import { describe, expect, test } from 'claude-code/testing'

import { GADGETS, STATUS } from './fixture'
import { STATUS_FREE, STATUS_PLANES, STATUS_WEB } from './fixture-sections'
import { PLANES_STATE } from './fixture-planes-state'
import { BAND_IDS } from '../hooks/tools'
import { logOf, start, world, type World } from './world'

// The six tools Claude can call (hooks/tools.ts), through the same fake world as the tab: radio.py and
// adsb.py answered from fixtures, files in memory, no RTL-SDR anywhere.

const NAMES = ['sdr_status', 'sdr_planes', 'sdr_gadgets', 'sdr_scan', 'sdr_tune', 'sdr_job'] as const

async function call($: any, tool: (typeof NAMES)[number], input: Record<string, unknown> = {}): Promise<string> {
  const r = await $.tool.call({ tool: `mcp__radio__${tool}`, ...input })
  return String((r as any).text ?? (r as any).result ?? '')
}

// Start the plugin and let its own start-up reads (status, the gadget list) finish, so a test sees only what a tool did.
async function up($: any, w: World): Promise<void> {
  await start($)
  await w.clock.advance(200)
  w.calls.length = 0
}

const joined = (w: World) => w.calls.map(c => c.join(' '))
// Everything that starts, stops or tunes something on the V4 (a read never does).
const ACTING = /^(scan (fm|noaa|air|adsb|2m|70cm|murs|marine|rail|gmrs|433|lora|mesh)|listen |job |stop|gadgets (start|stop)|live (start|stop)|share|biast|set |hf |calibrate|snapshot [0-9]|rec |log |record |play)/

function numbers(text: string): any {
  return JSON.parse(text.slice(text.indexOf('Numbers:\n') + 'Numbers:\n'.length))
}

describe('the tools are registered', () => {
  test('six tools, each with a schema and a description that says it only receives', async ($, on) => {
    const w = world(on)
    await up($, w)
    expect(w.tools.map(t => t.name)).toEqual([...NAMES])
    const by = Object.fromEntries(w.tools.map(t => [t.name, t]))
    for (const t of w.tools) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.description.length).toBeGreaterThan(200)
      expect(t.description).toMatch(/nothing here can transmit/)
    }
    expect(Object.keys(by.sdr_planes?.inputSchema.properties ?? {})).toEqual(['limit'])
    expect(by.sdr_scan?.inputSchema.required).toEqual(['band'])
    expect(by.sdr_scan?.inputSchema.properties.band.enum).toEqual([...BAND_IDS])
    expect(Object.keys(by.sdr_tune?.inputSchema.properties ?? {})).toEqual(['mhz', 'mode', 'station', 'stop'])
    expect(by.sdr_tune?.inputSchema.properties.mode.enum).toEqual(['wbfm', 'fm', 'am', 'usb', 'lsb', 'cw'])
    // The only jobs that can be switched; nothing that starts Docker, opens a port or powers the antenna.
    expect(by.sdr_job?.inputSchema.properties.job.enum).toEqual(['planes', 'aprs', 'alerts', 'gadgets'])
    expect(by.sdr_job?.inputSchema.required).toEqual(['job', 'state'])
    // The actions say plainly that they take the V4 and stop what was running.
    for (const n of ['sdr_scan', 'sdr_tune', 'sdr_job']) expect(by[n]?.description).toMatch(/takes the V4 and stops/)
    // The job tool names what stays in the tab.
    expect(by.sdr_job?.description).toMatch(/will NOT start Web SDR/)
    expect(by.sdr_job?.description).toMatch(/opens a network port with no password/)
    expect(by.sdr_job?.description).toMatch(/bias-tee/)
    // The reads say they only read, and the gadgets one that IDs are left out.
    expect(by.sdr_status?.description).toMatch(/it never starts, stops or tunes anything/)
    expect(by.sdr_planes?.description).toMatch(/does NOT start Planes/)
    expect(by.sdr_gadgets?.description).toMatch(/Sensor IDs are never included/)
  })

  test('the scan tool takes exactly the band ids the tab\'s band buttons use', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await up($, w)
    for (const id of BAND_IDS) {
      w.calls.length = 0
      const text = await call($, 'sdr_scan', { band: id })
      expect(w.calls.some(c => c[0] === 'scan' && c[1] === id), id).toBe(true)
      expect(text, id).toMatch(/signals? above the noise floor|Scan failed|scan/i)
    }
  })
})

describe('the read tools never start, stop or tune anything', () => {
  test('sdr_status says what /sdr says, plus the place and the band ids', async ($, on) => {
    const w = world(on)
    await up($, w)
    const text = await call($, 'sdr_status')
    expect(text).toMatch(/^Place: Walton, KY/)
    expect(text).toMatch(/RTL-SDR Blog V4: connected/)
    expect(text).toMatch(/Tuner 162\.55 MHz NFM/)
    expect(text).toMatch(/Gadget listener on \(433\.92 MHz\)/)
    expect(text).toMatch(/Last scan: FM broadcast/)
    expect(text).toMatch(/Planes off/)
    expect(text).toMatch(/APRS off/)
    expect(text).toMatch(/Bands for sdr_scan/)
    expect(text).toMatch(/FM broadcast\s+\d+ signals/)
    // The tab's slash-command list is for the person typing; the tool leaves it out.
    expect(text).not.toMatch(/\/sdr scan <band>/)
    expect(joined(w).filter(c => ACTING.test(c))).toEqual([])
    expect(w.calls.length).toBeGreaterThan(0)
  })

  test('sdr_status names what holds the V4 (Planes), and works with the V4 unplugged', async ($, on) => {
    const w = world(on, { status: STATUS_PLANES })
    await up($, w)
    expect(await call($, 'sdr_status')).toMatch(/in use by Planes/)
  })

  test('sdr_status works with the V4 unplugged, and starts nothing', async ($, on) => {
    const w = world(on, { status: { ...STATUS_FREE, device: { present: false }, state: 'missing', holder: null } })
    await up($, w)
    expect(await call($, 'sdr_status')).toMatch(/not found\. Plug it into the Mac/)
    expect(joined(w).filter(c => ACTING.test(c))).toEqual([])
  })

  test('sdr_planes lists the saved aircraft with distance and bearing, from adsb.py state only', async ($, on) => {
    const w = world(on, { status: STATUS_PLANES })
    await up($, w)
    const text = await call($, 'sdr_planes')
    expect(w.calls.map(c => c.join(' ')).filter(c => c.startsWith('adsb.py'))).toEqual(['adsb.py state'])
    expect(text).toMatch(/4 aircraft \(3 with a position\).*Walton, KY\. Planes is on, data updated \d+ s ago/)
    expect(text).toMatch(/DAL123 · 11,200 ft · 245 kt · 6\.1 nm N \(2°\) · heard \d+ s ago/)
    // A plane with only its registration, a plane with only its hex, one without a position.
    expect(text).toMatch(/N22222 · 36,000 ft · 470 kt · 42\.6 nm E \(94°\)/)
    expect(text).toMatch(/hex A44444 · 21,000 ft · speed unknown · no position yet/)
    expect(text).toMatch(/UPS77 .* 12\.4 nm SW \(215°\).* EMERGENCY nordo \(squawk 7600\)/)
    const n = numbers(text)
    expect(n.planesOn).toBe(true)
    expect(n.aircraft).toHaveLength(4)
    expect(n.aircraft[0]).toMatchObject({ flight: 'DAL123', altitudeFt: 11200, speedKt: 245, distanceNm: 6.1, bearingDeg: 2 })
    // The receiver's coordinates never leave the script.
    expect(text).not.toMatch(/38\.0|-84\.0/)
    expect(joined(w).filter(c => ACTING.test(c))).toEqual([])
  })

  test('sdr_planes with Planes off does not start it, and says the data is old; limit caps the list', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, planesState: { ...PLANES_STATE, updated: PLANES_STATE.updated - 600_000 } })
    await up($, w)
    const text = await call($, 'sdr_planes', { limit: 2 })
    expect(text).toMatch(/Planes is off, data updated 10 min ago: these are from the last run, not live/)
    expect(text).toMatch(/and 2 more/)
    expect(numbers(text).aircraft).toHaveLength(2)
    expect(joined(w).some(c => c.startsWith('job '))).toBe(false)
  })

  test('sdr_planes with nothing saved says how to start Planes and does not start it', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, planesState: { ...PLANES_STATE, aircraft: [] } })
    await up($, w)
    expect(await call($, 'sdr_planes')).toMatch(/No aircraft saved\. Planes is off, and it does not start from here/)
    expect(joined(w).some(c => c.startsWith('job '))).toBe(false)
  })

  test('sdr_gadgets lists the sensors heard with their readings, and no sensor IDs', async ($, on) => {
    const w = world(on)
    await up($, w)
    const text = await call($, 'sdr_gadgets')
    expect(text).toMatch(/Gadget listener on \(433\.92 MHz\) · 3 devices heard so far/)
    expect(text).toMatch(/Acurite-Tower ch A · outdoor temperature \/ humidity sensor · 57\.0°F \(13\.9°C\) · 43% humidity · heard .* · 8×/)
    expect(text).toMatch(/Neighbourhood: 3 heard today, 2 in the last hour · low battery: Acurite-Tower/)
    expect(numbers(text).devices).toHaveLength(3)
    expect(numbers(text).devices[0]).toMatchObject({ model: 'Acurite-Tower', reading: '57.0°F (13.9°C) · 43% humidity', timesHeard: 8, lowBattery: true })
    expect(w.calls.some(c => c.join(' ') === 'gadgets list')).toBe(true)
    expect(joined(w).filter(c => ACTING.test(c))).toEqual([])
    // None of the fixture's IDs or keys.
    for (const d of GADGETS.devices) {
      expect(text).not.toContain(d.key)
      expect(text).not.toContain(`"id"`)
    }
  })

  test('sdr_gadgets scrubs an ID even when the decoder printed it in the reading', async ($, on) => {
    const devices = [
      { key: 'Hyundai-VDO|7391402|0', model: 'Hyundai-VDO', models: null, id: 7391402, channel: null, kind: 'tire-pressure sensor (a passing car)', first: GADGETS.now - 60_000, last: GADGETS.now - 30_000, count: 3, rssi: -9, snr: 20, say: 'id 7391402 · 32.1 psi · 71°F', tempF: 71, lowBattery: false },
      { key: 'Oregon-THGR|55120938|2', model: 'Oregon-THGR', models: null, id: '55120938', channel: 2, kind: 'temperature / humidity sensor', first: GADGETS.now - 90_000, last: GADGETS.now - 5000, count: 9, rssi: -11, snr: 18, say: '68.0°F (20.0°C) · 40% humidity', tempF: 68, lowBattery: true },
    ]
    const w = world(on, { gadgets: { ...GADGETS, total: 2, devices, hood: { ...GADGETS.hood, lowBattery: ['Oregon-THGR'] } } })
    await up($, w)
    const text = await call($, 'sdr_gadgets')
    expect(text).toContain('Hyundai-VDO')
    expect(text).toContain('32.1 psi')
    for (const secret of ['7391402', '55120938', 'Hyundai-VDO|', 'Oregon-THGR|']) expect(text).not.toContain(secret)
    expect(JSON.stringify(numbers(text))).not.toMatch(/7391402|55120938/)
  })

  test('sdr_gadgets with the listener off says so and how to start it, without starting it', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, gadgets: { ...GADGETS, running: false } })
    await up($, w)
    const text = await call($, 'sdr_gadgets')
    expect(text).toMatch(/Gadget listener off \(sdr_job gadgets on starts it\)/)
    expect(joined(w).filter(c => ACTING.test(c))).toEqual([])
  })
})

describe('the actions go through the tab\'s own queue and say what they stopped', () => {
  test('sdr_scan scans the band and lists the signals; the gadget listener pause is in the answer', async ($, on) => {
    const w = world(on)
    await up($, w)
    const text = await call($, 'sdr_scan', { band: 'fm' })
    expect(w.calls.filter(c => c[0] === 'scan' && c[1] !== 'list')).toEqual([['scan', 'fm']])
    expect(text).toMatch(/FM broadcast: \d+ signals above the noise floor/)
    expect(text).toMatch(/The gadget listener paused for the scan and is back on\./)
    expect(text).toMatch(/noise floor/)
    expect(text).toMatch(/\(\/sdr listen /)
    // An alias for a band works like the id.
    w.calls.length = 0
    await call($, 'sdr_scan', { band: 'weather' })
    expect(w.calls.filter(c => c[0] === 'scan' && c[1] !== 'list')).toEqual([['scan', 'noaa']])
    await w.clock.advance(2000)
    expect(logOf(w).some(l => l.action === 'Scanning FM broadcast' && l.ok === true)).toBe(true)
  })

  test('sdr_tune plays a frequency through the speakers and says it paused the gadget listener', async ($, on) => {
    const w = world(on)
    await up($, w)
    const text = await call($, 'sdr_tune', { mhz: 94.1, mode: 'wbfm' })
    expect(w.calls.filter(c => c[0] === 'listen')).toHaveLength(1)
    expect(w.calls.find(c => c[0] === 'listen')?.slice(0, 3)).toEqual(['listen', '94.1', 'wbfm'])
    // Not --quick: the tool waits for the signal check, like /sdr listen.
    expect(w.calls.find(c => c[0] === 'listen')).not.toContain('--quick')
    expect(text).toMatch(/Now playing 94\.1 WNNF/)
    expect(text).toMatch(/paused the gadget listener: the V4 does one thing at a time/)
    await w.clock.advance(2000)
    expect(logOf(w).some(l => l.key === 'listen 94.1 wbfm' && l.ok === true)).toBe(true)
  })

  test('sdr_tune by station name: a call sign, NOAA, marine 16; two matches are asked about, an unknown one is not guessed', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await up($, w)
    const listens = () => w.calls.filter(c => c[0] === 'listen').map(c => c.slice(1, 3).join(' '))
    await call($, 'sdr_tune', { station: 'WEBN' })
    await call($, 'sdr_tune', { station: 'NOAA' })
    await call($, 'sdr_tune', { station: 'marine 16' })
    await call($, 'sdr_tune', { station: 'WWV 10', mode: 'am' })
    expect(listens()).toEqual(['102.7 wbfm', '162.55 fm', '156.8 fm', '10 am'])
    w.calls.length = 0
    const many = await call($, 'sdr_tune', { station: 'K4CO' })
    expect(many).toMatch(/matches more than one station: .*147\.03.*147\.255/)
    const none = await call($, 'sdr_tune', { station: 'Nothing Radio' })
    expect(none).toMatch(/does not know a station called "Nothing Radio"/)
    expect(w.calls.filter(c => c[0] === 'listen')).toEqual([])
  })

  test('sdr_tune below 28.8 MHz warns that HF needs a long wire; stop stops the audio', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await up($, w)
    const text = await call($, 'sdr_tune', { mhz: 10, mode: 'am' })
    expect(text).toMatch(/HF through the V4’s upconverter: it needs a 10–20 m long wire/)
    const stop = await call($, 'sdr_tune', { stop: true })
    expect(w.calls.filter(c => c[0] === 'listen' && c[1] === 'stop')).toHaveLength(1)
    expect(stop).toMatch(/Stopped/)
  })

  test('sdr_job planes on stops what was running (Web SDR) and says so; off stops only Planes', async ($, on) => {
    const w = world(on, { status: STATUS_WEB })
    await up($, w)
    const text = await call($, 'sdr_job', { job: 'planes', state: 'on' })
    expect(w.calls.filter(c => c[0] === 'job')).toEqual([['job', 'start', 'adsb']])
    expect(text).toMatch(/Planes on\./)
    expect(text).toMatch(/stopped Web SDR: the V4 does one thing at a time/)
    await w.clock.advance(2000)
    expect(logOf(w).find(l => l.key === 'job adsb on')).toMatchObject({ ok: true })
    w.calls.length = 0
    const off = await call($, 'sdr_job', { job: 'planes', state: 'off' })
    expect(w.calls.filter(c => c[0] === 'job')).toEqual([['job', 'stop', 'adsb']])
    expect(off).toMatch(/Planes off\./)
  })

  test('sdr_job maps aprs, alerts and gadgets onto the tab\'s jobs', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await up($, w)
    await call($, 'sdr_job', { job: 'aprs', state: 'on' })
    await call($, 'sdr_job', { job: 'alerts', state: 'on' })
    await call($, 'sdr_job', { job: 'gadgets', state: 'on' })
    await call($, 'sdr_job', { job: 'gadgets', state: 'off' })
    expect(w.calls.filter(c => c[0] === 'job' || (c[0] === 'gadgets' && c[1] !== 'list')).map(c => c.slice(0, 3).join(' '))).toEqual(['job start aprs', 'job start same', 'gadgets start 433', 'gadgets stop'])
  })

  test('a tool call and a press never overlap: the second waits for the first, in order, both in the timing log', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, slowListen: true })
    await up($, w)
    const first = call($, 'sdr_tune', { mhz: 94.1, mode: 'wbfm' })
    const second = call($, 'sdr_job', { job: 'planes', state: 'on' })
    await w.clock.advance(10)
    // The listen is under way (asleep on the clock); Planes has not started.
    expect(joined(w).filter(c => c.startsWith('listen 94.1'))).toHaveLength(1)
    expect(joined(w).some(c => c === 'job start adsb')).toBe(false)
    await w.clock.advance(3100)
    await Promise.all([first, second])
    const order = joined(w)
    const li = order.findIndex(c => c.startsWith('listen 94.1'))
    expect(li).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('job start adsb')).toBeGreaterThan(li)
    await w.clock.advance(2000)
    const log = logOf(w)
    expect(log.find(l => l.key === 'listen 94.1 wbfm')).toMatchObject({ queued: false, ok: true })
    expect(log.find(l => l.key === 'job adsb on')).toMatchObject({ queued: true, ok: true })
  })
})

describe('what stays in the tab', () => {
  const REFUSED: [string, Record<string, unknown>, RegExp][] = [
    ['sdr_job', { job: 'web', state: 'on' }, /Web SDR starts a Docker container, so it stays in the tab/],
    ['sdr_job', { job: 'webrx', state: 'on' }, /Docker/],
    ['sdr_job', { job: 'share', state: 'on' }, /opens a network port with no password/],
    ['sdr_job', { job: 'biast', state: 'on' }, /bias-tee puts DC on the antenna port and can damage gear/],
    ['sdr_job', { job: 'bias-tee', state: 'on' }, /can damage gear/],
    ['sdr_job', { job: 'ppm', state: 'on' }, /PPM and the other settings stay in the tab/],
    ['sdr_job', { job: 'settings', state: 'on' }, /stay in the tab/],
    ['sdr_job', { job: 'hf', state: 'on' }, /The HF test stays in the tab/],
    ['sdr_job', { job: 'delete', state: 'on' }, /Recordings .* stay in the tab/],
    ['sdr_job', { job: 'recordings', state: 'off' }, /stay in the tab/],
    ['sdr_job', { job: 'scanner', state: 'on' }, /Scanner and the live view stay in the tab/],
    ['sdr_job', { job: 'planes' }, /needs state "on" or "off"/],
    ['sdr_job', { job: 'telemetry', state: 'on' }, /sdr_job can switch planes, aprs, alerts or gadgets/],
    ['sdr_scan', {}, /needs a band/],
    ['sdr_scan', { band: 'web' }, /stays in the tab/],
    ['sdr_scan', { band: 'custom 150 174' }, /Custom ranges stay in the tab/],
    ['sdr_scan', { band: 'cellular' }, /"cellular" is not a band\. Bands: fm, noaa/],
    ['sdr_tune', {}, /needs \{ mhz, mode \}/],
    ['sdr_tune', { mhz: 0 }, /from 0\.1 to 1766 MHz/],
    ['sdr_tune', { mhz: 5000 }, /from 0\.1 to 1766 MHz/],
    ['sdr_tune', { mhz: 'loud' }, /from 0\.1 to 1766 MHz/],
    ['sdr_tune', { mhz: 94.1, mode: 'dmr' }, /Mode "dmr" is not one the tuner has/],
  ]
  for (const [tool, input, re] of REFUSED) {
    test(`${tool} ${JSON.stringify(input)} is refused in words and touches nothing`, async ($, on) => {
      const w = world(on)
      await up($, w)
      const text = await call($, tool as (typeof NAMES)[number], input)
      expect(text).toMatch(re)
      expect(w.calls).toEqual([])
    })
  }

  test('a tool that fails answers in words instead of throwing', async ($, on) => {
    // adsb.py answers something that is not the state: the tool says so.
    const w = world(on, { status: STATUS_FREE, planesState: { ok: false, say: 'no state file' } })
    await up($, w)
    expect(await call($, 'sdr_planes')).toMatch(/Could not read the Planes data: no state file/)
    expect(w.calls.some(c => c[0] === 'job')).toBe(false)
  })
})

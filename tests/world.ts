import { describe, expect, mock, test } from 'claude-code/testing'
import type { JsonValue, On } from 'claude-code'

import { GADGETS, LISTEN_NOAA, LISTEN_WEAK, LIVE_FM, MESH, METER_NOAA, METER_WEAK, SCAN_FM, SCAN_LORA, STATUS } from './fixture'
import { ALERTS_NONE, ALERTS_WARNING, APRS_HEARD, APRS_NOTHING, PLANES_QUIET, PLANES_VIEW, SAME_TEST, STATUS_FREE, STATUS_PLANES, STATUS_WEB, WEB_STATUS } from './fixture-sections'
import { EQ_NFM, EQ_WBFM, RECS_TODAY } from './fixture-recordings'
import { PLANES_STATE } from './fixture-planes-state'

// webrx/status.sh's background decoding (from its live settings.json).
export const WEB_BACKGROUND = { enabled: true, decoders: ['packet', 'ism'], schedule: { '1000-0400': '2 m 143.8-146.2 MHz (APRS 144.39)', '0400-1000': '433 MHz ISM 432.3-434.7 MHz (rtl_433)' }, utc: true }

// The world beneath the plugin: radio.py answered from fixtures captured on the real V4, every call recorded.
export const stored = new Map<string, unknown>()
// slowPoll: one process (a radio.py verb or a script's file name) that sleeps slowMs on the mock clock;
// files: what the plugin wrote ($.fs.write), e.g. the timing log actions.jsonl.
export type World = { calls: string[][]; toasts: string[]; status: (string | undefined)[]; clock: ReturnType<typeof mock.clock>; eqReads: number; slow: boolean; handoff: any; slowPoll: string | null; slowMs: number; files: Map<string, string>; ppm: number; biast: boolean; tools: { name: string; description: string; inputSchema: any }[] }

const LABELS: Record<string, string> = { gadgets: 'Gadget listener', listen: 'Audio', share: 'Phone share', live: 'Live view', webrx: 'Web SDR', adsb: 'Planes', aprs: 'APRS', same: 'Weather alerts', scanner: 'Scanner', snapshot: 'IQ snapshot' }
// 0.4.0 fixtures: the Scanner's favourites and a parked state, two IQ snapshots, the settings.
export const SCAN_CHANNELS = [
  { freq: 146.52, mode: 'fm', name: '2 m calling', squelch: 40 },
  { freq: 147.03, mode: 'fm', name: 'K4CO Edgewood', squelch: 40 },
  { freq: 162.55, mode: 'fm', name: 'NOAA KIH42', squelch: 0 },
]
export const SNAP_FILE = '2026-10-07/433.920_1024k.cu8'
export const SNAP_ITEMS = [
  { file: SNAP_FILE, mhz: 433.92, rate: 1_024_000, seconds: 10, gain: null, at: 1791249400000, size: 20_480_000, mtime: 1791249410000, label: '433.92: sensors, remotes, doorbells' },
  { file: '2026-10-07/162.550_1024k.cu8', mhz: 162.55, rate: 1_024_000, seconds: 20, gain: null, at: 1791249300000, size: 40_960_000, mtime: 1791249320000, label: 'NOAA KIH42 Covington' },
]
export const HF_DRIVER = { supported: true, lib: 'Homebrew librtlsdr (osmocom >= 2.0.3)', note: 'The RTL-SDR Blog V4 auto-upconverts by 28.8 MHz when tuned below 28.8 MHz, so HF works through rtl_fm / rtl_power / rtl_sdr with no flag or separate driver. HF still needs a proper antenna (a 10-20 m long wire through a 9:1 balun).' }
const DOING: Record<string, string> = { adsb: 'track planes (ADS-B on 1090 MHz)', aprs: 'decode APRS on 144.390 MHz', same: 'watch for NOAA weather alerts on 162.550 MHz', webrx: 'run Web SDR' }

export function world(on: On, opts: { status?: any; gadgets?: any; gadgetsOn?: boolean; planes?: any; aprs?: any; alerts?: any; store?: Record<string, unknown>; recordings?: any; slowListen?: boolean; slowPoll?: string; location?: any; planesState?: any } = {}): World {
  const clock = mock.clock(on, { now: GADGETS.now + 60_000 })
  // A made-up home folder, so no test ever reads the real one.
  mock.env(on, { HOME: '/Users/test' })
  const w: World = { calls: [], toasts: [], status: [], clock, eqReads: 0, slow: !!opts.slowListen, handoff: null, slowPoll: opts.slowPoll ?? null, slowMs: 2000, files: new Map(), ppm: 0, biast: false, tools: [] }
  stored.clear()
  if (opts.gadgetsOn !== undefined) stored.set('gadgetsOn', opts.gadgetsOn)
  for (const [k, v] of Object.entries(opts.store ?? {})) stored.set(k, v)
  on('store.get', async (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', async (_$, e) => {
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  let status: any = { ...(opts.status ?? STATUS), mesh: MESH }
  let meter: any = null
  // Recordings as radio.py keeps them: ● Rec in the tap's meter, Log's file, the ffplay playing one.
  let recView: any = opts.recordings ?? RECS_TODAY
  let recLive: any = null
  let logOn = false
  let logSince: number | null = null
  let playingRec: any = null
  const recsNow = () => ({ ...recView, rec: recLive, log: { ...recView.log, on: logOn, since: logSince, count: logOn ? 7 : 0 }, playing: playingRec, listen: { running: !!status.listen?.running, label: status.listen?.label, freq: status.listen?.freq, volume: 100, tap: 2 } })
  // The EQ display reads the tap's eq.json from the state folder while it plays.
  on('fs.read', async (_$, e) => {
    if (String(e.path).endsWith('/radio/eq.json') && status.listen?.running) {
      w.eqReads++
      const base: any = status.listen.mode === 'wbfm' ? EQ_WBFM : EQ_NFM
      return { value: JSON.stringify({ ...base, at: base.at + w.eqReads, since: status.listen.since, freq: status.listen.freq }) }
    }
    // Web SDR's "Send to Radio tab" (webrx/handoff.py writes it).
    if (String(e.path).endsWith('/radio/handoff.json') && w.handoff) return { value: JSON.stringify(w.handoff) }
    // The timing log: what this test's plugin wrote, else empty (never the real one).
    if (String(e.path).endsWith('/radio/actions.jsonl')) return { value: w.files.get(String(e.path)) ?? '' }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('fs.write', async (_$, e) => {
    w.files.set(String(e.path), String(e.text))
    return { value: undefined }
  })
  const list = opts.gadgets ?? GADGETS
  const quiet = { running: false, since: null, lastExit: null }
  // Every job's state in one place, as radio.py keeps it: starting one stops the others (and says so).
  const setJobs = (kind: string | null) => {
    const jobs: Record<string, any> = {}
    for (const [k, j] of Object.entries(status.jobs ?? {})) jobs[k] = { ...(j as object), running: k === kind }
    if (kind && !jobs[kind]) jobs[kind] = { running: true, since: GADGETS.now, lastExit: null, label: LABELS[kind] }
    const holder = kind ? { kind, label: LABELS[kind] ?? kind, detail: kind === 'webrx' ? 'OpenWebRX+ on :8073' : null, since: GADGETS.now, pid: 4242, ours: true } : null
    status = { ...status, jobs, holder, state: kind ? 'ours' : 'free', owner: kind ? { pid: 4242, name: kind === 'webrx' ? 'rtl_tcp' : 'rtl_fm', app: LABELS[kind], ours: kind } : null, gadgets: { ...status.gadgets, running: kind === 'gadgets' }, listen: { ...quiet }, live: { ...quiet }, share: { ...quiet } }
  }
  on('process.run', async (_$, e) => {
    const py = e.argv[0] === 'python3'
    const file = String(py ? e.argv[1] : e.argv[0]).split('/').pop() ?? ''
    const args = [...e.argv.slice(py ? 2 : 1)]
    w.calls.push(file === 'radio.py' ? args : [file, ...args])
    const reply = (o: unknown) => ({ value: { exitCode: 0, stdout: JSON.stringify(o), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const [verb, sub] = args
    if (w.slowPoll && w.slowPoll !== 'status.sh' && w.slowPoll === (file === 'radio.py' ? verb : file)) await clock.sleep(w.slowMs)
    const running = (k: string) => (['gadgets', 'listen', 'share', 'live'].includes(k) ? !!status[k]?.running : !!status.jobs?.[k]?.running)
    if (file === 'adsb.py' && verb === 'view') {
      const v: any = opts.planes ?? PLANES_VIEW
      return reply({ ...v, range: args[args.indexOf('--range') + 1], job: { ...v.job, running: running('adsb') } })
    }
    if (file === 'adsb.py' && verb === 'state') return reply({ ...(opts.planesState ?? PLANES_STATE), now: GADGETS.now + 60_000, job: { running: running('adsb'), pid: null, since: null, lastExit: null } })
    if (file === 'digital.py' && verb === 'aprs' && sub === 'view') return reply(opts.aprs ?? APRS_NOTHING)
    if (file === 'digital.py' && verb === 'same' && sub === 'view') return reply(opts.alerts ?? ALERTS_NONE)
    if (file === 'digital.py' && verb === 'same' && sub === 'selftest') return reply(SAME_TEST)
    if (file === 'status.sh') {
      // What it saw when it was called; a slow one answers that much later.
      const out = running('webrx')
        ? { ...WEB_STATUS, map: 'http://localhost:8073/map', handoff: { port: 8074, running: true, pid: 4243 }, background: WEB_BACKGROUND }
        : { ...WEB_STATUS, running: false, container: 'absent', health: null, url: null, urls: {}, rtl_tcp_pid: null, map: null, handoff: { port: 8074, running: false, pid: null }, background: WEB_BACKGROUND }
      if (w.slowPoll === 'status.sh') await clock.sleep(w.slowMs)
      return reply(out)
    }
    if (file === 'sync-bookmarks.sh') return reply({ ok: true, count: 51, kept: 1, say: 'Bookmarks synced: 14 stations, 23 notable, 14 busy lately from recent scans; 1 of your own kept.' })
    if (file !== 'radio.py') return reply({ ok: false, say: `unknown ${file}` })
    if (verb === 'job' && (sub === 'start' || sub === 'stop')) {
      const kind = args[2] ?? ''
      if (sub === 'stop') {
        const was = running(kind)
        setJobs(null)
        return reply({ ok: true, stopped: was, say: was ? `${LABELS[kind]} off.` : `${LABELS[kind]} was not running.` })
      }
      const stopped: any[] = Object.keys(status.jobs ?? {})
        .filter(k => k !== kind && !['listen', 'live', 'share'].includes(k) && running(k))
        .map(k => ({ kind: k, label: LABELS[k] }))
      if (status.listen?.running) stopped.push({ kind: 'listen', label: status.listen.label, freq: status.listen.freq, mode: status.listen.mode })
      if (status.live?.running) stopped.push({ kind: 'live', label: status.live.label, preset: status.live.preset })
      setJobs(kind)
      const res = kind === 'webrx' ? WEB_STATUS : null
      return reply({ ok: true, say: kind === 'webrx' ? `Web SDR running at ${WEB_STATUS.url} (rtl_tcp pid ${WEB_STATUS.rtl_tcp_pid} holds the V4).` : `${LABELS[kind]} on.`, stopped, result: res, doing: DOING[kind] })
    }
    if (verb === 'handoff' && sub === 'clear') {
      w.handoff = null
      return reply({ ok: true, say: 'Handoff cleared.' })
    }
    if (verb === 'handoff') {
      // radio.py takes the file, stops Web SDR through the job system and plays it.
      const h = w.handoff
      w.handoff = null
      if (!h) return reply({ ok: true, handoff: null, say: 'No handoff from Web SDR is waiting.' })
      const wasWeb = running('webrx')
      setJobs(null)
      const label = `${h.mhz} MHz`
      status = { ...status, listen: { running: true, since: GADGETS.now, freq: h.mhz, mode: h.mode, label, player: 'ffplay', volume: 100, tap: 2, lastExit: null } }
      if (wasWeb) status.jobs.webrx = { ...status.jobs.webrx, lastExit: { at: GADGETS.now, reason: 'preempted', detail: `stopped so the V4 could play ${label} in the Radio tab` } }
      meter = { ...METER_NOAA.meter, freq: h.mhz, mode: h.mode, label, level: 0.6, weak: false, tap: 2 }
      return reply({ ok: true, say: `From Web SDR: Now playing ${label} (AM) on the Mac's audio output.`, listen: { freq: h.mhz, mode: h.mode, label }, meter, weak: null, handoff: { mhz: h.mhz, mode: h.mode, at: h.at }, stopped: wasWeb ? [{ kind: 'webrx', label: 'Web SDR', port: 8073 }] : [] })
    }
    // `location` reads location.json only (never the dongle): no file by default, so Walton, KY.
    if (verb === 'location') return reply(opts.location ?? { ok: true, custom: false, error: null, path: '/Users/test/Library/Application Support/radio/location.json', location: {} })
    if (verb === 'status') return reply(status)
    if (verb === 'last') return reply(SCAN_FM)
    if (verb === 'mesh') return reply(MESH)
    if (verb === 'gadgets' && sub === 'list') return reply({ ...list, running: status.gadgets.running })
    if (verb === 'gadgets' && sub === 'start') {
      status = { ...status, state: 'ours', gadgets: { ...status.gadgets, running: true } }
      return reply({ ok: true, say: 'Gadget listener on (433.92 MHz).', stopped: [] })
    }
    if (verb === 'gadgets' && sub === 'stop') {
      status = { ...status, state: 'free', gadgets: { ...status.gadgets, running: false } }
      return reply({ ok: true, say: 'Gadget listener off.' })
    }
    // 0.4.0: the Scanner shares the `scan` verb (list|on|off|hold|resume|skip|lockout|unlock|priority|add|remove).
    if (verb === 'scan' && ['list', 'status'].includes(sub ?? '')) {
      const on = running('scanner')
      const hits = [{ freq: 146.52, name: '2 m calling', mode: 'fm', at: GADGETS.now - 90_000, secs: 12.4 }, { freq: 147.03, name: 'K4CO Edgewood', mode: 'fm', at: GADGETS.now - 30_000, secs: 4.1 }]
      const state = on ? { running: true, since: GADGETS.now - 120_000, current: SCAN_CHANNELS[0], parked: true, scanning: false, hold: false, hits, heard: 3.5, level: 0.7, at: GADGETS.now } : null
      return reply({ running: on, state, channels: SCAN_CHANNELS, active: 2, lockout: [147.03], priority: 146.52, hold: false, dwell: 0.8, resume: 4, hits: on ? hits : [], now: GADGETS.now })
    }
    if (verb === 'scan' && (sub === 'on' || sub === 'start')) {
      const stopped: any[] = []
      if (status.listen?.running) stopped.push({ kind: 'listen', label: status.listen.label, freq: status.listen.freq, mode: status.listen.mode })
      setJobs('scanner')
      return reply({ ok: true, error: null, say: 'Scanner on.', stopped })
    }
    if (verb === 'scan' && (sub === 'off' || sub === 'stop')) {
      const was = running('scanner')
      setJobs(null)
      return reply({ ok: true, stopped: was, say: was ? 'Scanner off.' : 'The scanner was not running.' })
    }
    if (verb === 'scan' && ['hold', 'resume', 'skip', 'lockout', 'unlock', 'priority', 'add', 'remove', 'clear'].includes(sub ?? '')) {
      const say: Record<string, string> = { hold: 'Holding on the current channel. scan resume to carry on.', resume: 'Resumed scanning.', skip: 'Skipped to the next channel.', lockout: `Locked out ${args[2]} MHz. The scanner skips it now.`, unlock: `Unlocked ${args[2]} MHz.`, priority: args[2] === 'off' ? 'Priority channel off.' : `Priority channel set to ${args[2]} MHz; checked every few seconds.`, add: `Added ${args.slice(4).join(' ') || `${args[2]} MHz`} (${args[2]} MHz narrow FM) to the scanner.`, remove: `Removed ${args[2]} MHz from the scanner.`, clear: 'Cleared the lock-outs.' }
      return reply({ ok: true, say: say[sub!] })
    }
    if (verb === 'settings' || (verb === 'set' && !sub)) return reply({ ok: true, ppm: w.ppm, filters: { am: 12000, fm: 24000, usb: 12000, lsb: 12000, cw: 12000 }, biast: w.biast, tools: { rtl_sdr: true, rtl_biast: true }, hf: { confirmed: !!status.hf?.confirmed, at: null, evidence: status.hf?.confirmed ? 'marked by hand' : null, maxMhz: 28.8, driver: HF_DRIVER }, filterDefaults: { am: 12000, fm: 24000, usb: 12000, lsb: 12000, cw: 12000 }, now: GADGETS.now })
    if (verb === 'set' && sub === 'ppm') {
      w.ppm = Number(args[2])
      return reply({ ok: true, ppm: w.ppm, say: `PPM correction set to ${w.ppm}. It applies to listening, scanning, the live view and snapshots.` })
    }
    if (verb === 'set' && sub === 'filter') return reply({ ok: true, say: `${args[2]} filter width set to ${args[3]} Hz (takes effect on the next Listen).` })
    if (verb === 'biast') {
      w.biast = sub === 'on'
      return reply({ ok: true, on: w.biast, say: w.biast ? 'Bias-tee ON: 4.5 V DC now feeds the antenna port. Only for an amplifier or an active antenna that needs power.' : 'Bias-tee OFF: no DC on the antenna port.' })
    }
    if (verb === 'hf') {
      if (sub === 'confirm') status = { ...status, hf: { confirmed: true } }
      if (sub === 'reset') status = { ...status, hf: { confirmed: false } }
      const st = { ok: true, confirmed: !!status.hf?.confirmed, at: null, evidence: status.hf?.confirmed ? 'marked by hand' : null, maxMhz: 28.8, driver: HF_DRIVER }
      if (sub === 'test') return reply({ ...st, heard: false, mhz: Number(args[2] ?? 10), say: `No clear carrier at ${args[2] ?? 10} MHz. HF needs a long-wire antenna through a 9:1 balun; try again with one connected, outdoors or by a window.` })
      if (sub === 'confirm') return reply({ ...st, say: 'HF marked as confirmed: the HF presets now light up.' })
      return reply(st)
    }
    if (verb === 'calibrate') return reply({ ok: true, ppm: -2, measured: 162.550325, expected: 162.55, stopped: [], say: 'Calibrated: the 162.55 MHz carrier read 0.325 kHz off, so PPM is set to -2.' })
    if (verb === 'snapshot' && (!sub || sub === 'list')) return reply({ ok: true, items: SNAP_ITEMS, total: SNAP_ITEMS.reduce((a, b) => a + b.size, 0), keep: { gb: 4, days: 30 }, root: '~/Radio/IQ', now: GADGETS.now })
    if (verb === 'snapshot' && sub === 'waterfall') return reply({ ok: true, file: args[2], mhz: 433.92, rate: 1_024_000, cols: 8, rows: 2, start: 433.408, stop: 434.432, scale: [-40, -10], png: 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAACCAIAAADq9gq6AAAAC0lEQVR4nGNgGAUAAAEAAZ3F4sMAAAAASUVORK5CYII=', wf: { cols: 8, rows: 2, b64: 'AAAAAP8AAAAAAAAAAAAAAA==' } })
    if (verb === 'snapshot' && sub === 'decode') return reply({ ok: true, file: args[2], events: 3, models: { 'Acurite-Tower': 3 }, devices: ['Acurite-Tower'], say: 'rtl_433 decoded 3 messages from 1 device model in the snapshot.' })
    if (verb === 'snapshot' && sub === 'delete') return reply({ ok: true, say: `Moved ${String(args[2]).split('/').pop()} to the Trash.` })
    if (verb === 'snapshot') {
      setJobs('snapshot')
      return reply({ ok: true, file: `2026-10-07/${Number(sub).toFixed(3)}_1024k.cu8`, mhz: Number(sub), rate: 1_024_000, seconds: Number(args[args.indexOf('--seconds') + 1] || 20), stopped: [], say: `Capturing ${args[args.indexOf('--seconds') + 1] || 20} s of raw I/Q at ${sub} MHz (1.024 MS/s, about 20 MB) to ~/Radio/IQ/2026-10-07/${Number(sub).toFixed(3)}_1024k.cu8. It stops by itself; then ▶ renders a waterfall.` })
    }
    if (verb === 'scan') return reply({ ...(sub === 'lora' ? SCAN_LORA : SCAN_FM), gadgets: { paused: true, restarted: true }, stopped: [] })
    if (verb === 'live' && sub === 'start') {
      const was = status.gadgets.running
      status = { ...status, gadgets: { ...status.gadgets, running: false }, live: { running: true, since: GADGETS.now, preset: args[2], label: args[2] === 'lora' ? 'Meshtastic / LoRa' : 'FM broadcast', lastExit: null } }
      return reply({ ok: true, say: 'Live view on: FM broadcast (87.5-108 MHz), a new row about every second.', live: { label: 'FM broadcast', lo: 87.5, hi: 108, preset: args[2] }, stopped: was ? [{ kind: 'gadgets', band: '433' }] : [] })
    }
    if (verb === 'live' && sub === 'stop') {
      status = { ...status, live: { ...quiet } }
      return reply({ ok: true, stopped: true, say: 'Live view off.' })
    }
    if (verb === 'live' && sub === 'frame') return reply(status.live?.running ? { ...LIVE_FM, running: true } : { ...LIVE_FM, running: false, lastExit: status.live?.lastExit ?? null })
    if (verb === 'live' && sub === 'reset') return reply({ ok: true, say: 'Max hold cleared.' })
    if (verb === 'listen' && sub === 'meter') return reply(status.listen.running ? { ok: true, running: true, meter: { ...meter, rec: recLive, log: logOn ? { on: true, since: logSince, clips: 2, dropped: 0, open: false, gate: 'squelch', skipped: null } : null } } : { ok: true, running: false, meter: null })
    if (verb === 'recordings') return reply(recsNow())
    if (verb === 'rec' && sub === 'start') {
      if (!status.listen?.running) return reply({ ok: false, error: 'idle', say: 'Nothing is playing: press ▶ Listen first, then ● Rec.' })
      recLive = { on: true, id: '1', file: '2026-10-05/224800_94.100_wfm_WNNF.m4a', since: GADGETS.now, seconds: 42.4, bytes: 340_000, until: null }
      return reply({ ok: true, rec: recLive, say: `Recording ${status.listen.label} to ~/Radio/Recordings/2026-10-05/224800_94.100_wfm_WNNF.m4a.` })
    }
    if (verb === 'rec' && sub === 'stop') {
      const was = recLive
      recLive = null
      return reply({ ok: true, stopped: !!was, say: was ? `Saved 0 min 42 s (340 KB): ${was.file}.` : '● Rec was not on.' })
    }
    if (verb === 'rec' && sub === 'keep') return reply({ ok: true, keep: { gb: Number(args[2]), days: 30 }, trashed: [], say: `Keeping recordings up to ${args[2]} GB and 30 days. 4.7 MB on disk.` })
    if (verb === 'rec' && sub === 'delete') {
      recView = { ...recView, items: recView.items.filter((i: any) => i.file !== args[2]) }
      return reply({ ok: true, say: `Moved ${args[2]} to the Trash.` })
    }
    if (verb === 'rec' && sub === 'reveal') return reply({ ok: true, say: 'Opened ~/Radio/Recordings/2026-10-05 in Finder.' })
    if (verb === 'log') {
      logOn = sub === 'start'
      logSince = logOn ? GADGETS.now : null
      return reply({ ok: true, log: { on: logOn, since: logSince }, say: logOn ? 'Log on: each transmission is saved as a clip, on 2 m calling (simplex) by squelch 40.' : 'Log off: 7 transmissions saved since 9:10 pm (1 min 02 s).' })
    }
    if (verb === 'play') {
      if (sub === 'stop') {
        const was = playingRec
        playingRec = null
        return reply({ ok: true, stopped: !!was, say: was ? `Stopped playing ${was.file}.` : 'Nothing was playing back.' })
      }
      playingRec = { pid: 777, file: sub, started: GADGETS.now, duration: 4.6, volume: 100 }
      return reply({ ok: true, playing: playingRec, say: `Playing ${sub} (4 s) on the Mac.` })
    }
    if (verb === 'record') {
      const f = Number(sub)
      const label = Math.abs(f - 162.55) < 0.001 ? 'NOAA KIH42 Covington' : `${f} MHz`
      status = { ...status, gadgets: { ...status.gadgets, running: false }, listen: { running: true, since: GADGETS.now, freq: f, mode: args[2], label, player: 'ffplay', volume: 0, tap: 2, autostop: true, lastExit: null } }
      recLive = { on: true, id: '2', file: `2026-10-05/224900_${f.toFixed(3)}_nfm_NOAA-KIH42-Covington.m4a`, since: GADGETS.now, seconds: 0, bytes: 0, until: GADGETS.now + Number(args[3]) * 1000 }
      meter = { ...METER_NOAA.meter, tap: 2 }
      return reply({ ok: true, rec: recLive, listen: { freq: f, mode: args[2], label }, stopped: [], say: `Recording ${args[3]} s of ${label}, muted; it stops by itself. The file: ~/Radio/Recordings/2026-10-05/224900_162.550_nfm_NOAA-KIH42-Covington.m4a.` })
    }
    if (verb === 'listen' && sub === 'stop') {
      status = { ...status, listen: { ...quiet } }
      return reply({ ok: true, stopped: true, say: 'Stopped 94.1 WNNF.' })
    }
    if (verb === 'listen') {
      const f = Number(sub)
      const weak = Math.abs(f - 162.45) < 0.001
      const noaa = Math.abs(f - 162.55) < 0.001
      const stopped: any[] = []
      if (status.gadgets.running) stopped.push({ kind: 'gadgets', band: '433' })
      if (status.live?.running) {
        stopped.push({ kind: 'live', preset: status.live.preset, label: status.live.label })
        status = { ...status, live: { running: false, since: null, lastExit: { at: GADGETS.now, reason: 'preempted', detail: 'stopped so the V4 could play 94.1 WNNF' } } }
      }
      const label = weak ? 'NOAA weather radio' : noaa ? 'NOAA KIH42 Covington' : f === 94.1 ? '94.1 WNNF' : `${f} FM`
      if (w.slow) await clock.sleep(3000)
      status = { ...status, gadgets: { ...status.gadgets, running: false }, listen: { running: true, since: GADGETS.now, freq: f, mode: args[2], label, player: 'ffplay', volume: 100, tap: 2, lastExit: null } }
      meter = weak ? METER_WEAK.meter : noaa ? METER_NOAA.meter : { ...METER_NOAA.meter, freq: f, mode: args[2], label, level: 0.8, weak: false, tap: 2 }
      const base = weak ? LISTEN_WEAK : noaa ? LISTEN_NOAA : { ...LISTEN_NOAA, say: "Now playing 94.1 WNNF (wide FM) on the Mac's audio output.", meter, weak: null }
      // --quick (a press) answers as soon as it plays: no meter yet and no verdict, as radio.py does.
      if (args.includes('--quick')) {
        const how = args[2] === 'wbfm' ? 'wide FM' : args[2] === 'am' ? 'AM' : 'narrow FM'
        return reply({ ...base, say: `Now playing ${label} (${how}) on the Mac's audio output.`, meter: null, weak: null, stopped })
      }
      return reply({ ...base, stopped })
    }
    if (verb === 'share' && sub === 'start') {
      status = { ...status, share: { running: true, since: GADGETS.now, port: 1234, addr: '0.0.0.0', lan: '192.168.1.29', tailscale: '100.64.0.7', lastExit: null } }
      return reply({ ok: true, say: 'Sharing the V4 with rtl_tcp. In an SDR app on the phone (e.g. CoronaSDR), add an rtl_tcp source at 100.64.0.7:1234 (Tailscale) or 192.168.1.29:1234 (home Wi-Fi).', stopped: [] })
    }
    if (verb === 'stop') {
      const was = Object.keys(status.jobs ?? {}).filter(k => k !== 'listen' && running(k))
      const playing = status.listen?.running ? status.listen.label : null
      setJobs(null)
      status = { ...status, listen: { ...quiet }, live: { ...quiet }, share: { ...quiet } }
      const names = was.map(k => (k === 'listen' && playing ? `Audio (${playing})` : LABELS[k] ?? k))
      if (playing && !was.includes('listen')) names.unshift(`Audio (${playing})`)
      return reply({ ok: true, stopped: was, free: true, say: names.length ? `Stopped ${names.join(', ')}. The V4 is free.` : 'Nothing of ours was running. The V4 is free.' })
    }
    return reply({ ok: false, say: `unknown ${args.join(' ')}` })
  })
  on('session.start', async () => ({ cwd: '/tmp' }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_$, e) => {
    w.tools.push(e as any)
    return { value: { tool: `mcp__radio__${e.name}` } }
  })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.status', async (_$, e) => {
    w.status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  return w
}

export async function start($: any): Promise<void> {
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
}

// /sdr <args> as the person typing it; the engine stamps origin and presentation.
export async function radio($: any, args: string): Promise<{ text?: string }> {
  return $.command.run({ command: 'sdr', args })
}

// The timing log the plugin wrote ($.fs.write of actions.jsonl), one object per press.
export function logOf(w: World): any[] {
  const text = [...w.files.entries()].find(([path]) => path.endsWith('/radio/actions.jsonl'))?.[1] ?? ''
  return text
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
}

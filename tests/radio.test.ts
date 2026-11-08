import { describe, expect, mock, test } from 'claude-code/testing'
import type { JsonValue, On } from 'claude-code'

import { GADGETS, LISTEN_NOAA, LISTEN_WEAK, LIVE_FM, MESH, METER_NOAA, METER_WEAK, SCAN_FM, SCAN_LORA, STATUS } from './fixture'
import { ALERTS_NONE, ALERTS_WARNING, APRS_HEARD, APRS_NOTHING, PLANES_QUIET, PLANES_VIEW, SAME_TEST, STATUS_FREE, STATUS_PLANES, STATUS_WEB, WEB_STATUS } from './fixture-sections'
import { EQ_NFM, EQ_WBFM, RECS_TODAY } from './fixture-recordings'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const PANE = {
  plugin: 'radio',
  component: 'Pane' as const,
  requestId: 'radio',
  props: { title: 'Radio', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 80 }, view: {} },
}
const SVG_MAX = 131072
// webrx/status.sh's background decoding (from its live settings.json).
const WEB_BACKGROUND = { enabled: true, decoders: ['packet', 'ism'], schedule: { '1000-0400': '2 m 143.8-146.2 MHz (APRS 144.39)', '0400-1000': '433 MHz ISM 432.3-434.7 MHz (rtl_433)' }, utc: true }

// The world beneath the plugin: radio.py answered from fixtures captured on the real V4, every call recorded.
const stored = new Map<string, unknown>()
// slowPoll: one process (a radio.py verb or a script's file name) that sleeps slowMs on the mock clock;
// files: what the plugin wrote ($.fs.write), e.g. the timing log actions.jsonl.
type World = { calls: string[][]; toasts: string[]; status: (string | undefined)[]; clock: ReturnType<typeof mock.clock>; eqReads: number; slow: boolean; handoff: any; slowPoll: string | null; slowMs: number; files: Map<string, string>; ppm: number; biast: boolean }

const LABELS: Record<string, string> = { gadgets: 'Gadget listener', listen: 'Audio', share: 'Phone share', live: 'Live view', webrx: 'Web SDR', adsb: 'Planes', aprs: 'APRS', same: 'Weather alerts', scanner: 'Scanner', snapshot: 'IQ snapshot' }
// 0.4.0 fixtures: the Scanner's favourites and a parked state, two IQ snapshots, the settings.
const SCAN_CHANNELS = [
  { freq: 146.52, mode: 'fm', name: '2 m calling', squelch: 40 },
  { freq: 147.03, mode: 'fm', name: 'K4CO Edgewood', squelch: 40 },
  { freq: 162.55, mode: 'fm', name: 'NOAA KIH42', squelch: 0 },
]
const SNAP_FILE = '2026-10-07/433.920_1024k.cu8'
const SNAP_ITEMS = [
  { file: SNAP_FILE, mhz: 433.92, rate: 1_024_000, seconds: 10, gain: null, at: 1791249400000, size: 20_480_000, mtime: 1791249410000, label: '433.92: sensors, remotes, doorbells' },
  { file: '2026-10-07/162.550_1024k.cu8', mhz: 162.55, rate: 1_024_000, seconds: 20, gain: null, at: 1791249300000, size: 40_960_000, mtime: 1791249320000, label: 'NOAA KIH42 Covington' },
]
const HF_DRIVER = { supported: true, lib: 'Homebrew librtlsdr (osmocom >= 2.0.3)', note: 'The RTL-SDR Blog V4 auto-upconverts by 28.8 MHz when tuned below 28.8 MHz, so HF works through rtl_fm / rtl_power / rtl_sdr with no flag or separate driver. HF still needs a proper antenna (a 10-20 m long wire through a 9:1 balun).' }
const DOING: Record<string, string> = { adsb: 'track planes (ADS-B on 1090 MHz)', aprs: 'decode APRS on 144.390 MHz', same: 'watch for NOAA weather alerts on 162.550 MHz', webrx: 'run Web SDR' }

function world(on: On, opts: { status?: any; gadgets?: any; gadgetsOn?: boolean; planes?: any; aprs?: any; alerts?: any; store?: Record<string, unknown>; recordings?: any; slowListen?: boolean; slowPoll?: string; location?: any } = {}): World {
  const clock = mock.clock(on, { now: GADGETS.now + 60_000 })
  // A made-up home folder, so no test ever reads the real one.
  mock.env(on, { HOME: '/Users/test' })
  const w: World = { calls: [], toasts: [], status: [], clock, eqReads: 0, slow: !!opts.slowListen, handoff: null, slowPoll: opts.slowPoll ?? null, slowMs: 2000, files: new Map(), ppm: 0, biast: false }
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

async function start($: any): Promise<void> {
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
}

// /sdr <args> as the person typing it; the engine stamps origin and presentation.
async function radio($: any, args: string): Promise<{ text?: string }> {
  return $.command.run({ command: 'sdr', args })
}

describe('radio tab', () => {
  test('draws every surface: LCD tuner, band map, spectrum + waterfall, mesh, neighbourhood and sparklines; cells on the terminal', async ($, on) => {
    world(on)
    await start($)
    const r = await radio($, '')
    expect(r.text).toMatch(/RTL-SDR Blog V4: connected/)
    expect(r.text).toMatch(/Tuner \d+(\.\d+)? MHz NFM/)
    expect(r.text).toMatch(/Mesh \(last hour/)
    expect(r.text).toMatch(/Acurite-Tower ch A · outdoor temperature \/ humidity sensor · .* · LOW BATTERY/)
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      if (surface === 'terminal') {
        expect(await ui.find({ type: 'Raster' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /[▁▂▃▄▅▆▇█]{30,}/ })).toBeDefined()
        expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      } else {
        const svgs = await ui.findAll({ type: 'Svg' })
        const alts = svgs.map(s => String(s.props.alt))
        expect(alts.some(a => /^Tuner: 162\.55 MHz narrow FM/.test(a))).toBe(true)
        expect(alts.some(a => /^Band map from 24 MHz to 1\.7 GHz/.test(a))).toBe(true)
        expect(alts.some(a => /^Spectrum and waterfall of FM broadcast 87\.5–108 MHz: \d+ signals .*94\.1 WNNF/.test(a))).toBe(true)
        expect(alts.some(a => /^Mesh traffic over the last hour: Meshtastic LongFast quiet/.test(a))).toBe(true)
        expect(alts.some(a => /^Radio neighbourhood: 3 devices heard today/.test(a))).toBe(true)
        expect(alts.filter(a => /temperature readings/.test(a)).length).toBeGreaterThanOrEqual(2)
        for (const s of svgs) expect(String(s.props.source).length).toBeLessThan(SVG_MAX)
        for (const s of svgs) expect(String(s.props.source)).not.toMatch(/<script|onload=|onclick=/)
      }
      expect(await ui.find({ type: 'Text', text: 'WEBN' })).toBeDefined()
      expect(await ui.find({ key: 'ls:102.7' })).toBeDefined()
      if (surface !== 'terminal') expect((await ui.findAll({ type: 'Svg' })).some(x => /^Audio spectrum: not playing/.test(String(x.props.alt)))).toBe(true)
      expect(await ui.find({ key: 'scan:lora' })).toBeDefined()
      expect(await ui.find({ key: 'scan:marine' })).toBeDefined()
      expect(await ui.find({ key: 't-up' })).toBeDefined()
      expect(await ui.find({ key: 'live' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' low battery ' })).toBeDefined()
      // The phone has no text fields: every control is a Button.
      expect(Boolean(await ui.find({ key: 'custom' }))).toBe(surface !== 'mobile')
      expect(Boolean(await ui.find({ key: 'tune' }))).toBe(surface !== 'mobile')
      await ui.unmount()
    }
  })

  test('one transmitter decoded as two models is one card, labelled with both names', async ($, on) => {
    world(on)
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.findAll({ type: 'Text', text: 'LaCrosse-TX141THBv2 / TFA-303221' })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /decodes as 2 models; shown once/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^TFA-303221$/ })).toBeUndefined()
    const g = await radio($, 'gadgets')
    expect(g.text).toMatch(/Neighbourhood: 3 heard today/)
    expect(g.text).toMatch(/low battery: Acurite-Tower, LaCrosse-TX141THBv2 \/ TFA-303221/)
  })

  test('a band button scans, shows the new band and remembers it', async ($, on) => {
    const w = world(on)
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'scan:lora' })
    expect(w.calls.some(c => c[0] === 'scan' && c[1] === 'lora')).toBe(true)
    const alts = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
    expect(alts.some(a => /^Spectrum and waterfall of Meshtastic \/ LoRa 902–928 MHz/.test(a))).toBe(true)
    const pan = (await ui.findAll({ type: 'Svg' })).find(s => /^Spectrum and waterfall/.test(String(s.props.alt)))
    expect(String(pan?.props.source)).toContain('Meshtastic')
    expect(stored.get('lastPreset')).toBe('lora')
    expect(await ui.find({ type: 'Text', text: /gadget listener paused for the scan and is back on/ })).toBeDefined()
  })

  test('/sdr scan fm names the stations and remembers them for the station buttons', async ($, on) => {
    world(on)
    await start($)
    const r = await radio($, 'scan fm')
    expect(r.text).toMatch(/^FM broadcast: \d+ signals above the noise floor, strongest /)
    expect(r.text).toMatch(/94\.1 MHz +\+\d+ dB +steady +94\.1 WNNF +\(\/sdr listen 94\.1\)/)
    const fm = stored.get('fmStations') as { mhz: number; name: string }[]
    expect(fm.some(s => s.name === '91.7 WVXU')).toBe(true)
  })

  test('live: the toggle starts rtl_power, frames redraw on the tick, max hold resets, a band button moves it', async ($, on) => {
    const w = world(on)
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'live' })
    expect(w.calls.some(c => c.join(' ') === 'live start fm')).toBe(true)
    expect(w.status.at(-1)).toMatch(/◉ live FM broadcast/)
    await w.clock.advance(2500)
    expect(w.calls.some(c => c.join(' ') === 'live frame')).toBe(true)
    const pan = (await ui.findAll({ type: 'Svg' })).find(s => /^Live spectrum and waterfall of FM broadcast/.test(String(s.props.alt)))
    expect(pan).toBeDefined()
    expect(String(pan?.props.source)).toContain('LIVE')
    expect(String(pan?.props.source)).toContain('max hold')
    expect(String(pan?.props.source).length).toBeLessThan(SVG_MAX)
    expect((await ui.find({ key: 'live' }))?.text).toBe('■ Stop live')
    await ui.press({ key: 'live-reset' })
    expect(w.calls.some(c => c.join(' ') === 'live reset')).toBe(true)
    await ui.press({ key: 'scan:lora' })
    expect(w.calls.some(c => c.join(' ') === 'live start lora')).toBe(true)
    expect(w.calls.some(c => c[0] === 'scan' && c[1] === 'lora')).toBe(false)
    const off = await radio($, 'live off')
    expect(off.text).toBe('Live view off.')
  })

  test('listening stops the live view and the tab says why, with a Resume button', async ($, on) => {
    const w = world(on)
    await start($)
    await radio($, 'live on')
    const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
    await ui.press({ key: 'ls:94.1' })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 94.1 wbfm')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /Live view stopped so the V4 could play/ })).toBeDefined()
    expect(await ui.find({ key: 'resume-live' })).toBeDefined()
    await ui.press({ key: 'resume-live' })
    expect(w.calls.filter(c => c[0] === 'live' && c[1] === 'start')).toHaveLength(2)
  })

  test('a weak station says so instead of playing noise in silence', async ($, on) => {
    const w = world(on)
    await start($)
    const r = await radio($, 'listen 162.45 fm')
    expect(r.text).toMatch(/weak signal — try the antenna by a window/)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const lcd = (await ui.findAll({ type: 'Svg' })).find(s => /^Tuner:/.test(String(s.props.alt)))
    expect(String(lcd?.props.alt)).toMatch(/162\.45 MHz narrow FM.*weak signal — try the antenna by a window/)
    await w.clock.advance(2000)
    expect(w.calls.some(c => c.join(' ') === 'listen meter')).toBe(true)
    expect(w.status.at(-1)).toMatch(/\(weak\)/)
    const s = await radio($, 'listen 162.55 fm')
    expect(s.text).toMatch(/^Now playing NOAA KIH42 Covington/)
    expect(s.text).not.toMatch(/weak/)
  })

  test('the tuner: ▲ ▼ by the step, mode and step chips, squelch and gain; while playing it retunes once the presses stop', async ($, on) => {
    const w = world(on)
    await start($)
    await radio($, '')
    for (const surface of ['desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ key: 't-down' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
    await ui.press({ key: 'step:100000' })
    await ui.press({ key: 'mode:wbfm' })
    expect(await radio($, 'tune')).toEqual({ text: expect.stringMatching(/^Tuner: 162\.55 MHz WFM/) })
    await radio($, 'tune 94.1')
    await ui.press({ key: 't-up' })
    await ui.press({ key: 't-up' })
    expect((await radio($, 'tune')).text).toMatch(/^Tuner: 94\.3 MHz WFM/)
    // A press starts the audio at once (--quick); the meter polls give the weak-signal verdict.
    await ui.press({ key: 't-listen' })
    expect(w.calls.some(c => c.join(' ') === 'listen 94.3 wbfm --squelch 0 --gain auto --quick')).toBe(true)
    const quick = () => w.calls.filter(c => c[0] === 'listen' && c.includes('--quick'))
    const q0 = quick().length
    await ui.press({ key: 't-down' })
    await ui.press({ key: 't-down' })
    await ui.press({ key: 'gain-auto' })
    expect(quick()).toHaveLength(q0)
    await w.clock.advance(800)
    const retunes = quick().slice(q0)
    expect(retunes).toHaveLength(1)
    expect(retunes[0]?.join(' ')).toBe('listen 94.1 wbfm --squelch 0 --gain 40.2 --quick')
    expect(stored.get('tuner')).toMatchObject({ hz: 94_100_000, mode: 'wbfm', gain: 40.2 })
    // A station row's ▶ tunes and plays it.
    await ui.press({ key: 'ls:102.7' })
    expect(w.calls.some(c => c.join(' ') === 'listen 102.7 wbfm --squelch 0 --gain 40.2 --quick')).toBe(true)
    expect((await radio($, 'tune')).text).toMatch(/^Tuner: 102\.7 MHz WFM/)
  })

  test('gadgets: status line, one toast for new devices, neutral wording for tire sensors', async ($, on) => {
    const tire = { ...GADGETS.devices[0]!, key: 'Schrader|1a2b|', model: 'Schrader', models: null, id: '1a2b', channel: null, kind: 'tire-pressure sensor (likely a passing car)', first: GADGETS.now, say: 'tire 32 psi', tempF: null, humidity: null, lowBattery: false, hist: [] }
    const w = world(on, { gadgets: { ...GADGETS, devices: [...GADGETS.devices, tire] } })
    await start($)
    await radio($, '')
    const acurite = GADGETS.devices.find(d => d.model === 'Acurite-Tower')
    const hour = [...GADGETS.devices, tire].filter(d => GADGETS.now + 60_000 - d.last < 3_600_000).length
    expect(w.status.at(-1)).toBe(`Radio · ${hour} gadgets · Acurite ${Math.round(acurite?.tempF ?? 0)}°F`)
    const first = w.toasts.filter(t => /new gadgets nearby/.test(t))
    expect(first).toHaveLength(1)
    expect(first[0]).toMatch(/a passing car's tire sensor/)
    for (const t of w.toasts) expect(t).not.toMatch(/track/i)
    const g = await radio($, 'gadgets')
    expect(g.text).toMatch(/Gadget listener on \(433\.92 MHz\) · 3 devices heard so far/)
    expect(w.toasts.filter(t => /new gadgets nearby|New nearby/.test(t))).toHaveLength(1)
  })

  test('the listener only starts on session start when it was on last time', async ($, on) => {
    const off = { ...STATUS, state: 'free', owner: null, gadgets: { ...STATUS.gadgets, running: false } }
    const w = world(on, { status: off })
    await start($)
    await radio($, '')
    expect(w.calls.some(c => c[0] === 'gadgets' && c[1] === 'start')).toBe(false)
    const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
    expect((await ui.find({ key: 'gadgets-toggle' }))?.text).toBe('Listener on')
    await ui.press({ key: 'gadgets-toggle' })
    expect(w.calls.some(c => c[0] === 'gadgets' && c[1] === 'start')).toBe(true)
    expect(stored.get('gadgetsOn')).toBe(true)
  })

  test('a listener that was on comes back in the next session, but not over the live view', async ($, on) => {
    const off = { ...STATUS, state: 'free', owner: null, gadgets: { ...STATUS.gadgets, running: false } }
    const w = world(on, { status: off, gadgetsOn: true })
    await start($)
    await radio($, '')
    expect(w.calls.filter(c => c[0] === 'gadgets' && c[1] === 'start')).toHaveLength(1)
    await radio($, 'live on')
    await w.clock.advance(31_000)
    expect(w.calls.filter(c => c[0] === 'gadgets' && c[1] === 'start')).toHaveLength(1)
  })

  test('listen from a peak, stop, share to the phone, and the text replies for the phone', async ($, on) => {
    const w = world(on)
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'ls:94.1' })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 94.1 wbfm')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /The gadget listener comes back when you press Stop/ })).toBeDefined()
    expect(await ui.find({ key: 'stop-top' })).toBeDefined()
    expect(w.status.at(-1)).toMatch(/^Radio · ▶ 94\.1 WNNF/)
    const s = await radio($, 'stop')
    expect(s.text).toBe('Stopped Audio (94.1 WNNF). The V4 is free.')
    expect(w.calls.some(c => c.join(' ') === 'stop')).toBe(true)
    const sh = await radio($, 'share on')
    expect(w.calls.some(c => c.join(' ') === 'share start all')).toBe(true)
    expect(sh.text).toMatch(/100\.64\.0\.7:1234 \(Tailscale\)/)
    const b = await radio($, 'bands')
    expect(b.text).toMatch(/FM broadcast +\d+ signals, best \+\d+ dB/)
    expect(b.text).toMatch(/Marine VHF +– +not scanned yet/)
    const m = await radio($, 'mesh')
    expect(m.text).toMatch(/^Mesh \(last hour, 0 min listened\): Meshtastic quiet .* MeshCore busy/)
  })
})

declare const console: { log: (...args: unknown[]) => void }
// true prints the drawn tree of each layout below (the test output), for reading wraps by eye.
const PRINT_OUTLINE = false
// ---- layout: what a row of controls needs, in cells (a Button is `[ label ]`, a Box its width)
function rigid(n: any): number {
  if (!n || typeof n !== 'object') return 0
  const p = n.props ?? {}
  if (n.type === 'Button') return [...String(p.label ?? '')].length + 4
  if (n.type !== 'Box') return 0
  if (typeof p.width === 'number') return p.width
  const pad = Number(p.paddingLeft ?? 0) + Number(p.paddingRight ?? 0)
  const kids = (n.children ?? []).map(rigid)
  return pad + (p.flexDirection === 'column' ? Math.max(0, ...kids) : kids.reduce((a: number, b: number) => a + b, 0))
}
function buttonsIn(n: any): string[] {
  if (!n || typeof n !== 'object') return []
  if (n.type === 'Button') return [n.props.label]
  return (n.children ?? []).flatMap(buttonsIn)
}
// Rows of buttons wider than the pane wrap into ragged runs: list them.
function overflowing(n: any, columns: number, out: string[] = []): string[] {
  if (!n || typeof n !== 'object') return out
  if (n.type === 'Box' && n.props?.flexDirection !== 'column' && buttonsIn(n).length > 1) {
    const w = rigid(n)
    if (w > columns) out.push(`${w} > ${columns}: ${buttonsIn(n).join(' | ')}`)
    return out
  }
  for (const c of n.children ?? []) overflowing(c, columns, out)
  return out
}
// The tree as an outline (the tuner area of it), to read what a surface gets.
function outline(n: any, depth = 0, lines: string[] = []): string[] {
  if (typeof n === 'string') {
    if (n.trim()) lines.push(`${'  '.repeat(depth)}"${n.slice(0, 70)}"`)
    return lines
  }
  if (!n || typeof n !== 'object') return lines
  const p = n.props ?? {}
  const bits = [n.type, p.key ? `#${p.key}` : '', typeof p.width === 'number' ? `w=${p.width}` : '', p.flexDirection === 'column' ? 'col' : n.type === 'Box' ? 'row' : '', n.type === 'Button' ? `[ ${p.label} ]` : '', n.type === 'Box' && n.props?.flexDirection !== 'column' && buttonsIn(n).length > 1 ? `(needs ${rigid(n)})` : '']
  lines.push(`${'  '.repeat(depth)}${bits.filter(Boolean).join(' ')}`)
  if (n.type !== 'Svg' && n.type !== 'Code') for (const c of n.children ?? []) outline(c, depth + 1, lines)
  return lines
}

describe('one instrument: planes, APRS, weather alerts and Web SDR', () => {
  test('the sections draw from real state on the desktop: radar, nothing-heard APRS, a red warning card, Web SDR links', async ($, on) => {
    world(on, { status: STATUS_WEB, alerts: ALERTS_WARNING })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const svgs = await ui.findAll({ type: 'Svg' })
    const alts = svgs.map(s => String(s.props.alt))
    const radar = svgs.find(s => /^Plane radar around Walton, KY \(auto range\): 10 aircraft, 8 with a position, farthest DAL2294 at 29\.3 nm/.test(String(s.props.alt)))
    expect(radar).toBeDefined()
    expect(String(radar?.props.source)).toContain('ADS-B RADAR')
    expect(alts.some(a => /^APRS map/.test(a))).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^Nothing heard yet on 144\.390 MHz\. .*outdoor 2 m antenna/ })).toBeDefined()
    const card = svgs.find(s => /^Severe Thunderstorm Warning \(warning\)/.test(String(s.props.alt)))
    expect(String(card?.props.source)).toContain('#e5484d')
    for (const s of svgs) {
      expect(String(s.props.source).length).toBeLessThan(SVG_MAX)
      expect(String(s.props.source)).not.toMatch(/<script|onload=|onclick=/)
    }
    // Web SDR: the Mac's link, the home Wi-Fi address as text (a Link may only be https or localhost), the Tailscale command as text.
    expect((await ui.find({ type: 'Link' }))?.props.href).toBe('http://localhost:8073/')
    expect(await ui.find({ type: 'Text', text: 'http://192.168.1.29:8073' })).toBeDefined()
    expect((await ui.find({ type: 'Code', text: /tailscale serve --bg --https=8073 http:\/\/127\.0\.0\.1:8073/ }))).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /A full live waterfall in any browser — tap a signal to hear it; the phone works on home Wi-Fi/ })).toBeDefined()
    // On the V4 now names Web SDR, never the tool under it.
    expect(await ui.find({ type: 'Text', text: /^Web SDR · OpenWebRX\+ on :8073 · since / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^rtl_tcp|in use by rtl_tcp/ })).toBeUndefined()
    expect(await ui.find({ key: 'stop-all' })).toBeDefined()
    expect(await ui.find({ key: 'range:25' })).toBeDefined()
    expect(await ui.find({ key: 'alerts-test' })).toBeDefined()
  })

  test('the phone gets the tables and stacked rows: the planes table, APRS stations, the warning, no text fields', async ($, on) => {
    world(on, { status: STATUS_PLANES, aprs: APRS_HEARD, alerts: ALERTS_WARNING })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
    const planes = await ui.find({ type: 'Code', text: /JIA5673 +2,875/ })
    expect(planes).toBeDefined()
    for (const line of String(planes?.text).split('\n')) expect([...line].length).toBeLessThanOrEqual(34)
    expect(await ui.find({ type: 'Code', text: /KD8TST-9/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Svg' })).some(s => /^Plane radar|^APRS map/.test(String(s.props.alt)))).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^Planes · ADS-B on 1090 MHz/ })).toBeDefined()
    expect(await ui.find({ key: 'range:auto' })).toBeUndefined()
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    // Weather alerts stay big and red on the phone too.
    expect((await ui.findAll({ type: 'Svg' })).some(s => /^Severe Thunderstorm Warning \(warning\)/.test(String(s.props.alt)))).toBe(true)
  })

  test('starting one stops the other and says so; Resume brings it back; Stop all frees the V4', async ($, on) => {
    const w = world(on, { status: STATUS_PLANES })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: 'planes-toggle' }))?.text).toBe('■ Planes off')
    await ui.press({ key: 'web-toggle' })
    expect(w.calls.some(c => c.join(' ') === 'job start webrx')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Web SDR running at http:\/\/192\.168\.1\.29:8073 .*\(stopped Planes: the V4 does one thing at a time\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Web SDR · OpenWebRX\+ on :8073/ })).toBeDefined()
    expect((await ui.find({ key: 'restore:adsb:0' }))?.text).toBe('Resume Planes')
    expect(w.status.at(-1)).toMatch(/Web SDR on :8073/)
    await ui.press({ key: 'restore:adsb:0' })
    expect(w.calls.filter(c => c.join(' ') === 'job start adsb')).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /^Planes · / })).toBeDefined()
    await ui.press({ key: 'stop-all' })
    expect(w.calls.some(c => c.join(' ') === 'stop')).toBe(true)
    expect(await ui.find({ type: 'Text', text: 'nothing — the V4 is free' })).toBeDefined()
    expect(await ui.find({ key: 'stop-all' })).toBeUndefined()
  })

  test('the planes radar refreshes every ~2 s only while it runs and the tab is drawn; range chips refetch', async ($, on) => {
    const w = world(on, { status: STATUS_PLANES })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const views = () => w.calls.filter(c => c[0] === 'adsb.py' && c[1] === 'view').length
    const n0 = views()
    await w.clock.advance(4100)
    expect(views() - n0).toBeGreaterThanOrEqual(2)
    await ui.press({ key: 'range:25' })
    await w.clock.advance(1100)
    expect(w.calls.some(c => c[0] === 'adsb.py' && c.join(' ').includes('--range 25'))).toBe(true)
    expect((await ui.find({ key: 'range:25' }))?.props.variant).toBe('primary')
    await ui.unmount()
    await w.clock.advance(20_000)
    const n1 = views()
    await w.clock.advance(10_000)
    expect(views()).toBe(n1)
  })

  test('/sdr planes, aprs, alerts and web answer in text for the phone', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, planes: PLANES_VIEW })
    await start($)
    const p = await radio($, 'planes')
    expect(p.text).toMatch(/^10 aircraft · 8 with a position · farthest DAL2294 at 29\.3 nm/)
    expect(p.text).toMatch(/JIA5673 +2,875 +184 +2\.6/)
    const on1 = await radio($, 'planes on')
    expect(w.calls.some(c => c.join(' ') === 'job start adsb')).toBe(true)
    expect(on1.text).toMatch(/^Planes on\./)
    const a = await radio($, 'aprs')
    expect(a.text).toMatch(/Nothing heard yet on 144\.390 MHz/)
    const t = await radio($, 'alerts test')
    expect(t.text).toMatch(/^SAME pipeline OK: encoded ZCZC-WXR-RWT-/)
    expect(t.text).toMatch(/REQUIRED WEEKLY TEST/i)
    const al = await radio($, 'alerts')
    expect(al.text).toMatch(/No active alerts/)
    expect(al.text).toMatch(/usually Wednesday late morning/)
    const web = await radio($, 'web on')
    expect(w.calls.some(c => c.join(' ') === 'job start webrx')).toBe(true)
    expect(web.text).toMatch(/stopped Planes/)
    expect(web.text).toMatch(/This Mac: http:\/\/localhost:8073/)
    expect(web.text).toMatch(/Phone on home Wi-Fi: http:\/\/192\.168\.1\.29:8073/)
    expect(web.text).toMatch(/tailscale serve --bg --https=8073/)
    const sum = await radio($, '')
    expect(sum.text).toMatch(/in use by Web SDR · OpenWebRX\+ on :8073/)
    expect(sum.text).toMatch(/Web SDR on: This Mac: http:\/\/localhost:8073/)
    const off = await radio($, 'stop')
    expect(off.text).toBe('Stopped Web SDR. The V4 is free.')
  })

  test('a quiet night: Planes on with nothing heard says so and gives the antenna tip', async ($, on) => {
    world(on, { status: STATUS_PLANES, planes: PLANES_QUIET })
    await start($)
    const p = await radio($, 'planes')
    expect(p.text).toMatch(/^0 aircraft · 0 with a position/)
    expect(p.text).toMatch(/Antenna: stand the V4's dipole vertical/)
  })
})

// What `radio.py location` answers for a location.json that moves the tab to Springfield, IL.
const LOCATION_SPRINGFIELD = {
  ok: true,
  custom: true,
  error: null,
  path: '/Users/test/Library/Application Support/radio/location.json',
  location: {
    name: 'Springfield, IL',
    short: 'Springfield',
    weather: { station: 'KXYZ99', city: 'Springfield', freq: 162.475 },
    river: { name: '' },
    fm: { '88.5': 'WXYZ Springfield', '99.1': 'WABC' },
    repeaters: [{ mhz: 145.23, name: 'Springfield ARC repeater', short: 'SARC', mark: true, wx: true }],
  },
}
const LOCATION_BROKEN = { ok: false, custom: false, error: '/Users/test/Library/Application Support/radio/location.json is not valid JSON (Expecting value: line 1 column 1 (char 0)); using Walton, KY. The file was left alone.', path: '/Users/test/Library/Application Support/radio/location.json' }

describe('your location (location.json)', () => {
  test('a location file renames the places, swaps the FM list and the weather station; the weather and FM buttons follow', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, location: LOCATION_SPRINGFIELD })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /^Aircraft around Springfield, from the position/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Listens to NOAA Weather Radio KXYZ99 \(162\.475 MHz\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Walton|Cincinnati/ })).toBeUndefined()
    await ui.press({ key: 'try:weather' })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 162.475 fm')).toBe(true)
    await ui.press({ key: 'try:fm' })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 88.5 wbfm')).toBe(true)
    const alts = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.alt))
    expect(alts.some(a => /^Plane radar around Springfield, IL /.test(a))).toBe(true)
    expect(alts.some(a => /Walton/.test(a))).toBe(false)
    expect(w.toasts.some(t => /location/i.test(t))).toBe(false)
  })

  test('a file that does not parse is reported in a toast, and the tab stays on Walton, KY', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, location: LOCATION_BROKEN })
    await start($)
    await radio($, '')
    expect(w.toasts.some(t => /location\.json is not valid JSON.*The file was left alone/.test(t))).toBe(true)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /^Listens to NOAA Weather Radio KIH42 \(162\.550 MHz\)/ })).toBeDefined()
    await ui.press({ key: 'try:weather' })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 162.55 fm')).toBe(true)
  })

  test('the tab asks for the location once, at session start, and the question touches no dongle', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, '')
    expect(w.calls.filter(c => c[0] === 'location')).toEqual([['location']])
  })
})

describe('start here and the tuner layout', () => {
  test('Start here: seven steps that each do the thing, Got it folds it away for good', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, '')
    for (const surface of ['desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const tries = (await ui.findAll({ type: 'Button' })).filter(b => /^try:/.test(String(b.key)))
      expect(tries.map(b => b.text)).toEqual(['Hear the weather radio', 'Play an FM station', 'Watch the FM band live', 'See planes overhead', 'Open Web SDR in a browser', 'Check gadgets nearby', 'Record what you hear'])
      expect(await ui.find({ type: 'Text', text: /^The V4 does one thing at a time\. Starting something stops the last thing, and the tab says what it stopped\. Stop all is at the top\.$/ })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'try:weather' })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 162.55 fm')).toBe(true)
    await ui.press({ key: 'try:fm' })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 94.1 wbfm')).toBe(true)
    await ui.press({ key: 'try:planes' })
    expect(w.calls.some(c => c.join(' ') === 'job start adsb')).toBe(true)
    await ui.press({ key: 'try:web' })
    expect(w.calls.some(c => c.join(' ') === 'job start webrx')).toBe(true)
    expect(await ui.find({ type: 'Text', text: 'Running. Open it here:' })).toBeDefined()
    // 0.4.0 adds the "What's this signal?" link-out (the Signal Identification Wiki) under Radio settings.
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toEqual(['http://localhost:8073/', 'http://localhost:8073/', 'http://localhost:8073/map', 'https://www.sigidwiki.com/wiki/Signal_Identification_Guide'])
    // Nothing playing: Record makes a 30 s timed recording of the weather radio, muted.
    await ui.press({ key: 'try:record' })
    expect(w.calls.some(c => c.join(' ') === 'record 162.55 fm 30')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Recording 30 s of NOAA KIH42 Covington, muted; it stops by itself/ })).toBeDefined()
    await ui.press({ key: 'start-here-close' })
    expect(stored.get('startHereClosed')).toBe(true)
    expect(await ui.find({ key: 'try:weather' })).toBeUndefined()
    expect((await ui.find({ key: 'start-here-open' }))?.text).toBe('Start here ▸')
  })

  test('the tuner: station tabs (FM strongest first, remembered), favourites from listening, one row per control', async ($, on) => {
    const w = world(on)
    await start($)
    await radio($, 'scan fm')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // Favourites by default: NOAA 162.550 until he listens to something.
    expect((await ui.findAll({ type: 'Button' })).filter(b => /^st:fav:/.test(String(b.key))).map(b => b.text)).toEqual(['162.550 NOAA'])
    await ui.press({ key: 'cat:fm' })
    expect(stored.get('stationTab')).toBe('fm')
    const fm = (await ui.findAll({ type: 'Button' })).filter(b => /^st:fm:/.test(String(b.key)))
    expect(fm.length).toBe(8)
    const strongest = [...SCAN_FM.peaks].filter((p: any) => p.name && !p.comb && !p.spur && !/ FM$/.test(p.name)).sort((a: any, b: any) => b.above - a.above)[0] as any
    expect(fm[0]?.key).toBe(`st:fm:${strongest.mhz}`)
    expect(await ui.find({ key: 'fm-more' })).toBeDefined()
    await ui.press({ key: 'fm-more' })
    expect((await ui.findAll({ type: 'Button' })).filter(b => /^st:fm:/.test(String(b.key))).length).toBeGreaterThan(8)
    await ui.press({ key: `st:fm:${strongest.mhz}` })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === `listen ${strongest.mhz} wbfm`)).toBe(true)
    await ui.press({ key: 'cat:fav' })
    const fav = (await ui.findAll({ type: 'Button' })).filter(b => /^st:fav:/.test(String(b.key))).map(b => b.text)
    expect(fav[0]).toMatch(new RegExp(`^${String(strongest.mhz).replace('.', '\\.')} `))
    expect(fav).toContain('162.550 NOAA')
    // The S-meter's paragraph is one line until asked.
    expect(await ui.find({ type: 'Text', text: /FM quieting/ })).toBeUndefined()
    await ui.press({ key: 'meter-help' })
    expect(await ui.find({ type: 'Text', text: /FM quieting/ })).toBeDefined()
  })

  test('no row of buttons is wider than the pane: desktop at ~700 and ~1000 px, and the phone', async ($, on) => {
    world(on, { status: STATUS_WEB, alerts: ALERTS_WARNING, aprs: APRS_HEARD })
    await start($)
    await radio($, 'scan fm')
    for (const [surface, columns] of [['desktop', 88], ['desktop', 128], ['mobile', 46]] as const) {
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: columns } })
      const tree = await ui.drawn()
      const rows = overflowing(tree, columns)
      if (rows.length) console.log(`${surface} @ ${columns}:\n${rows.join('\n')}`)
      if (PRINT_OUTLINE) console.log(`--- ${surface} @ ${columns} ---\n${outline(tree).join('\n')}`)
      expect(rows).toEqual([])
      await ui.unmount()
    }
  })
})

describe('recording, the EQ display and the station list', () => {
  test('● Rec and Log on the tuner while it plays: the tap records, the counter counts, the LCD and status line say so', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, 'listen 94.1')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: 'rec-toggle' }))?.text).toBe('● Rec')
    await ui.press({ key: 'rec-toggle' })
    expect(w.calls.some(c => c.join(' ') === 'rec start')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Recording 94\.1 WNNF to ~\/Radio\/Recordings\// })).toBeDefined()
    expect((await ui.find({ key: 'rec-toggle' }))?.text).toBe('■ Rec')
    expect(await ui.find({ type: 'Text', text: /^● REC 0:42 · 340 KB/ })).toBeDefined()
    const lcd = (await ui.findAll({ type: 'Svg' })).find(s => /^Tuner:/.test(String(s.props.alt)))
    expect(String(lcd?.props.source)).toContain('● REC')
    await w.clock.advance(1600)
    expect(w.status.at(-1)).toMatch(/● rec 0:42/)
    await ui.press({ key: 'log-toggle' })
    expect(w.calls.some(c => c.join(' ') === 'log start')).toBe(true)
    expect((await ui.find({ key: 'log-toggle' }))?.text).toBe('■ Log')
    expect(await ui.find({ type: 'Text', text: /Log: 7 transmissions since / })).toBeDefined()
    await ui.press({ key: 'rec-toggle' })
    expect(w.calls.some(c => c.join(' ') === 'rec stop')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Saved 0 min 42 s \(340 KB\)/ })).toBeDefined()
    const off = await radio($, 'log off')
    expect(off.text).toMatch(/^Log off: 7 transmissions saved/)
  })

  test('Recordings: today newest first with ▶ and 🗑, Show in Finder, older days, disk; the phone gets text rows with ▶', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const first = RECS_TODAY.items[0]!
    expect(await ui.find({ key: `rec-play:${first.file}` })).toBeDefined()
    expect(await ui.find({ key: `rec-del:${first.file}` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'NOAA KIH42 Covington · timed' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Yesterday: 12 clips, 1 recording, 4 min · 1\.8 MB$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^On disk: 4\.7 MB of 2 GB · kept 30 days, then the oldest go to the Trash/ })).toBeDefined()
    await ui.press({ key: `rec-play:${first.file}` })
    expect(w.calls.some(c => c.join(' ') === `play ${first.file}`)).toBe(true)
    expect((await ui.find({ key: `rec-play:${first.file}` }))?.text).toBe('■')
    expect(await ui.find({ key: 'recs-stop-play' })).toBeDefined()
    await ui.press({ key: 'recs-stop-play' })
    expect(w.calls.some(c => c.join(' ') === 'play stop')).toBe(true)
    await ui.press({ key: `rec-del:${first.file}` })
    expect(w.calls.some(c => c.join(' ') === `rec delete ${first.file}`)).toBe(true)
    expect(await ui.find({ key: `rec-play:${first.file}` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Finder can put it back/ })).toBeDefined()
    await ui.press({ key: 'recs-finder' })
    expect(w.calls.some(c => c.join(' ') === 'rec reveal')).toBe(true)
    await ui.unmount()
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
    const second = RECS_TODAY.items[1]!
    expect(await phone.find({ key: `rec-play:${second.file}` })).toBeDefined()
    expect(await phone.find({ key: `rec-del:${second.file}` })).toBeUndefined()
    expect(await phone.find({ type: 'Text', text: /^10:44 pm 133\.425 transmission·clip 0:07$/ })).toBeDefined()
    expect(await phone.find({ type: 'Input' })).toBeUndefined()
  })

  test('/sdr recordings, rec keep, record answer in text', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    const r = await radio($, 'recordings')
    expect(r.text).toMatch(/^Today: 4 files · On disk: 4\.7 MB of 2 GB/)
    expect(r.text).toMatch(/10:45 pm {2}133\.425 {2}transmission \(clip\) {2}0:05 {2}28 KB/)
    expect(r.text).toMatch(/\/sdr rec on\|off/)
    const k = await radio($, 'rec keep 3')
    expect(w.calls.some(c => c.join(' ') === 'rec keep 3')).toBe(true)
    expect(k.text).toMatch(/^Keeping recordings up to 3 GB/)
    const t = await radio($, 'record 162.55 fm 10')
    expect(w.calls.some(c => c.join(' ') === 'record 162.55 fm 10')).toBe(true)
    expect(t.text).toMatch(/^Recording 10 s of NOAA KIH42 Covington, muted/)
    const sum = await radio($, '')
    expect(sum.text).toMatch(/Recordings today: 2 recordings, 2 clips · 4\.7 MB on disk · ● recording 0:00/)
    expect((await radio($, 'record 162.55')).text).toMatch(/^Record: \/sdr record <MHz>/)
  })

  test('the EQ display draws the sound while it plays: bars on the desktop, fewer on the phone, a Raster on the terminal, only while drawn', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, 'listen 94.1')
    for (const surface of ['desktop', 'mobile', 'terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      await w.clock.advance(1100)
      if (surface === 'terminal') {
        const ras = await ui.find({ type: 'Raster', key: 'eq' })
        expect(ras).toBeDefined()
        expect(Number(ras?.props.rows)).toBe(7)
      } else {
        const eqSvg = (await ui.findAll({ type: 'Svg' })).find(x => /^Audio spectrum/.test(String(x.props.alt)))
        expect(String(eqSvg?.props.alt)).toMatch(/^Audio spectrum of 94\.1 WNNF: 32 bands 60–12k Hz, loudest around \d+ Hz, sounds like music, -\d+ dBFS$/)
        const src = String(eqSvg?.props.source)
        expect(src.length).toBeLessThan(SVG_MAX)
        expect(src).not.toMatch(/<script|onload=|onclick=/)
        expect((src.match(/fill="url\(#eqb\d+\)"/g) ?? []).length).toBe(surface === 'mobile' ? 16 : 32)
        expect(src).toContain('AUDIO SPECTRUM')
        expect(eqSvg?.props.height).toBeGreaterThan(100)
      }
      await ui.unmount()
    }
    if (PRINT_EQ) {
      for (const surface of ['desktop', 'mobile'] as const) {
        const u = await $.ui.mount({ ...PANE, surface })
        await w.clock.advance(1100)
        for (const x of await u.findAll({ type: 'Svg' })) if (/^Audio spectrum|^Tuner:/.test(String(x.props.alt))) console.log(`EQSVG ${surface} ${String(x.props.alt).slice(0, 14).replace(/\W+/g, '_')} ${x.props.source}`)
        await u.unmount()
      }
      await radio($, 'stop')
      const u = await $.ui.mount({ ...PANE, surface: 'desktop' })
      for (const x of await u.findAll({ type: 'Svg' })) if (/^Audio spectrum/.test(String(x.props.alt))) console.log(`EQSVG ghost Audio_spectrum ${x.props.source}`)
      await u.unmount()
      await radio($, 'listen 94.1')
    }
    // About 2.5 reads a second while drawn, none once the tab has not been drawn for a while.
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const r0 = w.eqReads
    await w.clock.advance(2000)
    expect(w.eqReads - r0).toBeGreaterThanOrEqual(4)
    expect(w.eqReads - r0).toBeLessThanOrEqual(6)
    await ui.unmount()
    await w.clock.advance(16_000)
    const r1 = w.eqReads
    await w.clock.advance(5000)
    expect(w.eqReads).toBe(r1)
  })

  test('the station list: ▶ on the left, the playing row lit with ■ Stop, the tuned one marked, a pressed one Starting…, sorted and folded', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, slowListen: true })
    await start($)
    await radio($, 'scan fm')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // Ten strongest of 24, in frequency order, then all of them.
    const rows = async () => (await ui.findAll({ type: 'Button' })).filter(b => /^ls:/.test(String(b.key))).map(b => Number(String(b.key).slice(3)))
    expect(await rows()).toEqual([89.1, 89.7, 91.7, 92.5, 94.1, 94.9, 98.5, 101.9, 102.7, 105.1])
    await ui.press({ key: 'peaks-sort:strength' })
    expect((await rows()).slice(0, 3)).toEqual([89.1, 94.1, 102.7])
    expect(stored.get('peakSort')).toBe('strength')
    await ui.press({ key: 'peaks-all' })
    expect(await rows()).toHaveLength(24)
    await ui.press({ key: 'peaks-sort:freq' })
    // Press ▶ on 94.1: the row says Starting… until the audio is up, then ■ Stop and ▶ playing.
    await ui.press({ key: 'ls:94.1' })
    expect((await ui.find({ key: 'ls:94.1' }))?.text).toBe('Starting…')
    expect(await ui.find({ type: 'Text', text: 'starting…' })).toBeDefined()
    await w.clock.advance(3100)
    expect((await ui.find({ key: 'ls:94.1' }))?.text).toBe('■ Stop')
    // A press starts the audio with --quick; the S-meter comes with the first meter poll, ~1 s on.
    await w.clock.advance(1100)
    expect(await ui.find({ type: 'Text', text: /^▶ playing S9\+\d+$/ })).toBeDefined()
    // Stop: 94.1 stays tuned and says so.
    await ui.press({ key: 'ls:94.1' })
    expect(w.calls.some(c => c.join(' ') === 'listen stop')).toBe(true)
    expect((await ui.find({ key: 'ls:94.1' }))?.text).toBe('▶')
    expect(await ui.find({ type: 'Text', text: '◂ tuned' })).toBeDefined()
    // The long paragraph is one line until asked.
    expect(await ui.find({ type: 'Text', text: /the dashed grey line is the noise floor/ })).toBeUndefined()
    await ui.press({ key: 'spectrum-help' })
    expect(await ui.find({ type: 'Text', text: /the dashed grey line is the noise floor/ })).toBeDefined()
  })

  test('the station list on the phone and the terminal: playing, starting and tuned rows at once, drawn to read by eye', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, 'scan fm')
    await radio($, 'listen 94.1')
    for (const [surface, columns] of [['desktop', 100], ['mobile', 46], ['terminal', 100]] as const) {
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: columns } })
      // 94.1 plays; ▶ on 101.9 was just pressed; the tuner was stepped to 102.7 meanwhile.
      w.slow = true
      await ui.press({ key: 'ls:101.9' })
      await radio($, 'tune 102.7')
      const tree = await ui.drawn()
      expect((await ui.find({ key: 'ls:94.1' }))?.text).toBe('■ Stop')
      expect((await ui.find({ key: 'ls:101.9' }))?.text).toBe('Starting…')
      const texts = (await ui.findAll({ type: 'Text' })).map(x => String(x.text))
      expect(texts.filter(x => /^▶ playing/.test(x))).toHaveLength(1)
      expect(texts.filter(x => x === 'starting…')).toHaveLength(1)
      expect(texts.filter(x => x === '◂ tuned')).toHaveLength(1)
      if (PRINT_ROWS) console.log(`--- station rows: ${surface} @ ${columns} ---\n${['pk:89.1', 'pk:94.1', 'pk:101.9', 'pk:102.7'].map(k => outline(findKey(tree, k)).join('\n')).join('\n')}`)
      if (PRINT_TREE_JSON && surface === 'desktop') console.log(`ROWS-JSON ${JSON.stringify(findKey(tree, 'peaks-list'))}`)
      w.slow = false
      await w.clock.advance(4000)
      await ui.unmount()
      await radio($, 'listen 94.1')
    }
  })
})

describe('the tuning strip under the waterfall', () => {
  test('a Client under the Raster on the terminal and under the chart on the desktop; the phone and VS Code keep the rows, and each hint says which', async ($, on) => {
    world(on, { status: STATUS_FREE })
    await start($)
    await radio($, 'scan fm')
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...PANE, surface })
      const strip = await ui.find({ type: 'Client', key: 'strip' })
      const hint = await ui.find({ type: 'Text', text: /scanned at / })
      const line = await ui.find({ type: 'Text', text: /^Spikes are transmitters/ })
      if (surface === 'terminal' || surface === 'desktop') {
        expect(strip?.props.module).toBe('hooks/tuning-strip.tsx')
        expect(hint?.text).toMatch(/· click the strip under the waterfall to tune$/)
        expect(line?.text).toMatch(/Click the strip under it to tune/)
        const sp = strip?.props.props as any
        expect(sp).toMatchObject({ start: 87.5, stop: 108, label: 'FM broadcast', tuned: 162.55, mode: 'fm', playing: null })
        expect(sp.peaks.find((p: any) => p.mhz === 94.1)).toMatchObject({ name: '94.1 WNNF', tag: 'WNNF', burst: false })
        expect(sp.grid).toContainEqual([87.5, 108, 'wbfm', 0.2, 87.9])
        expect(sp.pk.length).toBeLessThanOrEqual(240)
        expect(JSON.stringify(sp).length).toBeLessThan(20_000)
        if (surface === 'terminal') {
          // Cell for cell under the Raster: the same width, so a column is the same slice of the band.
          expect(strip?.props.width).toBe((await ui.find({ type: 'Raster' }))?.props.columns)
          expect(await ui.find({ type: 'Text', text: /^87\.5 MHz {2,}108 MHz$/ })).toBeUndefined()
        } else expect(strip?.props.width).toBe('100%')
        await ui.press({ key: 'spectrum-help' })
        expect(await ui.find({ type: 'Text', text: /Under the waterfall is the tuning strip.*Shift\+← → jump between signals, Enter plays or stops, Esc lets go\./ })).toBeDefined()
        await ui.press({ key: 'spectrum-help' })
      } else {
        expect(strip).toBeUndefined()
        expect(hint?.text).toMatch(surface === 'mobile' ? /· tap a row to play$/ : /· ▶ on a row plays it$/)
        if (surface === 'mobile') expect(line?.text).toBe('Spikes are transmitters. Tap a row to play. ')
      }
      await ui.unmount()
    }
  })

  test('terminal: pointing reads a station, a click tunes it, Enter plays, → → retunes once the presses stop, Shift+→ jumps, Enter stops', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, 'scan fm')
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const C = Number((await ui.find({ type: 'Client', key: 'strip' }))?.props.width)
    await ui.resize({ columns: C, rows: 6, in: 'strip' })
    const at = (f: number) => Math.floor(((f - SCAN_FM.start) / (SCAN_FM.stop - SCAN_FM.start)) * C)
    await ui.pointer({ type: 'move', x: at(102.7), y: 2, in: 'strip' })
    expect(await ui.find({ in: 'strip', type: 'Text', text: /^102\.7 MHz · WFM · \+\d+ dB · 102\.7 WEBN \(steady\) · click to tune$/ })).toBeDefined()
    await ui.pointer({ type: 'down', x: at(102.7), y: 2, button: 'left', in: 'strip' })
    await ui.pointer({ type: 'up', x: at(102.7), y: 2, button: 'left', in: 'strip' })
    expect((await radio($, 'tune')).text).toMatch(/^Tuner: 102\.7 MHz WFM/)
    expect(stored.get('tuner')).toMatchObject({ hz: 102_700_000, mode: 'wbfm' })
    expect(w.calls.some(c => c[0] === 'listen')).toBe(false)
    await ui.pointer({ type: 'leave', x: at(102.7), y: 2, in: 'strip' })
    expect(await ui.find({ in: 'strip', type: 'Text', text: /^▼ 102\.7 MHz WFM · 102\.7 WEBN · Enter ▶ plays/ })).toBeDefined()
    // The rest of the tab follows: the station row is marked tuned.
    expect(await ui.find({ type: 'Text', text: '◂ tuned' })).toBeDefined()
    await ui.key({ key: 'return', in: 'strip' })
    expect(w.calls.some(c => c.join(' ') === 'listen 102.7 wbfm --squelch 0 --gain auto --quick')).toBe(true)
    // Two quick steps add up and the V4 retunes once, after the presses stop.
    const q0 = w.calls.filter(c => c.includes('--quick')).length
    await ui.key({ key: 'right', in: 'strip' })
    await ui.key({ key: 'right', in: 'strip' })
    expect(w.calls.filter(c => c.includes('--quick'))).toHaveLength(q0)
    await w.clock.advance(800)
    expect(w.calls.filter(c => c.includes('--quick')).slice(q0).map(c => c.join(' '))).toEqual(['listen 102.9 wbfm --squelch 0 --gain auto --quick'])
    const next = SCAN_FM.peaks.filter((p: any) => !p.comb && !p.spur && p.mhz > 102.9001).sort((a: any, b: any) => a.mhz - b.mhz)[0]!.mhz
    await ui.key({ key: 'right', shift: true, in: 'strip' })
    await w.clock.advance(800)
    expect(w.calls.filter(c => c.includes('--quick')).at(-1)?.slice(0, 2)).toEqual(['listen', String(next)])
    expect(await ui.find({ in: 'strip', type: 'Text', text: new RegExp(`^▼ ${String(next).replace('.', '\\.')} MHz WFM .*▶ playing, Enter stops`) })).toBeDefined()
    await ui.key({ key: 'return', in: 'strip' })
    expect(w.calls.some(c => c.join(' ') === 'listen stop')).toBe(true)
  })

  test('desktop: the ui.message hook tunes in the band’s mode, refuses anything malformed, and hands the strip fresh props', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, 'scan fm')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.resize({ columns: 96, rows: 6, in: 'strip' })
    const tuned = async () => (await radio($, 'tune')).text
    const before = await tuned()
    // 0.4.0: HF reaches down to 0.5 MHz, so the out-of-range probe sits below that (12 MHz is a valid HF tune now).
    const bad: JsonValue[] = [null, 'tune', [1, 2], {}, { type: 'tune' }, { type: 'tune', mhz: '94.1' }, { type: 'tune', mhz: 5000 }, { type: 'tune', mhz: 0.2 }, { type: 'scan', mhz: 94.1 }, { type: 'listen', mhz: -3 }, { type: 'listen', mhz: 'x' }]
    for (const data of bad) await ui.post(data, { in: 'strip' })
    expect(await tuned()).toBe(before)
    expect(w.calls.some(c => c[0] === 'listen')).toBe(false)
    await ui.post({ type: 'tune', mhz: 146.52, by: 'click' }, { in: 'strip' })
    expect(await tuned()).toMatch(/^Tuner: 146\.52 MHz NFM/)
    await ui.post({ type: 'tune', mhz: 121.5 }, { in: 'strip' })
    expect(await tuned()).toMatch(/^Tuner: 121\.5 MHz AM/)
    await ui.post({ type: 'tune', mhz: 94.1, by: 'click' }, { in: 'strip' })
    expect(await tuned()).toMatch(/^Tuner: 94\.1 MHz WFM/)
    expect(await ui.find({ in: 'strip', type: 'Text', text: /^▼ 94\.1 MHz WFM · 94\.1 WNNF · Enter ▶ plays/ })).toBeDefined()
    // Listen with a frequency the strip had not yet heard back about: tuned first, then played.
    await ui.post({ type: 'listen', mhz: 102.7 }, { in: 'strip' })
    expect(w.calls.some(c => c.join(' ') === 'listen 102.7 wbfm --squelch 0 --gain auto --quick')).toBe(true)
    await ui.post({ type: 'listen' }, { in: 'strip' })
    expect(w.calls.some(c => c.join(' ') === 'listen stop')).toBe(true)
  })

  test('the strip drawn at ~100 and ~140 columns with a hover readout, every row as wide as the region', async ($, on) => {
    world(on, { status: STATUS_FREE })
    await start($)
    await radio($, 'scan fm')
    await radio($, 'tune 94.1')
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const body of [102, 142]) {
        const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: body } })
        const C = body - 2
        await ui.resize({ columns: C, rows: 6, in: 'strip' })
        await ui.pointer({ type: 'move', x: Math.floor(((102.7 - 87.5) / 20.5) * C), y: 2, in: 'strip' })
        const tree = await ui.drawn({ in: 'strip' })
        const rows = stripRows(tree)
        expect(rows).toHaveLength(6)
        for (const r of rows.slice(0, 5)) expect([...r]).toHaveLength(C)
        expect(rows[0]).toContain('WNNF')
        expect(rows[1]).toContain('▼')
        expect(rows[4]).toMatch(/^87\.5 ─+ 97\.75 ─+ 108 MHz$/)
        expect(rows[5]).toMatch(/^102\.7 MHz · WFM · \+\d+ dB · 102\.7 WEBN \(steady\) · click to tune$/)
        if (PRINT_STRIP) console.log(`--- strip: ${surface} @ ${C} ---\n${rows.join('\n')}\nSTRIP-JSON ${surface} ${C} ${JSON.stringify(tree)}`)
        await ui.unmount()
      }
    }
  })
})

// true prints the strip as text and as its tree (for an HTML picture of it).
const PRINT_STRIP = false
// The strip's drawn tree as lines of text: a spacer Box is that many spaces.
function stripRows(tree: any): string[] {
  const flat = (n: any): string => {
    if (typeof n === 'string') return n
    if (!n || typeof n !== 'object') return ''
    if (n.type === 'Box' && typeof n.props?.width === 'number' && !(n.children ?? []).length) return ' '.repeat(n.props.width)
    return (n.children ?? []).flat(9).map(flat).join('')
  }
  return (tree?.children ?? []).flat(9).map(flat)
}

const PRINT_ROWS = false
const PRINT_TREE_JSON = false
const PRINT_EQ = false
function findKey(n: any, key: string): any {
  if (!n || typeof n !== 'object') return undefined
  if (n.props?.key === key || n.key === key) return n
  for (const c of n.children ?? []) {
    const f = findKey(c, key)
    if (f) return f
  }
  return undefined
}

describe('Wildcat RF: Web SDR hands back to the tab, its bookmarks and map, the band map', () => {
  test('Send to Radio tab: a handoff while Web SDR runs stops it and plays there, once; the note and a toast say so', async ($, on) => {
    const w = world(on, { status: STATUS_WEB })
    w.handoff = { mhz: 133.425, mode: 'am', at: GADGETS.now + 59_000, from: '192.168.1.40', origin: 'http://192.168.1.29:8073' }
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await w.clock.advance(3000)
    expect(w.calls.filter(c => c[0] === 'handoff')).toEqual([['handoff']])
    expect(w.handoff).toBeNull()
    expect(await ui.find({ type: 'Text', text: /^From Web SDR: Now playing 133\.425 MHz \(AM\).*\(stopped Web SDR: the V4 does one thing at a time\)/ })).toBeDefined()
    expect(w.toasts.some(t => /^Web SDR → Radio tab: 133\.425 MHz/.test(t))).toBe(true)
    expect((await ui.find({ key: 'restore:webrx:0' }))?.text).toBe('Resume Web SDR')
    expect((await ui.findAll({ type: 'Svg' })).some(s => /^Tuner: 133\.425 MHz AM/.test(String(s.props.alt)))).toBe(true)
    // Web SDR's own line says why it stopped.
    expect(await ui.find({ type: 'Text', text: 'Web SDR stopped so the V4 could play 133.425 MHz in the Radio tab.' })).toBeDefined()
    await w.clock.advance(6000)
    expect(w.calls.filter(c => c[0] === 'handoff')).toHaveLength(1)
  })

  test('nothing is read while Web SDR is off; an old handoff is cleared, not played', async ($, on) => {
    const off = world(on, { status: STATUS_FREE })
    off.handoff = { mhz: 100.1, mode: 'wbfm', at: GADGETS.now + 59_000 }
    await start($)
    await off.clock.advance(5000)
    expect(off.calls.some(c => c[0] === 'handoff')).toBe(false)
  })

  test('an old handoff (the tab was closed) is cleared, not played', async ($, on) => {
    const w = world(on, { status: STATUS_WEB })
    w.handoff = { mhz: 100.1, mode: 'wbfm', at: GADGETS.now - 3_600_000 }
    await start($)
    await w.clock.advance(4000)
    expect(w.calls.filter(c => c[0] === 'handoff')).toEqual([['handoff', 'clear']])
    expect(w.handoff).toBeNull()
  })

  test('the Web SDR section: the Map, Sync bookmarks, what Send to Radio tab does and how background decoding shares the V4', async ($, on) => {
    const w = world(on, { status: STATUS_WEB })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toContain('http://localhost:8073/map')
    expect(await ui.find({ type: 'Text', text: /^Send to Radio tab: the amber button under the frequency in Web SDR hands what it is tuned to back here/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Background decoding: .*APRS on 144\.390 MHz .*433 MHz gadgets .*Web SDR still holds the V4 the whole time/ })).toBeDefined()
    await ui.press({ key: 'web-sync' })
    expect(w.calls.some(c => c[0] === 'sync-bookmarks.sh')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Bookmarks synced: 14 stations, 23 notable, 14 busy lately .* Web SDR shows them the next time its page loads/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Bookmarks synced: 14 stations/ })).toBeDefined()
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
    expect((await phone.find({ type: 'Link', text: 'Web SDR map' }))?.props.href).toBe('http://localhost:8073/map')
    expect(await phone.find({ type: 'Text', text: /^While nobody has the page open, Web SDR decodes APRS/ })).toBeDefined()
    const sync = await radio($, 'web sync')
    expect(sync.text).toMatch(/^Bookmarks synced: 14 stations/)
    const txt = await radio($, 'web')
    expect(txt.text).toMatch(/Map: http:\/\/localhost:8073\/map/)
    expect(txt.text).toMatch(/Send to Radio tab: /)
    expect(txt.text).toMatch(/\/sdr web sync refreshes its bookmarks/)
  })

  test('the band map: buttons named in the hint, hover tooltips on the desktop only, a coloured dot on each button', async ($, on) => {
    world(on)
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const map = (await ui.findAll({ type: 'Svg' })).find(s => /^Band map from 24 MHz/.test(String(s.props.alt)))
    expect(map?.props.isInteractive).toBe(true)
    const src = String(map?.props.source)
    expect(src).toMatch(/<g class="bnd"><title>Aircraft 118–137 MHz · (\d+ signals? in the last scan \(\d+:\d\d [ap]m\), strongest \+\d+ dB|not scanned yet) · use the Aircraft button below to scan it<\/title>/)
    expect(src).toMatch(/<title>FM broadcast 87\.5–108 MHz · /)
    expect(src).toContain('.bnd:hover .bar')
    expect(src.length).toBeLessThan(SVG_MAX)
    expect(src).not.toMatch(/<script|onload=|onclick=|onmouseover=/)
    expect(map?.props.height).toBeGreaterThan(100)
    expect(await ui.find({ type: 'Text', text: /the buttons under the map scan a band \(about 10 s\) · hover the map for details/ })).toBeDefined()
    // One dot per band button, in its colour on the map: FM cyan, then NOAA teal, Aircraft and ADS-B sky...
    const dots = (await ui.findAll({ type: 'Text', text: '● ' })).map(d => d.props.color)
    expect(dots.slice(0, 4)).toEqual(['#4fd1e0', '#5fd3b8', '#7fb8ff', '#7fb8ff'])
    expect(dots.length).toBeGreaterThanOrEqual((await ui.findAll({ type: 'Button' })).filter(b => /^scan:/.test(String(b.key))).length)
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
    const pmap = (await phone.findAll({ type: 'Svg' })).find(s => /^Band map from 24 MHz/.test(String(s.props.alt)))
    expect(pmap?.props.isInteractive).toBeUndefined()
    expect(await phone.find({ type: 'Text', text: /tap a band button below to scan it/ })).toBeDefined()
  })
})

// The timing log the plugin wrote (~/Library/Application Support/radio/actions.jsonl), one record a line.
function logOf(w: World): any[] {
  const text = [...w.files.entries()].find(([path]) => path.endsWith('/radio/actions.jsonl'))?.[1] ?? ''
  return text
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
}

describe('presses: shown at once, never dropped, run once, ahead of the polls', () => {
  test('the pending label is in the very next drawing after a press, and the top says what it is doing', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, slowListen: true })
    await start($)
    await radio($, '')
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect((await ui.find({ key: 'try:weather' }))?.text).toBe('Hear the weather radio')
      await ui.press({ key: 'try:weather' })
      // radio.py has not answered yet (it is asleep on the clock): the drawing already says so.
      expect(w.calls.filter(c => c[0] === 'listen' && c[1] === '162.55')).toHaveLength(1)
      const btn = await ui.find({ key: 'try:weather' })
      expect(btn?.text).toBe('Tuning 162.55 MHz…')
      expect(btn?.props.variant).toBe('primary')
      expect(await ui.find({ type: 'Text', text: /^Tuning 162\.55 MHz: starting the audio \(about \d+ s\)$/ })).toBeDefined()
      await w.clock.advance(3100)
      expect((await ui.find({ key: 'try:weather' }))?.text).toBe('Hear the weather radio')
      expect(await ui.find({ type: 'Text', text: /^Tuning 162\.55 MHz: / })).toBeUndefined()
      await radio($, 'stop')
      w.calls.length = 0
      await ui.unmount()
    }
  })

  test('a press while another runs is queued, not dropped, and runs after it; the newest press waiting wins', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, slowListen: true })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'try:weather' })
    await ui.press({ key: 'try:live' })
    expect((await ui.find({ key: 'try:live' }))?.text).toBe('Queued: Starting the live view of FM broadcast')
    expect((await ui.find({ key: 'try:live' }))?.props.dimColor).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Queued: Starting the live view of FM broadcast, runs next$/ })).toBeDefined()
    // A newer press replaces the one waiting (the last click wins); nothing has run yet.
    await ui.press({ key: 'try:planes' })
    expect((await ui.find({ key: 'try:live' }))?.text).toBe('Watch the FM band live')
    expect((await ui.find({ key: 'try:planes' }))?.text).toBe('Queued: Starting Planes')
    expect(w.calls.some(c => c.join(' ') === 'job start adsb')).toBe(false)
    await w.clock.advance(3100)
    const order = w.calls.map(c => c.join(' '))
    const li = order.findIndex(c => c.startsWith('listen 162.55 fm'))
    expect(li).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('job start adsb')).toBeGreaterThan(li)
    expect(order.some(c => c.startsWith('live start'))).toBe(false)
    expect(await ui.find({ type: 'Text', text: /^Planes · / })).toBeDefined()
    expect((await ui.find({ key: 'try:planes' }))?.text).toBe('See planes overhead')
    // One line per press in the timing log, with when it was pressed, started and finished.
    await w.clock.advance(1100)
    const log = logOf(w)
    const planes = log.find(l => l.action === 'Starting Planes')
    expect(planes).toMatchObject({ key: 'job adsb on', queued: true, coalesced: 0, ok: true })
    expect(planes.startedAt).toBeGreaterThanOrEqual(planes.pressedAt)
    expect(planes.finishedAt).toBeGreaterThanOrEqual(planes.startedAt)
    expect(log.find(l => l.action === 'Starting the live view of FM broadcast')).toMatchObject({ superseded: true, ok: null, by: 'Starting Planes' })
    expect(log.find(l => l.key === 'listen 162.55 fm')).toMatchObject({ queued: false, ok: true })
  })

  test('three quick presses on one button run it once; a late fourth one changes nothing', async ($, on) => {
    const w = world(on, { status: STATUS_FREE, slowListen: true })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    for (let i = 0; i < 3; i++) await ui.press({ key: 'st:fav:162.55' })
    expect((await ui.find({ key: 'st:fav:162.55' }))?.text).toBe('Tuning 162.55…')
    await w.clock.advance(3100)
    const listens = () => w.calls.filter(c => c[0] === 'listen' && c[1] === '162.55')
    expect(listens()).toHaveLength(1)
    // From a drawing a moment old: it already plays, so radio.py is not asked again.
    await ui.press({ key: 'st:fav:162.55' })
    expect(listens()).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: /^Already playing NOAA KIH42 Covington\.$/ })).toBeDefined()
    await w.clock.advance(1100)
    expect(logOf(w).find(l => l.key === 'listen 162.55 fm')).toMatchObject({ coalesced: 2, ok: true })
  })

  test('a press jumps ahead of the polls already queued, and they wait until it is done', async ($, on) => {
    // radio.py recordings takes 2 s: the first polls queue up behind it on the V4 lane.
    const w = world(on, { status: STATUS_FREE, slowPoll: 'recordings' })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const order = () => w.calls.map(c => c.join(' '))
    expect(order()).toContain('recordings')
    const views = (o: string[]) => o.filter(c => /^(adsb\.py view|digital\.py (aprs|same) view)/.test(c))
    expect(views(order())).toEqual([])
    await ui.press({ key: 'try:planes' })
    expect((await ui.find({ key: 'try:planes' }))?.text).toBe('Starting Planes…')
    await w.clock.advance(2100)
    const o = order()
    const job = o.indexOf('job start adsb')
    const firstView = o.findIndex(c => views([c]).length > 0)
    expect(job).toBeGreaterThan(o.indexOf('recordings'))
    expect(firstView).toBeGreaterThan(job)
    // The press's own status read comes before the queued polls too: they waited until it was done.
    expect(o.indexOf('status', job)).toBeGreaterThan(job)
    expect(o.indexOf('status', job)).toBeLessThan(firstView)
    expect(views(o).length).toBeGreaterThanOrEqual(2)
  })

  test('webrx/status.sh runs beside the V4 lane: a press never waits on it', async ($, on) => {
    const w = world(on, { status: STATUS_WEB, slowPoll: 'status.sh' })
    w.slowMs = 5000
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(w.calls.some(c => c[0] === 'status.sh')).toBe(true)
    // status.sh is still out (5 s); the press runs at once all the same.
    await ui.press({ key: 'planes-toggle' })
    expect(w.calls.some(c => c.join(' ') === 'job start adsb')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Planes · / })).toBeDefined()
    // Its answer ("Web SDR running") comes back after the press stopped Web SDR: dropped, and read again.
    await w.clock.advance(6500)
    expect(w.calls.filter(c => c[0] === 'status.sh').length).toBeGreaterThanOrEqual(2)
    expect(await ui.find({ type: 'Text', text: /^Web SDR · / })).toBeUndefined()
    expect(w.status.at(-1)).not.toMatch(/Web SDR on/)
  })

  test('Listen starts at once with --quick; the weak-signal toast comes from the meter polls', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.input({ key: 'tune', text: '162.45 fm' })
    expect(w.calls.some(c => c.join(' ') === 'listen 162.45 fm --squelch 0 --gain 40.2 --quick')).toBe(true)
    expect(w.calls.some(c => c[0] === 'listen' && c[1] === '162.45' && !c.includes('--quick'))).toBe(false)
    // The quick reply has no verdict; the first meter polls bring it.
    expect(w.toasts.some(t => /weak signal/.test(t))).toBe(false)
    await w.clock.advance(1600)
    expect(w.calls.some(c => c.join(' ') === 'listen meter')).toBe(true)
    expect(w.toasts.filter(t => t === '162.45 MHz: weak signal — try the antenna by a window')).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: 'NOAA weather radio: weak signal — try the antenna by a window.' })).toBeDefined()
    expect(w.status.at(-1)).toMatch(/\(weak\)/)
    // Once per listen, however many meter polls follow.
    await w.clock.advance(4000)
    expect(w.toasts.filter(t => /weak signal/.test(t))).toHaveLength(1)
    // The station rows and Start here play with --quick too.
    await ui.press({ key: 'try:weather' })
    expect(w.calls.some(c => c.join(' ') === 'listen 162.55 fm --squelch 0 --gain 40.2 --quick')).toBe(true)
  })

  test('a failed press says so in a toast and clears its pending state', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    await radio($, '')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // rec start with nothing playing: radio.py says why, and the press ends in a toast.
    await ui.press({ key: 'rec-toggle' })
    expect(w.calls.some(c => c.join(' ') === 'rec start')).toBe(true)
    expect(w.toasts.some(t => /^Starting ● Rec: Nothing is playing: press ▶ Listen first, then ● Rec\.$/.test(t))).toBe(true)
    expect((await ui.find({ key: 'rec-toggle' }))?.text).toBe('● Rec')
    await w.clock.advance(1100)
    expect(logOf(w).find(l => l.key === 'rec on')).toMatchObject({ ok: false, failed: 'Nothing is playing: press ▶ Listen first, then ● Rec.' })
  })
})

// ---------------------------------------------------------------- 0.4.0: the "beat SDR++" pack

describe('0.4.0: SSB/CW and HF presets, the Scanner, IQ snapshots, Radio settings', () => {
  test('SSB and CW on the tuner; the HF tab is dimmed with the antenna note until HF is confirmed, then lights up and plays', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    for (const k of ['mode:usb', 'mode:lsb', 'mode:cw']) expect(await ui.find({ key: k })).toBeDefined()
    await ui.press({ key: 'mode:usb' })
    expect((await radio($, 'tune')).text).toMatch(/^Tuner: 162\.55 MHz USB/)
    expect((await ui.find({ key: 'step:1000' }))?.props.variant).toBe('primary')      // SSB tunes in 1 kHz steps
    await ui.press({ key: 'cat:hf' })
    const wwv = await ui.find({ key: 'st:hf:10' })
    expect(wwv?.text).toBe('WWV 10 MHz')
    expect(wwv?.props.dimColor).toBe(true)                                              // not yet confirmed on air
    expect(await ui.find({ type: 'Text', text: /needs a 10–20 m long wire \+ 9:1 balun; not yet confirmed on air/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Link' })).map(l => l.props.href)).toContain('https://www.sigidwiki.com/wiki/Signal_Identification_Guide')
    expect((await radio($, 'hf status')).text).toMatch(/not yet confirmed on air[\s\S]*28\.8 MHz/)
    expect((await radio($, 'hf confirm')).text).toMatch(/HF marked as confirmed/)
    expect(w.calls.some(c => c.join(' ') === 'hf confirm')).toBe(true)
    await w.clock.advance(1100)
    expect((await ui.find({ key: 'st:hf:10' }))?.props.dimColor).toBeFalsy()
    expect(await ui.find({ type: 'Text', text: /^shortwave through the V4’s upconverter/ })).toBeDefined()
    await ui.press({ key: 'st:hf:10' })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 10 am')).toBe(true)
    expect((await radio($, 'listen 14.2 usb')).text).toBeDefined()
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 14.2 usb')).toBe(true)
    expect((await radio($, 'listen 518 khz usb')).text).toBeDefined()
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 0.518 usb')).toBe(true)
  })

  test('the Scanner: on and off through the job system, the parked state line and hits, Hold / Skip / Lock out, ★ and ⛔ on the favourites, /sdr scan list|add; scan <band> still sweeps', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    expect((await radio($, 'scan fm')).text).toMatch(/FM broadcast/)                   // the band sweep, as before
    expect(w.calls.some(c => c.join(' ') === 'scan fm')).toBe(true)
    expect((await radio($, 'scan on')).text).toMatch(/^Scanner on\./)
    expect(w.calls.some(c => c.join(' ') === 'scan on')).toBe(true)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /^▶ stopped on 2 m calling · 146\.52 NFM/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^On the V4 now/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /146\.52  2 m calling · 0:12/ })).toBeDefined()  // the hit history
    expect((await ui.find({ key: 'scan-toggle' }))?.text).toBe('■ Scan off')
    for (const k of ['scan-hold', 'scan-skip', 'scan-lock-cur']) expect(await ui.find({ key: k })).toBeDefined()
    expect((await ui.find({ key: 'scan-lock-cur' }))?.text).toBe('⛔ Lock out 146.52')
    await ui.press({ key: 'scan-skip' })
    expect(w.calls.some(c => c.join(' ') === 'scan skip')).toBe(true)
    await ui.press({ key: 'scan-hold' })
    expect(w.calls.some(c => c.join(' ') === 'scan hold')).toBe(true)
    // The favourites: ★ marks the priority channel, ⛔ locks one out, ✓ unlocks the locked-out one.
    expect((await ui.find({ key: 'sc-pri:146.52' }))?.text).toBe('★')
    expect((await ui.find({ key: 'sc-lock:147.03' }))?.text).toBe('✓')
    expect((await ui.find({ key: 'sc-lock:162.55' }))?.text).toBe('⛔')
    await ui.press({ key: 'sc-lock:162.55' })
    expect(w.calls.some(c => c.join(' ') === 'scan lockout 162.55')).toBe(true)
    await ui.press({ key: 'sc-lock:147.03' })
    expect(w.calls.some(c => c.join(' ') === 'scan unlock 147.03')).toBe(true)
    await ui.press({ key: 'sc-pri:162.55' })
    expect(w.calls.some(c => c.join(' ') === 'scan priority 162.55')).toBe(true)
    await ui.press({ key: 'sc-play:147.03' })
    expect(w.calls.some(c => c.slice(0, 3).join(' ') === 'listen 147.03 fm')).toBe(true)
    expect((await radio($, 'scan add 146.46 fm test repeater')).text).toMatch(/^Added test repeater/)
    expect(w.calls.some(c => c.join(' ') === 'scan add 146.46 fm test repeater')).toBe(true)
    const list = (await radio($, 'scan list')).text ?? ''
    expect(list).toMatch(/147\.03  K4CO Edgewood  NFM sql 40  \(locked out\)/)
    expect(list).toMatch(/146\.52  2 m calling  NFM sql 40  ★ priority/)
    expect(list).toMatch(/scan priority <MHz\|off>/)
    // The phone: everything stacks, every control a button, nothing wider than 46 columns.
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile', props: { ...PANE.props, bodyColumns: 46 } })
    expect(overflowing(await phone.drawn(), 46)).toEqual([])
    expect(await phone.find({ key: 'scan-toggle' })).toBeDefined()
    await phone.unmount()
    expect((await radio($, 'scan off')).text).toMatch(/^Scanner off\./)
    expect(w.calls.some(c => c.join(' ') === 'scan off')).toBe(true)
    expect((await ui.find({ key: 'scan-toggle' }))?.text).toBe('▶ Scan on')
  })

  test('IQ snapshots: a 10 s snapshot at the tuner takes the V4, the list, ▶ renders a waterfall from the file, decode gadgets on 433.92, 🗑', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    expect((await radio($, 'snapshot 162.55 10')).text).toMatch(/^Capturing 10 s of raw I\/Q at 162\.55 MHz/)
    expect(w.calls.some(c => c.join(' ') === 'snapshot 162.55 --seconds 10')).toBe(true)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /^● capturing/ })).toBeDefined()
    for (const k of ['snap-10', 'snap-30', 'snap-60']) expect(await ui.find({ key: k })).toBeDefined()
    expect(await ui.find({ key: `snap-dec:${SNAP_FILE}` })).toBeDefined()                     // only the 433.92 one decodes
    expect(await ui.find({ key: 'snap-dec:2026-10-07/162.550_1024k.cu8' })).toBeUndefined()
    await ui.press({ key: `snap-wf:${SNAP_FILE}` })
    expect(w.calls.some(c => c.join(' ') === `snapshot waterfall ${SNAP_FILE} --cols 256`)).toBe(true)
    const wf = (await ui.findAll({ type: 'Svg' })).find(s => /^Waterfall of the 433\.92 MHz snapshot/.test(String(s.props.alt)))
    expect(wf).toBeDefined()
    expect(String(wf?.props.source)).toContain('data:image/png;base64,')
    expect(String(wf?.props.source)).toContain('433.408')
    await ui.press({ key: `snap-dec:${SNAP_FILE}` })
    expect(w.calls.some(c => c.join(' ') === `snapshot decode ${SNAP_FILE}`)).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^rtl_433 decoded 3 messages from 1 device model in the snapshot\. Acurite-Tower\./ })).toBeDefined()
    await ui.press({ key: `snap-del:${SNAP_FILE}` })
    expect(w.calls.some(c => c.join(' ') === `snapshot delete ${SNAP_FILE}`)).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^On disk: 61\.4 MB of 4 GB in ~\/Radio\/IQ/ })).toBeDefined()
    const text = (await radio($, 'snapshots')).text ?? ''
    expect(text).toMatch(/^IQ snapshots: 2 · 61\.4 MB of 4 GB/)
    expect(text).toContain(SNAP_FILE)
    const phone = await $.ui.mount({ ...PANE, surface: 'mobile', props: { ...PANE.props, bodyColumns: 46 } })
    expect(overflowing(await phone.drawn(), 46)).toEqual([])
    await phone.unmount()
  })

  test('Radio settings: PPM − + and calibrate from NOAA (takes the V4), the filter width per mode, the bias-tee with its warning, the HF test; /sdr set, settings, calibrate', async ($, on) => {
    const w = world(on, { status: STATUS_FREE })
    await start($)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'ppm-up' })
    expect(w.calls.some(c => c.join(' ') === 'set ppm 1')).toBe(true)
    expect((await radio($, 'set ppm 2')).text).toMatch(/^PPM correction set to 2/)
    expect((await radio($, 'settings')).text).toMatch(/^PPM 2 · bias-tee off/)
    await ui.press({ key: 'ppm-down' })
    expect(w.calls.some(c => c.join(' ') === 'set ppm 1')).toBe(true)
    await ui.press({ key: 'flt-up' })
    expect(w.calls.some(c => c.join(' ') === 'set filter fm 26000')).toBe(true)        // the tuner's NFM, +2 kHz
    expect(await ui.find({ type: 'Text', text: /^Only for an amplifier or an active antenna that needs power/ })).toBeDefined()
    await ui.press({ key: 'biast-toggle' })
    expect(w.calls.some(c => c.join(' ') === 'biast on')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Bias-tee ON: 4\.5 V DC now feeds the antenna port/ })).toBeDefined()
    expect((await ui.find({ key: 'biast-toggle' }))?.text).toBe('■ Bias-tee off')
    await ui.press({ key: 'ppm-cal' })
    expect(w.calls.some(c => c.join(' ') === 'calibrate 162.55')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^Calibrated: the 162\.55 MHz carrier read 0\.325 kHz off, so PPM is set to -2/ })).toBeDefined()
    await ui.press({ key: 'hf-test' })
    expect(w.calls.some(c => c.join(' ') === 'hf test 10')).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^No clear carrier at 10 MHz\. HF needs a long-wire antenna through a 9:1 balun/ })).toBeDefined()
    expect(await ui.find({ key: 'hf-confirm' })).toBeDefined()
    expect((await radio($, 'calibrate')).text).toMatch(/PPM is set to -2/)
    expect((await radio($, 'biast off')).text).toMatch(/^Bias-tee OFF/)
    expect((await radio($, 'hf test 5')).text).toMatch(/No clear carrier at 5 MHz/)
  })
})

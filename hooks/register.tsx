import type { Register } from 'claude-code'
import { parseJob, parsePlanes, parseScan, parseTune, registerTools } from './tools'
import type { StripGrid, StripMessage, StripPeak, StripProps } from './tuning-strip'

// The Radio tab: an RTL-SDR Blog V4 on the Mac's USB, driven through
// scripts/radio.py, for seeing the radio world around Walton, KY. Receive only.
//   Tuner     a receiver's LCD (7-segment frequency, mode, step, squelch, gain)
//             with ▼ ▲, chips and an S-meter read from the audio while playing,
//             an EQ display of the sound under it, and ● Rec / Log: record what
//             plays, or keep one clip per transmission.
//   World     24 MHz – 1.7 GHz on a log scale with VHF / UHF close-ups (a
//             picture: tooltips on hover on the desktop), and under it a button
//             per band (scan it, or move the live view there) with its map
//             colour, with what the last scans heard as heat marks.
//   Spectrum  a 10 s scan, or Live: rtl_power without end, redrawn every ~2 s
//             as a spectrum (average, 60 s peak hold, max hold) over a scrolling
//             60-row waterfall. Peaks are named; tapping one sets the tuner.
//             Under it on the terminal and the desktop, the tuning strip
//             (tuning-strip.tsx, a Client): the band as coloured cells that
//             take the pointer. Point to read, click to tune, then ← → and
//             Enter; its posts land in the 'ui.message' hook below.
//   Mesh      Meshtastic 906.875 / MeshCore 910.525 bursts per minute.
//   Gadgets   rtl_433 in the background: one card per transmitter (one sensor
//             decoded as two models is merged), sparklines of its readings, the
//             neighbourhood summed up, low batteries, a toast for a new one.
//   Share     rtl_tcp so an SDR app on the phone can use the V4.
//   Planes    ADS-B on 1090 MHz: a radar of the aircraft around Walton (adsb.py).
//   APRS      144.390 MHz packets: stations on a map (digital.py).
//   Alerts    NOAA weather alerts (SAME) from KIH42 162.550 (digital.py).
//   Web SDR   OpenWebRX+ in Docker over rtl_tcp, for any browser (webrx/), in the
//             Wildcat RF skin; its Map, Sync bookmarks, and its "Send to Radio
//             tab" button handing a frequency back (handoff.json, pollHandoff).
//   Recordings what Rec and Log saved under ~/Radio/Recordings: play, trash, Finder.
// The V4 is one-program-at-a-time: every use of it is a job in radio.py's job
// manager, which stops whatever holds it and records why; the tab says so
// ("Planes stopped so the V4 could run Web SDR"), names the holder at the top
// ("On the V4 now") and offers Resume and Stop all.
// Presses (0.3.4): every button's press is an intent (intent() below): shown on the button at
// once and at the top with its step and duration, queued (never dropped) behind a press that
// runs, the newest one waiting winning and the same one again joining it; presses run ahead of
// the polls, slow read-only reads run beside the V4 lane, and each press is timed into
// actions.jsonl (see the README's "Presses and polls").
//
// HOOK POINT for other modules: SECTIONS below. A module exports a Section
// ({ id, title, render, text?, verbs?, command?, poll? }); `SECTIONS.push(it)`
// adds it to the tab after the core sections, to the /sdr summary and to
// /sdr <verb>. Its jobs go in radio.py's MODES registry (see the top of that
// file) and show up in `status.jobs[kind]`, which the section reads from its
// context. Planes, APRS, Weather alerts and Web SDR are written that way here.
const PANE = 'radio'
const TITLE = 'Radio'
// The plane radar on its own: a second tab with nothing to scroll past, which can also be popped out.
const PLANES_PANE = 'radio-planes'
// The home folder comes from the environment at session.start (setHome), never from the code.
let HOME = ''
const PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
const TICK_MS = 1000
const STATUS_MS = 30_000
const LIST_MS = 5000
const FRAME_MS = 2000
const METER_MS = 1500
const RETUNE_MS = 700
// The EQ display reads the tap's eq.json straight from the state folder (no process), only
// while Listen plays and the tab is drawn: ~2.5 times a second, once a second on the phone.
const EQ_TICK_MS = 200
const EQ_MS = 400
const EQ_MS_PHONE = 1000
let EQ_FILE = '' // set by setHome
// Web SDR's "Send to Radio tab" leaves {mhz, mode, at} here; looked at every ~1.5 s while it runs.
let HANDOFF_FILE = '' // set by setHome
const HANDOFF_MS = 1500
const HANDOFF_MAX_MS = 120_000
const RECS_MS = 4000
// The peak list under the spectrum: this many strongest until "show all".
const PEAKS_SHOWN = 10
const MONO = 'Menlo,monospace'
const SANS = 'Helvetica,Arial,sans-serif'
// One dark instrument look for every chart (the VNA tab's palette).
const BG = '#10161a'
const PLOT = '#0c1215'
const GRID = '#243238'
const GRID2 = '#1a252a'
const AXIS = '#7f9199'
const LABEL = '#c9d4da'
const BRIGHT = '#e6edf0'
const CYAN = '#4fd1e0'
const AMBER = '#f0c050'
const YELLOW = '#ffd84a'
const GREEN = '#7ad67a'
const MAGENTA = '#e07be0'
const ORANGE = '#f0a050'
const RED = '#ff6b6b'
const SKY = '#7fb8ff'
const TEAL = '#5fd3b8'
const MARK = '#6fae8c'
const LCD = '#62f0dc'

// ---------------------------------------------------------------- types

type Peak = { mhz: number; db: number; above: number; kind: 'steady' | 'burst'; name: string | null; listen: string | null; spur?: boolean; comb?: boolean }
type Grid = { cols: number; rows: number; b64: string }
type Exit = { at: number; reason: string; detail: string } | null
type Stopped = { kind: string; freq?: number; mode?: string; label?: string; port?: number; addr?: string; band?: string; preset?: string; lo?: number; hi?: number }
// A scan (one-shot) or a live frame: what the spectrum draws.
type View = {
  ok: true
  live?: boolean
  running?: boolean
  preset: string
  label: string
  start: number
  stop: number
  binHz: number
  gain: number | string | null
  seconds?: number
  at: number
  startedAt?: number
  sweeps?: number
  bins: number
  freqs: number[]
  avg: number[]
  max: number[]
  hold?: number[] | null
  cur?: number[]
  rows?: number[][]
  nrows?: number
  maxRows?: number
  rowSec?: number
  newestFirst?: boolean
  times?: string[]
  floor: number
  top: number
  scale?: [number, number]
  peaks: Peak[]
  marks: { mhz: number; label: string }[]
  listen: string | null
  png: string
  wf?: Grid
  mesh?: Record<string, number> | null
  gadgets?: { paused: boolean; restarted: boolean | null }
  stopped?: Stopped[]
  lastExit?: Exit
}
type Job = { running: boolean; since: number | null; lastExit: Exit; label?: string; meta?: Record<string, any>; doing?: string }
// Who has the V4 (radio.py status.holder): one of our jobs by its label, a one-shot script run, or another program.
type Holder = { kind: string | null; label: string; detail: string | null; doing?: string | null; since: number | null; pid: number | null; ours: boolean; oneshot?: boolean }
type Activity = { at: number; n: number; best: number; bursts: number; named: string[]; floor: number; scans: number }
type MeshChan = { mhz: number; name: string; bursts: number; perMin: number; state: 'busy' | 'active' | 'quiet' | 'unknown' }
type Mesh = { window: [number, number, number, number][]; seconds: number; lastAt: number | null; mt: MeshChan; mc: MeshChan }
type Status = {
  device: { present: boolean; name?: string; serial?: string; usb?: string }
  state: 'missing' | 'free' | 'ours' | 'busy'
  owner: { pid: number; name: string; app: string; ours?: string } | null
  holder?: Holder | null
  gadgets: { running: boolean; since: number | null; band: string | null; lastExit: Exit }
  listen: { running: boolean; since: number | null; freq?: number; mode?: string; label?: string; player?: string; squelch?: number; gain?: number | string; volume?: number; tap?: number; autostop?: boolean; lastExit: Exit }
  share: { running: boolean; since: number | null; port?: number; addr?: string; lan?: string | null; tailscale?: string | null; lastExit: Exit }
  live?: { running: boolean; since: number | null; preset?: string; label?: string; lo?: number; hi?: number; lastExit: Exit }
  jobs?: Record<string, Job>
  lastScan: { preset: string; label: string; at: number } | null
  activity?: Record<string, Activity>
  mesh?: Mesh
  tools: Record<string, boolean | string | null>
  pluginErrors?: Record<string, string>
  /** 0.4.0: the settings panel's quick facts, whether HF is confirmed on air, the scanner's state. */
  settings?: { ppm: number; biast: boolean }
  hf?: { confirmed: boolean }
  scanner?: { running: boolean; current: ScanChannel | null; parked?: boolean | null }
  now: number
}
type HistPoint = [number, number | null, number | null, number | null]
type Device = {
  key: string
  model: string
  models?: string[] | null
  id: number | string | null
  channel: number | string | null
  kind: string
  first: number
  last: number
  count: number
  rssi: number | null
  snr: number | null
  say: string
  tempF: number | null
  humidity?: number | null
  lowBattery: boolean
  hist?: HistPoint[]
}
type Hood = { day: number; hour: number; kinds: Record<string, number>; newest: { model: string; kind: string; first: number } | null; lowBattery: string[]; merged: number }
type Gadgets = { running: boolean; since: number | null; band: string | null; total: number; devices: Device[]; hood?: Hood; lastExit: Exit; now: number }
type Station = { mhz: number; name: string; above?: number }
type Meter = {
  at: number
  freq: number
  mode: string
  label?: string
  level: number
  peak: number
  metric: number | null
  unit: string
  squelch: 'off' | 'open' | 'closed'
  squelchLevel: number
  heard: number
  weak: boolean | null
  idle?: boolean | null
  since: number
  /** The tap's version: 2 records and feeds the EQ (a Listen started by 0.2.x has none). */
  tap?: number
  rec?: RecLive | null
  log?: LogLive | null
  recError?: string
}
// What the listen tap is recording (meter.json's rec / log) and what is on disk (radio.py recordings).
type RecLive = { on: boolean; id: string; file: string; since: number; seconds: number; bytes: number; until: number | null }
type LogLive = { on: boolean; since: number | null; clips: number; dropped: number; open: boolean; gate: string; skipped: string | null }
type Recording = { file: string; name: string; start: number; freq: number; mode: string; station?: string | null; label?: string | null; duration: number | null; size: number; clip: boolean; recording: boolean; timed?: boolean; ok?: boolean }
type RecDay = { day: string; label: string; recordings: number; clips: number; seconds: number; bytes: number }
// 0.4.0: the Scanner (radio.py scan list), Radio settings (radio.py settings) and IQ snapshots (radio.py snapshot list).
type ScanChannel = { freq: number; mode: string; name: string; squelch: number }
type ScanHit = { freq: number; name: string; mode: string; at: number; secs?: number }
type ScanState = { running: boolean; since: number; current: ScanChannel | null; parked: boolean; scanning: boolean; hold: boolean; hits: ScanHit[]; empty?: boolean; heard?: number; level?: number; at: number }
type ScannerView = { running: boolean; state: ScanState | null; channels: ScanChannel[]; active: number; lockout: number[]; priority: number | null; hold: boolean; dwell: number; resume: number; hits: ScanHit[]; now: number }
type HfState = { confirmed: boolean; at: number | null; evidence: string | null; maxMhz: number; driver: { supported: boolean; lib: string; note: string } }
type SettingsView = { ok: boolean; ppm: number; filters: Record<string, number>; biast: boolean; tools: Record<string, boolean>; hf: HfState; filterDefaults: Record<string, number>; now: number }
type Snap = { file: string; mhz: number | null; rate: number | null; seconds: number | null; gain: string | null; at: number | null; size: number; mtime: number; label: string | null }
type SnapView = { ok: boolean; items: Snap[]; total: number; keep: { gb: number; days: number }; root: string; now: number }
type SnapWf = { ok: boolean; file: string; mhz: number; rate: number; cols: number; rows: number; start: number; stop: number; scale: [number, number]; png: string; wf: Grid; say?: string }
type SnapDecode = { ok: boolean; file?: string; events?: number; models?: Record<string, number>; devices?: string[]; say: string }
type RecView = {
  ok: boolean
  day: string
  today: boolean
  root: string
  dir: string
  items: Recording[]
  count: number
  older: RecDay[]
  total: { bytes: number; files: number }
  keep: { gb: number; days: number }
  rec: RecLive | null
  log: { on: boolean; since: number | null; count: number; seconds: number; skipped?: string | null; open?: boolean; gate?: string | null }
  listen: { running: boolean; label?: string | null; freq?: number | null; volume?: number | null; tap?: number | null; autostop?: boolean }
  playing: { pid: number; file: string; started: number; duration: number | null; volume: number } | null
  say: string
  now: number
}
// The EQ display: the tap's audio spectrum (eq.json), each band and its peak cap 0-1 of the dB range.
type Eq = { at: number; since: number; freq: number; mode: string; rate: number; edges: number[]; bands: number[]; peaks: number[]; rms: number | null; kind: string; range: [number, number] }
type Mode = 'wbfm' | 'fm' | 'am' | 'usb' | 'lsb' | 'cw'
// The tuner's mode row (0.4.0 adds SSB and CW: rtl_fm's usb / lsb, CW as USB tuned 700 Hz low).
const MODES_ROW: Mode[] = ['wbfm', 'fm', 'am', 'usb', 'lsb', 'cw']
const HF_MAX = 28.8
const SIGID_WIKI = 'https://www.sigidwiki.com/wiki/Signal_Identification_Guide'
type Tuner = { hz: number; mode: Mode; step: number; squelch: number; gain: 'auto' | number }
// A station preset: the tuner's category tabs and the stations he has listened to.
type Preset = { mhz: number; label: string; mode: Mode; above?: number; at?: number }
// What the new sections read (adsb.py view, digital.py aprs/same view, webrx/status.sh).
type PlanesView = {
  ok: boolean
  empty: boolean
  updated: number | null
  job: { running: boolean; since: number | null; lastExit: Exit }
  counts: { aircraft: number; withPosition: number; farthestNm: number | null; farthest: string | null; msgPerSec?: number | null }
  emergencies: string[]
  antenna: string
  range: string
  svg?: string
  table?: string
  now: number
}
type AprsView = {
  ok: boolean
  updated: number | null
  packets: number
  stations: number
  withPosition: number
  nearest: number | null
  farthest: number | null
  lastPacket: { at: number; call: string; type: string; summary: string } | null
  recent: { at: number; call: string; type: string; summary: string }[]
  lastExit: Exit
  empty: boolean
  emptySay: string
  svg?: string
  table?: string
  now: number
}
type Alert = { id: string; raw: string; event: string; eventName: string; severity: string; issued: number | null; expires: number | null; active: boolean; received?: number; cardText?: string; cardSvg?: string; areas?: unknown[] }
type AlertBrief = { id: string; eventName: string; severity: string; received: number; expires: number | null; active: boolean; areas: string[]; source: string; times: number }
type AlertsView = { ok: boolean; active: Alert[]; activeCount: number; history: AlertBrief[]; total: number; lastExit: Exit; nextTest: { at: number; day: string; say: string }; now: number }
type SameTest = { ok: boolean; say: string; header?: string; card?: string; cardSvg?: string; alert?: Alert | null }
type WebStatus = {
  running: boolean
  container: string
  health: string | null
  url: string | null
  urls: { local?: string; lan?: string; tailscale?: string }
  port: number
  rtl_tcp_pid: number | null
  /** OpenWebRX+'s map page (http://localhost:8073/map) while it runs. */
  map?: string | null
  /** The "Send to Radio tab" endpoint (webrx/handoff.py). */
  handoff?: { port: number; running: boolean; pid: number | null }
  /** Background decoding from its settings: decoders and the UTC schedule (time range -> profile name). */
  background?: { enabled: boolean; decoders: string[]; schedule: Record<string, string>; utc: boolean } | null
  ok?: boolean
  say?: string
  error?: string
}

// ---------------------------------------------------------------- hook point: extra sections

/** What a section added to the tab gets when it draws, answers /sdr or polls. */
export type SectionContext = {
  /** The surface's element table ($.ui.resolve(e)) while drawing; {} otherwise. */
  els: any
  /** 'terminal' | 'desktop' | 'vscode' | 'mobile' while drawing; '' otherwise. */
  surface: string
  /** The phone: stack things, no Input or Select. */
  narrow: boolean
  /** The pane body's width in cells. */
  columns: number
  now: number
  /** The tab was drawn in the last 15 s: poll for pictures only then. */
  watched: boolean
  /** radio.py status: `jobs[kind]` for every MODES entry (running, since, meta, lastExit). */
  status: Status | null
  /** What the tab is doing now ('' when idle). */
  busy: string
  /** The lane this context's processes run in: 'action' (a press, a command) or 'poll' (the tick). */
  lane: Lane
  /** scripts/radio.py <args> → its JSON, through the tab's V4 lane (one call at a time, a press first). */
  radio: (args: string[], timeoutMs?: number) => Promise<any>
  /** scripts/<script> <args> → its JSON, through the same lane. */
  python: (script: string, args: string[], timeoutMs?: number) => Promise<any>
  /** <the mod's folder>/<path> <args> (an executable, e.g. webrx/status.sh) → its JSON; webrx/status.sh runs beside the V4 lane. */
  run: (path: string, args: string[], timeoutMs?: number) => Promise<any>
  /** Notes what a start stopped, for the Resume buttons at the top. */
  stopped: (started: string, list: Stopped[] | undefined) => void
  /** The " (stopped X, …: the V4 does one thing at a time)" tail for a reply. */
  stoppedText: (list: Stopped[] | undefined) => string
  /**
   * Runs a press as an intent: at once when nothing runs, else queued (the newest press waiting
   * replaces an older one; the same press again joins it). opts.key names the request (default:
   * the label), opts.plan its first step and how long it takes. A job returning false failed.
   */
  act: (label: string, job: () => Promise<unknown>, opts?: ActOpts) => Promise<ActEnd>
  /** Plays a frequency on the tuner (the same press as a station button): tunes, then Listen with --quick. */
  listen: (mhz: number, mode?: string | null) => Promise<string>
  /** Sets the tab's note line. */
  setNote: (text: string) => void
  toast: (text: string) => void
  redraw: () => void
  /** Re-reads radio.py status now (after starting or stopping a job). */
  refresh: () => Promise<void>
  /** The pane being drawn: the Radio tab, or a section's own tab. */
  pane: string
  /** Opens (or shows) another tab of this mod. */
  open: (id: string, title: string) => void
}
export type Section = {
  id: string
  title: string
  hint?: string
  /** The heading's accent colour. */
  color?: string
  /** Drawn after the core sections, lowest first. */
  order?: number
  /** A tree built from ctx.els, or null for nothing. */
  render: (ctx: SectionContext) => unknown | Promise<unknown>
  /** Lines for the /sdr summary (the phone reads these). */
  text?: (ctx: SectionContext) => string | null
  /** /sdr <verb> <arg> goes to command(). */
  verbs?: string[]
  command?: (ctx: SectionContext, verb: string, arg: string) => Promise<string>
  /** Every second while the tab ticks; keep it cheap. */
  poll?: (ctx: SectionContext) => Promise<void>
}
/** Sections other modules add (see the top of this file). */
export const SECTIONS: Section[] = []

// ---------------------------------------------------------------- location

// Where the tab is. This is Walton, KY, the built-in default (a mirror of scripts/location.py's DEFAULT);
// when ~/Library/Application Support/radio/location.json is in use, `radio.py location` says so at
// session.start and applyLocation() swaps in its values (nothing changes without a file).
type Repeater = { mhz: number; name: string; short?: string; mark?: boolean; wx?: boolean }
type Loc = { name: string; short: string; wxStation: string; wxCity: string; wxFreq: number; riverName: string; repeaters: Repeater[]; error: string | null }
let LOC: Loc = {
  name: 'Walton, KY',
  short: 'Walton',
  wxStation: 'KIH42',
  wxCity: 'Covington',
  wxFreq: 162.55,
  riverName: 'Ohio River',
  repeaters: [
    { mhz: 146.88, name: 'Cincinnati SKYWARN repeater', short: 'SKYWARN', mark: true, wx: true },
    { mhz: 146.79, name: 'NKARC net repeater', short: 'NKARC' },
    { mhz: 147.03, name: 'K4CO Edgewood repeater', short: 'K4CO' },
    { mhz: 147.255, name: 'K4CO Edgewood repeater', short: 'K4CO' },
  ],
  error: null,
}
const wxFreqText = (): string => LOC.wxFreq.toFixed(3)
const noaaShort = (): string => (LOC.wxStation ? `NOAA ${LOC.wxStation}` : 'NOAA weather radio')
const noaaName = (): string => (LOC.wxStation ? ['NOAA', LOC.wxStation, LOC.wxCity].filter(Boolean).join(' ') : 'NOAA weather radio')
const repShort = (r: Repeater): string => r.short || r.name
const mhz3 = (m: number): string => m.toFixed(3)

// ---------------------------------------------------------------- bands

type Cat = 'broadcast' | 'air' | 'ham' | 'public' | 'weather' | 'iot'
const CAT_COLOR: Record<Cat, string> = { broadcast: CYAN, air: SKY, ham: GREEN, public: ORANGE, weather: TEAL, iot: MAGENTA }
type Band = { id: string; label: string; lo: number; hi: number; cat: Cat; help: string }
const BANDS: Band[] = [
  { id: 'fm', label: 'FM broadcast', lo: 87.5, hi: 108, cat: 'broadcast', help: '87.5–108 MHz, the Cincinnati FM stations. Each tall spike is a station; small bumps on its shoulders are its digital HD Radio sidebands.' },
  { id: 'air', label: 'Aircraft', lo: 118, hi: 137, cat: 'air', help: '118–137 MHz, pilots and controllers in AM voice (CVG is next door). Calls are short, so they show as dots in the waterfall and in the peak-hold line, not the average.' },
  { id: '2m', label: '2 m ham', lo: 144, hi: 148, cat: 'ham', help: '144–148 MHz, amateur radio. Repeaters (146.880 SKYWARN, 146.790 NKARC, 147.030 / 147.255 K4CO) light up only while someone talks; 146.520 is the calling frequency.' },
  { id: 'murs', label: 'MURS', lo: 151.8, hi: 154.62, cat: 'public', help: 'MURS, five licence-free channels (151.820, .880, .940, 154.570 blue dot, 154.600 green dot): farm and business radios, drive-through intercoms, wireless doorbells and driveway alarms.' },
  { id: 'marine', label: 'Marine VHF', lo: 156.0, hi: 157.45, cat: 'public', help: 'Marine VHF. The Ohio River is a few miles north: towboats call bridges and locks on ch 13 (156.650) and hail on ch 16 (156.800). Quiet unless a boat is talking.' },
  { id: 'rail', label: 'Railroad', lo: 160.2, hi: 161.6, cat: 'public', help: 'Railroad radio (AAR channels, 160.215–161.565 MHz): crews, dispatchers and the automatic defect detectors that read out axle counts as trains pass.' },
  { id: 'noaa', label: 'NOAA weather', lo: 162.35, hi: 162.6, cat: 'weather', help: '162.40–162.55 MHz, NOAA Weather Radio. KIH42 in Covington on 162.550 is the local one and talks around the clock; weaker spikes are transmitters farther away.' },
  { id: '70cm', label: '70 cm ham', lo: 420, hi: 450, cat: 'ham', help: '420–450 MHz, amateur radio and UHF repeaters; 446.000 is the calling frequency, and 433.92 gadgets sit inside this band too.' },
  { id: '433', label: '433 MHz ISM', lo: 433, hi: 435, cat: 'iot', help: '433–435 MHz: weather sensors, doorbells, remotes and car tire sensors send short bursts on 433.92. The gadget listener below decodes them.' },
  { id: 'gmrs', label: 'GMRS / FRS', lo: 462.5, hi: 467.75, cat: 'public', help: 'GMRS / FRS walkie-talkies: channels 1–7 at 462.5625–462.7125, 8–14 at 467.5625–467.7125, GMRS repeaters on 462.550–462.725. Busy on weekends and at events.' },
  { id: 'lora', label: 'Meshtastic / LoRa', lo: 902, hi: 928, cat: 'iot', help: '902–928 MHz: Meshtastic LongFast at 906.875 and MeshCore at 910.525 (dashed lines), plus smart meters and other 915 MHz gear. LoRa packets are short bursts, so look at the peak-hold line and the waterfall dots.' },
  { id: 'mesh', label: 'Mesh watch', lo: 905.8, hi: 911.6, cat: 'iot', help: '905.8–911.6 MHz, narrow enough for a row every second over both mesh channels: Meshtastic LongFast at 906.875 and MeshCore at 910.525. Live here feeds the mesh traffic meter below.' },
  { id: 'adsb', label: 'ADS-B 1090', lo: 1086, hi: 1094, cat: 'air', help: '1090 MHz: every airliner’s transponder (ADS-B and Mode S) answers here many times a second. The spectrum shows the burst energy; CVG traffic keeps it busy.' },
]
// The band buttons, grouped in rows (short names; the map and the spectrum use the long ones).
const BAND_SHORT: Record<string, string> = { fm: 'FM', noaa: 'NOAA', air: 'Aircraft', adsb: 'ADS-B', '2m': '2 m', '70cm': '70 cm', murs: 'MURS', marine: 'Marine', rail: 'Railroad', gmrs: 'GMRS/FRS', '433': '433 MHz', lora: 'LoRa 915', mesh: 'Mesh watch' }
const BAND_GROUPS: [string, string[]][] = [
  ['Broadcast', ['fm', 'noaa']],
  ['Air', ['air', 'adsb']],
  ['Ham', ['2m', '70cm']],
  ['Two-way', ['murs', 'marine', 'rail', 'gmrs']],
  ['Gadgets', ['433', 'lora', 'mesh']],
]
const ALIAS: Record<string, string> = {
  aircraft: 'air', airband: 'air', weather: 'noaa', wx: 'noaa', meshtastic: 'lora', '915': 'lora', meshcore: 'mesh', ism: '433', '70': '70cm', '2': '2m',
  broadcast: 'fm', boats: 'marine', river: 'marine', railroad: 'rail', trains: 'rail', frs: 'gmrs', '1090': 'adsb', 'ads-b': 'adsb',
}
const KNOWN_REST: [number, number, string][] = [
  [146.52, 0.004, '2 m calling (simplex)'],
  [446.0, 0.006, '70 cm calling (simplex)'],
  [121.5, 0.012, 'aircraft emergency (guard)'],
  [156.8, 0.006, 'Marine ch 16 (distress / calling)'],
  [156.65, 0.006, 'Marine ch 13 (towboats)'],
  [151.94, 0.004, 'MURS 3'],
  [154.57, 0.004, 'MURS 4 (blue dot)'],
  [154.6, 0.004, 'MURS 5 (green dot)'],
]
const KNOWN: [number, number, string][] = []
function buildKnown(): void {
  KNOWN.length = 0
  KNOWN.push([LOC.wxFreq, 0.006, noaaName()], ...LOC.repeaters.map(r => [r.mhz, 0.004, r.name] as [number, number, string]), ...KNOWN_REST)
}
buildKnown()
const FM_NAMES: Record<string, string> = { '89.1': 'WKCX', '90.9': 'WGUC', '91.7': 'WVXU', '92.5': 'WOFX', '94.1': 'WNNF', '97.3': 'WYGY', '98.5': 'WRRM', '101.1': 'WIZF', '101.9': 'WKRQ', '102.7': 'WEBN', '103.5': 'WGRR', '105.1': 'WUBE', '106.7': 'WNKR', '107.1': 'WKFS' }
const STEPS: [number, string][] = [
  [1000, '1 k'],
  [5000, '5 k'],
  [12_500, '12.5 k'],
  [25_000, '25 k'],
  [100_000, '100 k'],
  [1_000_000, '1 M'],
]
const GAINS = [0, 7.7, 12.5, 16.6, 20.7, 25.4, 29.7, 33.8, 37.2, 40.2, 43.4, 44.5, 48, 49.6]
// The tuner's station tabs: one row of categories, then that category's stations.
type StationTab = 'fav' | 'fm' | 'wx' | 'air' | 'ham' | 'water' | 'hf'
const STATION_TABS: [StationTab, string][] = [
  ['fav', 'Favourites'],
  ['fm', 'FM'],
  ['wx', 'Weather'],
  ['air', 'Air'],
  ['ham', 'Ham'],
  ['water', 'Marine/Rail'],
  ['hf', 'HF'],
]
const NOAA: Preset = { mhz: 162.55, label: '162.550 NOAA', mode: 'fm' }
const repPreset = (r: Repeater): Preset => ({ mhz: r.mhz, label: `${mhz3(r.mhz)} ${repShort(r)}`, mode: 'fm' })
const FIXED: Record<Exclude<StationTab, 'fav' | 'fm'>, Preset[]> = {
  wx: [NOAA, ...LOC.repeaters.filter(r => r.wx).map(r => repPreset(r))],
  air: [{ mhz: 121.5, label: '121.5 guard', mode: 'am' }],
  ham: [
    { mhz: 146.52, label: '146.520 calling', mode: 'fm' },
    ...LOC.repeaters.map(r => repPreset(r)),
    { mhz: 446.0, label: '446.000 calling', mode: 'fm' },
  ],
  water: [
    { mhz: 156.8, label: 'Marine ch 16', mode: 'fm' },
    { mhz: 156.65, label: 'Marine ch 13', mode: 'fm' },
    { mhz: 157.1, label: 'Marine ch 22A', mode: 'fm' },
  ],
  // HF (0.4.0), through the V4's built-in upconverter: public broadcasts and open ham bands. These
  // light up once HF is confirmed on air (Radio settings › Test HF); until then they are dimmed and
  // the hint says what HF needs (a 10-20 m long wire through a 9:1 balun).
  hf: [
    { mhz: 10.0, label: 'WWV 10 MHz', mode: 'am' },
    { mhz: 5.0, label: 'WWV 5 MHz', mode: 'am' },
    { mhz: 15.0, label: 'WWV 15 MHz', mode: 'am' },
    { mhz: 2.5, label: 'WWV 2.5 MHz', mode: 'am' },
    { mhz: 7.85, label: 'CHU 7.85 MHz', mode: 'am' },
    { mhz: 6.0, label: '49 m shortwave', mode: 'am' },
    { mhz: 7.4, label: '41 m shortwave', mode: 'am' },
    { mhz: 9.7, label: '31 m shortwave', mode: 'am' },
    { mhz: 11.8, label: '25 m shortwave', mode: 'am' },
    { mhz: 15.3, label: '19 m shortwave', mode: 'am' },
    { mhz: 3.8, label: '80 m ham LSB', mode: 'lsb' },
    { mhz: 7.2, label: '40 m ham LSB', mode: 'lsb' },
    { mhz: 14.2, label: '20 m ham USB', mode: 'usb' },
    { mhz: 8.502, label: 'NMG weather fax', mode: 'usb' },
    { mhz: 0.518, label: 'NAVTEX 518 kHz', mode: 'usb' },
    { mhz: 4.625, label: 'UVB-76 4625 kHz', mode: 'usb' },
  ],
}
const FM_SHOWN = 8
const COMMANDS_LINE = '/sdr scan <band> · scan list|on|off|add <MHz> (the Scanner) · live on|off [band] · tune <MHz> · listen <MHz> [wbfm|fm|am|usb|lsb|cw] · stop (everything) · rec on|off · log on|off · record <MHz> [mode] <sec> · recordings · snapshot <MHz> [secs] · snapshots · settings · set ppm <N> · biast on|off · hf test · calibrate · bands · mesh · gadgets [on|off] · share on|off · planes [on|off] · radar · aprs [on|off] · alerts [on|off|test] · web [on|off|sync]'
const ARG_HINT = '[scan <band> | scan list|on|off|add <MHz> | live on|off | tune <MHz> | listen <MHz> [mode] | stop | rec on|off | log on|off | record <MHz> [mode] <sec> | recordings | snapshot <MHz> [secs] | snapshots | settings | set ppm <N> | biast on|off | hf test | calibrate | gadgets on|off | share on|off | planes [on|off] | radar | aprs [on|off] | alerts [on|off|test] | web [on|off|sync]]'
// The rows of the tuner and the band buttons line up on this label width (cells).
const ROW_LABEL = 10
const PLANE_RANGES = ['10', '25', '50', 'auto']
const TAILSCALE_SERVE = 'tailscale serve --bg --https=8073 http://127.0.0.1:8073'

// ---------------------------------------------------------------- module state

let st: Status | null = null
let scan: View | null = null
let liveFrame: View | null = null
let gadgets: Gadgets | null = null
let meter: Meter | null = null
let tuner: Tuner = { hz: 162_550_000, mode: 'fm', step: 25_000, squelch: 0, gain: 40.2 }
let busy = ''
let note = ''
let liveNote = ''
let lastPreset = 'fm'
let gadgetsWanted = false
let toastedUpTo = 0
let weakSaid = 0
let fmStations: Station[] = []
let restore: Stopped[] = []
let loaded = false
let lastStatus = 0
let lastList = 0
let lastFrame = 0
let lastMeter = 0
let lastRender = 0
// The clock's last reading (a press's context needs a time before any await).
let lastNow = 0
// When radio.py status was last read (Date.now()): a fresh read settles a late second press.
let stReadAt = 0
let wasPresent: boolean | null = null
let retuneTimer: { cancel: () => void } | null = null
let autoStarting = false
// A tick is under way (its polls queued behind a press): the next one waits its turn.
let ticking = false
// The tuner's station tabs and the stations he has listened to (newest first).
let stationTab: StationTab = 'fav'
let fmMore = false
let recentStations: Preset[] = []
let meterHelp = false
let startHereClosed = false
// The sections: what each last read, when, and whether a fresh read is wanted.
let planes: PlanesView | null = null
let planesAt = 0
let planesRange = 'auto'
let planesStale = true
let aprs: AprsView | null = null
let aprsAt = 0
let aprsStale = true
let alerts: AlertsView | null = null
let alertsAt = 0
let alertsStale = true
let alertsToasted: string[] = []
let sameTest: SameTest | null = null
let web: WebStatus | null = null
let webAt = 0
let webStale = true
let webBookmarks = ''
// Web SDR's "Send to Radio tab" (webrx/handoff.py writes handoff.json): read while Web SDR runs.
let handoffAt = 0
let handoffRead = 0
let storeDirty = false
// The EQ display: the last spectrum read, when, and the surface the tab was last drawn on.
let eq: Eq | null = null
let eqAt = 0
let eqReading = false
let paneSurface = ''
// Recordings: what radio.py recordings last said, and the list's "more".
let recs: RecView | null = null
let recsAt = 0
let recsStale = true
let recsMore = false
// 0.4.0: the Scanner, Radio settings and IQ snapshots (each read on its own poll; see their sections)
let scanner: ScannerView | null = null
let scannerAt = 0
let scannerStale = true
let settingsView: SettingsView | null = null
let settingsAt = 0
let settingsStale = true
let snaps: SnapView | null = null
let snapsAt = 0
let snapsStale = true
let snapWf: SnapWf | null = null
let snapDecoded: SnapDecode | null = null
// The peak list: its order (remembered), all or the strongest, and its help.
let peakSort: 'freq' | 'strength' = 'freq'
let peaksAll = false
let spectrumHelp = false
// The tuning strip: bumped on every tuner change (a strip's own pending tune is stale once it
// moves), and the width it was last drawn at, for the props a 'ui.message' answer carries.
let stripRev = 0
let stripCols = 96
// The heavy pictures, drawn again only when what they show changed (the EQ redraws the tab often):
// one cached string per picture (slot), kept until that picture's inputs change.
const svgCache = new Map<string, { key: string; svg: string }>()

// ---------------------------------------------------------------- helpers

function bandOf(id: string): Band | undefined {
  return BANDS.find(b => b.id === id)
}

function mhz(f: number): string {
  return String(Number(f.toFixed(4)))
}

function modeName(m?: string | null): string {
  return m === 'wbfm' ? 'wide FM' : m === 'fm' ? 'narrow FM' : m === 'am' ? 'AM' : m === 'usb' ? 'upper sideband' : m === 'lsb' ? 'lower sideband' : m === 'cw' ? 'CW (Morse)' : m ?? ''
}

function modeChip(m: Mode): string {
  return m === 'wbfm' ? 'WFM' : m === 'fm' ? 'NFM' : m === 'usb' ? 'USB' : m === 'lsb' ? 'LSB' : m === 'cw' ? 'CW' : 'AM'
}

function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

// The picture in `slot` (the LCD, the EQ, the band map, a sparkline per device..., each per width
// so the desktop and the phone keep their own), drawn again only when its key (everything it
// shows) changed. A slot holds one string, so a picture that changes every EQ frame never pushes
// the others out.
function memoSvg(slot: string, key: string, draw: () => string): string {
  const hit = svgCache.get(slot)
  if (hit && hit.key === key) return hit.svg
  const svg = draw()
  if (!hit && svgCache.size > 80) svgCache.clear()
  svgCache.set(slot, { key, svg })
  return svg
}

// 0:42, 12:05, 1:02:10
function dur(sec: number | null | undefined): string {
  const t = Math.max(0, Math.round(sec ?? 0))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const ss = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function sizeOf(b: number | null | undefined): string {
  const v = b ?? 0
  return v >= 1e9 ? `${(v / 1e9).toFixed(2)} GB` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(v / 1e3))} KB`
}

function clockOf(t: number): string {
  const d = new Date(t)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

// The height an SVG takes at the width the pane gives it (its own width, at most maxW). Given as
// the Svg's height, the box keeps its size while a refreshed picture loads, so the pane never
// shrinks for a moment and the scroll position stays where the person put it.
function svgHeight(source: string, maxW: number): number | undefined {
  const head = source.slice(0, 800)
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(head)
  const wa = /<svg[^>]*\swidth="([\d.]+)"/.exec(head)
  const w = vb ? Number(vb[1]) : NaN
  const h = vb ? Number(vb[2]) : NaN
  if (!(w > 0 && h > 0)) return undefined
  const drawn = Math.min(wa ? Number(wa[1]) : w, maxW)
  return Math.round((drawn * h) / w)
}

function clamp(v: number, a = 0, b = 1): number {
  return v < a ? a : v > b ? b : v
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function n1(v: number): string {
  return v.toFixed(1)
}

type TxtOpts = { fill?: string; size?: number; anchor?: string; weight?: number; rotate?: boolean; font?: string; opacity?: number; spacing?: number; cls?: string }
function txt(x: number, y: number, s: string, o: TxtOpts = {}): string {
  const at = o.rotate ? ` transform="translate(${n1(x)},${n1(y)}) rotate(-90)" x="0" y="0"` : ` x="${n1(x)}" y="${n1(y)}"`
  return `<text${at}${o.cls ? ` class="${o.cls}"` : ''} fill="${o.fill ?? AXIS}" font-size="${o.size ?? 10}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ''}${o.spacing ? ` letter-spacing="${o.spacing}"` : ''} font-family="${o.font ?? MONO}">${esc(s)}</text>`
}

function niceStep(span: number, target = 8): number {
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag
  return 10 * mag
}

function svgDoc(W: number, H: number, body: string, xlink = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg"${xlink ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ''} width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`
}

function guessMode(f: number): Mode | null {
  if (f < HF_MAX) {
    // HF: shortwave broadcasting is AM; the ham bands are SSB (LSB below 10 MHz, USB above).
    if ((f >= 3.5 && f <= 4.0) || (f >= 7.0 && f <= 7.3)) return 'lsb'
    if ((f >= 14.0 && f <= 14.35) || (f >= 18.068 && f <= 18.168) || (f >= 21.0 && f <= 21.45) || (f >= 24.89 && f <= 24.99) || f >= 28.0) return 'usb'
    return 'am'
  }
  if (f >= 87.5 && f <= 108) return 'wbfm'
  if (f >= 108 && f <= 137) return 'am'
  if ((f >= 902 && f <= 928) || (f >= 433 && f <= 435) || (f >= 1085 && f <= 1095)) return null
  return 'fm'
}

function defaultSquelch(f: number, mode: Mode): number {
  return mode !== 'fm' || (f >= 162.39 && f <= 162.56) ? 0 : 40
}

function defaultStep(mode: Mode): number {
  // SSB and CW tune in 1 kHz steps (a voice is a few kHz wide; CW a few hundred Hz).
  return mode === 'wbfm' ? 100_000 : mode === 'am' ? 25_000 : mode === 'usb' || mode === 'lsb' || mode === 'cw' ? 1_000 : 12_500
}

function fmChannel(f: number): number {
  return Math.round((Math.round((f - 87.9) / 0.2) * 0.2 + 87.9) * 10) / 10
}

// A name for a frequency: the shown scan's peak, an FM station, or a known spot.
function nameAt(f: number): string | null {
  if (f >= 87.5 && f <= 108) {
    const ch = fmChannel(f)
    if (Math.abs(ch - f) < 0.07) {
      const s = fmStations.find(x => Math.abs(x.mhz - ch) < 0.05)
      if (s) return s.name
      const call = FM_NAMES[ch.toFixed(1)]
      return call ? `${ch.toFixed(1)} ${call}` : null
    }
  }
  for (const [k, tol, name] of KNOWN) if (Math.abs(f - k) <= tol) return name
  if (f >= 162.39 && f <= 162.56) return 'NOAA weather radio'
  const v = shownView()
  const p = v?.peaks.find(q => Math.abs(q.mhz - f) < Math.max(0.003, v.binHz / 1e6) && q.name && !q.comb && !q.spur)
  return p?.name ?? null
}

function bandAt(f: number): Band | undefined {
  return BANDS.filter(b => b.id !== 'mesh').find(b => f >= b.lo && f <= b.hi)
}

function anyJobRunning(s: Status): boolean {
  if (s.listen.running || s.share.running || s.live?.running) return true
  return Object.entries(s.jobs ?? {}).some(([k, j]) => k !== 'gadgets' && j.running)
}

function shownView(): View | null {
  if (st?.live?.running && liveFrame) return liveFrame
  if (liveFrame && scan) return liveFrame.at > scan.at ? liveFrame : scan
  return liveFrame ?? scan
}

function poolTo(vals: number[], n: number): number[] {
  if (vals.length <= n) return vals
  const out: number[] = []
  const g = vals.length / n
  for (let i = 0; i < n; i++) {
    let m = -Infinity
    for (let j = Math.floor(i * g); j < Math.min(vals.length, Math.floor((i + 1) * g)); j++) m = Math.max(m, vals[j] ?? -Infinity)
    out.push(m)
  }
  return out
}

// ---------------------------------------------------------------- colour

// Turbo (polynomial fit) with its bottom faded to near-black: radio.py's waterfall PNG
// uses the same ramp, so the legend and the terminal's cells match the picture.
function turbo(t: number): [number, number, number] {
  t = clamp(t)
  const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))))
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))))
  const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))))
  return [clamp(r), clamp(g), clamp(b)]
}

function wfRgb(t: number): [number, number, number] {
  t = clamp(t)
  const base: [number, number, number] = [0.031, 0.043, 0.094]
  let c: [number, number, number]
  if (t < 0.25) {
    const u = (t / 0.25) ** 2.2
    const top = turbo(0.08)
    c = [base[0] + (top[0] - base[0]) * u, base[1] + (top[1] - base[1]) * u, base[2] + (top[2] - base[2]) * u]
  } else c = turbo(0.08 + ((t - 0.25) / 0.75) * 0.9)
  return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]
}

const PAL: number[] = Array.from({ length: 256 }, (_, i) => {
  const [r, g, b] = wfRgb(i / 255)
  return (r << 16) | (g << 8) | b
})

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

function rampStops(n = 12): string {
  return Array.from({ length: n + 1 }, (_, i) => `<stop offset="${(i / n).toFixed(3)}" stop-color="${hex(PAL[Math.round((i / n) * 255)] ?? 0)}"/>`).join('')
}

function heat(best: number): string {
  return best >= 30 ? '#ff6b4a' : best >= 20 ? '#ffb347' : best >= 12 ? YELLOW : best >= 6 ? CYAN : '#4b7bb2'
}

// ---------------------------------------------------------------- base64 (the module has no atob)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]))

function b64encode(bytes: Uint8Array): string {
  const out: string[] = []
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out.push(B64[(n >> 18) & 63]!, B64[(n >> 12) & 63]!, B64[(n >> 6) & 63]!, B64[n & 63]!)
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16
    out.push(B64[(n >> 18) & 63]!, B64[(n >> 12) & 63]!, '==')
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)
    out.push(B64[(n >> 18) & 63]!, B64[(n >> 12) & 63]!, B64[(n >> 6) & 63]!, '=')
  }
  return out.join('')
}

function b64decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_INDEX[clean[i] ?? 'A'] ?? 0
    const b = B64_INDEX[clean[i + 1] ?? 'A'] ?? 0
    const c = B64_INDEX[clean[i + 2] ?? 'A'] ?? 0
    const d = B64_INDEX[clean[i + 3] ?? 'A'] ?? 0
    const n = (a << 18) | (b << 12) | (c << 6) | d
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (i + 2 < clean.length && o < out.length) out[o++] = (n >> 8) & 255
    if (i + 3 < clean.length && o < out.length) out[o++] = n & 255
  }
  return out
}

// ---------------------------------------------------------------- the spectrum + waterfall

type PanOpts = { W: number; compact: boolean; tunedMhz: number | null; playing: boolean }

function panadapterSvg(v: View, o: PanOpts, thin = 1): string {
  const W = o.W
  const c = o.compact
  const fs = c ? 11 : 10
  const L = c ? 36 : 46
  const R = 12
  const live = !!v.live
  const running = live && v.running !== false
  const HEAD = 30
  const LAB = c ? 22 : 72
  const ST = HEAD + LAB + 4
  const SH = c ? 150 : 176
  const AXH = 22
  const WT = ST + SH + AXH
  const nrows = v.nrows ?? v.rows?.length ?? 10
  const maxRows = live ? (v.maxRows ?? 60) : Math.max(1, nrows)
  const WH = live ? (c ? 150 : 186) : Math.min(170, Math.max(96, nrows * 14))
  const FOOT = c ? 46 : 30
  const H = WT + WH + FOOT
  const pw = W - L - R
  const x = (f: number) => L + ((f - v.start) / (v.stop - v.start)) * pw
  const top = Math.max(v.top, v.floor + 20)
  const lo = Math.floor((v.floor - 8) / 5) * 5
  const hi = Math.ceil((top + 4) / 5) * 5
  const y = (db: number) => ST + (1 - (clamp(db, lo, hi) - lo) / (hi - lo)) * SH
  const parts: string[] = []
  parts.push(
    `<defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${CYAN}" stop-opacity="0.42"/><stop offset="1" stop-color="${CYAN}" stop-opacity="0.03"/></linearGradient>` +
      `<linearGradient id="ramp" x1="0" x2="1" y1="0" y2="0">${rampStops()}</linearGradient>` +
      `<clipPath id="plot"><rect x="${L}" y="${ST}" width="${pw}" height="${SH}"/></clipPath></defs>`,
  )
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="${BG}"/>`)
  // Header: LIVE badge (or SCAN), band, details.
  const badge = running ? 'LIVE' : live ? 'PAUSED' : 'SCAN'
  const bcol = running ? RED : live ? AXIS : CYAN
  parts.push(`<rect x="12" y="8" width="${badge.length * 7.4 + 22}" height="17" rx="8.5" fill="${bcol}" fill-opacity="0.16" stroke="${bcol}" stroke-opacity="0.7"/>`)
  parts.push(`<circle cx="22" cy="16.5" r="3.6" fill="${bcol}"/>`)
  parts.push(txt(30, 20.5, badge, { fill: bcol, size: 10.5, weight: 700, spacing: 1 }))
  const hx = 12 + badge.length * 7.4 + 32
  parts.push(txt(hx, 21, `${v.label}`, { fill: BRIGHT, size: fs + 2.5, weight: 600, font: SANS }))
  const detail = live
    ? `${mhz(v.start)}–${mhz(v.stop)} MHz · ${nrows} row${nrows === 1 ? '' : 's'} · ${Math.max(0.5, v.rowSec ?? 1).toFixed(1)} s/row`
    : `${mhz(v.start)}–${mhz(v.stop)} MHz · ${v.seconds ?? nrows} s · ${clockOf(v.at)}`
  if (!c) parts.push(txt(W - 14, 21, detail, { anchor: 'end', size: 10, fill: AXIS }))
  // Spectrum plot.
  parts.push(`<rect x="${L}" y="${ST}" width="${pw}" height="${SH}" fill="${PLOT}"/>`)
  const dstep = hi - lo > 40 ? 10 : 5
  for (let d = lo; d <= hi; d += dstep) {
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${n1(y(d))}" y2="${n1(y(d))}" stroke="${GRID}" stroke-width="1"/>`)
    parts.push(txt(L - 5, y(d) + 3.5, String(d), { anchor: 'end', size: fs - 0.5 }))
  }
  parts.push(txt(L - 5, ST + SH + 15, 'dB', { anchor: 'end', size: fs - 1 }))
  const span = v.stop - v.start
  const step = niceStep(span, c ? 5 : 8)
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  const first = Math.ceil(v.start / step - 1e-9) * step
  for (let f = first; f <= v.stop + 1e-9; f += step) {
    const px = x(f)
    parts.push(`<line x1="${n1(px)}" x2="${n1(px)}" y1="${ST}" y2="${ST + SH}" stroke="${GRID2}" stroke-width="1"/>`)
    const last = f + step > v.stop + 1e-9
    parts.push(txt(px, ST + SH + 15, `${f.toFixed(dec)}${last && !c ? ' MHz' : ''}`, { anchor: last ? 'end' : px < L + 20 ? 'start' : 'middle', size: fs - 0.5 }))
  }
  for (const m of v.marks) {
    if (m.mhz < v.start || m.mhz > v.stop) continue
    const px = n1(x(m.mhz))
    parts.push(`<line x1="${px}" x2="${px}" y1="${ST}" y2="${ST + SH}" stroke="${MARK}" stroke-width="1" stroke-dasharray="3 3"/>`)
    parts.push(txt(x(m.mhz) + 3, ST + SH - 5, m.label, { fill: MARK, size: fs - 1 }))
  }
  const n = Math.min(v.freqs.length, Math.round(pw / ((c ? 1.6 : 1.15) * thin)))
  const fq = poolTo(v.freqs, n).map((_, i, a) => v.freqs[Math.min(v.freqs.length - 1, Math.round(((i + 0.5) / a.length) * v.freqs.length - 0.5))] ?? v.start)
  const path = (vals: number[]) => {
    const pv = poolTo(vals, n)
    return pv.map((val, i) => `${i ? 'L' : 'M'}${n1(x(fq[i] ?? v.start))},${n1(y(val))}`).join('')
  }
  const avgPath = path(v.avg)
  const f0 = fq[0] ?? v.start
  const f1 = fq[fq.length - 1] ?? v.stop
  parts.push(`<g clip-path="url(#plot)">`)
  parts.push(`<path d="${avgPath}L${n1(x(f1))},${ST + SH}L${n1(x(f0))},${ST + SH}Z" fill="url(#fill)"/>`)
  if (v.hold && live) parts.push(`<path d="${path(v.hold)}" fill="none" stroke="${MAGENTA}" stroke-width="1" stroke-opacity="0.75" stroke-dasharray="2 2"/>`)
  parts.push(`<path d="${path(v.max)}" fill="none" stroke="${AMBER}" stroke-width="1" stroke-opacity="0.7"/>`)
  if (v.cur && live) parts.push(`<path d="${path(v.cur)}" fill="none" stroke="${BRIGHT}" stroke-width="0.7" stroke-opacity="0.45"/>`)
  parts.push(`<path d="${avgPath}" fill="none" stroke="${CYAN}" stroke-width="1.5"/>`)
  parts.push(`</g>`)
  parts.push(`<line x1="${L}" x2="${W - R}" y1="${n1(y(v.floor))}" y2="${n1(y(v.floor))}" stroke="#9aa9b0" stroke-width="1" stroke-dasharray="5 4" stroke-opacity="0.6"/>`)
  parts.push(`<rect x="${W - R - 118}" y="${n1(y(v.floor) + 3)}" width="114" height="13" rx="2" fill="${PLOT}" fill-opacity="0.9"/>`)
  parts.push(txt(W - R - 6, y(v.floor) + 13, `noise floor ${v.floor.toFixed(0)} dB`, { anchor: 'end', size: fs - 1 }))
  // Peaks: a dot each; desktop names them upward in the lane above, the phone in a row inside.
  // Every named peak gets a name; of the rest, only the strongest few (a bursty band would be all numbers).
  const placed: number[] = []
  const order = [...v.peaks].sort((a, b) => b.above - a.above)
  const pdec = v.binHz >= 20_000 ? 2 : v.binHz >= 2000 ? 3 : 4
  let shown = 0
  let unnamed = 0
  const maxChars = Math.floor((LAB - 6) / 5.75)
  for (const p of order) {
    const px = x(p.mhz)
    const py = y(p.db)
    const burst = p.kind === 'burst'
    parts.push(burst ? `<path d="M${n1(px)},${n1(py - 3)} l-3.5,-6 h7 z" fill="${AMBER}"/>` : `<circle cx="${n1(px)}" cy="${n1(py)}" r="2.8" fill="${YELLOW}" stroke="${PLOT}" stroke-width="0.8"/>`)
    let label = shortLabel(p, pdec)
    if (!label) continue
    const generic = !p.name || /^915 MHz device|^433 MHz gadget|^aircraft or ground/.test(p.name)
    if (generic) {
      if (unnamed >= (c ? 2 : 7)) continue
      label = Number(p.mhz.toFixed(pdec)).toString()
    }
    if (c) {
      if (shown >= 5 || placed.some(q => Math.abs(q - px) < 64)) continue
      placed.push(px)
      shown++
      if (generic) unnamed++
      const short = label.length > 10 ? label.slice(0, 10) : label
      const lx = clamp(px, L + short.length * 3.2 + 2, W - R - short.length * 3.2 - 2)
      parts.push(`<line x1="${n1(px)}" x2="${n1(px)}" y1="${ST - 6}" y2="${n1(py - (burst ? 10 : 5))}" stroke="${burst ? AMBER : YELLOW}" stroke-width="0.8" stroke-opacity="0.35" stroke-dasharray="1 2"/>`)
      parts.push(txt(lx, ST - 8, short, { anchor: 'middle', size: 10, fill: generic ? AMBER : BRIGHT }))
      continue
    }
    if (placed.some(q => Math.abs(q - px) < 12)) continue
    placed.push(px)
    if (generic) unnamed++
    parts.push(`<line x1="${n1(px)}" x2="${n1(px)}" y1="${ST - 2}" y2="${n1(py - (burst ? 10 : 5))}" stroke="${burst ? AMBER : YELLOW}" stroke-width="0.8" stroke-opacity="0.35" stroke-dasharray="1 2"/>`)
    parts.push(txt(px + 3.5, ST - 5, label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label, { rotate: true, size: 9.5, fill: generic ? (burst ? AMBER : LABEL) : BRIGHT }))
  }
  // The tuner's frequency, through both panels.
  if (o.tunedMhz !== null && o.tunedMhz >= v.start && o.tunedMhz <= v.stop) {
    const tx = n1(x(o.tunedMhz))
    parts.push(`<line x1="${tx}" x2="${tx}" y1="${ST}" y2="${WT + WH}" stroke="${RED}" stroke-width="1.3" stroke-opacity="0.9"/>`)
    parts.push(`<path d="M${tx},${ST + 1} l-5,-7 h10 z" fill="${RED}"/>`)
    const t = `${o.playing ? '▶ ' : ''}${mhz(o.tunedMhz)}`
    const right = x(o.tunedMhz) > W - 90
    // At the top of the plot, unless the line legend sits there.
    const ty = x(o.tunedMhz) < L + 230 ? ST + SH - 34 : ST + 5
    parts.push(`<rect x="${n1(right ? x(o.tunedMhz) - 8 - t.length * 6.3 : x(o.tunedMhz) + 5)}" y="${ty}" width="${n1(t.length * 6.3 + 6)}" height="14" rx="3" fill="${RED}" fill-opacity="0.85"/>`)
    parts.push(txt(right ? x(o.tunedMhz) - 5 : x(o.tunedMhz) + 8, ty + 10.5, t, { fill: '#10161a', size: 10, weight: 700, anchor: right ? 'end' : 'start' }))
  }
  // Legend for the lines.
  const lx = c ? L : L + 8
  const ly = c ? WT + WH + 17 : ST + 12
  const leg: [string, string, string][] = [
    [CYAN, 'average', ''],
    [AMBER, live ? 'peak 60 s' : 'peak hold', ''],
  ]
  if (live && v.hold) leg.push([MAGENTA, 'max hold', '2 2'])
  if (live && v.cur) leg.push([BRIGHT, 'now', ''])
  let ox = lx
  if (!c) parts.push(`<rect x="${lx - 5}" y="${ly - 8}" width="${leg.reduce((a, [, s]) => a + s.length * 6 + 26, 0) + 4}" height="14" rx="3" fill="${PLOT}" fill-opacity="0.85"/>`)
  for (const [col, s, dash] of leg) {
    parts.push(`<line x1="${ox}" x2="${ox + 14}" y1="${ly - 1}" y2="${ly - 1}" stroke="${col}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`)
    parts.push(txt(ox + 18, ly + 2.5, s, { fill: LABEL, size: 9 }))
    ox += s.length * 6 + 26
  }
  // Waterfall.
  const half = v.freqs.length > 1 ? ((v.freqs[1] ?? 0) - (v.freqs[0] ?? 0)) / 2 : 0
  const x0 = Math.max(L, x((v.freqs[0] ?? v.start) - half))
  const x1 = Math.min(W - R, x((v.freqs[v.freqs.length - 1] ?? v.stop) + half))
  const ih = live ? (Math.min(nrows, maxRows) / maxRows) * WH : WH
  parts.push(`<rect x="${L}" y="${WT}" width="${pw}" height="${WH}" fill="${hex(PAL[0] ?? 0)}"/>`)
  if (v.png) {
    parts.push(
      `<image x="${n1(x0)}" y="${WT}" width="${n1(x1 - x0)}" height="${n1(ih)}" preserveAspectRatio="none" style="image-rendering:pixelated" href="data:image/png;base64,${v.png}"/>`,
    )
  }
  for (const m of v.marks) {
    if (m.mhz < v.start || m.mhz > v.stop) continue
    const px = n1(x(m.mhz))
    parts.push(`<line x1="${px}" x2="${px}" y1="${WT}" y2="${WT + WH}" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1" stroke-dasharray="3 3"/>`)
  }
  parts.push(`<rect x="${L}" y="${WT}" width="${pw}" height="${WH}" fill="none" stroke="${GRID}"/>`)
  if (live) {
    const secs = Math.round(Math.max(0.5, v.rowSec ?? 1) * maxRows)
    parts.push(txt(L - 5, WT + 9, 'now', { anchor: 'end', size: fs - 1, fill: LABEL }))
    parts.push(txt(L - 5, WT + WH / 2 + 3, `−${Math.round(secs / 2)}s`, { anchor: 'end', size: fs - 1.5 }))
    parts.push(txt(L - 5, WT + WH - 2, `−${secs}s`, { anchor: 'end', size: fs - 1.5 }))
  } else {
    parts.push(txt(L - 5, WT + 9, '0 s', { anchor: 'end', size: fs - 1 }))
    parts.push(txt(L - 5, WT + WH - 2, `${v.seconds ?? nrows} s`, { anchor: 'end', size: fs - 1 }))
  }
  // Footer: what the colours mean, and which way time runs.
  const [s0, s1] = v.scale ?? [v.floor - 4, top + 1]
  const fy = c ? WT + WH + 38 : WT + WH + 19
  const gw = c ? 150 : 170
  parts.push(txt(c ? L : L, fy, live ? (c ? 'newest on top ↓' : 'newest row on top, scrolling down ↓') : c ? 'time runs down ↓' : 'one row a second, time runs down ↓', { size: fs - 1 }))
  parts.push(txt(W - R - gw - 8, fy, `${Math.round(s0)} dB`, { anchor: 'end', size: fs - 1 }))
  parts.push(`<rect x="${W - R - gw}" y="${fy - 8}" width="${gw - 46}" height="9" rx="2" fill="url(#ramp)"/>`)
  parts.push(txt(W - R, fy, `${Math.round(s1)} dB`, { anchor: 'end', size: fs - 1 }))
  const doc = svgDoc(W, H, parts.join(''))
  // The drawing's budget is 131072 characters: thin the lines before the picture goes.
  return doc.length > 126_000 && thin < 4 ? panadapterSvg(v, o, thin * 2) : doc
}

// The chart's short label for a peak: "94.1 WNNF", "162.55 KIH42" (for Walton), or the frequency.
function shortLabel(p: Peak, dec = 4): string {
  const nm = p.name ?? ''
  if (p.comb || p.spur) return ''
  const fm = nm.match(/^(\d+\.\d) ([WK][A-Z]{2,3})/)
  if (fm) return `${fm[1]} ${fm[2]}`
  if (/^\d+\.\d FM$/.test(nm)) return nm.replace(' FM', '')
  const reEsc = (t: string): RegExp => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const shorts = [...new Set(LOC.repeaters.map(repShort))]
  const known: [RegExp, string][] = [
    ...(LOC.wxStation ? ([[reEsc(LOC.wxStation), LOC.wxStation]] as [RegExp, string][]) : []),
    ...shorts.map(sh => [reEsc(sh), sh] as [RegExp, string]),
    [/calling/, 'calling'],
    [/guard/, 'guard'],
    [/Meshtastic/, 'Meshtastic'],
    [/MeshCore/, 'MeshCore'],
    [/^NOAA weather/, 'NOAA'],
    [/^Marine ch (\w+)/, 'ch'],
    [/^MURS (\d)/, 'MURS'],
    [/^FRS \/ GMRS ch (\d+)/, 'FRS'],
    [/^railroad/, 'rail'],
    [/^ADS-B/, 'ADS-B'],
  ]
  for (const [re, s] of known) {
    const m = nm.match(re)
    if (m) return `${Number(p.mhz.toFixed(dec))} ${s}${m[1] ? ` ${m[1]}` : ''}`
  }
  return String(Number(p.mhz.toFixed(dec)))
}

function peakName(p: Peak): string {
  if (p.name) return p.name
  return p.kind === 'burst' ? 'short bursts' : 'steady signal'
}

function viewAlt(v: View): string {
  const named = [...new Set(v.peaks.filter(p => p.name && !p.comb && !p.spur).map(p => p.name as string))].slice(0, 8)
  const head = v.live ? `${v.running === false ? 'Last live view' : 'Live'} spectrum and waterfall` : 'Spectrum and waterfall'
  return `${head} of ${v.label} ${mhz(v.start)}–${mhz(v.stop)} MHz: ${v.peaks.length} signals above the ${v.floor.toFixed(0)} dB noise floor${named.length ? `, including ${named.join(', ')}` : ''}; ${v.nrows ?? v.rows?.length ?? 0} waterfall rows`
}

// ---------------------------------------------------------------- the tuner's LCD

const SEG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' }

function segPolys(x: number, y: number, w: number, h: number, t: number): Record<string, string> {
  const g = t * 0.2
  const P = (pts: number[][]) => pts.map(([a, b]) => `${n1(a ?? 0)},${n1(b ?? 0)}`).join(' ')
  const hs = (yy: number, x0: number, x1: number) =>
    P([
      [x0 + t / 2 + g, yy],
      [x0 + t + g, yy - t / 2],
      [x1 - t - g, yy - t / 2],
      [x1 - t / 2 - g, yy],
      [x1 - t - g, yy + t / 2],
      [x0 + t + g, yy + t / 2],
    ])
  const vs = (xx: number, y0: number, y1: number) =>
    P([
      [xx, y0 + t / 2 + g],
      [xx + t / 2, y0 + t + g],
      [xx + t / 2, y1 - t - g],
      [xx, y1 - t / 2 - g],
      [xx - t / 2, y1 - t - g],
      [xx - t / 2, y0 + t + g],
    ])
  return {
    a: hs(y + t / 2, x, x + w),
    g: hs(y + h / 2, x, x + w),
    d: hs(y + h - t / 2, x, x + w),
    f: vs(x + t / 2, y, y + h / 2),
    b: vs(x + w - t / 2, y, y + h / 2),
    e: vs(x + t / 2, y + h / 2, y + h),
    c: vs(x + w - t / 2, y + h / 2, y + h),
  }
}

// One 7-segment digit: every segment as a faint ghost (as a real LCD shows), the lit ones bright.
function digit(ch: string, x: number, y: number, w: number, h: number, lit: string[], ghost: string[]): void {
  const t = Math.max(3, w * 0.19)
  const segs = segPolys(x, y, w, h, t)
  const on = SEG[ch] ?? ''
  for (const [k, pts] of Object.entries(segs)) {
    ghost.push(`<polygon points="${pts}"/>`)
    if (on.includes(k)) lit.push(`<polygon points="${pts}"/>`)
  }
}

type LcdOpts = { W: number; compact: boolean; playing: boolean; retuning: boolean; meter: Meter | null; scanLevel: { above: number; label: string } | null; name: string | null; band: string | null; since: number | null; now: number; rec?: boolean; log?: boolean }

function lcdSvg(t: Tuner, o: LcdOpts): string {
  const W = o.W
  const c = o.compact
  const H = c ? 214 : 182
  const parts: string[] = []
  parts.push(
    `<defs><linearGradient id="glass" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0d1c1f"/><stop offset="0.55" stop-color="#081214"/><stop offset="1" stop-color="#060d0f"/></linearGradient>` +
      `<filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`,
  )
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="#0b1012"/>`)
  parts.push(`<rect x="7" y="7" width="${W - 14}" height="${H - 14}" rx="10" fill="url(#glass)" stroke="#1f3a40" stroke-width="1.2"/>`)
  parts.push(`<rect x="9" y="9" width="${W - 18}" height="${(H - 18) * 0.42}" rx="9" fill="#ffffff" fill-opacity="0.025"/>`)
  // Annunciators along the top: RX, the three modes (one lit), step, squelch, gain.
  const ann: [string, boolean, string][] = [
    ['RX', o.playing, GREEN],
    ...(o.rec ? [['● REC', true, RED] as [string, boolean, string]] : []),
    ...(o.log ? [['LOG', true, AMBER] as [string, boolean, string]] : []),
    ['WFM', t.mode === 'wbfm', LCD],
    ['NFM', t.mode === 'fm', LCD],
    ['AM', t.mode === 'am', LCD],
    [`STEP ${STEPS.find(s => s[0] === t.step)?.[1].replace(' ', '') ?? `${t.step / 1000}k`}`, true, LCD],
    [t.squelch ? `SQL ${t.squelch}` : 'SQL OFF', t.squelch > 0, LCD],
    [t.gain === 'auto' ? 'AGC' : `RF ${t.gain} dB`, true, LCD],
  ]
  let ax = 20
  const ay = 18
  for (const [s, on, col] of ann) {
    const w = s.length * (c ? 6.6 : 6.8) + 12
    if (ax + w > W - 14) break
    parts.push(`<rect x="${n1(ax)}" y="${ay}" width="${n1(w)}" height="16" rx="3" fill="${on ? col : 'none'}" fill-opacity="${on ? 0.12 : 0}" stroke="${col}" stroke-opacity="${on ? 0.75 : 0.14}"/>`)
    parts.push(txt(ax + w / 2, ay + 12, s, { anchor: 'middle', size: 10, weight: 700, fill: col, opacity: on ? 1 : 0.16 }))
    ax += w + 6
  }
  // The frequency: MHz . kHz . 10 Hz, leading blanks as ghost 8s.
  const hz = Math.round(t.hz)
  const mhzPart = String(Math.floor(hz / 1e6)).padStart(4, ' ')
  const khz = String(Math.floor((hz % 1e6) / 1000)).padStart(3, '0')
  const sub = String(Math.round((hz % 1000) / 10)).padStart(2, '0').slice(0, 2)
  const big = c ? { w: 25, h: 46, gap: 7 } : { w: 36, h: 64, gap: 9 }
  const small = c ? { w: 15, h: 28, gap: 5 } : { w: 21, h: 38, gap: 6 }
  const dy = c ? 46 : 46
  const lit: string[] = []
  const ghost: string[] = []
  const dots: string[] = []
  let dx = 22
  for (const ch of mhzPart) {
    digit(ch, dx, dy, big.w, big.h, lit, ghost)
    dx += big.w + big.gap
  }
  dots.push(`<rect x="${n1(dx - 2)}" y="${n1(dy + big.h - 7)}" width="7" height="7" rx="1.5"/>`)
  dx += 9
  for (const ch of khz) {
    digit(ch, dx, dy, big.w, big.h, lit, ghost)
    dx += big.w + big.gap
  }
  dots.push(`<rect x="${n1(dx - 2)}" y="${n1(dy + big.h - 5)}" width="5" height="5" rx="1"/>`)
  dx += 6
  for (const ch of sub) {
    digit(ch, dx, dy + big.h - small.h, small.w, small.h, lit, ghost)
    dx += small.w + small.gap
  }
  const skew = `transform="translate(${n1((dy + big.h / 2) * 0.105)},0) skewX(-6)"`
  parts.push(`<g ${skew} fill="${LCD}" fill-opacity="0.065">${ghost.join('')}</g>`)
  parts.push(`<g ${skew} fill="${LCD}" filter="url(#glow)" fill-opacity="${o.retuning ? 0.6 : 1}">${lit.join('')}${dots.join('')}</g>`)
  parts.push(txt(dx + 6, dy + big.h - 2, 'MHz', { fill: LCD, size: c ? 11 : 13, weight: 700, opacity: 0.85 }))
  // Station and band, beside the digits on the desktop, under them on the phone.
  const nx = c ? 22 : Math.max(dx + 52, 470)
  const ny = c ? dy + big.h + 22 : dy + 14
  const nmax = c ? 40 : Math.floor((W - nx - 16) / 7.4)
  const name = o.name ?? (o.band ? `${o.band}` : 'no station name')
  parts.push(txt(nx, ny, name.length > nmax ? `${name.slice(0, nmax - 1)}…` : name, { fill: o.name ? BRIGHT : AXIS, size: c ? 13 : 14, weight: 600, font: SANS }))
  const sub2 = `${modeName(t.mode)}${o.band && o.name ? ` · ${o.band}` : ''}`
  parts.push(txt(nx, ny + (c ? 17 : 20), sub2, { fill: AXIS, size: 11, font: SANS }))
  if (!c) {
    const state = o.retuning ? 'retuning…' : o.playing ? `▶ playing${o.since ? ` since ${clockOf(o.since)}` : ''}` : '■ not playing · press Listen'
    parts.push(txt(nx, ny + 40, state, { fill: o.playing ? GREEN : AXIS, size: 11, font: SANS }))
  }
  // The S-meter: segments S1..S9 green, +20 amber, +40 red; a peak tick.
  const my = H - (c ? 40 : 36)
  const mx0 = 44
  const mx1 = W - (c ? 24 : 210)
  const segs = c ? 22 : 30
  const sw = (mx1 - mx0) / segs
  const m = o.meter
  const listening = o.playing && !!m
  const closed = listening && m?.squelch === 'closed'
  const level = listening ? (closed ? 0 : m?.level ?? 0) : o.scanLevel ? clamp(o.scanLevel.above / 40) : 0
  const peak = listening ? m?.peak ?? 0 : 0
  parts.push(txt(22, my + 12, 'S', { fill: LCD, size: 14, weight: 700, opacity: 0.9 }))
  const scale: [number, string][] = [
    [0.05, '1'],
    [0.18, '3'],
    [0.32, '5'],
    [0.46, '7'],
    [0.6, '9'],
    [0.8, '+20'],
    [1, '+40'],
  ]
  for (const [p, s] of scale) parts.push(txt(mx0 + p * (mx1 - mx0), my - 4, s, { anchor: p === 1 ? 'end' : 'middle', size: 9, fill: p > 0.62 ? (p > 0.85 ? RED : AMBER) : LCD, opacity: 0.7 }))
  for (let i = 0; i < segs; i++) {
    const p = (i + 0.5) / segs
    const col = p > 0.8 ? RED : p > 0.6 ? AMBER : GREEN
    const on = p <= level
    const isPeak = listening && Math.abs(p - peak) < 0.5 / segs
    parts.push(`<rect x="${n1(mx0 + i * sw + 1)}" y="${my}" width="${n1(sw - 2)}" height="14" rx="1.5" fill="${col}" fill-opacity="${on ? (listening ? 0.95 : 0.4) : isPeak ? 0.7 : 0.08}"/>`)
  }
  // The reading in words.
  let reading = ''
  let rcol = AXIS
  if (o.playing && !m) reading = 'measuring…'
  else if (listening && m) {
    if (closed) reading = `squelch closed (SQL ${m.squelchLevel})`
    else if (m.metric === null) reading = 'measuring…'
    else reading = m.mode === 'wbfm' ? `stereo pilot ${m.metric.toFixed(0)} dB` : m.mode === 'am' ? `AM ${m.metric >= 0 ? '+' : ''}${m.metric.toFixed(0)} dB over noise` : `FM quieting ${m.metric.toFixed(0)}%`
    rcol = LCD
    if (m.weak) {
      reading = c ? 'weak signal — try the antenna by a window' : 'weak signal'
      rcol = AMBER
    } else if (m.idle) {
      reading = `${reading} · idle`
    }
  } else if (o.scanLevel) reading = `last ${o.scanLevel.label}: +${o.scanLevel.above.toFixed(0)} dB`
  else reading = 'not playing: press Listen'
  if (c) parts.push(txt(22, my + 30, reading, { fill: rcol, size: 11, font: SANS }))
  else parts.push(txt(mx1 + 14, my + 11, reading.length > 28 ? `${reading.slice(0, 27)}…` : reading, { fill: rcol, size: 11, font: SANS }))
  if (!c && m?.weak && listening) parts.push(txt(nx, ny + 58, 'weak signal — try the antenna by a window', { fill: AMBER, size: 11, font: SANS, weight: 600 }))
  return svgDoc(W, H, parts.join(''))
}

function lcdAlt(t: Tuner, playing: boolean, name: string | null, m: Meter | null): string {
  const f = `${mhz(t.hz / 1e6)} MHz`
  const what = `${f} ${modeName(t.mode)}, step ${STEPS.find(s => s[0] === t.step)?.[1] ?? t.step}, squelch ${t.squelch || 'off'}, gain ${t.gain === 'auto' ? 'auto' : `${t.gain} dB`}`
  const sig = playing && m ? (m.weak ? 'weak signal — try the antenna by a window' : m.squelch === 'closed' ? 'squelch closed' : `signal ${Math.round(m.level * 100)}%`) : ''
  return `Tuner: ${what}${name ? ` (${name})` : ''}${playing ? `, playing${sig ? `, ${sig}` : ''}` : ', not playing'}`
}

// ---------------------------------------------------------------- the EQ display (the sound itself)

// Bass to treble: the Radio palette from magenta through sky, cyan and green to amber.
const EQ_STOPS = [MAGENTA, SKY, CYAN, TEAL, GREEN, YELLOW, AMBER]

function rgbOf(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a)
  const y = rgbOf(b)
  return `#${[0, 1, 2].map(i => Math.round((x[i] ?? 0) + ((y[i] ?? 0) - (x[i] ?? 0)) * t).toString(16).padStart(2, '0')).join('')}`
}

function eqColor(i: number, n: number): string {
  const p = (n <= 1 ? 0 : i / (n - 1)) * (EQ_STOPS.length - 1)
  const k = Math.min(EQ_STOPS.length - 2, Math.floor(p))
  return mix(EQ_STOPS[k] ?? CYAN, EQ_STOPS[k + 1] ?? CYAN, p - k)
}

// The bands, fewer on the phone: neighbours merged by their loudest.
function eqFold(e: Eq, n: number): { bands: number[]; peaks: number[]; edges: number[] } {
  const N = e.bands.length
  if (n >= N) return { bands: e.bands, peaks: e.peaks, edges: e.edges }
  const bands: number[] = []
  const peaks: number[] = []
  const edges: number[] = [e.edges[0] ?? 60]
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * N) / n)
    const b = Math.max(a + 1, Math.floor(((i + 1) * N) / n))
    bands.push(Math.max(...e.bands.slice(a, b)))
    peaks.push(Math.max(...e.peaks.slice(a, b)))
    edges.push(e.edges[b] ?? edges[edges.length - 1] ?? 0)
  }
  return { bands, peaks, edges }
}

function hzLabel(f: number): string {
  return f >= 1000 ? `${Number((f / 1000).toFixed(f >= 10_000 ? 0 : 1))}k` : String(Math.round(f))
}

type EqOpts = { W: number; compact: boolean; playing: boolean; label?: string | null; legacy?: boolean }

// A hi-fi spectrum display: neon LED bars bass to treble with glowing peak caps over a faint
// mirrored reflection, a dB scale, the frequency axis, and a guess at what it is hearing.
function eqSvg(e: Eq | null, o: EqOpts): string {
  const W = o.W
  const c = o.compact
  const H = c ? 156 : 184
  const x0 = c ? 38 : 50
  const x1 = W - (c ? 14 : 20)
  const top = 34
  const base = H - (c ? 46 : 50)
  const refl = c ? 16 : 20
  const lo = e?.range?.[0] ?? -84
  const hi = e?.range?.[1] ?? -12
  const want = c ? 16 : 32
  const folded = e ? eqFold(e, want) : null
  const n = folded ? folded.bands.length : want
  const bands = folded?.bands ?? Array.from({ length: n }, () => 0)
  const peaks = folded?.peaks ?? Array.from({ length: n }, () => 0)
  const edges = folded?.edges ?? Array.from({ length: n + 1 }, (_, i) => 60 * (200 ** (i / n)))
  const ghost = !o.playing
  const slot = (x1 - x0) / n
  const bw = Math.max(3, slot * 0.7)
  const span = base - top
  const parts: string[] = []
  const defs: string[] = [
    `<linearGradient id="eqglass" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#0d1c1f"/><stop offset="0.6" stop-color="#081214"/><stop offset="1" stop-color="#060d0f"/></linearGradient>`,
    `<linearGradient id="eqfade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#070f11" stop-opacity="0.25"/><stop offset="1" stop-color="#070f11" stop-opacity="1"/></linearGradient>`,
    `<pattern id="eqseg" width="8" height="5" patternUnits="userSpaceOnUse" y="${n1(base)}"><rect width="8" height="3.7" fill="#fff"/></pattern>`,
    `<mask id="eqled"><rect x="0" y="0" width="${W}" height="${n1(base)}" fill="url(#eqseg)"/></mask>`,
    `<filter id="eqglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${c ? 2.2 : 3}"/></filter>`,
    `<filter id="eqcap" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
  ]
  for (let i = 0; i < n; i++) {
    const col = eqColor(i, n)
    defs.push(`<linearGradient id="eqb${i}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${mix(col, '#ffffff', 0.25)}"/><stop offset="0.45" stop-color="${col}"/><stop offset="1" stop-color="${mix(col, '#061014', 0.55)}"/></linearGradient>`)
  }
  parts.push(`<defs>${defs.join('')}</defs>`)
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="#0b1012"/>`)
  parts.push(`<rect x="7" y="7" width="${W - 14}" height="${H - 14}" rx="10" fill="url(#eqglass)" stroke="#1f3a40" stroke-width="1.2"/>`)
  // Title and what it hears, like the LCD's annunciators.
  const title = 'AUDIO SPECTRUM'
  const tw = title.length * 6.8 + 12
  parts.push(`<rect x="20" y="15" width="${n1(tw)}" height="16" rx="3" fill="${LCD}" fill-opacity="${ghost ? 0 : 0.12}" stroke="${LCD}" stroke-opacity="${ghost ? 0.2 : 0.75}"/>`)
  parts.push(txt(20 + tw / 2, 27, title, { anchor: 'middle', size: 10, weight: 700, fill: LCD, opacity: ghost ? 0.3 : 1 }))
  const kindCol: Record<string, string> = { music: CYAN, voice: GREEN, noise: AMBER, silence: AXIS }
  if (!ghost && e) {
    const kind = e.kind === 'silence' ? 'silence' : `sounds like ${e.kind}`
    const rms = e.rms !== null && e.rms !== undefined ? ` · ${e.rms.toFixed(0)} dBFS` : ''
    parts.push(txt(x1, 27, `${kind}${rms}`, { anchor: 'end', size: 11, font: SANS, fill: kindCol[e.kind] ?? AXIS, weight: 600 }))
  } else if (!ghost) parts.push(txt(x1, 27, o.legacy ? 'press ■ Stop, then ▶ Listen once to see the sound' : 'reading the audio…', { anchor: 'end', size: 11, font: SANS, fill: o.legacy ? AMBER : AXIS }))
  // The dB scale and its grid.
  const step = c ? 24 : 12
  const marks: number[] = []
  for (let d = Math.ceil(lo / step) * step; d <= hi + 0.01; d += step) marks.push(d)
  for (const d of marks) {
    const y = base - ((d - lo) / (hi - lo)) * span
    parts.push(`<line x1="${x0}" x2="${x1}" y1="${n1(y)}" y2="${n1(y)}" stroke="${GRID}" stroke-opacity="${ghost ? 0.35 : 0.7}" stroke-dasharray="2 4"/>`)
    parts.push(txt(x0 - 6, y + 3.5, d === marks[marks.length - 1] ? `${d} dB` : `${d}`, { anchor: 'end', size: 9, fill: AXIS, opacity: ghost ? 0.4 : 0.9 }))
  }
  // The bars: a glow behind, the LED bars, the reflection, the peak caps.
  const glow: string[] = []
  const bars: string[] = []
  const mirror: string[] = []
  const caps: string[] = []
  for (let i = 0; i < n; i++) {
    const x = x0 + i * slot + (slot - bw) / 2
    const lv = ghost ? 0.1 + 0.32 * Math.exp(-(((i / n) - 0.3) ** 2) / 0.06) : clamp(bands[i] ?? 0)
    const h = Math.max(ghost ? 6 : 1.5, lv * span)
    const col = eqColor(i, n)
    if (!ghost && lv > 0.04) glow.push(`<rect x="${n1(x)}" y="${n1(base - h)}" width="${n1(bw)}" height="${n1(h)}" fill="${col}"/>`)
    bars.push(`<rect x="${n1(x)}" y="${n1(base - h)}" width="${n1(bw)}" height="${n1(h)}" fill="${ghost ? col : `url(#eqb${i})`}"/>`)
    mirror.push(`<rect x="${n1(x)}" y="${n1(base + 2)}" width="${n1(bw)}" height="${n1(Math.min(refl, h * 0.32))}" fill="${col}"/>`)
    const pk = ghost ? 0 : clamp(peaks[i] ?? 0)
    if (pk > 0.02) caps.push(`<rect x="${n1(x - 0.5)}" y="${n1(base - pk * span - 4)}" width="${n1(bw + 1)}" height="2.6" rx="1" fill="${mix(col, '#ffffff', 0.55)}"/>`)
  }
  if (glow.length) parts.push(`<g filter="url(#eqglow)" opacity="0.55">${glow.join('')}</g>`)
  parts.push(`<g mask="url(#eqled)" opacity="${ghost ? 0.09 : 1}">${bars.join('')}</g>`)
  parts.push(`<g opacity="${ghost ? 0.04 : 0.2}">${mirror.join('')}</g>`)
  parts.push(`<rect x="${x0 - 2}" y="${n1(base + 1)}" width="${n1(x1 - x0 + 4)}" height="${refl + 3}" fill="url(#eqfade)"/>`)
  parts.push(`<line x1="${x0}" x2="${x1}" y1="${n1(base + 1)}" y2="${n1(base + 1)}" stroke="${LCD}" stroke-opacity="0.25"/>`)
  if (caps.length) parts.push(`<g filter="url(#eqcap)">${caps.join('')}</g>`)
  // The frequency axis: the usual landmarks, placed on the log scale.
  const f0 = edges[0] ?? 60
  const f1 = edges[edges.length - 1] ?? 12000
  const ticks = c ? [100, 250, 500, 1000, 2000, 4000, 8000] : [60, 125, 250, 500, 1000, 2000, 4000, 8000, 12000]
  for (const f of ticks) {
    if (f < f0 * 0.98 || f > f1 * 1.02) continue
    const x = x0 + (Math.log(f / f0) / Math.log(f1 / f0)) * (x1 - x0)
    parts.push(txt(x, H - 14, hzLabel(f), { anchor: 'middle', size: 9, fill: AXIS, opacity: ghost ? 0.4 : 0.9 }))
  }
  if (ghost) parts.push(txt(W / 2, top + span / 2 + 4, 'press ▶ Listen to see the sound', { anchor: 'middle', size: c ? 12 : 13, font: SANS, fill: AXIS, weight: 600 }))
  return svgDoc(W, H, parts.join(''))
}

function eqAlt(e: Eq | null, playing: boolean, label?: string | null): string {
  if (!playing) return 'Audio spectrum: not playing (press Listen to see the sound)'
  if (!e) return `Audio spectrum of ${label ?? 'the station'}: reading the audio`
  const k = e.bands.reduce((b, v, i, a) => (v > (a[b] ?? 0) ? i : b), 0)
  const at = Math.sqrt((e.edges[k] ?? 0) * (e.edges[k + 1] ?? 0))
  return `Audio spectrum of ${label ?? `${mhz(e.freq)} MHz`}: ${e.bands.length} bands ${hzLabel(e.edges[0] ?? 0)}–${hzLabel(e.edges[e.edges.length - 1] ?? 0)} Hz, loudest around ${hzLabel(at)} Hz, ${e.kind === 'silence' ? 'silent' : `sounds like ${e.kind}`}${e.rms !== null ? `, ${e.rms.toFixed(0)} dBFS` : ''}`
}

// The terminal's EQ: one Raster, a column of eighth blocks per band in its colour, the peak cap a bar above.
function eqRaster(e: Eq, columns: number): { cells: string; columns: number; rows: number } {
  const ROWS = 7
  const nb = Math.max(8, Math.min(e.bands.length, Math.floor((columns - 2) / 2)))
  const f = eqFold(e, nb)
  const n = f.bands.length
  const C = n * 2
  const words = new Uint32Array(C * ROWS * 3)
  const DEF = 0x01000000
  for (let i = 0; i < n; i++) {
    const fg = parseInt(eqColor(i, n).slice(1), 16)
    const capFg = parseInt(mix(eqColor(i, n), '#ffffff', 0.6).slice(1), 16)
    const eighths = Math.round(clamp(f.bands[i] ?? 0) * ROWS * 8)
    const capRow = ROWS - 1 - Math.min(ROWS - 1, Math.floor(clamp(f.peaks[i] ?? 0) * ROWS))
    for (let r = 0; r < ROWS; r++) {
      const fromBottom = ROWS - 1 - r
      const fill = eighths - fromBottom * 8
      let cp = fill >= 8 ? 0x2588 : fill <= 0 ? 0x20 : (BARS.codePointAt(fill - 1) ?? 0x20)
      let col = fg
      if (cp === 0x20 && r === capRow && (f.peaks[i] ?? 0) > 0.03) {
        cp = 0x2594
        col = capFg
      }
      const k = (r * C + i * 2) * 3
      words[k] = cp
      words[k + 1] = col
      words[k + 2] = DEF
      words[k + 3] = 0x20
      words[k + 4] = DEF
      words[k + 5] = DEF
    }
  }
  return { cells: b64encode(new Uint8Array(words.buffer)), columns: C, rows: ROWS }
}

// ---------------------------------------------------------------- the radio world map

const MAP_LO = 24
const MAP_HI = 1700
type Item = { id: string; lo: number; hi: number; lane: number; label: string; cat: Cat | 'group' }

function activityOf(id: string, act: Record<string, Activity>): Activity | null {
  if (id === 'lora') {
    const a = act.lora
    const b = act.mesh
    if (a && b) return a.at > b.at ? a : b
    return a ?? b ?? null
  }
  return act[id] ?? null
}

function heatMark(cx: number, cy: number, a: Activity | null, now: number, parts: string[]): void {
  if (!a) {
    parts.push(`<circle cx="${n1(cx)}" cy="${n1(cy)}" r="3" fill="none" stroke="${AXIS}" stroke-opacity="0.45" stroke-dasharray="1.5 1.5"/>`)
    return
  }
  const age = now - a.at
  const op = age < 10 * 60_000 ? 1 : age < 3_600_000 ? 0.75 : age < 86_400_000 ? 0.5 : 0.3
  const r = 3.5 + 6 * clamp(a.n / 16)
  const col = heat(a.best)
  parts.push(`<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r + 3.5)}" fill="${col}" fill-opacity="${(0.18 * op).toFixed(2)}"/>`)
  parts.push(`<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" fill="${col}" fill-opacity="${(0.9 * op).toFixed(2)}" stroke="${BG}" stroke-width="1"/>`)
  parts.push(txt(cx, cy + 3.5, String(a.n), { anchor: 'middle', size: 9, weight: 700, fill: '#10161a' }))
}

// A band's tooltip on the map (the desktop draws the map interactive: <title> and :hover work).
function bandTitle(id: string, a: Activity | null, live: boolean): string {
  if (id === '@vhf') return 'VHF close-up 144–163 MHz: 2 m ham, MURS, Marine, Railroad and NOAA weather, drawn larger below'
  if (id === '@uhf') return 'UHF close-up 420–468 MHz: 70 cm ham, 433 MHz gadgets and GMRS / FRS, drawn larger below'
  const b = bandOf(id)
  if (!b) return id
  const heard = a ? `${a.n} signal${a.n === 1 ? '' : 's'} in the last scan (${clockOf(a.at)}), strongest +${Math.round(a.best)} dB` : 'not scanned yet'
  const short = BAND_SHORT[id] ?? b.label
  return `${b.label} ${b.lo}–${b.hi} MHz · ${heard} · use the ${short} button below to ${live ? 'move the live view there' : 'scan it'}`
}

// Hover on the interactive map: the band under the pointer brightens (no script).
const MAP_STYLE = `<style>.bnd{cursor:default}.bnd:hover .bar{fill-opacity:1;stroke:${BRIGHT};stroke-width:2}.bnd:hover .lbl{fill:${BRIGHT}}</style>`

function bandMapSvg(o: { W: number; compact: boolean; now: number; activity: Record<string, Activity>; current: string | null; tunedMhz: number | null; live?: boolean }): string {
  const W = o.W
  const c = o.compact
  const L = 20
  const R = 20
  const pw = W - L - R
  const lx = (f: number) => L + (Math.log(f / MAP_LO) / Math.log(MAP_HI / MAP_LO)) * pw
  const AX = 156
  const BAR = 12
  const laneY = [AX - 26, AX - 62, AX - 98]
  const insetH = 142
  const iy0 = AX + 44
  const H = c ? iy0 + insetH * 2 + 14 + 26 : iy0 + insetH + 30
  const parts: string[] = [MAP_STYLE, `<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="${BG}"/>`]
  parts.push(txt(16, 21, c ? 'RADIO WORLD · 24 MHz – 1.7 GHz' : `RADIO WORLD AROUND ${LOC.name.toUpperCase()} · 24 MHz – 1.7 GHz · log scale`, { fill: LABEL, size: 11, weight: 700, spacing: 0.6 }))
  // Zones: VHF and UHF, faintly, behind the main strip.
  for (const [a, b, s] of [
    [30, 300, 'VHF 30–300 MHz'],
    [300, 1700, 'UHF 300 MHz–3 GHz'],
  ] as [number, number, string][]) {
    parts.push(`<rect x="${n1(lx(a))}" y="${AX - 120}" width="${n1(lx(b) - lx(a))}" height="120" fill="${a === 30 ? '#13202a' : '#171a2a'}" fill-opacity="0.6"/>`)
    parts.push(txt(lx(a) + 6, AX - 108, c ? s.split(' ')[0]! : s, { fill: AXIS, size: 9.5, opacity: 0.6, weight: 700 }))
  }
  parts.push(`<line x1="${L}" x2="${W - R}" y1="${AX}" y2="${AX}" stroke="${AXIS}" stroke-width="1.2"/>`)
  for (const f of [30, 50, 100, 200, 300, 500, 1000, 1500]) {
    const px = lx(f)
    parts.push(`<line x1="${n1(px)}" x2="${n1(px)}" y1="${AX}" y2="${AX + 5}" stroke="${AXIS}"/>`)
    if (c && (f === 30 || f === 300 || f === 1500)) continue
    parts.push(txt(px, AX + 17, f >= 1000 ? `${f / 1000} GHz` : `${f}`, { anchor: 'middle', size: c ? 10.5 : 9.5 }))
  }
  if (!c) parts.push(txt(L, AX + 17, 'MHz', { size: 9.5 }))
  const main: Item[] = [
    { id: 'fm', lo: 87.5, hi: 108, lane: 0, label: c ? 'FM' : 'FM 88–108', cat: 'broadcast' },
    { id: 'air', lo: 118, hi: 137, lane: 1, label: c ? 'Air' : 'Aircraft 118–137', cat: 'air' },
    { id: '@vhf', lo: 144, hi: 163, lane: 2, label: c ? 'VHF ▾' : 'VHF close-up ▾', cat: 'group' },
    { id: '@uhf', lo: 420, hi: 468, lane: 0, label: c ? 'UHF ▾' : 'UHF close-up ▾', cat: 'group' },
    { id: 'lora', lo: 902, hi: 928, lane: 1, label: c ? 'LoRa' : 'LoRa 902–928', cat: 'iot' },
    { id: 'adsb', lo: 1088, hi: 1092, lane: 0, label: 'ADS-B', cat: 'air' },
  ]
  // A band's bar with its label above; returns the bar's centre.
  const bar = (it: Item, x: (f: number) => number, yb: number, h: number, hl: boolean): number => {
    const a = x(it.lo)
    const w = Math.max(6, x(it.hi) - a)
    const col = it.cat === 'group' ? LABEL : CAT_COLOR[it.cat]
    const xa = w === 6 ? (x(it.lo) + x(it.hi)) / 2 - 3 : a
    if (it.cat === 'group') parts.push(`<rect class="bar" x="${n1(xa)}" y="${n1(yb)}" width="${n1(w)}" height="${h}" rx="3" fill="${LABEL}" fill-opacity="0.06" stroke="${col}" stroke-opacity="0.7" stroke-dasharray="3 2"/>`)
    else parts.push(`<rect class="bar" x="${n1(xa)}" y="${n1(yb)}" width="${n1(w)}" height="${h}" rx="3" fill="${col}" fill-opacity="0.85"${hl ? ` stroke="${BRIGHT}" stroke-width="2"` : ''}/>`)
    const half = it.label.length * 3.1
    const tx = clamp(xa + w / 2, L + half, W - R - half)
    parts.push(txt(tx, yb - 12, it.label, { anchor: 'middle', size: c ? 10.5 : 10, fill: col, weight: 600, cls: 'lbl' }))
    return xa + w / 2
  }
  // Each band is one group: its bar, label and count badge share a <title> and the hover.
  const groupStart = (id: string, a: Activity | null) => parts.push(`<g class="bnd"><title>${esc(bandTitle(id, a, !!o.live))}</title>`)
  for (const it of main) {
    const yb = laneY[it.lane] ?? AX - 26
    const a = it.id.startsWith('@') ? null : activityOf(it.id, o.activity)
    groupStart(it.id, a)
    const cx = bar(it, lx, yb, BAR, it.id === o.current || (it.id === 'lora' && o.current === 'mesh'))
    parts.push(`<line x1="${n1(cx)}" x2="${n1(cx)}" y1="${n1(yb + BAR)}" y2="${AX}" stroke="${GRID}" stroke-dasharray="1 2"/>`)
    if (!it.id.startsWith('@')) heatMark(cx, yb + BAR / 2, a, o.now, parts)
    parts.push('</g>')
  }
  if (o.tunedMhz !== null && o.tunedMhz >= MAP_LO && o.tunedMhz <= MAP_HI) parts.push(`<path d="M${n1(lx(o.tunedMhz))},${AX - 1} l-5,-8 h10 z" fill="${RED}"/>`)
  // Close-ups: lane 1 high, lane 0 low; marks labelled along the top.
  const vhf: Item[] = [
    { id: '2m', lo: 144, hi: 148, lane: 0, label: '2 m ham', cat: 'ham' },
    { id: 'murs', lo: 151.82, hi: 154.6, lane: 1, label: 'MURS', cat: 'public' },
    { id: 'marine', lo: 156.0, hi: 157.45, lane: 0, label: 'Marine', cat: 'public' },
    { id: 'rail', lo: 160.2, hi: 161.6, lane: 1, label: 'Rail', cat: 'public' },
    { id: 'noaa', lo: 162.4, hi: 162.55, lane: 0, label: 'NOAA', cat: 'weather' },
  ]
  const uhf: Item[] = [
    { id: '70cm', lo: 420, hi: 450, lane: 0, label: '70 cm ham', cat: 'ham' },
    { id: '433', lo: 433.05, hi: 434.79, lane: 1, label: '433 ISM', cat: 'iot' },
    { id: 'gmrs', lo: 462.55, hi: 467.725, lane: 1, label: 'GMRS / FRS', cat: 'public' },
  ]
  const inset = (x0: number, y0: number, w: number, lo: number, hi: number, title: string, items: Item[], ticks: number, marks: [number, string][], fromLo: number, fromHi: number) => {
    const x = (f: number) => x0 + 14 + ((f - lo) / (hi - lo)) * (w - 28)
    const fromY = (laneY[main.find(m => m.lo === fromLo)?.lane ?? 0] ?? AX) + BAR
    parts.push(`<path d="M${n1(lx(fromLo))},${n1(fromY)} L${n1(x0 + 6)},${y0} M${n1(lx(fromHi))},${n1(fromY)} L${n1(x0 + w - 6)},${y0}" stroke="${LABEL}" stroke-opacity="0.2" stroke-dasharray="2 3" fill="none"/>`)
    parts.push(`<rect x="${n1(x0)}" y="${y0}" width="${n1(w)}" height="${insetH}" rx="8" fill="${PLOT}" stroke="${GRID}"/>`)
    parts.push(txt(x0 + 10, y0 + 17, title, { fill: LABEL, size: 10, weight: 700 }))
    const ay = y0 + insetH - 28
    parts.push(`<line x1="${n1(x0 + 14)}" x2="${n1(x0 + w - 14)}" y1="${ay}" y2="${ay}" stroke="${AXIS}"/>`)
    for (let f = Math.ceil(lo / ticks) * ticks; f <= hi; f += ticks) {
      parts.push(`<line x1="${n1(x(f))}" x2="${n1(x(f))}" y1="${ay}" y2="${ay + 4}" stroke="${AXIS}"/>`)
      parts.push(txt(x(f), ay + 16, String(f), { anchor: 'middle', size: 9.5 }))
    }
    for (const [f, s] of marks) {
      parts.push(`<line x1="${n1(x(f))}" x2="${n1(x(f))}" y1="${y0 + 34}" y2="${ay}" stroke="${MARK}" stroke-dasharray="2 2" stroke-opacity="0.75"/>`)
      parts.push(txt(clamp(x(f), x0 + 20, x0 + w - 20), y0 + 31, s, { anchor: 'middle', size: 9, fill: MARK }))
    }
    for (const it of items) {
      const yb = it.lane === 0 ? ay - 22 : ay - 58
      const a = activityOf(it.id, o.activity)
      groupStart(it.id, a)
      const cx = bar(it, x, yb, BAR, it.id === o.current)
      heatMark(cx, yb + BAR / 2, a, o.now, parts)
      parts.push('</g>')
    }
    if (o.tunedMhz !== null && o.tunedMhz >= lo && o.tunedMhz <= hi) parts.push(`<path d="M${n1(x(o.tunedMhz))},${ay - 1} l-4,-7 h8 z" fill="${RED}"/>`)
  }
  if (c) {
    inset(L, iy0, pw, 143, 164, 'VHF 143–164 MHz', vhf, 4, [[146.52, '146.52'], [156.8, 'ch 13·16']], 144, 163)
    inset(L, iy0 + insetH + 14, pw, 418, 470, 'UHF 418–470 MHz', uhf, 10, [[446, '446.0']], 420, 468)
  } else {
    const iw = (pw - 16) / 2
    inset(L, iy0, iw, 143, 164, 'VHF close-up · 143–164 MHz', vhf, 2, [[146.52, '146.52 calling'], [156.725, 'ch 13 · 16 river']], 144, 163)
    inset(L + iw + 16, iy0, iw, 418, 470, 'UHF close-up · 418–470 MHz', uhf, 10, [[446, '446.0 calling']], 420, 468)
  }
  const ly = H - 10
  parts.push(`<circle cx="${L + 4}" cy="${ly - 4}" r="4" fill="${YELLOW}"/>`)
  parts.push(txt(L + 13, ly, c ? 'heard in the last scan · size = signals' : 'heard in the last scan of the band: size = how many signals, colour = the strongest (blue weak → red strong); faded = older', { size: 9.5 }))
  return svgDoc(W, H, parts.join(''))
}

// ---------------------------------------------------------------- mesh, neighbourhood, sparklines

function meshSvg(m: Mesh, o: { W: number; compact: boolean; now: number }): string {
  const W = o.W
  const c = o.compact
  const L = c ? 16 : 206
  const R = 16
  const laneH = 34
  const T = c ? 34 : 30
  const H = c ? T + 2 * (laneH + 18) + 26 : T + 2 * (laneH + 8) + 24
  const parts: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="${BG}"/>`]
  parts.push(txt(14, 19, 'MESH TRAFFIC · bursts a minute, last hour', { fill: LABEL, size: 11, weight: 700, spacing: 0.5 }))
  const pw = W - L - R
  const slot = pw / 60
  const end = Math.floor(o.now / 60_000) * 60_000
  const byMin = new Map(m.window.map(b => [b[0], b]))
  const chans: [MeshChan, string, number][] = [
    [m.mt, ORANGE, 1],
    [m.mc, MAGENTA, 2],
  ]
  chans.forEach(([ch, col, idx], k) => {
    const y0 = c ? T + k * (laneH + 18) + 14 : T + k * (laneH + 8)
    const base = y0 + laneH
    const sc = ch.state === 'busy' ? RED : ch.state === 'active' ? YELLOW : ch.state === 'quiet' ? GREEN : AXIS
    const word = ch.state === 'unknown' ? 'NO DATA' : ch.state.toUpperCase()
    if (c) {
      parts.push(txt(14, y0 - 2, `${ch.name.replace(' LongFast', '')} ${ch.mhz}`, { fill: col, size: 10.5, weight: 700 }))
      parts.push(txt(W - 16, y0 - 2, word, { fill: sc, size: 10, weight: 700, anchor: 'end' }))
    } else {
      parts.push(txt(14, y0 + 13, ch.name, { fill: col, size: 10.5, weight: 700 }))
      parts.push(`<rect x="14" y="${y0 + 18}" width="58" height="14" rx="7" fill="${sc}" fill-opacity="0.15" stroke="${sc}" stroke-opacity="0.7"/>`)
      parts.push(txt(43, y0 + 28.5, word, { fill: sc, size: 9, weight: 700, anchor: 'middle' }))
      parts.push(txt(80, y0 + 29, `${ch.mhz} · ${ch.perMin}/min`, { size: 9.5 }))
    }
    parts.push(`<rect x="${L}" y="${y0}" width="${pw}" height="${laneH}" rx="4" fill="${PLOT}"/>`)
    let peak = 1
    for (const b of m.window) if (b[3] >= 5) peak = Math.max(peak, ((b[idx] ?? 0) / b[3]) * 60)
    for (let i = 0; i < 60; i++) {
      const t = end - (59 - i) * 60_000
      const b = byMin.get(t)
      const x = L + i * slot
      if (!b || !b[3]) {
        parts.push(`<circle cx="${n1(x + slot / 2)}" cy="${base - 3}" r="0.9" fill="${AXIS}" fill-opacity="0.35"/>`)
        continue
      }
      const rate = ((b[idx] ?? 0) / b[3]) * 60
      const h = rate > 0 ? Math.max(3, (rate / peak) * (laneH - 4)) : 1.5
      parts.push(`<rect x="${n1(x + 0.6)}" y="${n1(base - h)}" width="${n1(Math.max(1, slot - 1.2))}" height="${n1(h)}" fill="${col}" fill-opacity="${rate > 0 ? 0.9 : 0.35}"/>`)
    }
  })
  const ay = H - 9
  parts.push(txt(L, ay, '−60 min', { size: 9.5 }))
  parts.push(txt(L + pw / 2, ay, '−30', { size: 9.5, anchor: 'middle' }))
  parts.push(txt(W - R, ay, 'now', { size: 9.5, anchor: 'end' }))
  if (!c) parts.push(txt(14, ay, `${Math.round(m.seconds / 60)} min listened`, { size: 9.5 }))
  return svgDoc(W, H, parts.join(''))
}

function meshAlt(m: Mesh): string {
  const s = (ch: MeshChan) => `${ch.name} ${ch.state === 'unknown' ? 'no data yet' : `${ch.state} (${ch.bursts} bursts, ${ch.perMin} a minute)`}`
  return `Mesh traffic over the last hour: ${s(m.mt)}; ${s(m.mc)}; ${Math.round(m.seconds / 60)} minutes listened`
}

function hoodSvg(h: Hood, o: { W: number; compact: boolean; now: number; total: number }): string {
  const W = o.W
  const c = o.compact
  const tiles: [string, string, string, string][] = [
    ['HEARD TODAY', String(h.day), `${o.total} ever`, CYAN],
    ['LAST HOUR', String(h.hour), h.merged ? `${h.merged} merged twin${h.merged === 1 ? '' : 's'}` : 'transmitters', GREEN],
    ['LOW BATTERY', String(h.lowBattery.length), h.lowBattery.length ? h.lowBattery[0]!.split(' / ')[0]! : 'all fine', h.lowBattery.length ? RED : GREEN],
    ['NEWEST', h.newest ? ago(h.newest.first, o.now) : '—', h.newest ? h.newest.model.split(' / ')[0]! : 'nothing yet', AMBER],
  ]
  const cols = c ? 2 : 4
  const tw = (W - 16 - (cols - 1) * 8) / cols
  const th = 64
  const rows = Math.ceil(tiles.length / cols)
  const H = 8 + rows * (th + 8)
  const parts: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="${BG}"/>`]
  tiles.forEach(([k, v, s, col], i) => {
    const x = 8 + (i % cols) * (tw + 8)
    const y = 8 + Math.floor(i / cols) * (th + 8)
    parts.push(`<rect x="${n1(x)}" y="${y}" width="${n1(tw)}" height="${th}" rx="8" fill="${PLOT}" stroke="${GRID}"/>`)
    parts.push(`<rect x="${n1(x)}" y="${y + 10}" width="3" height="${th - 20}" rx="1.5" fill="${col}"/>`)
    parts.push(txt(x + 12, y + 16, k, { size: 9, weight: 700, fill: AXIS, spacing: 0.6 }))
    parts.push(txt(x + 12, y + 41, v, { size: v.length > 6 ? 15 : 22, weight: 700, fill: BRIGHT, font: SANS }))
    const smax = Math.floor((tw - 20) / 6)
    parts.push(txt(x + 12, y + 56, s.length > smax ? `${s.slice(0, smax - 1)}…` : s, { size: 9.5, fill: col === RED ? RED : LABEL }))
  })
  return svgDoc(W, H, parts.join(''))
}

function sparkSvg(d: Device, now: number): string | null {
  const pts = (d.hist ?? []).filter(p => p[1] !== null || p[2] !== null)
  const W = 320
  const H = 62
  const parts: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="${BG}"/>`]
  const temps = pts.filter(p => p[1] !== null) as [number, number, number | null, number | null][]
  if (temps.length < 2 && pts.length < 2) return null
  const t0 = pts[0]?.[0] ?? now
  const t1 = Math.max(pts[pts.length - 1]?.[0] ?? now, t0 + 60_000)
  const L = 46
  const R = 92
  const T = 9
  const B = 15
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R)
  parts.push(`<defs><linearGradient id="tf" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.35"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></linearGradient></defs>`)
  parts.push(`<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="${PLOT}"/>`)
  const hums = pts.filter(p => p[2] !== null)
  if (hums.length >= 2) {
    const hy = (h: number) => T + (1 - h / 100) * (H - T - B)
    parts.push(`<path d="${hums.map((p, i) => `${i ? 'L' : 'M'}${n1(x(p[0]))},${n1(hy(p[2] ?? 0))}`).join('')}" fill="none" stroke="${CYAN}" stroke-width="1.1" stroke-dasharray="3 2" stroke-opacity="0.8"/>`)
  }
  if (temps.length >= 2) {
    const vs = temps.map(p => p[1])
    let lo = Math.min(...vs)
    let hi = Math.max(...vs)
    if (hi - lo < 2) {
      lo -= 1
      hi += 1
    }
    const ty = (v: number) => T + 2 + (1 - (v - lo) / (hi - lo)) * (H - T - B - 4)
    const line = temps.map((p, i) => `${i ? 'L' : 'M'}${n1(x(p[0]))},${n1(ty(p[1]))}`).join('')
    parts.push(`<path d="${line}L${n1(x(temps[temps.length - 1]![0]))},${H - B}L${n1(x(temps[0]![0]))},${H - B}Z" fill="url(#tf)"/>`)
    parts.push(`<path d="${line}" fill="none" stroke="${AMBER}" stroke-width="1.6"/>`)
    const last = temps[temps.length - 1]!
    parts.push(`<circle cx="${n1(x(last[0]))}" cy="${n1(ty(last[1]))}" r="2.6" fill="${YELLOW}"/>`)
    parts.push(txt(L - 5, T + 8, `${Math.max(...vs).toFixed(0)}°`, { anchor: 'end', size: 9.5, fill: AMBER }))
    parts.push(txt(L - 5, H - B, `${Math.min(...vs).toFixed(0)}°`, { anchor: 'end', size: 9.5, fill: AMBER }))
  }
  const cur = d.tempF !== null ? `${d.tempF.toFixed(1)}°F` : hums.length ? `${hums[hums.length - 1]![2]}%` : ''
  parts.push(txt(W - 10, 30, cur, { anchor: 'end', size: 18, weight: 700, fill: d.tempF !== null ? AMBER : CYAN, font: SANS }))
  if (d.tempF !== null && d.humidity !== null && d.humidity !== undefined) parts.push(txt(W - 10, 46, `${d.humidity}% RH`, { anchor: 'end', size: 10.5, fill: CYAN }))
  // Battery glyph.
  const bx = W - 86
  parts.push(`<rect x="${bx}" y="10" width="16" height="9" rx="2" fill="none" stroke="${d.lowBattery ? RED : GREEN}"/>`)
  parts.push(`<rect x="${bx + 16}" y="12.5" width="2" height="4" fill="${d.lowBattery ? RED : GREEN}"/>`)
  parts.push(`<rect x="${bx + 2}" y="12" width="${d.lowBattery ? 3 : 12}" height="5" fill="${d.lowBattery ? RED : GREEN}"/>`)
  const hrs = (t1 - t0) / 3_600_000
  parts.push(txt(L, H - 3, hrs >= 1 ? `last ${hrs.toFixed(hrs < 10 ? 1 : 0)} h` : `last ${Math.max(1, Math.round(hrs * 60))} min`, { size: 9 }))
  parts.push(txt(W - R - 2, H - 3, `${pts.length} readings`, { size: 9, anchor: 'end' }))
  return svgDoc(W, H, parts.join(''))
}

// ---------------------------------------------------------------- the terminal's cells

const BARS = '▁▂▃▄▅▆▇█'

// The spectrum (eighth blocks) over the waterfall (▀: two rows a cell) as one Raster.
function rasterOf(v: View, columns: number): { cells: string; columns: number; rows: number } | null {
  if (!v.wf?.b64 || !v.wf.cols || !v.wf.rows) return null
  const g = b64decode(v.wf.b64)
  const C = Math.max(20, Math.min(columns, 160))
  const SPEC = 6
  const wrows = Math.min(v.wf.rows, v.live ? 32 : v.wf.rows)
  const WFR = Math.ceil(wrows / 2)
  const rows = SPEC + WFR
  const words = new Uint32Array(C * rows * 3)
  const DEF = 0x01000000
  const [s0, s1] = v.scale ?? [v.floor - 4, v.top + 1]
  const avg = poolTo(v.avg, C)
  const put = (r: number, col: number, cp: number, fg: number, bg: number) => {
    const k = (r * C + col) * 3
    words[k] = cp
    words[k + 1] = fg
    words[k + 2] = bg
  }
  for (let col = 0; col < C; col++) {
    const val = avg[Math.floor((col / C) * avg.length)] ?? s0
    const lvl = clamp((val - s0) / (s1 - s0))
    const eighths = Math.round(lvl * SPEC * 8)
    const fg = PAL[Math.round(clamp(lvl * 1.15) * 255)] ?? 0xffffff
    for (let r = 0; r < SPEC; r++) {
      const fromBottom = SPEC - 1 - r
      const fill = eighths - fromBottom * 8
      const cp = fill >= 8 ? 0x2588 : fill <= 0 ? 0x20 : (BARS.codePointAt(fill - 1) ?? 0x20)
      put(r, col, cp, fg, DEF)
    }
    const src = Math.min(v.wf.cols - 1, Math.floor((col / C) * v.wf.cols))
    for (let r = 0; r < WFR; r++) {
      const a = g[(2 * r) * v.wf.cols + src] ?? 0
      const b = 2 * r + 1 < wrows ? (g[(2 * r + 1) * v.wf.cols + src] ?? 0) : 0
      put(SPEC + r, col, 0x2580, PAL[a] ?? 0, PAL[b] ?? 0)
    }
  }
  return { cells: b64encode(new Uint8Array(words.buffer)), columns: C, rows }
}

function sparkline(vals: number[], width: number, lo?: number, hi?: number): string {
  if (!vals.length) return ''
  const a = lo ?? Math.min(...vals)
  const b = hi ?? Math.max(...vals)
  const out: string[] = []
  for (let i = 0; i < width; i++) {
    const s = Math.floor((i / width) * vals.length)
    const e = Math.max(s + 1, Math.floor(((i + 1) / width) * vals.length))
    const v = Math.max(...vals.slice(s, e))
    out.push(BARS[Math.round(clamp((v - a) / Math.max(1e-6, b - a)) * (BARS.length - 1))] ?? '▁')
  }
  return out.join('')
}

function specLine(v: View, width = 64): string {
  return sparkline(v.avg, width, v.floor, Math.max(v.top, v.floor + 15))
}

function meterBar(level: number, n = 12): string {
  const k = Math.round(clamp(level) * n)
  return '▮'.repeat(k) + '▯'.repeat(n - k)
}

function sUnits(level: number): string {
  if (level >= 0.6) return `S9+${Math.round(((level - 0.6) / 0.4) * 40)}`
  return `S${Math.max(0, Math.round((level / 0.6) * 9))}`
}

// ---------------------------------------------------------------- the tuning strip (tuning-strip.tsx)
// The Client under the chart on the terminal and the desktop. Its props are the shown view cut
// down to STRIP_BINS slices per row, the tuner, the signals and the band's channel grid; its posts
// ({ type: 'tune', mhz, by } and { type: 'listen', mhz }) come back through 'ui.message'.

const STRIP_KEY = 'strip'
const STRIP_BINS = 240
const STRIP_PEAKS = 60
const STRIP_NAMES = 80
// Where a click with no signal near snaps: [lo, hi, mode, step, base] (MHz). FM channels sit on odd
// tenths, airband on 25 kHz, GMRS/FRS on 12.5 kHz; elsewhere 5 kHz in the band's mode (guessMode).
const CHANNEL_GRID: StripGrid[] = [
  [87.5, 108, 'wbfm', 0.2, 87.9],
  [108, 137, 'am', 0.025, 108],
  [156, 157.45, 'fm', 0.025, 156],
  [162.4, 162.55, 'fm', 0.025, 162.4],
  [433, 435, null, 0.005, 0],
  [462.5, 467.75, 'fm', 0.0125, 462.5],
  [902, 928, null, 0.0125, 902],
  [1085, 1095, null, 0.005, 0],
]

// The view's stretch of the grid, the gaps between filled in 5 kHz steps in the band's own mode.
function stripGrid(lo: number, hi: number): StripGrid[] {
  const segs = CHANNEL_GRID.filter(g => g[1] > lo && g[0] < hi).sort((a, b) => a[0] - b[0])
  const out: StripGrid[] = []
  let at = lo
  for (const g of segs) {
    if (g[0] > at) out.push([at, g[0], guessMode((at + g[0]) / 2), 0.005, 0])
    out.push([Math.max(lo, g[0]), Math.min(hi, g[1]), g[2], g[3], g[4]])
    at = Math.max(at, g[1])
  }
  if (at < hi) out.push([at, hi, guessMode((at + hi) / 2), 0.005, 0])
  return out
}

// The word printed over a signal on the strip: the chart's short label less its frequency ("WNNF",
// "KIH42", "calling"), or nothing for an unnamed one (it gets a tick).
function stripTag(p: Peak): string | null {
  if (!p.name) return null
  const t = shortLabel(p).replace(/^\d+(\.\d+)?\s*/, '')
  return t || null
}

// Every name the strip can offer for a spot with no signal on it: the known spots and FM calls in view.
function stripNames(v: View): [number, string][] {
  const out = new Map<string, [number, string]>()
  const add = (f: number, name: string) => {
    if (f >= v.start && f <= v.stop) out.set(f.toFixed(4), [Number(f.toFixed(6)), name])
  }
  for (const [f, , name] of KNOWN) add(f, name)
  if (v.start < 108 && v.stop > 87.5) {
    for (const [f, call] of Object.entries(FM_NAMES)) add(Number(f), `${f} ${call}`)
    for (const s of fmStations) add(s.mhz, s.name)
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]).slice(0, STRIP_NAMES)
}

function stripPropsOf(v: View, cols: number): StripProps {
  const [s0, s1] = v.scale ?? [v.floor - 4, v.top + 1]
  const span = s1 - s0 || 1
  const q = (vals: number[]) => poolTo(vals, STRIP_BINS).map(db => Math.round(clamp((db - s0) / span) * 255))
  const peaks: StripPeak[] = v.peaks
    .filter(p => !p.comb && !p.spur && p.mhz >= v.start && p.mhz <= v.stop)
    .sort((a, b) => b.above - a.above)
    .slice(0, STRIP_PEAKS)
    .sort((a, b) => a.mhz - b.mhz)
    .map(p => ({ mhz: Number(p.mhz.toFixed(6)), db: Math.round(p.above * 10) / 10, name: p.name, tag: stripTag(p), burst: p.kind === 'burst' }))
  const playing = st?.listen.running && typeof st.listen.freq === 'number' ? st.listen.freq : null
  return {
    start: v.start,
    stop: v.stop,
    label: v.label,
    live: !!v.live,
    pk: q(v.max?.length ? v.max : v.avg),
    av: q(v.avg),
    lo: Math.round(s0 * 10) / 10,
    hi: Math.round(s1 * 10) / 10,
    floor: Math.round(v.floor * 10) / 10,
    tuned: Number((tuner.hz / 1e6).toFixed(6)),
    mode: tuner.mode,
    step: tuner.step / 1e6,
    playing,
    busy,
    peaks,
    names: stripNames(v),
    grid: stripGrid(v.start, v.stop),
    cols: Math.max(20, Math.round(cols)),
    rev: stripRev,
  }
}

// The mode a strip tune takes: the signal's own (radio.py names it) where one is there, else the band's.
function stripModeAt(f: number): Mode | null {
  const v = shownView()
  const p = v?.peaks.find(q => q.listen && Math.abs(q.mhz - f) < Math.max(0.0005, v.binHz / 1e6))
  const m = p?.listen
  return m === 'wbfm' || m === 'fm' || m === 'am' ? m : guessMode(f)
}

// A post from the strip is code's word, not a fact: only these two shapes, a frequency in the V4's range.
function parseStripMessage(data: unknown): StripMessage | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const f = d.mhz
  const inRange = typeof f === 'number' && Number.isFinite(f) && f >= 0.5 && f <= 1766
  if (d.type === 'tune') {
    if (!inRange) return null
    const by = d.by === 'key' || d.by === 'peak' ? d.by : 'click'
    return { type: 'tune', mhz: f as number, by }
  }
  if (d.type === 'listen') {
    if (f !== undefined && !inRange) return null
    return { type: 'listen', mhz: inRange ? (f as number) : tuner.hz / 1e6 }
  }
  return null
}

// Moves the tuner where the strip said. A ← → step in the same mode keeps squelch, gain and step
// (as ▲ ▼ do); anything else is /sdr tune's setTuner. Playing, the V4 retunes once the posts stop.
function stripTune($: any, f: number, by: 'click' | 'key' | 'peak'): void {
  const mode = stripModeAt(f)
  if (by === 'key' && (mode ?? 'fm') === tuner.mode) tuner = { ...tuner, hz: Math.round(f * 1e6) }
  else setTuner(f, mode)
  tunerChanged($)
}

// ---------------------------------------------------------------- text (the phone reads these)

function deviceLine(d: Device, now: number): string {
  return `${d.model}${d.channel !== null && d.channel !== undefined && d.channel !== '' ? ` ch ${d.channel}` : ''} · ${d.kind} · ${ago(d.last, now)}${d.say ? ` · ${d.say}` : ''}${d.lowBattery ? ' · LOW BATTERY' : ''} · heard ${d.count}×`
}

function peakLine(p: Peak): string {
  return `${mhz(p.mhz).padStart(8)} MHz  +${p.above.toFixed(0).padStart(2)} dB  ${p.kind === 'burst' ? 'bursts' : 'steady'}  ${peakName(p)}`
}

function deviceText(): string {
  const s = st
  if (!s) return 'Checking the RTL-SDR…'
  if (!s.device.present) return 'RTL-SDR Blog V4: not found. Plug it into the Mac.'
  if (s.state === 'busy' && s.owner) return `RTL-SDR Blog V4: in use by ${s.owner.app} (pid ${s.owner.pid}). The V4 can be used by one program at a time: close ${s.owner.app} first.`
  const hold = s.holder
  return `RTL-SDR Blog V4: connected · ${hold?.ours ? `in use by ${holderText(hold)} · /sdr stop frees it` : 'free'}`
}

// "Planes · ADS-B on 1090 MHz · since 21:04"
function holderText(h: Holder): string {
  return `${h.label}${h.detail ? ` · ${h.detail}` : ''}${h.since ? ` · since ${clockOf(h.since)}` : ''}`
}

// A job's name in a sentence: its label from radio.py, lower-cased unless it is a name (APRS, Web SDR).
function kindLabel(kind: string): string {
  const fixed: Record<string, string> = { listen: 'the audio', share: 'sharing with the phone', live: 'the live view', gadgets: 'the gadget listener', adsb: 'Planes', aprs: 'APRS', same: 'Weather alerts', webrx: 'Web SDR' }
  return fixed[kind] ?? st?.jobs?.[kind]?.label ?? kind
}

function shareWhere(s: Status['share']): string {
  const port = s.port ?? 1234
  const w: string[] = []
  if (s.tailscale && (s.addr === '0.0.0.0' || s.addr === s.tailscale)) w.push(`${s.tailscale}:${port} (Tailscale, works away from home)`)
  if (s.lan && (s.addr === '0.0.0.0' || s.addr === s.lan)) w.push(`${s.lan}:${port} (home Wi-Fi)`)
  return w.join(' or ')
}

function bandName(b?: string | null): string {
  return b === '915' ? '915 MHz' : b === 'hop' ? '433.92 + 915 MHz' : '433.92 MHz'
}

function tunerLine(): string {
  const playing = st?.listen.running
  const name = nameAt(tuner.hz / 1e6)
  const m = playing ? meter : null
  const sig = m ? (m.weak ? ' · weak signal — try the antenna by a window' : m.squelch === 'closed' ? ' · squelch closed' : ` · signal ${meterBar(m.level, 8)} ${sUnits(m.level)}`) : ''
  return `Tuner ${mhz(tuner.hz / 1e6)} MHz ${modeChip(tuner.mode)}${name ? ` (${name})` : ''} · ${playing ? `playing${sig}` : 'not playing'}`
}

function meshLine(m?: Mesh): string {
  if (!m) return ''
  const s = (ch: MeshChan) => `${ch.name.replace(' LongFast', '')} ${ch.state === 'unknown' ? 'no data yet' : `${ch.state} (${ch.bursts} burst${ch.bursts === 1 ? '' : 's'}, ${ch.perMin}/min)`}`
  return `Mesh (last hour, ${Math.round(m.seconds / 60)} min listened): ${s(m.mt)} · ${s(m.mc)}`
}

function bandsText(now: number): string {
  const act = st?.activity ?? {}
  return BANDS.map(b => {
    const a = act[b.id]
    return `  ${b.label.padEnd(18)} ${a ? `${String(a.n).padStart(2)} signals, best +${a.best.toFixed(0)} dB, ${ago(a.at, now)}${a.named.length ? ` · ${a.named.slice(0, 2).join(', ')}` : ''}` : '–  not scanned yet'}`
  }).join('\n')
}

function report(now: number): string {
  const lines: string[] = [deviceText()]
  const s = st
  lines.push(tunerLine())
  if (s?.live?.running) {
    const v = liveFrame
    const top = v ? [...v.peaks].filter(p => p.name && !p.comb && !p.spur).sort((a, b) => b.above - a.above).slice(0, 4) : []
    lines.push(`Live view on: ${s.live.label ?? ''}${v ? ` · ${v.peaks.length} signals${top.length ? `, strongest ${top.map(p => shortLabel(p) || p.name).join(', ')}` : ''}` : ''} · /sdr live off`)
  } else if (liveNote) lines.push(liveNote)
  if (s?.share.running) lines.push(`Sharing with rtl_tcp: ${shareWhere(s.share)} · /sdr share off`)
  const g = gadgets
  if (s?.gadgets.running || g?.running) {
    const recent = (g?.devices ?? []).filter(d => now - d.last < 3_600_000)
    const lows = g?.hood?.lowBattery ?? []
    lines.push(`Gadget listener on (${bandName(s?.gadgets.band ?? g?.band)}) · ${recent.length} heard in the last hour${lows.length ? ` · ${lows.length} low batter${lows.length === 1 ? 'y' : 'ies'}` : ''}`)
  } else lines.push(`Gadget listener off${gadgetsWanted ? ' for now (it comes back when the V4 is free)' : ''} · /sdr gadgets on`)
  for (const d of (g?.devices ?? []).slice(0, 6)) lines.push(`  ${deviceLine(d, now)}`)
  if (s?.mesh) lines.push(meshLine(s.mesh))
  const v = shownView()
  if (v && !v.live) {
    lines.push(`Last scan: ${v.label} at ${clockOf(v.at)} · noise floor ${v.floor.toFixed(0)} dB · ${v.peaks.length} signals`)
    lines.push(`  ${mhz(v.start)} ${specLine(v, 48)} ${mhz(v.stop)} MHz`)
    const top = [...v.peaks].filter(p => !p.comb && !p.spur).sort((a, b) => b.above - a.above).slice(0, 8)
    for (const p of top.sort((a, b) => a.mhz - b.mhz)) lines.push(`  ${peakLine(p)}`)
  }
  for (const sec of sortedSections()) {
    const t = sec.text?.(ctxBase(now))
    if (t) lines.push(t)
  }
  if (note) lines.push(note)
  lines.push(COMMANDS_LINE)
  return lines.join('\n')
}

function scanText(v: View): string {
  const lines = [`${mhz(v.start)} ${specLine(v, 48)} ${mhz(v.stop)} MHz · noise floor ${v.floor.toFixed(0)} dB · ${clockOf(v.at)}`]
  for (const p of v.peaks) lines.push(peakLine(p) + (p.listen ? `  (/sdr listen ${mhz(p.mhz)}${p.listen === 'wbfm' ? '' : ` ${p.listen}`})` : ''))
  return lines.join('\n')
}

function gadgetsText(now: number): string {
  const g = gadgets
  if (!g) return 'No gadget list yet.'
  const h = g.hood
  const head = `Gadget listener ${g.running ? `on (${bandName(g.band)})` : 'off'} · ${g.total} device${g.total === 1 ? '' : 's'} heard so far`
  const hood = h ? `Neighbourhood: ${h.day} heard today, ${h.hour} in the last hour${h.lowBattery.length ? ` · low battery: ${h.lowBattery.join(', ')}` : ''}${h.newest ? ` · newest ${h.newest.model} (${ago(h.newest.first, now)})` : ''}` : ''
  if (!g.devices.length) return `${head}\nNothing heard yet. Sensors report every 15 s to a few minutes; tire sensors only while a car goes by.`
  return [head, ...(hood ? [hood] : []), ...g.devices.slice(0, 15).map(d => `  ${deviceLine(d, now)}${d.hist && d.hist.length > 2 && d.tempF !== null ? `  ${sparkline(d.hist.filter(p => p[1] !== null).map(p => p[1] as number), 16)}` : ''}`)].join('\n')
}

function stoppedText(list: Stopped[] | undefined): string {
  const bits = (list ?? []).map(s =>
    s.kind === 'listen' ? `stopped playing ${s.label ?? `${s.freq} MHz`}` : s.kind === 'share' ? 'stopped sharing with the phone' : s.kind === 'live' ? `stopped the live view of ${s.label ?? 'the band'}` : s.kind === 'gadgets' ? 'paused the gadget listener' : `stopped ${kindLabel(s.kind)}`,
  )
  return bits.length ? ` (${bits.join(', ')}: the V4 does one thing at a time)` : ''
}

// What a start stopped, kept for the Resume buttons (the gadget listener comes back by itself).
function rememberStopped(started: string, list: Stopped[] | undefined): void {
  const got = (list ?? []).filter(s => s.kind !== 'gadgets' && s.kind !== started)
  restore = restore
    .filter(r => r.kind !== started && !got.some(g => g.kind === r.kind))
    .concat(got)
    .slice(-3)
}

function resumeLabel(r: Stopped): string {
  return r.kind === 'listen' ? `Resume ${r.label ?? `${r.freq} MHz`}` : r.kind === 'share' ? 'Share again' : r.kind === 'live' ? `Resume live (${r.label ?? 'band'})` : `Resume ${kindLabel(r.kind)}`
}

// ---- the tuner's stations

function shortName(name: string): string {
  return name.split(' ').slice(0, 2).join(' ')
}

function fmPresets(): Preset[] {
  const known = Object.entries(FM_NAMES).map(([f, n]) => ({ mhz: Number(f), label: `${f} ${n}`, mode: 'wbfm' as Mode }))
  const heard = fmStations.filter(f => !/ FM$/.test(f.name)).map(f => ({ mhz: f.mhz, label: shortName(f.name), mode: 'wbfm' as Mode, above: f.above ?? 0 }))
  return heard.length ? [...heard].sort((a, b) => (b.above ?? 0) - (a.above ?? 0)) : known
}

function airPresets(): Preset[] {
  const v = shownView()
  const heard = v?.preset === 'air' ? [...v.peaks].filter(p => !p.comb && !p.spur).sort((a, b) => b.above - a.above).slice(0, 5) : []
  return [...heard.map(p => ({ mhz: p.mhz, label: `${mhz(p.mhz)} ${p.kind === 'burst' ? 'heard' : 'steady'}`, mode: 'am' as Mode, above: p.above })), ...FIXED.air]
}

function railPresets(): Preset[] {
  const v = shownView()
  return v?.preset === 'rail' ? [...v.peaks].filter(p => !p.comb && !p.spur).sort((a, b) => b.above - a.above).slice(0, 4).map(p => ({ mhz: p.mhz, label: `${mhz(p.mhz)} rail`, mode: 'fm' as Mode })) : []
}

function favPresets(): Preset[] {
  const list = [...recentStations]
  if (!list.some(p => Math.abs(p.mhz - NOAA.mhz) < 0.001)) list.push(NOAA)
  return list.slice(0, 9)
}

function presetsFor(tab: StationTab): Preset[] {
  if (tab === 'fav') return favPresets()
  if (tab === 'fm') return fmPresets()
  if (tab === 'air') return airPresets()
  if (tab === 'water') return [...FIXED.water, ...railPresets()]
  return FIXED[tab]
}

function strongestFm(): Preset {
  if (fmStations.length) return fmPresets()[0]!
  const first = Object.entries(FM_NAMES).find(([f]) => f === '94.1') ?? Object.entries(FM_NAMES)[0]
  return first ? { mhz: Number(first[0]), label: `${first[0]} ${first[1]}`, mode: 'wbfm' } : { mhz: 94.1, label: '94.1 FM', mode: 'wbfm' }
}

function noteListened(f: number, mode: Mode, label?: string | null): void {
  const known = [...Object.values(FIXED).flat(), ...fmPresets()].find(p => Math.abs(p.mhz - f) < 0.0005)
  if (known) {
    recentStations = [{ ...known, mode, at: Date.now() }, ...recentStations.filter(p => Math.abs(p.mhz - f) > 0.0005)].slice(0, 8)
    return
  }
  const plain = (label ?? '').replace(/\s*\(.*\)$/, '')
  const name = !plain || /MHz$/.test(plain) ? mhz(f) : /^\d/.test(plain) ? shortName(plain) : `${mhz(f)} ${plain.split(' ').slice(0, 3).join(' ')}`
  recentStations = [{ mhz: f, label: name.length > 22 ? name.slice(0, 21) + '…' : name, mode, at: Date.now() }, ...recentStations.filter(p => Math.abs(p.mhz - f) > 0.0005)].slice(0, 8)
}

function exitText(label: string, ex: Exit): string {
  if (!ex || ex.reason === 'stopped') return ''
  if (ex.reason === 'done') return ex.detail
  if (ex.reason === 'preempted') return `${label} ${ex.detail}.`
  if (/^Stopped /.test(ex.detail)) return `${label} s${ex.detail.slice(1)}`
  return `${label} stopped: ${ex.detail || ex.reason}`
}

// ---------------------------------------------------------------- the script: lanes, presses, the timing log

// Background work never rejects into the void (a reload or a test ending under it).
function bg(p: Promise<unknown>): void {
  p.catch(() => undefined)
}

// Processes run in lanes. The V4 lane runs one process at a time: a press's first ('action'), the
// polls after it ('poll': only while no press runs or waits, and one already queued is not queued
// twice). Read-only calls that never touch the V4 (radio.py status, webrx/status.sh, ~0.4-0.8 s)
// run in the free lane beside it, so a press never waits behind them; a free read that comes back
// after a press started or ended is dropped (the press's own read is newer). radio.py's lock
// (sdr.lock) still keeps every V4 command to one at a time.
export type Lane = 'action' | 'poll' | 'free'
type Proc = { lane: 'action' | 'poll'; id: string; argv: string[]; timeoutMs: number; resolve: (v: any) => void; reject: (e: unknown) => void; promise: Promise<any>; waitedOn: boolean }
const actionQ: Proc[] = []
const pollQ: Proc[] = []
let procNow: Proc | null = null
const freeNow = new Map<string, Promise<any>>()

// "radio.py listen meter", "status.sh": a process by what it is, for the poll queue and the log.
function procId(argv: string[]): string {
  return argv
    .filter(a => a !== 'python3')
    .map(a => (a.includes('/') ? a.split('/').pop() ?? a : a))
    .join(' ')
}

// A process's stdout as JSON (or { ok: false, say }).
async function spawnJson($: any, argv: string[], timeoutMs: number): Promise<any> {
  const r = await $.process.run(argv, { env: { PATH, HOME }, timeoutMs })
  try {
    return JSON.parse(r.stdout)
  } catch {
    return { ok: false, say: (r.stderr || r.stdout || `exit ${r.exitCode}`).trim().split('\n').slice(-1)[0] }
  }
}

function runJson($: any, argv: string[], timeoutMs: number, lane: Lane = 'action'): Promise<any> {
  const id = procId(argv)
  if (lane === 'free') {
    const same = freeNow.get(id)
    if (same) return same
    const t0 = Date.now()
    const g = gen
    // Read before a press started or ended (or while one runs): stale for everyone who asked.
    const p = spawnJson($, argv, timeoutMs)
      .then(res => (gen !== g || current ? { ok: false, stale: true, say: 'read while a press ran' } : res))
      .finally(() => {
        freeNow.delete(id)
        notePoll($, id, Date.now() - t0, 'free', false)
      })
    freeNow.set(id, p)
    return p
  }
  if (lane === 'poll') {
    // One of a kind: the same poll queued or running already answers this one too.
    const same = pollQ.find(q => q.id === id) ?? (procNow?.lane === 'poll' && procNow.id === id ? procNow : undefined)
    if (same) return same.promise
  }
  let resolve: (v: any) => void = () => undefined
  let reject: (e: unknown) => void = () => undefined
  const promise = new Promise<any>((a, b) => {
    resolve = a
    reject = b
  })
  const job: Proc = { lane, id, argv, timeoutMs, resolve, reject, promise, waitedOn: false }
  if (lane === 'action') {
    actionQ.push(job)
    if (procNow?.lane === 'poll') procNow.waitedOn = true
  } else pollQ.push(job)
  pump($)
  return promise
}

// The next process on the V4 lane: a press's before any poll, and no poll while a press runs or waits.
function pump($: any): void {
  if (procNow) return
  const job = actionQ.shift() ?? (current || pending ? undefined : pollQ.shift())
  if (!job) return
  procNow = job
  const t0 = Date.now()
  spawnJson($, job.argv, job.timeoutMs)
    .then(job.resolve, job.reject)
    .finally(() => {
      procNow = null
      if (job.lane === 'poll') notePoll($, job.id, Date.now() - t0, 'v4', job.waitedOn)
      pump($)
    })
}

async function pyScript($: any, name: string, args: string[], timeoutMs = 20_000, lane: Lane = 'action'): Promise<any> {
  return runJson($, ['python3', `${$.plugin.root}/scripts/${name}`, ...args], timeoutMs, lane)
}

async function script($: any, args: string[], timeoutMs = 20_000, lane: Lane = 'action'): Promise<any> {
  return pyScript($, 'radio.py', args, timeoutMs, lane)
}

// ---- presses: one press is one intent. One runs at a time; one more waits, and the newest press
// replaces it (the last click wins); the same press again joins the one running or waiting. The
// button shows it at once ("Starting Planes…", "Queued: …") and the top says what it is doing.

/** What intent() resolves to: it ran, it joined the same request already running or waiting, or a newer press replaced it while it waited. */
export type ActEnd = 'ran' | 'joined' | 'superseded'
/** A press's first step in plain words and how long it should take (`id` groups timings for the estimate). */
export type Plan = { step: string; ms: number; id?: string }
/** key: what the press asks for ("job adsb on"; the same key is the same request), plan: its step and duration. */
export type ActOpts = { key?: string; plan?: () => Plan }
type Intent = {
  key: string
  label: string
  job: () => Promise<unknown>
  plan?: () => Plan
  pressedAt: number
  startedAt: number
  step: string
  expectMs: number
  planId: string
  queued: boolean
  coalesced: number
  failed: string
  done: Promise<ActEnd>
  end: (r: ActEnd) => void
}
let current: Intent | null = null
let pending: Intent | null = null
// Bumped as a press starts and ends: a free-lane read issued before then is stale.
let gen = 0
// How long each kind of press took this session (the "about N s" after the first time).
const learned = new Map<string, number>()

function intent($: any, label: string, job: () => Promise<unknown>, opts: ActOpts = {}): Promise<ActEnd> {
  const key = opts.key ?? label
  if (current?.key === key) {
    current.coalesced++
    return current.done.then(() => 'joined' as const)
  }
  if (pending?.key === key) {
    pending.coalesced++
    return pending.done.then(r => (r === 'ran' ? 'joined' : r))
  }
  let end: (r: ActEnd) => void = () => undefined
  const done = new Promise<ActEnd>(r => (end = r))
  const it: Intent = { key, label, job, plan: opts.plan, pressedAt: Date.now(), startedAt: 0, step: '', expectMs: 0, planId: key, queued: false, coalesced: 0, failed: '', done, end }
  if (current) {
    if (pending) supersede($, pending, it)
    it.queued = true
    pending = it
    $.ui.invalidate('ui.render')
    return done
  }
  begin($, it)
  return done
}

function supersede($: any, it: Intent, by: Intent): void {
  const now = Date.now()
  logLine($, { at: iso(it.pressedAt), action: it.label, key: it.key, pressedAt: it.pressedAt, startedAt: null, finishedAt: now, waitMs: now - it.pressedAt, queued: true, coalesced: it.coalesced, ok: null, superseded: true, by: by.label })
  it.end('superseded')
}

function begin($: any, it: Intent): void {
  current = it
  gen++
  busy = it.label
  it.startedAt = Date.now()
  let p: Plan = { step: 'working on it', ms: 2000 }
  try {
    p = it.plan?.() ?? p
  } catch {}
  it.step = p.step
  it.planId = p.id ?? it.key
  it.expectMs = learned.get(it.planId) ?? p.ms
  $.ui.invalidate('ui.render')
  bg(runIntent($, it))
}

async function runIntent($: any, it: Intent): Promise<void> {
  let ok = true
  try {
    if ((await it.job()) === false || it.failed) ok = false
  } catch (err: any) {
    ok = false
    it.failed = String(err?.message ?? err)
    note = `${it.label} failed: ${it.failed}`
  }
  const end = Date.now()
  const runMs = end - it.startedAt
  if (ok) learned.set(it.planId, Math.round(learned.has(it.planId) ? ((learned.get(it.planId) ?? runMs) + runMs) / 2 : runMs))
  logLine($, { at: iso(it.pressedAt), action: it.label, key: it.key, pressedAt: it.pressedAt, startedAt: it.startedAt, finishedAt: end, waitMs: it.startedAt - it.pressedAt, runMs, expectMs: it.expectMs, step: it.step, queued: it.queued, coalesced: it.coalesced, ok, ...(it.failed ? { failed: it.failed.slice(0, 200) } : {}) })
  if (!ok) $.ui.toast(`${it.label}: ${it.failed || 'it did not work'}`, { timeoutMs: 6000 })
  current = null
  gen++
  busy = ''
  it.end('ran')
  const next = pending
  pending = null
  if (next) begin($, next)
  else pump($)
  $.ui.invalidate('ui.render')
}

// A job's way to say its press did not work (its note says why): the press ends with a toast.
function failed(text: string): false {
  if (current) current.failed = text || 'it did not work'
  return false
}

// Starting something on the V4 first stops whatever holds it (Web SDR's container takes seconds).
const STOP_MS: Record<string, number> = { webrx: 5000, live: 1000, listen: 800, gadgets: 1000, share: 800, adsb: 1000, aprs: 1000, same: 1000 }
function takeover(id: string, doing: string, ms: number, own?: string): Plan {
  const h = st?.holder
  const kind = h?.ours && h.kind && h.kind !== own ? h.kind : null
  if (!kind) return { id, step: doing, ms }
  return { id: `${id} after ${kind}`, step: `stopping ${kindLabel(kind)} first`, ms: ms + (STOP_MS[kind] ?? 1000) }
}

// "Starting Planes: stopping Web SDR first (about 6 s)"
function doingLine(): string {
  return current ? `${current.label}: ${current.step} (about ${Math.max(1, Math.round(current.expectMs / 1000))} s)` : ''
}

function queuedLine(): string {
  return pending ? `Queued: ${pending.label}, runs next${pending.coalesced ? ` (pressed ${pending.coalesced + 1}×, runs once)` : ''}` : ''
}

// What a press asks for, the same key at the button (to show it) and in the action (to run it).
function resolveMode(f: number, mode?: string | null): Mode {
  return ((MODES_ROW as string[]).includes(mode ?? '') ? (mode as Mode) : guessMode(f)) ?? 'fm'
}
const K = {
  listen: (f: number, mode?: string | null) => `listen ${mhz(f)} ${resolveMode(f, mode)}`,
  stopListen: 'listen stop',
  retune: 'retune',
  scan: (preset: string, range?: [number, number]) => (range ? `scan ${range[0]}-${range[1]}` : `scan ${preset}`),
  live: (want: boolean, preset?: string, range?: [number, number]) => (want ? `live ${range ? `${range[0]}-${range[1]}` : preset ?? shownView()?.preset ?? lastPreset}` : 'live off'),
  liveReset: 'live reset',
  gadgets: (want: boolean) => `gadgets ${want ? 'on' : 'off'}`,
  share: (want: boolean) => `share ${want ? 'on' : 'off'}`,
  job: (kind: string, want: boolean) => `job ${kind} ${want ? 'on' : 'off'}`,
  stopAll: 'stop all',
  handoff: 'handoff',
  rec: (want: boolean) => `rec ${want ? 'on' : 'off'}`,
  log: (want: boolean) => `log ${want ? 'on' : 'off'}`,
  record: (f: number) => `record ${mhz(f)}`,
  play: (file: string) => `play ${file}`,
  playStop: 'play stop',
  trash: (file: string) => `trash ${file}`,
  reveal: 'rec reveal',
  sync: 'web sync',
  alertsTest: 'alerts test',
  // 0.4.0: the Scanner, Radio settings and IQ snapshots
  scanner: (want: boolean) => `scanner ${want ? 'on' : 'off'}`,
  scanHold: 'scan hold',
  scanResume: 'scan resume',
  scanSkip: 'scan skip',
  scanLock: (f: number) => `scan lockout ${mhz(f)}`,
  scanUnlock: (f: number) => `scan unlock ${mhz(f)}`,
  scanPri: (f: number) => `scan priority ${mhz(f)}`,
  scanPriOff: 'scan priority off',
  scanAdd: (f: number) => `scan add ${mhz(f)}`,
  ppm: (v: number) => `set ppm ${v}`,
  filter: (m: string, hz: number) => `set filter ${m} ${hz}`,
  biast: (want: boolean) => `biast ${want ? 'on' : 'off'}`,
  hfTest: 'hf test',
  hfConfirm: 'hf confirm',
  calibrate: 'calibrate',
  snapshot: (f: number, s: number) => `snapshot ${mhz(f)} ${s}`,
  snapWf: (file: string) => `snapshot waterfall ${file}`,
  snapDecode: (file: string) => `snapshot decode ${file}`,
  snapTrash: (file: string) => `snapshot delete ${file}`,
}

type Look = { label: string; variant?: 'primary'; dimColor?: boolean }
// A button for the press it makes: primary "<doing>…" while that runs, dim "Queued: …" while it waits.
function look(keys: string | string[], idle: string, doing?: string, queued?: string): Look {
  const ks = typeof keys === 'string' ? [keys] : keys
  if (current && ks.includes(current.key)) return { label: doing ?? `${current.label}…`, variant: 'primary' }
  if (pending && ks.includes(pending.key)) return { label: queued ?? `Queued: ${pending.label}`, dimColor: true }
  return { label: idle }
}

// A Look as Button props, leaving out what it does not set (a Button's own variant stays).
function lookProps(l: Look): { label: string; variant?: 'primary'; dimColor?: boolean } {
  return { label: l.label, ...(l.variant ? { variant: l.variant } : {}), ...(l.dimColor ? { dimColor: true } : {}) }
}

// The press a Resume button makes (resume() below), by what was stopped.
function resumeKey(r: Stopped): string {
  if (r.kind === 'listen' && r.freq) return K.listen(r.freq, r.mode)
  if (r.kind === 'share') return K.share(true)
  if (r.kind === 'live') return K.live(true, r.preset ?? lastPreset, r.preset === 'custom' && r.lo && r.hi ? [r.lo, r.hi] : undefined)
  return K.job(r.kind, true)
}

// The Walton values above are the defaults. A location.json in use replaces them: the FM names, the
// weather-radio station, the repeaters and the words in the band help.
// `radio.py location` reads files only (it never opens the dongle): the location file, if there is one.
async function loadLocation($: any): Promise<void> {
  try {
    applyLocation(await script($, ['location'], 10_000, 'free'))
    if (LOC.error) $.ui.toast(`Radio: ${LOC.error}`)
  } catch {
    // The default (Walton) stays.
  }
  $.ui.invalidate('ui.render')
}

const LOC_DEFAULT: Loc = { ...LOC, repeaters: LOC.repeaters.map(r => ({ ...r })) }
const FM_DEFAULT: Record<string, string> = { ...FM_NAMES }
const FIXED_DEFAULT = { wx: [...FIXED.wx], ham: [...FIXED.ham] }
const HELP_DEFAULT: Record<string, string> = Object.fromEntries(BANDS.map(b => [b.id, b.help]))

function applyLocation(r: any): void {
  const l = r?.location
  const error = typeof r?.error === 'string' ? r.error : null
  if (!r?.custom || !l || typeof l !== 'object') {
    // No usable file: Walton, exactly as built in (also undoes an earlier custom one).
    LOC = { ...LOC_DEFAULT, repeaters: LOC_DEFAULT.repeaters.map(x => ({ ...x })), error }
    for (const k of Object.keys(FM_NAMES)) delete FM_NAMES[k]
    Object.assign(FM_NAMES, FM_DEFAULT)
    NOAA.mhz = LOC.wxFreq
    NOAA.label = `${wxFreqText()} NOAA`
    buildKnown()
    FIXED.wx = [...FIXED_DEFAULT.wx]
    FIXED.ham = [...FIXED_DEFAULT.ham]
    for (const b of BANDS) b.help = HELP_DEFAULT[b.id] ?? b.help
    return
  }
  const w = l.weather ?? {}
  LOC = {
    ...LOC,
    name: String(l.name ?? LOC.name),
    short: String(l.short ?? LOC.short),
    wxStation: String(w.station ?? ''),
    wxCity: String(w.city ?? ''),
    wxFreq: Number(w.freq) || 162.55,
    riverName: String(l.river?.name ?? ''),
    error,
    repeaters: Array.isArray(l.repeaters) ? l.repeaters.map((x: any) => ({ mhz: Number(x.mhz), name: String(x.name), short: x.short ? String(x.short) : undefined, mark: !!x.mark, wx: !!x.wx })) : [],
  }
  for (const k of Object.keys(FM_NAMES)) delete FM_NAMES[k]
  for (const [f, n] of Object.entries(l.fm ?? {})) FM_NAMES[Number(f).toFixed(1)] = String(n).split(' ')[0] ?? ''
  NOAA.mhz = LOC.wxFreq
  NOAA.label = `${wxFreqText()} NOAA`
  buildKnown()
  FIXED.wx = [NOAA, ...LOC.repeaters.filter(x => x.wx).map(repPreset)]
  FIXED.ham = [
    { mhz: 146.52, label: '146.520 calling', mode: 'fm' },
    ...LOC.repeaters.map(repPreset),
    { mhz: 446.0, label: '446.000 calling', mode: 'fm' },
  ]
  const reps = LOC.repeaters.map(x => `${x.mhz.toFixed(3)} ${repShort(x)}`).join(', ')
  const help = (id: string, text: string): void => {
    const b = BANDS.find(x => x.id === id)
    if (b) b.help = text
  }
  help('fm', '87.5–108 MHz, the FM broadcast stations. Each tall spike is a station; small bumps on its shoulders are its digital HD Radio sidebands.')
  help('air', '118–137 MHz, pilots and controllers in AM voice. Calls are short, so they show as dots in the waterfall and in the peak-hold line, not the average.')
  help('2m', `144–148 MHz, amateur radio. ${reps ? `Repeaters (${reps}) light up only while someone talks; ` : 'Repeaters light up only while someone talks; '}146.520 is the calling frequency.`)
  help('marine', `Marine VHF.${LOC.riverName ? ` Towboats on the ${LOC.riverName} call bridges and locks on ch 13 (156.650) and hail on ch 16 (156.800).` : ' Ch 13 (156.650) is bridge-to-bridge and ch 16 (156.800) is distress and calling.'} Quiet unless a boat is talking.`)
  help('noaa', `162.40–162.55 MHz, NOAA Weather Radio.${LOC.wxStation ? ` ${LOC.wxStation}${LOC.wxCity ? ` in ${LOC.wxCity}` : ''} on ${wxFreqText()} is the local one and talks around the clock;` : ''} weaker spikes are transmitters farther away.`)
  help('adsb', '1090 MHz: every airliner’s transponder (ADS-B and Mode S) answers here many times a second. The spectrum shows the burst energy; airport traffic keeps it busy.')
}

// ---- the timing log: one JSON line per press (and per slow poll) in actions.jsonl, the last 1000

let ACTIONS_LOG = '' // set by setHome

// Every path under the home folder, set at session.start once HOME is known.
function setHome(home: string): void {
  HOME = home
  EQ_FILE = `${HOME}/Library/Application Support/radio/eq.json`
  HANDOFF_FILE = `${HOME}/Library/Application Support/radio/handoff.json`
  ACTIONS_LOG = `${HOME}/Library/Application Support/radio/actions.jsonl`
}
const LOG_MAX = 1000
const POLL_LOG_MS = 300
let logLines: string[] | null = null
let logLoad: Promise<void> | null = null
let logFlush: { cancel: () => void } | null = null
const pollLogged = new Map<string, number>()

function iso(t: number): string {
  try {
    return new Date(t).toISOString()
  } catch {
    return String(t)
  }
}

function logLine($: any, rec: Record<string, unknown>): void {
  bg(
    (async () => {
      if (!logLines) {
        logLoad ??= (async () => {
          let text = ''
          try {
            text = String(await $.fs.read(ACTIONS_LOG))
          } catch {}
          logLines = text.split('\n').filter(Boolean).slice(-LOG_MAX)
        })()
        await logLoad
      }
      const lines = logLines ?? []
      lines.push(JSON.stringify(rec))
      if (lines.length > LOG_MAX) lines.splice(0, lines.length - LOG_MAX)
      logLines = lines
      if (!logFlush) logFlush = $.clock.after(1000, () => bg(flushLog($)))
    })(),
  )
}

async function flushLog($: any): Promise<void> {
  logFlush = null
  if (logLines) await $.fs.write(ACTIONS_LOG, `${logLines.join('\n')}\n`)
}

// A poll over 300 ms: always when a press waited behind it, else at most once in 10 min per kind.
function notePoll($: any, id: string, ms: number, lane: string, blocked: boolean): void {
  if (ms < POLL_LOG_MS) return
  const now = Date.now()
  if (!blocked && now - (pollLogged.get(id) ?? 0) < 600_000) return
  pollLogged.set(id, now)
  logLine($, { at: iso(now), poll: id, ms, lane, ...(blocked ? { delayedAPress: true } : {}) })
}

async function loadStore($: any): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const p = await $.store.get('lastPreset')
    if (typeof p === 'string' && bandOf(p)) lastPreset = p
    const g = await $.store.get('gadgetsOn')
    if (typeof g === 'boolean') gadgetsWanted = g
    const t = await $.store.get('toastedUpTo')
    if (typeof t === 'number') toastedUpTo = t
    const f = await $.store.get('fmStations')
    if (Array.isArray(f)) fmStations = f as Station[]
    const tu = await $.store.get('tuner')
    if (tu && typeof tu === 'object' && typeof (tu as Tuner).hz === 'number') tuner = { ...tuner, ...(tu as Tuner) }
    const tab = await $.store.get('stationTab')
    if (typeof tab === 'string' && STATION_TABS.some(([k]) => k === tab)) stationTab = tab as StationTab
    const rec = await $.store.get('recentStations')
    if (Array.isArray(rec)) recentStations = (rec as Preset[]).filter(p => typeof p?.mhz === 'number' && typeof p.label === 'string')
    const sh = await $.store.get('startHereClosed')
    if (typeof sh === 'boolean') startHereClosed = sh
    const rg = await $.store.get('planesRange')
    if (typeof rg === 'string' && PLANE_RANGES.includes(rg)) planesRange = rg
    const ps = await $.store.get('peakSort')
    if (ps === 'freq' || ps === 'strength') peakSort = ps
  } catch {}
}

async function saveStore($: any): Promise<void> {
  try {
    await $.store.set('lastPreset', lastPreset)
    await $.store.set('gadgetsOn', gadgetsWanted)
    await $.store.set('toastedUpTo', toastedUpTo)
    await $.store.set('fmStations', fmStations)
    await $.store.set('tuner', tuner)
    await $.store.set('stationTab', stationTab)
    await $.store.set('recentStations', recentStations)
    await $.store.set('startHereClosed', startHereClosed)
    await $.store.set('planesRange', planesRange)
    await $.store.set('peakSort', peakSort)
  } catch {}
}

function pushStatus($: any, now: number): void {
  const s = st
  const parts: string[] = []
  if (s?.listen.running) parts.push(`▶ ${s.listen.label ?? `${s.listen.freq} MHz`}${meter && !meter.weak && meter.squelch !== 'closed' ? ` ${sUnits(meter.level)}` : meter?.weak ? ' (weak)' : ''}`)
  const rl = recLiveNow()
  if (rl) parts.push(`● rec ${dur(rl.seconds)}`)
  if (recs?.log.on) parts.push(`log ${recs.log.count}`)
  if (s?.live?.running) parts.push(`◉ live ${s.live.label ?? ''}`.trim())
  if (s?.share.running) parts.push(`sharing on :${s.share.port ?? 1234}`)
  for (const [k, j] of Object.entries(s?.jobs ?? {})) {
    if (!j.running || ['gadgets', 'listen', 'share', 'live'].includes(k)) continue
    if (k === 'adsb') parts.push(`✈ ${planes?.job.running ? `${planes.counts.aircraft} plane${planes.counts.aircraft === 1 ? '' : 's'}` : 'planes'}`)
    else if (k === 'aprs') parts.push(`APRS${aprs ? ` ${aprs.stations} station${aprs.stations === 1 ? '' : 's'}` : ''}`)
    else if (k === 'same') parts.push(alerts?.activeCount ? `⚠ ${alerts.active[0]?.eventName ?? 'weather alert'}` : 'watching alerts')
    else if (k === 'webrx') parts.push(`Web SDR on :${web?.port ?? 8073}`)
    else parts.push(j.label ?? k)
  }
  if (s?.gadgets.running) {
    const recent = (gadgets?.devices ?? []).filter(d => now - d.last < 3_600_000)
    parts.push(`${recent.length} gadget${recent.length === 1 ? '' : 's'}`)
    const temps = recent.filter(d => d.tempF !== null && !/tire|soil|food|pool/.test(d.kind))
    const temp = temps.find(d => /outdoor|weather station/.test(d.kind)) ?? temps[0]
    if (temp?.tempF !== null && temp?.tempF !== undefined) parts.push(`${temp.model.split(/[-_ ]/)[0]} ${Math.round(temp.tempF)}°F`)
  }
  $.ui.status(parts.length ? `Radio · ${parts.join(' · ')}` : undefined)
}

async function refreshStatus($: any, poll = false): Promise<void> {
  // A poll reads it beside the V4 lane (one that a press overtook comes back stale, without a
  // device, and is read again next tick); a press's own read (poll false) is in its lane.
  const r = (await script($, ['status'], 20_000, poll ? 'free' : 'action')) as Status
  if (!r?.device) return
  const before = st
  st = r
  stReadAt = Date.now()
  lastStatus = await $.clock.now()
  if (wasPresent === false && r.device.present) $.ui.toast('RTL-SDR Blog V4 connected', { timeoutMs: 5000 })
  if (wasPresent === true && !r.device.present) $.ui.toast('RTL-SDR Blog V4 unplugged', { timeoutMs: 5000 })
  wasPresent = r.device.present
  // A job stopped by itself since last time (another program took the V4, it was unplugged, the lease ran out).
  const ex = r.gadgets.lastExit
  if (before?.gadgets.running && !r.gadgets.running && ex && !['stopped', 'preempted'].includes(ex.reason)) note = `Gadget listener stopped: ${ex.detail || ex.reason}`
  const lx = r.listen.lastExit
  if (before?.listen.running && !r.listen.running && lx && lx.reason !== 'stopped') note = exitText('Audio', lx)
  if (before?.live?.running && !r.live?.running) {
    liveNote = exitText('Live view', r.live?.lastExit ?? null)
    if (liveFrame) liveFrame = { ...liveFrame, running: false }
  }
  if (!r.listen.running) meter = null
  // Keep the listener on while it is wanted and the V4 is free (nothing else running, no other program, no press under way).
  if (gadgetsWanted && !current && !pending && !autoStarting && r.device.present && !r.gadgets.running && !anyJobRunning(r) && r.state !== 'busy') {
    autoStarting = true
    try {
      await startGadgets($, true)
    } finally {
      autoStarting = false
    }
    return
  }
  pushStatus($, lastStatus)
  $.ui.invalidate('ui.render')
}

// radio.py status read inside a press (its own lane, after what it changed): kept when it is one.
async function readStatus($: any): Promise<void> {
  const r = await script($, ['status'])
  if (!r?.device) return
  st = r as Status
  stReadAt = Date.now()
}

// The same reading again (its clock aside): nothing to draw.
function sameRead(a: unknown, b: unknown): boolean {
  if (!a || !b) return false
  try {
    return JSON.stringify({ ...(a as object), now: 0 }) === JSON.stringify({ ...(b as object), now: 0 })
  } catch {
    return false
  }
}

async function refreshGadgets($: any, poll = false): Promise<void> {
  const r = (await script($, ['gadgets', 'list'], 20_000, poll ? 'poll' : 'action')) as Gadgets
  if (!r || !Array.isArray(r.devices)) return
  const same = sameRead(gadgets, r)
  gadgets = r
  lastList = await $.clock.now()
  const fresh = r.devices.filter(d => d.first > toastedUpTo)
  if (fresh.length) {
    toastedUpTo = Math.max(...fresh.map(d => d.first))
    const tires = fresh.filter(d => /tire/.test(d.kind))
    const others = fresh.filter(d => !/tire/.test(d.kind))
    const bits = others.slice(0, 3).map(d => `${d.model} (${d.kind})`)
    if (others.length > 3) bits.push(`${others.length - 3} more`)
    if (tires.length) bits.push(tires.length === 1 ? "a passing car's tire sensor" : `${tires.length} tire sensors from passing cars`)
    $.ui.toast(`${fresh.length === 1 ? 'New nearby' : `${fresh.length} new gadgets nearby`}: ${bits.join(', ')}`, { timeoutMs: 8000 })
    await saveStore($)
  }
  const was = st?.gadgets
  if (st) st = { ...st, gadgets: { ...st.gadgets, running: r.running, since: r.since, band: r.band, lastExit: r.lastExit } }
  pushStatus($, lastList)
  if (!same || was?.running !== r.running) $.ui.invalidate('ui.render')
}

async function pollLive($: any, poll = false): Promise<void> {
  const r = (await script($, ['live', 'frame'], 20_000, poll ? 'poll' : 'action')) as View & { say?: string; lastExit?: Exit }
  lastFrame = await $.clock.now()
  const same = !!r?.ok && !!liveFrame && r.at === liveFrame.at && r.running === liveFrame.running
  if (r?.ok && Array.isArray(r.freqs)) liveFrame = r
  if (r && r.running === false && st?.live?.running) {
    st = { ...st, live: { ...st.live, running: false, lastExit: r.lastExit ?? st.live.lastExit } }
    liveNote = exitText('Live view', r.lastExit ?? null)
    lastStatus = 0
  } else if (same) return
  $.ui.invalidate('ui.render')
}

// The meter while Listen plays: the S-meter and the verdict on the signal. Listen starts at once
// (--quick) and this says "weak signal" once the tap has heard ~2 s of it.
async function pollMeter($: any, poll = false): Promise<void> {
  const r = await script($, ['listen', 'meter'], 20_000, poll ? 'poll' : 'action')
  lastMeter = await $.clock.now()
  if (!r?.ok) return
  if (!r.running) {
    meter = null
    if (st?.listen.running) lastStatus = 0
  } else if (r.meter) {
    meter = r.meter as Meter
    if (r.eq && (!eq || r.eq.at > eq.at)) eq = r.eq as Eq
    if (meter.weak && weakSaid !== meter.since) {
      weakSaid = meter.since
      note = `${meter.label ?? `${meter.freq} MHz`}: weak signal — try the antenna by a window.`
      $.ui.toast(`${mhz(meter.freq)} MHz: weak signal — try the antenna by a window`, { timeoutMs: 6000 })
    }
  }
  pushStatus($, lastMeter)
  $.ui.invalidate('ui.render')
}

// The EQ display: eq.json read directly (a file read, no process) while Listen plays and the tab
// is drawn. It holds off while a press runs or waits, so the tab is not redrawn under the pointer.
async function eqTick($: any): Promise<void> {
  if (eqReading || !st?.listen.running || current || pending) return
  const now = (await $.clock.now()) as number
  if (now - lastRender >= 15_000 || now - eqAt < (paneSurface === 'mobile' ? EQ_MS_PHONE : EQ_MS) - 50) return
  eqReading = true
  eqAt = now
  try {
    const e = JSON.parse(String(await $.fs.read(EQ_FILE))) as Eq
    const since = st?.listen.since ?? 0
    if (e && Array.isArray(e.bands) && e.since >= since - 3000 && (!eq || e.at !== eq.at)) {
      eq = e
      $.ui.invalidate('ui.render')
    }
  } catch {
  } finally {
    eqReading = false
  }
}

// Every second: what is due, queued at once on the poll lane (each behind any press, one of a kind).
// A tick still waiting on its polls makes the next one skip.
async function tick($: any): Promise<void> {
  if (ticking || current) return
  ticking = true
  try {
    const now = (await $.clock.now()) as number
    lastNow = now
    const polls: Promise<unknown>[] = []
    // The free lane's read is not waited for: a slow one never holds the next tick's polls back.
    if (now - lastStatus >= STATUS_MS - 200) bg(refreshStatus($, true))
    polls.push(pollHandoff($, now))
    if (st?.gadgets.running && now - lastList >= LIST_MS - 200) polls.push(refreshGadgets($, true))
    const watched = now - lastRender < 15_000
    if (st?.live?.running && watched && now - lastFrame >= FRAME_MS - 100) polls.push(pollLive($, true))
    if (st?.listen.running && watched && now - lastMeter >= METER_MS - 100) polls.push(pollMeter($, true))
    polls.push(pollSections($, now))
    await Promise.all(polls.map(p => p.catch(() => undefined)))
    if (storeDirty) {
      storeDirty = false
      await saveStore($)
    }
  } finally {
    ticking = false
  }
}

// Each section's poll, all queued together (a fault in one never stops the others).
async function pollSections($: any, now: number, lane: Lane = 'poll'): Promise<void> {
  const ctx = ctxFor($, now, {}, '', 100, PANE, lane)
  await Promise.all(
    SECTIONS.filter(sec => sec.poll).map(sec =>
      (async () => {
        if (lane !== 'poll' || !current) await sec.poll?.(ctx)
      })().catch(() => undefined),
    ),
  )
}

// Web SDR handed a frequency back ("Send to Radio tab" on its page): a file read while Web SDR
// runs, no process. A new one runs `radio.py handoff`, which stops Web SDR through the job
// system (recorded as "stopped so the V4 could play X in the Radio tab"), tunes and plays.
async function pollHandoff($: any, now: number): Promise<void> {
  if (current || !st?.jobs?.webrx?.running || now - handoffRead < HANDOFF_MS - 100) return
  handoffRead = now
  let h: { mhz?: unknown; mode?: unknown; at?: unknown } | null = null
  try {
    h = JSON.parse(String(await $.fs.read(HANDOFF_FILE)))
  } catch {
    return
  }
  if (!h || typeof h.at !== 'number' || h.at <= handoffAt) return
  handoffAt = h.at
  if (now - h.at > HANDOFF_MAX_MS) {
    bg(script($, ['handoff', 'clear']))
    return
  }
  await takeHandoff($, typeof h.mhz === 'number' ? h.mhz : null)
}

async function takeHandoff($: any, f: number | null): Promise<string> {
  let text = ''
  const label = `Taking over from Web SDR${f ? `: ${mhz(f)} MHz` : ''}`
  const end = await intent(
    $,
    label,
    async () => {
      const r = await script($, ['handoff'], 60_000)
      if (r?.ok && r.listen) {
        setTuner(r.listen.freq, r.listen.mode)
        rememberStopped('listen', r.stopped)
        noteListened(tuner.hz / 1e6, tuner.mode, r.listen.label)
        meter = r.meter ?? null
        if (r.weak && meter) weakSaid = meter.since
        $.ui.toast(`Web SDR → Radio tab: ${r.listen.label ?? `${mhz(tuner.hz / 1e6)} MHz`}`, { timeoutMs: 6000 })
      }
      text = r?.ok ? `${r.say}${stoppedText(r.stopped)}` : r?.say ?? 'The handoff from Web SDR did not play.'
      if (!r?.ok) failed(text)
      note = text
      eq = null
      recsStale = webStale = true
      await saveStore($)
      await readStatus($)
      lastStatus = await $.clock.now()
      lastMeter = lastStatus
      pushStatus($, lastStatus)
    },
    { key: K.handoff, plan: () => takeover('handoff', 'tuning in what Web SDR sent', 4500, 'listen') },
  )
  return text || endText(end, label)
}

// The reply for a press that did not run itself: it joined the same one, or a newer press replaced it.
function endText(end: ActEnd, label: string): string {
  return end === 'superseded' ? `${label}: skipped, a newer press replaced it before it ran.` : end === 'joined' ? `${label}: already under way.` : ''
}

function ctxBase(now: number): SectionContext {
  return {
    els: {},
    surface: '',
    narrow: false,
    columns: 100,
    now,
    watched: false,
    // Read when used, so a section sees the status and busy line after its own refresh.
    get status() {
      return st
    },
    get busy() {
      return busy
    },
    lane: 'action',
    radio: async () => ({ ok: false, say: 'not available here' }),
    python: async () => ({ ok: false, say: 'not available here' }),
    run: async () => ({ ok: false, say: 'not available here' }),
    stopped: rememberStopped,
    stoppedText,
    act: async () => 'superseded',
    listen: async () => 'not available here',
    setNote: (t: string) => {
      note = t
    },
    toast: () => undefined,
    redraw: () => undefined,
    refresh: async () => undefined,
    pane: PANE,
    open: () => undefined,
  }
}

// Read-only, never the V4: runs beside the V4 lane.
const FREE_RUNS = new Set(['webrx/status.sh'])

function ctxFor($: any, now: number, els: any = {}, surface = '', columns = 100, pane = PANE, lane: Lane = 'action'): SectionContext {
  return {
    ...ctxBase(now),
    get status() {
      return st
    },
    get busy() {
      return busy
    },
    lane,
    els,
    surface,
    narrow: surface === 'mobile',
    columns,
    watched: now - lastRender < 15_000,
    radio: (args: string[], timeoutMs?: number) => script($, args, timeoutMs, lane),
    python: (name: string, args: string[], timeoutMs?: number) => pyScript($, name, args, timeoutMs, lane),
    run: (path: string, args: string[], timeoutMs = 20_000) => runJson($, [`${$.plugin.root}/${path}`, ...args], timeoutMs, FREE_RUNS.has(path) ? 'free' : lane),
    act: (label: string, job: () => Promise<unknown>, opts?: ActOpts) => intent($, label, job, opts),
    listen: (f: number, mode?: string | null) => listen($, f, mode, true),
    setNote: (t: string) => {
      note = t
      $.ui.invalidate('ui.render')
    },
    toast: (t: string) => $.ui.toast(t, { timeoutMs: 6000 }),
    redraw: () => $.ui.invalidate('ui.render'),
    refresh: async () => {
      lastStatus = 0
      await refreshStatus($)
    },
    pane,
    open: (id: string, title: string) => void $.ui.open({ id, title }),
  }
}

function sortedSections(): Section[] {
  return [...SECTIONS].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

// ---------------------------------------------------------------- actions
// Every press is an intent (intent() above): its button shows it at once, a press while another runs
// waits its turn (the newest one wins), and the same press again runs once. The `want` each one
// takes is what the button said when pressed ("Planes on"), never a toggle of whatever is now.

async function runScan($: any, preset: string, range?: [number, number]): Promise<string> {
  let text = ''
  const label = `Scanning ${range ? `${range[0]}–${range[1]} MHz` : bandOf(preset)?.label ?? preset}`
  const end = await intent(
    $,
    label,
    async () => {
      const args = range ? ['scan', 'custom', String(range[0]), String(range[1])] : ['scan', preset]
      const r = await script($, args, 90_000)
      if (r?.ok) {
        scan = r as View
        if (!range) lastPreset = preset
        if (scan.preset === 'fm') fmStations = scan.peaks.filter(p => p.name && !p.comb && !p.spur).map(p => ({ mhz: p.mhz, name: p.name as string, above: p.above }))
        rememberStopped('scan', scan.stopped)
        if (restore.some(s => s.kind === 'live') && st?.live) {
          st = { ...st, live: { ...st.live, running: false } }
          liveNote = ''
        }
        if (restore.some(s => s.kind === 'listen') && st) st = { ...st, listen: { ...st.listen, running: false } }
        const named = [...scan.peaks].filter(p => p.name && !p.comb && !p.spur).sort((a, b) => b.above - a.above).slice(0, 5)
        text = `${scan.label}: ${scan.peaks.length} signal${scan.peaks.length === 1 ? '' : 's'} above the noise floor${named.length ? `, strongest ${named.map(p => shortLabel(p) || p.name).join(', ')}` : ''}.`
        const g = scan.gadgets
        if (g?.paused) text += g.restarted ? ' The gadget listener paused for the scan and is back on.' : ' The gadget listener paused for the scan and did not come back; it retries in a moment.'
        text += stoppedText(scan.stopped?.filter(s => s.kind !== 'gadgets'))
        await saveStore($)
      } else {
        text = r?.say ?? 'Scan failed.'
        failed(text)
      }
      note = text
    },
    { key: K.scan(preset, range), plan: () => takeover('scan', 'the V4 listens for about 10 s', 11_000, 'scan') },
  )
  lastStatus = 0
  bg(tick($))
  return text || endText(end, label)
}

async function setLive($: any, want: boolean, preset?: string, range?: [number, number]): Promise<string> {
  let text = ''
  const id = preset ?? shownView()?.preset ?? lastPreset
  const where = range ? `${range[0]}–${range[1]} MHz` : bandOf(id)?.label ?? id
  const label = want ? `Starting the live view of ${where}` : 'Stopping the live view'
  const end = await intent(
    $,
    label,
    async () => {
      if (!want) {
        const r = await script($, ['live', 'stop'])
        text = r?.say ?? 'Live view off.'
        if (st?.live) st = { ...st, live: { ...st.live, running: false } }
        if (liveFrame) liveFrame = { ...liveFrame, running: false }
        liveNote = ''
        note = text
        return
      }
      const args = range || id === 'custom' ? ['live', 'start', 'custom', String(range?.[0] ?? scan?.start ?? 88), String(range?.[1] ?? scan?.stop ?? 108)] : ['live', 'start', id]
      const r = await script($, args, 30_000)
      text = r?.ok ? `${r.say}${stoppedText(r.stopped)}` : r?.say ?? 'The live view did not start.'
      if (r?.ok) {
        if (id !== 'custom') lastPreset = id
        liveNote = ''
        liveFrame = null
        lastFrame = 0
        rememberStopped('live', r.stopped)
        st = st ? { ...st, live: { running: true, since: Date.now(), preset: id, label: r.live?.label, lo: r.live?.lo, hi: r.live?.hi, lastExit: null }, listen: { ...st.listen, running: false }, share: { ...st.share, running: false } } : st
        meter = null
        await saveStore($)
      } else failed(text)
      note = text
    },
    { key: K.live(want, preset, range), plan: () => (want ? takeover('live', 'starting rtl_power', 2500, 'live') : { step: 'stopping rtl_power', ms: 1000 }) },
  )
  lastStatus = 0
  bg(tick($))
  return text || endText(end, label)
}

async function liveReset($: any): Promise<void> {
  await intent(
    $,
    'Clearing the max hold',
    async () => {
      const r = await script($, ['live', 'reset'])
      note = r?.say ?? 'Max hold cleared.'
      lastFrame = 0
    },
    { key: K.liveReset, plan: () => ({ step: 'resetting the live view’s max hold', ms: 500 }) },
  )
}

// A band button: moves the live view there while it runs, else scans it.
async function bandPress($: any, id: string): Promise<string> {
  if (st?.live?.running) return setLive($, true, id)
  return runScan($, id)
}

async function startGadgets($: any, quiet = false, band = '433'): Promise<string> {
  const r = await script($, ['gadgets', 'start', band], 30_000)
  gadgetsWanted = true
  await saveStore($)
  const text = r?.ok ? `${r.say}${stoppedText(r.stopped)}` : r?.say ?? 'The gadget listener did not start.'
  if (!quiet || !r?.ok) note = text
  if (r?.ok) rememberStopped('gadgets', r.stopped)
  else if (!quiet) failed(text)
  lastStatus = 0
  await readStatus($)
  lastStatus = await $.clock.now()
  await refreshGadgets($)
  return text
}

async function setGadgets($: any, want: boolean, band = '433'): Promise<string> {
  let text = ''
  const label = want ? 'Starting the gadget listener' : 'Stopping the gadget listener'
  const end = await intent(
    $,
    label,
    async () => {
      if (want) {
        text = await startGadgets($, false, band)
      } else {
        gadgetsWanted = false
        await saveStore($)
        const r = await script($, ['gadgets', 'stop'])
        text = r?.say ?? 'Gadget listener off.'
        note = text
        await readStatus($)
        pushStatus($, await $.clock.now())
      }
    },
    { key: K.gadgets(want), plan: () => (want ? takeover('gadgets', 'starting rtl_433 on 433.92 MHz', 2500, 'gadgets') : { step: 'stopping rtl_433', ms: 1000 }) },
  )
  return text || endText(end, label)
}

function listenArgs(quick: boolean): string[] {
  return ['listen', mhz(tuner.hz / 1e6), tuner.mode, '--squelch', String(tuner.squelch), '--gain', String(tuner.gain), ...(quick ? ['--quick'] : [])]
}

function setTuner(f: number, mode?: string | null): void {
  const m = resolveMode(f, mode)
  const changed = m !== tuner.mode
  tuner = {
    ...tuner,
    hz: Math.round(f * 1e6),
    mode: m,
    step: changed ? defaultStep(m) : tuner.step,
    squelch: defaultSquelch(f, m),
    gain: changed ? (m === 'wbfm' ? 'auto' : 40.2) : tuner.gain,
  }
  stripRev++
}

// radio.py status was read in the last few seconds (a press's own read): its word on what plays is good.
function statusFresh(): boolean {
  return Date.now() - stReadAt < 5000
}

// What plays now is already what the tuner says (a second press that came in after the first one finished).
function playingTuner(): boolean {
  const p = st?.listen
  if (!p?.running || !statusFresh()) return false
  return Math.abs((p.freq ?? 0) - tuner.hz / 1e6) < 0.0004 && p.mode === tuner.mode && (p.squelch === undefined || p.squelch === tuner.squelch) && (p.gain === undefined || String(p.gain) === String(tuner.gain))
}

// Plays the tuner (after setting it to freq / mode). A press (quick) starts the audio at once and
// leaves the weak-signal verdict to the meter polls; /sdr listen waits ~3 s for it, for its reply.
async function listen($: any, freq?: number, mode?: string | null, quick = false): Promise<string> {
  if (freq !== undefined) setTuner(freq, mode)
  // The press plays the tuner as it is now: a retune the ▲ ▼ presses had pending is part of it.
  retuneTimer?.cancel()
  retuneTimer = null
  let text = ''
  const f = tuner.hz / 1e6
  const md = tuner.mode
  const args = listenArgs(quick)
  const label = `Tuning ${mhz(f)} MHz`
  const end = await intent(
    $,
    label,
    async () => {
      if (quick && playingTuner()) {
        text = `Already playing ${st?.listen.label ?? `${mhz(f)} MHz`}.`
        note = text
        return
      }
      const r = await script($, args, 30_000)
      text = r?.ok ? `${r.say}${stoppedText(r.stopped)}${(r.stopped ?? []).some((s: Stopped) => s.kind === 'gadgets') ? ' The gadget listener comes back when you press Stop.' : ''}` : r?.say ?? 'Could not start the audio.'
      if (r?.ok) {
        rememberStopped('listen', r.stopped)
        noteListened(f, md, r.listen?.label)
        meter = r.meter ?? null
        if (r.weak && meter) weakSaid = meter.since
        if ((r.stopped ?? []).some((s: Stopped) => s.kind === 'live')) {
          liveNote = `Live view stopped so the V4 could play ${r.listen?.label ?? `${mhz(f)} MHz`}.`
          if (liveFrame) liveFrame = { ...liveFrame, running: false }
        }
      } else failed(text)
      note = text
      eq = null
      recsStale = true
      await saveStore($)
      await readStatus($)
      lastStatus = await $.clock.now()
      // Started quick: the first meter reading (the S-meter) about a second on, the verdict by ~3 s.
      lastMeter = quick ? lastStatus - METER_MS + 1000 : lastStatus
      pushStatus($, lastStatus)
    },
    { key: K.listen(f, md), plan: () => takeover('listen', quick ? 'starting the audio' : 'starting the audio, then ~3 s listening for a weak signal', quick ? 1500 : 4500, 'listen') },
  )
  return text || endText(end, label)
}

// While playing, the V4 follows the tuner once the presses stop: one retune, queued behind a
// press that runs (a second one joins it), done at the tuner's frequency when its turn comes.
async function retune($: any): Promise<void> {
  retuneTimer = null
  if (!st?.listen.running) return
  await intent(
    $,
    'Retuning',
    async () => {
      if (!st?.listen.running || playingTuner()) return
      const r = await script($, listenArgs(true), 30_000)
      if (r?.ok) {
        meter = null
        note = r.say
      } else {
        note = r?.say ?? 'Could not retune.'
        failed(note)
      }
      await readStatus($)
      lastStatus = await $.clock.now()
      lastMeter = 0
      pushStatus($, lastStatus)
    },
    { key: K.retune, plan: () => ({ step: `moving the audio to ${mhz(tuner.hz / 1e6)} MHz ${modeChip(tuner.mode)}`, ms: 1500 }) },
  )
}

// Tuner changes redraw at once; while playing, the V4 retunes once the presses stop.
function tunerChanged($: any): void {
  stripRev++
  bg(saveStore($))
  $.ui.invalidate('ui.render')
  if (!st?.listen.running) return
  retuneTimer?.cancel()
  retuneTimer = $.clock.after(RETUNE_MS, () => bg(retune($)))
}

function stepTuner($: any, dir: number, mult = 1): void {
  tuner = { ...tuner, hz: clamp(tuner.hz + dir * tuner.step * mult, 24e6, 1766e6) }
  tunerChanged($)
}

function gainStep(dir: number): 'auto' | number {
  const g = tuner.gain
  if (g === 'auto') return 40.2
  const i = GAINS.findIndex(x => x >= g - 0.05)
  const k = clamp((i < 0 ? GAINS.length - 1 : i) + dir, 0, GAINS.length - 1)
  return GAINS[k] ?? 40.2
}

async function stopListening($: any): Promise<string> {
  let text = ''
  retuneTimer?.cancel()
  retuneTimer = null
  const label = 'Stopping the audio'
  const end = await intent(
    $,
    label,
    async () => {
      const r = await script($, ['listen', 'stop'])
      text = r?.say ?? 'Stopped.'
      note = text
      meter = null
      eq = null
      recsStale = true
    },
    { key: K.stopListen, plan: () => ({ step: 'stopping rtl_fm and the player', ms: 1000 }) },
  )
  lastStatus = 0
  await tick($)
  return text || endText(end, label)
}

async function setShare($: any, want: boolean, scope = 'all'): Promise<string> {
  let text = ''
  const label = want ? 'Starting rtl_tcp' : 'Stopping the share'
  const end = await intent(
    $,
    label,
    async () => {
      const r = await script($, want ? ['share', 'start', scope] : ['share', 'stop'], 30_000)
      text = r?.ok ? `${r.say}${want ? stoppedText(r.stopped) : ''}` : r?.say ?? 'Could not start sharing.'
      if (r?.ok && want) rememberStopped('share', r.stopped)
      if (!r?.ok) failed(text)
      note = text
    },
    { key: K.share(want), plan: () => (want ? takeover('share', 'starting rtl_tcp for the phone', 2000, 'share') : { step: 'stopping rtl_tcp', ms: 1000 }) },
  )
  lastStatus = 0
  await tick($)
  return text || endText(end, label)
}

async function resume($: any, s: Stopped): Promise<void> {
  restore = restore.filter(x => x !== s)
  if (s.kind === 'listen' && s.freq) await listen($, s.freq, s.mode, true)
  else if (s.kind === 'share') await setShare($, true, s.addr === '0.0.0.0' || !s.addr ? 'all' : s.addr === st?.share.tailscale ? 'tailscale' : 'lan')
  else if (s.kind === 'live') await setLive($, true, s.preset ?? lastPreset, s.preset === 'custom' && s.lo && s.hi ? [s.lo, s.hi] : undefined)
  else await setJob($, s.kind, true)
}

// A section's job (adsb, aprs, same, webrx) on or off through radio.py's job manager.
const JOB_START: Record<string, string> = { adsb: 'Starting Planes', aprs: 'Starting APRS', same: 'Starting the weather alert watch', webrx: 'Starting Web SDR' }
const JOB_STEP: Record<string, string> = { adsb: 'starting the ADS-B decoder on 1090 MHz', aprs: 'starting the APRS decoder on 144.390 MHz', same: 'starting the alert decoder on 162.550 MHz', webrx: 'starting rtl_tcp and the OpenWebRX+ container' }
const JOB_MS: Record<string, number> = { adsb: 2500, aprs: 2500, same: 2500, webrx: 20_000 }
// Synchronous up to the press, so its button shows it in the very next drawing.
function setJob($: any, kind: string, want: boolean): Promise<string> {
  return toggleJob(ctxFor($, lastNow || lastRender), kind, want)
}

// Through the section context, as a module's section would: radio.py job start|stop <kind>.
async function toggleJob(ctx: SectionContext, kind: string, want: boolean): Promise<string> {
  let text = ''
  const label = want ? JOB_START[kind] ?? `Starting ${kindLabel(kind)}` : `Stopping ${kindLabel(kind)}`
  const end = await ctx.act(
    label,
    async () => {
      // On already, as a status read a moment ago says (a second press after the first finished).
      if (want && jobOn(ctx, kind) && statusFresh()) {
        text = `${kindLabel(kind)} is already on.`
        ctx.setNote(text)
        return
      }
      const r = await ctx.radio(['job', want ? 'start' : 'stop', kind], kind === 'webrx' ? 320_000 : 60_000)
      text = r?.ok ? `${r.say}${want ? ctx.stoppedText(r.stopped) : ''}` : r?.say ?? `${kindLabel(kind)} did not ${want ? 'start' : 'stop'}.`
      if (r?.ok && want) {
        ctx.stopped(kind, r.stopped)
        if ((r.stopped ?? []).some((x: Stopped) => x.kind === 'live')) {
          liveNote = `Live view stopped so the V4 could ${KIND_DOING[kind] ?? `run ${kindLabel(kind)}`}.`
          if (liveFrame) liveFrame = { ...liveFrame, running: false }
        }
        if ((r.stopped ?? []).some((x: Stopped) => x.kind === 'listen')) meter = null
      }
      if (!r?.ok) failed(text)
      if (kind === 'webrx' && r?.result?.urls) web = r.result as WebStatus
      planesStale = aprsStale = alertsStale = webStale = true
      ctx.setNote(text)
      await ctx.refresh()
    },
    { key: K.job(kind, want), plan: () => (want ? takeover(`job ${kind}`, JOB_STEP[kind] ?? 'starting it', JOB_MS[kind] ?? 2500, kind) : { id: `stop ${kind}`, step: `stopping ${kindLabel(kind)}`, ms: (STOP_MS[kind] ?? 1000) + 500 }) },
  )
  return text || endText(end, label)
}
const KIND_DOING: Record<string, string> = { adsb: 'track planes (ADS-B on 1090 MHz)', aprs: 'decode APRS on 144.390 MHz', same: 'watch for NOAA weather alerts on 162.550 MHz', webrx: 'run Web SDR' }

// Stop all: whatever holds the V4 (Web SDR included). The gadget listener stays off if it was the one.
async function stopAll($: any): Promise<string> {
  let text = ''
  retuneTimer?.cancel()
  retuneTimer = null
  const label = 'Stopping everything on the V4'
  const end = await intent(
    $,
    label,
    async () => {
      const wasGadgets = st?.holder?.kind === 'gadgets' || !!st?.gadgets.running
      const r = await script($, ['stop'], 120_000)
      text = r?.say ?? 'Stopped.'
      if (wasGadgets) {
        gadgetsWanted = false
        await saveStore($)
      }
      meter = null
      eq = null
      restore = []
      liveNote = ''
      recsStale = true
      if (recs) recs = { ...recs, rec: null, log: { ...recs.log, on: false }, playing: null }
      if (liveFrame) liveFrame = { ...liveFrame, running: false }
      note = text
      await readStatus($)
      lastStatus = await $.clock.now()
      planesStale = aprsStale = alertsStale = webStale = true
      pushStatus($, lastStatus)
    },
    {
      key: K.stopAll,
      plan: () => {
        const k = st?.holder?.ours ? st.holder.kind : null
        return k ? { id: `stop all ${k}`, step: `stopping ${kindLabel(k)}`, ms: (STOP_MS[k] ?? 1000) + 1000 } : { id: 'stop all', step: 'stopping whatever is ours', ms: 1500 }
      },
    },
  )
  return text || endText(end, label)
}

async function loadLast($: any): Promise<void> {
  const r = await script($, ['last'])
  if (r?.ok && Array.isArray(r.freqs)) scan = r as View
  $.ui.invalidate('ui.render')
}

function parseRange(arg: string): [number, number] | null {
  const n = arg.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/)
  if (!n) return null
  const a = Number(n[1])
  const b = Number(n[2])
  return a > 0 && b > 0 && a !== b ? [Math.min(a, b), Math.max(a, b)] : null
}

function parseListen(arg: string): { freq: number; mode: string | null } | null {
  const m = arg.trim().match(/^(\d+(?:\.\d+)?)\s*(?:mhz|khz)?\s*(wbfm|wfm|fm|nfm|am|usb|lsb|ssb|cw)?$/i)
  if (!m) return null
  const mode = m[2] ? m[2].toLowerCase() : null
  // "518 khz" reads as kHz; anything else is MHz.
  const freq = /khz/i.test(arg) ? Number(m[1]) / 1000 : Number(m[1])
  return { freq, mode: mode === 'wfm' ? 'wbfm' : mode === 'nfm' ? 'fm' : mode === 'ssb' ? 'usb' : mode }
}

// The last scan's (or live frame's) level at the tuner's frequency, for the meter while not playing.
function scanLevelAt(f: number): { above: number; label: string } | null {
  const v = shownView()
  if (!v || f < v.start || f > v.stop || !v.freqs.length) return null
  let best = 0
  let bd = Infinity
  v.freqs.forEach((q, i) => {
    const d = Math.abs(q - f)
    if (d < bd) {
      bd = d
      best = i
    }
  })
  const lo = Math.max(0, best - 1)
  const hi = Math.min(v.freqs.length, best + 2)
  const level = Math.max(...v.max.slice(lo, hi))
  return { above: Math.max(0, level - v.floor), label: v.live ? 'live view' : 'scan' }
}

// ---------------------------------------------------------------- the sections: Planes, APRS, Weather alerts, Web SDR
// Each is a Section (the hook point above): it draws from ctx.els, polls through ctx, answers /sdr <verb>.

// A row of controls with a fixed-width label, so rows line up.
function ctrlRow(els: any, key: string, label: string, kids: unknown[]): unknown {
  const { Box, Text } = els
  return (
    <Box key={key} flexWrap="wrap">
      <Box width={ROW_LABEL}>
        <Text dimColor>{label}</Text>
      </Box>
      {kids}
    </Box>
  )
}

// A button in a row: a plain label, or a Look (look() above) that shows its press under way or queued.
function ctrl(els: any, key: string, label: string | Look, press: () => void, primary = false): unknown {
  const { Box, Button } = els
  const lk = typeof label === 'string' ? { label } : label
  return (
    <Box key={`b:${key}`} paddingRight={1}>
      <Button key={key} label={lk.label} variant={primary || lk.variant ? 'primary' : undefined} dimColor={lk.dimColor || undefined} onPress={press} />
    </Box>
  )
}

function svgOf(ctx: SectionContext): any {
  return ctx.surface === 'terminal' ? null : steadySvg(ctx.els.Svg, ctx.narrow ? 440 : 760)
}

// The surface's Svg with a height filled in from the markup (see svgHeight), so no picture in
// the tab drops to zero height while its refreshed copy loads. A pane that keeps the person at
// the bottom would otherwise pin them there each time a picture refreshed. An explicit `height`
// (undefined included: "take the natural size") is left as given.
function steadySvg(base: any, maxW: number): any {
  if (!base) return null
  return (props: any) =>
    base(Object.prototype.hasOwnProperty.call(props, 'height') ? props : { ...props, height: svgHeight(String(props.source ?? ''), maxW) })
}

function jobOn(ctx: SectionContext, kind: string): boolean {
  return !!ctx.status?.jobs?.[kind]?.running
}

function jobExitLine(ctx: SectionContext, kind: string, label: string): string {
  const ex = ctx.status?.jobs?.[kind]?.lastExit ?? null
  return exitText(label, ex)
}

function localHref(u: string): string {
  return /^https?:\/\/[^/]+$/.test(u) ? `${u}/` : u
}

// ---- Planes (adsb.py)

async function fetchPlanes(ctx: SectionContext): Promise<void> {
  const r = (await ctx.python('adsb.py', ['view', '--range', planesRange, '--svg', '--table', '--width', '34'], 20_000)) as PlanesView
  planesAt = ctx.now
  planesStale = false
  if (r?.ok) planes = r
  ctx.redraw()
}

function planesCounts(p: PlanesView | null, isOn: boolean): string {
  if (!p || p.empty) return isOn ? 'Listening on 1090 MHz: the first planes show up within a few seconds.' : 'No planes yet: turn Planes on.'
  const c = p.counts
  const far = c.farthestNm !== null ? ` · farthest ${c.farthest ?? '?'} at ${c.farthestNm} nm` : ''
  const when = p.updated ? `${isOn ? 'updated' : 'last heard'} ${clockOf(p.updated)}` : ''
  return `${c.aircraft} aircraft · ${c.withPosition} with a position${far}${when ? ` · ${when}` : ''}`
}

const planesSection: Section = {
  id: 'planes',
  title: 'Planes',
  color: SKY,
  order: 10,
  verbs: ['planes', 'plane', 'adsb'],
  render: ctx => {
    const { Box, Text, Code } = ctx.els
    const Svg = ctx.narrow ? null : svgOf(ctx)
    const isOn = jobOn(ctx, 'adsb')
    const p = planes
    const ex = isOn ? '' : jobExitLine(ctx, 'adsb', 'Planes')
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">{ctx.narrow ? 'Aircraft around you, from their own ADS-B broadcasts on 1090 MHz.' : `Aircraft around ${LOC.short}, from the position, height and speed they broadcast themselves (ADS-B on 1090 MHz). Colour is height; the trail is the last few minutes.`}</Text>
        {ctrlRow(ctx.els, 'planes-row', 'Planes', [
          ctrl(ctx.els, 'planes-toggle', look(K.job('adsb', !isOn), isOn ? '■ Planes off' : '✈ Planes on', isOn ? 'Stopping…' : 'Starting Planes…', 'Queued…'), () => void toggleJob(ctx, 'adsb', !isOn), !isOn),
          ...(ctx.narrow || ctx.pane === PLANES_PANE ? [] : [ctrl(ctx.els, 'planes-tab', '⤢ Radar in its own tab', () => ctx.open(PLANES_PANE, 'Planes'))]),
        ])}
        {Svg ? ctrlRow(ctx.els, 'planes-range', 'Range', PLANE_RANGES.map(r => ctrl(ctx.els, `range:${r}`, r === 'auto' ? 'auto' : `${r} nm`, () => {
          planesRange = r
          planesStale = true
          storeDirty = true
          ctx.redraw()
        }, planesRange === r))) : null}
        <Text wrap="wrap" color={isOn ? 'green' : undefined}>{planesCounts(p, isOn)}</Text>
        {(p?.emergencies ?? []).map((em, k) => (
          <Text key={`em:${k}`} bold color="red">{`⚠ ${em}`}</Text>
        ))}
        {ex ? <Text color="yellow" wrap="wrap">{ex}</Text> : null}
        {p && !p.empty && Svg && p.svg ? (
          <Svg key="planes-radar" height={ctx.pane === PLANES_PANE ? undefined : svgHeight(p.svg, 760)} source={p.svg} alt={`Plane radar around ${LOC.name} (${planesRange === 'auto' ? 'auto range' : `${planesRange} nm`}): ${p.counts.aircraft} aircraft, ${p.counts.withPosition} with a position${p.counts.farthestNm !== null ? `, farthest ${p.counts.farthest ?? '?'} at ${p.counts.farthestNm} nm` : ''}`} />
        ) : p && !p.empty && p.table ? (
          <Code key="planes-table" source={p.table} />
        ) : null}
        <Text dimColor wrap="wrap">{p?.antenna ?? 'Antenna: stand the dipole vertical with the short elements at about 6.9 cm each, high at a window.'}</Text>
      </Box>
    )
  },
  text: ctx => {
    const isOn = jobOn(ctx, 'adsb')
    if (!isOn && !planes) return 'Planes off · /sdr planes on'
    return `Planes ${isOn ? 'on' : 'off'}: ${planesCounts(planes, isOn)} · /sdr planes${isOn ? '' : ' on'}`
  },
  command: async (ctx, _verb, arg) => {
    const a = arg.toLowerCase()
    if (/^(off|stop)/.test(a)) return toggleJob(ctx, 'adsb', false)
    let head = ''
    if (/^(on|start)/.test(a)) head = await toggleJob(ctx, 'adsb', true)
    await fetchPlanes(ctx)
    const isOn = jobOn(ctx, 'adsb')
    const p = planes
    const lines = [head, planesCounts(p, isOn)].filter(Boolean)
    if (p && !p.empty && p.table) lines.push(p.table.split('\n').slice(2).join('\n'))
    if (!p || p.empty || p.counts.aircraft < 3) lines.push(p?.antenna ?? '')
    lines.push(isOn ? '/sdr planes off stops it.' : '/sdr planes on starts it.')
    return lines.filter(Boolean).join('\n')
  },
  poll: async ctx => {
    const isOn = jobOn(ctx, 'adsb')
    if ((isOn && ctx.watched && ctx.now - planesAt >= FRAME_MS - 100) || (planesStale && (ctx.watched || !planes))) await fetchPlanes(ctx)
  },
}

// ---- APRS (digital.py)

async function fetchAprs(ctx: SectionContext): Promise<void> {
  const r = (await ctx.python('digital.py', ['aprs', 'view', '--svg', '--table', '--width', '34'], 20_000)) as AprsView
  aprsAt = ctx.now
  aprsStale = false
  const same = sameRead(aprs, r)
  if (r?.ok) aprs = r
  if (!same) ctx.redraw()
}

function aprsCounts(ctx: SectionContext): string {
  const a = aprs
  if (!a) return ''
  return `${a.stations} station${a.stations === 1 ? '' : 's'}, ${a.packets} packet${a.packets === 1 ? '' : 's'}${a.lastPacket ? ` · last ${ago(a.lastPacket.at, ctx.now)}` : ''}`
}

function aprsLine(ctx: SectionContext): string {
  const since = ctx.status?.jobs?.aprs?.since
  const head = jobOn(ctx, 'aprs') ? `Decoding 144.390 MHz${since ? ` since ${clockOf(since)}` : ''}` : 'Off'
  const counts = aprsCounts(ctx)
  return counts ? `${head} · ${counts}` : head
}

const aprsSection: Section = {
  id: 'aprs',
  title: 'APRS',
  color: GREEN,
  order: 20,
  verbs: ['aprs'],
  render: ctx => {
    const { Box, Text, Code } = ctx.els
    const Svg = ctx.narrow ? null : svgOf(ctx)
    const isOn = jobOn(ctx, 'aprs')
    const a = aprs
    const ex = isOn ? '' : jobExitLine(ctx, 'aprs', 'APRS')
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">{ctx.narrow ? 'Ham stations sending position, weather and messages on 144.390 MHz.' : 'Ham radio packets on 144.390 MHz: cars and hikers sending their position, home weather stations, digipeaters relaying them, and short messages.'}</Text>
        {ctrlRow(ctx.els, 'aprs-row', 'APRS', [ctrl(ctx.els, 'aprs-toggle', look(K.job('aprs', !isOn), isOn ? '■ APRS off' : '▶ APRS on', isOn ? 'Stopping…' : 'Starting APRS…', 'Queued…'), () => void toggleJob(ctx, 'aprs', !isOn), !isOn)])}
        <Text wrap="wrap" color={isOn ? 'green' : undefined}>{aprsLine(ctx)}</Text>
        {ex ? <Text color="yellow" wrap="wrap">{ex}</Text> : null}
        {!a || a.empty ? (
          <Text wrap="wrap">{a?.emptySay ?? 'Nothing heard yet on 144.390 MHz. Indoors the small antenna reaches only the strongest stations; an outdoor 2 m antenna helps most.'}</Text>
        ) : Svg && a.svg ? (
          <Svg key="aprs-map" height={svgHeight(a.svg, 760)} source={a.svg} alt={`APRS map around ${LOC.name}: ${a.stations} stations, ${a.withPosition} with a position${a.farthest !== null ? `, farthest ${a.farthest} mi` : ''}`} />
        ) : a.table ? (
          <Code key="aprs-table" source={a.table} />
        ) : null}
        {(a?.recent ?? []).slice(0, ctx.narrow ? 2 : 4).map((r, k) => (
          <Text key={`ap:${k}`} dimColor wrap="truncate-end">{`${clockOf(r.at)}  ${r.call}  ${r.summary}`}</Text>
        ))}
      </Box>
    )
  },
  text: ctx => (jobOn(ctx, 'aprs') ? `APRS on: ${aprsLine(ctx)} · /sdr aprs` : `APRS off${aprsCounts(ctx) ? ` · ${aprsCounts(ctx)} so far` : ''} · /sdr aprs on`),
  command: async (ctx, _verb, arg) => {
    const a = arg.toLowerCase()
    if (/^(off|stop)/.test(a)) return toggleJob(ctx, 'aprs', false)
    let head = ''
    if (/^(on|start)/.test(a)) head = await toggleJob(ctx, 'aprs', true)
    await fetchAprs(ctx)
    const v = aprs
    const lines = [head, aprsLine(ctx)]
    if (!v || v.empty) lines.push(v?.emptySay ?? '')
    else if (v.table) lines.push(v.table.split('\n').slice(1).join('\n'))
    return lines.filter(Boolean).join('\n')
  },
  poll: async ctx => {
    const isOn = jobOn(ctx, 'aprs')
    if ((isOn && ctx.watched && ctx.now - aprsAt >= 5000) || (aprsStale && (ctx.watched || !aprs))) await fetchAprs(ctx)
  },
}

// ---- Weather alerts (digital.py same)

async function fetchAlerts(ctx: SectionContext): Promise<void> {
  const r = (await ctx.python('digital.py', ['same', 'view', '--svg'], 20_000)) as AlertsView
  alertsAt = ctx.now
  alertsStale = false
  if (!r?.ok) return
  const same = sameRead(alerts, r)
  alerts = r
  for (const al of r.active) {
    if (alertsToasted.includes(al.id)) continue
    alertsToasted = [...alertsToasted, al.id].slice(-20)
    if (al.severity !== 'test') ctx.toast(`⚠ ${al.eventName}: heard from ${noaaShort()} just now`)
  }
  if (!same) ctx.redraw()
}

function alertBrief(a: AlertBrief, now: number): string {
  return `${clockOf(a.received)}  ${a.eventName}${a.areas.length ? ` · ${a.areas.slice(0, 3).join(', ')}` : ''}${a.active ? ' · ACTIVE' : a.expires ? ` · ended ${ago(a.expires, now)}` : ''}${a.source === 'selftest' ? ' (test)' : ''}`
}

const alertsSection: Section = {
  id: 'alerts',
  title: 'Weather alerts',
  color: TEAL,
  order: 30,
  verbs: ['alerts', 'alert', 'same'],
  render: ctx => {
    const { Box, Text, Code } = ctx.els
    const Svg = svgOf(ctx)
    const isOn = jobOn(ctx, 'same')
    const v = alerts
    const ex = isOn ? '' : jobExitLine(ctx, 'same', 'The alert watch')
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">{ctx.narrow ? `Listens to ${noaaShort()} (${wxFreqText()}) for the alert tones and decodes them.` : `Listens to NOAA Weather Radio${LOC.wxStation ? ` ${LOC.wxStation}` : ''} (${wxFreqText()} MHz) for the coded alert burst sent before every warning, watch and weekly test, and decodes what, where and until when.`}</Text>
        {ctrlRow(ctx.els, 'alerts-row', 'Watch', [
          ctrl(ctx.els, 'alerts-toggle', look(K.job('same', !isOn), isOn ? '■ Watch off' : '▶ Watch on', isOn ? 'Stopping…' : 'Starting…', 'Queued…'), () => void toggleJob(ctx, 'same', !isOn), !isOn),
          ctrl(ctx.els, 'alerts-test', look(K.alertsTest, 'Test the decoder', 'Testing…', 'Queued: test'), () => void testAlerts(ctx)),
        ])}
        {(v?.active ?? []).map(a =>
          Svg && a.cardSvg ? (
            <Svg key={`card:${a.id}`} source={a.cardSvg} alt={`${a.eventName} (${a.severity}) ${a.cardText?.split('\n')[2] ?? ''}`} />
          ) : (
            <Box key={`card:${a.id}`} flexDirection="column">
              <Text bold color={a.severity === 'test' ? 'cyan' : a.severity === 'watch' ? 'yellow' : 'red'}>{`⚠ ${a.eventName.toUpperCase()}`}</Text>
              {a.cardText ? <Code source={a.cardText} /> : null}
            </Box>
          ),
        )}
        <Text wrap="wrap" color={isOn ? 'green' : undefined}>
          {`${isOn ? `Watching${ctx.status?.jobs?.same?.since ? ` since ${clockOf(ctx.status.jobs.same.since)}` : ''}` : 'Off'} · ${v?.activeCount ? `${v.activeCount} active alert${v.activeCount === 1 ? '' : 's'}` : 'no active alerts'}`}
        </Text>
        {ex ? <Text color="yellow" wrap="wrap">{ex}</Text> : null}
        <Text dimColor wrap="wrap">{v?.nextTest.say ?? 'The weekly test (RWT) is usually Wednesday late morning.'}</Text>
        {(v?.history ?? []).filter(h => !h.active).slice(0, 4).map(h => (
          <Text key={`hist:${h.id}`} dimColor wrap="truncate-end">{alertBrief(h, ctx.now)}</Text>
        ))}
        {sameTest ? (
          <Box flexDirection="column" paddingTop={1}>
            <Text color={sameTest.ok ? 'green' : 'red'} wrap="wrap">{sameTest.say}</Text>
            {Svg && sameTest.cardSvg ? <Svg source={sameTest.cardSvg} alt={`Decoded test alert: ${sameTest.card?.split('\n')[0] ?? ''}`} /> : sameTest.card ? <Code source={sameTest.card} /> : null}
          </Box>
        ) : null}
      </Box>
    )
  },
  text: ctx => {
    const isOn = jobOn(ctx, 'same')
    const act = alerts?.active ?? []
    if (act.length) return `⚠ ${act.map(a => a.eventName).join(', ')} (${noaaShort()}) · /sdr alerts`
    return `Weather alert watch ${isOn ? 'on: no active alerts' : 'off'} · /sdr alerts${isOn ? '' : ' on'}`
  },
  command: async (ctx, _verb, arg) => {
    const a = arg.toLowerCase()
    if (/^(off|stop)/.test(a)) return toggleJob(ctx, 'same', false)
    if (/^test/.test(a)) {
      await testAlerts(ctx)
      return [sameTest?.say ?? 'The test did not run.', sameTest?.card ?? ''].filter(Boolean).join('\n')
    }
    let head = ''
    if (/^(on|start|watch)/.test(a)) head = await toggleJob(ctx, 'same', true)
    await fetchAlerts(ctx)
    const v = alerts
    const lines = [head]
    for (const al of v?.active ?? []) lines.push(al.cardText ?? al.eventName)
    if (!v?.activeCount) lines.push(`No active alerts${jobOn(ctx, 'same') ? ` (watching ${LOC.wxStation || 'NOAA'} ${wxFreqText()})` : ''}.`)
    lines.push(v?.nextTest.say ?? '')
    for (const h of (v?.history ?? []).filter(x => !x.active).slice(0, 5)) lines.push(`  ${alertBrief(h, ctx.now)}`)
    lines.push(jobOn(ctx, 'same') ? '/sdr alerts off stops the watch · /sdr alerts test checks the decoder' : '/sdr alerts on watches · /sdr alerts test checks the decoder')
    return lines.filter(Boolean).join('\n')
  },
  poll: async ctx => {
    const isOn = jobOn(ctx, 'same')
    const every = ctx.watched ? 10_000 : 60_000
    if ((isOn && ctx.now - alertsAt >= every) || (alertsStale && (ctx.watched || !alerts))) await fetchAlerts(ctx)
  },
}

async function testAlerts(ctx: SectionContext): Promise<void> {
  await ctx.act(
    'Testing the alert decoder',
    async () => {
      const r = await ctx.python('digital.py', ['same', 'selftest', '--svg'], 60_000)
      sameTest = { ok: !!r?.ok, say: r?.say ?? 'The decoder test did not run.', header: r?.header, card: r?.card, cardSvg: r?.cardSvg, alert: r?.alert ?? null }
      ctx.setNote(sameTest.ok ? 'The weather alert decoder works: it decoded a test alert made on the Mac (no radio needed).' : sameTest.say)
      if (!sameTest.ok) failed(sameTest.say)
    },
    { key: K.alertsTest, plan: () => ({ step: 'decoding a test alert made on the Mac (no radio)', ms: 3000 }) },
  )
}

// ---- Web SDR (webrx/)

// webrx/status.sh (docker inspect, ~0.2-0.8 s) runs beside the V4 lane: a press never waits on
// it. A reading that comes back after a press started or ended is dropped and read again.
async function fetchWeb(ctx: SectionContext): Promise<void> {
  const r = (await ctx.run('webrx/status.sh', [], 15_000)) as WebStatus & { stale?: boolean }
  webAt = ctx.now
  if (r?.stale) {
    webStale = true
    return
  }
  webStale = false
  const same = sameRead(web, r)
  if (r && typeof r.running === 'boolean') web = r
  if (!same) ctx.redraw()
}

function webUrlsText(w: WebStatus | null): string {
  if (!w?.running) return ''
  const u = w.urls ?? {}
  return [u.local ? `This Mac: ${u.local}` : '', u.lan ? `home Wi-Fi: ${u.lan}` : '', u.tailscale ? `Tailscale: ${u.tailscale}` : ''].filter(Boolean).join(' · ')
}

// Bookmarks for Web SDR from the tab: its name tables, the presets' notable frequencies and what
// recent scans found busy (webrx.py sync-bookmarks; Web SDR also runs it on every start).
async function syncBookmarks(ctx: SectionContext): Promise<string> {
  let text = ''
  const label = 'Syncing Web SDR bookmarks'
  const end = await ctx.act(
    label,
    async () => {
      const r = await ctx.run('webrx/sync-bookmarks.sh', [], 30_000)
      webBookmarks = r?.ok ? String(r.say ?? '') : ''
      text = r?.ok ? `${r.say} Web SDR shows them the next time its page loads or changes band.` : r?.say ?? 'The bookmark sync did not run.'
      if (!r?.ok) failed(text)
      ctx.setNote(text)
    },
    { key: K.sync, plan: () => ({ step: 'writing the tab’s stations into Web SDR’s bookmarks', ms: 2000 }) },
  )
  return text || endText(end, label)
}

// What Web SDR decodes while nobody has its page open (its settings: background decoding).
function backgroundText(w: WebStatus | null, narrow: boolean): string {
  const b = w?.background
  if (b && !b.enabled) return 'Background decoding is off (Web SDR Settings › Background decoding turns it back on).'
  const how = narrow
    ? 'While nobody has the page open, Web SDR decodes APRS on 144.390 (its Map) and, about midnight to 6 am, 433 MHz gadgets.'
    : 'Background decoding: while Web SDR runs and nobody has its page open, OpenWebRX+ sits on 2 m and decodes APRS on 144.390 MHz (stations land on its Map) and, from about midnight to 6 am, 433 MHz gadgets (rtl_433). Opening the page joins whatever it is decoding; pick another profile and listeners always win.'
  return `${how} Web SDR still holds the V4 the whole time, so the tab's own jobs wait until it stops (starting one stops it, as always).`
}

const SEND_HINT = 'Send to Radio tab: the amber button under the frequency in Web SDR hands what it is tuned to back here. The tab stops Web SDR, tunes the V4 there and plays it on the Mac (wide FM, narrow FM or AM), as long as this tab is open in Claude Code.'

const webSection: Section = {
  id: 'websdr',
  title: 'Web SDR',
  color: MAGENTA,
  order: 40,
  verbs: ['web', 'websdr', 'webrx'],
  render: ctx => {
    const { Box, Text, Code, Link } = ctx.els
    const isOn = jobOn(ctx, 'webrx')
    const w = web
    const u = w?.urls ?? {}
    const starting = current?.key === K.job('webrx', true)
    const ex = isOn ? '' : jobExitLine(ctx, 'webrx', 'Web SDR')
    const state = isOn ? (w?.running ? `running · ${w.health ?? 'starting'}` : 'running · checking…') : starting ? 'starting…' : 'off'
    const mapHref = w?.map ?? (u.local ? `${localHref(u.local)}map` : null)
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">A full live waterfall in any browser — tap a signal to hear it; the phone works on home Wi-Fi.</Text>
        {ctrlRow(ctx.els, 'web-row', 'Web SDR', [
          ctrl(ctx.els, 'web-toggle', look(K.job('webrx', !isOn), isOn ? '■ Web SDR off' : '▶ Web SDR on', isOn ? 'Stopping…' : 'Starting… (~20 s)', 'Queued…'), () => void toggleJob(ctx, 'webrx', !isOn), !isOn),
          <Text key="web-state" color={isOn && w?.health === 'healthy' ? 'green' : undefined}>{state}</Text>,
        ])}
        {ex ? <Text color="yellow" wrap="wrap">{ex}</Text> : null}
        {isOn && w?.running ? (
          <Box flexDirection="column">
            {u.local ? ctrlRow(ctx.els, 'web-local', 'This Mac', [<Link key="web-link-local" href={localHref(u.local)} label={u.local} />]) : null}
            {u.lan ? ctrlRow(ctx.els, 'web-lan', 'Home Wi-Fi', [<Text key="web-lan-url" bold>{u.lan}</Text>, <Text key="web-lan-hint" dimColor>{ctx.narrow ? '' : '  type it into the phone’s browser'}</Text>]) : null}
            {u.tailscale ? ctrlRow(ctx.els, 'web-ts', 'Tailscale', [<Link key="web-link-ts" href={localHref(u.tailscale)} label={u.tailscale} />]) : null}
            {mapHref ? ctrlRow(ctx.els, 'web-map', 'Map', [<Link key="web-link-map" href={mapHref} label={ctx.narrow ? 'Web SDR map' : `${mapHref}  (APRS stations and what else it decodes)`} />]) : null}
            <Text dimColor wrap="wrap">On the iPhone, tap Start once so Safari plays the audio. Log in as admin (the password is in the Mac's Keychain, item openwebrx-wildcat) only to change settings.</Text>
          </Box>
        ) : (
          <Text dimColor wrap="wrap">{isOn ? 'Checking the container…' : 'Turn it on to get the links. It takes the V4 over (whatever is on it stops) and takes about 20 s.'}</Text>
        )}
        {ctrlRow(ctx.els, 'web-bm', 'Bookmarks', [
          ctrl(ctx.els, 'web-sync', look(K.sync, '↻ Sync bookmarks', 'Syncing…', 'Queued: sync'), () => void syncBookmarks(ctx)),
          <Text key="web-bm-state" dimColor wrap="wrap">
            {webBookmarks || (ctx.narrow ? 'from the tab’s stations and scans' : 'the tab’s stations, notable frequencies and what recent scans found busy')}
          </Text>,
        ])}
        <Text dimColor wrap="wrap">{SEND_HINT}</Text>
        <Text dimColor wrap="wrap">{backgroundText(w, ctx.narrow)}</Text>
        {!u.tailscale ? (
          <Box flexDirection="column">
            <Text dimColor wrap="wrap">Away from home (optional, not set up): run this once in a terminal to reach it over Tailscale.</Text>
            <Code key="web-ts-cmd" source={TAILSCALE_SERVE} language="sh" />
          </Box>
        ) : null}
      </Box>
    )
  },
  text: ctx => (jobOn(ctx, 'webrx') ? `Web SDR on: ${webUrlsText(web) || 'starting'} · /sdr web off` : 'Web SDR off · /sdr web on'),
  command: async (ctx, _verb, arg) => {
    const a = arg.toLowerCase()
    if (/^(off|stop)/.test(a)) return toggleJob(ctx, 'webrx', false)
    if (/^(sync|bookmarks)/.test(a)) return syncBookmarks(ctx)
    let head = ''
    if (/^(on|start)/.test(a)) head = await toggleJob(ctx, 'webrx', true)
    await fetchWeb(ctx)
    const isOn = jobOn(ctx, 'webrx')
    const lines = [head]
    if (isOn && web?.running) {
      const u = web.urls ?? {}
      if (u.local) lines.push(`This Mac: ${u.local}`)
      if (u.lan) lines.push(`Phone on home Wi-Fi: ${u.lan}`)
      if (u.tailscale) lines.push(`Tailscale: ${u.tailscale}`)
      if (web.map) lines.push(`Map: ${web.map}`)
      lines.push(`Status: ${web.health ?? 'starting'}. A full live waterfall in any browser — tap a signal to hear it.`)
      lines.push(SEND_HINT)
      lines.push(backgroundText(web, false))
    } else lines.push('Web SDR is off. /sdr web on starts it (it takes the V4 over, about 20 s).')
    lines.push('/sdr web sync refreshes its bookmarks from the tab.')
    if (!web?.urls?.tailscale) lines.push(`Away from home (optional): ${TAILSCALE_SERVE}`)
    return lines.filter(Boolean).join('\n')
  },
  // status.sh runs in the free lane and is not waited for (one at a time: a second asks the first).
  poll: async ctx => {
    const isOn = jobOn(ctx, 'webrx')
    if ((isOn && ctx.watched && ctx.now - webAt >= 10_000) || (webStale && (ctx.watched || !web))) bg(fetchWeb(ctx))
  },
}

// ---- Recordings (radio.py rec / log / record / recordings / play): ● Rec and Log on the tuner, the list below

async function fetchRecs(ctx: SectionContext): Promise<void> {
  const r = (await ctx.radio(['recordings'], 30_000)) as RecView
  recsAt = ctx.now
  recsStale = false
  const same = sameRead(recs, r)
  if (r?.ok && Array.isArray(r.items)) recs = r
  if (!same) ctx.redraw()
}

// ● Rec: what plays, into ~/Radio/Recordings (the tap tees it; the audio never stops).
async function setRec(ctx: SectionContext, want: boolean): Promise<string> {
  let text = ''
  const label = want ? 'Starting ● Rec' : 'Saving the recording'
  const end = await ctx.act(
    label,
    async () => {
      const r = await ctx.radio(['rec', want ? 'start' : 'stop'], 20_000)
      text = r?.say ?? (want ? '● Rec did not start.' : 'Rec off.')
      if (meter) meter = { ...meter, rec: want && r?.ok ? (r.rec as RecLive) : null }
      if (!r?.ok) failed(text)
      recsStale = true
      ctx.setNote(text)
      await ctx.refresh()
    },
    { key: K.rec(want), plan: () => ({ step: want ? 'teeing what plays into a file' : 'closing the file', ms: 1500 }) },
  )
  if (recsStale) await fetchRecs(ctx)
  return text || endText(end, label)
}

// Log: one clip per transmission, until turned off.
async function setLog(ctx: SectionContext, want: boolean): Promise<string> {
  let text = ''
  const label = want ? 'Turning Log on' : 'Turning Log off'
  const end = await ctx.act(
    label,
    async () => {
      const r = await ctx.radio(['log', want ? 'start' : 'stop'], 20_000)
      text = r?.say ?? 'Log did not answer.'
      if (recs && r?.ok) recs = { ...recs, log: { ...recs.log, on: want, since: r.log?.since ?? recs.log.since, count: want ? recs.log.count : 0 } }
      if (!r?.ok) failed(text)
      recsStale = true
      ctx.setNote(text)
    },
    { key: K.log(want), plan: () => ({ step: want ? 'keeping each transmission as a clip' : 'closing the last clip', ms: 1000 }) },
  )
  if (recsStale) await fetchRecs(ctx)
  return text || endText(end, label)
}

// A timed recording: what plays, or Listen started muted for it (it stops by itself).
async function recordFor(ctx: SectionContext, freq: number, mode: string | null, secs: number): Promise<string> {
  let text = ''
  const label = `Recording ${mhz(freq)} MHz`
  const end = await ctx.act(
    label,
    async () => {
      const r = await ctx.radio(['record', mhz(freq), ...(mode ? [mode] : []), String(Math.round(secs))], 60_000)
      text = r?.ok ? `${r.say}${ctx.stoppedText(r.stopped)}` : r?.say ?? 'The recording did not start.'
      if (r?.ok && r.listen) {
        ctx.stopped('listen', r.stopped)
        setTuner(freq, r.listen.mode ?? mode)
        if ((r.stopped ?? []).some((x: Stopped) => x.kind === 'live')) {
          liveNote = `Live view stopped so the V4 could record ${r.listen.label ?? `${mhz(freq)} MHz`}.`
          if (liveFrame) liveFrame = { ...liveFrame, running: false }
        }
      }
      if (!r?.ok) failed(text)
      recsStale = true
      ctx.setNote(text)
      await ctx.refresh()
    },
    { key: K.record(freq), plan: () => takeover('record', 'starting Listen muted and recording it', 2500, 'listen') },
  )
  if (recsStale) await fetchRecs(ctx)
  return text || endText(end, label)
}

// Playback, the Trash and Finder are presses too: shown at once, queued behind a V4 press.
async function playRec(ctx: SectionContext, file: string): Promise<void> {
  await ctx.act(
    'Playing a recording',
    async () => {
      const r = await ctx.radio(['play', file], 15_000)
      ctx.setNote(r?.say ?? 'It did not play.')
      if (!r?.ok) failed(r?.say ?? 'It did not play.')
      await fetchRecs(ctx)
    },
    { key: K.play(file), plan: () => ({ step: 'starting the player', ms: 800 }) },
  )
}

async function stopPlayback(ctx: SectionContext): Promise<void> {
  await ctx.act(
    'Stopping the playback',
    async () => {
      const r = await ctx.radio(['play', 'stop'], 15_000)
      ctx.setNote(r?.say ?? 'Stopped.')
      await fetchRecs(ctx)
    },
    { key: K.playStop, plan: () => ({ step: 'stopping the player', ms: 600 }) },
  )
}

async function trashRec(ctx: SectionContext, file: string): Promise<void> {
  await ctx.act(
    'Moving a recording to the Trash',
    async () => {
      const r = await ctx.radio(['rec', 'delete', file], 30_000)
      ctx.setNote(r?.ok ? `${r.say} (Finder can put it back.)` : r?.say ?? 'It was not moved.')
      if (!r?.ok) failed(r?.say ?? 'It was not moved.')
      await fetchRecs(ctx)
    },
    { key: K.trash(file), plan: () => ({ step: 'moving the file to the Trash', ms: 800 }) },
  )
}

async function revealRecs(ctx: SectionContext): Promise<void> {
  await ctx.act(
    'Opening Recordings in Finder',
    async () => {
      const r = await ctx.radio(['rec', 'reveal'], 15_000)
      ctx.setNote(r?.say ?? '')
    },
    { key: K.reveal, plan: () => ({ step: 'opening Finder', ms: 800 }) },
  )
}

function recName(it: Recording): string {
  const st0 = it.station || (it.label && !/MHz$/.test(it.label) ? it.label : '')
  return st0 || (it.clip ? 'transmission' : 'recording')
}

// ● Rec's file while it records: the tap's own reading, else what radio.py recordings last said.
function recLiveNow(): RecLive | null {
  return st?.listen.running ? meter?.rec ?? recs?.rec ?? null : null
}

function logCountLine(): string {
  const l = recs?.log
  if (!l?.on) return ''
  return `Log: ${l.count} transmission${l.count === 1 ? '' : 's'}${l.since ? ` since ${clockOf(l.since)}` : ''}${l.open ? ' · ● saving one now' : ''}`
}

// The Record row's words: ● Rec's file growing, Log's counter, or how to use them.
function recLine(playing: boolean, m: Meter | null): { text: string; color?: string } {
  const bits: string[] = []
  const r = m?.rec
  if (playing && r) bits.push(`● REC ${dur(r.seconds)} · ${sizeOf(r.bytes)}${r.until ? ` · ${dur(Math.max(0, (r.until - (m?.at ?? r.until)) / 1000))} left` : ''}`)
  if (playing && m?.recError) return { text: m.recError, color: 'red' }
  const lc = logCountLine()
  if (lc) bits.push(lc)
  if (recs?.log.on && playing && (m?.log?.skipped === 'broadcast' || recs.log.skipped === 'broadcast')) bits.push('Log waits for a voice channel: broadcasts never stop')
  if (bits.length) return { text: bits.join(' · '), color: r ? 'red' : 'yellow' }
  if (playing && st?.listen.running && !st.listen.tap && !m?.tap) return { text: 'Rec and Log need Listen started once more (■ Stop, ▶ Listen): it began before recording was added' }
  return { text: playing ? 'Rec saves what plays; Log keeps each transmission as a clip' : 'Rec and Log work while Listen plays' }
}

function recRowText(it: Recording, now: number): string {
  return `${clockOf(it.start)}  ${mhz(it.freq)}  ${recName(it)}${it.clip ? ' (clip)' : ''}  ${it.recording ? '● recording' : dur(it.duration)}  ${sizeOf(it.size)}`
}

function olderLine(d: RecDay): string {
  const bits = [d.clips ? `${d.clips} clip${d.clips === 1 ? '' : 's'}` : '', d.recordings ? `${d.recordings} recording${d.recordings === 1 ? '' : 's'}` : ''].filter(Boolean)
  const mins = d.seconds >= 60 ? `${Math.round(d.seconds / 60)} min` : `${Math.round(d.seconds)} s`
  return `${d.label}: ${bits.join(', ')}, ${mins} · ${sizeOf(d.bytes)}`
}

function diskLine(r: RecView): string {
  return `On disk: ${sizeOf(r.total.bytes)} of ${r.keep.gb} GB · kept ${r.keep.days} days, then the oldest go to the Trash`
}

const recordingsSection: Section = {
  id: 'recordings',
  title: 'Recordings',
  color: RED,
  order: 5,
  verbs: ['recordings', 'recording', 'rec', 'log', 'record'],
  render: ctx => {
    const { Box, Text, Button } = ctx.els
    const r = recs
    const items = r?.items ?? []
    const limit = recsMore ? 60 : ctx.narrow ? 6 : 10
    const shown = items.slice(0, limit)
    const playingFile = r?.playing?.file ?? null
    const listenOn = !!ctx.status?.listen.running
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">
          {ctx.narrow
            ? 'What ● Rec and Log saved today. ▶ plays it on the Mac, over Listen if that is on.'
            : `What ● Rec (on the tuner) and Log saved today, newest first, in ~/Radio/Recordings. ▶ plays it on the Mac${listenOn ? '; Listen keeps going underneath so Rec and Log keep saving (■ Stop it for a clean listen)' : ''}. 🗑 moves it to the Trash.`}
        </Text>
        {ctrlRow(ctx.els, 'recs-row', 'Files', [
          ctrl(ctx.els, 'recs-finder', look(K.reveal, 'Show in Finder', 'Opening…', 'Queued…'), () => void revealRecs(ctx)),
          ...(r?.playing ? [ctrl(ctx.els, 'recs-stop-play', look(K.playStop, '■ Stop playback', 'Stopping…', 'Queued…'), () => void stopPlayback(ctx), true)] : []),
        ])}
        {logCountLine() ? <Text color="yellow" wrap="wrap">{logCountLine()}</Text> : null}
        {!items.length ? (
          <Text dimColor wrap="wrap">{r ? 'Nothing recorded today yet: ● Rec on the tuner while Listen plays, or turn Log on over a busy channel (Air, Ham, Marine).' : 'Reading ~/Radio/Recordings…'}</Text>
        ) : null}
        {shown.map(it => {
          const isPlaying = playingFile === it.file
          const play = it.recording ? (
            <Text key={`rec-live:${it.file}`} color="red">{'●'}</Text>
          ) : (
            <Button key={`rec-play:${it.file}`} label={isPlaying ? '■' : look(K.play(it.file), '▶', '…', '⋯').label} variant={isPlaying || current?.key === K.play(it.file) ? 'primary' : undefined} onPress={() => void (isPlaying ? stopPlayback(ctx) : playRec(ctx, it.file))} />
          )
          if (ctx.narrow)
            return (
              <Box key={`rec:${it.file}`} flexWrap="wrap" backgroundColor={isPlaying ? '#12301f' : undefined}>
                <Box width={6}>{play}</Box>
                <Text wrap="truncate-end">{`${clockOf(it.start)} ${mhz(it.freq)} ${recName(it).slice(0, 14)}${it.clip ? '·clip' : ''} ${it.recording ? 'rec' : dur(it.duration)}`}</Text>
              </Box>
            )
          return (
            <Box key={`rec:${it.file}`} flexWrap="wrap" backgroundColor={isPlaying ? '#12301f' : undefined}>
              <Box width={6}>{play}</Box>
              <Box width={9}>
                <Text>{clockOf(it.start)}</Text>
              </Box>
              <Box width={9}>
                <Text bold>{mhz(it.freq)}</Text>
              </Box>
              <Box width={28}>
                <Text wrap="truncate-end">{`${recName(it)}${it.clip ? ' · clip' : it.timed ? ' · timed' : ''}`}</Text>
              </Box>
              <Box width={8}>
                <Text color={it.recording ? 'red' : undefined} dimColor={!it.recording}>{it.recording ? '● rec' : dur(it.duration)}</Text>
              </Box>
              <Box width={9}>
                <Text dimColor>{sizeOf(it.size)}</Text>
              </Box>
              {it.recording ? null : <Button key={`rec-del:${it.file}`} plain label={look(K.trash(it.file), '🗑', '…', '⋯').label} onPress={() => void trashRec(ctx, it.file)} />}
            </Box>
          )
        })}
        {items.length > limit || recsMore ? (
          <Box>
            <Button
              key="recs-more"
              plain
              label={recsMore ? 'fewer' : `more… (${items.length - limit})`}
              onPress={() => {
                recsMore = !recsMore
                ctx.redraw()
              }}
            />
          </Box>
        ) : null}
        {(r?.older ?? []).slice(0, ctx.narrow ? 2 : 4).map(d => (
          <Text key={`older:${d.day}`} dimColor wrap="truncate-end">{olderLine(d)}</Text>
        ))}
        {r ? <Text dimColor wrap="wrap">{`${diskLine(r)}${ctx.narrow ? '' : ' (/sdr rec keep <GB> changes it)'}`}</Text> : null}
      </Box>
    )
  },
  text: () => {
    const r = recs
    if (!r) return null
    const n = r.items.length
    const clips = r.items.filter(i => i.clip).length
    const bits = [`Recordings today: ${n ? `${n - clips} recording${n - clips === 1 ? '' : 's'}, ${clips} clip${clips === 1 ? '' : 's'}` : 'none'}`, `${sizeOf(r.total.bytes)} on disk`]
    const rl = recLiveNow()
    if (rl) bits.push(`● recording ${dur(rl.seconds)}`)
    if (r.log.on) bits.push(logCountLine())
    return `${bits.join(' · ')} · /sdr recordings`
  },
  command: async (ctx, verb, arg) => {
    const a = arg.trim().toLowerCase()
    if (verb === 'rec') {
      if (/^(on|start)$/.test(a)) return setRec(ctx, true)
      if (/^(off|stop)$/.test(a)) return setRec(ctx, false)
      const keep = a.match(/^keep\s+(\d+(?:\.\d+)?)(?:\s*gb)?(?:\s+(\d+))?/)
      if (keep) {
        const r = await ctx.radio(['rec', 'keep', keep[1] ?? '2', ...(keep[2] ? [keep[2]] : [])], 60_000)
        recsStale = true
        await fetchRecs(ctx)
        return r?.say ?? 'It did not change.'
      }
      if (a === 'keep') {
        const r = await ctx.radio(['rec', 'keep'], 15_000)
        return r?.say ?? ''
      }
      if (a) return 'Rec: /sdr rec on|off (what plays) · /sdr rec keep <GB> [days] (how much to keep).'
    }
    if (verb === 'log') {
      if (/^(on|start)$/.test(a)) return setLog(ctx, true)
      if (/^(off|stop)$/.test(a)) return setLog(ctx, false)
      if (a) return 'Log: /sdr log on|off. With Log on, each transmission on a voice channel is saved as a clip.'
    }
    if (verb === 'record') {
      const m = a.match(/^(\d+(?:\.\d+)?)\s*(?:mhz)?\s+(?:(wbfm|wfm|fm|nfm|am)\s+)?(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?$/)
      if (!m) return 'Record: /sdr record <MHz> [wbfm|fm|am] <seconds>, e.g. /sdr record 162.55 fm 30. It records what plays when Listen is on that frequency, else starts Listen muted and stops by itself.'
      const md = m[2] === 'wfm' ? 'wbfm' : m[2] === 'nfm' ? 'fm' : m[2] ?? null
      return recordFor(ctx, Number(m[1]), md, Number(m[3]))
    }
    await fetchRecs(ctx)
    const r = recs
    if (!r) return 'Could not read ~/Radio/Recordings.'
    const lines = [`Today: ${r.items.length ? `${r.items.length} file${r.items.length === 1 ? '' : 's'}` : 'nothing recorded yet'} · ${diskLine(r)}`]
    for (const it of r.items.slice(0, 25)) lines.push(`  ${recRowText(it, ctx.now)}`)
    if (r.items.length > 25) lines.push(`  …and ${r.items.length - 25} more (Show in Finder in the tab)`)
    for (const d of r.older.slice(0, 5)) lines.push(olderLine(d))
    const live = recLiveNow()
    lines.push(live ? `● Rec on: ${live.file} (${dur(live.seconds)})` : '● Rec off')
    lines.push(r.log.on ? logCountLine() : 'Log off')
    if (r.playing) lines.push(`Playing ${r.playing.file} on the Mac.`)
    lines.push('/sdr rec on|off · /sdr log on|off · /sdr record <MHz> [mode] <sec> · /sdr rec keep <GB>. ▶ in the tab plays one on the Mac (the phone too).')
    return lines.join('\n')
  },
  poll: async ctx => {
    const active = !!(recs?.rec || recs?.log.on || recs?.playing || meter?.rec)
    if ((ctx.watched && (recsStale || ctx.now - recsAt >= (active ? RECS_MS : 30_000))) || (recsStale && !recs)) await fetchRecs(ctx)
  },
}

// ---- the Scanner (0.4.0, radio.py scan list|on|off|…): favourites cycled with squelch; stop and
// play when one opens, resume after the quiet; lock-out, skip, hold, a priority channel. Hits feed
// the transmission logger (clips save when Log is on). One exclusive V4 job ("scanner").

async function fetchScanner(ctx: SectionContext): Promise<void> {
  const r = (await ctx.radio(['scan', 'list'], 20_000)) as ScannerView
  scannerAt = ctx.now
  scannerStale = false
  const same = sameRead(scanner, r)
  if (r && Array.isArray(r.channels)) scanner = r
  if (!same) ctx.redraw()
}

async function toggleScanner(ctx: SectionContext, want: boolean): Promise<string> {
  let text = ''
  const label = want ? 'Starting the scanner' : 'Stopping the scanner'
  const end = await ctx.act(
    label,
    async () => {
      const r = await ctx.radio(['scan', want ? 'on' : 'off'], 30_000)
      // `scan on` answers with the list of what it stopped; `scan off` with a boolean (was it running).
      const stoppedList = want && Array.isArray(r?.stopped) ? (r.stopped as Stopped[]) : undefined
      text = r?.ok ? `${r.say}${ctx.stoppedText(stoppedList)}` : r?.say ?? (want ? 'The scanner did not start.' : 'The scanner did not stop.')
      if (r?.ok && want) ctx.stopped('scanner', stoppedList)
      if (!r?.ok) failed(text)
      scannerStale = true
      ctx.setNote(text)
      await ctx.refresh()
    },
    { key: K.scanner(want), plan: () => (want ? takeover('scanner', 'starting the scanner on the favourites', 2500, 'scanner') : { step: 'stopping the scanner', ms: 1200 }) },
  )
  if (scannerStale) await fetchScanner(ctx)
  return text || endText(end, label)
}

// hold / resume / skip / lockout / unlock / priority: edits to the scanner's list, shown at once.
async function scannerCtl(ctx: SectionContext, label: string, key: string, args: string[]): Promise<string> {
  let text = ''
  const end = await ctx.act(
    label,
    async () => {
      const r = await ctx.radio(['scan', ...args], 20_000)
      text = r?.say ?? 'It did not answer.'
      if (!r?.ok) failed(text)
      scannerStale = true
      ctx.setNote(text)
    },
    { key, plan: () => ({ step: label.toLowerCase(), ms: 600 }) },
  )
  if (scannerStale) await fetchScanner(ctx)
  return text || endText(end, label)
}

function scanStateLine(v: ScannerView | null, now: number): { text: string; color?: string } {
  if (!v) return { text: 'reading the favourites…' }
  if (!v.running) return { text: `off · ${v.active} channel${v.active === 1 ? '' : 's'} to scan${v.lockout.length ? `, ${v.lockout.length} locked out` : ''}` }
  const s = v.state
  if (!s) return { text: 'starting…', color: 'cyan' }
  if (s.empty) return { text: 'nothing to scan: add a channel or clear the lock-outs', color: 'yellow' }
  if (s.hold && s.current) return { text: `holding on ${s.current.name} (${mhz(s.current.freq)})`, color: 'yellow' }
  if (s.parked && s.current) return { text: `▶ stopped on ${s.current.name} · ${mhz(s.current.freq)} ${modeChip(s.current.mode as Mode)} · ${dur(Math.max(0, (now - (s.hits.at(-1)?.at ?? now)) / 1000))}`, color: 'green' }
  if (s.current) return { text: `scanning · at ${mhz(s.current.freq)} ${s.current.name}`, color: 'cyan' }
  return { text: 'scanning…', color: 'cyan' }
}

function hitLine(h: ScanHit): string {
  return `${clockOf(h.at)}  ${mhz(h.freq)}  ${h.name}${h.secs ? ` · ${dur(h.secs)}` : ''}`
}

const scannerSection: Section = {
  id: 'scanner',
  title: 'Scanner',
  color: GREEN,
  order: 3,
  verbs: ['scanner'],
  render: ctx => {
    const { Box, Text, Button } = ctx.els
    const v = scanner
    const on = jobOn(ctx, 'scanner')
    const sl = scanStateLine(v, ctx.now)
    const lock = new Set((v?.lockout ?? []).map(f => Number(f.toFixed(4))))
    const pri = v?.priority ?? null
    const hits = v?.hits ?? []
    const chans = v?.channels ?? []
    const hold = !!v?.state?.hold
    const curF = v?.state?.current?.freq ?? null
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">
          {ctx.narrow
            ? 'Cycles the favourites with squelch; stops and plays when one opens, resumes after a few seconds of quiet. Log saves each hit as a clip.'
            : 'Cycles the favourite channels with squelch on; stops and plays when one opens, and resumes after a few seconds of quiet. Hits go to the transmission logger, so clips save while Log is on. One thing on the V4 at a time: starting it stops whatever else runs.'}
        </Text>
        {ctrlRow(ctx.els, 'scan-row', 'Scanner', [
          ctrl(ctx.els, 'scan-toggle', look(K.scanner(!on), on ? '■ Scan off' : '▶ Scan on', on ? 'Stopping…' : 'Starting…', 'Queued…'), () => void toggleScanner(ctx, !on), !on),
          <Text key="scan-state" color={sl.color} dimColor={!sl.color} wrap="wrap">{sl.text}</Text>,
        ])}
        {on
          ? ctrlRow(ctx.els, 'scan-ctl', 'Controls', [
              ctrl(ctx.els, 'scan-hold', look(hold ? K.scanResume : K.scanHold, hold ? '▶ Resume' : '⏸ Hold', '…', 'Queued…'), () => void scannerCtl(ctx, hold ? 'Resuming the scan' : 'Holding the scanner', hold ? K.scanResume : K.scanHold, [hold ? 'resume' : 'hold'])),
              ctrl(ctx.els, 'scan-skip', look(K.scanSkip, '⏭ Skip', '…', 'Queued…'), () => void scannerCtl(ctx, 'Skipping to the next channel', K.scanSkip, ['skip'])),
              // The phone puts Lock out on its own line (below); the frequency is in the state line already.
              ...(curF !== null && !ctx.narrow ? [ctrl(ctx.els, 'scan-lock-cur', look(K.scanLock(curF), `⛔ Lock out ${mhz(curF)}`, '…', 'Queued…'), () => void scannerCtl(ctx, `Locking out ${mhz(curF)} MHz`, K.scanLock(curF), ['lockout', mhz(curF)]))] : []),
            ])
          : null}
        {on && curF !== null && ctx.narrow
          ? ctrlRow(ctx.els, 'scan-ctl2', '', [ctrl(ctx.els, 'scan-lock-cur', look(K.scanLock(curF), '⛔ Lock out', '…', 'Queued…'), () => void scannerCtl(ctx, `Locking out ${mhz(curF)} MHz`, K.scanLock(curF), ['lockout', mhz(curF)]))])
          : null}
        {ctrlRow(ctx.els, 'scan-pri', 'Priority', [
          <Text key="scan-pri-text" wrap="wrap">{pri !== null ? `${mhz(pri)} MHz, checked every few seconds` : 'none — ★ on a channel below makes it the priority channel'}</Text>,
          ...(pri !== null ? [ctrl(ctx.els, 'scan-pri-off', look(K.scanPriOff, 'clear', '…', 'Queued…'), () => void scannerCtl(ctx, 'Clearing the priority channel', K.scanPriOff, ['priority', 'off']))] : []),
        ])}
        {hits.length ? (
          <Box flexDirection="column">
            <Text dimColor>{`Hits (${hits.length}${hits.length >= 20 ? ', the last 20' : ''}):`}</Text>
            {[...hits].reverse().slice(0, ctx.narrow ? 4 : 8).map((hit, i) => (
              <Text key={`hit:${hit.at}:${i}`} wrap="truncate-end">{`  ${hitLine(hit)}`}</Text>
            ))}
          </Box>
        ) : on ? (
          <Text dimColor>No hits yet: it stops here the moment a channel opens.</Text>
        ) : null}
        <Text dimColor>{`Favourites (${chans.length}${lock.size ? `, ${lock.size} locked out` : ''}) — ▶ listens, ★ priority, ⛔ lock out / ✓ unlock; /sdr scan add <MHz> [mode] [name] adds one:`}</Text>
        {chans.slice(0, ctx.narrow ? 10 : 24).map(c => {
          const f = Number(c.freq.toFixed(4))
          const locked = lock.has(f)
          const isPri = pri !== null && Math.abs(pri - f) < 0.0005
          const here = on && curF !== null && Math.abs(curF - f) < 0.0005
          const play = <Button key={`sc-play:${f}`} label={look(K.listen(f, c.mode), '▶', 'Tuning…', '⋯').label} onPress={() => void ctx.listen(f, c.mode)} />
          const freq = (
            <Box key={`sc-f:${f}`} width={9} paddingLeft={1}>
              <Text bold color={here ? 'green' : undefined} dimColor={locked}>{mhz(f)}</Text>
            </Box>
          )
          const name = (
            <Box key={`sc-n:${f}`} width={ctx.narrow ? 28 : 24}>
              <Text dimColor={locked} wrap="truncate-end">{`${c.name}${isPri ? ' ★' : ''}`}</Text>
            </Box>
          )
          const mode = (
            <Box key={`sc-m:${f}`} width={ctx.narrow ? 14 : 10} paddingLeft={ctx.narrow ? 1 : 0}>
              <Text dimColor>{`${modeChip(c.mode as Mode)} sql ${c.squelch || 'off'}`}</Text>
            </Box>
          )
          const priBtn = <Button key={`sc-pri:${f}`} plain label={look(isPri ? K.scanPriOff : K.scanPri(f), isPri ? '★' : '☆', '…', '⋯').label} onPress={() => void scannerCtl(ctx, isPri ? 'Clearing the priority channel' : `Priority ${mhz(f)} MHz`, isPri ? K.scanPriOff : K.scanPri(f), isPri ? ['priority', 'off'] : ['priority', mhz(f)])} />
          const lockBtn = <Button key={`sc-lock:${f}`} plain label={look(locked ? K.scanUnlock(f) : K.scanLock(f), locked ? '✓' : '⛔', '…', '⋯').label} onPress={() => void scannerCtl(ctx, locked ? `Unlocking ${mhz(f)} MHz` : `Locking out ${mhz(f)} MHz`, locked ? K.scanUnlock(f) : K.scanLock(f), [locked ? 'unlock' : 'lockout', mhz(f)])} />
          // The phone stacks each channel: the frequency and name, then the mode and the two small buttons.
          if (ctx.narrow)
            return (
              <Box key={`sc:${f}`} flexDirection="column" backgroundColor={here ? '#0f2b1d' : undefined}>
                <Box flexWrap="wrap">
                  {play}
                  {freq}
                  {name}
                </Box>
                <Box flexWrap="wrap">
                  {mode}
                  {priBtn}
                  <Box key={`sc-gap:${f}`} width={1} />
                  {lockBtn}
                </Box>
              </Box>
            )
          return (
            <Box key={`sc:${f}`} flexWrap="wrap" backgroundColor={here ? '#0f2b1d' : undefined}>
              {play}
              {freq}
              {name}
              {mode}
              {priBtn}
              {lockBtn}
            </Box>
          )
        })}
        {chans.length > (ctx.narrow ? 10 : 24) ? <Text dimColor>{`…and ${chans.length - (ctx.narrow ? 10 : 24)} more (/sdr scan list).`}</Text> : null}
      </Box>
    )
  },
  text: ctx => {
    const v = scanner
    if (!v) return null
    const sl = scanStateLine(v, ctx.now)
    return `Scanner: ${sl.text} · ${v.channels.length} favourites · /sdr scan on|off|list`
  },
  command: async (ctx, _verb, arg) => scannerCommand(ctx, arg),
  poll: async ctx => {
    const on = jobOn(ctx, 'scanner')
    if ((ctx.watched && (scannerStale || ctx.now - scannerAt >= (on ? 1500 : 30_000))) || (scannerStale && !scanner)) await fetchScanner(ctx)
  },
}

// /sdr scan on|off|list|add <MHz> [mode] [name]|remove|skip|hold|resume|lockout [MHz]|unlock|priority <MHz|off>
async function scannerCommand(ctx: SectionContext, arg: string): Promise<string> {
  const words = arg.trim().split(/\s+/).filter(Boolean)
  const sub = (words[0] ?? 'list').toLowerCase()
  if (/^(on|start)$/.test(sub)) return toggleScanner(ctx, true)
  if (/^(off|stop)$/.test(sub)) return toggleScanner(ctx, false)
  if (sub === 'hold') return scannerCtl(ctx, 'Holding the scanner', K.scanHold, ['hold'])
  if (/^(resume|go)$/.test(sub)) return scannerCtl(ctx, 'Resuming the scan', K.scanResume, ['resume'])
  if (sub === 'skip') return scannerCtl(ctx, 'Skipping to the next channel', K.scanSkip, ['skip'])
  if (/^(lockout|lock|unlock|priority|add|remove|rm|clear)$/.test(sub)) {
    const r = await ctx.radio(['scan', ...words], 20_000)
    scannerStale = true
    await fetchScanner(ctx)
    return r?.say ?? 'It did not answer.'
  }
  await fetchScanner(ctx)
  const v = scanner
  if (!v) return 'Could not read the scanner.'
  const lines = [`Scanner ${scanStateLine(v, ctx.now).text}.`]
  if (v.hits.length) {
    lines.push(`Hits:`)
    for (const h of [...v.hits].reverse().slice(0, 10)) lines.push(`  ${hitLine(h)}`)
  }
  lines.push(`Favourites (${v.channels.length}${v.lockout.length ? `, ${v.lockout.length} locked out` : ''}):`)
  const lock = new Set(v.lockout.map(f => Number(f.toFixed(4))))
  for (const c of v.channels) lines.push(`  ${mhz(c.freq)}  ${c.name}  ${modeChip(c.mode as Mode)} sql ${c.squelch || 'off'}${lock.has(Number(c.freq.toFixed(4))) ? '  (locked out)' : ''}${v.priority !== null && Math.abs(v.priority - c.freq) < 0.0005 ? '  ★ priority' : ''}`)
  lines.push('/sdr scan on|off · scan add <MHz> [mode] [name] · scan remove <MHz> · scan skip|hold|resume · scan lockout [MHz] · scan unlock <MHz> · scan priority <MHz|off>')
  return lines.join('\n')
}

// ---- Radio settings (0.4.0, radio.py settings / set / biast / hf / calibrate): PPM, bias-tee, filter width, HF

async function fetchSettings(ctx: SectionContext): Promise<void> {
  const r = (await ctx.radio(['settings'], 15_000)) as SettingsView
  settingsAt = ctx.now
  settingsStale = false
  const same = sameRead(settingsView, r)
  if (r?.ok) settingsView = r
  if (!same) ctx.redraw()
}

// A setting change is a press too (shown at once; never touches the V4). takesV4: it does (calibrate, HF test).
async function settingPress(ctx: SectionContext, label: string, key: string, args: string[], plan: () => Plan, after?: (r: any) => void): Promise<string> {
  let text = ''
  const end = await ctx.act(
    label,
    async () => {
      const r = await ctx.radio(args, 60_000)
      text = r?.say ?? 'It did not answer.'
      if (!r?.ok) failed(text)
      else after?.(r)
      settingsStale = true
      ctx.setNote(text)
      if (/^(calibrate|hf)$/.test(args[0] ?? '')) await ctx.refresh()
    },
    { key, plan },
  )
  if (settingsStale) await fetchSettings(ctx)
  return text || endText(end, label)
}

const settingsSection: Section = {
  id: 'settings',
  title: 'Radio settings',
  color: SKY,
  order: 60,
  verbs: ['settings', 'set', 'ppm', 'biast', 'bias', 'hf', 'calibrate'],
  render: ctx => {
    const { Box, Text, Link } = ctx.els
    const v = settingsView
    const ppm = v?.ppm ?? ctx.status?.settings?.ppm ?? 0
    const biast = v?.biast ?? ctx.status?.settings?.biast ?? false
    const hf = v?.hf ?? null
    const hfOk = hf?.confirmed ?? !!ctx.status?.hf?.confirmed
    const fmode = tuner.mode === 'wbfm' ? 'fm' : tuner.mode
    const fhz = v?.filters?.[fmode] ?? null
    const busyV4 = !!ctx.status?.holder
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">{ctx.narrow ? 'The V4’s own knobs: PPM, bias-tee, filter width, HF.' : 'The V4’s own knobs. PPM corrects the crystal (it applies to listening, scanning, the live view and snapshots); the filter width is rtl_fm’s -s per mode; the bias-tee powers an amplifier or active antenna; HF is the built-in upconverter below 28.8 MHz.'}</Text>
        {ctrlRow(ctx.els, 'set-ppm', 'PPM', [
          ctrl(ctx.els, 'ppm-down', look(K.ppm(ppm - 1), '−', '…', '⋯'), () => void settingPress(ctx, `PPM ${ppm - 1}`, K.ppm(ppm - 1), ['set', 'ppm', String(ppm - 1)], () => ({ step: 'saving the correction', ms: 500 }))),
          <Box key="ppm-val" width={6}>
            <Text bold>{String(ppm)}</Text>
          </Box>,
          ctrl(ctx.els, 'ppm-up', look(K.ppm(ppm + 1), '+', '…', '⋯'), () => void settingPress(ctx, `PPM ${ppm + 1}`, K.ppm(ppm + 1), ['set', 'ppm', String(ppm + 1)], () => ({ step: 'saving the correction', ms: 500 }))),
          ...(ctx.narrow ? [] : [ctrl(ctx.els, 'ppm-cal', look(K.calibrate, `Calibrate from NOAA ${wxFreqText()}`, 'Calibrating…', 'Queued…'), () => void settingPress(ctx, 'Calibrating PPM from NOAA', K.calibrate, ['calibrate', String(LOC.wxFreq)], () => takeover('calibrate', `a 6 s rtl_power look at ${LOC.wxStation || 'the weather radio'}’s carrier`, 8000)))]),
          <Text key="ppm-hint" dimColor wrap="wrap">{ctx.narrow ? '' : `  a 50 kHz window around ${LOC.wxStation || 'the weather radio'}; the carrier’s offset becomes the PPM`}</Text>,
        ])}
        {ctx.narrow
          ? ctrlRow(ctx.els, 'set-ppm-cal', '', [ctrl(ctx.els, 'ppm-cal', look(K.calibrate, 'Calibrate (NOAA)', 'Calibrating…', 'Queued…'), () => void settingPress(ctx, 'Calibrating PPM from NOAA', K.calibrate, ['calibrate', String(LOC.wxFreq)], () => takeover('calibrate', `a 6 s rtl_power look at ${LOC.wxStation || 'the weather radio'}’s carrier`, 8000)))])
          : null}
        {ctrlRow(ctx.els, 'set-filter', 'Filter', [
          <Box key="flt-mode" width={5}>
            <Text>{modeChip(fmode as Mode)}</Text>
          </Box>,
          ctrl(ctx.els, 'flt-down', look(K.filter(fmode, (fhz ?? 12000) - 2000), '−', '…', '⋯'), () => void settingPress(ctx, `${modeChip(fmode as Mode)} filter narrower`, K.filter(fmode, (fhz ?? 12000) - 2000), ['set', 'filter', fmode, String((fhz ?? 12000) - 2000)], () => ({ step: 'saving the width', ms: 500 }))),
          <Box key="flt-val" width={10}>
            <Text bold>{fhz ? `${fhz} Hz` : '…'}</Text>
          </Box>,
          ctrl(ctx.els, 'flt-up', look(K.filter(fmode, (fhz ?? 12000) + 2000), '+', '…', '⋯'), () => void settingPress(ctx, `${modeChip(fmode as Mode)} filter wider`, K.filter(fmode, (fhz ?? 12000) + 2000), ['set', 'filter', fmode, String((fhz ?? 12000) + 2000)], () => ({ step: 'saving the width', ms: 500 }))),
          <Text key="flt-hint" dimColor wrap="wrap">{ctx.narrow ? '' : `  rtl_fm -s for ${modeName(fmode)}; wide FM is fixed at 200 k / 48 k. Takes effect on the next Listen.`}</Text>,
        ])}
        {ctrlRow(ctx.els, 'set-biast', 'Bias-tee', [
          ctrl(ctx.els, 'biast-toggle', look(K.biast(!biast), biast ? '■ Bias-tee off' : 'Bias-tee on', '…', 'Queued…'), () => void settingPress(ctx, biast ? 'Turning the bias-tee off' : 'Turning the bias-tee on', K.biast(!biast), ['biast', biast ? 'off' : 'on'], () => ({ step: 'rtl_biast opens the dongle for a moment', ms: 1500 })), !biast && false),
          <Text key="biast-state" color={biast ? 'yellow' : undefined} dimColor={!biast} wrap="wrap">{biast ? '4.5 V is on the antenna port' : 'off'}</Text>,
        ])}
        <Text color="yellow" wrap="wrap">{`Only for an amplifier or an active antenna that needs power: never with a plain antenna. ${busyV4 ? 'It sets a latch by opening the dongle, so Stop all first.' : ''}`}</Text>
        {ctrlRow(ctx.els, 'set-hf', 'HF', [
          <Text key="hf-state" color={hfOk ? 'green' : 'yellow'} wrap="wrap">{hfOk ? `confirmed on air${hf?.evidence ? ` (${hf.evidence})` : ''}` : 'driver supports it · not yet confirmed on air'}</Text>,
          ctrl(ctx.els, 'hf-test', look(K.hfTest, ctx.narrow ? 'Test HF' : 'Test HF: WWV 10 MHz', 'Listening…', 'Queued…'), () => void settingPress(ctx, 'Testing HF on WWV 10 MHz', K.hfTest, ['hf', 'test', '10'], () => takeover('hf test', 'a muted 4 s listen on 10.000 MHz AM', 6000))),
          ...(hfOk ? [] : [ctrl(ctx.els, 'hf-confirm', look(K.hfConfirm, ctx.narrow ? 'Confirm' : 'Mark confirmed', '…', '⋯'), () => void settingPress(ctx, 'Marking HF as confirmed', K.hfConfirm, ['hf', 'confirm'], () => ({ step: 'saving', ms: 400 })))]),
        ])}
        <Text dimColor wrap="wrap">
          {ctx.narrow
            ? 'Homebrew’s librtlsdr (osmocom 2.0.3) adds 28.8 MHz itself below 28.8 MHz on a Blog V4. HF needs a 10–20 m long wire + 9:1 balun.'
            : `${hf?.driver?.note ?? 'Homebrew’s librtlsdr 2.0.3 (osmocom) detects the Blog V4 and adds 28.8 MHz itself when tuned below 28.8 MHz, so rtl_fm, rtl_power, rtl_sdr and Web SDR’s rtl_tcp all reach HF with no flag or separate driver.'} The HF station tab lights up once a test hears a carrier.`}
        </Text>
        {Link ? <Link key="set-sigid" href={SIGID_WIKI} label="What’s this signal? — the Signal Identification Wiki" /> : null}
      </Box>
    )
  },
  text: ctx => {
    const v = settingsView
    const ppm = v?.ppm ?? ctx.status?.settings?.ppm ?? 0
    const hfOk = v?.hf?.confirmed ?? !!ctx.status?.hf?.confirmed
    return `Settings: PPM ${ppm} · bias-tee ${(v?.biast ?? ctx.status?.settings?.biast) ? 'ON' : 'off'} · HF ${hfOk ? 'confirmed' : 'driver OK, not confirmed on air (needs a long wire + 9:1 balun)'} · /sdr settings`
  },
  command: async (ctx, verb, arg) => {
    const words = arg.trim().split(/\s+/).filter(Boolean)
    const a = words[0]?.toLowerCase() ?? ''
    if (verb === 'set' || verb === 'ppm') {
      const w = verb === 'ppm' ? ['ppm', ...words] : words
      if (w[0] === 'ppm' && w[1] !== undefined) return settingPress(ctx, `PPM ${w[1]}`, K.ppm(Number(w[1])), ['set', 'ppm', w[1]], () => ({ step: 'saving', ms: 400 }))
      if (w[0] === 'filter' && w[2] !== undefined) return settingPress(ctx, `${w[1]} filter ${w[2]} Hz`, K.filter(w[1]!, Number(w[2])), ['set', 'filter', w[1]!, w[2]], () => ({ step: 'saving', ms: 400 }))
      return 'Settings: /sdr set ppm <N> · /sdr set filter <fm|am|usb|lsb|cw> <Hz> · /sdr biast on|off · /sdr hf test|confirm|status · /sdr calibrate [MHz]'
    }
    if (verb === 'biast' || verb === 'bias') {
      if (!/^(on|off)$/.test(a)) return 'Bias-tee: /sdr biast on|off. Only for an amplifier or active antenna that needs power.'
      return settingPress(ctx, `Turning the bias-tee ${a}`, K.biast(a === 'on'), ['biast', a], () => ({ step: 'rtl_biast opens the dongle for a moment', ms: 1500 }))
    }
    if (verb === 'hf') {
      if (a === 'test') return settingPress(ctx, `Testing HF on ${words[1] ?? '10'} MHz`, K.hfTest, ['hf', 'test', words[1] ?? '10'], () => takeover('hf test', 'a muted listen on WWV', 6000))
      if (a === 'confirm') return settingPress(ctx, 'Marking HF as confirmed', K.hfConfirm, ['hf', 'confirm'], () => ({ step: 'saving', ms: 400 }))
      if (a === 'reset') return settingPress(ctx, 'Resetting the HF confirmation', 'hf reset', ['hf', 'reset'], () => ({ step: 'saving', ms: 400 }))
      await fetchSettings(ctx)
      const h = settingsView?.hf
      return h ? `HF: ${h.confirmed ? `confirmed on air (${h.evidence ?? ''})` : 'not yet confirmed on air'}. Driver: ${h.driver.lib} — ${h.driver.note} /sdr hf test [MHz] tunes WWV muted for a few seconds; /sdr hf confirm marks it by hand.` : 'Could not read the HF state.'
    }
    if (verb === 'calibrate') return settingPress(ctx, 'Calibrating PPM', K.calibrate, ['calibrate', ...(words[0] ? [words[0]] : [String(LOC.wxFreq)])], () => takeover('calibrate', 'a 6 s rtl_power look at the carrier', 8000))
    await fetchSettings(ctx)
    const v = settingsView
    if (!v) return 'Could not read the settings.'
    return [
      `PPM ${v.ppm} · bias-tee ${v.biast ? 'ON (4.5 V on the antenna port)' : 'off'}`,
      `Filters: ${Object.entries(v.filters).map(([m, hz]) => `${modeChip(m as Mode)} ${hz} Hz`).join(' · ')} (wide FM fixed)`,
      `HF: ${v.hf.confirmed ? 'confirmed on air' : 'driver supports it; not yet confirmed on air — needs a 10–20 m long wire + 9:1 balun'}`,
      `Tools: rtl_sdr ${v.tools.rtl_sdr ? 'yes' : 'missing'} · rtl_biast ${v.tools.rtl_biast ? 'yes' : 'missing'}`,
      '/sdr set ppm <N> · set filter <mode> <Hz> · biast on|off · hf test|confirm · calibrate [MHz]',
    ].join('\n')
  },
  poll: async ctx => {
    if ((ctx.watched && (settingsStale || ctx.now - settingsAt >= 60_000)) || (settingsStale && !settingsView)) await fetchSettings(ctx)
  },
}

// ---- IQ snapshots (0.4.0, radio.py snapshot): raw I/Q with rtl_sdr to ~/Radio/IQ, a waterfall from the file, rtl_433 -r on 433.92

async function fetchSnaps(ctx: SectionContext): Promise<void> {
  const r = (await ctx.radio(['snapshot', 'list'], 20_000)) as SnapView
  snapsAt = ctx.now
  snapsStale = false
  const same = sameRead(snaps, r)
  if (r?.ok && Array.isArray(r.items)) snaps = r
  if (!same) ctx.redraw()
}

async function snapshotBand(ctx: SectionContext, f: number, secs: number): Promise<string> {
  let text = ''
  const label = `Snapshot of ${mhz(f)} MHz (${secs} s)`
  const end = await ctx.act(
    label,
    async () => {
      const r = await ctx.radio(['snapshot', mhz(f), '--seconds', String(secs)], 30_000)
      text = r?.ok ? `${r.say}${ctx.stoppedText(r.stopped)}` : r?.say ?? 'The snapshot did not start.'
      if (r?.ok) ctx.stopped('snapshot', r.stopped)
      if (!r?.ok) failed(text)
      snapsStale = true
      ctx.setNote(text)
      await ctx.refresh()
    },
    { key: K.snapshot(f, secs), plan: () => takeover('snapshot', `rtl_sdr writing ${secs} s of raw I/Q`, 2000, 'snapshot') },
  )
  if (snapsStale) await fetchSnaps(ctx)
  return text || endText(end, label)
}

async function snapAction(ctx: SectionContext, label: string, key: string, args: string[], after: (r: any) => void): Promise<void> {
  await ctx.act(
    label,
    async () => {
      const r = await ctx.radio(['snapshot', ...args], 120_000)
      if (!r?.ok) failed(r?.say ?? 'It did not work.')
      after(r)
      ctx.setNote(r?.say ?? '')
      snapsStale = true
      await fetchSnaps(ctx)
    },
    { key, plan: () => ({ step: label.toLowerCase(), ms: args[0] === 'decode' ? 6000 : args[0] === 'waterfall' ? 2500 : 800 }) },
  )
}

// The replayed waterfall as a picture: the file's rows as a palette PNG, the span on an axis.
function snapWfSvg(w: SnapWf, o: { W: number; compact: boolean }): string {
  const H = o.compact ? 170 : 220
  const L = 46
  const R = 12
  const T = 18
  const B = 26
  const pw = o.W - L - R
  const ph = H - T - B
  const parts: string[] = [`<rect width="${o.W}" height="${H}" fill="${BG}"/>`, `<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="${PLOT}"/>`]
  parts.push(`<image x="${L}" y="${T}" width="${pw}" height="${ph}" preserveAspectRatio="none" style="image-rendering:pixelated" href="data:image/png;base64,${w.png}"/>`)
  parts.push(txt(L, 12, `${mhz(w.mhz)} MHz · ${(w.rate / 1e6).toFixed(3)} MS/s · ${w.rows} rows`, { fill: LABEL, size: 11 }))
  parts.push(txt(L, H - 8, `${mhz(w.start)}`, { fill: AXIS, size: 10 }))
  parts.push(txt(L + pw / 2, H - 8, `${mhz(w.mhz)}`, { fill: AXIS, size: 10, anchor: 'middle' }))
  parts.push(txt(L + pw, H - 8, `${mhz(w.stop)}`, { fill: AXIS, size: 10, anchor: 'end' }))
  parts.push(txt(8, T + 10, 'start', { fill: AXIS, size: 9 }))
  parts.push(txt(8, T + ph, 'end', { fill: AXIS, size: 9 }))
  parts.push(`<line x1="${L + pw / 2}" y1="${T}" x2="${L + pw / 2}" y2="${T + ph}" stroke="${RED}" stroke-opacity="0.6" stroke-dasharray="3 3"/>`)
  return svgDoc(o.W, H, parts.join(''))
}

const snapshotsSection: Section = {
  id: 'snapshots',
  title: 'IQ snapshots',
  color: TEAL,
  order: 7,
  verbs: ['snapshot', 'snapshots', 'iq'],
  render: ctx => {
    const { Box, Text, Button } = ctx.els
    const Svg = svgOf(ctx)
    const v = snaps
    const items = v?.items ?? []
    const tf = tuner.hz / 1e6
    const capturing = jobOn(ctx, 'snapshot')
    const W = ctx.narrow ? 440 : 760
    const shown = items.slice(0, ctx.narrow ? 5 : 10)
    return (
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">
          {ctx.narrow
            ? 'Raw I/Q of the band around the tuner, with rtl_sdr, to ~/Radio/IQ. ▶ draws its waterfall; 433.92 ones decode with rtl_433.'
            : 'Snapshot band: rtl_sdr records 10–60 s of raw I/Q (8-bit, 1.024 MS/s, about 2 MB/s) around the tuner to ~/Radio/IQ/<date>/<MHz>_<rate>.cu8 with a JSON sidecar. ▶ renders a waterfall from the file (an FFT in Python, no numpy); a 433.92 MHz snapshot can be decoded again with rtl_433 -r. It takes the V4 for that long, then stops by itself.'}
        </Text>
        {ctrlRow(ctx.els, 'snap-row', 'Snapshot', [
          ...[10, 30, 60].map(s => ctrl(ctx.els, `snap-${s}`, look(K.snapshot(tf, s), `${s} s`, 'Starting…', 'Queued…'), () => void snapshotBand(ctx, tf, s))),
          <Text key="snap-at" dimColor wrap="wrap">{capturing ? `● capturing ${ctx.status?.jobs?.snapshot?.meta?.mhz ?? ''} MHz…` : `at ${mhz(tf)} MHz (the tuner)`}</Text>,
        ])}
        {!items.length ? <Text dimColor>{v ? 'No snapshots yet.' : 'Reading ~/Radio/IQ…'}</Text> : null}
        {shown.map(it => {
          const f = it.mhz ?? 0
          const sel = snapWf?.file === it.file
          const can433 = f >= 433 && f <= 435
          // The one file rtl_sdr is writing right now (the running job's own): no buttons until it is done.
          const fresh = capturing && String(ctx.status?.jobs?.snapshot?.meta?.file ?? '').endsWith(it.file)
          const play = (
            <Box key={`snap-pl:${it.file}`} width={4}>
              {fresh ? <Text color="red">{'●'}</Text> : <Button key={`snap-wf:${it.file}`} label={look(K.snapWf(it.file), '▶', '…', '⋯').label} variant={sel ? 'primary' : undefined} onPress={() => void snapAction(ctx, 'Rendering the waterfall', K.snapWf(it.file), ['waterfall', it.file, '--cols', ctx.narrow ? '128' : '256'], r => { if (r?.ok) { snapWf = r as SnapWf; snapDecoded = null } })} />}
            </Box>
          )
          const when = (
            <Box key={`snap-t:${it.file}`} width={9}>
              <Text>{it.at ? clockOf(it.at) : clockOf(it.mtime)}</Text>
            </Box>
          )
          const freq = (
            <Box key={`snap-f:${it.file}`} width={9}>
              <Text bold>{mhz(f)}</Text>
            </Box>
          )
          const what = (
            <Box key={`snap-w:${it.file}`} width={ctx.narrow ? 18 : 22}>
              <Text dimColor wrap="truncate-end">{`${it.rate ? `${(it.rate / 1e6).toFixed(3)} MS/s` : ''}${it.seconds ? ` · ${it.seconds} s` : ''}${it.label && !ctx.narrow ? ` · ${it.label}` : ''}`}</Text>
            </Box>
          )
          const size = (
            <Box key={`snap-s:${it.file}`} width={9}>
              <Text dimColor>{sizeOf(it.size)}</Text>
            </Box>
          )
          const decode = can433 && !fresh ? <Button key={`snap-dec:${it.file}`} plain label={look(K.snapDecode(it.file), ctx.narrow ? 'decode' : 'decode gadgets', 'decoding…', '⋯').label} onPress={() => void snapAction(ctx, 'Decoding gadgets from the snapshot', K.snapDecode(it.file), ['decode', it.file], r => { snapDecoded = r as SnapDecode })} /> : null
          const trash = !fresh ? <Button key={`snap-del:${it.file}`} plain label={look(K.snapTrash(it.file), '🗑', '…', '⋯').label} onPress={() => void snapAction(ctx, 'Moving a snapshot to the Trash', K.snapTrash(it.file), ['delete', it.file], () => { if (snapWf?.file === it.file) snapWf = null })} /> : null
          // The phone stacks a snapshot: when and where, then what it is and the buttons.
          if (ctx.narrow)
            return (
              <Box key={`snap:${it.file}`} flexDirection="column" backgroundColor={sel ? '#0f2430' : undefined}>
                <Box flexWrap="wrap">
                  {play}
                  {when}
                  {freq}
                </Box>
                <Box flexWrap="wrap" paddingLeft={2}>
                  {what}
                  {size}
                  {decode}
                  {decode ? <Box key={`snap-gap:${it.file}`} width={1} /> : null}
                  {trash}
                </Box>
              </Box>
            )
          return (
            <Box key={`snap:${it.file}`} flexWrap="wrap" backgroundColor={sel ? '#0f2430' : undefined}>
              {play}
              {when}
              {freq}
              {what}
              {size}
              {decode}
              {decode ? <Box key={`snap-gap:${it.file}`} width={1} /> : null}
              {trash}
            </Box>
          )
        })}
        {items.length > shown.length ? <Text dimColor>{`…and ${items.length - shown.length} more (/sdr snapshots).`}</Text> : null}
        {snapWf ? (
          Svg ? (
            <Svg key="snap-wf" source={memoSvg(`snapwf|${W}`, `${snapWf.file}|${snapWf.rows}|${W}`, () => snapWfSvg(snapWf!, { W, compact: ctx.narrow }))} alt={`Waterfall of the ${mhz(snapWf.mhz)} MHz snapshot: ${snapWf.rows} rows over ${mhz(snapWf.start)}–${mhz(snapWf.stop)} MHz, time top to bottom`} />
          ) : (
            <Text dimColor>{`Waterfall of ${snapWf.file}: ${snapWf.rows} rows over ${mhz(snapWf.start)}–${mhz(snapWf.stop)} MHz (drawn on the desktop and phone).`}</Text>
          )
        ) : null}
        {snapDecoded ? <Text color={snapDecoded.ok && snapDecoded.events ? 'green' : 'yellow'} wrap="wrap">{`${snapDecoded.say}${snapDecoded.devices?.length ? ` ${snapDecoded.devices.join(', ')}.` : ''}`}</Text> : null}
        {v ? <Text dimColor wrap="wrap">{`On disk: ${sizeOf(v.total)} of ${v.keep.gb} GB in ${v.root} · kept ${v.keep.days} days, then the oldest go to the Trash`}</Text> : null}
      </Box>
    )
  },
  text: () => {
    const v = snaps
    if (!v) return null
    return `IQ snapshots: ${v.items.length ? `${v.items.length}, ${sizeOf(v.total)}` : 'none'} · /sdr snapshot <MHz> [secs]`
  },
  command: async (ctx, _verb, arg) => {
    const m = arg.trim().match(/^(\d+(?:\.\d+)?)\s*(?:mhz)?(?:\s+(\d+))?\s*(?:s|sec)?$/i)
    if (m) return snapshotBand(ctx, Number(m[1]), Number(m[2] ?? 20))
    const words = arg.trim().split(/\s+/).filter(Boolean)
    if (/^(decode|waterfall|delete)$/.test(words[0] ?? '') && words[1]) {
      const r = await ctx.radio(['snapshot', words[0]!, words[1]], 120_000)
      if (words[0] === 'waterfall' && r?.ok) snapWf = r as SnapWf
      if (words[0] === 'decode') snapDecoded = r as SnapDecode
      snapsStale = true
      await fetchSnaps(ctx)
      ctx.redraw()
      return r?.say ?? (r?.ok ? `Done: ${words[1]}.` : 'It did not work.')
    }
    await fetchSnaps(ctx)
    const v = snaps
    if (!v) return 'Could not read ~/Radio/IQ.'
    const lines = [`IQ snapshots: ${v.items.length || 'none'} · ${sizeOf(v.total)} of ${v.keep.gb} GB in ${v.root}`]
    for (const it of v.items.slice(0, 20)) lines.push(`  ${it.at ? clockOf(it.at) : clockOf(it.mtime)}  ${mhz(it.mhz ?? 0)}  ${it.rate ? `${(it.rate / 1e6).toFixed(3)} MS/s` : ''}  ${it.seconds ?? '?'} s  ${sizeOf(it.size)}  ${it.file}`)
    lines.push('/sdr snapshot <MHz> [secs] records one (10–60 s, takes the V4) · snapshot waterfall <file> · snapshot decode <file> (433.92 only) · snapshot delete <file>')
    return lines.join('\n')
  },
  poll: async ctx => {
    const capturing = jobOn(ctx, 'snapshot')
    if ((ctx.watched && (snapsStale || ctx.now - snapsAt >= (capturing ? 3000 : 60_000))) || (snapsStale && !snaps)) await fetchSnaps(ctx)
  },
}

SECTIONS.push(scannerSection, recordingsSection, snapshotsSection, planesSection, aprsSection, alertsSection, webSection, settingsSection)

// ---------------------------------------------------------------- hooks

// ---------------------------------------------------------------- the tools Claude can call (hooks/tools.ts)
// The tab's own state and queue answer them: an action is an intent like a click on a button (one at a
// time, a press first), a read is the same read /sdr does. Nothing here transmits, and what the tab
// keeps for the tab (Web SDR, sharing to a phone, the bias-tee, settings, the HF test, recordings)
// is refused in tools.ts before it gets here.

// Resolves p's value, or null after ms: a tool call always answers within its budget.
function within<T>($: any, p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    let done = false
    let t: { cancel?: () => void } | null = null
    const finish = (v: T | null) => {
      if (done) return
      done = true
      try {
        t?.cancel?.()
      } catch {}
      resolve(v)
    }
    try {
      t = $.clock.after(ms, () => finish(null))
    } catch {}
    p.then(finish, () => finish(null))
  })
}

// A tool's wait for the queue; past it the press goes on and the answer says what is under way.
const TOOL_READ_MS = 45_000
const TOOL_ACT_MS = 100_000

async function toolWait($: any, p: Promise<string>, ms: number, what: string): Promise<string> {
  const t = await within($, p, ms)
  if (t !== null) return t
  const doing = doingLine()
  return `${what} is still going${doing ? ` (${doing})` : ''}. It carries on in the tab; call sdr_status in a moment to see the result.`
}

function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'N'
}

async function toolStatus($: any): Promise<string> {
  await loadStore($)
  if (!scan) await loadLast($)
  const now = (await $.clock.now()) as number
  await refreshStatus($)
  await refreshGadgets($)
  await pollSections($, now, 'action')
  // The tab's own summary without its list of slash commands (those are for the person typing).
  const lines = report(now).split('\n').filter(l => l !== COMMANDS_LINE)
  return [
    `Place: ${LOC.name}${LOC.error ? ` (${LOC.error})` : ''}`,
    ...lines,
    '',
    'Bands for sdr_scan, and what the last scan of each heard:',
    bandsText(now),
  ].join('\n')
}

type PlaneRow = { icao: string; callsign?: string | null; reg?: string | null; alt?: number | null; altGnss?: number | null; onGround?: boolean | null; distNm?: number | null; bearing?: number | null; gs?: number | null; lastSeen?: number; squawk?: string | null; emergency?: string | null }

async function toolPlanes($: any, limit: number): Promise<string> {
  await loadStore($)
  const now = (await $.clock.now()) as number
  const r = await pyScript($, 'adsb.py', ['state'], 20_000, 'action')
  if (!r || !Array.isArray(r.aircraft)) return `Could not read the Planes data${r?.say ? `: ${r.say}` : ''}.`
  const on = !!r.job?.running
  const acs = r.aircraft as PlaneRow[]
  const heardAt = typeof r.updated === 'number' ? r.updated : 0
  const age = heardAt ? ago(heardAt, now) : null
  if (!acs.length) {
    return on
      ? `Planes is on and has not heard an aircraft yet${age ? ` (updated ${age})` : ''}. The first ones show up within a few seconds; a dipole upright by a window with a clear sky helps most.`
      : `No aircraft saved. Planes is off, and it does not start from here: turn it on with sdr_job (job planes, state on), or in the tab.`
  }
  const withPos = acs.filter(a => typeof a.distNm === 'number')
  const rows = acs.slice(0, limit).map(a => {
    const id = a.callsign || a.reg || null
    const alt = a.onGround ? 'on the ground' : typeof (a.alt ?? a.altGnss) === 'number' ? `${Math.round((a.alt ?? a.altGnss) as number).toLocaleString('en-US')} ft` : 'altitude unknown'
    const where = typeof a.distNm === 'number' && typeof a.bearing === 'number' ? `${a.distNm.toFixed(1)} nm ${compass(a.bearing)} (${Math.round(a.bearing)}°)` : 'no position yet'
    const em = a.emergency && a.emergency !== 'none' ? ` · EMERGENCY ${a.emergency}${a.squawk ? ` (squawk ${a.squawk})` : ''}` : ''
    const seen = typeof a.lastSeen === 'number' ? ago(a.lastSeen, now) : '?'
    return {
      text: `  ${id ?? `hex ${a.icao}`} · ${alt} · ${typeof a.gs === 'number' ? `${Math.round(a.gs)} kt` : 'speed unknown'} · ${where} · heard ${seen}${em}`,
      data: { flight: id, hex: a.icao, altitudeFt: a.onGround ? null : a.alt ?? a.altGnss ?? null, onGround: !!a.onGround, speedKt: typeof a.gs === 'number' ? Math.round(a.gs) : null, distanceNm: typeof a.distNm === 'number' ? Number(a.distNm.toFixed(1)) : null, bearingDeg: typeof a.bearing === 'number' ? Math.round(a.bearing) : null, heardSecondsAgo: typeof a.lastSeen === 'number' ? Math.max(0, Math.round((now - a.lastSeen) / 1000)) : null, emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null },
    }
  })
  const stale = !on && heardAt && now - heardAt > 120_000
  const head = `${acs.length} aircraft (${withPos.length} with a position), distance and bearing from the station in ${LOC.name}. Planes is ${on ? 'on' : 'off'}${age ? `, data updated ${age}` : ''}${stale ? ': these are from the last run, not live' : ''}.`
  const more = acs.length > rows.length ? `\n  … and ${acs.length - rows.length} more (sdr_planes with a bigger limit)` : ''
  return `${head}\n${rows.map(x => x.text).join('\n')}${more}\n\nNumbers:\n${JSON.stringify({ planesOn: on, aircraft: rows.map(x => x.data) })}`
}

// A gadget's reading with the sensor's own ID taken out of it, whatever the decoder printed.
function scrubId(text: string, d: Device): string {
  let out = text
  for (const v of [d.id, d.key.split('|')[1]]) {
    const id = v === null || v === undefined ? '' : String(v)
    if (id.length >= 3) out = out.split(id).join('…')
  }
  return out
}

async function toolGadgets($: any): Promise<string> {
  await loadStore($)
  await refreshGadgets($)
  const now = (await $.clock.now()) as number
  const g = gadgets
  if (!g) return 'No gadget list yet.'
  const on = !!(st?.gadgets.running ?? g.running)
  const head = `Gadget listener ${on ? `on (${bandName(g.band)})` : 'off (sdr_job gadgets on starts it)'} · ${g.total} device${g.total === 1 ? '' : 's'} heard so far. Sensor IDs are left out on purpose.`
  const h = g.hood
  const hood = h ? `Neighbourhood: ${h.day} heard today, ${h.hour} in the last hour${h.lowBattery.length ? ` · low battery: ${h.lowBattery.join(', ')}` : ''}` : ''
  if (!g.devices.length) return `${head}\nNothing heard yet. Sensors report every 15 s to a few minutes; tire sensors only while a car goes by.`
  const rows = g.devices.slice(0, 15)
  const lines = rows.map(d => {
    const reading = scrubId(d.say || '', d)
    return `  ${d.model}${d.channel !== null && d.channel !== undefined && d.channel !== '' ? ` ch ${d.channel}` : ''} · ${d.kind}${reading ? ` · ${reading}` : ''} · heard ${ago(d.last, now)} · ${d.count}×${d.lowBattery ? ' · LOW BATTERY' : ''}`
  })
  const data = rows.map(d => ({ model: d.model, channel: d.channel ?? null, kind: d.kind, reading: scrubId(d.say || '', d) || null, tempF: d.tempF ?? null, humidity: d.humidity ?? null, heardSecondsAgo: Math.max(0, Math.round((now - d.last) / 1000)), timesHeard: d.count, lowBattery: !!d.lowBattery }))
  return [head, ...(hood ? [hood] : []), ...lines, '', 'Numbers:', JSON.stringify({ listenerOn: on, devices: data })].join('\n')
}

async function toolScan($: any, band: string): Promise<string> {
  await loadStore($)
  if (!bandOf(band)) return `Bands: ${BANDS.map(b => b.id).join(', ')}.`
  const label = bandOf(band)?.label ?? band
  const text = await toolWait($, runScan($, band), TOOL_ACT_MS, `Scanning ${label}`)
  const shown = scan?.preset === band ? `\n${scanText(scan)}` : ''
  return `${text}${shown}`
}

// A station by name: the tab's own station lists (FM calls, weather radio, repeaters, marine, air, HF, what was heard last).
function findStation(q: string): { hit?: Preset; many?: Preset[] } {
  const all: Preset[] = []
  const seen = new Set<number>()
  const add = (p: Preset) => {
    const k = Math.round(p.mhz * 10000)
    if (seen.has(k)) return
    seen.add(k)
    all.push(p)
  }
  for (const p of [...recentStations, NOAA, ...Object.values(FIXED).flat(), ...fmPresets(), ...airPresets(), ...railPresets()]) add(p)
  for (const [f, n] of Object.entries(FM_NAMES)) add({ mhz: Number(f), label: `${f} ${n}`, mode: 'wbfm' })
  const words = q.toLowerCase().split(/[\s,]+/).filter(Boolean)
  const hay = (p: Preset) => `${p.label} ${nameAt(p.mhz) ?? ''} ${mhz(p.mhz)}`.toLowerCase()
  const hits = all.filter(p => words.length > 0 && words.every(w => hay(p).includes(w)))
  const exact = hits.filter(p => p.label.toLowerCase() === q.toLowerCase() || mhz(p.mhz) === q.trim())
  if (exact.length === 1) return { hit: exact[0] }
  if (hits.length === 1) return { hit: hits[0] }
  return { many: hits.slice(0, 8) }
}

async function toolTune($: any, p: ReturnType<typeof parseTune> & { ok: true }): Promise<string> {
  await loadStore($)
  if (p.kind === 'stop') return toolWait($, stopListening($), TOOL_ACT_MS, 'Stopping the audio')
  let f: number
  let mode: string | null = p.mode
  if (p.kind === 'station') {
    const r = findStation(p.name)
    if (!r.hit) {
      return r.many?.length
        ? `"${p.name}" matches more than one station: ${r.many.map(x => `${x.label} (${mhz(x.mhz)} MHz)`).join('; ')}. Pick one, or pass mhz.`
        : `The tab does not know a station called "${p.name}". Give a frequency in MHz instead (and a mode), or ask sdr_status for the stations it has heard.`
    }
    f = r.hit.mhz
    mode = mode ?? r.hit.mode
  } else f = p.mhz
  let text = await toolWait($, listen($, f, mode), TOOL_ACT_MS, `Tuning ${mhz(f)} MHz`)
  if (f < HF_MAX && !st?.hf?.confirmed) text += ' (Below 28.8 MHz this is HF through the V4’s upconverter: it needs a 10–20 m long wire and a 9:1 balun, and it is not yet confirmed on air here; expect noise without one.)'
  return text
}

async function toolJob($: any, job: 'planes' | 'aprs' | 'alerts' | 'gadgets', want: boolean): Promise<string> {
  await loadStore($)
  if (job === 'gadgets') return toolWait($, setGadgets($, want, '433'), TOOL_ACT_MS, `The gadget listener ${want ? 'start' : 'stop'}`)
  const kind = job === 'planes' ? 'adsb' : job === 'alerts' ? 'same' : 'aprs'
  const ctx = ctxFor($, (await $.clock.now()) as number)
  return toolWait($, toggleJob(ctx, kind, want), TOOL_ACT_MS, `${kindLabel(kind)} ${want ? 'start' : 'stop'}`)
}

export const register: Register = on => {
  // The six tools (registered at session.start by registerTools): each answers a failure in words.
  // Spelled out one by one: the hook loader wants every on('tool.call', ...) at its own call site.
  on('tool.call', { tool: 'mcp__radio__sdr_status' }, async $ => {
    try {
      return { result: await toolWait($, toolStatus($), TOOL_READ_MS, 'Reading the radio') }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: 'mcp__radio__sdr_planes' }, async ($, e) => {
    try {
      return { result: await toolWait($, toolPlanes($, parsePlanes(e)), TOOL_READ_MS, 'Reading the planes') }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: 'mcp__radio__sdr_gadgets' }, async $ => {
    try {
      return { result: await toolWait($, toolGadgets($), TOOL_READ_MS, 'Reading the gadgets') }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: 'mcp__radio__sdr_scan' }, async ($, e) => {
    const p = parseScan(e)
    if (!p.ok) return { result: p.say }
    try {
      return { result: await toolScan($, p.band) }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: 'mcp__radio__sdr_tune' }, async ($, e) => {
    const p = parseTune(e)
    if (!p.ok) return { result: p.say }
    try {
      return { result: await toolTune($, p) }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: 'mcp__radio__sdr_job' }, async ($, e) => {
    const p = parseJob(e)
    if (!p.ok) return { result: p.say }
    try {
      return { result: await toolJob($, p.job, p.want) }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })

  on('session.start', async ($, e, next) => {
    // Paths first: everything below reads or writes under the home folder.
    setHome((await $.env.get('HOME')) || '')
    // The six tools Claude can call (hooks/tools.ts); a failure here never stops the tab.
    try {
      await registerTools($)
    } catch {}
    // Claude Code has its own built-in /radio, so the tab's command is /sdr. A refused name says so instead of
    // stopping the whole mod: everything below still starts.
    try {
      await $.command.register({
        name: 'sdr',
        description: 'Open the Radio tab: an RTL-SDR receiver with a live waterfall and station list, a tuner (WFM/NFM/AM/USB/LSB/CW) with an EQ display, a Scanner over favourite channels, ● Rec and a transmission logger with a Recordings list, IQ snapshots with a replayed waterfall, a Radio settings panel (PPM, bias-tee, filters, HF), the radio world map, mesh traffic, gadgets, plane radar (ADS-B), APRS, NOAA weather alerts and Web SDR (now with HF profiles), listening on the Mac and sharing to the phone',
        argumentHint: ARG_HINT,
      })
    } catch (err) {
      $.ui.toast(`Radio: Claude Code refused the /sdr command (${err instanceof Error ? err.message : String(err)})`)
    }
    await loadStore($)
    bg(
      (async () => {
        await loadLocation($)
        await loadLast($)
        await refreshStatus($, true)
        await refreshGadgets($, true)
        await pollSections($, (await $.clock.now()) as number)
      })(),
    )
    $.clock.every(TICK_MS, () => bg(tick($)))
    $.clock.every(EQ_TICK_MS, () => bg(eqTick($)))
    return next(e)
  })

  // Free the V4 when Claude Code quits (the listener comes back next session if it was on).
  on('session.end', async ($, e, next) => {
    try {
      logFlush?.cancel()
      await flushLog($)
    } catch {}
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      try {
        await $.process.run(['python3', `${$.plugin.root}/scripts/radio.py`, 'stop'], { env: { PATH, HOME }, timeoutMs: 60_000 })
      } catch {}
      $.ui.status(undefined)
    }
    return next(e)
  })

  // The live view is for watching: closing the tab stops it (the gadget listener then comes back).
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && st?.live?.running) {
      bg(script($, ['live', 'stop']))
      if (st.live) st = { ...st, live: { ...st.live, running: false } }
      lastStatus = 0
    }
    return next(e)
  })

  // The tuning strip's posts: tune (a click, a ← → step, a Shift+← → jump) or listen (Enter).
  // Anything else, or from anywhere else, is refused; an answer hands the strip fresh props.
  on('ui.message', async ($, e, next) => {
    if (e.element !== STRIP_KEY || e.requestId !== PANE) return next(e)
    const msg = parseStripMessage(e.data)
    if (!msg) return {}
    if (msg.type === 'tune') stripTune($, msg.mhz, msg.by)
    else {
      if (Math.abs(msg.mhz - tuner.hz / 1e6) > 0.0004) stripTune($, msg.mhz, 'click')
      if (st?.listen.running) bg(stopListening($))
      else bg(listen($, undefined, undefined, true))
    }
    const v = shownView()
    return v ? { props: stripPropsOf(v, stripCols) } : {}
  })

  on('command.run', { command: 'sdr' }, async ($, e) => {
    const raw = String(e.args ?? '').trim()
    const [verb = '', ...rest] = raw.split(/\s+/)
    const arg = rest.join(' ').trim()
    await loadStore($)
    await $.ui.open({ id: PANE, title: TITLE })
    const now = async () => (await $.clock.now()) as number
    const v = verb.toLowerCase()
    switch (v) {
      case 'scan': {
        const a = arg.toLowerCase()
        // 0.4.0: the Scanner shares the verb: scan list|on|off|add|remove|skip|hold|resume|lockout|unlock|priority
        if (/^(list|status|on|off|start|stop|add|remove|rm|skip|hold|resume|go|lockout|lock|unlock|clear|priority)(\s|$)/.test(a)) {
          return { text: await scannerCommand(ctxFor($, await now()), arg) }
        }
        if (a.startsWith('custom')) {
          const range = parseRange(a)
          if (!range) return { text: 'Custom scan: /sdr scan custom <start MHz> <stop MHz>, e.g. /sdr scan custom 150 174.' }
          const text = await runScan($, 'custom', range)
          return { text: scan?.preset === 'custom' ? `${text}\n${scanText(scan)}` : text }
        }
        const id = ALIAS[a] ?? (a || lastPreset)
        if (!bandOf(id)) return { text: `Bands: ${BANDS.map(b => b.id).join(', ')}, or custom <start> <stop>.` }
        const text = await runScan($, id)
        return { text: scan?.preset === id ? `${text}\n${scanText(scan)}` : text }
      }
      case 'live': {
        const a = arg.toLowerCase()
        if (/^(off|stop)/.test(a)) return { text: await setLive($, false) }
        if (a === 'reset') {
          await liveReset($)
          return { text: 'Max hold cleared.' }
        }
        const word = a.replace(/^(on|start)\s*/, '')
        if (word.startsWith('custom')) {
          const range = parseRange(word)
          if (!range) return { text: 'Live custom range: /sdr live custom <start MHz> <stop MHz> (up to 60 MHz wide).' }
          return { text: await setLive($, true, 'custom', range) }
        }
        const id = word ? ALIAS[word] ?? word : undefined
        if (id && !bandOf(id)) return { text: `Bands: ${BANDS.map(b => b.id).join(', ')}.` }
        return { text: await setLive($, true, id) }
      }
      case 'tune': {
        const p = parseListen(arg)
        if (!p) return { text: `Tuner: ${mhz(tuner.hz / 1e6)} MHz ${modeChip(tuner.mode)}. /sdr tune <MHz> [wbfm|fm|am] sets it; it retunes the audio when playing.` }
        setTuner(p.freq, p.mode)
        $.ui.invalidate('ui.render')
        if (st?.listen.running) {
          // Behind a press under way the retune waits its turn; the reply does not wait with it.
          if (current) {
            const after = current.label
            bg(retune($))
            return { text: `Tuner set to ${mhz(tuner.hz / 1e6)} MHz ${modeChip(tuner.mode)}; the audio retunes once "${after}" is done.` }
          }
          await retune($)
          return { text: `Retuned to ${mhz(tuner.hz / 1e6)} MHz ${modeChip(tuner.mode)}.` }
        }
        await saveStore($)
        $.ui.invalidate('ui.render')
        return { text: `Tuner set to ${mhz(tuner.hz / 1e6)} MHz ${modeChip(tuner.mode)}${nameAt(tuner.hz / 1e6) ? ` (${nameAt(tuner.hz / 1e6)})` : ''}. /sdr listen plays it.` }
      }
      case 'gadgets':
      case 'gadget': {
        const a = arg.toLowerCase()
        if (/^(on|start)/.test(a)) return { text: await setGadgets($, true, /915/.test(a) ? '915' : /hop/.test(a) ? 'hop' : '433') }
        if (/^(off|stop)/.test(a)) return { text: await setGadgets($, false) }
        await refreshGadgets($)
        return { text: gadgetsText(await now()) }
      }
      case 'listen':
      case 'play': {
        if (/^(stop|off)$/i.test(arg)) return { text: await stopListening($) }
        if (!arg) return { text: await listen($) }
        const p = parseListen(arg)
        if (!p) return { text: 'Listen: /sdr listen <MHz> [wbfm|fm|am], e.g. /sdr listen 94.1, /sdr listen 162.55 fm, /sdr listen 121.5 am.' }
        return { text: await listen($, p.freq, p.mode) }
      }
      case 'stop':
        return { text: await stopAll($) }
      case 'radar': {
        await $.ui.open({ id: PLANES_PANE, title: 'Planes' })
        return { text: await planesSection.command!(ctxFor($, await now(), {}, '', 100, PLANES_PANE), 'planes', arg) }
      }
      case 'bands':
      case 'band':
        await refreshStatus($)
        return { text: `What the last scan of each band heard:\n${bandsText(await now())}\nTap a band in the tab (or /sdr scan <band>) to scan it.` }
      case 'mesh':
        await refreshStatus($)
        return { text: st?.mesh ? meshLine(st.mesh) : 'No mesh traffic measured yet: scan lora, or /sdr live mesh.' }
      case 'share': {
        const a = arg.toLowerCase()
        if (/^(off|stop)/.test(a)) return { text: await setShare($, false) }
        return { text: await setShare($, true, /tailscale/.test(a) ? 'tailscale' : /lan|wifi/.test(a) ? 'lan' : 'all') }
      }
      case 'help':
        return { text: report(await now()) }
      default: {
        const sec = SECTIONS.find(s => s.verbs?.includes(v) && s.command)
        if (sec?.command) return { text: await sec.command(ctxFor($, await now()), v, arg) }
        if (v && (bandOf(ALIAS[v] ?? v) || v === 'custom')) return { text: `Scans are /sdr scan <band>, e.g. /sdr scan ${ALIAS[v] ?? v}.` }
        if (!scan) await loadLast($)
        await refreshStatus($)
        await refreshGadgets($)
        await pollSections($, await now(), 'action')
        return { text: report(await now()) }
      }
    }
  })

  // The radar on its own tab: the Planes section and nothing else, so nothing above it moves.
  on('ui.render', { component: 'Pane', requestId: PLANES_PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as any
    const { Box, Text } = els
    const now = (await $.clock.now()) as number
    lastRender = now
    lastNow = now
    const ctx = ctxFor($, now, els, e.surface as string, Number((e.props as any)?.bodyColumns ?? 100), PLANES_PANE)
    let tree: unknown = null
    try {
      tree = await planesSection.render(ctx)
    } catch (err: any) {
      tree = <Text color="red">{`Planes: ${String(err?.message ?? err)}`}</Text>
    }
    const holder = st?.holder ? `On the V4 now: ${holderText(st.holder)}` : ''
    const doing = doingLine()
    const queued = queuedLine()
    return (
      <Box flexDirection="column">
        {holder ? <Text key="p-holder" dimColor>{holder}</Text> : null}
        {doing ? <Text key="p-doing" color="cyan" wrap="wrap">{doing}</Text> : null}
        {queued ? <Text key="p-queued" dimColor wrap="wrap">{queued}</Text> : null}
        {tree}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as any
    const { Box, Text, Button } = els
    const surface = e.surface as string
    // Every table names every element, an absent one drawing nothing: the terminal draws no Svg
    // (it has a Raster), the phone has no Input.
    const Svg = surface === 'terminal' ? null : steadySvg(els.Svg, surface === 'mobile' ? 440 : 760)
    const Raster = surface === 'terminal' ? els.Raster : null
    const Input = surface === 'mobile' ? null : els.Input
    // The tuning strip takes the pointer where a Client runs (terminal, desktop); the phone and VS Code keep the rows.
    const Client = surface === 'terminal' || surface === 'desktop' ? els.Client : null
    const narrow = surface === 'mobile'
    const columns = Number((e.props as any)?.bodyColumns ?? 100)
    const W = narrow ? 440 : 760
    const now = (await $.clock.now()) as number
    lastRender = now
    lastNow = now
    paneSurface = surface
    const s = st
    const present = !!s?.device.present
    const playing = s?.listen.running ? s.listen : null
    const sharing = s?.share.running ? s.share : null
    const liveOn = !!s?.live?.running
    const gRunning = !!(s?.gadgets.running ?? gadgets?.running)
    const v = shownView()
    const band = v ? bandOf(v.preset) : undefined
    const devices = gadgets?.devices ?? []
    const tf = tuner.hz / 1e6
    const tName = nameAt(tf)
    const tBand = bandAt(tf)?.label ?? null
    const m = playing && meter && Math.abs(meter.freq - (playing.freq ?? 0)) < 0.0005 ? meter : null
    const retuning = current?.key === K.retune || (!!playing && Math.abs((playing.freq ?? 0) - tf) > 0.0004)

    const header = !s
      ? { text: 'checking…', color: undefined as string | undefined }
      : !present
        ? { text: 'not found: plug it into the Mac', color: 'red' }
        : s.state === 'busy'
          ? { text: `busy: ${s.owner?.app ?? 'another program'} has it`, color: 'yellow' }
          : { text: 'connected', color: 'green' }

    const Head = (p: { title: string; hint?: string; color?: string }) => (
      <Box flexWrap="wrap" paddingTop={1}>
        <Text color={p.color ?? CYAN}>{'▍'}</Text>
        <Text bold>{p.title}</Text>
        {p.hint ? <Text dimColor wrap="wrap">{`   ${p.hint}`}</Text> : null}
      </Box>
    )
    // dim: its press is queued behind another (look() above).
    const Chip = (p: { k: string; label: string; on?: boolean; dim?: boolean; press: () => void }) => (
      <Box key={`cb:${p.k}`} paddingRight={1}>
        <Button key={p.k} variant={p.on ? 'primary' : undefined} dimColor={p.dim || undefined} label={p.label} onPress={p.press} />
      </Box>
    )

    // ---- the tuner
    const lcdOpts: LcdOpts = { W, compact: narrow, playing: !!playing, retuning, meter: m, scanLevel: playing ? null : scanLevelAt(tf), name: tName, band: tBand, since: playing?.since ?? null, now: 0, rec: !!m?.rec, log: !!recs?.log.on }
    const lcd = Svg ? (
      <Svg key="lcd" source={memoSvg(`lcd|${W}`, JSON.stringify([tuner, lcdOpts]), () => lcdSvg(tuner, lcdOpts))} alt={lcdAlt(tuner, !!playing, tName, m)} />
    ) : (
      <Box flexDirection="column">
        <Box flexWrap="wrap">
          <Text bold color={LCD} backgroundColor="#0b1418">{`  ${mhz(tf).padStart(9)} MHz  `}</Text>
          <Text>{'  '}</Text>
          <Text color={LCD}>{`${modeChip(tuner.mode)} · step ${STEPS.find(x => x[0] === tuner.step)?.[1] ?? tuner.step} · SQL ${tuner.squelch || 'off'} · ${tuner.gain === 'auto' ? 'AGC' : `RF ${tuner.gain} dB`}`}</Text>
        </Box>
        <Text dimColor>{`${tName ?? tBand ?? ''}${playing ? ' · ▶ playing' : ''}`}</Text>
        {playing ? (
          <Box flexWrap="wrap">
            <Text color={m?.weak ? 'yellow' : 'green'}>{`S ${meterBar(m && m.squelch !== 'closed' ? m.level : 0, 16)} `}</Text>
            <Text dimColor>{m ? (m.weak ? 'weak signal — try the antenna by a window' : m.squelch === 'closed' ? 'squelch closed' : `${sUnits(m.level)} · ${m.metric?.toFixed(0) ?? '?'} ${m.unit}`) : 'measuring…'}</Text>
          </Box>
        ) : null}
      </Box>
    )

    // One row per kind of control, each with a fixed-width label so the rows line up; on the
    // phone the station tabs stack (two rows of three) and there is no text field.
    const LabelBox = (p: { text: string }) => (
      <Box width={narrow ? 5 : ROW_LABEL}>
        <Text dimColor>{p.text}</Text>
      </Box>
    )
    // label null: no label column (the phone's station picker takes the full width)
    const CtrlRow = (p: { k: string; label: string | null; children?: unknown }) => (
      <Box key={p.k} flexWrap="wrap">
        {p.label === null ? null : <LabelBox text={p.label} />}
        {p.children}
      </Box>
    )
    const presets = presetsFor(stationTab)
    const shownPresets = stationTab === 'fm' && !fmMore ? presets.slice(0, FM_SHOWN) : presets.slice(0, 16)
    const perRow = narrow ? 2 : 4
    const presetRows: Preset[][] = []
    for (let k = 0; k < shownPresets.length; k += perRow) presetRows.push(shownPresets.slice(k, k + perRow))
    const tabRows: [StationTab, string][][] = narrow ? [STATION_TABS.slice(0, 3), STATION_TABS.slice(3)] : [STATION_TABS]
    const tabHint: Record<StationTab, string> = {
      fav: recentStations.length ? 'what you listened to last, newest first' : 'what you listen to shows up here',
      fm: fmStations.length ? 'strongest first, from the last FM scan' : 'scan FM broadcast to sort these by strength',
      wx: (() => {
        const r = LOC.repeaters.find(x => x.wx)
        return 'NOAA weather radio' + (r ? ` and the ${repShort(r)} ${repShort(r) === 'SKYWARN' ? 'spotter ' : ''}repeater` : '')
      })(),
      air: v?.preset === 'air' ? 'what the last Aircraft scan heard, then the guard frequency' : 'scan Aircraft to add what is active now',
      ham: '2 m and 70 cm repeaters and calling frequencies',
      water: `${LOC.riverName ? `${LOC.riverName} marine` : 'Marine'} channels; scan Railroad to add rail channels`,
      hf: s?.hf?.confirmed
        ? 'shortwave through the V4’s upconverter: time signals (AM), broadcast bands (AM), ham bands (SSB), weather fax and NAVTEX'
        : 'needs a 10–20 m long wire + 9:1 balun; not yet confirmed on air (Radio settings › Test HF). The driver already supports it.',
    }
    const hfOk = !!s?.hf?.confirmed

    const squelchCtl = [
          <Chip
            k="sq-down"
            label="−"
            press={() => {
              tuner = { ...tuner, squelch: Math.max(0, tuner.squelch - 10) }
              tunerChanged($)
            }}
          />,
          <Box key="sq-val" width={5}>
            <Text>{tuner.squelch ? String(tuner.squelch) : 'off'}</Text>
          </Box>,
          <Chip
            k="sq-up"
            label="+"
            press={() => {
              tuner = { ...tuner, squelch: Math.min(500, tuner.squelch + 10) }
              tunerChanged($)
            }}
          />
    ]
    const gainCtl = [
          <Chip
            k="gain-auto"
            label="auto"
            on={tuner.gain === 'auto'}
            press={() => {
              tuner = { ...tuner, gain: tuner.gain === 'auto' ? 40.2 : 'auto' }
              tunerChanged($)
            }}
          />,
          <Chip
            k="gain-down"
            label="−"
            press={() => {
              tuner = { ...tuner, gain: gainStep(-1) }
              tunerChanged($)
            }}
          />,
          <Box key="gain-val" width={8}>
            <Text>{tuner.gain === 'auto' ? 'AGC' : `${tuner.gain} dB`}</Text>
          </Box>,
          <Chip
            k="gain-up"
            label="+"
            press={() => {
              tuner = { ...tuner, gain: gainStep(1) }
              tunerChanged($)
            }}
          />
    ]
    // ---- the EQ display under the LCD: the sound itself, while it plays
    const eqNow = playing && eq && Math.abs(eq.freq - (playing.freq ?? 0)) < 0.0005 && eq.since >= (playing.since ?? 0) - 3000 ? eq : null
    const eqRas = Raster && eqNow ? eqRaster(eqNow, columns - 2) : null
    const eqView = Svg ? (
      <Svg key="eq" source={memoSvg(`eq|${W}`, `${eqNow?.at ?? ''}|${eqNow?.since ?? ''}|${W}|${narrow}|${!!playing}|${playing?.label ?? ''}|${!!playing && !playing.tap && !m?.tap}`, () => eqSvg(eqNow, { W, compact: narrow, playing: !!playing, label: playing?.label, legacy: !!playing && !playing.tap && !m?.tap }))} alt={eqAlt(eqNow, !!playing, playing?.label)} />
    ) : eqRas && Raster ? (
      <Box flexDirection="column">
        <Raster key="eq" columns={eqRas.columns} rows={eqRas.rows} cells={eqRas.cells} />
        <Text dimColor>{`${hzLabel(eqNow?.edges[0] ?? 60)} Hz${' '.repeat(Math.max(1, eqRas.columns - 16))}${hzLabel(eqNow?.edges[eqNow.edges.length - 1] ?? 12000)} Hz · ${eqNow?.kind === 'silence' ? 'silence' : `sounds like ${eqNow?.kind}`}`}</Text>
      </Box>
    ) : playing && Raster ? (
      <Text dimColor>reading the audio…</Text>
    ) : null
    const recNow = recLine(!!playing, m)
    const recOn = !!(playing && m?.rec)
    const logOn = !!recs?.log.on
    const recCtx = () => ctxFor($, now, els, surface, columns)
    const recLook = look(K.rec(!recOn), recOn ? '■ Rec' : '● Rec', recOn ? 'Saving…' : 'Starting…', 'Queued…')
    const logLook = look(K.log(!logOn), logOn ? '■ Log' : '◎ Log', 'Log…', 'Queued…')
    const tunerSection = (
      <Box flexDirection="column">
        <Head title="Tuner" hint={narrow ? '' : 'pick a station, or step with ▼ ▲'} />
        {lcd}
        {eqView}
        <CtrlRow k="row-tune" label="Tune">
          <Chip k="t-down10" label="◀◀" press={() => stepTuner($, -1, 10)} />
          <Chip k="t-down" label="▼" press={() => stepTuner($, -1)} />
          <Chip k="t-up" label="▲" press={() => stepTuner($, 1)} />
          <Chip k="t-up10" label="▶▶" press={() => stepTuner($, 1, 10)} />
          <Box key="cb:t-gap" width={narrow ? 0 : 2} />
          {playing ? (
            <Box key="cb:t-stop" paddingRight={1}>
              <Button key="stop-top" variant="primary" {...lookProps(look(K.stopListen, '■ Stop', 'Stopping…', 'Queued…'))} onPress={() => void stopListening($)} />
            </Box>
          ) : (
            <Box key="cb:t-listen" paddingRight={1}>
              <Button key="t-listen" variant="primary" {...lookProps(look(K.listen(tf, tuner.mode), '▶ Listen', 'Tuning…', 'Queued…'))} onPress={() => void listen($, undefined, undefined, true)} />
            </Box>
          )}
        </CtrlRow>
        <CtrlRow k="row-rec" label="Record">
          <Chip k="rec-toggle" label={recLook.label} on={recOn || !!recLook.variant} dim={recLook.dimColor} press={() => void setRec(recCtx(), !recOn)} />
          <Chip k="log-toggle" label={logLook.label} on={logOn || !!logLook.variant} dim={logLook.dimColor} press={() => void setLog(recCtx(), !logOn)} />
          {narrow ? null : (
            <Text key="rec-line" color={recNow.color} dimColor={!recNow.color} wrap="wrap">
              {recNow.text}
            </Text>
          )}
        </CtrlRow>
        {narrow ? (
          <Text color={recNow.color} dimColor={!recNow.color} wrap="wrap">
            {recNow.text}
          </Text>
        ) : null}
        {(narrow ? [MODES_ROW.slice(0, 3), MODES_ROW.slice(3)] : [MODES_ROW]).map((mds, r) => (
          <CtrlRow key={`row-mode:${r}`} k={`row-mode:${r}`} label={r === 0 ? 'Mode' : ''}>
            {mds.map(md => (
              <Chip
                key={`mode:${md}`}
                k={`mode:${md}`}
                label={modeChip(md)}
                on={tuner.mode === md}
                press={() => {
                  tuner = { ...tuner, mode: md, step: defaultStep(md), squelch: defaultSquelch(tf, md), gain: md === 'wbfm' ? 'auto' : tuner.gain === 'auto' ? 40.2 : tuner.gain }
                  tunerChanged($)
                }}
              />
            ))}
          </CtrlRow>
        ))}
        {(narrow ? [STEPS.slice(0, 3), STEPS.slice(3)] : [STEPS]).map((steps, r) => (
          <CtrlRow key={`row-step:${r}`} k={`row-step:${r}`} label={r === 0 ? 'Step' : ''}>
            {steps.map(([hz, lab]) => (
              <Chip
                key={`step:${hz}`}
                k={`step:${hz}`}
                label={narrow ? lab.replace(' ', '') : lab}
                on={tuner.step === hz}
                press={() => {
                  tuner = { ...tuner, step: hz }
                  bg(saveStore($))
                  $.ui.invalidate('ui.render')
                }}
              />
            ))}
          </CtrlRow>
        ))}
        {narrow ? (
          <Box key="row-sqg" flexDirection="column">
            <CtrlRow k="row-sq" label="Sql">
              {squelchCtl}
            </CtrlRow>
            <CtrlRow k="row-gain" label="Gain">
              {gainCtl}
            </CtrlRow>
          </Box>
        ) : (
          <CtrlRow k="row-sq" label="Squelch">
            {squelchCtl}
            <Box key="gain-label" width={8}>
              <Text dimColor>{'   Gain'}</Text>
            </Box>
            {gainCtl}
          </CtrlRow>
        )}
        {tabRows.map((tabs, r) => (
          <CtrlRow key={`row-tabs:${r}`} k={`row-tabs:${r}`} label={narrow ? null : r === 0 ? 'Stations' : ''}>
            {tabs.map(([k, lab]) => (
              <Chip
                key={`cat:${k}`}
                k={`cat:${k}`}
                label={lab}
                on={stationTab === k}
                press={() => {
                  stationTab = k
                  fmMore = false
                  bg(saveStore($))
                  $.ui.invalidate('ui.render')
                }}
              />
            ))}
          </CtrlRow>
        ))}
        {presetRows.map((row, r) => (
          <CtrlRow key={`row-st:${r}`} k={`row-st:${r}`} label={narrow ? null : ''}>
            {row.map(pr => {
              const here = !!playing && Math.abs((playing.freq ?? 0) - pr.mhz) < 0.001
              const lk = look(K.listen(pr.mhz, pr.mode), pr.label.length > 16 ? `${pr.label.slice(0, 15)}…` : pr.label, `Tuning ${mhz(pr.mhz)}…`, `Queued: ${mhz(pr.mhz)}`)
              return (
                <Box key={`stb:${pr.mhz}`} width={narrow ? 20 : 18}>
                  <Button key={`st:${stationTab}:${pr.mhz}`} variant={here || lk.variant ? 'primary' : undefined} dimColor={lk.dimColor || (stationTab === 'hf' && !hfOk) || undefined} label={lk.label} onPress={() => void listen($, pr.mhz, pr.mode, true)} />
                </Box>
              )
            })}
          </CtrlRow>
        ))}
        <CtrlRow k="row-st-hint" label={narrow ? null : ''}>
          <Text dimColor wrap="wrap">{tabHint[stationTab]}</Text>
          {stationTab === 'hf' && els.Link ? (
            <Box key="hf-sigid-box" paddingLeft={1}>
              <els.Link key="hf-sigid" href={SIGID_WIKI} label="What’s this signal? (Signal Identification Wiki)" />
            </Box>
          ) : null}
          {stationTab === 'fm' && presets.length > FM_SHOWN ? (
            <Box key="fm-more-box" paddingLeft={1}>
              <Button
                key="fm-more"
                plain
                label={fmMore ? 'fewer' : `more… (${presets.length - FM_SHOWN})`}
                onPress={() => {
                  fmMore = !fmMore
                  $.ui.invalidate('ui.render')
                }}
              />
            </Box>
          ) : null}
        </CtrlRow>
        {Input ? (
          <Box paddingTop={1}>
            <Input
              key="tune"
              label="Tune to a frequency"
              placeholder="e.g. 94.1, 162.55 fm, 121.5 am"
              submitLabel="Listen"
              onSubmit={(val: string) => {
                const p = parseListen(val)
                if (p) void listen($, p.freq, p.mode, true)
                else {
                  note = 'Type a frequency in MHz and optionally a mode: 94.1, 162.55 fm, 121.5 am.'
                  $.ui.invalidate('ui.render')
                }
              }}
            />
          </Box>
        ) : null}
        <Box flexWrap="wrap">
          <Text dimColor>{"Plays on the Mac (AirPods too, when they're connected to it). "}</Text>
          <Button
            key="meter-help"
            plain
            label={meterHelp ? 'how the meter works ▾' : 'how the meter works ▸'}
            onPress={() => {
              meterHelp = !meterHelp
              $.ui.invalidate('ui.render')
            }}
          />
        </Box>
        {meterHelp ? (
          <Text dimColor wrap="wrap">
            rtl_fm reports no signal level, so the S-meter is read from the audio itself: wide FM by its 19 kHz stereo pilot, narrow FM by how quiet the hiss gets (FM quieting), AM by the carrier over the noise. While not playing it shows the last scan's level at the tuner.
          </Text>
        ) : null}
      </Box>
    )

    // ---- the radio world
    const act0 = s?.activity ?? {}
    const worldSection = (
      <Box flexDirection="column">
        <Head
          title="Radio world"
          hint={
            narrow
              ? `tap a band button below to ${liveOn ? 'move the live view there' : 'scan it'}`
              : `the buttons under the map ${liveOn ? 'move the live view to a band' : 'scan a band (about 10 s)'} · hover the map for details`
          }
        />
        {Svg ? (
          <Svg
            isInteractive={surface === 'desktop' ? true : undefined}
            source={memoSvg(`map|${W}`, `${W}|${narrow}|${liveOn}|${v?.preset ?? ''}|${tf}|${Math.floor(now / 60_000)}|${Object.entries(act0).map(([k, a]) => `${k}:${a.at}:${a.n}:${a.best}`).join(',')}`, () => bandMapSvg({ W, compact: narrow, now, activity: act0, current: v?.preset ?? null, tunedMhz: tf, live: liveOn }))}
            alt={`Band map from 24 MHz to 1.7 GHz around ${LOC.name}: ${BANDS.filter(b => b.id !== 'mesh')
              .map(b => `${b.label}${act0[b.id] ? ` (${act0[b.id]!.n} heard)` : ''}`)
              .join(', ')}`}
          />
        ) : null}
        {BAND_GROUPS.flatMap(([label, ids]) => (narrow && ids.length > 2 ? [[label, ids.slice(0, 2)] as const, ['', ids.slice(2)] as const] : [[label, ids] as const])).map(([label, ids], gi) => (
          <Box key={`bg:${gi}`} flexWrap="wrap">
            <Box width={narrow ? 10 : ROW_LABEL}>
              <Text dimColor>{label}</Text>
            </Box>
            {ids.map(id => {
              const b = bandOf(id)!
              const a = act0[b.id]
              const short = BAND_SHORT[b.id] ?? b.label
              const lk = look([K.scan(b.id), K.live(true, b.id)], `${short}${a ? ` · ${a.n}` : ''}`, `${short}…`, `Queued: ${short}`)
              return (
                <Box key={`pb:${b.id}`} paddingRight={1}>
                  <Text key={`dot:${b.id}`} color={CAT_COLOR[b.cat]}>{'● '}</Text>
                  <Button key={`scan:${b.id}`} variant={v?.preset === b.id || lk.variant ? 'primary' : undefined} dimColor={lk.dimColor || undefined} label={lk.label} onPress={() => void bandPress($, b.id)} />
                </Box>
              )
            })}
          </Box>
        ))}
        {Input ? (
          <Box paddingTop={1}>
            <Input
              key="custom"
              label="Custom range"
              placeholder="start stop in MHz, e.g. 150 174"
              submitLabel={liveOn ? 'Live' : 'Scan'}
              onSubmit={(val: string) => {
                const r = parseRange(val)
                if (r) void (liveOn ? setLive($, true, 'custom', r) : runScan($, 'custom', r))
                else {
                  note = 'Type two frequencies in MHz, e.g. 150 174.'
                  $.ui.invalidate('ui.render')
                }
              }}
            />
          </Box>
        ) : null}
      </Box>
    )

    // ---- the peak list: one row per station, ▶ on the left by its frequency and name; the
    // playing row lit with ■ Stop and its S-meter, the tuned one marked, a pressed one "Starting…"
    const allPeaks = v?.peaks ?? []
    const collapsed = !peaksAll && allPeaks.length > PEAKS_SHOWN
    const listed = (collapsed ? [...allPeaks].sort((a, b) => b.above - a.above).slice(0, PEAKS_SHOWN) : [...allPeaks]).sort(
      peakSort === 'strength' ? (a, b) => b.above - a.above : (a, b) => a.mhz - b.mhz,
    )
    const playMhz = playing ? playing.freq ?? null : null
    const nameW = narrow ? 30 : Math.max(16, Math.min(34, columns - 70))
    // Eight blocks, 4 dB each from +6 dB, coloured weak (amber) to strong (green, teal).
    const STRENGTH = ['#f0a050', '#f0b850', '#f0c850', '#ffd84a', '#c8e06a', '#9adc72', '#7ad67a', '#5fd3b8']
    const strength = (p: Peak, k: string) => {
      const filled = Math.max(1, Math.min(8, Math.round((p.above - 6) / 4)))
      return (
        <Box key={`str:${k}`} width={10}>
          {STRENGTH.map((c, i) => (
            <Text key={`sb:${k}:${i}`} color={i < filled ? c : undefined} dimColor={i >= filled}>
              {i < filled ? '▮' : '▯'}
            </Text>
          ))}
        </Box>
      )
    }
    const peakRow = (p: Peak) => {
      const here = playMhz !== null && Math.abs(playMhz - p.mhz) < 0.001
      const tunedHere = !here && Math.abs(tf - p.mhz) < 0.0005
      const pk = p.listen ? K.listen(p.mhz, p.listen) : ''
      const starting = !!pk && current?.key === pk && !here
      const waiting = !!pk && pending?.key === pk && !here
      const nm = peakName(p).replace(new RegExp(`^${mhz(p.mhz).replace('.', '\\.')}\\s*`), '') || peakName(p)
      const quiet = !p.name || !!p.comb || !!p.spur
      const press = () => void (here ? stopListening($) : listen($, p.mhz, p.listen, true))
      const button = p.listen ? (
        <Button key={`ls:${p.mhz}`} variant={here || starting ? 'primary' : undefined} dimColor={waiting || undefined} label={starting ? 'Starting…' : waiting ? 'Queued…' : here ? (current?.key === K.stopListen ? 'Stopping…' : '■ Stop') : '▶'} onPress={press} />
      ) : (
        <Text key={`nl:${p.mhz}`} dimColor>{'  ·  '}</Text>
      )
      const tag = here ? (
        <Text key={`tag:${p.mhz}`} color="green" bold>{`▶ playing${m && m.squelch !== 'closed' ? ` ${sUnits(m.level)}` : ''}`}</Text>
      ) : starting ? (
        <Text key={`tag:${p.mhz}`} color="yellow">{'starting…'}</Text>
      ) : waiting ? (
        <Text key={`tag:${p.mhz}`} dimColor>{'queued, runs next'}</Text>
      ) : tunedHere ? (
        <Text key={`tag:${p.mhz}`} color="cyan" dimColor>{'◂ tuned'}</Text>
      ) : null
      const bgc = here ? '#0f2b1d' : starting ? '#2b2610' : undefined
      if (narrow)
        return (
          <Box key={`pk:${p.mhz}`} flexDirection="column" paddingBottom={1} backgroundColor={bgc}>
            <Box flexWrap="wrap">
              <Text bold color={here ? 'green' : tunedHere ? 'cyan' : undefined}>{mhz(p.mhz)}</Text>
              <Text dimColor={quiet} wrap="truncate-end">{`  ${nm}`}</Text>
            </Box>
            <Box flexWrap="wrap">
              {strength(p, String(p.mhz))}
              <Box width={14}>
                <Text dimColor>{`+${p.above.toFixed(0)} dB ${p.kind === 'burst' ? 'bursts' : 'steady'}`}</Text>
              </Box>
              <Box width={13} paddingRight={1}>
                {button}
              </Box>
              {tag}
            </Box>
          </Box>
        )
      return (
        <Box key={`pk:${p.mhz}`} flexWrap="wrap" backgroundColor={bgc}>
          <Box width={13} paddingRight={1}>
            {button}
          </Box>
          <Box width={9}>
            <Text bold color={here ? 'green' : tunedHere ? 'cyan' : undefined}>{mhz(p.mhz)}</Text>
          </Box>
          <Box width={nameW}>
            <Text dimColor={quiet} bold={here} wrap="truncate-end">{nm}</Text>
          </Box>
          {strength(p, String(p.mhz))}
          <Box width={7}>
            <Text dimColor>{`+${p.above.toFixed(0)} dB`}</Text>
          </Box>
          <Box width={8}>
            <Text dimColor color={p.kind === 'burst' ? 'yellow' : undefined}>{p.kind === 'burst' ? 'bursts' : 'steady'}</Text>
          </Box>
          {tag}
        </Box>
      )
    }
    const peakRows = v ? (
      <Box key="peaks-list" flexDirection="column" paddingTop={1}>
        <Box flexWrap="wrap">
          <Box width={narrow ? 6 : ROW_LABEL}>
            <Text dimColor>Sort</Text>
          </Box>
          <Chip k="peaks-sort:freq" label={narrow ? 'MHz' : 'by frequency'} on={peakSort === 'freq'} press={() => {
            peakSort = 'freq'
            bg(saveStore($))
            $.ui.invalidate('ui.render')
          }} />
          <Chip k="peaks-sort:strength" label={narrow ? 'strength' : 'by strength'} on={peakSort === 'strength'} press={() => {
            peakSort = 'strength'
            bg(saveStore($))
            $.ui.invalidate('ui.render')
          }} />
          {allPeaks.length > PEAKS_SHOWN ? (
            <Box key="peaks-all-box" paddingLeft={1}>
              <Button key="peaks-all" plain label={peaksAll ? `the ${PEAKS_SHOWN} strongest` : `show all ${allPeaks.length}`} onPress={() => {
                peaksAll = !peaksAll
                $.ui.invalidate('ui.render')
              }} />
            </Box>
          ) : null}
        </Box>
        {listed.map(peakRow)}
        {collapsed ? <Text dimColor>{`the ${PEAKS_SHOWN} strongest of ${allPeaks.length}`}</Text> : null}
      </Box>
    ) : null

    // ---- the spectrum
    const restoreLive = restore.find(r => r.kind === 'live')
    const livePreset = v?.preset === 'custom' ? 'custom' : v?.preset ?? lastPreset
    const liveRange: [number, number] | undefined = v?.preset === 'custom' ? [v.start, v.stop] : undefined
    const scanPreset = v?.preset ?? lastPreset
    const liveLook = look(K.live(!liveOn, livePreset, liveRange), liveOn ? '■ Stop live' : '◉ Live', liveOn ? 'Stopping…' : 'Starting…', 'Queued…')
    const ras = Raster && v ? rasterOf(v, columns - 2) : null
    // The tuning strip: cell for cell under the terminal's Raster; across the pane on the desktop,
    // where it cannot line up with the picture's pixels and carries its own MHz axis instead.
    const stripW = ras ? ras.columns : Math.max(20, columns - 2)
    if (Client && v) stripCols = stripW
    const strip =
      Client && v ? <Client key={STRIP_KEY} module="./tuning-strip.tsx" props={stripPropsOf(v, stripW)} width={surface === 'terminal' ? stripW : '100%'} /> : null
    const playHint = Client ? 'click the strip under the waterfall to tune' : narrow ? 'tap a row to play' : '▶ on a row plays it'
    const spectrumSection = (
      <Box flexDirection="column">
        <Head title={v ? `Spectrum · ${v.label}` : 'Spectrum'} hint={`${liveOn ? 'live: a new row about every second, redrawn every 2 s' : v ? `scanned at ${clockOf(v.at)}` : 'pick a band above'}${v ? ` · ${playHint}` : ''}`} color={liveOn ? RED : CYAN} />
        <Box flexWrap="wrap">
          <Box paddingRight={1}>
            <Button key="live" variant={liveOn || liveLook.variant ? 'primary' : undefined} dimColor={liveLook.dimColor || undefined} label={liveLook.label} onPress={() => void setLive($, !liveOn, livePreset, liveRange)} />
          </Box>
          <Box key="b:rescan" paddingRight={1}>
            <Button key="rescan" {...lookProps(look(K.scan(scanPreset, liveRange), 'Scan 10 s', 'Scanning…', 'Queued…'))} onPress={() => void runScan($, scanPreset, liveRange)} />
          </Box>
          {liveOn ? (
            <Box key="b:live-reset" paddingRight={1}>
              <Button key="live-reset" {...lookProps(look(K.liveReset, 'Reset max hold', 'Resetting…', 'Queued…'))} onPress={() => void liveReset($)} />
            </Box>
          ) : null}
        </Box>
        {!liveOn && liveNote ? (
          <Box flexWrap="wrap">
            <Text color="yellow" wrap="wrap">{`${liveNote}  `}</Text>
            {restoreLive ? <Button key="resume-live" {...lookProps(look(K.live(true, restoreLive.preset ?? lastPreset, restoreLive.preset === 'custom' && restoreLive.lo && restoreLive.hi ? [restoreLive.lo, restoreLive.hi] : undefined), `Resume live (${restoreLive.label ?? 'band'})`, 'Starting…', 'Queued…'))} onPress={() => void resume($, restoreLive)} /> : null}
          </Box>
        ) : null}
        {v ? (
          <Box flexDirection="column">
            {Svg ? (
              <Svg key="pan" source={memoSvg(`pan|${W}`, `${v.preset}|${v.at}|${v.start}|${v.stop}|${v.sweeps ?? ''}|${v.nrows ?? ''}|${v.running ?? ''}|${W}|${narrow}|${tf}|${!!playing}`, () => panadapterSvg(v, { W, compact: narrow, tunedMhz: tf, playing: !!playing }))} alt={viewAlt(v)} />
            ) : ras && Raster ? (
              <Box flexDirection="column">
                <Raster key="wf" columns={ras.columns} rows={ras.rows} cells={ras.cells} />
                {strip ?? <Text dimColor>{`${mhz(v.start)} MHz${' '.repeat(Math.max(1, ras.columns - mhz(v.start).length - mhz(v.stop).length - 8))}${mhz(v.stop)} MHz`}</Text>}
              </Box>
            ) : (
              <Box flexDirection="column">
                <Text color="cyan">{specLine(v, 64)}</Text>
                <Text dimColor>{`${mhz(v.start)} MHz${' '.repeat(Math.max(1, 64 - mhz(v.start).length - mhz(v.stop).length - 8))}${mhz(v.stop)} MHz · the charts draw on the desktop and phone`}</Text>
                {strip}
              </Box>
            )}
            {Svg && strip ? strip : null}
            {Raster ? <Text color="cyan">{specLine(v, Math.min(64, columns - 4))}</Text> : null}
            <Box flexWrap="wrap">
              <Text dimColor>{narrow ? 'Spikes are transmitters. Tap a row to play. ' : Client ? 'Spikes are transmitters; the waterfall is time. Click the strip under it to tune; ▶ plays a row. ' : 'Spikes are transmitters; the waterfall below is time. ▶ plays one. '}</Text>
              <Button
                key="spectrum-help"
                plain
                label={spectrumHelp ? 'what am I looking at ▾' : 'what am I looking at ▸'}
                onPress={() => {
                  spectrumHelp = !spectrumHelp
                  $.ui.invalidate('ui.render')
                }}
              />
            </Box>
            {spectrumHelp ? (
              <Text dimColor wrap="wrap">
                {`${v.live ? 'The top panel is the spectrum: how much radio energy there is at each frequency — cyan the average of the last few seconds, amber the loudest moment in the last minute, dashed magenta the loudest since you pressed Reset. ' : 'The top panel is the spectrum: cyan the average over the scan, amber the loudest moment (peak hold). '}Spikes are transmitters; the dashed grey line is the noise floor. Below is the waterfall: time as rows, colour as strength (dark quiet → blue → yellow → red loud), so steady stations draw stripes and short bursts draw dots. The red line is the tuner.${
                  Client
                    ? ' Under the waterfall is the tuning strip, the same band as coloured cells: the top row the loudest moment, the bottom row the average, in the waterfall’s colours, with ▾ under each signal (named where known) and the red ▼ at the tuner. Point at it and the line under it reads the frequency, the mode, the level and the name; click to tune there (it snaps to a signal within a cell or so, else to the band’s channel step), and if it is playing the audio follows. After a click, ← → step the tuner, Shift+← → jump between signals, Enter plays or stops, Esc lets go.'
                    : narrow
                      ? ' On the phone, tap a row below to play that station; on the desktop and in the terminal a strip under the waterfall takes clicks too.'
                      : ' ▶ on a row below plays that station.'
                }`}
              </Text>
            ) : null}
            {spectrumHelp && band ? <Text dimColor wrap="wrap">{band.help}</Text> : null}
            {peakRows}
          </Box>
        ) : (
          <Text dimColor>No scan yet: tap a band above, or ◉ Live.</Text>
        )}
      </Box>
    )

    // ---- mesh traffic
    const mesh = s?.mesh
    const meshSection = mesh ? (
      <Box flexDirection="column">
        <Head title="Mesh traffic" hint={narrow ? '' : 'LoRa bursts at the Meshtastic and MeshCore frequencies, from LoRa scans and the live view'} color={ORANGE} />
        {Svg ? (
          <Svg key="mesh" source={memoSvg(`mesh|${W}`, `${W}|${narrow}|${mesh.lastAt}|${mesh.seconds}|${mesh.mt.bursts}|${mesh.mc.bursts}|${mesh.window.length}|${Math.floor(now / 60_000)}`, () => meshSvg(mesh, { W, compact: narrow, now }))} alt={meshAlt(mesh)} />
        ) : (
          <Box flexDirection="column">
            {(['mt', 'mc'] as const).map(k => {
              const ch = mesh[k]
              const idx = k === 'mt' ? 1 : 2
              const vals = mesh.window.map(b => ((b[idx] ?? 0) / Math.max(1, b[3])) * 60)
              return (
                <Box key={`mesh:${k}`} flexWrap="wrap">
                  <Box width={22}>
                    <Text color={k === 'mt' ? ORANGE : MAGENTA}>{`${ch.name.replace(' LongFast', '')} ${ch.mhz}`}</Text>
                  </Box>
                  <Text>{vals.length ? sparkline(vals, Math.min(40, vals.length * 2), 0) : '·'}</Text>
                  <Text dimColor>{`  ${ch.state === 'unknown' ? 'no data yet' : `${ch.state} · ${ch.bursts} bursts · ${ch.perMin}/min`}`}</Text>
                </Box>
              )
            })}
          </Box>
        )}
        <Box flexWrap="wrap">
          <Text color={mesh.mt.state === 'busy' ? 'red' : mesh.mt.state === 'active' ? 'yellow' : undefined} bold>
            {mesh.mt.state === 'unknown' ? 'Meshtastic: no data yet' : `Meshtastic ${mesh.mt.state === 'busy' ? 'busy' : mesh.mt.state === 'active' ? 'active' : 'quiet'}`}
          </Text>
          <Text dimColor>{'   '}</Text>
          <Box paddingRight={1}>
            <Button key="mesh-live" {...lookProps(look(K.live(true, 'mesh'), liveOn && v?.preset === 'mesh' ? 'Mesh watch is live' : 'Mesh watch (live)', 'Starting…', 'Queued…'))} onPress={() => void setLive($, true, 'mesh')} />
          </Box>
        </Box>
      </Box>
    ) : null

    // ---- gadgets
    const hood = gadgets?.hood
    const gLook = look(K.gadgets(!gRunning), gRunning ? 'Listener off' : 'Listener on', gRunning ? 'Stopping the gadget listener…' : 'Starting the gadget listener…', 'Queued…')
    const gadgetSection = (
      <Box flexDirection="column">
        <Head title="Gadgets nearby" hint={`${gRunning ? `rtl_433 on ${bandName(s?.gadgets.band)}${s?.gadgets.since ? ` since ${clockOf(s.gadgets.since)}` : ''}` : 'listener off'} · ${gadgets?.total ?? 0} heard`} color={AMBER} />
        <Box flexWrap="wrap">
          <Button
            key="gadgets-toggle"
            variant={gRunning && !gLook.variant ? undefined : 'primary'}
            dimColor={gLook.dimColor || undefined}
            label={gLook.label}
            onPress={() => void setGadgets($, !gRunning)}
          />
        </Box>
        {!gRunning && gadgetsWanted && (playing || sharing || liveOn) ? (
          <Text dimColor wrap="wrap">{`Paused while ${playing ? 'the audio plays' : liveOn ? 'the live view runs' : 'the V4 is shared'}; it comes back when that stops.`}</Text>
        ) : null}
        {hood && devices.length ? (
          Svg ? (
            <Svg key="hood" source={memoSvg(`hood|${W}`, `${W}|${narrow}|${JSON.stringify(hood)}|${gadgets?.total ?? 0}|${Math.floor(now / 60_000)}`, () => hoodSvg(hood, { W, compact: narrow, now, total: gadgets?.total ?? 0 }))} alt={`Radio neighbourhood: ${hood.day} devices heard today, ${hood.hour} in the last hour, ${hood.lowBattery.length} with a low battery${hood.newest ? `, newest ${hood.newest.model}` : ''}`} />
          ) : (
            <Text wrap="wrap">{`Neighbourhood: ${hood.day} heard today · ${hood.hour} in the last hour · ${hood.lowBattery.length} low batter${hood.lowBattery.length === 1 ? 'y' : 'ies'}${hood.newest ? ` · newest ${hood.newest.model} (${ago(hood.newest.first, now)})` : ''}`}</Text>
          )
        ) : null}
        {gRunning && !devices.length ? <Text dimColor wrap="wrap">Listening… Sensors report every 15 s to a few minutes; tire sensors only while a car goes by.</Text> : null}
        {devices.slice(0, 14).map(d => {
          const sp = Svg ? memoSvg(`spark|${narrow}|${d.key}`, `${narrow}|${d.last}|${d.count}|${d.hist?.length ?? 0}|${Math.floor(now / 60_000)}`, () => sparkSvg(d, now) ?? '') || null : null
          const temps = (d.hist ?? []).filter(p => p[1] !== null).map(p => p[1] as number)
          return (
            <Box key={`dev:${d.key}`} flexDirection="column" paddingTop={1}>
              <Box flexWrap="wrap">
                <Text bold>{d.model}</Text>
                <Text dimColor>{`${d.channel !== null && d.channel !== '' ? ` ch ${d.channel}` : ''}${d.id !== null && d.id !== '' ? ` · id ${d.id}` : ''} · ${d.kind}`}</Text>
              </Box>
              {d.models && d.models.length > 1 ? <Text dimColor wrap="wrap">{`One transmitter that rtl_433 decodes as ${d.models.length} models; shown once.`}</Text> : null}
              <Box flexWrap="wrap">
                <Box width={14}>
                  <Text color={now - d.last < 120_000 ? 'green' : undefined} dimColor={now - d.last >= 120_000}>
                    {ago(d.last, now)}
                  </Text>
                </Box>
                {d.say ? <Text>{d.say}</Text> : <Text dimColor>no readings</Text>}
                {d.lowBattery ? <Text>{'  '}</Text> : null}
                {d.lowBattery ? (
                  <Text backgroundColor="#c0392b" color="#ffffff" bold>
                    {' low battery '}
                  </Text>
                ) : null}
                <Text dimColor>{`  · heard ${d.count}×${d.rssi !== null ? ` · ${d.rssi.toFixed(0)} dB` : ''}`}</Text>
              </Box>
              {sp && Svg ? <Svg source={sp} alt={`${d.model}: ${temps.length} temperature readings, from ${Math.min(...temps).toFixed(1)} to ${Math.max(...temps).toFixed(1)} °F${d.humidity !== null && d.humidity !== undefined ? `, humidity ${d.humidity}%` : ''}`} /> : null}
              {!Svg && temps.length > 2 ? <Text color="yellow">{`${sparkline(temps, Math.min(32, temps.length))}  ${Math.min(...temps).toFixed(0)}–${Math.max(...temps).toFixed(0)}°F`}</Text> : null}
            </Box>
          )
        })}
        {devices.length > 14 ? <Text dimColor>{`…and ${devices.length - 14} more (/sdr gadgets lists them).`}</Text> : null}
      </Box>
    )

    // ---- sections other modules add
    const extra: unknown[] = []
    for (const sec of sortedSections()) {
      const ctx = ctxFor($, now, els, surface, columns)
      let tree: unknown = null
      try {
        tree = await sec.render(ctx)
      } catch (err: any) {
        tree = <Text color="red">{`${sec.title}: ${String(err?.message ?? err)}`}</Text>
      }
      if (tree)
        extra.push(
          <Box key={`sec:${sec.id}`} flexDirection="column">
            <Head title={sec.title} hint={sec.hint} color={sec.color} />
            {tree}
          </Box>,
        )
    }

    // ---- Start here: seven things to try, each one button (open until "Got it"). Each button
    // shows its own press at once ("Starting Planes…", or "Queued: …" behind another one).
    const fmPick = strongestFm()
    const webOn = !!s?.jobs?.webrx?.running
    const steps: { k: string; label: string; say: string; key: string; press: () => void; extra?: unknown }[] = [
      { k: 'weather', label: 'Hear the weather radio', say: `NOAA ${wxFreqText()} NFM, on the Mac (AirPods work too).`, key: K.listen(LOC.wxFreq, 'fm'), press: () => void listen($, LOC.wxFreq, 'fm', true) },
      { k: 'fm', label: 'Play an FM station', say: fmStations.length ? `The strongest from the last FM scan: ${fmPick.label}.` : `Plays ${fmPick.label} until an FM scan finds the strongest.`, key: K.listen(fmPick.mhz, 'wbfm'), press: () => void listen($, fmPick.mhz, 'wbfm', true) },
      { k: 'live', label: 'Watch the FM band live', say: 'A live waterfall of FM. Tap a peak to tune it.', key: K.live(true, 'fm'), press: () => void setLive($, true, 'fm') },
      { k: 'planes', label: 'See planes overhead', say: 'Turns Planes on: a radar of the planes around you.', key: K.job('adsb', true), press: () => void setJob($, 'adsb', true) },
      {
        k: 'web',
        label: 'Open Web SDR in a browser',
        say: webOn && web?.urls?.local ? 'Running. Open it here:' : 'Turns Web SDR on (about 20 s), then shows the link.',
        key: K.job('webrx', true),
        press: () => void setJob($, 'webrx', true),
        extra: webOn && web?.urls?.local ? <els.Link key="try-web-link" href={localHref(web.urls.local)} label={web.urls.local} /> : null,
      },
      { k: 'gadgets', label: 'Check gadgets nearby', say: 'Weather sensors, doorbells and tire sensors nearby.', key: K.gadgets(true), press: () => void setGadgets($, true) },
      {
        k: 'record',
        label: 'Record what you hear',
        say: playing
          ? `● Rec saves what plays (${playing.label ?? `${playing.freq} MHz`}) to ~/Radio/Recordings; the list is under Recordings.`
          : 'Records 30 s of the weather radio (muted) to ~/Radio/Recordings, then ▶ plays it under Recordings. Log keeps each transmission.',
        key: playing ? K.rec(true) : K.record(LOC.wxFreq),
        press: () => void (playing ? setRec(ctxFor($, now, els, surface, columns), true) : recordFor(ctxFor($, now, els, surface, columns), LOC.wxFreq, 'fm', 30)),
      },
    ]
    const startHere = startHereClosed ? (
      <Box key="start-here" flexWrap="wrap">
        <Button
          key="start-here-open"
          plain
          label="Start here ▸"
          onPress={() => {
            startHereClosed = false
            bg(saveStore($))
            $.ui.invalidate('ui.render')
          }}
        />
      </Box>
    ) : (
      <Box key="start-here" flexDirection="column">
        <Head title="Start here" hint={narrow ? '' : 'seven things to try: each button does it'} color={YELLOW} />
        {steps.map((st0, i) => {
          const lk = look(st0.key, st0.label)
          const btn = <Button key={`try:${st0.k}`} {...lookProps(lk)} onPress={st0.press} />
          return narrow ? (
            <Box key={`try-row:${st0.k}`} flexDirection="column" paddingBottom={1}>
              <Box flexWrap="wrap">
                <Box width={3}>
                  <Text bold>{`${i + 1}.`}</Text>
                </Box>
                {btn}
              </Box>
              <Box flexWrap="wrap" paddingLeft={3}>
                <Text dimColor wrap="wrap">{st0.say}</Text>
                {st0.extra ? <Text>{' '}</Text> : null}
                {st0.extra ?? null}
              </Box>
            </Box>
          ) : (
            <Box key={`try-row:${st0.k}`} flexWrap="wrap">
              <Box width={3}>
                <Text bold>{`${i + 1}.`}</Text>
              </Box>
              <Box width={30}>{btn}</Box>
              <Text dimColor wrap="wrap">{st0.say}</Text>
              {st0.extra ? <Text>{' '}</Text> : null}
              {st0.extra ?? null}
            </Box>
          )
        })}
        <Text dimColor wrap="wrap">The V4 does one thing at a time. Starting something stops the last thing, and the tab says what it stopped. Stop all is at the top.</Text>
        <Box>
          <Button
            key="start-here-close"
            label="Got it"
            onPress={() => {
              startHereClosed = true
              bg(saveStore($))
              $.ui.invalidate('ui.render')
            }}
          />
        </Box>
      </Box>
    )

    // ---- On the V4 now: the holder by name, Stop all, what a press is doing (its step and how
    // long it takes), the press waiting behind it, and Resume for what was stopped
    const hold = s?.holder ?? null
    const onV4 = !s
      ? 'checking…'
      : !present
        ? 'nothing: the V4 is not plugged in'
        : hold
          ? hold.ours
            ? holderText(hold)
            : `${hold.label} (pid ${hold.pid}) ${hold.oneshot ? '— finishes by itself' : '— not ours: close it to use the tab'}`
          : 'nothing — the V4 is free'
    const resumable = restore.filter(r => r.kind !== 'live')
    const doing = doingLine()
    const queued = queuedLine()
    const v4W = narrow ? 9 : 14
    const v4Now = (
      <Box key="v4-now" flexDirection="column" paddingTop={1}>
        <Box key="v4-holder" flexWrap="wrap">
          <Box width={v4W}>
            <Text bold>{narrow ? 'On V4' : 'On the V4 now'}</Text>
          </Box>
          <Text bold color={hold?.ours ? 'green' : hold ? 'yellow' : undefined}>{onV4}</Text>
          {hold?.ours || (s && anyJobRunning(s)) ? (
            <Box key="stop-all-box" paddingLeft={2}>
              <Button key="stop-all" variant="primary" {...lookProps(look(K.stopAll, '■ Stop all', 'Stopping…', 'Queued: Stop all'))} onPress={() => void stopAll($)} />
            </Box>
          ) : null}
        </Box>
        {doing ? (
          <Box key="v4-doing" flexWrap="wrap">
            <Box width={v4W}>
              <Text dimColor>{narrow ? 'Doing' : 'Doing now'}</Text>
            </Box>
            <Text color="cyan" wrap="wrap">{doing}</Text>
          </Box>
        ) : null}
        {queued ? (
          <Box key="v4-queued" flexWrap="wrap">
            <Box width={v4W}>
              <Text dimColor>Next</Text>
            </Box>
            <Text dimColor wrap="wrap">{queued}</Text>
          </Box>
        ) : null}
        {resumable.length ? (
          <Box key="v4-stopped" flexWrap="wrap">
            <Box width={v4W}>
              <Text dimColor>Stopped</Text>
            </Box>
            {resumable.map((r, k) => (
              <Box key={`rs-box:${k}`} paddingRight={1}>
                <Button key={`restore:${r.kind}:${k}`} {...lookProps(look(resumeKey(r), resumeLabel(r)))} onPress={() => void resume($, r)} />
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    )

    const shareLook = look(K.share(!sharing), sharing ? 'Stop sharing' : 'Share to phone', sharing ? 'Stopping…' : 'Starting rtl_tcp…', 'Queued…')
    // Every child keyed: one appearing or going (a note, the owner warning) never shifts the rest.
    return (
      <Box flexDirection="column">
        <Box key="hdr" flexWrap="wrap">
          <Text bold>RTL-SDR Blog V4</Text>
          <Text>{'   '}</Text>
          <Text color={header.color}>{header.text}</Text>
        </Box>
        {startHere}
        {v4Now}
        {s?.state === 'busy' && s.owner && !s.holder?.oneshot ? (
          <Text key="owner-warning" color="yellow" wrap="wrap">
            {`${s.owner.app} (pid ${s.owner.pid}) is using the V4. It can be used by one program at a time: close ${s.owner.app} first, and the tab picks it up within 30 s.`}
          </Text>
        ) : null}
        {note ? <Text key="note" color={/weak signal/.test(note) ? 'yellow' : undefined} dimColor={!/weak signal/.test(note)} wrap="wrap">{note}</Text> : null}
        <Box key="sec-tuner" flexDirection="column">{tunerSection}</Box>
        <Box key="sec-world" flexDirection="column">{worldSection}</Box>
        <Box key="sec-spectrum" flexDirection="column">{spectrumSection}</Box>
        {meshSection ? <Box key="sec-mesh" flexDirection="column">{meshSection}</Box> : null}
        <Box key="sec-gadgets" flexDirection="column">{gadgetSection}</Box>
        <Box key="sec-share" flexDirection="column">
          <Head title="Share to phone" color={GREEN} />
          <Box flexWrap="wrap">
            <Button key="share" variant={sharing || shareLook.variant ? 'primary' : undefined} dimColor={shareLook.dimColor || undefined} label={shareLook.label} onPress={() => void setShare($, !sharing)} />
          </Box>
          {sharing ? (
            <Text wrap="wrap">{`rtl_tcp is serving the V4. In an SDR app on the iPhone (CoronaSDR is free), add an rtl_tcp source at ${shareWhere(sharing)}. Stop sharing when you're done: rtl_tcp has no password.`}</Text>
          ) : (
            <Text dimColor wrap="wrap">Lets an SDR app on the iPhone (e.g. CoronaSDR) use the V4 over the network with rtl_tcp, through Tailscale or on the home Wi-Fi. It has no password, so it only runs while you share.</Text>
          )}
        </Box>
        <Box key="sec-extra" flexDirection="column">{extra}</Box>
        <Box key="footer" flexDirection="column">
          <Text> </Text>
          <Text dimColor wrap="wrap">
            The V4 can be used by one program at a time: the live view, audio, gadgets, sharing, Planes, APRS, the alert watch and Web SDR take turns, and the tab says what stopped what. Close SDR++ first. Receive only: nothing here transmits.
          </Text>
          <Text dimColor wrap="wrap">
            {COMMANDS_LINE}
          </Text>
        </Box>
      </Box>
    )
  })
}

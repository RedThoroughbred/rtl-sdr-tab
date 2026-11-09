// The shapes the Radio tab passes around (types only; nothing here runs).


export type Peak = { mhz: number; db: number; above: number; kind: 'steady' | 'burst'; name: string | null; listen: string | null; spur?: boolean; comb?: boolean }

export type Grid = { cols: number; rows: number; b64: string }

export type Exit = { at: number; reason: string; detail: string } | null

export type Stopped = { kind: string; freq?: number; mode?: string; label?: string; port?: number; addr?: string; band?: string; preset?: string; lo?: number; hi?: number }

// A scan (one-shot) or a live frame: what the spectrum draws.
export type View = {
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

export type Job = { running: boolean; since: number | null; lastExit: Exit; label?: string; meta?: Record<string, any>; doing?: string }

// Who has the V4 (radio.py status.holder): one of our jobs by its label, a one-shot script run, or another program.
export type Holder = { kind: string | null; label: string; detail: string | null; doing?: string | null; since: number | null; pid: number | null; ours: boolean; oneshot?: boolean }

export type Activity = { at: number; n: number; best: number; bursts: number; named: string[]; floor: number; scans: number }

export type MeshChan = { mhz: number; name: string; bursts: number; perMin: number; state: 'busy' | 'active' | 'quiet' | 'unknown' }

export type Mesh = { window: [number, number, number, number][]; seconds: number; lastAt: number | null; mt: MeshChan; mc: MeshChan }

export type Status = {
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

export type HistPoint = [number, number | null, number | null, number | null]

export type Device = {
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

export type Hood = { day: number; hour: number; kinds: Record<string, number>; newest: { model: string; kind: string; first: number } | null; lowBattery: string[]; merged: number }

export type Gadgets = { running: boolean; since: number | null; band: string | null; total: number; devices: Device[]; hood?: Hood; lastExit: Exit; now: number }

export type Station = { mhz: number; name: string; above?: number }

export type Meter = {
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
export type RecLive = { on: boolean; id: string; file: string; since: number; seconds: number; bytes: number; until: number | null }

export type LogLive = { on: boolean; since: number | null; clips: number; dropped: number; open: boolean; gate: string; skipped: string | null }

export type Recording = { file: string; name: string; start: number; freq: number; mode: string; station?: string | null; label?: string | null; duration: number | null; size: number; clip: boolean; recording: boolean; timed?: boolean; ok?: boolean }

export type RecDay = { day: string; label: string; recordings: number; clips: number; seconds: number; bytes: number }

// 0.4.0: the Scanner (radio.py scan list), Radio settings (radio.py settings) and IQ snapshots (radio.py snapshot list).
export type ScanChannel = { freq: number; mode: string; name: string; squelch: number }

export type ScanHit = { freq: number; name: string; mode: string; at: number; secs?: number }

export type ScanState = { running: boolean; since: number; current: ScanChannel | null; parked: boolean; scanning: boolean; hold: boolean; hits: ScanHit[]; empty?: boolean; heard?: number; level?: number; at: number }

export type ScannerView = { running: boolean; state: ScanState | null; channels: ScanChannel[]; active: number; lockout: number[]; priority: number | null; hold: boolean; dwell: number; resume: number; hits: ScanHit[]; now: number }

export type HfState = { confirmed: boolean; at: number | null; evidence: string | null; maxMhz: number; driver: { supported: boolean; lib: string; note: string } }

export type SettingsView = { ok: boolean; ppm: number; filters: Record<string, number>; biast: boolean; tools: Record<string, boolean>; hf: HfState; filterDefaults: Record<string, number>; now: number }

export type Snap = { file: string; mhz: number | null; rate: number | null; seconds: number | null; gain: string | null; at: number | null; size: number; mtime: number; label: string | null }

export type SnapView = { ok: boolean; items: Snap[]; total: number; keep: { gb: number; days: number }; root: string; now: number }

export type SnapWf = { ok: boolean; file: string; mhz: number; rate: number; cols: number; rows: number; start: number; stop: number; scale: [number, number]; png: string; wf: Grid; say?: string }

export type SnapDecode = { ok: boolean; file?: string; events?: number; models?: Record<string, number>; devices?: string[]; say: string }

export type RecView = {
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
export type Eq = { at: number; since: number; freq: number; mode: string; rate: number; edges: number[]; bands: number[]; peaks: number[]; rms: number | null; kind: string; range: [number, number] }

export type Mode = 'wbfm' | 'fm' | 'am' | 'usb' | 'lsb' | 'cw'

export type Tuner = { hz: number; mode: Mode; step: number; squelch: number; gain: 'auto' | number }

// A station preset: the tuner's category tabs and the stations he has listened to.
export type Preset = { mhz: number; label: string; mode: Mode; above?: number; at?: number }

// What the new sections read (adsb.py view, digital.py aprs/same view, webrx/status.sh).
export type PlanesView = {
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

export type AprsView = {
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

export type Alert = { id: string; raw: string; event: string; eventName: string; severity: string; issued: number | null; expires: number | null; active: boolean; received?: number; cardText?: string; cardSvg?: string; areas?: unknown[] }

export type AlertBrief = { id: string; eventName: string; severity: string; received: number; expires: number | null; active: boolean; areas: string[]; source: string; times: number }

export type AlertsView = { ok: boolean; active: Alert[]; activeCount: number; history: AlertBrief[]; total: number; lastExit: Exit; nextTest: { at: number; day: string; say: string }; now: number }

export type SameTest = { ok: boolean; say: string; header?: string; card?: string; cardSvg?: string; alert?: Alert | null }

export type WebStatus = {
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

// Where the tab is. This is Walton, KY, the built-in default (a mirror of scripts/location.py's DEFAULT);
// when ~/Library/Application Support/radio/location.json is in use, `radio.py location` says so at
// session.start and applyLocation() swaps in its values (nothing changes without a file).
export type Repeater = { mhz: number; name: string; short?: string; mark?: boolean; wx?: boolean }

export type Loc = { name: string; short: string; wxStation: string; wxCity: string; wxFreq: number; riverName: string; repeaters: Repeater[]; error: string | null }

export type Cat = 'broadcast' | 'air' | 'ham' | 'public' | 'weather' | 'iot'

export type Band = { id: string; label: string; lo: number; hi: number; cat: Cat; help: string }

// The tuner's station tabs: one row of categories, then that category's stations.
export type StationTab = 'fav' | 'fm' | 'wx' | 'air' | 'ham' | 'water' | 'hf'

export type TxtOpts = { fill?: string; size?: number; anchor?: string; weight?: number; rotate?: boolean; font?: string; opacity?: number; spacing?: number; cls?: string }

export type PanOpts = { W: number; compact: boolean; tunedMhz: number | null; playing: boolean }

export type LcdOpts = { W: number; compact: boolean; playing: boolean; retuning: boolean; meter: Meter | null; scanLevel: { above: number; label: string } | null; name: string | null; band: string | null; since: number | null; now: number; rec?: boolean; log?: boolean }

export type EqOpts = { W: number; compact: boolean; playing: boolean; label?: string | null; legacy?: boolean }

export type Item = { id: string; lo: number; hi: number; lane: number; label: string; cat: Cat | 'group' }

// Processes run in lanes. The V4 lane runs one process at a time: a press's first ('action'), the
// polls after it ('poll': only while no press runs or waits, and one already queued is not queued
// twice). Read-only calls that never touch the V4 (radio.py status, webrx/status.sh, ~0.4-0.8 s)
// run in the free lane beside it, so a press never waits behind them; a free read that comes back
// after a press started or ended is dropped (the press's own read is newer). radio.py's lock
// (sdr.lock) still keeps every V4 command to one at a time.
export type Lane = 'action' | 'poll' | 'free'

export type Proc = { lane: 'action' | 'poll'; id: string; argv: string[]; timeoutMs: number; resolve: (v: any) => void; reject: (e: unknown) => void; promise: Promise<any>; waitedOn: boolean }

export type ActEnd = 'ran' | 'joined' | 'superseded'
/** A press's first step in plain words and how long it should take (`id` groups timings for the estimate). */

export type Plan = { step: string; ms: number; id?: string }
/** key: what the press asks for ("job adsb on"; the same key is the same request), plan: its step and duration. */

export type ActOpts = { key?: string; plan?: () => Plan }

export type Intent = {
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

export type Look = { label: string; variant?: 'primary'; dimColor?: boolean }

export type PlaneRow = { icao: string; callsign?: string | null; reg?: string | null; alt?: number | null; altGnss?: number | null; onGround?: boolean | null; distNm?: number | null; bearing?: number | null; gs?: number | null; lastSeen?: number; squawk?: string | null; emergency?: string | null }

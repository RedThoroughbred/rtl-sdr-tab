import type { Register } from 'claude-code'
import { parseJob, parsePlanes, parseScan, parseTune, registerTools, TOOL_PREFIX } from './tools'
import type { StripGrid, StripMessage, StripPeak, StripProps } from './tuning-strip'
import { ALIAS, AMBER, ARG_HINT, AXIS, BANDS, BAND_GROUPS, BAND_SHORT, BG, BRIGHT, CAT_COLOR, COMMANDS_LINE, CYAN, EQ_MS, EQ_MS_PHONE, EQ_TICK_MS, FIXED, FM_NAMES, FM_SHOWN, FRAME_MS, GAINS, GREEN, GRID, HANDOFF_MAX_MS, HANDOFF_MS, HF_MAX, KNOWN, LABEL, LCD, LIST_MS, MAGENTA, MARK, METER_MS, MODES_ROW, NOAA, ORANGE, PANE, PATH, PEAKS_SHOWN, PLANES_PANE, PLANE_RANGES, PLOT, RECS_MS, RED, RETUNE_MS, ROW_LABEL, SECTIONS, SIGID_WIKI, SKY, STATION_TABS, STATUS_MS, STEPS, TAILSCALE_SERVE, TEAL, TICK_MS, TITLE, YELLOW, noaaShort, repShort, wxFreqText } from './constants'
import { ago, anyJobRunning, bandAt, bandOf, bg, clamp, clockOf, defaultSquelch, defaultStep, dur, esc, fmChannel, guessMode, hex, memoSvg, mhz, modeChip, modeName, n1, poolTo, sizeOf, svgDoc, svgHeight, txt } from './helpers'
import { LOC } from './location'
import { MAP_HI, MAP_LO, MAP_STYLE, activityOf, bandTitle, eqAlt, eqRaster, eqSvg, heatMark, hoodSvg, hzLabel, lcdAlt, lcdSvg, meshAlt, meshSvg, meterBar, panadapterSvg, peakName, rasterOf, sUnits, shortLabel, sparkSvg, sparkline, specLine, viewAlt } from './pictures'
import { FREE_RUNS, JOB_MS, JOB_START, JOB_STEP, KIND_DOING, LOG_MAX, POLL_LOG_MS, SEND_HINT, STOP_MS, STRIP_BINS, STRIP_KEY, STRIP_NAMES, STRIP_PEAKS, TOOL_ACT_MS, TOOL_READ_MS, actionQ, alertBrief, applyLocation, backgroundText, bandName, compass, ctrl, ctrlRow, deviceLine, diskLine, endText, exitText, freeNow, hitLine, holderText, iso, jobExitLine, jobOn, learned, localHref, lookProps, meshLine, olderLine, parseListen, parseRange, peakLine, planesCounts, pollLogged, pollQ, procId, recName, recRowText, resolveMode, sameRead, scanStateLine, scanText, scrubId, shareWhere, shortName, snapWfSvg, sortedSections, steadySvg, stripGrid, stripTag, svgOf, webUrlsText } from './tab-text'
import type { ActEnd, ActOpts, Activity, AlertsView, AprsView, Band, Eq, Exit, Gadgets, Intent, Item, Lane, LcdOpts, Look, Mesh, Meter, Mode, Peak, Plan, PlaneRow, PlanesView, Preset, Proc, RecLive, RecView, Recording, SameTest, ScannerView, Section, SectionContext, SettingsView, SnapDecode, SnapView, SnapWf, Station, StationTab, Status, Stopped, Tuner, View, WebStatus } from './types'

// The home folder comes from the environment at session.start (setHome), never from the code.
let HOME = ''
let EQ_FILE = '' // set by setHome
// Web SDR's "Send to Radio tab" leaves {mhz, mode, at} here; looked at every ~1.5 s while it runs.
let HANDOFF_FILE = '' // set by setHome

// ---------------------------------------------------------------- types

// ---------------------------------------------------------------- location

// ---------------------------------------------------------------- bands

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

// ---------------------------------------------------------------- helpers

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

function shownView(): View | null {
  if (st?.live?.running && liveFrame) return liveFrame
  if (liveFrame && scan) return liveFrame.at > scan.at ? liveFrame : scan
  return liveFrame ?? scan
}

// ---------------------------------------------------------------- colour

// ---------------------------------------------------------------- base64 (the module has no atob)

// ---------------------------------------------------------------- the spectrum + waterfall

// ---------------------------------------------------------------- the tuner's LCD

// ---------------------------------------------------------------- the EQ display (the sound itself)

// ---------------------------------------------------------------- the radio world map

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

// ---------------------------------------------------------------- the terminal's cells

// ---------------------------------------------------------------- the tuning strip (tuning-strip.tsx)
// The Client under the chart on the terminal and the desktop. Its props are the shown view cut
// down to STRIP_BINS slices per row, the tuner, the signals and the band's channel grid; its posts
// ({ type: 'tune', mhz, by } and { type: 'listen', mhz }) come back through 'ui.message'.

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

function deviceText(): string {
  const s = st
  if (!s) return 'Checking the RTL-SDR…'
  if (!s.device.present) return 'RTL-SDR Blog V4: not found. Plug it into the Mac.'
  if (s.state === 'busy' && s.owner) return `RTL-SDR Blog V4: in use by ${s.owner.app} (pid ${s.owner.pid}). The V4 can be used by one program at a time: close ${s.owner.app} first.`
  const hold = s.holder
  return `RTL-SDR Blog V4: connected · ${hold?.ours ? `in use by ${holderText(hold)} · /sdr stop frees it` : 'free'}`
}

// A job's name in a sentence: its label from radio.py, lower-cased unless it is a name (APRS, Web SDR).
function kindLabel(kind: string): string {
  const fixed: Record<string, string> = { listen: 'the audio', share: 'sharing with the phone', live: 'the live view', gadgets: 'the gadget listener', adsb: 'Planes', aprs: 'APRS', same: 'Weather alerts', webrx: 'Web SDR' }
  return fixed[kind] ?? st?.jobs?.[kind]?.label ?? kind
}

function tunerLine(): string {
  const playing = st?.listen.running
  const name = nameAt(tuner.hz / 1e6)
  const m = playing ? meter : null
  const sig = m ? (m.weak ? ' · weak signal — try the antenna by a window' : m.squelch === 'closed' ? ' · squelch closed' : ` · signal ${meterBar(m.level, 8)} ${sUnits(m.level)}`) : ''
  return `Tuner ${mhz(tuner.hz / 1e6)} MHz ${modeChip(tuner.mode)}${name ? ` (${name})` : ''} · ${playing ? `playing${sig}` : 'not playing'}`
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

// ---------------------------------------------------------------- the script: lanes, presses, the timing log

let procNow: Proc | null = null

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
let current: Intent | null = null
let pending: Intent | null = null
// Bumped as a press starts and ends: a free-lane read issued before then is stale.
let gen = 0

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

// A button for the press it makes: primary "<doing>…" while that runs, dim "Queued: …" while it waits.
function look(keys: string | string[], idle: string, doing?: string, queued?: string): Look {
  const ks = typeof keys === 'string' ? [keys] : keys
  if (current && ks.includes(current.key)) return { label: doing ?? `${current.label}…`, variant: 'primary' }
  if (pending && ks.includes(pending.key)) return { label: queued ?? `Queued: ${pending.label}`, dimColor: true }
  return { label: idle }
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

// ---- the timing log: one JSON line per press (and per slow poll) in actions.jsonl, the last 1000

let ACTIONS_LOG = '' // set by setHome

// Every path under the home folder, set at session.start once HOME is known.
function setHome(home: string): void {
  HOME = home
  EQ_FILE = `${HOME}/Library/Application Support/radio/eq.json`
  HANDOFF_FILE = `${HOME}/Library/Application Support/radio/handoff.json`
  ACTIONS_LOG = `${HOME}/Library/Application Support/radio/actions.jsonl`
}
let logLines: string[] | null = null
let logLoad: Promise<void> | null = null
let logFlush: { cancel: () => void } | null = null

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

// ---- Planes (adsb.py)

async function fetchPlanes(ctx: SectionContext): Promise<void> {
  const r = (await ctx.python('adsb.py', ['view', '--range', planesRange, '--svg', '--table', '--width', '34'], 20_000)) as PlanesView
  planesAt = ctx.now
  planesStale = false
  if (r?.ok) planes = r
  ctx.redraw()
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

async function toolWait($: any, p: Promise<string>, ms: number, what: string): Promise<string> {
  const t = await within($, p, ms)
  if (t !== null) return t
  const doing = doingLine()
  return `${what} is still going${doing ? ` (${doing})` : ''}. It carries on in the tab; call sdr_status in a moment to see the result.`
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
  on('tool.call', { tool: `${TOOL_PREFIX}sdr_status` }, async $ => {
    try {
      return { result: await toolWait($, toolStatus($), TOOL_READ_MS, 'Reading the radio') }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: `${TOOL_PREFIX}sdr_planes` }, async ($, e) => {
    try {
      return { result: await toolWait($, toolPlanes($, parsePlanes(e)), TOOL_READ_MS, 'Reading the planes') }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: `${TOOL_PREFIX}sdr_gadgets` }, async $ => {
    try {
      return { result: await toolWait($, toolGadgets($), TOOL_READ_MS, 'Reading the gadgets') }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: `${TOOL_PREFIX}sdr_scan` }, async ($, e) => {
    const p = parseScan(e)
    if (!p.ok) return { result: p.say }
    try {
      return { result: await toolScan($, p.band) }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: `${TOOL_PREFIX}sdr_tune` }, async ($, e) => {
    const p = parseTune(e)
    if (!p.ok) return { result: p.say }
    try {
      return { result: await toolTune($, p) }
    } catch (err: any) {
      return { result: `The Radio tool failed: ${String(err?.message ?? err)}` }
    }
  })
  on('tool.call', { tool: `${TOOL_PREFIX}sdr_job` }, async ($, e) => {
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

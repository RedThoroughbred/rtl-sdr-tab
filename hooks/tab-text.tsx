// Lines of words the tab shows, and the small view helpers. No $.

import { AXIS, BANDS, BG, FIXED, FM_NAMES, LABEL, MODES_ROW, NOAA, PLOT, RED, ROW_LABEL, SECTIONS, buildKnown, repPreset, repShort, wxFreqText } from './constants'
import { ago, clockOf, dur, guessMode, mhz, modeChip, sizeOf, svgDoc, svgHeight, txt } from './helpers'
import { LOC, setLoc } from './location'
import { peakName, shortLabel, specLine } from './pictures'
import type { ActEnd, AlertBrief, Device, Exit, Holder, Loc, Look, Mesh, MeshChan, Mode, Peak, PlanesView, Proc, RecDay, RecView, Recording, ScanHit, ScannerView, Section, SectionContext, SnapWf, Status, View, WebStatus } from './types'

export const STRIP_KEY = 'strip'

export const STRIP_BINS = 240

export const STRIP_PEAKS = 60

export const STRIP_NAMES = 80

// Where a click with no signal near snaps: [lo, hi, mode, step, base] (MHz). FM channels sit on odd
// tenths, airband on 25 kHz, GMRS/FRS on 12.5 kHz; elsewhere 5 kHz in the band's mode (guessMode).
export const CHANNEL_GRID: StripGrid[] = [
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
export function stripGrid(lo: number, hi: number): StripGrid[] {
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
export function stripTag(p: Peak): string | null {
  if (!p.name) return null
  const t = shortLabel(p).replace(/^\d+(\.\d+)?\s*/, '')
  return t || null
}

export function deviceLine(d: Device, now: number): string {
  return `${d.model}${d.channel !== null && d.channel !== undefined && d.channel !== '' ? ` ch ${d.channel}` : ''} · ${d.kind} · ${ago(d.last, now)}${d.say ? ` · ${d.say}` : ''}${d.lowBattery ? ' · LOW BATTERY' : ''} · heard ${d.count}×`
}

export function peakLine(p: Peak): string {
  return `${mhz(p.mhz).padStart(8)} MHz  +${p.above.toFixed(0).padStart(2)} dB  ${p.kind === 'burst' ? 'bursts' : 'steady'}  ${peakName(p)}`
}

// "Planes · ADS-B on 1090 MHz · since 21:04"
export function holderText(h: Holder): string {
  return `${h.label}${h.detail ? ` · ${h.detail}` : ''}${h.since ? ` · since ${clockOf(h.since)}` : ''}`
}

export function shareWhere(s: Status['share']): string {
  const port = s.port ?? 1234
  const w: string[] = []
  if (s.tailscale && (s.addr === '0.0.0.0' || s.addr === s.tailscale)) w.push(`${s.tailscale}:${port} (Tailscale, works away from home)`)
  if (s.lan && (s.addr === '0.0.0.0' || s.addr === s.lan)) w.push(`${s.lan}:${port} (home Wi-Fi)`)
  return w.join(' or ')
}

export function bandName(b?: string | null): string {
  return b === '915' ? '915 MHz' : b === 'hop' ? '433.92 + 915 MHz' : '433.92 MHz'
}

export function meshLine(m?: Mesh): string {
  if (!m) return ''
  const s = (ch: MeshChan) => `${ch.name.replace(' LongFast', '')} ${ch.state === 'unknown' ? 'no data yet' : `${ch.state} (${ch.bursts} burst${ch.bursts === 1 ? '' : 's'}, ${ch.perMin}/min)`}`
  return `Mesh (last hour, ${Math.round(m.seconds / 60)} min listened): ${s(m.mt)} · ${s(m.mc)}`
}

export function scanText(v: View): string {
  const lines = [`${mhz(v.start)} ${specLine(v, 48)} ${mhz(v.stop)} MHz · noise floor ${v.floor.toFixed(0)} dB · ${clockOf(v.at)}`]
  for (const p of v.peaks) lines.push(peakLine(p) + (p.listen ? `  (/sdr listen ${mhz(p.mhz)}${p.listen === 'wbfm' ? '' : ` ${p.listen}`})` : ''))
  return lines.join('\n')
}

export function shortName(name: string): string {
  return name.split(' ').slice(0, 2).join(' ')
}

export function exitText(label: string, ex: Exit): string {
  if (!ex || ex.reason === 'stopped') return ''
  if (ex.reason === 'done') return ex.detail
  if (ex.reason === 'preempted') return `${label} ${ex.detail}.`
  if (/^Stopped /.test(ex.detail)) return `${label} s${ex.detail.slice(1)}`
  return `${label} stopped: ${ex.detail || ex.reason}`
}

export const actionQ: Proc[] = []

export const pollQ: Proc[] = []

export const freeNow = new Map<string, Promise<any>>()

// "radio.py listen meter", "status.sh": a process by what it is, for the poll queue and the log.
export function procId(argv: string[]): string {
  return argv
    .filter(a => a !== 'python3')
    .map(a => (a.includes('/') ? a.split('/').pop() ?? a : a))
    .join(' ')
}

// How long each kind of press took this session (the "about N s" after the first time).
export const learned = new Map<string, number>()

// Starting something on the V4 first stops whatever holds it (Web SDR's container takes seconds).
export const STOP_MS: Record<string, number> = { webrx: 5000, live: 1000, listen: 800, gadgets: 1000, share: 800, adsb: 1000, aprs: 1000, same: 1000 }

// What a press asks for, the same key at the button (to show it) and in the action (to run it).
export function resolveMode(f: number, mode?: string | null): Mode {
  return ((MODES_ROW as string[]).includes(mode ?? '') ? (mode as Mode) : guessMode(f)) ?? 'fm'
}

// A Look as Button props, leaving out what it does not set (a Button's own variant stays).
export function lookProps(l: Look): { label: string; variant?: 'primary'; dimColor?: boolean } {
  return { label: l.label, ...(l.variant ? { variant: l.variant } : {}), ...(l.dimColor ? { dimColor: true } : {}) }
}

export const LOC_DEFAULT: Loc = { ...LOC, repeaters: LOC.repeaters.map(r => ({ ...r })) }

export const FM_DEFAULT: Record<string, string> = { ...FM_NAMES }

export const FIXED_DEFAULT = { wx: [...FIXED.wx], ham: [...FIXED.ham] }

export const HELP_DEFAULT: Record<string, string> = Object.fromEntries(BANDS.map(b => [b.id, b.help]))

export function applyLocation(r: any): void {
  const l = r?.location
  const error = typeof r?.error === 'string' ? r.error : null
  if (!r?.custom || !l || typeof l !== 'object') {
    // No usable file: Walton, exactly as built in (also undoes an earlier custom one).
    setLoc({ ...LOC_DEFAULT, repeaters: LOC_DEFAULT.repeaters.map(x => ({ ...x })), error })
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
  setLoc({
    ...LOC,
    name: String(l.name ?? LOC.name),
    short: String(l.short ?? LOC.short),
    wxStation: String(w.station ?? ''),
    wxCity: String(w.city ?? ''),
    wxFreq: Number(w.freq) || 162.55,
    riverName: String(l.river?.name ?? ''),
    error,
    repeaters: Array.isArray(l.repeaters) ? l.repeaters.map((x: any) => ({ mhz: Number(x.mhz), name: String(x.name), short: x.short ? String(x.short) : undefined, mark: !!x.mark, wx: !!x.wx })) : [],
  })
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

export const LOG_MAX = 1000

export const POLL_LOG_MS = 300

export const pollLogged = new Map<string, number>()

export function iso(t: number): string {
  try {
    return new Date(t).toISOString()
  } catch {
    return String(t)
  }
}

// The same reading again (its clock aside): nothing to draw.
export function sameRead(a: unknown, b: unknown): boolean {
  if (!a || !b) return false
  try {
    return JSON.stringify({ ...(a as object), now: 0 }) === JSON.stringify({ ...(b as object), now: 0 })
  } catch {
    return false
  }
}

// The reply for a press that did not run itself: it joined the same one, or a newer press replaced it.
export function endText(end: ActEnd, label: string): string {
  return end === 'superseded' ? `${label}: skipped, a newer press replaced it before it ran.` : end === 'joined' ? `${label}: already under way.` : ''
}

// Read-only, never the V4: runs beside the V4 lane.
export const FREE_RUNS = new Set(['webrx/status.sh'])

export function sortedSections(): Section[] {
  return [...SECTIONS].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

// A section's job (adsb, aprs, same, webrx) on or off through radio.py's job manager.
export const JOB_START: Record<string, string> = { adsb: 'Starting Planes', aprs: 'Starting APRS', same: 'Starting the weather alert watch', webrx: 'Starting Web SDR' }

export const JOB_STEP: Record<string, string> = { adsb: 'starting the ADS-B decoder on 1090 MHz', aprs: 'starting the APRS decoder on 144.390 MHz', same: 'starting the alert decoder on 162.550 MHz', webrx: 'starting rtl_tcp and the OpenWebRX+ container' }

export const JOB_MS: Record<string, number> = { adsb: 2500, aprs: 2500, same: 2500, webrx: 20_000 }

export const KIND_DOING: Record<string, string> = { adsb: 'track planes (ADS-B on 1090 MHz)', aprs: 'decode APRS on 144.390 MHz', same: 'watch for NOAA weather alerts on 162.550 MHz', webrx: 'run Web SDR' }

export function parseRange(arg: string): [number, number] | null {
  const n = arg.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/)
  if (!n) return null
  const a = Number(n[1])
  const b = Number(n[2])
  return a > 0 && b > 0 && a !== b ? [Math.min(a, b), Math.max(a, b)] : null
}

export function parseListen(arg: string): { freq: number; mode: string | null } | null {
  const m = arg.trim().match(/^(\d+(?:\.\d+)?)\s*(?:mhz|khz)?\s*(wbfm|wfm|fm|nfm|am|usb|lsb|ssb|cw)?$/i)
  if (!m) return null
  const mode = m[2] ? m[2].toLowerCase() : null
  // "518 khz" reads as kHz; anything else is MHz.
  const freq = /khz/i.test(arg) ? Number(m[1]) / 1000 : Number(m[1])
  return { freq, mode: mode === 'wfm' ? 'wbfm' : mode === 'nfm' ? 'fm' : mode === 'ssb' ? 'usb' : mode }
}

// A row of controls with a fixed-width label, so rows line up.
export function ctrlRow(els: any, key: string, label: string, kids: unknown[]): unknown {
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
export function ctrl(els: any, key: string, label: string | Look, press: () => void, primary = false): unknown {
  const { Box, Button } = els
  const lk = typeof label === 'string' ? { label } : label
  return (
    <Box key={`b:${key}`} paddingRight={1}>
      <Button key={key} label={lk.label} variant={primary || lk.variant ? 'primary' : undefined} dimColor={lk.dimColor || undefined} onPress={press} />
    </Box>
  )
}

export function svgOf(ctx: SectionContext): any {
  return ctx.surface === 'terminal' ? null : steadySvg(ctx.els.Svg, ctx.narrow ? 440 : 760)
}

// The surface's Svg with a height filled in from the markup (see svgHeight), so no picture in
// the tab drops to zero height while its refreshed copy loads. A pane that keeps the person at
// the bottom would otherwise pin them there each time a picture refreshed. An explicit `height`
// (undefined included: "take the natural size") is left as given.
export function steadySvg(base: any, maxW: number): any {
  if (!base) return null
  return (props: any) =>
    base(Object.prototype.hasOwnProperty.call(props, 'height') ? props : { ...props, height: svgHeight(String(props.source ?? ''), maxW) })
}

export function jobOn(ctx: SectionContext, kind: string): boolean {
  return !!ctx.status?.jobs?.[kind]?.running
}

export function jobExitLine(ctx: SectionContext, kind: string, label: string): string {
  const ex = ctx.status?.jobs?.[kind]?.lastExit ?? null
  return exitText(label, ex)
}

export function localHref(u: string): string {
  return /^https?:\/\/[^/]+$/.test(u) ? `${u}/` : u
}

export function planesCounts(p: PlanesView | null, isOn: boolean): string {
  if (!p || p.empty) return isOn ? 'Listening on 1090 MHz: the first planes show up within a few seconds.' : 'No planes yet: turn Planes on.'
  const c = p.counts
  const far = c.farthestNm !== null ? ` · farthest ${c.farthest ?? '?'} at ${c.farthestNm} nm` : ''
  const when = p.updated ? `${isOn ? 'updated' : 'last heard'} ${clockOf(p.updated)}` : ''
  return `${c.aircraft} aircraft · ${c.withPosition} with a position${far}${when ? ` · ${when}` : ''}`
}

export function alertBrief(a: AlertBrief, now: number): string {
  return `${clockOf(a.received)}  ${a.eventName}${a.areas.length ? ` · ${a.areas.slice(0, 3).join(', ')}` : ''}${a.active ? ' · ACTIVE' : a.expires ? ` · ended ${ago(a.expires, now)}` : ''}${a.source === 'selftest' ? ' (test)' : ''}`
}

export function webUrlsText(w: WebStatus | null): string {
  if (!w?.running) return ''
  const u = w.urls ?? {}
  return [u.local ? `This Mac: ${u.local}` : '', u.lan ? `home Wi-Fi: ${u.lan}` : '', u.tailscale ? `Tailscale: ${u.tailscale}` : ''].filter(Boolean).join(' · ')
}

// What Web SDR decodes while nobody has its page open (its settings: background decoding).
export function backgroundText(w: WebStatus | null, narrow: boolean): string {
  const b = w?.background
  if (b && !b.enabled) return 'Background decoding is off (Web SDR Settings › Background decoding turns it back on).'
  const how = narrow
    ? 'While nobody has the page open, Web SDR decodes APRS on 144.390 (its Map) and, about midnight to 6 am, 433 MHz gadgets.'
    : 'Background decoding: while Web SDR runs and nobody has its page open, OpenWebRX+ sits on 2 m and decodes APRS on 144.390 MHz (stations land on its Map) and, from about midnight to 6 am, 433 MHz gadgets (rtl_433). Opening the page joins whatever it is decoding; pick another profile and listeners always win.'
  return `${how} Web SDR still holds the V4 the whole time, so the tab's own jobs wait until it stops (starting one stops it, as always).`
}

export const SEND_HINT = 'Send to Radio tab: the amber button under the frequency in Web SDR hands what it is tuned to back here. The tab stops Web SDR, tunes the V4 there and plays it on the Mac (wide FM, narrow FM or AM), as long as this tab is open in Claude Code.'

export function recName(it: Recording): string {
  const st0 = it.station || (it.label && !/MHz$/.test(it.label) ? it.label : '')
  return st0 || (it.clip ? 'transmission' : 'recording')
}

export function recRowText(it: Recording, now: number): string {
  return `${clockOf(it.start)}  ${mhz(it.freq)}  ${recName(it)}${it.clip ? ' (clip)' : ''}  ${it.recording ? '● recording' : dur(it.duration)}  ${sizeOf(it.size)}`
}

export function olderLine(d: RecDay): string {
  const bits = [d.clips ? `${d.clips} clip${d.clips === 1 ? '' : 's'}` : '', d.recordings ? `${d.recordings} recording${d.recordings === 1 ? '' : 's'}` : ''].filter(Boolean)
  const mins = d.seconds >= 60 ? `${Math.round(d.seconds / 60)} min` : `${Math.round(d.seconds)} s`
  return `${d.label}: ${bits.join(', ')}, ${mins} · ${sizeOf(d.bytes)}`
}

export function diskLine(r: RecView): string {
  return `On disk: ${sizeOf(r.total.bytes)} of ${r.keep.gb} GB · kept ${r.keep.days} days, then the oldest go to the Trash`
}

export function scanStateLine(v: ScannerView | null, now: number): { text: string; color?: string } {
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

export function hitLine(h: ScanHit): string {
  return `${clockOf(h.at)}  ${mhz(h.freq)}  ${h.name}${h.secs ? ` · ${dur(h.secs)}` : ''}`
}

// The replayed waterfall as a picture: the file's rows as a palette PNG, the span on an axis.
export function snapWfSvg(w: SnapWf, o: { W: number; compact: boolean }): string {
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

// A tool's wait for the queue; past it the press goes on and the answer says what is under way.
export const TOOL_READ_MS = 45_000

export const TOOL_ACT_MS = 100_000

export function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'N'
}

// A gadget's reading with the sensor's own ID taken out of it, whatever the decoder printed.
export function scrubId(text: string, d: Device): string {
  let out = text
  for (const v of [d.id, d.key.split('|')[1]]) {
    const id = v === null || v === undefined ? '' : String(v)
    if (id.length >= 3) out = out.split(id).join('…')
  }
  return out
}

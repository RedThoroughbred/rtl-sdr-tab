import type { ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface, RenderChildren } from 'claude-code'

// The tuning strip: a Client region drawn under the spectrum + waterfall on the terminal and the
// desktop. The chart above is an Svg (desktop) or a Raster (terminal), and neither takes clicks; a
// Client is the one element that gets the pointer, so this stands in for the chart:
//   rows      names at the signals · ▾ ticks and ▼ at the tuner · two rows of coloured cells (the
//             loudest moment on top, the average below, in the waterfall's colours) · a start /
//             middle / end MHz axis · a readout line
//   point     the readout names what is under the pointer: "133.425 MHz · AM · +24 dB · aircraft (bursts)"
//   click     posts { type: 'tune', mhz } on the button's release: snapped to a signal within a cell
//             and a half, else to the band's channel step (FM's odd tenths, airband's 25 kHz, ...);
//             holding the button and moving scrubs the readout first
//   keys      once a click has given it the focus: ← → by the tuner's step, Shift+← → to the
//             previous / next signal, Enter posts { type: 'listen' } (play or stop); Escape hands
//             the focus back (the engine does that)
// register.tsx's 'ui.message' hook does the tuning and answers with fresh props. No $ here and no
// timers: the strip draws from its props and its local state and talks only through post.

export type StripMode = 'wbfm' | 'fm' | 'am' | null
/** A signal on the strip: its height above the noise floor, its name, a short tag to print over it. */
export type StripPeak = { mhz: number; db: number; name: string | null; tag: string | null; burst: boolean }
/** A stretch of the band and its channel grid: [lo, hi, mode, step, base] in MHz (null mode: no audio). */
export type StripGrid = [number, number, StripMode, number, number]
/** What the hooks module hands the strip: the view downsampled, the tuner, the signals, the grid. */
export type StripProps = {
  start: number
  stop: number
  label: string
  live: boolean
  /** The loudest moment per slice and the average per slice, 0–255 on the waterfall's palette. */
  pk: number[]
  av: number[]
  /** The dB that 0 and 255 stand for, and the noise floor. */
  lo: number
  hi: number
  floor: number
  tuned: number
  mode: 'wbfm' | 'fm' | 'am'
  /** The tuner's step, MHz. */
  step: number
  playing: number | null
  busy: string
  peaks: StripPeak[]
  names: [number, string][]
  grid: StripGrid[]
  /** The hooks module's guess at the width, for the first draw before the region is laid out. */
  cols: number
  /** Bumped by the hooks module on every tuner change: a pending local tune is stale once it moves. */
  rev: number
}
export type StripState = { hx: number | null; drag: boolean; pend: { mhz: number; rev: number } | null }
export type StripMessage = { type: 'tune'; mhz: number; by: 'click' | 'key' | 'peak' } | { type: 'listen'; mhz: number }

export const STRIP_ROWS = 6
const EMPTY: StripState = { hx: null, drag: false, pend: null }
const RED = '#ff6b6b'
const YELLOW = '#ffd84a'
const AMBER = '#f0c050'
const BRIGHT = '#e6edf0'
const AXIS = '#7f9199'
const LABEL = '#c9d4da'
const WHITE = '#ffffff'
const INK = '#10161a'
// The tuner's range (the V4's): ← → never step past it.
const F_MIN = 0.5 // HF (0.4.0): the V4's upconverter reaches down to about 500 kHz
const F_MAX = 1766

// ---------------------------------------------------------------- the waterfall's colours
// The same ramp as register.tsx's wfRgb (turbo with its bottom faded to near-black), so a cell
// here is the colour of the waterfall above it at that level.

function clamp(v: number, a = 0, b = 1): number {
  return Math.min(b, Math.max(a, v))
}

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

export const PALETTE: string[] = Array.from({ length: 256 }, (_, i) => {
  const [r, g, b] = wfRgb(i / 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
})

// What reads on top of each palette colour: white on the dark end and on the ramp's dark-red top
// (where the chart's red tuner line would vanish), near-black on the bright middle.
export const ON_PALETTE: string[] = Array.from({ length: 256 }, (_, i) => {
  const [r, g, b] = wfRgb(i / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? INK : WHITE
})

// ---------------------------------------------------------------- frequencies (pure, tested)

export function fmtMhz(f: number): string {
  return String(Number(f.toFixed(4)))
}

function modeLabel(m: StripMode): string {
  return m === 'wbfm' ? 'WFM' : m === 'fm' ? 'NFM' : m === 'am' ? 'AM' : 'no audio'
}

/** The frequency at `x` cells from the region's left edge (fractional; a column's middle is col + 0.5). */
export function mhzAtCell(p: StripProps, columns: number, x: number): number {
  return p.start + (clamp(x, 0, columns) / columns) * (p.stop - p.start)
}

/** The column a frequency falls in, or null off the strip. */
export function cellOfMhz(p: StripProps, columns: number, f: number): number | null {
  if (f < p.start - 1e-9 || f > p.stop + 1e-9) return null
  return Math.min(columns - 1, Math.max(0, Math.floor(((f - p.start) / (p.stop - p.start)) * columns)))
}

export function gridAt(p: StripProps, f: number): StripGrid | undefined {
  return p.grid.find(g => f >= g[0] - 1e-9 && f <= g[1] + 1e-9)
}

/** The signal nearest `f` within a cell and a half, or null. */
export function peakNear(p: StripProps, columns: number, f: number): StripPeak | null {
  const r = (1.5 * (p.stop - p.start)) / columns
  let best: StripPeak | null = null
  for (const k of p.peaks) if (Math.abs(k.mhz - f) <= r && (!best || Math.abs(k.mhz - f) < Math.abs(best.mhz - f))) best = k
  return best
}

/** Where a click at `f` tunes: a signal within a cell and a half, else the nearest channel of the band's grid. */
export function snapMhz(p: StripProps, columns: number, f: number): number {
  const k = peakNear(p, columns, f)
  if (k) return k.mhz
  const g = gridAt(p, f)
  const step = g && g[3] > 0 ? g[3] : 0.005
  const base = g ? g[4] : 0
  let s = base + Math.round((f - base) / step) * step
  if (g && s > g[1] + 1e-9) s -= step
  if (g && s < g[0] - 1e-9) s += step
  return Number(clamp(s, Math.min(p.start, p.stop), Math.max(p.start, p.stop)).toFixed(6))
}

/** The next signal above (dir 1) or below (dir -1) `f`, or null at the end of the list. */
export function nextPeak(p: StripProps, f: number, dir: number): number | null {
  const sorted = [...p.peaks].sort((a, b) => a.mhz - b.mhz)
  const k = dir > 0 ? sorted.find(x => x.mhz > f + 1e-4) : [...sorted].reverse().find(x => x.mhz < f - 1e-4)
  return k ? k.mhz : null
}

function nameNear(p: StripProps, columns: number, f: number): string | null {
  const r = (3 * (p.stop - p.start)) / columns
  let best: [number, string] | null = null
  for (const n of p.names) if (Math.abs(n[0] - f) <= r && (!best || Math.abs(n[0] - f) < Math.abs(best[0] - f))) best = n
  return best ? best[1] : null
}

/** One value per column from a per-slice array: the loudest slice the column covers. */
function perColumn(vals: number[], columns: number): number[] {
  const n = vals.length
  const out: number[] = []
  for (let c = 0; c < columns; c++) {
    if (!n) {
      out.push(0)
      continue
    }
    const a = Math.min(n - 1, Math.floor((c * n) / columns))
    const b = Math.max(a + 1, Math.floor(((c + 1) * n) / columns))
    let m = 0
    for (let i = a; i < Math.min(n, b); i++) m = Math.max(m, vals[i] ?? 0)
    out.push(m)
  }
  return out
}

// What the readout says about a spot: the signal there, else the level and the nearest name.
export function readoutAt(p: StripProps, columns: number, f: number, col: number, pk: number[]): string {
  const g = gridAt(p, f)
  const k = peakNear(p, columns, f)
  if (k) {
    const what = k.name ? `${k.name} (${k.burst ? 'bursts' : 'steady'})` : k.burst ? 'short bursts' : 'steady signal'
    return `${fmtMhz(k.mhz)} MHz · ${modeLabel(gridAt(p, k.mhz)?.[2] ?? g?.[2] ?? null)} · +${Math.round(k.db)} dB · ${what}`
  }
  const at = snapMhz(p, columns, f)
  const db = p.lo + ((pk[col] ?? 0) / 255) * (p.hi - p.lo) - p.floor
  const level = db >= 2 ? `+${Math.round(db)} dB` : 'noise floor'
  return `${fmtMhz(at)} MHz · ${modeLabel(g?.[2] ?? null)} · ${level} · ${nameNear(p, columns, f) ?? p.label}`
}

// ---------------------------------------------------------------- input

function effectiveTuned(p: StripProps, s: StripState): number {
  return s.pend && s.pend.rev === p.rev ? s.pend.mhz : p.tuned
}

function rowsOf(surface: ClientSurface<StripState>): number {
  return surface.rows > 0 ? surface.rows : STRIP_ROWS
}

export function onStripPointer(ev: ClientPointerEvent, p: StripProps, surface: ClientSurface<StripState>, columns: number): void {
  const s = surface.state ?? EMPTY
  const x = ev.fine?.x ?? ev.x + 0.5
  const inside = ev.x >= 0 && ev.x < columns && ev.y >= 0 && ev.y < rowsOf(surface)
  const hx = clamp(x, 0, columns - 1e-6)
  if (ev.type === 'move') {
    if (!inside && !s.drag) {
      if (s.hx !== null) surface.setState({ ...s, hx: null })
      return
    }
    if (s.hx === null || Math.floor(s.hx) !== Math.floor(hx) || (ev.fine && Math.abs(s.hx - hx) >= 0.25)) surface.setState({ ...s, hx })
    return
  }
  if (ev.type === 'down') {
    if (inside && (!ev.button || ev.button === 'left')) surface.setState({ ...s, hx, drag: true })
    return
  }
  if (ev.type === 'up') {
    if (!s.drag) return
    if (!inside) {
      surface.setState({ ...s, hx: null, drag: false })
      return
    }
    const mhz = snapMhz(p, columns, mhzAtCell(p, columns, x))
    surface.post({ type: 'tune', mhz, by: 'click' })
    surface.setState({ ...s, hx, drag: false, pend: { mhz, rev: p.rev } })
    return
  }
  if (ev.type === 'leave' && !s.drag && s.hx !== null) surface.setState({ ...s, hx: null })
}

export function onStripKey(ev: ClientKeyEvent, p: StripProps, surface: ClientSurface<StripState>): void {
  const s = surface.state ?? EMPTY
  const tuned = effectiveTuned(p, s)
  if (ev.key === 'left' || ev.key === 'right') {
    const dir = ev.key === 'left' ? -1 : 1
    const mhz = ev.shift ? nextPeak(p, tuned, dir) : Number(clamp(tuned + dir * p.step, F_MIN, F_MAX).toFixed(6))
    if (mhz === null || Math.abs(mhz - tuned) < 1e-7) return
    surface.post({ type: 'tune', mhz, by: ev.shift ? 'peak' : 'key' })
    surface.setState({ ...s, hx: null, pend: { mhz, rev: p.rev } })
    return
  }
  if (ev.key === 'return' || ev.key === 'enter') surface.post({ type: 'listen', mhz: tuned })
}

// ---------------------------------------------------------------- drawing

type Cell = { ch: string; fg?: string; bg?: string; bold?: boolean }

function blank(columns: number): Cell[] {
  return Array.from({ length: columns }, () => ({ ch: ' ' }))
}

function put(row: Cell[], at: number, text: string, fg: string, bold = false): void {
  const chars = [...text]
  for (let i = 0; i < chars.length; i++) if (at + i >= 0 && at + i < row.length) row[at + i] = { ch: chars[i] ?? ' ', fg, bold }
}

function isGap(c: Cell): boolean {
  return c.ch === ' ' && !c.bg
}

function sameStyle(a: Cell, b: Cell): boolean {
  return isGap(a) ? isGap(b) : !isGap(b) && a.fg === b.fg && a.bg === b.bg && !!a.bold === !!b.bold
}

function sane(props: StripProps): StripProps | null {
  const p = props as Partial<StripProps> | null
  if (!p || typeof p !== 'object') return null
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const start = num(p.start, NaN)
  const stop = num(p.stop, NaN)
  if (!(stop > start)) return null
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(x => num(x, 0)) : [])
  return {
    start,
    stop,
    label: typeof p.label === 'string' ? p.label : '',
    live: !!p.live,
    pk: arr(p.pk),
    av: arr(p.av),
    lo: num(p.lo, -40),
    hi: num(p.hi, 0),
    floor: num(p.floor, -40),
    tuned: num(p.tuned, start),
    mode: p.mode === 'wbfm' || p.mode === 'am' ? p.mode : 'fm',
    step: num(p.step, 0.0125) || 0.0125,
    playing: typeof p.playing === 'number' ? p.playing : null,
    busy: typeof p.busy === 'string' ? p.busy : '',
    peaks: Array.isArray(p.peaks) ? p.peaks.filter(k => k && typeof k.mhz === 'number') : [],
    names: Array.isArray(p.names) ? p.names.filter(n => Array.isArray(n) && typeof n[0] === 'number' && typeof n[1] === 'string') : [],
    grid: Array.isArray(p.grid) ? p.grid.filter(g => Array.isArray(g) && g.length === 5) : [],
    cols: num(p.cols, 80),
    rev: num(p.rev, 0),
  }
}

function axisRow(p: StripProps, columns: number): Cell[] {
  const row = blank(columns)
  const a = fmtMhz(p.start)
  const m = fmtMhz((p.start + p.stop) / 2)
  const b = `${fmtMhz(p.stop)} MHz`
  if (columns < a.length + m.length + b.length + 8) {
    put(row, 0, `${a} – ${b}`.slice(0, columns), AXIS)
    return row
  }
  put(row, 0, '─'.repeat(columns), AXIS)
  put(row, 0, `${a} `, AXIS)
  put(row, columns - b.length - 1, ` ${b}`, AXIS)
  put(row, Math.round(columns / 2 - m.length / 2) - 1, ` ${m} `, AXIS)
  return row
}

const TuningStrip: ClientModule<StripProps, StripState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const p = sane(props)
  const columns = Math.max(16, surface.columns > 0 ? surface.columns : Math.round(p?.cols ?? 80))
  if (!p) return <Text dimColor>No band to show yet: scan one, or ◉ Live.</Text>
  surface.onPointer(ev => onStripPointer(ev, p, surface, columns))
  surface.onKey(ev => onStripKey(ev, p, surface))
  const s = surface.state ?? EMPTY
  const tuned = effectiveTuned(p, s)
  const pk = perColumn(p.pk, columns)
  const av = perColumn(p.av, columns)
  const tunedCol = cellOfMhz(p, columns, tuned)
  const hoverCol = s.hx === null ? null : Math.min(columns - 1, Math.floor(s.hx))

  // Names over the signals (strongest first, never touching), and a tick under each.
  const labels = blank(columns)
  const ticks = blank(columns)
  const taken: boolean[] = Array.from({ length: columns }, () => false)
  for (const k of [...p.peaks].sort((a, b) => b.db - a.db)) {
    const c = cellOfMhz(p, columns, k.mhz)
    if (c === null) continue
    ticks[c] = { ch: '▾', fg: k.burst ? AMBER : YELLOW }
    const tag = k.tag ? k.tag.slice(0, 10) : ''
    if (!tag) continue
    const x0 = Math.min(columns - tag.length, Math.max(0, c - Math.floor((tag.length - 1) / 2)))
    if (taken.slice(Math.max(0, x0 - 1), x0 + tag.length + 1).some(Boolean)) continue
    for (let i = x0; i < x0 + tag.length; i++) taken[i] = true
    put(labels, x0, tag, k.burst ? AMBER : BRIGHT)
  }
  if (tunedCol !== null) ticks[tunedCol] = { ch: '▼', fg: RED, bold: true }

  // The two rows of cells: the loudest moment, then the average; the tuner (heavy, under the red ▼)
  // and the pointer (light) through both, in whichever of white or near-black reads on the cell.
  const heat = (lv: number[]) =>
    lv.map((v, c): Cell => {
      const i = Math.round(clamp(v, 0, 255))
      const bg = PALETTE[i] ?? PALETTE[0]
      const on = ON_PALETTE[i] ?? WHITE
      if (c === tunedCol) return { ch: '┃', fg: on, bg, bold: true }
      if (c === hoverCol) return { ch: s.drag ? '┃' : '│', fg: on, bg }
      return { ch: '█', fg: bg }
    })

  // The readout: what is under the pointer, else the tuner and the keys.
  let readout: string
  let lit = false
  if (hoverCol !== null && s.hx !== null) {
    const f = mhzAtCell(p, columns, s.hx)
    readout = `${s.drag ? 'release to tune ' : ''}${readoutAt(p, columns, f, hoverCol, pk)}${s.drag ? '' : ' · click to tune'}`
    lit = true
  } else if (p.busy) {
    readout = `${p.busy}…`
  } else {
    const k = peakNear(p, columns, tuned)
    const name = k?.name ?? nameNear(p, columns, tuned)
    const playing = p.playing !== null && Math.abs(p.playing - tuned) < 0.0005
    const off = tunedCol === null ? ' (off this band)' : ''
    readout = `▼ ${fmtMhz(tuned)} MHz ${modeLabel(p.mode)}${off}${name ? ` · ${name}` : ''} · ${playing ? '▶ playing, Enter stops' : p.playing !== null ? `▶ ${fmtMhz(p.playing)} playing` : 'Enter ▶ plays'} · click to tune · ← → step · ⇧← ⇧→ signals`
  }

  const rows: Cell[][] = [labels, ticks, heat(pk), heat(av), axisRow(p, columns)]
  return (
    <Box flexDirection="column" width={columns}>
      {rows.map((cells, r) => {
        const kids: RenderChildren[] = []
        for (let i = 0; i < cells.length; ) {
          const c = cells[i] as Cell
          let j = i + 1
          while (j < cells.length && sameStyle(cells[j] as Cell, c)) j++
          // A gap is a spacer Box rather than spaces, so no surface folds it away.
          kids.push(
            isGap(c) ? (
              <Box key={`g${r}:${i}`} width={j - i} />
            ) : (
              <Text key={`t${r}:${i}`} color={c.fg} backgroundColor={c.bg} bold={c.bold}>
                {cells
                  .slice(i, j)
                  .map(x => x.ch)
                  .join('')}
              </Text>
            ),
          )
          i = j
        }
        return (
          <Box key={`row${r}`} height={1} overflow="hidden">
            {kids}
          </Box>
        )
      })}
      <Box key="row5" height={1} overflow="hidden">
        <Text color={lit ? BRIGHT : LABEL} dimColor={!lit} wrap="truncate-end">
          {readout}
        </Text>
      </Box>
    </Box>
  )
}

export default TuningStrip

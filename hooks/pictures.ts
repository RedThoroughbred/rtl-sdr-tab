// The instrument pictures: the LCD tuner, the audio spectrum, the band map, the mesh and neighbourhood pictures and the sparklines. No $.

import { AMBER, AXIS, BAND_SHORT, BG, BRIGHT, CYAN, GREEN, GRID, GRID2, LABEL, LCD, MAGENTA, MARK, ORANGE, PLOT, RED, SANS, SKY, STEPS, TEAL, YELLOW, repShort } from './constants'
import { PAL, ago, b64decode, b64encode, bandOf, bg, clamp, clockOf, heat, hex, mhz, modeName, n1, niceStep, poolTo, rampStops, svgDoc, txt } from './helpers'
import { LOC } from './location'
import type { Activity, Device, Eq, EqOpts, Hood, LcdOpts, Mesh, MeshChan, Meter, PanOpts, Peak, Tuner, View } from './types'

export function panadapterSvg(v: View, o: PanOpts, thin = 1): string {
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
export function shortLabel(p: Peak, dec = 4): string {
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

export function peakName(p: Peak): string {
  if (p.name) return p.name
  return p.kind === 'burst' ? 'short bursts' : 'steady signal'
}

export function viewAlt(v: View): string {
  const named = [...new Set(v.peaks.filter(p => p.name && !p.comb && !p.spur).map(p => p.name as string))].slice(0, 8)
  const head = v.live ? `${v.running === false ? 'Last live view' : 'Live'} spectrum and waterfall` : 'Spectrum and waterfall'
  return `${head} of ${v.label} ${mhz(v.start)}–${mhz(v.stop)} MHz: ${v.peaks.length} signals above the ${v.floor.toFixed(0)} dB noise floor${named.length ? `, including ${named.join(', ')}` : ''}; ${v.nrows ?? v.rows?.length ?? 0} waterfall rows`
}

export const SEG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' }

export function segPolys(x: number, y: number, w: number, h: number, t: number): Record<string, string> {
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
export function digit(ch: string, x: number, y: number, w: number, h: number, lit: string[], ghost: string[]): void {
  const t = Math.max(3, w * 0.19)
  const segs = segPolys(x, y, w, h, t)
  const on = SEG[ch] ?? ''
  for (const [k, pts] of Object.entries(segs)) {
    ghost.push(`<polygon points="${pts}"/>`)
    if (on.includes(k)) lit.push(`<polygon points="${pts}"/>`)
  }
}

export function lcdSvg(t: Tuner, o: LcdOpts): string {
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

export function lcdAlt(t: Tuner, playing: boolean, name: string | null, m: Meter | null): string {
  const f = `${mhz(t.hz / 1e6)} MHz`
  const what = `${f} ${modeName(t.mode)}, step ${STEPS.find(s => s[0] === t.step)?.[1] ?? t.step}, squelch ${t.squelch || 'off'}, gain ${t.gain === 'auto' ? 'auto' : `${t.gain} dB`}`
  const sig = playing && m ? (m.weak ? 'weak signal — try the antenna by a window' : m.squelch === 'closed' ? 'squelch closed' : `signal ${Math.round(m.level * 100)}%`) : ''
  return `Tuner: ${what}${name ? ` (${name})` : ''}${playing ? `, playing${sig ? `, ${sig}` : ''}` : ', not playing'}`
}

// Bass to treble: the Radio palette from magenta through sky, cyan and green to amber.
export const EQ_STOPS = [MAGENTA, SKY, CYAN, TEAL, GREEN, YELLOW, AMBER]

export function rgbOf(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a)
  const y = rgbOf(b)
  return `#${[0, 1, 2].map(i => Math.round((x[i] ?? 0) + ((y[i] ?? 0) - (x[i] ?? 0)) * t).toString(16).padStart(2, '0')).join('')}`
}

export function eqColor(i: number, n: number): string {
  const p = (n <= 1 ? 0 : i / (n - 1)) * (EQ_STOPS.length - 1)
  const k = Math.min(EQ_STOPS.length - 2, Math.floor(p))
  return mix(EQ_STOPS[k] ?? CYAN, EQ_STOPS[k + 1] ?? CYAN, p - k)
}

// The bands, fewer on the phone: neighbours merged by their loudest.
export function eqFold(e: Eq, n: number): { bands: number[]; peaks: number[]; edges: number[] } {
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

export function hzLabel(f: number): string {
  return f >= 1000 ? `${Number((f / 1000).toFixed(f >= 10_000 ? 0 : 1))}k` : String(Math.round(f))
}

// A hi-fi spectrum display: neon LED bars bass to treble with glowing peak caps over a faint
// mirrored reflection, a dB scale, the frequency axis, and a guess at what it is hearing.
export function eqSvg(e: Eq | null, o: EqOpts): string {
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

export function eqAlt(e: Eq | null, playing: boolean, label?: string | null): string {
  if (!playing) return 'Audio spectrum: not playing (press Listen to see the sound)'
  if (!e) return `Audio spectrum of ${label ?? 'the station'}: reading the audio`
  const k = e.bands.reduce((b, v, i, a) => (v > (a[b] ?? 0) ? i : b), 0)
  const at = Math.sqrt((e.edges[k] ?? 0) * (e.edges[k + 1] ?? 0))
  return `Audio spectrum of ${label ?? `${mhz(e.freq)} MHz`}: ${e.bands.length} bands ${hzLabel(e.edges[0] ?? 0)}–${hzLabel(e.edges[e.edges.length - 1] ?? 0)} Hz, loudest around ${hzLabel(at)} Hz, ${e.kind === 'silence' ? 'silent' : `sounds like ${e.kind}`}${e.rms !== null ? `, ${e.rms.toFixed(0)} dBFS` : ''}`
}

// The terminal's EQ: one Raster, a column of eighth blocks per band in its colour, the peak cap a bar above.
export function eqRaster(e: Eq, columns: number): { cells: string; columns: number; rows: number } {
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

export const MAP_LO = 24

export const MAP_HI = 1700

export function activityOf(id: string, act: Record<string, Activity>): Activity | null {
  if (id === 'lora') {
    const a = act.lora
    const b = act.mesh
    if (a && b) return a.at > b.at ? a : b
    return a ?? b ?? null
  }
  return act[id] ?? null
}

export function heatMark(cx: number, cy: number, a: Activity | null, now: number, parts: string[]): void {
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
export function bandTitle(id: string, a: Activity | null, live: boolean): string {
  if (id === '@vhf') return 'VHF close-up 144–163 MHz: 2 m ham, MURS, Marine, Railroad and NOAA weather, drawn larger below'
  if (id === '@uhf') return 'UHF close-up 420–468 MHz: 70 cm ham, 433 MHz gadgets and GMRS / FRS, drawn larger below'
  const b = bandOf(id)
  if (!b) return id
  const heard = a ? `${a.n} signal${a.n === 1 ? '' : 's'} in the last scan (${clockOf(a.at)}), strongest +${Math.round(a.best)} dB` : 'not scanned yet'
  const short = BAND_SHORT[id] ?? b.label
  return `${b.label} ${b.lo}–${b.hi} MHz · ${heard} · use the ${short} button below to ${live ? 'move the live view there' : 'scan it'}`
}

// Hover on the interactive map: the band under the pointer brightens (no script).
export const MAP_STYLE = `<style>.bnd{cursor:default}.bnd:hover .bar{fill-opacity:1;stroke:${BRIGHT};stroke-width:2}.bnd:hover .lbl{fill:${BRIGHT}}</style>`

export function meshSvg(m: Mesh, o: { W: number; compact: boolean; now: number }): string {
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

export function meshAlt(m: Mesh): string {
  const s = (ch: MeshChan) => `${ch.name} ${ch.state === 'unknown' ? 'no data yet' : `${ch.state} (${ch.bursts} bursts, ${ch.perMin} a minute)`}`
  return `Mesh traffic over the last hour: ${s(m.mt)}; ${s(m.mc)}; ${Math.round(m.seconds / 60)} minutes listened`
}

export function hoodSvg(h: Hood, o: { W: number; compact: boolean; now: number; total: number }): string {
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

export function sparkSvg(d: Device, now: number): string | null {
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

export const BARS = '▁▂▃▄▅▆▇█'

// The spectrum (eighth blocks) over the waterfall (▀: two rows a cell) as one Raster.
export function rasterOf(v: View, columns: number): { cells: string; columns: number; rows: number } | null {
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

export function sparkline(vals: number[], width: number, lo?: number, hi?: number): string {
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

export function specLine(v: View, width = 64): string {
  return sparkline(v.avg, width, v.floor, Math.max(v.top, v.floor + 15))
}

export function meterBar(level: number, n = 12): string {
  const k = Math.round(clamp(level) * n)
  return '▮'.repeat(k) + '▯'.repeat(n - k)
}

export function sUnits(level: number): string {
  if (level >= 0.6) return `S9+${Math.round(((level - 0.6) / 0.4) * 40)}`
  return `S${Math.max(0, Math.round((level / 0.6) * 9))}`
}

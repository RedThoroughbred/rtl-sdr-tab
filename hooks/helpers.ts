// Small pure helpers: frequency and mode words, time formats, the SVG text and document pieces, base64 and the waterfall colours. No state, no $.

import { AXIS, BANDS, CYAN, HF_MAX, MONO, YELLOW } from './constants'
import type { Band, Mode, Status, TxtOpts } from './types'

// The heavy pictures, drawn again only when what they show changed (the EQ redraws the tab often):
// one cached string per picture (slot), kept until that picture's inputs change.
export const svgCache = new Map<string, { key: string; svg: string }>()

export function bandOf(id: string): Band | undefined {
  return BANDS.find(b => b.id === id)
}

export function mhz(f: number): string {
  return String(Number(f.toFixed(4)))
}

export function modeName(m?: string | null): string {
  return m === 'wbfm' ? 'wide FM' : m === 'fm' ? 'narrow FM' : m === 'am' ? 'AM' : m === 'usb' ? 'upper sideband' : m === 'lsb' ? 'lower sideband' : m === 'cw' ? 'CW (Morse)' : m ?? ''
}

export function modeChip(m: Mode): string {
  return m === 'wbfm' ? 'WFM' : m === 'fm' ? 'NFM' : m === 'usb' ? 'USB' : m === 'lsb' ? 'LSB' : m === 'cw' ? 'CW' : 'AM'
}

export function ago(t: number, now: number): string {
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
export function memoSvg(slot: string, key: string, draw: () => string): string {
  const hit = svgCache.get(slot)
  if (hit && hit.key === key) return hit.svg
  const svg = draw()
  if (!hit && svgCache.size > 80) svgCache.clear()
  svgCache.set(slot, { key, svg })
  return svg
}

// 0:42, 12:05, 1:02:10
export function dur(sec: number | null | undefined): string {
  const t = Math.max(0, Math.round(sec ?? 0))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const ss = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function sizeOf(b: number | null | undefined): string {
  const v = b ?? 0
  return v >= 1e9 ? `${(v / 1e9).toFixed(2)} GB` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(v / 1e3))} KB`
}

export function clockOf(t: number): string {
  const d = new Date(t)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

// The height an SVG takes at the width the pane gives it (its own width, at most maxW). Given as
// the Svg's height, the box keeps its size while a refreshed picture loads, so the pane never
// shrinks for a moment and the scroll position stays where the person put it.
export function svgHeight(source: string, maxW: number): number | undefined {
  const head = source.slice(0, 800)
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(head)
  const wa = /<svg[^>]*\swidth="([\d.]+)"/.exec(head)
  const w = vb ? Number(vb[1]) : NaN
  const h = vb ? Number(vb[2]) : NaN
  if (!(w > 0 && h > 0)) return undefined
  const drawn = Math.min(wa ? Number(wa[1]) : w, maxW)
  return Math.round((drawn * h) / w)
}

export function clamp(v: number, a = 0, b = 1): number {
  return v < a ? a : v > b ? b : v
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function n1(v: number): string {
  return v.toFixed(1)
}

export function txt(x: number, y: number, s: string, o: TxtOpts = {}): string {
  const at = o.rotate ? ` transform="translate(${n1(x)},${n1(y)}) rotate(-90)" x="0" y="0"` : ` x="${n1(x)}" y="${n1(y)}"`
  return `<text${at}${o.cls ? ` class="${o.cls}"` : ''} fill="${o.fill ?? AXIS}" font-size="${o.size ?? 10}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ''}${o.spacing ? ` letter-spacing="${o.spacing}"` : ''} font-family="${o.font ?? MONO}">${esc(s)}</text>`
}

export function niceStep(span: number, target = 8): number {
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag
  return 10 * mag
}

export function svgDoc(W: number, H: number, body: string, xlink = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg"${xlink ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ''} width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`
}

export function guessMode(f: number): Mode | null {
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

export function defaultSquelch(f: number, mode: Mode): number {
  return mode !== 'fm' || (f >= 162.39 && f <= 162.56) ? 0 : 40
}

export function defaultStep(mode: Mode): number {
  // SSB and CW tune in 1 kHz steps (a voice is a few kHz wide; CW a few hundred Hz).
  return mode === 'wbfm' ? 100_000 : mode === 'am' ? 25_000 : mode === 'usb' || mode === 'lsb' || mode === 'cw' ? 1_000 : 12_500
}

export function fmChannel(f: number): number {
  return Math.round((Math.round((f - 87.9) / 0.2) * 0.2 + 87.9) * 10) / 10
}

export function bandAt(f: number): Band | undefined {
  return BANDS.filter(b => b.id !== 'mesh').find(b => f >= b.lo && f <= b.hi)
}

export function anyJobRunning(s: Status): boolean {
  if (s.listen.running || s.share.running || s.live?.running) return true
  return Object.entries(s.jobs ?? {}).some(([k, j]) => k !== 'gadgets' && j.running)
}

export function poolTo(vals: number[], n: number): number[] {
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

// Turbo (polynomial fit) with its bottom faded to near-black: radio.py's waterfall PNG
// uses the same ramp, so the legend and the terminal's cells match the picture.
export function turbo(t: number): [number, number, number] {
  t = clamp(t)
  const r = 0.13572138 + t * (4.6153926 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))))
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))))
  const b = 0.1066733 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))))
  return [clamp(r), clamp(g), clamp(b)]
}

export function wfRgb(t: number): [number, number, number] {
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

export const PAL: number[] = Array.from({ length: 256 }, (_, i) => {
  const [r, g, b] = wfRgb(i / 255)
  return (r << 16) | (g << 8) | b
})

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

export function rampStops(n = 12): string {
  return Array.from({ length: n + 1 }, (_, i) => `<stop offset="${(i / n).toFixed(3)}" stop-color="${hex(PAL[Math.round((i / n) * 255)] ?? 0)}"/>`).join('')
}

export function heat(best: number): string {
  return best >= 30 ? '#ff6b4a' : best >= 20 ? '#ffb347' : best >= 12 ? YELLOW : best >= 6 ? CYAN : '#4b7bb2'
}

export const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]))

export function b64encode(bytes: Uint8Array): string {
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

export function b64decode(s: string): Uint8Array {
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

// Background work never rejects into the void (a reload or a test ending under it).
export function bg(p: Promise<unknown>): void {
  p.catch(() => undefined)
}

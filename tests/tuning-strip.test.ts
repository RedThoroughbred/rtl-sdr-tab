import { describe, expect, test } from 'claude-code/testing'
import type { ClientKeyEvent, ClientPointerEvent } from 'claude-code'

import TuningStrip, { ON_PALETTE, PALETTE, STRIP_ROWS, snapMhz } from '../hooks/tuning-strip'
import type { StripProps, StripState } from '../hooks/tuning-strip'

// The strip's module function called straight, with fake props and a fake surface: what it draws,
// and what a pointer or a key makes it post.

const FM: StripProps = {
  start: 87.5,
  stop: 108,
  label: 'FM broadcast',
  live: false,
  // A quiet band with three stations standing up out of it.
  pk: Array.from({ length: 205 }, (_, i) => ([16, 66, 151].includes(i) ? 230 : 20)),
  av: Array.from({ length: 205 }, (_, i) => ([16, 66, 151].includes(i) ? 200 : 10)),
  lo: -40,
  hi: 10,
  floor: -36,
  tuned: 94.1,
  mode: 'wbfm',
  step: 0.1,
  playing: null,
  busy: '',
  peaks: [
    { mhz: 89.1, db: 33, name: '89.1 WKCX', tag: 'WKCX', burst: false },
    { mhz: 94.1, db: 31, name: '94.1 WNNF', tag: 'WNNF', burst: false },
    { mhz: 102.7, db: 29, name: '102.7 WEBN', tag: 'WEBN', burst: false },
  ],
  names: [
    [91.7, '91.7 WVXU'],
    [97.3, '97.3 WYGY'],
  ],
  grid: [[87.5, 108, 'wbfm', 0.2, 87.9]],
  cols: 100,
  rev: 3,
}

type Fake = {
  surface: any
  posts: unknown[]
  sets: number
  pointer: (e: ClientPointerEvent) => void
  key: (e: ClientKeyEvent) => void
  draw: (p?: StripProps) => any
}

function fake(columns = 100, rows = STRIP_ROWS): Fake {
  const els = {
    Box: (p: any) => ({ type: 'Box', props: p, children: p.children ?? [] }),
    Text: (p: any) => ({ type: 'Text', props: p, children: p.children ?? [] }),
  }
  const f: Fake = {
    surface: null,
    posts: [],
    sets: 0,
    pointer: () => undefined,
    key: () => undefined,
    draw: () => undefined,
  }
  let props = FM
  const surface: any = {
    elements: els,
    state: undefined as StripState | undefined,
    setState: (s: StripState) => {
      f.sets++
      surface.state = s
    },
    columns,
    rows,
    every: () => () => undefined,
    onPointer: (fn: (e: ClientPointerEvent) => void) => {
      f.pointer = e => {
        fn(e)
        f.draw()
      }
      return () => undefined
    },
    onKey: (fn: (e: ClientKeyEvent) => void) => {
      f.key = e => {
        fn(e)
        f.draw()
      }
      return () => undefined
    },
    post: (d: unknown) => f.posts.push(d),
  }
  f.surface = surface
  f.draw = (p?: StripProps) => {
    if (p) props = p
    return TuningStrip(props, surface)
  }
  return f
}

// The drawn tree as lines of text: a spacer Box is that many spaces.
function lines(tree: any): string[] {
  const flat = (n: any): string => {
    if (typeof n === 'string') return n
    if (!n || typeof n !== 'object') return ''
    if (n.type === 'Box' && typeof n.props?.width === 'number' && !(n.children ?? []).length) return ' '.repeat(n.props.width)
    return (n.children ?? []).flat(9).map(flat).join('')
  }
  return (tree.children ?? []).flat(9).map(flat)
}

const col = (f: number, columns = 100) => Math.floor(((f - FM.start) / (FM.stop - FM.start)) * columns)

describe('the tuning strip, called straight', () => {
  test('draws six rows as wide as the region: names, ticks with ▼ at the tuner, two rows of heat, the axis, the readout', () => {
    for (const columns of [100, 140]) {
      const f = fake(columns)
      const rows = lines(f.draw())
      expect(rows).toHaveLength(STRIP_ROWS)
      for (const r of rows.slice(0, 5)) expect([...r]).toHaveLength(columns)
      expect(rows[0]?.indexOf('WNNF')).toBe(col(94.1, columns) - 1)
      expect(rows[1]?.[col(94.1, columns)]).toBe('▼')
      expect(rows[1]?.[col(102.7, columns)]).toBe('▾')
      expect(rows[2]?.[col(94.1, columns)]).toBe('┃')
      expect(rows[4]).toMatch(/^87\.5 ─+ 97\.75 ─+ 108 MHz$/)
      expect(rows[5]).toMatch(/^▼ 94\.1 MHz WFM · 94\.1 WNNF · Enter ▶ plays · click to tune/)
    }
  })

  test('colours a cell by its level on the waterfall palette, the tuner a heavy bar that reads on any cell', () => {
    const f = fake()
    const tree = f.draw()
    const heat = tree.children.flat(9)[2].children.flat(9)
    const station = heat.find((t: any) => t.type === 'Text' && t.props.color === PALETTE[230])
    expect(station).toBeDefined()
    expect(heat.find((t: any) => t.type === 'Text' && t.props.color === PALETTE[20])).toBeDefined()
    const tuned = heat.find((t: any) => t.children?.[0] === '┃')
    expect(PALETTE).toContain(tuned?.props.backgroundColor)
    expect(tuned?.props.color).toBe(ON_PALETTE[PALETTE.indexOf(tuned?.props.backgroundColor)])
    // White on the dark ends of the ramp (the floor, the dark-red top), near-black on the bright middle.
    expect([ON_PALETTE[0], ON_PALETTE[128], ON_PALETTE[255]]).toEqual(['#ffffff', '#10161a', '#ffffff'])
    expect(lines(tree)[1]?.[col(94.1)]).toBe('▼')
  })

  test('a click posts the frequency under it: a station within a cell and a half wins, else the FM channel grid', () => {
    const f = fake()
    f.draw()
    // One cell right of 94.1's column: still 94.1.
    f.pointer({ type: 'down', x: col(94.1) + 1, y: 2, button: 'left' })
    f.pointer({ type: 'up', x: col(94.1) + 1, y: 2, button: 'left' })
    // Far from any station: the nearest odd tenth.
    f.pointer({ type: 'down', x: 60, y: 3, button: 'left' })
    f.pointer({ type: 'up', x: 60, y: 3, button: 'left' })
    expect(f.posts).toEqual([
      { type: 'tune', mhz: 94.1, by: 'click' },
      { type: 'tune', mhz: 99.9, by: 'click' },
    ])
  })

  test('the edges tune to the first and last channels, never past the band; a release outside posts nothing', () => {
    const f = fake()
    f.draw()
    for (const x of [0, 99]) {
      f.pointer({ type: 'down', x, y: 2, button: 'left' })
      f.pointer({ type: 'up', x, y: 2, button: 'left' })
    }
    // Sub-cell positions (a terminal that reports pixels) at the very edges.
    f.pointer({ type: 'down', x: 0, y: 2, button: 'left', fine: { x: 0, y: 2.5 } })
    f.pointer({ type: 'up', x: 0, y: 2, button: 'left', fine: { x: 0, y: 2.5 } })
    f.pointer({ type: 'down', x: 99, y: 2, button: 'left', fine: { x: 100, y: 2.5 } })
    f.pointer({ type: 'up', x: 99, y: 2, button: 'left', fine: { x: 100, y: 2.5 } })
    expect(f.posts.map((p: any) => p.mhz)).toEqual([87.7, 107.9, 87.5, 107.9])
    // Dragged off the region and let go there: cancelled.
    f.pointer({ type: 'down', x: 40, y: 2, button: 'left' })
    f.pointer({ type: 'move', x: 130, y: 2, button: 'left' })
    f.pointer({ type: 'up', x: 130, y: 2, button: 'left' })
    // A right button does nothing.
    f.pointer({ type: 'down', x: 40, y: 2, button: 'right' })
    f.pointer({ type: 'up', x: 40, y: 2, button: 'right' })
    expect(f.posts).toHaveLength(4)
    expect(snapMhz(FM, 100, 87.5)).toBe(87.5)
    expect(snapMhz(FM, 100, 108)).toBe(107.9)
  })

  test('pointing reads out the station under the pointer, or the level and the nearest name; leaving clears it', () => {
    const f = fake()
    f.draw()
    f.pointer({ type: 'move', x: col(94.1), y: 2 })
    expect(lines(f.draw())[5]).toBe('94.1 MHz · WFM · +31 dB · 94.1 WNNF (steady) · click to tune')
    f.pointer({ type: 'move', x: col(97.3), y: 2 })
    expect(lines(f.draw())[5]).toMatch(/^97\.3 MHz · WFM · noise floor · 97\.3 WYGY · click to tune$/)
    f.pointer({ type: 'move', x: col(106), y: 2 })
    expect(lines(f.draw())[5]).toMatch(/^10[56]\.\d MHz · WFM · noise floor · FM broadcast · click to tune$/)
    // Held down and moved: the readout scrubs, saying what letting go will do.
    f.pointer({ type: 'down', x: col(102.7), y: 2, button: 'left' })
    expect(lines(f.draw())[5]).toBe('release to tune 102.7 MHz · WFM · +29 dB · 102.7 WEBN (steady)')
    f.pointer({ type: 'up', x: 140, y: 2, button: 'left' })
    f.pointer({ type: 'move', x: col(94.1), y: 2 })
    f.pointer({ type: 'leave', x: col(94.1), y: 2 })
    expect(lines(f.draw())[5]).toMatch(/^▼ 94\.1 MHz WFM/)
    // A move within the same cell sets nothing.
    const before = f.sets
    f.pointer({ type: 'move', x: 10, y: 2 })
    f.pointer({ type: 'move', x: 10, y: 3 })
    expect(f.sets).toBe(before + 1)
  })

  test('keys after a click: ← → by the step, Shift+← → to the next station, Enter plays; quick presses add up', () => {
    const f = fake()
    f.draw()
    f.key({ key: 'right' })
    f.key({ key: 'right' })
    f.key({ key: 'left', shift: true })
    f.key({ key: 'right', shift: true })
    f.key({ key: 'right', shift: true })
    f.key({ key: 'return' })
    expect(f.posts).toEqual([
      { type: 'tune', mhz: 94.2, by: 'key' },
      { type: 'tune', mhz: 94.3, by: 'key' },
      { type: 'tune', mhz: 94.1, by: 'peak' },
      { type: 'tune', mhz: 102.7, by: 'peak' },
      // No station above 102.7: nothing.
      { type: 'listen', mhz: 102.7 },
    ])
    // The hooks module's answer (a new rev) settles it: the props' tuner wins again.
    f.draw({ ...FM, tuned: 102.7, rev: 4 })
    expect(lines(f.draw())[5]).toMatch(/^▼ 102\.7 MHz WFM · 102\.7 WEBN/)
    f.draw({ ...FM, tuned: 102.7, rev: 5, playing: 102.7 })
    expect(lines(f.draw())[5]).toMatch(/^▼ 102\.7 MHz WFM · 102\.7 WEBN · ▶ playing, Enter stops/)
  })

  test('drawing again with nothing new sets no state (no render loop); bad props draw a line, not a fault', () => {
    const f = fake()
    for (let i = 0; i < 5; i++) f.draw()
    expect(f.sets).toBe(0)
    const bad = TuningStrip({ start: 'x' } as unknown as StripProps, f.surface)
    expect(JSON.stringify(bad)).toContain('No band to show yet')
    // Before the region is laid out it draws at the hooks module's guess.
    const g = fake(0, 0)
    expect([...(lines(g.draw())[4] ?? '')]).toHaveLength(100)
  })
})

// Fixed tables of the Radio tab: timings, the instrument palette, bands, known stations, presets, steps and the command help. No $.

import { LOC } from './location'
import type { Band, Cat, Mode, Preset, Repeater, Section, StationTab } from './types'

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
export const PANE = 'radio'

export const TITLE = 'Radio'

// The plane radar on its own: a second tab with nothing to scroll past, which can also be popped out.
export const PLANES_PANE = 'radio-planes'

export const PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

export const TICK_MS = 1000

export const STATUS_MS = 30_000

export const LIST_MS = 5000

export const FRAME_MS = 2000

export const METER_MS = 1500

export const RETUNE_MS = 700

// The EQ display reads the tap's eq.json straight from the state folder (no process), only
// while Listen plays and the tab is drawn: ~2.5 times a second, once a second on the phone.
export const EQ_TICK_MS = 200

export const EQ_MS = 400

export const EQ_MS_PHONE = 1000

export const HANDOFF_MS = 1500

export const HANDOFF_MAX_MS = 120_000

export const RECS_MS = 4000

// The peak list under the spectrum: this many strongest until "show all".
export const PEAKS_SHOWN = 10

export const MONO = 'Menlo,monospace'

export const SANS = 'Helvetica,Arial,sans-serif'

// One dark instrument look for every chart (the VNA tab's palette).
export const BG = '#10161a'

export const PLOT = '#0c1215'

export const GRID = '#243238'

export const GRID2 = '#1a252a'

export const AXIS = '#7f9199'

export const LABEL = '#c9d4da'

export const BRIGHT = '#e6edf0'

export const CYAN = '#4fd1e0'

export const AMBER = '#f0c050'

export const YELLOW = '#ffd84a'

export const GREEN = '#7ad67a'

export const MAGENTA = '#e07be0'

export const ORANGE = '#f0a050'

export const RED = '#ff6b6b'

export const SKY = '#7fb8ff'

export const TEAL = '#5fd3b8'

export const MARK = '#6fae8c'

export const LCD = '#62f0dc'

// The tuner's mode row (0.4.0 adds SSB and CW: rtl_fm's usb / lsb, CW as USB tuned 700 Hz low).
export const MODES_ROW: Mode[] = ['wbfm', 'fm', 'am', 'usb', 'lsb', 'cw']

export const HF_MAX = 28.8

export const SIGID_WIKI = 'https://www.sigidwiki.com/wiki/Signal_Identification_Guide'

export const SECTIONS: Section[] = []

export const wxFreqText = (): string => LOC.wxFreq.toFixed(3)

export const noaaShort = (): string => (LOC.wxStation ? `NOAA ${LOC.wxStation}` : 'NOAA weather radio')

export const noaaName = (): string => (LOC.wxStation ? ['NOAA', LOC.wxStation, LOC.wxCity].filter(Boolean).join(' ') : 'NOAA weather radio')

export const repShort = (r: Repeater): string => r.short || r.name

export const mhz3 = (m: number): string => m.toFixed(3)

export const CAT_COLOR: Record<Cat, string> = { broadcast: CYAN, air: SKY, ham: GREEN, public: ORANGE, weather: TEAL, iot: MAGENTA }

export const BANDS: Band[] = [
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
export const BAND_SHORT: Record<string, string> = { fm: 'FM', noaa: 'NOAA', air: 'Aircraft', adsb: 'ADS-B', '2m': '2 m', '70cm': '70 cm', murs: 'MURS', marine: 'Marine', rail: 'Railroad', gmrs: 'GMRS/FRS', '433': '433 MHz', lora: 'LoRa 915', mesh: 'Mesh watch' }

export const BAND_GROUPS: [string, string[]][] = [
  ['Broadcast', ['fm', 'noaa']],
  ['Air', ['air', 'adsb']],
  ['Ham', ['2m', '70cm']],
  ['Two-way', ['murs', 'marine', 'rail', 'gmrs']],
  ['Gadgets', ['433', 'lora', 'mesh']],
]

export const ALIAS: Record<string, string> = {
  aircraft: 'air', airband: 'air', weather: 'noaa', wx: 'noaa', meshtastic: 'lora', '915': 'lora', meshcore: 'mesh', ism: '433', '70': '70cm', '2': '2m',
  broadcast: 'fm', boats: 'marine', river: 'marine', railroad: 'rail', trains: 'rail', frs: 'gmrs', '1090': 'adsb', 'ads-b': 'adsb',
}

export const KNOWN_REST: [number, number, string][] = [
  [146.52, 0.004, '2 m calling (simplex)'],
  [446.0, 0.006, '70 cm calling (simplex)'],
  [121.5, 0.012, 'aircraft emergency (guard)'],
  [156.8, 0.006, 'Marine ch 16 (distress / calling)'],
  [156.65, 0.006, 'Marine ch 13 (towboats)'],
  [151.94, 0.004, 'MURS 3'],
  [154.57, 0.004, 'MURS 4 (blue dot)'],
  [154.6, 0.004, 'MURS 5 (green dot)'],
]

export const KNOWN: [number, number, string][] = []

export function buildKnown(): void {
  KNOWN.length = 0
  KNOWN.push([LOC.wxFreq, 0.006, noaaName()], ...LOC.repeaters.map(r => [r.mhz, 0.004, r.name] as [number, number, string]), ...KNOWN_REST)
}
buildKnown()

export const FM_NAMES: Record<string, string> = { '89.1': 'WKCX', '90.9': 'WGUC', '91.7': 'WVXU', '92.5': 'WOFX', '94.1': 'WNNF', '97.3': 'WYGY', '98.5': 'WRRM', '101.1': 'WIZF', '101.9': 'WKRQ', '102.7': 'WEBN', '103.5': 'WGRR', '105.1': 'WUBE', '106.7': 'WNKR', '107.1': 'WKFS' }

export const STEPS: [number, string][] = [
  [1000, '1 k'],
  [5000, '5 k'],
  [12_500, '12.5 k'],
  [25_000, '25 k'],
  [100_000, '100 k'],
  [1_000_000, '1 M'],
]

export const GAINS = [0, 7.7, 12.5, 16.6, 20.7, 25.4, 29.7, 33.8, 37.2, 40.2, 43.4, 44.5, 48, 49.6]

export const STATION_TABS: [StationTab, string][] = [
  ['fav', 'Favourites'],
  ['fm', 'FM'],
  ['wx', 'Weather'],
  ['air', 'Air'],
  ['ham', 'Ham'],
  ['water', 'Marine/Rail'],
  ['hf', 'HF'],
]

export const NOAA: Preset = { mhz: 162.55, label: '162.550 NOAA', mode: 'fm' }

export const repPreset = (r: Repeater): Preset => ({ mhz: r.mhz, label: `${mhz3(r.mhz)} ${repShort(r)}`, mode: 'fm' })

export const FIXED: Record<Exclude<StationTab, 'fav' | 'fm'>, Preset[]> = {
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

export const FM_SHOWN = 8

export const COMMANDS_LINE = '/sdr scan <band> · scan list|on|off|add <MHz> (the Scanner) · live on|off [band] · tune <MHz> · listen <MHz> [wbfm|fm|am|usb|lsb|cw] · stop (everything) · rec on|off · log on|off · record <MHz> [mode] <sec> · recordings · snapshot <MHz> [secs] · snapshots · settings · set ppm <N> · biast on|off · hf test · calibrate · bands · mesh · gadgets [on|off] · share on|off · planes [on|off] · radar · aprs [on|off] · alerts [on|off|test] · web [on|off|sync]'

export const ARG_HINT = '[scan <band> | scan list|on|off|add <MHz> | live on|off | tune <MHz> | listen <MHz> [mode] | stop | rec on|off | log on|off | record <MHz> [mode] <sec> | recordings | snapshot <MHz> [secs] | snapshots | settings | set ppm <N> | biast on|off | hf test | calibrate | gadgets on|off | share on|off | planes [on|off] | radar | aprs [on|off] | alerts [on|off|test] | web [on|off|sync]]'

// The rows of the tuner and the band buttons line up on this label width (cells).
export const ROW_LABEL = 10

export const PLANE_RANGES = ['10', '25', '50', 'auto']

export const TAILSCALE_SERVE = 'tailscale serve --bg --https=8073 http://127.0.0.1:8073'

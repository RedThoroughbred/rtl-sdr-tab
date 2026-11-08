// Six tools Claude can call beside the Radio tab (0.6.0). The tab owns the state and the queue; this
// file owns what Claude sees: the names, the schemas, the descriptions, the argument parsing and what
// is refused. The calls themselves are answered in register.tsx (the tab's state lives there), so a
// tool call and a click on the tab go through the very same code, queue and one-program-at-a-time rule.

const RECEIVE_ONLY = 'It only ever receives: nothing here can transmit.'

const TAKES_THE_V4 =
  'The RTL-SDR V4 does one thing at a time, so this takes the V4 and stops whatever was running (the audio, the live view, Planes, APRS, the alert watch, the gadget listener, a scan), exactly as the tab does; the reply says what it stopped. If the person is listening to something, tell them first.'

export const STATUS_DESCRIPTION = `Reads what the Radio tab (/sdr) says right now. Use it first for "what is the radio doing", "what am I hearing", "is the V4 free" and before any action. Returns plain lines: the place the tab is set for, whether the RTL-SDR V4 is plugged in and what holds it (the tuner, a scan, Planes, APRS, the alert watch, Web SDR, another program), the tuner (frequency, mode, playing or not, signal), the gadget listener, mesh traffic, the last scan (its strongest signals), the scanner, recordings, Planes / APRS / weather-alert state, Web SDR state, and the band ids sdr_scan takes with what the last scan of each band heard. It only reads: it never starts, stops or tunes anything. ${RECEIVE_ONLY}`

export const PLANES_DESCRIPTION = `Lists the aircraft from the last ADS-B data the Planes job wrote: flight or registration (or the hex address), altitude, speed, distance and bearing from the station, how long ago each was heard, and any emergency squawk. Use it for "what planes are overhead", "what is that low plane" and "how far is the farthest". It reads the saved data only: it does NOT start Planes and never touches the V4. If Planes is off it says how old the data is and that sdr_job (planes on) or the tab starts it. Optional { limit } caps the list (default 15, closest first). ${RECEIVE_ONLY}`

export const GADGETS_DESCRIPTION = `Lists the 433 MHz gadgets the tab's rtl_433 listener has heard: weather stations, temperature and soil sensors, doorbells, tire-pressure sensors from passing cars. Each line has the model, channel, what it is, its latest reading, how long ago, how many times heard, and low-battery warnings, plus the neighbourhood summary (heard today, in the last hour). Sensor IDs are never included (a tire sensor's ID can identify a car); keep it that way and do not try to recover them. It reads the saved list only and never touches the V4; if the listener is off it says so (sdr_job gadgets on starts it). ${RECEIVE_ONLY}`

export const SCAN_DESCRIPTION = `Scans one band for about 10 seconds with the V4 and lists the signals found (frequency, how far above the noise, steady or bursts, and a name where the tab knows one), the same as pressing that band's button in the tab. Pass the band id: fm, noaa, air, adsb, 2m, 70cm, murs, marine, rail, gmrs, 433, lora (Meshtastic / LoRa 915) or mesh (Meshtastic and MeshCore channels). ${TAKES_THE_V4} Custom ranges stay in the tab (/sdr scan custom). ${RECEIVE_ONLY}`

export const TUNE_DESCRIPTION = `Listens to a frequency through the Mac's speakers, or stops listening. Give { mhz, mode } (mode: wbfm for FM broadcast, fm for narrow FM like NOAA, marine, MURS, GMRS and repeaters, am for airband, usb, lsb or cw for HF; if you leave the mode out the tab guesses it from the band) or { station } (a name the tab knows, such as a call sign like WEBN, "NOAA", "SKYWARN", "marine 16", "WWV 10"), or { stop: true } to stop the audio. For a weak signal the reply says so and gives the tab's antenna tip. ${TAKES_THE_V4} Frequencies from 0.1 to 1766 MHz; below 28.8 MHz is HF through the V4's upconverter, which needs a long-wire antenna. Receive only: never try to follow encrypted or private traffic, and do not repeat what private conversations say. ${RECEIVE_ONLY}`

export const JOB_DESCRIPTION = `Turns one of the tab's background jobs on or off: planes (ADS-B on 1090 MHz), aprs (ham position packets on 144.390 MHz), alerts (the NOAA weather-alert watch on the weather-radio frequency) or gadgets (the 433 MHz rtl_433 sensor listener). Starting one takes the V4 and stops whatever was running (the audio, the live view, another job, a scan), exactly as the tab does; the reply says what it stopped, and if the person is listening to something, tell them first. Turning one off just stops it. It will NOT start Web SDR (it starts Docker), share the V4 to a phone (it opens a network port with no password), switch the bias-tee on (it can damage gear with a plain antenna), change PPM or other settings, run the HF test or delete recordings: those stay in the tab, and if asked it says to do them there. Do not try to work around that. ${RECEIVE_ONLY}`

// The band ids the tab's band buttons use (BAND_GROUPS in register.tsx).
export const BAND_IDS = ['fm', 'noaa', 'air', 'adsb', '2m', '70cm', 'murs', 'marine', 'rail', 'gmrs', '433', 'lora', 'mesh'] as const
export const MODES = ['wbfm', 'fm', 'am', 'usb', 'lsb', 'cw'] as const
export const JOBS = ['planes', 'aprs', 'alerts', 'gadgets'] as const

const BAND_ALIAS: Record<string, string> = {
  aircraft: 'air', airband: 'air', weather: 'noaa', wx: 'noaa', meshtastic: 'lora', '915': 'lora', meshcore: 'mesh', ism: '433', '70': '70cm', '2': '2m',
  broadcast: 'fm', boats: 'marine', river: 'marine', railroad: 'rail', trains: 'rail', frs: 'gmrs', '1090': 'adsb', 'ads-b': 'adsb', '2 m': '2m', '70 cm': '70cm',
}

const clean = (v: unknown, n = 60): string =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n)

// What stays in the tab, by the word a caller might use for it.
const TAB_ONLY: [RegExp, string][] = [
  [/^(web|websdr|web sdr|webrx|openwebrx|docker)\b/, 'Web SDR starts a Docker container, so it stays in the tab: open /sdr and use the Web SDR section (or /sdr web on) yourself.'],
  [/^(share|rtl_tcp|rtltcp|phone|tcp)\b/, 'Sharing the V4 to a phone opens a network port with no password, so it stays in the tab: use /sdr share on there if you want it.'],
  [/^(biast|bias|bias-tee|biastee|bias tee|bias_t)\b/, 'The bias-tee puts DC on the antenna port and can damage gear with a plain antenna, so it stays in the tab (Radio settings): switch it on there only for an amplifier or active antenna.'],
  [/^(ppm|settings|setting|set|filter|gain)\b/, 'PPM and the other settings stay in the tab: open /sdr settings (Radio settings) and change them there.'],
  [/^(hf|hf test|hftest)\b/, 'The HF test stays in the tab: Radio settings, Test HF.'],
  [/^(delete|remove|trash|rm|erase|recordings?|rec|log)\b/, 'Recordings (making them and deleting them) stay in the tab: open /sdr, Recordings.'],
  [/^(scanner|scan list|live)\b/, 'The Scanner and the live view stay in the tab: /sdr scan on, /sdr live on.'],
]

export function tabOnly(word: string): string | null {
  const w = word.trim().toLowerCase()
  for (const [re, say] of TAB_ONLY) if (re.test(w)) return say
  return null
}

export type ScanParse = { ok: true; band: string } | { ok: false; say: string }
export function parseScan(input: any): ScanParse {
  const raw = clean(input?.band).toLowerCase()
  if (!raw) return { ok: false, say: `sdr_scan needs a band: ${BAND_IDS.join(', ')}.` }
  if (/^custom/.test(raw)) return { ok: false, say: 'Custom ranges stay in the tab: /sdr scan custom <start MHz> <stop MHz>.' }
  const refusal = tabOnly(raw)
  if (refusal) return { ok: false, say: refusal }
  const band = BAND_ALIAS[raw] ?? raw
  if (!(BAND_IDS as readonly string[]).includes(band)) return { ok: false, say: `"${raw}" is not a band. Bands: ${BAND_IDS.join(', ')}.` }
  return { ok: true, band }
}

export type TuneParse =
  | { ok: true; kind: 'stop' }
  | { ok: true; kind: 'freq'; mhz: number; mode: string | null }
  | { ok: true; kind: 'station'; name: string; mode: string | null }
  | { ok: false; say: string }
export function parseTune(input: any): TuneParse {
  if (input?.stop === true || String(input?.stop ?? '').toLowerCase() === 'true') return { ok: true, kind: 'stop' }
  const modeRaw = clean(input?.mode, 12).toLowerCase()
  const modeFix: Record<string, string> = { wfm: 'wbfm', nfm: 'fm', ssb: 'usb' }
  const mode = modeRaw ? modeFix[modeRaw] ?? modeRaw : null
  if (mode && !(MODES as readonly string[]).includes(mode)) return { ok: false, say: `Mode "${modeRaw}" is not one the tuner has. Modes: ${MODES.join(', ')} (or leave it out and the tab guesses from the band).` }
  const hasMhz = input?.mhz !== undefined && input?.mhz !== null && clean(input.mhz) !== ''
  if (hasMhz) {
    const text = clean(input.mhz, 24).toLowerCase()
    const num = Number(text.replace(/\s*(mhz|khz)$/, ''))
    const f = /khz$/.test(text) ? num / 1000 : num
    if (!Number.isFinite(f) || f < 0.1 || f > 1766) return { ok: false, say: 'mhz must be a frequency from 0.1 to 1766 MHz (the V4 tunes 24 MHz to 1.766 GHz, and below 28.8 MHz through its HF upconverter).' }
    return { ok: true, kind: 'freq', mhz: f, mode }
  }
  const name = clean(input?.station, 60)
  if (name) return { ok: true, kind: 'station', name, mode }
  return { ok: false, say: 'sdr_tune needs { mhz, mode }, or { station } (a name like WEBN or NOAA), or { stop: true }.' }
}

export type JobParse = { ok: true; job: (typeof JOBS)[number]; want: boolean } | { ok: false; say: string }
export function parseJob(input: any): JobParse {
  const job = clean(input?.job).toLowerCase()
  const refusal = job ? tabOnly(job) : null
  if (refusal) return { ok: false, say: refusal }
  const alias: Record<string, (typeof JOBS)[number]> = { plane: 'planes', adsb: 'planes', 'ads-b': 'planes', radar: 'planes', alert: 'alerts', same: 'alerts', weather: 'alerts', gadget: 'gadgets', sensors: 'gadgets', '433': 'gadgets', rtl_433: 'gadgets' }
  const name = (alias[job] ?? job) as (typeof JOBS)[number]
  if (!(JOBS as readonly string[]).includes(name)) return { ok: false, say: `sdr_job can switch planes, aprs, alerts or gadgets. "${job || '(nothing)'}" is not one of them; if it is something else the tab does (Web SDR, sharing to a phone, the bias-tee, settings, recordings), do it in the tab: /sdr.` }
  const s = clean(input?.state, 8).toLowerCase()
  const want = input?.state === true || s === 'on' || s === 'start' || s === 'true' ? true : input?.state === false || s === 'off' || s === 'stop' || s === 'false' ? false : null
  if (want === null) return { ok: false, say: 'sdr_job needs state "on" or "off".' }
  return { ok: true, job: name, want }
}

export function parsePlanes(input: any): number {
  const n = Number(input?.limit)
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.round(n), 40) : 15
}

export async function registerTools($: any): Promise<void> {
  await $.tool.register({
    name: 'sdr_status',
    description: STATUS_DESCRIPTION,
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'sdr_planes',
    description: PLANES_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many aircraft to list, closest first (1 to 40, default 15).' } },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'sdr_gadgets',
    description: GADGETS_DESCRIPTION,
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'sdr_scan',
    description: SCAN_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: { band: { type: 'string', enum: [...BAND_IDS], description: 'The band id, as the tab\'s band buttons use it.' } },
      required: ['band'],
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'sdr_tune',
    description: TUNE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        mhz: { type: 'number', description: 'Frequency in MHz (for example 94.1, 162.55, 121.5, 146.52).' },
        mode: { type: 'string', enum: [...MODES], description: 'wbfm (FM broadcast), fm (narrow FM), am (airband), usb, lsb or cw. Optional: the tab guesses from the frequency.' },
        station: { type: 'string', description: 'Instead of mhz: a station the tab knows, such as a call sign (WEBN) or "NOAA", "SKYWARN", "marine 16", "WWV 10".' },
        stop: { type: 'boolean', description: 'true: stop the audio.' },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'sdr_job',
    description: JOB_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        job: { type: 'string', enum: [...JOBS], description: 'planes (ADS-B), aprs, alerts (NOAA weather-alert watch) or gadgets (433 MHz sensors).' },
        state: { type: 'string', enum: ['on', 'off'] },
      },
      required: ['job', 'state'],
    },
    isDeferred: false,
  })
}

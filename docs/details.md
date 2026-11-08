# rtl-sdr-tab: the details

Everything the Radio tab does, section by section, with every command and file. The [README](../README.md) has the pictures and the install line.


A **Radio** tab that turns an **RTL-SDR Blog V4** plugged into the Mac into an instrument for the radio world around you. Out of the box that is Walton, KY (Cincinnati, next to CVG); a small file moves it ([Your location](#your-location)). It has:

- a live scrolling waterfall under a spectrum, with a **tuning strip** under it: point at a signal to read it, click to tune there (desktop and terminal);
- a receiver-style tuner with an S-meter, and under it an EQ display of the sound itself;
- **● Rec** (record what plays) and **Log** (one clip per transmission: the scanner that remembers), with a **Recordings** list to play them back;
- a 24 MHz – 1.7 GHz band map showing what each band's last scan heard;
- a Meshtastic / MeshCore traffic meter;
- the gadgets `rtl_433` hears nearby, with sparklines of their readings;
- **Planes**: a radar of the aircraft around you (Walton by default) from their ADS-B broadcasts on 1090 MHz;
- **APRS**: ham stations' positions, weather and messages on 144.390 MHz, on a map;
- **Weather alerts**: the coded NOAA alerts (SAME) from KIH42 on 162.550, decoded;
- **Web SDR**: OpenWebRX+ in Docker, a full waterfall in any browser, the phone included, in the tab's own "Wildcat RF" look, with **Send to Radio tab** (hand what it is tuned to back to the Mac), the tab's bookmarks, and background APRS / 433 MHz decoding while nobody listens.

0.4.0, the "beat SDR++" pack, adds:

- a **Scanner**: favourite channels cycled with squelch; it stops and plays when one opens, resumes after a few seconds of quiet, with lock-out, skip, hold and a priority channel, and its hits feed the transmission logger;
- **SSB and CW** on the tuner (USB, LSB, CW as USB tuned 700 Hz low) and an **HF** station tab through the V4's built-in upconverter (WWV, CHU, the shortwave broadcast bands, 80/40/20 m, weather fax, NAVTEX, UVB-76), lit once HF is confirmed on air;
- **IQ snapshots**: 10–60 s of raw I/Q with `rtl_sdr` to `~/Radio/IQ`, a waterfall replayed from the file, and `rtl_433` run again over a 433.92 snapshot;
- a **Radio settings** panel: PPM with a calibrate-from-NOAA helper, the bias-tee, the filter width per mode, and the HF status and test;
- Web SDR: **gapless FM windows** (0.3.x left 103.0–105.6 MHz unreachable, so 103.5 WGRR could not be tuned) and **HF profiles** for public modes (WWV, 40/20 m FT8 and WSPR, SSTV, weather fax, NAVTEX, the broadcast bands).

It can play a station through the Mac's audio output and share the V4 with an SDR app on the phone. It only receives; nothing here transmits.

It needs the Homebrew rtl-sdr tools: `brew install librtlsdr rtl_433` (for `rtl_power`, `rtl_fm`, `rtl_tcp`, `rtl_adsb` and `rtl_433`), plus `sox` or `ffmpeg` for audio. Web SDR also needs Docker Desktop.

## Your location

Walton, KY is the built-in example: the plane radar's centre and CVG's runways, the Cincinnati FM stations, the local repeaters, NOAA KIH42 and the county codes for weather alerts, the APRS map's place names and the Ohio River all come from it. To move the tab, make `~/Library/Application Support/radio/location.json` (the same folder as the rest of the state; `RADIO_DIR` moves it). No file means Walton, exactly as before.

A file only has to hold what you want to change: every key you leave out keeps its Walton value, except the hand-drawn shapes below. Use a town centre, not a home address. Here is a complete one (Springfield, IL, with made-up call signs and a made-up airport layout) showing every key:

```json
{
  "name": "Springfield, IL",
  "short": "Springfield",
  "lat": 39.799,
  "lon": -89.644,
  "airports": [
    {"id": "SPI", "name": "Abraham Lincoln Capital", "lat": 39.8441, "lon": -89.6779, "elevFt": 598,
     "runways": [["4/22", 0.1, 0.0, 40, 1.4]]}
  ],
  "places": [["Chatham", 39.677, -89.7027, 0, 25]],
  "radar_places": [["RIVERTON", 39.835, -89.54]],
  "river": {"name": "Sangamon River", "radar": [[39.9, -89.9], [39.85, -89.7]], "map": [[39.9, -89.9], [39.85, -89.7]]},
  "fm": {"88.5": "WXYZ Springfield", "99.1": "WABC"},
  "weather": {
    "station": "KXYZ99", "city": "Springfield", "freq": 162.475,
    "home": "17167", "local": ["17167", "17129"],
    "counties": {"17167": "Sangamon", "17129": "Menard", "17001": "Adams"}
  },
  "repeaters": [
    {"mhz": 145.23, "name": "Springfield ARC repeater", "short": "SARC", "mark": true, "wx": true}
  ],
  "scan": [[162.475, "fm", "NOAA KXYZ99"], [145.23, "fm", "SARC"], [156.8, "fm", "Marine ch 16"]]
}
```

What each key does:

- `name`: the place as the tab writes it (titles, the radar caption, picture descriptions). The receiver is called "name (town centre)".
- `short`: the word on the map centre ("Springfield", and "SPRINGFIELD" on the radar). Taken from `name` up to the comma when left out.
- `lat`, `lon`: the receiver's reference point, in degrees. Planes are measured from it and the radar and APRS map are centred on it.
- `airports`: drawn on the radar with schematic runways. Each runway is `[designator, east nm, north nm, true heading of the higher end, length nm]` from the airport's point. `[]` for none.
- `places`: the APRS map's place names, `[name, lat, lon, smallest map radius mi, largest map radius mi]`. The first three are labelled first.
- `radar_places`: city names on the plane radar, `[name, lat, lon]`.
- `river`: a faint river behind both pictures: its `name` and coarse `[lat, lon]` points west to east for the `radar` and the APRS `map`. It also names the river in the Marine help.
- `fm`: FM broadcast stations, frequency (one decimal) to name. They name the peaks, fill the tuner's FM list before a scan and become Web SDR bookmarks.
- `weather`: your NOAA Weather Radio `station` and `city`, its `freq` (162.400 to 162.550), and the SAME alert codes: `counties` maps a 5-digit state + county code to a name, `local` lists the ones that count as yours (shown first) and `home` is your own county (tagged with `short`).
- `repeaters`: local repeaters, each with `mhz`, `name` and an optional chart label `short`; `mark` also marks it on the 2 m scan and `wx` also lists it under Weather.
- `scan`: the Scanner's starting favourites, `[MHz, mode, name]`. Only used the first time; your own `scan add` list wins afterwards.

When you move `lat` or `lon`, the shapes that only fit Walton (`airports`, `places`, `radar_places`, `river`) are dropped unless the file gives its own, so Walton's airport and river don't float in the wrong place. The lists (`fm`, `weather`, `repeaters`, `scan`) are not geographic, so they stay Walton's until you replace them. The Web SDR receiver name and position (`receiver_location`, `receiver_gps`) follow the file too, unless you already changed them in Web SDR's own settings. Web SDR's FM windows and bookmark seeds, and the ground height in its settings, are still the Walton ones.

A file that is not valid JSON, or has a value that cannot be used (a latitude of 999, an unknown key, a county code that is not 5 digits), is never rewritten or deleted. The tab says so in a toast at start, `radio.py location` prints the same line and the scripts print it on stderr, and everything runs as Walton until you fix it. Check it any time with `python3 scripts/radio.py location` (it only reads files; it does not touch the V4).

## What the tab shows

Every chart uses the same dark instrument look as the VNA tab, and each section has a short line saying what you're looking at. On the phone the charts are narrower and stack; every control is a button, so nothing needs a text field.

### Header, Start here and "On the V4 now"

The top line says whether the V4 is connected, busy (with the program and pid that holds it, usually SDR++) or not found. This is read from the USB tree without opening the device.

**Start here** is a card of seven things to try, each one button that does it: hear the weather radio (162.550 NFM, on the Mac's speakers or AirPods), play an FM station (the strongest from the last FM scan, else 94.1), watch the FM band live, see planes overhead, open Web SDR in a browser (the link shows up once it runs), check gadgets nearby, and record what you hear (● Rec on what plays, or with nothing playing a muted 30 s recording of the weather radio). **Got it** folds it into a one-line "Start here ▸" (remembered).

**On the V4 now** names whatever holds the V4 by what it is, e.g. "Planes · ADS-B on 1090 MHz · since 9:04 pm" or "Web SDR · OpenWebRX+ on :8073", with **■ Stop all**. While a button's press runs, **Doing now** says what it is doing in plain words and about how long it takes, e.g. "Starting Planes: stopping Web SDR first (about 6 s)"; a press waiting behind it shows as **Next** ("Queued: Tuning 94.1 MHz, runs next"). Under them, **Resume** buttons bring back what the last start stopped (Planes, APRS, audio, sharing…).

Every button shows its press the moment it is pressed: "Starting Planes…" (or "Tuning 94.1…", "Scanning…") while it runs, dim "Queued: …" while it waits for the one before it. Nothing is dropped any more (0.3.3 ignored a press while another ran, so it took two or three clicks): see [Presses and polls](#presses-and-polls) below.

### Tuner

A receiver's LCD: the frequency in glowing 7-segment digits (MHz . kHz . 10 Hz, with unlit "8"s as ghosts). Around it:

- annunciators for RX, the mode (WFM / NFM / AM), the step, the squelch and the gain;
- the station's name and band;
- an S-meter (S1–S9 green, +20 amber, +40 red, with a peak tick).

Under it, one row per kind of control, each with a label so the rows line up:

| Row | What it does |
|---|---|
| **Tune: ◀◀ ▼ ▲ ▶▶ · ▶ Listen / ■ Stop** | Move by the step, or by 10 steps; start or stop the audio |
| **Record: ● Rec / ■ Rec · ◎ Log / ■ Log** | Record what plays; save one clip per transmission. The line beside them counts: "● REC 1:12 · 420 KB", "Log: 7 transmissions since 10:42 pm" |
| **Mode: WFM / NFM / AM / USB / LSB / CW** | Pick the mode (two rows of three on the phone). USB and LSB are `rtl_fm`'s own sideband demodulators; CW is USB tuned 700 Hz low, so a Morse carrier beats at 700 Hz. SSB and CW default to a 1 kHz step and no squelch |
| **Step** | 1 k, 5 k, 12.5 k, 25 k, 100 k, 1 M |
| **Squelch − / + · Gain auto / − / +** | Squelch in steps of 10 (`off` is 0); automatic gain or the R828D's steps (two rows on the phone) |
| **Stations** | Tabs: Favourites · FM · Weather · Air · Ham · Marine/Rail · HF (remembered), then that tab's stations in tidy rows |

- **Favourites:** what you listened to, newest first, plus NOAA 162.550.
- **FM:** strongest first from the last FM scan (8, then "more…"); the known Cincinnati stations before any scan.
- **Weather:** NOAA KIH42 162.550 and the SKYWARN repeater. **Air:** what the last Aircraft scan heard, and 121.5 guard. **Ham:** the 2 m / 70 cm repeaters and calling frequencies. **Marine/Rail:** Ohio River channels 16, 13, 22A, and what the last Railroad scan heard.
- **HF** (0.4.0): WWV 2.5 / 5 / 10 / 15 MHz and CHU 7.85 (AM time signals), the 49 / 41 / 31 / 25 / 19 m shortwave broadcast bands (AM), 80 and 40 m (LSB) and 20 m (USB), NMG's weather fax, NAVTEX 518 kHz and UVB-76 4625 kHz (a well-known public mystery broadcast), with a **What's this signal?** link to the Signal Identification Wiki. The V4's built-in upconverter does this: Homebrew's librtlsdr 2.0.3 (osmocom) detects the Blog V4 and adds 28.8 MHz itself below 28.8 MHz, so `rtl_fm`, `rtl_power`, `rtl_sdr` and Web SDR's `rtl_tcp` all reach HF with no flag or separate driver. Hearing anything there needs a 10–20 m long wire through a 9:1 balun, so the HF buttons stay dimmed, with that note in the hint, until a test hears a carrier (**Radio settings › Test HF**, or `/sdr hf test`), or you mark it by hand.

One dim line says it plays on the Mac; "how the meter works ▸" opens the S-meter's explanation. On the phone the station tabs take two rows of three and there is no text field.

**The EQ display.** Under the LCD while it plays: the sound itself as a hi-fi spectrum display, neon LED bars from bass (magenta) to treble (amber) with glowing peak caps over a faint reflection, a dB scale, the frequency axis, and a guess at what it hears ("sounds like music / voice", noise, silence) with the level in dBFS. Wide FM shows 32 bands from 60 Hz to 12 kHz; narrow FM and AM stop sooner (6 and 5 kHz), as their audio does. The tap runs an FFT about ten times a second (stdlib Python, under 1 ms each), each band rising fast and falling slowly, and only while the tab is drawn. The tab reads it about 2.5 times a second (once a second on the phone, with 16 bars); the terminal draws it as a block-character bar graph. Not playing, a dim "press ▶ Listen" ghost holds its place.

While playing, changes retune the V4 once the presses stop (0.7 s), without blocking.

**The S-meter.** `rtl_fm` reports no signal level, so the meter is read from the demodulated audio on its way to the speaker:

- **Wide FM:** the 19 kHz stereo pilot against the quiet 16–17 kHz gap.
- **Narrow FM:** "quieting". FM audio is full of hiss without a carrier and goes quiet with one.
- **AM:** the carrier's envelope over the receiver's own noise.

It's rough, but it tells a station from noise. With squelch on, `rtl_fm` sends nothing while closed, which the meter shows as "squelch closed". While not playing, the meter shows the last scan's (or live view's) level at the tuner's frequency.

**Weak signals.** A broadcast that never stops (wide FM, NOAA) heard as noise is called out: "weak signal — try the antenna by a window". It appears on the LCD, in a toast, in the note line and in the status line, and in the `/sdr listen` reply. A button (▶ Listen, a station, a row's ▶, Start here, the strip's Enter) starts the audio at once with `radio.py listen … --quick` and the meter polls that follow give the verdict about 3 s in; `/sdr listen` still waits the ~3 s so its reply can say it. A voice channel heard as noise (aircraft, repeaters) is "quiet right now" instead.

### Radio world

A 24 MHz – 1.7 GHz map on a log scale, with VHF (143–164) and UHF (418–470) close-ups. It shows:

- FM broadcast, aircraft, 2 m / 70 cm ham, MURS, marine VHF (Ohio River towboats on ch 13 / 16), railroad, NOAA, 433 ISM, GMRS / FRS, LoRa 902–928 (Meshtastic 906.875, MeshCore 910.525) and ADS-B 1090;
- a heat mark on each band from its last scan: size for how many signals, colour for the strongest, faded when old;
- a red mark at the tuner.

The map is a picture, not buttons. On the desktop it is drawn interactive: hover a band (or its count badge) for a tooltip, e.g. "Aircraft 118–137 MHz · 14 signals in the last scan (11:06 pm), strongest +20 dB · use the Aircraft button below to scan it", and the band brightens under the pointer. The hint says so: "the buttons under the map scan a band (about 10 s) · hover the map for details" (on the phone, "tap a band button below to scan it").

The band buttons sit below the map, each with a dot in its colour on the map, in labelled rows: Broadcast (FM, NOAA), Air (Aircraft, ADS-B), Ham (2 m, 70 cm), Two-way (MURS, Marine, Railroad, GMRS/FRS) and Gadgets (433 MHz, LoRa 915, Mesh watch). A button scans its band (about 10 s), or moves the live view there while it runs. The **Mesh watch** band (905.8–911.6 MHz) is narrow enough for a row a second over both mesh channels. On the desktop you can also scan a custom range.

| Band | Range | Notes |
|---|---|---|
| FM broadcast | 87.5–108 MHz | stations named, e.g. 89.1 WKCX, 94.1 WNNF, 102.7 WEBN |
| NOAA weather | 162.35–162.6 MHz | KIH42 Covington on 162.550 |
| Aircraft | 118–137 MHz | AM voice |
| 2 m ham | 144–148 MHz | 146.880 SKYWARN, 146.790 NKARC, 147.030 / 147.255 K4CO, 146.520 calling |
| MURS | 151.8–154.62 MHz | MURS 1–5 named |
| Marine VHF | 156.0–157.45 MHz | channels named; ch 13 / 16 marked |
| Railroad | 160.2–161.6 MHz | |
| 70 cm ham | 420–450 MHz | |
| 433 MHz ISM | 433–435 MHz | |
| GMRS / FRS | 462.5–467.75 MHz | FRS / GMRS channels named |
| Meshtastic / LoRa | 902–928 MHz | 906.875 LongFast and 910.525 MeshCore marked |
| Mesh watch | 905.8–911.6 MHz | both mesh channels at a row a second |
| ADS-B 1090 | 1086–1094 MHz | transponder burst energy |

### Spectrum

The chart has two panels on one frequency axis:

- **The spectrum on top:** the average (cyan), the peak hold (amber) and the noise floor (dashed). Live adds the max hold since you pressed Reset (dashed magenta) and the newest sweep (white). Peaks are labelled with names where they're known (FM peaks snap to the US channel grid), and the red line is the tuner.
- **The waterfall below:** time as rows, colour as strength. It runs from dark at the noise floor through blue, cyan, green and yellow to red, with a legend in dB.

There are two ways to fill it:

- **Scan 10 s:** a one-shot sweep of the band.
- **◉ Live:** a continuous `rtl_power` over the current band. A new row arrives about every second, and the tab redraws every 2 s with the last 60 rows, newest on top.

**The tuning strip.** The chart is a picture (an SVG on the desktop, cells on the terminal), so it can't take a click. Directly under it on the desktop and the terminal is a strip that can: the same band as two rows of coloured cells in the waterfall's colours (the top row the loudest moment, the bottom row the average), the signals' names over small ▾ ticks, the tuner as a red ▼ with a heavy bar through the cells, a start / middle / end MHz axis, and a readout line.

- **Point** at it and the readout says what is there: "102.7 MHz · WFM · +28 dB · 102.7 WEBN (steady)", or away from a signal its level and the nearest named station ("97.3 MHz · WFM · noise floor · 97.3 WYGY").
- **Click** to tune there. The click snaps to a signal within a cell and a half, else to the band's channel step: FM's odd tenths, 25 kHz on the airband, marine and NOAA, 12.5 kHz on GMRS/FRS, 5 kHz elsewhere. The mode is the signal's own, else the band's. If Listen is playing, the audio follows (it retunes once the clicks and keys stop, as ▲ ▼ do). Hold the button and move to scrub the readout first; let go off the strip to cancel.
- **Keys**, once a click has given it the focus: **← →** step the tuner by its step, **Shift+← →** jump to the previous or next signal, **Enter** plays or stops, **Esc** lets go.

On the terminal the strip is cell for cell under the waterfall's columns. On the desktop it spans the pane and can't line up with the picture's pixels, which is why it carries its own axis. The phone (and VS Code) have no such element, so there the station list below does the job: tap a row to play. The section's hint says which: "click the strip under the waterfall to tune" on the desktop and terminal, "tap a row to play" on the phone.

Under the chart is the list of stations, one row each: **▶** on the left, then the frequency in bold, the name, an 8-block strength bar (amber weak to green strong) with its height above the floor, and whether it's steady or bursts. ▶ tunes and plays it.

- The playing row is lit green, its button **■ Stop**, with "▶ playing S9+20".
- The row just pressed says **Starting…** until the audio starts; the tuned station, when not playing, is marked "◂ tuned".
- **Sort** by frequency or by strength (remembered). A list longer than ten shows the 10 strongest first, with "show all 26".
- One dim line explains the picture; "what am I looking at ▸" opens the full explanation and the band's notes.
- On the phone each row stacks: the frequency and name, then the strength and ▶.

Names are only what is known: a call sign from the Cincinnati list, a channel name, or "FM" for an unnamed broadcast (never a guess).

The live view stops whenever anything else needs the V4, and the tab says why with a **Resume live** button, e.g. "Live view stopped so the V4 could play 94.1 WNNF." It also stops when you close the tab, or after 3 minutes off screen.

On the terminal, which draws no SVG, the spectrum and waterfall are drawn in cells: eighth-blocks for the spectrum, half-blocks for two waterfall rows per line, in the same colours. The tuning strip sits right under them.

### Mesh traffic

Bursts per minute over the last hour at Meshtastic LongFast 906.875 and MeshCore 910.525, counted from LoRa scans and the live view (each second whose level jumps 6 dB over the channel's quiet level). Each channel shows **BUSY** (a burst a minute or more), **ACTIVE**, **QUIET**, or **NO DATA** under 30 s listened.

### Gadgets nearby

What `rtl_433` hears on 433.92 MHz:

- a **neighbourhood** strip: heard today, in the last hour, low batteries, the newest device;
- one card per transmitter, newest first. Each card has the model, what it probably is, its readings (°F first), a red **low battery** pill, how often and how strongly it's been heard, and a sparkline of temperature (amber) and humidity (cyan) over the last hours.

One sensor that `rtl_433` decodes as two models is shown once, labelled with both names, e.g. "LaCrosse-TX141THBv2 / TFA-303221" (the same id and the same readings within ~2 s). A toast appears once for a device that's never been heard before. Tire sensors are described neutrally, as a passing car's.

### Share to phone

Runs `rtl_tcp` so an SDR app on the iPhone (CoronaSDR is free) can use the V4 over the network. The tab shows the Mac's Tailscale and home Wi-Fi addresses.

### Planes

ADS-B on 1090 MHz, decoded by `scripts/adsb.py` (`rtl_adsb` plus its own decoder): every airliner sends its position, height and speed many times a second.

- **✈ Planes on / ■ Planes off**, and range chips **10 / 25 / 50 nm / auto** (remembered).
- On the desktop, a radar of your location (Walton with CVG's runways by default), each plane coloured by height with its trail; it redraws about every 2 s while Planes runs and the tab is on screen.
- On the phone, a table instead: callsign, altitude, speed, distance, last heard (34 columns).
- A counts line (aircraft, with a position, the farthest), emergencies in red, and an antenna tip: the V4's dipole vertical, short elements at about 6.9 cm each, high at a window.

### APRS

Ham radio packets on 144.390 MHz, decoded by `scripts/digital.py`'s built-in AFSK1200 modem: cars and hikers sending positions, home weather stations, digipeaters and short messages. **▶ APRS on / ■ APRS off**; a map on the desktop, a station table on the phone, and the latest packets. Until something is heard it says why instead of showing an empty map: stations beacon every few minutes to half an hour, and indoors the small antenna reaches only the strongest; an outdoor 2 m antenna helps most (or the dipole vertical at a window, long elements at about 49 cm).

### Weather alerts

The watch listens to NOAA KIH42 on 162.550 for the coded burst (SAME) sent before every warning, watch and weekly test, and decodes what, where and until when. **▶ Watch on / ■ Watch off.**

- Active alerts come first as big cards, red for warnings, amber for watches; a new one also toasts.
- Then "no active alerts" and the recent history, and the hint that the weekly test (RWT) is usually Wednesday late morning, with the date.
- **Test the decoder** encodes a test alert as audio on the Mac and decodes it back (`digital.py same selftest`, no V4 needed), and shows the decoded card.

### Web SDR

OpenWebRX+ in Docker, fed by `rtl_tcp` on the Mac: a full live waterfall in any browser; tap a signal to hear it, and the phone works on home Wi-Fi. **▶ Web SDR on / ■ Web SDR off** (it takes the V4 over and needs about 20 s), its live state (running, healthy), and the addresses: **This Mac** (http://localhost:8073, a link), **Home Wi-Fi** (the Mac's LAN address, read live, as text to type into the phone), and **Tailscale** when a serve mapping exists. Reaching it away from home is opt-in and not set up; the tab shows the one command to run yourself:

```sh
tailscale serve --bg --https=8073 http://127.0.0.1:8073
```

While it runs the section also has:

- **Map**: OpenWebRX+'s map page (http://localhost:8073/map), where background decoding puts APRS stations.
- **↻ Sync bookmarks** (`/sdr web sync`): rewrites Web SDR's bookmarks from the tab (its FM stations, the notable frequencies from the presets and the name tables, and what recent scans found busy or strong). Web SDR runs the same sync on every start. Your own bookmarks are kept.
- A line on **Send to Radio tab**: the amber button under the frequency in Web SDR hands what it is tuned to back here. The tab sees it within a couple of seconds (while it is open in Claude Code), stops Web SDR through the job system ("Web SDR stopped so the V4 could play 133.425 MHz in the Radio tab", with **Resume Web SDR**), tunes the V4 there and plays it on the Mac, and toasts "Web SDR → Radio tab". Wide FM, narrow FM and AM only.
- A line on **background decoding**: while Web SDR runs and nobody has its page open, OpenWebRX+ decodes APRS on 2 m (to its Map) and, about midnight to 6 am, 433 MHz gadgets. Web SDR still holds the V4 the whole time, so the tab's own jobs wait until it stops; starting one stops it, as always.

The admin password lives in the Keychain (item `openwebrx-wildcat`) and is never shown. Details (the skin, the plugin, the handoff and its security model, bookmarks, background decoding, profiles, admin, disk, limits): [webrx/README.md](webrx/README.md). `webrx/start.sh`, `stop.sh`, `status.sh` and `sync-bookmarks.sh` work on their own.

### Recordings

● Rec on the tuner saves exactly what plays; ■ Rec stops it. The audio never restarts: the listen job's meter tap tees the sound into `ffmpeg` (AAC, mono, 48 kbps; 64 for wide FM) as it goes on to the speaker, and the file keeps real time (silence while squelch is closed). Retuning carries on in a new file named for the new frequency.

**Log** saves one clip per transmission, the scanner that remembers: pilots on 133.42, towboats on 156.65, hams on 146.52. With squelch on, a transmission is squelch open (`rtl_fm -l` sends nothing while closed); with squelch off, the meter's reading of the audio (FM quieting, the AM carrier) with half a second kept from before. A clip ends 2 s after the voice stops, without that quiet tail; one with under 0.5 s of sound (a kerchunk) is never written; one over 5 minutes is cut there. Broadcasts (wide FM, NOAA) are not logged: they never stop, so ● Rec is for them. Log stays on through retunes until it is turned off (or Stop all).

Files go to `~/Radio/Recordings/YYYY-MM-DD/HHMMSS_<MHz>_<mode>[_<station>][_clip].m4a`, e.g. `224512_162.550_nfm_NOAA-KIH42-Covington.m4a`, each with a JSON sidecar beside it: frequency, mode, station, start, duration, size, whether it's a clip or timed. Never under `~/Documents` or `~/Desktop`.

The **Recordings** section lists today's, newest first: ▶ plays one on the Mac through ffplay (the one playing is lit, with ■; another ▶ stops it first), 🗑 moves it to the macOS Trash (Finder can put it back; never `rm`), and **Show in Finder** opens the day's folder. ▶ while Listen is on plays over it, and says so: Listen keeps going underneath so Rec and Log keep saving; ■ Stop on the tuner gives a clean listen. Then the older days ("Yesterday: 12 clips, 1 recording, 4 min") and the disk used.

**Keeping it small.** The oldest recordings go to the Trash past 30 days or past 2 GB, checked when recording starts and hourly while it runs (`/sdr rec keep <GB> [days]` changes it). A file being written is never touched.

On the phone the list is text rows with ▶ (playback on the Mac).

### Scanner (0.4.0)

A list of favourite channels (frequency, mode, name, squelch), cycled with squelch on. It **stops and plays** when a channel opens and resumes after a few seconds of quiet (4 s; a broadcast such as NOAA is sampled for 6 s and left, since it never goes quiet). It is one exclusive V4 job (`scanner`), so the one-at-a-time rule holds: starting it stops whatever else runs and says so, and anything else stops it.

- **▶ Scan on / ■ Scan off**, then while it runs **⏸ Hold** (stay on the current channel), **⏭ Skip** (next channel now) and **⛔ Lock out** (the current channel). The state line says what it is doing: "scanning · at 147.030 K4CO Edgewood", "▶ stopped on 2 m calling · 146.52 NFM · 0:12", "holding on …".
- A **priority channel** is checked every 3 s even while it plays something else: ★ on a channel makes it the priority, **clear** removes it. None by default.
- **Hits**: the last 20 (time, frequency, name, how long). Hits feed the transmission logger, so with **Log** on each one is saved as a clip in `~/Radio/Recordings` like any transmission.
- The **favourites** list, one row each: ▶ listens to it on the tuner, ☆/★ priority, ⛔ lock out / ✓ unlock. It is seeded with NOAA 162.550, 2 m calling 146.52, the K4CO repeaters 147.03 / 147.255, NKARC 146.79, SKYWARN 146.88, marine ch 16 and 13, aircraft guard 121.5 and the busiest peaks of the last Aircraft scan; `/sdr scan add <MHz> [mode] [name]` adds one, `scan remove <MHz>` drops it.

How it works: each channel gets its own short `rtl_fm` (0.8 s to see whether the squelch opens; a 0-squelch channel counts as open over a meter level), muted while hunting; an open one gets the player and keeps it until the quiet, through the same meter tap that drives ● Rec and Log. Only one `rtl_fm` runs at a time, and `radio.py status` names the holder "Scanner". The list, lock-outs, priority and timings live in `scanner-conf.json`; the live state (current channel, parked, hits) in `scanner.json`.

### IQ snapshots (0.4.0)

**Snapshot band** records 10, 30 or 60 s of raw 8-bit I/Q at 1.024 MS/s (about 2 MB/s) around the tuner's frequency with `rtl_sdr` to `~/Radio/IQ/YYYY-MM-DD/<MHz>_<rate>k.cu8` (e.g. `433.920_1024k.cu8`), with a JSON sidecar (frequency, rate, seconds, gain, time, the station's name). It is a V4 job (`snapshot`) that stops by itself (`rtl_sdr -n`), so it takes the V4 for exactly that long. The list shows each file: **▶** renders a waterfall from the file (an FFT in plain Python, no numpy: rows through the capture, DC in the middle, the span on an axis), **decode gadgets** runs `rtl_433 -r` over a 433.92 MHz snapshot and reports what it decoded, **🗑** moves it to the Trash. Snapshots have their own cap (4 GB, `iqGb` in `recordings.json`) under the same 30-day rule, pruned when one starts and hourly with the recordings; a file still being written is never touched. `/sdr snapshot <MHz> [secs]`, `/sdr snapshots`.

### Radio settings (0.4.0)

The V4's own knobs, in `settings.json`:

- **PPM** − / + (it applies to listening, scanning, the live view, the scanner and snapshots as `-p`), and **Calibrate from NOAA 162.550**: a 6 s `rtl_power` look at a 50 kHz window around KIH42's carrier; the loudest bin's offset from 162.550 becomes the PPM (it takes the V4, like a scan). It needs the carrier well above the noise; with a weak signal it says so and changes nothing.
- **Filter** − / + for the tuner's mode: `rtl_fm -s`, the demodulator's filter width, which is also the audio rate (narrow FM 24 kHz, AM / SSB / CW 12 kHz by default, 4–48 kHz); wide FM stays at 200 k / 48 k. It takes effect on the next Listen.
- **Bias-tee** on / off through `rtl_biast` (it opens the dongle for a moment, so the V4 must be free: Stop all first). **Only for an amplifier or an active antenna that needs power: never with a plain antenna.** 4.5 V DC on the antenna port while on; the setting remembers what you asked for.
- **HF**: whether HF is confirmed on air, **Test HF** (a muted 4 s listen on WWV 10 MHz; a carrier confirms it and lights the HF tab), **Mark confirmed**, and the driver note. `/sdr settings`, `/sdr set ppm <N>`, `/sdr set filter <mode> <Hz>`, `/sdr biast on|off`, `/sdr hf test [MHz]|confirm|status`, `/sdr calibrate [MHz]`.

### Status line

The status line only shows while something runs: `Radio · ▶ 94.1 WNNF S9+20`, `Radio · ▶ 133.425 MHz · ● rec 0:42 · log 7`, `Radio · ◉ live FM broadcast`, `Radio · 3 gadgets · Acurite 57°F`, `Radio · sharing on :1234`, `Radio · ✈ 9 planes`, `Radio · APRS 3 stations`, `Radio · ⚠ Tornado Warning`, `Radio · Web SDR on :8073`.

## One program at a time

The V4 can be used by one program at a time, so close SDR++ before using the tab. Every use of the V4 is a job in `radio.py`'s job manager, with one name everywhere:

| Kind | Label | What holds the V4 |
|---|---|---|
| `gadgets` | Gadget listener | `rtl_433` |
| `listen` | Audio | `rtl_fm` → meter tap → player |
| `share` | Phone share | `rtl_tcp` on :1234 |
| `live` | Live view | `rtl_power` |
| `adsb` | Planes | `rtl_adsb` → `adsb.py`'s decoder |
| `aprs` | APRS | `rtl_fm` 144.390 → `digital.py`'s AFSK1200 decoder |
| `same` | Weather alerts | `rtl_fm` 162.550 → `digital.py`'s SAME decoder |
| `webrx` | Web SDR | `webrx/start.sh`'s `rtl_tcp` on 127.0.0.1:1234 + the container |
| `scanner` | Scanner | one `rtl_fm` at a time (its own, per channel) → meter tap → player |
| `snapshot` | IQ snapshot | `rtl_sdr -n` writing the .cu8 (it stops by itself) |

- **Starting a job** stops whichever job holds the V4 and records why. The tab shows it, e.g. "Planes stopped so the V4 could run Web SDR", and offers **Resume**.
- **`radio.py status`** names the holder by its label (`holder`), never by the tool under it: "Web SDR", not `rtl_tcp`; "APRS", not an outside `rtl_fm`. A one-shot `adsb.py run` / `digital.py … run` is named by its script.
- **Web SDR** keeps the V4 lock while it runs (its `rtl_tcp` holds it), so `radio.py` stops it with `webrx/stop.sh` before it takes the lock for anything that needs the V4. Starting Web SDR from the tab stops the tab's jobs first, then runs `webrx/start.sh`.
- **Web SDR's background decoding** (APRS, overnight 433 MHz) happens inside Web SDR, so it never adds a second owner: it runs only while Web SDR already holds the V4, and stops with it. **Send to Radio tab** goes the other way through the same rules: `radio.py handoff` starts Listen, which stops Web SDR with the reason recorded.
- **`radio.py stop`** (the tab's **Stop all**, `/sdr stop`, and quitting Claude Code) stops all of them, Web SDR included. Nothing that `radio.py` didn't start is ever killed.
- **A scan** pauses the gadget listener for about 10 s and then starts it again. Anything else running stops, with **Resume**.
- **The gadget listener** remembers whether it was on. It comes back by itself when the V4 is free, and never over another job. When Claude Code quits, it stops along with everything else, so the V4 is free for other programs.
- **A job nobody is watching** stops by itself: the live view after 3 minutes off screen, the others after 20 minutes without a `status` or `gadgets list` call.

## Presses and polls

The tab runs two kinds of work: **presses** (a button, the strip's Enter, a typed frequency, a `/sdr` command) and **polls** (the one-second tick reading status, the meter, live frames, the sections' views).

- **One press at a time, the newest one waiting.** A press while another runs is queued, not dropped, and runs when that one ends. Only one waits: a newer press replaces it (the last click wins; the replaced one is logged as `superseded`). Pressing the same button again while its press runs or waits joins it, so three quick clicks run once.
- **A press says what it wants.** "Planes on", never "toggle Planes": a second click from a drawing that is a moment old asks for the same thing again, and a press for what is already so (the station already playing, Planes already on, per a status read in the last 5 s) changes nothing.
- **Presses before polls.** Processes on the V4 lane run one at a time, a press's first; polls queue behind any press and do not run while one runs or waits, and a poll of a kind already queued is not queued twice. `radio.py`'s own lock (`sdr.lock`) still keeps every V4 command to one at a time, whoever calls.
- **Slow reads beside the lane.** `radio.py status` (~0.4 s, it reads the USB tree) and `webrx/status.sh` (~0.2–0.8 s, `docker inspect`) never touch the V4, so their polls run beside the V4 lane and a press never waits on them. One that comes back after a press started or ended is dropped and read again, so the tab never shows the state from before the press. File reads (`eq.json`, `handoff.json`) never queue at all.
- **Fewer redraws.** A poll that reads the same as last time does not redraw the tab, the LCD and EQ pictures are cached until what they show changes, and the EQ display (~2.5 redraws a second while Listen plays) holds off while a press runs or waits.

### The timing log

Every press adds one JSON line to `~/Library/Application Support/radio/actions.jsonl` (the last 1000 are kept): `action`, `key` (what it asked for), `pressedAt`, `startedAt`, `finishedAt` (ms since 1970), `waitMs` (queued behind another press), `runMs`, `expectMs` (what "about N s" said), `step`, `queued`, `coalesced` (extra presses that joined it), `ok` (false with `failed`: the reason, also shown in a toast), or `superseded: true` with `by`. A poll that took over 300 ms adds a `{"poll": "radio.py status", "ms": 412, "lane": "free"}` line, at most once in 10 minutes per kind unless a press waited behind it (`delayedAPress: true`). When the tab feels slow:

```sh
tail -n 20 ~/Library/Application\ Support/radio/actions.jsonl | jq -c '{action, waitMs, runMs, expectMs, queued, coalesced, ok}'
jq -c 'select(.poll)' ~/Library/Application\ Support/radio/actions.jsonl | tail
```

A large `waitMs` with `queued: false` means a poll held the V4 lane (look for `delayedAPress`); a large `runMs` is `radio.py` itself (Web SDR's container stop, a 10 s scan).

## Commands

All of them reply in text that reads well on the phone.

| Command | What it does |
|---|---|
| `/sdr` | Opens the tab and prints a summary: the V4, the tuner and signal, the live view, gadgets, mesh traffic, the last scan's peaks |
| `/sdr scan <band>` | Any band above, or `custom <start> <stop>` (MHz) |
| `/sdr live on\|off [band]` | Starts the live view (on the current band, or the one named), or stops it; `live reset` clears the max hold; `live custom <a> <b>` up to 60 MHz wide |
| `/sdr tune <MHz> [wbfm\|fm\|am]` | Sets the tuner; retunes the audio if it's playing. With no frequency, it says where the tuner is |
| `/sdr listen [<MHz> [wbfm\|fm\|am]]` | Plays the tuner (or the frequency given). The mode is guessed when left out: wide FM for 88–108, AM for 118–137, narrow FM elsewhere |
| `/sdr stop` | Stops everything on the V4 (Web SDR included): the same as **Stop all** |
| `/sdr bands` | What the last scan of each band heard |
| `/sdr mesh` | Meshtastic / MeshCore traffic over the last hour |
| `/sdr gadgets` | The devices heard and the neighbourhood |
| `/sdr gadgets on\|off` | Turns the listener on or off; `on 915` or `on hop` also listens on 915 MHz |
| `/sdr share on\|off` | Shares the V4 over rtl_tcp; `share on tailscale` or `share on lan` binds to one address only |
| `/sdr planes [on\|off]` | Planes on or off; prints the aircraft table, the counts and (when few are heard) the antenna tip |
| `/sdr radar` | Opens the plane radar in its own **Planes** tab (also the ⤢ button in the Planes section), with nothing to scroll past; the tab can be popped out |
| `/sdr aprs [on\|off]` | APRS on or off; prints the stations heard, or why nothing has been yet |
| `/sdr alerts [on\|off\|test]` | The weather alert watch on or off; prints active alerts (as cards), the history and the next weekly test; `test` runs the decoder's self-test |
| `/sdr web [on\|off\|sync]` | Web SDR on or off; prints its addresses (this Mac, home Wi-Fi, Tailscale), its Map, what Send to Radio tab and background decoding do, and the opt-in Tailscale command; `sync` rewrites its bookmarks from the tab |
| `/sdr rec on\|off` | ● Rec: records what plays (Listen must be on) |
| `/sdr rec keep <GB> [days]` | How much to keep (2 GB, 30 days by default); the oldest go to the Trash |
| `/sdr log on\|off` | The transmission logger: one clip per transmission while Listen plays a voice channel |
| `/sdr record <MHz> [wbfm\|fm\|am] <seconds>` | A timed recording: of what plays when Listen is on that frequency, else Listen starts muted for it (through the job manager) and stops by itself |
| `/sdr recordings` | Today's recordings and clips as text, the older days, the disk used, Rec and Log |
| `/sdr scan list\|on\|off` | The Scanner: its favourites, lock-outs and priority; on / off (one V4 job). `scan add <MHz> [mode] [name]`, `scan remove <MHz>`, `scan skip`, `scan hold`, `scan resume`, `scan lockout [MHz]`, `scan unlock <MHz>`, `scan priority <MHz\|off>`. `/sdr scan <band>` is still a band sweep |
| `/sdr snapshot <MHz> [secs]` | An IQ snapshot (10–60 s, takes the V4); `snapshots` lists them; `snapshot waterfall\|decode\|delete <file>` |
| `/sdr settings` | PPM, the filter widths, the bias-tee, HF; `set ppm <N>`, `set filter <mode> <Hz>`, `biast on\|off`, `hf test [MHz]\|confirm\|status`, `calibrate [MHz]` |
| `/sdr listen <MHz> usb\|lsb\|cw` | SSB and CW join wbfm / fm / am; `518 khz` reads as kHz |

## Security: sharing

`rtl_tcp` has **no authentication**: anyone who can reach the port can tune the V4 and stream from it.

- The tab only runs it while you share, and stops it when Claude Code quits.
- By default it binds to all interfaces (`0.0.0.0:1234`). Prefer the **Tailscale** address in the phone app, and use `/sdr share on tailscale` to bind to Tailscale alone, so it is never reachable from the home Wi-Fi.
- Press **Stop sharing** when you're done.

## Adding to it: hook points

**The meter tap (`AudioMeter` in `scripts/radio.py`).** The listen job's reader gets every chunk of demodulated audio on its way to the player; anything slow happens in its `tick()`, after the player has the chunk, so nothing there can glitch the sound. The `Recorder` (● Rec, Log) and the EQ's `AudioSpectrum` hang off it: the recorder follows two control files in the state folder, `rec.on` (an id and an optional `until`) and `log.on` (`since`), and the spectrum runs only while `eq.seen` is fresh (`listen meter` touches it). `ClipGate` is the logger's splitter on its own (feed PCM with times; it opens a sink per transmission), `Encoder` the non-blocking ffmpeg. A reader may end its own job with `Stop("done", "what it did")`, as a timed recording does.

**Python (`scripts/radio.py`).** `MODES` is the registry of exclusive V4 jobs. Each mode is a detached process pipeline run by one generic wrapper, which handles the pidfile, log, lease, clean stop and recorded exit. `scripts/adsb.py` and `scripts/digital.py` register theirs this way (`adsb`, `aprs`, `same`), and their own `start` / `live` / `stop` commands go through `radio.py job …`, so there is one pidfile owner. To add one:

```python
register_mode(Mode(kind="adsb", label="ADS-B decoder", children=("rtl_adsb",),
                   pipeline=lambda meta: [[RTL_ADSB]], reader=lambda meta: Decoder(meta),
                   doing=lambda meta: "decode ADS-B on 1090 MHz"))
```

The fields:

| Field | What it is |
|---|---|
| `pipeline` | One argv per process; several are piped stdout → stdin |
| `reader` | Optional. Gets `.feed(bytes)` of the first process's stdout, `.tick()` every ~0.2–1 s and `.close()` at the end |
| `forward=True` | Passes those bytes on to the second process |
| `lease_s` / `heartbeat` | Stop after this long with nobody asking, counted from that file's mtime |
| `doing` | Completes "stopped so the V4 could …" |
| `detail` | Optional: the holder line's detail, e.g. "ADS-B on 1090 MHz" |
| `probe` / `starter` / `stopper` / `holds_lock` | An external mode with its own lifecycle (Web SDR): `probe()` returns a pidfile-shaped dict while it runs, `starter(meta)` / `stopper()` run its scripts, `holds_lock` says it keeps `sdr.lock` while it runs |

A mode is started and stopped with `radio.py job start <kind> ['{json meta}']` and `job stop <kind>`, under the lock. It shows in `status.jobs[kind]`, is paused by scans, and is stopped by `radio.py stop`.

A module named in `PLUGIN_MODULES` (`scripts/adsb.py`, `scripts/digital.py`) that defines `radio_modes(radio)` is registered automatically. One that fails to import is listed under `status.pluginErrors` and never breaks the radio. To drive the V4 directly instead, hold `Lock("sdr.lock")` (keep holds under ~20 s) and check `device()` / `owner_info()`.

**The tab (`hooks/register.tsx`).** `SECTIONS` is a list of extra sections. A module exports a `Section` (`{ id, title, hint?, color?, order?, render, text?, verbs?, command?, poll? }`), and `SECTIONS.push(it)` adds it. Recordings, Planes, APRS, Weather alerts and Web SDR are written that way:

- `render` draws the section after the core sections, from the context's `els`;
- `text` adds a block to the `/sdr` summary;
- `verbs` and `command` answer `/sdr <verb>`;
- `poll` runs on the tab's one-second tick.

The `SectionContext` gives a section:

- `surface`, `narrow`, `columns`, `now` and `watched` (the tab was drawn in the last 15 s: poll for pictures only then);
- `status`, which includes `jobs` and `holder` (read live, so it is fresh after `refresh`);
- `radio(args)`, `python(script, args)` and `run(path, args)` (an executable in the mod, e.g. `webrx/status.sh`), which run on the tab's V4 lane in the context's `lane` (`action` for a press or a command, `poll` in `poll`); `webrx/status.sh` runs beside it;
- `act(label, job, { key, plan })`: a press (see [Presses and polls](#presses-and-polls)). `key` names what it asks for (the same key joins a press already running or waiting), `plan()` its first step and how long it takes; it resolves `'ran'`, `'joined'` or `'superseded'`, and a job that returns `false` failed (a toast says so);
- `setNote`, `toast`, `redraw`, `refresh`, and `stopped(kind, list)` / `stoppedText(list)` for the Resume buttons and the "(stopped X: the V4 does one thing at a time)" tail.

## Notes

`scripts/radio.py` is standard-library Python and works on its own. It prints one JSON object per call:

- `status`, `jobs`, `mesh`
- `scan fm`, `scan custom 150 174`, `last`
- `live start fm|mesh|custom <a> <b>`, `live frame`, `live reset`, `live stop`
- `gadgets start|stop|list`
- `listen 94.1`, `listen 162.55 fm --squelch 0 --gain 40`, `listen meter`, `listen stop`
- `share start|stop`
- `rec start|stop [--seconds N]`, `rec keep <GB> [days]`, `rec prune`, `rec delete <file>`, `rec reveal [<file>]`
- `log start|stop`, `record <MHz> [mode] <sec>`, `recordings [--day YYYY-MM-DD]`, `play <file> [--volume N]`, `play stop`
- `job start|stop <kind>` (`gadgets`, `listen`, `share`, `live`, `webrx`, `adsb`, `aprs`, `same`)
- `handoff` (takes Web SDR's `handoff.json`: drops it if older than 2 minutes or not a frequency and mode it plays, else stops Web SDR and plays it), `handoff clear`
- `stop` (stops everything that uses the V4, Web SDR included)
- 0.4.0: `scan list|on|off|add <MHz> [mode] [name]|remove|skip|hold|resume|lockout [MHz]|unlock|priority <MHz|off>` (the Scanner; `scan <preset>` stays the sweep), `snapshot <MHz> [--rate Hz] [--seconds N] [--gain dB]`, `snapshot list|waterfall <file> [--rows N] [--cols N]|decode <file>|delete <file>|prune`, `settings`, `set ppm <N>`, `set filter <mode> <Hz>`, `biast on|off`, `hf status|test [MHz]|confirm|reset`, `calibrate [MHz]`; `listen` takes `usb`, `lsb` and `cw` and reaches 0.5–1766 MHz (HF below 28.8 through the upconverter), as do `scan custom` and `live custom`

The sections read one JSON object each: `adsb.py view [--range NM|auto] [--svg] [--table] [--width N]`, `digital.py aprs view [--svg] [--table]`, `digital.py same view [--svg]`, `digital.py same selftest --svg`, `webrx/status.sh` and `webrx/sync-bookmarks.sh`. The tab reads `handoff.json` straight from the state folder (no process) every ~1.5 s while Web SDR runs.

How the scan data is cleaned up:

- **The V4's own spike:** the V4 shows a spike at the center of every tuning step (its DC offset). The script fills those few center bins from their neighbours, in scans and live alike. Otherwise the 915 MHz scan shows a fake "signal" every 2.17 MHz.
- **Interference combs:** four or more unnamed steady peaks at an even spacing are labelled as an interference comb. The aircraft band here shows one every 0.77 MHz, from electronics nearby rather than aircraft.
- **Crystal spurs:** peaks at multiples of 28.8 MHz are labelled as the V4's own spurs.

The waterfall is a palette PNG: one byte a pixel, so a 60 × 600 waterfall fits the chart's 128 KB budget. The tab thins its lines if a chart ever gets near the budget.

Audio details:

- Narrow FM plays at 24 kHz and AM at 12 kHz, because this `rtl_fm` only resamples downward.
- Narrow FM's default squelch is 40, except on NOAA, which broadcasts all the time. Measured at gain 40: the V4's noise reads under 20 and KIH42 about 90, so 0.1.0's 130 kept even KIH42 silent.

Tests:

- 0.3.4's presses (`tests/radio.test.ts`, "presses"): the pending label is in the very next drawing after a press (with the Doing now line), a press while another runs is queued and runs after it while a newer one replaces the one waiting, three quick presses run once (and a late fourth asks nothing), a press jumps ahead of polls already queued and they wait until it is done, `webrx/status.sh` never holds a press up (and its stale answer is dropped), Listen starts with `--quick` while the weak-signal toast still comes from the meter, and a failed press ends in a toast; the timing log's lines are checked along the way.
- `claude plugin test radio` draws the tab on the terminal, desktop, VS Code and the phone from data captured on the real V4 (`tests/fixture.ts`, `tests/fixture-sections.ts`). It covers the charts' size limit, the phone's lack of text fields, the merged twin sensor, scans, live (frames, max-hold reset, moving bands), preemption with Resume, the weak-signal path, the tuner's retune debounce and station tabs, the gadget listener's comebacks, listening, sharing, Start here, the four new sections on the desktop and the phone (radar, nothing-heard APRS, a red warning card, Web SDR's links), "On the V4 now" and Stop all, the radar's polling, the text replies, ● Rec and Log on the tuner with the LCD's REC annunciator, the Recordings list (play, trash, Finder, older days; text rows on the phone), `/sdr recordings`, `rec keep` and `record`, the EQ display on each surface (32 bars, 16 on the phone, a Raster on the terminal) and that it reads only while drawn, the station list (▶ on the left, the playing, starting and tuned rows, sort and the 10 strongest), the tuning strip (where it is drawn and where not, the hints, pointing, clicking and the keys through to Listen and the debounced retune on the terminal, the `ui.message` hook refusing malformed posts on the desktop, and the strip at ~100 and ~140 columns), that no row of buttons is wider than the pane at ~700 px, ~1000 px and on the phone (it prints the drawn tree for reading), and 0.3.2's Web SDR pieces: a handoff while Web SDR runs stops it and plays there once (note, toast, Resume Web SDR, the tuner, Web SDR's "stopped so the V4 could play … in the Radio tab"), nothing read while it is off, an old handoff cleared rather than played, the Map link, Sync bookmarks and `/sdr web sync`, the Send to Radio tab and background-decoding lines, and the band map's tooltips (interactive on the desktop only, a `<title>` per band, the hover style, the hint, a coloured dot per button). `tests/tuning-strip.test.ts` calls the strip's module function straight with fake props and a fake surface: what it draws, and that a pointer or a key posts the right MHz (the edges, snapping to a station, the FM grid, quick presses adding up).
- `python3 -m unittest discover -s tests -p 'test_*.py'` tests `radio.py`'s twin merge, DC-spike fill, palette PNG, mesh burst count, names, signal meter, the one registry with its labels, an external mode stopped before the lock with its reason recorded, the real ADS-B capture (`tests/adsb-capture.txt` decodes to aircraft with positions), the APRS/SAME job reader, the logger's clip splitting over a synthetic squelched stream with gaps (and with the level gate, and the 5-minute cut), the retention cap (too old, then oldest past the size, never one being written), the tap recording and logging through ffmpeg, a timed recording ending its own job, the real job wrapper over a fake rtl_fm passing every byte to the player while it records, and the EQ's spectrum (a tone lights its band, hiss reads as noise), against throwaway state and recordings folders.
- `tests/test_webrx.py` (in the same unittest run) covers Web SDR's package without Docker or the V4: the handoff endpoint's origin rule, every refusal (method, path, origin, content type, length, size, bad JSON, extra keys, a non-number or out-of-range MHz, a mode the tab does not play) and its CORS preflight, the real handler on a loopback port writing `handoff.json` (and writing nothing when it refuses), `radio.py`'s side (fresh, stale, invalid, taken once, the "in the Radio tab" reason), the activity `top` peaks, the bookmark generator (names only from the tables, no invented call signs, busy and strong from recent scans with spurs, combs, data bands, old scans and already-named frequencies left out, the "tonight / last night / on Sat" words), the merge that keeps Seth's own bookmarks, the settings it adds (and leaves alone), and the skin link.
- 0.4.0 (`tests/test_040.py`, `tests/test_webrx_040.py`, and a `describe` in `tests/radio.test.ts`): the Scanner's rules without the V4 (the seeded favourites with the busiest airband peaks, add / remove / lock-out / unlock / skip nonce / hold / priority through `scanner_cmd`, lock-outs and the priority shaping the cycle, the open decision, and the park rule as one pure step: stop and play while open, resume 4 s after the quiet, never on hold, a broadcast left at its cap), IQ snapshots (the `<date>/<MHz>_<rate>k.cu8` name that never overwrites, `rtl_sdr -n` with the PPM, the list from sidecars or names, retention — too old, then the oldest past the cap, never one being written, sidecars and the emptied day folder along — a waterfall from a synthetic tone landing in the right column, decode refused off 433.92), HF (unconfirmed by default with the driver supported, confirm / reset, the HF presets and names, the HF mode guess), SSB / CW tuning (`-M usb|lsb`, CW 700 Hz low, the filter width as the player rate, the meter reading SSB by loudness), the settings (defaults, PPM persisted into `-p`, the filter clamp, the PPM-from-offset sign, the bias-tee's tool check, the 0.5 MHz floor); Web SDR's gapless FM windows (every US channel 87.9–107.9 reachable, centres between channels, WEBN's window first) and HF profiles (public modes only, the night slot off), and the live merge (the untouched gapped windows retired, an edited one kept, FM first, idempotent, HF bookmarks with OpenWebRX+'s decoders). The tab: SSB / CW chips and the 1 kHz step, the HF tab dimmed with the antenna note until `hf confirm` lights it and plays, the Scanner on and off through the job system with its state line, hits, Hold / Skip / Lock out and the ★ / ⛔ / ✓ row buttons (and `scan fm` still a sweep), snapshots (capture, the list, ▶ waterfall as an Svg, decode gadgets only on 433.92, 🗑), the settings panel's presses, and nothing wider than the phone.
- `tests/test_location.py` (0.5.0): the location file without the V4, each check in a fresh process on a throwaway folder: no file is Walton and every picture and name is as before; a file moves the radar centre and airport, the APRS map, the FM list, the repeaters and the weather-alert codes; a partial file replaces only its keys; a broken file is reported and left byte for byte alone; Web SDR's receiver follows the file until you edit it there. `tests/radio.test.ts` has a `describe` for the tab's side.
- `python3 scripts/adsb.py selftest`, `python3 scripts/digital.py aprs selftest` and `python3 scripts/digital.py same selftest` check the decoders against reference vectors and synthesized audio.

## Files (0.4.0)

`scripts/radio.py` (the job manager, the meter tap, recording, the Web SDR handoff; 0.4.0's Scanner, IQ snapshots, settings, HF and PPM live there too), `scripts/adsb.py` + `adsb_render.py` (Planes), `scripts/digital.py` + `digital_render.py` (APRS, weather alerts), `webrx/` (Web SDR: `webrx.py` and its scripts, `handoff.py`, `skin/custom.css`, `plugins/receiver/`), `hooks/register.tsx` (the tab), `hooks/tuning-strip.tsx` (the tuning strip, a `Client` surface module), `tests/`.


| Where | What |
|---|---|
| `~/Library/Application Support/radio/` | State, listed below |
| `~/Library/Caches/radio/sdr.lock` | The lock that keeps the tab's polling, scans and other callers from colliding |
| `~/Radio/Recordings/YYYY-MM-DD/` | Recordings and clips (.m4a) with their JSON sidecars |
| `~/Radio/IQ/YYYY-MM-DD/` | IQ snapshots (.cu8) with their JSON sidecars (0.4.0) |

The state folder holds:

- `devices.json`: every device heard, with its reading history;
- `gadgets.jsonl`: raw `rtl_433` lines, rotated at 5 MB to `gadgets.jsonl.1`;
- `last-scan.json`, `live-frame.json`, `meter.json`, `activity.json` (each band's last scans) and `mesh.json` (bursts per minute, 24 h);
- `adsb.json` (the aircraft table), `aprs.json` (stations, packets, messages), `same.json` (alert history);
- each job's pidfile and log, and `exits.json` (why each job last stopped);
- `handoff.json` (what Web SDR's Send to Radio tab asked for; gone once the tab takes it);
- `rec.on` and `log.on` (● Rec and Log, read by the tap), `recordings.json` (the retention cap and its last run), `playback.json` (the ffplay playing a recording), `rec.log` (ffmpeg's errors), `eq.json` and `eq.seen` (the EQ display's spectrum, and when the tab last looked);
- `actions.jsonl`: the tab's timing log, one line per press and per slow poll, the last 1000 (see [The timing log](#the-timing-log));
- 0.4.0: `settings.json` (PPM, the filter widths, the bias-tee you asked for), `hf.json` (whether HF is confirmed on air, and the evidence), `scanner-conf.json` (the favourites, lock-outs, priority, hold, the skip nonce, the timings) and `scanner.json` (the scanner's live state); `recordings.json` also carries `iqGb`, the IQ cap.

Web SDR keeps its `rtl_tcp` and handoff pids and logs in `~/Library/Caches/radio/webrx-rtl_tcp.{pid,log}` and `webrx-handoff.{pid,log}`, and its settings, bookmarks and the Wildcat panel's list in its data folder (`~/Library/Application Support/radio/openwebrx` unless `WEBRX_DATA` or a `webrx-data` file names another).

Nothing lives in `~/Documents` or `~/Desktop`: on this Mac they sync to iCloud, and reads there have stalled for minutes. Environment variables for testing:

| Variable | What it does |
|---|---|
| `RADIO_DIR=/some/dir` | Moves the state folder |
| `RADIO_LEASE_S` | Changes the 20-minute lease |
| `RADIO_LIVE_LEASE_S` | Changes the live view's 3-minute lease |
| `RADIO_NO_LEASE=1` | Turns the leases off |
| `RADIO_REC_DIR=/some/dir` | Moves the recordings (never into ~/Documents or ~/Desktop) |
| `RADIO_IQ_DIR=/some/dir` | Moves the IQ snapshots |

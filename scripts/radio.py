#!/usr/bin/env python3
"""RTL-SDR bridge for the Radio tab. Standard library only, receive only.

Drives an RTL-SDR Blog V4 through the Homebrew rtl-sdr tools and prints one
JSON object per call.

  radio.py status                    the V4 on USB (from the USB tree, never opened), who
                                     holds it, every job's state, band activity, mesh traffic
  radio.py scan <preset> [--seconds N]
  radio.py scan custom <start> <stop> [--bin kHz]
                                     an rtl_power sweep (~10 s): per-bin average and peak-hold
                                     power, the noise floor, peaks with local names, a
                                     waterfall PNG (palette) and its index grid
  radio.py last                      the last scan again (kept on disk)
  radio.py live start <preset> | live start custom <a> <b> | live stop | live frame | live reset
                                     a continuous rtl_power over one band: the job keeps the
                                     last 60 one-second rows and writes a frame (spectrum:
                                     average, 60 s peak hold, max hold since reset; a waterfall
                                     PNG newest row first); `frame` returns it, `reset` clears
                                     the max hold
  radio.py gadgets start [433|915|hop] | stop | list
                                     rtl_433 as a detached listener; list merges one transmitter
                                     decoded as two models, keeps per-device reading history and
                                     sums up the neighbourhood
  radio.py location                  where the tab is: Walton, KY unless location.json says otherwise
                                     (reads files only; a bad file is reported, never rewritten)
  radio.py listen <MHz> [wbfm|fm|am] [--squelch N] [--gain auto|dB] [--volume 0-100] [--quick]
  radio.py listen stop | listen meter
                                     rtl_fm through a small tap (the signal meter) to ffplay/play;
                                     `meter` is the live reading (with the EQ display's spectrum,
                                     `eq`); without --quick the call waits ~3 s and says "weak
                                     signal" when there is nothing to hear
  radio.py rec start|stop [--seconds N] | rec keep <GB> [days] | rec prune | rec delete <file>
                                     | rec reveal [<file>]
                                     ● Rec: the listen tap tees exactly what plays into ffmpeg (AAC
                                     .m4a) without touching the audio; keep sets the retention cap
                                     (2 GB / 30 days), prune enforces it, delete moves one to the
                                     Trash, reveal shows it in Finder
  radio.py log start|stop            the transmission logger: one clip per transmission
  radio.py record <MHz> [mode] <sec> a timed recording (starts Listen muted when nothing plays)
  radio.py recordings [--day YYYY-MM-DD]
                                     that day's recordings and clips, older days summed up, disk
  radio.py play <file> [--volume N] | play stop
                                     plays a recording on the Mac through ffplay
  radio.py share start [all|lan|tailscale] [--port N] | share stop
                                     rtl_tcp for an SDR app on the phone
  radio.py job start <kind> ['{json meta}'] | job stop <kind> | jobs
                                     any job in MODES: gadgets, listen, share, live, webrx
                                     (Web SDR), and the ones modules register: adsb (Planes),
                                     aprs (APRS), same (Weather alerts)
  radio.py mesh                      Meshtastic / MeshCore burst counts over the last hour
  radio.py handoff [clear]           takes the frequency Web SDR's "Send to Radio tab" left in
                                     handoff.json (webrx/handoff.py): stops Web SDR, plays it
  radio.py stop                      stops everything that uses the V4, Web SDR included

Presets: fm, noaa, air, 2m, 70cm, lora, mesh, 433, marine, rail, murs, gmrs, adsb.

The V4 can be used by one program at a time, and every use of it is a job here. A scan
pauses the gadget listener and starts it again afterwards; it stops any other job and
says so. Starting any job stops whichever other job holds the V4, and records why
("Planes stopped so the V4 could run Web SDR") so the tab can say it. `status` names
the holder by its label (`holder`), never by the tool underneath it.

HOOK POINTS for other modules (ADS-B, digital modes, WebRX)
-----------------------------------------------------------
MODES is the registry of exclusive V4 jobs, each a detached process tree run by one
generic wrapper (pidfile, log, lease, clean stop, recorded exit). Built in: gadgets
(rtl_433), listen (rtl_fm -> meter tap -> ffplay), share (rtl_tcp), live (rtl_power),
and webrx (Web SDR: OpenWebRX+ in Docker over rtl_tcp, an "external" mode, below).
Another job is one call:

    register_mode(Mode(
        kind="adsb",                          # pidfile / log name, `job start adsb`
        label="ADS-B decoder",                # what the tab and "stopped" lines call it
        children=("rtl_adsb",),               # process names a stop may kill (safety check)
        pipeline=lambda meta: [[RTL_ADSB]],   # argv per process; several are piped stdout->stdin
        reader=lambda meta: Decoder(meta),    # optional: .feed(bytes) gets the FIRST process's
                                              #   stdout, .tick() runs every ~0.2-1 s, .close() last
        forward=False,                        # with a reader: pass those bytes on to process 2
        lease_s=LEASE_S,                      # stop after this long with nobody asking (0 never)
        heartbeat=None,                       # file whose mtime counts as "asked" (None: shared)
        doing=lambda meta: "decode ADS-B on 1090 MHz",  # "...stopped so the V4 could <doing>"
        detail=lambda meta: "1090 MHz"))      # optional: the holder line's detail

It is started and stopped with `job start <kind> ['{json}']` / `job stop <kind>` (under
the lock, stopping whichever job holds the V4 first), listed in `status` under `jobs`
(running, since, label, meta, lastExit), paused by scans, and stopped by `stop` and when
Claude Code quits. A module named in PLUGIN_MODULES (scripts/<name>.py) that defines
`radio_modes(radio)` -- `radio` being this module -- and returns a list of Modes is
registered on every call; one that fails to import is listed under `pluginErrors`.

An EXTERNAL mode runs under its own lifecycle instead of the wrapper: `probe()` returns a
pidfile-shaped dict while it runs (children = the process holding the V4), `starter(meta)`
starts it and returns its JSON, `stopper()` stops it. `holds_lock=True` says it keeps
sdr.lock while it runs (Web SDR hands the locked fd to rtl_tcp), so radio.py stops it
before taking the lock, and releases its own lock before calling `starter`.

Web SDR hands a frequency back through handoff.json in the state folder: its page's "Send
to Radio tab" posts {mhz, mode} to webrx/handoff.py (a small server that runs with Web SDR),
which writes {mhz, mode, at, from, origin} here and nothing else. The tab's poll sees the file
and runs `radio.py handoff`: it takes the file (removes it), checks it (24-1766 MHz, wbfm / fm /
am, under HANDOFF_MAX_AGE_S old) and runs listen with meta via="websdr", so Web SDR is stopped
through stop_kind like any job, recorded as "stopped so the V4 could play X in the Radio tab".

The name tables (FM_NAMES, SPOTS, MARKS) and the band activity also feed Web SDR's bookmarks:
`webrx/webrx.py sync-bookmarks` reads them, plus each activity entry's `top` peaks (busy or
strong frequencies from recent scans and the live view), on every Web SDR start.

Driving the V4 directly instead: hold Lock("sdr.lock") (keep holds under ~20 s), check
device()/owner_info(), stop our jobs with stop_kind(kind, why=...). A one-shot run of
adsb.py / digital.py that holds the V4 is named by its script in `holder`.

The listen job's reader (AudioMeter, "the meter tap") is the hook point for what is done with
the audio as it plays: it gets every chunk on its way to the player, and anything slow happens
in its tick(), after the player has the chunk. The Recorder there polls two control files in the
state folder, rec.on (● Rec, with an id and an optional `until`) and log.on (the logger, with
`since`), and the EQ display's AudioSpectrum runs only while eq.seen is fresh (`listen meter`
touches it). A job's reader may end its own job with Stop("done", "what it did").

Everything lives on local disk: state in ~/Library/Application Support/radio,
the lock in ~/Library/Caches/radio, recordings in ~/Radio/Recordings/YYYY-MM-DD (never
~/Documents or ~/Desktop, which sync to iCloud on this Mac). RADIO_DIR moves the state and
RADIO_REC_DIR the recordings for testing.
"""
import array
import atexit
import base64
import json
import math
import os
import re
import signal
import struct
import subprocess
import sys
import time
import zlib
from collections import deque

HOME = os.path.expanduser("~")
STATE = os.environ.get("RADIO_DIR") or os.path.join(HOME, "Library", "Application Support", "radio")
CACHE = os.path.join(HOME, "Library", "Caches", "radio")
SCRIPT = os.path.abspath(__file__)
SCRIPTS = os.path.dirname(SCRIPT)
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import location  # noqa: E402  (where the tab is: Walton, KY unless ~/Library/Application Support/radio/location.json says otherwise)

LOC = location.load_once()
BIN = "/opt/homebrew/bin"
RTL_POWER = os.path.join(BIN, "rtl_power")
RTL_433 = os.path.join(BIN, "rtl_433")
RTL_FM = os.path.join(BIN, "rtl_fm")
RTL_TCP = os.path.join(BIN, "rtl_tcp")
RTL_ADSB = os.path.join(BIN, "rtl_adsb")
# Web SDR (webrx/): OpenWebRX+ in Docker fed by rtl_tcp; its start.sh hands the locked
# sdr.lock fd to rtl_tcp and records rtl_tcp's pid here.
WEBRX_DIR = os.path.join(os.path.dirname(SCRIPTS), "webrx")
WEBRX_PID = os.path.join(CACHE, "webrx-rtl_tcp.pid")
WEBRX_PORT = int(os.environ.get("WEBRX_PORT") or 8073)

GADGETS_LOG = os.path.join(STATE, "gadgets.jsonl")
DEVICES = os.path.join(STATE, "devices.json")
LAST_SCAN = os.path.join(STATE, "last-scan.json")
EXITS = os.path.join(STATE, "exits.json")
HEARTBEAT = os.path.join(STATE, "heartbeat")
LIVE_FRAME = os.path.join(STATE, "live-frame.json")
LIVE_SEEN = os.path.join(STATE, "live.seen")
LIVE_RESET = os.path.join(STATE, "live.reset")
METER = os.path.join(STATE, "meter.json")
EQ = os.path.join(STATE, "eq.json")          # the audio spectrum the tab's EQ display draws
EQ_SEEN = os.path.join(STATE, "eq.seen")     # touched by `listen meter`: the tab is watching
ACTIVITY = os.path.join(STATE, "activity.json")
MESH = os.path.join(STATE, "mesh.json")
HANDOFF = os.path.join(STATE, "handoff.json")   # Web SDR's "Send to Radio tab" (webrx/handoff.py writes it)
HANDOFF_MAX_AGE_S = 120                         # an older one (the tab was closed) is dropped, not played
ROTATE_BYTES = 5 * 1024 * 1024
MAX_DEVICES = 400
HIST_MAX = 288          # readings kept per device (one a minute at most: ~5 h of a 1-min sensor)
HIST_OUT = 96           # readings returned per device by `gadgets list`
# A background job stops by itself when nothing has asked about it (the tab
# polls every 1-30 s) for this long, so a crashed session never keeps the V4.
LEASE_S = int(os.environ.get("RADIO_LEASE_S") or 20 * 60)
LIVE_LEASE_S = int(os.environ.get("RADIO_LIVE_LEASE_S") or 3 * 60)
LIVE_ROWS = 60
LIVE_COLS = 600
WF_COLS = 200           # the index grid for the terminal's cell waterfall
PLUGIN_MODULES = ("adsb", "digital")

# 0.4.0 (the "beat SDR++" pack): a settings panel (PPM, bias-tee, per-mode filter width), SSB/CW
# and the V4's HF upconverter, IQ snapshots, and the Scanner. All receive only.
SETTINGS = os.path.join(STATE, "settings.json")   # ppm, per-mode filter width, bias-tee desired
HF = os.path.join(STATE, "hf.json")               # whether HF reception is confirmed on real air
SCANNER = os.path.join(STATE, "scanner.json")      # the scanner's live state (the scanloop writes it)
SCANNER_CONF = os.path.join(STATE, "scanner-conf.json")  # favourites, lock-outs, dwell/resume/priority
IQ_ROOT = os.path.abspath(os.path.expanduser(os.environ.get("RADIO_IQ_DIR") or os.path.join(HOME, "Radio", "IQ")))
RTL_SDR = os.path.join(BIN, "rtl_sdr")
RTL_BIAST = os.path.join(BIN, "rtl_biast")
IQ_KEEP_GB = 4.0          # the IQ snapshot cap (raw I/Q is large: ~2 MB/s at 1 MS/s cu8)
IQ_MAX_S = 60             # the longest single snapshot
# The V4's built-in HF upconverter: Homebrew's osmocom librtlsdr (>= 2.0) auto-adds 28.8 MHz when
# a Blog V4 is tuned below 28.8 MHz, so HF works through rtl_fm / rtl_power / rtl_sdr with no flag.
HF_MAX_MHZ = 28.8

# ---------------------------------------------------------------- presets and names

PRESETS = {
    "fm": {"label": "FM broadcast", "lo": 87.5, "hi": 108.0, "bin": 25e3, "gain": 20, "sep": 0.25, "steady": 8, "listen": "wbfm"},
    "noaa": {"label": "NOAA weather", "lo": 162.35, "hi": 162.6, "bin": 1e3, "gain": 40, "sep": 0.02, "steady": 6, "listen": "fm"},
    "air": {"label": "Aircraft", "lo": 118.0, "hi": 137.0, "bin": 12.5e3, "gain": 40, "sep": 0.03, "steady": 7, "listen": "am"},
    "2m": {"label": "2 m ham", "lo": 144.0, "hi": 148.0, "bin": 5e3, "gain": 40, "sep": 0.012, "steady": 7, "listen": "fm"},
    "70cm": {"label": "70 cm ham", "lo": 420.0, "hi": 450.0, "bin": 25e3, "gain": 40, "sep": 0.05, "steady": 7, "listen": "fm"},
    "lora": {"label": "Meshtastic / LoRa", "lo": 902.0, "hi": 928.0, "bin": 25e3, "gain": 40, "sep": 0.2, "steady": 6, "listen": None},
    "mesh": {"label": "Mesh watch", "lo": 905.8, "hi": 911.6, "bin": 25e3, "gain": 40, "sep": 0.2, "steady": 6, "listen": None},
    "433": {"label": "433 MHz ISM", "lo": 433.0, "hi": 435.0, "bin": 5e3, "gain": 40, "sep": 0.05, "steady": 6, "listen": None},
    "marine": {"label": "Marine VHF", "lo": 156.0, "hi": 157.45, "bin": 5e3, "gain": 40, "sep": 0.02, "steady": 7, "listen": "fm"},
    "rail": {"label": "Railroad", "lo": 160.2, "hi": 161.6, "bin": 5e3, "gain": 40, "sep": 0.012, "steady": 7, "listen": "fm"},
    "murs": {"label": "MURS", "lo": 151.8, "hi": 154.62, "bin": 5e3, "gain": 40, "sep": 0.02, "steady": 7, "listen": "fm"},
    "gmrs": {"label": "GMRS / FRS", "lo": 462.5, "hi": 467.75, "bin": 12.5e3, "gain": 40, "sep": 0.02, "steady": 7, "listen": "fm"},
    "adsb": {"label": "ADS-B 1090", "lo": 1086.0, "hi": 1094.0, "bin": 25e3, "gain": 40, "sep": 0.4, "steady": 6, "listen": None},
    # HF (0.4.0): through the V4's built-in upconverter. rtl_power sweeps them like any band; they
    # need a long-wire antenna through a 9:1 balun to hear anything but noise.
    "80m": {"label": "80 m ham", "lo": 3.5, "hi": 4.0, "bin": 2e3, "gain": 40, "sep": 0.01, "steady": 6, "listen": "lsb", "hf": True},
    "40m": {"label": "40 m ham", "lo": 7.0, "hi": 7.3, "bin": 1e3, "gain": 40, "sep": 0.006, "steady": 6, "listen": "lsb", "hf": True},
    "20m": {"label": "20 m ham", "lo": 14.0, "hi": 14.35, "bin": 1e3, "gain": 40, "sep": 0.006, "steady": 6, "listen": "usb", "hf": True},
    "49m": {"label": "49 m shortwave", "lo": 5.9, "hi": 6.2, "bin": 1e3, "gain": 40, "sep": 0.008, "steady": 6, "listen": "am", "hf": True},
    "41m": {"label": "41 m shortwave", "lo": 7.2, "hi": 7.6, "bin": 1e3, "gain": 40, "sep": 0.008, "steady": 6, "listen": "am", "hf": True},
    "31m": {"label": "31 m shortwave", "lo": 9.4, "hi": 9.9, "bin": 1e3, "gain": 40, "sep": 0.008, "steady": 6, "listen": "am", "hf": True},
    "25m": {"label": "25 m shortwave", "lo": 11.6, "hi": 12.1, "bin": 1e3, "gain": 40, "sep": 0.008, "steady": 6, "listen": "am", "hf": True},
    "19m": {"label": "19 m shortwave", "lo": 15.1, "hi": 15.8, "bin": 1e3, "gain": 40, "sep": 0.008, "steady": 6, "listen": "am", "hf": True},
}
HF_PRESETS = tuple(k for k, v in PRESETS.items() if v.get("hf"))
ALIASES = {"aircraft": "air", "airband": "air", "weather": "noaa", "wx": "noaa", "2": "2m", "70": "70cm", "70cm": "70cm",
           "meshtastic": "lora", "915": "lora", "meshcore": "mesh", "ism": "433", "433mhz": "433", "broadcast": "fm",
           "boats": "marine", "river": "marine", "railroad": "rail", "trains": "rail", "frs": "gmrs", "1090": "adsb",
           "ads-b": "adsb"}

# FM stations heard around the location (location.json "fm"; Cincinnati from Walton, KY by default).
FM_NAMES = LOC["fm_names"]
# (MHz, tolerance MHz, name, listen mode)
SPOTS = [
    (LOC["weather"]["freq"], 0.006, LOC["weather"]["noaa_name"], "fm"),
    *[(r["mhz"], 0.004, r["name"], "fm") for r in LOC["repeaters"]],
    (146.520, 0.004, "2 m calling (simplex)", "fm"),
    (446.000, 0.006, "70 cm calling (simplex)", "fm"),
    (121.500, 0.012, "aircraft emergency (guard)", "am"),
    (156.800, 0.006, "Marine ch 16 (distress / calling)", "fm"),
    (156.650, 0.006, "Marine ch 13 (bridge-to-bridge" + (f": {LOC['river']['name']} towboats" if LOC["river"].get("name") else "") + ")", "fm"),
    (157.100, 0.006, "Marine ch 22A (Coast Guard)", "fm"),
    (151.820, 0.004, "MURS 1", "fm"),
    (151.880, 0.004, "MURS 2", "fm"),
    (151.940, 0.004, "MURS 3", "fm"),
    (154.570, 0.004, "MURS 4 (blue dot)", "fm"),
    (154.600, 0.004, "MURS 5 (green dot)", "fm"),
    (906.875, 0.15, "Meshtastic LongFast", None),
    (910.525, 0.15, "MeshCore", None),
    (433.920, 0.07, "433.92: sensors, remotes, doorbells", None),
    (1090.0, 0.8, "ADS-B: aircraft transponders", None),
    # HF (0.4.0): public broadcasts and open ham modes through the V4's upconverter.
    (2.500, 0.003, "WWV 2.5 MHz time signal (Fort Collins)", "am"),
    (5.000, 0.003, "WWV 5 MHz time signal (Fort Collins)", "am"),
    (10.000, 0.003, "WWV 10 MHz time signal (Fort Collins)", "am"),
    (15.000, 0.003, "WWV 15 MHz time signal (Fort Collins)", "am"),
    (20.000, 0.003, "WWV 20 MHz time signal (Fort Collins)", "am"),
    (3.330, 0.003, "CHU Canada 3.33 MHz time signal", "am"),
    (7.850, 0.003, "CHU Canada 7.85 MHz time signal", "am"),
    (14.670, 0.003, "CHU Canada 14.67 MHz time signal", "am"),
    (4.625, 0.004, "UVB-76 'The Buzzer' (a well-known public mystery broadcast)", "usb"),
    (7.0386, 0.0012, "40 m WSPR beacons", "usb"),
    (7.074, 0.002, "40 m FT8", "usb"),
    (7.171, 0.002, "40 m SSTV (LSB)", "lsb"),
    (14.0956, 0.0012, "20 m WSPR beacons", "usb"),
    (14.074, 0.002, "20 m FT8", "usb"),
    (14.230, 0.002, "20 m SSTV", "usb"),
    (8.502, 0.003, "NMG New Orleans weather fax 8503.9 kHz (USB dial 8502.0)", "usb"),
    (0.518, 0.002, "NAVTEX 518 kHz (international maritime safety broadcasts)", "usb"),
]
MARKS = {
    "noaa": [(LOC["weather"]["freq"], LOC["weather"]["station"] or "NOAA")],
    "air": [(121.5, "121.5 guard")],
    "2m": [(146.52, "146.52 calling")] + [(r["mhz"], f"{r['mhz']:g} {r.get('short') or r['name']}") for r in LOC["repeaters"] if r.get("mark")],
    "70cm": [(433.92, "433.92"), (446.0, "446.0 calling")],
    "lora": [(906.875, "Meshtastic"), (910.525, "MeshCore")],
    "mesh": [(906.875, "Meshtastic"), (910.525, "MeshCore")],
    "433": [(433.92, "433.92")],
    "marine": [(156.8, "ch 16"), (156.65, "ch 13")],
    "murs": [(151.94, "MURS 3"), (154.57, "MURS 4")],
    "gmrs": [(462.5625, "FRS 1"), (462.675, "GMRS 20")],
    "adsb": [(1090.0, "1090")],
    "80m": [(3.573, "FT8"), (3.33, "CHU")],
    "40m": [(7.0386, "WSPR"), (7.074, "FT8"), (7.171, "SSTV")],
    "20m": [(14.0956, "WSPR"), (14.074, "FT8"), (14.23, "SSTV")],
    "49m": [(5.0, "WWV 5"), (6.0, "49 m")],
    "41m": [(7.4, "41 m")],
    "31m": [(9.7, "31 m")],
    "25m": [(11.8, "25 m")],
    "19m": [(15.3, "19 m")],
}
MESH_CHANNELS = (("mt", 906.875, "Meshtastic LongFast"), ("mc", 910.525, "MeshCore"))


def fm_channel(mhz):
    """The nearest US FM channel (odd tenths, 87.9-107.9)."""
    return round(round((mhz - 87.9) / 0.2) * 0.2 + 87.9, 1)


def frs_channel(mhz):
    for ch in range(1, 23):
        f = 462.5625 + 0.025 * (ch - 1) if ch <= 7 else 467.5625 + 0.025 * (ch - 8) if ch <= 14 else 462.550 + 0.025 * (ch - 15)
        if abs(mhz - f) < 0.004:
            return ch
    return None


def marine_channel(mhz):
    if not 156.0 <= mhz <= 157.45:
        return None
    k = (mhz - 156.0) / 0.05
    if abs(k - round(k)) * 0.05 < 0.004 and 1 <= round(k) <= 28:
        return str(round(k))
    k = (mhz - 156.025) / 0.05
    if abs(k - round(k)) * 0.05 < 0.004 and 0 <= round(k) <= 28:
        return str(60 + round(k))
    return None


def name_for(mhz, preset=None):
    """(name, listen mode) for a frequency, or (None, guess)."""
    if 87.5 <= mhz <= 108.0:
        ch = fm_channel(mhz)
        if abs(ch - mhz) < 0.07:
            return (f"{ch:.1f} {FM_NAMES[ch]}" if ch in FM_NAMES else f"{ch:.1f} FM"), "wbfm"
    for f, tol, name, mode in SPOTS:
        if abs(mhz - f) <= tol:
            return name, mode
    if 162.39 <= mhz <= 162.56:
        return "NOAA weather radio", "fm"
    ch = marine_channel(mhz)
    if ch:
        return f"Marine ch {ch}", "fm"
    if 160.2 <= mhz <= 161.6:
        return "railroad radio", "fm"
    ch = frs_channel(mhz)
    if ch:
        return f"FRS / GMRS ch {ch}", "fm"
    for k in range(1, 70):
        if abs(mhz - 28.8 * k) < 0.012:
            return f"the V4's own spur ({k} x 28.8 MHz)", None
    return None, guess_mode(mhz)


def guess_mode(mhz):
    if mhz < HF_MAX_MHZ:
        # HF: shortwave broadcasting is AM; the ham bands are SSB (LSB below 10 MHz, USB above).
        if 3.5 <= mhz <= 4.0 or 7.0 <= mhz <= 7.3:
            return "lsb"
        if 14.0 <= mhz <= 14.35 or 18.068 <= mhz <= 18.168 or 21.0 <= mhz <= 21.45 or 24.89 <= mhz <= 24.99 or 28.0 <= mhz <= 28.8:
            return "usb"
        return "am"
    if 87.5 <= mhz <= 108.0:
        return "wbfm"
    if 108.0 <= mhz <= 137.0:
        return "am"
    if 902 <= mhz <= 928 or 433.0 <= mhz <= 435.0 or 1085 <= mhz <= 1095:
        return None
    return "fm"


def mode_label(mode):
    return {"wbfm": "wide FM", "fm": "narrow FM", "am": "AM", "usb": "upper sideband", "lsb": "lower sideband",
            "cw": "CW (Morse)"}.get(mode, mode or "")


AUDIO_MODES = ("wbfm", "fm", "am", "usb", "lsb", "cw")
# rtl_fm's own demodulators. CW is USB with a BFO offset (below), so the carrier lands as a tone.
RTL_FM_MODE = {"wbfm": "wbfm", "fm": "fm", "am": "am", "usb": "usb", "lsb": "lsb", "cw": "usb"}
MODE_ALIASES = {"wfm": "wbfm", "wide": "wbfm", "nfm": "fm", "narrow": "fm", "ssb": "usb", "morse": "cw"}
CW_BFO_HZ = 700             # CW is tuned 700 Hz low on USB, so the signal beats at 700 Hz
# Default rtl_fm filter / output rate per mode (Hz); the settings panel can narrow fm/am/ssb/cw.
MODE_RATE = {"am": 12000, "fm": 24000, "usb": 12000, "lsb": 12000, "cw": 12000}


def band_params(preset, lo=None, hi=None, bin_khz=None):
    """A preset's scan parameters, or a custom range's."""
    if preset != "custom":
        return dict(PRESETS[preset], preset=preset)
    span = hi - lo
    bin_hz = 1e3 if span <= 0.5 else 5e3 if span <= 5 else 12.5e3 if span <= 20 else 25e3 if span <= 40 else 100e3
    if bin_khz:
        bin_hz = bin_khz * 1e3
    return {"preset": "custom", "label": f"Custom {lo:g}-{hi:g} MHz", "lo": lo, "hi": hi, "bin": bin_hz, "gain": 40,
            "sep": max(span / 60, bin_hz * 3 / 1e6), "steady": 7, "listen": None}


# ---------------------------------------------------------------- plumbing

def out(obj):
    print(json.dumps(obj, separators=(",", ":")))
    sys.stdout.flush()
    sys.exit(0)


def now_ms():
    return int(time.time() * 1000)


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, obj):
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)


def settings():
    """The radio settings the panel owns: PPM, per-mode filter width (rtl_fm -s, Hz), bias-tee
    desired state. Missing keys fall back to the defaults, so an empty file is fine."""
    s = read_json(SETTINGS, {}) or {}
    try:
        ppm = int(s.get("ppm") or 0)
    except (TypeError, ValueError):
        ppm = 0
    filters = {}
    for m, default in MODE_RATE.items():
        try:
            filters[m] = int(s.get("filters", {}).get(m) or default)
        except (TypeError, ValueError):
            filters[m] = default
    return {"ppm": ppm, "filters": filters, "biast": bool(s.get("biast"))}


def settings_set(**kw):
    s = read_json(SETTINGS, {}) or {}
    for k, v in kw.items():
        if k == "filter" and isinstance(v, tuple):   # ("fm", 8000)
            s.setdefault("filters", {})[v[0]] = v[1]
        else:
            s[k] = v
    write_json(SETTINGS, s)
    return settings()


def ppm_args(extra=None):
    """-p <ppm> for any rtl_* tool, from the settings (or an override). 0 adds nothing."""
    p = extra if extra is not None else settings()["ppm"]
    return ["-p", str(int(p))] if p else []


def touch(path):
    try:
        with open(path, "a"):
            pass
        os.utime(path, None)
    except OSError:
        pass


def touch_heartbeat():
    touch(HEARTBEAT)


def mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


class Lock:
    """One caller at a time drives the V4 (the tab polls; Claude or a terminal may call too)."""

    def __init__(self, name, wait=45.0):
        import fcntl
        self.fcntl = fcntl
        os.makedirs(CACHE, exist_ok=True)
        self.f = open(os.path.join(CACHE, name), "w")
        end = time.time() + wait
        while True:
            try:
                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return
            except BlockingIOError:
                if time.time() > end:
                    out({"ok": False, "error": "busy", "say": "Another radio command is still running (a scan takes about 10 s). Try again in a moment."})
                time.sleep(0.2)

    def release(self):
        try:
            self.fcntl.flock(self.f, self.fcntl.LOCK_UN)
        except OSError:
            pass


def run(argv, timeout=10):
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ""


def proc_name(pid):
    return run(["/bin/ps", "-o", "comm=", "-p", str(pid)], 5).strip()


def alive(pid, names=None):
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except (OSError, ValueError):
        return False
    if names:
        comm = os.path.basename(proc_name(pid))
        return any(n in comm for n in names)
    return True


def clamp(v, a=0.0, b=1.0):
    return a if v < a else b if v > b else v


def median(xs):
    s = sorted(xs)
    n = len(s)
    return (s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2) if n else 0.0


def pct(xs, q):
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, int(q * (len(s) - 1))))] if s else 0.0


# ---------------------------------------------------------------- the V4 on USB

def device():
    """The RTL-SDR from the USB tree (ioreg), without opening it, and who holds it."""
    text = run(["/usr/sbin/ioreg", "-r", "-c", "IOUSBHostDevice", "-l", "-w0"], 15)
    devs = []
    cur = None
    for line in text.splitlines():
        m = re.search(r"\+-o (.+?)@[0-9a-f]+\s+<class IOUSBHostDevice", line)
        if m:
            cur = {"node": m.group(1)}
            devs.append(cur)
            continue
        if cur is None:
            continue
        for key, field in (("idVendor", "vid"), ("idProduct", "pid")):
            m = re.search(rf'"{key}" = (\d+)', line)
            if m and field not in cur:
                cur[field] = int(m.group(1))
        m = re.search(r'"USB Product Name" = "([^"]*)"', line)
        if m and "product" not in cur:
            cur["product"] = m.group(1)
        m = re.search(r'"USB Serial Number" = "([^"]*)"', line)
        if m and "serial" not in cur:
            cur["serial"] = m.group(1)
        m = re.search(r'"UsbExclusiveOwner" = "pid (\d+), ([^"]*)"', line)
        if m and "owner" not in cur:
            cur["owner"] = {"pid": int(m.group(1)), "name": m.group(2)}
    for d in devs:
        is_v4 = "blog v4" in (d.get("product") or d["node"]).lower()
        is_rtl = d.get("vid") == 0x0BDA and d.get("pid") in (0x2838, 0x2832)
        if is_v4 or is_rtl:
            return {"present": True, "name": d.get("product") or d["node"], "serial": d.get("serial"),
                    "usb": f"{d.get('vid', 0):04x}:{d.get('pid', 0):04x}", "owner": d.get("owner")}
    return {"present": False, "owner": None}


APP_NAMES = {"sdrpp": "SDR++", "sdr++": "SDR++", "cubicsdr": "CubicSDR", "gqrx": "Gqrx", "sdrangel": "SDRangel",
             "google chrome": "a web page in Chrome (WebUSB)", "rtl_tcp": "rtl_tcp", "rtl_433": "rtl_433",
             "rtl_fm": "rtl_fm", "rtl_power": "rtl_power", "rtl_test": "rtl_test", "rtl_sdr": "rtl_sdr",
             "rtl_adsb": "rtl_adsb", "dump1090": "dump1090", "readsb": "readsb"}


ONESHOT = {("adsb", "run"): "Planes (a one-shot adsb.py run)", ("digital", "aprs"): "APRS (a one-shot digital.py run)",
           ("digital", "same"): "Weather alerts (a one-shot digital.py run)", ("digital", "record"): "a digital.py recording"}


def oneshot_label(pid):
    """A one-shot run of adsb.py / digital.py holds the V4 under the lock without a job: name
    it by its script (its tool's parent) rather than as an outside rtl_adsb / rtl_fm."""
    ppid = run(["/bin/ps", "-o", "ppid=", "-p", str(pid)], 5).strip()
    if not ppid.isdigit() or ppid == "1":
        return None
    m = re.search(r"/(adsb|digital)\.py\s+(\w+)", run(["/bin/ps", "-o", "args=", "-p", ppid], 5))
    return ONESHOT.get((m.group(1), m.group(2))) if m else None


def owner_info(owner):
    """Who holds the V4: one of our jobs (`ours`, `app` its label), or another program (likely SDR++)."""
    if not owner:
        return None
    o = dict(owner)
    o["app"] = APP_NAMES.get(owner["name"].lower(), owner["name"])
    for kind in MODES:
        info = read_pid(kind)
        if info and owner["pid"] in (info.get("children") or []):
            o["ours"] = kind
            o["app"] = MODES[kind].label
    if "ours" not in o and owner["name"] in ("rtl_adsb", "rtl_fm"):
        label = oneshot_label(owner["pid"])
        if label:
            o["app"] = label
            o["oneshot"] = True
    return o


def wait_free(seconds=4.0):
    end = time.time() + seconds
    while time.time() < end:
        d = device()
        if not d["present"] or not d.get("owner"):
            return d
        time.sleep(0.25)
    return device()


# ---------------------------------------------------------------- the MODES registry

class Mode:
    """One kind of exclusive V4 job (see HOOK POINTS at the top)."""

    def __init__(self, kind, label, children, pipeline=None, reader=None, forward=False, lease_s=None,
                 heartbeat=None, doing=None, stdout_log=False, detail=None, probe=None, starter=None,
                 stopper=None, holds_lock=False):
        self.kind = kind
        self.label = label
        self.children = tuple(children)
        self.pipeline = pipeline
        self.reader = reader
        self.forward = forward
        self.lease_s = LEASE_S if lease_s is None else lease_s
        self.heartbeat = heartbeat
        self.doing = doing or (lambda meta: f"run {label}")
        self.stdout_log = stdout_log
        self.detail = detail
        # External modes (see HOOK POINTS): their own lifecycle, recognised by probe().
        self.probe = probe
        self.starter = starter
        self.stopper = stopper
        self.holds_lock = holds_lock
        self.result = None


MODES = {}
PLUGIN_ERRORS = {}
LOCKS = []      # the lock main() holds, released before an external mode's starter runs
EARLY = {}      # lock-holding external jobs stopped before taking the lock: kind -> their info


def register_mode(mode):
    MODES[mode.kind] = mode
    return mode


def load_plugin_modes():
    """Modes other modules add: scripts/<name>.py defining radio_modes(radio) -> [Mode, ...]."""
    me = sys.modules[__name__]
    sys.modules.setdefault("radio", me)
    sys.dont_write_bytecode = True
    if SCRIPTS not in sys.path:
        sys.path.insert(0, SCRIPTS)
    for name in PLUGIN_MODULES:
        if not os.path.exists(os.path.join(SCRIPTS, f"{name}.py")):
            continue
        try:
            mod = __import__(name)
            fn = getattr(mod, "radio_modes", None)
            if fn:
                for m in fn(me) or []:
                    register_mode(m)
        except Exception as err:  # a broken module never breaks the radio
            PLUGIN_ERRORS[name] = f"{type(err).__name__}: {err}"[:200]


# ---------------------------------------------------------------- background jobs

def pid_path(kind):
    return os.path.join(STATE, f"{kind}.pid")


def read_pid(kind):
    mode = MODES.get(kind)
    if mode is not None and mode.probe:
        return mode.probe()
    info = read_json(pid_path(kind))
    if not info or not alive(info.get("pid"), ("python", "Python", "radio")):
        return None
    return info


def free_lock_holders():
    """An external job that keeps sdr.lock (Web SDR) is stopped before radio.py takes the
    lock; stop_kind records why once the caller knows what the V4 is wanted for."""
    for kind, mode in MODES.items():
        if mode.holds_lock and mode.stopper:
            info = read_pid(kind)
            if info:
                mode.stopper()
                EARLY[kind] = info


def lock_holder_running():
    return any(m.holds_lock and read_pid(k) for k, m in MODES.items())


@atexit.register
def _early_unrecorded():
    for kind in list(EARLY):  # stopped early, but the command then did not start anything
        EARLY.pop(kind, None)
        record_exit(kind, "preempted", "stopped so the V4 could be used by the Radio tab")


def record_exit(kind, reason, detail=""):
    ex = read_json(EXITS, {}) or {}
    ex[kind] = {"at": now_ms(), "reason": reason, "detail": detail}
    write_json(EXITS, ex)


def clear_exit(kind):
    ex = read_json(EXITS, {}) or {}
    if kind in ex:
        del ex[kind]
        write_json(EXITS, ex)


def log_reason(kind):
    """Why a tool stopped, from the tail of its stderr."""
    try:
        with open(os.path.join(STATE, f"{kind}.log"), errors="replace") as f:
            tail = f.read()[-4000:]
    except OSError:
        return "exited", ""
    low = tail.lower()
    if "usb_claim_interface" in low or "resource busy" in low or "failed to open" in low:
        return "busy", "Another program has the V4 (likely SDR++). Close it and try again."
    if "no supported devices" in low or "no matching devices" in low or "no devices found" in low:
        return "missing", "The V4 is not plugged in."
    last = [l for l in tail.strip().splitlines() if l.strip()]
    return "exited", last[-1][:200] if last else ""


def stop_kind(kind, record=True, why=""):
    """Stops one job and its children; returns its meta if it was running. `why` (what the
    V4 is needed for) is recorded as a "preempted" exit the tab shows."""
    mode = MODES.get(kind)
    if mode is not None and mode.stopper:
        info = read_pid(kind)
        if info:
            mode.stopper()
        info = info or EARLY.get(kind)
        EARLY.pop(kind, None)
        if not info:
            return None
        if record:
            record_exit(kind, "preempted", f"stopped so the V4 could {why}") if why else record_exit(kind, "stopped")
        return info.get("meta") or {"job": kind}
    info = read_json(pid_path(kind))
    if not info:
        return None
    wrapper_pid = info.get("pid")
    was = alive(wrapper_pid, ("python", "Python", "radio"))
    if was:
        try:
            os.kill(wrapper_pid, signal.SIGTERM)
        except OSError:
            pass
        end = time.time() + 4
        while time.time() < end and alive(wrapper_pid):
            time.sleep(0.1)
        if alive(wrapper_pid):
            try:
                os.kill(wrapper_pid, signal.SIGKILL)
            except OSError:
                pass
    for c in info.get("children") or []:
        if mode and alive(c, mode.children):
            try:
                os.kill(c, signal.SIGKILL)
            except OSError:
                pass
    try:
        os.remove(pid_path(kind))
    except OSError:
        pass
    if record and was:
        if why:
            record_exit(kind, "preempted", f"stopped so the V4 could {why}")
        else:
            record_exit(kind, "stopped")
    return (info.get("meta") or {"job": kind}) if was else None


def start_kind(kind, meta, stop_others=True):
    """Starts a job detached (its own session, so it outlives this call), or an external
    mode through its starter (the lock released first). Returns (ok, say, stopped, error)."""
    mode = MODES[kind]
    stopped = []
    if stop_others:
        why = mode.doing(meta)
        for k in list(MODES):
            m = stop_kind(k, why=why if k != kind else "")
            if m and k != kind:
                stopped.append({"kind": k, **m})
    if mode.starter:
        if stopped:
            wait_free()
        for lk in LOCKS:  # the starter takes sdr.lock itself (Web SDR keeps it)
            lk.release()
        clear_exit(kind)
        res = mode.starter(meta) or {}
        mode.result = res
        return bool(res.get("ok")), res.get("say") or "", stopped, res.get("error")
    d = wait_free() if stopped else device()
    if not d["present"]:
        return False, "The RTL-SDR (Blog V4) is not plugged in.", stopped, "missing"
    o = owner_info(d.get("owner"))
    if o and not o.get("ours"):
        return False, f"The V4 is in use by {o['app']} (pid {o['pid']}). It can be used by one program at a time: close {o['app']} first.", stopped, "busy"
    clear_exit(kind)
    try:
        os.remove(pid_path(kind))
    except OSError:
        pass
    with open(os.path.join(STATE, f"{kind}.log"), "w") as log:
        subprocess.Popen([sys.executable, SCRIPT, "_run", kind, json.dumps(meta)], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=log, start_new_session=True, close_fds=True, cwd=STATE)
    # Up and holding the V4, or dead with a reason.
    end = time.time() + 6
    while time.time() < end:
        time.sleep(0.3)
        info = read_pid(kind)
        ex = (read_json(EXITS, {}) or {}).get(kind)
        if ex:
            return False, ex.get("detail") or f"{kind} stopped: {ex.get('reason')}", stopped, ex.get("reason")
        if info:
            o = device().get("owner")
            if o and o["pid"] in (info.get("children") or []):
                return True, "", stopped, None
    if read_pid(kind):
        return True, "", stopped, None
    return False, f"{kind} did not start.", stopped, "exited"


class Stop(Exception):
    pass


def _raise_stop(*_):
    raise Stop()


def wrapper(kind, meta):
    """The detached job, for any mode: starts the pipeline, writes the pidfile, feeds the
    reader, honours the lease, and stops its children on SIGTERM."""
    import select
    mode = MODES[kind]
    signal.signal(signal.SIGTERM, _raise_stop)
    signal.signal(signal.SIGINT, _raise_stop)
    signal.signal(signal.SIGHUP, _raise_stop)
    log = open(os.path.join(STATE, f"{kind}.log"), "a")
    procs = []
    reason, detail = "stopped", ""
    reader = None
    try:
        argvs = mode.pipeline(meta)
        reader = mode.reader(meta) if mode.reader else None
        for i, argv in enumerate(argvs):
            last = i == len(argvs) - 1
            if i == 0:
                stdout = subprocess.PIPE if (reader or not last) else (log if mode.stdout_log else subprocess.DEVNULL)
                procs.append(subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=log))
            else:
                tap = reader is not None and i == 1
                stdin = subprocess.PIPE if tap else procs[-1].stdout
                stdout = subprocess.DEVNULL if last else subprocess.PIPE
                procs.append(subprocess.Popen(argv, stdin=stdin, stdout=stdout, stderr=log))
                if not tap:
                    procs[-2].stdout.close()
        write_json(pid_path(kind), {"pid": os.getpid(), "kind": kind, "started": now_ms(), "meta": meta,
                                    "children": [p.pid for p in procs]})
        beat = mode.heartbeat or HEARTBEAT
        touch(beat)
        lease = 0 if os.environ.get("RADIO_NO_LEASE") or meta.get("keep") else mode.lease_s
        every = min(30, max(2, lease // 4)) if lease else 30
        next_check = time.time() + every
        fd = procs[0].stdout.fileno() if reader else None
        sink = procs[1].stdin if (reader and mode.forward and len(procs) > 1) else None
        while True:
            if fd is not None:
                r, _, _ = select.select([fd], [], [], 0.25)
                if r:
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        procs[0].wait(timeout=5)
                    else:
                        reader.feed(chunk)
                        if sink is not None:
                            try:
                                sink.write(chunk)
                                sink.flush()
                            except (BrokenPipeError, OSError):
                                sink = None
                reader.tick()
            else:
                time.sleep(1.0)
            dead = [p for p in procs if p.poll() is not None]
            if dead:
                log.flush()
                reason, detail = log_reason(kind)
                break
            if time.time() > next_check:
                next_check = time.time() + every
                idle = time.time() - (mtime(beat) or time.time())
                if lease and idle > lease:
                    who = "the live view was not on screen" if kind == "live" else "the Radio tab was closed"
                    reason, detail = "lease", f"Stopped after {max(1, round(lease / 60))} min with nobody watching ({who})."
                    break
    except Stop as s:
        # A reader may end its own job (a timed recording done): Stop("done", "what it did").
        reason = s.args[0] if s.args else "stopped"
        detail = s.args[1] if len(s.args) > 1 else ""
    except Exception as err:
        reason, detail = "exited", f"{type(err).__name__}: {err}"[:200]
    finally:
        for p in procs:
            if p.poll() is None:
                try:
                    p.terminate()
                except OSError:
                    pass
        end = time.time() + 3
        for p in procs:
            try:
                p.wait(timeout=max(0.1, end - time.time()))
            except Exception:
                try:
                    p.kill()
                except OSError:
                    pass
        if reader:
            try:
                reader.close()
            except Exception:
                pass
        info = read_json(pid_path(kind))
        if info and info.get("pid") == os.getpid():
            try:
                os.remove(pid_path(kind))
            except OSError:
                pass
        if reason != "stopped":
            record_exit(kind, reason, detail)


# ---------------------------------------------------------------- gadgets (rtl_433)

KEEP_FIELDS = ("temperature_C", "temperature_F", "temperature_1_C", "temperature_2_C", "humidity", "pressure_hPa",
               "pressure_kPa", "pressure_PSI", "wind_avg_km_h", "wind_max_km_h", "wind_avg_m_s", "wind_max_m_s",
               "wind_avg_mi_h", "wind_max_mi_h", "wind_dir_deg", "rain_mm", "rain_in", "battery_ok", "battery_mV",
               "button", "cmd", "event", "state", "code", "power_W", "power0_W", "energy_kWh", "consumption",
               "moisture", "light_lux", "uv", "alarm", "tamper", "contact_open", "motion", "subtype", "type", "mic")


def temp_c(f):
    tc = f.get("temperature_C")
    if tc is None and f.get("temperature_F") is not None:
        tc = (f["temperature_F"] - 32) * 5 / 9
    return tc


def same_readings(a, b, tol_c=0.25, tol_h=1):
    """Two decodes carry the same readings (one transmitter decoded as two models)."""
    ta, tb = temp_c(a), temp_c(b)
    ha, hb = a.get("humidity"), b.get("humidity")
    if ta is None and ha is None:
        return False
    if (ta is None) != (tb is None) or (ha is None) != (hb is None):
        return False
    if ta is not None and abs(ta - tb) > tol_c:
        return False
    if ha is not None and abs(ha - hb) > tol_h:
        return False
    return True


def hist_point(t, f):
    tc = temp_c(f)
    b = f.get("battery_ok")
    return [t, round(tc, 2) if tc is not None else None, f.get("humidity"), b if b in (0, 1) else None]


def parse_time(s):
    try:
        return int(time.mktime(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S")) * 1000)
    except Exception:
        return None


class Registry:
    """Every device rtl_433 has decoded, keyed by (model, id, channel), with a reading history;
    written by the listener alone."""

    def __init__(self):
        self.data = read_json(DEVICES, None) or {"devices": {}}
        self.dirty = False
        self.saved = 0.0
        self.out = None
        self.recent = {}
        self.backfill()

    def backfill(self):
        """Builds the history of devices heard before 0.2.0 from the raw log."""
        devs = self.data["devices"]
        need = {k for k, d in devs.items() if "hist" not in d}
        if not need:
            return
        for d in devs.values():
            d.setdefault("hist", [])
        for path in (GADGETS_LOG + ".1", GADGETS_LOG):
            try:
                with open(path, "rb") as f:
                    for line in f:
                        try:
                            ev = json.loads(line)
                        except ValueError:
                            continue
                        key = f"{ev.get('model')}|{ev.get('id', '')}|{ev.get('channel', '')}"
                        if key not in need:
                            continue
                        t = parse_time(str(ev.get("time", "")))
                        if t is None:
                            continue
                        h = devs[key]["hist"]
                        if h and t - h[-1][0] < 55_000:
                            continue
                        h.append(hist_point(t, {k: ev[k] for k in KEEP_FIELDS if k in ev}))
                        del h[:-HIST_MAX]
            except OSError:
                continue
        self.dirty = True

    def write_line(self, line):
        try:
            if self.out is None:
                self.out = open(GADGETS_LOG, "ab")
            self.out.write(line + b"\n")
            self.out.flush()
            if self.out.tell() > ROTATE_BYTES:
                self.out.close()
                self.out = None
                os.replace(GADGETS_LOG, GADGETS_LOG + ".1")
        except OSError:
            pass

    def add(self, line):
        line = line.strip()
        if not line.startswith(b"{"):
            return
        self.write_line(line)
        try:
            ev = json.loads(line)
        except ValueError:
            return
        model = ev.get("model")
        if not model:
            return
        key = f"{model}|{ev.get('id', '')}|{ev.get('channel', '')}"
        t = now_ms()
        devs = self.data["devices"]
        d = devs.get(key)
        if d is None:
            d = devs[key] = {"key": key, "model": model, "id": ev.get("id"), "channel": ev.get("channel"),
                             "first": t, "last": t, "count": 0, "fields": {}, "hist": []}
        # Most sensors repeat each packet 2-3 times; count one transmission per 2 s.
        fresh = t - self.recent.get(key, 0) > 2000
        if fresh:
            d["count"] += 1
        self.recent[key] = t
        d["last"] = t
        for k in ("rssi", "snr", "noise", "freq"):
            if k in ev:
                d[k] = ev[k]
        for k in KEEP_FIELDS:
            if k in ev:
                d["fields"][k] = ev[k]
        h = d.setdefault("hist", [])
        if fresh and (not h or t - h[-1][0] >= 55_000):
            h.append(hist_point(t, d["fields"]))
            del h[:-HIST_MAX]
        # One transmitter decoded as two models (LaCrosse-TX141THBv2 and TFA-303221 both claim
        # id 163): same id, same readings, within ~2 s. Link them; `gadgets list` shows one card.
        for ok, od in devs.items():
            if ok != key and od["model"] != model and od.get("id") == d.get("id") and t - od["last"] <= 2500 \
                    and same_readings(od.get("fields") or {}, d["fields"]):
                d["twin"] = ok
                od["twin"] = key
        self.dirty = True
        if len(devs) > MAX_DEVICES:
            for k in sorted(devs, key=lambda x: devs[x]["last"])[: len(devs) - MAX_DEVICES]:
                del devs[k]

    def save_if_due(self):
        if self.dirty and time.time() - self.saved > 1.5:
            self.save()

    def save(self, force=False):
        if self.dirty or force:
            self.data["updated"] = now_ms()
            write_json(DEVICES, self.data)
            self.dirty = False
            self.saved = time.time()


class GadgetReader:
    """The gadgets job's reader: rtl_433's JSON lines into the registry."""

    def __init__(self):
        self.reg = Registry()
        self.buf = b""

    def feed(self, chunk):
        self.buf += chunk
        *lines, self.buf = self.buf.split(b"\n")
        for line in lines:
            self.reg.add(line)

    def tick(self):
        self.reg.save_if_due()

    def close(self):
        self.reg.save(force=True)


def kind_of(model, f):
    m = model.lower()
    if "tpms" in m or (("pressure_kpa" in {k.lower() for k in f} or "pressure_PSI" in f) and "temperature_C" in f and "humidity" not in f):
        return "tire-pressure sensor (likely a passing car)"
    if "doorbell" in m or "chime" in m:
        return "doorbell"
    if "smoke" in m:
        return "smoke alarm"
    if "water" in m and "leak" in m or "leak" in m:
        return "water-leak sensor"
    if "motion" in m or "pir" in m or "motion" in f:
        return "motion sensor"
    if "contact" in m or "door" in m or "window" in m or "contact_open" in f:
        return "door / window sensor"
    if any(k in f for k in ("power_W", "power0_W", "energy_kWh", "consumption")) or any(x in m for x in ("efergy", "currentcost", "ert-", "scm", "idm", "energy", "meter")):
        return "power / utility meter"
    if any(x in m for x in ("bbq", "meat", "grill", "thermopro-tp")):
        return "food thermometer"
    if "pool" in m:
        return "pool thermometer"
    if "soil" in m or "moisture" in f:
        return "soil-moisture sensor"
    if any(k in f for k in ("wind_avg_km_h", "wind_avg_m_s", "wind_avg_mi_h", "rain_mm", "rain_in")):
        return "weather station"
    if "temperature_C" in f or "temperature_F" in f or "humidity" in f:
        return "outdoor temperature / humidity sensor" if "tower" in m or "outdoor" in m else "temperature / humidity sensor"
    if any(x in m for x in ("remote", "keyfob", "key", "switch", "button", "garage", "gate", "fan", "light")) or any(k in f for k in ("button", "cmd")):
        return "remote / button"
    if any(x in m for x in ("security", "interlogix", "dsc", "honeywell", "visonic", "2gig")):
        return "security-system sensor"
    return "unknown gadget"


def c_to_f(c):
    return c * 9 / 5 + 32


def readings(f):
    """Plain-English readings, °F first."""
    parts = []
    tc = temp_c(f)
    if tc is not None:
        parts.append(f"{c_to_f(tc):.1f}°F ({tc:.1f}°C)")
    if f.get("humidity") is not None:
        parts.append(f"{f['humidity']:.0f}% humidity")
    if f.get("pressure_hPa") is not None:
        parts.append(f"{f['pressure_hPa']:.0f} hPa")
    kpa = f.get("pressure_kPa")
    psi = f.get("pressure_PSI")
    if kpa is not None or psi is not None:
        psi = psi if psi is not None else kpa * 0.145038
        parts.append(f"tire {psi:.0f} psi")
    wind = f.get("wind_avg_mi_h")
    if wind is None and f.get("wind_avg_km_h") is not None:
        wind = f["wind_avg_km_h"] * 0.621371
    if wind is None and f.get("wind_avg_m_s") is not None:
        wind = f["wind_avg_m_s"] * 2.23694
    if wind is not None:
        gust = f.get("wind_max_mi_h")
        if gust is None and f.get("wind_max_km_h") is not None:
            gust = f["wind_max_km_h"] * 0.621371
        if gust is None and f.get("wind_max_m_s") is not None:
            gust = f["wind_max_m_s"] * 2.23694
        s = f"wind {wind:.0f} mph"
        if gust is not None:
            s += f", gust {gust:.0f}"
        if f.get("wind_dir_deg") is not None:
            s += f" from {f['wind_dir_deg']:.0f}°"
        parts.append(s)
    if f.get("rain_in") is not None:
        parts.append(f"rain {f['rain_in']:.2f} in total")
    elif f.get("rain_mm") is not None:
        parts.append(f"rain {f['rain_mm'] / 25.4:.2f} in total")
    for k in ("power_W", "power0_W"):
        if f.get(k) is not None:
            parts.append(f"{f[k]:.0f} W")
            break
    if f.get("energy_kWh") is not None:
        parts.append(f"{f['energy_kWh']} kWh")
    if f.get("moisture") is not None:
        parts.append(f"moisture {f['moisture']}%")
    for k in ("button", "cmd", "event", "state", "code"):
        if f.get(k) not in (None, "", 0, False):
            parts.append(f"{'button' if k == 'button' else k} {f[k]}" + (" pressed" if k == "button" else ""))
            break
    if f.get("contact_open") is not None:
        parts.append("open" if f["contact_open"] else "closed")
    if f.get("alarm"):
        parts.append("alarm")
    return " · ".join(parts)


def twin_groups(devs):
    """Groups of registry entries that are one transmitter: linked by the listener (two models
    within ~2 s with the same readings), or the same id under two models with matching readings,
    frequency and overlapping times."""
    parent = {d["key"]: d["key"] for d in devs}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k

    def link(a, b):
        parent[find(a)] = find(b)

    by_key = {d["key"]: d for d in devs}
    for d in devs:
        t = d.get("twin")
        if t in by_key:
            link(d["key"], t)
    for i, a in enumerate(devs):
        for b in devs[i + 1:]:
            if a["model"] == b["model"] or a.get("id") is None or a.get("id") != b.get("id"):
                continue
            if not same_readings(a.get("fields") or {}, b.get("fields") or {}, 0.6, 2):
                continue
            if a.get("freq") and b.get("freq") and abs(a["freq"] - b["freq"]) > 0.05:
                continue
            if max(a["first"], b["first"]) - min(a["last"], b["last"]) > 15 * 60_000:
                continue
            link(a["key"], b["key"])
    groups = {}
    for d in devs:
        groups.setdefault(find(d["key"]), []).append(d)
    return list(groups.values())


def merge_group(g):
    if len(g) == 1:
        return dict(g[0])
    g = sorted(g, key=lambda d: d["count"], reverse=True)
    newest = max(g, key=lambda d: d["last"])
    m = dict(newest)
    m["key"] = g[0]["key"]
    m["models"] = [d["model"] for d in g]
    m["model"] = " / ".join(m["models"])
    m["first"] = min(d["first"] for d in g)
    m["last"] = newest["last"]
    m["count"] = max(d["count"] for d in g)
    hist = sorted((p for d in g for p in d.get("hist") or []), key=lambda p: p[0])
    merged = []
    for p in hist:
        if merged and p[0] - merged[-1][0] < 30_000:
            continue
        merged.append(p)
    m["hist"] = merged[-HIST_MAX:]
    return m


def gadgets_list(limit=60):
    touch_heartbeat()
    data = read_json(DEVICES, None) or {"devices": {}}
    raw = list(data["devices"].values())
    devs = sorted((merge_group(g) for g in twin_groups(raw)), key=lambda d: d["last"], reverse=True)
    info = read_pid("gadgets")
    items = []
    now = now_ms()
    for d in devs[:limit]:
        f = d.get("fields") or {}
        tc = temp_c(f)
        hist = [[p[0], round(c_to_f(p[1]), 1) if p[1] is not None else None, p[2], p[3]] for p in (d.get("hist") or [])[-HIST_OUT:]]
        items.append({
            "key": d["key"], "model": d["model"], "models": d.get("models"), "id": d.get("id"), "channel": d.get("channel"),
            "kind": kind_of(d["model"].split(" / ")[0], f), "first": d["first"], "last": d["last"], "count": d["count"],
            "rssi": d.get("rssi"), "snr": d.get("snr"), "say": readings(f),
            "tempF": round(c_to_f(tc), 1) if tc is not None else None, "humidity": f.get("humidity"),
            "lowBattery": f.get("battery_ok") == 0, "hist": hist,
        })
    day = [d for d in items if now - d["last"] < 86_400_000]
    kinds = {}
    for d in day:
        k = d["kind"].split(" (")[0]
        kinds[k] = kinds.get(k, 0) + 1
    newest = max(items, key=lambda d: d["first"]) if items else None
    hood = {"day": len(day), "hour": sum(1 for d in items if now - d["last"] < 3_600_000), "kinds": kinds,
            "newest": {"model": newest["model"], "kind": newest["kind"], "first": newest["first"]} if newest else None,
            "lowBattery": [d["model"] for d in items if d["lowBattery"] and now - d["last"] < 86_400_000],
            "merged": sum(1 for d in items if d.get("models"))}
    ex = (read_json(EXITS, {}) or {}).get("gadgets")
    return {"running": bool(info), "since": info.get("started") if info else None,
            "band": (info.get("meta") or {}).get("band", "433") if info else None,
            "total": len(devs), "devices": items, "hood": hood, "lastExit": ex, "now": now}


def gadgets_pipeline(meta):
    freqs = {"433": ["433.92M"], "915": ["915M"], "hop": ["433.92M", "915M"]}.get(meta.get("band", "433"), ["433.92M"])
    argv = [RTL_433, "-F", "json", "-M", "level", "-M", "time:iso"]
    for fr in freqs:
        argv += ["-f", fr]
    if len(freqs) > 1:
        argv += ["-H", "30"]
    return [argv]


# ---------------------------------------------------------------- rtl_power parsing

CHILD = []


def _kill_children(*_):
    for p in CHILD:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
    sys.exit(1)


def rtl_power(lo, hi, bin_hz, gain, seconds):
    argv = [RTL_POWER, "-f", f"{lo}M:{hi}M:{int(bin_hz)}", "-g", str(gain), "-i", "1", "-e", f"{int(seconds)}s",
            "-c", "20%", "-w", "hamming"] + ppm_args()
    p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         start_new_session=True)
    CHILD.append(p)
    try:
        so, se = p.communicate(timeout=seconds + 25)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        so, se = p.communicate()
    finally:
        CHILD.remove(p)
    return so.decode(errors="replace"), se.decode(errors="replace"), argv


def parse_line(line, lo, hi):
    """One rtl_power CSV line -> ((date, time), [(MHz, dB), ...]) or None. Each bin is placed from
    its hop's center, bins outside the hop's stated range (the overlap between hops) are dropped,
    and the V4's DC spike at the center of every hop is filled from its neighbours."""
    p = [x.strip() for x in line.split(",")]
    if len(p) < 7:
        return None
    try:
        flo, fhi, step = int(p[2]), int(p[3]), float(p[4])
        vals = [float(x) for x in p[6:] if x]
    except ValueError:
        return None
    n = len(vals)
    c = (flo + fhi) / 2
    mid = (n - 1) // 2
    side = sorted(vals[max(0, mid - 9): max(0, mid - 3)] + vals[mid + 5: mid + 11])
    if len(side) >= 6:
        ref = side[len(side) // 2]
        for k in range(max(0, mid - 2), min(n, mid + 4)):
            if vals[k] > ref + 3:
                vals[k] = ref
    bins = []
    for i, v in enumerate(vals):
        f = c + (i - (n - 1) / 2) * step
        if flo - step / 2 <= f < fhi + step / 2 and lo * 1e6 <= f <= hi * 1e6 and not math.isnan(v):
            bins.append((f / 1e6, v))
    return (p[0], p[1]), bins


def align(freqs, bins):
    """A sweep's (MHz, dB) bins on a reference frequency grid (nearest bin)."""
    if len(bins) == len(freqs):
        return [v for _, v in bins]
    row, j = [], 0
    for f in freqs:
        while j + 1 < len(bins) and abs(bins[j + 1][0] - f) <= abs(bins[j][0] - f):
            j += 1
        row.append(bins[j][1])
    return row


def parse_power(text, lo, hi):
    """rtl_power CSV -> (freqs MHz, rows of dB, row times)."""
    groups = []
    cur_key = None
    for line in text.splitlines():
        r = parse_line(line, lo, hi)
        if not r:
            continue
        key, bins = r
        if key != cur_key:
            groups.append({"t": key[1], "bins": []})
            cur_key = key
        groups[-1]["bins"] += bins
    if not groups:
        return [], [], []
    for g in groups:
        g["bins"].sort()
    full = max(len(g["bins"]) for g in groups)
    groups = [g for g in groups if len(g["bins"]) >= 0.9 * full]
    ref = max(groups, key=lambda g: len(g["bins"]))
    freqs = [f for f, _ in ref["bins"]]
    rows = [align(freqs, g["bins"]) for g in groups]
    return freqs, rows, [g["t"] for g in groups]


def find_peaks(freqs, avg, mx, floor, mfloor, p, preset):
    n = len(freqs)
    sm = [sum(avg[max(0, i - 1): i + 2]) / len(avg[max(0, i - 1): i + 2]) for i in range(n)]
    cands = []
    for i in range(n):
        if sm[i] >= max(sm[max(0, i - 2): i + 3]) and avg[i] - floor >= p["steady"]:
            j = max(range(max(0, i - 1), min(n, i + 2)), key=lambda k: avg[k])
            cands.append((avg[j], j, "steady"))
    for i in range(n):
        if mx[i] >= max(mx[max(0, i - 2): i + 3]) and mx[i] - mfloor >= 9 and avg[i] - floor < p["steady"]:
            cands.append((mx[i] - 3, i, "burst"))
    cands.sort(reverse=True)
    picked = []
    for lvl, i, kind in cands:
        f = freqs[i]
        if any(abs(f - q["mhz"]) < p["sep"] for q in picked):
            continue
        name, mode = name_for(f, preset)
        mhz = f
        if preset == "fm" or (preset == "custom" and 87.5 <= f <= 108):
            mhz = fm_channel(f)
        elif preset in ("noaa", "marine"):
            mhz = round(round(f / 0.025) * 0.025, 3)
        elif preset in ("2m", "70cm", "murs", "rail"):
            mhz = round(round(f / 0.005) * 0.005, 3)
        elif preset == "gmrs":
            mhz = round(round(f / 0.0125) * 0.0125, 4)
        if mhz != f:
            name, mode = name_for(mhz, preset)
        if any(abs(mhz - q["mhz"]) < 1e-6 for q in picked):
            continue
        above = (avg[i] if kind == "steady" else mx[i]) - (floor if kind == "steady" else mfloor)
        picked.append({"mhz": round(mhz, 4), "db": round(avg[i] if kind == "steady" else mx[i], 1),
                       "above": round(above, 1), "kind": kind, "name": name,
                       "listen": mode if preset not in ("lora", "mesh", "433", "adsb") else None,
                       "spur": bool(name and "spur" in name)})
        if len(picked) >= (24 if preset == "fm" else 14):
            break
    picked.sort(key=lambda q: q["mhz"])
    mark_comb(picked, freqs[1] - freqs[0] if n > 1 else 0.01)
    for q in picked:
        if not q["name"] and preset in ("lora", "mesh"):
            q["name"] = "915 MHz device (LoRa, smart meter, Sidewalk…)"
        elif not q["name"] and preset == "433":
            q["name"] = "433 MHz gadget burst"
        elif not q["name"] and preset == "air" and q["kind"] == "burst":
            q["name"] = "aircraft or ground voice (AM)"
    return picked


def mark_comb(peaks, bin_mhz):
    """Four or more unnamed steady peaks at an even spacing are almost always interference
    (harmonics of a switching power supply or other electronics), not stations."""
    free = [q for q in peaks if not q["name"] and q["kind"] == "steady"]
    best = []
    step = 0
    for a in range(len(free)):
        for b in range(a + 1, len(free)):
            d = free[b]["mhz"] - free[a]["mhz"]
            if d < 0.1:
                continue
            tol = max(2.5 * bin_mhz, 0.012 * d)
            hits = [q for q in free if abs((q["mhz"] - free[a]["mhz"]) / d - round((q["mhz"] - free[a]["mhz"]) / d)) * d <= tol]
            if len(hits) >= 4 and len(hits) > len(best):
                best = hits
                step = d
    for q in best:
        q["name"] = f"interference comb (every {step:.3g} MHz)"
        q["listen"] = None
        q["comb"] = True


# ---------------------------------------------------------------- the waterfall image

def turbo(t):
    """Google's Turbo colormap (polynomial fit), 0..1 -> (r, g, b) 0..1."""
    t = clamp(t)
    r = 0.13572138 + t * (4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))))
    g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))))
    b = 0.10667330 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))))
    return clamp(r), clamp(g), clamp(b)


def wf_rgb(t):
    """The waterfall ramp (the tab draws the same one): near-black at the noise floor, then Turbo
    from deep blue through cyan, green and yellow to red."""
    t = clamp(t)
    base = (0.031, 0.043, 0.094)
    if t < 0.25:
        u = t / 0.25
        top = turbo(0.08)
        c = tuple(base[k] + (top[k] - base[k]) * (u ** 2.2) for k in range(3))
    else:
        c = turbo(0.08 + (t - 0.25) / 0.75 * 0.9)
    return tuple(int(round(v * 255)) for v in c)


PALETTE = [wf_rgb(i / 255) for i in range(256)]


def quantize(rows, lo_db, hi_db):
    span = max(1e-6, hi_db - lo_db)
    return [[int(clamp((v - lo_db) / span) * 255) for v in r] for r in rows]


def png_indexed(grid):
    """A palette PNG (base64) of an index grid: smaller than RGB by ~3x, so a 60 x 600 waterfall
    fits the drawing's budget."""
    h = len(grid)
    w = len(grid[0]) if grid else 0
    raw = bytearray()
    up = bytearray()
    prev = bytes(w)
    for r in grid:
        br = bytes(r)
        raw.append(0)
        raw.extend(br)
        up.append(2)
        up.extend((br[i] - prev[i]) & 255 for i in range(w))
        prev = br
    data = min(zlib.compress(bytes(raw), 9), zlib.compress(bytes(up), 9), key=len)

    def chunk(tag, payload):
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    plte = bytes(c for rgb in PALETTE for c in rgb)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 3, 0, 0, 0)) + \
        chunk(b"PLTE", plte) + chunk(b"IDAT", data) + chunk(b"IEND", b"")
    return base64.b64encode(png).decode()


def wf_grid(grid, cols=WF_COLS):
    """The index grid, max-pooled to at most `cols` columns, as base64 bytes (for the terminal)."""
    if not grid:
        return {"cols": 0, "rows": 0, "b64": ""}
    w = len(grid[0])
    if w > cols:
        g = math.ceil(w / cols)
        idx = [(k, min(w, k + g)) for k in range(0, w, g)]
        grid = [[max(r[a:b]) for a, b in idx] for r in grid]
    return {"cols": len(grid[0]), "rows": len(grid), "b64": base64.b64encode(bytes(v for r in grid for v in r)).decode()}


def pool_idx(n, cols):
    if n <= cols:
        return [(k, k + 1) for k in range(n)]
    g = math.ceil(n / cols)
    return [(k, min(n, k + g)) for k in range(0, n, g)]


def decimate(freqs, avg, mx, rows, cols=400):
    n = len(freqs)
    if n <= cols:
        return freqs, avg, mx, rows
    idx = pool_idx(n, cols)
    f2 = [sum(freqs[a:b]) / (b - a) for a, b in idx]
    a2 = [max(avg[a:b]) for a, b in idx]
    m2 = [max(mx[a:b]) for a, b in idx]
    r2 = [[max(r[a:b]) for a, b in idx] for r in rows]
    return f2, a2, m2, r2


def scale_of(floor, rows):
    allv = sorted(v for r in rows for v in r)
    top = allv[int(0.995 * (len(allv) - 1))] if allv else floor + 20
    return floor - 3, max(floor + 22, top + 1)


# ---------------------------------------------------------------- band activity and mesh traffic

def mesh_windows(freqs):
    return {k: [j for j, f in enumerate(freqs) if abs(f - c) <= 0.1] for k, c, _ in MESH_CHANNELS}


def mesh_counts(freqs, rows):
    """Rows (seconds) with a burst at 906.875 / 910.525: the window's level 6 dB over its quiet
    level (the 25th percentile over the rows)."""
    wins = mesh_windows(freqs)
    res = {}
    for k, _, _ in MESH_CHANNELS:
        js = wins[k]
        if not js or len(rows) < 3:
            continue
        lv = [max(r[j] for j in js) for r in rows]
        base = pct(lv, 0.25)
        res[k] = sum(1 for v in lv if v - base >= 6)
    return res


def mesh_add(at_ms, counts, seconds):
    """Adds bursts seen over `seconds` to the minute buckets in mesh.json (last 24 h)."""
    if not counts:
        return
    data = read_json(MESH, None) or {"buckets": []}
    b = {x[0]: x for x in data["buckets"]}
    minute = at_ms // 60_000 * 60_000
    x = b.setdefault(minute, [minute, 0, 0, 0])
    x[1] += counts.get("mt", 0)
    x[2] += counts.get("mc", 0)
    x[3] += int(round(seconds))
    keep = [b[k] for k in sorted(b) if k > at_ms - 86_400_000]
    write_json(MESH, {"buckets": keep, "updated": now_ms()})


def mesh_summary(now=None):
    now = now or now_ms()
    data = read_json(MESH, None) or {"buckets": []}
    win = [x for x in data["buckets"] if x[0] > now - 3_600_000]
    secs = sum(x[3] for x in win)
    res = {"window": win, "seconds": secs, "lastAt": data["buckets"][-1][0] if data["buckets"] else None}
    for i, (k, f, name) in enumerate(MESH_CHANNELS):
        n = sum(x[1 + i] for x in win)
        rate = n / (secs / 60) if secs else 0
        state = "unknown" if secs < 30 else "busy" if rate >= 1 else "active" if rate >= 0.2 else "quiet"
        res[k] = {"mhz": f, "name": name, "bursts": n, "perMin": round(rate, 2), "state": state}
    return res


def activity_add(preset, peaks, at_ms, floor):
    if preset == "custom":
        return
    data = read_json(ACTIVITY, None) or {}
    real = [q for q in peaks if not q.get("comb") and not q.get("spur")]
    named = [q["name"] for q in sorted(real, key=lambda q: -q["above"]) if q.get("name")][:3]
    # `top`: the strongest few as [MHz, dB over the floor, "b"urst | "s"teady], for Web SDR's
    # "busy lately" bookmarks (webrx.py sync-bookmarks); status leaves it out.
    top = [[round(q["mhz"], 4), round(q["above"], 1), "b" if q["kind"] == "burst" else "s"]
           for q in sorted(real, key=lambda q: -q["above"])[:8]]
    entry = {"at": at_ms, "n": len(real), "best": round(max((q["above"] for q in real), default=0), 1),
             "bursts": sum(1 for q in real if q["kind"] == "burst"), "named": named, "floor": round(floor, 1),
             "top": top}
    lst = data.get(preset) or []
    if lst and at_ms - lst[-1]["at"] < 25_000:
        lst[-1] = entry
    else:
        lst.append(entry)
    data[preset] = lst[-12:]
    write_json(ACTIVITY, data)


def activity_summary():
    data = read_json(ACTIVITY, None) or {}
    return {k: {**{x: y for x, y in v[-1].items() if x != "top"}, "scans": len(v)} for k, v in data.items() if v}


# ---------------------------------------------------------------- scan (rtl_power, one-shot)

def scan(preset, args):
    seconds = 10
    if "--seconds" in args:
        k = args.index("--seconds")
        try:
            seconds = max(3, min(60, int(float(args[k + 1]))))
        except (IndexError, ValueError):
            pass
        del args[k:k + 2]
    if preset == "custom":
        try:
            lo, hi = sorted((float(args[0]), float(args[1])))
        except (IndexError, ValueError):
            out({"ok": False, "error": "usage", "say": "Custom scan: radio.py scan custom <start MHz> <stop MHz>, e.g. scan custom 150 174."})
        if lo < 0.5 or hi > 1766 or hi - lo < 0.05 or hi - lo > 300:
            out({"ok": False, "error": "range", "say": "Pick a range inside 0.5-1766 MHz (HF below 28.8 through the V4's upconverter), at least 0.05 and at most 300 MHz wide."})
        bin_khz = None
        if "--bin" in args:
            try:
                bin_khz = float(args[args.index("--bin") + 1])
            except (IndexError, ValueError):
                pass
        p = band_params("custom", lo, hi, bin_khz)
    else:
        p = band_params(preset)
    lo, hi = p["lo"], p["hi"]
    touch_heartbeat()
    d = device()
    if not d["present"]:
        out({"ok": False, "error": "missing", "say": "The RTL-SDR (Blog V4) is not plugged in."})
    o = owner_info(d.get("owner"))
    if o and not o.get("ours"):
        out({"ok": False, "error": "busy", "owner": o,
             "say": f"The V4 is in use by {o['app']} (pid {o['pid']}). It can be used by one program at a time: close {o['app']} first."})
    gmeta = stop_kind("gadgets", record=False)
    stopped = []
    for k in list(MODES):
        if k == "gadgets":
            continue
        m = stop_kind(k, why=f"run the {p['label']} scan")
        if m:
            stopped.append({"kind": k, **m})
    if gmeta or stopped:
        wait_free()
    signal.signal(signal.SIGTERM, _kill_children)
    restarted = None
    try:
        text, err, argv = rtl_power(lo, hi, p["bin"], p["gain"], seconds)
    finally:
        if gmeta:
            ok, why, _, _ = start_kind("gadgets", gmeta, stop_others=False)
            restarted = ok
    low = err.lower()
    if "usb_claim_interface" in low or "failed to open" in low:
        out({"ok": False, "error": "busy", "say": "The V4 is busy: another program has it (likely SDR++). Close it first.",
             "gadgets": {"paused": bool(gmeta), "restarted": restarted}, "stopped": stopped})
    freqs, rows, times = parse_power(text, lo, hi)
    if not rows:
        out({"ok": False, "error": "nodata", "say": "rtl_power returned no data: " + (err.strip().splitlines() or ["?"])[-1],
             "gadgets": {"paused": bool(gmeta), "restarted": restarted}, "stopped": stopped})
    n = len(freqs)
    avg = [sum(r[j] for r in rows) / len(rows) for j in range(n)]
    mx = [max(r[j] for r in rows) for j in range(n)]
    floor = median(avg)
    mfloor = median(mx)
    peaks = find_peaks(freqs, avg, mx, floor, mfloor, p, preset)
    mesh = mesh_counts(freqs, rows)
    f2, a2, m2, r2 = decimate(freqs, avg, mx, rows, LIVE_COLS)
    lo_db, hi_db = scale_of(floor, r2)
    grid = quantize(r2, lo_db, hi_db)
    gain = gain_used(err) or p["gain"]
    at = now_ms()
    res = {
        "ok": True, "live": False, "preset": preset, "label": p["label"], "start": lo, "stop": hi,
        "binHz": round((freqs[-1] - freqs[0]) / max(1, n - 1) * 1e6, 1), "gain": gain, "seconds": seconds, "at": at, "bins": n,
        "freqs": [round(f, 4) for f in f2], "avg": [round(v, 1) for v in a2], "max": [round(v, 1) for v in m2],
        "nrows": len(r2), "rowSec": round(seconds / max(1, len(r2)), 2), "newestFirst": False, "times": times,
        "floor": round(floor, 1), "top": round(max(m2), 1), "scale": [round(lo_db, 1), round(hi_db, 1)],
        "peaks": peaks, "marks": [{"mhz": f, "label": l} for f, l in MARKS.get(preset, [])], "listen": p.get("listen"),
        "png": png_indexed(grid), "wf": wf_grid(grid), "mesh": mesh or None,
        "gadgets": {"paused": bool(gmeta), "restarted": restarted}, "stopped": stopped,
    }
    write_json(LAST_SCAN, res)
    activity_add(preset, peaks, at, floor)
    if mesh:
        mesh_add(at, mesh, len(rows))
    return res


def gain_used(err):
    m = re.search(r"Tuner gain set to ([\d.]+) dB", err)
    return float(m.group(1)) if m else None


# ---------------------------------------------------------------- live (rtl_power, continuous)

def live_argv(meta):
    return [RTL_POWER, "-f", f"{meta['lo']}M:{meta['hi']}M:{int(meta['bin'])}", "-g", str(meta.get("gain", 40)),
            "-i", "1", "-c", "20%", "-w", "hamming"] + ppm_args()


class LiveSpectrum:
    """The live job's reader: rtl_power's sweeps (one a second) into a ring of the last 60 rows,
    with the average, peak hold and max hold, written as a frame for the tab about every 1.5 s."""

    def __init__(self, meta):
        self.p = meta
        self.buf = b""
        self.key = None
        self.bins = []
        self.lines = 0
        self.per_sweep = None
        self.full = None
        self.idx = None
        self.freqs = None
        self.rows = deque(maxlen=LIVE_ROWS)
        self.hold = None
        self.sweeps = 0
        self.times = deque(maxlen=12)
        self.started = now_ms()
        self.last_frame = 0.0
        self.dirty = False
        self.reset_seen = mtime(LIVE_RESET)
        self.scale = None
        self.mesh_win = None
        self.mesh_hist = {k: deque(maxlen=60) for k, _, _ in MESH_CHANNELS}
        self.mesh_new = {}
        self.mesh_secs = 0
        self.mesh_flushed = time.time()
        self.activity_at = 0.0
        self.peaks = []
        self.floor = None

    def feed(self, chunk):
        self.buf += chunk
        *lines, self.buf = self.buf.split(b"\n")
        for line in lines:
            r = parse_line(line.decode(errors="replace"), self.p["lo"], self.p["hi"])
            if not r:
                continue
            key, bins = r
            if key != self.key:
                if self.bins:
                    self.finish()
                self.key = key
                self.bins = []
                self.lines = 0
            self.bins += bins
            self.lines += 1
            if self.per_sweep and self.lines >= self.per_sweep:
                self.finish()

    def finish(self):
        bins = sorted(self.bins)
        if self.per_sweep is None or self.lines > self.per_sweep:
            self.per_sweep = self.lines
        self.bins = []
        if self.full is None:
            if len(bins) < 8:
                return
            self.full = [f for f, _ in bins]
            self.idx = pool_idx(len(self.full), LIVE_COLS)
            self.freqs = [round(sum(self.full[a:b]) / (b - a), 4) for a, b in self.idx]
            self.mesh_win = mesh_windows(self.full)
        if len(bins) < 0.9 * len(self.full):
            return
        row = align(self.full, bins)
        self.mesh_row(row)
        drow = [round(max(row[a:b]), 1) for a, b in self.idx]
        self.rows.append(drow)
        self.hold = drow[:] if self.hold is None else [max(a, b) for a, b in zip(self.hold, drow)]
        self.sweeps += 1
        self.times.append(time.time())
        self.dirty = True

    def mesh_row(self, row):
        for k, _, _ in MESH_CHANNELS:
            js = self.mesh_win.get(k) if self.mesh_win else None
            if not js:
                continue
            lv = max(row[j] for j in js)
            h = self.mesh_hist[k]
            if len(h) >= 5 and lv - pct(h, 0.25) >= 6:
                self.mesh_new[k] = self.mesh_new.get(k, 0) + 1
            h.append(lv)
        if self.mesh_win and any(self.mesh_win.values()):
            self.mesh_secs += 1

    def tick(self):
        rs = mtime(LIVE_RESET)
        if rs > self.reset_seen:
            self.reset_seen = rs
            self.hold = list(self.rows[-1]) if self.rows else None
            self.dirty = True
            self.last_frame = 0
        if self.dirty and time.time() - self.last_frame >= 1.5:
            self.write_frame()
        if self.mesh_secs and time.time() - self.mesh_flushed >= 15:
            self.flush_mesh()

    def flush_mesh(self):
        mesh_add(now_ms(), {k: self.mesh_new.get(k, 0) for k, _, _ in MESH_CHANNELS}, self.mesh_secs)
        self.mesh_new = {}
        self.mesh_secs = 0
        self.mesh_flushed = time.time()

    def frame(self, running=True):
        rows = list(self.rows)
        n = len(rows)
        cols = len(self.freqs)
        recent = rows[-8:]
        avg = [round(sum(r[j] for r in recent) / len(recent), 1) for j in range(cols)]
        peak = [max(r[j] for r in rows) for j in range(cols)]
        floor = median(avg)
        mfloor = median(peak)
        preset = self.p.get("preset", "custom")
        peaks = find_peaks(self.freqs, avg, peak, floor, mfloor, self.p, preset)
        lo_db, hi_db = scale_of(floor, rows)
        if self.scale:
            lo_db = self.scale[0] * 0.7 + lo_db * 0.3
            hi_db = self.scale[1] * 0.7 + hi_db * 0.3
        self.scale = (lo_db, hi_db)
        grid = quantize(rows[::-1], lo_db, hi_db)
        dt = [b - a for a, b in zip(self.times, list(self.times)[1:])]
        self.peaks, self.floor = peaks, floor
        return {
            "ok": True, "live": True, "running": running, "preset": preset, "label": self.p.get("label"),
            "start": self.p["lo"], "stop": self.p["hi"], "binHz": round((self.full[-1] - self.full[0]) / max(1, len(self.full) - 1) * 1e6, 1),
            "gain": self.p.get("gain"), "at": now_ms(), "startedAt": self.started, "sweeps": self.sweeps, "bins": len(self.full),
            "freqs": self.freqs, "avg": avg, "max": peak, "hold": self.hold, "cur": rows[-1],
            "nrows": n, "maxRows": LIVE_ROWS, "rowSec": round(sum(dt) / len(dt), 2) if dt else 1.0, "newestFirst": True,
            "floor": round(floor, 1), "top": round(max(self.hold or peak), 1), "scale": [round(lo_db, 1), round(hi_db, 1)],
            "peaks": peaks, "marks": [{"mhz": f, "label": l} for f, l in MARKS.get(preset, [])], "listen": self.p.get("listen"),
            "png": png_indexed(grid), "wf": wf_grid(grid),
        }

    def write_frame(self, running=True):
        if not self.rows or not self.freqs:
            return
        write_json(LIVE_FRAME, self.frame(running))
        self.last_frame = time.time()
        self.dirty = False
        if time.time() - self.activity_at >= 30 and self.floor is not None:
            activity_add(self.p.get("preset", "custom"), self.peaks, now_ms(), self.floor)
            self.activity_at = time.time()

    def close(self):
        if self.rows:
            self.write_frame(running=False)
        if self.mesh_secs:
            self.flush_mesh()


def live(args):
    sub = args[0] if args else "frame"
    if sub == "frame":
        touch(LIVE_SEEN)
        info = read_pid("live")
        f = read_json(LIVE_FRAME, None)
        ex = (read_json(EXITS, {}) or {}).get("live")
        if f and info and f.get("startedAt", 0) >= (info.get("started", 0) - 5000):
            f["running"] = True
            f["now"] = now_ms()
            return f
        if info:
            return {"ok": False, "running": True, "say": "The live view is starting: the first rows take a second or two.",
                    "meta": info.get("meta"), "now": now_ms()}
        if f:
            f["running"] = False
            f["lastExit"] = ex
            f["now"] = now_ms()
            return f
        return {"ok": False, "running": False, "lastExit": ex, "say": "The live view is off."}
    if sub == "reset":
        touch(LIVE_RESET)
        return {"ok": True, "say": "Max hold cleared."}
    if sub in ("stop", "off"):
        m = stop_kind("live")
        return {"ok": True, "stopped": bool(m), "say": "Live view off." if m else "The live view was not running."}
    if sub in ("start", "on"):
        rest = args[1:]
        name = (rest[0] if rest else "fm").lower()
        name = ALIASES.get(name, name)
        if name == "custom":
            try:
                lo, hi = sorted((float(rest[1]), float(rest[2])))
            except (IndexError, ValueError):
                return {"ok": False, "error": "usage", "say": "Live custom range: radio.py live start custom <start MHz> <stop MHz>."}
            if lo < 0.5 or hi > 1766 or hi - lo < 0.05 or hi - lo > 60:
                return {"ok": False, "error": "range", "say": "Live needs a range inside 0.5-1766 MHz, 0.05 to 60 MHz wide (wider sweeps take too long per row)."}
            p = band_params("custom", lo, hi)
        elif name in PRESETS:
            p = band_params(name)
        else:
            return {"ok": False, "error": "preset", "say": f"Presets: {', '.join(PRESETS)}, or custom <start> <stop>."}
        if "--gain" in rest:
            try:
                p["gain"] = float(rest[rest.index("--gain") + 1])
            except (IndexError, ValueError):
                pass
        touch(LIVE_SEEN)
        ok, why, stopped, err = start_kind("live", p)
        return {"ok": ok, "error": err, "say": f"Live view on: {p['label']} ({p['lo']:g}-{p['hi']:g} MHz), a new row about every second." if ok else why,
                "live": p if ok else None, "stopped": stopped}
    return {"ok": False, "say": "live start <preset>|custom <a> <b> · live stop · live frame · live reset"}


# ---------------------------------------------------------------- listen (rtl_fm through the meter tap)

AM_NOISE = 220.0      # rtl_fm's AM output with no carrier at gain 40 on this V4 (measured)
NFM_NOISE_D = 3300.0  # the high-frequency part of narrow-FM audio with no carrier (measured)
NFM_CLEAN_D = 900.0   # ... with a full-quieting carrier (NOAA KIH42)
WEAK_LEVEL = 0.25


def player_argv(rate, volume):
    play = os.path.join(BIN, "play")
    if os.path.exists(play):
        return [play, "-q", "-r", str(rate), "-t", "raw", "-e", "signed", "-b", "16", "-c", "1", "-v", f"{volume / 100:.2f}", "-"]
    ffplay = os.path.join(BIN, "ffplay")
    if os.path.exists(ffplay):
        return [ffplay, "-nodisp", "-loglevel", "error", "-volume", str(int(volume)), "-f", "s16le", "-ar", str(rate),
                "-ch_layout", "mono", "-i", "-"]
    return None


def audio_rate(mode):
    if mode == "wbfm":
        return 48000
    return settings()["filters"].get(mode, MODE_RATE.get(mode, 24000))


def gain_args(meta):
    g = meta.get("gain")
    if g in (None, "auto"):
        return []
    return ["-g", f"{float(g):g}"]


def listen_argv(meta):
    f = meta["freq"]
    mode = meta["mode"]
    rate = audio_rate(mode)
    ppm = ppm_args(meta.get("ppm"))
    if mode == "wbfm":
        fm = [RTL_FM, "-f", f"{f}M", "-M", "wbfm", "-s", "200000", "-r", "48000"] + gain_args(meta) + ppm + ["-"]
    else:
        # This rtl_fm only resamples down, so narrow FM / AM / SSB play at their own filter rate.
        # CW is USB tuned CW_BFO_HZ low, so the carrier beats at an audible tone.
        tune = f - (CW_BFO_HZ / 1e6 if mode == "cw" else 0.0)
        fm = ([RTL_FM, "-f", f"{tune:.6f}M", "-M", RTL_FM_MODE[mode], "-s", str(rate)] + gain_args(meta) + ppm
              + ["-l", str(meta.get("squelch", 0)), "-"])
    return fm, player_argv(rate, meta.get("volume", 100))


def goertzel(a, freq, rate):
    w = 2 * math.pi * freq / rate
    c = 2 * math.cos(w)
    s1 = s2 = 0.0
    for x in a:
        s0 = x + c * s1 - s2
        s2 = s1
        s1 = s0
    return (s1 * s1 + s2 * s2 - c * s1 * s2) / max(1, len(a))


class AudioMeter:
    """The listen job's tap: measures the demodulated audio on its way to the player, every
    half second, and writes meter.json. rtl_fm reports no signal level, so the reading comes
    from the audio: wide FM by the 19 kHz stereo pilot over the quiet 16-17 kHz gap; narrow FM
    by "quieting" (FM audio is full of hiss without a carrier and goes quiet with one); AM by
    the carrier's envelope over the receiver's own noise. Rough, but it tells a station from
    noise. With squelch on, rtl_fm sends nothing while closed: that is "squelch closed".

    The tap also feeds the Recorder (● Rec and the transmission logger) and, while the tab is
    watching, the EQ display's AudioSpectrum. Both run in tick(), after the chunk has gone on to
    the player, and a fault in either turns that part off without touching the audio."""

    def __init__(self, meta):
        self.meta = meta
        self.mode = meta["mode"]
        self.rate = audio_rate(self.mode)
        self.carry = b""
        self.samples = array.array("h")
        self.levels = deque(maxlen=8)
        self.metrics = deque(maxlen=8)
        self.started = time.time()
        self.last_data = None
        self.heard = 0.0
        self.last_write = 0.0
        g = meta.get("gain")
        self.am_ref = AM_NOISE * (10 ** ((float(g) - 40.2) / 20) if g not in (None, "auto") else 1.0)
        self.recq = []
        self.rec = None
        self.rec_error = None
        try:
            self.rec = Recorder(meta, self.rate, level=self.gate_level)
        except Exception as err:
            self.rec_error = f"{type(err).__name__}: {err}"[:200]
        self.spec = None
        try:
            self.spec = AudioSpectrum(self.mode, self.rate)
        except Exception:
            self.spec = None
        self.eq_wanted = False
        self.eq_checked = 0.0
        self.eq_frame = 0.0
        self.eq_write = 0.0

    def feed(self, chunk):
        data = self.carry + chunk
        n = len(data) // 2 * 2
        self.carry = data[n:]
        pcm = data[:n]
        self.samples.frombytes(pcm)
        self.last_data = time.time()
        if pcm and (self.rec or self.eq_wanted):
            self.recq.append((pcm, self.last_data))  # recorded / analysed in tick(), after the player has it
        half = self.rate // 2
        while len(self.samples) >= half:
            block = self.samples[:half]
            del self.samples[:half]
            self.measure(block)

    def level_of(self, a):
        """(metric, level 0-1) of a block of samples, the way the meter reads it."""
        n = len(a)
        if self.mode == "wbfm":
            part = a[: n // 2]
            p19 = goertzel(part, 19000, self.rate)
            gap = (goertzel(part, 16200, self.rate) + goertzel(part, 17000, self.rate)) / 2
            metric = 10 * math.log10(max(p19, 1e-9) / max(gap, 1e-9))
            level = clamp((metric - 4) / 20)
        elif self.mode in ("am", "usb", "lsb", "cw"):
            # AM by its carrier's envelope; SSB / CW have no carrier, so the demodulated audio's
            # own loudness (RMS) over the receiver's noise stands in for a signal.
            if self.mode == "am":
                mean = sum(a) / n
            else:
                mean = math.sqrt(sum(x * x for x in a) / n)
            metric = 20 * math.log10(max(mean, 1.0) / self.am_ref)
            level = clamp(metric / 30)
        else:
            d = math.sqrt(sum((a[i] - a[i - 1]) ** 2 for i in range(1, n, 2)) / max(1, n // 2))
            metric = clamp((NFM_NOISE_D - d) / (NFM_NOISE_D - NFM_CLEAN_D)) * 100
            level = metric / 100
        return metric, level

    def gate_level(self, block):
        """The logger's gate with squelch off: the meter's level of a block of raw PCM."""
        a = array.array("h")
        a.frombytes(block)
        return self.level_of(a)[1] if len(a) > 2 else 0.0

    def measure(self, a):
        metric, level = self.level_of(a)
        self.levels.append(level)
        self.metrics.append(metric)
        self.heard += 0.5

    def squelch_state(self, now=None):
        now = now or time.time()
        sq = self.meta.get("squelch", 0) if self.mode != "wbfm" else 0
        return sq, ("off" if not sq else ("open" if self.last_data and now - self.last_data < 0.8 else "closed"))

    def state(self):
        now = time.time()
        sq, squelch = self.squelch_state(now)
        recent = list(self.levels)[-2:]
        level = sum(recent) / len(recent) if recent and squelch != "closed" else 0.0
        metric = sum(list(self.metrics)[-2:]) / len(list(self.metrics)[-2:]) if self.metrics else None
        weak = idle = None
        if self.heard >= 2.0:
            avg4 = sum(list(self.levels)[-4:]) / len(list(self.levels)[-4:])
            if self.meta.get("broadcast"):
                weak = avg4 < WEAK_LEVEL
            else:
                idle = avg4 < WEAK_LEVEL
        unit = {"wbfm": "dB pilot", "am": "dB over noise", "fm": "% quieting", "usb": "dB over noise",
                "lsb": "dB over noise", "cw": "dB over noise"}.get(self.mode, "dB over noise")
        s = {"at": now_ms(), "freq": self.meta["freq"], "mode": self.mode, "label": self.meta.get("label"),
             "level": round(level, 3), "peak": round(max(self.levels), 3) if self.levels else 0.0,
             "metric": round(metric, 1) if metric is not None else None, "unit": unit,
             "squelch": squelch, "squelchLevel": sq, "heard": round(self.heard, 1), "weak": weak, "idle": idle,
             "since": int(self.started * 1000), "tap": TAP_VERSION, "rec": None, "log": None}
        if self.rec:
            s["rec"], s["log"] = self.rec.state()
        if self.rec_error:
            s["recError"] = self.rec_error
        return s

    def tick(self):
        now = time.time()
        q, self.recq = self.recq, []
        if self.rec:
            try:
                for pcm, t in q:
                    self.rec.feed(pcm, t)
                self.rec.tick(now)
            except Exception as err:  # the recorder stops; the audio never does
                self.rec_error = f"recording stopped: {type(err).__name__}: {err}"[:200]
                try:
                    self.rec.close()
                except Exception:
                    pass
                self.rec = None
                self.last_write = 0.0
        if self.spec:
            try:
                self.eq_tick(q, now)
            except Exception:
                self.spec = None
                self.eq_wanted = False
        changed = bool(self.rec and self.rec.changed)
        if changed or now - self.last_write >= 0.5:
            if self.rec:
                self.rec.changed = False
            write_json(METER, self.state())
            self.last_write = now
        if self.rec and self.rec.finished:
            raise Stop("done", self.rec.finished)

    def eq_tick(self, q, now):
        """The EQ display's spectrum, only while the tab watches (it touches EQ_SEEN through `listen meter`)."""
        if now - self.eq_checked >= 1.0:
            self.eq_checked = now
            self.eq_wanted = now - mtime(EQ_SEEN) < 6.0
        if not self.eq_wanted:
            return
        for pcm, t in q:
            self.spec.push(pcm, t)
        if now - self.eq_frame >= 0.1:
            self.eq_frame = now
            self.spec.frame(now, closed=self.squelch_state(now)[1] == "closed")
        if now - self.eq_write >= 0.2:
            self.eq_write = now
            write_json(EQ, self.spec.state(self.meta, int(self.started * 1000)))

    def close(self):
        if self.rec:
            try:
                self.rec.close()
            except Exception:
                pass
        s = self.state()
        s["stopped"] = True
        write_json(METER, s)


TAP_VERSION = 2   # in the listen job's meta and meter.json: this tap records and feeds the EQ display


# ---------------------------------------------------------------- the EQ display's spectrum

class AudioSpectrum:
    """The EQ display's numbers, from the audio on its way to the speaker. About ten times a
    second, an FFT (stdlib radix-2 over a Hann window: 2048 samples at 48 kHz, 1024 at 24 kHz,
    512 at 12 kHz, so ~23 Hz a bin; under 1 ms each) folded into log-spaced bands: 32 from 60 Hz
    to 12 kHz for wide FM, 28 from 100 Hz to 6 kHz for narrow FM, 24 to 5 kHz for AM, whose audio
    stops sooner. Each band rises fast and falls slowly; a peak cap holds for 0.8 s, then falls.
    A rough guess says music, voice, noise (hiss) or silence."""

    RANGE = (-66.0, -12.0)  # dBFS per band, bottom to top of the display (54 dB: broadcast FM is loud and dense)
    ATTACK = 0.75           # of the way to a louder value, each frame
    FALL = 1.4              # display heights per second a band falls
    HOLD = 0.8              # seconds a peak cap holds
    PEAK_FALL = 0.45        # display heights per second a cap falls after that

    def __init__(self, mode, rate):
        self.mode = mode
        self.rate = rate
        n = 2048 if rate >= 44100 else 1024 if rate >= 22050 else 512
        self.n = n
        lo, hi, nb = (60.0, 12000.0, 32) if mode == "wbfm" else (100.0, 6000.0, 28) if mode == "fm" else (100.0, 5000.0, 24)
        hi = min(hi, rate / 2 * 0.92)
        self.edges = [lo * (hi / lo) ** (i / nb) for i in range(nb + 1)]
        bin_hz = rate / n
        self.bins = []
        for i in range(nb):
            a, b = self.edges[i], self.edges[i + 1]
            ks = [k for k in range(1, n // 2) if a <= k * bin_hz < b]
            self.bins.append(ks or [min(n // 2 - 1, max(1, round(math.sqrt(a * b) / bin_hz)))])
        self.k_lo = max(1, int(lo / bin_hz))
        self.k_hi = min(n // 2 - 1, int(hi / bin_hz))
        self.k_speech = (int(250 / bin_hz), int(3500 / bin_hz))
        bits = n.bit_length() - 1
        self.rev = [int(format(i, f"0{bits}b")[::-1], 2) for i in range(n)]
        self.win = [0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]
        self.tw = [complex(math.cos(-2 * math.pi * k / n), math.sin(-2 * math.pi * k / n)) for k in range(n // 2)]
        self.ref = (32768.0 * n / 4) ** 2  # a full-scale sine's bin power through the window
        self.ring = array.array("h")
        self.fresh = 0
        self.last_push = None
        self.level = [0.0] * nb
        self.peak = [0.0] * nb
        self.held = [0.0] * nb
        self.last = None
        self.rms_db = None
        self.loud = deque(maxlen=20)
        self.kinds = deque(maxlen=10)
        self.kind = "silence"

    def push(self, pcm, now=None):
        self.ring.frombytes(pcm)
        self.fresh += len(pcm) // 2
        self.last_push = now if now is not None else time.time()
        extra = len(self.ring) - self.n
        if extra > 0:
            del self.ring[:extra]

    def fft(self, x):
        n = self.n
        win = self.win
        a = [complex(x[r] * win[r]) for r in self.rev]
        size = 2
        while size <= n:
            half = size // 2
            tws = self.tw[:: n // size][:half]
            for start in range(0, n, size):
                for k in range(half):
                    i = start + k
                    j = i + half
                    t = tws[k] * a[j]
                    u = a[i]
                    a[i] = u + t
                    a[j] = u - t
            size *= 2
        return a

    def frame(self, now, closed=False):
        # rtl_fm hands its audio over in chunks (about 8 a second for AM at 12 kHz): a frame with
        # nothing new since the last one waits for the next chunk; only half a second of nothing
        # (squelch closed, the job ending) is silence.
        if not self.fresh and not closed and self.last_push is not None and now - self.last_push < 0.5:
            return
        nb = len(self.bins)
        dt = min(0.5, now - self.last) if self.last else 0.1
        self.last = now
        lo_db, hi_db = self.RANGE
        target = [0.0] * nb
        kind = "silence"
        if self.fresh and not closed and len(self.ring) >= self.n:
            x = self.ring
            spec = self.fft(x)
            p = [(c.real * c.real + c.imag * c.imag) for c in spec[: self.n // 2]]
            for i, ks in enumerate(self.bins):
                db = 10 * math.log10(sum(p[k] for k in ks) / self.ref + 1e-15)
                target[i] = clamp((db - lo_db) / (hi_db - lo_db))
            m = min(self.fresh, self.n)
            tail = x[-m:]
            ms = sum(v * v for v in tail) / m
            self.rms_db = 10 * math.log10(ms / (32768.0 ** 2) + 1e-15)
            kind = self.guess(p)
        else:
            self.rms_db = None
        self.fresh = 0
        for i in range(nb):
            v, t = self.level[i], target[i]
            v = v + (t - v) * self.ATTACK if t > v else max(t, v - self.FALL * dt)
            self.level[i] = v
            if v >= self.peak[i]:
                self.peak[i] = v
                self.held[i] = now + self.HOLD
            elif now > self.held[i]:
                self.peak[i] = max(v, self.peak[i] - self.PEAK_FALL * dt)
        self.kinds.append(kind)
        self.kind = max(("music", "voice", "noise", "silence"), key=lambda k: (self.kinds.count(k), k == kind))

    def guess(self, p):
        """music / voice / noise / silence: loudness, spectral flatness (hiss is flat) and, for wide
        FM, how much sits in the speech band and how much the loudness swings (speech pauses)."""
        if self.rms_db is None or self.rms_db < -55:
            return "silence"
        band = p[self.k_lo:self.k_hi] or [0.0]
        total = sum(band) + 1e-9
        logs = sum(math.log(v + 1e-9) for v in band) / len(band)
        flat = math.exp(logs) / (total / len(band))
        self.loud.append(self.rms_db)
        if flat > 0.3:
            return "noise"
        if self.mode != "wbfm":
            return "voice"
        speech = sum(p[self.k_speech[0]:self.k_speech[1]]) / total
        swing = (max(self.loud) - min(self.loud)) if len(self.loud) >= 8 else 0.0
        return "voice" if speech > 0.72 and swing > 14 else "music"

    def state(self, meta, since):
        return {"at": now_ms(), "since": since, "freq": meta.get("freq"), "mode": self.mode, "rate": self.rate,
                "edges": [round(e) for e in self.edges], "bands": [round(v, 3) for v in self.level],
                "peaks": [round(v, 3) for v in self.peak], "rms": round(self.rms_db, 1) if self.rms_db is not None else None,
                "kind": self.kind, "range": list(self.RANGE)}


# ---------------------------------------------------------------- recording (the tap tees into ffmpeg)

FFMPEG = os.path.join(BIN, "ffmpeg")
FFPLAY = os.path.join(BIN, "ffplay")
FFPROBE = os.path.join(BIN, "ffprobe")
REC_ON = os.path.join(STATE, "rec.on")          # ● Rec: there while the tap should record what plays
LOG_ON = os.path.join(STATE, "log.on")          # Log: there while the transmission logger is on
REC_CONF = os.path.join(STATE, "recordings.json")  # the retention cap and when it last ran
PLAYBACK = os.path.join(STATE, "playback.json")  # the ffplay playing a recording
REC_LOG = os.path.join(STATE, "rec.log")
KEEP_GB = 2.0
KEEP_DAYS = 30
HANG_S = 2.0          # a clip ends this long after the last sound
MIN_CLIP_S = 0.5      # a clip with less sound than this is never written
MAX_CLIP_S = 300.0    # a clip this long ends and the next one starts
GATE_LEVEL = WEAK_LEVEL
PRUNE_EVERY_S = 3600
REC_POLL_S = 0.5
MAX_TIMED_S = 6 * 3600


def rec_root():
    """~/Radio/Recordings (RADIO_REC_DIR moves it for tests), never inside the iCloud-synced
    ~/Documents or ~/Desktop."""
    root = os.path.abspath(os.path.expanduser(os.environ.get("RADIO_REC_DIR") or os.path.join(HOME, "Radio", "Recordings")))
    for synced in ("Documents", "Desktop", os.path.join("Library", "Mobile Documents")):
        s = os.path.join(HOME, synced)
        if root == s or root.startswith(s + os.sep):
            return os.path.join(HOME, "Radio", "Recordings")
    return root


REC_ROOT = rec_root()


def slug(s, n=40):
    return re.sub(r"[^A-Za-z0-9]+", "-", s or "").strip("-")[:n].rstrip("-")


def station_of(label, freq=None):
    """The station's name without its frequency ("94.1 WNNF" -> "WNNF"); "" when it has none."""
    s = re.sub(r"^\s*(\d+\.\d+\s*(MHz)?|\d+\s*MHz)\s*", "", label or "", flags=re.I).strip()
    return "" if re.fullmatch(r"(FM|MHz)?", s, flags=re.I) else s


def mode_tag(mode):
    return {"wbfm": "wfm", "fm": "nfm", "am": "am"}.get(mode, mode or "x")


def rec_path(start, freq, mode, label, clip=False):
    """~/Radio/Recordings/YYYY-MM-DD/HHMMSS_<MHz>_<mode>[_<station>][_clip].m4a, never one that exists."""
    lt = time.localtime(start)
    st = slug(station_of(label, freq))
    base = f"{time.strftime('%H%M%S', lt)}_{float(freq or 0):.3f}_{mode_tag(mode)}{f'_{st}' if st else ''}{'_clip' if clip else ''}"
    folder = os.path.join(REC_ROOT, time.strftime("%Y-%m-%d", lt))
    path = os.path.join(folder, base + ".m4a")
    k = 2
    while os.path.exists(path) or os.path.exists(path[:-4] + ".json"):
        path = os.path.join(folder, f"{base}-{k}.m4a")
        k += 1
    return path


def rel(path):
    return os.path.relpath(path, REC_ROOT)


def pretty(path):
    """~/… for a path in the home folder, else the path itself."""
    return "~/" + os.path.relpath(path, HOME) if path.startswith(HOME + os.sep) else path


def fmt_dur(s):
    s = int(round(s or 0))
    return f"{s} s" if s < 60 else f"{s // 60} min {s % 60:02d} s" if s < 3600 else f"{s // 3600} h {s % 3600 // 60:02d} min"


def fmt_size(b):
    b = b or 0
    return f"{b / 1e9:.2f} GB" if b >= 1e9 else f"{b / 1e6:.1f} MB" if b >= 1e6 else f"{max(1, round(b / 1e3))} KB"


def clock_of(ms):
    return time.strftime("%I:%M %p", time.localtime(ms / 1000)).lstrip("0").lower()


class Encoder:
    """One ffmpeg turning the tap's raw PCM into AAC in an .m4a (mono, 48 kbps; 64 for wide FM),
    with a JSON sidecar beside it. Writes never block the audio: the pipe is non-blocking and
    what does not fit yet waits here. close() starts a clean finish (ffmpeg writes the file's
    index once its input ends, which makes it playable); poll() completes it; wait() blocks."""

    MAX_PENDING_S = 20

    def __init__(self, path, rate, info=None, kbps=None):
        self.path = path
        self.rate = rate
        self.side = path[:-4] + ".json"
        self.samples = 0
        self.dropped = 0
        self.pending = bytearray()
        self.closing = False
        self.done = False
        kbps = kbps or (64 if rate >= 44100 else 48)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.info = dict(info or {}, file=os.path.basename(path), rate=rate, recording=True, duration=0.0, size=0)
        write_json(self.side, self.info)
        with open(REC_LOG, "a") as err:
            self.p = subprocess.Popen([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(rate), "-ac", "1",
                                       "-i", "pipe:0", "-c:a", "aac", "-b:a", f"{kbps}k", path],
                                      stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=err, close_fds=True)
        self.fd = self.p.stdin.fileno()
        os.set_blocking(self.fd, False)

    def write(self, data):
        if self.closing or not data:
            return
        if len(self.pending) > self.MAX_PENDING_S * self.rate * 2:
            self.dropped += len(data) // 2
            return
        self.pending += data
        self.samples += len(data) // 2
        self.pump()

    def pump(self):
        while self.pending and self.fd is not None:
            try:
                n = os.write(self.fd, self.pending)
            except BlockingIOError:
                return
            except OSError:
                self.pending.clear()
                self._eof()
                return
            del self.pending[:n]
        if self.closing and not self.pending:
            self._eof()

    def _eof(self):
        if self.fd is not None:
            self.fd = None
            try:
                self.p.stdin.close()
            except OSError:
                pass

    def seconds(self):
        return self.samples / self.rate

    def close(self):
        """Starts the finish; returns what it will have saved."""
        if not self.closing:
            self.closing = True
            self.pump()
        return {"file": rel(self.path), "duration": round(self.seconds(), 2), "clip": bool(self.info.get("clip"))}

    def poll(self):
        if self.done:
            return True
        self.pump()
        if self.fd is None and self.p.poll() is not None:
            self._finalize()
        return self.done

    def wait(self, timeout=5.0):
        self.closing = True
        if self.fd is not None:
            os.set_blocking(self.fd, True)
            try:
                if self.pending:
                    self.p.stdin.write(bytes(self.pending))
                    self.pending.clear()
            except OSError:
                pass
            self._eof()
        try:
            self.p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.p.kill()
            self.p.wait(timeout=2)
        self._finalize()

    def _finalize(self):
        if self.done:
            return
        self.done = True
        size = os.path.getsize(self.path) if os.path.exists(self.path) else 0
        self.info.update(recording=False, duration=round(self.seconds(), 2), size=size, end=now_ms(),
                         ok=self.p.returncode == 0 and size > 0)
        if self.dropped:
            self.info["droppedSeconds"] = round(self.dropped / self.rate, 1)
        write_json(self.side, self.info)


class RecStream:
    """● Rec: everything the tap passes, with silence for the gaps while squelch is closed (rtl_fm
    sends nothing then), so the file keeps real time."""

    def __init__(self, sink, rate, started):
        self.sink = sink
        self.rate = rate
        self.started = started
        self.written = 0
        self.last_data = started

    def feed(self, pcm, now):
        self.sink.write(pcm)
        self.written += len(pcm) // 2
        self.last_data = now

    def tick(self, now):
        if now - self.last_data > 0.3:
            due = int((now - 0.3 - self.started) * self.rate) - self.written
            if due > self.rate // 4:
                self.sink.write(bytes(2 * due))
                self.written += due


class ClipGate:
    """Splits the tap's audio into one clip per transmission ("the scanner that remembers").

    feed(pcm, now) takes each chunk as it arrived; tick(now) runs between chunks. With squelch on,
    a chunk with any sound is a transmission: rtl_fm sends nothing while squelch is closed, and
    zeros for a moment as it closes. With squelch off, `level(block)` over 0.25 s blocks gates it
    (the meter's own reading: FM quieting, the AM carrier), with 0.5 s kept from before the
    sound. A clip ends `hang` s after the last sound, and that quiet tail is not kept; gaps inside
    it are kept as silence. A clip with under `min_s` s of sound is never written: its audio
    waits here until it has that much, then `open_sink(start)` gets it all. One that reaches
    `max_s` ends, and the next sound starts the next."""

    def __init__(self, rate, open_sink, squelch=True, level=None, threshold=GATE_LEVEL, hang=HANG_S,
                 min_s=MIN_CLIP_S, max_s=MAX_CLIP_S, preroll=0.5, block_s=0.25):
        self.rate = rate
        self.open_sink = open_sink
        self.squelch = squelch or level is None
        self.level = level
        self.threshold = threshold
        self.hang = hang
        self.min_n = int(min_s * rate)
        self.max_n = int(max_s * rate)
        self.pre_bytes = int(preroll * rate) * 2
        self.block_bytes = max(2, int(block_s * rate) * 2)
        self.buf = bytearray()
        self.pre = bytearray()
        self.last_data = None
        self.saved = 0
        self.dropped = 0
        self.clips = []
        self._reset()

    def _reset(self):
        self.active = False
        self.sink = None
        self.head = bytearray()
        self.tail = bytearray()
        self.voiced = 0
        self.total = 0
        self.started = None
        self.last_sound = None

    def feed(self, pcm, now):
        if self.squelch:
            begin = now - len(pcm) / 2 / self.rate
            self.expire(begin)
            sound = bool(pcm.strip(b"\0"))
            if self.active and self.last_data is not None and begin - self.last_data > 0.05:
                self._quiet(bytes(2 * int(min(begin - self.last_data, self.hang) * self.rate)))
            if sound:
                if not self.active:
                    self._begin(begin)
                self._sound(pcm, now)
            elif self.active:
                self._quiet(pcm)
            self.last_data = now
            return
        self.buf += pcm
        block_s = self.block_bytes / 2 / self.rate
        while len(self.buf) >= self.block_bytes:
            block = bytes(self.buf[: self.block_bytes])
            del self.buf[: self.block_bytes]
            end = now - len(self.buf) / 2 / self.rate
            self.expire(end - block_s)
            if self.level(block) >= self.threshold:
                if not self.active:
                    pre = bytes(self.pre)
                    self.pre = bytearray()
                    self._begin(end - block_s - len(pre) / 2 / self.rate)
                    if pre:
                        self._put(pre, False)
                self._sound(block, end)
            elif self.active:
                self._quiet(block)
            else:
                self.pre += block
                if len(self.pre) > self.pre_bytes:
                    del self.pre[: len(self.pre) - self.pre_bytes]
        self.last_data = now

    def tick(self, now):
        self.expire(now)

    def expire(self, t):
        if self.active and self.last_sound is not None and t - self.last_sound > self.hang:
            self.end()

    def _begin(self, t):
        self._reset()
        self.active = True
        self.started = t

    def _sound(self, data, t):
        if self.tail:
            tail = bytes(self.tail)
            self.tail = bytearray()
            self._put(tail, False)
        self._put(data, True)
        self.last_sound = t
        if self.total >= self.max_n:
            self.end()

    def _quiet(self, data):
        self.tail += data
        cap = int((self.hang + 1) * self.rate) * 2
        if len(self.tail) > cap:
            del self.tail[: len(self.tail) - cap]

    def _put(self, data, voiced):
        n = len(data) // 2
        self.total += n
        if voiced:
            self.voiced += n
        if self.sink is not None:
            self.sink.write(data)
            return
        self.head += data
        if self.voiced >= self.min_n:
            self.sink = self.open_sink(self.started)
            self.sink.write(bytes(self.head))
            self.head = bytearray()

    def end(self):
        if self.sink is not None:
            info = self.sink.close() or {}
            self.saved += 1
            self.clips.append(dict(info, seconds=round(self.total / self.rate, 2), start=self.started))
            del self.clips[:-50]
        elif self.voiced:
            self.dropped += 1
        self._reset()

    def close(self):
        self.end()


class Recorder:
    """The listen tap's recorder (see AudioMeter).

    ● Rec: while STATE/rec.on is there, it tees exactly what plays into an Encoder (RecStream),
    and a new rec.on id starts a new file. A timed one (`until`) ends itself; one started for
    the recording (`autostop` in the job's meta) then ends the job. Retuning restarts the job,
    and the new tap carries on in a new file named for the new frequency.

    Log: while STATE/log.on is there, a ClipGate saves one clip per transmission, gated by
    squelch when it is on and by the audio level when it is off. Broadcasts (wide FM, NOAA)
    are not logged: they never stop. The control files are read every half second."""

    def __init__(self, meta, rate, level=None):
        self.meta = meta
        self.rate = rate
        self.mode = meta.get("mode", "fm")
        self.squelch = int(meta.get("squelch") or 0) > 0 and self.mode != "wbfm"
        self.level = level
        self.loggable = not meta.get("broadcast") and self.mode != "wbfm"
        self.rec = None
        self.rec_enc = None
        self.rec_id = None
        self.rec_until = None
        self.gate = None
        self.log_since = None
        self.encoders = []
        self.last_poll = 0.0
        self.prune_at = 0.0
        self.pruner = None
        self.changed = False
        self.finished = None
        self.saved = []
        self.done_ids = set()   # timed recordings that ended here: never restarted by a stale rec.on

    def info(self, start, clip):
        label = self.meta.get("label") or ""
        return {"freq": self.meta.get("freq"), "mode": self.mode, "station": station_of(label), "label": label,
                "start": int(start * 1000), "clip": clip, "squelch": self.meta.get("squelch", 0), "gain": self.meta.get("gain")}

    def open_encoder(self, start, clip, extra=None):
        path = rec_path(start, self.meta.get("freq") or 0, self.mode, self.meta.get("label"), clip)
        enc = Encoder(path, self.rate, info=dict(self.info(start, clip), **(extra or {})))
        self.encoders.append(enc)
        self.changed = True
        self.maybe_prune(time.time())
        return enc

    def poll(self, now):
        self.last_poll = now
        want = read_json(REC_ON, None) if os.path.exists(REC_ON) else None
        if isinstance(want, dict) and want.get("id") and want.get("id") != self.rec_id and want["id"] not in self.done_ids:
            self.stop_rec()
            self.rec_id = want["id"]
            self.rec_until = want["until"] / 1000 if want.get("until") else None
            self.rec_enc = self.open_encoder(now, False, {"timed": bool(self.rec_until)})
            self.rec = RecStream(self.rec_enc, self.rate, now)
        elif not os.path.exists(REC_ON) and self.rec:
            self.stop_rec()
        if os.path.exists(LOG_ON):
            if self.gate is None and self.loggable:
                self.log_since = (read_json(LOG_ON, None) or {}).get("since") or now_ms()
                self.gate = ClipGate(self.rate, lambda t: self.open_encoder(t, True), squelch=self.squelch, level=self.level)
                self.changed = True
        elif self.gate is not None:
            self.gate.close()
            self.gate = None
            self.changed = True

    def stop_rec(self):
        if self.rec_enc is not None:
            self.saved.append(self.rec_enc.close())
            del self.saved[:-20]
        self.rec = self.rec_enc = self.rec_id = self.rec_until = None
        self.changed = True

    def feed(self, pcm, now):
        if self.rec:
            self.rec.feed(pcm, now)
        if self.gate:
            self.gate.feed(pcm, now)

    def tick(self, now):
        if now - self.last_poll >= REC_POLL_S:
            self.poll(now)
        if self.rec:
            self.rec.tick(now)
            if self.rec_until and now >= self.rec_until:
                secs, name, rid = self.rec.written / self.rate, rel(self.rec_enc.path), self.rec_id
                self.done_ids.add(rid)
                self.stop_rec()
                cur = read_json(REC_ON, None)
                if isinstance(cur, dict) and cur.get("id") == rid:
                    try:
                        os.remove(REC_ON)
                    except OSError:
                        pass
                if self.meta.get("autostop"):
                    self.finished = f"Recorded {fmt_dur(secs)} of {self.meta.get('label') or self.meta.get('freq')} to {name}."
        if self.gate:
            self.gate.tick(now)
        for e in list(self.encoders):
            e.pump()
            if e.closing and e.poll():
                self.encoders.remove(e)
                self.changed = True
        if (self.rec or self.gate) and now - self.prune_at > PRUNE_EVERY_S:
            self.maybe_prune(now)
        if self.pruner is not None and self.pruner.poll() is not None:
            self.pruner = None

    def maybe_prune(self, now):
        """The retention cap, from the tap: in a detached `rec prune` (moving files to the Trash
        takes a moment, never the audio's), at the first recording and hourly while recording."""
        if now - self.prune_at < 60 or self.pruner is not None:
            return
        self.prune_at = now
        if time.time() - (rec_conf()["pruned"] or 0) / 1000 < PRUNE_EVERY_S:
            return
        self.pruner = subprocess.Popen([sys.executable, SCRIPT, "rec", "prune"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)

    def state(self):
        rec = log = None
        if self.rec:
            try:
                size = os.path.getsize(self.rec_enc.path)
            except OSError:
                size = 0
            rec = {"on": True, "id": self.rec_id, "file": rel(self.rec_enc.path), "since": int(self.rec.started * 1000),
                   "seconds": round(self.rec.written / self.rate, 1), "bytes": size,
                   "until": int(self.rec_until * 1000) if self.rec_until else None}
        if self.gate or os.path.exists(LOG_ON):
            g = self.gate
            log = {"on": bool(g), "since": self.log_since, "clips": g.saved if g else 0, "dropped": g.dropped if g else 0,
                   "open": bool(g and g.sink is not None), "gate": "squelch" if self.squelch else "level",
                   "skipped": None if self.loggable else "broadcast",
                   "last": g.clips[-1] if g and g.clips else None}
        return rec, log

    def close(self):
        self.stop_rec()
        if self.gate:
            self.gate.close()
            self.gate = None
        for e in self.encoders:
            e.closing = True
            e.pump()
        for e in self.encoders:
            e.wait(5.0)
        self.encoders = []


WEAK_SAY = "weak signal — try the antenna by a window"


def meter_read():
    info = read_pid("listen")
    m = read_json(METER, None)
    if not info:
        return {"ok": True, "running": False, "meter": None}
    eq = read_json(EQ, None)
    eq = eq if eq and eq.get("since", 0) >= info.get("started", 0) - 3000 and now_ms() - eq.get("at", 0) < 3000 else None
    if m and m.get("since", 0) >= info.get("started", 0) - 3000 and not m.get("stopped"):
        return {"ok": True, "running": True, "meter": m, "eq": eq, "now": now_ms()}
    return {"ok": True, "running": True, "meter": None, "eq": eq, "now": now_ms()}


def listen(args, lock=None, extra=None):
    if not args or args[0] in ("stop", "off"):
        m = stop_kind("listen")
        try:
            os.remove(REC_ON)  # ● Rec belongs to that listening; Log stays on until turned off
        except OSError:
            pass
        return {"ok": True, "stopped": bool(m), "say": f"Stopped {m.get('label') or m.get('freq')}." if m else "Nothing was playing."}
    if args[0] == "meter":
        touch_heartbeat()
        touch(EQ_SEEN)
        return meter_read()
    opts = {"squelch": None, "volume": 100, "gain": None}
    quick = "--quick" in args
    if quick:
        args.remove("--quick")
    for flag in ("--squelch", "--volume", "--gain"):
        if flag in args:
            k = args.index(flag)
            try:
                v = args[k + 1]
                opts[flag[2:]] = v if flag == "--gain" and v == "auto" else float(v)
            except (IndexError, ValueError):
                pass
            del args[k:k + 2]
    try:
        freq = float(args[0].lower().rstrip("mhz"))
    except ValueError:
        return {"ok": False, "say": "Usage: radio.py listen <MHz> [wbfm|fm|am], e.g. listen 94.1 or listen 162.55 fm."}
    if not 0.5 <= freq <= 1766:
        return {"ok": False, "say": "The V4 tunes 0.5-1766 MHz (HF below 28.8 MHz through its upconverter); pick a frequency in that range."}
    name, guessed = name_for(freq)
    mode = (args[1].lower() if len(args) > 1 else None) or guessed or "fm"
    mode = MODE_ALIASES.get(mode, mode)
    if mode not in AUDIO_MODES:
        return {"ok": False, "say": f"Mode {mode}? Use wbfm (broadcast FM), fm (narrow: weather, ham, public service), am (aircraft), usb/lsb (SSB: ham HF, marine) or cw (Morse)."}
    if guessed is None and len(args) < 2 and name:
        return {"ok": False, "say": f"{freq:g} MHz is {name}: data, not voice, so there is nothing to listen to."}
    if not player_argv(48000, 100):
        return {"ok": False, "say": "No audio player: install sox (brew install sox) or ffmpeg."}
    squelch = opts["squelch"]
    if squelch is None:
        # NOAA broadcasts all the time, so no squelch there; elsewhere hold back the hiss between
        # calls. The V4's noise reads under 20 at gain 40 and KIH42 about 90, so 40 opens for a
        # usable signal (0.1.0's 130 kept even KIH42 shut).
        squelch = 0 if mode != "fm" or 162.39 <= freq <= 162.56 else 40
    gain = opts["gain"]
    if gain is None:
        gain = "auto" if mode == "wbfm" else 40
    label = name if name and "spur" not in name else f"{freq:g} MHz"
    # A broadcast that never stops (wide FM, NOAA) heard as noise is a weak signal; a voice
    # channel (aircraft, repeaters, marine) heard as noise is just idle.
    broadcast = mode == "wbfm" or 162.39 <= freq <= 162.56
    meta = {"freq": round(freq, 5), "mode": mode, "label": label, "squelch": int(squelch), "gain": gain, "broadcast": broadcast,
            "volume": max(0, min(100, opts["volume"])), "player": os.path.basename(player_argv(48000, 100)[0]), "tap": TAP_VERSION,
            **(extra or {})}
    if not read_pid("listen"):
        try:
            os.remove(REC_ON)  # a fresh Listen starts with ● Rec off; a retune carries it on
        except OSError:
            pass
    ok, why, stopped, err = start_kind("listen", meta)
    if not ok:
        return {"ok": False, "error": err, "say": why, "listen": None, "stopped": stopped}
    tag = f"{label}, {mode_label(mode)}" if "(" in label else f"{label} ({mode_label(mode)})"
    say = f"Now playing {tag} on the Mac's audio output."
    meter = None
    weak = None
    if not quick:
        # Hand the V4's lock back (the job holds the dongle, not the lock) and listen for ~3 s.
        if lock:
            lock.release()
        end = time.time() + 3.2
        while time.time() < end:
            time.sleep(0.4)
            r = meter_read()
            meter = r.get("meter")
            if meter and (meter.get("weak") is not None or meter.get("idle") is not None) and meter.get("heard", 0) >= 2.5:
                break
        if meter and meter.get("weak"):
            weak = True
            say = f"Now playing {tag}: {WEAK_SAY}. It is mostly noise here right now."
        elif meter and meter.get("idle"):
            say = f"Now playing {tag}: quiet right now, only noise until someone transmits."
        elif meter and meter.get("squelch") == "closed" and not meter.get("heard"):
            say = f"Tuned {tag}: squelch {int(squelch)} is closed, so it stays silent until someone transmits. Lower the squelch to hear the noise."
    return {"ok": True, "error": None, "say": say, "listen": meta, "stopped": stopped, "meter": meter, "weak": weak}


# ---------------------------------------------------------------- recordings: rec, log, record, recordings, play

def rec_conf():
    c = read_json(REC_CONF, {}) or {}
    try:
        gb = float(c.get("gb") or KEEP_GB)
    except (TypeError, ValueError):
        gb = KEEP_GB
    try:
        days = float(c.get("days") or KEEP_DAYS)
    except (TypeError, ValueError):
        days = KEEP_DAYS
    return {"gb": gb, "days": days, "pruned": c.get("pruned") or 0}


def rec_conf_set(**kw):
    c = read_json(REC_CONF, {}) or {}
    c.update(kw)
    write_json(REC_CONF, c)


def trash_paths(paths):
    """Moves files to the macOS Trash (never rm): /usr/bin/trash (macOS 15+), else Foundation's
    trashItemAtURL through osascript. Returns the paths that are gone."""
    paths = [p for p in paths if os.path.exists(p)]
    if not paths:
        return []
    if os.path.exists("/usr/bin/trash"):
        run(["/usr/bin/trash", *paths], 120)
    left = [p for p in paths if os.path.exists(p)]
    if left:
        js = ("ObjC.import('Foundation');function run(a){const fm=$.NSFileManager.defaultManager;"
              "a.forEach(p=>fm.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(p),null,null));return ''}")
        run(["/usr/bin/osascript", "-l", "JavaScript", "-e", js, *left], 120)
    return [p for p in paths if not os.path.exists(p)]


def rec_scan(day=None):
    """The recordings on disk (one day's, or all), oldest first: each its sidecar's fields plus path,
    file (relative to the root), size and mtime. A file without a sidecar is read from its name."""
    out_ = []
    try:
        days = sorted(d for d in os.listdir(REC_ROOT) if re.fullmatch(r"\d{4}-\d\d-\d\d", d))
    except OSError:
        return out_
    for d in days:
        if day and d != day:
            continue
        folder = os.path.join(REC_ROOT, d)
        try:
            names = os.listdir(folder)
        except OSError:
            continue
        for f in names:
            if not f.endswith(".m4a") or f.startswith("."):
                continue
            path = os.path.join(folder, f)
            try:
                stt = os.stat(path)
            except OSError:
                continue
            side = read_json(path[:-4] + ".json", None) or {}
            if not side.get("start"):
                m = re.match(r"(\d\d)(\d\d)(\d\d)_([\d.]+)_([a-z]+)", f)
                if m:
                    t = time.mktime(time.strptime(f"{d} {m.group(1)}:{m.group(2)}:{m.group(3)}", "%Y-%m-%d %H:%M:%S"))
                    side = dict(side, start=int(t * 1000), freq=float(m.group(4)), mode={"wfm": "wbfm", "nfm": "fm"}.get(m.group(5), m.group(5)),
                                clip=f.endswith("_clip.m4a") or "_clip-" in f)
            out_.append(dict(side, path=path, file=f"{d}/{f}", day=d, name=f, size=stt.st_size, mtime=stt.st_mtime))
    out_.sort(key=lambda it: (it.get("start") or it["mtime"] * 1000))
    return out_


def rec_busy(it, now=None):
    return bool(it.get("recording")) and (now or time.time()) - it["mtime"] < 120


def prune(now=None, trash=None, conf=None):
    """The retention cap: recordings older than `days` go to the Trash, then the oldest until the
    rest fit in `gb`. One being written is never touched."""
    now = now or time.time()
    conf = conf or rec_conf()
    trash = trash or trash_paths
    items = rec_scan()
    victims = [it for it in items if not rec_busy(it, now) and (it.get("start") or it["mtime"] * 1000) / 1000 < now - conf["days"] * 86400]
    gone = {it["path"] for it in victims}
    total = sum(it["size"] for it in items if it["path"] not in gone)
    cap = conf["gb"] * 1e9
    for it in items:
        if total <= cap:
            break
        if it["path"] in gone or rec_busy(it, now):
            continue
        victims.append(it)
        gone.add(it["path"])
        total -= it["size"]
    paths = []
    for it in victims:
        paths.append(it["path"])
        if os.path.exists(it["path"][:-4] + ".json"):
            paths.append(it["path"][:-4] + ".json")
    moved = set(trash(paths)) if paths else set()
    freed = sum(it["size"] for it in victims if it["path"] in moved)
    for it in victims:
        try:
            os.rmdir(os.path.dirname(it["path"]))  # only ever an empty day folder
        except OSError:
            pass
    rec_conf_set(pruned=int(now * 1000))
    kept = sum(it["size"] for it in items) - freed
    return {"ok": True, "trashed": [rel(p) for p in paths if p in moved and p.endswith(".m4a")], "freed": freed, "total": kept,
            "keep": {"gb": conf["gb"], "days": conf["days"]}}


def maybe_prune():
    if time.time() - rec_conf()["pruned"] / 1000 >= PRUNE_EVERY_S:
        if os.path.isdir(IQ_ROOT):
            try:
                iq_prune()
            except Exception:
                pass
        if os.path.isdir(REC_ROOT):
            try:
                return prune()
            except Exception:
                return None
    return None


def resolve_rec(name):
    """A recording by its name, its day/name, or its path: always inside the recordings folder."""
    if not name:
        return None
    cands = [name, os.path.join(REC_ROOT, name)]
    if "/" not in name:
        cands += [os.path.join(REC_ROOT, d, name) for d in sorted(os.listdir(REC_ROOT), reverse=True)] if os.path.isdir(REC_ROOT) else []
    root = os.path.realpath(REC_ROOT)
    for c in cands:
        p = os.path.realpath(os.path.expanduser(c))
        if p.endswith(".m4a") and os.path.isfile(p) and os.path.commonpath([p, root]) == root:
            return p
    return None


def live_tap():
    """The running listen job's meta and its tap's reading (rec / log), or (None, None)."""
    info = read_pid("listen")
    if not info:
        return None, None
    return info.get("meta") or {}, meter_read().get("meter")


def wait_meter(test, seconds=2.5):
    end = time.time() + seconds
    m = None
    while time.time() < end:
        m = meter_read().get("meter")
        if m and test(m):
            return m
        time.sleep(0.15)
    return None


def finished_sidecar(relpath, seconds=3.0):
    side = os.path.join(REC_ROOT, relpath)[:-4] + ".json"
    end = time.time() + seconds
    s = None
    while time.time() < end:
        s = read_json(side, None)
        if s and not s.get("recording"):
            return s
        time.sleep(0.15)
    return s


LEGACY_SAY = ("This Listen started before recording was added to the tab: press ■ Stop and ▶ Listen once "
              "(a second of silence), then it can record.")


def rec_start(until=None):
    meta, m = live_tap()
    if meta is None:
        return {"ok": False, "error": "idle", "say": "Nothing is playing: press ▶ Listen first, then ● Rec. (/sdr record <MHz> <seconds> records without listening.)"}
    if not meta.get("tap"):
        return {"ok": False, "error": "legacy", "say": LEGACY_SAY}
    maybe_prune()
    token = {"id": str(now_ms()), "at": now_ms(), "until": until}
    write_json(REC_ON, token)
    got = wait_meter(lambda x: (x.get("rec") or {}).get("id") == token["id"])
    label = meta.get("label") or f"{meta.get('freq')} MHz"
    if not got:
        return {"ok": False, "error": "tap", "say": f"● Rec is on, but the tap has not started the file yet ({label}). Try again in a moment.",
                "rec": None}
    r = got["rec"]
    where = pretty(os.path.join(REC_ROOT, r["file"]))
    return {"ok": True, "rec": r, "where": where,
            "say": f"Recording {label}{f' for {fmt_dur((until - token['at']) / 1000)}' if until else ''} to {where}."}


def rec_stop():
    meta, m = live_tap()
    was = (m or {}).get("rec")
    try:
        os.remove(REC_ON)
    except OSError:
        if not was:
            return {"ok": True, "stopped": False, "say": "● Rec was not on."}
    if not was:
        return {"ok": True, "stopped": True, "say": "● Rec off."}
    wait_meter(lambda x: not x.get("rec"))
    side = finished_sidecar(was["file"]) or {}
    dur = side.get("duration", was.get("seconds"))
    return {"ok": True, "stopped": True, "file": was["file"], "duration": dur, "size": side.get("size"),
            "say": f"Saved {fmt_dur(dur)}{f' ({fmt_size(side.get('size'))})' if side.get('size') else ''}: {was['file']}."}


def log_count(since_ms):
    if not since_ms:
        return 0, 0.0
    day0 = time.strftime("%Y-%m-%d", time.localtime(since_ms / 1000))
    n, secs = 0, 0.0
    for it in rec_scan():
        if it["day"] >= day0 and it.get("clip") and (it.get("start") or 0) >= since_ms:
            n += 1
            secs += it.get("duration") or 0
    return n, secs


def log_cmd(sub):
    meta, m = live_tap()
    if sub in ("start", "on"):
        cur = read_json(LOG_ON, None) if os.path.exists(LOG_ON) else None
        since = (cur or {}).get("since") or now_ms()
        maybe_prune()
        write_json(LOG_ON, {"since": since})
        head = f"Log on{f' since {clock_of(since)}' if cur else ''}: each transmission is saved as a clip (it ends 2 s after the voice stops; under 0.5 s is skipped)"
        if meta is None:
            say = f"{head}, while Listen plays a voice channel (air, ham, marine, rail). Press ▶ Listen."
        elif not meta.get("tap"):
            say = f"{head}. {LEGACY_SAY}"
        elif meta.get("broadcast") or meta.get("mode") == "wbfm":
            say = f"{head}, but {meta.get('label')} never stops transmitting: Log saves voice channels (air, ham, marine, rail). ● Rec records a broadcast."
        else:
            gate = f"squelch {meta.get('squelch')}" if int(meta.get("squelch") or 0) > 0 and meta.get("mode") != "wbfm" else "the audio level (squelch is off)"
            say = f"{head}, on {meta.get('label')} by {gate}."
        return {"ok": True, "log": {"on": True, "since": since}, "say": say}
    if sub in ("stop", "off"):
        cur = read_json(LOG_ON, None) if os.path.exists(LOG_ON) else None
        if not os.path.exists(LOG_ON):
            return {"ok": True, "log": {"on": False}, "say": "Log was not on."}
        try:
            os.remove(LOG_ON)
        except OSError:
            pass
        if meta is not None:
            wait_meter(lambda x: not (x.get("log") or {}).get("on"), 1.5)
            time.sleep(0.3)
        since = (cur or {}).get("since")
        n, secs = log_count(since)
        return {"ok": True, "log": {"on": False, "since": since, "count": n},
                "say": f"Log off: {n} transmission{'' if n == 1 else 's'} saved{f' since {clock_of(since)}' if since else ''}{f' ({fmt_dur(secs)})' if n else ''}."}
    return {"ok": False, "say": "log start|stop"}


def playback_state():
    p = read_json(PLAYBACK, None)
    if p and alive(p.get("pid"), ("ffplay",)):
        return p
    return None


def play_stop():
    p = playback_state()
    if p:
        try:
            os.kill(p["pid"], signal.SIGTERM)
        except OSError:
            pass
    try:
        os.remove(PLAYBACK)
    except OSError:
        pass
    return p


def play(args):
    if not args or args[0] in ("stop", "off"):
        p = play_stop()
        return {"ok": True, "stopped": bool(p), "say": f"Stopped playing {p['file']}." if p else "Nothing was playing back."}
    vol = 100
    if "--volume" in args:
        k = args.index("--volume")
        try:
            vol = max(0, min(100, int(float(args[k + 1]))))
        except (IndexError, ValueError):
            pass
        del args[k:k + 2]
    path = resolve_rec(" ".join(args))
    if not path:
        return {"ok": False, "error": "missing", "say": f"No recording {' '.join(args)} in {pretty(REC_ROOT)}."}
    if not os.path.exists(FFPLAY):
        return {"ok": False, "error": "ffplay", "say": "ffplay is missing: brew install ffmpeg."}
    play_stop()
    side = read_json(path[:-4] + ".json", None) or {}
    p = subprocess.Popen([FFPLAY, "-nodisp", "-autoexit", "-loglevel", "error", "-volume", str(vol), path], stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
    state = {"pid": p.pid, "file": rel(path), "started": now_ms(), "duration": side.get("duration"), "volume": vol}
    write_json(PLAYBACK, state)
    meta, _ = live_tap()
    over = ""
    if meta is not None and vol > 0 and (meta.get("volume") or 0) > 0:
        over = f" Listen keeps playing {meta.get('label') or meta.get('freq')} underneath (so Rec and Log keep saving); ■ Stop on the tuner silences it."
    return {"ok": True, "playing": state, "say": f"Playing {rel(path)}{f' ({fmt_dur(side.get('duration'))})' if side.get('duration') else ''} on the Mac.{over}"}


def repair_sidecars(items, active):
    """A sidecar still saying "recording" whose file nobody is writing (the job was killed; ffmpeg
    still finished the file at the end of its input): its duration from ffprobe."""
    for it in items:
        if not it.get("recording") or it["file"] in active or time.time() - it["mtime"] < 30:
            continue
        dur = None
        txt = run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", it["path"]], 10).strip()
        try:
            dur = round(float(txt), 2)
        except ValueError:
            pass
        side = read_json(it["path"][:-4] + ".json", None) or {}
        side.update(recording=False, duration=dur if dur is not None else side.get("duration", 0), size=it["size"], repaired=True,
                    ok=dur is not None)
        write_json(it["path"][:-4] + ".json", side)
        it.update(side)


def day_label(day, today):
    t = time.mktime(time.strptime(day, "%Y-%m-%d"))
    t0 = time.mktime(time.strptime(today, "%Y-%m-%d"))
    d = round((t0 - t) / 86400)
    return "Yesterday" if d == 1 else time.strftime("%a %b %d", time.localtime(t)).replace(" 0", " ")


def recordings(args):
    day = time.strftime("%Y-%m-%d")
    if "--day" in args:
        try:
            day = args[args.index("--day") + 1]
        except IndexError:
            pass
    today = time.strftime("%Y-%m-%d")
    pruned = maybe_prune()
    meta, m = live_tap()
    active = set()
    if m:
        if (m.get("rec") or {}).get("file"):
            active.add(m["rec"]["file"])
    items = rec_scan()
    repair_sidecars(items, active)
    keys = ("file", "name", "start", "freq", "mode", "station", "label", "duration", "size", "clip", "recording", "timed", "ok")
    shown = [{k: it.get(k) for k in keys} for it in items if it["day"] == day]
    shown.reverse()
    days = {}
    for it in items:
        if it["day"] == day:
            continue
        d = days.setdefault(it["day"], {"day": it["day"], "recordings": 0, "clips": 0, "seconds": 0.0, "bytes": 0})
        d["clips" if it.get("clip") else "recordings"] += 1
        d["seconds"] += it.get("duration") or 0
        d["bytes"] += it["size"]
    older = sorted(days.values(), key=lambda d: d["day"], reverse=True)
    for d in older:
        d["label"] = day_label(d["day"], today)
        d["seconds"] = round(d["seconds"], 1)
    conf = rec_conf()
    log_on = os.path.exists(LOG_ON)
    since = (read_json(LOG_ON, None) or {}).get("since") if log_on else None
    n, secs = log_count(since) if log_on else (0, 0.0)
    total = sum(it["size"] for it in items)
    rec = (m or {}).get("rec")
    tap_log = (m or {}).get("log")
    say = (f"{len(shown)} recording{'' if len(shown) == 1 else 's'} on {day}" if shown else f"Nothing recorded on {day} yet") + \
          f" · {fmt_size(total)} on disk (kept: {conf['gb']:g} GB, {conf['days']:g} days)"
    return {"ok": True, "day": day, "today": day == today, "root": REC_ROOT, "dir": os.path.join(REC_ROOT, day), "items": shown[:300],
            "count": len(shown), "older": older[:14], "total": {"bytes": total, "files": len(items)},
            "keep": {"gb": conf["gb"], "days": conf["days"], "pruned": conf["pruned"]},
            "rec": rec, "log": {"on": log_on, "since": since, "count": n, "seconds": round(secs, 1),
                                "skipped": (tap_log or {}).get("skipped"), "open": bool((tap_log or {}).get("open")),
                                "gate": (tap_log or {}).get("gate")},
            "listen": {"running": meta is not None, "label": (meta or {}).get("label"), "freq": (meta or {}).get("freq"),
                       "volume": (meta or {}).get("volume"), "tap": (meta or {}).get("tap"), "autostop": bool((meta or {}).get("autostop"))},
            "playing": playback_state(), "pruned": pruned, "say": say, "now": now_ms()}


def rec_cmd(args):
    sub = args[0] if args else "status"
    if sub in ("start", "on"):
        secs = None
        if "--seconds" in args:
            try:
                secs = max(1, min(MAX_TIMED_S, int(float(args[args.index("--seconds") + 1]))))
            except (IndexError, ValueError):
                pass
        return rec_start(now_ms() + secs * 1000 if secs else None)
    if sub in ("stop", "off"):
        return rec_stop()
    if sub == "prune":
        return prune()
    if sub == "keep":
        conf = rec_conf()
        try:
            gb = float(args[1])
            days = float(args[2]) if len(args) > 2 else conf["days"]
        except (IndexError, ValueError):
            return {"ok": True, "keep": conf, "say": f"Keeping recordings up to {conf['gb']:g} GB and {conf['days']:g} days; the oldest go to the Trash. rec keep <GB> [days] changes it."}
        if not (0.05 <= gb <= 500) or not (1 <= days <= 3650):
            return {"ok": False, "say": "rec keep <GB> [days]: between 0.05 and 500 GB, 1 and 3650 days."}
        rec_conf_set(gb=gb, days=days)
        r = prune()
        moved = len(r["trashed"])
        return {"ok": True, "keep": rec_conf(), "trashed": r["trashed"],
                "say": f"Keeping recordings up to {gb:g} GB and {days:g} days.{f' Moved {moved} old recording' + ('' if moved == 1 else 's') + ' to the Trash.' if moved else ''} {fmt_size(r['total'])} on disk."}
    if sub == "delete":
        path = resolve_rec(" ".join(args[1:]))
        if not path:
            return {"ok": False, "error": "missing", "say": "No such recording."}
        it = next((x for x in rec_scan() if x["path"] == path), None)
        if it and rec_busy(it):
            return {"ok": False, "error": "busy", "say": "That one is still being recorded: stop it first."}
        p = playback_state()
        if p and os.path.realpath(os.path.join(REC_ROOT, p["file"])) == path:
            play_stop()
        moved = trash_paths([path] + ([path[:-4] + ".json"] if os.path.exists(path[:-4] + ".json") else []))
        ok = path in moved
        return {"ok": ok, "say": f"Moved {rel(path)} to the Trash." if ok else f"Could not move {rel(path)} to the Trash."}
    if sub in ("reveal", "finder", "show"):
        path = resolve_rec(" ".join(args[1:])) if len(args) > 1 else None
        target = path or os.path.join(REC_ROOT, time.strftime("%Y-%m-%d"))
        if not os.path.isdir(target) and not path:
            target = REC_ROOT
            os.makedirs(target, exist_ok=True)
        run(["/usr/bin/open", "-R", target] if path else ["/usr/bin/open", target], 10)
        return {"ok": True, "say": f"Opened {pretty(target)} in Finder."}
    return recordings(args[1:])


def record(args, lock=None):
    """record <MHz> [mode] <seconds>: a timed recording. Records what plays when Listen is on that
    frequency; otherwise starts Listen muted for it (through the job manager, stopping whatever
    holds the V4 and saying so), and that Listen ends itself when the time is up."""
    nums = [a for a in args if re.fullmatch(r"\d+(\.\d+)?(mhz)?", a.lower())]
    modes = [a for a in args if a.lower() in ("wbfm", "wfm", "fm", "nfm", "am", "wide", "narrow")]
    if len(nums) < 2:
        return {"ok": False, "say": "record <MHz> [wbfm|fm|am] <seconds>, e.g. record 162.55 fm 10."}
    freq = float(nums[0].lower().rstrip("mhz"))
    secs = max(1, min(MAX_TIMED_S, int(float(nums[1]))))
    meta, _ = live_tap()
    if meta is not None and abs((meta.get("freq") or 0) - freq) < 0.0005:
        if lock:
            lock.release()
        r = rec_start(now_ms() + secs * 1000)
        if r.get("ok"):
            r["say"] = f"Recording {fmt_dur(secs)} of what is playing ({meta.get('label')}) to {r['where']}."
        return r
    largs = [f"{freq:g}"] + ([modes[0]] if modes else []) + ["--volume", "0", "--quick"]
    res = listen(largs, lock, extra={"autostop": True, "keep": True})
    if not res.get("ok"):
        return res
    if lock:
        lock.release()
    r = rec_start(now_ms() + secs * 1000)
    label = res["listen"]["label"]
    if r.get("ok"):
        r["say"] = f"Recording {fmt_dur(secs)} of {label}, muted; it stops by itself. The file: {r['where']}."
    else:
        listen(["stop"])
    r["stopped"] = res.get("stopped") or []
    r["listen"] = res.get("listen")
    return r


# ---------------------------------------------------------------- share (rtl_tcp)

def lan_ip():
    iface = ""
    for line in run(["/sbin/route", "-n", "get", "default"], 5).splitlines():
        if "interface:" in line:
            iface = line.split(":", 1)[1].strip()
    for i in ([iface] if iface else []) + ["en0", "en1"]:
        ip = run(["/usr/sbin/ipconfig", "getifaddr", i], 5).strip()
        if ip:
            return ip
    return None


def tailscale_ip():
    for exe in (os.path.join(BIN, "tailscale"), "/Applications/Tailscale.app/Contents/MacOS/Tailscale"):
        if os.path.exists(exe):
            for line in run([exe, "ip", "-4"], 5).splitlines():
                if re.match(r"^\d+\.\d+\.\d+\.\d+$", line.strip()):
                    return line.strip()
    return None


def share(args):
    sub = args[0] if args else "start"
    if sub in ("stop", "off"):
        m = stop_kind("share")
        return {"ok": True, "stopped": bool(m), "say": "Stopped sharing the V4." if m else "It was not being shared."}
    port = 1234
    if "--port" in args:
        try:
            port = int(args[args.index("--port") + 1])
        except (IndexError, ValueError):
            pass
    scope = next((a for a in args[1:] if a in ("all", "lan", "tailscale")), "all")
    lan, ts = lan_ip(), tailscale_ip()
    addr = {"lan": lan, "tailscale": ts}.get(scope) or "0.0.0.0"
    if scope != "all" and addr == "0.0.0.0":
        return {"ok": False, "say": f"No {scope} address on this Mac right now."}
    meta = {"port": port, "addr": addr}
    ok, why, stopped, err = start_kind("share", meta)
    where = [x for x in ([f"{ts}:{port} (Tailscale)"] if ts and addr in ("0.0.0.0", ts) else []) + ([f"{lan}:{port} (home Wi-Fi)"] if lan and addr in ("0.0.0.0", lan) else [])]
    say = ("Sharing the V4 with rtl_tcp. In an SDR app on the phone (e.g. CoronaSDR), add an rtl_tcp source at " + " or ".join(where) + "."
           if ok else why)
    return {"ok": ok, "error": err, "say": say, "share": {"port": port, "addr": addr, "lan": lan, "tailscale": ts} if ok else None, "stopped": stopped}


# ---------------------------------------------------------------- the built-in modes

GADGET_BANDS = {"433": "433.92 MHz", "915": "915 MHz", "hop": "433.92 + 915 MHz"}

register_mode(Mode("gadgets", "Gadget listener", ("rtl_433",), gadgets_pipeline, reader=lambda meta: GadgetReader(),
                   doing=lambda meta: "listen for gadgets",
                   detail=lambda meta: f"rtl_433 on {GADGET_BANDS.get(meta.get('band', '433'), '433.92 MHz')}"))
register_mode(Mode("listen", "Audio", ("rtl_fm", "play", "ffplay", "sox"), lambda meta: list(listen_argv(meta)),
                   reader=lambda meta: AudioMeter(meta), forward=True,
                   doing=lambda meta: f"{'record' if meta.get('autostop') else 'play'} {meta.get('label') or meta.get('freq')}"
                                      f"{' in the Radio tab' if meta.get('via') == 'websdr' else ''}",
                   detail=lambda meta: f"{'recording (muted)' if meta.get('autostop') else 'playing'} {meta.get('label') or meta.get('freq')}"))
register_mode(Mode("share", "Phone share", ("rtl_tcp",),
                   lambda meta: [[RTL_TCP, "-a", meta.get("addr", "0.0.0.0"), "-p", str(meta.get("port", 1234))]],
                   stdout_log=True, doing=lambda meta: "share itself with the phone (rtl_tcp)",
                   detail=lambda meta: f"rtl_tcp on :{meta.get('port', 1234)}"))
register_mode(Mode("live", "Live view", ("rtl_power",), lambda meta: [live_argv(meta)],
                   reader=lambda meta: LiveSpectrum(meta), lease_s=LIVE_LEASE_S, heartbeat=LIVE_SEEN,
                   doing=lambda meta: f"show {meta.get('label')} live",
                   detail=lambda meta: f"{meta.get('label')}"))
# The Scanner (0.4.0): one process (scanloop) that manages its own rtl_fm / player and records the
# live rtl_fm pid into the pidfile so owner_info names it. The IQ snapshot: one rtl_sdr that stops
# itself (-n), so lease_s=0 and the wrapper ends the job when it exits.
register_mode(Mode("scanner", "Scanner", ("rtl_fm", "play", "ffplay", "sox"),
                   lambda meta: [[sys.executable, SCRIPT, "_scan", json.dumps(meta)]],
                   doing=lambda meta: "run the scanner", detail=lambda meta: scanner_detail()))
register_mode(Mode("snapshot", "IQ snapshot", ("rtl_sdr",), lambda meta: [snapshot_argv(meta)], lease_s=0,
                   doing=lambda meta: f"capture an IQ snapshot of {meta.get('mhz')} MHz",
                   detail=lambda meta: f"rtl_sdr {meta.get('mhz')} MHz at {int(meta.get('rate', 1_024_000)) / 1e6:g} MS/s"))


# ---------------------------------------------------------------- Web SDR (webrx/, an external mode)

def webrx_call(name, timeout):
    """webrx/<name> (start.sh / stop.sh / status.sh): its one JSON object."""
    try:
        p = subprocess.run([os.path.join(WEBRX_DIR, name)], capture_output=True, text=True, timeout=timeout,
                           stdin=subprocess.DEVNULL)
    except Exception as err:
        return {"ok": False, "error": "webrx", "say": f"Web SDR {name} failed: {type(err).__name__}: {err}"[:300]}
    lines = [ln for ln in p.stdout.strip().splitlines() if ln.startswith("{")]
    try:
        return json.loads(lines[-1])
    except (IndexError, ValueError):
        return {"ok": False, "error": "webrx", "say": f"Web SDR {name}: " + (p.stderr or p.stdout or f"exit {p.returncode}").strip()[-300:]}


def webrx_probe():
    """Web SDR is running while the rtl_tcp its start.sh exec'd (pid in WEBRX_PID) lives."""
    try:
        with open(WEBRX_PID) as f:
            pid = int(f.read().strip())
    except (OSError, ValueError):
        return None
    if not alive(pid, ("rtl_tcp",)):
        return None
    return {"pid": pid, "kind": "webrx", "started": int(mtime(WEBRX_PID) * 1000),
            "meta": {"label": "Web SDR", "port": WEBRX_PORT}, "children": [pid]}


if os.path.exists(os.path.join(WEBRX_DIR, "start.sh")):
    register_mode(Mode("webrx", "Web SDR", ("rtl_tcp",), probe=webrx_probe, holds_lock=True,
                       starter=lambda meta: webrx_call("start.sh", 300), stopper=lambda: webrx_call("stop.sh", 90),
                       doing=lambda meta: "run Web SDR", detail=lambda meta: f"OpenWebRX+ on :{WEBRX_PORT}"))


# Web SDR's "Send to Radio tab": webrx/handoff.py leaves {mhz, mode, at, ...} in handoff.json.
HANDOFF_SAY = {"none": "No handoff from Web SDR is waiting.",
               "stale": "The handoff from Web SDR was too old to act on (the Radio tab was not open); dropped it.",
               "invalid": "The handoff from Web SDR was not a frequency and mode the Radio tab plays; dropped it."}


def handoff_read(now=None):
    """(the pending handoff {mhz, mode, at}, None) or (None, "none" | "stale" | "invalid")."""
    d = read_json(HANDOFF, None)
    if d is None:
        return None, "invalid" if os.path.exists(HANDOFF) else "none"
    if not isinstance(d, dict):
        return None, "invalid"
    mhz, mode, at = d.get("mhz"), d.get("mode"), d.get("at")
    if isinstance(mhz, bool) or not isinstance(mhz, (int, float)) or not math.isfinite(mhz) or not 24 <= mhz <= 1766:
        return None, "invalid"
    if mode not in ("wbfm", "fm", "am") or isinstance(at, bool) or not isinstance(at, int):
        return None, "invalid"
    age = (now if now is not None else now_ms()) - at
    if age > HANDOFF_MAX_AGE_S * 1000 or age < -60_000:
        return None, "stale"
    return {"mhz": round(float(mhz), 6), "mode": mode, "at": at}, None


def handoff_clear():
    try:
        os.remove(HANDOFF)
    except OSError:
        pass


def handoff_take(lock=None):
    """Takes the handoff (the file goes first, so it is acted on once), then plays it: listen's
    start_kind stops Web SDR, recorded as "stopped so the V4 could play X in the Radio tab"."""
    h, why = handoff_read()
    handoff_clear()
    if not h:
        return {"ok": why == "none", "error": None if why == "none" else why, "handoff": None, "say": HANDOFF_SAY[why]}
    res = listen([f"{h['mhz']:.6f}".rstrip("0").rstrip("."), h["mode"]], lock, extra={"via": "websdr"})
    res["handoff"] = h
    if res.get("ok"):
        res["say"] = f"From Web SDR: {res.get('say', '')}"
    return res


# ---------------------------------------------------------------- the Scanner (0.4.0)

# A list of favourite channels cycled with squelch; stop and play when one opens, resume after
# a few seconds of quiet. Lock-out / skip / a priority channel. Hits feed the transmission logger
# (clips save when Log is on). One exclusive V4 job ("scanner"): the one-at-a-time rule holds.
SCAN_OPEN_LEVEL = 0.33    # a 0-squelch channel counts as open over this meter level
SCAN_DEFAULTS = {"dwell": 0.8, "resume": 4.0, "priorityEvery": 3.0, "maxPark": 300.0, "volume": 100, "gain": None}
# Seeded favourites: the stations worth parking on around the location (the user adds more with `scan add`).
SCAN_SEED = [(float(f), m, n) for f, m, n in LOC["scan"]]


def norm_f(f):
    return round(float(f), 4)


def default_squelch(freq, mode):
    return 0 if mode != "fm" or 162.39 <= freq <= 162.56 else 40


def seed_favourites():
    """The initial channel list: the known local voice channels plus the busiest airband peaks
    the last Aircraft scan found."""
    chans, seen = [], set()

    def add(f, mode, name, squelch=None):
        f = norm_f(f)
        if f in seen:
            return
        seen.add(f)
        chans.append({"freq": f, "mode": mode, "name": name,
                      "squelch": int(default_squelch(f, mode) if squelch is None else squelch)})
    for f, mode, name in SCAN_SEED:
        add(f, mode, name)
    air = (read_json(ACTIVITY, {}) or {}).get("air") or []
    top = (air[-1].get("top") if air else None) or []
    for row in top[:6]:
        try:
            f = float(row[0])
        except (TypeError, ValueError, IndexError):
            continue
        if 118.0 <= f <= 137.0:
            nm, _ = name_for(f)
            add(round(f, 3), "am", nm or f"{f:g} MHz air")
    return chans


def scanner_conf():
    """Favourites, lock-outs, the priority channel and the timings. Seeds the file on first read
    so the tab can show the favourites at once."""
    c = read_json(SCANNER_CONF, None)
    if not c or not c.get("channels"):
        c = {"channels": seed_favourites(), "lockout": [], "priority": None, "hold": False, "skipAt": 0, **SCAN_DEFAULTS}
        write_json(SCANNER_CONF, c)
        return c
    for k, v in {"lockout": [], "priority": None, "hold": False, "skipAt": 0, **SCAN_DEFAULTS}.items():
        c.setdefault(k, v)
    return c


def scanner_conf_set(**kw):
    c = read_json(SCANNER_CONF, None) or scanner_conf()
    for k, v in {"lockout": [], "priority": None, "hold": False, "skipAt": 0, **SCAN_DEFAULTS}.items():
        c.setdefault(k, v)
    c.update(kw)
    write_json(SCANNER_CONF, c)
    return c


def scan_channels(conf):
    """(the channels to cycle, the priority channel or None): favourites minus lock-outs, in order."""
    lock = {norm_f(f) for f in conf.get("lockout") or []}
    chans = [c for c in conf.get("channels") or [] if norm_f(c["freq"]) not in lock]
    pr = conf.get("priority")
    priority = None
    if pr is not None and norm_f(pr) not in lock:
        priority = next((c for c in (conf.get("channels") or []) if norm_f(c["freq"]) == norm_f(pr)), None)
        if priority is None:
            nm, guessed = name_for(float(pr))
            mode = guessed or "fm"
            priority = {"freq": norm_f(pr), "mode": mode, "name": nm or f"{float(pr):g} MHz",
                        "squelch": int(default_squelch(float(pr), mode))}
    return chans, priority


def scan_open(st):
    """Is a channel transmitting, from the meter's reading? Squelch open when it is on, else a
    level over the gate once enough audio has been heard."""
    if st.get("squelch") == "open":
        return True
    if st.get("squelch") == "closed":
        return False
    return st.get("heard", 0) >= 0.5 and (st.get("level") or 0) >= SCAN_OPEN_LEVEL


def scan_leave(hold, opened, quiet_since, park_start, now, resume, cap):
    """The park rule, as one pure step: parked on a channel, keep playing while it is open; once it
    goes quiet, leave `resume` seconds later; never leave on hold; leave anyway after `cap` seconds
    (a broadcast never goes quiet). Returns (leave, quiet_since)."""
    quiet_since = None if opened else (quiet_since or now)
    if hold:
        return False, quiet_since
    if quiet_since is not None and now - quiet_since >= resume:
        return True, quiet_since
    if now - park_start >= cap:
        return True, quiet_since
    return False, quiet_since


def scan_add(freq, mode=None, name=None, squelch=None):
    f = norm_f(freq)
    nm, guessed = name_for(f)
    mode = MODE_ALIASES.get((mode or "").lower(), (mode or "").lower()) or guessed or "fm"
    if mode not in AUDIO_MODES:
        mode = guessed or "fm"
    ch = {"freq": f, "mode": mode, "name": name or nm or f"{f:g} MHz",
          "squelch": int(default_squelch(f, mode) if squelch is None else squelch)}
    chans = [x for x in scanner_conf()["channels"] if norm_f(x["freq"]) != f]
    chans.append(ch)
    chans.sort(key=lambda x: x["freq"])
    scanner_conf_set(channels=chans)
    return ch


def scan_remove(freq):
    f = norm_f(freq)
    c = scanner_conf()
    chans = [x for x in c["channels"] if norm_f(x["freq"]) != f]
    lock = [x for x in c.get("lockout") or [] if norm_f(x) != f]
    scanner_conf_set(channels=chans, lockout=lock)
    return f


def scanner_detail():
    s = read_json(SCANNER, None) or {}
    cur = s.get("current") or {}
    if s.get("parked") and cur:
        return f"stopped on {cur.get('name') or cur.get('freq')}"
    if cur:
        return f"scanning · {cur.get('freq')} MHz"
    return "scanning favourites"


def scanloop(meta):
    """The detached scanner (the "scanner" job's one process): cycles the favourites with squelch,
    parks and plays when one opens, resumes after the quiet, and writes scanner.json. It manages its
    own rtl_fm / player and records the live rtl_fm pid into the job pidfile so status names it."""
    import select
    stop = {"v": False}

    def _stop(*_):
        stop["v"] = True
    for sg in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sg, _stop)
    base_children = []
    for _ in range(30):                       # wait for the wrapper's pidfile, then own its children list
        info = read_json(pid_path("scanner"))
        if info:
            base_children = list(info.get("children") or [])
            break
        time.sleep(0.1)

    def set_child(pid):
        info = read_json(pid_path("scanner"))
        if info and info.get("pid"):
            info["children"] = base_children + ([pid] if pid else [])
            write_json(pid_path("scanner"), info)

    since = meta.get("since") or now_ms()
    volume = meta.get("volume", 100)
    hits, idx, last_priority = [], 0, 0.0
    last_write = [0.0]
    skip_ref = [scanner_conf().get("skipAt", 0)]

    def write_state(current, parked, scanning, conf, force=False, **extra):
        now = time.time()
        if not force and now - last_write[0] < 0.4:
            return
        last_write[0] = now
        write_json(SCANNER, {"running": True, "since": since, "current": current, "parked": parked,
                             "scanning": scanning, "hold": bool(conf.get("hold")), "hits": hits[-20:],
                             "channels": len(conf.get("channels") or []), "lockout": conf.get("lockout") or [],
                             "priority": conf.get("priority"), "at": now_ms(), **extra})

    def visit(ch, conf):
        """Tune ch, hunt for `dwell` s; park and play if it opens, until the quiet. Returns 'hit',
        'empty', 'skip' or 'stopped'."""
        f = float(ch["freq"])
        mode = ch.get("mode", "fm")
        m = {"freq": round(f, 5), "mode": mode, "label": ch.get("name"), "squelch": int(ch.get("squelch", 0)),
             "gain": conf.get("gain"), "volume": volume, "broadcast": mode == "wbfm" or 162.39 <= f <= 162.56,
             "tap": TAP_VERSION}
        broadcast = m["broadcast"]
        fm_argv, play_cmd = listen_argv(m)
        proc = subprocess.Popen(fm_argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        set_child(proc.pid)
        am = AudioMeter(m)
        player, parked, hit, quiet_since, park_start = None, False, None, None, None
        fd = proc.stdout.fileno()
        start = time.time()
        dwell, resume = float(conf.get("dwell", 0.8)), float(conf.get("resume", 4.0))
        cur = {"freq": m["freq"], "mode": mode, "name": m["label"], "squelch": m["squelch"]}
        result = "empty"
        try:
            while not stop["v"]:
                c2 = scanner_conf()
                if c2.get("skipAt", 0) != skip_ref[0]:
                    skip_ref[0] = c2.get("skipAt", 0)
                    result = "skip"
                    break
                hold = bool(c2.get("hold"))
                r, _, _ = select.select([fd], [], [], 0.2)
                if r:
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        break
                    am.feed(chunk)
                    am.tick()
                    if parked and player and player.poll() is None:
                        try:
                            player.stdin.write(chunk)
                            player.stdin.flush()
                        except (BrokenPipeError, OSError):
                            player = None
                else:
                    am.tick()
                stt = am.state()
                opened = scan_open(stt)
                now = time.time()
                if not parked:
                    write_state(cur, False, True, c2, heard=stt.get("heard"))
                    if opened:
                        parked, park_start, quiet_since = True, now, None
                        player = (subprocess.Popen(play_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                                   stderr=subprocess.DEVNULL) if play_cmd else None)
                        hit = {"freq": m["freq"], "name": m["label"], "mode": mode, "at": now_ms()}
                        result = "hit"
                    elif not hold and now - start >= dwell:
                        break
                else:
                    write_state(cur, True, False, c2, force=True, heard=stt.get("heard"),
                                level=stt.get("level"))
                    cap = 6.0 if broadcast else float(conf.get("maxPark", 300))
                    leave, quiet_since = scan_leave(hold, opened, quiet_since, park_start, now, resume, cap)
                    if leave:
                        break
        finally:
            for p in (player, proc):
                if p and p.poll() is None:
                    try:
                        p.terminate()
                    except OSError:
                        pass
            try:
                am.close()
            except Exception:
                pass
            set_child(None)
        if hit:
            hit["secs"] = round((now_ms() - hit["at"]) / 1000, 1)
            hits.append(hit)
        return "stopped" if stop["v"] else result

    try:
        while not stop["v"]:
            conf = scanner_conf()
            chans, priority = scan_channels(conf)
            if not chans and not priority:
                write_state(None, False, False, conf, force=True, empty=True)
                for _ in range(10):
                    if stop["v"]:
                        break
                    time.sleep(0.5)
                continue
            now = time.time()
            if priority and now - last_priority >= float(conf.get("priorityEvery", 3)):
                last_priority = now
                if visit(priority, conf) == "stopped":
                    break
                continue
            if not chans:
                continue
            idx %= len(chans)
            if visit(chans[idx], conf) == "stopped":
                break
            idx += 1
    finally:
        write_json(SCANNER, {"running": False, "since": since, "current": None, "parked": False,
                             "scanning": False, "hits": hits[-20:], "at": now_ms()})


def scanner_view():
    s = read_json(SCANNER, None) or {}
    conf = scanner_conf()
    running = bool(read_pid("scanner"))
    chans, priority = scan_channels(conf)
    return {"running": running, "state": s if running else None, "channels": conf["channels"],
            "active": len(chans), "lockout": conf.get("lockout") or [], "priority": conf.get("priority"),
            "hold": bool(conf.get("hold")), "dwell": conf.get("dwell"), "resume": conf.get("resume"),
            "hits": (s.get("hits") if running else []) or [], "now": now_ms()}


def scanner_cmd(args, lock=None):
    sub = (args[0] if args else "list").lower()
    if sub == "list" or sub == "status":
        return scanner_view()
    if sub in ("add",):
        if len(args) < 2:
            return {"ok": False, "say": "Usage: /sdr scan add <MHz> [mode] [name], e.g. scan add 146.52 fm \"2 m calling\"."}
        try:
            f = float(args[1])
        except ValueError:
            return {"ok": False, "say": "Give the frequency in MHz, e.g. scan add 146.52."}
        mode = args[2] if len(args) > 2 and MODE_ALIASES.get(args[2].lower(), args[2].lower()) in AUDIO_MODES else None
        name = " ".join(args[3:]) if len(args) > 3 else (" ".join(args[2:]) if len(args) > 2 and not mode else None)
        ch = scan_add(f, mode, name)
        return {"ok": True, "channel": ch, "say": f"Added {ch['name']} ({ch['freq']:g} MHz {mode_label(ch['mode'])}) to the scanner."}
    if sub in ("remove", "rm", "del", "delete"):
        try:
            f = scan_remove(float(args[1]))
        except (IndexError, ValueError):
            return {"ok": False, "say": "Usage: scan remove <MHz>."}
        return {"ok": True, "say": f"Removed {f:g} MHz from the scanner."}
    if sub in ("lockout", "lock"):
        s = read_json(SCANNER, None) or {}
        f = None
        if len(args) > 1:
            try:
                f = norm_f(args[1])
            except ValueError:
                f = None
        if f is None:
            f = (s.get("current") or {}).get("freq")
        if f is None:
            return {"ok": False, "say": "Nothing to lock out: give a frequency, or lock out the channel the scanner is on."}
        conf = scanner_conf()
        lock = sorted(set((conf.get("lockout") or []) + [norm_f(f)]))
        scanner_conf_set(lockout=lock, skipAt=now_ms())
        return {"ok": True, "say": f"Locked out {float(f):g} MHz. The scanner skips it now."}
    if sub in ("unlock", "clear"):
        conf = scanner_conf()
        if sub == "clear" or len(args) < 2:
            scanner_conf_set(lockout=[])
            return {"ok": True, "say": "Cleared the lock-outs."}
        try:
            f = norm_f(args[1])
        except ValueError:
            return {"ok": False, "say": "Usage: scan unlock <MHz>."}
        scanner_conf_set(lockout=[x for x in conf.get("lockout") or [] if norm_f(x) != f])
        return {"ok": True, "say": f"Unlocked {float(f):g} MHz."}
    if sub == "skip":
        scanner_conf_set(skipAt=now_ms())
        return {"ok": True, "say": "Skipped to the next channel."}
    if sub == "hold":
        scanner_conf_set(hold=True)
        return {"ok": True, "say": "Holding on the current channel. scan resume to carry on."}
    if sub in ("resume", "go", "unhold"):
        scanner_conf_set(hold=False, skipAt=now_ms())
        return {"ok": True, "say": "Resumed scanning."}
    if sub == "priority":
        if len(args) < 2 or args[1].lower() in ("off", "none", "clear"):
            scanner_conf_set(priority=None)
            return {"ok": True, "say": "Priority channel off."}
        try:
            f = norm_f(args[1])
        except ValueError:
            return {"ok": False, "say": "Usage: scan priority <MHz|off>."}
        scanner_conf_set(priority=f)
        return {"ok": True, "say": f"Priority channel set to {float(f):g} MHz; checked every few seconds."}
    if sub in ("on", "start"):
        conf = scanner_conf()
        if not scan_channels(conf)[0] and not scan_channels(conf)[1]:
            return {"ok": False, "say": "No channels to scan: add some with scan add <MHz>, or clear the lock-outs."}
        ok, why, stopped, err = start_kind("scanner", {"since": now_ms(), "volume": conf.get("volume", 100)})
        return {"ok": ok, "error": err, "say": "Scanner on." if ok else why, "stopped": stopped}
    if sub in ("off", "stop"):
        m = stop_kind("scanner")
        return {"ok": True, "stopped": bool(m), "say": "Scanner off." if m else "The scanner was not running."}
    return {"ok": False, "say": "scan list|on|off|add <MHz> [mode] [name]|remove|skip|hold|resume|lockout|unlock|priority <MHz>"}


# ---------------------------------------------------------------- IQ snapshots (0.4.0)

def resolve_iq(name):
    if not name:
        return None
    root = os.path.realpath(IQ_ROOT)
    cands = [name, os.path.join(IQ_ROOT, name)]
    if "/" not in name and os.path.isdir(IQ_ROOT):
        cands += [os.path.join(IQ_ROOT, d, name) for d in sorted(os.listdir(IQ_ROOT), reverse=True)]
    for c in cands:
        p = os.path.realpath(os.path.expanduser(c))
        if p.endswith(".cu8") and os.path.isfile(p) and os.path.commonpath([p, root]) == root:
            return p
    return None


def iq_rel(path):
    return os.path.relpath(path, IQ_ROOT)


def iq_path(mhz, rate):
    day = time.strftime("%Y-%m-%d")
    folder = os.path.join(IQ_ROOT, day)
    base = f"{float(mhz):.3f}_{int(round(rate / 1000))}k"
    path = os.path.join(folder, base + ".cu8")
    k = 2
    while os.path.exists(path) or os.path.exists(path[:-4] + ".json"):
        path = os.path.join(folder, f"{base}-{k}.cu8")
        k += 1
    return path


def iq_conf():
    c = read_json(REC_CONF, {}) or {}
    try:
        gb = float(c.get("iqGb") or IQ_KEEP_GB)
    except (TypeError, ValueError):
        gb = IQ_KEEP_GB
    try:
        days = float(c.get("days") or KEEP_DAYS)
    except (TypeError, ValueError):
        days = KEEP_DAYS
    return {"gb": gb, "days": days}


def iq_scan(day=None):
    out_ = []
    try:
        days = sorted(d for d in os.listdir(IQ_ROOT) if re.fullmatch(r"\d{4}-\d\d-\d\d", d))
    except OSError:
        return out_
    for d in days:
        if day and d != day:
            continue
        folder = os.path.join(IQ_ROOT, d)
        try:
            names = os.listdir(folder)
        except OSError:
            continue
        for f in names:
            if not f.endswith(".cu8") or f.startswith("."):
                continue
            path = os.path.join(folder, f)
            try:
                stt = os.stat(path)
            except OSError:
                continue
            side = read_json(path[:-4] + ".json", None) or {}
            if not side.get("mhz"):
                m = re.match(r"([\d.]+)_(\d+)k", f)
                if m:
                    side = dict(side, mhz=float(m.group(1)), rate=int(m.group(2)) * 1000)
            out_.append(dict(side, path=path, file=f"{d}/{f}", day=d, name=f, size=stt.st_size, mtime=stt.st_mtime))
    out_.sort(key=lambda it: (it.get("at") or it["mtime"] * 1000))
    return out_


def iq_prune(now=None, trash=None, conf=None):
    """The IQ cap: snapshots older than `days` to the Trash, then the oldest until the rest fit in
    `gb`. A file still being written (fresh mtime) is left alone."""
    now = now or time.time()
    conf = conf or iq_conf()
    trash = trash or trash_paths
    items = iq_scan()
    fresh = lambda it: now - it["mtime"] < 90
    victims = [it for it in items if not fresh(it) and (it.get("at") or it["mtime"] * 1000) / 1000 < now - conf["days"] * 86400]
    gone = {it["path"] for it in victims}
    total = sum(it["size"] for it in items if it["path"] not in gone)
    cap = conf["gb"] * 1e9
    for it in items:
        if total <= cap:
            break
        if it["path"] in gone or fresh(it):
            continue
        victims.append(it)
        gone.add(it["path"])
        total -= it["size"]
    paths = []
    for it in victims:
        paths.append(it["path"])
        if os.path.exists(it["path"][:-4] + ".json"):
            paths.append(it["path"][:-4] + ".json")
    moved = set(trash(paths)) if paths else set()
    for it in victims:
        try:
            os.rmdir(os.path.dirname(it["path"]))
        except OSError:
            pass
    kept = sum(it["size"] for it in items if it["path"] not in moved)
    return {"ok": True, "trashed": [iq_rel(p) for p in paths if p in moved and p.endswith(".cu8")],
            "total": kept, "keep": conf}


def iq_list():
    items = iq_scan()
    items.reverse()
    conf = iq_conf()
    total = sum(it["size"] for it in items)
    out_ = [{"file": it["file"], "mhz": it.get("mhz"), "rate": it.get("rate"), "seconds": it.get("seconds"),
             "gain": it.get("gain"), "at": it.get("at"), "size": it["size"], "mtime": int(it["mtime"] * 1000),
             "label": it.get("label")} for it in items]
    return {"ok": True, "items": out_, "total": total, "keep": conf, "root": pretty(IQ_ROOT), "now": now_ms()}


def _fft(a):
    """Iterative radix-2 complex FFT (numpy-free); len(a) a power of two."""
    n = len(a)
    out = list(a)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            out[i], out[j] = out[j], out[i]
    length = 2
    while length <= n:
        theta = -2.0 * math.pi / length
        wstep = complex(math.cos(theta), math.sin(theta))
        half = length >> 1
        for start in range(0, n, length):
            w = 1 + 0j
            for k in range(half):
                u = out[start + k]
                t = w * out[start + k + half]
                out[start + k] = u + t
                out[start + k + half] = u - t
                w *= wstep
        length <<= 1
    return out


def iq_waterfall(args):
    name = args[0] if args else ""
    rows = 120
    cols = 256
    for flag, cast in (("--rows", int), ("--cols", int)):
        if flag in args:
            k = args.index(flag)
            try:
                v = cast(args[k + 1])
                if flag == "--rows":
                    rows = max(8, min(240, v))
                else:
                    cols = 1 << max(5, min(9, int(math.log2(max(32, v)))))
            except (IndexError, ValueError):
                pass
    path = resolve_iq(name)
    if not path:
        return {"ok": False, "say": "No such snapshot.", "file": name}
    side = read_json(path[:-4] + ".json", {}) or {}
    rate = int(side.get("rate") or 1_024_000)
    mhz = float(side.get("mhz") or 0)
    n = cols
    win = [0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]
    try:
        size = os.path.getsize(path)
    except OSError:
        return {"ok": False, "say": "Could not read the snapshot."}
    pairs = size // 2
    blocks = max(1, pairs // n)
    step = max(1, blocks // rows)
    grid = []
    with open(path, "rb") as f:
        b = 0
        while len(grid) < rows and b < blocks:
            f.seek(b * n * 2)
            raw = f.read(n * 2)
            if len(raw) < n * 2:
                break
            samples = [complex((raw[2 * i] - 127.4) * win[i], (raw[2 * i + 1] - 127.4) * win[i]) for i in range(n)]
            spec = _fft(samples)
            mags = [spec[(i + n // 2) % n] for i in range(n)]       # fftshift: DC in the middle
            row = [10 * math.log10(max(x.real * x.real + x.imag * x.imag, 1e-6)) for x in mags]
            grid.append(row)
            b += step
    if not grid:
        return {"ok": False, "say": "The snapshot was too short to render."}
    flat = [v for r in grid for v in r]
    floor = pct(sorted(flat), 0.30)
    top = pct(sorted(flat), 0.999)
    lo_db, hi_db = floor - 2, max(floor + 6, top)
    q = quantize(grid, lo_db, hi_db)
    return {"ok": True, "file": iq_rel(path), "mhz": mhz, "rate": rate, "cols": n, "rows": len(grid),
            "start": round(mhz - rate / 2e6, 4), "stop": round(mhz + rate / 2e6, 4),
            "scale": [round(lo_db, 1), round(hi_db, 1)], "png": png_indexed(q), "wf": wf_grid(q), "now": now_ms()}


def iq_decode(args):
    path = resolve_iq(args[0] if args else "")
    if not path:
        return {"ok": False, "say": "No such snapshot."}
    side = read_json(path[:-4] + ".json", {}) or {}
    mhz = float(side.get("mhz") or 0)
    rate = int(side.get("rate") or 1_024_000)
    if not 433.0 <= mhz <= 435.0:
        return {"ok": False, "say": f"Decoding gadgets works on 433.92 MHz snapshots (rtl_433). This one is {mhz:g} MHz."}
    if not os.path.exists(RTL_433):
        return {"ok": False, "say": "rtl_433 is not installed (brew install rtl_433)."}
    try:
        txt = run([RTL_433, "-r", path, "-s", str(rate), "-F", "json"], 120)
    except Exception as err:
        return {"ok": False, "say": f"rtl_433 could not read it: {type(err).__name__}: {err}"[:200]}
    events, models = [], {}
    for line in txt.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            events.append(ev)
            mdl = ev.get("model") or "?"
            models[mdl] = models.get(mdl, 0) + 1
    return {"ok": True, "file": iq_rel(path), "events": len(events), "models": models,
            "devices": sorted(models), "now": now_ms(),
            "say": f"rtl_433 decoded {len(events)} message{'' if len(events) == 1 else 's'} from {len(models)} device model{'' if len(models) == 1 else 's'} in the snapshot."
                   if events else "rtl_433 found no decodable gadget transmissions in the snapshot."}


def snapshot_argv(meta):
    """rtl_sdr writing cu8 straight to the file; -n limits the sample count, so it stops itself."""
    rate = int(meta.get("rate", 1_024_000))
    count = int(rate * int(meta.get("seconds", 20)))
    tune = float(meta["mhz"]) * 1e6
    argv = [RTL_SDR, "-f", f"{tune:.0f}", "-s", str(rate), "-n", str(count)]
    g = meta.get("gain")
    if g not in (None, "auto"):
        argv += ["-g", f"{float(g):g}"]
    return argv + ppm_args() + [meta["file"]]


def snapshot_start(args, lock=None):
    rate, seconds, gain = 1_024_000, 20, None
    a = list(args)
    for flag, setter in (("--rate", "rate"), ("--seconds", "seconds"), ("--gain", "gain")):
        if flag in a:
            k = a.index(flag)
            try:
                v = a[k + 1]
                if setter == "rate":
                    rate = int(float(v))
                elif setter == "seconds":
                    seconds = int(float(v))
                else:
                    gain = v
            except (IndexError, ValueError):
                pass
            del a[k:k + 2]
    try:
        mhz = float(a[0].lower().rstrip("mhz"))
    except (IndexError, ValueError):
        return {"ok": False, "say": "Usage: radio.py snapshot <MHz> [--rate Hz] [--seconds N] [--gain dB]."}
    if not 24 <= mhz <= 1766 and not (0.5 <= mhz <= HF_MAX_MHZ):
        return {"ok": False, "say": "The V4 tunes 24-1766 MHz (and HF below 28.8 MHz); pick a frequency in range."}
    rate = max(250_000, min(2_560_000, rate))
    seconds = max(5, min(IQ_MAX_S, seconds))
    if not os.path.exists(RTL_SDR):
        return {"ok": False, "say": "rtl_sdr is not installed (brew install librtlsdr)."}
    bytes_needed = rate * seconds * 2
    cap = iq_conf()["gb"] * 1e9
    if bytes_needed > cap:
        seconds = max(5, int(cap / (rate * 2)))
    try:
        iq_prune()
    except Exception:
        pass
    path = iq_path(mhz, rate)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    nm, _ = name_for(mhz)
    at = now_ms()
    write_json(path[:-4] + ".json", {"mhz": round(mhz, 4), "rate": rate, "seconds": seconds, "gain": gain,
                                     "at": at, "label": nm, "format": "cu8", "hf": mhz < HF_MAX_MHZ})
    meta = {"mhz": round(mhz, 5), "rate": rate, "seconds": seconds, "gain": gain, "file": path, "since": at, "keep": True}
    ok, why, stopped, err = start_kind("snapshot", meta)
    if not ok:
        for p in (path, path[:-4] + ".json"):
            try:
                os.remove(p)
            except OSError:
                pass
        return {"ok": False, "error": err, "say": why, "stopped": stopped}
    mb = round(bytes_needed / 1e6)
    return {"ok": True, "file": iq_rel(path), "mhz": round(mhz, 4), "rate": rate, "seconds": seconds,
            "stopped": stopped, "say": f"Capturing {seconds} s of raw I/Q at {mhz:g} MHz ({rate / 1e6:g} MS/s, about {mb} MB) to {pretty(path)}. It stops by itself; then ▶ renders a waterfall."}


def iq_delete(name):
    path = resolve_iq(name)
    if not path:
        return {"ok": False, "say": "No such snapshot."}
    paths = [path] + ([path[:-4] + ".json"] if os.path.exists(path[:-4] + ".json") else [])
    moved = trash_paths(paths)
    try:
        os.rmdir(os.path.dirname(path))
    except OSError:
        pass
    return {"ok": bool(moved), "say": f"Moved {os.path.basename(path)} to the Trash." if moved else "It was not moved."}


def snapshot_read(args):
    sub = (args[0] if args else "list").lower()
    if sub in ("list", "snapshots", ""):
        return iq_list()
    if sub == "waterfall":
        return iq_waterfall(args[1:])
    if sub == "decode":
        return iq_decode(args[1:])
    if sub == "delete":
        return iq_delete(args[1] if len(args) > 1 else "")
    if sub == "prune":
        return iq_prune()
    return {"ok": False, "say": "snapshot <MHz> [--rate|--seconds|--gain] | snapshot list|waterfall <file>|decode <file>|delete <file>|prune"}


# ---------------------------------------------------------------- settings, bias-tee, HF, PPM (0.4.0)

def settings_view():
    s = settings()
    tools = {"rtl_sdr": os.path.exists(RTL_SDR), "rtl_biast": os.path.exists(RTL_BIAST)}
    return {"ok": True, **s, "tools": tools, "hf": hf_state(), "filterDefaults": MODE_RATE, "now": now_ms()}


def settings_cmd(args):
    if not args:
        return settings_view()
    sub = args[0].lower()
    if sub == "ppm":
        if len(args) < 2:
            return {"ok": True, "say": f"PPM correction is {settings()['ppm']}.", **settings_view()}
        try:
            p = int(float(args[1]))
        except ValueError:
            return {"ok": False, "say": "Usage: set ppm <integer>, e.g. set ppm 2 or set ppm -1."}
        settings_set(ppm=p)
        return {"ok": True, "say": f"PPM correction set to {p}. It applies to listening, scanning, the live view and snapshots.", **settings_view()}
    if sub == "filter":
        if len(args) < 3 or args[1].lower() not in MODE_RATE:
            return {"ok": False, "say": f"Usage: set filter <{'/'.join(MODE_RATE)}> <Hz>, e.g. set filter fm 12500."}
        try:
            hz = int(float(args[2]))
        except ValueError:
            return {"ok": False, "say": "Give the filter width in Hz, e.g. 12500."}
        hz = max(4000, min(48000, hz))
        settings_set(filter=(args[1].lower(), hz))
        return {"ok": True, "say": f"{mode_label(args[1].lower())} filter width set to {hz} Hz (takes effect on the next Listen).", **settings_view()}
    return {"ok": False, "say": "settings | set ppm <N> | set filter <mode> <Hz>"}


def biast_cmd(args):
    want = args and args[0].lower() in ("on", "1", "true")
    if not os.path.exists(RTL_BIAST):
        return {"ok": False, "say": "rtl_biast is not installed (brew install librtlsdr)."}
    d = device()
    if not d["present"]:
        return {"ok": False, "say": "The V4 is not plugged in."}
    o = owner_info(d.get("owner"))
    if o:
        who = o.get("app", "another program")
        return {"ok": False, "busy": True,
                "say": f"The V4 is in use by {who}: the bias-tee is set by briefly opening the dongle, so stop what is on the V4 first (■ Stop all), then try again."}
    argv = [RTL_BIAST, "-b", "1" if want else "0"]
    try:
        err = ""
        p = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        err = (p.stderr or b"").decode(errors="replace")
    except Exception as e:
        return {"ok": False, "say": f"rtl_biast failed: {type(e).__name__}: {e}"[:200]}
    settings_set(biast=bool(want))
    warn = ("Bias-tee ON: 4.5 V DC now feeds the antenna port. Only for an amplifier or an active antenna "
            "that needs power — never a plain antenna, and never while connected to a transmitter.") if want else \
           "Bias-tee OFF: no DC on the antenna port."
    return {"ok": True, "on": bool(want), "say": warn, "argv": argv, "stderr": err.strip()[-200:]}


def hf_state():
    s = read_json(HF, {}) or {}
    return {"confirmed": bool(s.get("confirmed")), "at": s.get("at"), "evidence": s.get("evidence"),
            "maxMhz": HF_MAX_MHZ,
            "driver": {"supported": True, "lib": "Homebrew librtlsdr (osmocom >= 2.0.3)",
                       "note": "The RTL-SDR Blog V4 auto-upconverts by 28.8 MHz when tuned below 28.8 MHz, so HF "
                               "works through rtl_fm / rtl_power / rtl_sdr with no flag or separate driver. HF "
                               "still needs a proper antenna (a 10-20 m long wire through a 9:1 balun)."}}


def hf_confirm(evidence="confirmed by hand"):
    write_json(HF, {"confirmed": True, "at": now_ms(), "evidence": evidence})
    return hf_state()


def hf_cmd(args, lock=None):
    sub = (args[0] if args else "status").lower()
    if sub == "status":
        return {"ok": True, **hf_state()}
    if sub == "confirm":
        st = hf_confirm("marked by hand")
        return {"ok": True, "say": "HF marked as confirmed: the HF presets now light up.", **st}
    if sub == "reset":
        write_json(HF, {"confirmed": False})
        return {"ok": True, "say": "HF confirmation reset.", **hf_state()}
    if sub == "test":
        mhz = 10.0
        if len(args) > 1:
            try:
                mhz = float(args[1])
            except ValueError:
                pass
        if not 0.5 <= mhz <= HF_MAX_MHZ:
            return {"ok": False, "say": f"The HF test tunes below {HF_MAX_MHZ} MHz; try WWV 5, 10 or 15."}
        res = listen([f"{mhz}", "am", "--volume", "0"], lock=lock)
        if not res.get("ok"):
            return {"ok": False, "say": res.get("say"), "error": res.get("error")}
        time.sleep(1.0)
        meter = meter_read().get("meter") or {}
        stop_kind("listen")
        heard = (meter.get("level") or 0) >= 0.2 and not meter.get("weak")
        ev = f"WWV {mhz:g} MHz: meter level {meter.get('level')}, metric {meter.get('metric')} {meter.get('unit')}"
        if heard:
            hf_confirm(ev)
        return {"ok": True, "heard": heard, "mhz": mhz, "meter": meter, "evidence": ev, **hf_state(),
                "say": f"Heard a carrier at {mhz:g} MHz — HF confirmed, the HF presets light up." if heard
                       else f"No clear carrier at {mhz:g} MHz. HF needs a long-wire antenna through a 9:1 balun; try again with one connected, outdoors or by a window."}
    return {"ok": False, "say": "hf status|test [MHz]|confirm|reset"}


def ppm_from_offset(expected_mhz, measured_mhz):
    """The PPM correction that would move a carrier measured at `measured_mhz` back to `expected_mhz`."""
    if not expected_mhz:
        return 0
    return int(round((expected_mhz - measured_mhz) / expected_mhz * 1e6))


def calibrate(args, lock=None):
    """Estimate PPM from a strong steady carrier (the location's NOAA station, 162.550 for KIH42, by default): a narrow rtl_power
    window, the loudest bin's offset from where it should be."""
    freq = LOC["weather"]["freq"]
    if args:
        try:
            freq = float(args[0])
        except ValueError:
            pass
    span = 0.05
    lo, hi = freq - span / 2, freq + span / 2
    d = device()
    if not d["present"]:
        return {"ok": False, "say": "The V4 is not plugged in."}
    o = owner_info(d.get("owner"))
    if o and not o.get("ours"):
        return {"ok": False, "say": f"The V4 is in use by {o['app']}: close it first."}
    stopped = []
    for k in list(MODES):
        m = stop_kind(k, why="calibrate the PPM")
        if m:
            stopped.append({"kind": k, **m})
    if stopped:
        wait_free()
    text, err, _ = rtl_power(lo, hi, 200, 40, 6)
    freqs, rows, _ = parse_power(text, lo, hi)
    if not rows:
        return {"ok": False, "say": "rtl_power returned no data for the calibration window.", "stopped": stopped}
    avg = [sum(r[j] for r in rows) / len(rows) for j in range(len(freqs))]
    floor = median(avg)
    peak_i = max(range(len(avg)), key=lambda i: avg[i])
    if avg[peak_i] - floor < 6:
        wx_station = LOC["weather"]["station"] or "a NOAA station"
        return {"ok": False, "stopped": stopped,
                "say": f"No strong carrier near {freq:g} MHz to calibrate against ({wx_station} should read well above the noise). Try with a better antenna, or calibrate from a strong local FM station."}
    measured = freqs[peak_i]
    ppm = ppm_from_offset(freq, measured)
    settings_set(ppm=ppm)
    return {"ok": True, "ppm": ppm, "measured": round(measured, 6), "expected": freq, "stopped": stopped,
            "say": f"Calibrated: the {freq:g} MHz carrier read {measured * 1e3:.3f} kHz off, so PPM is set to {ppm}."}


# ---------------------------------------------------------------- status

def status():
    touch_heartbeat()
    d = device()
    o = owner_info(d.get("owner"))
    exits = read_json(EXITS, {}) or {}
    jobs = {}
    for kind, mode in MODES.items():
        info = read_pid(kind)
        m = (info or {}).get("meta") or {}
        j = {"running": bool(info), "since": (info or {}).get("started"), "lastExit": exits.get(kind), "label": mode.label}
        if info:
            j["meta"] = m
            j["doing"] = mode.doing(m)
        jobs[kind] = j
    res = {}
    for kind in ("gadgets", "listen", "share", "live"):
        j = jobs[kind]
        m = j.get("meta") or {}
        r = {"running": j["running"], "since": j["since"], "lastExit": j["lastExit"]}
        if kind == "gadgets":
            r["band"] = m.get("band", "433") if j["running"] else None
        if kind == "listen" and j["running"]:
            r.update({"freq": m.get("freq"), "mode": m.get("mode"), "label": m.get("label"), "player": m.get("player"),
                      "squelch": m.get("squelch"), "gain": m.get("gain"), "volume": m.get("volume"), "tap": m.get("tap"),
                      "autostop": bool(m.get("autostop"))})
        if kind == "share" and j["running"]:
            r.update({"port": m.get("port", 1234), "addr": m.get("addr"), "lan": lan_ip(), "tailscale": tailscale_ip()})
        if kind == "live" and j["running"]:
            r.update({"preset": m.get("preset"), "label": m.get("label"), "lo": m.get("lo"), "hi": m.get("hi")})
        res[kind] = r
    state = "missing" if not d["present"] else "free" if not o else "ours" if o.get("ours") else "busy"
    # Who has the V4, by name: one of our jobs (also while it is still opening the V4), a
    # one-shot script run, or another program.
    holder = None
    kind = o.get("ours") if o else next((k for k, j in jobs.items() if j["running"]), None)
    if kind:
        j = jobs[kind]
        m = j.get("meta") or {}
        mode = MODES[kind]
        holder = {"kind": kind, "label": mode.label, "detail": mode.detail(m) if mode.detail else None,
                  "doing": j.get("doing"), "since": j.get("since"), "pid": (o or {}).get("pid"), "ours": True}
    elif o:
        holder = {"kind": None, "label": o["app"], "detail": None, "since": None, "pid": o["pid"], "ours": False,
                  "oneshot": bool(o.get("oneshot"))}
    last = read_json(LAST_SCAN, None)
    tools = {k: os.path.exists(v) for k, v in (("rtl_power", RTL_POWER), ("rtl_433", RTL_433), ("rtl_fm", RTL_FM),
                                               ("rtl_tcp", RTL_TCP), ("rtl_sdr", RTL_SDR), ("rtl_biast", RTL_BIAST))}
    pl = player_argv(48000, 100)
    tools["player"] = os.path.basename(pl[0]) if pl else None
    set0 = settings()
    scan0 = read_json(SCANNER, None) or {}
    out_ = {"device": {k: d.get(k) for k in ("present", "name", "serial", "usb")}, "state": state, "owner": o,
            "holder": holder, **res, "jobs": jobs, "lastScan": {"preset": last["preset"], "label": last["label"], "at": last["at"]} if last else None,
            "activity": activity_summary(), "mesh": mesh_summary(), "tools": tools, "now": now_ms(),
            "settings": {"ppm": set0["ppm"], "biast": set0["biast"]}, "hf": {"confirmed": hf_state()["confirmed"]},
            "scanner": {"running": jobs["scanner"]["running"], "current": scan0.get("current"), "parked": scan0.get("parked")}}
    if PLUGIN_ERRORS:
        out_["pluginErrors"] = PLUGIN_ERRORS
    if LOC["_custom"] or LOC["_error"]:       # only when a location file exists: no change without one
        out_["location"] = {"name": LOC["name"], "custom": LOC["_custom"], "error": LOC["_error"]}
    return out_


# ---------------------------------------------------------------- main

def main():
    os.makedirs(STATE, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    load_plugin_modes()
    args = sys.argv[1:] or ["status"]
    verb = args[0]
    if verb == "_run":
        wrapper(args[1], json.loads(args[2]))
        return
    if verb == "_scan":                       # the scanner job's one process (scanloop)
        scanloop(json.loads(args[1]))
        return
    if verb == "status":
        out(status())
    if verb == "location":                    # where the tab is (reads location.json; opens nothing)
        out(location.public(location.load()))
    if verb == "last":
        touch_heartbeat()
        out(read_json(LAST_SCAN, None) or {"ok": False, "say": "No scan yet."})
    if verb == "gadgets" and (len(args) < 2 or args[1] == "list"):
        out(gadgets_list())
    if verb == "live" and (len(args) < 2 or args[1] in ("frame", "reset")):
        out(live(args[1:]))
    if verb == "listen" and len(args) > 1 and args[1] == "meter":
        out(listen(args[1:]))
    if verb == "mesh":
        out(mesh_summary())
    if verb == "recordings":
        out(recordings(args[1:]))
    if verb == "rec":
        out(rec_cmd(args[1:]))
    if verb == "log":
        out(log_cmd(args[1] if len(args) > 1 else ""))
    if verb == "play":
        out(play(args[1:]))
    if verb == "jobs":
        out(status()["jobs"])
    sub = args[1] if len(args) > 1 else ""
    # 0.4.0 read-only commands (no V4 / no lock): the settings panel, the scanner's own list and
    # edits, the IQ snapshot list / waterfall / decode, and HF status.
    if verb in ("settings", "set"):
        out(settings_cmd(args[1:]))
    if verb in ("biast", "bias"):
        out(biast_cmd(args[1:]))
    if verb == "hf" and sub != "test":
        out(hf_cmd(args[1:]))
    SCANNER_READ = ("list", "status", "add", "remove", "rm", "del", "delete", "lockout", "lock", "unlock",
                    "clear", "skip", "hold", "resume", "go", "unhold", "priority", "off", "stop")
    if verb == "scan" and sub in SCANNER_READ:
        out(scanner_cmd(args[1:]))
    if verb == "snapshot" and (len(args) < 2 or sub in ("list", "snapshots", "waterfall", "decode", "delete", "prune")):
        out(snapshot_read(args[1:]))
    if verb == "job" and sub in ("start", "on") and len(args) > 2 and args[2] in MODES:
        mode = MODES[args[2]]
        if mode.probe and read_pid(args[2]):
            out({"ok": True, "already": True, "say": f"{mode.label} is already running.", "result": webrx_call("status.sh", 30) if args[2] == "webrx" else None})
    # Starting anything (or `stop`) takes the V4 from whoever has it, Web SDR included: its
    # rtl_tcp keeps sdr.lock, so it is stopped before the lock is taken. A command that only
    # stops one of our jobs needs no lock while Web SDR has the V4 (none of ours can run then).
    if verb == "handoff" and (sub == "clear" or not handoff_read()[0]):
        out(handoff_take() if sub != "clear" else (handoff_clear() or {"ok": True, "say": "Handoff cleared."}))
    starting = (verb in ("stop", "record", "handoff", "snapshot", "calibrate")
                or (verb == "scan" and sub not in SCANNER_READ)
                or (verb in ("live", "gadgets", "job") and sub in ("start", "on"))
                or (verb == "scan" and sub in ("on", "start"))
                or (verb == "hf" and sub == "test")
                or (verb == "listen" and sub not in ("", "stop", "off", "meter"))
                or (verb == "share" and sub not in ("stop", "off")))
    if starting:
        free_lock_holders()
    lock = Lock("sdr.lock") if starting or not lock_holder_running() else None
    if lock:
        LOCKS.append(lock)
    if verb == "scan" and sub in ("on", "start"):
        out(scanner_cmd(args[1:], lock))
    if verb == "snapshot":
        out(snapshot_start(args[1:], lock))
    if verb == "calibrate":
        out(calibrate(args[1:], lock))
    if verb == "hf":
        out(hf_cmd(args[1:], lock))
    if verb == "scan":
        name = (args[1] if len(args) > 1 else "fm").lower()
        name = ALIASES.get(name, name)
        if name != "custom" and name not in PRESETS:
            out({"ok": False, "error": "preset", "say": f"Presets: {', '.join(PRESETS)}, or custom <start> <stop>, or scan list|on|off|add."})
        out(scan(name, args[2:]))
    if verb == "live":
        out(live(args[1:]))
    if verb == "gadgets":
        sub = args[1]
        if sub in ("start", "on"):
            band = args[2] if len(args) > 2 and args[2] in ("433", "915", "hop") else "433"
            ok, why, stopped, err = start_kind("gadgets", {"band": band})
            band_say = {"433": "433.92 MHz", "915": "915 MHz", "hop": "433.92 and 915 MHz, switching every 30 s"}[band]
            out({"ok": ok, "error": err, "say": f"Gadget listener on ({band_say})." if ok else why, "stopped": stopped})
        if sub in ("stop", "off"):
            m = stop_kind("gadgets")
            out({"ok": True, "say": "Gadget listener off." if m else "The gadget listener was not running."})
        out({"ok": False, "say": "gadgets start|stop|list"})
    if verb == "listen":
        out(listen(args[1:], lock))
    if verb == "handoff":
        out(handoff_take(lock))
    if verb == "share":
        out(share(args[1:]))
    if verb == "record":
        out(record(args[1:], lock))
    if verb == "job":
        sub = args[1] if len(args) > 1 else ""
        kind = args[2] if len(args) > 2 else ""
        if kind not in MODES:
            out({"ok": False, "error": "kind", "say": f"Jobs: {', '.join(MODES)}."})
        if sub in ("start", "on"):
            try:
                meta = json.loads(args[3]) if len(args) > 3 else {}
            except ValueError:
                out({"ok": False, "error": "meta", "say": "The job's meta must be JSON."})
            ok, why, stopped, err = start_kind(kind, meta)
            res = MODES[kind].result
            say = (why or f"{MODES[kind].label} on.") if res is not None and ok else f"{MODES[kind].label} on." if ok else why
            out({"ok": ok, "error": err, "say": say, "stopped": stopped, "result": res})
        if sub in ("stop", "off"):
            m = stop_kind(kind)
            out({"ok": True, "stopped": bool(m), "say": f"{MODES[kind].label} off." if m else f"{MODES[kind].label} was not running."})
        out({"ok": False, "say": "job start <kind> [json] | job stop <kind>"})
    if verb == "stop":
        # Stop all ends ● Rec, the logger and any playback too (Claude Code quitting runs it).
        for f in (REC_ON, LOG_ON):
            try:
                os.remove(f)
            except OSError:
                pass
        play_stop()
        done = [(k, stop_kind(k)) for k in MODES]
        done = [(k, m) for k, m in done if m]
        names = [f"{MODES[k].label} ({m['label']})" if k == "listen" and m.get("label") else MODES[k].label for k, m in done]
        o = owner_info((wait_free(3.0) if done else device()).get("owner"))
        free = "The V4 is free." if not o else f"{o['app']} (pid {o['pid']}) still has the V4: it is not ours to stop."
        out({"ok": True, "stopped": [k for k, _ in done], "free": not o,
             "say": f"Stopped {', '.join(names)}. {free}" if done else f"Nothing of ours was running. {free}"})
    out({"ok": False, "error": f"unknown command {verb}"})


if __name__ == "__main__":
    main()

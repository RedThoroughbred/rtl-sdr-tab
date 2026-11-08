#!/usr/bin/env python3
"""Digital decoders for the Radio tab: APRS and NOAA weather alerts (SAME). Receive only.

Standard-library Python, like radio.py. It tunes the RTL-SDR Blog V4 with Homebrew's
rtl_fm (narrow FM, 22050 Hz signed 16-bit mono) and decodes the audio with the
built-in decoders in this file: an AFSK1200 / Bell 202 AX.25 modem for APRS (five
twist slicers, NRZI, HDLC, CRC) and a 520.83 baud FSK SAME decoder (three slicers,
2-of-3 burst voting). Both use a band-pass prefilter, quadrature tone correlators and
a debounced DPLL bit clock, and cost about 1.5% of one core in real time.
multimon-ng is used instead when it is installed (Homebrew has no formula for it; it
is found on PATH, in /opt/homebrew/bin or /usr/local/bin, or via $MULTIMON_NG, and
its -h output is checked for AFSK1200 / EAS / -A). Both decoders print the same
lines ("APRS: SRC>DEST,PATH:info", "EAS: ZCZC-...", "EAS: NNNN"), so one parser
handles either; --decoder builtin|multimon forces one.

  digital.py status                           tools, the V4's owner, running jobs, counts

  digital.py aprs run [SECONDS]               listen on 144.390 MHz for SECONDS (default 20,
                                              3-600), decode, update aprs.json, print a summary
  digital.py aprs live [--keep]               the "aprs" job (APRS) through radio.py's job manager:
                                              `radio.py job start aprs`, which stops whatever holds
                                              the V4 first and says why (aprs.pid)
  digital.py aprs stop                        `radio.py job stop aprs`
  digital.py aprs list [--limit N]            stations as JSON (distance/bearing from Walton)
  digital.py aprs table [--limit N] [--width N]
                                              the same as a text table (narrow under 60 columns)
  digital.py aprs view [--svg] [--table] [--width N]
                                              one JSON object for the tab: counts, the job, the
                                              map SVG and/or the table
  digital.py aprs svg [--out FILE] [--radius MI]
                                              a dark map (SVG, no scripts, <= 100 KB)
  digital.py aprs decode FILE [--dry]         replay a recording (raw s16le 22050 Hz, or WAV)
  digital.py aprs parse 'SRC>DEST,PATH:info'  parse one TNC2 packet, print the JSON
  digital.py aprs selftest [--keep DIR]       synthesize packets as audio and decode them
  digital.py aprs clear                       forget all stations

  digital.py same run|live|stop|decode|clear  as above, on 162.550 MHz (KIH42 Covington); the
                                              job is "same" (Weather alerts)
  digital.py same list [--limit N]            alert history (newest first) as JSON
  digital.py same view [--svg]                one JSON object for the tab: active alerts (with
                                              their cards), history, the job, the next weekly test
  digital.py same card [--id ID | --raw ZCZC...] [--out FILE] [--text]
                                              an alert card (SVG, or text with --text)
  digital.py same parse 'ZCZC-...'            parse one SAME header
  digital.py same selftest [--keep DIR] [--save] [--svg]
                                              encode a test header as SAME audio and decode
                                              it end to end (multimon-ng and built-in); --svg
                                              adds the decoded alert's card. Needs no V4.

  digital.py record MHZ SECONDS FILE          capture raw rtl_fm audio (s16le 22050 Hz, <= 120 s)

Options for run/live/record: --freq MHZ, --gain DB (default 40), --ppm N,
--decoder auto|builtin|multimon, --wait S (how long to wait for the V4, default 45),
--save-audio FILE (run only: keep the raw audio), --stream (run only: print one JSON
line per decoded packet/alert as it arrives, then the summary).

Sharing the V4: the background decoders are radio.py jobs. radio_modes(radio) below
registers "aprs" and "same" with radio.py's MODES (it imports this module through its
PLUGIN_MODULES): rtl_fm is the pipeline and JobReader (the built-in decoder) is the
reader, so radio.py's one wrapper owns the pidfile (<kind>.pid), the log, the lease
(20 min without a heartbeat; RADIO_LEASE_S / RADIO_NO_LEASE / --keep), the recorded exit
(exits.json) and the clean stop. Starting one stops whatever holds the V4 (planes, the
gadget listener, Web SDR...) and records why; `radio.py status` names it "APRS" or
"Weather alerts"; `radio.py stop` stops it. The jobs always use the built-in decoder.
One-shot commands (`run`, `record`) take the Radio tab's lock (~/Library/Caches/radio/
sdr.lock, fcntl.flock LOCK_EX, as radio.py does) for their whole run, check the USB tree
for another owner, wait until --wait runs out and then say "busy"; they never stop a
program they did not start. Keep them short (the default run is 20 s): radio.py's
commands wait at most 45 s for the lock.

State (all local, never ~/Documents): ~/Library/Application Support/radio/aprs.json,
same.json, aprs.log / same.log (rtl_fm's stderr). RADIO_DIR moves it for testing.

aprs.json:
  {"version":1, "ref":{"lat","lon","name"}, "updated":ms, "packets":int,
   "stations":{CALL:{"call","first","last","count","symbol":{"table","code","overlay",
               "name","kind"}, "pos":{"lat","lon","at","fmt","ambiguity"}|null,
               "distMi","bearing","dir","course","speedMph","altFt","path":[..],
               "via":"direct"|CALL|"digipeater", "dest","comment","status",
               "weather":{...}|null, "weatherAt", "micE", "object":bool, "owner",
               "lastType","lastRaw"}},
   "digis":{CALL:{"count","last"}},       callsigns seen repeating packets
   "recent":[{"at","call","type","summary","raw"}] (newest first, <= 200),
   "messages":[{"at","from","to","text","id","kind"}] (newest first, <= 100),
   "runs":[{"at","seconds","packets","decoder","mode"}], "lastExit":{"at","reason","detail"}}
same.json:
  {"version":1, "updated":ms,
   "alerts":[{"id","raw","org","orgName","event","eventName","severity","test":bool,
              "areas":[{"code","part","state","county","name","local"}],
              "issued":ms,"expires":ms,"durationMin","station","received","lastHeard",
              "times","source"}] (newest first, <= 200),
   "eom":[ms...], "runs":[...], "lastExit":{...}}
"""
import array
import cmath
import hashlib
import json
import math
import os
import random
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True  # no __pycache__ in the mod
import digital_render  # noqa: E402  (the SVG/text renderers, next to this file)
import location  # noqa: E402  (where the tab is: Walton, KY unless location.json says otherwise)

LOC = location.load_once()

HOME = os.path.expanduser("~")
STATE = os.environ.get("RADIO_DIR") or os.path.join(HOME, "Library", "Application Support", "radio")
CACHE = os.path.join(HOME, "Library", "Caches", "radio")
LOCK_NAME = "sdr.lock"  # radio.py's lock: one caller at a time drives the V4
SCRIPT = os.path.abspath(__file__)
BIN = "/opt/homebrew/bin"
RTL_FM = os.path.join(BIN, "rtl_fm")
HEARTBEAT = os.path.join(STATE, "heartbeat")  # shared with radio.py (the tab touches it)
LEASE_S = int(os.environ.get("RADIO_LEASE_S") or 20 * 60)
RATE = 22050

# The map reference: a town centre (public coordinates), never a home address. Walton, KY unless
# location.json says otherwise; RADIO_REF ("lat,lon,name") still overrides both.
_ref = (os.environ.get("RADIO_REF") or "").split(",")
REF = {"lat": float(_ref[0]), "lon": float(_ref[1]), "name": ",".join(_ref[2:]) or "Reference"} if len(_ref) >= 2 else \
    {k: LOC["receiver"][k] for k in ("lat", "lon", "name")}
WX = LOC["weather"]

MODES = {
    "aprs": {"freq": 144.390, "label": "APRS 144.390 MHz", "file": "aprs.json", "multimon": ["-a", "AFSK1200", "-A"]},
    "same": {"freq": WX["freq"], "label": f"{WX['noaa_short']} {WX['freq']:.3f} MHz", "file": "same.json", "multimon": ["-a", "EAS"]},
}
JOB_KINDS = ("aprs", "same")


# ====================================================================== plumbing

def now_ms():
    return int(time.time() * 1000)


def emit(obj):
    print(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))
    sys.stdout.flush()


def out(obj):
    emit(obj)
    sys.exit(0)


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, obj):
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, path)


def touch_heartbeat():
    try:
        with open(HEARTBEAT, "a"):
            pass
        os.utime(HEARTBEAT, None)
    except OSError:
        pass


def run_cmd(argv, timeout=10):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return r.stdout + r.stderr
    except Exception:
        return ""


def proc_name(pid):
    try:
        return subprocess.run(["/bin/ps", "-o", "comm=", "-p", str(pid)], capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        return ""


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


class FileLock:
    """An fcntl.flock on a file in ~/Library/Caches/radio (sdr.lock is radio.py's)."""

    def __init__(self, name):
        import fcntl
        self.fcntl = fcntl
        os.makedirs(CACHE, exist_ok=True)
        self.path = os.path.join(CACHE, name)
        self.f = None
        self.held = False

    def try_take(self):
        if self.f is None:
            self.f = open(self.path, "w")  # radio.py opens it the same way
        try:
            self.fcntl.flock(self.f, self.fcntl.LOCK_EX | self.fcntl.LOCK_NB)
            self.held = True
        except BlockingIOError:
            self.held = False
        return self.held

    def take(self, wait):
        end = time.time() + wait
        while not self.try_take():
            if time.time() > end:
                return False
            time.sleep(0.2)
        return True

    def release(self):
        if self.f is not None and self.held:
            self.fcntl.flock(self.f, self.fcntl.LOCK_UN)
        self.held = False

    def __enter__(self):
        self.take(30)
        return self

    def __exit__(self, *_):
        self.release()
        if self.f is not None:
            self.f.close()
            self.f = None


def state_lock():
    """Serializes read-modify-write of aprs.json / same.json between a job and the CLI."""
    return FileLock("digital-state.lock")


# ---------------------------------------------------------------------- the V4 on USB

def device():
    """The RTL-SDR from the USB tree (ioreg), without opening it, and who holds it (as radio.py reads it)."""
    try:
        text = subprocess.run(["/usr/sbin/ioreg", "-r", "-c", "IOUSBHostDevice", "-l", "-w0"],
                              capture_output=True, text=True, timeout=15).stdout
    except Exception:
        text = ""
    devs, cur = [], None
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
        m = re.search(r'"UsbExclusiveOwner" = "pid (\d+), ([^"]*)"', line)
        if m and "owner" not in cur:
            cur["owner"] = {"pid": int(m.group(1)), "name": m.group(2)}
    for d in devs:
        is_v4 = "blog v4" in (d.get("product") or d["node"]).lower()
        is_rtl = d.get("vid") == 0x0BDA and d.get("pid") in (0x2838, 0x2832)
        if is_v4 or is_rtl:
            return {"present": True, "name": d.get("product") or d["node"], "owner": d.get("owner")}
    return {"present": False, "owner": None}


def owner_label(owner):
    if not owner:
        return None
    o = dict(owner)
    for kind in JOB_KINDS:
        info = read_pid(kind)
        if info and owner["pid"] in (info.get("children") or []):
            o["ours"] = kind
    if "ours" not in o:
        for kind in ("gadgets", "listen", "share", "live", "adsb"):  # radio.py's jobs (read only)
            info = read_json(os.path.join(STATE, f"{kind}.pid"))
            if info and owner["pid"] in (info.get("children") or []):
                o["radio"] = kind
    return o


def acquire_v4(wait):
    """Takes sdr.lock and makes sure the V4 is present and free, retrying until `wait` runs out.
    Returns (lock, None) or (None, error dict). Never stops anybody else's program."""
    lock = FileLock(LOCK_NAME)
    end = time.time() + max(0.0, wait)
    last = None
    while True:
        if lock.try_take():
            d = device()
            if not d["present"]:
                lock.release()
                return None, {"ok": False, "error": "missing", "say": "The RTL-SDR (Blog V4) is not plugged in."}
            o = owner_label(d.get("owner"))
            if not o:
                return lock, None
            lock.release()
            last = o
        if time.time() > end:
            if last:
                who = (f"this script's {last['ours']} job" if last.get("ours") else
                       f"the Radio tab's {last['radio']} job" if last.get("radio") else f"{last['name']} (pid {last['pid']})")
                return None, {"ok": False, "error": "busy", "owner": last,
                              "say": f"The V4 is in use by {who}. It can be used by one program at a time; try again when it is free."}
            return None, {"ok": False, "error": "busy", "say": "Another radio command holds the V4 lock (a scan takes about 10 s). Try again in a moment."}
        time.sleep(1.0 if last else 0.3)


# ---------------------------------------------------------------------- multimon-ng

def multimon_path():
    for p in (os.environ.get("MULTIMON_NG"), shutil.which("multimon-ng"), os.path.join(BIN, "multimon-ng"),
              "/usr/local/bin/multimon-ng"):
        if p and os.path.exists(p) and os.access(p, os.X_OK):
            return p
    return None


_MM_INFO = None


def multimon_info():
    """multimon-ng's version and demodulators, read from its own --help (None if not installed)."""
    global _MM_INFO
    if _MM_INFO is not None:
        return _MM_INFO or None
    p = multimon_path()
    if not p:
        _MM_INFO = False
        return None
    text = run_cmd([p, "-h"], 5)
    m = re.search(r"multimon-ng\s+([\w.\-]+)", text)
    demods = set(re.findall(r"\b([A-Z][A-Z0-9_]{2,})\b", text.split("Usage")[0] if "Usage" in text else text))
    _MM_INFO = {"path": p, "version": m.group(1) if m else None, "afsk1200": "AFSK1200" in demods, "eas": "EAS" in demods,
                "aprsFlag": bool(re.search(r"^\s*-A\b", text, re.M))}
    return _MM_INFO


def pick_decoder(mode, want="auto"):
    info = multimon_info()
    usable = bool(info and (info["afsk1200"] if mode == "aprs" else info["eas"]))
    if want == "multimon":
        return "multimon" if usable else None
    if want == "builtin":
        return "builtin"
    return "multimon" if usable else "builtin"


def multimon_argv(mode, src="-"):
    info = multimon_info()
    argv = [info["path"], "-q", "-t", "raw"] + list(MODES[mode]["multimon"])
    if mode == "aprs" and not info.get("aprsFlag"):
        argv.remove("-A")
    return argv + [src]


# ====================================================================== DSP: built-in modems

class FSKDemod:
    """Non-coherent two-tone FSK demodulator for audio from rtl_fm.

    A band-pass biquad keeps the tone pair; quadrature correlators integrate each tone
    over one bit (a sliding window), so the output compares mark and space energy.
    Several slicers weight the space tone differently (FM pre-emphasis makes one tone
    louder than the other, the "twist"), each with its own DPLL bit clock, and hand bits
    (True = mark) to their own sink at the middle of each bit. A level change only
    steers the clock once it has lasted a few samples, so noise glitches (which flip
    back at once) cannot walk the clock off by whole bits."""

    def __init__(self, rate, baud, mark, space, sinks, gains=(1.0,), q=None):
        self.n = max(4, int(round(rate / baud)))
        # A band-pass around the tone pair (RBJ biquad, centred on their geometric mean) keeps
        # out voice, hum and the FM discriminator's loud high-frequency noise.
        lo, hi = min(mark, space), max(mark, space)
        f0 = math.sqrt(lo * hi)
        q = q or f0 / ((hi - lo) * 2.2)
        w0 = 2 * math.pi * f0 / rate
        al = math.sin(w0) / (2 * q)
        self.bq = (al / (1 + al), -2 * math.cos(w0) / (1 + al), (1 - al) / (1 + al))
        self.z = [0.0, 0.0, 0.0, 0.0]
        self.wm = cmath.exp(-2j * math.pi * mark / rate)
        self.ws = cmath.exp(-2j * math.pi * space / rate)
        self.om = 1 + 0j
        self.os = 1 + 0j
        self.bm = [0j] * self.n
        self.bs = [0j] * self.n
        self.sm = 0j
        self.ss = 0j
        self.i = 0
        self.inc = baud / rate
        self.gains = list(gains)
        self.sinks = list(sinks)
        self.last = [False] * len(gains)
        self.ph = [0.0] * len(gains)
        self.pend = [0] * len(gains)  # samples the slicer has disagreed with its level
        self.pph = [0.0] * len(gains)  # the clock phase where that disagreement began
        self.hold = max(2, self.n // 7)  # a level change counts once it lasts this many samples
        self.alpha = 0.2
        self.count = 0

    def feed(self, samples):
        n, bm, bs, i = self.n, self.bm, self.bs, self.i
        sm, ss, om, os_, wm, ws = self.sm, self.ss, self.om, self.os, self.wm, self.ws
        inc, gains, last, ph, sinks = self.inc, self.gains, self.last, self.ph, self.sinks
        pend, pph, hold, alpha = self.pend, self.pph, self.hold, self.alpha
        b0, a1, a2 = self.bq
        x1, x2, y1, y2 = self.z
        rng = range(len(gains))
        cnt = self.count
        for x0 in samples:
            x = b0 * (x0 - x2) - a1 * y1 - a2 * y2
            x2 = x1
            x1 = x0
            y2 = y1
            y1 = x
            om *= wm
            os_ *= ws
            a = om * x
            b = os_ * x
            sm += a - bm[i]
            bm[i] = a
            ss += b - bs[i]
            bs[i] = b
            i += 1
            if i == n:
                i = 0
            m = abs(sm)
            s = abs(ss)
            for k in rng:
                p = ph[k]
                if (m > gains[k] * s) != last[k]:
                    c = pend[k] + 1
                    if c == 1:
                        pph[k] = p
                    if c >= hold:  # a real transition (noise glitches flip back sooner): steer the
                        last[k] = not last[k]  # bit clock so transitions fall between bit samples
                        p += (0.5 - pph[k]) * alpha
                        c = 0
                    pend[k] = c
                elif pend[k]:
                    pend[k] = 0
                p += inc
                if p >= 1.0:
                    p -= 1.0
                    self.count = cnt  # sinks read the sample clock
                    sinks[k](last[k])
                ph[k] = p
            cnt += 1
            if not cnt & 8191:  # keep the oscillators on the unit circle and the sums exact
                om /= abs(om)
                os_ /= abs(os_)
                sm = sum(bm)
                ss = sum(bs)
        self.i, self.sm, self.ss, self.om, self.os, self.count = i, sm, ss, om, os_, cnt
        self.z = [x1, x2, y1, y2]


_CRC_TABLE = []
for _b in range(256):
    _c = _b
    for _ in range(8):
        _c = (_c >> 1) ^ 0x8408 if _c & 1 else _c >> 1
    _CRC_TABLE.append(_c)


def crc_x25(data):
    """AX.25 frame check sequence (CRC-16-CCITT, reflected, init/xorout 0xFFFF)."""
    crc = 0xFFFF
    for b in data:
        crc = (crc >> 8) ^ _CRC_TABLE[(crc ^ b) & 0xFF]
    return crc ^ 0xFFFF


class HDLC:
    """NRZI + HDLC deframer (flags, bit stuffing, CRC) for one slicer; good frames go to on_frame."""

    def __init__(self, on_frame):
        self.on_frame = on_frame
        self.prev = False
        self.stream = 0
        self.inframe = False
        self.buf = bytearray()
        self.bitbuf = 0x80

    def bit(self, level):
        b = 1 if level == self.prev else 0  # NRZI: no tone change = 1
        self.prev = level
        st = ((self.stream << 1) | b) & 0xFF
        self.stream = st
        if st == 0x7E:
            if self.inframe and len(self.buf) >= 17:
                frame = bytes(self.buf)
                if crc_x25(frame[:-2]) == frame[-2] | (frame[-1] << 8):
                    self.on_frame(frame[:-2])
            self.inframe = True
            self.buf = bytearray()
            self.bitbuf = 0x80
            return
        if (st & 0x7F) == 0x7F:
            self.inframe = False
            return
        if not self.inframe:
            return
        if (st & 0x3F) == 0x3E:  # a stuffed zero after five ones
            return
        if b:
            self.bitbuf |= 0x100
        if self.bitbuf & 1:
            if len(self.buf) >= 400:
                self.inframe = False
                return
            self.buf.append(self.bitbuf >> 1)
            self.bitbuf = 0x80
            return
        self.bitbuf >>= 1


def ax25_to_tnc2(frame):
    """An AX.25 UI frame (without FCS) as TNC2 text 'SRC>DEST,DIGI*,...:info', or None."""
    addrs, i, end = [], 0, False
    while i + 7 <= len(frame) and len(addrs) < 10:
        a = frame[i:i + 7]
        chars = [c >> 1 for c in a[:6]]
        if any(c & 1 for c in a[:6]):
            return None
        call = "".join(chr(c) for c in chars).rstrip()
        if not call or not re.fullmatch(r"[A-Z0-9]{1,6}", call):
            return None
        ssid = (a[6] >> 1) & 0x0F
        addrs.append((call + (f"-{ssid}" if ssid else ""), bool(a[6] & 0x80)))
        i += 7
        if a[6] & 1:
            end = True
            break
    if not end or len(addrs) < 2 or i + 2 > len(frame):
        return None
    ctrl, pid = frame[i], frame[i + 1]
    if (ctrl & 0xEF) != 0x03 or pid != 0xF0:
        return None
    info = frame[i + 2:].decode("latin-1")
    path = [c + ("*" if h else "") for c, h in addrs[2:]]
    return f"{addrs[1][0]}>{addrs[0][0]}" + "".join("," + p for p in path) + ":" + info


class AprsDecoder:
    """Bell 202 AFSK1200 -> HDLC -> AX.25 -> 'APRS: ' lines (the shape of multimon-ng -A)."""

    def __init__(self, rate=RATE, gains=(0.5, 0.71, 1.0, 1.41, 2.0)):
        self.lines = []
        self.seen = {}
        self.hdlcs = [HDLC(self._frame) for _ in gains]
        self.demod = FSKDemod(rate, 1200, 1200, 2200, [h.bit for h in self.hdlcs], gains)
        self.rate = rate

    def _frame(self, frame):
        t = self.demod.count
        key = bytes(frame)
        if t - self.seen.get(key, -10 ** 9) < self.rate:  # the same frame from another slicer
            return
        self.seen[key] = t
        if len(self.seen) > 64:
            self.seen = {k: v for k, v in self.seen.items() if t - v < self.rate}
        tnc2 = ax25_to_tnc2(frame)
        if tnc2:
            self.lines.append("APRS: " + tnc2)

    def feed(self, samples):
        self.demod.feed(samples)
        res, self.lines = self.lines, []
        return res

    def flush(self):
        return []


SAME_CHARS = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-+/ ")


class SameFramer:
    """SAME byte framing for one slicer: sync on the 0xAB preamble, read bytes LSB first."""

    def __init__(self, on_burst):
        self.on_burst = on_burst
        self.sh = 0
        self.sync = False
        self.nbits = 0
        self.text = bytearray()
        self.started = False
        self.pre = 0
        self.bad = 0

    def bit(self, level):
        b = 1 if level else 0
        self.sh = ((self.sh >> 1) | (b << 7)) & 0xFF
        if not self.sync:
            if self.sh == 0xAB:
                self.sync, self.nbits, self.pre, self.started, self.text = True, 0, 1, False, bytearray()
            return
        self.nbits += 1
        if self.nbits < 8:
            return
        self.nbits = 0
        c = self.sh
        if not self.started:
            if c == 0xAB:
                self.pre += 1
                return
            if c in (ord("Z"), ord("N")) and self.pre >= 2:
                self.started, self.bad = True, 0
                self.text.append(c)
                return
            self.sync = False
            return
        if c in SAME_CHARS:
            self.text.append(c)
            self.bad = 0
        else:  # a bit error, or the end of the burst: mark it and let the vote over 3 bursts decide
            self.text.append(0x3F)
            self.bad += 1
        if self.bad >= 3 or len(self.text) >= 268:
            self._done()

    def _done(self):
        t = self.text.decode("ascii", "replace").rstrip("?")
        self.sync, self.started, self.text, self.bad = False, False, bytearray(), 0
        if t.startswith(("ZCZC", "NNNN")):
            self.on_burst(t)


SAME_RE = re.compile(r"ZCZC-([A-Z]{3})-([A-Z]{3})((?:-\d{6}){1,31})\+(\d{4})-(\d{3})(\d{2})(\d{2})-([A-Z0-9/ ]{1,8}?)(?:-|$)")


def vote(texts):
    """The best SAME header from repeated bursts: one that parses and repeats, else a per-character majority."""
    good = [SAME_RE.match(t).group(0) for t in texts if SAME_RE.match(t)]
    for g in good:
        if good.count(g) >= 2:
            return g
    n = max(len(t) for t in texts)
    chars = []
    for j in range(n):
        col = [t[j] for t in texts if j < len(t)]
        real = [c for c in col if c != "?"] or col
        chars.append(max(sorted(set(real)), key=real.count))
    v = "".join(chars)
    m = SAME_RE.match(v)
    if m:
        return m.group(0)
    return good[0] if good else None


class SameDecoder:
    """520.83 baud FSK (mark 2083.3 Hz, space 1562.5 Hz) -> SAME bursts -> voted 'EAS: ' lines."""

    def __init__(self, rate=RATE, gains=(0.7, 1.0, 1.4)):
        self.rate = rate
        self.lines = []
        self.group = []  # (sample index, text) of bursts not yet voted
        self.framers = [SameFramer(self._burst) for _ in gains]
        self.demod = FSKDemod(rate, 520.0 + 5.0 / 6.0, 2083.0 + 1.0 / 3.0, 1562.5, [f.bit for f in self.framers], gains, q=2.4)

    def _burst(self, text):
        self.group.append((self.demod.count, text))

    def _close(self, force=False):
        if not self.group:
            return
        t = self.demod.count
        if not force and t - self.group[-1][0] < 3.2 * self.rate:
            return
        for prefix in ("ZCZC", "NNNN"):
            texts = [x for _, x in self.group if x.startswith(prefix)]
            if not texts:
                continue
            if prefix == "NNNN":
                self.lines.append("EAS: NNNN")
            else:
                v = vote(texts)
                if v:
                    self.lines.append("EAS: " + v)
        self.group = []

    def feed(self, samples):
        self.demod.feed(samples)
        self._close()
        res, self.lines = self.lines, []
        return res

    def flush(self):
        self._close(force=True)
        res, self.lines = self.lines, []
        return res


def make_decoder(mode):
    return AprsDecoder() if mode == "aprs" else SameDecoder()


# ---------------------------------------------------------------------- audio files and synthesis

def samples_from_bytes(data):
    a = array.array("h")
    a.frombytes(data[:len(data) // 2 * 2])
    if sys.byteorder == "big":
        a.byteswap()
    return a


def read_audio(path):
    """Raw s16le 22050 Hz mono, or a 16-bit PCM WAV (mono or the first channel, resampled to 22050)."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return samples_from_bytes(data)
    pos, fmt, pcm = 12, None, b""
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
        elif cid == b"data":
            pcm = body
        pos += 8 + size + (size & 1)
    if not fmt or fmt[0] != 1 or fmt[5] != 16:
        raise ValueError("only 16-bit PCM WAV files are supported")
    ch, rate = fmt[1], fmt[2]
    s = samples_from_bytes(pcm)
    if ch > 1:
        s = s[::ch]
    if rate != RATE:
        ratio = rate / RATE
        n = int(len(s) / ratio)
        s = array.array("h", (s[min(len(s) - 1, int(k * ratio))] for k in range(n)))
    return s


def write_raw(path, samples):
    a = array.array("h", (max(-32767, min(32767, int(v))) for v in samples))
    if sys.byteorder == "big":
        a.byteswap()
    with open(path, "wb") as f:
        f.write(a.tobytes())


def write_wav(path, samples, rate=RATE):
    a = array.array("h", (max(-32767, min(32767, int(v))) for v in samples))
    if sys.byteorder == "big":
        a.byteswap()
    pcm = a.tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE")
        f.write(b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16))
        f.write(b"data" + struct.pack("<I", len(pcm)) + pcm)


def fsk_synth(bits, baud, mark, space, rate=RATE, amp=9000.0, twist_db=0.0, phase=0.0):
    """Phase-continuous FSK; bits are tone levels (1 = mark). twist_db boosts the space tone."""
    out_ = []
    spb = rate / baud
    t_next = 0.0
    n = 0
    sp_amp = amp * 10 ** (twist_db / 20)
    for bit in bits:
        t_next += spb
        f, a = (mark, amp) if bit else (space, sp_amp)
        w = 2 * math.pi * f / rate
        while n < t_next:
            out_.append(a * math.sin(phase))
            phase += w
            n += 1
    return out_


def ax25_encode(tnc2):
    """TNC2 text -> AX.25 UI frame with FCS (for the self-tests)."""
    head, info = tnc2.split(":", 1)
    src, rest = head.split(">", 1)
    parts = rest.split(",")
    calls = [parts[0], src] + parts[1:]
    out_ = bytearray()
    for k, c in enumerate(calls):
        h = c.endswith("*")
        c = c.rstrip("*")
        call, _, ssid = c.partition("-")
        out_ += bytes((ord(ch) << 1) for ch in call.ljust(6)[:6])
        sb = 0x60 | ((int(ssid or 0) & 0x0F) << 1)
        if k == 0 or (h and k >= 2):  # the command bit on the destination; has-been-repeated on digis
            sb |= 0x80
        if k == len(calls) - 1:
            sb |= 1
        out_.append(sb)
    out_ += b"\x03\xf0" + info.encode("latin-1")
    fcs = crc_x25(out_)
    return bytes(out_) + bytes((fcs & 0xFF, fcs >> 8))


def afsk_packet_audio(tnc2, flags=40, twist_db=0.0, amp=9000.0):
    """One APRS packet as Bell 202 audio: flags, the bit-stuffed frame, NRZI, 1200/2200 Hz."""
    frame = ax25_encode(tnc2)
    raw = []
    for _ in range(flags):
        raw += [0, 1, 1, 1, 1, 1, 1, 0]
    ones = 0
    for byte in frame:
        for k in range(8):
            b = (byte >> k) & 1
            raw.append(b)
            if b:
                ones += 1
                if ones == 5:
                    raw.append(0)
                    ones = 0
            else:
                ones = 0
    for _ in range(4):
        raw += [0, 1, 1, 1, 1, 1, 1, 0]
    level, tones = 1, []
    for b in raw:
        if b == 0:
            level ^= 1
        tones.append(level)
    return fsk_synth(tones, 1200, 1200, 2200, amp=amp, twist_db=twist_db)


def same_burst_bits(text):
    bits = []
    for byte in [0xAB] * 16 + list(text.encode("ascii")):
        bits += [(byte >> k) & 1 for k in range(8)]
    return bits


def same_audio(header, attention_s=3.0, eom=True, amp=9000.0):
    """A SAME transmission: the header three times (1 s apart), the 1050 Hz attention tone, then EOM x3."""
    sil = [0.0] * RATE
    s = list(sil)
    baud, mark, space = 520.0 + 5.0 / 6.0, 2083.0 + 1.0 / 3.0, 1562.5
    for _ in range(3):
        s += fsk_synth(same_burst_bits(header), baud, mark, space, amp=amp) + sil
    if attention_s:
        w = 2 * math.pi * 1050 / RATE
        s += [amp * 0.8 * math.sin(w * k) for k in range(int(attention_s * RATE))] + sil
    if eom:
        for _ in range(3):
            s += fsk_synth(same_burst_bits("NNNN"), baud, mark, space, amp=amp) + sil
    return s


def add_noise(samples, rms, seed=7):
    rnd = random.Random(seed)
    return [v + rnd.gauss(0, rms) for v in samples]


# ====================================================================== APRS parsing

PRIMARY = {
    "!": ("Police station", "police"), "#": ("Digipeater", "digi"), "$": ("Phone", "station"), "%": ("DX cluster", "station"),
    "&": ("HF gateway", "igate"), "'": ("Small aircraft", "aircraft"), "(": ("Mobile satellite station", "station"),
    ")": ("Wheelchair", "person"), "*": ("Snowmobile", "car"), "+": ("Red Cross", "emergency"), ",": ("Scouts", "person"),
    "-": ("House", "house"), ".": ("X marker", "station"), "/": ("Dot", "station"), ":": ("Fire", "emergency"),
    ";": ("Campground", "house"), "<": ("Motorcycle", "car"), "=": ("Railroad engine", "train"), ">": ("Car", "car"),
    "?": ("File server", "station"), "@": ("Hurricane forecast", "weather"), "A": ("Aid station", "emergency"),
    "B": ("BBS", "station"), "C": ("Canoe", "boat"), "E": ("Eyeball (event)", "station"), "F": ("Farm vehicle", "truck"),
    "G": ("Grid square", "station"), "H": ("Hotel", "house"), "I": ("TCP/IP station", "igate"), "K": ("School", "house"),
    "L": ("PC user", "station"), "M": ("MacAPRS", "station"), "N": ("NTS station", "station"), "O": ("Balloon", "balloon"),
    "P": ("Police", "police"), "R": ("RV", "car"), "S": ("Space shuttle", "aircraft"), "T": ("SSTV", "station"),
    "U": ("Bus", "truck"), "V": ("ATV", "station"), "W": ("Weather service site", "weather"), "X": ("Helicopter", "aircraft"),
    "Y": ("Sailboat", "boat"), "Z": ("WinAPRS", "station"), "[": ("Person", "person"), "\\": ("DF station", "station"),
    "]": ("Post office", "house"), "^": ("Large aircraft", "aircraft"), "_": ("Weather station", "weather"),
    "`": ("Dish antenna", "station"), "a": ("Ambulance", "emergency"), "b": ("Bicycle", "bike"),
    "c": ("Incident command post", "emergency"), "d": ("Fire department", "emergency"), "e": ("Horse", "person"),
    "f": ("Fire truck", "emergency"), "g": ("Glider", "aircraft"), "h": ("Hospital", "emergency"),
    "i": ("Islands on the air", "station"), "j": ("Jeep", "car"), "k": ("Truck", "truck"), "l": ("Laptop", "station"),
    "m": ("Mic-E repeater", "repeater"), "n": ("Node", "digi"), "o": ("Emergency operations center", "emergency"),
    "p": ("Dog", "person"), "q": ("Grid square", "station"), "r": ("Repeater", "repeater"), "s": ("Power boat", "boat"),
    "t": ("Truck stop", "house"), "u": ("Semi truck", "truck"), "v": ("Van", "car"), "w": ("Water station", "house"),
    "x": ("xAPRS", "station"), "y": ("House with yagi", "house"),
}
ALTERNATE = {
    "!": ("Emergency", "emergency"), "#": ("Digipeater", "digi"), "$": ("Bank", "house"), "&": ("Gateway", "igate"),
    "'": ("Crash site", "emergency"), "(": ("Cloudy", "weather"), "*": ("Snow", "weather"), "+": ("Church", "house"),
    ",": ("Scouts", "person"), "-": ("House (HF)", "house"), ".": ("Ambiguous", "station"), "0": ("Circle", "station"),
    ":": ("Hail", "weather"), ";": ("Park", "house"), "<": ("Advisory", "weather"), ">": ("Car", "car"),
    "@": ("Hurricane", "weather"), "A": ("Box", "station"), "B": ("Blowing snow", "weather"), "C": ("Coast Guard", "boat"),
    "D": ("Drizzle", "weather"), "E": ("Smoke", "weather"), "F": ("Freezing rain", "weather"), "G": ("Snow shower", "weather"),
    "H": ("Haze", "weather"), "I": ("Rain shower", "weather"), "J": ("Lightning", "weather"), "K": ("Kenwood radio", "station"),
    "L": ("Lighthouse", "house"), "N": ("Navigation buoy", "boat"), "O": ("Rocket", "aircraft"), "P": ("Parking", "house"),
    "Q": ("Earthquake", "emergency"), "R": ("Restaurant", "house"), "S": ("Satellite", "station"),
    "T": ("Thunderstorm", "weather"), "U": ("Sunny", "weather"), "V": ("VORTAC", "aircraft"), "W": ("NWS site", "weather"),
    "X": ("Pharmacy", "house"), "[": ("Wall cloud", "weather"), "^": ("Aircraft", "aircraft"), "_": ("Weather station", "weather"),
    "`": ("Rain", "weather"), "a": ("ARES/RACES", "emergency"), "c": ("Civil defense", "emergency"), "d": ("DX spot", "station"),
    "e": ("Sleet", "weather"), "f": ("Funnel cloud", "weather"), "g": ("Gale flags", "weather"), "h": ("Ham store", "house"),
    "i": ("Point of interest", "station"), "j": ("Work zone", "truck"), "k": ("SUV", "car"), "l": ("Area", "station"),
    "m": ("Milepost", "station"), "n": ("Triangle", "station"), "o": ("Small circle", "station"),
    "p": ("Partly cloudy", "weather"), "r": ("Restrooms", "house"), "s": ("Boat", "boat"), "t": ("Tornado", "weather"),
    "u": ("Truck", "truck"), "v": ("Van", "car"), "w": ("Flooding", "weather"), "y": ("Skywarn", "weather"),
    "z": ("Shelter", "house"),
}


def symbol_info(table, code):
    """{'table','code','overlay','name','kind'} for an APRS symbol (overlays use the alternate table)."""
    overlay = None
    t = table
    if t not in ("/", "\\"):
        overlay, t = t, "\\"
    name, kind = (PRIMARY if t == "/" else ALTERNATE).get(code, (None, "station"))
    if code.isdigit() and t == "/":
        name, kind = f"Circle {code}", "station"
    if name and overlay and kind == "digi":
        name = f"Digipeater ({overlay})"
    return {"table": table, "code": code, "overlay": overlay, "name": name or "Station", "kind": kind}


def b91(s):
    v = 0
    for c in s:
        v = v * 91 + (ord(c) - 33)
    return v


def clean_text(s):
    """APRS text arrives as bytes; show UTF-8 when it is, drop control characters."""
    try:
        s = s.encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    return "".join(ch for ch in s if ch >= " " and ch != "\x7f").strip()


KNOT_MPH = 1.150779

UNC_RE = re.compile(r"^(\d{2})([0-9 ]{2}\.[0-9 ]{2})([NnSs])(.)(\d{3})([0-9 ]{2}\.[0-9 ]{2})([EeWw])(.)")


def parse_uncompressed(s):
    m = UNC_RE.match(s)
    if not m:
        return None
    lat_min_s, lon_min_s = m.group(2), m.group(6)
    amb = lat_min_s.count(" ")
    unit = {0: 0, 1: 0.01, 2: 0.1, 3: 1, 4: 10}.get(amb, 10)
    half = 0  # ambiguous digits sit mid-way through the range they hide
    if amb:
        half = {1: 0.05, 2: 0.5, 3: 5.0, 4: 30.0}.get(amb, 0) if unit else 0
    try:
        lat = int(m.group(1)) + (float(lat_min_s.replace(" ", "0")) + half) / 60
        lon = int(m.group(5)) + (float(lon_min_s.replace(" ", "0")) + half) / 60
    except ValueError:
        return None
    if m.group(3) in "Ss":
        lat = -lat
    if m.group(7) in "Ww":
        lon = -lon
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    pos = {"lat": round(lat, 5), "lon": round(lon, 5), "fmt": "uncompressed", "ambiguity": amb,
           "table": m.group(4), "code": m.group(8)}
    return pos, s[19:]


def parse_compressed(s):
    if len(s) < 13:
        return None
    table = s[0]
    if not (table in "/\\" or "A" <= table <= "Z" or "a" <= table <= "j"):
        return None
    if any(not ("!" <= c <= "{") for c in s[1:9]):
        return None
    lat = 90 - b91(s[1:5]) / 380926.0
    lon = -180 + b91(s[5:9]) / 190463.0
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    if "a" <= table <= "j":
        table = str(ord(table) - 97)  # an overlay digit on the alternate table
    pos = {"lat": round(lat, 5), "lon": round(lon, 5), "fmt": "compressed", "ambiguity": 0, "table": table, "code": s[9]}
    c, sp, t = s[10], s[11], s[12]
    if c != " ":
        cv, sv = ord(c) - 33, ord(sp) - 33
        if ((ord(t) - 33) >> 3) & 3 == 2:
            pos["altFt"] = round(1.002 ** (cv * 91 + sv))
        elif 0 <= cv <= 89:
            pos["course"] = cv * 4
            pos["speedMph"] = round((1.08 ** sv - 1) * KNOT_MPH, 1)
        elif c == "{":
            pos["rangeMi"] = round(2 * 1.08 ** sv, 1)
    return pos, s[13:]


def parse_position(s):
    if not s:
        return None
    return parse_uncompressed(s) if s[0].isdigit() else parse_compressed(s)


WX_LEN = {"c": 3, "s": 3, "g": 3, "t": 3, "r": 3, "p": 3, "P": 3, "h": 2, "b": 5, "L": 3, "l": 3, "#": 3}


def parse_weather(s, positionless=False):
    """APRS weather fields -> ({tempF, humidity, windMph, ...}, the rest of the comment)."""
    wx, i = {}, 0
    if not positionless:
        m = re.match(r"^([0-9 .]{3})/([0-9 .]{3})", s)
        if m:
            if m.group(1).strip(" .").isdigit():
                wx["windDir"] = int(m.group(1))
            if m.group(2).strip(" .").isdigit():
                wx["windMph"] = int(m.group(2))
            i = 7
    while i < len(s):
        k = s[i]
        n = WX_LEN.get(k)
        if not n:
            break
        v = s[i + 1:i + 1 + n]
        if len(v) < n or not re.fullmatch(r"-?[0-9 .]+", v):
            break
        i += 1 + n
        try:
            num = int(v)
        except ValueError:
            continue
        if k == "c":
            wx["windDir"] = num
        elif k == "s":
            wx["windMph" if positionless else "snowIn"] = num
        elif k == "g":
            wx["gustMph"] = num
        elif k == "t":
            wx["tempF"] = num
        elif k == "r":
            wx["rain1hIn"] = num / 100
        elif k == "p":
            wx["rain24hIn"] = num / 100
        elif k == "P":
            wx["rainMidnightIn"] = num / 100
        elif k == "h":
            wx["humidity"] = 100 if num == 0 else num
        elif k == "b":
            wx["pressureHpa"] = num / 10
        elif k == "L":
            wx["luminosity"] = num
        elif k == "l":
            wx["luminosity"] = num + 1000
    return wx, s[i:]


def extensions(pos, rest, weather_symbol):
    """Course/speed, PHG/RNG and /A=altitude after an uncompressed position."""
    if pos["fmt"] == "uncompressed" and not weather_symbol:
        m = re.match(r"^(\d{3})/(\d{3})", rest)
        if m:
            if 0 < int(m.group(1)) <= 360:
                pos["course"] = int(m.group(1)) % 360
            pos["speedMph"] = round(int(m.group(2)) * KNOT_MPH, 1)
            rest = rest[7:]
        m = re.match(r"^PHG(\d)(\d)(\d)(\d)", rest)
        if m:
            p, h, g, d = (int(x) for x in m.groups())
            pos["phg"] = {"watts": p * p, "haatFt": 10 * 2 ** h, "gainDb": g, "dir": d * 45 if d else None}
            rest = rest[7:]
        m = re.match(r"^RNG(\d{4})", rest)
        if m:
            pos["rangeMi"] = int(m.group(1))
            rest = rest[7:]
    m = re.search(r"/A=(-?\d{5,6})", rest)
    if m:
        pos["altFt"] = int(m.group(1))
        rest = rest[:m.start()] + rest[m.end():]
    rest = re.sub(r"!w..!", "", rest)  # DAO extra-precision marker
    return rest


MICE_MSG = {7: "Off duty", 6: "En route", 5: "In service", 4: "Returning", 3: "Committed", 2: "Special", 1: "Priority",
            0: "Emergency"}


def parse_mice(dest, info):
    """Mic-E: latitude and flags from the destination callsign, longitude/speed/course from the info field."""
    d = dest.split("-")[0]
    if len(d) != 6 or len(info) < 9:
        return None
    digits, bits, flags, custom = [], [], [], False
    for k, c in enumerate(d):
        if "0" <= c <= "9":
            dig, bit, flag = ord(c) - 48, 0, False
        elif "A" <= c <= "J":
            dig, bit, flag = ord(c) - 65, 1, False
            custom = custom or k < 3
        elif "P" <= c <= "Y":
            dig, bit, flag = ord(c) - 80, 1, True
        elif c == "K":
            dig, bit, flag = None, 1, False
            custom = custom or k < 3
        elif c == "L":
            dig, bit, flag = None, 0, False
        elif c == "Z":
            dig, bit, flag = None, 1, True
        else:
            return None
        digits.append(dig)
        bits.append(bit)
        flags.append(flag)
    amb = sum(1 for x in digits if x is None)
    dg = [x if x is not None else 0 for x in digits]
    lat = dg[0] * 10 + dg[1] + (dg[2] * 10 + dg[3] + dg[4] / 10 + dg[5] / 100) / 60
    if not flags[3]:
        lat = -lat
    b = [ord(c) - 28 for c in info[1:7]]
    deg = b[0] + (100 if flags[4] else 0)
    if 180 <= deg <= 189:
        deg -= 80
    elif 190 <= deg <= 199:
        deg -= 190
    mins = b[1] - 60 if b[1] >= 60 else b[1]
    lon = deg + (mins + b[2] / 100) / 60
    if flags[5]:
        lon = -lon
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or mins < 0 or b[2] < 0:
        return None
    speed = b[3] * 10 + b[4] // 10
    if speed >= 800:
        speed -= 800
    course = (b[4] % 10) * 100 + b[5]
    if course >= 400:
        course -= 400
    pos = {"lat": round(lat, 5), "lon": round(lon, 5), "fmt": "mic-e", "ambiguity": amb, "table": info[8], "code": info[7]}
    if speed:
        pos["speedMph"] = round(speed * KNOT_MPH, 1)
    if 0 < course <= 360:
        pos["course"] = course % 360
    rest = info[9:]
    m = re.search(r"(.{3})\}", rest)
    if m and all("!" <= c <= "{" for c in m.group(1)):
        pos["altFt"] = round((b91(m.group(1)) - 10000) * 3.28084)
        rest = rest[:m.start()] + rest[m.end():]
    if rest[:1] in (">", "]", "`", "'"):
        rest = rest[1:]
    rest = re.sub(r"(_[ \"#$%&()*+,\-./0-9]|[=^])$", "", rest)
    msg_bits = bits[0] * 4 + bits[1] * 2 + bits[2]
    status = ("Custom " + str(7 - msg_bits)) if custom else MICE_MSG[msg_bits]
    return pos, rest, status


TNC2_RE = re.compile(r"^([A-Za-z0-9\-]{1,9})>([A-Za-z0-9\-]{1,9})((?:,[A-Za-z0-9\-]{1,9}\*?)*):(.*)$", re.S)
ALIAS_RE = re.compile(r"^(WIDE\d?|TRACE\d?|RELAY|ECHO|GATE|TEMP\d?|NCA\d?|[A-Z]{2}\d?)(-\d{1,2})?$")


def is_alias(call):
    return bool(ALIAS_RE.match(call)) or call.startswith(("WIDE", "TRACE", "RELAY", "TCPIP", "TCPXX", "NOGATE", "RFONLY", "q"))


def parse_tnc2(line):
    """One APRS packet in TNC2 text -> a dict (type, position, symbol, weather, message, ...), or None."""
    line = line.rstrip("\r\n")
    m = TNC2_RE.match(line)
    if not m:
        return None
    src, dest, path_s, info = m.group(1), m.group(2), m.group(3), m.group(4)
    path = [p for p in path_s.split(",") if p]
    # Everything up to the last '*' has been repeated; the last real callsign there is who we heard it from.
    starred = [k for k, p in enumerate(path) if p.endswith("*")]
    used = [p.rstrip("*") for p in path[:starred[-1] + 1]] if starred else []
    real = [p for p in used if not is_alias(p)]
    if not used:
        via = "direct"
    elif not is_alias(used[-1]):
        via = used[-1]
    else:
        via = real[-1] if real else "digipeater"
    pkt = {"src": src, "dest": dest, "path": path, "via": via, "digis": real, "raw": line, "info": info}
    if not info:
        pkt["type"] = "empty"
        return pkt
    dti = info[0]
    pos = rest = None
    try:
        if dti in "!=":
            r = parse_position(info[1:])
            if r:
                pos, rest = r
                pkt["messaging"] = dti == "="
        elif dti in "/@":
            r = parse_position(info[8:])
            if r:
                pos, rest = r
                pkt["timestamp"] = info[1:8]
        elif dti in "`'\x1c\x1d":
            r = parse_mice(dest, info)
            if r:
                pos, rest, pkt["micE"] = r
        elif dti == ";" and len(info) >= 18:
            pkt["object"] = {"name": info[1:10].rstrip(), "live": info[10] == "*"}
            r = parse_position(info[18:])
            if r:
                pos, rest = r
        elif dti == ")":
            mm = re.match(r"^\)([^!_]{3,9})([!_])", info)
            if mm:
                pkt["object"] = {"name": mm.group(1).rstrip(), "live": mm.group(2) == "!", "item": True}
                r = parse_position(info[mm.end():])
                if r:
                    pos, rest = r
        elif dti == ":" and len(info) >= 11 and info[10] == ":":
            to, text = info[1:10].strip(), info[11:]
            msg = {"to": to, "text": clean_text(text)}
            mi = re.search(r"\{([A-Za-z0-9]{1,5})(\}.*)?$", text)
            if mi:
                msg["id"] = mi.group(1)
                msg["text"] = clean_text(text[:mi.start()])
            ak = re.match(r"^(ack|rej)([A-Za-z0-9]{1,5})", text)
            msg["kind"] = (ak.group(1) if ak else "bulletin" if to.startswith(("BLN", "NWS")) else
                           "telemetry-setup" if text.startswith(("PARM.", "UNIT.", "EQNS.", "BITS.")) else "message")
            pkt["type"], pkt["message"] = "message", msg
        elif dti == ">":
            text = info[1:]
            if re.match(r"^\d{6}z", text):
                text = text[7:]
            pkt["type"], pkt["status"] = "status", clean_text(text)
        elif dti == "_" and len(info) >= 9:
            wx, rest2 = parse_weather(info[9:], positionless=True)
            pkt["type"], pkt["weather"] = "weather", wx
            pkt["comment"] = clean_text(rest2)
        elif dti == "$":
            pos = parse_nmea(info)
            rest = ""
        elif dti == "T" and info.startswith("T#"):
            pkt["type"], pkt["telemetry"] = "telemetry", clean_text(info[2:])[:120]
        elif dti == "<":
            pkt["type"], pkt["capabilities"] = "capabilities", clean_text(info[1:])[:120]
        elif dti == "}":
            inner = parse_tnc2(info[1:])
            if inner:
                inner["thirdParty"] = {"by": src, "path": path}
                inner["raw"] = line
                inner["via"] = via
                return inner
            pkt["type"] = "third-party"
        if pos is None and "type" not in pkt:
            k = info.find("!", 0, 40)
            if k > 0:
                r = parse_position(info[k + 1:])
                if r:
                    pos, rest = r
    except (ValueError, IndexError):
        pos = None
    if pos is not None:
        sym = symbol_info(pos.pop("table"), pos.pop("code"))
        pkt["symbol"] = sym
        rest = rest or ""
        is_wx = sym["code"] == "_"
        rest = extensions(pos, rest, is_wx)
        if is_wx:
            wx, rest = parse_weather(rest)
            if wx:
                pkt["weather"] = wx
        pkt["pos"] = pos
        pkt["comment"] = clean_text(rest)
        pkt["type"] = "object" if "object" in pkt else "weather" if pkt.get("weather") else "position"
    pkt.setdefault("type", "other")
    pkt["summary"] = summarize(pkt)
    return pkt


def parse_nmea(info):
    f = info.split(",")
    try:
        if f[0][3:6] == "RMC" and f[2] == "A":
            lat, lon = nmea_deg(f[3], f[4]), nmea_deg(f[5], f[6])
            p = {"lat": lat, "lon": lon, "fmt": "nmea", "ambiguity": 0, "table": "/", "code": "/"}
            if f[7]:
                p["speedMph"] = round(float(f[7]) * KNOT_MPH, 1)
            if f[8]:
                p["course"] = round(float(f[8])) % 360
            return p
        if f[0][3:6] == "GGA" and f[6] not in ("", "0"):
            p = {"lat": nmea_deg(f[2], f[3]), "lon": nmea_deg(f[4], f[5]), "fmt": "nmea", "ambiguity": 0, "table": "/", "code": "/"}
            if f[9]:
                p["altFt"] = round(float(f[9]) * 3.28084)
            return p
    except (IndexError, ValueError):
        return None
    return None


def nmea_deg(v, hemi):
    x = float(v)
    d = int(x // 100)
    val = d + (x - d * 100) / 60
    return round(-val if hemi in "SW" else val, 5)


def geo(lat, lon, ref=None):
    """(miles, bearing degrees, compass) from the reference point."""
    ref = ref or REF
    p1, p2 = math.radians(ref["lat"]), math.radians(lat)
    dl = math.radians(lon - ref["lon"])
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    dist = 3958.8 * 2 * math.asin(min(1.0, math.sqrt(a)))
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    brg = (math.degrees(math.atan2(y, x)) + 360) % 360
    return round(dist, 2), round(brg), compass(brg)


def compass(deg):
    return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][int((deg + 11.25) % 360 // 22.5)]


def wx_text(wx):
    parts = []
    if "tempF" in wx:
        parts.append(f"{wx['tempF']}°F")
    if "humidity" in wx:
        parts.append(f"{wx['humidity']}%")
    if "windMph" in wx:
        w = f"wind {wx['windMph']} mph"
        if "windDir" in wx and wx.get("windMph"):
            w += f" from {compass(wx['windDir'])}"
        if wx.get("gustMph"):
            w += f", gusts {wx['gustMph']}"
        parts.append(w)
    if "pressureHpa" in wx:
        parts.append(f"{wx['pressureHpa']:.1f} hPa")
    if wx.get("rain1hIn"):
        parts.append(f"rain {wx['rain1hIn']:.2f} in/h")
    if wx.get("rainMidnightIn"):
        parts.append(f"{wx['rainMidnightIn']:.2f} in today")
    return ", ".join(parts)


def summarize(pkt):
    t = pkt["type"]
    who = pkt.get("object", {}).get("name") or pkt["src"]
    if t in ("position", "object", "weather") and pkt.get("pos"):
        d, _, cmp_ = geo(pkt["pos"]["lat"], pkt["pos"]["lon"])
        s = f"{who}: {pkt['symbol']['name']} {d:.1f} mi {cmp_}"
        if pkt.get("weather"):
            s += " · " + wx_text(pkt["weather"])
        elif pkt.get("pos", {}).get("speedMph"):
            s += f" · {pkt['pos']['speedMph']:.0f} mph"
        if pkt.get("comment"):
            s += f" · {pkt['comment'][:60]}"
        return s
    if t == "weather":
        return f"{who}: weather · {wx_text(pkt.get('weather') or {})}"
    if t == "status":
        return f"{who}: status · {pkt['status'][:80]}"
    if t == "message":
        mm = pkt["message"]
        return f"{who} → {mm['to']}: {mm['kind']} · {mm['text'][:80]}"
    if t == "telemetry":
        return f"{who}: telemetry"
    if t == "capabilities":
        return f"{who}: capabilities · {pkt['capabilities'][:60]}"
    return f"{who}: {clean_text(pkt.get('info', ''))[:80]}"


# ---------------------------------------------------------------------- APRS state

def empty_aprs():
    return {"version": 1, "ref": REF, "updated": None, "packets": 0, "stations": {}, "digis": {}, "recent": [],
            "messages": [], "runs": []}


def load_state(mode):
    st = read_json(os.path.join(STATE, MODES[mode]["file"]), None)
    if not isinstance(st, dict) or st.get("version") != 1:
        st = empty_aprs() if mode == "aprs" else empty_same()
    return st


def save_state(mode, st):
    os.makedirs(STATE, exist_ok=True)
    st["updated"] = now_ms()
    write_json(os.path.join(STATE, MODES[mode]["file"]), st)


def aprs_apply(st, pkt, at):
    """Folds one parsed packet into aprs.json's state."""
    st["packets"] = st.get("packets", 0) + 1
    obj = pkt.get("object")
    key = obj["name"] if obj else pkt["src"]
    s = st["stations"].setdefault(key, {"call": key, "first": at, "count": 0})
    s["count"] += 1
    s["last"] = at
    s["path"] = pkt["path"]
    s["via"] = pkt["via"]
    s["dest"] = pkt["dest"]
    s["lastType"] = pkt["type"]
    s["lastRaw"] = pkt["raw"][:300]
    if obj:
        s["object"] = True
        s["owner"] = pkt["src"]
        s["live"] = obj.get("live", True)
    if pkt.get("symbol"):
        s["symbol"] = pkt["symbol"]
    if pkt.get("pos"):
        p = pkt["pos"]
        d, brg, cmp_ = geo(p["lat"], p["lon"], st.get("ref"))
        s["pos"] = {"lat": p["lat"], "lon": p["lon"], "at": at, "fmt": p["fmt"], "ambiguity": p.get("ambiguity", 0)}
        s["distMi"], s["bearing"], s["dir"] = d, brg, cmp_
        for k in ("course", "speedMph", "altFt", "phg", "rangeMi"):
            if k in p:
                s[k] = p[k]
            elif k in ("course", "speedMph"):
                s.pop(k, None)
    if pkt.get("comment"):
        s["comment"] = pkt["comment"][:200]
    if pkt.get("status"):
        s["status"] = pkt["status"][:200]
    if pkt.get("weather"):
        s["weather"] = pkt["weather"]
        s["weatherAt"] = at
    if pkt.get("micE"):
        s["micE"] = pkt["micE"]
    if pkt.get("capabilities"):
        s["capabilities"] = pkt["capabilities"]
    for dg in pkt.get("digis") or []:
        e = st["digis"].setdefault(dg, {"count": 0})
        e["count"] += 1
        e["last"] = at
    st["recent"].insert(0, {"at": at, "call": key, "type": pkt["type"], "summary": pkt["summary"][:160], "raw": pkt["raw"][:300]})
    del st["recent"][200:]
    if pkt.get("message"):
        mm = pkt["message"]
        st["messages"].insert(0, {"at": at, "from": pkt["src"], "to": mm["to"], "text": mm["text"][:200],
                                  "id": mm.get("id"), "kind": mm["kind"]})
        del st["messages"][100:]
    if len(st["stations"]) > 500:
        for k in sorted(st["stations"], key=lambda c: st["stations"][c]["last"])[:len(st["stations"]) - 500]:
            del st["stations"][k]


def aprs_view(st, limit=None, now=None):
    """Stations newest first, with what each one is ('Car', 'Digipeater', ...), its kind and age."""
    rows = digital_render.view(st, now)
    return rows[:limit] if limit else rows


# ====================================================================== SAME parsing

SAME_ORG = {"EAS": "EAS participant (broadcast/cable)", "CIV": "Civil authorities", "WXR": "National Weather Service",
            "PEP": "Primary Entry Point (national)", "EAN": "Emergency Action Network"}

SAME_EVENTS = {
    # weather
    "BZW": "Blizzard Warning", "CFA": "Coastal Flood Watch", "CFW": "Coastal Flood Warning", "DSW": "Dust Storm Warning",
    "EWW": "Extreme Wind Warning", "FFA": "Flash Flood Watch", "FFW": "Flash Flood Warning", "FFS": "Flash Flood Statement",
    "FLA": "Flood Watch", "FLW": "Flood Warning", "FLS": "Flood Statement", "FSW": "Flash Freeze Warning",
    "FZW": "Freeze Warning", "HWA": "High Wind Watch", "HWW": "High Wind Warning", "HUA": "Hurricane Watch",
    "HUW": "Hurricane Warning", "HLS": "Hurricane Statement", "SVA": "Severe Thunderstorm Watch",
    "SVR": "Severe Thunderstorm Warning", "SVS": "Severe Weather Statement", "SQW": "Snow Squall Warning",
    "SMW": "Special Marine Warning", "SPS": "Special Weather Statement", "SSA": "Storm Surge Watch",
    "SSW": "Storm Surge Warning", "TOA": "Tornado Watch", "TOR": "Tornado Warning", "TRA": "Tropical Storm Watch",
    "TRW": "Tropical Storm Warning", "TSA": "Tsunami Watch", "TSW": "Tsunami Warning", "WSA": "Winter Storm Watch",
    "WSW": "Winter Storm Warning", "ECW": "Extreme Cold Warning", "ECA": "Extreme Cold Watch",
    "EHW": "Extreme Heat Warning", "EHA": "Extreme Heat Watch",
    # non-weather
    "ADR": "Administrative Message", "AVA": "Avalanche Watch", "AVW": "Avalanche Warning", "BLU": "Blue Alert",
    "CAE": "Child Abduction Emergency", "CDW": "Civil Danger Warning", "CEM": "Civil Emergency Message",
    "EQW": "Earthquake Warning", "EVI": "Evacuation Immediate", "FRW": "Fire Warning", "HMW": "Hazardous Materials Warning",
    "LEW": "Law Enforcement Warning", "LAE": "Local Area Emergency", "MEP": "Missing and Endangered Persons",
    "TOE": "911 Telephone Outage Emergency", "NUW": "Nuclear Power Plant Warning", "RHW": "Radiological Hazard Warning",
    "SPW": "Shelter in Place Warning", "VOW": "Volcano Warning", "NMN": "Network Message Notification",
    # national and tests
    "EAN": "Emergency Action Notification", "EAT": "Emergency Action Termination", "NIC": "National Information Center",
    "NPT": "National Periodic Test", "NAT": "National Audible Test", "NST": "National Silent Test",
    "RMT": "Required Monthly Test", "RWT": "Required Weekly Test", "DMO": "Practice/Demo Warning",
    "TXB": "Transmitter Backup On", "TXF": "Transmitter Carrier Off", "TXO": "Transmitter Carrier On",
    "TXP": "Transmitter Primary On",
}
TEST_EVENTS = {"RWT", "RMT", "NPT", "NAT", "NST", "DMO", "ADR", "NMN", "TXB", "TXF", "TXO", "TXP"}
EMERGENCY_EVENTS = {"EAN", "EAT", "NIC", "CAE", "CDW", "CEM", "EVI", "LAE", "SPW", "NUW", "RHW", "HMW", "LEW", "TOE",
                    "BLU", "MEP", "FRW", "EQW", "VOW"}

STATES = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
          "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
          "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
          "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
          "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
          "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "72": "PR"}
STATE_NAMES = {"IN": "Indiana", "KY": "Kentucky", "OH": "Ohio"}

# Counties for the alert areas (state FIPS + county FIPS) and the ones that count as local: the
# location's "weather" block (Cincinnati / Northern Kentucky around Walton by default).
COUNTIES = WX["counties"]
LOCAL = set(WX["local"])
PARTS = {"0": "", "1": "northwest", "2": "north", "3": "northeast", "4": "west", "5": "central", "6": "east",
         "7": "southwest", "8": "south", "9": "southeast"}


def severity(event):
    if event in TEST_EVENTS:
        return "test"
    if event in EMERGENCY_EVENTS:
        return "emergency"
    if event.endswith("W") or event in ("SVR", "TOR", "EWW"):
        return "warning"
    if event.endswith("A"):
        return "watch"
    if event.endswith("S"):
        return "statement"
    return "advisory"


def decode_area(code):
    p, ss, ccc = code[0], code[1:3], code[3:6]
    st = STATES.get(ss)
    county = None if ccc == "000" else COUNTIES.get(ss + ccc)
    part = PARTS.get(p, "")
    if ccc == "000":
        name = f"All of {STATE_NAMES.get(st, st or 'state ' + ss)}"
    elif county:
        name = f"{county} County, {st}"
    else:
        name = f"County {ccc}, {st or 'state ' + ss}"
    if part:
        name = f"{part.capitalize()} {name}"
    return {"code": code, "part": part, "state": st, "county": county, "name": name, "local": ss + ccc in LOCAL}


def parse_same(text, now=None):
    """'ZCZC-ORG-EEE-PSSCCC...+TTTT-JJJHHMM-LLLLLLLL-' -> a dict, or None."""
    m = SAME_RE.search(text or "")
    if not m:
        return None
    org, ev, areas_s, tttt, jjj, hh, mm, station = m.groups()
    now = now or now_ms()
    t_now = time.gmtime(now / 1000)
    year = t_now.tm_year
    issued = None
    try:
        import calendar
        for y in (year, year - 1):
            base = calendar.timegm((y, 1, 1, int(hh), int(mm), 0, 0, 0, 0))
            ts = (base + (int(jjj) - 1) * 86400) * 1000
            if ts <= now + 2 * 86400 * 1000:
                issued = ts
                break
    except (ValueError, OverflowError):
        issued = None
    dur = int(tttt[:2]) * 60 + int(tttt[2:])
    areas = [decode_area(c) for c in areas_s.strip("-").split("-") if c]
    return {"raw": m.group(0), "org": org, "orgName": SAME_ORG.get(org, org), "event": ev,
            "eventName": SAME_EVENTS.get(ev, f"Event {ev}"), "severity": severity(ev), "test": ev in TEST_EVENTS,
            "areas": areas, "local": any(a["local"] for a in areas), "issued": issued, "durationMin": dur,
            "expires": issued + dur * 60000 if issued else None, "station": station.strip()}


def empty_same():
    return {"version": 1, "updated": None, "alerts": [], "eom": [], "runs": []}


def same_apply(st, alert, at, source):
    for a in st["alerts"]:
        if a["raw"] == alert["raw"] and at - a.get("lastHeard", 0) < 30 * 60000:
            a["times"] = a.get("times", 1) + 1
            a["lastHeard"] = at
            return a
    rec = dict(alert)
    rec.update({"id": hashlib.sha1(f"{alert['raw']}{at}".encode()).hexdigest()[:10], "received": at, "lastHeard": at,
                "times": 1, "source": source})
    st["alerts"].insert(0, rec)
    del st["alerts"][200:]
    return rec


# ====================================================================== receiving

def rtl_fm_argv(freq, gain, ppm):
    argv = [RTL_FM, "-f", f"{freq:.4f}M", "-M", "fm", "-s", str(RATE), "-F", "9", "-E", "dc"]
    if gain is not None and str(gain) != "auto":
        argv += ["-g", str(gain)]
    if ppm:
        argv += ["-p", str(int(ppm))]
    return argv + ["-"]


def log_reason(path):
    try:
        with open(path, errors="replace") as f:
            tail = f.read()[-4000:]
    except OSError:
        return "exited", ""
    low = tail.lower()
    if "usb_claim_interface" in low or "resource busy" in low or "failed to open" in low:
        return "busy", "Another program has the V4. Close it and try again."
    if "no supported devices" in low or "no matching devices" in low or "no devices found" in low:
        return "missing", "The V4 is not plugged in."
    last = [ln for ln in tail.strip().splitlines() if ln.strip()]
    return "exited", last[-1][:200] if last else ""


class Receiver:
    """rtl_fm (narrow FM, 22050 Hz s16le) piped into multimon-ng or a built-in decoder.
    poll() returns decoded lines: 'APRS: SRC>DEST,PATH:info' or 'EAS: ZCZC-...' / 'EAS: NNNN'."""

    def __init__(self, mode, freq=None, gain=40, ppm=0, decoder="builtin", log_path=None, tee=None):
        self.mode, self.freq, self.gain, self.ppm, self.decoder = mode, freq or MODES[mode]["freq"], gain, ppm, decoder
        self.log_path = log_path or os.path.join(STATE, f"{mode}.log")
        self.tee = open(tee, "wb") if tee else None
        self.rtl = self.mm = None
        self.dec = None
        self.left = b""
        self.mbuf = b""
        self.bytes = 0
        self.sq = 0.0
        self.nsq = 0
        self.eof = False

    def start(self):
        os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
        self.log = open(self.log_path, "w")
        self.rtl = subprocess.Popen(rtl_fm_argv(self.freq, self.gain, self.ppm), stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=self.log, start_new_session=True)
        if self.decoder == "multimon":
            self.mm = subprocess.Popen(multimon_argv(self.mode), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=self.log, start_new_session=True)
        else:
            self.dec = make_decoder(self.mode)
        return self

    def children(self):
        return [p.pid for p in (self.rtl, self.mm) if p]

    def poll(self, timeout=0.5):
        lines = []
        fds = [self.rtl.stdout] + ([self.mm.stdout] if self.mm else [])
        try:
            r, _, _ = select.select(fds, [], [], timeout)
        except (OSError, ValueError):
            return lines
        if self.rtl.stdout in r:
            chunk = os.read(self.rtl.stdout.fileno(), 65536)
            if not chunk:
                self.eof = True
            else:
                self.bytes += len(chunk)
                if self.tee:
                    self.tee.write(chunk)
                data = self.left + chunk
                cut = len(data) // 2 * 2
                self.left = data[cut:]
                data = data[:cut]
                if self.mm:
                    try:
                        self.mm.stdin.write(data)
                        self.mm.stdin.flush()
                    except (BrokenPipeError, OSError):
                        self.eof = True
                s = samples_from_bytes(data)
                sub = s[::16]
                self.sq += sum(v * v for v in sub)
                self.nsq += len(sub)
                if self.dec:
                    lines += self.dec.feed(s)
        if self.mm and self.mm.stdout in r:
            data = os.read(self.mm.stdout.fileno(), 65536)
            if data:
                self.mbuf += data
                *done, self.mbuf = self.mbuf.split(b"\n")
                lines += [d.decode("latin-1").rstrip("\r") for d in done]
        return lines

    def dead(self):
        return self.eof or self.rtl.poll() is not None or (self.mm is not None and self.mm.poll() is not None)

    def level_dbfs(self):
        if not self.nsq:
            return None
        rms = math.sqrt(self.sq / self.nsq)
        return round(20 * math.log10(max(rms, 1) / 32768), 1)

    def stop(self):
        lines = []
        for p in (self.rtl, self.mm):
            if p and p.poll() is None:
                try:
                    p.terminate()
                except OSError:
                    pass
        if self.mm:
            try:
                self.mm.stdin.close()
            except OSError:
                pass
        end = time.time() + 3
        for p in (self.rtl, self.mm):
            if not p:
                continue
            try:
                p.wait(timeout=max(0.1, end - time.time()))
            except Exception:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except OSError:
                    pass
        if self.mm:
            try:
                rest = self.mm.stdout.read() or b""
                lines += [d.decode("latin-1").rstrip("\r") for d in (self.mbuf + rest).split(b"\n") if d.strip()]
            except (OSError, ValueError):
                pass
        if self.dec:
            lines += self.dec.flush()
        if self.tee:
            self.tee.close()
        try:
            self.log.close()
        except Exception:
            pass
        return lines


def handle_lines(mode, lines, at=None):
    """Decoder lines -> parsed events: ('aprs', pkt) / ('same', alert) / ('eom', None)."""
    evs = []
    for ln in lines:
        ln = ln.strip("\r\n")
        if mode == "aprs" and ln.startswith("APRS: "):
            pkt = parse_tnc2(ln[6:])
            if pkt:
                evs.append(("aprs", pkt))
        elif mode == "same" and ln.startswith("EAS"):
            body = ln.split(":", 1)[1].strip() if ":" in ln else ""
            if body.startswith("NNNN"):
                evs.append(("eom", None))
            else:
                a = parse_same(body, at)
                if a:
                    evs.append(("same", a))
    return evs


def apply_events(mode, evs, source, at=None):
    """Writes events into aprs.json / same.json under the state lock; returns the stored records."""
    if not evs:
        return []
    at = at or now_ms()
    stored = []
    with state_lock():
        st = load_state(mode)
        for kind, x in evs:
            if kind == "aprs":
                aprs_apply(st, x, at)
                stored.append(x)
            elif kind == "same":
                stored.append(same_apply(st, x, at, source))
            elif kind == "eom":
                st["eom"].insert(0, at)
                del st["eom"][20:]
        save_state(mode, st)
    return stored


def note_run(mode, info, exit_info=None):
    with state_lock():
        st = load_state(mode)
        if info:
            st.setdefault("runs", []).insert(0, info)
            del st["runs"][20:]
        if exit_info is not None:
            st["lastExit"] = exit_info
        save_state(mode, st)


def event_json(kind, x):
    if kind == "aprs":
        return {"type": "aprs", "packet": {k: x[k] for k in x if k not in ("info",)}}
    if kind == "same":
        return {"type": "same", "alert": x}
    return {"type": "eom"}


# ---------------------------------------------------------------------- jobs (pidfiles)

def pid_path(kind):
    return os.path.join(STATE, f"{kind}.pid")


def read_pid(kind):
    info = read_json(pid_path(kind))
    if not info or not alive(info.get("pid"), ("python", "Python", "digital")):
        return None
    return info


class Stop(Exception):
    pass


def _raise_stop(*_):
    raise Stop()


def job_exit(kind):
    """The job's last exit: radio.py records it in exits.json (the wrapper's), older runs in our state."""
    ex = (read_json(os.path.join(STATE, "exits.json"), {}) or {}).get(kind)
    own = load_state(kind).get("lastExit")
    if ex and own:
        return ex if ex.get("at", 0) >= own.get("at", 0) else own
    return ex or own


def radio_cli(args, timeout=120):
    """radio.py <args> -> its JSON: the one job manager that owns the V4."""
    try:
        p = subprocess.run([sys.executable, os.path.join(os.path.dirname(SCRIPT), "radio.py")] + args,
                           capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        return json.loads(p.stdout.strip().splitlines()[-1])
    except Exception as err:
        return {"ok": False, "error": "radio", "say": f"radio.py {' '.join(args[:2])} failed: {type(err).__name__}: {err}"[:300]}


class JobReader:
    """radio.py's wrapper feeds this rtl_fm's audio (s16le 22050 Hz): the built-in decoder,
    its events saved to aprs.json / same.json every ~2 s and at the end (with the run)."""

    def __init__(self, kind, meta):
        self.kind = kind
        self.meta = meta or {}
        self.dec = make_decoder(kind)
        self.left = b""
        self.pending = []
        self.count = 0
        self.started = now_ms()
        self.next_save = time.time() + 2

    def feed(self, chunk):
        data = self.left + chunk
        cut = len(data) // 2 * 2
        self.left = data[cut:]
        self.pending += handle_lines(self.kind, self.dec.feed(samples_from_bytes(data[:cut])))

    def tick(self):
        if self.pending and time.time() >= self.next_save:
            self.count += len(apply_events(self.kind, self.pending, "live"))
            self.pending = []
            self.next_save = time.time() + 2

    def close(self):
        self.pending += handle_lines(self.kind, self.dec.flush())
        if self.pending:
            self.count += len(apply_events(self.kind, self.pending, "live"))
            self.pending = []
        note_run(self.kind, {"at": self.started, "seconds": round((now_ms() - self.started) / 1000),
                             "packets": self.count, "decoder": "builtin", "mode": "live"})


def radio_modes(radio):
    """radio.py's PLUGIN_MODULES hook: "aprs" (APRS) and "same" (Weather alerts) as exclusive
    V4 jobs. Start: `radio.py job start aprs ['{"gain": 40, "freq": 144.39}']`."""
    def pipeline(kind):
        return lambda meta: [rtl_fm_argv(float((meta or {}).get("freq") or MODES[kind]["freq"]),
                                         (meta or {}).get("gain", 40), (meta or {}).get("ppm", 0))]
    return [
        radio.Mode(kind="aprs", label="APRS", children=("rtl_fm",), pipeline=pipeline("aprs"),
                   reader=lambda meta: JobReader("aprs", meta),
                   doing=lambda meta: "decode APRS on 144.390 MHz",
                   detail=lambda meta: f"decoding {float(meta.get('freq') or 144.39):.3f} MHz"),
        radio.Mode(kind="same", label="Weather alerts", children=("rtl_fm",), pipeline=pipeline("same"),
                   reader=lambda meta: JobReader("same", meta),
                   doing=lambda meta: f"watch for NOAA weather alerts on {WX['freq']:.3f} MHz",
                   detail=lambda meta: f"{WX['noaa_short']} {float(meta.get('freq') or WX['freq']):.3f} MHz"),
    ]


# ====================================================================== commands

def opt(args, name, default=None, cast=str):
    if name in args:
        k = args.index(name)
        try:
            v = cast(args[k + 1])
        except (IndexError, ValueError):
            v = default
        del args[k:k + 2]
        return v
    return default


def flag(args, name):
    if name in args:
        args.remove(name)
        return True
    return False


def common_opts(mode, args):
    o = {"freq": opt(args, "--freq", MODES[mode]["freq"], float), "gain": opt(args, "--gain", 40, str),
         "ppm": opt(args, "--ppm", 0, int), "decoder": opt(args, "--decoder", "auto"), "wait": opt(args, "--wait", 45.0, float)}
    if not 24 <= o["freq"] <= 1766:
        out({"ok": False, "error": "range", "say": "The V4 tunes 24-1766 MHz."})
    dec = pick_decoder(mode, o["decoder"])
    if not dec:
        out({"ok": False, "error": "decoder", "say": "multimon-ng is not installed (Homebrew has no formula for it); use --decoder builtin."})
    o["decoder"] = dec
    return o


def cmd_run(mode, args):
    o = common_opts(mode, args)
    stream = flag(args, "--stream")
    tee = opt(args, "--save-audio")
    pos = [a for a in args if not a.startswith("--")]
    try:
        seconds = max(3.0, min(600.0, float(pos[0]))) if pos else 20.0
    except ValueError:
        out({"ok": False, "error": "usage", "say": f"digital.py {mode} run [SECONDS]"})
    if not os.path.exists(RTL_FM):
        out({"ok": False, "error": "tools", "say": "rtl_fm is missing: brew install librtlsdr."})
    touch_heartbeat()
    lock, err = acquire_v4(o["wait"])
    if err:
        out(err)
    signal.signal(signal.SIGTERM, _raise_stop)
    signal.signal(signal.SIGINT, _raise_stop)
    rx = Receiver(mode, o["freq"], o["gain"], o["ppm"], o["decoder"], log_path=os.path.join(STATE, f"{mode}.log"), tee=tee)
    started = now_ms()
    evs = []
    reason = None
    try:
        rx.start()
        end = time.time() + seconds
        while time.time() < end:
            new = handle_lines(mode, rx.poll(0.5))
            evs += new
            if stream:
                for k, x in new:
                    emit(event_json(k, x))
            if rx.dead():
                reason = log_reason(rx.log_path)
                break
    except Stop:
        reason = ("stopped", "")
    finally:
        tail = handle_lines(mode, rx.stop())
        evs += tail
        if stream:
            for k, x in tail:
                emit(event_json(k, x))
        lock.release()
    secs = round((now_ms() - started) / 1000, 1)
    if reason and reason[0] in ("busy", "missing"):
        out({"ok": False, "error": reason[0], "say": reason[1]})
    stored = apply_events(mode, evs, "live")
    note_run(mode, {"at": started, "seconds": secs, "packets": len(stored), "decoder": o["decoder"], "mode": "run"})
    res = {"ok": True, "mode": mode, "freq": o["freq"], "seconds": secs, "decoder": o["decoder"],
           "audioBytes": rx.bytes, "audioLevelDbfs": rx.level_dbfs(), "stoppedEarly": reason[1] if reason else None}
    if mode == "aprs":
        pk = [x for k, x in evs if k == "aprs"]
        calls = sorted({(x.get("object") or {}).get("name") or x["src"] for x in pk})
        res.update({"packets": len(pk), "stations": calls, "summaries": [x["summary"] for x in pk][:50],
                    "say": (f"Heard {len(pk)} APRS packet{'s' if len(pk) != 1 else ''} from {len(calls)} station{'s' if len(calls) != 1 else ''} in {secs:g} s."
                            if pk else f"No APRS packets in {secs:g} s on {o['freq']:.3f} MHz (indoors, with a small antenna, that is common).")})
    else:
        al = [x for k, x in evs if k == "same"]
        res.update({"alerts": al, "eom": sum(1 for k, _ in evs if k == "eom"),
                    "say": (f"Decoded {len(al)} SAME header{'s' if len(al) != 1 else ''}: " + "; ".join(a["eventName"] for a in al)
                            if al else f"No SAME alert in {secs:g} s on {o['freq']:.3f} MHz (alerts and weekly tests are rare; RWT is usually Wednesday late morning).")})
    if tee:
        res["audio"] = os.path.abspath(tee)
    out(res)


def cmd_live(mode, args):
    """The background decoder: radio.py's "aprs" / "same" job (one owner of the V4)."""
    o = {"freq": opt(args, "--freq", MODES[mode]["freq"], float), "gain": opt(args, "--gain", 40, str),
         "ppm": opt(args, "--ppm", 0, int)}
    opt(args, "--decoder")  # the job always uses the built-in decoder
    opt(args, "--wait")
    if not 24 <= o["freq"] <= 1766:
        out({"ok": False, "error": "range", "say": "The V4 tunes 24-1766 MHz."})
    if not os.path.exists(RTL_FM):
        out({"ok": False, "error": "tools", "say": "rtl_fm is missing: brew install librtlsdr."})
    touch_heartbeat()
    meta = dict(o, decoder="builtin", label=MODES[mode]["label"])
    if flag(args, "--keep"):
        meta["keep"] = True
    out(radio_cli(["job", "start", mode, json.dumps(meta)]))


def cmd_stop(mode):
    out(radio_cli(["job", "stop", mode]))


def cmd_decode(mode, args):
    dry = flag(args, "--dry")
    want = opt(args, "--decoder", "auto")
    pos = [a for a in args if not a.startswith("--")]
    if not pos:
        out({"ok": False, "error": "usage", "say": f"digital.py {mode} decode FILE (raw s16le 22050 Hz mono, or WAV)"})
    path = pos[0]
    dec = pick_decoder(mode, want) or "builtin"
    t0 = time.time()
    lines = decode_file(mode, path, dec)
    evs = handle_lines(mode, lines)
    stored = [] if dry else apply_events(mode, evs, "file")
    res = {"ok": True, "mode": mode, "file": os.path.abspath(path), "decoder": dec, "cpuSeconds": round(time.time() - t0, 2),
           "lines": lines, "saved": len(stored)}
    if mode == "aprs":
        res["packets"] = [x for k, x in evs if k == "aprs"]
    else:
        res["alerts"] = [x for k, x in evs if k == "same"]
        res["eom"] = sum(1 for k, _ in evs if k == "eom")
    out(res)


def decode_file(mode, path, decoder="builtin"):
    """Decodes a recording; returns the decoder's lines."""
    if decoder == "multimon":
        tmp = None
        if path.lower().endswith(".wav"):
            tmp = os.path.join(CACHE, f"decode-{os.getpid()}.raw")
            write_raw(tmp, read_audio(path))
            path = tmp
        try:
            text = run_cmd(multimon_argv(mode, path), 120)
        finally:
            if tmp:
                os.remove(tmp)
        return [ln for ln in text.splitlines() if ln.startswith(("APRS", "EAS"))]
    s = read_audio(path)
    d = make_decoder(mode)
    lines = []
    for k in range(0, len(s), 22050):
        lines += d.feed(s[k:k + 22050])
    return lines + d.flush()


def cmd_record(args):
    gain = opt(args, "--gain", 40, str)
    ppm = opt(args, "--ppm", 0, int)
    wait = opt(args, "--wait", 45.0, float)
    try:
        freq, seconds, path = float(args[0]), max(1.0, min(120.0, float(args[1]))), args[2]
    except (IndexError, ValueError):
        out({"ok": False, "error": "usage", "say": "digital.py record MHZ SECONDS FILE"})
    lock, err = acquire_v4(wait)
    if err:
        out(err)
    log = os.path.join(CACHE, "record.log")
    try:
        with open(path, "wb") as f, open(log, "w") as lf:
            p = subprocess.Popen(rtl_fm_argv(freq, gain, ppm), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=lf, start_new_session=True)
            end = time.time() + seconds
            n = 0
            try:
                while time.time() < end:
                    r, _, _ = select.select([p.stdout], [], [], 0.5)
                    if r:
                        chunk = os.read(p.stdout.fileno(), 65536)
                        if not chunk:
                            break
                        f.write(chunk)
                        n += len(chunk)
            finally:
                p.terminate()
                try:
                    p.wait(3)
                except Exception:
                    os.killpg(p.pid, signal.SIGKILL)
    finally:
        lock.release()
    reason = log_reason(log) if n == 0 else (None, None)
    out({"ok": n > 0, "file": os.path.abspath(path), "bytes": n, "seconds": round(n / 2 / RATE, 2), "freq": freq,
         "say": f"Recorded {n / 2 / RATE:.1f} s of {freq:g} MHz." if n else (reason[1] or "rtl_fm gave no audio.")})


def cmd_selftest_aprs(args):
    keep = opt(args, "--keep")
    d = keep or os.path.join(CACHE, "selftest")
    os.makedirs(d, exist_ok=True)
    pkts = [
        "KD8TST-9>APDR16,WIDE1-1,WIDE2-1:=3852.53N/08436.63W>090/035/A=000870 heading to Florence",
        "W8TST-10>APX219,K4TST-3*,WIDE2-1:!/:h%29*VQ>7PGcompressed beacon",
        "KY4WX>APRS,WIDE2-1:@061200z3904.20N/08430.60W_220/004g010t072r000p000P000h55b10132wRSW",
        "K4TST-3>APNU19,WIDE2-1:!3858.00NS08441.00W#PHG5360 W2 digi, Boone Co.",
        "N0TST-7>SY0R9S,WIDE1-1:`pD#oZI>/]\"6o}Mic-E test=",
        "KD8TST-9>APDR16,WIDE1-1:>On the way",
        "W8TST>APRS,WIDE1-1::KD8TST-9 :Hello from the selftest{01",
    ]
    audio = [0.0] * 4000
    for k, p in enumerate(pkts):
        audio += afsk_packet_audio(p, twist_db=[0, 6, -4, 3, 0, -6, 2][k]) + [0.0] * 6000
    noisy = add_noise(audio, 1800)
    raw = os.path.join(d, "aprs-selftest.raw")
    write_raw(raw, noisy)
    write_wav(os.path.join(d, "aprs-selftest.wav"), noisy)
    res = {"ok": True, "sent": pkts, "files": {"raw": raw, "wav": os.path.join(d, "aprs-selftest.wav")}}
    t0 = time.time()
    lines = decode_file("aprs", raw, "builtin")
    res["builtin"] = {"lines": lines, "decoded": sum(1 for p in pkts if "APRS: " + p in lines), "of": len(pkts),
                      "cpuSeconds": round(time.time() - t0, 2), "audioSeconds": round(len(noisy) / RATE, 1)}
    if pick_decoder("aprs", "multimon"):
        ml = decode_file("aprs", raw, "multimon")
        res["multimon"] = {"lines": ml, "decoded": sum(1 for p in pkts if any(p in x for x in ml)), "of": len(pkts)}
    else:
        res["multimon"] = None
    res["parsed"] = [parse_tnc2(ln[6:]) for ln in lines]
    for p in res["parsed"]:
        p.pop("info", None)
    res["ok"] = res["builtin"]["decoded"] == len(pkts)
    res["say"] = (f"Built-in AFSK1200 decoder: {res['builtin']['decoded']}/{len(pkts)} packets from noisy audio with ±6 dB twist."
                  + (f" multimon-ng: {res['multimon']['decoded']}/{len(pkts)}." if res["multimon"] else " (multimon-ng not installed.)"))
    out(res)


def cmd_selftest_same(args):
    keep = opt(args, "--keep")
    save = flag(args, "--save")
    want_svg = flag(args, "--svg")
    d = keep or os.path.join(CACHE, "selftest")
    os.makedirs(d, exist_ok=True)
    t = time.gmtime()
    home_state = (WX["local"] or ["00"])[0][:2]
    sample = list(WX["local"][:3]) + [c for c in WX["counties"] if c[:2] != home_state][:1]
    codes = "-".join("0" + c for c in sample) or "000000"
    header = f"ZCZC-WXR-RWT-{codes}+0030-{t.tm_yday:03d}{t.tm_hour:02d}{t.tm_min:02d}-{(WX['station'] or 'KXXX0').ljust(8)[:8]}-"
    audio = add_noise(same_audio(header, attention_s=2.0), 1500, seed=11)
    raw = os.path.join(d, "same-selftest.raw")
    wav = os.path.join(d, "same-selftest.wav")
    write_raw(raw, audio)
    write_wav(wav, audio)
    res = {"header": header, "files": {"raw": raw, "wav": wav}, "audioSeconds": round(len(audio) / RATE, 1)}
    t0 = time.time()
    lines = decode_file("same", raw, "builtin")
    res["builtin"] = {"lines": lines, "cpuSeconds": round(time.time() - t0, 2), "match": ("EAS: " + header) in lines,
                      "eom": "EAS: NNNN" in lines}
    mm = pick_decoder("same", "multimon")
    if mm:
        ml = decode_file("same", raw, "multimon")
        res["multimon"] = {"version": multimon_info()["version"], "lines": ml, "match": any(header.rstrip("-") in x for x in ml)}
    else:
        res["multimon"] = None
    evs = handle_lines("same", lines)
    alert = next((x for k, x in evs if k == "same"), None)
    res["alert"] = alert
    if alert and save:
        apply_events("same", [("same", alert)], "selftest")
    if alert:
        res["card"] = digital_render.same_card_text(alert)
        if want_svg:
            res["cardSvg"] = digital_render.same_card_svg(alert)
    res["ok"] = bool(res["builtin"]["match"] and (res["multimon"] is None or res["multimon"]["match"]))
    res["say"] = ("SAME pipeline OK: encoded " + header + " as 520.83 baud audio and decoded it back"
                  + (" with multimon-ng and the built-in decoder." if mm else " with the built-in decoder (multimon-ng is not installed).")
                  if res["ok"] else "SAME self-test failed: see builtin/multimon lines.")
    out(res)


def cmd_status():
    touch_heartbeat()
    d = device()
    o = owner_label(d.get("owner"))
    jobs = {}
    for k in JOB_KINDS:
        info = read_pid(k)
        jobs[k] = {"running": bool(info), "since": (info or {}).get("started"), "meta": (info or {}).get("meta"),
                   "lastExit": job_exit(k)}
    a, s = load_state("aprs"), load_state("same")
    mm = multimon_info()
    out({"ok": True, "device": {"present": d["present"], "name": d.get("name")}, "owner": o,
         "state": "missing" if not d["present"] else "free" if not o else "ours" if o.get("ours") else "busy",
         "tools": {"rtl_fm": RTL_FM if os.path.exists(RTL_FM) else None, "multimon": mm,
                   "decoder": {"aprs": pick_decoder("aprs"), "same": pick_decoder("same")}},
         "jobs": jobs,
         "aprs": {"stations": len(a["stations"]), "packets": a["packets"], "updated": a["updated"],
                  "lastPacket": (a["recent"][0] if a["recent"] else None)},
         "same": {"alerts": len(s["alerts"]), "latest": s["alerts"][0] if s["alerts"] else None, "updated": s["updated"]},
         "ref": REF, "now": now_ms()})


APRS_EMPTY = ("Nothing heard yet on 144.390 MHz. APRS stations beacon every few minutes to half an hour, and "
              "indoors the V4's small antenna reaches only the strongest. An outdoor 2 m antenna helps most; "
              "otherwise stand the dipole vertical at a window with the long elements pulled out to about 49 cm each.")


def aprs_tab_view(st, rest, limit=None):
    """Everything the tab's APRS section draws, in one call."""
    rows = aprs_view(st, limit or 40)
    res = {"ok": True, "updated": st["updated"], "packets": st["packets"], "stations": len(st["stations"]),
           "withPosition": sum(1 for r in rows if r.get("pos")),
           "nearest": min((r["distMi"] for r in rows if r.get("distMi") is not None), default=None),
           "farthest": max((r["distMi"] for r in rows if r.get("distMi") is not None), default=None),
           "lastPacket": st["recent"][0] if st["recent"] else None, "recent": st["recent"][:6],
           "job": read_pid("aprs"), "lastExit": job_exit("aprs"), "runs": st.get("runs", [])[:3],
           "empty": not st["stations"], "emptySay": APRS_EMPTY, "now": now_ms()}
    width = opt(rest, "--width", 34, int)
    if flag(rest, "--svg"):
        res["svg"] = digital_render.aprs_svg(st)
    if flag(rest, "--table"):
        res["table"] = digital_render.aprs_table(st, limit or 20, width=width)
    return res


def next_weekly_test(now_s=None):
    """The next Required Weekly Test from the location's weather-radio station (KIH42 for Walton): usually Wednesday late morning (local time)."""
    t = time.localtime(now_s or time.time())
    days = (2 - t.tm_wday) % 7
    if days == 0 and t.tm_hour >= 12:
        days = 7
    day = time.localtime(time.mktime((t.tm_year, t.tm_mon, t.tm_mday + days, 11, 0, 0, 0, 0, -1)))
    return {"at": int(time.mktime(day) * 1000), "day": time.strftime("%a %b %-d", day),
            "say": f"The weekly test (RWT) is usually Wednesday late morning: next {'today' if days == 0 else time.strftime('%a %b %-d', day)}."}


def same_tab_view(st, rest):
    """Everything the tab's Weather alerts section draws: active alerts first (cards), then history."""
    n = now_ms()
    svg = flag(rest, "--svg")
    alerts = [dict(a, active=bool(a.get("expires") and a["expires"] > n)) for a in st["alerts"][:30]]
    active = [a for a in alerts if a["active"]]
    for a in active[:3]:
        a["cardText"] = digital_render.same_card_text(a, n)
        if svg:
            a["cardSvg"] = digital_render.same_card_svg(a, n)
    hist = [{"id": a.get("id"), "eventName": a.get("eventName"), "severity": a.get("severity"), "received": a.get("received"),
             "expires": a.get("expires"), "active": a["active"], "areas": [t for t, _ in digital_render.area_names(a)][:4],
             "source": a.get("source"), "times": a.get("times", 1)} for a in alerts[:10]]
    return {"ok": True, "updated": st["updated"], "active": active[:3], "activeCount": len(active), "history": hist,
            "total": len(st["alerts"]), "eom": st["eom"][:3], "job": read_pid("same"), "lastExit": job_exit("same"),
            "runs": st.get("runs", [])[:3], "nextTest": next_weekly_test(), "now": n}


def cmd_aprs(args):
    sub = args[0] if args else "list"
    rest = args[1:]
    if sub == "run":
        cmd_run("aprs", rest)
    if sub == "live":
        cmd_live("aprs", rest)
    if sub == "stop":
        cmd_stop("aprs")
    if sub == "decode":
        cmd_decode("aprs", rest)
    if sub == "selftest":
        cmd_selftest_aprs(rest)
    if sub == "parse":
        p = parse_tnc2(" ".join(rest)) if rest else None
        if p:
            p.pop("info", None)
        out({"ok": bool(p), "packet": p})
    if sub == "clear":
        with state_lock():
            save_state("aprs", empty_aprs())
        out({"ok": True, "say": "Forgot all APRS stations."})
    limit = opt(rest, "--limit", None, int)
    touch_heartbeat()
    st = load_state("aprs")
    if sub == "list":
        out({"ok": True, "ref": st["ref"], "updated": st["updated"], "packets": st["packets"],
             "stations": aprs_view(st, limit), "messages": st["messages"][:20], "recent": st["recent"][:20],
             "job": read_pid("aprs"), "lastExit": job_exit("aprs")})
    if sub == "table":
        print(digital_render.aprs_table(st, limit or 40, width=opt(rest, "--width", None, int)))
        sys.exit(0)
    if sub == "view":
        out(aprs_tab_view(st, rest, limit))
    if sub == "svg":
        svg = digital_render.aprs_svg(st, radius=opt(rest, "--radius", None, float))
        path = opt(rest, "--out")
        if path:
            with open(path, "w") as f:
                f.write(svg)
            out({"ok": True, "file": os.path.abspath(path), "bytes": len(svg.encode())})
        sys.stdout.write(svg)
        sys.exit(0)
    out({"ok": False, "error": "usage", "say": "aprs run|live|stop|list|table|view|svg|decode|parse|selftest|clear"})


def cmd_same(args):
    sub = args[0] if args else "list"
    rest = args[1:]
    if sub == "run":
        cmd_run("same", rest)
    if sub == "live":
        cmd_live("same", rest)
    if sub == "stop":
        cmd_stop("same")
    if sub == "decode":
        cmd_decode("same", rest)
    if sub == "selftest":
        cmd_selftest_same(rest)
    if sub == "parse":
        a = parse_same(" ".join(rest)) if rest else None
        out({"ok": bool(a), "alert": a})
    if sub == "clear":
        with state_lock():
            save_state("same", empty_same())
        out({"ok": True, "say": "Cleared the alert history."})
    touch_heartbeat()
    st = load_state("same")
    if sub == "list":
        limit = opt(rest, "--limit", 50, int)
        n = now_ms()
        alerts = [dict(a, active=bool(a.get("expires") and a["expires"] > n)) for a in st["alerts"][:limit]]
        out({"ok": True, "updated": st["updated"], "alerts": alerts, "eom": st["eom"][:5], "job": read_pid("same"),
             "lastExit": job_exit("same")})
    if sub == "view":
        out(same_tab_view(st, rest))
    if sub == "card":
        aid, raw, path, text = opt(rest, "--id"), opt(rest, "--raw"), opt(rest, "--out"), flag(rest, "--text")
        alert = parse_same(raw) if raw else next((a for a in st["alerts"] if not aid or a.get("id") == aid), None)
        if not alert:
            out({"ok": False, "error": "none", "say": "No alert to show (none heard yet)."})
        body = digital_render.same_card_text(alert) if text else digital_render.same_card_svg(alert)
        if path:
            with open(path, "w") as f:
                f.write(body)
            out({"ok": True, "file": os.path.abspath(path), "bytes": len(body.encode())})
        sys.stdout.write(body + ("\n" if text else ""))
        sys.exit(0)
    out({"ok": False, "error": "usage", "say": "same run|live|stop|list|view|card|decode|parse|selftest|clear"})


def main():
    os.makedirs(STATE, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    args = sys.argv[1:] or ["status"]
    verb = args[0]
    if verb in ("-h", "--help", "help"):
        print(__doc__)
        return
    if verb == "status":
        cmd_status()
    if verb == "aprs":
        cmd_aprs(args[1:])
    if verb == "same":
        cmd_same(args[1:])
    if verb == "record":
        cmd_record(args[1:])
    out({"ok": False, "error": f"unknown command {verb}", "say": "digital.py status | aprs ... | same ... | record ... (see --help)"})


if __name__ == "__main__":
    main()

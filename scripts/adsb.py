#!/usr/bin/env python3
"""ADS-B plane radar for the Radio tab: rtl_adsb on the RTL-SDR Blog V4, decoded here.

Standard library only, receive only. Usable as a CLI and as a module.

  adsb.py run [seconds] [--gain G] [--wait S] [--raw FILE]
                     runs rtl_adsb for N seconds (default 20, max 600) under the
                     shared radio lock, decodes, writes the state file and prints
                     a JSON summary. If `live` is already running it just reports
                     the live table instead of waiting for the V4.
  adsb.py decode <file> [--save] [--table] [--svg OUT] [--range NM]
                     decodes a capture offline (rtl_adsb / dump1090 --raw lines
                     "*8D...;" with an optional leading unix timestamp, or Beast
                     AVR "@<12 hex time><frame>;") and prints the state JSON;
                     --save also writes it to the state file
  adsb.py state      the current table as JSON (with the live job's status)
  adsb.py svg [--range NM|auto] [--out FILE] [--input FILE]
                     the radar picture as SVG (stdout unless --out)
  adsb.py table [--input FILE] [--width N]
                     a compact monospace table for the terminal or the phone
  adsb.py live [--gain G] [--keep] [--no-lock]
                     long-running decoder (the tab starts/stops it as a job):
                     pidfile adsb.pid, state flushed every ~2 s, clean stop on
                     SIGTERM/SIGINT/SIGHUP. Honours the radio lease (stops after
                     20 min with nobody watching) unless --keep.
  adsb.py start [--gain G] [--keep] | adsb.py stop
                     the "adsb" job (Planes) through radio.py's job manager:
                     `radio.py job start adsb` stops whatever holds the V4 (and
                     says why), `radio.py job stop adsb` (JSON out). --no-lock on
                     `live`: the caller already holds sdr.lock and has checked
                     that the V4 is free
  adsb.py view [--range NM|auto] [--width N] [--svg] [--table]
                     one JSON object for the tab: counts, the job, the antenna
                     tip, and the radar SVG and/or the text table
  adsb.py selftest   CRC, CPR, velocity, identity and altitude reference vectors
  adsb.py help       this text plus the antenna note

Files (local disk, never iCloud-synced folders):
  ~/Library/Application Support/radio/adsb.json   the state (schema: STATE_DOC below)
  ~/Library/Application Support/radio/adsb.pid    the job (radio.py's wrapper writes it; `live`
                                                  writes the same shape: pid, kind, started,
                                                  meta, children)
  ~/Library/Application Support/radio/adsb.log    rtl_adsb's stderr for the live job
  ~/Library/Caches/radio/sdr.lock                 the shared V4 lock (fcntl.flock, exclusive),
                                                  the same file and semantics as radio.py
RADIO_DIR moves the state directory (for tests), as in radio.py.

Antenna: ADS-B is vertically polarised at 1090 MHz. With the V4 kit's dipole, use the
SHORT telescopic elements pulled out to about 6.9 cm each (a quarter wave), stand the
dipole vertical, and put it as high as you can with a clear view of the sky, ideally at
a window. Gain 40-49.6 dB; 49.6 (the default) gave about twice the frames of 40.2 here.

Decoding follows "The 1090 MHz Riddle" (Junzi Sun, 2nd ed., mode-s.org/decode): DF17
and DF18 extended squitter (CRC-24, identification and category, airborne position by
CPR global and local decode, barometric altitude in 25 ft steps and Gillham/Mode C
100 ft steps, airborne velocity sub-types 1-4, surface position and movement, aircraft
status with squawk and emergency), plus DF16/20/21 altitude and squawk for aircraft
already known (their parity is overlaid with the address).
"""
import json
import math
import os
import re
import signal
import subprocess
import sys
import time

sys.dont_write_bytecode = True  # adsb_render is imported from here; no __pycache__ in the mod
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import location  # noqa: E402  (where the receiver is: Walton, KY unless location.json says otherwise)

HOME = os.path.expanduser("~")
STATE_DIR = os.environ.get("RADIO_DIR") or os.path.join(HOME, "Library", "Application Support", "radio")
CACHE = os.path.join(HOME, "Library", "Caches", "radio")
LOCK_FILE = os.path.join(CACHE, "sdr.lock")
STATE_FILE = os.path.join(STATE_DIR, "adsb.json")
PID_FILE = os.path.join(STATE_DIR, "adsb.pid")
LOG_FILE = os.path.join(STATE_DIR, "adsb.log")
HEARTBEAT = os.path.join(STATE_DIR, "heartbeat")
SCRIPT = os.path.abspath(__file__)
RTL_ADSB = "/opt/homebrew/bin/rtl_adsb"

DEFAULT_GAIN = 49.6
FLUSH_S = 2.0
EXPIRE_S = 300          # live mode drops an aircraft after 5 min of silence
TRAIL_MAX = 40          # positions kept per aircraft
TRAIL_SPAN_S = 600      # ...and no older than this
MAX_RANGE_NM = 250.0    # a decoded position farther than this from the receiver is rejected
PAIR_WINDOW_S = 10.0    # even/odd CPR frames this close in time make a global decode
LOCAL_REF_MAX_S = 600   # an aircraft's own last fix is a local-decode reference this long
LEASE_S = int(os.environ.get("RADIO_LEASE_S") or 20 * 60)

# The receiver reference is a town centre (not anyone's address): Walton's by default, or the one in
# ~/Library/Application Support/radio/location.json. The location's airports are marked.
LOC = location.load_once()
RECEIVER = dict(LOC["receiver"])
AIRPORTS = LOC["airports"]

STATE_DOC = """
State JSON (adsb.json and `adsb.py state`; times are unix ms, distances nm, speeds kt):
{
  "version": 1, "kind": "adsb",
  "updated": ms,                      # when this table was written
  "now": ms,                          # (state command only) when it was read
  "receiver": {"id","name","lat","lon"},
  "airports": [{"id","name","lat","lon","elevFt","distNm","bearing","runways":[...]}],
  "source": {"mode": "run|live|decode", "gain": dB|null, "started": ms, "seconds": s,
             "file": path|null, "device": "Blog V4"|null},
  "stats": {"frames", "crcOk", "fixed" (1-bit CRC repairs), "crcBad", "apMatched" (DF16/20/21
            matched to a known address), "df": {"17": n, ...}, "positionsRejected",
            "aircraft", "withPosition", "maxRangeNm", "msgPerSec"},
  "job": {"running": bool, "pid": int|null, "since": ms|null,
          "lastExit": {"at","reason","detail"}|null},       # live job, when known
  "aircraft": [{
      "icao": "A1B2C3",               # "~" prefix = non-ICAO (TIS-B / anonymous) address
      "reg": "N123AB"|null,           # US N-number derived from the ICAO address
      "callsign": "AAL1234"|null, "category": "A3"|null, "categoryLabel": "Large"|null,
      "squawk": "1200"|null, "emergency": "none|general|lifeguard|minfuel|nordo|unlawful|downed"|null,
      "alt": ft|null (barometric), "altGnss": ft|null, "onGround": bool|null,
      "lat": deg|null, "lon": deg|null, "posAt": ms|null,
      "posSource": "global|local|local-rx|surface"|null,
      "distNm": nm|null, "bearing": deg|null,          # from the receiver
      "gs": kt|null, "track": deg|null, "vr": ft/min|null, "vrSource": "baro|gnss"|null,
      "heading": deg|null, "ias": kt|null, "tas": kt|null,   # velocity sub-types 3/4
      "trail": [[lat, lon, alt|null, ms], ...],         # oldest first, <= 40 points
      "firstSeen": ms, "lastSeen": ms, "msgs": n, "rssi": null,  # rtl_adsb gives no level
      "via": ["adsb","tisb","adsr","modes"]             # how it was heard
  }, ...]                             # sorted: with position by distance, then the rest
}
"""

HELP = __doc__ + STATE_DOC


# ---------------------------------------------------------------- small helpers

def now_ms():
    return int(time.time() * 1000)


def out(obj, code=0):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    sys.exit(code)


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    os.replace(tmp, path)


def touch_heartbeat():
    """The radio tab's 'somebody is watching' file (radio.py's lease uses it too)."""
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(HEARTBEAT, "a"):
            pass
        os.utime(HEARTBEAT, None)
    except OSError:
        pass


def arg_value(args, flag, default=None, cast=str):
    """Pops `flag value` from args; returns the cast value or default."""
    if flag in args:
        k = args.index(flag)
        try:
            v = cast(args[k + 1])
        except (IndexError, ValueError):
            v = default
        del args[k:k + 2]
        return v
    return default


def arg_flag(args, flag):
    if flag in args:
        args.remove(flag)
        return True
    return False


# ---------------------------------------------------------------- geometry

EARTH_NM = 3440.065


def dist_nm(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_NM * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


# ---------------------------------------------------------------- CRC-24 (Mode S parity)

# Generator polynomial G(x) = x^24 + x^23 + ... (0x1FFF409), as in the 1090 MHz Riddle, "CRC".
CRC_POLY = 0xFFF409
CRC_TABLE = []
for _b in range(256):
    _c = _b << 16
    for _ in range(8):
        _c = ((_c << 1) ^ CRC_POLY) if _c & 0x800000 else (_c << 1)
    CRC_TABLE.append(_c & 0xFFFFFF)


def crc24(data):
    """The 24-bit Mode S CRC of a byte string (no init, no reflection)."""
    crc = 0
    for b in data:
        crc = ((crc << 8) & 0xFFFFFF) ^ CRC_TABLE[((crc >> 16) ^ b) & 0xFF]
    return crc


def remainder(msg):
    """CRC of the data bits XOR the transmitted parity: 0 for a clean DF17/18,
    the ICAO address for address/parity replies (DF0/4/5/16/20/21)."""
    return crc24(msg[:-3]) ^ int.from_bytes(msg[-3:], "big")


_SYNDROMES = {}


def syndromes(nbytes):
    """remainder -> bit index for every single-bit error in an n-byte frame."""
    if nbytes not in _SYNDROMES:
        table = {}
        zero = bytes(nbytes)
        for i in range(nbytes * 8):
            m = bytearray(zero)
            m[i // 8] ^= 0x80 >> (i % 8)
            table[remainder(bytes(m))] = i
        _SYNDROMES[nbytes] = table
    return _SYNDROMES[nbytes]


# ---------------------------------------------------------------- field decoders

CHARSET = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ##### ###############0123456789######"

CATEGORIES = {
    "A": ["", "Light", "Small", "Large", "High vortex large", "Heavy", "High performance", "Rotorcraft"],
    "B": ["", "Glider", "Lighter-than-air", "Parachutist", "Ultralight", "", "UAV", "Space vehicle"],
    "C": ["", "Emergency vehicle", "Service vehicle", "Point obstacle", "Cluster obstacle", "Line obstacle", "", ""],
    "D": ["", "", "", "", "", "", "", ""],
}
EMERGENCY = ["none", "general", "lifeguard", "minfuel", "nordo", "unlawful", "downed", "reserved"]


def callsign_from(bits48):
    s = "".join(CHARSET[(bits48 >> (42 - 6 * i)) & 0x3F] for i in range(8))
    return s.replace("#", "").strip() or None, "#" in s


def ac13_to_modea(code):
    """13-bit AC/ID field (C1 A1 C2 A2 C4 A4 M/X B1 Q/D1 B2 D2 B4 D4) -> the 0xABCD
    octal-digit layout used for squawks and Gillham decoding."""
    m = 0
    for bit, mask in ((12, 0x0010), (11, 0x1000), (10, 0x0020), (9, 0x2000), (8, 0x0040), (7, 0x4000),
                      (5, 0x0100), (4, 0x0001), (3, 0x0200), (2, 0x0002), (1, 0x0400), (0, 0x0004)):
        if code & (1 << bit):
            m |= mask
    return m


def squawk_from(code13):
    return f"{ac13_to_modea(code13):04x}"


def gillham_to_alt(modea):
    """Mode C (Gillham gray code) -> altitude in feet, or None. The usual decode, as in dump1090's
    ModeAToModeC: 500 ft steps from D2 D4 A1 A2 A4 B1 B2 B4, 100 ft steps from C1 C2 C4."""
    if (modea & 0xFFFF8889) or not (modea & 0x0070):
        return None
    ones = 0
    if modea & 0x0010:
        ones ^= 7
    if modea & 0x0020:
        ones ^= 3
    if modea & 0x0040:
        ones ^= 1
    if (ones & 5) == 5:
        ones ^= 2
    if ones > 5:
        return None
    fives = 0
    for mask, x in ((0x0002, 0xFF), (0x0004, 0x7F), (0x1000, 0x3F), (0x2000, 0x1F), (0x4000, 0x0F),
                    (0x0100, 0x07), (0x0200, 0x03), (0x0400, 0x01)):
        if modea & mask:
            fives ^= x
    if fives & 1:
        ones = 6 - ones
    return (fives * 5 + ones - 13) * 100


def ac13_to_alt(code):
    """13-bit altitude code (DF0/4/16/20) -> feet. Q=1: 25 ft steps; Q=0: Gillham 100 ft; M=1 (metric): None."""
    if not code:
        return None
    if code & 0x40:  # M bit
        return None
    if code & 0x10:  # Q bit
        n = ((code & 0x1F80) >> 2) | ((code & 0x20) >> 1) | (code & 0x0F)
        return n * 25 - 1000
    return gillham_to_alt(ac13_to_modea(code))


def ac12_to_alt(ac12):
    """12-bit altitude in airborne position messages: the 13-bit code without the M bit."""
    if not ac12:
        return None
    return ac13_to_alt(((ac12 & 0xFC0) << 1) | (ac12 & 0x3F))


SURFACE_SPEED = ((1, 0, 0.0), (2, 0.125, 0.125), (9, 1.0, 0.25), (13, 2.0, 0.5), (39, 15.0, 1.0),
                 (94, 70.0, 2.0), (109, 100.0, 5.0))


def surface_speed(mov):
    if mov == 0 or mov > 124:
        return None
    if mov == 124:
        return 175.0
    for lo, base, step in reversed(SURFACE_SPEED):
        if mov >= lo:
            return base + (mov - lo) * step
    return None


# US civil register: ICAO A00001-ADF7C7 map one-to-one onto N-numbers.
_NCHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"  # no I or O
_SUFFIX = 1 + len(_NCHARS) * (1 + len(_NCHARS))  # 601
_B4 = 1 + len(_NCHARS) + 10                       # 35
_B3 = 10 * _B4 + _SUFFIX                           # 951
_B2 = 10 * _B3 + _SUFFIX                           # 10111
_B1 = 10 * _B2 + _SUFFIX                           # 101711


def _suffix(off):
    if off == 0:
        return ""
    first = _NCHARS[(off - 1) // (len(_NCHARS) + 1)]
    rest = (off - 1) % (len(_NCHARS) + 1)
    return first + (_NCHARS[rest - 1] if rest else "")


def n_number(icao):
    """The US registration for a US ICAO address, else None."""
    try:
        off = int(icao, 16) - 0xA00001
    except (TypeError, ValueError):
        return None
    if off < 0 or off >= 915399:
        return None
    out_ = "N" + str(off // _B1 + 1)
    off %= _B1
    for size in (_B2, _B3, _B4):
        if off < _SUFFIX:
            return out_ + _suffix(off)
        off -= _SUFFIX
        out_ += str(off // size)
        off %= size
    if off == 0:
        return out_
    return out_ + (_NCHARS[off - 1] if off <= len(_NCHARS) else str(off - 1 - len(_NCHARS)))


# ---------------------------------------------------------------- CPR

NZ = 15


def cpr_nl(lat):
    """Number of longitude zones at a latitude (the 1090 MHz Riddle, "CPR")."""
    lat = abs(lat)
    if lat < 1e-9:
        return 59
    if abs(lat - 87) < 1e-9:
        return 2
    if lat > 87:
        return 1
    a = 1 - math.cos(math.pi / (2 * NZ))
    b = math.cos(math.pi / 180 * lat) ** 2
    return int(math.floor(2 * math.pi / math.acos(1 - a / b)))


def cpr_global(even, odd, newest_odd):
    """Airborne global decode from an even and an odd (lat17, lon17) pair, using the newest
    frame's zone (the 1090 MHz Riddle, "Globally unambiguous position"). -> (lat, lon) or None."""
    lat_e_cpr, lon_e_cpr = even[0] / 131072.0, even[1] / 131072.0
    lat_o_cpr, lon_o_cpr = odd[0] / 131072.0, odd[1] / 131072.0
    d_e, d_o = 360.0 / 60, 360.0 / 59
    j = math.floor(59 * lat_e_cpr - 60 * lat_o_cpr + 0.5)
    lat_e = d_e * (j % 60 + lat_e_cpr)
    lat_o = d_o * (j % 59 + lat_o_cpr)
    if lat_e >= 270:
        lat_e -= 360
    if lat_o >= 270:
        lat_o -= 360
    if not (-90 <= lat_e <= 90 and -90 <= lat_o <= 90):
        return None
    if cpr_nl(lat_e) != cpr_nl(lat_o):
        return None  # the pair straddles a zone boundary; wait for the next one
    if newest_odd:
        lat, nl, lon_cpr, i = lat_o, cpr_nl(lat_o), lon_o_cpr, 1
    else:
        lat, nl, lon_cpr, i = lat_e, cpr_nl(lat_e), lon_e_cpr, 0
    ni = max(nl - i, 1)
    m = math.floor(lon_e_cpr * (nl - 1) - lon_o_cpr * nl + 0.5)
    lon = (360.0 / ni) * (m % ni + lon_cpr)
    if lon >= 180:
        lon -= 360
    return lat, lon


def cpr_local(ref_lat, ref_lon, lat17, lon17, odd, surface=False):
    """Local decode of one frame against a reference within half a zone (180 nm airborne, 45 nm surface)."""
    span = 90.0 if surface else 360.0
    i = 1 if odd else 0
    lat_cpr, lon_cpr = lat17 / 131072.0, lon17 / 131072.0
    d_lat = span / (60 - i)
    j = math.floor(ref_lat / d_lat) + math.floor((ref_lat % d_lat) / d_lat - lat_cpr + 0.5)
    lat = d_lat * (j + lat_cpr)
    d_lon = span / max(cpr_nl(lat) - i, 1)
    m = math.floor(ref_lon / d_lon) + math.floor((ref_lon % d_lon) / d_lon - lon_cpr + 0.5)
    lon = d_lon * (m + lon_cpr)
    return lat, lon


# ---------------------------------------------------------------- frame parsing

FRAME_RE = re.compile(r"[*@]([0-9A-Fa-f]{14,40});")


def parse_line(line):
    """-> (timestamp or None, bytes) for one capture line, or None.
    Accepts '*HEX;' (rtl_adsb, dump1090 --raw), '<unix ts> *HEX;' (our captures) and
    Beast AVR '@<12 hex clock><HEX>;'."""
    m = FRAME_RE.search(line)
    if not m:
        return None
    hexs = m.group(1)
    if line[m.start()] == "@":
        hexs = hexs[12:]
    if len(hexs) not in (14, 28):
        return None
    ts = None
    head = line[:m.start()].strip()
    if head:
        try:
            ts = float(head.split()[0])
        except ValueError:
            ts = None
    return ts, bytes.fromhex(hexs)


def decode_me(me, df, out_):
    """Decodes a 56-bit extended-squitter ME field into out_ (a dict)."""
    tc = me >> 51
    out_["tc"] = tc

    def mb(start, n):  # ME bits, 1-indexed from the left as in the Riddle
        return (me >> (56 - start - n + 1)) & ((1 << n) - 1)

    if 1 <= tc <= 4:
        ca = mb(6, 3)
        cs, bad = callsign_from(me & ((1 << 48) - 1))
        if cs and not bad:
            out_["callsign"] = cs
        cat_set = "ABCD"[4 - tc]
        out_["category"] = f"{cat_set}{ca}" if ca else None
        out_["categoryLabel"] = CATEGORIES[cat_set][ca] or None
    elif 5 <= tc <= 8:
        out_["surface"] = True
        out_["gs"] = surface_speed(mb(6, 7))
        if mb(13, 1):
            out_["track"] = round(mb(14, 7) * 360 / 128, 1)
        out_["odd"] = bool(mb(22, 1))
        out_["cpr"] = (mb(23, 17), mb(40, 17))
    elif 9 <= tc <= 18 or 20 <= tc <= 22:
        alt = mb(9, 12)
        if tc >= 20:
            out_["altGnss"] = round(alt * 3.28084) if alt else None  # GNSS height, metres
        else:
            out_["alt"] = ac12_to_alt(alt)
        out_["odd"] = bool(mb(22, 1))
        out_["cpr"] = (mb(23, 17), mb(40, 17))
    elif tc == 19:
        st = mb(6, 3)
        vr_raw = mb(38, 9)
        if vr_raw:
            out_["vr"] = (vr_raw - 1) * 64 * (-1 if mb(37, 1) else 1)
            out_["vrSource"] = "baro" if mb(36, 1) else "gnss"
        d_alt = mb(50, 7)
        if d_alt:
            out_["gnssDelta"] = (d_alt - 1) * 25 * (-1 if mb(49, 1) else 1)
        if st in (1, 2):
            vew, vns = mb(15, 10), mb(26, 10)
            if vew and vns:
                k = 4 if st == 2 else 1
                vx = (vew - 1) * k * (-1 if mb(14, 1) else 1)
                vy = (vns - 1) * k * (-1 if mb(25, 1) else 1)
                out_["gs"] = round(math.hypot(vx, vy), 1)
                out_["track"] = round((math.degrees(math.atan2(vx, vy)) + 360) % 360, 2)
        elif st in (3, 4):
            if mb(14, 1):
                out_["heading"] = round(mb(15, 10) * 360 / 1024, 2)
            asp = mb(26, 10)
            if asp:
                v = (asp - 1) * (4 if st == 4 else 1)
                out_["tas" if mb(25, 1) else "ias"] = v
    elif tc == 28:
        if mb(6, 3) == 1:
            em = mb(9, 3)
            out_["emergency"] = EMERGENCY[em]
            code = mb(12, 13)
            if code:
                out_["squawk"] = squawk_from(code)
    return out_


def decode_frame(msg, known=None):
    """Decodes one Mode S frame (bytes). `known` is a set/dict of recently seen ICAO
    addresses (hex) used to accept address/parity replies and single-bit fixes.
    Returns a dict with at least {"ok": bool, "df": int}; "icao" when attributable."""
    n = len(msg)
    df = msg[0] >> 3
    if df >= 24:
        df = 24
    res = {"ok": False, "df": df}
    if n == 14 and df in (17, 18):
        rem = remainder(msg)
        if rem:
            bit = syndromes(14).get(rem)
            if bit is None or bit < 5:  # never "fix" the DF field itself
                res["why"] = "crc"
                return res
            fixed = bytearray(msg)
            fixed[bit // 8] ^= 0x80 >> (bit % 8)
            icao = fixed[1:4].hex().upper()
            if not known or icao not in known:
                res["why"] = "crc"
                return res
            msg = bytes(fixed)
            res["fixed"] = True
        icao = msg[1:4].hex().upper()
        cf = msg[0] & 7
        res["ca" if df == 17 else "cf"] = cf
        if df == 18:
            # CF 0/1: ADS-B from non-transponder devices; 2/3: TIS-B; 5: TIS-B anonymous; 6: ADS-R.
            if cf in (3, 4, 7):
                res["why"] = "df18cf"
                return res
            res["via"] = {0: "adsb", 1: "adsb", 2: "tisb", 5: "tisb", 6: "adsr"}[cf]
            if cf in (1, 5):  # not an ICAO address (anonymous / track-file number)
                icao = "~" + icao
        else:
            res["via"] = "adsb"
        res["icao"] = icao
        res["ok"] = True
        me = int.from_bytes(msg[4:11], "big")
        decode_me(me, df, res)
        return res
    if n == 7 and df == 11:
        rem = remainder(msg)
        if rem & 0xFFFF80:
            res["why"] = "crc"
            return res
        res.update(ok=True, icao=msg[1:4].hex().upper(), via="modes")
        return res
    if df in (0, 4, 5, 16, 20, 21) and n == (14 if df >= 16 else 7):
        addr = f"{remainder(msg):06X}"
        if not known or addr not in known:
            res["why"] = "ap"
            return res
        res.update(ok=True, icao=addr, ap=True, via="modes")
        code = ((msg[2] & 0x1F) << 8) | msg[3]  # bits 20-32
        if df in (0, 4, 16, 20):
            alt = ac13_to_alt(code)
            if alt is not None:
                res["alt"] = alt
        else:
            res["squawk"] = squawk_from(code)
        if df in (4, 5, 20, 21):
            fs = msg[0] & 7
            if fs in (1, 3):
                res["onGround"] = True
            elif fs == 0:
                res["onGround"] = False
        if df in (20, 21) and msg[4] == 0x20:  # Comm-B BDS 2,0: aircraft identification
            cs, bad = callsign_from(int.from_bytes(msg[5:11], "big"))
            if cs and not bad and len(cs) >= 3:
                res["callsign"] = cs
        return res
    res["why"] = "df"
    return res


# ---------------------------------------------------------------- the aircraft table

class Tracker:
    """Per-aircraft state fed by decoded frames."""

    def __init__(self, receiver=RECEIVER, mode="decode"):
        self.rx = receiver
        self.ac = {}
        self.stats = {"frames": 0, "crcOk": 0, "fixed": 0, "crcBad": 0, "apMatched": 0, "df": {},
                      "positionsRejected": 0}
        self.first_t = None
        self.last_t = None
        self.mode = mode

    # -- helpers
    def known(self, t):
        return {k for k, a in self.ac.items() if t - a["_last"] < 60 and a.get("_adsb")}

    def _new(self, icao, t):
        a = {"icao": icao, "reg": n_number(icao), "callsign": None, "category": None, "categoryLabel": None,
             "squawk": None, "emergency": None, "alt": None, "altGnss": None, "onGround": None,
             "lat": None, "lon": None, "posAt": None, "posSource": None, "distNm": None, "bearing": None,
             "gs": None, "track": None, "vr": None, "vrSource": None, "heading": None, "ias": None, "tas": None,
             "trail": [], "firstSeen": int(t * 1000), "lastSeen": int(t * 1000), "msgs": 0, "rssi": None,
             "via": [], "_last": t, "_cpr": {}, "_adsb": False, "_rej": 0}
        self.ac[icao] = a
        return a

    def feed(self, msg, t):
        """One frame (bytes) at time t (seconds). Returns the decoded dict."""
        self.stats["frames"] += 1
        self.first_t = t if self.first_t is None else self.first_t
        self.last_t = t
        d = decode_frame(msg, self.known(t))
        df = str(d["df"])
        if not d["ok"]:
            self.stats["crcBad"] += 1
            return d
        self.stats["crcOk"] += 1
        self.stats["df"][df] = self.stats["df"].get(df, 0) + 1
        if d.get("fixed"):
            self.stats["fixed"] += 1
        if d.get("ap"):
            self.stats["apMatched"] += 1
        icao = d["icao"]
        a = self.ac.get(icao) or self._new(icao, t)
        a["msgs"] += 1
        a["_last"] = t
        a["lastSeen"] = int(t * 1000)
        if d["df"] in (17, 18) and not d.get("fixed"):
            a["_adsb"] = True
        if d.get("via") and d["via"] not in a["via"]:
            a["via"].append(d["via"])
        for k in ("callsign", "category", "categoryLabel", "squawk", "emergency", "alt", "altGnss", "vr",
                  "vrSource", "heading", "ias", "tas"):
            if d.get(k) is not None:
                a[k] = d[k]
        if d.get("gs") is not None:
            a["gs"] = d["gs"]
        if d.get("track") is not None:
            a["track"] = d["track"]
        if d.get("onGround") is not None:
            a["onGround"] = d["onGround"]
        if d.get("ca") == 4:
            a["onGround"] = True
        elif d.get("ca") == 5:
            a["onGround"] = False
        if "cpr" in d:
            self._position(a, d, t)
        return d

    def _position(self, a, d, t):
        surface = bool(d.get("surface"))
        if surface:
            a["onGround"] = True
            a["alt"] = None
        elif d.get("tc") and 9 <= d["tc"] <= 22:
            a["onGround"] = False
        kind = ("s" if surface else "a")
        a["_cpr"][(kind, d["odd"])] = (d["cpr"], t)
        other = a["_cpr"].get((kind, not d["odd"]))
        pos, src = None, None
        rx = (self.rx["lat"], self.rx["lon"])
        # 1) Global decode whenever a fresh even/odd airborne pair exists (the reference result).
        if not surface and other and abs(t - other[1]) <= PAIR_WINDOW_S:
            even, odd = (other[0], d["cpr"]) if d["odd"] else (d["cpr"], other[0])
            pos = cpr_global(even, odd, newest_odd=d["odd"])
            src = "global"
        # 2) Otherwise local decode against the aircraft's own recent fix.
        if pos is None and a["lat"] is not None and a["posAt"] and t - a["posAt"] / 1000 < LOCAL_REF_MAX_S:
            pos = cpr_local(a["lat"], a["lon"], d["cpr"][0], d["cpr"][1], d["odd"], surface)
            src = "surface" if surface else "local"
        # 3) Surface frames (90-degree zones always need a reference), and a first airborne
        #    frame, against the receiver: unambiguous within 45 / 180 nm. A later global pair
        #    confirms or replaces a receiver-relative airborne fix.
        if pos is None and (surface or a["lat"] is None):
            pos = cpr_local(rx[0], rx[1], d["cpr"][0], d["cpr"][1], d["odd"], surface)
            src = "surface" if surface else "local-rx"
            if not surface:
                # Hold it until a second frame agrees, so one bad frame never draws a plane.
                prev = a.get("_rxcand")
                a["_rxcand"] = (pos, t)
                if not prev or t - prev[1] > 30 or dist_nm(prev[0][0], prev[0][1], pos[0], pos[1]) > 5:
                    return
        if not pos:
            return
        lat, lon = pos
        dist = dist_nm(rx[0], rx[1], lat, lon)
        if dist > MAX_RANGE_NM:
            self.stats["positionsRejected"] += 1
            return
        if a["lat"] is not None and a["posAt"] and not (src == "global" and a["posSource"] == "local-rx"):
            dt = max(0.5, t - a["posAt"] / 1000)
            vmax = max(600.0, (a["gs"] or 0) * 1.5 + 150) if not surface else 120.0
            moved = dist_nm(a["lat"], a["lon"], lat, lon)
            if moved > vmax * dt / 3600 + 1.0:
                self.stats["positionsRejected"] += 1
                a["_rej"] += 1
                if a["_rej"] >= 3 and src == "global":
                    a["_rej"] = 0  # the old fix was the bad one: start over from this pair
                else:
                    return
            else:
                a["_rej"] = 0
        a["lat"], a["lon"] = round(lat, 5), round(lon, 5)
        a["posAt"] = int(t * 1000)
        # A chain of local decodes that started from the receiver stays "local-rx" until a
        # global pair confirms it.
        a["posSource"] = "local-rx" if (src == "local" and a["posSource"] == "local-rx") else src
        a["distNm"] = round(dist, 2)
        a["bearing"] = round(bearing_deg(rx[0], rx[1], lat, lon), 1)
        alt = a["alt"] if a["alt"] is not None else a["altGnss"]
        tr = a["trail"]
        if not tr or t - tr[-1][3] / 1000 >= 4 or dist_nm(tr[-1][0], tr[-1][1], lat, lon) >= 0.5:
            tr.append([a["lat"], a["lon"], alt, int(t * 1000)])
            cutoff = (t - TRAIL_SPAN_S) * 1000
            while tr and (len(tr) > TRAIL_MAX or tr[0][3] < cutoff):
                tr.pop(0)

    def expire(self, t, after=EXPIRE_S):
        for k in [k for k, a in self.ac.items() if t - a["_last"] > after]:
            del self.ac[k]

    def snapshot(self, source, t=None):
        """The public state dict (STATE_DOC)."""
        t = t if t is not None else (self.last_t or time.time())
        acs = []
        for a in self.ac.values():
            # Mode S-only entries that never got anything useful stay out of the table.
            if not a["_adsb"] and a["alt"] is None and a["squawk"] is None and not a["callsign"]:
                continue
            acs.append({k: v for k, v in a.items() if not k.startswith("_")})
        acs.sort(key=lambda a: (a["distNm"] is None, a["distNm"] if a["distNm"] is not None else 0, -a["lastSeen"]))
        span = (self.last_t - self.first_t) if self.first_t is not None and self.last_t else 0
        with_pos = [a for a in acs if a["lat"] is not None]
        stats = dict(self.stats)
        stats.update(aircraft=len(acs), withPosition=len(with_pos),
                     maxRangeNm=round(max((a["distNm"] for a in with_pos), default=0), 1) or None,
                     msgPerSec=round(self.stats["crcOk"] / span, 1) if span > 0 else None)
        airports = []
        for ap in AIRPORTS:
            x = dict(ap)
            x["distNm"] = round(dist_nm(self.rx["lat"], self.rx["lon"], ap["lat"], ap["lon"]), 1)
            x["bearing"] = round(bearing_deg(self.rx["lat"], self.rx["lon"], ap["lat"], ap["lon"]), 1)
            airports.append(x)
        return {"version": 1, "kind": "adsb", "updated": int(t * 1000), "receiver": dict(self.rx),
                "airports": airports, "source": source, "stats": stats, "aircraft": acs}

    def load(self, state, t):
        """Seeds the table from a saved state (aircraft still fresh at time t)."""
        for a in state.get("aircraft") or []:
            if t - a.get("lastSeen", 0) / 1000 > EXPIRE_S:
                continue
            b = self._new(a["icao"], a["lastSeen"] / 1000)
            b.update({k: v for k, v in a.items() if k in b})
            b["_adsb"] = True
            b["_last"] = a["lastSeen"] / 1000


# ---------------------------------------------------------------- the V4 (lock, USB, rtl_adsb)

class Lock:
    """The shared V4 lock: an exclusive fcntl.flock on ~/Library/Caches/radio/sdr.lock,
    taken non-blocking and retried (radio.py's semantics). Released on close or exit."""

    def __init__(self, wait=45.0):
        import fcntl
        self.fcntl = fcntl
        os.makedirs(CACHE, exist_ok=True)
        self.f = open(LOCK_FILE, "w")
        end = time.time() + wait
        while True:
            try:
                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.held = True
                return
            except BlockingIOError:
                if time.time() > end:
                    self.f.close()
                    self.held = False
                    return
                time.sleep(0.25)

    def release(self):
        if getattr(self, "held", False):
            try:
                self.fcntl.flock(self.f, self.fcntl.LOCK_UN)
            except OSError:
                pass
            self.held = False
        try:
            self.f.close()
        except OSError:
            pass


def _run(argv, timeout=10):
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout).stdout
    except Exception:
        return ""


def device():
    """The V4 from the USB tree (ioreg), never opened: present?, and who holds it exclusively."""
    text = _run(["/usr/sbin/ioreg", "-r", "-c", "IOUSBHostDevice", "-l", "-w0"], 15)
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


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, TypeError, ValueError):
        return False


def proc_name(pid):
    return os.path.basename(_run(["/bin/ps", "-o", "comm=", "-p", str(pid)], 5).strip())


def read_pid():
    """The live job's pidfile if its wrapper is still running (and is a python process)."""
    info = read_json(PID_FILE)
    if not info or not alive(info.get("pid")):
        return None
    if "python" not in proc_name(info["pid"]).lower():
        return None
    return info


def rtl_argv(gain):
    return [RTL_ADSB, "-g", f"{gain:g}"]


def stderr_reason(text):
    low = text.lower()
    if "usb_claim_interface" in low or "resource busy" in low or "failed to open" in low:
        return "busy", "Another program has the V4. Close it (or stop the other radio job) and try again."
    if "no supported devices" in low or "no matching devices" in low or "no devices found" in low:
        return "missing", "The V4 is not plugged in."
    last = [ln for ln in text.strip().splitlines() if ln.strip()]
    return "exited", last[-1][:200] if last else ""


def acquire_v4(wait):
    """Takes the lock and waits for the V4 to be free (never kills anyone).
    Returns (lock, device, error-dict-or-None)."""
    end = time.time() + wait
    while True:
        lock = Lock(wait=max(0.0, end - time.time()))
        if not lock.held:
            return None, None, {"ok": False, "error": "busy",
                                "say": "Another radio command holds the V4 lock. Try again in a moment."}
        d = device()
        if not d["present"]:
            lock.release()
            return None, d, {"ok": False, "error": "missing", "say": "The RTL-SDR (Blog V4) is not plugged in."}
        if not d.get("owner"):
            return lock, d, None
        lock.release()
        if time.time() > end:
            o = d["owner"]
            return None, d, {"ok": False, "error": "busy", "owner": o,
                             "say": f"The V4 is in use by {o['name']} (pid {o['pid']}); it can be used by one program at a time."}
        time.sleep(2.0)


class Decoder:
    """rtl_adsb's stdout bytes -> the aircraft table -> adsb.json.

    The reader for radio.py's job wrapper (see radio_modes below): .feed(bytes) with the
    first process's stdout, .tick() every ~0.2-1 s (flushes the state every ~2 s and drops
    aircraft silent for 5 min), .close() at the end. `run` and `live` use it too.
    meta: {"gain": dB, "raw": optional path to append timestamped frames to}."""

    def __init__(self, meta=None, mode="live", keep_previous=True, write=True):
        meta = meta or {}
        self.mode = mode
        self.write = write
        self.tr = Tracker(mode=mode)
        self.started = time.time()
        self.buf = b""
        self.raw = open(meta["raw"], "a") if meta.get("raw") else None
        self.src = {"mode": mode, "gain": meta.get("gain", DEFAULT_GAIN), "started": int(self.started * 1000),
                    "seconds": 0, "file": meta.get("raw"), "device": meta.get("device")}
        self.job = {"running": True, "pid": os.getpid(), "since": int(self.started * 1000), "lastExit": None}
        self.next_flush = 0.0
        if keep_previous:
            prev = read_json(STATE_FILE, None)
            if prev and (prev.get("source") or {}).get("mode") in ("live", "run"):
                self.tr.load(prev, self.started)  # keep aircraft heard a moment ago

    def feed(self, chunk):
        self.buf += chunk
        *lines, self.buf = self.buf.split(b"\n")
        t = time.time()
        for line in lines:
            s = line.decode(errors="replace").strip()
            p = parse_line(s)
            if not p:
                continue
            if self.raw:
                self.raw.write(f"{t:.3f} {s}\n")
            self.tr.feed(p[1], t)

    def snapshot(self):
        t = time.time()
        self.src["seconds"] = round(t - self.started, 1)
        st = self.tr.snapshot(self.src, t)
        st["job"] = dict(self.job)
        return st

    def flush(self):
        if self.mode == "live":
            self.tr.expire(time.time())
        if self.write:
            write_json(STATE_FILE, self.snapshot())

    def tick(self):
        if time.time() >= self.next_flush:
            self.next_flush = time.time() + FLUSH_S
            self.flush()

    def close(self, reason=None, detail=""):
        """Final flush. `reason` is recorded as the job's lastExit when given (radio.py keeps
        its own record in exits.json, so its wrapper leaves it out)."""
        self.job.update(running=False, pid=None,
                        lastExit={"at": now_ms(), "reason": reason, "detail": detail} if reason else None)
        if self.raw:
            self.raw.close()
            self.raw = None
        self.flush()


def stream(proc, decoder, until, on_tick=None, stop=None):
    """Feeds rtl_adsb's stdout to the decoder until time `until` (or EOF / stop())."""
    import select
    fd = proc.stdout.fileno()
    while time.time() < until and not (stop and stop()):
        r, _, _ = select.select([fd], [], [], 0.5)
        if r:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            decoder.feed(chunk)
        elif proc.poll() is not None:
            break
        if on_tick:
            on_tick()


def stop_proc(p, sig=signal.SIGINT, wait=4.0):
    if p.poll() is None:
        try:
            p.send_signal(sig)
        except OSError:
            pass
        try:
            p.wait(timeout=wait)
        except subprocess.TimeoutExpired:
            try:
                p.kill()
            except OSError:
                pass
            p.wait()


# ---------------------------------------------------------------- commands

def cmd_run(args):
    seconds = 20.0
    if args and re.match(r"^\d+(\.\d+)?$", args[0]):
        seconds = float(args.pop(0))
    seconds = max(1.0, min(600.0, seconds))
    gain = arg_value(args, "--gain", DEFAULT_GAIN, float)
    wait = arg_value(args, "--wait", 60.0, float)
    raw_path = arg_value(args, "--raw", None)
    touch_heartbeat()
    live = read_pid()
    if live:
        st = read_json(STATE_FILE, {}) or {}
        s = st.get("stats") or {}
        out({"ok": True, "live": True, "state": STATE_FILE, "aircraft": s.get("aircraft"), "positions": s.get("withPosition"),
             "say": f"The live decoder is running: {s.get('aircraft', 0)} aircraft, {s.get('withPosition', 0)} with positions."})
    if not os.path.exists(RTL_ADSB):
        out({"ok": False, "error": "tool", "say": "rtl_adsb is missing: brew install librtlsdr."})
    lock, d, err = acquire_v4(wait)
    if err:
        out(err)
    dec = Decoder({"gain": gain, "raw": raw_path, "device": d.get("name")}, mode="run", keep_previous=False,
                  write=False)
    started = time.time()
    p = subprocess.Popen(rtl_argv(gain), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         start_new_session=True)
    stopping = []

    def on_term(*_):
        stopping.append(1)

    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)
    try:
        stream(p, dec, started + seconds + 0.6, stop=lambda: bool(stopping))  # +0.6 s: tuner start-up
    finally:
        stop_proc(p)
        err_text = p.stderr.read().decode(errors="replace") if p.stderr else ""
        lock.release()
    m = re.search(r"Tuner gain set to ([\d.]+) dB", err_text)
    if m:
        dec.src["gain"] = float(m.group(1))
    if dec.tr.stats["frames"] == 0 and p.returncode not in (0, None, -2, 130):
        reason, detail = stderr_reason(err_text)
        out({"ok": False, "error": reason, "say": detail})
    dec.write = True
    dec.close()
    st = dec.snapshot()
    src = st["source"]
    s = st["stats"]
    out({"ok": True, "state": STATE_FILE, "seconds": src["seconds"], "gain": src["gain"], "frames": s["frames"],
         "valid": s["crcOk"], "aircraft": s["aircraft"], "positions": s["withPosition"], "maxRangeNm": s["maxRangeNm"],
         "say": f"Heard {s['aircraft']} aircraft in {src['seconds']:g} s, {s['withPosition']} with positions"
                + (f" (farthest {s['maxRangeNm']:g} nm)." if s["maxRangeNm"] else ".")})


def decode_file(path):
    tr = Tracker(mode="decode")
    t_syn = 0.0
    with open(path, errors="replace") as f:
        for line in f:
            p = parse_line(line)
            if not p:
                continue
            ts, msg = p
            if ts is None:
                t_syn += 0.1  # no timestamps: assume ~10 frames/s (rtl_adsb's rate here)
                ts = t_syn
            tr.feed(msg, ts)
    src = {"mode": "decode", "gain": None, "started": int((tr.first_t or 0) * 1000),
           "seconds": round((tr.last_t or 0) - (tr.first_t or 0), 1), "file": os.path.abspath(path), "device": None}
    return tr.snapshot(src)


def cmd_decode(args):
    if not args:
        out({"ok": False, "error": "usage", "say": "adsb.py decode <file> [--save] [--table] [--svg OUT] [--range NM]"})
    path = args.pop(0)
    save = arg_flag(args, "--save")
    table = arg_flag(args, "--table")
    svg_out = arg_value(args, "--svg", None)
    rng = arg_value(args, "--range", "50")
    if not os.path.exists(path):
        out({"ok": False, "error": "nofile", "say": f"No such file: {path}"})
    st = decode_file(path)
    if save:
        write_json(STATE_FILE, st)
    if svg_out:
        import adsb_render
        with open(svg_out, "w") as f:
            f.write(adsb_render.radar_svg(st, rng))
    if table:
        import adsb_render
        sys.stdout.write(adsb_render.text_table(st) + "\n")
        return
    out(st)


def job_status():
    info = read_pid()
    st = read_json(STATE_FILE, {}) or {}
    last = (st.get("job") or {}).get("lastExit")
    return {"running": bool(info), "pid": info.get("pid") if info else None,
            "since": info.get("started") if info else None, "lastExit": last}


def load_state(path=None):
    st = read_json(path or STATE_FILE, None)
    if not st:
        st = Tracker().snapshot({"mode": "none", "gain": None, "started": None, "seconds": 0, "file": None,
                                 "device": None}, time.time())
        st["empty"] = True
    return st


def cmd_state(args):
    touch_heartbeat()
    st = load_state(arg_value(args, "--input", None))
    st["job"] = job_status()
    st["now"] = now_ms()
    out(st)


def cmd_svg(args):
    touch_heartbeat()
    import adsb_render
    rng = arg_value(args, "--range", "50")
    out_path = arg_value(args, "--out", None)
    st = load_state(arg_value(args, "--input", None))
    st["job"] = job_status()
    svg = adsb_render.radar_svg(st, rng)
    if out_path:
        with open(out_path, "w") as f:
            f.write(svg)
        out({"ok": True, "path": out_path, "bytes": len(svg.encode())})
    sys.stdout.write(svg)


def cmd_table(args):
    touch_heartbeat()
    import adsb_render
    width = arg_value(args, "--width", 48, int)
    st = load_state(arg_value(args, "--input", None))
    st["job"] = job_status()
    sys.stdout.write(adsb_render.text_table(st, width=width) + "\n")


ANTENNA_TIP = ("Antenna: stand the V4's dipole vertical with the short elements pulled out to about 6.9 cm each, "
               "as high as you can at a window with a clear view of the sky.")


def cmd_view(args):
    """Everything the tab's Planes section draws, in one call (it polls this every ~2 s)."""
    touch_heartbeat()
    import adsb_render
    rng = arg_value(args, "--range", "auto")
    width = arg_value(args, "--width", 34, int)
    st = load_state(arg_value(args, "--input", None))
    st["job"] = job_status()
    acs = st.get("aircraft") or []
    pos = [a for a in acs if a.get("distNm") is not None]
    far = max(pos, key=lambda a: a["distNm"], default=None)
    res = {"ok": True, "empty": bool(st.get("empty")), "updated": st.get("updated"), "job": st["job"],
           "source": st.get("source"), "range": rng,
           "counts": {"aircraft": len(acs), "withPosition": len(pos),
                      "farthestNm": round(far["distNm"], 1) if far else None,
                      "farthest": (adsb_render.ident(far) if far else None),
                      "msgPerSec": (st.get("stats") or {}).get("msgPerSec")},
           "emergencies": [f"{adsb_render.ident(a)} squawks {adsb_render.emergency(a)}" for a in acs if adsb_render.emergency(a)],
           "antenna": ANTENNA_TIP, "now": now_ms()}
    if arg_flag(args, "--svg"):
        res["svg"] = adsb_render.radar_svg(st, rng)
    if arg_flag(args, "--table"):
        res["table"] = adsb_render.text_table(st, width=width)
    out(res)


class Stop(Exception):
    pass


def _raise_stop(*_):
    raise Stop()


def cmd_live(args):
    """The long-running decoder. Writes adsb.pid in radio.py's pidfile shape so the main
    script can treat it as a job ("adsb", child "rtl_adsb")."""
    gain = arg_value(args, "--gain", DEFAULT_GAIN, float)
    keep = arg_flag(args, "--keep")
    no_lock = arg_flag(args, "--no-lock")
    wait = arg_value(args, "--wait", 45.0, float)
    os.makedirs(STATE_DIR, exist_ok=True)
    if read_pid():
        out({"ok": False, "error": "running", "say": "The ADS-B decoder is already running."})
    signal.signal(signal.SIGTERM, _raise_stop)
    signal.signal(signal.SIGINT, _raise_stop)
    signal.signal(signal.SIGHUP, _raise_stop)
    reason, detail = "stopped", ""
    lock, p = None, None
    meta = {"gain": gain, "keep": keep}
    try:
        if os.path.getsize(LOG_FILE) > 1_000_000:
            os.remove(LOG_FILE)
    except OSError:
        pass
    log = open(LOG_FILE, "a")  # `start` points this process's own stderr here too
    dec = Decoder(meta, mode="live")
    try:
        if not no_lock:
            lock, d, err = acquire_v4(wait)
            if err:
                reason, detail = err["error"], err["say"]
                raise Stop()
            dec.src["device"] = d.get("name")
        p = subprocess.Popen(rtl_argv(gain), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=log,
                             start_new_session=True)
        write_json(PID_FILE, {"pid": os.getpid(), "kind": "adsb", "started": now_ms(), "meta": meta,
                              "children": [p.pid]})
        dec.tick()
        lease = 0 if (keep or os.environ.get("RADIO_NO_LEASE")) else LEASE_S
        next_lease = time.time() + 30
        released_at = time.time() + 3.0  # hold the lock until rtl_adsb has claimed the V4

        def tick():
            nonlocal next_lease, reason, detail
            if lock and lock.held and time.time() > released_at:
                lock.release()
            dec.tick()
            if lease and time.time() >= next_lease:
                next_lease = time.time() + 30
                try:
                    idle = time.time() - os.path.getmtime(HEARTBEAT)
                except OSError:
                    idle = 0
                if idle > lease:
                    reason, detail = "lease", f"Stopped after {max(1, lease // 60)} min with nobody watching."
                    raise Stop()

        stream(p, dec, float("inf"), on_tick=tick)
        log.flush()
        reason, detail = stderr_reason(open(LOG_FILE, errors="replace").read()[-4000:])
    except Stop:
        pass
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)  # a second stop must not cut the clean-up short
        if p is not None:
            stop_proc(p)
        if lock:
            lock.release()
        try:
            dec.close(reason, detail)
        except Exception:
            pass
        info = read_json(PID_FILE)
        if info and info.get("pid") == os.getpid():
            try:
                os.remove(PID_FILE)
            except OSError:
                pass
        log.close()
    sys.exit(0 if reason == "stopped" else 1)


def radio_cli(args, timeout=120):
    """radio.py <args> -> its JSON: the one job manager that owns the V4."""
    try:
        p = subprocess.run([sys.executable, os.path.join(os.path.dirname(SCRIPT), "radio.py")] + args,
                           capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        return json.loads(p.stdout.strip().splitlines()[-1])
    except Exception as err:
        return {"ok": False, "error": "radio", "say": f"radio.py {' '.join(args[:2])} failed: {type(err).__name__}: {err}"[:300]}


def cmd_start(args):
    """The "adsb" job through radio.py (it stops whatever holds the V4 and records why)."""
    touch_heartbeat()
    meta = {"gain": arg_value(args, "--gain", DEFAULT_GAIN, float)}
    if arg_flag(args, "--keep"):
        meta["keep"] = True
    out(radio_cli(["job", "start", "adsb", json.dumps(meta)]))


def cmd_stop(_args):
    out(radio_cli(["job", "stop", "adsb"]))


# ---------------------------------------------------------------- radio.py plugin hook

def radio_modes(radio):
    """radio.py's PLUGIN_MODULES hook: the "adsb" job for its generic wrapper, which owns the
    lock, the pidfile (adsb.pid, the same file `live` uses, so `state`/`stop`/`run` here see
    either), the log, the lease and the recorded exit. Start: `radio.py job start adsb
    ['{"gain": 49.6}']`. The Decoder writes adsb.json every ~2 s."""
    rtl = getattr(radio, "RTL_ADSB", RTL_ADSB)
    return [radio.Mode(
        kind="adsb", label="Planes", children=("rtl_adsb",),
        pipeline=lambda meta: [[rtl, "-g", f"{float((meta or {}).get('gain', DEFAULT_GAIN)):g}"]],
        reader=lambda meta: Decoder(meta, mode="live"),
        doing=lambda meta: "track planes (ADS-B on 1090 MHz)",
        detail=lambda meta: "ADS-B on 1090 MHz")]


# ---------------------------------------------------------------- self-test

def selftest():
    """Reference vectors from "The 1090 MHz Riddle" (Junzi Sun), cited per check."""
    results = []

    def check(name, cond, got=None):
        results.append({"name": name, "ok": bool(cond), **({"got": got} if got is not None else {})})

    h = bytes.fromhex
    # Riddle, "CRC": 8D406B902015A678D4D220AA4BDA has a zero remainder.
    check("crc: 8D406B902015A678D4D220AA4BDA valid", remainder(h("8D406B902015A678D4D220AA4BDA")) == 0)
    bad = bytearray(h("8D406B902015A678D4D220AA4BDA"))
    bad[6] ^= 0x10
    check("crc: one flipped bit detected", remainder(bytes(bad)) != 0)
    fixed = decode_frame(bytes(bad), known={"406B90"})
    check("crc: one flipped bit corrected for a known ICAO", fixed.get("ok") and fixed.get("fixed"))
    check("crc: not corrected for an unknown ICAO", not decode_frame(bytes(bad), known=set()).get("ok"))
    # Riddle, "Aircraft identification": 8D4840D6202CC371C32CE0576098 -> ICAO 4840D6, TC 4, KLM1023.
    d = decode_frame(h("8D4840D6202CC371C32CE0576098"))
    check("ident: ICAO 4840D6", d.get("icao") == "4840D6", d.get("icao"))
    check("ident: TC 4", d.get("tc") == 4, d.get("tc"))
    check("ident: callsign KLM1023", d.get("callsign") == "KLM1023", d.get("callsign"))
    # Riddle, "Airborne position": even 8D40621D58C382D690C8AC2863A7 (t=1457996402),
    # odd 8D40621D58C386435CC412692AD6 (t=1457996400) -> lat 52.25720, lon 3.91937, 38000 ft.
    e = decode_frame(h("8D40621D58C382D690C8AC2863A7"))
    o = decode_frame(h("8D40621D58C386435CC412692AD6"))
    check("alt: Q=1 38000 ft", e.get("alt") == 38000, e.get("alt"))
    check("cpr: frame flags even/odd", e.get("odd") is False and o.get("odd") is True)
    g = cpr_global(e["cpr"], o["cpr"], newest_odd=False)
    check("cpr global: 52.25720, 3.91937", g and abs(g[0] - 52.25720) < 1e-4 and abs(g[1] - 3.91937) < 1e-4,
          [round(g[0], 5), round(g[1], 5)] if g else None)
    check("cpr: NL(52.2572) = 36", cpr_nl(52.2572) == 36, cpr_nl(52.2572))
    check("cpr: NL edges 0->59, 87->2, 88->1", (cpr_nl(0), cpr_nl(87), cpr_nl(88)) == (59, 2, 1))
    # Riddle, "Locally unambiguous position": reference 52.258, 3.918 and the even frame.
    loc = cpr_local(52.258, 3.918, e["cpr"][0], e["cpr"][1], odd=False)
    check("cpr local: 52.25720, 3.91937", abs(loc[0] - 52.25720) < 1e-4 and abs(loc[1] - 3.91937) < 1e-4,
          [round(loc[0], 5), round(loc[1], 5)])
    # Tracker end to end on the same pair (odd first, then even 2 s later).
    tr = Tracker(receiver={"id": "T", "name": "test", "lat": 52.0, "lon": 4.0})
    tr.feed(h("8D40621D58C386435CC412692AD6"), 1457996400.0)
    tr.feed(h("8D40621D58C382D690C8AC2863A7"), 1457996402.0)
    a = tr.ac.get("40621D", {})
    check("tracker: global fix from the pair", a.get("posSource") == "global" and abs(a.get("lat", 0) - 52.2572) < 1e-4,
          [a.get("lat"), a.get("lon"), a.get("posSource")])
    # Riddle, "Airborne velocity" sub-type 1: 8D485020994409940838175B284F ->
    # 159.20 kt, track 182.88 deg, -832 ft/min.
    v = decode_frame(h("8D485020994409940838175B284F"))
    check("velocity st1: 159.2 kt", abs(v.get("gs", 0) - 159.20) < 0.01, v.get("gs"))
    check("velocity st1: track 182.88", abs(v.get("track", 0) - 182.88) < 0.01, v.get("track"))
    check("velocity st1: -832 ft/min", v.get("vr") == -832, v.get("vr"))
    # Sub-type 3: 8DA05F219B06B6AF189400CBC33F -> heading 243.98, TAS 375 kt, -2304 ft/min.
    v = decode_frame(h("8DA05F219B06B6AF189400CBC33F"))
    check("velocity st3: heading 243.98", abs(v.get("heading", 0) - 243.98) < 0.01, v.get("heading"))
    check("velocity st3: TAS 375 kt", v.get("tas") == 375, v.get("tas"))
    check("velocity st3: -2304 ft/min", v.get("vr") == -2304, v.get("vr"))
    # Riddle, "Identity code" (DF5): 2A00516D492B80 -> squawk 0356.
    sq = squawk_from(((0x51 & 0x1F) << 8) | 0x6D)
    check("squawk: DF5 2A00516D492B80 -> 0356", sq == "0356", sq)
    # Gillham (Q=0): every legal code maps to a distinct 100 ft level from -1200 ft upward.
    alts = {}
    for code in range(1 << 13):
        if code & 0x50:  # M or Q (here D1) set: not a Gillham altitude
            continue
        alt = ac13_to_alt(code)
        if alt is not None:
            alts.setdefault(alt, 0)
            alts[alt] += 1
    want = set(range(-1200, 126800, 100))
    check("gillham: -1200..126700 ft, each exactly once", set(alts) == want and all(c == 1 for c in alts.values()),
          [min(alts), max(alts), len(alts)] if alts else None)
    # US register mapping (FAA): A00001 = N1, ADF7C7 = N99999, A00002 = N1A, A00003 = N1AA.
    check("n-number: A00001 N1, A00002 N1A, A00003 N1AA, ADF7C7 N99999",
          [n_number(x) for x in ("A00001", "A00002", "A00003", "ADF7C7")] == ["N1", "N1A", "N1AA", "N99999"],
          [n_number(x) for x in ("A00001", "A00002", "A00003", "ADF7C7")])
    # Riddle, "Surface position", locally unambiguous example: 8C4841753A9A153237AEF0F275BE
    # against the reference 51.990, 4.375 -> 52.320561, 4.735735; movement 17 kt, track 92.8125.
    s = decode_frame(h("8C4841753A9A153237AEF0F275BE"))
    sl = cpr_local(51.990, 4.375, s["cpr"][0], s["cpr"][1], s["odd"], surface=True)
    check("surface: local 52.320561, 4.735735", abs(sl[0] - 52.320561) < 1e-5 and abs(sl[1] - 4.735735) < 1e-5,
          [round(sl[0], 6), round(sl[1], 6)])
    check("surface: 17 kt, track 92.8", s.get("gs") == 17 and abs(s.get("track", 0) - 92.8125) < 0.1,
          [s.get("gs"), s.get("track")])
    # DF18: the same identification re-framed as TIS-B (CF=2) and anonymous TIS-B (CF=5), parity recomputed.
    for cf, via, key in ((2, "tisb", "4840D6"), (5, "tisb", "~4840D6"), (6, "adsr", "4840D6")):
        body = bytes([(18 << 3) | cf]) + h("8D4840D6202CC371C32CE0576098")[1:11]
        m18 = body + crc24(body).to_bytes(3, "big")
        d18 = decode_frame(m18)
        check(f"df18 cf{cf}: {via} {key} KLM1023", d18.get("ok") and d18.get("via") == via and d18.get("icao") == key
              and d18.get("callsign") == "KLM1023", [d18.get("via"), d18.get("icao"), d18.get("callsign")])
    # Geometry: CVG from Walton (about 10.8 nm, roughly north-north-west).
    # (Fixed to the built-in Walton default, so a location.json does not change the check.)
    wal, cvg = location.DEFAULT, location.DEFAULT["airports"][0]
    dn = dist_nm(wal["lat"], wal["lon"], cvg["lat"], cvg["lon"])
    br = bearing_deg(wal["lat"], wal["lon"], cvg["lat"], cvg["lon"])
    check("geometry: CVG 10-11.5 nm at 330-350 deg", 10 < dn < 11.5 and 330 < br < 350, [round(dn, 2), round(br, 1)])
    ok = all(r["ok"] for r in results)
    return {"ok": ok, "passed": sum(r["ok"] for r in results), "total": len(results), "checks": results}


# ---------------------------------------------------------------- main

def main():
    sys.path.insert(0, os.path.dirname(SCRIPT))
    args = sys.argv[1:] or ["help"]
    verb = args.pop(0)
    if verb in ("help", "-h", "--help"):
        sys.stdout.write(HELP)
        return
    if verb == "selftest":
        r = selftest()
        out(r, 0 if r["ok"] else 1)
    if verb == "run":
        cmd_run(args)
    if verb == "decode":
        cmd_decode(args)
        return
    if verb == "state":
        cmd_state(args)
    if verb == "svg":
        cmd_svg(args)
        return
    if verb == "table":
        cmd_table(args)
        return
    if verb == "view":
        cmd_view(args)
    if verb == "live":
        cmd_live(args)
    if verb == "start":
        cmd_start(args)
    if verb == "stop":
        cmd_stop(args)
    out({"ok": False, "error": f"unknown command {verb}", "say": "adsb.py help"}, 2)


if __name__ == "__main__":
    main()

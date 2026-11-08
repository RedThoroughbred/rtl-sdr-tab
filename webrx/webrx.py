#!/usr/bin/env python3
"""Web SDR for the Radio tab: OpenWebRX+ in Docker, fed by rtl_tcp on the Mac.

  webrx.py start     take the V4 lock, run rtl_tcp on 127.0.0.1:1234, sync the bookmarks,
                     bring the container up, make sure the admin user exists, start the
                     handoff endpoint (handoff.py, :8074)
  webrx.py stop      handoff endpoint and container down, rtl_tcp stopped, lock released
  webrx.py status    running?, URLs, port, rtl_tcp pid, handoff, background decoding (fast;
                     safe to poll)
  webrx.py sync-bookmarks
                     regenerate bookmarks.json from radio.py's name tables, the presets'
                     notable frequencies and what recent scans found busy or strong (also
                     the Wildcat panel's list); safe while Web SDR runs

Each call prints one JSON object. Standard library only, receive only.

The Wildcat RF package (0.3.2): skin/custom.css (the theme), plugins/receiver/ (init.js and
the wildcat plugin: "Send to Radio tab" and the Wildcat panel), handoff.py (the endpoint the
button posts to), the bookmark sync below, and background decoding (ensure_settings: APRS on
2 m, 433 MHz gadgets overnight, while nobody has the page open).

Docker Desktop on macOS cannot pass USB into a container, so rtl_tcp shares the
V4 and OpenWebRX+ uses an rtl_tcp source at host.docker.internal:1234. rtl_tcp
has no authentication, so it is bound to 127.0.0.1 only (Docker Desktop still
reaches it through host.docker.internal).

The dongle lock: radio.py takes an flock on ~/Library/Caches/radio/sdr.lock for
each command. Web SDR takes the same lock and hands the locked file descriptor
to rtl_tcp (exec), so the lock is held exactly as long as rtl_tcp runs; other
lock takers (one-shot adsb.py / digital.py runs) wait, then report "busy".
Nothing here ever kills a process it did not start.

radio.py knows this as its "webrx" job (Web SDR): it recognises our rtl_tcp by the
pid file below, stops Web SDR (stop.sh) before taking the lock whenever the Radio
tab needs the V4, and stops its own jobs before calling start.sh (`radio.py job
start webrx`, /radio web on). These scripts still work on their own.

Admin password: macOS Keychain, service "openwebrx-wildcat", account "admin".
Never written to the repo; the container keeps only its hash (users.json).
"""
import fcntl
import json
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")
CACHE = os.path.join(HOME, "Library", "Caches", "radio")
LOCK_PATH = os.path.join(CACHE, "sdr.lock")
PID_PATH = os.path.join(CACHE, "webrx-rtl_tcp.pid")
LOG_PATH = os.path.join(CACHE, "webrx-rtl_tcp.log")

RADIO_DIR = os.environ.get("RADIO_DIR") or os.path.join(HOME, "Library", "Application Support", "radio")


def _data_dir():
    """Where Web SDR keeps its settings, users and bookmarks: WEBRX_DATA when set, else the folder
    named on the one line of <radio folder>/webrx-data (a data folder on another drive), else a
    folder beside the radio state."""
    if os.environ.get("WEBRX_DATA"):
        return os.environ["WEBRX_DATA"]
    try:
        with open(os.path.join(RADIO_DIR, "webrx-data")) as f:
            named = f.read().strip()
        if named:
            return os.path.expanduser(named)
    except OSError:
        pass
    return os.path.join(RADIO_DIR, "openwebrx")


DATA = _data_dir()
PORT = int(os.environ.get("WEBRX_PORT") or 8073)
RTL_PORT = 1234  # must match "remote" in config/settings.json
LOCK_WAIT = float(os.environ.get("WEBRX_LOCK_WAIT") or 60)

IMAGE = "slechev/openwebrxplus:1.2.126"
PROJECT = "wildcat-webrx"
CONTAINER = "wildcat-webrx"
COMPOSE = os.path.join(HERE, "docker-compose.yml")
COMPOSE_LAN = os.path.join(HERE, "docker-compose.lan.yml")
KEYCHAIN_SERVICE = "openwebrx-wildcat"
ADMIN_USER = "admin"

RTL_TCP = "/opt/homebrew/bin/rtl_tcp"
DOCKER = shutil.which("docker") or "/usr/local/bin/docker"
TAILSCALE = shutil.which("tailscale") or "/opt/homebrew/bin/tailscale"
SECURITY = "/usr/bin/security"

# The handoff endpoint (handoff.py): same addresses as the web UI, its own port.
HANDOFF_PORT = int(os.environ.get("WEBRX_HANDOFF_PORT") or 8074)
HANDOFF_PY = os.path.join(HERE, "handoff.py")
HANDOFF_PID = os.path.join(CACHE, "webrx-handoff.pid")
HANDOFF_LOG = os.path.join(CACHE, "webrx-handoff.log")
# What the Wildcat plugin reads (static/plugins/receiver/wildcat-data/wildcat.json in the page).
WILDCAT_DATA = os.path.join(DATA, "wildcat")
SCRIPTS = os.path.join(os.path.dirname(HERE), "scripts")


# ---------------------------------------------------------------- plumbing

def out(obj, code=0):
    print(json.dumps(obj, separators=(",", ":")))
    sys.stdout.flush()
    sys.exit(code)


def run(argv, timeout=15, env=None):
    """(returncode, stdout, stderr); never raises."""
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=env)
        return p.returncode, p.stdout, p.stderr
    except Exception as e:  # missing binary, timeout
        return 127, "", str(e)


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def proc_comm(pid):
    return run(["/bin/ps", "-o", "comm=", "-p", str(pid)], 5)[1].strip()


def read_pid():
    try:
        with open(PID_PATH) as f:
            pid = int(f.read().strip())
    except (OSError, ValueError):
        return None
    # Only ours if it is still rtl_tcp (pids get reused).
    if alive(pid) and os.path.basename(proc_comm(pid)) == "rtl_tcp":
        return pid
    return None


def rtl_listening(pid):
    code, so, _ = run(["/usr/sbin/lsof", "-nP", "-a", "-p", str(pid), "-iTCP", "-sTCP:LISTEN"], 5)
    return f":{RTL_PORT}" in so


def log_tail(n=12):
    try:
        with open(LOG_PATH, errors="replace") as f:
            return f.read().splitlines()[-n:]
    except OSError:
        return []


# ---------------------------------------------------------------- network

def lan_ip():
    """The Mac's address on the default route's interface (not a tunnel)."""
    if os.environ.get("WEBRX_LAN_IP"):
        return os.environ["WEBRX_LAN_IP"]
    _, so, _ = run(["/sbin/route", "-n", "get", "default"], 5)
    m = re.search(r"interface:\s*(\S+)", so)
    ifaces = ([m.group(1)] if m else []) + ["en0", "en1", "en8"]
    for i in ifaces:
        if i.startswith(("utun", "lo")):
            continue
        ip = run(["/usr/sbin/ipconfig", "getifaddr", i], 5)[1].strip()
        if ip:
            return ip
    return None


def tailscale_url():
    """https URL if Seth has run `tailscale serve` for this port (read-only check)."""
    if not os.path.exists(TAILSCALE):
        return None
    code, so, _ = run([TAILSCALE, "serve", "status", "--json"], 5)
    try:
        web = (json.loads(so) or {}).get("Web") or {}
    except ValueError:
        return None
    for hostport, cfg in web.items():
        for path, h in ((cfg or {}).get("Handlers") or {}).items():
            proxy = (h or {}).get("Proxy") or ""
            if re.search(rf"(127\.0\.0\.1|localhost):{PORT}/?$", proxy):
                host = hostport[:-4] if hostport.endswith(":443") else hostport
                return f"https://{host}{path}"
    return None


# ---------------------------------------------------------------- docker

def docker_up():
    return run([DOCKER, "info", "--format", "{{.ServerVersion}}"], 10)[0] == 0


def ensure_docker(wait=120):
    if docker_up():
        return True
    run(["/usr/bin/open", "-g", "-a", "Docker"], 10)
    end = time.time() + wait
    while time.time() < end:
        time.sleep(3)
        if docker_up():
            return True
    return False


def container():
    """{state, health, ports:[(ip, port)]} or None when absent / Docker down."""
    code, so, _ = run([DOCKER, "inspect", CONTAINER, "--format",
                       "{{json .State}}|{{json .NetworkSettings.Ports}}"], 10)
    if code != 0 or "|" not in so:
        return None
    st_raw, ports_raw = so.strip().split("|", 1)
    try:
        st = json.loads(st_raw)
        ports = json.loads(ports_raw) or {}
    except ValueError:
        return None
    binds = [(b.get("HostIp"), b.get("HostPort")) for b in (ports.get("8073/tcp") or [])]
    return {"state": st.get("Status"), "health": (st.get("Health") or {}).get("Status"), "ports": binds}


def compose(args, lan=None, timeout=180):
    env = dict(os.environ, WEBRX_DATA=DATA, WEBRX_PORT=str(PORT))
    argv = [DOCKER, "compose", "-p", PROJECT, "-f", COMPOSE]
    if lan:
        env["WEBRX_LAN_IP"] = lan
        argv += ["-f", COMPOSE_LAN]
    return run(argv + args, timeout, env)


def http_ok(timeout=2):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


# ---------------------------------------------------------------- the V4 on USB

def v4_usb():
    """{present, owner} from the USB tree (ioreg), without opening the device."""
    _, text, _ = run(["/usr/sbin/ioreg", "-r", "-c", "IOUSBHostDevice", "-l", "-w0"], 15)
    cur = None
    found = []
    for line in text.splitlines():
        m = re.search(r"\+-o (.+?)@[0-9a-f]+\s+<class IOUSBHostDevice", line)
        if m:
            cur = {"node": m.group(1)}
            found.append(cur)
            continue
        if cur is None:
            continue
        for key, field in (("idVendor", "vid"), ("idProduct", "pid")):
            m = re.search(rf'"{key}" = (\d+)', line)
            if m and field not in cur:
                cur[field] = int(m.group(1))
        m = re.search(r'"UsbExclusiveOwner" = "pid (\d+), ([^"]*)"', line)
        if m and "owner" not in cur:
            cur["owner"] = {"pid": int(m.group(1)), "name": m.group(2)}
    for d in found:
        if "blog v4" in d["node"].lower() or (d.get("vid") == 0x0BDA and d.get("pid") in (0x2838, 0x2832)):
            return {"present": True, "owner": d.get("owner")}
    return {"present": False, "owner": None}


def holder_name(owner):
    """The Radio tab's name for whoever has the V4 (radio.py status: "Planes", "APRS"...),
    else the process name from the USB tree."""
    try:
        p = subprocess.run([sys.executable, os.path.join(os.path.dirname(HERE), "scripts", "radio.py"), "status"],
                           capture_output=True, text=True, timeout=20, stdin=subprocess.DEVNULL)
        h = json.loads(p.stdout).get("holder") or {}
        if h.get("label"):
            return f"{h['label']} (pid {owner['pid']})"
    except Exception:
        pass
    return f"{owner['name']} (pid {owner['pid']})"


# ---------------------------------------------------------------- the lock holder

def hold():
    """Runs detached (own session). Takes the lock, then becomes rtl_tcp."""
    os.makedirs(CACHE, exist_ok=True)
    f = open(LOCK_PATH, "a")
    end = time.time() + LOCK_WAIT
    while True:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.time() > end:
                out({"ok": False, "error": "busy",
                     "say": "Another radio command still holds the V4 lock; try again in a moment."}, 3)
            time.sleep(0.5)
    while True:
        d = v4_usb()
        if not d["present"]:
            out({"ok": False, "error": "missing", "say": "The RTL-SDR Blog V4 is not on USB."}, 4)
        if not d["owner"]:
            break
        if time.time() > end:
            out({"ok": False, "error": "busy", "owner": d["owner"],
                 "say": f"The V4 is in use by {holder_name(d['owner'])}. Stop it (Radio tab: Stop all, or "
                        "radio.py stop) and start Web SDR again, or start Web SDR from the Radio tab "
                        "(/radio web on), which takes the V4 over."}, 3)
        time.sleep(1)
    with open(PID_PATH, "w") as p:
        p.write(str(os.getpid()))
    os.set_inheritable(f.fileno(), True)  # the lock rides along into rtl_tcp
    print(json.dumps({"ok": True, "say": "lock taken; exec rtl_tcp", "pid": os.getpid()}), flush=True)
    os.execv(RTL_TCP, [RTL_TCP, "-a", "127.0.0.1", "-p", str(RTL_PORT), "-s", "2400000"])


def start_rtl_tcp():
    """(pid, None) when rtl_tcp is listening, else (None, error dict)."""
    pid = read_pid()
    if pid and rtl_listening(pid):
        return pid, None
    if not os.path.exists(RTL_TCP):
        return None, {"ok": False, "error": "rtl_tcp", "say": "rtl_tcp is missing: brew install librtlsdr."}
    try:
        os.remove(PID_PATH)
    except OSError:
        pass
    log = open(LOG_PATH, "w")
    proc = subprocess.Popen([sys.executable, os.path.abspath(__file__), "_hold"], stdin=subprocess.DEVNULL,
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
    end = time.time() + LOCK_WAIT + 30
    while time.time() < end:
        time.sleep(0.5)
        if proc.poll() is not None:
            for line in reversed(log_tail(20)):
                if line.startswith("{"):
                    try:
                        err = json.loads(line)
                        if not err.get("ok", True):
                            return None, err
                    except ValueError:
                        pass
            return None, {"ok": False, "error": "rtl_tcp", "say": "rtl_tcp exited: " + " / ".join(log_tail(4))}
        if os.path.exists(PID_PATH) and rtl_listening(proc.pid):
            return proc.pid, None
    stop_rtl_tcp()
    return None, {"ok": False, "error": "rtl_tcp", "say": "rtl_tcp did not start listening in time."}


def stop_rtl_tcp():
    pid = read_pid()
    if not pid:
        try:
            os.remove(PID_PATH)
        except OSError:
            pass
        return None
    os.kill(pid, signal.SIGTERM)
    for _ in range(50):
        if not alive(pid):
            break
        time.sleep(0.1)
    else:
        os.kill(pid, signal.SIGKILL)  # ours (pid file + name checked)
        time.sleep(0.3)
    try:
        os.remove(PID_PATH)
    except OSError:
        pass
    return pid


# ---------------------------------------------------------------- admin user

def keychain_password():
    code, so, _ = run([SECURITY, "find-generic-password", "-a", ADMIN_USER, "-s", KEYCHAIN_SERVICE, "-w"], 10)
    return so.strip() if code == 0 and so.strip() else None


def ensure_admin():
    """Creates the admin user when missing. The password comes from (or goes to) Keychain."""
    code, _, _ = run([DOCKER, "exec", CONTAINER, "openwebrx", "admin", "--silent", "hasuser", ADMIN_USER], 30)
    if code == 0:
        return "exists"
    pw = keychain_password()
    made = False
    if not pw:
        pw = secrets.token_urlsafe(18)
        if run([SECURITY, "add-generic-password", "-a", ADMIN_USER, "-s", KEYCHAIN_SERVICE,
                "-l", "OpenWebRX+ Wildcat RF admin", "-w", pw], 10)[0] != 0:
            return "keychain-failed"
        made = True
    env = dict(os.environ, OWRX_PASSWORD=pw)  # passed by name: never on a command line
    code, so, se = run([DOCKER, "exec", "-e", "OWRX_PASSWORD", CONTAINER,
                        "openwebrx", "admin", "--noninteractive", "adduser", ADMIN_USER], 30, env)
    if code != 0:
        return "adduser-failed"
    return "created (new Keychain password)" if made else "created (Keychain password)"


# ---------------------------------------------------------------- the handoff endpoint

def handoff_pid():
    """The handoff server's pid while it runs (pid file, and the process is still handoff.py)."""
    try:
        with open(HANDOFF_PID) as f:
            pid = int(f.read().strip())
    except (OSError, ValueError):
        return None
    if alive(pid) and "handoff.py" in run(["/bin/ps", "-o", "args=", "-p", str(pid)], 5)[1]:
        return pid
    return None


def handoff_listening(addr="127.0.0.1", port=None):
    import socket
    try:
        with socket.create_connection((addr, port or HANDOFF_PORT), timeout=0.5):
            return True
    except OSError:
        return False


def start_handoff(lan):
    """Detached, like rtl_tcp: it outlives this call and the tab's process.run."""
    pid = handoff_pid()
    if pid and handoff_listening():
        return pid
    stop_handoff()
    binds = ["127.0.0.1"] + ([lan] if lan else [])
    argv = [sys.executable, HANDOFF_PY, "serve", "--port", str(HANDOFF_PORT), "--web-port", str(PORT)]
    for b in binds:
        argv += ["--bind", b]
    log = open(HANDOFF_LOG, "a")
    proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True, close_fds=True)
    with open(HANDOFF_PID, "w") as f:
        f.write(str(proc.pid))
    for _ in range(30):
        if handoff_listening():
            return proc.pid
        if proc.poll() is not None:
            break
        time.sleep(0.1)
    return None


def stop_handoff():
    pid = handoff_pid()
    if pid:
        os.kill(pid, signal.SIGTERM)
        for _ in range(30):
            if not alive(pid):
                break
            time.sleep(0.1)
        else:
            os.kill(pid, signal.SIGKILL)  # ours (pid file + command line checked)
    try:
        os.remove(HANDOFF_PID)
    except OSError:
        pass
    return pid


# ---------------------------------------------------------------- background decoding and the waterfall

# When nobody has the page open, OpenWebRX+'s scheduler tunes a profile and its background
# services decode there: APRS (packet) on 2 m, rtl_433 (ism) on 433.92. Times are UTC: 433 MHz
# from 04:00 to 10:00 (about midnight to 6 am US Eastern), 2 m APRS the rest of the day.
SCHEDULE = {"type": "static", "schedule": {"1000-0400": "2m-aprs", "0400-1000": "ism433"}}
DECODERS = ["packet", "ism"]
ISM433 = {"name": "433 MHz ISM 432.3-434.7 MHz (rtl_433)", "center_freq": 433500000, "samp_rate": 2400000,
          "start_freq": 433920000, "start_mod": "ism", "tuning_step": "25000"}
SEED_SETTINGS = os.path.join(HERE, "config", "settings.json")
# 0.3.x's four FM profiles left 88-90.6, 93-96.6, 99-100.6 and 103-105.6 MHz unreachable (103.5 WGRR
# could not be tuned). 0.4.0 replaces them with ten contiguous windows (bcfm-*, in the seed). A live
# copy of one of these that is exactly the old seed (never edited in the web Settings) is retired.
RETIRED_FM = {
    "fm-102": {"name": "FM 100.6-103.0 MHz (WEBN, WKRQ, WIZF)", "center_freq": 101800000, "samp_rate": 2400000,
               "start_freq": 102700000, "start_mod": "wfm", "tuning_step": "50000", "rf_gain": 19.7},
    "fm-92": {"name": "FM 90.6-93.0 MHz (WGUC, WVXU, WOFX)", "center_freq": 91800000, "samp_rate": 2400000,
              "start_freq": 91700000, "start_mod": "wfm", "tuning_step": "50000", "rf_gain": 19.7},
    "fm-98": {"name": "FM 96.6-99.0 MHz (WYGY, WRRM)", "center_freq": 97800000, "samp_rate": 2400000,
              "start_freq": 97300000, "start_mod": "wfm", "tuning_step": "50000", "rf_gain": 19.7},
    "fm-107": {"name": "FM 105.6-108.0 MHz (WNKR, WKFS)", "center_freq": 106800000, "samp_rate": 2400000,
               "start_freq": 107100000, "start_mod": "wfm", "tuning_step": "50000", "rf_gain": 19.7},
}


def seed_profiles(prefixes=("bcfm-", "hf-")):
    """The managed profiles from the seed config (one source of truth): the contiguous FM windows
    and the HF profiles (public broadcasts and open ham modes), in the seed's order."""
    try:
        with open(SEED_SETTINGS) as f:
            prof = json.load(f)["sdrs"]["v4"]["profiles"]
    except (OSError, ValueError, KeyError, TypeError):
        return {}
    return {k: v for k, v in prof.items() if k.startswith(prefixes)}


def tab_waterfall(stops=24):
    """The Radio tab's waterfall ramp (radio.py wf_rgb) as OpenWebRX+ custom colours."""
    radio = radio_module()
    if radio is None:
        return None
    out_ = []
    for i in range(stops):
        r, g, b = radio.wf_rgb(i / (stops - 1))
        out_.append((r << 16) | (g << 8) | b)
    return out_


def managed_settings():
    """What Web SDR adds to its settings when missing: (top-level keys, v4 SDR keys, new profiles)."""
    top = {"services_enabled": True, "services_decoders": DECODERS, "map_position_retention_time": 12 * 3600}
    colors = tab_waterfall()
    if colors:
        top.update({"waterfall_scheme": "CustomWaterfall", "waterfall_colors": colors})
    return top, {"scheduler": SCHEDULE}, {**seed_profiles(("bcfm-",)), "ism433": ISM433, **seed_profiles(("hf-",))}


def location_settings(seed):
    """The receiver's name and position from ~/Library/Application Support/radio/location.json, as the
    keys OpenWebRX+ keeps them under: only for a location file that is in use, and only for the keys
    that still hold the seed's Walton values (a name or position Seth typed into the web Settings is
    never overwritten). {} with no location file."""
    if SCRIPTS not in sys.path:
        sys.path.insert(0, SCRIPTS)
    try:
        import location
        loc = location.load()
    except Exception:
        return {}
    if not loc["_custom"]:
        return {}
    want = {"receiver_location": loc["name"], "photo_title": f"Wildcat RF, {loc['name']}",
            "receiver_gps": {"lat": loc["lat"], "lon": loc["lon"]}}
    return {k: v for k, v in want.items() if k in seed and seed[k] != v}


def ensure_settings(path=None):
    """Adds the managed keys to the live settings.json when they are missing. A key that is
    there already (Seth changed it in the web Settings) is left alone. Returns the keys added
    (a retired profile counts as "-sdrs.v4.profiles.<key>"). The contiguous FM windows go first,
    so the default profile stays an FM one."""
    path = path or os.path.join(DATA, "var", "settings.json")
    try:
        with open(path) as f:
            s = json.load(f)
    except (OSError, ValueError):
        return []
    if not isinstance(s, dict):
        return []
    top, sdr_keys, profiles = managed_settings()
    added = []
    for k, v in top.items():
        if k not in s:
            s[k] = v
            added.append(k)
    try:
        with open(SEED_SETTINGS) as f:
            seed = json.load(f)
    except (OSError, ValueError):
        seed = {}
    for k, v in location_settings(seed).items():
        if s.get(k) == seed.get(k):
            s[k] = v
            added.append(k)
    sdr = ((s.get("sdrs") or {}).get("v4"))
    if isinstance(sdr, dict):
        for k, v in sdr_keys.items():
            if k not in sdr:
                sdr[k] = v
                added.append(f"sdrs.v4.{k}")
        prof = sdr.setdefault("profiles", {})
        new_fm = [k for k in profiles if k.startswith("bcfm-") and k not in prof]
        for k, v in profiles.items():
            if k not in prof:
                prof[k] = v
                added.append(f"sdrs.v4.profiles.{k}")
        # The old gapped FM windows go only when they are exactly the old seed (never edited).
        for k, old in RETIRED_FM.items():
            if k in prof and prof[k] == old and any(x.startswith("bcfm-") for x in prof):
                del prof[k]
                added.append(f"-sdrs.v4.profiles.{k}")
        if new_fm:
            fm_first = {k: prof[k] for k in profiles if k.startswith("bcfm-") and k in prof}
            sdr["profiles"] = {**fm_first, **{k: v for k, v in prof.items() if k not in fm_first}}
    if added:
        tmp = f"{path}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(s, f, indent=4)
        os.replace(tmp, path)
    return added


def background_status(path=None):
    """What background decoding is set to, from the live settings."""
    path = path or os.path.join(DATA, "var", "settings.json")
    try:
        with open(path) as f:
            s = json.load(f)
    except (OSError, ValueError):
        return None
    sdr = (s.get("sdrs") or {}).get("v4") or {}
    sched = (sdr.get("scheduler") or {}).get("schedule") or {}
    names = {k: (v or {}).get("name", k) for k, v in (sdr.get("profiles") or {}).items()}
    return {"enabled": bool(s.get("services_enabled")), "decoders": s.get("services_decoders") or [],
            "schedule": {k: names.get(v, v) for k, v in sched.items()}, "utc": True}


# ---------------------------------------------------------------- bookmarks from the Radio tab

TAG = "Radio tab"          # the descriptions the sync owns start with this
APRS = (144.390, "APRS", "packet", "North American APRS (Web SDR decodes it in the background; the Radio tab's APRS too)")
# Presets whose "busy" peaks are data bursts or hops, not something to tune to by hand.
DATA_PRESETS = {"lora", "mesh", "433", "adsb"}
GRID = {"fm": 0.2, "air": 0.025, "noaa": 0.025, "marine": 0.025, "2m": 0.005, "70cm": 0.0125, "murs": 0.005,
        "rail": 0.015, "gmrs": 0.0125}
BUSY_MAX = 30
BUSY_DAYS = 3


def radio_module():
    """scripts/radio.py as a module (its name tables), or None."""
    if "radio" in sys.modules:
        return sys.modules["radio"]
    if SCRIPTS not in sys.path:
        sys.path.insert(0, SCRIPTS)
    sys.dont_write_bytecode = True
    try:
        import radio
        return radio
    except Exception:
        return None


def fmt_mhz(mhz):
    """133.425, 133.42, 121.0: no trailing zeros past the first decimal."""
    s = f"{mhz:.4f}".rstrip("0")
    return s + "0" if s.endswith(".") else s


def owrx_mod(mhz, mode):
    """OpenWebRX+'s modulation for a frequency and the Radio tab's listen mode. HF digital spots
    (0.4.0) get OpenWebRX+'s own decoder: FT8, WSPR, SSTV, weather fax, NAVTEX."""
    for f, mod in ((7.074, "ft8"), (14.074, "ft8"), (7.0386, "wspr"), (14.0956, "wspr"), (14.23, "sstv"),
                   (7.171, "sstv"), (8.502, "fax"), (0.518, "navtex")):
        if abs(mhz - f) < 0.0015:
            return mod
    if mode in ("wbfm", "fm", "am", "usb", "lsb", "cw"):
        return {"wbfm": "wfm", "fm": "nfm", "am": "am", "usb": "usb", "lsb": "lsb", "cw": "cw"}[mode]
    if abs(mhz - 144.39) < 0.003:
        return "packet"
    if abs(mhz - 906.875) < 0.15:
        return "meshtastic"
    if abs(mhz - 910.525) < 0.15:
        return "meshcore"
    if 433.0 <= mhz <= 435.0:
        return "ism"
    if 1085 <= mhz <= 1095:
        return "adsb"
    return "am" if 108 <= mhz <= 137 else "nfm"


def short_name(name):
    """A bookmark-bar name from a table name: "Marine ch 16 (distress / calling)" -> "Marine ch 16"."""
    s = re.split(r"\s*[(:]", name, maxsplit=1)[0].strip() or name
    if not re.search(r"[A-Za-z]", s):
        s += " ISM" if s.startswith("433") else " MHz"
    return s[:1].upper() + s[1:]


def when_word(at_ms, now_ms):
    """"tonight", "today", "last night", "yesterday" or "on Sat", in local time."""
    t = time.localtime(at_ms / 1000)
    n = time.localtime(now_ms / 1000)
    night = t.tm_hour >= 17 or t.tm_hour < 5
    day_diff = (time.mktime((n.tm_year, n.tm_mon, n.tm_mday, 12, 0, 0, 0, 0, -1)) -
                time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 12, 0, 0, 0, 0, -1))) / 86400
    if now_ms - at_ms < 12 * 3600_000 and night:
        return "tonight"
    if round(day_diff) == 0:
        return "today"
    if round(day_diff) == 1:
        return "last night" if night else "yesterday"
    return "on " + time.strftime("%a", t)


def clock(at_ms):
    return time.strftime("%-I:%M %p", time.localtime(at_ms / 1000)).lower()


def generate_bookmarks(radio, activity, last_scan, now_ms):
    """[(group, bookmark)] from the tab's tables and recent scans. Names come only from
    radio.py's tables (never invented); an unnamed frequency is labelled by itself."""
    out_ = []
    seen = []                                   # MHz already bookmarked

    def near(mhz, tol=0.006):
        return any(abs(mhz - f) <= tol for f in seen)

    def add(group, mhz, name, mod, desc):
        seen.append(mhz)
        out_.append((group, {"name": name, "frequency": int(round(mhz * 1e6)), "modulation": mod,
                             "description": f"{TAG} · {desc}"}))

    for mhz, full in sorted(radio.FM_NAMES.items()):
        add("Stations", mhz, full.split()[0], "wfm", f"{mhz:.1f} {full}, FM broadcast")
    for mhz, _tol, name, mode in radio.SPOTS:
        if not near(mhz):
            add("Notable", mhz, short_name(name), owrx_mod(mhz, mode), f"{fmt_mhz(mhz)} MHz {name}")
    mhz, name, mod, desc = APRS
    if not near(mhz):
        add("Notable", mhz, name, mod, f"{fmt_mhz(mhz)} MHz {desc}")
    for preset, marks in radio.MARKS.items():
        for mhz, _label in marks:
            if near(mhz):
                continue
            name, mode = radio.name_for(mhz, preset)
            if name and "spur" not in name:
                add("Notable", mhz, short_name(name), owrx_mod(mhz, mode), f"{fmt_mhz(mhz)} MHz {name} "
                    f"(marked on the tab's {radio.PRESETS[preset]['label']} scans)")

    # What recent scans and the live view found busy (bursts) or strong (steady, 10 dB+).
    hits = {}
    cutoff = now_ms - BUSY_DAYS * 86_400_000

    def hit(preset, mhz, above, burst, at):
        if preset not in GRID or preset in DATA_PRESETS or at < cutoff:
            return
        if preset == "fm":
            mhz = radio.fm_channel(mhz)
        else:
            mhz = round(round(mhz / GRID[preset]) * GRID[preset], 4)
        if not burst and above < 10:
            return
        h = hits.setdefault((preset, mhz), {"preset": preset, "mhz": mhz, "n": 0, "best": 0.0, "burst": False, "at": 0})
        h["n"] += 1
        h["best"] = max(h["best"], above)
        h["burst"] = h["burst"] or burst
        h["at"] = max(h["at"], at)

    counted = set()                              # (preset, at) of scans already read from activity
    for preset, entries in (activity or {}).items():
        for e in entries or []:
            if e.get("top"):
                counted.add((preset, e.get("at")))
            for row in e.get("top") or []:
                try:
                    hit(preset, float(row[0]), float(row[1]), row[2] == "b", int(e["at"]))
                except (TypeError, ValueError, IndexError, KeyError):
                    continue
    # The last scan's full peak list (scans from before 0.3.2 have no `top`), unless that same
    # scan was just counted from the activity.
    if last_scan and last_scan.get("preset") and last_scan.get("at") and (last_scan["preset"], last_scan["at"]) not in counted:
        for q in last_scan.get("peaks") or []:
            if q.get("comb") or q.get("spur"):
                continue
            hit(last_scan["preset"], float(q["mhz"]), float(q["above"]), q.get("kind") == "burst", int(last_scan["at"]))
    ranked = sorted(hits.values(), key=lambda h: (-(h["n"] + h["best"] / 10), h["mhz"]))
    count = 0
    for h in ranked:
        mhz = h["mhz"]
        if count >= BUSY_MAX or near(mhz, 0.07 if h["preset"] == "fm" else 0.004):
            continue
        name, mode = radio.name_for(mhz, h["preset"])
        if name and "spur" in name:
            continue
        what = "busy" if h["burst"] else "strong"
        word = when_word(h["at"], now_ms)
        label = short_name(name) if name and re.search(r"\d", name) else fmt_mhz(mhz) + (f" {name}" if name else "")
        mode = mode or radio.guess_mode(mhz) or "fm"
        scans = f"{h['n']} {radio.PRESETS[h['preset']]['label']} scan{'s' if h['n'] != 1 else ''}"
        add("Busy lately", mhz, f"{label} · {what} {word}", owrx_mod(mhz, mode),
            f"{what} in {scans}, last at {clock(h['at'])} {word}, up to +{h['best']:.0f} dB over the noise")
        count += 1
    return out_


def legacy_seed():
    """0.3.1's seed bookmarks (config/bookmarks.json): in the live file they are ours, not Seth's."""
    try:
        with open(os.path.join(HERE, "config", "bookmarks.json")) as f:
            return {(b.get("frequency"), b.get("name")) for b in json.load(f)}
    except (OSError, ValueError):
        return set()


def merge_bookmarks(existing, generated, seed_keys):
    """Seth's own bookmarks stay (any not tagged "Radio tab" and not an untouched 0.3.1 seed);
    ours are replaced; where he has one at a frequency, his wins."""
    mine = [b for b in existing if isinstance(b, dict) and not str(b.get("description") or "").startswith(TAG)
            and (b.get("frequency"), b.get("name")) not in seed_keys]
    taken = {b.get("frequency") for b in mine}
    return sorted(mine + [g for g in generated if g["frequency"] not in taken], key=lambda b: b.get("frequency") or 0)


def write_json(path, obj, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=indent, separators=None if indent else (",", ":"))
    os.replace(tmp, path)


def sync_bookmarks():
    radio = radio_module()
    if radio is None:
        return {"ok": False, "error": "radio", "say": "Could not read radio.py's name tables."}
    if not os.path.isdir(os.path.join(DATA, "var")):
        return {"ok": False, "error": "drive", "say": f"{DATA}/var is missing (is the drive that holds it mounted?)."}
    now = int(time.time() * 1000)
    activity = radio.read_json(radio.ACTIVITY, {}) or {}
    last = radio.read_json(radio.LAST_SCAN, None)
    gen = generate_bookmarks(radio, activity, last, now)
    path = os.path.join(DATA, "var", "bookmarks.json")
    try:
        with open(path) as f:
            existing = json.load(f)
        if not isinstance(existing, list):
            existing = []
    except (OSError, ValueError):
        existing = []
    merged = merge_bookmarks(existing, [b for _, b in gen], legacy_seed())
    write_json(path, merged, indent=4)
    groups = {}
    for g, b in gen:
        mhz = b["frequency"] / 1e6
        mode = {"wfm": "wbfm", "nfm": "fm", "am": "am"}.get(b["modulation"])
        groups.setdefault(g, []).append({"name": b["name"], "mhz": round(mhz, 6), "modulation": b["modulation"],
                                         "radio": mode, "description": b["description"][len(TAG) + 3:]})
    write_json(os.path.join(WILDCAT_DATA, "wildcat.json"),
               {"updated": now, "handoffPort": HANDOFF_PORT, "webPort": PORT,
                "groups": [{"title": t, "items": groups[t]} for t in ("Stations", "Notable", "Busy lately") if t in groups]})
    n = {t: len(v) for t, v in groups.items()}
    mine = sum(1 for m in merged if not str(m.get("description") or "").startswith(TAG))
    return {"ok": True, "count": len(merged) - mine, "groups": n, "kept": mine, "path": path,
            "say": f"Bookmarks synced: {n.get('Stations', 0)} stations, {n.get('Notable', 0)} notable, "
                   f"{n.get('Busy lately', 0)} busy lately from recent scans"
                   + (f"; {mine} of your own kept" if mine else "") + "."}


# ---------------------------------------------------------------- verbs

def status():
    pid = read_pid()
    hpid = handoff_pid()
    up = docker_up()
    c = container() if up else None
    cstate = "docker-down" if not up else (c["state"] if c else "absent")
    urls = {}
    for ip, port in (c or {}).get("ports", []):
        if ip in ("127.0.0.1", "localhost"):
            urls["local"] = f"http://localhost:{port}"
        elif ip in ("0.0.0.0", "", None):
            urls["local"] = f"http://localhost:{port}"
            lan = lan_ip()
            if lan:
                urls["lan"] = f"http://{lan}:{port}"
        else:
            urls["lan"] = f"http://{ip}:{port}"
    running = bool(c and c["state"] == "running" and pid)
    if running:
        ts = tailscale_url()
        if ts:
            urls["tailscale"] = ts
    return {
        "running": running,
        "container": cstate,
        "health": (c or {}).get("health"),
        "url": urls.get("lan") or urls.get("local"),
        "urls": urls,
        "port": PORT,
        "rtl_tcp_pid": pid,
        "rtl_tcp": f"127.0.0.1:{RTL_PORT}" if pid else None,
        "lock": "held" if pid else "not held",
        "image": IMAGE,
        "data": DATA,
        "admin": {"user": ADMIN_USER, "keychain_service": KEYCHAIN_SERVICE},
        "map": f"{urls['local']}/map" if running and urls.get("local") else None,
        "handoff": {"port": HANDOFF_PORT, "running": bool(hpid), "pid": hpid},
        "background": background_status(),
    }


SKIN_IN_CONTAINER = "/opt/wildcat-skin/custom.css"   # docker-compose.yml mounts ./skin there


def link_skin(etc=None):
    """/etc/openwebrx/custom.css (what the page's static/css/custom.css is) -> the mounted skin.
    A custom.css of Seth's own (a regular file with something in it) is left alone."""
    path = os.path.join(etc or os.path.join(DATA, "etc"), "custom.css")
    if os.path.islink(path):
        if os.readlink(path) == SKIN_IN_CONTAINER:
            return "linked"
        os.remove(path)
    elif os.path.exists(path):
        if os.path.getsize(path) > 0:
            return "kept your own etc/custom.css"
        os.remove(path)  # an empty one (Docker leaves those behind)
    os.symlink(SKIN_IN_CONTAINER, path)
    return "linked"


def seed():
    """First run only: our settings/bookmarks into the data folder (never overwrites edits)."""
    seeded = []
    for sub in ("etc", "var", "wildcat"):
        os.makedirs(os.path.join(DATA, sub), exist_ok=True)
    for name in ("settings.json", "bookmarks.json"):
        dst = os.path.join(DATA, "var", name)
        try:
            small = os.path.getsize(dst) <= 3  # the image's empty "{}" / "[]" / ""
        except OSError:
            small = True
        if small:
            shutil.copyfile(os.path.join(HERE, "config", name), dst)
            seeded.append(name)
    return seeded


def start():
    parts = DATA.split("/")
    vol = "/".join(parts[:3]) if DATA.startswith("/Volumes/") and len(parts) > 3 else ""
    if vol and not os.path.ismount(vol):
        out({"ok": False, "error": "drive", "say": f"The drive {parts[2]} is not mounted; Web SDR keeps its settings there."})
    st = status()
    if st["running"]:
        if not st["handoff"]["running"]:
            start_handoff(lan_ip())
            st = status()
        out({**st, "ok": True, "say": f"Web SDR is already running at {st['url']}."})
    if not ensure_docker():
        out({"ok": False, "error": "docker", "say": "Docker Desktop did not start (open it and try again)."})
    seeded = seed()
    skin = link_skin()
    added = ensure_settings()
    synced = sync_bookmarks()
    pid, err = start_rtl_tcp()
    if err:
        out(err)
    if st["container"] == "running":
        # rtl_tcp was down under a running container: recreate it so the source reconnects cleanly.
        compose(["down", "--timeout", "10"])
    lan = lan_ip()
    code, so, se = compose(["up", "-d", "--remove-orphans"], lan)
    if code != 0:
        stop_rtl_tcp()  # never leave the dongle locked behind a failed start
        out({"ok": False, "error": "compose", "say": "docker compose up failed: " + (se or so).strip()[-400:]})
    end = time.time() + 90
    while time.time() < end and not http_ok():
        time.sleep(1)
    if not http_ok():
        compose(["down", "--timeout", "10"])
        stop_rtl_tcp()
        out({"ok": False, "error": "web", "say": f"OpenWebRX+ did not answer on port {PORT}; stopped it again."})
    admin = ensure_admin()
    hpid = start_handoff(lan)
    st = status()
    out({**st, "ok": True, "say": f"Web SDR running at {st['url']} (rtl_tcp pid {pid} holds the V4)."
         + ("" if hpid else f" The Send to Radio tab endpoint did not start (see {HANDOFF_LOG})."),
         "seeded": seeded, "skin": skin, "settings_added": added, "bookmarks": synced.get("say"), "admin_user": admin})


def stop():
    stop_handoff()
    down = None
    if docker_up() and container():
        code, so, se = compose(["down", "--timeout", "10"])
        down = code == 0
        if not down:
            run([DOCKER, "rm", "-f", CONTAINER], 30)
            down = container() is None
    pid = stop_rtl_tcp()
    # Confirm the lock is free (a brief non-blocking probe; radio.py retries for 45 s).
    lock = "free"
    try:
        with open(LOCK_PATH, "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(f, fcntl.LOCK_UN)
    except BlockingIOError:
        lock = "held by another radio command"
    except OSError:
        pass
    parts = []
    parts.append("container removed" if down else "container was not running" if down is None else "container stop failed")
    parts.append(f"rtl_tcp {pid} stopped" if pid else "rtl_tcp was not running")
    out({**status(), "ok": down is not False, "say": "Web SDR off: " + ", ".join(parts) + f"; V4 lock {lock}.",
         "rtl_tcp_stopped": pid, "lock": lock})


def main():
    verb = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()
    if verb == "_hold":
        hold()
    elif verb == "start":
        start()
    elif verb == "stop":
        stop()
    elif verb == "status":
        out(status())
    elif verb in ("sync-bookmarks", "sync"):
        out(sync_bookmarks())
    else:
        out({"ok": False, "say": "Usage: webrx.py start | stop | status | sync-bookmarks"}, 2)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Web SDR -> Radio tab handoff: one tiny HTTP endpoint, standard library only.

  POST /handoff   {"mhz": 133.425, "mode": "am"}

The Web SDR page's "Send to Radio tab" button (plugins/receiver/wildcat) posts the frequency
and mode it is tuned to. This server checks them and writes handoff.json into the radio state
folder (RADIO_DIR, else ~/Library/Application Support/radio). That is all it does. The Radio
tab's poll sees the file and runs `radio.py handoff`, which takes it, stops Web SDR through the
normal job system ("Web SDR stopped so the V4 could play 133.425 MHz in the Radio tab"), tunes
the V4 there and plays it on the Mac.

webrx.py starts it with Web SDR and stops it with Web SDR:

  handoff.py serve --port 8074 --web-port 8073 --bind 127.0.0.1 [--bind <LAN address>]

It binds the same addresses as the web UI (never 0.0.0.0).

Security model: LAN-only, no secrets. Anyone who can reach the port can ask the Radio tab to
play a frequency, so the worst a stranger on the home network can do is stop Web SDR (and make
the Mac play a station). It accepts only POST /handoff (plus the browser's CORS preflight for
it) with a JSON body of exactly {mhz, mode}: mhz a number from 24 to 1766, mode one of wbfm,
fm, am, at most 256 bytes. The Origin must be the Web SDR page itself: the same host on the web
UI's port (localhost and 127.0.0.1 count as one host). That keeps any other web page the browser
has open from posting here; it is not authentication. Everything else gets a 4xx and changes
nothing.
"""
import json
import math
import os
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

STATE = os.environ.get("RADIO_DIR") or os.path.join(os.path.expanduser("~"), "Library", "Application Support", "radio")
FILE = "handoff.json"
LO_MHZ = 24.0
HI_MHZ = 1766.0
MODES = ("wbfm", "fm", "am")
MAX_BODY = 256
LOOPBACK = {"localhost", "127.0.0.1", "::1"}
MODE_SAY = {"wbfm": "wide FM", "fm": "narrow FM", "am": "AM"}


def host_of(value):
    """The hostname of a Host header ("192.168.1.29:8074", "[::1]:8074"), lower-cased."""
    try:
        return (urlsplit(f"//{value}").hostname or "").lower()
    except ValueError:
        return ""


def origin_ok(origin, host, web_port):
    """The Web SDR page only: http(s)://<this host>:<web port>."""
    if not origin or not host:
        return False
    try:
        o = urlsplit(origin)
        port = o.port
    except ValueError:
        return False
    if o.scheme not in ("http", "https") or o.path not in ("", "/") or o.query or o.username:
        return False
    if port != web_port:
        return False
    oh = (o.hostname or "").lower()
    hh = host_of(host)
    return bool(oh) and (oh == hh or (oh in LOOPBACK and hh in LOOPBACK))


def parse(body):
    """(data, None) for a valid {mhz, mode}, else (None, why)."""
    try:
        d = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None, "The body must be JSON: {\"mhz\": 133.425, \"mode\": \"am\"}."
    if not isinstance(d, dict) or set(d) != {"mhz", "mode"}:
        return None, "Send exactly {\"mhz\": <number>, \"mode\": \"wbfm\"|\"fm\"|\"am\"}."
    mhz, mode = d["mhz"], d["mode"]
    if isinstance(mhz, bool) or not isinstance(mhz, (int, float)) or not math.isfinite(mhz):
        return None, "mhz must be a number."
    if not LO_MHZ <= mhz <= HI_MHZ:
        return None, f"The V4 tunes {LO_MHZ:g}-{HI_MHZ:g} MHz."
    if mode not in MODES:
        return None, "mode must be wbfm, fm or am (the modes the Radio tab plays)."
    return {"mhz": round(float(mhz), 6), "mode": mode}, None


def check(method, path, headers, body, web_port):
    """The whole decision, without sockets: (status, payload or None, extra headers, data to
    write or None). `headers` is a case-insensitive mapping (http.client.HTTPMessage or a dict
    with the usual capitalisation); `body` is bytes or None."""
    origin = headers.get("Origin")
    allowed = origin_ok(origin, headers.get("Host"), web_port)
    cors = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if allowed else {}

    def fail(code, error, say):
        return code, {"ok": False, "error": error, "say": say}, cors, None

    if path != "/handoff":
        return fail(404, "path", "Only POST /handoff is served here.")
    if method == "OPTIONS":
        if not allowed or (headers.get("Access-Control-Request-Method") or "").upper() != "POST":
            return fail(403, "origin", "Only the Web SDR page may call this.")
        extra = dict(cors, **{"Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type",
                              "Access-Control-Max-Age": "600"})
        if (headers.get("Access-Control-Request-Private-Network") or "").lower() == "true":
            extra["Access-Control-Allow-Private-Network"] = "true"
        return 204, None, extra, None
    if method != "POST":
        return fail(405, "method", "Only POST /handoff is served here.")
    if not allowed:
        return fail(403, "origin", "Only the Web SDR page may call this.")
    if (headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
        return fail(415, "type", "Send JSON (Content-Type: application/json).")
    if body is None:
        return fail(411, "length", "A Content-Length of at most 256 bytes is required.")
    if len(body) > MAX_BODY:
        return fail(413, "size", "The body is too big.")
    data, why = parse(body)
    if not data:
        return fail(400, "invalid", why)
    say = (f"Sent {data['mhz']:g} MHz {MODE_SAY[data['mode']]} to the Radio tab. If the tab is open in "
           "Claude Code, it stops Web SDR and plays it on the Mac in a few seconds.")
    return 202, {"ok": True, "say": say, **data}, cors, data


def write(data, client, origin, state=None):
    """handoff.json, written atomically: {mhz, mode, at (ms), from, origin}."""
    state = state or STATE
    os.makedirs(state, exist_ok=True)
    path = os.path.join(state, FILE)
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
    with open(tmp, "w") as f:
        json.dump({**data, "at": int(time.time() * 1000), "from": client, "origin": origin}, f, separators=(",", ":"))
    os.replace(tmp, path)
    return path


class Handler(BaseHTTPRequestHandler):
    server_version = "wildcat-handoff"
    sys_version = ""
    timeout = 5            # a slow or idle client never ties a thread up for long
    web_port = 8073
    state = None

    def _handle(self):
        body = None
        if self.command == "POST":
            if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
                body = None
            else:
                try:
                    n = int(self.headers.get("Content-Length") or "x")
                except ValueError:
                    n = -1
                if n > MAX_BODY:
                    body = b"x" * (MAX_BODY + 1)  # too big: refused without reading it
                elif n >= 0:
                    body = self.rfile.read(n)
        code, payload, extra, data = check(self.command, self.path, self.headers, body, self.web_port)
        if data is not None:
            try:
                write(data, self.client_address[0], self.headers.get("Origin"), self.state)
            except OSError as err:
                code, payload = 500, {"ok": False, "error": "write", "say": f"Could not write the handoff: {err}"}
        out = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(code)
        for k, v in extra.items():
            self.send_header(k, v)
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        if out and self.command != "HEAD":
            self.wfile.write(out)
        self.close_connection = True

    do_POST = do_OPTIONS = do_GET = do_HEAD = do_PUT = do_DELETE = do_PATCH = _handle

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {self.client_address[0]} {fmt % args}\n")
        sys.stderr.flush()


def serve(binds, port, web_port):
    Handler.web_port = web_port
    servers = []
    for addr in binds:
        srv = ThreadingHTTPServer((addr, port), Handler)
        srv.daemon_threads = True
        servers.append(srv)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(json.dumps({"ok": True, "pid": os.getpid(), "port": port, "binds": binds}), flush=True)
    done = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, lambda *_: done.set())
    done.wait()
    for srv in servers:
        srv.shutdown()
        srv.server_close()


def main(argv):
    if not argv or argv[0] != "serve":
        print("Usage: handoff.py serve --port 8074 --web-port 8073 --bind 127.0.0.1 [--bind <LAN address>]")
        return 2
    port, web_port, binds = 8074, 8073, []
    i = 1
    while i < len(argv) - 1:
        k, v = argv[i], argv[i + 1]
        if k == "--port":
            port = int(v)
        elif k == "--web-port":
            web_port = int(v)
        elif k == "--bind":
            if v in ("0.0.0.0", "::", ""):
                raise SystemExit("Never bind the handoff to every interface; name the web UI's addresses.")
            binds.append(v)
        i += 2
    serve(binds or ["127.0.0.1"], port, web_port)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

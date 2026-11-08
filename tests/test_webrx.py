"""Web SDR's Wildcat RF package without Docker or the V4: the handoff endpoint's input checks,
radio.py's side of the handoff, the bookmark generator, the settings it adds and the skin link.

  python3 -m unittest discover -s tests -p 'test_*.py'

Everything runs in throwaway folders (RADIO_DIR, WEBRX_DATA); nothing touches the real ones.
"""
import http.client
import json
import os
import re
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from shutil import which as shutil_which

# A throwaway state folder unless test_radio.py (run first by discover) already made one.
OWN_STATE = not os.environ.get("RADIO_DIR", "").startswith(tempfile.gettempdir())
if OWN_STATE:
    os.environ["RADIO_DIR"] = tempfile.mkdtemp(prefix="radio-test-")
    os.environ["RADIO_REC_DIR"] = tempfile.mkdtemp(prefix="radio-test-recs-")
DATA = tempfile.mkdtemp(prefix="webrx-test-")
os.environ["WEBRX_DATA"] = DATA
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, os.path.join(HERE, "..", "webrx"))
import radio  # noqa: E402
import handoff  # noqa: E402
import webrx  # noqa: E402

def setUpModule():
    # test_radio.py removes its state folder when it finishes; radio.py's paths still point there.
    os.makedirs(radio.STATE, exist_ok=True)


def tearDownModule():
    import shutil
    shutil.rmtree(DATA, ignore_errors=True)
    if radio.STATE.startswith(tempfile.gettempdir()):   # only ever a throwaway folder
        shutil.rmtree(radio.STATE, ignore_errors=True)


ORIGIN = "http://localhost:8073"
H = {"Origin": ORIGIN, "Host": "localhost:8074", "Content-Type": "application/json"}


def post(body, headers=None):
    raw = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
    return handoff.check("POST", "/handoff", headers or H, raw, 8073)


class HandoffOrigin(unittest.TestCase):
    def test_the_web_sdr_page_on_this_host(self):
        self.assertTrue(handoff.origin_ok("http://localhost:8073", "localhost:8074", 8073))
        self.assertTrue(handoff.origin_ok("http://127.0.0.1:8073", "localhost:8074", 8073))
        self.assertTrue(handoff.origin_ok("http://192.168.1.29:8073", "192.168.1.29:8074", 8073))
        self.assertTrue(handoff.origin_ok("https://my-mac.tail.ts.net:8073", "my-mac.tail.ts.net:8074", 8073))

    def test_anything_else_is_refused(self):
        for origin, host in [
            (None, "localhost:8074"), ("null", "localhost:8074"), ("http://localhost:8073", None),
            ("http://localhost:8080", "localhost:8074"),            # another port on this host
            ("http://localhost", "localhost:8074"),                 # default port
            ("http://evil.example:8073", "localhost:8074"),         # another host
            ("http://192.168.1.40:8073", "192.168.1.29:8074"),    # another machine on the LAN
            ("http://localhost:8073.evil.example", "localhost:8074"),
            ("http://localhost:8073/page", "localhost:8074"),
            ("ftp://localhost:8073", "localhost:8074"),
            ("http://user@localhost:8073", "localhost:8074"),
        ]:
            self.assertFalse(handoff.origin_ok(origin, host, 8073), (origin, host))


class HandoffCheck(unittest.TestCase):
    def test_a_valid_handoff_is_accepted_with_cors(self):
        code, payload, extra, data = post({"mhz": 133.425, "mode": "am"})
        self.assertEqual(code, 202)
        self.assertEqual(data, {"mhz": 133.425, "mode": "am"})
        self.assertTrue(payload["ok"])
        self.assertIn("133.425 MHz AM", payload["say"])
        self.assertEqual(extra["Access-Control-Allow-Origin"], ORIGIN)

    def test_range_edges(self):
        self.assertEqual(post({"mhz": 24, "mode": "fm"})[0], 202)
        self.assertEqual(post({"mhz": 1766, "mode": "fm"})[0], 202)
        self.assertEqual(post({"mhz": 23.999, "mode": "fm"})[0], 400)
        self.assertEqual(post({"mhz": 1766.001, "mode": "fm"})[0], 400)

    def test_bad_bodies(self):
        for body in [{"mhz": 100.1}, {"mode": "wbfm"}, {"mhz": 100.1, "mode": "wbfm", "x": 1},
                     {"mhz": "100.1", "mode": "wbfm"}, {"mhz": True, "mode": "wbfm"}, {"mhz": None, "mode": "am"},
                     {"mhz": 100.1, "mode": "usb"}, {"mhz": 100.1, "mode": "WBFM"}, [100.1, "wbfm"], "100.1"]:
            code, payload, _, data = post(body)
            self.assertEqual(code, 400, body)
            self.assertIsNone(data)
            self.assertFalse(payload["ok"])
        for raw in [b"{", b"\xff\xfe", b'{"mhz": NaN, "mode": "am"}', b'{"mhz": Infinity, "mode": "am"}', b""]:
            self.assertEqual(post(raw)[0], 400, raw)

    def test_only_post_handoff(self):
        self.assertEqual(handoff.check("GET", "/handoff", H, None, 8073)[0], 405)
        self.assertEqual(handoff.check("PUT", "/handoff", H, b"{}", 8073)[0], 405)
        self.assertEqual(handoff.check("DELETE", "/handoff", H, None, 8073)[0], 405)
        self.assertEqual(handoff.check("POST", "/", H, b"{}", 8073)[0], 404)
        self.assertEqual(handoff.check("POST", "/handoff?mhz=1", H, b"{}", 8073)[0], 404)
        self.assertEqual(handoff.check("POST", "/handoff/", H, b"{}", 8073)[0], 404)

    def test_origin_type_length_and_size(self):
        good = json.dumps({"mhz": 100.1, "mode": "wbfm"}).encode()
        self.assertEqual(post(good, {**H, "Origin": "http://evil.example:8073"})[0], 403)
        self.assertEqual(post(good, {k: v for k, v in H.items() if k != "Origin"})[0], 403)
        self.assertEqual(post(good, {**H, "Content-Type": "text/plain"})[0], 415)
        self.assertEqual(post(good, {k: v for k, v in H.items() if k != "Content-Type"})[0], 415)
        self.assertEqual(post(good, {**H, "Content-Type": "application/json; charset=utf-8"})[0], 202)
        self.assertEqual(post(None)[0], 411)
        self.assertEqual(post(b" " * 300)[0], 413)
        # A refused origin gets no CORS headers, so its page cannot even read the refusal.
        self.assertEqual(post(good, {**H, "Origin": "http://evil.example:8073"})[2], {})

    def test_preflight(self):
        pre = {**H, "Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true"}
        code, payload, extra, data = handoff.check("OPTIONS", "/handoff", pre, None, 8073)
        self.assertEqual(code, 204)
        self.assertIsNone(payload)
        self.assertIsNone(data)
        self.assertEqual(extra["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(extra["Access-Control-Allow-Methods"], "POST")
        self.assertEqual(extra["Access-Control-Allow-Headers"], "Content-Type")
        self.assertEqual(extra["Access-Control-Allow-Private-Network"], "true")
        self.assertEqual(handoff.check("OPTIONS", "/handoff", {**pre, "Origin": "http://evil.example"}, None, 8073)[0], 403)
        self.assertEqual(handoff.check("OPTIONS", "/handoff", {**pre, "Access-Control-Request-Method": "PUT"}, None, 8073)[0], 403)


class HandoffServer(unittest.TestCase):
    """The real handler on a loopback port: the plumbing around check() (Content-Length, the file)."""

    @classmethod
    def setUpClass(cls):
        cls.state = tempfile.mkdtemp(prefix="handoff-test-")
        handoff.Handler.state = cls.state
        handoff.Handler.web_port = 8073
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), handoff.Handler)
        cls.port = cls.srv.server_address[1]
        cls._log = sys.stderr
        sys.stderr = open(os.devnull, "w")  # the request log
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        sys.stderr.close()
        sys.stderr = cls._log
        handoff.Handler.state = None

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, dict(r.getheaders()), json.loads(data) if data else None

    def test_post_writes_handoff_json(self):
        hdr = {"Origin": f"http://127.0.0.1:8073", "Content-Type": "application/json"}
        st, headers, payload = self.req("POST", "/handoff", json.dumps({"mhz": 162.55, "mode": "fm"}), hdr)
        self.assertEqual(st, 202)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8073")
        with open(os.path.join(self.state, "handoff.json")) as f:
            d = json.load(f)
        self.assertEqual((d["mhz"], d["mode"], d["from"]), (162.55, "fm", "127.0.0.1"))
        self.assertLess(abs(d["at"] - time.time() * 1000), 10_000)

    def test_refusals_write_nothing(self):
        path = os.path.join(self.state, "handoff.json")
        if os.path.exists(path):
            os.remove(path)
        hdr = {"Origin": "http://127.0.0.1:8073", "Content-Type": "application/json"}
        self.assertEqual(self.req("GET", "/handoff", None, hdr)[0], 405)
        self.assertEqual(self.req("POST", "/handoff", json.dumps({"mhz": 5000, "mode": "fm"}), hdr)[0], 400)
        self.assertEqual(self.req("POST", "/handoff", json.dumps({"mhz": 100.1, "mode": "wbfm"}),
                                  {**hdr, "Origin": "http://example.com"})[0], 403)
        self.assertEqual(self.req("POST", "/handoff", "x" * 1000, hdr)[0], 413)
        self.assertEqual(self.req("POST", "/elsewhere", "{}", hdr)[0], 404)
        self.assertFalse(os.path.exists(path))


class RadioHandoff(unittest.TestCase):
    def write(self, obj):
        with open(radio.HANDOFF, "w") as f:
            f.write(obj if isinstance(obj, str) else json.dumps(obj))

    def tearDown(self):
        radio.handoff_clear()

    def test_fresh_valid_handoff(self):
        now = radio.now_ms()
        self.write({"mhz": 133.425, "mode": "am", "at": now - 2000, "from": "127.0.0.1"})
        h, why = radio.handoff_read(now)
        self.assertIsNone(why)
        self.assertEqual(h, {"mhz": 133.425, "mode": "am", "at": now - 2000})

    def test_stale_invalid_and_missing(self):
        now = radio.now_ms()
        radio.handoff_clear()
        self.assertEqual(radio.handoff_read(now), (None, "none"))
        self.write({"mhz": 133.425, "mode": "am", "at": now - (radio.HANDOFF_MAX_AGE_S + 5) * 1000})
        self.assertEqual(radio.handoff_read(now), (None, "stale"))
        for bad in [{"mhz": 3000, "mode": "am", "at": now}, {"mhz": 100.1, "mode": "usb", "at": now},
                    {"mhz": "100.1", "mode": "wbfm", "at": now}, {"mhz": 100.1, "mode": "wbfm"}, "not json", "[1, 2]"]:
            self.write(bad)
            self.assertEqual(radio.handoff_read(now), (None, "invalid"), bad)

    def test_take_drops_a_stale_one_without_touching_the_v4(self):
        self.write({"mhz": 133.425, "mode": "am", "at": radio.now_ms() - 3_600_000})
        res = radio.handoff_take()
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"], "stale")
        self.assertFalse(os.path.exists(radio.HANDOFF))

    def test_the_reason_names_the_radio_tab(self):
        doing = radio.MODES["listen"].doing
        self.assertEqual(doing({"label": "133.425 MHz", "via": "websdr"}), "play 133.425 MHz in the Radio tab")
        self.assertEqual(doing({"label": "94.1 WNNF"}), "play 94.1 WNNF")


class Activity(unittest.TestCase):
    def test_top_peaks_are_kept_but_not_in_status(self):
        peaks = [{"mhz": 133.425, "above": 20.0, "kind": "burst", "name": None},
                 {"mhz": 121.5, "above": 8.0, "kind": "steady", "name": "aircraft emergency (guard)"},
                 {"mhz": 144.0, "above": 30.0, "kind": "steady", "name": "spur", "spur": True}]
        radio.activity_add("air", peaks, radio.now_ms(), -40.0)
        data = radio.read_json(radio.ACTIVITY, {})
        self.assertEqual(data["air"][-1]["top"], [[133.425, 20.0, "b"], [121.5, 8.0, "s"]])
        self.assertNotIn("top", radio.activity_summary()["air"])


def local_ms(y, mo, d, h, mi):
    return int(time.mktime((y, mo, d, h, mi, 0, 0, 0, -1)) * 1000)


class Bookmarks(unittest.TestCase):
    NOW = local_ms(2026, 10, 5, 22, 0)

    def gen(self, activity=None, last=None):
        return webrx.generate_bookmarks(radio, activity or {}, last, self.NOW)

    def table_names(self):
        names = {full.split()[0] for full in radio.FM_NAMES.values()}
        names |= {webrx.short_name(n) for _, _, n, _ in radio.SPOTS}
        names |= {webrx.APRS[1]}
        for preset, marks in radio.MARKS.items():
            for mhz, _ in marks:
                n, _ = radio.name_for(mhz, preset)
                if n:
                    names.add(webrx.short_name(n))
        return names

    def test_tables_give_stations_and_notable_frequencies(self):
        out = self.gen()
        groups = {g for g, _ in out}
        self.assertEqual(groups, {"Stations", "Notable"})
        by = {b["frequency"]: b for _, b in out}
        self.assertEqual(by[102_700_000]["name"], "WEBN")
        self.assertEqual(by[102_700_000]["modulation"], "wfm")
        for mhz, mod in [(162.55, "nfm"), (121.5, "am"), (146.52, "nfm"), (156.8, "nfm"), (156.65, "nfm"),
                         (144.39, "packet"), (906.875, "meshtastic"), (910.525, "meshcore")]:
            self.assertIn(int(round(mhz * 1e6)), by, mhz)
            self.assertEqual(by[int(round(mhz * 1e6))]["modulation"], mod, mhz)
        self.assertEqual(by[162_550_000]["name"], "NOAA KIH42 Covington")
        self.assertEqual(by[156_800_000]["name"], "Marine ch 16")
        for _, b in out:
            self.assertTrue(b["description"].startswith("Radio tab · "))
        self.assertEqual(len(by), len(out), "one bookmark per frequency")

    def test_names_only_come_from_the_tables(self):
        allowed = self.table_names()
        act = {"air": [{"at": self.NOW - 600_000, "top": [[133.4219, 20.0, "b"], [119.1, 14.0, "s"]]}],
               "2m": [{"at": self.NOW - 600_000, "top": [[146.94, 12.0, "b"]]}]}
        for g, b in self.gen(act):
            if g == "Busy lately":
                self.assertRegex(b["name"], r"^\d+\.\d+( |$)| · ")
                head = b["name"].split(" · ")[0]
                self.assertTrue(re.match(r"^\d+\.\d+", head) or head in allowed, b["name"])
            else:
                self.assertIn(b["name"], allowed)
            # A call sign anywhere must be one from FM_NAMES or SPOTS.
            for cs in re.findall(r"\b[KW][A-Z]{2,3}\d*\b", b["name"]):
                self.assertTrue(any(cs in s for s in list(radio.FM_NAMES.values()) + [x[2] for x in radio.SPOTS]), cs)

    def test_busy_and_strong_from_recent_scans(self):
        act = {
            "air": [{"at": local_ms(2026, 10, 5, 21, 42), "top": [[133.4219, 20.0, "b"], [119.1, 14.0, "s"], [128.0, 6.0, "s"]]}],
            "2m": [{"at": self.NOW - 600_000, "top": [[144.0, 25.0, "s"], [146.88, 15.0, "b"]]}],   # spur; a named repeater
            "lora": [{"at": self.NOW - 600_000, "top": [[903.1, 30.0, "b"]]}],                     # data bursts: no
            "marine": [{"at": self.NOW - 5 * 86_400_000, "top": [[157.0, 20.0, "b"]]}],              # too old
        }
        last = {"preset": "air", "at": self.NOW - 300_000,
                "peaks": [{"mhz": 133.425, "above": 18.0, "kind": "burst"}, {"mhz": 134.0, "above": 30, "kind": "steady", "comb": True}]}
        busy = {b["frequency"]: b for g, b in self.gen(act, last) if g == "Busy lately"}
        self.assertEqual(busy[133_425_000]["name"], "133.425 · busy tonight")
        self.assertEqual(busy[133_425_000]["modulation"], "am")
        self.assertIn("busy in 2 Aircraft scans, last at 9:55 pm tonight, up to +20 dB", busy[133_425_000]["description"])
        self.assertEqual(busy[119_100_000]["name"], "119.1 · strong tonight")
        self.assertNotIn(128_000_000, busy)          # steady and weak
        self.assertNotIn(134_000_000, busy)          # a comb mark
        self.assertNotIn(144_000_000, busy)          # the V4's own spur
        self.assertNotIn(146_880_000, busy)          # already bookmarked by name (SKYWARN)
        self.assertNotIn(903_100_000, busy)
        self.assertNotIn(157_000_000, busy)

    def test_one_scan_counts_once(self):
        at = self.NOW - 600_000
        act = {"air": [{"at": at, "top": [[133.425, 20.0, "b"]]}]}
        last = {"preset": "air", "at": at, "peaks": [{"mhz": 133.425, "above": 20.0, "kind": "burst"}]}
        busy = {b["frequency"]: b for g, b in self.gen(act, last) if g == "Busy lately"}
        self.assertIn("busy in 1 Aircraft scan,", busy[133_425_000]["description"])

    def test_when_words(self):
        self.assertEqual(webrx.when_word(local_ms(2026, 10, 5, 21, 0), self.NOW), "tonight")
        self.assertEqual(webrx.when_word(local_ms(2026, 10, 5, 10, 0), self.NOW), "today")
        self.assertEqual(webrx.when_word(local_ms(2026, 10, 4, 22, 0), self.NOW), "last night")
        self.assertEqual(webrx.when_word(local_ms(2026, 10, 4, 13, 0), self.NOW), "yesterday")
        self.assertEqual(webrx.when_word(local_ms(2026, 10, 3, 13, 0), self.NOW), "on Sat")

    def test_merge_keeps_seths_own_and_replaces_ours(self):
        seed = {(146_520_000, "2m calling")}
        existing = [
            {"name": "2m calling", "frequency": 146_520_000, "modulation": "nfm"},              # untouched 0.3.1 seed: ours
            {"name": "My net", "frequency": 147_225_000, "modulation": "nfm"},                 # his
            {"name": "Old busy", "frequency": 133_000_000, "modulation": "am", "description": "Radio tab · busy"},  # ours
            {"name": "KIH42!", "frequency": 162_550_000, "modulation": "nfm", "description": "mine"},  # his, same freq as ours
        ]
        gen = [{"name": "2 m calling", "frequency": 146_520_000, "modulation": "nfm", "description": "Radio tab · x"},
               {"name": "NOAA KIH42 Covington", "frequency": 162_550_000, "modulation": "nfm", "description": "Radio tab · y"}]
        out = webrx.merge_bookmarks(existing, gen, seed)
        names = [b["name"] for b in out]
        self.assertEqual(names, ["2 m calling", "My net", "KIH42!"])

    def test_sync_writes_both_files(self):
        os.makedirs(os.path.join(DATA, "var"), exist_ok=True)
        with open(os.path.join(DATA, "var", "bookmarks.json"), "w") as f:
            json.dump([{"name": "Mine", "frequency": 147_225_000, "modulation": "nfm"}], f)
        res = webrx.sync_bookmarks()
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["kept"], 1)
        with open(os.path.join(DATA, "var", "bookmarks.json")) as f:
            live = json.load(f)
        self.assertIn("Mine", [b["name"] for b in live])
        self.assertIn("WEBN", [b["name"] for b in live])
        with open(os.path.join(DATA, "wildcat", "wildcat.json")) as f:
            panel = json.load(f)
        self.assertEqual(panel["handoffPort"], webrx.HANDOFF_PORT)
        self.assertEqual([g["title"] for g in panel["groups"]][:2], ["Stations", "Notable"])
        webn = next(i for i in panel["groups"][0]["items"] if i["name"] == "WEBN")
        self.assertEqual((webn["mhz"], webn["radio"]), (102.7, "wbfm"))


class Settings(unittest.TestCase):
    def test_missing_keys_are_added_and_edits_kept(self):
        path = os.path.join(tempfile.mkdtemp(prefix="webrx-settings-"), "settings.json")
        with open(path, "w") as f:
            json.dump({"version": 8, "services_enabled": False,
                       "sdrs": {"v4": {"profiles": {"2m-aprs": {"name": "2 m"}}}}}, f)
        added = webrx.ensure_settings(path)
        with open(path) as f:
            s = json.load(f)
        self.assertFalse(s["services_enabled"])                       # his choice stays
        self.assertNotIn("services_enabled", added)
        self.assertEqual(s["services_decoders"], ["packet", "ism"])
        self.assertEqual(s["sdrs"]["v4"]["scheduler"]["schedule"], {"1000-0400": "2m-aprs", "0400-1000": "ism433"})
        self.assertEqual(s["sdrs"]["v4"]["profiles"]["ism433"]["start_freq"], 433_920_000)
        self.assertEqual(s["waterfall_scheme"], "CustomWaterfall")
        self.assertEqual(s["waterfall_colors"][0], 0x080B18)          # the tab's near-black floor
        self.assertEqual(webrx.ensure_settings(path), [])              # nothing more to add

    def test_seed_settings_carry_the_schedule(self):
        with open(os.path.join(HERE, "..", "webrx", "config", "settings.json")) as f:
            s = json.load(f)
        sdr = s["sdrs"]["v4"]
        for profile in sdr["scheduler"]["schedule"].values():
            self.assertIn(profile, sdr["profiles"])
        self.assertTrue(s["services_enabled"])


class Skin(unittest.TestCase):
    def test_link_skin(self):
        etc = tempfile.mkdtemp(prefix="webrx-etc-")
        path = os.path.join(etc, "custom.css")
        self.assertEqual(webrx.link_skin(etc), "linked")
        self.assertEqual(os.readlink(path), webrx.SKIN_IN_CONTAINER)
        self.assertEqual(webrx.link_skin(etc), "linked")
        os.remove(path)
        open(path, "w").close()                                       # an empty one Docker left
        self.assertEqual(webrx.link_skin(etc), "linked")
        os.remove(path)
        with open(path, "w") as f:
            f.write("body { color: red }")
        self.assertEqual(webrx.link_skin(etc), "kept your own etc/custom.css")
        self.assertFalse(os.path.islink(path))


WEBRX_DIR = os.path.join(HERE, "..", "webrx")
PLUGIN_JS = os.path.join(WEBRX_DIR, "plugins", "receiver", "wildcat", "wildcat.js")


def css_rules(text):
    """(selectors, body) for each rule, comments dropped, @media blocks flattened."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"@media[^{]*\{", "", text)
    return [(m.group(1).strip(), m.group(2)) for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", text)]


class Package(unittest.TestCase):
    """0.3.3's regressions, read from the files the container serves."""

    def test_buttons_keep_the_stock_box_model(self):
        # 0.3.2 gave .openwebrx-button a border and box-sizing: border-box, which squeezed every
        # mode key to 19 px (labels spilled out, rows overlapped, DIG half covered).
        with open(os.path.join(WEBRX_DIR, "skin", "custom.css")) as f:
            rules = css_rules(f.read())
        hits = [(sel, body) for sel, body in rules
                if any(re.search(r"\.openwebrx-(demodulator-)?button(?![\w-])", s) for s in sel.split(","))]
        self.assertTrue(hits)
        for sel, body in hits:
            self.assertNotIn("box-sizing", body, sel)
            if "plugin-header" not in sel:
                self.assertIsNone(re.search(r"(^|;)\s*border(-width)?\s*:", body), sel)

    def test_plugin_never_writes_location_hash(self):
        with open(PLUGIN_JS) as f:
            js = re.sub(r"^\s*//.*$", "", re.sub(r"/\*.*?\*/", "", f.read(), flags=re.S), flags=re.M)
        self.assertIn("DemodulatorPanel.prototype.updateHash", js)
        self.assertIn("history.replaceState", js)
        self.assertIsNone(re.search(r"location\.hash\s*=[^=]", js))

    def test_init_loads_only_the_local_plugin(self):
        with open(os.path.join(WEBRX_DIR, "plugins", "receiver", "init.js")) as f:
            code = [ln for ln in f.read().splitlines() if ln.strip() and not ln.strip().startswith("//")]
        self.assertEqual(code, ["Plugins.load('wildcat');"])

    @unittest.skipUnless(shutil_which("node"), "node is not installed")
    def test_hash_fix_in_a_browser_shim(self):
        # Runs wildcat.js against a stand-in DemodulatorPanel: the tuning goes into the address
        # with history.replaceState (no page load on iOS), in the stock format, and an unchanged
        # tuning writes nothing.
        harness = r"""
        const fs = require('fs');
        const calls = [];
        global.window = global;
        global.location = { hash: '', set href(v) { throw new Error('navigated'); } };
        global.history = { state: null, replaceState: (s, t, url) => { calls.push(url); location.hash = url; } };
        global.Plugins = { wildcat: {} };
        global.DemodulatorPanel = function () {};
        DemodulatorPanel.prototype.updateHash = function () { throw new Error('stock updateHash ran'); };
        eval(fs.readFileSync(process.argv[1], 'utf8'));
        const demod = { get_offset_frequency: () => -610000, get_modulation: () => 'nfm',
                        get_secondary_demod: () => 'packet', getSquelch: () => -150 };
        const panel = new DemodulatorPanel();
        panel.center_freq = 145000000;
        panel.getDemodulator = () => demod;
        panel.updateHash();
        panel.updateHash();
        demod.get_secondary_demod = () => false;
        panel.updateHash();
        console.log(JSON.stringify(calls));
        """
        import subprocess
        out = subprocess.run(["node", "-e", harness, PLUGIN_JS], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout.strip().splitlines()[-1]),
                         ["#freq=144390000,mod=nfm,secondary_mod=packet,sql=-150",
                          "#freq=144390000,mod=nfm,sql=-150"])


if __name__ == "__main__":
    unittest.main()

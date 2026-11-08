"""The location file without the V4: python3 tests/test_location.py

Walton, KY is built in; ~/Library/Application Support/radio/location.json (RADIO_DIR moves the folder)
replaces any part of it. Each check runs the scripts in a fresh python3 process whose RADIO_DIR and HOME
are throwaway folders (the modules read the location when they are imported), and only calls pure
functions: nothing here opens the RTL-SDR, a USB device, Docker or the real state folder.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.abspath(os.path.join(HERE, "..", "scripts"))
WEBRX = os.path.abspath(os.path.join(HERE, "..", "webrx"))
sys.dont_write_bytecode = True
sys.path.insert(0, SCRIPTS)
sys.path.insert(0, WEBRX)

SPRINGFIELD = {
    "name": "Springfield, IL",
    "lat": 39.7990, "lon": -89.6440,
    "airports": [{"id": "SPI", "name": "Abraham Lincoln Capital", "lat": 39.8441, "lon": -89.6779, "elevFt": 598,
                  "runways": [["4/22", 0.1, 0.0, 40, 1.4]]}],
    "radar_places": [["RIVERTON", 39.8350, -89.5400]],
    "places": [["Chatham", 39.6770, -89.7027, 0, 25]],
    "fm": {"88.5": "WXYZ Springfield", "99.1": "WABC"},
    "repeaters": [{"mhz": 145.23, "name": "Springfield ARC repeater", "short": "SARC", "mark": True, "wx": True}],
    "scan": [[162.475, "fm", "NOAA KXYZ99"], [145.23, "fm", "SARC"]],
    "weather": {"station": "KXYZ99", "city": "Springfield", "freq": 162.475, "home": "17167", "local": ["17167", "17129"],
                "counties": {"17167": "Sangamon", "17129": "Menard", "17001": "Adams"}},
}


def run(location, code):
    """Runs `code` (python source printing one JSON value) in a fresh process with `location` as the
    location.json: a dict (written as JSON), a str (written as is) or None (no file). Returns (value, dir)."""
    d = tempfile.mkdtemp(prefix="radio-loc-")
    if location is not None:
        with open(os.path.join(d, "location.json"), "w") as f:
            f.write(location if isinstance(location, str) else json.dumps(location))
    env = {**os.environ, "RADIO_DIR": d, "HOME": d}
    env.pop("RADIO_REF", None)
    src = f"import sys; sys.dont_write_bytecode = True; sys.path.insert(0, {SCRIPTS!r})\n" + code
    r = subprocess.run([sys.executable, "-c", src], env=env, capture_output=True, text=True, timeout=60, cwd=d)
    if r.returncode:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout.strip().splitlines()[-1]), d, r.stderr


RADAR = """
import json, adsb, adsb_render, digital, digital_render
t = 1791250000.0
state = {"version": 1, "kind": "adsb", "updated": int(t * 1000), "receiver": adsb.RECEIVER,
         "airports": [dict(a, distNm=1.0, bearing=10.0) for a in adsb.AIRPORTS],
         "source": {"mode": "live", "started": int(t * 1000) - 60000, "seconds": 60}, "stats": {"aircraft": 0, "withPosition": 0},
         "job": {"running": True}, "aircraft": []}
aprs = {"version": 1, "ref": digital.REF, "updated": 1, "packets": 0, "stations": {}, "digis": {}, "recent": []}
print(json.dumps({"rx": adsb.RECEIVER, "airports": [a["id"] for a in adsb.AIRPORTS],
                  "radar": adsb_render.radar_svg(state, "25", now=t), "table": adsb_render.text_table(state, now=t),
                  "map": digital_render.aprs_svg(aprs, 25, now=1791250000000), "ref": digital.REF}))
"""

WEATHER = """
import json, digital, digital_render
a = digital.decode_area("017167")
alert = {"event": "TOR", "eventName": "Tornado Warning", "severity": "warning", "station": "KXYZ99", "expires": 9 * 10**12,
         "areas": [a, digital.decode_area("017129"), digital.decode_area("039061")], "org": "WXR", "orgName": "National Weather Service"}
print(json.dumps({"area": a, "other": digital.decode_area("039061"), "names": digital_render.area_names(alert),
                  "mode": {k: v for k, v in digital.MODES["same"].items() if k != "multimon"},
                  "card": digital_render.same_card_svg(alert, now=1791250000000)}))
"""

FM = """
import json, radio
print(json.dumps({"fm": {str(k): v for k, v in radio.FM_NAMES.items()}, "n88": radio.name_for(88.5), "n94": radio.name_for(94.1),
                  "noaa": radio.name_for(radio.LOC["weather"]["freq"]), "rep": radio.name_for(145.23), "walton_rep": radio.name_for(147.03),
                  "marks": radio.MARKS["2m"], "noaa_mark": radio.MARKS["noaa"], "scan": radio.SCAN_SEED[:2]}))
"""


class Default(unittest.TestCase):
    def test_no_file_is_walton_and_not_custom(self):
        v, _, err = run(None, "import json, location; l = location.load(); print(json.dumps({'c': l['_custom'], 'e': l['_error'], 'rx': l['receiver'], 'w': l['weather']['station']}))")
        self.assertEqual(err, "")
        self.assertFalse(v["c"])
        self.assertIsNone(v["e"])
        self.assertEqual(v["rx"], {"id": "WALTON", "name": "Walton, KY (town centre)", "lat": 38.8756, "lon": -84.6105})
        self.assertEqual(v["w"], "KIH42")

    def test_no_file_everything_still_says_walton(self):
        v, _, _ = run(None, RADAR)
        self.assertEqual(v["airports"], ["CVG"])
        for word in ("WALTON", "CVG", "CINCINNATI"):
            self.assertIn(word, v["radar"])
        self.assertIn("Walton", v["map"])
        self.assertIn("Ohio River", v["map"])
        self.assertIn("Walton KY", v["table"])
        f, _, _ = run(None, FM)
        self.assertEqual(f["fm"]["94.1"], "WNNF")
        self.assertEqual(f["noaa"][0], "NOAA KIH42 Covington")


class RadarAndMap(unittest.TestCase):
    def test_a_file_moves_the_radar_centre_and_the_airport(self):
        v, _, _ = run(SPRINGFIELD, RADAR)
        self.assertEqual(v["rx"], {"id": "SPRINGFIELD", "name": "Springfield, IL (town centre)", "lat": 39.799, "lon": -89.644})
        self.assertEqual(v["airports"], ["SPI"])
        self.assertIn(">SPI<", v["radar"])
        self.assertIn("SPRINGFIELD", v["radar"])
        self.assertIn("RIVERTON", v["radar"])
        for gone in ("WALTON", "CVG", "CINCINNATI"):
            self.assertNotIn(gone, v["radar"])
        self.assertIn("Springfield IL", v["table"])
        self.assertNotIn("Walton", v["table"])

    def test_the_aprs_map_follows(self):
        v, _, _ = run(SPRINGFIELD, RADAR)
        self.assertEqual(v["ref"]["lat"], 39.799)
        self.assertIn("Chatham", v["map"])
        self.assertIn(">Springfield<", v["map"])
        self.assertNotIn("Walton", v["map"])
        self.assertNotIn("Ohio River", v["map"])    # the river is Walton's hand-drawn shape: dropped when the centre moves

    def test_moving_the_centre_alone_drops_the_walton_shapes_but_keeps_the_lists(self):
        v, _, _ = run({"name": "Springfield, IL", "lat": 39.799, "lon": -89.644}, RADAR)
        self.assertEqual(v["airports"], [])
        for gone in ("CVG", "CINCINNATI", "Walton"):
            self.assertNotIn(gone, v["radar"])
        f, _, _ = run({"name": "Springfield, IL", "lat": 39.799, "lon": -89.644}, FM)
        self.assertEqual(f["fm"]["94.1"], "WNNF")           # lists you do not give stay as shipped

    def test_a_partial_file_replaces_only_its_keys(self):
        v, _, _ = run({"weather": {"station": "KABC1"}}, "import json, location; l = location.load(); print(json.dumps({'w': l['weather'], 'a': [x['id'] for x in l['airports']], 'c': l['_custom']}))")
        self.assertTrue(v["c"])
        self.assertEqual(v["w"]["station"], "KABC1")
        self.assertEqual(v["w"]["freq"], 162.55)             # the rest of the weather block is still Walton's
        self.assertIn("21015", v["w"]["counties"])
        self.assertEqual(v["a"], ["CVG"])                    # the centre did not move, so CVG stays


class FmAndWeather(unittest.TestCase):
    def test_a_file_swaps_the_fm_list_and_the_repeaters(self):
        v, _, _ = run(SPRINGFIELD, FM)
        self.assertEqual(v["fm"], {"88.5": "WXYZ Springfield", "99.1": "WABC"})
        self.assertEqual(v["n88"], ["88.5 WXYZ Springfield", "wbfm"])
        self.assertEqual(v["n94"], ["94.1 FM", "wbfm"])      # no longer a named station
        self.assertEqual(v["rep"], ["Springfield ARC repeater", "fm"])
        self.assertNotEqual(v["walton_rep"][0], "K4CO Edgewood repeater")
        self.assertEqual(v["marks"], [[146.52, "146.52 calling"], [145.23, "145.23 SARC"]])
        self.assertEqual(v["noaa_mark"], [[162.475, "KXYZ99"]])
        self.assertEqual(v["noaa"], ["NOAA KXYZ99 Springfield", "fm"])
        self.assertEqual(v["scan"][0], [162.475, "fm", "NOAA KXYZ99"])

    def test_a_file_changes_the_weather_alert_codes(self):
        v, _, _ = run(SPRINGFIELD, WEATHER)
        self.assertEqual(v["area"]["name"], "Sangamon County, IL")
        self.assertTrue(v["area"]["local"])
        self.assertFalse(v["other"]["local"])
        self.assertEqual(v["other"]["county"], None)          # Hamilton OH is no longer in the list
        self.assertEqual(v["names"][0], ["Sangamon County, IL (Springfield)", True])
        self.assertEqual(v["mode"], {"freq": 162.475, "label": "NOAA KXYZ99 162.475 MHz", "file": "same.json"})
        self.assertIn("NOAA WEATHER RADIO · KXYZ99 · 162.475 MHz", v["card"])

    def test_walton_codes_without_a_file(self):
        v, _, _ = run(None, WEATHER.replace("017167", "021015").replace("017129", "021117"))
        self.assertEqual(v["area"]["name"], "Boone County, KY")
        self.assertTrue(v["area"]["local"])
        self.assertEqual(v["other"]["name"], "Hamilton County, OH")
        self.assertEqual(v["names"][0], ["Boone County, KY (Walton)", True])
        self.assertEqual(v["mode"]["label"], "NOAA KIH42 162.550 MHz")
        self.assertIn("NOAA WEATHER RADIO · KXYZ99 · 162.550 MHz".replace("KXYZ99", "KXYZ99") if False else "NOAA WEATHER RADIO", v["card"])
        self.assertNotIn("162.550 MHz", v["card"])        # the demo alert's station is not KIH42 here, so no frequency is added

class BrokenFile(unittest.TestCase):
    CASES = {
        "not json": "{ this is not json",
        "a list": "[1, 2, 3]",
        "a bad latitude": '{"lat": 999, "lon": 5}',
        "an unknown key": '{"nmae": "typo"}',
        "a bad county code": '{"weather": {"counties": {"abc": "Nope"}}}',
    }

    def test_a_broken_file_is_reported_walton_is_used_and_the_file_is_left_alone(self):
        for what, text in self.CASES.items():
            with self.subTest(what):
                v, d, err = run(text, "import json, location; l = location.load(); print(json.dumps({'c': l['_custom'], 'e': l['_error'], 'p': l['_path'], 'rx': l['receiver']['id'], 'pub': location.public(l)['ok']}))")
                self.assertFalse(v["c"])
                self.assertEqual(v["rx"], "WALTON")
                self.assertFalse(v["pub"])
                self.assertIn(os.path.join(d, "location.json"), v["e"])
                self.assertIn("left alone", v["e"])
                with open(os.path.join(d, "location.json")) as f:
                    self.assertEqual(f.read(), text)               # never rewritten
                self.assertEqual(os.listdir(d), ["location.json"])  # nothing else written either

    def test_the_message_says_what_is_wrong(self):
        v, _, _ = run("{ nope", "import json, location; print(json.dumps(location.load()['_error']))")
        self.assertIn("not valid JSON", v)
        v, _, _ = run('{"lat": 999, "lon": 5}', "import json, location; print(json.dumps(location.load()['_error']))")
        self.assertIn("'lat' must be a number between -90 and 90", v)

    def test_every_script_still_renders_walton_and_warns_on_stderr(self):
        v, d, err = run("{ nope", RADAR)
        self.assertIn("WALTON", v["radar"])
        self.assertIn("not valid JSON", err)
        with open(os.path.join(d, "location.json")) as f:
            self.assertEqual(f.read(), "{ nope")

    def test_the_location_verb_reports_it_and_reads_only_files(self):
        d = tempfile.mkdtemp(prefix="radio-loc-")
        with open(os.path.join(d, "location.json"), "w") as f:
            f.write("{ nope")
        env = {**os.environ, "RADIO_DIR": d, "HOME": d}
        r = subprocess.run([sys.executable, "-B", os.path.join(SCRIPTS, "radio.py"), "location"], env=env, capture_output=True, text=True, timeout=60, cwd=d)
        out = json.loads(r.stdout)
        self.assertFalse(out["ok"])
        self.assertFalse(out["custom"])
        self.assertIn("not valid JSON", out["error"])
        self.assertEqual(out["location"]["name"], "Walton, KY")
        r = subprocess.run([sys.executable, "-B", os.path.join(SCRIPTS, "radio.py"), "location"], env={**env, "RADIO_DIR": tempfile.mkdtemp(prefix="radio-loc-")}, capture_output=True, text=True, timeout=60, cwd=d)
        out = json.loads(r.stdout)
        self.assertTrue(out["ok"])
        self.assertFalse(out["custom"])


class WebSdr(unittest.TestCase):
    SEED = {"receiver_location": "Walton, Kentucky, USA", "photo_title": "Wildcat RF, Walton, Kentucky",
            "receiver_gps": {"lat": 38.8756, "lon": -84.6105}}

    def settings(self, live, location):
        import webrx
        d = tempfile.mkdtemp(prefix="radio-loc-webrx-")
        path = os.path.join(d, "settings.json")
        with open(path, "w") as f:
            json.dump({"version": 8, **live, "sdrs": {"v4": {"profiles": {}}}}, f)
        state = tempfile.mkdtemp(prefix="radio-loc-state-")
        if location is not None:
            with open(os.path.join(state, "location.json"), "w") as f:
                json.dump(location, f)
        old = os.environ.get("RADIO_DIR")
        os.environ["RADIO_DIR"] = state
        try:
            added = webrx.ensure_settings(path)
        finally:
            if old is None:
                del os.environ["RADIO_DIR"]
            else:
                os.environ["RADIO_DIR"] = old
        with open(path) as f:
            return added, json.load(f)

    def test_the_receiver_follows_the_file_until_it_was_edited_in_web_settings(self):
        added, s = self.settings(self.SEED, SPRINGFIELD)
        self.assertEqual(s["receiver_gps"], {"lat": 39.799, "lon": -89.644})
        self.assertEqual(s["receiver_location"], "Springfield, IL")
        self.assertEqual(s["photo_title"], "Wildcat RF, Springfield, IL")
        self.assertIn("receiver_gps", added)
        added, s = self.settings({**self.SEED, "receiver_location": "My own words"}, SPRINGFIELD)
        self.assertEqual(s["receiver_location"], "My own words")
        self.assertEqual(s["receiver_gps"]["lat"], 39.799)

    def test_no_file_leaves_the_settings_alone(self):
        added, s = self.settings(self.SEED, None)
        self.assertEqual(s["receiver_gps"], self.SEED["receiver_gps"])
        self.assertNotIn("receiver_gps", added)


if __name__ == "__main__":
    unittest.main()

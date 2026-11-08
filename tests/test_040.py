"""0.4.0 ("beat SDR++") without the V4: the Scanner's rules, IQ snapshot naming and retention,
HF preset gating, SSB/CW tuning, PPM. python3 -m unittest discover -s tests -p 'test_*.py'

Runs against throwaway folders (RADIO_DIR / RADIO_REC_DIR / RADIO_IQ_DIR), never the real ones,
and opens no device. radio is imported once per process (test_radio.py may have done it first),
so the IQ root is pointed at a fresh temp folder per test rather than trusted from the environment.
"""
import json
import math
import os
import sys
import tempfile
import time
import unittest

os.environ.setdefault("RADIO_DIR", tempfile.mkdtemp(prefix="radio-040-state-"))
os.environ.setdefault("RADIO_REC_DIR", tempfile.mkdtemp(prefix="radio-040-recs-"))
os.environ["RADIO_IQ_DIR"] = tempfile.mkdtemp(prefix="radio-040-iq-")
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import radio  # noqa: E402


def fresh_state():
    """A clean state folder for one test (the module's STATE paths are rebound to it)."""
    d = tempfile.mkdtemp(prefix="radio-040-")
    for name in ("SETTINGS", "HF", "SCANNER", "SCANNER_CONF", "ACTIVITY", "REC_CONF"):
        setattr(radio, name, os.path.join(d, os.path.basename(getattr(radio, name))))
    return d


class ScannerRules(unittest.TestCase):
    def setUp(self):
        fresh_state()

    def test_seed_has_the_required_stations_and_the_busy_airband_peaks(self):
        radio.write_json(radio.ACTIVITY, {"air": [{"at": 1, "n": 3, "best": 20, "bursts": 2, "named": [], "floor": -30,
                                                   "top": [[133.425, 18.0, "b"], [124.0, 12.0, "b"], [500.0, 30.0, "s"]]}]})
        chans = radio.seed_favourites()
        freqs = {c["freq"] for c in chans}
        for f in (162.55, 146.52, 147.03, 147.255, 146.79, 146.88, 156.8, 156.65, 121.5):
            self.assertIn(f, freqs)
        self.assertIn(133.425, freqs)                 # the busiest airband peaks come along, as AM
        self.assertEqual(next(c for c in chans if c["freq"] == 133.425)["mode"], "am")
        self.assertNotIn(500.0, freqs)                # only peaks inside the airband
        noaa = next(c for c in chans if c["freq"] == 162.55)
        self.assertEqual(noaa["squelch"], 0)          # a broadcast gets no squelch; voice channels 40
        self.assertEqual(next(c for c in chans if c["freq"] == 146.52)["squelch"], 40)

    def test_conf_seeds_itself_once_and_add_remove_persist(self):
        c = radio.scanner_conf()
        self.assertTrue(os.path.exists(radio.SCANNER_CONF))
        n = len(c["channels"])
        ch = radio.scan_add(146.46, "fm", "test repeater")
        self.assertEqual((ch["freq"], ch["mode"], ch["name"], ch["squelch"]), (146.46, "fm", "test repeater", 40))
        self.assertEqual(len(radio.scanner_conf()["channels"]), n + 1)
        radio.scan_add(146.46, "fm", "renamed")       # the same frequency replaces, never duplicates
        self.assertEqual(len(radio.scanner_conf()["channels"]), n + 1)
        self.assertEqual(next(c for c in radio.scanner_conf()["channels"] if c["freq"] == 146.46)["name"], "renamed")
        radio.scan_remove(146.46)
        self.assertEqual(len(radio.scanner_conf()["channels"]), n)
        # A mode the tab does not play falls back to the frequency's own guess (HF: 14.2 -> usb).
        self.assertEqual(radio.scan_add(14.2, "dmr")["mode"], "usb")

    def test_lockout_and_priority_shape_the_cycle(self):
        conf = {"channels": [{"freq": 146.52, "mode": "fm", "name": "calling", "squelch": 40},
                             {"freq": 147.03, "mode": "fm", "name": "K4CO", "squelch": 40},
                             {"freq": 162.55, "mode": "fm", "name": "NOAA", "squelch": 0}],
                "lockout": [147.03], "priority": 146.52}
        chans, pri = radio.scan_channels(conf)
        self.assertEqual([c["freq"] for c in chans], [146.52, 162.55])   # the locked-out one is skipped
        self.assertEqual(pri["name"], "calling")                          # priority resolves to its favourite
        # A locked-out priority is no priority; a priority outside the list is built from the tables.
        self.assertIsNone(radio.scan_channels({**conf, "lockout": [146.52]})[1])
        pri2 = radio.scan_channels({**conf, "priority": 146.88})[1]
        self.assertEqual((pri2["freq"], pri2["mode"]), (146.88, "fm"))
        self.assertIn("SKYWARN", pri2["name"])
        self.assertEqual(pri2["squelch"], 40)

    def test_commands_edit_the_list_without_the_v4(self):
        radio.scanner_conf()
        self.assertTrue(radio.scanner_cmd(["lockout", "147.03"])["ok"])
        self.assertEqual(radio.scanner_conf()["lockout"], [147.03])
        skip0 = radio.scanner_conf()["skipAt"]
        self.assertGreater(skip0, 0)                                      # a lock-out also skips at once
        self.assertTrue(radio.scanner_cmd(["unlock", "147.03"])["ok"])
        self.assertEqual(radio.scanner_conf()["lockout"], [])
        self.assertTrue(radio.scanner_cmd(["hold"])["ok"])
        self.assertTrue(radio.scanner_conf()["hold"])
        self.assertTrue(radio.scanner_cmd(["resume"])["ok"])
        self.assertFalse(radio.scanner_conf()["hold"])
        time.sleep(0.002)
        self.assertTrue(radio.scanner_cmd(["skip"])["ok"])
        self.assertGreater(radio.scanner_conf()["skipAt"], skip0)         # skip is a nonce the loop watches
        self.assertTrue(radio.scanner_cmd(["priority", "146.52"])["ok"])
        self.assertEqual(radio.scanner_conf()["priority"], 146.52)
        self.assertTrue(radio.scanner_cmd(["priority", "off"])["ok"])
        self.assertIsNone(radio.scanner_conf()["priority"])
        v = radio.scanner_cmd(["list"])
        self.assertFalse(v["running"])
        self.assertGreaterEqual(len(v["channels"]), 9)
        self.assertFalse(radio.scanner_cmd(["add"])["ok"])
        self.assertFalse(radio.scanner_cmd(["lockout"])["ok"])              # nothing running, nothing given
        # Everything locked out: `on` refuses instead of starting an empty scan.
        radio.scanner_conf_set(lockout=[c["freq"] for c in radio.scanner_conf()["channels"]])
        r = radio.scanner_cmd(["on"])
        self.assertFalse(r["ok"])
        self.assertIn("No channels", r["say"])

    def test_open_decision(self):
        self.assertTrue(radio.scan_open({"squelch": "open"}))
        self.assertFalse(radio.scan_open({"squelch": "closed", "level": 0.9}))
        self.assertTrue(radio.scan_open({"squelch": "off", "heard": 1.0, "level": 0.5}))
        self.assertFalse(radio.scan_open({"squelch": "off", "heard": 1.0, "level": 0.1}))
        self.assertFalse(radio.scan_open({"squelch": "off", "heard": 0.2, "level": 0.9}))   # not enough heard yet

    def test_stop_and_play_then_resume_after_the_quiet(self):
        """Parked on an open channel: stay while it is open, leave `resume` seconds after it goes quiet,
        never on hold, and leave anyway at the cap (a broadcast never stops)."""
        t0 = 1000.0
        leave, qs = radio.scan_leave(False, True, None, t0, t0 + 1, 4.0, 300)
        self.assertEqual((leave, qs), (False, None))                      # open: keep playing
        leave, qs = radio.scan_leave(False, False, None, t0, t0 + 10, 4.0, 300)
        self.assertEqual((leave, qs), (False, t0 + 10))                   # just went quiet: start the clock
        leave, qs = radio.scan_leave(False, False, qs, t0, t0 + 13.9, 4.0, 300)
        self.assertFalse(leave)                                           # 3.9 s quiet: not yet
        leave, _ = radio.scan_leave(False, True, qs, t0, t0 + 14, 4.0, 300)
        self.assertFalse(leave)                                           # it came back: the clock resets
        leave, qs = radio.scan_leave(False, False, t0 + 10, t0, t0 + 14.1, 4.0, 300)
        self.assertTrue(leave)                                            # 4.1 s quiet: resume scanning
        leave, _ = radio.scan_leave(True, False, t0 + 10, t0, t0 + 60, 4.0, 300)
        self.assertFalse(leave)                                           # hold: stay put
        leave, _ = radio.scan_leave(False, True, None, t0, t0 + 6.1, 4.0, 6.0)
        self.assertTrue(leave)                                            # a broadcast: sampled, then move on

    def test_scanner_and_snapshot_are_exclusive_v4_jobs(self):
        for kind in ("scanner", "snapshot"):
            self.assertIn(kind, radio.MODES)
        self.assertEqual(radio.MODES["scanner"].label, "Scanner")
        argv = radio.MODES["scanner"].pipeline({"since": 1})[0]
        self.assertEqual(argv[:3], [sys.executable, radio.SCRIPT, "_scan"])
        self.assertEqual(radio.MODES["snapshot"].lease_s, 0)             # rtl_sdr -n ends it itself


class IQSnapshots(unittest.TestCase):
    def setUp(self):
        fresh_state()
        radio.IQ_ROOT = tempfile.mkdtemp(prefix="radio-040-iq-")

    def write(self, day, name, size, mhz, rate, at, mtime=None):
        folder = os.path.join(radio.IQ_ROOT, day)
        os.makedirs(folder, exist_ok=True)
        p = os.path.join(folder, name)
        with open(p, "wb") as f:
            f.write(b"\x80" * size)
        with open(p[:-4] + ".json", "w") as f:
            json.dump({"mhz": mhz, "rate": rate, "seconds": 1, "at": at}, f)
        if mtime is not None:
            os.utime(p, (mtime, mtime))
        return p

    def test_naming_date_mhz_rate_and_no_overwrite(self):
        p = radio.iq_path(433.92, 1_024_000)
        day = time.strftime("%Y-%m-%d")
        self.assertEqual(os.path.relpath(p, radio.IQ_ROOT), f"{day}/433.920_1024k.cu8")
        os.makedirs(os.path.dirname(p))
        open(p, "wb").close()
        self.assertTrue(radio.iq_path(433.92, 1_024_000).endswith("433.920_1024k-2.cu8"))
        self.assertTrue(radio.iq_path(14.2, 250_000).endswith("14.200_250k.cu8"))

    def test_rtl_sdr_argv_stops_itself_and_carries_the_ppm(self):
        radio.settings_set(ppm=-3)
        argv = radio.snapshot_argv({"mhz": 433.92, "rate": 1_024_000, "seconds": 10, "gain": 40, "file": "/x/y.cu8"})
        self.assertEqual(argv[0], radio.RTL_SDR)
        self.assertEqual(argv[argv.index("-f") + 1], "433920000")
        self.assertEqual(argv[argv.index("-n") + 1], str(1_024_000 * 10))
        self.assertEqual(argv[argv.index("-g") + 1], "40")
        self.assertEqual(argv[argv.index("-p") + 1], "-3")
        self.assertEqual(argv[-1], "/x/y.cu8")
        self.assertNotIn("-g", radio.snapshot_argv({"mhz": 1.0, "rate": 250_000, "seconds": 5, "gain": "auto", "file": "f"}))

    def test_list_reads_sidecars_or_the_name(self):
        self.write("2026-10-06", "433.920_1024k.cu8", 10, 433.92, 1_024_000, 1_000)
        folder = os.path.join(radio.IQ_ROOT, "2026-10-06")
        with open(os.path.join(folder, "162.550_250k.cu8"), "wb") as f:   # no sidecar: read from its name
            f.write(b"\x80" * 4)
        v = radio.iq_list()
        self.assertEqual(len(v["items"]), 2)
        bare = next(i for i in v["items"] if i["file"].endswith("162.550_250k.cu8"))
        self.assertEqual((bare["mhz"], bare["rate"]), (162.55, 250_000))
        self.assertEqual(v["total"], 14)
        self.assertEqual(v["keep"], {"gb": 4.0, "days": 30.0})

    def test_retention_too_old_then_oldest_past_the_cap_never_one_being_written(self):
        now = time.time()
        old = self.write("2025-01-01", "100.000_1024k.cu8", 100, 100.0, 1_024_000, int((now - 40 * 86400) * 1000), now - 40 * 86400)
        a = self.write("2026-10-01", "101.000_1024k.cu8", 600, 101.0, 1_024_000, int((now - 5 * 86400) * 1000), now - 5 * 86400)
        b = self.write("2026-10-02", "102.000_1024k.cu8", 600, 102.0, 1_024_000, int((now - 4 * 86400) * 1000), now - 4 * 86400)
        fresh = self.write("2026-10-07", "103.000_1024k.cu8", 600, 103.0, 1_024_000, int(now * 1000))   # just written
        trashed = []

        def fake_trash(paths):
            trashed.extend(paths)
            for p in paths:
                os.remove(p)
            return paths
        res = radio.iq_prune(now=now, trash=fake_trash, conf={"gb": 1300 / 1e9, "days": 30})
        gone = {os.path.basename(p) for p in trashed if p.endswith(".cu8")}
        self.assertIn("100.000_1024k.cu8", gone)      # past 30 days
        self.assertIn("101.000_1024k.cu8", gone)      # the oldest past the cap (1300 B for 1800 B)
        self.assertNotIn("102.000_1024k.cu8", gone)   # now under the cap
        self.assertNotIn("103.000_1024k.cu8", gone)   # fresh: never touched
        self.assertTrue(all(not os.path.exists(p) for p in (old, a)))
        self.assertTrue(os.path.exists(b) and os.path.exists(fresh))
        self.assertTrue(all(not p.endswith(".cu8") or p[:-4] + ".json" in trashed for p in trashed))  # sidecars go too
        self.assertEqual(res["total"], 1200)
        self.assertFalse(os.path.exists(os.path.dirname(old)))             # the emptied day folder is gone

    def test_waterfall_from_the_file_puts_a_tone_where_it_belongs(self):
        rate, n = 256_000, 256_000
        f_tone = 64_000.0                                                  # +64 kHz: a quarter of the way up
        buf = bytearray()
        for i in range(n):
            t = i / rate
            buf.append(int(127.5 + 90 * math.cos(2 * math.pi * f_tone * t)) & 255)
            buf.append(int(127.5 + 90 * math.sin(2 * math.pi * f_tone * t)) & 255)
        folder = os.path.join(radio.IQ_ROOT, "2026-10-07")
        os.makedirs(folder)
        p = os.path.join(folder, "14.200_256k.cu8")
        with open(p, "wb") as f:
            f.write(buf)
        with open(p[:-4] + ".json", "w") as f:
            json.dump({"mhz": 14.2, "rate": rate, "seconds": 1, "at": 1}, f)
        wf = radio.iq_waterfall(["14.200_256k.cu8", "--rows", "20", "--cols", "128"])
        self.assertTrue(wf["ok"])
        self.assertEqual((wf["rows"], wf["cols"]), (20, 128))
        self.assertEqual((wf["start"], wf["stop"]), (14.072, 14.328))
        import base64
        grid = base64.b64decode(wf["wf"]["b64"])
        cols = wf["wf"]["cols"]
        row = list(grid[:cols])
        peak = row.index(max(row))
        self.assertAlmostEqual(peak / cols, 0.75, delta=0.03)              # DC in the middle, +64 kHz at 3/4
        self.assertTrue(wf["png"].startswith("iVBOR"))
        self.assertFalse(radio.iq_waterfall(["nope.cu8"])["ok"])

    def test_decode_only_for_433_snapshots(self):
        p = self.write("2026-10-07", "162.550_1024k.cu8", 10, 162.55, 1_024_000, 1)
        r = radio.iq_decode([os.path.relpath(p, radio.IQ_ROOT)])
        self.assertFalse(r["ok"])
        self.assertIn("433.92", r["say"])

    def test_snapshot_capture_validates_before_touching_the_v4(self):
        self.assertFalse(radio.snapshot_start([])["ok"])
        self.assertFalse(radio.snapshot_start(["2000"])["ok"])
        self.assertEqual(radio.snapshot_read([])["ok"], True)                   # bare: the list


class HFPresets(unittest.TestCase):
    def setUp(self):
        fresh_state()

    def test_gating_starts_unconfirmed_with_a_supported_driver(self):
        h = radio.hf_state()
        self.assertFalse(h["confirmed"])
        self.assertTrue(h["driver"]["supported"])
        self.assertIn("28.8", h["driver"]["note"])
        self.assertIn("balun", h["driver"]["note"])
        self.assertEqual(h["maxMhz"], 28.8)
        st = radio.status.__wrapped__() if hasattr(radio.status, "__wrapped__") else None  # noqa: F841 (status needs ioreg)
        radio.hf_confirm("WWV 10 MHz heard")
        self.assertTrue(radio.hf_state()["confirmed"])
        self.assertEqual(radio.hf_state()["evidence"], "WWV 10 MHz heard")
        self.assertFalse(radio.hf_cmd(["reset"])["confirmed"])
        self.assertTrue(radio.hf_cmd(["confirm"])["confirmed"])
        self.assertFalse(radio.hf_cmd(["test", "50"])["ok"])             # the test tunes below 28.8 only

    def test_hf_presets_and_names(self):
        self.assertEqual(set(radio.HF_PRESETS), {"80m", "40m", "20m", "49m", "41m", "31m", "25m", "19m"})
        for k in radio.HF_PRESETS:
            self.assertLess(radio.PRESETS[k]["hi"], radio.HF_MAX_MHZ)
        self.assertEqual(radio.name_for(10.0)[0], "WWV 10 MHz time signal (Fort Collins)")
        self.assertEqual(radio.name_for(4.625)[1], "usb")
        self.assertIn("mystery", radio.name_for(4.625)[0])
        self.assertEqual(radio.name_for(0.518)[0].split(" ")[0], "NAVTEX")
        self.assertEqual(radio.guess_mode(7.2), "lsb")
        self.assertEqual(radio.guess_mode(14.2), "usb")
        self.assertEqual(radio.guess_mode(9.7), "am")
        self.assertEqual(radio.guess_mode(146.52), "fm")

    def test_ssb_and_cw_tuning(self):
        radio.settings_set(ppm=2)
        fm, player = radio.listen_argv({"freq": 14.23, "mode": "usb", "squelch": 0, "gain": 40})
        self.assertEqual(fm[fm.index("-M") + 1], "usb")
        self.assertEqual(fm[fm.index("-s") + 1], "12000")
        self.assertEqual(fm[fm.index("-p") + 1], "2")
        self.assertEqual(fm[fm.index("-f") + 1], "14.230000M")
        fm, _ = radio.listen_argv({"freq": 7.2, "mode": "lsb", "squelch": 0})
        self.assertEqual(fm[fm.index("-M") + 1], "lsb")
        fm, _ = radio.listen_argv({"freq": 14.03, "mode": "cw", "squelch": 0})
        self.assertEqual(fm[fm.index("-M") + 1], "usb")                    # CW is USB, tuned 700 Hz low
        self.assertEqual(fm[fm.index("-f") + 1], "14.029300M")
        self.assertEqual(radio.audio_rate("usb"), 12000)
        radio.settings_set(filter=("usb", 8000))
        self.assertEqual(radio.audio_rate("usb"), 8000)                    # the filter width is the player rate too
        fm, player = radio.listen_argv({"freq": 14.23, "mode": "usb", "squelch": 0})
        self.assertEqual(fm[fm.index("-s") + 1], "8000")
        self.assertIn("8000", " ".join(player or ["8000"]))
        self.assertEqual(radio.mode_label("cw"), "CW (Morse)")
        self.assertIn("usb", radio.AUDIO_MODES)
        # The meter reads SSB / CW by loudness, like AM's envelope, and names the unit.
        am = radio.AudioMeter({"freq": 14.23, "mode": "usb", "squelch": 0, "gain": 40, "label": "x"})
        import array
        quiet = array.array("h", [3] * 6000)
        loud = array.array("h", [int(8000 * math.sin(i / 7.0)) for i in range(6000)])
        self.assertLess(am.level_of(quiet)[1], am.level_of(loud)[1])
        self.assertEqual(am.state()["unit"], "dB over noise")
        am.close()


class SettingsAndPPM(unittest.TestCase):
    def setUp(self):
        fresh_state()

    def test_settings_defaults_persist_and_clamp(self):
        s = radio.settings()
        self.assertEqual((s["ppm"], s["biast"], s["filters"]["fm"]), (0, False, 24000))
        self.assertEqual(radio.ppm_args(), [])
        self.assertTrue(radio.settings_cmd(["ppm", "5"])["ok"])
        self.assertEqual(radio.settings()["ppm"], 5)
        self.assertEqual(radio.ppm_args(), ["-p", "5"])
        self.assertEqual(radio.ppm_args(-2), ["-p", "-2"])
        self.assertFalse(radio.settings_cmd(["ppm", "x"])["ok"])
        self.assertTrue(radio.settings_cmd(["filter", "fm", "1000"])["ok"])
        self.assertEqual(radio.settings()["filters"]["fm"], 4000)          # clamped to 4-48 kHz
        self.assertFalse(radio.settings_cmd(["filter", "wbfm", "9000"])["ok"])
        v = radio.settings_view()
        self.assertEqual(v["filterDefaults"]["am"], 12000)
        self.assertIn("rtl_biast", v["tools"])

    def test_ppm_from_a_carrier_offset(self):
        self.assertEqual(radio.ppm_from_offset(162.55, 162.55), 0)
        self.assertEqual(radio.ppm_from_offset(162.55, 162.553), -18)       # reads high: a negative correction
        self.assertEqual(radio.ppm_from_offset(162.55, 162.5484), 10)
        self.assertEqual(radio.ppm_from_offset(0, 1), 0)

    def test_bias_tee_needs_the_tool_and_warns(self):
        was = radio.RTL_BIAST
        radio.RTL_BIAST = "/nonexistent/rtl_biast"
        try:
            r = radio.biast_cmd(["on"])
            self.assertFalse(r["ok"])
            self.assertIn("rtl_biast", r["say"])
        finally:
            radio.RTL_BIAST = was

    def test_the_range_reaches_hf(self):
        self.assertFalse(radio.listen(["0.1", "am"])["ok"])                 # below the upconverter's floor
        self.assertIn("0.5-1766", radio.listen(["0.1", "am"])["say"])


if __name__ == "__main__":
    unittest.main()

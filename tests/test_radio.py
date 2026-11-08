"""radio.py's logic without the V4: python3 -m unittest discover -s tests -p 'test_*.py'

Runs against a throwaway state folder (RADIO_DIR), never the real one, and opens no device.
"""
import array
import base64
import json
import math
import os
import sys
import tempfile
import time
import unittest
import zlib

STATE = tempfile.mkdtemp(prefix="radio-test-")
RECS = tempfile.mkdtemp(prefix="radio-test-recs-")
os.environ["RADIO_DIR"] = STATE
os.environ["RADIO_REC_DIR"] = RECS
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import radio  # noqa: E402


def dev(key, model, id_, t_c, hum, first, last, count=3, freq=433.94, twin=None, hist=None):
    d = {"key": key, "model": model, "id": id_, "channel": 0, "first": first, "last": last, "count": count,
         "fields": {"temperature_C": t_c, "humidity": hum, "battery_ok": 0}, "freq": freq, "hist": hist or []}
    if twin:
        d["twin"] = twin
    return d


class Twins(unittest.TestCase):
    def test_same_id_same_readings_two_models_merge(self):
        a = dev("LaCrosse-TX141THBv2|101|0", "LaCrosse-TX141THBv2", 101, 16.9, 33, 1000, 900_000, count=5,
                hist=[[1000, 17.0, 33, 0], [200_000, 16.9, 33, 0]])
        b = dev("TFA-303221|101|1", "TFA-303221", 101, 17.0, 33, 400_000, 850_000, count=2, hist=[[400_000, 17.0, 33, 0]])
        c = dev("Acurite-Tower|10001|A", "Acurite-Tower", 10001, 13.9, 43, 1000, 950_000)
        groups = radio.twin_groups([a, b, c])
        self.assertEqual(sorted(len(g) for g in groups), [1, 2])
        m = radio.merge_group(next(g for g in groups if len(g) == 2))
        self.assertEqual(m["model"], "LaCrosse-TX141THBv2 / TFA-303221")
        self.assertEqual(m["first"], 1000)
        self.assertEqual(len(m["hist"]), 3)

    def test_different_readings_stay_apart(self):
        a = dev("A|7|0", "Model-A", 7, 20.0, 40, 0, 100_000)
        b = dev("B|7|0", "Model-B", 7, 25.0, 60, 0, 100_000)
        self.assertEqual(len(radio.twin_groups([a, b])), 2)

    def test_listener_links_a_pair_within_two_seconds(self):
        reg = radio.Registry()
        line = {"model": "LaCrosse-TX141THBv2", "id": 101, "channel": 0, "temperature_C": 16.9, "humidity": 33, "battery_ok": 0}
        reg.add(json.dumps(line).encode())
        reg.add(json.dumps({**line, "model": "TFA-303221", "channel": 1}).encode())
        if reg.out:
            reg.out.close()
        devs = reg.data["devices"]
        self.assertEqual(devs["LaCrosse-TX141THBv2|101|0"].get("twin"), "TFA-303221|101|1")
        self.assertEqual(len(devs["TFA-303221|101|1"]["hist"]), 1)


class Spectrum(unittest.TestCase):
    def test_dc_spike_is_filled(self):
        vals = [-40.0] * 41
        vals[20] = -10.0
        line = "2026-10-05, 20:00:00, 162000000, 162400000, 10000.00, 1, " + ", ".join(str(v) for v in vals)
        _, bins = radio.parse_line(line, 162.0, 162.4)
        self.assertTrue(all(v < -30 for _, v in bins))

    def test_png_is_a_valid_palette_png(self):
        grid = [[(i * 7 + j) % 256 for j in range(50)] for i in range(12)]
        png = base64.b64decode(radio.png_indexed(grid))
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        self.assertIn(b"PLTE", png)
        idat = png[png.index(b"IDAT") + 4:]
        raw = zlib.decompress(idat[: idat.index(b"IEND") - 8])
        self.assertEqual(len(raw), 12 * 51)

    def test_mesh_bursts_are_counted(self):
        freqs = [906.0 + k * 0.025 for k in range(200)]
        rows = [[-40.0] * 200 for _ in range(10)]
        j = min(range(200), key=lambda k: abs(freqs[k] - 906.875))
        for r in (2, 6):
            rows[r][j] = -20.0
        self.assertEqual(radio.mesh_counts(freqs, rows).get("mt"), 2)

    def test_names(self):
        self.assertEqual(radio.name_for(156.8)[0], "Marine ch 16 (distress / calling)")
        self.assertEqual(radio.name_for(156.45)[0], "Marine ch 9")
        self.assertEqual(radio.name_for(462.5625)[0], "FRS / GMRS ch 1")
        self.assertEqual(radio.name_for(94.1)[0], "94.1 WNNF")
        self.assertIsNone(radio.name_for(1090.0)[1])


class Meter(unittest.TestCase):
    def feed(self, meta, samples):
        m = radio.AudioMeter(meta)
        m.feed(array.array("h", samples).tobytes())
        return m.state()

    def test_nfm_noise_is_weak_on_a_broadcast_and_idle_elsewhere(self):
        import random
        random.seed(1)
        noise = [int(random.gauss(0, 2600)) for _ in range(24000 * 3)]
        noaa = self.feed({"freq": 162.45, "mode": "fm", "squelch": 0, "broadcast": True}, noise)
        self.assertTrue(noaa["weak"])
        rpt = self.feed({"freq": 146.94, "mode": "fm", "squelch": 0, "broadcast": False}, noise)
        self.assertIsNone(rpt["weak"])
        self.assertTrue(rpt["idle"])

    def test_nfm_quiet_carrier_is_strong(self):
        tone = [int(1500 * math.sin(2 * math.pi * 400 * k / 24000)) for k in range(24000 * 3)]
        s = self.feed({"freq": 162.55, "mode": "fm", "squelch": 0, "broadcast": True}, tone)
        self.assertFalse(s["weak"])
        self.assertGreater(s["level"], 0.8)


class Modes(unittest.TestCase):
    def test_registry_and_status_list_every_mode(self):
        radio.register_mode(radio.Mode("testjob", "test job", ("true",), lambda meta: [["/usr/bin/true"]]))
        self.assertIn("testjob", radio.MODES)
        self.assertIsNone(radio.stop_kind("testjob"))
        del radio.MODES["testjob"]

    def test_every_v4_use_is_one_registry_with_friendly_labels(self):
        radio.load_plugin_modes()
        self.assertEqual(radio.PLUGIN_ERRORS, {})
        labels = {k: m.label for k, m in radio.MODES.items()}
        for kind, label in (("gadgets", "Gadget listener"), ("listen", "Audio"), ("share", "Phone share"),
                            ("live", "Live view"), ("webrx", "Web SDR"), ("adsb", "Planes"), ("aprs", "APRS"),
                            ("same", "Weather alerts")):
            self.assertEqual(labels.get(kind), label)
        self.assertTrue(radio.MODES["webrx"].holds_lock)
        self.assertEqual(radio.MODES["aprs"].pipeline({})[0][0], radio.RTL_FM)
        self.assertIn("144.3900M", radio.MODES["aprs"].pipeline({})[0])
        self.assertIn("162.5500M", radio.MODES["same"].pipeline({})[0])


class External(unittest.TestCase):
    """An external mode (Web SDR's shape): probed, stopped by its own script, the reason recorded."""

    def setUp(self):
        self.running = {"pid": 4242, "kind": "ext", "started": 1, "meta": {"label": "Ext", "port": 1}, "children": [4242]}
        self.stops = 0

        def stopper():
            self.stops += 1
            self.running = None

        # The real external modes leave for the test: free_lock_holders() walks every mode, and
        # Web SDR's probe reads the real pid file (~/Library/Caches/radio), so with Web SDR
        # running it used to call the real stop.sh and take Web SDR down mid-test.
        self.real = {k: m for k, m in radio.MODES.items() if m.holds_lock and m.stopper}
        for k in self.real:
            radio.MODES.pop(k)
        radio.register_mode(radio.Mode("ext", "Ext SDR", ("rtl_tcp",), probe=lambda: self.running, stopper=stopper,
                                       holds_lock=True, doing=lambda meta: "run Ext"))

    def tearDown(self):
        radio.MODES.pop("ext", None)
        radio.MODES.update(self.real)
        radio.EARLY.clear()

    def test_owner_is_named_by_label(self):
        o = radio.owner_info({"pid": 4242, "name": "rtl_tcp"})
        self.assertEqual((o["ours"], o["app"]), ("ext", "Ext SDR"))

    def test_stopped_before_the_lock_then_the_reason_is_recorded(self):
        self.assertTrue(radio.lock_holder_running())
        radio.free_lock_holders()
        self.assertEqual(self.stops, 1)
        self.assertFalse(radio.lock_holder_running())
        m = radio.stop_kind("ext", why="track planes (ADS-B on 1090 MHz)")
        self.assertEqual(m["label"], "Ext")
        ex = radio.read_json(radio.EXITS, {})["ext"]
        self.assertEqual((ex["reason"], ex["detail"]), ("preempted", "stopped so the V4 could track planes (ADS-B on 1090 MHz)"))
        self.assertIsNone(radio.stop_kind("ext"))
        self.assertEqual(self.stops, 1)


class Planes(unittest.TestCase):
    def test_the_real_capture_decodes_to_aircraft_with_positions(self):
        import adsb
        st = adsb.decode_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), "adsb-capture.txt"))
        with_pos = [a for a in st["aircraft"] if a.get("lat") is not None and a.get("distNm") is not None]
        self.assertGreaterEqual(len(with_pos), 1)
        self.assertGreaterEqual(st["stats"]["crcOk"], 100)
        self.assertTrue(all(a["distNm"] < adsb.MAX_RANGE_NM for a in with_pos))
        import adsb_render
        svg = adsb_render.radar_svg(st, "auto")
        self.assertLess(len(svg), 131072)
        self.assertNotIn("<script", svg)
        table = adsb_render.text_table(st, width=34)
        self.assertTrue(all(len(line) <= 34 for line in table.splitlines()[2:]))


class Digital(unittest.TestCase):
    def test_job_reader_decodes_same_audio_into_the_state(self):
        import digital
        header = "ZCZC-WXR-TOR-021015-021117+0045-2781900-KIH42   -"
        audio = digital.same_audio(header, attention_s=0.5)
        r = digital.JobReader("same", {})
        raw = digital.array.array("h", [int(max(-32767, min(32767, v))) for v in audio]).tobytes()
        for k in range(0, len(raw), 4097):  # odd chunks: the reader keeps the half sample
            r.feed(raw[k:k + 4097])
        r.close()
        st = digital.load_state("same")
        self.assertEqual(st["alerts"][0]["event"], "TOR")
        self.assertEqual(st["alerts"][0]["severity"], "warning")
        self.assertEqual(st["runs"][0]["mode"], "live")

    def test_next_weekly_test_is_a_wednesday(self):
        import digital
        import time
        nt = digital.next_weekly_test()
        self.assertEqual(time.localtime(nt["at"] / 1000).tm_wday, 2)
        self.assertIn("Wednesday late morning", nt["say"])


# ---------------------------------------------------------------- recording

RATE = 24000


def tone(seconds, amp=4000, freq=700, rate=RATE):
    return array.array("h", [int(amp * math.sin(2 * math.pi * freq * k / rate)) for k in range(int(seconds * rate))]).tobytes()


def zeros(seconds, rate=RATE):
    return bytes(2 * int(seconds * rate))


class FakeSink:
    def __init__(self, start, log):
        self.start = start
        self.data = bytearray()
        self.closed = False
        log.append(self)

    def write(self, b):
        assert not self.closed
        self.data += b

    def close(self):
        self.closed = True
        return {"file": f"clip@{self.start:.2f}", "duration": len(self.data) / 2 / RATE}

    def seconds(self):
        return len(self.data) / 2 / RATE


def stream(gate, pieces, chunk_s=0.04, t0=1000.0):
    """Feeds (kind, seconds) pieces as rtl_fm -l would: 'tx' a tone in chunks, 'zero' the zeros it
    sends as squelch closes, 'gap' nothing at all (squelch closed), ticking every 0.25 s."""
    t = t0
    for kind, secs in pieces:
        end = t + secs
        while t < end - 1e-9:
            step = min(chunk_s, end - t)
            t += step
            if kind == "tx":
                gate.feed(tone(step), t)
            elif kind == "zero":
                gate.feed(zeros(step), t)
            elif kind == "noise":
                gate.feed(tone(step, amp=40), t)
            gate.tick(t)
    for _ in range(20):
        t += 0.25
        gate.tick(t)
    return t


class Clips(unittest.TestCase):
    def test_squelch_stream_with_gaps_splits_into_clips(self):
        sinks = []
        gate = radio.ClipGate(RATE, lambda start: FakeSink(start, sinks), squelch=True)
        stream(gate, [
            ("gap", 1.0),
            ("tx", 1.5), ("zero", 0.2), ("gap", 1.0), ("tx", 1.0), ("zero", 0.2),  # one over, a 1.2 s pause inside it
            ("gap", 3.0),
            ("tx", 0.2), ("zero", 0.2),                                            # a kerchunk: under 0.5 s, dropped
            ("gap", 3.0),
            ("tx", 2.0), ("zero", 0.2), ("gap", 2.5),                              # a second over
        ])
        self.assertEqual(len(sinks), 2)
        self.assertEqual(gate.saved, 2)
        self.assertEqual(gate.dropped, 1)
        self.assertTrue(all(s.closed for s in sinks))
        # The pause inside the first over is kept as silence; the quiet tail after each is not.
        self.assertAlmostEqual(sinks[0].seconds(), 1.5 + 1.2 + 1.0, delta=0.1)
        self.assertAlmostEqual(sinks[1].seconds(), 2.0, delta=0.06)
        self.assertGreater(sinks[1].start - sinks[0].start, 7.0)
        # The clips start with the sound and end with it (no zeros at either end).
        for s in sinks:
            self.assertTrue(bytes(s.data[:200]).strip(b"\0"))
            self.assertTrue(bytes(s.data[-200:]).strip(b"\0"))

    def test_level_gate_with_squelch_off_keeps_a_preroll(self):
        sinks = []
        loud = lambda block: 1.0 if max(abs(v) for v in array.array("h", block)) > 1000 else 0.0
        gate = radio.ClipGate(RATE, lambda start: FakeSink(start, sinks), squelch=False, level=loud)
        stream(gate, [("noise", 2.0), ("tx", 1.0), ("noise", 3.0), ("tx", 0.25), ("noise", 3.0), ("tx", 1.5), ("noise", 0.5), ("tx", 1.0), ("noise", 3.0)])
        self.assertEqual(len(sinks), 2)
        self.assertEqual(gate.dropped, 1)
        self.assertAlmostEqual(sinks[0].seconds(), 0.5 + 1.0, delta=0.3)
        self.assertAlmostEqual(sinks[1].seconds(), 0.5 + 1.5 + 0.5 + 1.0, delta=0.3)

    def test_a_long_transmission_is_cut_at_the_cap(self):
        sinks = []
        gate = radio.ClipGate(RATE, lambda start: FakeSink(start, sinks), squelch=True, max_s=4.0)
        stream(gate, [("tx", 9.0), ("gap", 3.0)])
        self.assertEqual(len(sinks), 3)
        self.assertAlmostEqual(sum(s.seconds() for s in sinks), 9.0, delta=0.1)


class RecFiles(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="radio-test-recs-")
        self.old = radio.REC_ROOT
        radio.REC_ROOT = self.root

    def tearDown(self):
        radio.REC_ROOT = self.old
        import shutil
        shutil.rmtree(self.root, ignore_errors=True)

    def test_names(self):
        t = time.mktime((2026, 10, 5, 22, 45, 12, 0, 0, -1))
        p = radio.rec_path(t, 162.55, "fm", "NOAA KIH42 Covington")
        self.assertEqual(radio.rel(p), "2026-10-05/224512_162.550_nfm_NOAA-KIH42-Covington.m4a")
        self.assertEqual(os.path.basename(radio.rec_path(t, 94.1, "wbfm", "94.1 WNNF", clip=True)), "224512_94.100_wfm_WNNF_clip.m4a")
        self.assertEqual(os.path.basename(radio.rec_path(t, 133.425, "am", "133.425 MHz", clip=True)), "224512_133.425_am_clip.m4a")
        self.assertFalse(radio.rec_root().startswith(os.path.join(os.path.expanduser("~"), "Documents")))

    def make(self, day_offset, size, name, recording=False, clip=False, age_s=None):
        t = time.time() - day_offset * 86400 - (age_s or 0)
        p = radio.rec_path(t, 146.52, "fm", name, clip)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(b"\0" * size)
        radio.write_json(p[:-4] + ".json", {"start": int(t * 1000), "freq": 146.52, "mode": "fm", "clip": clip,
                                            "recording": recording, "duration": size / 6000, "size": size})
        return p

    def test_retention_cap_trashes_oldest_and_too_old_but_never_one_being_written(self):
        old = self.make(40, 1000, "ancient")
        a = self.make(3, 4000, "a")
        b = self.make(2, 4000, "b")
        c = self.make(1, 4000, "c")
        busy = self.make(5, 4000, "busy", recording=True)      # a sidecar saying recording, file written now
        trash = tempfile.mkdtemp(prefix="radio-test-trash-")
        moved = []

        def fake_trash(paths):
            for p in paths:
                os.rename(p, os.path.join(trash, os.path.basename(p)))
                moved.append(p)
            return list(paths)

        r = radio.prune(trash=fake_trash, conf={"gb": 12000 / 1e9, "days": 30, "pruned": 0})
        gone = sorted(os.path.basename(p) for p in moved if p.endswith(".m4a"))
        self.assertIn(os.path.basename(old), gone)        # older than 30 days
        self.assertIn(os.path.basename(a), gone)          # then the oldest until it fits 12 KB
        self.assertNotIn(os.path.basename(busy), gone)    # still being recorded
        self.assertTrue(os.path.exists(b) and os.path.exists(c) and os.path.exists(busy))
        self.assertTrue(all(os.path.exists(os.path.join(trash, os.path.basename(p)[:-4] + ".json")) for p in (old, a)))
        self.assertEqual(r["total"], 12000)
        self.assertFalse(os.path.isdir(os.path.dirname(old)))  # the emptied day folder is gone
        self.assertGreater(radio.rec_conf()["pruned"], 0)

    def test_scan_lists_newest_last_and_counts_clips_for_the_log(self):
        self.make(0, 100, "x", clip=True, age_s=30)
        self.make(0, 100, "y", clip=True, age_s=10)
        self.make(0, 100, "z", age_s=5)
        items = radio.rec_scan()
        self.assertEqual([it["clip"] for it in items], [True, True, False])
        n, _ = radio.log_count(int((time.time() - 20) * 1000))
        self.assertEqual(n, 1)


@unittest.skipUnless(os.path.exists(radio.FFMPEG) and os.path.exists(radio.FFPROBE), "needs ffmpeg")
class Encoding(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="radio-test-recs-")
        self.old = radio.REC_ROOT
        radio.REC_ROOT = self.root
        radio.rec_conf_set(pruned=radio.now_ms())  # no background prune from these taps

    def tearDown(self):
        radio.REC_ROOT = self.old
        for f in (radio.REC_ON, radio.LOG_ON):
            if os.path.exists(f):
                os.remove(f)
        import shutil
        shutil.rmtree(self.root, ignore_errors=True)

    def probe(self, path):
        return float(radio.run([radio.FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], 20).strip())

    def test_the_tap_records_and_logs_without_touching_the_audio(self):
        meta = {"freq": 146.52, "mode": "fm", "label": "2 m calling (simplex)", "squelch": 40, "gain": 40, "broadcast": False, "tap": 2}
        rec = radio.Recorder(meta, RATE)
        radio.write_json(radio.REC_ON, {"id": "t1", "at": radio.now_ms(), "until": None})
        radio.write_json(radio.LOG_ON, {"since": radio.now_ms()})
        t = time.time()
        rec.tick(t)
        self.assertIsNotNone(rec.rec)
        self.assertIsNotNone(rec.gate)
        # 1 s of voice, 1 s with squelch closed (nothing comes), 0.8 s of voice, then quiet.
        for k in range(25):
            t += 0.04
            rec.feed(tone(0.04), t)
            rec.tick(t)
        for k in range(4):
            t += 0.25
            rec.tick(t)
        for k in range(20):
            t += 0.04
            rec.feed(tone(0.04), t)
            rec.tick(t)
        for k in range(12):
            t += 0.25
            rec.tick(t)
        os.remove(radio.REC_ON)
        rec.tick(t + 1)
        rec.close()
        items = radio.rec_scan()
        whole = [it for it in items if not it.get("clip")]
        clips = [it for it in items if it.get("clip")]
        self.assertEqual(len(whole), 1)
        self.assertEqual(len(clips), 1)
        self.assertTrue(clips[0]["name"].endswith("_nfm_2-m-calling-simplex_clip.m4a"))
        self.assertFalse(whole[0]["recording"])
        self.assertTrue(whole[0]["ok"])
        # The whole recording keeps real time (the closed squelch is silence in it); the clip is the over.
        self.assertGreater(whole[0]["duration"], 4.0)
        self.assertAlmostEqual(self.probe(whole[0]["path"]), whole[0]["duration"], delta=0.15)
        self.assertAlmostEqual(clips[0]["duration"], 2.8, delta=0.15)
        self.assertAlmostEqual(self.probe(clips[0]["path"]), clips[0]["duration"], delta=0.15)

    def test_through_the_job_wrapper_the_player_gets_every_byte_while_it_records(self):
        """The real wrapper and tap over a fake rtl_fm (a tone with squelch gaps) and a fake player
        (cat): the player's copy is byte-for-byte the source, while ● Rec and Log save files."""
        import subprocess as sp
        out_raw = os.path.join(self.root, "player.raw")
        src_raw = os.path.join(self.root, "source.raw")
        gen = ("import sys,time,math,array\n"
               "r=24000\n"
               "def t(s):\n"
               "  return array.array('h',[int(5000*math.sin(2*math.pi*600*k/r)) for k in range(int(s*r))]).tobytes()\n"
               "src=open(%r,'wb')\n"
               "for secs,gap in ((1.2,2.4),(0.9,2.4),(0.3,2.4)):\n"
               "  b=t(secs)\n"
               "  for i in range(0,len(b),1920):\n"
               "    sys.stdout.buffer.write(b[i:i+1920]); src.write(b[i:i+1920]); sys.stdout.flush(); time.sleep(0.04)\n"
               "  time.sleep(gap)\n" % src_raw)
        script = (
            "import os,sys,json\n"
            "sys.path.insert(0,%r)\n"
            "import radio\n"
            "radio.REC_ROOT=%r\n"
            "radio.register_mode(radio.Mode('faketap','Fake tap',('python3','cat'),lambda m:[[sys.executable,'-c',%r],['/bin/sh','-c','cat > %s']],"
            "reader=lambda m: radio.AudioMeter(m), forward=True))\n"
            "radio.write_json(radio.REC_ON,{'id':'w1','at':radio.now_ms(),'until':None})\n"
            "radio.write_json(radio.LOG_ON,{'since':radio.now_ms()})\n"
            "radio.wrapper('faketap',{'freq':146.52,'mode':'fm','label':'2 m calling (simplex)','squelch':40,'broadcast':False,'tap':2})\n"
        ) % (os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"), self.root, gen, out_raw)
        sp.run([sys.executable, "-c", script], env=dict(os.environ), timeout=60, check=True)
        with open(src_raw, "rb") as a, open(out_raw, "rb") as b:
            self.assertEqual(a.read(), b.read())
        items = radio.rec_scan()
        clips = [it for it in items if it.get("clip")]
        whole = [it for it in items if not it.get("clip")]
        self.assertEqual(len(whole), 1)
        self.assertEqual(len(clips), 2)                      # the 0.3 s kerchunk is not kept
        self.assertTrue(all(not it["recording"] and it["ok"] for it in items))
        self.assertAlmostEqual(clips[0]["duration"], 1.2, delta=0.15)
        self.assertAlmostEqual(clips[1]["duration"], 0.9, delta=0.15)
        self.assertAlmostEqual(self.probe(clips[1]["path"]), clips[1]["duration"], delta=0.15)
        self.assertAlmostEqual(self.probe(whole[0]["path"]), whole[0]["duration"], delta=0.2)
        self.assertGreater(whole[0]["duration"], 8.0)        # real time, squelch gaps as silence

    def test_a_timed_recording_ends_itself_and_its_own_listen(self):
        meta = {"freq": 162.55, "mode": "fm", "label": "NOAA KIH42 Covington", "squelch": 0, "broadcast": True, "autostop": True, "tap": 2}
        rec = radio.Recorder(meta, RATE)
        t = time.time()
        radio.write_json(radio.REC_ON, {"id": "t2", "at": int(t * 1000), "until": int((t + 1.0) * 1000)})
        rec.tick(t)
        while not rec.finished:
            t += 0.05
            rec.feed(tone(0.05), t)
            rec.tick(t)
            self.assertLess(t, time.time() + 5)
        self.assertFalse(os.path.exists(radio.REC_ON))
        self.assertRegex(rec.finished, r"^Recorded 1 s of NOAA KIH42 Covington to \d{4}-\d\d-\d\d/\d{6}_162\.550_nfm_NOAA-KIH42-Covington\.m4a\.$")
        rec.close()
        it = radio.rec_scan()[0]
        self.assertTrue(it["timed"])
        self.assertAlmostEqual(self.probe(it["path"]), 1.0, delta=0.15)


class Spectrum2(unittest.TestCase):
    def test_a_tone_lights_its_band_and_silence_falls(self):
        sp = radio.AudioSpectrum("wbfm", 48000)
        self.assertEqual(len(sp.level), 32)
        t = 100.0
        for _ in range(6):
            t += 0.1
            sp.push(tone(0.1, amp=8000, freq=1000, rate=48000), t)
            sp.frame(t)
        k = max(range(32), key=lambda i: sp.level[i])
        self.assertTrue(sp.edges[k - 1] <= 1000 < sp.edges[k + 2])
        self.assertGreater(sp.level[k], 0.6)
        self.assertLess(sorted(sp.level)[16], 0.2)
        top = sp.level[k]
        for _ in range(6):
            t += 0.1
            sp.frame(t)   # nothing new: after half a second it falls, slowly; the cap holds a moment
        self.assertLess(sp.level[k], top - 0.3)
        self.assertGreater(sp.peak[k], sp.level[k])
        self.assertIsNone(sp.rms_db)
        for _ in range(10):
            t += 0.5
            sp.frame(t)
        st = sp.state({"freq": 94.1}, 1)
        self.assertEqual(len(st["bands"]), 32)
        self.assertEqual(st["kind"], "silence")

    def test_chunks_slower_than_the_frames_are_not_read_as_silence(self):
        import random
        random.seed(5)
        sp = radio.AudioSpectrum("am", 12000)
        t, next_chunk = 0.0, 0.0
        for _ in range(40):                       # frames every 0.1 s, rtl_fm's chunks every 0.13 s
            t += 0.1
            if t >= next_chunk:
                sp.push(array.array("h", [max(0, int(2000 + random.gauss(0, 1500))) for _ in range(1560)]).tobytes(), t)
                next_chunk += 0.13
            sp.frame(t)
        self.assertEqual(sp.kind, "noise")
        self.assertIsNotNone(sp.rms_db)
        self.assertGreater(max(sp.level), 0.2)
        t += 1.0
        sp.frame(t)                               # then nothing for a second: silence, falling
        self.assertIsNone(sp.rms_db)

    def test_hiss_is_noise_and_a_voice_channel_is_voice(self):
        import random
        random.seed(3)
        sp = radio.AudioSpectrum("fm", RATE)
        t = 0.0
        for _ in range(12):
            sp.push(array.array("h", [int(random.gauss(0, 3000)) for _ in range(2400)]).tobytes())
            t += 0.1
            sp.frame(t)
        self.assertEqual(sp.kind, "noise")
        sp2 = radio.AudioSpectrum("fm", RATE)
        for _ in range(12):
            sp2.push(tone(0.1, amp=6000, freq=500) )
            t += 0.1
            sp2.frame(t)
        self.assertEqual(sp2.kind, "voice")
        self.assertEqual(len(sp2.level), 28)
        self.assertLessEqual(sp2.edges[-1], 6000)



def tearDownModule():
    import shutil
    for d in (STATE, RECS):
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()

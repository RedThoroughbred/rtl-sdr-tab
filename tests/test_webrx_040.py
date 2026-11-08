"""Web SDR 0.4.0 without Docker or the V4: the gapless FM windows, the HF profiles, and the merge
that brings both into a live settings.json while retiring the old gapped windows only when they
were never edited. Never touches the real live file."""
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("RADIO_DIR", tempfile.mkdtemp(prefix="radio-webrx040-state-"))   # never the real state folder
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(HERE, "..", "webrx"))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import webrx  # noqa: E402
import radio  # noqa: E402

FM_CHANNELS = [round(87.9 + 0.2 * i, 1) for i in range(101)]   # every US FM channel, 87.9-107.9


def windows(profiles, prefix):
    return sorted(((v["center_freq"] - v["samp_rate"] / 2) / 1e6, (v["center_freq"] + v["samp_rate"] / 2) / 1e6, k)
                  for k, v in profiles.items() if k.startswith(prefix))


class FMWindows(unittest.TestCase):
    def test_seed_fm_windows_cover_88_to_108_with_no_gap(self):
        prof = webrx.seed_profiles(("bcfm-",))
        self.assertEqual(len(prof), 10)
        fm = windows(prof, "bcfm-")
        cov = fm[0][0]
        for lo, hi, _ in fm:
            self.assertLessEqual(lo, cov + 1e-9, f"gap before {lo}")   # each window starts inside the last
            cov = max(cov, hi)
        self.assertLessEqual(fm[0][0], 87.9)
        self.assertGreaterEqual(cov, 107.9)
        for ch in FM_CHANNELS:                                          # 103.5 WGRR included
            self.assertTrue(any(lo <= ch <= hi for lo, hi, _ in fm), f"{ch} unreachable")
        for lo, hi, k in fm:                                            # centres on even MHz: between channels
            c = (lo + hi) / 2
            self.assertAlmostEqual(c % 1.0, 0.0, places=6, msg=k)
            self.assertEqual(prof[k]["rf_gain"], 19.7)
            self.assertEqual(prof[k]["start_mod"], "wfm")
        with open(webrx.SEED_SETTINGS) as f:
            seed = json.load(f)
        self.assertEqual(next(iter(seed["sdrs"]["v4"]["profiles"])), "bcfm-103")   # WEBN's window stays the default

    def test_hf_profiles_are_public_modes_only(self):
        hf = webrx.seed_profiles(("hf-",))
        self.assertEqual(set(hf), {"hf-49m", "hf-40m", "hf-wefax", "hf-31m", "hf-25m", "hf-20m", "hf-sstv", "hf-19m", "hf-navtex"})
        self.assertEqual({v["start_mod"] for v in hf.values()}, {"am", "ft8", "fax", "sstv", "navtex"})
        for v in hf.values():
            self.assertLess(v["center_freq"], 28_800_000)
        self.assertEqual(hf["hf-20m"]["start_freq"], 14_074_000)
        self.assertEqual(hf["hf-navtex"]["start_freq"], 518_000)
        with open(webrx.SEED_SETTINGS) as f:
            seed = json.load(f)
        self.assertEqual(seed["services_decoders"], ["packet", "ism"])   # the night FT8/WSPR slot stays off
        self.assertNotIn("hf", " ".join(seed["sdrs"]["v4"]["scheduler"]["schedule"].values()))


class LiveMerge(unittest.TestCase):
    def live(self, edit=None):
        path = os.path.join(tempfile.mkdtemp(prefix="webrx-040-"), "settings.json")
        prof = {**{k: dict(v) for k, v in webrx.RETIRED_FM.items()}, "noaa": {"name": "NOAA", "center_freq": 162300000, "samp_rate": 1024000},
                "ism433": dict(webrx.ISM433)}
        if edit:
            edit(prof)
        with open(path, "w") as f:
            json.dump({"version": 8, "sdrs": {"v4": {"profiles": prof}}, "services_enabled": True,
                       "services_decoders": ["packet", "ism"], "waterfall_scheme": "CustomWaterfall"}, f)
        return path

    def test_untouched_gapped_windows_are_retired_and_fm_stays_first(self):
        path = self.live()
        added = webrx.ensure_settings(path)
        self.assertEqual(sorted(a for a in added if a.startswith("-")),
                         ["-sdrs.v4.profiles.fm-102", "-sdrs.v4.profiles.fm-107", "-sdrs.v4.profiles.fm-92", "-sdrs.v4.profiles.fm-98"])
        with open(path) as f:
            prof = json.load(f)["sdrs"]["v4"]["profiles"]
        self.assertEqual(list(prof)[:10], ["bcfm-103", "bcfm-89", "bcfm-91", "bcfm-93", "bcfm-95", "bcfm-97", "bcfm-99", "bcfm-101", "bcfm-105", "bcfm-107"])
        self.assertIn("noaa", prof)
        self.assertTrue(all(k in prof for k in webrx.seed_profiles(("hf-",))))
        self.assertEqual(webrx.ensure_settings(path), [])                   # idempotent

    def test_an_edited_window_is_kept(self):
        def edit(prof):
            prof["fm-98"]["rf_gain"] = 25.4                                  # Seth turned the gain up in Settings
        path = self.live(edit)
        added = webrx.ensure_settings(path)
        self.assertNotIn("-sdrs.v4.profiles.fm-98", added)
        with open(path) as f:
            prof = json.load(f)["sdrs"]["v4"]["profiles"]
        self.assertEqual(prof["fm-98"]["rf_gain"], 25.4)
        self.assertNotIn("fm-92", prof)                                     # the untouched ones still go

    def test_bookmarks_and_modes_for_hf(self):
        self.assertEqual(webrx.owrx_mod(14.074, "usb"), "ft8")
        self.assertEqual(webrx.owrx_mod(7.0386, "usb"), "wspr")
        self.assertEqual(webrx.owrx_mod(14.23, "usb"), "sstv")
        self.assertEqual(webrx.owrx_mod(8.502, "usb"), "fax")
        self.assertEqual(webrx.owrx_mod(0.518, "usb"), "navtex")
        self.assertEqual(webrx.owrx_mod(10.0, "am"), "am")
        self.assertEqual(webrx.owrx_mod(7.2, "lsb"), "lsb")
        self.assertEqual(webrx.owrx_mod(146.52, "fm"), "nfm")
        bm = webrx.generate_bookmarks(radio, {}, None, radio.now_ms())
        hf = {b["name"]: b["modulation"] for _, b in bm if b["frequency"] < 28_800_000}
        self.assertEqual(hf["20 m FT8"], "ft8")
        self.assertEqual(hf["WWV 10 MHz time signal"], "am")
        self.assertEqual(hf["NAVTEX 518 kHz"], "navtex")
        self.assertIn("UVB-76 'The Buzzer'", hf)
        self.assertTrue(all(b["description"].startswith("Radio tab ·") for _, b in bm))


if __name__ == "__main__":
    unittest.main()

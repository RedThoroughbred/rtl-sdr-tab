#!/usr/bin/env python3
"""Where the Radio tab is: one default (Walton, KY) and an optional file that replaces any part of it.

Every script and the tab read their location from here: the planes radar's centre and airport,
the FM station names, the weather-radio station and the county codes for weather alerts, the
repeaters, the APRS map's place names and the receiver's name.

    ~/Library/Application Support/radio/location.json    (RADIO_DIR moves the folder, as for the state)

A missing file means Walton, exactly as before. A file that is not valid JSON (or has a wrong
value) is never rewritten or deleted: the default is used, and load() says what is wrong in
"_error". A partial file works: only the keys it gives replace the defaults (the nested
"weather" and "river" blocks are merged key by key).

    python3 location.py [show]     the merged location as JSON (reads files only; opens nothing)
"""
import json
import os
import sys

HOME = os.path.expanduser("~")
FILE_NAME = "location.json"

DEFAULT = {
    # Display name: titles, the radar's caption, picture descriptions. The receiver is "<name> (town centre)".
    "name": "Walton, KY",
    # The word on the map centre ("Walton", and "WALTON" on the radar). Taken from `name` up to the comma when absent.
    "short": "Walton",
    # The receiver's reference point: a town centre, never a home address.
    "lat": 38.8756,
    "lon": -84.6105,
    # Airports drawn on the radar with schematic runways. runways: [designator, offset east nm,
    # offset north nm, true heading of the higher end, length nm]. Empty list: none.
    "airports": [{
        "id": "CVG", "name": "Cincinnati/Northern Kentucky Intl", "lat": 39.0488, "lon": -84.6678, "elevFt": 896,
        "runways": [["18L/36R", 0.55, -0.15, 356, 1.65], ["18C/36C", -0.05, 0.0, 356, 1.81],
                    ["18R/36L", -0.62, -0.05, 356, 1.32], ["9/27", -0.25, -1.05, 266, 1.97]],
    }],
    # The APRS map's place names: [name, lat, lon, smallest map radius (mi), largest map radius (mi)].
    "places": [
        ["Florence", 38.9990, -84.6266, 0, 50], ["CVG", 39.0488, -84.6678, 0, 50],
        ["Cincinnati", 39.1031, -84.5120, 0, 50], ["Covington", 39.0837, -84.5086, 0, 25],
        ["Independence", 38.9431, -84.5441, 0, 25], ["Burlington", 39.0276, -84.7241, 0, 25],
        ["Williamstown", 38.6384, -84.5605, 0, 50], ["Lawrenceburg IN", 39.0909, -84.8499, 25, 50],
        ["Hamilton OH", 39.3995, -84.5613, 50, 50], ["Georgetown KY", 38.2098, -84.5588, 50, 50],
        ["Dry Ridge", 38.6820, -84.5899, 10, 10], ["Union", 38.9459, -84.6805, 10, 10],
    ],
    # Name labels on the plane radar: [name, lat, lon].
    "radar_places": [["CINCINNATI", 39.103, -84.512]],
    # A river drawn faintly behind the radar and the APRS map: coarse [lat, lon] points, west to east.
    # A hand-drawn shape, so it only exists for Walton: moving the centre drops it unless you give your own.
    "river": {
        "name": "Ohio River",
        "radar": [
        [38.60, -85.62], [38.66, -85.50], [38.736, -85.380], [38.722, -85.300], [38.681, -85.180], [38.737, -85.062],
        [38.775, -84.964], [38.783, -84.901], [38.86, -84.86], [38.950, -84.854], [39.010, -84.875],
        [39.057, -84.901], [39.091, -84.850], [39.105, -84.818], [39.153, -84.748], [39.137, -84.709],
        [39.110, -84.680], [39.087, -84.640], [39.093, -84.547], [39.095, -84.510], [39.100, -84.480],
        [39.090, -84.450], [39.060, -84.425], [39.035, -84.390], [39.000, -84.330], [38.949, -84.280],
        [38.859, -84.227], [38.800, -84.180], [38.793, -84.135], [38.772, -84.006], [38.791, -83.966],
        [38.760, -83.900], [38.745, -83.845], [38.700, -83.800], [38.656, -83.761], [38.641, -83.744],
        [38.688, -83.609], [38.660, -83.450], [38.600, -83.320]
        ],
        "map": [
        [38.736, -85.380], [38.747, -85.067], [38.786, -84.905], [38.950, -84.850], [39.057, -84.895],
        [39.090, -84.845], [39.108, -84.815], [39.110, -84.720], [39.090, -84.640], [39.095, -84.510],
        [39.090, -84.440], [39.040, -84.390], [38.950, -84.290], [38.858, -84.229], [38.772, -84.006],
        [38.700, -83.800]
        ],
    },
    # Cincinnati FM stations: frequency (MHz, one decimal) -> name.
    "fm": {"89.1": "WKCX Crittenden", "90.9": "WGUC", "91.7": "WVXU", "92.5": "WOFX", "94.1": "WNNF", "97.3": "WYGY",
           "98.5": "WRRM", "101.1": "WIZF", "101.9": "WKRQ", "102.7": "WEBN", "103.5": "WGRR", "105.1": "WUBE",
           "106.7": "WNKR", "107.1": "WKFS"},
    # NOAA Weather Radio and the coded (SAME) alerts. counties: 5-digit state+county codes -> county name;
    # local: the ones that count as "yours" (listed first); home: your own county, tagged with `short`.
    "weather": {
        "station": "KIH42", "city": "Covington", "freq": 162.55,
        "home": "21015", "local": ["21015", "21117", "21037"],
        "counties": {
            "21015": "Boone", "21117": "Kenton", "21037": "Campbell", "21081": "Grant", "21077": "Gallatin",
            "21191": "Pendleton", "21041": "Carroll", "21187": "Owen", "21023": "Bracken", "21097": "Harrison",
            "21161": "Mason", "21201": "Robertson", "21209": "Scott", "21223": "Trimble", "21067": "Fayette",
            "21073": "Franklin", "21103": "Henry", "21111": "Jefferson", "21185": "Oldham", "21017": "Bourbon",
            "21181": "Nicholas", "21135": "Lewis", "21069": "Fleming",
            "39061": "Hamilton", "39017": "Butler", "39165": "Warren", "39025": "Clermont", "39015": "Brown",
            "39027": "Clinton", "39071": "Highland", "39001": "Adams", "39057": "Greene", "39113": "Montgomery",
            "39135": "Preble", "39049": "Franklin", "39047": "Fayette", "39145": "Scioto",
            "18029": "Dearborn", "18115": "Ohio", "18155": "Switzerland", "18137": "Ripley", "18047": "Franklin",
            "18161": "Union", "18031": "Decatur", "18079": "Jennings", "18077": "Jefferson", "18041": "Fayette",
            "18177": "Wayne", "18097": "Marion",
        },
    },
    # Local repeaters. name: the long name; short: the chart label; mark: also marked on the 2 m scan;
    # wx: also in the Weather station list.
    "repeaters": [
        {"mhz": 146.88, "name": "Cincinnati SKYWARN repeater", "short": "SKYWARN", "mark": True, "wx": True},
        {"mhz": 146.79, "name": "NKARC net repeater", "short": "NKARC"},
        {"mhz": 147.03, "name": "K4CO Edgewood repeater", "short": "K4CO"},
        {"mhz": 147.255, "name": "K4CO Edgewood repeater", "short": "K4CO"},
    ],
    # The Scanner's starting favourites: [MHz, mode, name].
    "scan": [
        [162.55, "fm", "NOAA KIH42"], [146.52, "fm", "2 m calling"], [147.03, "fm", "K4CO Edgewood"],
        [147.255, "fm", "K4CO Edgewood"], [146.79, "fm", "NKARC net"], [146.88, "fm", "Cincinnati SKYWARN"],
        [156.8, "fm", "Marine ch 16"], [156.65, "fm", "Marine ch 13"], [121.5, "am", "aircraft guard 121.5"],
    ],
}

# Shapes that only make sense around one centre: they are dropped when the file moves lat/lon
# and does not give its own.
GEO_KEYS = ("airports", "places", "radar_places", "river")
EMPTY_GEO = {"airports": [], "places": [], "radar_places": [], "river": {"name": "", "radar": [], "map": []}}
NESTED = ("weather", "river")


def state_dir():
    return os.environ.get("RADIO_DIR") or os.path.join(HOME, "Library", "Application Support", "radio")


def path():
    return os.path.join(state_dir(), FILE_NAME)


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _pts(v):
    return isinstance(v, list) and all(isinstance(p, (list, tuple)) and len(p) == 2 and _num(p[0]) and _num(p[1]) for p in v)


def problems(u):
    """What is wrong with a parsed user file, as short plain sentences ([] when it is fine)."""
    if not isinstance(u, dict):
        return ["the file must hold one JSON object ({ ... })"]
    bad = []
    unknown = [k for k in u if k not in DEFAULT]
    if unknown:
        bad.append("unknown key " + ", ".join(repr(k) for k in unknown))
    for k in ("name", "short"):
        if k in u and not isinstance(u[k], str):
            bad.append(f"'{k}' must be text")
    for k, lim in (("lat", 90), ("lon", 180)):
        if k in u and not (_num(u[k]) and -lim <= u[k] <= lim):
            bad.append(f"'{k}' must be a number between {-lim} and {lim}")
    for k in ("airports", "places", "radar_places", "repeaters", "scan"):
        if k in u and not isinstance(u[k], list):
            bad.append(f"'{k}' must be a list")
    if isinstance(u.get("airports"), list):
        for a in u["airports"]:
            if not (isinstance(a, dict) and _num(a.get("lat")) and _num(a.get("lon")) and a.get("id")):
                bad.append("each airport needs id, lat and lon")
                break
    if isinstance(u.get("places"), list) and not all(isinstance(p, list) and len(p) == 5 and _num(p[1]) and _num(p[2]) for p in u["places"]):
        bad.append("each place is [name, lat, lon, min radius, max radius]")
    if isinstance(u.get("radar_places"), list) and not all(isinstance(p, list) and len(p) == 3 and _num(p[1]) and _num(p[2]) for p in u["radar_places"]):
        bad.append("each radar place is [name, lat, lon]")
    if isinstance(u.get("repeaters"), list) and not all(isinstance(r, dict) and _num(r.get("mhz")) and r.get("name") for r in u["repeaters"]):
        bad.append("each repeater needs mhz and name")
    if isinstance(u.get("scan"), list) and not all(isinstance(r, list) and len(r) == 3 and _num(r[0]) for r in u["scan"]):
        bad.append("each scan favourite is [MHz, mode, name]")
    if "fm" in u:
        fm = u["fm"]
        if not (isinstance(fm, dict) and all(isinstance(n, str) and _num(_f(f)) for f, n in fm.items())):
            bad.append("'fm' must map a frequency like \"94.1\" to a name")
    if "river" in u:
        r = u["river"]
        if not (isinstance(r, dict) and _pts(r.get("radar", [])) and _pts(r.get("map", [])) and isinstance(r.get("name", ""), str)):
            bad.append("'river' needs name and lists of [lat, lon] points")
    if "weather" in u:
        w = u["weather"]
        if not isinstance(w, dict):
            bad.append("'weather' must be an object")
        else:
            if "freq" in w and not _num(w["freq"]):
                bad.append("'weather.freq' must be a number (MHz)")
            if "counties" in w and not (isinstance(w["counties"], dict) and all(isinstance(c, str) and len(c) == 5 and c.isdigit() for c in w["counties"])):
                bad.append("'weather.counties' maps 5-digit codes (state + county) to names")
            if "local" in w and not (isinstance(w["local"], list) and all(isinstance(c, str) for c in w["local"])):
                bad.append("'weather.local' must be a list of 5-digit codes")
    return bad


def _f(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _copy(v):
    return json.loads(json.dumps(v))


def merge(user):
    """DEFAULT with the user's keys over it (a valid, parsed user dict)."""
    out = _copy(DEFAULT)
    moved = "lat" in user or "lon" in user
    if "name" in user and "short" not in user:
        out["short"] = ""          # worked out from the new name (the text before the comma)
    if moved:
        for k in GEO_KEYS:
            if k not in user:
                out[k] = _copy(EMPTY_GEO[k])
    for k, v in user.items():
        if k in NESTED and isinstance(v, dict):
            out[k].update(_copy(v))
        else:
            out[k] = _copy(v)
    return out


def derive(loc):
    """The values everything else needs, filled in (short, receiver, NOAA's name, number keys)."""
    short = (loc.get("short") or "").strip() or loc["name"].split(",")[0].strip() or "Here"
    loc["short"] = short
    loc["receiver"] = {"id": short.upper(), "name": f"{loc['name']} (town centre)", "lat": float(loc["lat"]), "lon": float(loc["lon"])}
    w = loc["weather"]
    w["freq"] = float(w.get("freq") or 162.55)
    w["noaa_name"] = " ".join(x for x in ("NOAA", w.get("station") or "", w.get("city") or "") if x) if w.get("station") else "NOAA weather radio"
    w["noaa_short"] = f"NOAA {w['station']}" if w.get("station") else "NOAA weather radio"
    loc["fm_names"] = {float(f): n for f, n in loc["fm"].items()}
    return loc


def load(directory=None):
    """The merged location. Extra keys: _custom (a valid file was applied), _error (what is wrong with a
    file that exists but could not be used; the default is returned and the file is left alone), _path."""
    p = os.path.join(directory, FILE_NAME) if directory else path()
    loc = None
    err = None
    custom = False
    try:
        with open(p, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        text = None
    except (OSError, UnicodeDecodeError) as e:
        text, err = None, f"{p} could not be read ({e})"
    if text is not None:
        try:
            user = json.loads(text)
        except ValueError as e:
            err = f"{p} is not valid JSON ({e}); using Walton, KY. The file was left alone."
        else:
            bad = problems(user)
            if bad:
                err = f"{p} was not used: " + "; ".join(bad) + ". Using Walton, KY. The file was left alone."
            else:
                loc = merge(user)
                custom = True
    if loc is None:
        loc = _copy(DEFAULT)
    derive(loc)
    loc["_custom"], loc["_error"], loc["_path"] = custom, err, p
    return loc


def public(loc):
    """The location as radio.py's `location` verb and the tab see it (JSON-safe, no private keys but the status)."""
    out = {k: v for k, v in loc.items() if not k.startswith("_") and k != "fm_names"}
    return {"ok": loc["_error"] is None, "custom": loc["_custom"], "error": loc["_error"], "path": loc["_path"], "location": out}


_WARNED = False


def load_once():
    """load() that prints a bad file's problem on stderr once per process (for scripts that run as jobs)."""
    global _WARNED
    loc = load()
    if loc["_error"] and not _WARNED:
        _WARNED = True
        print("radio: " + loc["_error"], file=sys.stderr)
    return loc


if __name__ == "__main__":
    print(json.dumps(public(load()), indent=2))

#!/usr/bin/env python3
"""Renderers for digital.py's state. Standard library only; pure functions of the JSON.

  aprs_svg(state, radius=None, now=None) -> str     a dark map-style SVG centred on the
                                                    reference point (Walton, KY town centre by default):
                                                    5/10/25/50 mi rings, north arrow, faint
                                                    place labels, each station as an icon +
                                                    callsign, faint lines to the digipeater
                                                    it was heard through. No scripts, <= 100 KB.
  aprs_table(state, limit=40, now=None, width=None) -> str
                                                    callsign, what it is, distance/bearing,
                                                    last heard, via, comment (two short lines
                                                    a station under 60 columns: the phone)
  same_card_svg(alert, now=None) -> str             an alert card: event, areas, expires-in
  same_card_text(alert, now=None) -> str            the same as plain text

`state` is aprs.json as digital.py writes it; `alert` is one entry of same.json's "alerts"
(or digital.parse_same()'s result). Times are shown in the Mac's local time zone.

    python3 digital_render.py aprs-svg  [aprs.json] > map.svg
    python3 digital_render.py aprs-table [aprs.json]
    python3 digital_render.py same-card [same.json] > card.svg
"""
import html
import json
import math
import os
import sys
import time

import location

# The reference point, the place names and the river come from the location: Walton, KY, its
# Cincinnati-area places and the Ohio River, unless ~/Library/Application Support/radio/location.json
# says otherwise. PLACES: (name, lat, lon, smallest map radius mi, largest map radius mi).
LOC = location.load_once()
REF = {k: LOC["receiver"][k] for k in ("lat", "lon", "name")}
PLACES = [tuple(p) for p in LOC["places"]]
RIVER = [tuple(p) for p in LOC["river"]["map"]]
RIVER_NAME = LOC["river"].get("name") or ""
HOME_NAME = LOC["short"]
HOME_COUNTY = LOC["weather"].get("home") or ""
WX_STATION = LOC["weather"].get("station") or ""
WX_FREQ = LOC["weather"]["freq"]
FIRST_PLACES = tuple(p[0] for p in LOC["places"][:3])  # labelled first, before the smaller places

KIND_COLORS = {
    "car": "#4ea1ff", "truck": "#7c93ff", "house": "#f2c94c", "weather": "#56ccf2", "digi": "#6fcf97",
    "igate": "#bb86fc", "aircraft": "#f2994a", "balloon": "#ff7eb6", "boat": "#2dd4bf", "person": "#d6dde8",
    "bike": "#a3e635", "emergency": "#ff5c5c", "police": "#3b82f6", "repeater": "#9ae6b4", "train": "#d1a3ff",
    "station": "#9aa4b2",
}
KIND_NAMES = {"car": "Vehicle", "truck": "Truck/bus", "house": "Fixed station", "weather": "Weather", "digi": "Digipeater",
              "igate": "Gateway", "aircraft": "Aircraft", "balloon": "Balloon", "boat": "Boat", "person": "On foot",
              "bike": "Bicycle", "emergency": "Emergency services", "police": "Police", "repeater": "Repeater",
              "train": "Train", "station": "Other"}
# White glyphs drawn inside a coloured disc of radius 10.
GLYPHS = {
    "car": '<path d="M-6.5 2.2V-0.6L-4.4-4h8.8l2.1 3.4v2.8z"/><circle cx="-3.6" cy="3" r="1.7"/><circle cx="3.6" cy="3" r="1.7"/>',
    "truck": '<path d="M-7-4h8.5v6.5H-7z"/><path d="M2-1.5h3.2L7 1v1.5H2z"/><circle cx="-4.5" cy="3.4" r="1.6"/><circle cx="4" cy="3.4" r="1.6"/>',
    "house": '<path d="M-6.5 0.5L0-6l6.5 6.5H4.5V6h-9V0.5z"/>',
    "weather": '<circle r="3.2"/><path d="M0-7.2v2.4M0 4.8v2.4M-7.2 0h2.4M4.8 0h2.4M-5.1-5.1l1.7 1.7M3.4 3.4l1.7 1.7M-5.1 5.1l1.7-1.7M3.4-3.4l1.7-1.7" stroke="#fff" stroke-width="1.4" fill="none"/>',
    "digi": '<path d="M0-7.2l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L0 3.6l-4.4 2.5 1.1-4.9-3.8-3.3 5-.5z"/>',
    "igate": '<path d="M0-6.5L6.5 0 0 6.5-6.5 0z"/><circle r="2" fill="#0b1020"/>',
    "aircraft": '<path d="M0-7.5l1.4 4.6 6 3.2v1.6l-6-1.6-.5 4 2.2 1.5v1.1L0 6.2l-3.1 1.2V6.3l2.2-1.5-.5-4-6 1.6V.8l6-3.2z"/>',
    "balloon": '<ellipse cy="-2.2" rx="4.2" ry="4.8"/><path d="M0 2.6V7" stroke="#fff" stroke-width="1.2"/>',
    "boat": '<path d="M-7 1.5h14l-3.2 4.5h-7.6z"/><path d="M-0.5-6.5v7h-5.5z"/><path d="M0.6-5v6.5h4.8z"/>',
    "person": '<circle cy="-4.3" r="2.3"/><path d="M-3.6 6.8l1-7.2h5.2l1 7.2h-2.3L0.6 2.6h-1.2l-0.7 4.2z"/>',
    "bike": '<g fill="none" stroke="#fff" stroke-width="1.5"><circle cx="-4" cy="2.2" r="3"/><circle cx="4" cy="2.2" r="3"/><path d="M-4 2.2l2.6-5.2h4.2L4 2.2M-1.4-3L0 2.2l2.8-5.2"/></g>',
    "emergency": '<path d="M-2-6.5h4v4.5h4.5v4H2v4.5h-4V2h-4.5v-4H-2z"/>',
    "police": '<path d="M0-7l6 2.3v3.6C6 2.6 3.4 5.6 0 7-3.4 5.6-6 2.6-6-1.1v-3.6z"/>',
    "repeater": '<g fill="none" stroke="#fff" stroke-width="1.5"><path d="M0-3.5L-4 7M0-3.5L4 7M-2.4 2.6h4.8"/><path d="M-3.6-6.3a5 5 0 0 0 0 5.6M3.6-6.3a5 5 0 0 1 0 5.6"/></g><circle cy="-3.5" r="1.4"/>',
    "train": '<path d="M-5-6h10v9h-10z"/><path d="M-3.5-4.5h7v3h-7z" fill="#0b1020"/><circle cx="-2.8" cy="5" r="1.5"/><circle cx="2.8" cy="5" r="1.5"/>',
    "station": '<circle r="3.4"/>',
}
SEVERITY_STYLE = {
    "emergency": ("#ff3b30", "EMERGENCY"), "warning": ("#e5484d", "WARNING"), "watch": ("#f5a524", "WATCH"),
    "statement": ("#e2c044", "STATEMENT"), "advisory": ("#e2c044", "ADVISORY"), "test": ("#5b8def", "TEST"),
}
MONO = "SF Mono, Menlo, Consolas, monospace"
SANS = "-apple-system, BlinkMacSystemFont, Helvetica Neue, Helvetica, Arial, sans-serif"


def esc(s):
    return html.escape(str(s), quote=True)


def now_ms():
    return int(time.time() * 1000)


def ago(ms, now=None):
    """'40 s', '3 min', '2 h 5 min', '3 d' since a timestamp."""
    s = max(0, ((now or now_ms()) - ms) / 1000)
    return span(s)


def span(s):
    s = abs(s)
    if s < 60:
        return f"{int(s)} s"
    if s < 3600:
        return f"{int(s // 60)} min"
    if s < 86400:
        h, m = int(s // 3600), int(s % 3600 // 60)
        return f"{h} h {m} min" if m and h < 6 else f"{h} h"
    return f"{int(s // 86400)} d"


def clock(ms, now=None):
    """Local time: '8:05 PM' today, else 'Mon Oct 5, 8:05 PM'."""
    if not ms:
        return "?"
    t = time.localtime(ms / 1000)
    n = time.localtime((now or now_ms()) / 1000)
    hm = time.strftime("%-I:%M %p", t)
    if (t.tm_year, t.tm_yday) == (n.tm_year, n.tm_yday):
        return hm
    return time.strftime("%a %b %-d, ", t) + hm


def tz_name(ms=None):
    return time.strftime("%Z", time.localtime((ms or now_ms()) / 1000))


def geo(lat, lon, ref):
    p1, p2 = math.radians(ref["lat"]), math.radians(lat)
    dl = math.radians(lon - ref["lon"])
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    dist = 3958.8 * 2 * math.asin(min(1.0, math.sqrt(a)))
    brg = (math.degrees(math.atan2(math.sin(dl) * math.cos(p2),
                                   math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl))) + 360) % 360
    return dist, brg


def compass(deg):
    return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][int((deg + 11.25) % 360 // 22.5)]


def view(state, now=None):
    """Stations with kind/what/age, newest first (the same view as digital.aprs_view)."""
    now = now or now_ms()
    digis = state.get("digis", {})
    rows = []
    for s in state.get("stations", {}).values():
        r = dict(s)
        sym = s.get("symbol") or {}
        kind, what = sym.get("kind", "station"), sym.get("name")
        if s["call"] in digis and kind in ("station", "house", "repeater"):
            kind = "digi"
            what = f"Digipeater ({what})" if what and what not in ("Station", "Digipeater") else "Digipeater"
        if s.get("weather") and kind == "station":
            kind = "weather"
        if not what:
            what = {"weather": "Weather station", "digi": "Digipeater"}.get(kind) or ("Object" if s.get("object") else "Station")
        if s.get("object"):
            what = f"Object · {what}"
        r["kind"], r["what"], r["ageS"] = kind, what, max(0, (now - s["last"]) // 1000)
        rows.append(r)
    rows.sort(key=lambda r: -r["last"])
    return rows


# ====================================================================== APRS map

def pick_radius(dists):
    """The map radius: 10 mi when everything is close, 25 when most stations are in the metro, else 50."""
    if not dists:
        return 25
    near = lambda r: sum(1 for d in dists if d <= r * 1.05) / len(dists)
    if max(dists) <= 9:
        return 10
    if near(25) >= 0.75:
        return 25
    return 50


def _free(box, boxes, skip=None):
    return not any(box[0] < q[2] and q[0] < box[2] and box[1] < q[3] and q[1] < box[3] for q in boxes if q is not skip)


def aprs_svg(state, radius=None, now=None, width=900, height=790):
    now = now or now_ms()
    ref = state.get("ref") or REF
    rows = view(state, now)
    placed = [r for r in rows if r.get("pos")][:150]
    unplaced = [r for r in rows if not r.get("pos")]
    radius = radius or pick_radius([geo(r["pos"]["lat"], r["pos"]["lon"], ref)[0] for r in placed])
    cx, cy, rpx = width / 2, 400, 296
    scale = rpx / radius  # px per mile
    coslat = math.cos(math.radians(ref["lat"]))
    top, bottom = 66, height - 64  # labels stay between the header and the legend

    def xy(lat, lon):
        return (cx + (lon - ref["lon"]) * coslat * 69.172 * scale, cy - (lat - ref["lat"]) * 69.0 * scale)

    # ---- layout: station positions, then labels that avoid icons, each other and the places
    pos_of = {}
    for r in placed:
        d, b = geo(r["pos"]["lat"], r["pos"]["lon"], ref)
        x, y = xy(r["pos"]["lat"], r["pos"]["lon"])
        edge = d > radius * 1.08
        if edge:
            x = cx + math.sin(math.radians(b)) * rpx * 1.06
            y = cy - math.cos(math.radians(b)) * rpx * 1.06
        pos_of[r["call"]] = (x, y, d, b, edge)
    icons = {c: (v[0] - 11, v[1] - 11, v[0] + 11, v[1] + 11) for c, v in pos_of.items()}
    home_box = (cx - 6, cy - 6, cx + 62, cy + 20)
    boxes = list(icons.values()) + [home_box]
    places, done = [], set()

    def place_labels(first):
        for name, lat, lon, rmin, rmax in PLACES:
            if name in done or not rmin <= radius <= rmax or (first and name not in FIRST_PLACES):
                continue
            x, y = xy(lat, lon)
            if math.hypot(x - cx, y - cy) > rpx * 1.02:
                continue
            w = len(name) * 6.2
            for anc, dx in (("start", 6), ("end", -6)):
                bx = x + dx if anc == "start" else x + dx - w
                box = (bx, y - 8, bx + w, y + 6)
                if _free(box, boxes):
                    boxes.append(box)
                    places.append((name, x, y, anc, dx))
                    done.add(name)
                    break
            else:
                if not first:
                    places.append((None, x, y, None, 0))

    place_labels(True)  # the main landmarks keep their names; stations fit around them
    labels = {}
    for r in placed:  # newest first gets the best spot
        x, y, d, b, edge = pos_of[r["call"]]
        call = r["call"]
        sub = r["what"] + " · " + span(r["ageS"]) + (f" · {d:.0f} mi {compass(b)}" if edge else "")
        sub = sub[:46]
        w = max(len(call) * 7.6, len(sub) * 5.5) + 4
        for lx, ly, anc in ((x + 14, y - 1, "start"), (x - 14, y - 1, "end"), (x - w / 2, y - 22, "start"),
                            (x - w / 2, y + 25, "start"), (x + 12, y - 16, "start"), (x + 12, y + 16, "start"),
                            (x - 12, y - 16, "end"), (x - 12, y + 16, "end")):
            bx = lx if anc == "start" else lx - w
            box = (bx, ly - 11, bx + w, ly + 14)
            if box[0] < 4 or box[2] > width - 4 or box[1] < top or box[3] > bottom:
                continue
            if _free(box, boxes, icons[call]):
                labels[call] = (lx, ly, anc, sub)
                boxes.append(box)
                break
        else:  # crowded: the callsign alone, if it fits anywhere
            for lx, ly, anc in ((x + 13, y + 4, "start"), (x - 13, y + 4, "end"), (x - len(call) * 3.8, y - 14, "start")):
                bx = lx if anc == "start" else lx - len(call) * 7.6
                box = (bx, ly - 10, bx + len(call) * 7.6, ly + 3)
                if box[0] >= 4 and box[2] <= width - 4 and box[1] >= top and box[3] <= bottom and _free(box, boxes, icons[call]):
                    labels[call] = (lx, ly, anc, None)
                    boxes.append(box)
                    break
    place_labels(False)
    river_label = None
    for (a, b) in (RIVER[::-1] if RIVER_NAME else []):
        x, y = xy(a, b)
        box = (x - 4, y - 18, x + 62, y - 6)
        if math.hypot(x - cx, y - cy) < rpx * 0.92 and abs(x - cx) > 50 and _free(box, boxes):
            river_label = (x, y - 9)
            boxes.append(box)
            break

    # ---- draw
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}" height="{height}" '
         f'viewBox="0 0 {width} {height}" font-family="{SANS}">',
         '<defs><radialGradient id="bg" cx="50%" cy="54%" r="65%"><stop offset="0" stop-color="#14203a"/>'
         '<stop offset="1" stop-color="#090d18"/></radialGradient>'
         f'<clipPath id="map"><circle cx="{cx:.0f}" cy="{cy:.0f}" r="{rpx * 1.1:.0f}"/></clipPath>']
    kinds = sorted({r["kind"] for r in placed}, key=lambda k: list(KIND_NAMES).index(k) if k in KIND_NAMES else 99)
    for k in kinds:
        o.append(f'<g id="k-{k}"><circle r="10" fill="{KIND_COLORS.get(k, "#9aa4b2")}" stroke="#0b1020" stroke-width="1.5"/>'
                 f'<g fill="#fff">{GLYPHS.get(k, GLYPHS["station"])}</g></g>')
    o.append('</defs>')
    o.append(f'<rect width="{width}" height="{height}" fill="url(#bg)"/>')
    o.append(f'<path d="M{cx - rpx * 1.1:.0f} {cy:.0f}H{cx + rpx * 1.1:.0f}M{cx:.0f} {cy - rpx * 1.1:.0f}V{cy + rpx * 1.1:.0f}" stroke="#1d2a45"/>')
    if RIVER:
        river = " ".join(f"{'M' if k == 0 else 'L'}{x:.1f} {y:.1f}" for k, (x, y) in enumerate(xy(a, b) for a, b in RIVER))
        o.append(f'<g clip-path="url(#map)"><path d="{river}" fill="none" stroke="#1d4a78" stroke-width="{max(2, min(5, scale * 0.22)):.1f}" '
                 'stroke-linejoin="round" stroke-linecap="round" opacity="0.6"/></g>')
    if river_label:
        o.append(f'<text x="{river_label[0]:.0f}" y="{river_label[1]:.0f}" font-size="10" font-style="italic" fill="#2f6aa3">{esc(RIVER_NAME)}</text>')
    for r_mi in (5, 10, 25, 50):
        if r_mi > radius * 1.01:
            continue
        rr = r_mi * scale
        o.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="{rr:.1f}" fill="none" stroke="#2c3e63" stroke-dasharray="4 5"/>'
                 f'<text x="{cx + rr * 0.707 + 4:.1f}" y="{cy + rr * 0.707 + 12:.1f}" font-size="11" fill="#5a6e92">{r_mi} mi</text>')
    for name, x, y, anc, dx in places:
        o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="2.2" fill="#4f5f84"/>')
        if name:
            o.append(f'<text x="{x + dx:.1f}" y="{y + 3.5:.1f}" font-size="11" fill="#6b7ca3" text-anchor="{anc}">{esc(name)}</text>')
    o.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="4.5" fill="none" stroke="#c9d4e8" stroke-width="1.6"/>'
             f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="1.4" fill="#c9d4e8"/>'
             f'<text x="{cx + 8:.0f}" y="{cy + 16:.0f}" font-size="12" font-weight="600" fill="#aebbd4">{esc(HOME_NAME)}</text>')
    lines = []
    for r in placed:
        via = r.get("via")
        if via and via in pos_of and via != r["call"]:
            x1, y1 = pos_of[r["call"]][:2]
            x2, y2 = pos_of[via][:2]
            lines.append(f'M{x1:.1f} {y1:.1f}L{x2:.1f} {y2:.1f}')
    if lines:
        o.append(f'<path d="{"".join(lines)}" stroke="#6fcf97" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.5" fill="none"/>')
    for r in sorted(placed, key=lambda r: r["last"]):  # newest drawn on top
        x, y, d, b, edge = pos_of[r["call"]]
        age = r["ageS"]
        op = 1.0 if age < 1800 else 0.8 if age < 7200 else 0.55
        o.append(f'<g opacity="{op}">')
        if r.get("course") is not None and (r.get("speedMph") or 0) >= 2 and not edge:
            a = math.radians(r["course"])
            o.append(f'<path d="M{x + math.sin(a) * 11:.1f} {y - math.cos(a) * 11:.1f}L{x + math.sin(a) * 18:.1f} {y - math.cos(a) * 18:.1f}" '
                     f'stroke="{KIND_COLORS.get(r["kind"])}" stroke-width="2.2" stroke-linecap="round"/>')
        o.append(f'<use xlink:href="#k-{r["kind"]}" href="#k-{r["kind"]}" transform="translate({x:.1f} {y:.1f}){" scale(0.8)" if edge else ""}"/>')
        lab = labels.get(r["call"])
        if lab:
            lx, ly, anc, sub = lab
            o.append(f'<text x="{lx:.1f}" y="{ly:.1f}" font-family="{MONO}" font-size="12" font-weight="700" fill="#e8eef7" '
                     f'text-anchor="{anc}" stroke="#090d18" stroke-width="3" paint-order="stroke">{esc(r["call"])}</text>')
            if sub:
                o.append(f'<text x="{lx:.1f}" y="{ly + 12:.1f}" font-size="10" fill="#93a3bd" text-anchor="{anc}" stroke="#090d18" '
                         f'stroke-width="3" paint-order="stroke">{esc(sub)}</text>')
        o.append("</g>")
    if not placed:
        o.append(f'<text x="{cx:.0f}" y="{cy - 44:.0f}" font-size="16" fill="#8b98ad" text-anchor="middle">No stations with a position yet</text>'
                 f'<text x="{cx:.0f}" y="{cy - 24:.0f}" font-size="12" fill="#5f7396" text-anchor="middle">'
                 'APRS on 144.390 MHz: an outdoor or higher antenna hears more</text>')

    # ---- header, north arrow, legend, footer
    n_pk = state.get("packets", 0)
    last = rows[0]["last"] if rows else None
    sub = f"{len(rows)} station{'s' if len(rows) != 1 else ''} · {n_pk} packet{'s' if n_pk != 1 else ''}"
    if last:
        sub += f" · last heard {ago(last, now)} ago"
    o.append(f'<text x="22" y="34" font-size="19" font-weight="700" fill="#e6edf3">APRS · 144.390 MHz</text>'
             f'<text x="22" y="54" font-size="12" fill="#8b98ad">{esc(sub)}</text>')
    o.append(f'<g transform="translate({width - 46} 44)"><circle r="17" fill="#0f1729" stroke="#2c3e63"/>'
             '<path d="M0-12L5 4 0 1-5 4z" fill="#e6edf3"/><path d="M0 1L5 4 0 12-5 4z" fill="#3a4a6b"/>'
             '<text y="-21" font-size="11" font-weight="700" fill="#aebbd4" text-anchor="middle">N</text></g>')
    lx, ly = 22, height - 40
    for k in kinds:
        name = KIND_NAMES.get(k, k)
        w = 24 + len(name) * 6.3
        if lx + w > width - 22:
            lx, ly = 22, ly + 18
            if ly > height - 22:
                break
        o.append(f'<use xlink:href="#k-{k}" href="#k-{k}" transform="translate({lx + 7} {ly - 4}) scale(0.65)"/>'
                 f'<text x="{lx + 17}" y="{ly}" font-size="11" fill="#8b98ad">{esc(name)}</text>')
        lx += w
    if unplaced:
        o.append(f'<text x="22" y="{height - 58}" font-size="11" fill="#6f80a6">+ {len(unplaced)} heard without a position: '
                 f'{esc(", ".join(r["call"] for r in unplaced[:6]))}{"…" if len(unplaced) > 6 else ""}</text>')
    o.append(f'<text x="{width - 22}" y="{height - 10}" font-size="10" fill="#566a8c" text-anchor="end">'
             f'Receive-only · positions as broadcast · centred on {esc(ref.get("name", LOC["name"]))} · {esc(clock(now, now))}</text>')
    o.append("</svg>")
    return "".join(o)


# ====================================================================== APRS table

def aprs_table(state, limit=40, now=None, width=None):
    """The station table; under 60 columns (the phone) two short lines per station."""
    now = now or now_ms()
    ref = state.get("ref") or REF
    rows = view(state, now)[:limit]
    if width and width < 60:
        out = [f"APRS 144.390 · {len(state.get('stations', {}))} stations · {state.get('packets', 0)} pkts"[:width]]
        if not rows:
            return out[0] + "\n(no stations heard yet)"
        out.append(f"{'CALL':<10}{'DIST':>8} {'BRG':<3} {'HEARD':>6}"[:width])
        for r in rows:
            if r.get("pos"):
                d, b = geo(r["pos"]["lat"], r["pos"]["lon"], ref)
                dist, brg = f"{d:.1f}mi", compass(b)
            else:
                dist, brg = "-", ""
            out.append(f"{r['call'][:10]:<10}{dist:>8} {brg:<3} {span(r['ageS']):>6}"[:width])
            note = r.get("comment") or r.get("status") or ""
            if r.get("weather"):
                note = wx_line(r["weather"])
            out.append(f"  {r['what']}{' · ' + note if note else ''}"[:width])
        return "\n".join(out)
    head = f"APRS 144.390 MHz · {len(state.get('stations', {}))} stations · {state.get('packets', 0)} packets · distances from {ref.get('name', LOC['name'])}"
    if not rows:
        return head + "\n(no stations heard yet)"
    cols = f"{'CALL':<10} {'WHAT':<22} {'DIST':>8} {'BRG':<3} {'HEARD':>8}  {'VIA':<10} COMMENT"
    out = [head, cols, "-" * 100]
    for r in rows:
        if r.get("pos"):
            d, b = geo(r["pos"]["lat"], r["pos"]["lon"], ref)
            dist, brg = f"{d:.1f} mi", compass(b)
        else:
            dist, brg = "-", ""
        note = r.get("comment") or r.get("status") or ""
        if r.get("weather"):
            note = wx_line(r["weather"]) + (f" · {note}" if note and not note.startswith("w") else "")
        elif r.get("speedMph"):
            note = f"{r['speedMph']:.0f} mph · " + note if note else f"{r['speedMph']:.0f} mph"
        if r.get("micE") and r["micE"] not in ("Off duty",):
            note = f"[{r['micE']}] " + note
        via = r.get("via") or ""
        out.append(f"{r['call']:<10} {r['what'][:22]:<22} {dist:>8} {brg:<3} {span(r['ageS']):>8}  {via[:10]:<10} {note[:40]}")
    msgs = state.get("messages") or []
    if msgs:
        out.append("")
        out.append("Recent messages:")
        for m in msgs[:5]:
            out.append(f"  {clock(m['at'], now):>8}  {m['from']} → {m['to']}: {m['text'][:70]}")
    return "\n".join(out)


def wx_line(wx):
    p = []
    if "tempF" in wx:
        p.append(f"{wx['tempF']}°F")
    if "humidity" in wx:
        p.append(f"{wx['humidity']}%")
    if "windMph" in wx:
        p.append(f"wind {wx['windMph']}" + (f" {compass(wx['windDir'])}" if wx.get("windDir") is not None and wx["windMph"] else ""))
    if "pressureHpa" in wx:
        p.append(f"{wx['pressureHpa']:.0f} hPa")
    return ", ".join(p)


# ====================================================================== SAME alert card

def area_names(alert):
    """Short area names, local (Boone/Kenton/Campbell for Walton) first."""
    areas = alert.get("areas") or []
    local = [a for a in areas if a.get("local")]
    other = [a for a in areas if not a.get("local")]
    names = []
    for a in local + other:
        n = a.get("name") or a.get("code")
        if HOME_COUNTY and a.get("code", "")[1:] == HOME_COUNTY:
            n += f" ({HOME_NAME})"
        names.append((n, bool(a.get("local"))))
    return names


def expiry_text(alert, now):
    exp = alert.get("expires")
    if not exp:
        return "", ""
    if exp > now:
        return f"Expires {clock(exp, now)}", f"in {span((exp - now) / 1000)}"
    return f"Expired {clock(exp, now)}", f"{span((now - exp) / 1000)} ago"


def wrap(items, width):
    """Packs (text, flag) items into lines of at most `width` characters, joined by ' · '."""
    lines, cur, n = [], [], 0
    for t, f in items:
        add = len(t) + (3 if cur else 0)
        if cur and n + add > width:
            lines.append(cur)
            cur, n = [], 0
            add = len(t)
        cur.append((t, f))
        n += add
    if cur:
        lines.append(cur)
    return lines


def same_card_svg(alert, now=None, width=640, height=330):
    now = now or now_ms()
    color, tag = SEVERITY_STYLE.get(alert.get("severity"), ("#e2c044", "ALERT"))
    expired = alert.get("expires") and alert["expires"] <= now
    title = alert.get("eventName") or alert.get("event") or "Alert"
    tsize = 34 if len(title) <= 26 else 28 if len(title) <= 32 else 23
    station = alert.get("station") or ""
    src = "NOAA WEATHER RADIO" + (f" · {station}" if station else "") + (f" · {WX_FREQ:.3f} MHz" if WX_STATION and station.startswith(WX_STATION) else "")
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" font-family="{SANS}">',
         f'<rect width="{width}" height="{height}" rx="16" fill="#10141c"/>',
         f'<rect x="1" y="1" width="{width - 2}" height="{height - 2}" rx="15" fill="none" stroke="{color}" stroke-opacity="0.45"/>',
         f'<rect x="0" y="0" width="12" height="{height}" rx="6" fill="{color}"/>',
         f'<text x="34" y="38" font-size="12" letter-spacing="1.2" font-weight="600" fill="#8b98ad">{esc(src)}</text>']
    pw = len(tag) * 9 + 22
    o.append(f'<rect x="{width - 24 - pw}" y="20" width="{pw}" height="26" rx="13" fill="{color}" fill-opacity="{0.25 if expired else 0.9}"/>'
             f'<text x="{width - 24 - pw / 2}" y="38" font-size="13" font-weight="800" letter-spacing="1" fill="{"#e6edf3" if expired else "#0b0f16"}" '
             f'text-anchor="middle">{esc(tag)}</text>')
    o.append(f'<text x="34" y="{82 if tsize >= 28 else 78}" font-size="{tsize}" font-weight="800" fill="#f5f7fa">{esc(title)}</text>')
    o.append(f'<text x="34" y="106" font-size="14" fill="#aab4c3">from the {esc(alert.get("orgName") or alert.get("org") or "originator")}'
             f'{" (" + esc(alert["event"]) + ")" if alert.get("event") else ""}</text>')
    o.append('<text x="34" y="140" font-size="11" letter-spacing="1.4" font-weight="700" fill="#6b7a90">AREAS</text>')
    lines = wrap(area_names(alert), 64)
    y = 162
    for ln in lines[:3]:
        parts = []
        for k, (t, loc) in enumerate(ln):
            if k:
                parts.append('<tspan fill="#56627a"> · </tspan>')
            parts.append(f'<tspan fill="{"#ffd166" if loc else "#d7dde8"}" font-weight="{700 if loc else 400}">{esc(t)}</tspan>')
        o.append(f'<text x="34" y="{y}" font-size="15">{"".join(parts)}</text>')
        y += 22
    if len(lines) > 3:
        more = sum(len(x) for x in lines[3:])
        o.append(f'<text x="34" y="{y}" font-size="13" fill="#8b98ad">+ {more} more area{"s" if more != 1 else ""}</text>')
    if not lines:
        o.append(f'<text x="34" y="{y}" font-size="15" fill="#8b98ad">(no areas listed)</text>')
    # times
    e1, e2 = expiry_text(alert, now)
    issued = alert.get("issued")
    o.append(f'<text x="34" y="{height - 58}" font-size="13" fill="#aab4c3">Issued {esc(clock(issued, now))} {esc(tz_name(issued))}'
             f'{" · heard " + str(alert["times"]) + "×" if alert.get("times", 1) > 1 else ""}</text>')
    if e1:
        o.append(f'<text x="34" y="{height - 38}" font-size="13" fill="#aab4c3">{esc(e1)}</text>')
        o.append(f'<text x="{width - 28}" y="{height - 40}" font-size="26" font-weight="800" fill="{"#6b7a90" if expired else color}" '
                 f'text-anchor="end">{esc(e2)}</text>')
    raw = alert.get("raw") or ""
    o.append(f'<text x="34" y="{height - 14}" font-size="10" font-family="{MONO}" fill="#4f5b6e">{esc(raw[:96])}</text>')
    o.append("</svg>")
    return "".join(o)


def same_card_text(alert, now=None):
    now = now or now_ms()
    _, tag = SEVERITY_STYLE.get(alert.get("severity"), ("", "ALERT"))
    title = (alert.get("eventName") or alert.get("event") or "Alert").upper()
    lines = [f"{title}  [{tag}]",
             f"{alert.get('orgName') or alert.get('org')}" + (f" via {alert['station']}" if alert.get("station") else "")]
    names = [t for t, _ in area_names(alert)]
    lines.append("Areas: " + (" · ".join(names) if names else "(none listed)"))
    e1, e2 = expiry_text(alert, now)
    t = f"Issued {clock(alert.get('issued'), now)} {tz_name(alert.get('issued'))}"
    if e1:
        t += f" · {e1[0].lower() + e1[1:]} ({e2})"
    lines.append(t)
    if alert.get("raw"):
        lines.append(alert["raw"])
    return "\n".join(lines)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "aprs-table"
    base = os.environ.get("RADIO_DIR") or os.path.expanduser("~/Library/Application Support/radio")
    if cmd.startswith("aprs"):
        st = json.load(open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(base, "aprs.json")))
        print(aprs_svg(st) if cmd == "aprs-svg" else aprs_table(st))
    elif cmd == "same-card":
        st = json.load(open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(base, "same.json")))
        al = st.get("alerts") or []
        print(same_card_svg(al[0]) if al else "no alerts", end="")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()

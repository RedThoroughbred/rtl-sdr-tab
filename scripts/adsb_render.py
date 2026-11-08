#!/usr/bin/env python3
"""Renderers for the ADS-B state (adsb.py's STATE_DOC): a radar-scope SVG and a compact text table.

Standard library only. Import and call:

  radar_svg(state, rng="50", now=None, sweep=None) -> str   SVG, no scripts, <= 100 KB
  text_table(state, width=48, now=None) -> str             monospace table for terminal / phone
  alt_color(alt_ft, on_ground=False) -> "#rrggbb"           the altitude colour scale

`rng` is a range in nm ("25", "50", ...) or "auto" (the smallest of 25/50/100/150/250 nm that
holds every positioned aircraft). `now` (unix seconds) defaults to the wall clock, except for an
offline decode, whose ages are measured from the end of the capture.

  python3 adsb_render.py svg  [state.json] > radar.svg
  python3 adsb_render.py table [state.json]
"""
import colorsys
import math
import os
import sys
import time

import location

FONT = "SF Mono, Menlo, Monaco, Consolas, monospace"
W, H = 1000, 680
CX, CY, R = 340, 340, 300          # the scope
PX = 690                            # side panel x
MAX_LABELS = 24
TRAIL_GAP_MS = 60_000
MAX_BYTES = 97_000  # the tab's limit is 100 KB

# Theme: a dark phosphor scope (teal) with warm/cool aircraft colours on top.
C = {
    "bg": "#030708", "face0": "#0c2725", "face1": "#061413", "face2": "#020807",
    "ring": "#1d5a51", "ringLabel": "#4e9b8c", "axis": "#123c36", "bezel": "#3bb29d", "tick": "#3a8f80",
    "tickLabel": "#69c9b6", "north": "#9ffff0", "sweep": "#5dffd9", "river": "#2f74b5", "city": "#3e6f68",
    "apt": "#ffb547", "rx": "#d9fff7", "text": "#d8fff6", "dim": "#7fb3a8", "faint": "#3f6b63",
    "panel": "#06100f", "panelLine": "#143630", "live": "#5dffb0", "warn": "#ff5a5a", "stale": "#5f7a75",
}

# The river behind the radar and the city names come from the location (Walton's Ohio River and
# Cincinnati unless ~/Library/Application Support/radio/location.json says otherwise).
LOC = location.load_once()
RIVER = [tuple(p) for p in LOC["river"]["radar"]]
PLACES = [tuple(p) for p in LOC["radar_places"]]

PLANE = ("M0,-8.5 L1.4,-5.6 L1.4,-2.2 L8,1.6 L8,3.2 L1.4,1.6 L1.1,5.6 L3.4,7.3 L3.4,8.4 L0,7.6 "
         "L-3.4,8.4 L-3.4,7.3 L-1.1,5.6 L-1.4,1.6 L-8,3.2 L-8,1.6 L-1.4,-2.2 L-1.4,-5.6 Z")


# ---------------------------------------------------------------- helpers

def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def f1(x):
    return f"{x:.1f}".rstrip("0").rstrip(".")


def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, l, s)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


ALT_HUES = [(0, 20), (2000, 32), (4000, 43), (6000, 54), (8000, 72), (9000, 85), (11000, 140), (40000, 300)]


def alt_color(alt, on_ground=False):
    """Altitude colour: orange near the ground through yellow and green to blue and magenta at 40,000 ft."""
    if on_ground:
        return "#8f9ca3"
    if alt is None:
        return "#b9c6cc"
    a = max(0, min(40000, alt))
    for (a0, h0), (a1, h1) in zip(ALT_HUES, ALT_HUES[1:]):
        if a <= a1:
            h = h0 + (h1 - h0) * (a - a0) / (a1 - a0)
            break
    # Blues and violets read much darker than yellows at the same lightness: lift them.
    light = 0.57 if h < 120 else 0.55 + 0.19 * min(1.0, (h - 120) / 130.0)
    return hsl(h, 0.95, light)


def ident(a):
    return a.get("callsign") or a.get("reg") or a.get("icao")


def alt_hundreds(a):
    if a.get("onGround"):
        return "GND"
    alt = a.get("alt") if a.get("alt") is not None else a.get("altGnss")
    if alt is None:
        return "---"
    return f"{max(0, round(alt / 100)):03d}"


def trend(a):
    vr = a.get("vr")
    if vr is None or abs(vr) < 300:
        return " "
    return "↑" if vr > 0 else "↓"


def ago(sec):
    if sec is None:
        return "-"
    sec = max(0, int(sec))
    if sec < 60:
        return f"{sec}s"
    if sec < 3600:
        return f"{sec // 60}m"
    return f"{sec // 3600}h"


def ref_now(state, now=None):
    if now is not None:
        return now
    if (state.get("source") or {}).get("mode") == "decode":
        return (state.get("updated") or 0) / 1000.0
    return time.time()


def emergency(a):
    sq = a.get("squawk")
    em = a.get("emergency")
    if sq in ("7500", "7600", "7700"):
        return sq
    if em and em not in ("none", "reserved"):
        return em.upper()
    return None


# ---------------------------------------------------------------- projection

class Proj:
    """Azimuthal equidistant around the receiver (a true radar picture), nm -> px."""

    def __init__(self, lat0, lon0, rng):
        self.lat0, self.lon0, self.k = lat0, lon0, R / rng

    def nm(self, lat, lon):
        p1, p2 = math.radians(self.lat0), math.radians(lat)
        dl = math.radians(lon - self.lon0)
        a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        d = 2 * 3440.065 * math.asin(min(1.0, math.sqrt(a)))
        y = math.sin(dl) * math.cos(p2)
        x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
        b = math.atan2(y, x)
        return d * math.sin(b), d * math.cos(b)  # east, north

    def xy(self, lat, lon):
        e, n = self.nm(lat, lon)
        return CX + e * self.k, CY - n * self.k


def polar(deg, r):
    a = math.radians(deg)
    return CX + r * math.sin(a), CY - r * math.cos(a)


def pick_range(state, rng):
    if str(rng).lower() != "auto":
        try:
            return max(2.0, min(400.0, float(rng)))
        except ValueError:
            return 50.0
    far = max((a["distNm"] for a in state.get("aircraft") or [] if a.get("distNm") is not None), default=0)
    for r in (25, 50, 100, 150, 250):
        if far <= r * 0.96:
            return float(r)
    return 250.0


def rings_for(rng):
    rs = [r for r in (2, 5, 10, 25, 50, 100, 150, 200, 250, 300) if rng / 6 <= r < rng - 1e-9]
    return rs[-3:] + [rng]


# ---------------------------------------------------------------- SVG

def radar_svg(state, rng="50", now=None, sweep=None, trail_pts=14, rows=11):
    svg = _radar(state, rng, now, sweep, trail_pts, rows)
    while len(svg.encode()) > MAX_BYTES and trail_pts > 2:
        trail_pts //= 2
        rows = max(4, rows - 3)
        svg = _radar(state, rng, now, sweep, trail_pts, rows)
    return svg


def _radar(state, rng, now, sweep, trail_pts, rows):
    rng = pick_range(state, rng)
    now = ref_now(state, now)
    rx = state.get("receiver") or {k: LOC["receiver"][k] for k in ("lat", "lon", "name")}
    pj = Proj(rx["lat"], rx["lon"], rng)
    acs = state.get("aircraft") or []
    o = []
    add = o.append
    add(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="{FONT}">')
    add("<defs>"
        f'<radialGradient id="face" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="{C["face0"]}"/>'
        f'<stop offset=".72" stop-color="{C["face1"]}"/><stop offset="1" stop-color="{C["face2"]}"/></radialGradient>'
        f'<radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/>'
        f'<stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>'
        '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.8" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
        '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>'
        f'<clipPath id="scope"><circle cx="{CX}" cy="{CY}" r="{R}"/></clipPath>'
        f'<path id="pl" d="{PLANE}"/>'
        '<g id="rot"><circle r="3.2"/><path d="M-7,-7 L7,7 M7,-7 L-7,7" stroke-width="1.6"/></g>'
        + _legend_gradient() +
        "</defs>")
    add(f'<rect width="{W}" height="{H}" fill="{C["bg"]}"/>')
    # Scope face, outer halo.
    add(f'<circle cx="{CX}" cy="{CY}" r="{R + 4}" fill="none" stroke="{C["bezel"]}" stroke-opacity=".18" '
        f'stroke-width="10" filter="url(#soft)"/>')
    add(f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#face)"/>')
    add('<g clip-path="url(#scope)">')
    # The river and a city name.
    if RIVER:
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in (pj.xy(la, lo) for la, lo in RIVER))
        add(f'<polyline points="{pts}" fill="none" stroke="{C["river"]}" stroke-opacity=".5" stroke-width="2" '
            f'stroke-linejoin="round" stroke-linecap="round"/>')
    placed = [(CX - 10, CY - 10, 20, 20), (CX + 6, CY + 8, 50, 12)]  # receiver marker and name
    for name, la, lo in PLACES:
        x, y = pj.xy(la, lo)
        if math.hypot(x - CX, y - CY) < R - 20:
            placed.append((x + 4, y - 13, len(name) * 6.2, 12))
            add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.6" fill="{C["city"]}"/>'
                f'<text x="{x + 5:.1f}" y="{y - 4:.1f}" font-size="9" fill="{C["city"]}" letter-spacing="1">{name}</text>')
    # Sweep: a fading wedge behind the beam.
    th = sweep if sweep is not None else (now * 24.0) % 360
    n, w = 22, 2.2
    for k in range(n):
        a1, a2 = th - (k + 1) * w, th - k * w
        x1, y1 = polar(a1, R)
        x2, y2 = polar(a2, R)
        op = 0.20 * (1 - k / n) ** 2
        add(f'<path d="M{CX},{CY} L{x1:.1f},{y1:.1f} A{R},{R} 0 0 1 {x2:.1f},{y2:.1f} Z" fill="{C["sweep"]}" '
            f'fill-opacity="{op:.3f}"/>')
    bx, by = polar(th, R)
    add(f'<line x1="{CX}" y1="{CY}" x2="{bx:.1f}" y2="{by:.1f}" stroke="{C["sweep"]}" stroke-opacity=".55" stroke-width="1.2"/>')
    # Axes and range rings.
    add(f'<path d="M{CX},{CY - R} V{CY + R} M{CX - R},{CY} H{CX + R}" stroke="{C["axis"]}" stroke-width="1"/>')
    d45 = R * math.sqrt(0.5)
    add(f'<path d="M{CX - d45:.1f},{CY - d45:.1f} L{CX + d45:.1f},{CY + d45:.1f} M{CX - d45:.1f},{CY + d45:.1f} '
        f'L{CX + d45:.1f},{CY - d45:.1f}" stroke="{C["axis"]}" stroke-width="1" stroke-dasharray="2 6"/>')
    rings = rings_for(rng)
    for r in rings:
        rp = r / rng * R
        if r != rings[-1]:
            add(f'<circle cx="{CX}" cy="{CY}" r="{rp:.1f}" fill="none" stroke="{C["ring"]}" stroke-width="1"/>')
        outer = r == rings[-1]
        lx, ly = polar(146 if outer else 152, rp - (20 if outer else 0))
        add(f'<text x="{lx + 4:.1f}" y="{ly - 3:.1f}" font-size="10" fill="{C["ringLabel"]}">'
            f'{f1(r)}{" NM" if outer else ""}</text>')
    # The location's airports, schematic runways.
    for ap in state.get("airports") or []:
        box = _airport(add, pj, ap)
        if box:
            placed.append(box)
    # Traffic.
    pos = [a for a in acs if a.get("lat") is not None]
    inside = []
    beyond = []
    for a in pos:
        x, y = pj.xy(a["lat"], a["lon"])
        (inside if math.hypot(x - CX, y - CY) <= R - 2 else beyond).append((a, x, y))
    inside.sort(key=lambda t: -(t[0].get("lastSeen") or 0))
    for a, x, y in inside:
        _trail(add, pj, a, now, trail_pts)
    for a, x, y in inside:
        placed.append((x - 9, y - 9, 18, 18))  # glyphs are obstacles for labels
    targets = []
    for a, x, y in inside:
        targets.append(_target(a, x, y, now, pj.k))
        add(targets[-1])
    add("</g>")
    # Labels (not clipped, so a target at the rim keeps its tag).
    order = sorted(inside, key=lambda t: (_alpha(t[0], now) < 1, t[0].get("distNm") or 0))
    for a, x, y in order[:MAX_LABELS]:
        add(_label(a, x, y, now, placed))
    for a, x, y in beyond:
        brg = a.get("bearing") or 0
        tx, ty = polar(brg, R - 9)
        col = alt_color(a.get("alt"), a.get("onGround"))
        add(f'<path d="M0,-5 L4,3 L-4,3 Z" transform="translate({tx:.1f} {ty:.1f}) rotate({brg:.0f})" fill="{col}" '
            f'fill-opacity=".85"/>')
        lx, ly = polar(brg, R - 22)
        add(f'<text x="{lx:.1f}" y="{ly + 3:.1f}" font-size="9" fill="{col}" text-anchor="middle" '
            f'fill-opacity=".85">{esc(ident(a))}</text>')
    # Vignette, bezel, compass.
    add(f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="url(#vig)"/>')
    add(f'<circle cx="{CX}" cy="{CY}" r="{R}" fill="none" stroke="{C["bezel"]}" stroke-width="1.6"/>')
    ticks = []
    for deg in range(0, 360, 5):
        ln = 12 if deg % 30 == 0 else 8 if deg % 10 == 0 else 4
        x1, y1 = polar(deg, R)
        x2, y2 = polar(deg, R + ln)
        ticks.append(f"M{x1:.1f},{y1:.1f} L{x2:.1f},{y2:.1f}")
    add(f'<path d="{" ".join(ticks)}" stroke="{C["tick"]}" stroke-width="1"/>')
    for deg in range(0, 360, 30):
        lx, ly = polar(deg, R + 24)
        lab = {0: "N", 90: "E", 180: "S", 270: "W"}.get(deg, f"{deg:03d}")
        card = deg % 90 == 0
        add(f'<text x="{lx:.1f}" y="{ly + 4:.1f}" font-size="{13 if card else 10}" text-anchor="middle" '
            f'fill="{C["north"] if deg == 0 else C["tickLabel"]}"{" font-weight=\"700\"" if card else ""}>{lab}</text>')
    # The receiver at the centre.
    add(f'<g stroke="{C["rx"]}" stroke-width="1.3" fill="none"><path d="M{CX - 9},{CY} H{CX - 3} M{CX + 3},{CY} H{CX + 9} '
        f'M{CX},{CY - 9} V{CY - 3} M{CX},{CY + 3} V{CY + 9}"/><circle cx="{CX}" cy="{CY}" r="2.2" fill="{C["rx"]}"/></g>')
    add(f'<text x="{CX + 8}" y="{CY + 17}" font-size="9" fill="{C["dim"]}" letter-spacing="1">{esc(str(rx.get("id") or LOC["receiver"]["id"]))}</text>')
    _panel(add, state, rng, now, acs, pos, beyond, rows)
    add("</svg>")
    return "".join(o)


def _airport(add, pj, ap):
    x, y = pj.xy(ap["lat"], ap["lon"])
    if math.hypot(x - CX, y - CY) > R - 6:
        return
    k = pj.k
    zoom = max(1.0, 16.0 / (1.8 * k))  # keep the runway sketch readable at wide ranges
    segs = []
    for _rw, east, north, hdg, length in ap.get("runways") or []:
        cx, cy = x + east * k * zoom, y - north * k * zoom
        dx, dy = math.sin(math.radians(hdg)), -math.cos(math.radians(hdg))
        hl = length / 2 * k * zoom
        segs.append(f"M{cx - dx * hl:.1f},{cy - dy * hl:.1f} L{cx + dx * hl:.1f},{cy + dy * hl:.1f}")
    rad = max(9.0, 2.6 * k * zoom)
    add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{rad:.1f}" fill="{C["apt"]}" fill-opacity=".06" stroke="{C["apt"]}" '
        f'stroke-opacity=".35" stroke-width="1" stroke-dasharray="3 3"/>')
    if segs:
        add(f'<path d="{" ".join(segs)}" stroke="{C["apt"]}" stroke-width="2.2" stroke-linecap="round" opacity=".9"/>')
    name = esc(ap.get("id", ""))
    add(f'<text x="{x - rad - 4:.1f}" y="{y + 4:.1f}" font-size="11" font-weight="700" fill="{C["apt"]}" '
        f'text-anchor="end" letter-spacing="1">{name}</text>')
    lw = len(name) * 8.0
    return (x - rad - 4 - lw, y - rad, lw + 2 * rad + 4, 2 * rad)


def _alpha(a, now):
    age = now - (a.get("lastSeen") or 0) / 1000.0
    return 1.0 if age < 30 else 0.6 if age < 90 else 0.35


def _trail(add, pj, a, now, n):
    tr = (a.get("trail") or [])[-n:]
    if not tr:
        return
    col = alt_color(a.get("alt"), a.get("onGround"))
    al = _alpha(a, now)
    pts = [pj.xy(p[0], p[1]) for p in tr] + [pj.xy(a["lat"], a["lon"])]
    times = [p[3] for p in tr] + [a.get("posAt") or tr[-1][3]]
    # The line breaks where the aircraft went unheard for over a minute (no straight jumps).
    runs, cur = [], [pts[0]]
    for i in range(1, len(pts)):
        if times[i] - times[i - 1] > TRAIL_GAP_MS:
            runs.append(cur)
            cur = []
        cur.append(pts[i])
    runs.append(cur)
    d = "".join("M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in run) for run in runs if len(run) > 1)
    if d:
        add(f'<path d="{d}" fill="none" stroke="{col}" stroke-opacity="{0.28 * al:.2f}" stroke-width="1.2" '
            f'stroke-linejoin="round"/>')
    # History dots in three fading steps; each step is one path of zero-length round-capped
    # segments (a dot costs ~12 bytes instead of a <circle>).
    k = len(tr)
    for step, op in enumerate((0.22, 0.42, 0.7)):
        seg = [f"M{x:.1f},{y:.1f}h0" for i, (x, y) in enumerate(pts[:-1]) if min(2, i * 3 // k) == step]
        if seg:
            add(f'<path d="{"".join(seg)}" stroke="{col}" stroke-opacity="{op * al:.2f}" stroke-width="3.6" '
                f'stroke-linecap="round"/>')


def _target(a, x, y, now, k):
    col = alt_color(a.get("alt"), a.get("onGround"))
    al = _alpha(a, now)
    parts = []
    trk = a.get("track") if a.get("track") is not None else a.get("heading")
    gs = a.get("gs")
    # One-minute velocity vector, as on an ATC display.
    if trk is not None and gs and not a.get("onGround"):
        vx, vy = math.sin(math.radians(trk)), -math.cos(math.radians(trk))
        ln = max(12.0, gs / 60.0 * k)
        parts.append(f'<line x1="{x + vx * 9:.1f}" y1="{y + vy * 9:.1f}" x2="{x + vx * ln:.1f}" y2="{y + vy * ln:.1f}" '
                     f'stroke="{col}" stroke-opacity="{0.7 * al:.2f}" stroke-width="1.1"/>')
    if a.get("onGround"):
        parts.append(f'<rect x="{x - 3.5:.1f}" y="{y - 3.5:.1f}" width="7" height="7" fill="{col}" fill-opacity="{al:.2f}"/>')
    elif a.get("category") == "A7":
        parts.append(f'<use xlink:href="#rot" href="#rot" transform="translate({x:.1f} {y:.1f})" fill="{col}" '
                     f'stroke="{col}" opacity="{al:.2f}"/>')
    elif trk is not None:
        scale = 1.15 if a.get("category") in ("A5", "A4") else 0.85 if a.get("category") in ("A1", "B1", "B4") else 1.0
        parts.append(f'<use xlink:href="#pl" href="#pl" transform="translate({x:.1f} {y:.1f}) rotate({trk:.0f}) '
                     f'scale({scale})" fill="{col}" opacity="{al:.2f}" stroke="#000" stroke-opacity=".5" stroke-width=".6"/>')
    else:
        parts.append(f'<path d="M{x:.1f},{y - 5:.1f} L{x + 5:.1f},{y:.1f} L{x:.1f},{y + 5:.1f} L{x - 5:.1f},{y:.1f} Z" '
                     f'fill="none" stroke="{col}" stroke-width="1.6" opacity="{al:.2f}"/>')
    if emergency(a):
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="13" fill="none" stroke="{C["warn"]}" stroke-width="1.6"/>')
    return f'<g filter="url(#glow)">{"".join(parts)}</g>'


def _overlap(b, boxes):
    x, y, w, h = b
    tot = 0.0
    for bx, by, bw, bh in boxes:
        ox = max(0.0, min(x + w, bx + bw) - max(x, bx))
        oy = max(0.0, min(y + h, by + bh) - max(y, by))
        tot += ox * oy
    return tot


def _label(a, x, y, now, placed):
    col = alt_color(a.get("alt"), a.get("onGround"))
    al = _alpha(a, now)
    l1 = ident(a)
    em = emergency(a)
    gs = a.get("gs")
    l2 = f"{alt_hundreds(a)}{trend(a)}{'' if gs is None else f' {round(gs)}'}"
    if em:
        l2 += f" {em}"
    cw = 6.3
    w = max(len(l1) * 6.9, len(l2) * cw) + 8
    h = 27
    best = None
    for dx, dy in ((13, -31), (13, 6), (-13 - w, -31), (-13 - w, 6), (-w / 2, -44), (-w / 2, 13)):
        box = (x + dx, y + dy, w, h)
        score = _overlap(box, placed)
        cx_, cy_ = box[0] + w / 2, box[1] + h / 2
        if box[0] < 4 or box[0] + w > PX - 12 or box[1] < 4 or box[1] + h > H - 4:
            score += 5000
        if math.hypot(cx_ - CX, cy_ - CY) > R + 10:
            score += 400
        if best is None or score < best[0] - 1e-6:
            best = (score, box)
    bx, by, bw, bh = best[1]
    placed.append(best[1])
    # Leader from the glyph to the nearest corner of the block.
    ax = bx if bx > x else bx + bw
    ay = by + bh if by < y else by
    vx, vy = ax - x, ay - y
    d = math.hypot(vx, vy) or 1
    sx, sy = x + vx / d * 9, y + vy / d * 9
    stroke = C["warn"] if em else col
    return (f'<g opacity="{al:.2f}"><line x1="{sx:.1f}" y1="{sy:.1f}" x2="{ax:.1f}" y2="{ay:.1f}" stroke="{col}" '
            f'stroke-opacity=".55" stroke-width=".9"/>'
            f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bw:.1f}" height="{bh}" rx="2.5" fill="#020a09" fill-opacity=".72" '
            f'stroke="{stroke}" stroke-opacity="{0.9 if em else 0.28}"/>'
            f'<text x="{bx + 4:.1f}" y="{by + 11.5:.1f}" font-size="11.5" font-weight="700" fill="{col}">{esc(l1)}</text>'
            f'<text x="{bx + 4:.1f}" y="{by + 23:.1f}" font-size="10.5" fill="{C["warn"] if em else C["text"]}" '
            f'fill-opacity=".85">{esc(l2)}</text></g>')


LEGEND_TICKS = [(0, "GND"), (5000, "5k"), (10000, "10k"), (20000, "20k"), (30000, "30k"), (40000, "40k+")]


def _legend_pos(alt):
    """0..1 along the legend: equal steps between the tick altitudes."""
    n = len(LEGEND_TICKS) - 1
    for i in range(n):
        a0, a1 = LEGEND_TICKS[i][0], LEGEND_TICKS[i + 1][0]
        if alt <= a1:
            return (i + (max(alt, a0) - a0) / (a1 - a0)) / n
    return 1.0


def _legend_gradient():
    stops = []
    for alt in (0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 13000, 16000, 20000,
                25000, 30000, 35000, 40000):
        stops.append(f'<stop offset="{_legend_pos(alt):.3f}" stop-color="{alt_color(alt)}"/>')
    return f'<linearGradient id="altg" x1="0" x2="1" y1="0" y2="0">{"".join(stops)}</linearGradient>'


def _panel(add, state, rng, now, acs, pos, beyond, rows):
    x0, x1 = PX, W - 20
    add(f'<rect x="{x0 - 14}" y="18" width="{x1 - x0 + 28}" height="{H - 36}" rx="10" fill="{C["panel"]}" '
        f'stroke="{C["panelLine"]}"/>')
    add(f'<text x="{x0}" y="50" font-size="19" font-weight="700" fill="{C["text"]}" letter-spacing="3">ADS-B RADAR</text>')
    rx = state.get("receiver") or {}
    add(f'<text x="{x0}" y="68" font-size="10.5" fill="{C["dim"]}" letter-spacing=".5">1090 MHz · '
        f'{esc((rx.get("name") or LOC["receiver"]["name"]).replace(" (town centre)", ""))} · {f1(rng)} nm</text>')
    # Status chip.
    src = state.get("source") or {}
    job = state.get("job") or {}
    upd = (state.get("updated") or 0) / 1000.0
    age = now - upd if upd else None
    mode = src.get("mode")
    if state.get("empty"):
        chip, ccol = "NO DATA", C["faint"]
    elif mode == "live" and job.get("running") and age is not None and age < 15:
        chip, ccol = "LIVE", C["live"]
    elif mode == "live":
        chip, ccol = "STOPPED", C["stale"]
    elif mode == "decode":
        chip, ccol = "RECORDING", C["dim"]
    else:
        chip, ccol = f"SNAPSHOT {f1(src.get('seconds') or 0)} s", C["dim"]
    cw = len(chip) * 7 + 22
    add(f'<rect x="{x0}" y="80" width="{cw}" height="18" rx="9" fill="{ccol}" fill-opacity=".14" stroke="{ccol}" '
        f'stroke-opacity=".6"/><circle cx="{x0 + 9}" cy="89" r="3" fill="{ccol}"/>'
        f'<text x="{x0 + 16}" y="93" font-size="10" font-weight="700" fill="{ccol}" letter-spacing="1">{chip}</text>')
    if upd and not state.get("empty"):
        tstr = time.strftime("%H:%M:%S", time.localtime(upd))
        extra = f" · {ago(age)} ago" if age is not None and mode != "decode" else ""
        add(f'<text x="{x0 + cw + 8}" y="93" font-size="10" fill="{C["dim"]}">{tstr}{extra}</text>')
    # Tiles.
    st = state.get("stats") or {}
    tiles = [("AIRCRAFT", len(acs)), ("POSITIONS", len(pos)),
             ("FARTHEST", f"{f1(st['maxRangeNm'])}" if st.get("maxRangeNm") else "-")]
    tw = (x1 - x0 - 16) / 3
    for i, (lab, val) in enumerate(tiles):
        tx = x0 + i * (tw + 8)
        add(f'<rect x="{tx:.1f}" y="110" width="{tw:.1f}" height="50" rx="6" fill="#0a1c1a" stroke="{C["panelLine"]}"/>'
            f'<text x="{tx + 9:.1f}" y="141" font-size="22" font-weight="700" fill="{C["text"]}">{val}'
            f'{"<tspan font-size=\"10\" fill=\"" + C["dim"] + "\"> nm</tspan>" if lab == "FARTHEST" and val != "-" else ""}</text>'
            f'<text x="{tx + 9:.1f}" y="154" font-size="8" fill="{C["dim"]}" letter-spacing="1">{lab}</text>')
    # Altitude legend.
    add(f'<text x="{x0}" y="182" font-size="8.5" fill="{C["dim"]}" letter-spacing="1.2">ALTITUDE (FT)</text>')
    lw = x1 - x0
    add(f'<rect x="{x0}" y="188" width="{lw}" height="7" rx="3.5" fill="url(#altg)"/>')
    for alt, lab in LEGEND_TICKS:
        lx = x0 + _legend_pos(alt) * lw
        anchor = "start" if alt == 0 else "end" if alt == 40000 else "middle"
        add(f'<text x="{lx:.1f}" y="207" font-size="8.5" fill="{C["dim"]}" text-anchor="{anchor}">{lab}</text>')
    # Traffic table (closest first), then the ones without a position.
    y = 232
    add(f'<text x="{x0}" y="{y}" font-size="8.5" fill="{C["dim"]}" letter-spacing="1.2">TRAFFIC</text>')
    cols = [(x0 + 10, "IDENT", "start"), (x0 + 128, "ALT", "end"), (x0 + 166, "GS", "end"), (x0 + 210, "NM", "end"),
            (x1, "BRG", "end")]
    y += 16
    add("".join(f'<text x="{cx}" y="{y}" font-size="8.5" fill="{C["faint"]}" text-anchor="{an}">{lab}</text>'
                for cx, lab, an in cols))
    nopos = [a for a in acs if a.get("lat") is None]
    # Lines that fit above the receiver block (17 px each; the NO POSITION header costs 2).
    avail = min(rows + 8, int((H - 100 - y) / 17))
    if not nopos:
        n_pos_rows = min(len(pos), avail if len(pos) <= avail else avail - 1)
        room = 0
    else:
        room = min(len(nopos), max(2, avail // 4) if len(pos) + len(nopos) + 2 > avail else len(nopos))
        room_lines = room + (1 if len(nopos) > room else 0) + 2
        n_pos_rows = min(len(pos), max(1, avail - room_lines - (1 if len(pos) > avail - room_lines else 0)))
    for a in pos[:n_pos_rows]:
        y += 17
        col = alt_color(a.get("alt"), a.get("onGround"))
        op = _alpha(a, now)
        em = emergency(a)
        vals = [ident(a), _alt_text(a), "-" if a.get("gs") is None else f"{round(a['gs'])}",
                f"{a['distNm']:.1f}" if a.get("distNm") is not None else "-",
                f"{round(a['bearing']) % 360:03d}" if a.get("bearing") is not None else "-"]
        add(f'<g opacity="{op:.2f}"><circle cx="{x0 + 3}" cy="{y - 3.5}" r="3" fill="{col}"/>'
            + "".join(f'<text x="{cx}" y="{y}" font-size="10.5" fill="{C["warn"] if em and i == 0 else (col if i == 0 else C["text"])}" '
                      f'text-anchor="{an}"{" font-weight=\"700\"" if i == 0 else ""}>{esc(v)}</text>'
                      for i, ((cx, _, an), v) in enumerate(zip(cols, vals)))
            + "</g>")
    if len(pos) > n_pos_rows:
        y += 15
        add(f'<text x="{x0 + 10}" y="{y}" font-size="9" fill="{C["faint"]}">+{len(pos) - n_pos_rows} more with position</text>')
    if not pos:
        y += 17
        add(f'<text x="{x0 + 10}" y="{y}" font-size="10" fill="{C["faint"]}">none with a position yet</text>')
    if nopos:
        y += 26
        add(f'<text x="{x0}" y="{y}" font-size="8.5" fill="{C["dim"]}" letter-spacing="1.2">NO POSITION</text>')
        y += 2
        for a in nopos[:room]:
            y += 16
            col = alt_color(a.get("alt"), a.get("onGround"))
            vals = [ident(a), _alt_text(a), "-" if a.get("gs") is None else f"{round(a['gs'])}", "",
                    ago(now - (a.get("lastSeen") or 0) / 1000.0)]
            add(f'<g opacity="{_alpha(a, now):.2f}"><circle cx="{x0 + 3}" cy="{y - 3.5}" r="2.6" fill="none" stroke="{col}"/>'
                + "".join(f'<text x="{cx}" y="{y}" font-size="10" fill="{col if i == 0 else C["dim"]}" text-anchor="{an}">'
                          f'{esc(v)}</text>' for i, ((cx, _, an), v) in enumerate(zip(cols, vals)) if v)
                + "</g>")
        if len(nopos) > room:
            y += 14
            add(f'<text x="{x0 + 10}" y="{y}" font-size="9" fill="{C["faint"]}">+{len(nopos) - room} more</text>')
    # Receiver numbers.
    yb = H - 76
    add(f'<line x1="{x0}" y1="{yb - 15}" x2="{x1}" y2="{yb - 15}" stroke="{C["panelLine"]}"/>')
    add(f'<text x="{x0}" y="{yb}" font-size="8.5" fill="{C["dim"]}" letter-spacing="1.2">RECEIVER</text>')
    fr, ok = st.get("frames") or 0, st.get("crcOk") or 0
    rate = st.get("msgPerSec")
    bits = [f"{fr:,} frames", f"{round(100 * ok / fr) if fr else 0}% valid"]
    if rate:
        bits.append(f"{f1(rate)} msg/s")
    add(f'<text x="{x0 + 70}" y="{yb}" font-size="9.5" fill="{C["text"]}" fill-opacity=".8">{" · ".join(bits)}</text>')
    if beyond:
        add(f'<text x="{x0 + 70}" y="{yb + 14}" font-size="9.5" fill="{C["dim"]}">▲ {len(beyond)} beyond '
            f'{f1(rng)} nm, on the rim</text>')
    gain = src.get("gain")
    foot = "rtl_adsb" + (f" · gain {f1(gain)} dB" if gain else "") + " · RTL-SDR Blog V4"
    add(f'<text x="{x0}" y="{H - 36}" font-size="8.5" fill="{C["faint"]}">{esc(foot)}</text>')
    add(f'<text x="{x0}" y="{H - 24}" font-size="8.5" fill="{C["faint"]}">dipole: short elements ~6.9 cm each, vertical</text>')
    if state.get("empty") or not acs:
        msg = "NO TRAFFIC YET" if not state.get("empty") else "NO DATA · adsb.py run 20"
        add(f'<text x="{CX}" y="{CY + R * 0.55:.0f}" font-size="12" fill="{C["dim"]}" text-anchor="middle" '
            f'letter-spacing="2">{msg}</text>')


def _alt_text(a):
    if a.get("onGround"):
        return "GND"
    alt = a.get("alt") if a.get("alt") is not None else a.get("altGnss")
    if alt is None:
        return "-"
    if alt >= 18000:
        return f"FL{round(alt / 100):03d}"
    return f"{alt:,}"


# ---------------------------------------------------------------- text table

def text_table(state, width=48, now=None):
    """A compact table: IDENT ALT GS NM BRG SEEN, closest first, then those without a position."""
    now = ref_now(state, now)
    acs = state.get("aircraft") or []
    src = state.get("source") or {}
    job = state.get("job") or {}
    pos = [a for a in acs if a.get("lat") is not None]
    mode = src.get("mode")
    upd = (state.get("updated") or 0) / 1000.0
    if state.get("empty"):
        status = "no data yet (adsb.py run 20)"
    elif mode == "live":
        status = "live" if job.get("running") else "stopped"
        if upd and (not job.get("running") or now - upd > 5):
            status += f" \u00b7 {ago(now - upd)} ago"
    elif mode == "decode":
        status = "recording"
    else:
        status = f"snapshot {ago(now - upd)} ago"
    rxn = (state.get("receiver") or LOC["receiver"]).get("name") or LOC["receiver"]["name"]
    loc_label = rxn.replace(" (town centre)", "").replace(",", "")
    lines = [f"ADS-B \u00b7 {loc_label} \u00b7 {status}"[:max(width, 20)],
             f"{len(acs)} aircraft \u00b7 {len(pos)} with position"[:max(width, 20)]]
    narrow = width < 40
    hdr = f"{'IDENT':<8} {'ALT':>6} {'GS':>4} {'NM':>5}" + ("" if narrow else f" {'BRG':>4}") + f" {'SEEN':>4}"
    lines.append(hdr)
    for a in acs:
        nm = f"{a['distNm']:.1f}" if a.get("distNm") is not None else "-"
        brg = f"{round(a['bearing']) % 360:03d}" if a.get("bearing") is not None else "-"
        gs = "-" if a.get("gs") is None else str(round(a["gs"]))
        row = f"{ident(a)[:8]:<8} {_alt_text(a):>6} {gs:>4} {nm:>5}" + ("" if narrow else f" {brg:>4}") + \
              f" {ago(now - (a.get('lastSeen') or 0) / 1000.0):>4}"
        em = emergency(a)
        if em:
            row += f" !{em}"
        lines.append(row)
    if not acs:
        lines.append("(nothing heard)")
    return "\n".join(lines)


if __name__ == "__main__":
    import json
    verb = sys.argv[1] if len(sys.argv) > 1 else "svg"
    path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.environ.get("RADIO_DIR") or os.path.expanduser("~/Library/Application Support/radio"), "adsb.json")
    with open(path) as f:
        st = json.load(f)
    sys.stdout.write((radar_svg(st, sys.argv[3] if len(sys.argv) > 3 else "50") if verb == "svg" else text_table(st)) + "\n")

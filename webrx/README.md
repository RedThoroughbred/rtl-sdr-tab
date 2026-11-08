# Web SDR (OpenWebRX+)

A browser SDR for the RTL-SDR Blog V4: live waterfall, click to listen, and
decoders (RDS, APRS, AIS, rtl_433, Meshtastic and more). It runs OpenWebRX+ in
Docker and works on the Mac and the iPhone.

```
V4 --USB--> rtl_tcp (Mac, 127.0.0.1:1234) --host.docker.internal--> OpenWebRX+ container --:8073--> browser
                                                                    browser "Send to Radio tab" --:8074--> handoff.py (Mac) --> handoff.json --> Radio tab
```

0.3.2 adds the **Wildcat RF package**: the tab's instrument look (`skin/custom.css`), a receiver
plugin with **Send to Radio tab** and the **Wildcat** panel (`plugins/receiver/`), the handoff
endpoint behind the button (`handoff.py`), bookmarks synced from the Radio tab
(`webrx.py sync-bookmarks`), and background decoding while nobody listens. Each is below.

0.3.3 fixes the **iPhone reload loop** (the page kept flashing "Start OpenWebRX+" at 0 Hz; see
[the iPhone](#the-iphone-the-reload-loop-fixed-in-033)), fixes the **jumbled receiver panel** (the
mode keys overlapped; see the skin), and adds **plain-English tooltips** on the receiver's controls
and a **"?" guide**, "How Web SDR works" (see the receiver plugin). The unit tests no longer stop
a running Web SDR (`tests/test_radio.py`'s external-mode test used to reach the real `stop.sh`).

Docker Desktop on macOS can't pass a USB device into a container, so the V4
stays on the Mac. `rtl_tcp` (Homebrew librtlsdr 2.0.3, which detects the V4 and
its R828D tuner) shares the dongle, and OpenWebRX+ reads it through an `rtl_tcp`
source. The container reaches the Mac's loopback through `host.docker.internal`,
so `rtl_tcp` never listens on the network.

## Start, stop, status

```sh
webrx/start.sh    # takes the V4 lock, starts rtl_tcp, syncs bookmarks, brings the container up,
                  #   ensures the admin user, starts the handoff endpoint
webrx/stop.sh     # handoff endpoint and container down, rtl_tcp stopped, lock released
webrx/status.sh   # fast (~0.3 s), safe to poll
webrx/sync-bookmarks.sh   # bookmarks from the Radio tab (also run by every start)
```

Each script prints one JSON object, like `radio.py` does. `status.sh` looks like this:

```json
{"running": true, "container": "running", "health": "healthy",
 "url": "http://192.168.1.29:8073",
 "urls": {"local": "http://localhost:8073", "lan": "http://192.168.1.29:8073"},
 "port": 8073, "rtl_tcp_pid": 82461, "rtl_tcp": "127.0.0.1:1234", "lock": "held",
 "image": "slechev/openwebrxplus:1.2.126", "data": "~/Library/Application Support/radio/openwebrx",
 "admin": {"user": "admin", "keychain_service": "openwebrx-wildcat"},
 "map": "http://localhost:8073/map",
 "handoff": {"port": 8074, "running": true, "pid": 82470},
 "background": {"enabled": true, "decoders": ["packet", "ism"], "utc": true,
                "schedule": {"1000-0400": "2 m 143.8-146.2 MHz (APRS 144.39)",
                             "0400-1000": "433 MHz ISM 432.3-434.7 MHz (rtl_433)"}}}
```

`start.sh` and `stop.sh` return the same fields plus `ok` and a one-line `say` (`start.sh` also
`skin`, `settings_added` and `bookmarks`, what it set up on the way).
On failure they return `error`, which is one of `busy`, `missing`, `docker`,
`drive`, `compose`, `web` or `rtl_tcp`. `running` is true only when the
container is up and our `rtl_tcp` is alive. If `rtl_tcp` dies under a running
container, `start.sh` recreates the container. If the Tailscale serve mapping
below is on, `urls.tailscale` shows up as well.

`start.sh` opens Docker Desktop if it isn't running (it waits up to 2 minutes).
The container uses `restart: "no"`, so it never comes back on its own when
Docker starts, and it can't sit on the dongle without the lock.

## Sharing the V4 with the Radio tab

`radio.py` takes an `flock` on `~/Library/Caches/radio/sdr.lock` for each
command. Web SDR takes the same lock and passes the locked file descriptor to
`rtl_tcp` through `exec`. The lock is therefore held exactly as long as
`rtl_tcp` runs, and it is released even if `rtl_tcp` crashes.

- `radio.py` knows Web SDR as its `webrx` job (label "Web SDR"): it recognises
  our `rtl_tcp` by the pid file below, so `radio.py status` names the holder
  "Web SDR" (never `rtl_tcp`). Anything the Radio tab starts (a scan, the
  gadget listener, audio, Planes, APRS, the alert watch, the live view) stops
  Web SDR first with `stop.sh` and records why ("Web SDR stopped so the V4
  could show FM broadcast live"); `radio.py stop` stops it too.
- `radio.py job start webrx` (the tab's Web SDR button, `/radio web on`) stops
  the tab's own jobs with a recorded reason, releases its lock and then runs
  `start.sh`.
- `start.sh` on its own waits up to 60 s for the lock (`WEBRX_LOCK_WAIT`). It
  then waits for the V4 to be free on USB. If something still holds the dongle,
  it gives up with `error: "busy"` and names it the way the tab does ("Planes",
  "the gadget listener", or SDR++). It never kills anything it didn't start.
- `stop.sh` only stops the `rtl_tcp` whose PID is in
  `~/Library/Caches/radio/webrx-rtl_tcp.pid`, and only if that process is still
  named `rtl_tcp`.

## URLs

| From | URL |
|---|---|
| This Mac | http://localhost:8073 |
| iPhone on home Wi-Fi | http://192.168.1.29:8073 (the Mac's LAN address when it started; `status.sh` prints the current one) |
| iPhone over Tailscale | not on by default; see below |

The web UI is published on `127.0.0.1` and on the Mac's LAN address only. It is
not published on `0.0.0.0`, so it isn't reachable at the Tailscale IP until you
choose to turn that on. The LAN address is read from the default route when
`start.sh` runs. If the Mac changes networks, stop and start again. To pin an
address, set `WEBRX_LAN_IP=…`.

On iOS, tap **Start OpenWebRX+** once so Safari allows audio. Over plain
`http://` from another device, the browser isn't in a secure context, so
OpenWebRX+ uses the older ScriptProcessor audio path. It works but is a bit
heavier. HTTPS through Tailscale gives the phone the modern AudioWorklet path.
Plain `http://` is fine on the iPhone since 0.3.3; HTTPS is not needed for the page to work.

### The iPhone: the reload loop (fixed in 0.3.3)

What Seth saw: on the iPhone (Chrome for iOS, which is WebKit like Safari) the page kept flashing
**Start OpenWebRX+**, showed 0 Hz and never settled. The container log showed a new client about
every second, each starting Dire Wolf (the 2 m APRS profile's Packet decoder), then a
`BrokenPipeError` as that client vanished. Desktop Chrome, even at phone width, was fine.

The cause is stock OpenWebRX+ meeting iOS WebKit, not the skin or the plugin. OpenWebRX+ keeps the
tuning in the address bar: every frequency, mode or squelch change runs
`window.location.hash = "freq=…,mod=…,sql=…"`. On iOS WebKit, a page loaded over plain `http://`
from a LAN address (`http://192.168.1.29:8073`) treats each of those writes as a **full page
load**, not a jump within the page. The page reloads, the receiver starts again (a new client, a
new Dire Wolf), and while it starts it writes the hash again in two or three steps (`mod=nfm`, then
`secondary_mod=packet`), each of which reloads it again. On the 2 m APRS profile it never stops; on
an FM profile it settled after one reload, but any later tune (a tap on the waterfall, a new mode)
reloaded it again.

How it was found (iOS Simulator, Mobile Safari, the same WebKit):

- WebKit's own log showed each cycle as a navigation started by the page
  (`PolicyChecker::checkNavigationPolicy` → `continueNavigationInNewProcess`) right after a
  same-document hash change, then the old page's socket closing with "WebSocket is closed due to
  suspension". Every ~2.4 s a new page process loaded
  `…/#freq=144390000,mod=nfm,secondary_mod=packet,sql=-150`.
- Bisect: stock OpenWebRX+ with our plugin skipped and `custom.css` removed reloaded the same way.
- A 10-line test page that only sets `location.hash` once a second reloaded on every write from
  `http://192.168.1.29`, looped forever when it set the hash several times per load, and never
  reloaded from `http://127.0.0.1` or when it used `history.replaceState` instead.
- Ruled out: WebContent memory or crashes (no crash, no jetsam; the waterfall's canvases stayed
  under about 20 MB), the ScriptProcessor audio path (the loop happens before audio starts),
  background decoding (the test receiver had it off), and our plugin's own code (it never touched
  the hash).

The fix (`plugins/receiver/wildcat/wildcat.js`, top): the plugin replaces OpenWebRX+'s
`DemodulatorPanel.prototype.updateHash` with one that writes the same text with
`history.replaceState`, which never loads a page. A reload or a shared link still opens on the same
frequency, typed or map links (`/#freq=…`) still tune, and as a bonus the back button no longer
steps through every tune. Checked in the simulator's Safari over `http://` from the LAN address:
one page load, the socket stays open, switching modes and tuning don't reload.

Static files are cached for an hour (`Cache-Control: max-age=3600`). A phone tab opened before the
update can keep the old plugin for up to an hour: pull down to reload (that re-checks the files),
or close the tab and open the page again.

### Exposing it over Tailscale (Seth's call; not enabled)

Ports 443 and 8443 already serve other apps on this Mac (`:5050`, `:5070`), so
use port 8073 for this:

```sh
tailscale serve --bg --https=8073 http://127.0.0.1:8073
# -> https://<your-mac>.<your-tailnet>.ts.net:8073/   (tailnet only, valid TLS)
tailscale serve status
tailscale serve --https=8073 off      # undo
```

This is tailnet-only. Don't use `tailscale funnel`, because that would put the
receiver on the public internet. The Homebrew `tailscale` CLI (1.92.5) is older
than the running daemon (1.102.4) and prints a warning. The app's own CLI
avoids that: `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve …`.
If port 8073 clashes with the Docker listener, pick another HTTPS port, such as
`--https=10073`. `status.sh` finds any serve mapping that points at
`127.0.0.1:8073`.

## The Wildcat RF skin

`skin/custom.css` gives OpenWebRX+ the Radio tab's dark instrument look: a near-black ground
(`#0b1114`), panels and keys in the tab's slate, the frequency as a teal LCD (`#5ef2d6`) with a
soft glow, amber (`#f4a640`) for whatever you touch, the selected mode lit teal, and a small
**WILDCAT RF** wordmark (teal on a dark plate with an amber edge) where OpenWebRX+'s logo and stock
avatar were. Bookmarks on the scale: the server's (the Radio tab's) amber, the ones you save in this
browser teal, the band plan's dial frequencies a quiet green. It stays readable on the iPhone (390
px): the header's buttons shrink and the receiver's name hides so the wordmark and all seven
buttons fit.

Where it is served: the page asks for `static/css/custom.css`. In the image that is
`/usr/lib/python3/dist-packages/htdocs/css/custom.css`, a link to `/etc/openwebrx/custom.css`. Docker
Desktop can't mount one file inside the `etc` bind mount ("mountpoint is outside of rootfs"), so
`docker-compose.yml` mounts `./skin` read-only at `/opt/wildcat-skin`, and `start.sh` makes
`~/Library/Application Support/radio/openwebrx/etc/custom.css` a link to `/opt/wildcat-skin/custom.css` (a
`custom.css` of your own there, a regular file with something in it, is left alone and wins).
Edit the file in the repo and reload the page; no restart needed.

The keys keep OpenWebRX+'s own sizes (0.3.3). OpenWebRX+ sizes its buttons by their content plus
padding (a mode key is 19 px of text plus 4.2 px top and bottom), so the skin draws a key's edge as
an inset ring (`box-shadow`) and never changes the box model. 0.3.2 used a border with
`box-sizing: border-box`, which squeezed every key to 19 px overall: the labels spilled out of the
keys, the mode rows overlapped and DIG was half covered (the zoom, bookmark and WILDCAT buttons
shrank too). `tests/test_webrx.py` checks that no `.openwebrx-button` rule sets a border or the
box model again. On the phone the WILDCAT button sits just above the receiver panel instead of on
the status bars.

The waterfall's colours aren't touched by the CSS. OpenWebRX+ has a matching setting, so
`settings.json` sets `waterfall_scheme: CustomWaterfall` with `waterfall_colors` from the tab's
own ramp (`radio.py wf_rgb`: near-black at the noise floor, then Turbo). A theme picked in the
page's Receiver › Settings still wins; pick "Default" to come back.

## The receiver plugin: Send to Radio tab and the Wildcat panel

The page loads `static/plugins/receiver/init.js` (OpenWebRX+'s receiver-plugin entry point, mounted
read-only from `plugins/receiver/init.js`). It loads one local plugin, `wildcat`
(`plugins/receiver/wildcat/wildcat.js` + `wildcat.css`), the OpenWebRX+ way:
`Plugins.load('wildcat')`, `Plugins.wildcat.init`, `Plugins.addButton` / `addWindow`. No third-party
code, and nothing is fetched from the internet (the sample init.js's remote plugins aren't used).

- **⇢ Send to Radio tab** (amber, right under the frequency): posts the frequency and mode the page
  is tuned to to the handoff endpoint below. The line under it says what it would send ("133.425
  MHz AM → the Mac's speakers"). The Radio tab plays wide FM, narrow FM and AM; in any other mode
  the button is dimmed and says so (a digital mode sends its underlying NFM/AM). The Radio tab in
  Claude Code then stops Web SDR, tunes the V4 there and plays it on the Mac, so this page
  disconnects a few seconds later. If the tab isn't open, nothing happens and the request is
  dropped after 2 minutes.
- **WILDCAT** (in the plugin stack, left of the receiver panel) opens the **Wildcat RF** window:
  the Radio tab's bookmarks in three tabs (Stations, Notable, Busy lately), each a tap to tune
  (outside the current band it moves the dongle there first, with the signal off the DC spike),
  plus **Map** and **Reload list**. Its list is `static/plugins/receiver/wildcat-data/wildcat.json`,
  written by the bookmark sync to `~/Library/Application Support/radio/openwebrx/wildcat/` and mounted read-only.
- **Tooltips** (0.3.3): every control in the receiver panel, the band and decoder lists, the
  status bars, the header's buttons (Map, Status, Settings...), WILDCAT and Send to Radio tab say
  what they do in plain words, written for this dongle around Walton. With a mouse they are the
  usual hover tooltip (`title`). On a touch screen the first tap on a control shows the same words
  in a small bubble (the tap still does its job); press and hold shows them again any time. The
  guide below can turn the bubbles off (remembered in this browser).
  What the panel's icons are in OpenWebRX+ 1.2.126: speaker = mute, slider = volume; the arrows
  icon and list = tuning step (where a tap snaps to; not the bandwidth); **SQ** = auto squelch,
  slider = squelch; the first waterfall icon = auto contrast, its slider = the waterfall's floor;
  **NR** = noise reduction on/off, slider = how strong; the second waterfall icon = default
  contrast, its slider = the waterfall's ceiling. None of the sliders is a gain or AGC; gain is set
  per band on the server. Display: zoom in / out one step, zoom all the way in / out, the spectrum
  graph on/off, and REC (records what you hear and downloads it).
  Modes that don't apply to this dongle here are drawn quieter and their tooltip starts with
  "Advanced": LSB, USB, CW, DATA, M17, FreeDV, TETRA, RADEL, RADEU, DRM and DAB (shortwave voice
  and data, and other countries' digital radio). FM, WFM, AM, SAM, HDR (HD Radio on FM stations)
  and DIG keep the normal look.
- **?** (beside Send to Radio tab, 0.3.3) opens **How Web SDR works**, a short guide that fits a
  phone: pick a band, tap a signal, pick the mode, squelch, zoom, Send to Radio tab, the Map, and
  one dongle at a time. Tap outside it, ✕ or Esc to close.

## The handoff endpoint (`handoff.py`)

A tiny standard-library HTTP server that `start.sh` starts after the container is up and `stop.sh`
stops first (pid and log in `~/Library/Caches/radio/webrx-handoff.{pid,log}`). It listens on port
**8074** (`WEBRX_HANDOFF_PORT`), on the same addresses as the web UI: `127.0.0.1` and the Mac's LAN
address, never `0.0.0.0`.

It accepts exactly one thing: `POST /handoff` with `Content-Type: application/json` and a body of
exactly `{"mhz": <number 24-1766>, "mode": "wbfm" | "fm" | "am"}`, at most 256 bytes, from the Web
SDR page. Then it writes `handoff.json` into the radio state folder
(`~/Library/Application Support/radio/`, or `RADIO_DIR`): `{mhz, mode, at, from, origin}`.
Everything else gets a 4xx and writes nothing: another method or path (405 / 404), another origin
(403), another content type (415), no length (411), too big (413), anything that isn't that JSON
(400).

The Radio tab reads `handoff.json` every ~1.5 s while Web SDR runs (a file read, no process). A new
one runs `radio.py handoff`, which takes the file (removes it, so it's acted on once), drops it if it
is older than 2 minutes, and otherwise starts Listen on it. Listen stops Web SDR through the normal
job system, recorded as "Web SDR stopped so the V4 could play 133.425 MHz in the Radio tab", with
**Resume Web SDR** offered.

**CORS.** The page (port 8073) and the endpoint (port 8074) are the same host on different ports,
so the browser treats the call as cross-origin. The JSON body makes it send a preflight first;
`OPTIONS /handoff` from the Web SDR page answers 204 with `Access-Control-Allow-Origin: <that
origin>`, `Allow-Methods: POST`, `Allow-Headers: Content-Type` (and `Allow-Private-Network` when
Chrome asks). The plugin calls `<the page's scheme and host>:8074`, so it works from this Mac
(`localhost`) and from the phone on home Wi-Fi (the LAN address). Over Tailscale's https it would
need its own `tailscale serve` mapping for 8074 (not set up; mixed content blocks http from an
https page).

**Security model: LAN-only, no secrets.**

- It's reachable only where the web UI is: this Mac and the home network (not the tailnet, not the
  internet). There is no password or token to protect, and it holds none.
- The only thing it can do is ask the Radio tab to play a frequency. So the worst a stranger on the
  home Wi-Fi can do is stop Web SDR (and make the Mac play a station), which anyone on the LAN
  can already disrupt by retuning the web UI.
- The Origin check (only `http(s)://<this host>:8073`, with `localhost` and `127.0.0.1` the same
  host) plus the JSON content type keep other web pages in the browser from posting to it. It is
  not authentication: a program on the LAN can send any Origin it likes.
- It never runs anything, never reads files, and writes one small file in one folder. The tab
  checks the values again before it plays them.

## Bookmarks from the Radio tab

`webrx.py sync-bookmarks` (`sync-bookmarks.sh`, the tab's **↻ Sync bookmarks**, `/radio web sync`,
and every start) regenerates the live `bookmarks.json` from the Radio tab:

- **Stations**: `radio.py`'s `FM_NAMES` (WKCX ... WKFS), as WFM.
- **Notable**: `SPOTS` (KIH42, the repeaters, 2 m / 70 cm calling, 121.5, marine ch 16 / 13 / 22A,
  MURS, Meshtastic 906.875, MeshCore 910.525, 433.92, ADS-B), APRS 144.390, and each preset's
  marks (`MARKS`, e.g. FRS 1, GMRS 20), in OpenWebRX+'s mode for each (NFM, AM, Packet,
  Meshtastic, MeshCore, ISM, ADS-B).
- **Busy lately**: what the tab's scans and live view found over the last 3 days (each band's
  activity keeps its strongest peaks, `top`, and the last scan's peaks): bursts are "busy", steady
  signals 10 dB or more over the noise are "strong". A frequency with a name in the tables gets
  it ("Marine ch 22A · busy tonight"); any other is labelled by itself ("133.425 · busy
  tonight", "88.7 FM · strong last night"). Names only ever come from the tables: no call sign
  is made up. The V4's spurs, interference combs, data-only bands (LoRa, mesh, 433, ADS-B) and
  frequencies already bookmarked by name are left out; at most 30.

Every generated bookmark's description starts with "Radio tab ·". The sync replaces those, drops
0.3.1's seed bookmarks if they are untouched, and keeps every other bookmark (yours, made in
Settings › Bookmarks); where you have one at the same frequency, yours wins. To keep an edit to a
generated one, also change its description. It also writes the Wildcat panel's list
(`~/Library/Application Support/radio/openwebrx/wildcat/wildcat.json`). Running it while Web SDR runs is fine:
OpenWebRX+ rereads the file when it changes, and the page shows the new ones the next time it loads
or changes band.

## Background decoding

`start.sh` adds these to the live `settings.json` when they are missing (so anything you change in
Settings › Background decoding or the SDR's scheduler stays as you set it), and the seed
`config/settings.json` has them too:

- `services_enabled: true`, `services_decoders: ["packet", "ism"]`
- on the V4, a static scheduler: `{"1000-0400": "2m-aprs", "0400-1000": "ism433"}` (UTC), i.e. the 2 m
  APRS profile most of the day and a new **433 MHz ISM 432.3-434.7 MHz** profile from about midnight
  to 6 am in Walton (11 pm to 5 am in winter)
- `map_position_retention_time: 43200` (12 h on the Map, so an overnight station is still there in
  the morning)

OpenWebRX+'s scheduler only acts when nobody has the page open: about 10 s after the last listener
leaves it tunes the scheduled profile and its background services decode the band plan's dial
frequencies there, APRS (packet) on 144.390 (and 145.825) and rtl_433 (ism) on 433.92. APRS stations
land on the **Map** page (http://localhost:8073/map); OpenWebRX+ keeps no per-packet log of its
own, and nothing is forwarded anywhere (the APRS-IS igate and MQTT stay off: no call sign or
passcode is set). Opening the page joins whatever it is decoding (2 m or 433 MHz); pick any other
profile, because a listener always wins and the scheduler stays out of the way until the page is
closed.

**The one-dongle rule still holds.** Background decoding is part of Web SDR, so Web SDR holds the V4
the whole time it runs, decoding or not. The Radio tab's own jobs (Listen, Live, scans, Planes,
gadgets, APRS) can't run until it stops, and starting one stops Web SDR with the reason recorded,
as always. Turn background decoding off in Settings › Background decoding (log in as admin) if you
want Web SDR idle when nobody's watching.

## Admin

- User `admin`. The password is in the macOS Keychain under service
  `openwebrx-wildcat`, account `admin`:
  `security find-generic-password -a admin -s openwebrx-wildcat -w`
- The container stores only a salted hash, in `users.json` on the external
  drive. No password is written anywhere in this repo.
- `start.sh` creates the user if it's missing. It uses the existing Keychain
  password, or generates one and stores it in the Keychain. The password is
  passed to `docker exec` as an environment variable by name, so it never
  appears on a command line.
- Log in at `/login`, then use **Settings**. To reset the password:
  `docker exec -it wildcat-webrx openwebrx admin resetpassword admin`, then
  update the Keychain item to match.

Anyone who can reach the port can listen and retune; that's normal for
OpenWebRX. `allow_center_freq_changes` is on, with no magic key, so typing a
frequency outside the current profile moves the dongle. Only settings need the
admin login. Chat is off, and there are at most 4 clients.

## Configuration

| What | Where |
|---|---|
| Compose file (image pinned to `slechev/openwebrxplus:1.2.126`) | `webrx/docker-compose.yml`, plus `docker-compose.lan.yml` for the LAN port |
| Seed settings: receiver, SDR, profiles, background decoding, waterfall colours | `webrx/config/settings.json` |
| 0.3.1's seed bookmarks (the sync now writes them) | `webrx/config/bookmarks.json` |
| Skin, receiver plugin, handoff endpoint | `webrx/skin/custom.css`, `webrx/plugins/receiver/`, `webrx/handoff.py` |
| Live settings, users, bookmarks | `~/Library/Application Support/radio/openwebrx/var` (`WEBRX_DATA`, or a one-line `webrx-data` file in the radio folder naming another folder, moves it) |
| Container `/etc/openwebrx` (band plans, built-in bookmarks, the `custom.css` link) | `~/Library/Application Support/radio/openwebrx/etc` |
| The Wildcat panel's list | `~/Library/Application Support/radio/openwebrx/wildcat/wildcat.json` |
| rtl_tcp / handoff log and pid | `~/Library/Caches/radio/webrx-rtl_tcp.{log,pid}`, `webrx-handoff.{log,pid}` |
| Container log | `docker logs wildcat-webrx` |

`start.sh` copies the seed files only when the live file is missing or still
the image's empty `{}` or `[]`, then adds the background-decoding and waterfall
keys only where they are missing, and syncs the bookmarks (above). Changes made
in the web Settings survive. To go back to the seed, stop Web SDR, delete
`~/Library/Application Support/radio/openwebrx/var/settings.json`, and start again.

0.4.0's profiles reach the live file the same way, on the next start
(`webrx.py ensure_settings`, which `start.sh` runs): the ten `bcfm-*` FM
windows and the `hf-*` profiles are added where missing (they are read from
the seed, one source of truth), the FM windows are put first so the default
stays FM, and each of 0.3.x's four gapped FM profiles (`fm-92`, `fm-98`,
`fm-102`, `fm-107`) is retired only if its live copy is exactly the old seed —
one you edited in Settings is kept. So the live config in the data folder
needs no hand edit: stop and start Web SDR once after updating. (The
tests do this against a copy of the live file; the real one is never touched
by them.)

Receiver: "Wildcat RF", Walton, Kentucky, at the town centre (38.8756 N,
84.6105 W, grid EM78qv, 285 m). ITU region 2 and country US are set, so the
built-in NOAA, USCG, marine, GMRS and MURS bookmarks appear. US FM de-emphasis
is 75 µs with RBDS on. The map uses OpenStreetMap. (With a `location.json` in use, the receiver's name and position follow it the next time Web SDR starts, unless you changed them in its own Settings; see "Your location" in the main README. The FM profile names and the ground height stay the Walton ones.)

Profiles: 2.4 MS/s unless noted. Each center sits between channels so the DC
spike stays off them.

| Profile | Center | Starts on |
|---|---|---|
| FM 101.8-104.2 (default, `bcfm-103`) | 103.0 | 102.7 WEBN, WFM + RDS (103.5 WGRR in view) |
| FM 87.8-90.2 … 105.8-108.2 (`bcfm-89` … `bcfm-107`, nine more) | 89, 91, 93, 95, 97, 99, 101, 105, 107 | 89.1 WKCX, 91.7 WVXU, 94.1 WNNF, 95.1, 97.3 WYGY, 98.5 WRRM, 101.9 WKRQ, 105.1 WUBE, 107.1 WKFS |
| NOAA 162.40-162.55 + AIS (1.024 MS/s) | 162.3 | 162.55 KIH42 (AIS 161.975/162.025 in view) |
| Airband 118.0-120.4 / 120.8-123.2 / 132.6-135.0 | 119.2 / 122.0 / 133.8 | AM; 121.5 guard |
| 2 m 143.8-146.2 | 145.0 | 144.39 APRS (Packet decoder) |
| 2 m 145.8-148.2 | 147.0125 | 146.52; 146.79 / 146.88 / 147.03 / 147.255 bookmarked |
| 70 cm 443.8-446.2 | 445.0125 | 446.0 simplex |
| Marine VHF 155.8-158.2 | 157.0125 | Ch 16 156.8 |
| 915 ISM 913.8-916.2 | 915.0 | rtl_433 (ISM decoder) |
| 915 ISM 906.3-908.7 | 907.5 | 906.875 Meshtastic LongFast (Meshtastic decoder) |
| 433 ISM 432.3-434.7 (0.3.2) | 433.5 | 433.92 rtl_433 (ISM decoder); background decoding overnight |
| HF 49 m shortwave + WWV 5 + UVB-76 (4.4-6.8, 2.4 MS/s; `hf-49m`) | 5.6 | 5.000 WWV, AM |
| HF 40 m ham 7.0-7.3 + 41 m shortwave (1.024 MS/s; `hf-40m`) | 7.3 | 7.074 FT8 (WSPR 7.0386, SSTV 7.171 bookmarked) |
| HF weather fax NMG New Orleans (`hf-wefax`) | 8.5 | 8.502 fax (the USB dial for the 8503.9 kHz assignment) |
| HF 31 m shortwave + WWV 10 (`hf-31m`) | 9.7 | 10.000 WWV, AM |
| HF 25 m shortwave (`hf-25m`) | 11.85 | 11.800 AM |
| HF 20 m ham 14.0-14.35 + CHU 14.67 (`hf-20m`) | 14.2 | 14.074 FT8 (WSPR 14.0956 bookmarked) |
| HF 20 m SSTV (`hf-sstv`) | 14.2 | 14.230 sstv |
| HF 19 m shortwave + WWV 15 (`hf-19m`) | 15.5 | 15.000 WWV, AM |
| NAVTEX 518 / 490 kHz (`hf-navtex`) | 0.9 | 518 kHz navtex (the edge of the V4's HF range) |

**The FM windows (0.4.0).** 0.3.x had four FM profiles (90.6-93.0, 96.6-99.0, 100.6-103.0,
105.6-108.0), which left 88-90.6, 93-96.6, 99-100.6 and 103-105.6 MHz unreachable: OpenWebRX+
clamps tuning to the profile, so 103.5 WGRR could not be tuned (Seth hit this live). The ten
`bcfm-*` windows are centred on even megahertz (between channels, so the DC spike never sits on
one), 2.4 MS/s wide, 2 MHz apart, so adjacent windows overlap by 0.4 MHz and every US channel from
87.9 to 107.9 is inside one (`tests/test_webrx_040.py` checks all 101). WEBN's window stays first,
so it stays the default.

**HF (0.4.0).** The `hf-*` profiles use the V4's built-in upconverter: `rtl_tcp` on the Mac
(librtlsdr 2.0.3) adds 28.8 MHz itself when OpenWebRX+ asks for a frequency below 28.8 MHz, so
nothing in the container changes. Each starts on a public, unencrypted mode OpenWebRX+ decodes
itself: FT8 and WSPR (the 40 m and 20 m digital segments), SSTV (14.230), weather fax (NMG), NAVTEX
(518 kHz), and AM for the time signals and the shortwave broadcast bands. UVB-76 4.625 is bookmarked
as a well-known public mystery broadcast. They show noise until an HF antenna is connected (a 10-20 m
long wire through a 9:1 balun); the Radio tab's HF presets stay dimmed until a test hears a carrier.
The Radio tab's bookmark sync adds the HF spots (WWV, CHU, FT8, WSPR, SSTV, fax, NAVTEX, UVB-76) with
those decoders. The 518 kHz window is at the lower edge of what the V4 tunes; expect it to be marginal.

**Optional night FT8 / WSPR slot (off by default).** With an HF antenna, background decoding can
watch 40 m overnight instead of 433 MHz: in Settings › Background decoding add `ft8` and `wspr` to
the decoders, and in the SDR's scheduler change the `0400-1000` slot from `ism433` to `hf-40m`
(or `hf-20m`). Decoded spots stay local (the map); nothing is uploaded unless you set a call sign
and turn on PSK Reporter yourself. The seed leaves this off, so the night slot keeps decoding
433 MHz gadgets until you change it.

FM uses 19.7 dB of gain because the local stations are strong. Everything else
uses 38.6 dB.

## Disk

- Image: `slechev/openwebrxplus:1.2.126` (arm64) takes 1.43 GB on disk (376 MB
  download). It lives in Docker Desktop's disk image (`Docker.raw`), which Docker Desktop
  can keep on an external drive.
- Data folder: about 0.5 MB. Decoder scratch
  files go to a tmpfs. Container logs are capped at 2 × 5 MB.
- To remove it: `webrx/stop.sh && docker image rm slechev/openwebrxplus:1.2.126`,
  then delete `~/Library/Application Support/radio/openwebrx` if you don't want the settings.

## Limitations

- **No USB passthrough on Docker Desktop for Mac.** Everything goes through
  `rtl_tcp`: 8-bit I/Q at up to about 2.4 MS/s (the source accepts up to
  3.2 MS/s, but the V4 drops samples above about 2.56). One window covers about
  2.2 MHz, so wide bands are split into profiles, or you retune by typing a
  frequency.
- **One consumer at a time.** Web SDR and the Radio tab's jobs take turns: the
  tab stops Web SDR when it needs the V4 (and says so), and starting Web SDR
  from the tab stops what the tab was doing.
- **Switching profiles** that changes the sample rate restarts the stream. The
  waterfall blanks for a few seconds.
- **rtl_tcp has no authentication.** It's bound to 127.0.0.1 only. Never pass it
  `-a 0.0.0.0`.
- **The web UI is unauthenticated for listening.** That's fine on the home LAN
  and the tailnet. Don't use Funnel, and don't port-forward it.
- The V4's HF mode (its built-in upconverter) is handled by librtlsdr on the Mac,
  so the HF profiles (0.4.0) work through `rtl_tcp` with no change in the
  container. They need a proper antenna (a long wire through a 9:1 balun) to
  show anything but noise, and the 518 kHz NAVTEX window is at the edge of the
  V4's range.
- OpenWebRX+ serves its static files (the skin, the plugin) with `max-age=3600`. After an
  update, reload the page; a tab that was already open can keep the old files for up to an hour.
- Expected harmless log noise: an `nmcli` Wi-Fi check error (Linux-only
  feature). The old 404s for `custom.css` and `plugins/receiver/init.js` are
  gone: 0.3.2 serves both.
- Resource use (measured): the container uses about 110 MB of RAM and 3-8 % of
  one core per listener. `rtl_tcp` uses under 1 % CPU.

## Upgrading

Change the tag in `docker-compose.yml` and `IMAGE` in `webrx.py` together, run
`docker pull slechev/openwebrxplus:<tag>`, then stop and start Web SDR. Newer
releases migrate `settings.json` automatically (config version 8 today).

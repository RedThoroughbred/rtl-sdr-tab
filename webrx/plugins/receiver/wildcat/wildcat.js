/*
 * Wildcat: the Radio tab's receiver plugin for OpenWebRX+ (Wildcat RF).
 *
 *  - "Send to Radio tab", under the frequency: posts the frequency and mode this page is tuned
 *    to (wide FM, narrow FM or AM) to the handoff endpoint that runs with Web SDR (webrx/
 *    handoff.py, same host, port 8074). The Radio tab in Claude Code then stops Web SDR, tunes
 *    the V4 there and plays it on the Mac. This page disconnects when Web SDR stops.
 *  - The Wildcat panel (a plugin window, from the WILDCAT button beside the receiver panel):
 *    the Radio tab's bookmarks (its stations, the notable frequencies, and what its recent scans
 *    found busy), each a tap to tune, and the Map. The list is static/plugins/receiver/wildcat-data/wildcat.json, which
 *    `webrx.py sync-bookmarks` writes on every Web SDR start and from the tab's Sync button.
 *  - Plain-English tooltips on the receiver's controls (0.3.3): a `title` for the mouse, and on a
 *    phone the first tap on a control (or a press and hold, any time) shows the same words in a
 *    small bubble. Modes that don't apply to this dongle are marked "Advanced".
 *  - "?" beside Send to Radio tab: a short "How Web SDR works" guide (0.3.3).
 *  - The player (0.3.4): one big Play / Stop on the page's own audio engine, a now-playing line
 *    (frequency, mode, station), mute and volume, previous / next bookmark and a frequency field,
 *    sized for a thumb; on a phone it is a bar along the bottom of the screen. See "the player".
 *  - The iPhone reload-loop fix (0.3.3), just below.
 *
 * Follows OpenWebRX+'s receiver-plugin conventions (Plugins.load('wildcat') from init.js,
 * Plugins.wildcat.init, Plugins.addButton / addWindow). No third-party code; jQuery is the page's own.
 */

Plugins.wildcat._version = 1.2;

// The iPhone reload loop (0.3.3). OpenWebRX+ keeps the tuning in the address bar: every frequency,
// mode or squelch change runs `window.location.hash = "freq=…,mod=…"`. In iOS WebKit (Safari, and
// Chrome for iOS, which is WebKit too) a page over plain http from a LAN address treats each of
// those hash writes as a full page load, not a jump within the page: the page reloads, the
// receiver starts again and writes the hash again (in two or three steps, e.g. mod=nfm, then
// secondary_mod=packet), so it reloads forever: "Start OpenWebRX+" flashing, 0 Hz, and a new
// client (a new Dire Wolf on 2 m APRS) every second or two. Stock OpenWebRX+ does it too; desktop
// browsers and http://127.0.0.1 on the phone itself don't. history.replaceState() changes the
// address without a page load anywhere, so a reload or a shared link still opens on the same
// frequency, and the back button no longer steps through every tune.
(function () {
  if (typeof DemodulatorPanel !== 'function' || !window.history || typeof history.replaceState !== 'function') return;
  var stock = DemodulatorPanel.prototype.updateHash;
  DemodulatorPanel.prototype.updateHash = function () {
    var demod = this.getDemodulator();
    if (!demod) return;
    var parts = {
      freq: demod.get_offset_frequency() + this.center_freq,
      mod: demod.get_modulation(),
      secondary_mod: demod.get_secondary_demod(),
      sql: demod.getSquelch(),
      key: this.magic_key
    };
    var hash = Object.keys(parts).filter(function (k) {
      var v = parts[k];
      return !(typeof v === 'undefined' || v === null || v === false || v === '');
    }).map(function (k) { return k + '=' + parts[k]; }).join(',');
    if (location.hash === '#' + hash) return;
    try {
      history.replaceState(history.state, '', '#' + hash);
    } catch (e) {
      stock.call(this);
    }
  };
})();

(function () {
  var W = Plugins.wildcat;
  var DATA = 'static/plugins/receiver/wildcat-data/wildcat.json';
  var TO_TAB = { wfm: 'wbfm', nfm: 'fm', am: 'am', sam: 'am' };
  var SAY = { wbfm: 'wide FM', fm: 'narrow FM', am: 'AM' };

  W.data = null;
  W.port = 8074;
  W.group = 0;
  W.busy = false;
  W.holdUntil = 0;     // a reply stays in view this long before the tuned-to line returns

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mhzText(hz) {
    var s = (hz / 1e6).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return s.indexOf('.') < 0 ? s + '.0' : s;
  }
  W.mhzText = mhzText;
  W.esc = esc;

  // What this page is tuned to, in the Radio tab's terms.
  W.current = function () {
    var demod = UI.getDemodulator && UI.getDemodulator();
    if (!demod) return null;
    var mod = demod.get_modulation();
    var hz = UI.getFrequency();
    if (!hz) return null;
    return { hz: Math.round(hz), modulation: mod, mode: TO_TAB[mod] || null };
  };

  W.handoffUrl = function () {
    var host = location.hostname.indexOf(':') >= 0 ? '[' + location.hostname + ']' : location.hostname;
    return location.protocol + '//' + host + ':' + W.port + '/handoff';
  };

  W.say = function (text, kind) {
    var $s = $('#wc-send-status');
    $s.text(text || '');
    $s.attr('data-kind', kind || '');
  };

  W.refreshSend = function () {
    if (W.busy || Date.now() < W.holdUntil) return;
    var c = W.current();
    var $b = $('#wc-send');
    if (!c) {
      $b.addClass('disabled');
      W.say('');
      return;
    }
    if (c.mode) {
      $b.removeClass('disabled');
      W.say(mhzText(c.hz) + ' MHz ' + SAY[c.mode] + ' → the Mac’s speakers', '');
    } else {
      $b.addClass('disabled');
      W.say('The Radio tab plays WFM, NFM and AM: pick one of those to send.', 'hint');
    }
  };

  W.send = function () {
    var c = W.current();
    if (W.busy || !c) return;
    if (!c.mode) {
      W.holdUntil = Date.now() + 5000;
      W.say('The Radio tab plays WFM, NFM and AM: pick one of those to send.', 'error');
      return;
    }
    W.busy = true;
    $('#wc-send').addClass('disabled');
    W.say('Sending ' + mhzText(c.hz) + ' MHz to the Radio tab…', 'busy');
    fetch(W.handoffUrl(), {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mhz: Math.round(c.hz) / 1e6, mode: c.mode })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; }, function () { return { ok: r.ok, j: {} }; });
    }).then(function (res) {
      W.busy = false;
      W.holdUntil = Date.now() + 10000;
      if (res.ok) {
        W.say((res.j && res.j.say) || 'Sent to the Radio tab.', 'ok');
        $('#wc-send').addClass('sent');
        setTimeout(function () { $('#wc-send').removeClass('sent'); }, 4000);
      } else {
        W.say((res.j && res.j.say) || 'The Radio tab’s handoff refused it.', 'error');
        $('#wc-send').removeClass('disabled');
      }
    }).catch(function () {
      W.busy = false;
      W.holdUntil = Date.now() + 10000;
      $('#wc-send').removeClass('disabled');
      W.say('Could not reach the handoff on port ' + W.port + ' (it runs with Web SDR, from this Mac or home Wi-Fi).', 'error');
    });
  };

  // Tune a bookmark: within the band at once; outside it, W.retune switches to the band that
  // covers it (or moves the dongle there), then tunes. Returns how it got there (see W.retune).
  W.tune = function (b) {
    var hz = Math.round(b.mhz * 1e6);
    var bm = { name: b.name, frequency: hz, modulation: b.modulation, description: b.description };
    return W.retune(hz, { name: b.name, bm: bm });
  };

  // Get to a frequency (0.3.4). Inside the current band: tune now ('here'). Outside: switch to
  // the band (SDR profile) whose name covers it, e.g. "NOAA 162.40-162.55" ('profile'); with no
  // such band, move the dongle there as Web SDR allows, the signal off the DC spike ('move').
  // Either way the tuning waits for the new centre to arrive, then applies o.bm (a bookmark, its
  // mode too) or the frequency, in o.mode when given. 'fail': no connection to send with.
  W.retune = function (hz, o) {
    o = o || {};
    var apply = function () {
      if (o.bm) {
        UI.tuneBookmark(o.bm);
      } else {
        if (o.mode && typeof UI.setModulation === 'function') UI.setModulation(o.mode);
        UI.setFrequency(hz, false);
      }
    };
    var inBand = function () {
      return typeof center_freq === 'number' && bandwidth > 0 && Math.abs(hz - center_freq) < bandwidth / 2 * 0.92;
    };
    if (inBand()) {
      apply();
      return 'here';
    }
    if (typeof ws === 'undefined' || !ws || ws.readyState !== 1) return 'fail';
    var key = UI.getDemodulatorPanel().getMagicKey();
    var how, band = W.bandFor(hz);
    if (band) {
      $('#openwebrx-sdr-profiles-listbox').val(band.value);
      if (typeof sdr_profile_changed === 'function') sdr_profile_changed();
      else ws.send(JSON.stringify({ type: 'selectprofile', params: { profile: band.value, key: key } }));
      how = 'profile';
    } else {
      ws.send(JSON.stringify({ type: 'setfrequency', params: { frequency: hz + Math.round(bandwidth / 2 * 0.3), key: key } }));
      how = 'move';
    }
    var tries = 0;
    var t = setInterval(function () {
      if (inBand()) {
        clearInterval(t);
        setTimeout(apply, 200);   // the demodulator restarts 50 ms after a new centre arrives
      } else if (++tries > 40) {
        clearInterval(t);
        UI.showBubble('Could not move to ' + mhzText(hz) + ' MHz' + (o.name ? ' (' + esc(o.name) + ')' : '') +
          ': pick a band that covers it.');
      }
    }, 150);
    return how;
  };

  // The band (SDR profile) whose name covers a frequency: the names carry their range in MHz
  // ("FM 100.6-103.0", "NOAA 162.40-162.55 + AIS"); the narrowest match wins. null when none does.
  W.bandFor = function (hz) {
    var m = hz / 1e6, best = null;
    $('#openwebrx-sdr-profiles-listbox option').each(function () {
      var name = $(this).text(), re = /(\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d+(?:\.\d+)?)/g, r;
      while ((r = re.exec(name))) {
        var lo = parseFloat(r[1]), hi = parseFloat(r[2]);
        if (lo < hi && hi < 3000 && lo <= m && m <= hi && (!best || hi - lo < best.span)) {
          best = { value: this.value, name: name, span: hi - lo };
        }
      }
    });
    return best;
  };

  W.render = function () {
    var d = W.data;
    var $list = $('#wc-list');
    var $tabs = $('#wc-tabs');
    if (!d || !d.groups || !d.groups.length) {
      $tabs.empty();
      $list.html('<div class="wc-empty">No list yet: Web SDR writes it when it starts (or press Sync bookmarks in the Radio tab).</div>');
      $('#wc-updated').text('');
      return;
    }
    if (W.group >= d.groups.length) W.group = 0;
    $tabs.html(d.groups.map(function (g, i) {
      return '<div class="openwebrx-button wc-tab' + (i === W.group ? ' highlighted' : '') + '" data-group="' + i + '">' +
        esc(g.title) + ' <span class="wc-count">' + g.items.length + '</span></div>';
    }).join(''));
    var items = d.groups[W.group].items;
    $list.html(items.map(function (b, i) {
      var f = mhzText(b.mhz * 1e6);
      var parts = String(b.name).split(' · ');
      var name = parts[0] === f ? '' : esc(parts[0]) + ' ';   // "133.42 · busy tonight": the number is already there
      return '<div class="wc-bm" data-i="' + i + '" title="' + esc(b.description) + '">' +
        '<span class="wc-f">' + esc(f) + '</span>' +
        '<span class="wc-n">' + name + (parts[1] ? '<em>' + esc(parts[1]) + '</em>' : '') + '</span>' +
        '<span class="wc-m">' + esc(String(b.modulation).toUpperCase()) + '</span></div>';
    }).join(''));
    var t = new Date(d.updated);
    $('#wc-updated').text('From the Radio tab · synced ' + t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  };

  W.load = function () {
    return fetch(DATA, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }).then(function (d) {
      W.data = d;
      if (d && d.handoffPort) W.port = d.handoffPort;
      W.render();
    }).catch(function () {
      W.data = null;
      W.render();
    });
  };

  W.init = function () {
    var $freqs = $('#openwebrx-panel-receiver .frequencies-container');
    if (!$freqs.length) return false;

    // "Send to Radio tab": always in view, right under the frequency; "?" (the guide) beside it.
    $('<div class="openwebrx-panel-line wc-send-line">' +
        '<div class="wc-send-row">' +
          '<div id="wc-send" class="openwebrx-button wc-send">' +
            '<span class="wc-arrow">⇢</span> Send to Radio tab</div>' +
          '<div id="wc-help" class="openwebrx-button wc-help" role="button" aria-label="How Web SDR works">?</div>' +
        '</div>' +
        '<div id="wc-send-status" class="wc-send-status"></div>' +
      '</div>').insertAfter($freqs);
    $('#wc-send').on('click', W.send);
    $('#wc-help').on('click', function () { W.guide(true); });

    // The Wildcat panel: a floating window (OpenWebRX+'s plugin window), opened from the
    // WILDCAT button in the plugin stack beside the receiver panel, so the receiver panel
    // keeps its height.
    var win = Plugins.addWindow('wildcat', 'Wildcat RF',
      '<div class="wc-panel">' +
        '<div class="wc-intro">The Radio tab\u2019s bookmarks: tap one to tune there.</div>' +
        '<div id="wc-tabs" class="wc-tabs"></div>' +
        '<div id="wc-list" class="wc-list"></div>' +
        '<div class="wc-row">' +
          '<a class="openwebrx-button wc-map" href="map" target="openwebrx-map" title="Stations, aircraft and gadgets on the map, from what this receiver decodes (APRS in the background)">Map</a>' +
          '<div class="openwebrx-button wc-reload" title="Read the list again">Reload list</div>' +
        '</div>' +
        '<div id="wc-updated" class="wc-updated"></div>' +
      '</div>');
    if (!win) return false;
    Plugins.addButton('wildcat', 'WILDCAT', function () {
      Plugins.toggleWindow('wildcat');
      if ($(win).is(':visible')) W.load();
    });

    $(win).on('click', '.wc-tab', function () {
      W.group = Number($(this).data('group')) || 0;
      W.render();
    });
    $(win).on('click', '.wc-bm', function () {
      var g = W.data && W.data.groups[W.group];
      var b = g && g.items[Number($(this).data('i'))];
      if (b) W.tune(b);
    });
    $(win).on('click', '.wc-reload', function () { W.load(); });

    if (W.playerInit) W.playerInit();   // the player (0.3.4): under the frequency, or along the phone's bottom edge
    W.tipsInit();
    W.load();
    W.refreshSend();
    setInterval(W.refreshSend, 1000);
    return true;
  };
})();

// ---------------------------------------------------------------- tooltips (0.3.3)
//
// Plain words for each control, written for this receiver: one RTL-SDR Blog V4 on VHF/UHF
// profiles. A `title` for the mouse; on a touch screen the first tap on a
// control shows the same words in a bubble (press and hold shows it again). The "?" guide can
// turn the bubbles off. The controls are OpenWebRX+ 1.2.126's own (htdocs/index.html):
//   row 1: speaker = mute, slider = volume; the arrows icon + list = tuning step (not bandwidth)
//   row 2: SQ = auto squelch, slider = squelch; the waterfall icon = auto contrast, slider =
//          the waterfall's floor (its "minimum level")
//   row 3: NR = noise reduction on/off, slider = how strong; the second waterfall icon =
//          default contrast, slider = the waterfall's ceiling ("maximum level")
// None of the sliders is a gain or AGC: gain is set per band on the server.

(function () {
  var W = Plugins.wildcat;

  // Modes that don't apply to this dongle here: shortwave voice and data, other countries'
  // digital systems. Still there for the curious, drawn quieter and marked "Advanced".
  W.ADVANCED = ['lsb', 'usb', 'cw', 'usbd', 'm17', 'freedv', 'tetra', 'radel', 'radeu', 'drm', 'dab',
                'dmr', 'dstar', 'nxdn', 'ysf', 'p25'];

  W.MODE_TIPS = {
    nfm: 'FM (narrow FM): two-way voice. NOAA weather (162.55), ham repeaters on 2 m and 70 cm, marine ch 16, GMRS/FRS walkie-talkies, MURS, railroad. The usual pick on most bands here.',
    wfm: 'WFM (wide FM): FM music and talk stations, 88-108 MHz. The station name and song show up from RDS.',
    am: 'AM: aircraft. The airband, 118-137 MHz (tower, approach, 121.5 emergency). Aircraft never use FM.',
    lsb: 'Advanced. LSB: single-sideband ham voice on shortwave (below 10 MHz). Not useful on this dongle’s VHF/UHF bands.',
    usb: 'Advanced. USB: single-sideband ham voice on shortwave (and weak-signal 2 m at 144.2). Almost never heard on this dongle’s bands.',
    cw: 'Advanced. CW: Morse code, through a narrow filter. A shortwave thing; not useful here.',
    sam: 'SAM (synchronous AM): AM that locks onto the carrier, so a fading signal sounds steadier. Try it on a weak aircraft call if plain AM sounds rough.',
    usbd: 'Advanced. DATA: a wide, unfiltered sideband channel for feeding data decoders. Not for listening.',
    m17: 'Advanced. M17: an open digital ham voice mode on 2 m/70 cm. Rare; you would hear a buzz if anyone nearby used it.',
    freedv: 'Advanced. FreeDV: digital ham voice on shortwave. Not useful on this dongle’s bands.',
    tetra: 'Advanced. TETRA: European digital two-way radio. Not used in the US.',
    radel: 'Advanced. RADE (lower sideband): FreeDV’s newest digital voice, shortwave ham. Not useful here.',
    radeu: 'Advanced. RADE (upper sideband): FreeDV’s newest digital voice, shortwave ham. Not useful here.',
    drm: 'Advanced. DRM: digital shortwave broadcasting. Not useful on this dongle’s bands.',
    dab: 'Advanced. DAB: digital broadcast radio in Europe and elsewhere. There is no DAB in the US.',
    hdr: 'HDR: HD Radio, the digital side of US FM stations (HD1, HD2...). Tune to an FM station and pick HDR; it needs a strong station and a few seconds to lock.',
    dmr: 'Advanced. DMR: digital two-way radio (some repeaters and businesses).',
    dstar: 'Advanced. D-Star: Icom’s digital ham voice.',
    nxdn: 'Advanced. NXDN: digital two-way radio (businesses, some public services).',
    ysf: 'Advanced. YSF: Yaesu System Fusion digital ham voice.',
    p25: 'Advanced. P25: US public-safety digital radio (often encrypted or trunked).'
  };

  W.DIG_TIP = 'DIG: digital decoders, data instead of sound. Pick one in the list: Packet = APRS position reports (144.39), Meshtastic / MeshCore = mesh packets (906.875 / 910.525), ISM = rtl_433 gadgets like weather sensors (433.92, 915), AIS = ships (161.975 / 162.025). Results appear in a panel on the left. Press DIG again for plain listening.';

  // [selector, words]. Several are OpenWebRX+'s own elements, found by id, class or onclick.
  W.TIPS = [
    ['#openwebrx-sdr-profiles-listbox', 'Band (profile): which 2.4 MHz slice the dongle listens to: FM stations, NOAA weather, airband, 2 m, 70 cm, marine, 433/915 MHz gadgets. Changing it moves the dongle for everyone watching (there is one dongle).'],
    ['.openwebrx-secondary-demod-listbox', 'Decoder for DIG: Packet = APRS, Meshtastic / MeshCore = mesh packets, ISM = rtl_433 gadgets, AIS = ships, ADSB = planes (on 1090 MHz, needs its own band). Picking one switches DIG on.'],
    ['.webrx-actual-freq', 'Tuned frequency. Tap a signal on the waterfall to change it, or click a digit and scroll (desktop). Typing a frequency outside this band moves the dongle there.'],
    ['.openwebrx-bookmark-button', 'Bookmark: save this frequency and mode in this browser (it shows on the scale in teal).'],
    ['.openwebrx-mute-button', 'Mute: sound off/on (this browser only).'],
    ['#openwebrx-panel-volume', 'Volume: how loud this browser plays. Nobody else is affected.'],
    ['.openwebrx-slider-button[onclick^="tuning_step_reset"]', 'Tuning step: tap to go back to this band’s usual step.'],
    ['#openwebrx-tuning-step-listbox', 'Tuning step: where a tap on the waterfall snaps to, and how far one scroll notch or arrow moves. 5 kHz suits 2 m, 12.5/25 kHz marine and business radio, 50 kHz FM stations. (This is not the bandwidth.)'],
    ['.openwebrx-squelch-auto', 'SQ, auto squelch: sets the squelch just above the hiss you hear now, so it stays quiet until someone talks. Right-click (desktop): scan this band’s bookmarks.'],
    ['.openwebrx-squelch-slider', 'Squelch: silence until a signal is stronger than this, so you don’t hear hiss between transmissions. All the way left = always open. Slide right until the hiss stops.'],
    ['#openwebrx-waterfall-colors-auto', 'Auto contrast: fit the waterfall colours to what is on screen now. Right-click (desktop): keep doing it.'],
    ['#openwebrx-waterfall-color-min', 'Waterfall floor: the level drawn black. Raise it to hide the noise speckle. Changes the picture only, not what you hear.'],
    ['.openwebrx-nr-toggle', 'NR, noise reduction: on/off. Softens steady hiss on voice (FM, AM). The slider beside it works when NR is on.'],
    ['#openwebrx-panel-nr', 'Noise reduction strength (when NR is on). Too far makes voices watery.'],
    ['#openwebrx-waterfall-colors-default', 'Default contrast: back to the band’s standard waterfall colours.'],
    ['#openwebrx-waterfall-color-max', 'Waterfall ceiling: the level drawn brightest. Lower it to make weak signals stand out. Changes the picture only.'],
    ['[onclick^="zoomInOneStep"]', 'Zoom in: spread the waterfall out around where you are tuned, to tell close signals apart.'],
    ['[onclick^="zoomOutOneStep"]', 'Zoom out one step.'],
    ['[onclick^="zoomInTotal"]', 'Zoom all the way in, around the tuned frequency.'],
    ['[onclick^="zoomOutTotal"]', 'Zoom all the way out: the whole band (2.4 MHz) again.'],
    ['[onclick^="UI.toggleSpectrum"]', 'Spectrum: show or hide the signal-strength graph above the waterfall.'],
    ['.openwebrx-record-button', 'REC: record what you hear. Press again to stop; the recording downloads as an audio file.'],
    ['#openwebrx-smeter', 'Signal meter: how strong the signal is where you are tuned (in dB).'],
    ['.openwebrx-tune-button[onclick^="tuneBySteps(-1)"]', 'Tune down one step.'],
    ['.openwebrx-tune-button[onclick^="tuneBySteps(1)"]', 'Tune up one step.'],
    ['#openwebrx-bar-audio-buffer', 'Audio buffer: sound waiting to play in this browser. Small and steady is good. 0 ms with no sound: tap Start first.'],
    ['#openwebrx-bar-audio-output', 'Audio output: the rate your device plays sound at.'],
    ['#openwebrx-bar-audio-speed', 'Audio stream: how fast sound arrives from the receiver.'],
    ['#openwebrx-bar-network-speed', 'Network: everything this page downloads (waterfall and sound), about 1-2 Mbit/s.'],
    ['#openwebrx-bar-server-cpu', 'Server CPU: how busy Web SDR is on the Mac.'],
    ['#openwebrx-bar-clients', 'Clients: browsers connected right now (at most 4). They all share one dongle and one band.'],
    ['.openwebrx-main-buttons a[href="map"]', 'Map: what this receiver has decoded with a position (APRS stations, ships, some gadgets), on a map. Opens in a new tab.'],
    ['.openwebrx-main-buttons [data-toggle-panel="openwebrx-panel-status"]', 'Status: show or hide the status bars (sound, network, server load, clients).'],
    ['.openwebrx-main-buttons [data-toggle-panel="openwebrx-panel-log"]', 'Log: show or hide the receiver’s log.'],
    ['.openwebrx-main-buttons [data-toggle-panel="openwebrx-panel-receiver"]', 'Receiver: show or hide this control panel.'],
    ['.openwebrx-main-buttons a[href="files"]', 'Files: pictures and recordings this receiver decoded (SSTV, fax).'],
    ['.openwebrx-main-buttons a[href="settings"]', 'Settings: the receiver’s setup (admin login).'],
    ['.openwebrx-main-buttons a[target="openwebrx-help"]', 'Help: OpenWebRX+’s own manual, on the internet. The "?" in the receiver panel is the short Wildcat guide.'],
    ['#wc-send', 'Send to Radio tab: hands this frequency and mode to the Radio tab in Claude Code on the Mac. Web SDR stops and the Mac plays it (WFM, FM or AM).'],
    ['#wc-help', 'How Web SDR works: a short guide.'],
    ['#plugin-button-wildcat', 'The Radio tab’s bookmarks: its stations, notable frequencies and what its scans found busy. Tap one to tune.']
  ];

  var STORE = 'wildcat_tips';
  W.tipsOn = function () {
    try { return localStorage.getItem(STORE) !== 'off'; } catch (e) { return true; }
  };
  W.setTipsOn = function (on) {
    try { localStorage.setItem(STORE, on ? 'on' : 'off'); } catch (e) {}
    W.hintSeen = {};
  };

  // Give one element its words: the title (mouse) and data-wc-tip (touch). OpenWebRX+ rewrites a
  // few titles with the current value ("Squelch (-150 dB)", "Noise reduction level (5 dB)"):
  // those keep our words and add the value.
  W.tip = function (el, text) {
    if (!el || !text) return;
    el.setAttribute('data-wc-tip', text);
    var compose = function () {
      var t = el.getAttribute('title') || '';
      if (t === el._wcTitle) return;
      var m = el._wcTitle && /\(([^()]*\d[^()]*)\)\s*$/.exec(t);
      el._wcTitle = m ? text + ' Now: ' + m[1] + '.' : text;
      el.setAttribute('title', el._wcTitle);
    };
    compose();
    if (!el._wcObserved && window.MutationObserver) {
      el._wcObserved = true;
      new MutationObserver(compose).observe(el, { attributes: true, attributeFilter: ['title'] });
    }
  };

  W.applyTips = function () {
    W.TIPS.forEach(function (t) {
      $(t[0]).each(function () { W.tip(this, t[1]); });
    });
    $('#openwebrx-panel-receiver .openwebrx-demodulator-button').each(function () {
      var mod = $(this).data('modulation');
      if (!mod) {
        W.tip(this, W.DIG_TIP);
        return;
      }
      var words = W.MODE_TIPS[mod];
      if (!words) words = $(this).text() + ': ' + (W.ADVANCED.indexOf(mod) >= 0 ? 'Advanced.' : 'another demodulator.');
      W.tip(this, words);
      $(this).toggleClass('wc-advanced', W.ADVANCED.indexOf(mod) >= 0);
    });
  };

  // ---- the touch bubble
  W.hintSeen = {};
  W.hideHint = function () {
    clearTimeout(W._hintTimer);
    $('#wc-hint').removeClass('show');
  };
  W.showHint = function (el) {
    var text = el.getAttribute('data-wc-tip');
    if (!text) return;
    var $h = $('#wc-hint');
    if (!$h.length) $h = $('<div id="wc-hint" class="wc-hint" role="status"></div>').appendTo('body');
    $h.text(text).addClass('show');
    var r = el.getBoundingClientRect(), w = $h.outerWidth(), h = $h.outerHeight();
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    var top = r.top - h - 8;
    if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 8);
    $h.css({ left: left + 'px', top: top + 'px' });
    clearTimeout(W._hintTimer);
    W._hintTimer = setTimeout(W.hideHint, Math.min(9000, 2500 + text.length * 35));
  };

  W.tipsInit = function () {
    W.applyTips();
    // Mode buttons are drawn when the server's mode list arrives (and again on reconnects).
    if (typeof DemodulatorPanel === 'function' && !DemodulatorPanel.prototype._wcRender) {
      var render = DemodulatorPanel.prototype.render;
      DemodulatorPanel.prototype._wcRender = render;
      DemodulatorPanel.prototype.render = function () {
        var r = render.apply(this, arguments);
        W.applyTips();
        return r;
      };
    }
    setTimeout(W.applyTips, 3000);   // anything drawn late (the plugin button, the panels)

    // Touch: the first tap on a control shows its words; press and hold shows them any time.
    var hold = null;
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      var el = e.target.closest && e.target.closest('[data-wc-tip]');
      if (!el) { W.hideHint(); return; }
      clearTimeout(hold);
      hold = setTimeout(function () { hold = null; el._wcHeld = true; W.showHint(el); }, 500);
    }, true);
    var up = function (e) {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      clearTimeout(hold);
      var el = e.target.closest && e.target.closest('[data-wc-tip]');
      if (!el) return;
      if (el._wcHeld) { el._wcHeld = false; return; }
      if (e.type !== 'pointerup' || !W.tipsOn()) return;
      var key = el.getAttribute('data-wc-tip');
      if (W.hintSeen[key]) return;
      W.hintSeen[key] = true;
      W.showHint(el);
    };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
  };
})();

// ---------------------------------------------------------------- the "?" guide (0.3.3)

(function () {
  var W = Plugins.wildcat;

  var STEPS = [
    ['Pick a band', 'The list under the frequency picks which 2.4 MHz slice the dongle hears: FM stations, NOAA weather, airband, 2 m, 70 cm, marine, gadgets on 433/915 MHz.'],
    ['Tap a signal', 'Bright lines on the waterfall are signals; the dark background is quiet. Tap or click one to tune to it. The frequency shows at the top of the panel.'],
    ['Pick the mode', 'WFM for FM stations. FM for weather, ham repeaters, marine and walkie-talkies. AM for aircraft. DIG plus a decoder (Packet, Meshtastic, ISM) turns data into text instead of sound. The quieter "Advanced" modes are for shortwave and other countries.'],
    ['Squelch', 'Slide SQ right until the hiss stops; it opens again when someone talks. Or tap SQ to set it for you. All the way left = always on.'],
    ['Zoom', 'The magnifiers spread the waterfall out around where you are tuned, to tell close signals apart. Zoom all the way out to see the whole band again.'],
    ['Send to Radio tab', 'The amber button hands this frequency to the Radio tab on the Mac: Web SDR stops and the Mac plays it (WFM, FM or AM).'],
    ['The Map', 'Map, in the top bar, shows what this receiver decoded with a position: APRS stations, ships, some gadgets. With nobody watching, Web SDR keeps decoding APRS (and gadgets overnight) for it.'],
    ['One dongle at a time', 'There is one V4. Everyone watching shares one band, so a new band moves it for all. When the Radio tab needs the V4 (Listen, Planes, a scan), Web SDR stops and this page disconnects.']
  ];

  W.guide = function (open) {
    var $g = $('#wc-guide');
    if (!$g.length) {
      $g = $('<div id="wc-guide" class="wc-guide" role="dialog" aria-modal="true" aria-labelledby="wc-guide-title">' +
        '<div class="wc-guide-card">' +
          '<div class="wc-guide-head">' +
            '<div id="wc-guide-title" class="wc-guide-title">How Web SDR works</div>' +
            '<div class="openwebrx-button wc-guide-close" role="button" aria-label="Close">✕</div>' +
          '</div>' +
          '<ol class="wc-guide-steps">' + STEPS.map(function (s) {
            return '<li><b>' + s[0] + '.</b> ' + s[1] + '</li>';
          }).join('') + '</ol>' +
          '<div class="wc-guide-foot">' +
            '<label class="wc-guide-tips"><input type="checkbox" id="wc-tips-toggle"> Tap hints: the first tap on a control says what it does (press and hold for it again)</label>' +
            '<div class="wc-guide-note">On a phone, tap Start once so it can play sound. Hover a control on a computer to see what it does.</div>' +
          '</div>' +
        '</div></div>').appendTo('body');
      $g.on('click', function (e) { if (e.target === this) W.guide(false); });
      $g.on('click', '.wc-guide-close', function () { W.guide(false); });
      $g.on('change', '#wc-tips-toggle', function () { W.setTipsOn(this.checked); });
      $(document).on('keydown', function (e) { if (e.key === 'Escape' && $('#wc-guide').is(':visible')) W.guide(false); });
    }
    if (open) {
      if (W.hideHint) W.hideHint();
      $('#wc-tips-toggle').prop('checked', W.tipsOn());
      $g.css('display', 'flex');
      $g.find('.wc-guide-card').scrollTop(0);
    } else {
      $g.hide();
    }
  };
})();

// ---------------------------------------------------------------- the player (0.3.4)
//
// One big Play / Stop, a now-playing line, mute and volume, previous / next bookmark and a
// "type a frequency" field, all on OpenWebRX+ 1.2.126's own functions (htdocs/lib/AudioEngine.js,
// UI.js, openwebrx.js):
//   Play / Stop   audioEngine.resume() / audioEngine.audioContext.suspend(). The Web Audio context
//                 is what makes sound: suspended, nothing plays and the status panel's audio-output
//                 bar falls to 0 (the receiver keeps streaming, so Play is instant and nothing on
//                 the server changes). Before the first tap on a phone the context is not allowed
//                 to run: the button says "Enable Sound" and that tap is the gesture iOS wants, the
//                 same call the "Start OpenWebRX+" overlay makes. A build whose context cannot be
//                 suspended falls back to muting.
//   Mute          UI.toggleMute(); volume: UI.setVolume() in OpenWebRX+'s 0-150 steps. The native
//                 speaker button and slider stay in step because the state is read back from
//                 UI.volume / UI.volumeMuted and the audio context every 400 ms, never kept here.
//   Now playing   UI.getFrequency(), UI.getModulation() (Modes gives the label); the name from RDS
//                 when the WFM panel has one, else the nearest Wildcat bookmark, else the page's
//                 own bookmarks.
//   Prev / next   step through the group the Wildcat panel shows (Stations at first), with W.tune,
//                 which switches band when it has to (W.retune).
//   Frequency     W.retune: inside the band UI.setFrequency; outside, the band whose name covers
//                 it, else move the dongle as the bookmark list does and say that no band covers
//                 it (the FM gaps between the bands are being fixed separately). A bookmark within
//                 6 kHz brings its mode; a bare frequency gets WFM on 88-108, AM on the airband.
// Anything this build lacks (no audioEngine, no UI.toggleMute) hides that control and leaves the
// native one; the poll never lets an error out. On a phone (600 px and under) the player is a
// bar fixed along the bottom of the screen, the thumb's reach, and the OpenWebRX+ panels move up
// by its height so nothing overlaps. Nothing here touches the keys' box model.

(function () {
  var W = Plugins.wildcat;
  var P = W.player = {};
  var PHONE = '(max-width: 600px)';
  var STEP = 10;            // one volume tap, in OpenWebRX+'s 0-150 steps
  var NEAR = 6000;          // Hz: "that bookmark is what we are tuned to"

  function fn(f) { return typeof f === 'function'; }
  function eng() {
    return (typeof audioEngine !== 'undefined' && audioEngine && audioEngine.audioContext) ? audioEngine : null;
  }
  function ui() { return (typeof UI !== 'undefined' && UI) ? UI : null; }

  var ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/>' +
      '<path d="M16 8.5a4.5 4.5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/>' +
      '<path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM19 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM5 5v14l10-7z"/></svg>'
  };

  // ---- what the sound is doing: off (no engine on this page) | enable | starting | playing | stopped
  P.state = function () {
    var e = eng(), U = ui();
    if (!e || !U || !fn(U.toggleMute) || !fn(U.setVolume) || !fn(e.isAllowed) || !fn(e.isStarted)) return 'off';
    if (!e.isAllowed()) return e.isStarted() ? 'stopped' : 'enable';
    if (!e.isStarted()) return 'starting';
    return 'playing';
  };
  P.muted = function () { var U = ui(); return !!(U && U.volumeMuted >= 0); };

  P.play = function () {
    var e = eng();
    if (!e) return;
    P.wantSound = true;    // once the engine runs, unmute too: Play means "I want to hear it"
    try { if (!e.isAllowed() && fn(e.resume)) e.resume(); } catch (x) {}
    P.unmuteIfWanted();
    P.tick();
  };
  P.unmuteIfWanted = function () {
    var e = eng(), U = ui();
    if (!P.wantSound || !e || !U || !e.isStarted()) return;
    P.wantSound = false;
    if (U.volumeMuted >= 0) U.toggleMute(false);
    if (U.volume === 0) U.setVolume(P.lastVol || 60);
  };
  P.stop = function () {
    var e = eng(), U = ui();
    if (!e) return;
    P.wantSound = false;
    var ctx = e.audioContext;
    if (ctx && fn(ctx.suspend)) {
      try {
        var p = ctx.suspend();
        if (p && fn(p.then)) p.then(P.tick, P.tick);
      } catch (x) {
        if (U) U.toggleMute(true);
      }
    } else if (U) {
      U.toggleMute(true);    // this build can't pause its audio context: mute instead
    }
    P.tick();
  };
  P.toggle = function () {
    var s = P.state();
    if (s === 'playing' || s === 'starting') P.stop();
    else if (s !== 'off') P.play();
  };
  P.mute = function () {
    var U = ui(), e = eng();
    if (!U || !e || !e.isStarted()) return;
    U.toggleMute();
    P.tick();
  };
  P.volume = function (d) {
    var U = ui(), e = eng();
    if (!U || !e || !e.isStarted()) return;
    if (U.volumeMuted >= 0) {
      if (d < 0) return;
      U.toggleMute(false);   // louder while muted: hear it again first
    }
    var v = Math.max(0, Math.min(150, (U.volume < 0 ? 100 : U.volume) + d));
    U.setVolume(v);
    if (v > 0) P.lastVol = v;
    P.tick();
  };

  // ---- what is tuned
  P.now = function () {
    var U = ui(), hz = 0, mod = '';
    try {
      hz = U && fn(U.getFrequency) ? U.getFrequency() : 0;
      mod = U && fn(U.getModulation) ? U.getModulation() : '';
    } catch (x) {}
    var m = (typeof Modes !== 'undefined' && Modes && fn(Modes.findByModulation)) ? Modes.findByModulation(mod) : null;
    return { hz: hz, mod: mod, label: (m && m.name) || String(mod || '').toUpperCase(), name: hz ? P.nameFor(hz, mod) : '' };
  };
  P.shortName = function (b) {
    var n = String(b.name || '').split(' · ')[0].trim();
    return n === W.mhzText(b.mhz * 1e6) ? '' : n;    // "133.425 · busy tonight" has no real name
  };
  P.nameFor = function (hz, mod) {
    if (mod === 'wfm') {        // RDS first: what the station says it is
      try {
        var $w = $('#openwebrx-panel-metadata-wfm');
        var inst = fn($w.metaPanel) ? $w.metaPanel()[0] : null;
        var ps = inst && (inst.long_stationname || inst.ps);
        if (ps && String(ps).trim()) return String(ps).trim();
      } catch (x) {}
    }
    var tol = mod === 'wfm' ? 100000 : NEAR, best = '', bestD = Infinity;
    var consider = function (f, m, name) {
      var d = Math.abs(f - hz);
      if (d > tol || !name) return;
      if (m && mod && m !== mod) d += tol;    // the same mode wins; another mode still counts
      if (d < bestD) { bestD = d; best = name; }
    };
    P.list(true).forEach(function (b) { consider(Math.round(b.mhz * 1e6), b.modulation, P.shortName(b)); });
    try {
      if (typeof bookmarks !== 'undefined' && bookmarks && fn(bookmarks.getAllBookmarks)) {
        bookmarks.getAllBookmarks().forEach(function (b) { consider(b.frequency, b.modulation, b.name); });
      }
    } catch (x) {}
    return best;
  };

  // ---- the bookmarks: the group the Wildcat panel shows for prev / next; all of them for naming
  P.group = function () {
    var d = W.data;
    if (!d || !d.groups || !d.groups.length) return null;
    return d.groups[W.group < d.groups.length ? W.group : 0];
  };
  P.list = function (all) {
    var d = W.data, g = P.group();
    if (!g) return [];
    var seen = {}, out = [];
    (all ? d.groups : [g]).forEach(function (grp) {
      (grp.items || []).forEach(function (b) {
        var k = Math.round(b.mhz * 1e6) + '|' + b.modulation;
        if (!seen[k]) { seen[k] = 1; out.push(b); }
      });
    });
    return out.sort(function (a, b) { return a.mhz - b.mhz; });
  };
  P.step = function (dir) {
    var L = P.list(false), U = ui();
    if (!L.length) {
      if (U && fn(U.showBubble)) U.showBubble('No bookmarks yet: Web SDR writes the list when it starts (Reload list in the WILDCAT panel).');
      return;
    }
    var hz = U && fn(U.getFrequency) ? U.getFrequency() : 0;
    var i = -1, best = Infinity, j, k;
    L.forEach(function (b, n) { var d = Math.abs(b.mhz * 1e6 - hz); if (d < best) { best = d; i = n; } });
    if (best <= NEAR) {
      j = (i + dir + L.length) % L.length;            // on a bookmark: the one after / before it
    } else if (dir > 0) {
      j = 0;
      for (k = 0; k < L.length; k++) { if (L[k].mhz * 1e6 > hz) { j = k; break; } }
    } else {
      j = L.length - 1;
      for (k = L.length - 1; k >= 0; k--) { if (L[k].mhz * 1e6 < hz) { j = k; break; } }
    }
    W.tune(L[j]);
    P.tick();
  };

  // ---- the frequency field
  P.parse = function (t) {
    var v = parseFloat(String(t || '').trim().replace(',', '.').replace(/\s*mhz$/i, ''));
    if (!isFinite(v) || v <= 0) return 0;
    if (v >= 3e6) return Math.round(v);          // typed in Hz
    if (v >= 3000) return Math.round(v * 1e3);   // kHz
    return Math.round(v * 1e6);                  // MHz, the usual
  };
  P.goto = function (text) {
    var hz = P.parse(text);
    if (!hz || hz < 24e6 || hz > 1766e6) {
      P.hint('Type a frequency in MHz, 24 to 1766: 102.7, 162.55, 121.5.', true);
      return false;
    }
    var match = null, bestD = NEAR;
    P.list(true).forEach(function (b) { var d = Math.abs(b.mhz * 1e6 - hz); if (d <= bestD) { bestD = d; match = b; } });
    var how = match ? W.tune(match) : W.retune(hz, { mode: P.modeFor(hz) });
    if (how === 'move') {
      P.hint('No band covers ' + W.mhzText(hz) + ' MHz, so the dongle is moving there as it is. (FM between the bands is a gap being fixed.)', true);
    } else if (how === 'fail') {
      P.hint('Not connected to the receiver yet: try again in a moment.', true);
    } else {
      P.hint('', false);
    }
    $('#wc-freq').val('').blur();
    P.tick();
    return true;
  };
  // A sensible mode for a bare frequency, as a radio would pick it: FM stations wide FM, the
  // airband AM, everything else narrow FM (a bookmark nearby brings its own mode instead).
  P.modeFor = function (hz) {
    var m = hz / 1e6;
    if (m >= 87.5 && m <= 108) return 'wfm';
    if (m >= 118 && m < 137) return 'am';
    return 'nfm';
  };
  P.hint = function (text, warn) {
    clearTimeout(P._hintT);
    P._hint = text || '';
    P._hintWarn = !!warn;
    var $f = $('#wc-freq');
    if (text) {
      $f.attr('title', text);
      P._hintT = setTimeout(function () { P._hint = ''; P.tick(); }, 9000);
    } else {
      $f.removeAttr('title');
    }
    P.tick();
  };

  // ---- draw the state (every 400 ms, and right after anything we do)
  P.tick = function () {
    try { P._tick(); } catch (x) { /* the player never breaks the page */ }
  };
  P._tick = function () {
    var $p = $('#wc-player');
    if (!$p.length) return;
    var e = eng(), U = ui();
    if (e && e.audioContext && !e.audioContext._wcWatched && fn(e.audioContext.addEventListener)) {
      e.audioContext._wcWatched = true;
      e.audioContext.addEventListener('statechange', function () { setTimeout(P.tick, 0); });
    }
    P.unmuteIfWanted();
    var s = P.state(), muted = P.muted(), np = P.now();
    var started = !!(e && fn(e.isStarted) && e.isStarted());
    if (U && U.volume > 0) P.lastVol = U.volume;

    $p.attr('data-state', s).attr('data-muted', muted ? '1' : '0');
    var word = { off: 'Sound', enable: 'Enable Sound', starting: 'Starting…', playing: 'Stop', stopped: 'Play' }[s];
    if (P._word !== word) {
      P._word = word;
      $('#wc-play .wc-lbl').text(word);
      $('#wc-play .wc-ico').html(s === 'playing' ? ICON.stop : ICON.play);
      $('#wc-play').attr('aria-label', word);
    }
    var gone = typeof ws !== 'undefined' && ws && typeof ws.readyState === 'number' && ws.readyState !== 1;
    var status = gone ? 'Disconnected' : s === 'enable' ? 'Tap to enable sound' : s === 'starting' ? 'Starting sound…' :
      s === 'stopped' ? 'Stopped' : s === 'off' ? 'Tuned to' : muted ? 'Muted' : 'Playing';
    $('#wc-np-state').text(status);
    $('#wc-np-freq').text(np.hz ? W.mhzText(np.hz) : '—');
    $('#wc-np-mode').text(np.hz ? np.label : '');
    $('#wc-np-name').text(np.name || '').toggle(!!np.name);
    if (P._muted !== muted) {
      P._muted = muted;
      $('#wc-mute').html(muted ? ICON.muted : ICON.speaker).attr('aria-label', muted ? 'Unmute' : 'Mute').toggleClass('wc-lit', muted);
    }
    var vol = U && U.volume >= 0 ? U.volume : null;
    $('#wc-vol-val').text(vol === null ? '–' : String(muted ? 0 : vol));
    $('#wc-mute, #wc-vol-down, #wc-vol-up').toggleClass('wc-off', !started);

    var L = P.list(false), g = P.group();
    var cap = P._hint || (L.length ? (g.title + ' · ' + L.length + ' · previous / next') : 'Type a frequency in MHz');
    $('#wc-cap').text(cap).toggleClass('wc-warn', !!(P._hint && P._hintWarn));
    P.place();
  };

  // Where the player lives: under the frequency in the receiver panel; on a phone a bar fixed
  // along the bottom of the screen (the panel's own transform would pin a fixed child to it, so
  // the bar moves to <body>), and the panels move up by the bar's height.
  P.place = function () {
    var el = document.getElementById('wc-player'), slot = P.slot;
    if (!el || !slot) return;
    var phone = !!(window.matchMedia && window.matchMedia(PHONE).matches);
    if (phone) {
      if (el.parentNode !== document.body) document.body.appendChild(el);
      document.body.classList.add('wc-phone-player');
      var h = el.offsetHeight;
      if (h && h !== P._h) {
        P._h = h;
        document.body.style.setProperty('--wc-player-h', h + 'px');
      }
    } else {
      if (el.previousElementSibling !== slot) slot.insertAdjacentElement('afterend', el);
      document.body.classList.remove('wc-phone-player');
    }
  };

  P.init = function () {
    if (document.getElementById('wc-player')) return;
    var $freqs = $('#openwebrx-panel-receiver .frequencies-container');
    if (!$freqs.length) return;
    P.slot = $('<div id="wc-player-slot" class="wc-player-slot"></div>').insertAfter($freqs)[0];
    $('<div id="wc-player" class="wc-player" data-state="off" data-muted="0">' +
        '<div class="wc-np">' +
          '<span id="wc-np-state" class="wc-np-state">Tuned to</span>' +
          '<span id="wc-np-freq" class="wc-np-freq">—</span>' +
          '<span id="wc-np-mode" class="wc-np-mode"></span>' +
          '<span id="wc-np-name" class="wc-np-name"></span>' +
        '</div>' +
        '<div class="wc-row wc-row-play">' +
          '<button id="wc-prev" class="wc-k wc-sq" type="button" aria-label="Previous bookmark">' + ICON.prev + '</button>' +
          '<button id="wc-play" class="wc-k wc-play" type="button" aria-label="Play">' +
            '<span class="wc-ico">' + ICON.play + '</span><span class="wc-lbl">Play</span></button>' +
          '<button id="wc-next" class="wc-k wc-sq" type="button" aria-label="Next bookmark">' + ICON.next + '</button>' +
        '</div>' +
        '<div class="wc-row wc-row-aux">' +
          '<div class="wc-audio">' +
            '<button id="wc-mute" class="wc-k wc-sq" type="button" aria-label="Mute">' + ICON.speaker + '</button>' +
            '<button id="wc-vol-down" class="wc-k wc-sq" type="button" aria-label="Quieter">−</button>' +
            '<span id="wc-vol-val" class="wc-vol-val" aria-label="Volume">–</span>' +
            '<button id="wc-vol-up" class="wc-k wc-sq" type="button" aria-label="Louder">+</button>' +
          '</div>' +
          '<form id="wc-goto" class="wc-goto" novalidate>' +
            '<input id="wc-freq" type="text" inputmode="decimal" autocomplete="off" autocorrect="off" spellcheck="false" ' +
              'placeholder="MHz" aria-label="Frequency in MHz" enterkeyhint="go">' +
            '<button class="wc-k wc-go" type="submit">Go</button>' +
          '</form>' +
        '</div>' +
        '<div id="wc-cap" class="wc-cap"></div>' +
      '</div>').insertAfter(P.slot);

    var $p = $('#wc-player');
    $p.on('click', '#wc-play', function () { P.toggle(); });
    $p.on('click', '#wc-mute', function () { P.mute(); });
    $p.on('click', '#wc-vol-down', function () { P.volume(-STEP); });
    $p.on('click', '#wc-vol-up', function () { P.volume(STEP); });
    $p.on('click', '#wc-prev', function () { P.step(-1); });
    $p.on('click', '#wc-next', function () { P.step(1); });
    $p.on('submit', '#wc-goto', function (e) { e.preventDefault(); P.goto($('#wc-freq').val()); });
    // OpenWebRX+'s keyboard shortcuts are for the page, not for typing in this field.
    $p.on('keydown keyup keypress', '#wc-freq', function (e) { e.stopPropagation(); });

    // The native speaker button and slider: redraw at once (the poll covers everything else).
    $(document).on('click', '.openwebrx-mute-button', function () { setTimeout(P.tick, 0); });
    $(document).on('input change', '#openwebrx-panel-volume', function () { setTimeout(P.tick, 0); });
    if (window.matchMedia) {
      var mq = window.matchMedia(PHONE);
      if (fn(mq.addEventListener)) mq.addEventListener('change', P.tick);
      else if (fn(mq.addListener)) mq.addListener(P.tick);
    }
    window.addEventListener('resize', P.tick);

    if (W.TIPS) {
      W.TIPS.push(
        ['#wc-play', 'Play / Stop: sound in this browser. Stop pauses the sound here only (the receiver keeps running), so Play is instant. On a phone the first tap enables sound.'],
        ['#wc-mute', 'Mute: sound off/on, this browser only. The volume keys bring it back.'],
        ['#wc-vol-down', 'Quieter, one step.'],
        ['#wc-vol-up', 'Louder, one step (unmutes).'],
        ['#wc-prev', 'Previous bookmark in the WILDCAT panel’s current list (Stations at first), switching band when it has to.'],
        ['#wc-next', 'Next bookmark in the WILDCAT panel’s current list (Stations at first), switching band when it has to.'],
        ['.wc-go', 'Go to the frequency typed, in MHz. Outside this band it switches to the band that covers it.']
      );
    }
    P.tick();
    P.timer = setInterval(P.tick, 400);
  };
  W.playerInit = P.init;
})();

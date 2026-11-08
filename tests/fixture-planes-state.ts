// A hand-made `adsb.py state` (the receiver is a made-up town centre; every address and call sign is
// invented). Times are unix ms in the fake world's clock (GADGETS.now + 60 s is "now").
const NOW = 1791247407553 + 60_000
const ac = (o: Record<string, unknown>) => ({ icao: 'A00001', reg: null, callsign: null, category: 'A3', categoryLabel: 'Large', squawk: '1200', emergency: 'none', alt: null, altGnss: null, onGround: false, lat: null, lon: null, posAt: null, posSource: null, distNm: null, bearing: null, gs: null, track: null, vr: null, trail: [], firstSeen: NOW - 300_000, lastSeen: NOW - 4000, msgs: 40, via: ['adsb'], ...o })

export const PLANES_STATE = {
  version: 1,
  kind: 'adsb',
  updated: NOW - 3000,
  receiver: { id: 'home', name: 'Test Town', lat: 38.0, lon: -84.0 },
  airports: [],
  source: { mode: 'live', gain: 49.6, started: NOW - 600_000, seconds: 600, file: null, device: 'Blog V4' },
  stats: { frames: 900, aircraft: 4, withPosition: 3, maxRangeNm: 61, msgPerSec: 14 },
  job: { running: true, pid: 4242, since: NOW - 600_000, lastExit: null },
  aircraft: [
    ac({ icao: 'A11111', callsign: 'DAL123', alt: 11200, gs: 245, lat: 38.1, lon: -84.0, distNm: 6.1, bearing: 2, track: 180, vr: -1500, lastSeen: NOW - 2000 }),
    ac({ icao: 'A22222', reg: 'N22222', callsign: null, alt: 36000, gs: 470, distNm: 42.6, bearing: 93.5, track: 270, lat: 38.0, lon: -83.1, lastSeen: NOW - 9000 }),
    ac({ icao: 'A33333', callsign: 'UPS77', alt: 4300, gs: 190, distNm: 12.4, bearing: 215, emergency: 'nordo', squawk: '7600', lat: 37.9, lon: -84.2, lastSeen: NOW - 1000 }),
    ac({ icao: 'A44444', callsign: null, alt: 21000, gs: null, distNm: null, bearing: null, lastSeen: NOW - 30_000 }),
  ],
}

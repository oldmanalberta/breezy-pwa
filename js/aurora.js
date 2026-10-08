/* Aurora forecast from NOAA's Space Weather Prediction Center (US government
   work, public domain, so it is fine in a paid app too).

   Two feeds:
   - OVATION Prime: a global 1° grid of aurora intensity for the next 30–90
     minutes (the solar wind's travel time from the L1 monitor to Earth).
     SWPC suggests reading it as a viewing probability, which is what it is
     used as here.
   - The 3-day planetary Kp forecast, in 3-hour blocks, for the nights ahead.

   Everything that makes it local (looking north of you, whether it is dark,
   the moon, the cloud) is worked out in render.js from data Breezy already
   has; this module only fetches, caches and samples. */

const OVATION = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const KP = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

const FRESH_MS = 10 * 60e3;      // OVATION refreshes every few minutes; 10 is plenty
let cache = null, busy = null;

/* The grid as a flat array: index = lon * 181 + (lat + 90), lon 0–359. */
function parseOvation(d) {
  const g = new Float32Array(360 * 181);
  for (const [lon, lat, v] of d.coordinates ?? []) {
    const x = ((Math.round(lon) % 360) + 360) % 360, y = Math.round(lat) + 90;
    if (y >= 0 && y <= 180) g[x * 181 + y] = v;
  }
  return {
    grid: g,
    observed: new Date(d['Observation Time'] ?? Date.now()),
    forecast: new Date(d['Forecast Time'] ?? Date.now()),
  };
}

/* SWPC has published this product both as an array of rows under a header row
   and as an array of objects; accept either. */
function parseKp(d) {
  if (!Array.isArray(d)) return [];
  let rows = d;
  if (Array.isArray(d[0])) {
    const head = d[0].map(String);
    rows = d.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  return rows.map((r) => ({
    time: new Date(`${String(r.time_tag).replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(r.time_tag) ? '' : 'Z'}`),
    kp: Number(r.kp),
    kind: r.observed ?? r.status ?? '',     // observed | estimated | predicted
  })).filter((r) => !isNaN(r.time) && !isNaN(r.kp));
}

export async function fetchAurora() {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache;
  if (busy) return busy;
  busy = (async () => {
    const [ov, kp] = await Promise.allSettled([
      fetch(OVATION).then((r) => { if (!r.ok) throw new Error(`OVATION ${r.status}`); return r.json(); }),
      fetch(KP).then((r) => { if (!r.ok) throw new Error(`Kp ${r.status}`); return r.json(); }),
    ]);
    if (ov.status !== 'fulfilled' && kp.status !== 'fulfilled') throw ov.reason;
    cache = {
      at: Date.now(),
      ovation: ov.status === 'fulfilled' ? parseOvation(ov.value) : null,
      kp: kp.status === 'fulfilled' ? parseKp(kp.value) : [],
    };
    return cache;
  })().finally(() => { busy = null; });
  return busy;
}

export const auroraCached = () => cache;

/* Bilinear sample of the grid at any lat/lon, wrapping in longitude. */
export function sampleOvation(ov, lat, lon) {
  if (!ov) return 0;
  const g = ov.grid;
  const x = ((lon % 360) + 360) % 360, y = Math.max(0, Math.min(180, lat + 90));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const x1 = (x0 + 1) % 360, y1 = Math.min(180, y0 + 1);
  const at = (i, j) => g[i * 181 + j];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy)
       + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/* Aurora sits 100–300 km up, so one overhead a few hundred kilometres
   poleward of you still shows above your horizon, lower and fainter the
   further away it is. Look up to ~9° of latitude poleward, discounting with
   distance, and across a couple of degrees of longitude either side. */
export function localChance(ov, lat, lon) {
  if (!ov) return null;
  const pole = lat >= 0 ? 1 : -1;
  let best = 0, overhead = 0;
  for (let d = 0; d <= 9; d += 0.5) {
    const w = 1 - d / 12;
    for (let dl = -2; dl <= 2; dl += 1) {
      const v = sampleOvation(ov, lat + pole * d, lon + dl) * w;
      if (d === 0 && dl === 0) overhead = v;
      if (v > best) best = v;
    }
  }
  return { chance: Math.round(Math.min(100, best)), overhead: Math.round(overhead) };
}

/* Geomagnetic latitude from a tilted dipole. The pole is IGRF's 2025 dipole
   position; it drifts a fraction of a degree a year, which is well inside the
   slop of the Kp rule of thumb this feeds. */
const POLE_LAT = 80.8, POLE_LON = -72.6;
export function magLat(lat, lon) {
  const r = Math.PI / 180;
  const s = Math.sin(lat * r) * Math.sin(POLE_LAT * r)
          + Math.cos(lat * r) * Math.cos(POLE_LAT * r) * Math.cos((lon - POLE_LON) * r);
  return Math.asin(Math.max(-1, Math.min(1, s))) / r;
}

/* How far equatorward the oval reaches for a given Kp: the geomagnetic
   latitude where it is roughly overhead (the usual SWPC-style table, about
   2° per Kp step). It is seen low on the poleward horizon from roughly 6°
   further equatorward. */
export const ovalEdge = (kp) => 66.5 - 2.05 * kp;
export const HORIZON_REACH = 6;

/* Map colours: faint green through bright green to the red-violet of a
   strong display, with alpha rising alongside. v is 0–100. */
export function auroraColour(v) {
  if (v < 4) return null;
  const t = Math.min(1, v / 60);
  const stops = [[0, [40, 200, 110]], [0.45, [70, 255, 140]], [0.75, [190, 240, 90]], [1, [235, 70, 160]]];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
  const f = (t - a[0]) / ((b[0] - a[0]) || 1);
  const rgb = a[1].map((c, i) => Math.round(c + (b[1][i] - c) * f));
  return [...rgb, Math.round(255 * Math.min(0.55, 0.12 + t * 0.55))];
}

/* localStorage-backed settings, saved places, and last-good weather payload
   (so the app opens with real content when the phone is offline). */

const KEY = 'breezy.v1';

const DEFAULTS = {
  unit: 'C',
  wind: 'kmh',
  source: 'auto',
  fx: 'on',
  mapTheme: 'terrain',     // radar base map key, see BASEMAPS in radar.js
  radarFlow: 'on',         // motion interpolation between radar scans
  dailyMode: 'conditions', // which series the daily panel charts
  order: null,             // card order; null means the default arrangement
  places: [],              // [{id,name,admin,cc,lat,lon,tz,current?:bool}]
  activeId: null,
};

function read() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export const state = read();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export function set(k, v) { state[k] = v; save(); }

export function addPlace(p) {
  const i = state.places.findIndex((x) => x.id === p.id);
  if (i >= 0) state.places[i] = { ...state.places[i], ...p };
  else state.places.push(p);
  state.activeId = p.id;
  save();
}

export function removePlace(id) {
  state.places = state.places.filter((p) => p.id !== id);
  if (state.activeId === id) state.activeId = state.places[0]?.id ?? null;
  save();
}

export const activePlace = () =>
  state.places.find((p) => p.id === state.activeId) ?? state.places[0] ?? null;

/* ── weather cache, keyed by place ── */
const CK = (id) => `breezy.wx.${id}`;

export function cacheWeather(id, data) {
  try {
    localStorage.setItem(CK(id), JSON.stringify({ at: Date.now(), data }));
  } catch { /* quota */ }
}

export function readCache(id, maxAgeMs = 6 * 3600e3) {
  try {
    const raw = JSON.parse(localStorage.getItem(CK(id)) || 'null');
    if (!raw || Date.now() - raw.at > maxAgeMs) return null;
    return { age: Date.now() - raw.at, data: revive(raw.data) };
  } catch { return null; }
}

/* JSON.parse gives back strings where Dates were — put them back. */
const DATE_KEYS = new Set(['time', 'date', 'sunrise', 'sunset', 'updated', 'observed', 'issued', 'expires']);
function revive(o) {
  if (Array.isArray(o)) return o.map(revive);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : revive(v);
    }
    return out;
  }
  return o;
}

/* Environment and Climate Change Canada — MSC GeoMet OGC API.
   https://api.weather.gc.ca  ·  Open Government Licence – Canada
   Serves CORS headers, so the browser can talk to it directly. */

import { ecccCondition } from '../icons.js';

const BASE = 'https://api.weather.gc.ca/collections';

/* ECCC wraps nearly every leaf in {en,fr} and/or {value:…}. Unwrap to English. */
const V = (o) => {
  if (o === null || o === undefined) return null;
  if (typeof o !== 'object') return o;
  if ('value' in o) return V(o.value);
  if ('en' in o) return o.en;
  return o;
};
const N = (o) => {
  const v = V(o);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const j = async (url) => {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`ECCC ${r.status} on ${url.split('/collections/')[1] ?? url}`);
  return r.json();
};

const bboxAround = (lat, lon, d) =>
  `${(lon - d).toFixed(4)},${(lat - d).toFixed(4)},${(lon + d).toFixed(4)},${(lat + d).toFixed(4)}`;

const dist = (lat, lon, g) => {
  if (!g || !g.coordinates) return Infinity;
  const c = g.type === 'Point' ? g.coordinates : g.coordinates?.[0]?.[0];
  if (!Array.isArray(c)) return Infinity;
  return Math.hypot(c[1] - lat, (c[0] - lon) * Math.cos((lat * Math.PI) / 180));
};

/* Canada's rough bounding box — used to decide whether ECCC can serve a place. */
export const inCanada = (lat, lon) =>
  lat >= 41.5 && lat <= 84 && lon >= -141.5 && lon <= -52;

/* ── nearest city page, widening the search until something turns up ── */
async function nearestCityPage(lat, lon) {
  for (const d of [0.35, 0.9, 2.0, 4.0]) {
    const r = await j(`${BASE}/citypageweather-realtime/items?bbox=${bboxAround(lat, lon, d)}&limit=40&f=json`);
    const feats = (r.features ?? []).filter((f) => f.properties?.currentConditions);
    if (feats.length) {
      feats.sort((a, b) => dist(lat, lon, a.geometry) - dist(lat, lon, b.geometry));
      return feats[0];
    }
  }
  return null;
}

/* ECCC states chance of precipitation in prose ("40 percent chance of showers")
   rather than as a number, so pull it back out of the text. */
const popFromText = (s) => {
  const m = /(\d{1,3})\s*percent/i.exec(String(s ?? ''));
  return m ? Math.min(100, Number(m[1])) : null;
};

/* ── daily forecasts: ECCC emits alternating day/night blocks ── */
function buildDaily(forecasts, issued, tz) {
  const days = [];
  const index = new Map();

  for (const fc of forecasts ?? []) {
    const rawName = String(V(fc.period?.textForecastName) ?? V(fc.period) ?? '');
    const isNight = /night|tonight|soir|nuit/i.test(rawName);
    // "Tonight" belongs to today; "Friday night" belongs to Friday.
    let key = rawName.replace(/\s*night$/i, '').trim();
    if (/^tonight$/i.test(rawName)) key = 'Today';
    if (!key) key = rawName || `d${days.length}`;

    let day = index.get(key);
    if (!day) {
      day = { key, label: key, hi: null, lo: null, condition: 'cloudy', night: false,
              text: '', summary: '', pop: null, uv: null, humidex: null, hasDay: false };
      index.set(key, day);
      days.push(day);
    }

    const temp = N(fc.temperatures?.temperature?.[0]);
    const cls = String(V(fc.temperatures?.temperature?.[0]?.class) ?? '').toLowerCase();
    if (cls === 'low' || (cls !== 'high' && isNight)) day.lo = temp;
    else day.hi = temp;

    const cond = ecccCondition(V(fc.abbreviatedForecast?.icon));
    const summary = String(V(fc.textSummary) ?? '');

    if (!isNight) {
      // the daytime block wins the row's icon and wording
      day.condition = cond.key;
      day.night = false;
      day.text = String(V(fc.abbreviatedForecast?.textSummary) ?? '');
      day.summary = summary;
      day.uv = N(fc.uv?.index);
      day.humidex = N(fc.humidex?.calculated);
      day.hasDay = true;
    } else {
      // only fall back to the night block when there is no daytime half
      // (happens for "Tonight" when the app is opened in the evening)
      if (!day.hasDay) {
        day.condition = cond.key;
        day.night = true;
        day.text = String(V(fc.abbreviatedForecast?.textSummary) ?? '');
      }
      if (!day.summary) day.summary = summary;
    }

    const pop = popFromText(V(fc.cloudPrecip)) ?? popFromText(summary);
    if (pop !== null) day.pop = Math.max(day.pop ?? 0, pop);
  }

  // Attach real dates, counting forward from the issue day.
  const start = issued ? new Date(issued) : new Date();
  days.forEach((d, i) => {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + i);
    d.date = dt;
  });
  return days;
}

/* ── alerts ── */
async function fetchAlerts(lat, lon) {
  try {
    const r = await j(`${BASE}/weather-alerts/items?bbox=${bboxAround(lat, lon, 0.28)}&limit=25&f=json`);
    return (r.features ?? [])
      .map((f) => f.properties)
      .filter((p) => p && String(p.status_en ?? '').toLowerCase() !== 'ended')
      .map((p) => ({
        title: p.alert_name_en || p.alert_short_name_en || 'Weather alert',
        type: p.alert_type || '',
        colour: ({ red: '#e0453a', orange: '#f07a1e', yellow: '#f5b823', grey: '#8b95a1', green: '#3ec46d' })[
          String(p.risk_colour_en ?? '').toLowerCase()] ?? '#f5a623',
        text: (p.alert_text_en || '').trim(),
        area: p.feature_name_en || '',
        issued: p.publication_datetime ? new Date(p.publication_datetime) : null,
        expires: p.expiration_datetime ? new Date(p.expiration_datetime) : null,
      }));
  } catch { return []; }
}

/* ── AQHI (Canada's own air-quality scale, 1–10+) ── */
async function fetchAqhi(lat, lon) {
  for (const d of [0.5, 1.5, 3.0]) {
    try {
      const r = await j(`${BASE}/aqhi-observations-realtime/items?bbox=${bboxAround(lat, lon, d)}&latest=true&limit=20&f=json`);
      const feats = (r.features ?? []).filter((f) => f.properties?.aqhi != null);
      if (!feats.length) continue;
      feats.sort((a, b) => dist(lat, lon, a.geometry) - dist(lat, lon, b.geometry));
      const p = feats[0].properties;
      const v = Number(p.aqhi);
      return {
        scale: 'AQHI',
        index: Math.round(v * 10) / 10,
        max: 11,
        category: v <= 3 ? 'Low risk' : v <= 6 ? 'Moderate risk' : v <= 10 ? 'High risk' : 'Very high risk',
        station: p.location_name_en ?? '',
        time: p.observation_datetime ? new Date(p.observation_datetime) : null,
      };
    } catch { /* try a wider box */ }
  }
  return null;
}

/* ── main entry ── */
export async function fetchEccc({ lat, lon, tz }) {
  const feat = await nearestCityPage(lat, lon);
  if (!feat) throw new Error('No ECCC city page covers this location');
  const p = feat.properties;
  const cc = p.currentConditions ?? {};

  const [alerts, air] = await Promise.all([fetchAlerts(lat, lon), fetchAqhi(lat, lon)]);

  const iconVal = V(cc.iconCode);
  const cond = ecccCondition(iconVal);

  const hourly = (p.hourlyForecastGroup?.hourlyForecasts ?? []).map((h) => {
    const c = ecccCondition(V(h.iconCode));
    return {
      time: new Date(typeof h.timestamp === 'string' ? h.timestamp : V(h.timestamp)),
      temp: N(h.temperature),
      condition: c.key,
      night: c.night,
      text: String(V(h.condition) ?? ''),
      pop: N(h.lop),
      wind: N(h.wind?.speed),
      windDirText: String(V(h.wind?.direction) ?? ''),
      humidex: N(h.humidex),
      uv: N(h.uv?.index),
    };
  }).filter((h) => h.time instanceof Date && !isNaN(h.time));

  const sunrise = V(p.riseSet?.sunrise) ? new Date(V(p.riseSet.sunrise)) : null;
  const sunset  = V(p.riseSet?.sunset)  ? new Date(V(p.riseSet.sunset))  : null;

  const daily = buildDaily(p.forecastGroup?.forecasts, V(p.forecastGroup?.timestamp) || p.lastUpdated, tz);

  /* ECCC leaves the previous season's windChill/humidex sitting in the feed
     long after it stops applying — a -2 wind chill turns up on a 30 °C August
     afternoon. Only trust each one inside the range it's defined for. */
  const tNow = N(cc.temperature);
  const windChill = N(cc.windChill);
  const humidex = N(cc.humidex);
  let feelsLike = null, feelsLabel = 'Feels like';
  if (windChill !== null && tNow !== null && tNow <= 10 && windChill < tNow) {
    feelsLike = windChill; feelsLabel = 'Wind chill';
  } else if (humidex !== null && tNow !== null && tNow >= 20 && humidex > tNow) {
    feelsLike = humidex; feelsLabel = 'Humidex';
  }

  const normals = p.forecastGroup?.regionalNormals?.temperature ?? [];
  const normHi = normals.find((t) => String(V(t.class)).toLowerCase() === 'high');
  const normLo = normals.find((t) => String(V(t.class)).toLowerCase() === 'low');

  return {
    source: {
      id: 'eccc',
      name: 'Environment and Climate Change Canada',
      short: 'ECCC',
      url: V(p.url) ?? 'https://weather.gc.ca',
    },
    place: String(V(p.name) ?? ''),
    updated: p.lastUpdated ? new Date(p.lastUpdated) : new Date(),
    current: {
      temp: tNow,
      feelsLike,
      feelsLabel,
      condition: cond.key,
      night: cond.night,
      text: String(V(cc.condition) ?? ''),
      humidity: N(cc.relativeHumidity),
      dewpoint: N(cc.dewpoint),
      windSpeed: N(cc.wind?.speed),
      windGust: N(cc.wind?.gust),
      windDir: N(cc.wind?.bearing),
      windDirText: String(V(cc.wind?.direction) ?? ''),
      pressure: N(cc.pressure) != null ? N(cc.pressure) * 10 : null,   // kPa → hPa
      pressureTrend: String(V(cc.pressure?.tendency) ?? ''),
      station: String(V(cc.station) ?? ''),
      observed: V(cc.timestamp) ? new Date(V(cc.timestamp)) : null,
      uv: daily[0]?.uv ?? null,
      visibility: null,
    },
    hourly,
    daily,
    alerts,
    air,
    sun: { sunrise, sunset },
    normals: { hi: N(normHi), lo: N(normLo) },
  };
}

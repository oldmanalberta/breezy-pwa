/* Open-Meteo — free, keyless, CORS-enabled, CC BY 4.0.
   https://open-meteo.com
   `model` lets us pin ECCC's own GEM suite for a Canadian-model view anywhere. */

import { wmoCondition, wmoText } from '../icons.js';

const FC  = 'https://api.open-meteo.com/v1/forecast';
const AQ  = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const HOURLY = [
  'temperature_2m', 'apparent_temperature', 'weather_code', 'precipitation_probability',
  'wind_speed_10m', 'wind_direction_10m', 'is_day', 'uv_index', 'visibility', 'dew_point_2m',
].join(',');

const DAILY = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset',
  'uv_index_max', 'precipitation_probability_max', 'precipitation_sum', 'wind_speed_10m_max',
].join(',');

const CURRENT = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day',
  'weather_code', 'surface_pressure', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
].join(',');

const j = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const d = await r.json();
  if (d.error) throw new Error(d.reason || 'Open-Meteo error');
  return d;
};

const at = (arr, i) => (Array.isArray(arr) && arr[i] != null ? arr[i] : null);
const D = (t) => (t == null ? null : new Date(t * 1000));

const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
export const compass = (deg) => (deg == null ? '' : COMPASS[Math.round(deg / 22.5) % 16]);

const AQI_CATS = [
  [50,  'Good'], [100, 'Moderate'], [150, 'Unhealthy for sensitive groups'],
  [200, 'Unhealthy'], [300, 'Very unhealthy'], [Infinity, 'Hazardous'],
];

async function fetchAir(lat, lon) {
  try {
    const d = await j(`${AQ}?latitude=${lat}&longitude=${lon}` +
      `&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide` +
      `&timeformat=unixtime&timezone=UTC`);
    const c = d.current ?? {};
    if (c.us_aqi == null) return null;
    const v = Math.round(c.us_aqi);
    return {
      scale: 'AQI',
      index: v,
      max: 300,
      category: AQI_CATS.find(([t]) => v <= t)[1],
      station: '',
      time: D(c.time),
      pollutants: {
        'PM2.5': c.pm2_5, 'PM10': c.pm10, 'O₃': c.ozone,
        'NO₂': c.nitrogen_dioxide, 'SO₂': c.sulphur_dioxide,
      },
    };
  } catch { return null; }
}

export async function fetchOpenMeteo({ lat, lon, tz, model = null }) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: CURRENT, hourly: HOURLY, daily: DAILY,
    timezone: tz || 'auto', timeformat: 'unixtime',
    forecast_days: '10', past_hours: '1',
    wind_speed_unit: 'kmh', temperature_unit: 'celsius', precipitation_unit: 'mm',
  });
  if (model) params.set('models', model);

  const [d, air] = await Promise.all([j(`${FC}?${params}`), fetchAir(lat, lon)]);

  const c = d.current ?? {};
  const isNight = c.is_day === 0;
  const now = Date.now();

  const H = d.hourly ?? {};
  const hourly = (H.time ?? []).map((t, i) => ({
    time: D(t),
    temp: at(H.temperature_2m, i),
    feelsLike: at(H.apparent_temperature, i),
    condition: wmoCondition(at(H.weather_code, i)),
    night: at(H.is_day, i) === 0,
    text: wmoText(at(H.weather_code, i)),
    pop: at(H.precipitation_probability, i),
    wind: at(H.wind_speed_10m, i),
    windDir: at(H.wind_direction_10m, i),
    windDirText: compass(at(H.wind_direction_10m, i)),
    uv: at(H.uv_index, i),
  })).filter((h) => h.time && h.time.getTime() >= now - 3600e3)
     .slice(0, 48);   // the card shows 24; keep a little slack, not 16 days'
                      // worth — the whole payload gets cached in localStorage.

  // current-hour extras that Open-Meteo only exposes hourly
  const hIdx = (H.time ?? []).findIndex((t) => t * 1000 >= now - 1800e3);
  const dew = at(H.dew_point_2m, hIdx);
  const vis = at(H.visibility, hIdx);
  const uvNow = at(H.uv_index, hIdx);

  const DD = d.daily ?? {};
  const daily = (DD.time ?? []).map((t, i) => {
    const date = D(t);
    return {
      date,
      key: date?.toDateString(),
      label: null,
      hi: at(DD.temperature_2m_max, i),
      lo: at(DD.temperature_2m_min, i),
      condition: wmoCondition(at(DD.weather_code, i)),
      night: false,
      text: wmoText(at(DD.weather_code, i)),
      summary: '',
      pop: at(DD.precipitation_probability_max, i),
      precip: at(DD.precipitation_sum, i),
      uv: at(DD.uv_index_max, i),
      wind: at(DD.wind_speed_10m_max, i),
      sunrise: D(at(DD.sunrise, i)),
      sunset: D(at(DD.sunset, i)),
    };
  });

  const label = model
    ? { id: 'gem', name: 'Open-Meteo · Canadian GEM (ECCC model)', short: 'GEM' }
    : { id: 'openmeteo', name: 'Open-Meteo', short: 'Open-Meteo' };

  return {
    source: { ...label, url: 'https://open-meteo.com' },
    place: '',
    updated: new Date(),
    current: {
      temp: c.temperature_2m ?? null,
      feelsLike: c.apparent_temperature ?? null,
      feelsLabel: 'Feels like',
      condition: wmoCondition(c.weather_code),
      night: isNight,
      text: wmoText(c.weather_code),
      humidity: c.relative_humidity_2m ?? null,
      dewpoint: dew,
      windSpeed: c.wind_speed_10m ?? null,
      windGust: c.wind_gusts_10m ?? null,
      windDir: c.wind_direction_10m ?? null,
      windDirText: compass(c.wind_direction_10m),
      pressure: c.surface_pressure ?? null,
      pressureTrend: '',
      station: '',
      observed: D(c.time),
      uv: uvNow,
      visibility: vis != null ? vis / 1000 : null,   // m → km
    },
    hourly,
    daily,
    alerts: [],
    air,
    sun: { sunrise: daily[0]?.sunrise ?? null, sunset: daily[0]?.sunset ?? null },
    normals: { hi: null, lo: null },
    tz: d.timezone,
  };
}

/* ── geocoding ── */
export async function geocode(name) {
  if (!name || name.trim().length < 2) return [];
  const d = await j(`https://geocoding-api.open-meteo.com/v1/search` +
    `?name=${encodeURIComponent(name.trim())}&count=8&language=en&format=json`);
  return (d.results ?? []).map((r) => ({
    id: `${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`,
    name: r.name,
    admin: [r.admin1, r.country].filter(Boolean).join(', '),
    country: r.country,
    cc: r.country_code,
    lat: r.latitude,
    lon: r.longitude,
    tz: r.timezone,
  }));
}

export const flagOf = (cc) =>
  !cc || cc.length !== 2 ? '📍'
    : String.fromCodePoint(...[...cc.toUpperCase()].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));

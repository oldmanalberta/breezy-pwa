/* Source dispatcher. Falls back to Open-Meteo if a preferred source can't
   serve the location, so the app never lands on an empty screen. */

import { fetchEccc, inCanada } from './eccc.js';
import { fetchOpenMeteo } from './openmeteo.js';

export const SOURCES = {
  auto:      { label: 'Automatic' },
  eccc:      { label: 'Environment and Climate Change Canada' },
  openmeteo: { label: 'Open-Meteo' },
  gem:       { label: 'Open-Meteo · Canadian GEM' },
};

/* Fold Open-Meteo's richer daily block into ECCC's, matched by calendar date.
 *
 * Two reasons this matters:
 *  - ECCC drops the daytime high from its forecast once the afternoon is past,
 *    so from early evening "Today" arrives with only an overnight low. The row
 *    then looks broken even though the day's forecast high is still the useful
 *    number. Open-Meteo keeps both for the whole day, so it backfills the gap.
 *  - The daily panel's other series (feels-like, sunshine, air quality, wind,
 *    precipitation totals) have no ECCC equivalent at all.
 *
 * ECCC's own values always win where it has them — this only fills holes.
 */
function mergeDailyExtras(eccc, om) {
  if (!Array.isArray(eccc) || !Array.isArray(om)) return;
  const byDate = new Map(om.filter((d) => d.date).map((d) => [d.date.toDateString(), d]));

  for (const day of eccc) {
    const m = day.date && byDate.get(day.date.toDateString());
    if (!m) continue;
    day.hi ??= m.hi;
    day.lo ??= m.lo;
    day.pop ??= m.pop;
    day.uv ??= m.uv;
    day.precip ??= m.precip;
    day.wind ??= m.wind;
    day.gust ??= m.gust;
    day.windDir ??= m.windDir;
    day.feelsHi ??= m.feelsHi;
    day.feelsLo ??= m.feelsLo;
    day.sunshine ??= m.sunshine;
    day.aqi ??= m.aqi;
    day.sunrise ??= m.sunrise;
    day.sunset ??= m.sunset;
  }
}

export async function loadWeather(loc, pref = 'auto') {
  const arg = { lat: loc.lat, lon: loc.lon, tz: loc.tz };
  const canadian = inCanada(loc.lat, loc.lon);

  const plan =
    pref === 'eccc'      ? ['eccc', 'openmeteo']
  : pref === 'gem'       ? ['gem', 'openmeteo']
  : pref === 'openmeteo' ? ['openmeteo']
  : canadian             ? ['eccc', 'openmeteo']
  :                        ['openmeteo'];

  let lastErr = null;
  for (const id of plan) {
    try {
      if (id === 'eccc') {
        if (!canadian) throw new Error('ECCC only covers Canada');
        const data = await fetchEccc(arg);
        // ECCC has no UV/visibility for the current hour and a short hourly run;
        // top it up from Open-Meteo without letting a failure break the page.
        try {
          const om = await fetchOpenMeteo(arg);
          data.current.visibility ??= om.current.visibility;
          data.current.uv ??= om.current.uv;
          data.current.feelsLike ??= om.current.feelsLike;
          if (data.hourly.length < 12) data.hourly = om.hourly;
          if (!data.air) data.air = om.air;
          mergeDailyExtras(data.daily, om.daily);
          data.supplement = 'Open-Meteo';
        } catch { /* ECCC alone is fine */ }
        return data;
      }
      if (id === 'gem') return await fetchOpenMeteo({ ...arg, model: 'gem_seamless' });
      return await fetchOpenMeteo(arg);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('No weather source available');
}

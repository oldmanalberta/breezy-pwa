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
          // ECCC's hourly has no cloud amount; the aurora card reads it from here
          data.cloudHours = om.hourly;
          /* ECCC reports sea-level pressure. Bring it back to what a barometer
             at this elevation reads (the hypsometric equation, using the
             observed temperature), so both sources mean the same thing. */
          data.elevation = om.elevation;
          const z = om.elevation, p = data.current.pressure, t = data.current.temp;
          if (z != null && p != null) {
            const tMean = (t ?? 15) + 273.15 + 0.0065 * z / 2;
            data.current.pressure = p * Math.exp(-9.80665 * z / (287.05 * tMean));
          }
          if (!data.air) data.air = om.air;
          /* Keep the US AQI even when ECCC supplied AQHI. They measure
             different things — AQHI is a health-risk score built from three
             pollutants, US AQI is the worst single pollutant on a 0-500 scale —
             so showing both side by side is more informative than picking one,
             and US AQI is the number most other apps report. */
          if (om.air?.index != null) data.airUs = om.air;
          mergeDailyExtras(data.daily, om.daily);
          // ECCC has no "what happened last week" feed at all
          data.past = om.past;
          data.supplement = 'Open-Meteo';
        } catch { /* ECCC alone is fine */ }
        data.checked = new Date();
        return data;
      }
      const om = await fetchOpenMeteo(id === 'gem' ? { ...arg, model: 'gem_seamless' } : arg);
      om.checked = new Date();   // when the app last fetched, as opposed to when the data was issued
      return om;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('No weather source available');
}

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

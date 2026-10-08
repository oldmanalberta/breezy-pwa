/* The heads-up line under the hero: the one or two things about the next
   twelve hours that are worth knowing before you step out, in plain words.
   Every candidate gets a priority; the highest wins, and a second shows only
   when it also matters. When nothing stands out it falls back to a short
   line about the day itself, picked by date so it changes from day to day
   but not on every refresh. */

import { temp, hourLabel, windVal, windUnit } from './render.js';
import { localChance } from './aurora.js';

const THUNDER = ['thunder', 'thunderrain'];
const ICE = ['freezing', 'sleet'];
const SNOW = ['snow', 'heavysnow', 'snowshower'];
const RAIN = ['rain', 'heavyrain', 'rainshower', 'drizzle', 'thunderrain'];
const WET = [...RAIN, ...SNOW, ...ICE, 'thunder', 'hail'];

/* "in about 40 minutes", "around 4 PM", "after midnight" */
function when(t, tz, now) {
  const mins = Math.round((t - now) / 60e3);
  if (mins <= 15) return 'any minute now';
  if (mins < 90) return `in about ${Math.round(mins / 5) * 5} minutes`;
  return `around ${hourLabel(t, tz)}`;
}

const pick = (arr, seed) => arr[seed % arr.length];

export function headsUp(data) {
  const c = data.current ?? {}, tz = data.tz, d0 = data.daily?.[0];
  const now = Date.now();
  const hrs = (data.hourly ?? []).filter((h) => h.time && h.time.getTime() > now - 1800e3 && h.time.getTime() <= now + 12 * 3600e3);
  const likely = (h) => h.pop == null || h.pop >= 40;
  const first = (keys, from = 0) => hrs.slice(from).find((h) => keys.includes(h.condition) && likely(h));
  const cond = c.condition ?? '';
  const out = [];
  const add = (pri, text) => out.push({ pri, text });
  const month = new Date().getMonth() + 1;
  const north = (data.coords?.lat ?? 1) >= 0;
  const m = north ? month : ((month + 5) % 12) + 1;
  const season = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'fall' : 'winter';
  const day = Math.floor(now / 864e5);

  // thunderstorms and hail
  if (THUNDER.includes(cond)) add(96, 'Thunderstorms overhead. Stay indoors until 30 minutes after the last rumble.');
  else {
    const t = first(THUNDER);
    if (t) add(94, `Thunderstorms rolling through ${when(t.time, tz, now)}. Head inside at the first rumble.`);
  }
  const hail = first(['hail']);
  if (hail) add(93, `Hail possible ${when(hail.time, tz, now)}. Tuck the car under cover.`);

  // freezing rain, and wet roads freezing over
  if (ICE.includes(cond)) add(95, 'Freezing rain right now. Sidewalks, steps and roads are glazing over.');
  else {
    const t = first(ICE);
    if (t) add(92, `Freezing rain ${when(t.time, tz, now)}. Sidewalks and steps will turn to glass.`);
  }
  const minAhead = hrs.reduce((a, h) => (h.temp != null && h.temp < a ? h.temp : a), Infinity);
  if (RAIN.includes(cond) && minAhead <= -1) add(90, 'Wet roads will freeze as the temperature drops. Watch for black ice.');

  // snow
  const heavySoon = first(['heavysnow']);
  if (SNOW.includes(cond)) {
    if (heavySoon && cond !== 'heavysnow') add(88, `Snow gets heavier ${when(heavySoon.time, tz, now)}. Give yourself extra time.`);
    else {
      const stop = hrs.find((h) => !SNOW.includes(h.condition) && h.time > now);
      const roads = (c.temp ?? 0) <= 0 ? ' Fresh snow on frozen roads, so leave extra stopping room.' : '';
      add(cond === 'heavysnow' ? 89 : 80, (stop ? `Snow tapers off ${when(stop.time, tz, now)}.` : 'Snow keeps coming for the rest of the day.') + roads);
    }
  } else {
    const s = first(SNOW);
    if (s) {
      const after = hrs.filter((h) => h.time >= s.time && h.temp != null);
      const cold = after.length && Math.min(...after.map((h) => h.temp)) <= 0;
      const heavy = s.condition === 'heavysnow' || heavySoon;
      add(heavy ? 90 : 84, `${heavy ? 'Heavy snow' : 'Snow'} moves in ${when(s.time, tz, now)}.${cold ? ' Fresh snow and sub-zero roads, so take it slow.' : ''}`);
    }
  }

  // rain
  if (RAIN.includes(cond)) {
    const stop = hrs.find((h) => h.time > now && !WET.includes(h.condition) && (h.pop == null || h.pop < 40));
    if (stop) add(55, `Rain eases ${when(stop.time, tz, now)}.`);
    else add(50, pick(['Rain sets in for the rest of the day. A good day for a book.', 'Wet all day. Boots, not sneakers.'], day));
  } else if (!SNOW.includes(cond)) {
    const r = first(RAIN);
    if (r) {
      const soon = r.time - now < 3 * 3600e3;
      if (r.condition === 'heavyrain') add(83, `Downpours ${when(r.time, tz, now)}. Expect puddles and slower roads.`);
      else if (soon) add(80, `Rain ${when(r.time, tz, now)}. Grab the umbrella on your way out.`);
      else add(62, `Rain arrives ${when(r.time, tz, now)}, so get the outdoor jobs done before then.`);
    }
  }

  // fog
  if (cond === 'fog') add(74, 'Fog right now. Low beams and a little extra following distance.');
  else {
    const f = first(['fog']);
    if (f) add(72, `Fog may roll in ${when(f.time, tz, now)}. Low beams and a little patience.`);
    else if (c.night && c.temp != null && c.dewpoint != null && c.temp - c.dewpoint <= 2 && (c.windSpeed ?? 99) < 8)
      add(46, 'Calm, damp air tonight. Fog could form by morning.');
  }

  // frost in the growing season, deep cold, heat
  const lo = Math.min(minAhead, d0?.lo ?? Infinity);
  if (lo <= 0 && (c.temp ?? 0) >= 2 && ['spring', 'summer', 'fall'].includes(season))
    add(76, `Frost tonight, down to ${temp(lo)}. Cover the garden or bring the pots in.`);
  const chill = hrs.reduce((a, h) => (h.feelsLike != null && h.feelsLike < a ? h.feelsLike : a), c.feelsLike ?? Infinity);
  if (chill <= -27) add(86, `Wind chill near ${temp(chill)}. Frostbite can set in within minutes on bare skin.`);
  const hot = hrs.reduce((a, h) => (h.temp != null && h.temp > a.temp ? h : a), { temp: -Infinity });
  if (hot.temp >= 30) add(70, `A hot one, peaking at ${temp(hot.temp)} ${when(hot.time, tz, now)}. Water, shade, repeat.`);

  // a big swing in the next twelve hours
  if (c.temp != null && Number.isFinite(minAhead) && c.temp - minAhead >= 10 && lo > 0)
    add(58, `A ${Math.round(c.temp - minAhead)}° drop by ${hourLabel(hrs.find((h) => h.temp === minAhead).time, tz)}. Bring a jacket if you'll be out late.`);

  // wind
  const gust = Math.max(c.windGust ?? 0, d0?.gust ?? 0);
  if (gust >= 60) add(73, `Gusts up to ${windVal(gust)} ${windUnit()} today. Hold on to your hat, and the recycling bin.`);

  // aurora
  const a = data.aurora, ll = data.coords;
  if (a?.ovation && ll?.lat != null && c.night && !['overcast', 'cloudy', 'fog'].includes(cond) && !WET.includes(cond)) {
    const ch = localChance(a.ovation, ll.lat, ll.lon)?.chance ?? 0;
    const dir = ll.lat >= 0 ? 'north' : 'south';
    if (ch >= 50) add(78, `The aurora is likely up right now. Get away from the city lights and look ${dir}.`);
    else if (ch >= 25) add(64, `The aurora could show tonight. Look ${dir}, away from city lights.`);
  }

  // strong sun
  const uv = hrs.filter((h) => !h.night && h.uv != null).reduce((x, h) => (h.uv > x.uv ? h : x), { uv: 0 });
  if (uv.uv >= 7) add(52, `UV reaches ${Math.round(uv.uv)} ${when(uv.time, tz, now)}. Sunscreen before you head out.`);

  out.sort((x, y) => y.pri - x.pri);
  if (out.length) return out.filter((x, i) => i === 0 || (i === 1 && x.pri >= 60)).map((x) => x.text);

  // nothing pressing: a line about the day itself
  const dry = !hrs.some((h) => WET.includes(h.condition) && likely(h));
  const clear = ['clear', 'mainlyclear'].includes(cond);
  let lines;
  if (c.night && clear) lines = ['Clear skies tonight. A good night to look up.', 'Not a cloud between you and the stars tonight.'];
  else if (c.night) lines = ['A quiet night ahead.', 'Nothing much stirring tonight.'];
  else if (season === 'fall' && dry && (c.humidity ?? 60) < 50) lines = ['Dry and settled. Good harvest weather.', 'Crisp and dry. Classic fall day.'];
  else if (season === 'fall') lines = ['Cool and quiet. Sweater weather.', 'A calm fall day. Nothing to plan around.'];
  else if (season === 'winter' && clear) lines = ['Bright and cold. Sunglasses for the snow glare.', 'Blue sky and crisp air. Bundle up and enjoy it.'];
  else if (season === 'winter') lines = ['Grey and quiet. A good day for something warm.', 'No surprises on the way today.'];
  else if (season === 'spring') lines = clear ? ['Clear and fresh. The season is turning.', 'Sunshine and no rain in sight. Windows open.'] : ['Quiet spring weather. Nothing to plan around.'];
  else lines = clear ? ['Sunshine and nothing on the horizon. Enjoy it.', 'A proper summer day. Get outside.'] : ['Dry for the next twelve hours.', 'Nothing on the radar to worry about.'];
  return [pick(lines, day)];
}

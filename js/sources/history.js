/* Historical daily records for the fortnight around today, N years back.
 *
 * Open-Meteo's archive serves ERA5 reanalysis, which begins in 1940 — so 50
 * years back works everywhere but 100 does not exist, for anywhere, at any
 * source that can be reached from a browser. Environment Canada does hold
 * older station records, but its climate archive is CSV downloads with no CORS
 * headers, so a static page cannot read it; using it would need a proxy.
 *
 * Reanalysis is modelled onto a grid rather than a thermometer reading at your
 * town, so treat these as "what that week was like" rather than an official
 * station record.
 */

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

export const ARCHIVE_FIRST_YEAR = 1940;

/* The spans worth offering, filtered at call time against what exists. */
export const HISTORY_SPANS = [1, 5, 10, 20, 50];

export const spansAvailable = (now = new Date()) =>
  HISTORY_SPANS.filter((y) => now.getFullYear() - y >= ARCHIVE_FIRST_YEAR);

const iso = (d) => d.toISOString().slice(0, 10);

/* ±7 days around today's date in the target year, so the middle column lines
   up with today and you can read either side of it. */
export async function fetchHistory(lat, lon, yearsAgo, now = new Date()) {
  const target = new Date(now);
  target.setFullYear(now.getFullYear() - yearsAgo);

  const from = new Date(target); from.setDate(target.getDate() - 7);
  const to = new Date(target); to.setDate(target.getDate() + 6);

  const url = `${ARCHIVE}?latitude=${lat}&longitude=${lon}`
    + `&start_date=${iso(from)}&end_date=${iso(to)}`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum`
    + `&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`archive ${res.status}`);
  const d = (await res.json()).daily ?? {};

  const days = (d.time ?? []).map((t, i) => ({
    // parsed as local noon so a timezone shift can't roll the label a day back
    date: new Date(`${t}T12:00:00`),
    hi: d.temperature_2m_max?.[i] ?? null,
    lo: d.temperature_2m_min?.[i] ?? null,
    precip: d.precipitation_sum?.[i] ?? null,
  })).filter((x) => x.hi != null || x.lo != null);

  return { yearsAgo, year: target.getFullYear(), days, today: iso(target) };
}

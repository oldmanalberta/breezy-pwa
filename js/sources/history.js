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

/* Days either side of today's date in the target year. Wider than the fortnight
   it displays at rest so there is somewhere to scroll to in both directions,
   with the matching day sitting dead centre. */
const HALF_WINDOW = 21;

const parseDaily = (d) => (d.time ?? []).map((t, i) => ({
  // parsed as local noon so a timezone shift can't roll the label a day back
  date: new Date(`${t}T12:00:00`),
  hi: d.temperature_2m_max?.[i] ?? null,
  lo: d.temperature_2m_min?.[i] ?? null,
  precip: d.precipitation_sum?.[i] ?? null,
})).filter((x) => x.hi != null || x.lo != null);

async function archive(lat, lon, from, to) {
  const url = `${ARCHIVE}?latitude=${lat}&longitude=${lon}`
    + `&start_date=${iso(from)}&end_date=${iso(to)}`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum`
    + `&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`archive ${res.status}`);
  return (await res.json()).daily ?? {};
}

/* Twelve monthly rainfall totals for a calendar year. The current year stops at
   whatever the archive has — reanalysis lags real time by a few days — so the
   final month is a partial total and is marked as such by the caller. */
function monthlyTotals(daily) {
  const months = Array(12).fill(null);
  const t = daily.time ?? [], p = daily.precipitation_sum ?? [];
  for (let i = 0; i < t.length; i++) {
    if (p[i] == null) continue;
    const m = Number(t[i].slice(5, 7)) - 1;
    months[m] = (months[m] ?? 0) + p[i];
  }
  return months.map((v) => (v == null ? null : Math.round(v * 10) / 10));
}

export async function fetchHistory(lat, lon, yearsAgo, now = new Date()) {
  const target = new Date(now);
  target.setFullYear(now.getFullYear() - yearsAgo);

  const from = new Date(target); from.setDate(target.getDate() - HALF_WINDOW);
  const to = new Date(target); to.setDate(target.getDate() + HALF_WINDOW);

  const pastYear = target.getFullYear();
  const nowYear = now.getFullYear();

  // archive lags a few days; ask only for what can exist
  const lag = new Date(now); lag.setDate(now.getDate() - 6);

  const [window, pastAll, nowAll] = await Promise.all([
    archive(lat, lon, from, to),
    archive(lat, lon, new Date(`${pastYear}-01-01T12:00:00`), new Date(`${pastYear}-12-31T12:00:00`)),
    archive(lat, lon, new Date(`${nowYear}-01-01T12:00:00`), lag),
  ]);

  return {
    yearsAgo,
    year: pastYear,
    nowYear,
    days: parseDaily(window),
    centre: iso(target),
    monthlyPast: monthlyTotals(pastAll),
    monthlyNow: monthlyTotals(nowAll),
  };
}

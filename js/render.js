/* Card renderers. Every card mirrors one of Breezy Weather's home blocks. */

import { icon } from './icons.js';
import { state } from './store.js';
import { radarAvailable, staticMapSpec } from './radar.js';

/* ── formatting ───────────────────────────────────── */
export const toF = (c) => (c * 9) / 5 + 32;

export function temp(c, withDeg = true) {
  if (c === null || c === undefined || Number.isNaN(c)) return '--' + (withDeg ? '°' : '');
  const v = state.unit === 'F' ? toF(c) : c;
  return Math.round(v) + (withDeg ? '°' : '');
}

export function windVal(kmh) {
  if (kmh == null) return '--';
  if (state.wind === 'ms')  return (kmh / 3.6).toFixed(1);
  if (state.wind === 'mph') return Math.round(kmh / 1.609).toString();
  return Math.round(kmh).toString();
}
export const windUnit = () => ({ kmh: 'km/h', ms: 'm/s', mph: 'mph' })[state.wind];

const fmt = (d, opts, tz) => {
  if (!(d instanceof Date) || isNaN(d)) return '--';
  try { return new Intl.DateTimeFormat('en-CA', { ...opts, timeZone: tz || undefined }).format(d); }
  catch { return new Intl.DateTimeFormat('en-CA', opts).format(d); }
};

/* en-CA renders "5 p.m."; compact it to "5 PM" so it fits an hour column. */
export const hourLabel = (d, tz) =>
  fmt(d, { hour: 'numeric' }, tz)
    .replace(/\s*([ap])\.?\s*m\.?/i, (_, x) => ` ${x.toUpperCase()}M`)
    .trim();
export const timeLabel = (d, tz) => fmt(d, { hour: 'numeric', minute: '2-digit' }, tz);
export const dayLabel  = (d, tz) => fmt(d, { weekday: 'short' }, tz);
export const dateLabel = (d, tz) => fmt(d, { month: 'short', day: 'numeric' }, tz);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const card = (title, glyph, body, extra = '') => `
  <section class="card ${extra}">
    <div class="card-head"><span class="ci">${glyph}</span>${title}</div>
    ${body}
  </section>`;

/* small line-art glyphs for card headers */
const G = {
  clock: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7z"/></svg>',
  cal:   '<svg viewBox="0 0 24 24"><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14z"/></svg>',
  info:  '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-6h2zm0-8h-2V7h2z"/></svg>',
  leaf:  '<svg viewBox="0 0 24 24"><path d="M6.05 17.95c-2.73-2.73-2.73-7.17 0-9.9C8.5 5.6 17 4 20 4c0 3-1.6 11.5-4.05 13.95a7 7 0 0 1-9.9 0zm1.4-1.4a5 5 0 0 0 7.1 0C16.4 14.65 17.7 8.3 17.9 6.1c-2.2.2-8.55 1.5-10.45 3.35a5 5 0 0 0 0 7.1z"/></svg>',
  sun:   '<svg viewBox="0 0 24 24"><path d="M12 7a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0-5 2 3h-4zm0 20-2-3h4zM2 12l3-2v4zm20 0-3 2v-4zM4.9 4.9l3.5 1.2-2.3 2.3zm14.2 14.2-3.5-1.2 2.3-2.3zM19.1 4.9l-1.2 3.5-2.3-2.3zM4.9 19.1l1.2-3.5 2.3 2.3z"/></svg>',
  warn:  '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z"/></svg>',
  radar: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8zm0 4a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4zm0 4a2 2 0 1 0 2 2h-2z"/><path d="M12 12 21 3v4l-9 5z"/></svg>',
};

/* ── alerts ───────────────────────────────────────── */
export function alertsCard(data) {
  if (!data.alerts?.length) return '';
  const body = data.alerts.map((a, i) => `
    <button class="alert" style="--al:${a.colour}" data-alert="${i}">
      <b>${esc(a.title.replace(/^\w/, (c) => c.toUpperCase()))}</b>
      <span>${esc(a.area)}${a.expires ? ` · until ${timeLabel(a.expires, data.tz)}` : ''}</span>
      <p>${esc(a.text)}</p>
    </button>`).join('');
  return card(`${data.alerts.length} active alert${data.alerts.length > 1 ? 's' : ''}`, G.warn, body);
}

/* ── hourly, with the temperature curve Breezy draws ── */
export function hourlyCard(data) {
  const hrs = (data.hourly ?? []).slice(0, 24);
  if (hrs.length < 2) return '';

  const W = 62, H = 62, padT = 20, padB = 10;
  const temps = hrs.map((h) => h.temp).filter((t) => t != null);
  if (!temps.length) return '';
  const min = Math.min(...temps), max = Math.max(...temps);
  const span = Math.max(max - min, 1);
  const y = (t) => padT + (1 - (t - min) / span) * (H - padT - padB);
  const x = (i) => i * W + W / 2;

  const pts = hrs.map((h, i) => (h.temp == null ? null : `${x(i)},${y(h.temp).toFixed(1)}`))
                 .filter(Boolean).join(' ');

  const labels = hrs.map((h, i) => h.temp == null ? '' :
    `<text x="${x(i)}" y="${(y(h.temp) - 9).toFixed(1)}" text-anchor="middle"
       font-size="14" font-weight="600" fill="currentColor">${temp(h.temp)}</text>`).join('');

  const cols = hrs.map((h, i) => `
    <div class="hr${i === 0 ? ' now' : ''}">
      <div class="i">${icon(h.condition, h.night)}</div>
      <div class="p">${h.pop != null && h.pop > 5 ? Math.round(h.pop) + '%' : ''}</div>
      <div class="h">${i === 0 ? 'Now' : hourLabel(h.time, data.tz)}</div>
    </div>`).join('');

  const total = hrs.length * W;
  return card('Hourly forecast', G.clock, `
    <div class="hourly-wrap">
      <div style="width:${total}px">
        <svg class="spark" width="${total}" height="${H}" viewBox="0 0 ${total} ${H}">
          <polyline points="${pts}" fill="none" stroke="var(--accent-ink)" stroke-width="2.5"
                    stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>
          ${labels}
        </svg>
        <div class="hourly">${cols}</div>
      </div>
    </div>`);
}

/* ── daily ────────────────────────────────────────────
   A horizontally scrolling panel of day columns with a chart drawn across
   them, and pills to switch which series the chart shows — the shape Breezy
   Weather uses. Every mode reuses one renderer; a mode just declares how to
   pull its numbers out of a day and how to label them. */

const COL = 72;          // px per day column
const CHART_H = 114;     // px of chart between the day and night icons

export const DAILY_MODES = {
  conditions: {
    label: 'Conditions',
    kind: 'range',
    hi: (d) => d.hi, lo: (d) => d.lo,
    fmt: (v) => temp(v),
  },
  precipitation: {
    label: 'Precipitation',
    kind: 'bar',
    val: (d) => d.precip,
    alt: (d) => d.pop,
    fmt: (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + ' mm',
    altFmt: (v) => Math.round(v) + '%',
    colour: '#5aa9e6',
  },
  wind: {
    label: 'Wind',
    kind: 'bar',
    val: (d) => d.wind,
    alt: (d) => d.gust,
    fmt: (v) => windVal(v) + ' ' + windUnit(),
    altFmt: (v) => 'gust ' + windVal(v),
    colour: '#7fb3ea',
  },
  uv: {
    label: 'UV index',
    kind: 'bar',
    val: (d) => d.uv,
    fmt: (v) => String(Math.round(v)),
    colour: '#f5b823',
  },
  air: {
    label: 'Air quality',
    kind: 'bar',
    val: (d) => d.aqi,
    fmt: (v) => String(Math.round(v)),
    colour: '#3ec46d',
  },
  feels: {
    label: 'Feels like',
    kind: 'range',
    hi: (d) => d.feelsHi, lo: (d) => d.feelsLo,
    fmt: (v) => temp(v),
  },
  sunshine: {
    label: 'Sunshine',
    kind: 'bar',
    val: (d) => d.sunshine,
    fmt: (v) => (Math.round(v * 10) / 10) + ' h',
    colour: '#ffc44d',
  },
};

const hasData = (mode, days) => days.some((d) =>
  mode.kind === 'range' ? mode.hi(d) != null || mode.lo(d) != null : mode.val(d) != null);

/* two stacked curves with value labels — used by Conditions and Feels like */
function rangeChart(days, mode, W) {
  const vals = days.flatMap((d) => [mode.hi(d), mode.lo(d)]).filter((v) => v != null);
  if (!vals.length) return '';
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = Math.max(max - min, 1);
  const padT = 24, padB = 24;
  const y = (v) => padT + (1 - (v - min) / span) * (CHART_H - padT - padB);
  const x = (i) => i * COL + COL / 2;

  const line = (get, cls, dy) => {
    const pts = days.map((d, i) => (get(d) == null ? null : `${x(i)},${y(get(d)).toFixed(1)}`))
                    .filter(Boolean).join(' ');
    if (!pts) return '';
    const labels = days.map((d, i) => get(d) == null ? '' :
      `<text x="${x(i)}" y="${(y(get(d)) + dy).toFixed(1)}" text-anchor="middle"
         font-size="13.5" font-weight="600" fill="currentColor">${esc(mode.fmt(get(d)))}</text>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="var(--accent-ink)" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round" class="${cls}"/>${labels}`;
  };

  return `<svg class="dp-chart" width="${W}" height="${CHART_H}" viewBox="0 0 ${W} ${CHART_H}">
      ${line(mode.hi, 'dp-hi', -9)}
      ${line(mode.lo, 'dp-lo', 17)}
    </svg>`;
}

/* simple column chart with a value label above each bar */
function barChart(days, mode, W) {
  const vals = days.map(mode.val).filter((v) => v != null);
  if (!vals.length) return '';
  const max = Math.max(...vals, 0.001);
  const padT = 26, padB = 20, base = CHART_H - padB;

  const bars = days.map((d, i) => {
    const v = mode.val(d);
    if (v == null) return '';
    const h = Math.max((v / max) * (CHART_H - padT - padB), v > 0 ? 3 : 0);
    const cx = i * COL + COL / 2;
    const alt = mode.alt?.(d);
    return `
      <rect x="${cx - 11}" y="${(base - h).toFixed(1)}" width="22" height="${h.toFixed(1)}"
            rx="5" fill="${mode.colour}" opacity=".85"/>
      <text x="${cx}" y="${(base - h - 8).toFixed(1)}" text-anchor="middle"
            font-size="12.5" font-weight="600" fill="currentColor">${esc(mode.fmt(v))}</text>
      ${alt != null && alt > 0 ? `<text x="${cx}" y="${base + 14}" text-anchor="middle"
            font-size="11" font-weight="600" fill="var(--on-surface-var)">${esc(mode.altFmt(alt))}</text>` : ''}`;
  }).join('');

  return `<svg class="dp-chart" width="${W}" height="${CHART_H}" viewBox="0 0 ${W} ${CHART_H}">${bars}</svg>`;
}

export function dailyCard(data, modeKey = 'conditions') {
  const days = (data.daily ?? []).slice(0, 10);
  if (!days.length) return '';

  const available = Object.entries(DAILY_MODES).filter(([, m]) => hasData(m, days));
  if (!available.length) return '';
  const key = available.some(([k]) => k === modeKey) ? modeKey : available[0][0];
  const mode = DAILY_MODES[key];

  const W = days.length * COL;
  const today = new Date().toDateString();

  const heads = days.map((d) => {
    const isToday = d.date && d.date.toDateString() === today;
    const name = d.label ?? (isToday ? 'Today' : dayLabel(d.date, data.tz));
    return `<div class="dp-col">
        <b>${esc(name)}</b>
        <em>${d.date ? dateLabel(d.date, data.tz) : ''}</em>
        <span class="dp-ico" title="${esc(d.text)}">${icon(d.condition, false)}</span>
      </div>`;
  }).join('');

  /* The night icon renders in every series, not just Conditions. It is useful
     everywhere, and reserving the row unconditionally is what keeps the card
     the same height as you switch series — otherwise the sheet jumps. */
  const feet = days.map((d) => `<div class="dp-col">
      <span class="dp-ico dim">${icon(d.condition, true)}</span>
      <span class="dp-pop">${d.pop != null && d.pop > 5 ? Math.round(d.pop) + '%' : ''}</span>
    </div>`).join('');

  const chart = mode.kind === 'range' ? rangeChart(days, mode, W) : barChart(days, mode, W);

  const pills = available.map(([k, m]) =>
    `<button class="dp-pill${k === key ? ' on' : ''}" data-daily-mode="${k}">${esc(m.label)}</button>`).join('');

  const summary = days[0]?.summary
    ? `<p class="dp-summary">${esc(days[0].summary)}</p>` : '';

  return card(`${days.length}-day forecast`, G.cal, `
    ${summary}
    <div class="dp-pills">${pills}</div>
    <div class="dp-scroll">
      <div style="width:${W}px">
        <div class="dp-row">${heads}</div>
        ${chart}
        <div class="dp-row">${feet}</div>
      </div>
    </div>`);
}

/* ── details grid ─────────────────────────────────── */
export function detailsCard(data) {
  const c = data.current ?? {};
  const tiles = [];
  const add = (k, v, s = '') => { if (v != null && v !== '--' && v !== '' && v !== '--°') tiles.push({ k, v, s }); };

  if (c.feelsLike != null) add(c.feelsLabel || 'Feels like', temp(c.feelsLike));
  add('Humidity', c.humidity != null ? `${Math.round(c.humidity)}%` : null);
  add('Wind', c.windSpeed != null ? `${windVal(c.windSpeed)}` : null,
      `${windUnit()}${c.windDirText ? ' · ' + c.windDirText : ''}`);
  add('Gusts', c.windGust != null ? `${windVal(c.windGust)}` : null, windUnit());
  add('Pressure', c.pressure != null ? Math.round(c.pressure) : null,
      `hPa${c.pressureTrend ? ' · ' + c.pressureTrend : ''}`);
  add('Dew point', c.dewpoint != null ? temp(c.dewpoint) : null);
  add('UV index', c.uv != null ? Math.round(c.uv) : null,
      c.uv == null ? '' : c.uv < 3 ? 'Low' : c.uv < 6 ? 'Moderate' : c.uv < 8 ? 'High' : c.uv < 11 ? 'Very high' : 'Extreme');
  add('Visibility', c.visibility != null ? c.visibility.toFixed(c.visibility < 10 ? 1 : 0) : null, 'km');

  if (data.normals?.hi != null) add('Normal high', temp(data.normals.hi));
  if (data.normals?.lo != null) add('Normal low', temp(data.normals.lo));

  if (!tiles.length) return '';
  const body = `<div class="grid">${tiles.map((t) =>
    `<div class="tile"><div class="k">${esc(t.k)}</div><div class="v">${esc(t.v)}</div>${
      t.s ? `<div class="s">${esc(t.s)}</div>` : ''}</div>`).join('')}</div>`;
  return card('Details', G.info, body);
}

/* ── air quality ──────────────────────────────────── */
export function airCard(data) {
  const a = data.air;
  if (!a) return '';
  const pct = Math.min(100, Math.max(0, (a.index / a.max) * 100));
  const poll = a.pollutants
    ? `<div class="grid" style="margin-top:14px">${Object.entries(a.pollutants)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${Math.round(v)}</div><div class="s">µg/m³</div></div>`)
        .join('')}</div>`
    : '';
  const sub = a.station
    ? `<div class="s" style="margin-top:8px;color:var(--on-surface-var);font-size:12.5px">${esc(a.station)}${a.time ? ` · ${timeLabel(a.time, data.tz)}` : ''}</div>`
    : '';

  return card(a.scale === 'AQHI' ? 'Air quality health index' : 'Air quality', G.leaf, `
    <div class="aq-head">
      <div class="aq-val">${a.index}</div>
      <div>
        <div class="aq-cat">${esc(a.category)}</div>
        <div class="s" style="font-size:12px;color:var(--on-surface-var)">${a.scale === 'AQHI' ? 'Canada AQHI · 1–10+' : 'US AQI'}</div>
      </div>
    </div>
    <div class="aq-scale"><i style="left:${pct.toFixed(1)}%"></i></div>
    ${sub}${poll}`);
}

/* ── radar ────────────────────────────────────────── */
export function radarCard(data) {
  const { lat, lon } = data.coords ?? {};
  if (lat == null || !radarAvailable(lat, lon)) return '';

  // Card is roughly 16:10 at the sheet's inner width; 360×225 is close enough
  // and the browser scales the result to fit.
  const W = 360, H = 225;
  const spec = staticMapSpec(lat, lon, W, H, 6);

  const tiles = spec.tiles.map((t) =>
    `<img class="rd-base" src="${t.url}" alt="" loading="lazy" style="
       position:absolute;width:256px;height:256px;inset:auto;
       left:${t.left}px;top:${t.top}px">`).join('');

  return card('Precipitation radar', G.radar, `
    <button class="rd-card-preview" data-open-radar aria-label="Open radar map">
      <span style="position:absolute;inset:0;overflow:hidden">${tiles}</span>
      <img src="${spec.rain}" alt="" loading="lazy">
      <img src="${spec.snow}" alt="" loading="lazy">
      <span class="rd-dot"></span>
      <span class="rd-open">Open radar</span>
    </button>`);
}

/* ── sun & moon ───────────────────────────────────── */
const MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
                    'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

function moonPhase(date = new Date()) {
  // days since a known new moon (2000-01-06 18:14 UTC), synodic month 29.530588853
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  const frac = ((days / 29.530588853) % 1 + 1) % 1;
  return { frac, name: MOON_NAMES[Math.round(frac * 8) % 8] };
}

export function sunCard(data) {
  const { sunrise, sunset } = data.sun ?? {};
  if (!sunrise || !sunset || isNaN(sunrise) || isNaN(sunset)) return '';

  const now = Date.now();
  const t = Math.min(1, Math.max(0, (now - sunrise.getTime()) / (sunset.getTime() - sunrise.getTime())));
  const W = 300, H = 92, r = 118;
  const cx = W / 2, cy = H + 26;
  const ang = Math.PI * (1 - t);
  const px = cx + Math.cos(ang) * r, py = cy - Math.sin(ang) * r;

  const lenMin = Math.round((sunset - sunrise) / 60000);
  const { frac, name } = moonPhase();

  return card('Sun & moon', G.sun, `
    <div class="sun-arc">
      <svg viewBox="0 0 ${W} ${H}" style="height:${H}px">
        <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}"
              fill="none" stroke="var(--outline)" stroke-width="2.5" stroke-dasharray="4 5"/>
        <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)}"
              fill="none" stroke="var(--accent-ink)" stroke-width="3" stroke-linecap="round"/>
        <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7" fill="var(--accent-ink)"/>
      </svg>
      <div class="sun-times">
        <div>Sunrise<b>${timeLabel(sunrise, data.tz)}</b></div>
        <div style="text-align:center">Daylight<b>${Math.floor(lenMin / 60)}h ${lenMin % 60}m</b></div>
        <div style="text-align:right">Sunset<b>${timeLabel(sunset, data.tz)}</b></div>
      </div>
    </div>
    <div class="grid" style="margin-top:16px;grid-template-columns:1fr">
      <div class="tile"><div class="k">Moon phase</div><div class="v">${name}</div>
        <div class="s">${Math.round(frac * 100)}% through the lunar cycle</div></div>
    </div>`);
}

/* ── card assembly ────────────────────────────────── */

/* Alerts are deliberately not in here: a severe weather warning always belongs
   at the top, so it is not something the reorder UI can bury. */
export const CARDS = {
  hourly:  { label: 'Hourly forecast',      fn: hourlyCard },
  radar:   { label: 'Precipitation radar',  fn: radarCard },
  daily:   { label: 'Daily forecast',       fn: (d, o) => dailyCard(d, o.dailyMode) },
  details: { label: 'Details',              fn: detailsCard },
  air:     { label: 'Air quality',          fn: airCard },
  sun:     { label: 'Sun & moon',           fn: sunCard },
};

/* Daily leads: with the shortened hero it is the card already on screen when a
   location opens, which is the one worth seeing first. */
export const DEFAULT_ORDER = ['daily', 'hourly', 'radar', 'details', 'air', 'sun'];

export function normalizeOrder(order) {
  const seen = new Set();
  const out = (Array.isArray(order) ? order : []).filter((k) => CARDS[k] && !seen.has(k) && seen.add(k));
  for (const k of DEFAULT_ORDER) if (!seen.has(k)) out.push(k);   // pick up newly added cards
  return out;
}

export function renderCards(data, opts = {}) {
  const order = normalizeOrder(opts.order);
  const safe = (fn) => {
    try { return fn(data, opts) ?? ''; }
    catch (e) { console.warn('card failed', e); return ''; }
  };
  return safe(alertsCard) + order.map((k) => safe(CARDS[k].fn)).join('');
}

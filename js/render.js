/* Card renderers. Every card mirrors one of Breezy Weather's home blocks. */

import { icon } from './icons.js';
import { state } from './store.js';
import { radarAvailable, staticMapSpec } from './radar.js';
import { spansAvailable } from './sources/history.js';

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
  ext:   '<svg viewBox="0 0 24 24"><path d="M14 3v2h3.6l-8.3 8.3 1.4 1.4L19 6.4V10h2V3zM5 5h5V3H3v18h18v-7h-2v5H5z"/></svg>',
  hist:  '<svg viewBox="0 0 24 24"><path d="M13 3a9 9 0 1 0 8.5 11.9l-1.9-.6A7 7 0 1 1 13 5v3l4.5-4L13 0zm-1 5v5.4l4.3 2.6.8-1.3-3.6-2.2V8z"/></svg>',
};

/* ── alerts ───────────────────────────────────────── */
/* Alerts no longer occupy a card in the list — they live in the drop-down the
   banner opens, so this returns just the entries. */
export function alertsMarkup(data) {
  if (!data.alerts?.length) return '';
  return data.alerts.map((a, i) => `
    <button class="alert open" style="--al:${a.colour}" data-alert="${i}">
      <b>${esc(a.title.replace(/^\w/, (c) => c.toUpperCase()))}</b>
      <span>${esc(a.area)}${a.expires ? ` · until ${timeLabel(a.expires, data.tz)}` : ''}</span>
      <p>${esc(a.text)}</p>
    </button>`).join('')
    + '<button class="alert-drop-close" data-close-alerts>Close</button>';
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

  /* If the primary reading is Canada's AQHI, show the US AQI beside it. They
     are not interchangeable — AQHI is a health-risk score from three pollutants
     on a 1–10+ scale, US AQI is the worst single pollutant on 0–500 — and the
     US number is what most other apps report, so having both saves guessing at
     which scale a figure is on. */
  const us = data.airUs && a.scale === 'AQHI' && data.airUs.index != null ? data.airUs : null;

  /* Each reading links to the authority that defines it. AQHI and US AQI are
     different scales with different bands, and "what does 4 actually mean"
     is a fair question the app cannot answer in a card. */
  const second = us ? `
    <a class="aq-second" href="${AQ_DOCS.us}" target="_blank" rel="noopener">
      <span class="aq-face">${aqiFace(us.index)}</span>
      <div>
        <b>${us.index} <span>US AQI</span></b>
        <div class="s">${esc(us.category)}</div>
      </div>
      <span class="aq-info">${G.ext}</span>
    </a>` : '';

  const isAqhi = a.scale === 'AQHI';
  return card(isAqhi ? 'Air quality health index' : 'Air quality', G.leaf, `
    <a class="aq-head" href="${isAqhi ? AQ_DOCS.aqhi : AQ_DOCS.us}" target="_blank" rel="noopener">
      <div class="aq-val">${a.index}</div>
      <div>
        <div class="aq-cat">${esc(a.category)}</div>
        <div class="s" style="font-size:12px;color:var(--on-surface-var)">${isAqhi ? 'Canada AQHI · 1–10+' : 'US AQI'}</div>
      </div>
      <span class="aq-info">${G.ext}</span>
    </a>
    <div class="aq-scale"><i style="left:${pct.toFixed(1)}%"></i></div>
    ${second}${sub}${poll}`);
}

const AQ_DOCS = {
  aqhi: 'https://www.canada.ca/en/environment-climate-change/services/air-quality-health-index/about.html',
  us: 'https://www.airnow.gov/aqi/aqi-basics/',
};

/* Face icons on the US AQI bands: good, moderate, unhealthy for sensitive
   groups, unhealthy, very unhealthy, hazardous. */
function aqiFace(aqi) {
  const band = aqi <= 50 ? 0 : aqi <= 100 ? 1 : aqi <= 150 ? 2 : aqi <= 200 ? 3 : aqi <= 300 ? 4 : 5;
  const fill = ['#3ec46d', '#f5c518', '#f5983b', '#e4573d', '#a457c4', '#8d3646'][band];
  // mouth: smile, flat, slight frown, frown, deep frown, grimace
  const mouth = [
    'M8.2 14.4a4.6 4.6 0 0 0 7.6 0',
    'M8.4 14.6h7.2',
    'M8.2 15.4a4.6 4.6 0 0 1 7.6 0',
    'M8 15.8a5 5 0 0 1 8 0',
    'M8 16.2a5 5 0 0 1 8 0',
    'M8 16.4a5 5 0 0 1 8 0',
  ][band];
  const eyes = band >= 4
    ? '<path d="M8.1 9.4 10.9 11M10.9 9.4 8.1 11M13.1 9.4 15.9 11M15.9 9.4 13.1 11" stroke="#0b1420" stroke-width="1.3" stroke-linecap="round" fill="none"/>'
    : '<circle cx="9.3" cy="10.2" r="1.25" fill="#0b1420"/><circle cx="14.7" cy="10.2" r="1.25" fill="#0b1420"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="${fill}"/>
    ${eyes}
    <path d="${mouth}" stroke="#0b1420" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  </svg>`;
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

const SYNODIC = 29.530588853;      // days between new moons

function moonPhase(date = new Date()) {
  // days since a known new moon (2000-01-06 18:14 UTC)
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  const frac = ((days / SYNODIC) % 1 + 1) % 1;          // 0 = new, 0.5 = full
  const illum = (1 - Math.cos(2 * Math.PI * frac)) / 2; // 0 = dark, 1 = full
  return { frac, illum, name: MOON_NAMES[Math.round(frac * 8) % 8] };
}

/* Draw the moon as it actually looks, because "waning gibbous" tells you
   nothing if you don't already know the word.
   The lit region is the outer limb on one side plus the terminator, which is
   a half-ellipse whose width tracks how far through the cycle we are. */
export function moonSvg(frac, size = 62) {
  const r = size / 2 - 2, cx = size / 2, cy = size / 2;
  const illum = (1 - Math.cos(2 * Math.PI * frac)) / 2;
  const disc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#20262f"/>
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3a4350" stroke-width="1"/>`;

  if (illum > 0.995) {
    return `<svg viewBox="0 0 ${size} ${size}">${disc}
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#EDF2F8"/></svg>`;
  }
  if (illum < 0.005) return `<svg viewBox="0 0 ${size} ${size}">${disc}</svg>`;

  const waxing = frac < 0.5;
  const rx = r * Math.abs(Math.cos(2 * Math.PI * frac));
  const outer = waxing ? 1 : 0;                 // which limb catches the light
  const inner = illum > 0.5 ? outer : 1 - outer; // gibbous bulges out, crescent in

  const lit = `M ${cx} ${cy - r}
               A ${r} ${r} 0 0 ${outer} ${cx} ${cy + r}
               A ${rx.toFixed(2)} ${r} 0 0 ${inner} ${cx} ${cy - r} Z`;

  return `<svg viewBox="0 0 ${size} ${size}">${disc}
    <path d="${lit}" fill="#EDF2F8"/></svg>`;
}

/* Days until the next new moon and the next full moon. */
function moonEvents(frac) {
  const toNew = (1 - frac) % 1 * SYNODIC;
  const toFull = ((0.5 - frac + 1) % 1) * SYNODIC;
  const fmt = (d) => {
    if (d < 1) return `${Math.max(1, Math.round(d * 24))} hours`;
    const n = Math.round(d);
    return `${n} day${n === 1 ? '' : 's'}`;
  };
  return toFull <= toNew
    ? { next: 'Full moon', in: fmt(toFull), other: 'New moon', otherIn: fmt(toNew) }
    : { next: 'New moon', in: fmt(toNew), other: 'Full moon', otherIn: fmt(toFull) };
}

/* ── where things actually are in the sky ─────────────
 * Low-precision solar and lunar position, the standard truncated series. A
 * degree or so of error is invisible on a 300px arc, and it avoids pulling in
 * an ephemeris library for what is ultimately a decoration with a job: showing
 * where the sun is now, and whether the moon is up at all.
 */
const DEG = Math.PI / 180;
const days2000 = (d) => d.getTime() / 86400000 - 10957.5;

function equatorial(lonEcl, latEcl, n) {
  const e = (23.439 - 0.0000004 * n) * DEG;
  const l = lonEcl * DEG, b = latEcl * DEG;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return { ra, dec };
}

const sunEq = (n) => {
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lam = 280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  return equatorial(lam, 0, n);
};

const moonEq = (n) => {
  const L = 218.316 + 13.176396 * n;
  const M = (134.963 + 13.064993 * n) * DEG;
  const F = (93.272 + 13.229350 * n) * DEG;
  return equatorial(L + 6.289 * Math.sin(M), 5.128 * Math.sin(F), n);
};

/* Altitude above the horizon, and how far through its own rise-to-set arc the
   body is — 0 at rising, 0.5 at its highest, 1 at setting. */
function skyPos(eq, n, lat, lon) {
  const lst = (280.16 + 360.9856235 * n + lon) * DEG;
  const H = lst - eq.ra;
  const la = lat * DEG;
  const alt = Math.asin(Math.sin(la) * Math.sin(eq.dec) + Math.cos(la) * Math.cos(eq.dec) * Math.cos(H));

  // semi-diurnal arc: how far either side of transit the body stays up
  const cosH0 = -Math.tan(la) * Math.tan(eq.dec);
  const H0 = Math.abs(cosH0) > 1 ? (cosH0 > 1 ? 0 : Math.PI) : Math.acos(cosH0);
  let h = Math.atan2(Math.sin(H), Math.cos(H));          // wrap to ±π
  const t = H0 ? 0.5 + h / (2 * H0) : 0.5;
  return { alt, t };
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
  const { frac, illum, name } = moonPhase();
  const ev = moonEvents(frac);

  /* Both bodies are placed on the same arc from their real positions, so the
     moon appears where it actually is rather than as an afterthought — and is
     simply absent when it is below the horizon. */
  const { lat, lon } = data.coords ?? {};
  const onArc = (f) => {
    const a = Math.PI * (1 - Math.min(1, Math.max(0, f)));
    return [cx + Math.cos(a) * r, cy - Math.sin(a) * r];
  };

  let sunUp = true, sunXY = [px, py], moonXY = null;
  if (lat != null && lon != null) {
    const n = days2000(new Date(now));
    const s = skyPos(sunEq(n), n, lat, lon);
    sunUp = s.alt > -0.05;
    if (sunUp) sunXY = onArc(s.t);
    const m = skyPos(moonEq(n), n, lat, lon);
    if (m.alt > -0.05) moonXY = onArc(m.t);
  }

  const [sx, sy] = sunXY;
  /* Below the horizon the sun still marks where it went down, dimmed — an arc
     with nothing on it reads as a failure to draw rather than as night. */
  const sunGlyph = sunUp ? `
    <g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})">
      <circle r="13" fill="var(--accent-ink)" opacity=".22"/>
      <circle r="7.5" fill="#f7c948"/>
      <g stroke="#f7c948" stroke-width="1.8" stroke-linecap="round">
        <path d="M0-12V-15M0 12v3M-12 0h-3M12 0h3M-8.5-8.5-10.6-10.6M8.5 8.5l2.1 2.1M8.5-8.5l2.1-2.1M-8.5 8.5-10.6 10.6"/>
      </g>
    </g>` : `
    <g transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})" opacity=".45">
      <circle r="6" fill="var(--on-surface-var)"/>
    </g>`;

  const moonGlyph = moonXY ? `
    <g transform="translate(${moonXY[0].toFixed(1)} ${moonXY[1].toFixed(1)})">
      <circle r="11" fill="#0b1420" opacity=".18"/>
      <g transform="translate(-8 -8) scale(.516)">${moonSvg(frac, 31)}</g>
    </g>` : '';

  return card('Sun & moon', G.sun, `
    <div class="sun-arc">
      <svg viewBox="0 0 ${W} ${H}" style="height:${H}px">
        <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}"
              fill="none" stroke="var(--outline)" stroke-width="2.5" stroke-dasharray="4 5"/>
        <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${px.toFixed(1)} ${py.toFixed(1)}"
              fill="none" stroke="var(--accent-ink)" stroke-width="3" stroke-linecap="round"/>
        ${moonGlyph}${sunGlyph}
      </svg>
      <div class="sun-times">
        <div>Sunrise<b>${timeLabel(sunrise, data.tz)}</b></div>
        <div style="text-align:center">Daylight<b>${Math.floor(lenMin / 60)}h ${lenMin % 60}m</b></div>
        <div style="text-align:right">Sunset<b>${timeLabel(sunset, data.tz)}</b></div>
      </div>
    </div>
    <div class="moon">
      <div class="moon-disc">${moonSvg(frac)}</div>
      <div class="moon-info">
        <b>${name}</b>
        <span>${Math.round(illum * 100)}% lit</span>
        <div class="moon-next"><em>${ev.next}</em> in ${ev.in}</div>
        <div class="moon-other">${ev.other} in ${ev.otherIn}</div>
      </div>
    </div>`);
}

/* ── historical ───────────────────────────────────── */
/* Same column-and-chart shape as the daily panel, so a fortnight of the past
   reads the way the week ahead does. Fourteen columns rather than seven, which
   is why it scrolls: today sits in the middle with a week either side. */
export function historyCard(data, opts = {}) {
  const spans = spansAvailable();
  const pick = spans.includes(opts.historyYears) ? opts.historyYears : spans[0];
  const h = data.history;

  const pills = spans.map((y) =>
    `<button class="dp-pill${y === pick ? ' on' : ''}" data-history-years="${y}">${
      y === 1 ? 'Last year' : `${y} years`}</button>`).join('');

  const shell = (body) => card('Historical', G.hist, `
    <div class="dp-pills">${pills}</div>${body}`);

  if (!h || h.yearsAgo !== pick) return shell('<p class="dp-summary">Loading…</p>');
  if (!h.days.length) return shell('<p class="dp-summary">No records for this period.</p>');

  const days = h.days;
  const W = days.length * COL;
  const todayKey = new Date().toDateString().slice(0, 3);   // weekday initials

  const temps = days.flatMap((d) => [d.hi, d.lo]).filter((v) => v != null);
  const max = Math.max(...temps), min = Math.min(...temps);
  const span = Math.max(max - min, 1);
  const padT = 24, padB = 24;
  const y = (v) => padT + (1 - (v - min) / span) * (CHART_H - padT - padB);
  const x = (i) => i * COL + COL / 2;

  const line = (key, dy, cls) => {
    const pts = days.map((d, i) => (d[key] == null ? null : `${x(i)},${y(d[key]).toFixed(1)}`))
                    .filter(Boolean).join(' ');
    if (!pts) return '';
    const labels = days.map((d, i) => d[key] == null ? '' :
      `<text x="${x(i)}" y="${(y(d[key]) + dy).toFixed(1)}" text-anchor="middle"
         font-size="13" font-weight="600" fill="currentColor">${esc(temp(d[key]))}</text>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="var(--accent-ink)" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round" class="${cls}"/>${labels}`;
  };

  /* Centre on the day that matches today rather than the middle of whatever
     the archive returned, so the marked column is the one you came to see even
     when the window is clipped at one end. */
  const mid = Math.max(0, days.findIndex((d) => d.date.toISOString().slice(0, 10) === h.centre));
  const heads = days.map((d, i) => `
    <div class="dp-col${i === mid ? ' hist-mid' : ''}">
      <b>${dayLabel(d.date, data.tz)}</b>
      <em>${dateLabel(d.date, data.tz)}</em>
    </div>`).join('');

  const wettest = Math.max(0.001, ...days.map((d) => d.precip ?? 0));
  const feet = days.map((d) => {
    const mm = d.precip ?? 0;
    const barH = mm > 0 ? Math.max(3, (mm / wettest) * 26) : 0;
    return `<div class="dp-col">
      <span class="hist-bar" style="height:${barH.toFixed(1)}px"></span>
      <span class="dp-pop">${mm >= 0.1 ? (mm >= 10 ? Math.round(mm) : mm.toFixed(1)) : ''}</span>
    </div>`;
  }).join('');

  return shell(`
    <p class="dp-summary">${h.year} · daily high and low, rainfall in mm below</p>
    <div class="dp-scroll" data-hist-scroll data-centre="${mid}">
      <div style="width:${W}px">
        <div class="dp-row">${heads}</div>
        <svg class="dp-chart" width="${W}" height="${CHART_H}" viewBox="0 0 ${W} ${CHART_H}">
          ${line('hi', -9, 'dp-hi')}
          ${line('lo', 17, 'dp-lo')}
        </svg>
        <div class="dp-row hist-feet">${feet}</div>
      </div>
    </div>
    ${monthlyChart(h)}`);
}

/* Monthly rainfall for the chosen year against this year, paired per month so
   the comparison is the point rather than two charts to hold in your head. */
function monthlyChart(h) {
  const past = h.monthlyPast ?? [], now = h.monthlyNow ?? [];
  if (!past.some((v) => v != null) && !now.some((v) => v != null)) return '';

  const M = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const peak = Math.max(1, ...past.filter((v) => v != null), ...now.filter((v) => v != null));
  const W = 336, H = 118, base = H - 26, top = 16;
  const slot = W / 12;

  const bars = M.map((_, i) => {
    const bar = (v, dx, cls) => {
      if (v == null) return '';
      const hgt = Math.max(v > 0 ? 2 : 0, (v / peak) * (base - top));
      return `<rect x="${(i * slot + slot / 2 + dx - 6).toFixed(1)}" y="${(base - hgt).toFixed(1)}"
        width="12" height="${hgt.toFixed(1)}" rx="2.5" class="${cls}"/>`;
    };
    return bar(past[i], -7, 'mo-past') + bar(now[i], 7, 'mo-now');
  }).join('');

  const labels = M.map((m, i) => `
    <text x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle"
      font-size="11" font-weight="700" fill="var(--on-surface-var)">${m}</text>`).join('');

  const total = (a) => { const v = a.filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0)) : null; };
  const tPast = total(past), tNow = total(now);

  return `
    <div class="mo-wrap">
      <div class="mo-key">
        <span><i class="mo-sw mo-past"></i>${h.year}${tPast != null ? ` · ${tPast} mm` : ''}</span>
        <span><i class="mo-sw mo-now"></i>${h.nowYear}${tNow != null ? ` · ${tNow} mm` : ''}</span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" class="mo-chart">${bars}${labels}</svg>
      <p class="mo-note">Monthly rainfall. ${h.nowYear} runs to the last few days
        — reanalysis lags real time, so the current month is partial.</p>
    </div>`;
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
  history: { label: 'Historical',           fn: (d, o) => historyCard(d, o) },
};

/* Daily leads: with the shortened hero it is the card already on screen when a
   location opens, which is the one worth seeing first. */
export const DEFAULT_ORDER = ['daily', 'hourly', 'radar', 'details', 'air', 'sun', 'history'];

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
  return order.map((k) => safe(CARDS[k].fn)).join('');
}

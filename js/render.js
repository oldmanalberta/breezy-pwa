/* Card renderers. Every card mirrors one of Breezy Weather's home blocks. */

import { icon } from './icons.js';
import { state } from './store.js';
import { radarAvailable, staticMapSpec } from './radar.js';
import { spansAvailable } from './sources/history.js';
import { localChance, magLat, ovalEdge, HORIZON_REACH } from './aurora.js';

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
  aurora: '<svg viewBox="0 0 24 24"><path d="M3 20c1.5-6 3-9 5-9s2.5 5 4 5 2.5-9 5-9 3 4 4 6l-1.8.9c-.9-2-1.6-3.4-2.2-3.4-1.2 0-1.9 9-5 9s-2.6-5-4-5-2.3 2.5-3.1 5.9z"/><path d="M5 6h2M9 3h2M15 4h2M20 8h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
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
const popLvl = (p) => (p >= 60 ? 'lv2' : p >= 30 ? 'lv1' : 'lv0');

export function hourlyCard(data) {
  const hrs = (data.hourly ?? []).slice(0, 24);
  if (hrs.length < 2) return '';

  measure();
  const W = HOUR_W, H = Math.round(CHART_H * 0.55), padT = Math.round(FS * 1.5), padB = 10;
  const temps = hrs.map((h) => h.temp).filter((t) => t != null);
  if (!temps.length) return '';
  const min = Math.min(...temps), max = Math.max(...temps);
  const span = Math.max(max - min, 1);
  const y = (t) => padT + (1 - (t - min) / span) * (H - padT - padB);
  const x = (i) => i * W + W / 2;

  const pts = hrs.map((h, i) => (h.temp == null ? null : `${x(i)},${y(h.temp).toFixed(1)}`))
                 .filter(Boolean).join(' ');

  const labels = hrs.map((h, i) => h.temp == null ? '' :
    `<text x="${x(i)}" y="${(y(h.temp) - 8).toFixed(1)}" text-anchor="middle"
       font-size="${FS}" font-weight="600" fill="currentColor">${temp(h.temp)}</text>`).join('');

  const cols = hrs.map((h, i) => `
    <div class="hr${i === 0 ? ' now' : ''}">
      <div class="i">${icon(h.condition, h.night)}</div>
      <div class="p ${popLvl(h.pop ?? 0)}">${h.pop != null && h.pop > 5 ? Math.round(h.pop) + '%' : ''}</div>
      <div class="h">${i === 0 ? 'Now' : hourLabel(h.time, data.tz)}</div>
    </div>`).join('');

  const total = hrs.length * W;
  return card('Hourly forecast', G.clock, `
    <div class="hourly-wrap">
      <div style="width:${total}px">
        <svg class="spark" width="${total}" height="${H}" viewBox="0 0 ${total} ${H}">
          <polyline points="${pts}" fill="none" stroke="var(--hi-line, var(--accent-ink))" stroke-width="2.5"
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

/* Strip geometry, measured rather than fixed: seven day columns fill the
   card's inner width on whatever phone this is, and every size inside the
   chart hangs off the root font so the strip tracks Text Size along with
   the rest of the app. Read once per paint by measure(). */
let COL = 48;            // px per day column
let CHART_H = 100;       // px of chart between the day and night icons
let FS = 13, FSS = 11;   // chart label sizes: values, and the small alt line
let HOUR_W = 52;         // px per hour column

export function measure() {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // card padding 18 each side (see app.css); on wide screens #cards is split
  // into columns, so measure one column rather than the whole strip
  const cards = document.querySelector('#cards');
  const cs = cards && getComputedStyle(cards);
  const n = parseInt(cs?.columnCount, 10) || 1;
  const gap = n > 1 ? parseFloat(cs.columnGap) || 0 : 0;
  const width = cards?.clientWidth || window.innerWidth;
  const inner = Math.max(240, (width - gap * (n - 1)) / n - 36);
  COL = Math.floor(inner / 7);
  HOUR_W = Math.max(Math.floor(inner / 6.5), Math.round(rem * 3));
  CHART_H = Math.round(rem * 6.25);
  FS = Math.round(rem * 0.8 * 10) / 10;
  FSS = Math.round(rem * 0.66 * 10) / 10;
  document.documentElement.style.setProperty('--dp-col', `${COL}px`);
  document.documentElement.style.setProperty('--hr-col', `${HOUR_W}px`);
  document.documentElement.style.setProperty('--dp-ico', `${Math.min(28, Math.round(COL * 0.56))}px`);
}

/* `past: true` marks the series that also make sense for days already gone —
   the recorded high and low, how much fell, how hard it blew. Those modes get
   the previous week prepended to the strip, parked off-screen to the left. A
   forecast-only quantity like probability of precipitation has no recorded
   counterpart, so the other modes show the forecast alone. */
export const DAILY_MODES = {
  conditions: {
    label: 'Conditions',
    kind: 'range',
    past: true,
    hi: (d) => d.hi, lo: (d) => d.lo,
    fmt: (v) => temp(v),
  },
  precipitation: {
    label: 'Precipitation',
    kind: 'bar',
    past: true,
    val: (d) => d.precip,
    alt: (d) => (d.past ? null : d.pop),      // a chance of rain is not a record
    fmt: (v) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + ' mm',
    altFmt: (v) => Math.round(v) + '%',
    colour: '#5aa9e6',
  },
  wind: {
    label: 'Wind',
    kind: 'bar',
    past: true,
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
  const padT = Math.round(FS * 1.7), padB = Math.round(FS * 1.7);
  const y = (v) => padT + (1 - (v - min) / span) * (CHART_H - padT - padB);
  const x = (i) => i * COL + COL / 2;

  const line = (get, cls, dy) => {
    const pts = days.map((d, i) => (get(d) == null ? null : `${x(i)},${y(get(d)).toFixed(1)}`))
                    .filter(Boolean).join(' ');
    if (!pts) return '';
    const labels = days.map((d, i) => get(d) == null ? '' :
      `<text x="${x(i)}" y="${(y(get(d)) + dy).toFixed(1)}" text-anchor="middle"
         font-size="${FS}" font-weight="600" class="${cls}-t">${esc(mode.fmt(get(d)))}</text>`).join('');
    return `<polyline points="${pts}" fill="none" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round" class="${cls}"/>${labels}`;
  };

  return `<svg class="dp-chart" width="${W}" height="${CHART_H}" viewBox="0 0 ${W} ${CHART_H}">
      ${line(mode.hi, 'dp-hi', -Math.round(FS * 0.65))}
      ${line(mode.lo, 'dp-lo', Math.round(FS * 1.25))}
      ${divider(days)}
    </svg>`;
}

/* A dashed rule where the record stops and the forecast starts, so the eye
   does not read last Tuesday's high as a prediction. Nothing is drawn when the
   strip holds forecast alone. */
function divider(days) {
  const n = days.filter((d) => d.past).length;
  if (!n || n === days.length) return '';
  const x = n * COL;
  return `<line x1="${x}" y1="4" x2="${x}" y2="${CHART_H - 4}" stroke="var(--on-surface-var)"
            stroke-width="1.5" stroke-dasharray="3 4" opacity=".6"/>`;
}

/* simple column chart with a value label above each bar */
function barChart(days, mode, W) {
  const vals = days.map(mode.val).filter((v) => v != null);
  if (!vals.length) return '';
  const max = Math.max(...vals, 0.001);
  const padT = Math.round(FS * 1.9), padB = Math.round(FSS * 1.8), base = CHART_H - padB;

  const bars = days.map((d, i) => {
    const v = mode.val(d);
    if (v == null) return '';
    const h = Math.max((v / max) * (CHART_H - padT - padB), v > 0 ? 3 : 0);
    const cx = i * COL + COL / 2;
    const alt = mode.alt?.(d);
    return `
      <rect x="${cx - Math.round(COL * 0.18)}" y="${(base - h).toFixed(1)}" width="${Math.round(COL * 0.36)}" height="${h.toFixed(1)}"
            rx="4" fill="${mode.colour}" opacity=".85"/>
      <text x="${cx}" y="${(base - h - 6).toFixed(1)}" text-anchor="middle"
            font-size="${FSS}" font-weight="600" fill="currentColor">${esc(mode.fmt(v))}</text>
      ${alt != null && alt > 0 ? `<text x="${cx}" y="${base + FSS + 3}" text-anchor="middle"
            font-size="${FSS}" font-weight="600" fill="var(--on-surface-var)">${esc(mode.altFmt(alt))}</text>` : ''}`;
  }).join('');

  return `<svg class="dp-chart" width="${W}" height="${CHART_H}" viewBox="0 0 ${W} ${CHART_H}">${bars}${divider(days)}</svg>`;
}

export function dailyCard(data, modeKey = 'conditions') {
  measure();
  const ahead = (data.daily ?? []).slice(0, 10);
  if (!ahead.length) return '';

  const available = Object.entries(DAILY_MODES).filter(([, m]) => hasData(m, ahead));
  if (!available.length) return '';
  const key = available.some(([k]) => k === modeKey) ? modeKey : available[0][0];
  const mode = DAILY_MODES[key];

  /* The week that has already happened sits to the left of today, off-screen
     until you slide the strip back — a scroll gesture the panel already has.
     Only for series a recorded value exists for. */
  const before = mode.past
    ? (data.past ?? []).slice(-7).map((d) => ({ ...d, past: true }))
    : [];
  const days = [...before, ...ahead];
  const start = before.length;                   // column today sits in

  const W = days.length * COL;
  const today = new Date().toDateString();

  const heads = days.map((d) => {
    const isToday = d.date && d.date.toDateString() === today;
    // seven across means "Thu", not ECCC's "Thursday"; the date line has the rest
    const name = isToday ? 'Today' : d.date ? dayLabel(d.date, data.tz) : String(d.label ?? '').slice(0, 3);
    return `<div class="dp-col${d.past ? ' dp-past' : ''}${isToday ? ' dp-today' : ''}">
        <b>${esc(name)}</b>
        <em>${d.date ? dateLabel(d.date, data.tz) : ''}</em>
        <span class="dp-ico" title="${esc(d.text)}">${icon(d.condition, false)}</span>
      </div>`;
  }).join('');

  /* The night icon renders in every series, not just Conditions. It is useful
     everywhere, and reserving the row unconditionally is what keeps the card
     the same height as you switch series — otherwise the sheet jumps. */
  const feet = days.map((d) => `<div class="dp-col${d.past ? ' dp-past' : ''}">
      <span class="dp-ico dim">${icon(d.condition, true)}</span>
      <span class="dp-pop ${popLvl(d.pop ?? 0)}">${!d.past && d.pop != null && d.pop > 5 ? Math.round(d.pop) + '%' : ''}</span>
    </div>`).join('');

  const chart = mode.kind === 'range' ? rangeChart(days, mode, W) : barChart(days, mode, W);

  const pills = available.map(([k, m]) =>
    `<button class="dp-pill${k === key ? ' on' : ''}" data-daily-mode="${k}">${esc(m.label)}</button>`).join('');

  const summary = ahead[0]?.summary
    ? `<p class="dp-summary">${esc(ahead[0].summary)}</p>` : '';

  const hint = before.length
    ? `<p class="dp-hint">Slide back for the past ${before.length} days</p>` : '';

  return card(`${ahead.length}-day forecast`, G.cal, `
    ${summary}
    <div class="dp-pills">${pills}</div>
    <div class="dp-scroll" data-daily-scroll data-start="${start}">
      <div style="width:${W}px">
        <div class="dp-row">${heads}</div>
        ${chart}
        <div class="dp-row">${feet}</div>
      </div>
    </div>${hint}`);
}

/* ── details grid ─────────────────────────────────── */
/* Each tile reads like a night on the aurora card: the number, a short
   verdict in the accent colour, then a plain sentence that grounds it
   against the actual temperature, the season's normal, the next few hours
   or a familiar yardstick (the Beaufort scale, the dew point comfort bands,
   the UV index advice). Anything worth acting on turns amber. A coloured dot
   places scaled values (wind, UV, visibility) from easy green to severe red. */
const BEAUFORT = [
  [2, 'Calm', 'Smoke rises straight up.'],
  [6, 'Light air', 'Barely noticeable.'],
  [12, 'Light breeze', 'Felt on the face, leaves rustle.'],
  [20, 'Gentle breeze', 'Leaves and small flags in constant motion.'],
  [29, 'Moderate breeze', 'Raises dust and loose paper.'],
  [39, 'Fresh breeze', 'Small trees sway.'],
  [50, 'Strong breeze', 'Umbrellas are hard to use.'],
  [62, 'Near gale', 'Hard to walk against.'],
  [75, 'Gale', 'Twigs break off trees.'],
  [Infinity, 'Strong gale', 'Expect damage.'],
];
const SCALE_DOT = ['#3ec46d', '#f7c948', '#f5a623', '#f2704b', '#d9434f'];

function detailNotes(data) {
  const c = data.current ?? {}, tz = data.tz;
  const now = Date.now();
  const ahead = (hrs) => (data.hourly ?? []).filter((h) => h.time && h.time.getTime() > now - 1800e3 && h.time.getTime() <= now + hrs * 3600e3);
  const notes = {};
  const d0 = data.daily?.[0];
  // h: verdict, n: the grounding sentence, warn: worth acting on, dot: 0–4 severity
  const put = (k, h, n = '', warn = false, dot = null) => { notes[k] = { h, n, warn, dot }; };

  // feels like, then where the temperature is heading
  if (c.temp != null) {
    let h = 'Same as actual', n = '', warn = false;
    if (c.feelsLike != null) {
      const diff = Math.round(c.feelsLike - c.temp);
      if (diff <= -2) h = `${-diff}° colder in the wind`;
      else if (diff >= 2) h = `${diff}° warmer with humidity`;
    }
    const next = ahead(12).filter((x) => x.temp != null);
    if (next.length > 2) {
      const lo = next.reduce((a, b) => (b.temp < a.temp ? b : a));
      const hi = next.slice(0, 7).reduce((a, b) => (b.temp > a.temp ? b : a));
      const drop = c.temp - lo.temp, rise = hi.temp - c.temp;
      const hrs = (lo.time - now) / 3600e3;
      if (drop >= 5 && hrs <= 8) { n = `Cooling quickly to ${temp(lo.temp)} by ${hourLabel(lo.time, tz)}.`; warn = lo.temp <= 2; }
      else if (drop >= 3) n = `Cooling to ${temp(lo.temp)} by ${hourLabel(lo.time, tz)}.`;
      else if (rise >= 3) n = `Warming to ${temp(hi.temp)} by ${hourLabel(hi.time, tz)}.`;
      else n = 'Holding steady for the next few hours.';
    }
    if (warn) n = n.replace(/\.$/, '. Frost possible.');
    put('Feels like', h, n, warn);
  }

  // humidity: dryness, comfort, and whether the next hours stay dry
  if (c.humidity != null) {
    const rh = c.humidity, t = c.temp ?? 10;
    const wet = Math.max(0, ...ahead(6).map((x) => x.pop ?? 0));
    if (rh < 25) put('Humidity', 'Very dry', 'Expect static and dry skin.', true);
    else if (rh < 45) put('Humidity', 'Dry', wet < 30 ? 'Good drying weather for laundry or harvest.' : 'Dry for now, but rain is possible later.');
    else if (rh < 65) put('Humidity', 'Comfortable', 'Neither dry nor muggy.');
    else if (rh < 85) put('Humidity', t >= 20 ? 'Humid' : 'Damp', t >= 20 ? 'It will feel muggy.' : 'Things dry slowly.');
    else put('Humidity', 'Very humid', 'Dew, mist or fog likely.');
  }

  // wind on the Beaufort scale, then how much harder the gusts hit
  if (c.windSpeed != null) {
    const i = BEAUFORT.findIndex(([max]) => c.windSpeed < max);
    const [, h, n] = BEAUFORT[i];
    put('Wind', h, n, i >= 6, i <= 3 ? 0 : i <= 5 ? 1 : i <= 6 ? 2 : i <= 7 ? 3 : 4);
  }
  if (c.windGust != null && c.windSpeed != null) {
    const g = c.windGust - c.windSpeed, G = c.windGust;
    const dot = G < 30 ? 0 : G < 50 ? 1 : G < 70 ? 2 : G < 90 ? 3 : 4;
    if (G >= 70) put('Gusts', 'Damaging', 'Secure loose items.', true, dot);
    else if (g >= 15) put('Gusts', 'Gusty', `${windVal(g)} ${windUnit()} stronger than the steady wind.`, G >= 50, dot);
    else put('Gusts', 'Steady', 'Close to the steady wind. No sudden blasts.', false, dot);
  }

  /* pressure: local (station) pressure, so it is judged against the normal
     for this elevation: 1013 hPa at sea level, about 937 at Edmonton's
     670 m. The low and high bands scale with it. */
  if (c.pressure != null) {
    const p = c.pressure, z = data.elevation;
    const avg = z != null ? 1013.25 * Math.pow(1 - 2.25577e-5 * z, 5.25588) : 1013.25;
    const k = avg / 1013.25;
    let trend = String(c.pressureTrend || '').toLowerCase();
    if (!trend) {
      const fut = ahead(6).filter((x) => x.pressure != null);
      if (fut.length > 3) {
        const dp = fut[fut.length - 1].pressure - fut[0].pressure;
        trend = dp <= -1.5 ? 'falling' : dp >= 1.5 ? 'rising' : 'steady';
      }
    }
    const fall = trend.startsWith('fall'), rise = trend.startsWith('ris'), flat = trend.startsWith('stead');
    const lvl = p < 1000 * k ? 'Low' : p > 1022 * k ? 'High' : 'Near average';
    const h = lvl + (fall ? ', falling' : rise ? ', rising' : flat ? ', steady' : '');
    const n = (z != null && z > 50 ? `Average at this elevation is about ${Math.round(avg)} hPa. ` : 'Sea-level average is 1013 hPa. ')
      + (fall ? 'Cloud or rain may move in.' : rise ? 'The weather should settle.'
        : lvl === 'Low' ? 'Typical of unsettled weather.' : lvl === 'High' ? 'Typical of settled weather.' : '');
    put('Pressure', h, n.trim(), fall || lvl === 'Low');
  }

  // dew point: comfort when warm, frost or fog when cool
  if (c.dewpoint != null) {
    const dp = c.dewpoint, t = c.temp;
    if (d0?.lo != null && d0.lo <= 0 && dp <= 0) put('Dew point', 'Frost likely', 'If the sky clears tonight.', true);
    else if (t != null && t - dp <= 2) put('Dew point', 'Near saturation', 'Fog or dew likely.', true);
    else if (t != null && t >= 18) {
      if (dp < 10) put('Dew point', 'Comfortable', 'Not sticky.');
      else if (dp < 16) put('Dew point', 'Noticeable', 'You will feel the humidity.');
      else if (dp < 20) put('Dew point', 'Sticky', 'Muggy, sweat dries slowly.', true);
      else put('Dew point', 'Oppressive', 'Take it easy outdoors.', true);
    } else put('Dew point', t != null && t - dp >= 10 ? 'Dry air' : 'Moist air', 'Where the air would start to form dew.');
  }

  // UV: the WHO advice for the level, or that it is over for the day
  if (c.uv != null) {
    const u = c.uv, dot = u < 3 ? 0 : u < 6 ? 1 : u < 8 ? 2 : u < 11 ? 3 : 4;
    if (c.night || u < 1) put('UV index', 'Over for today', 'Sun is down or too low to matter.', false, 0);
    else if (u < 3) put('UV index', 'Low', 'No protection needed.', false, dot);
    else if (u < 6) put('UV index', 'Moderate', 'Sunscreen if you are out for a while.', false, dot);
    else if (u < 8) put('UV index', 'High', 'Protection needed. Seek shade at midday.', true, dot);
    else put('UV index', u < 11 ? 'Very high' : 'Extreme', 'Burns quickly. Avoid the midday sun.', true, dot);
  }

  if (c.visibility != null) {
    const v = c.visibility;
    if (v >= 20) put('Visibility', 'Excellent', 'Clear views a long way.', false, 0);
    else if (v >= 10) put('Visibility', 'Good', 'A little haze in the distance.', false, 0);
    else if (v >= 4) put('Visibility', 'Hazy', 'Distant hills and buildings fade.', false, 1);
    else if (v >= 1) put('Visibility', 'Poor', 'Drive with care.', true, 3);
    else put('Visibility', 'Fog', 'Very limited visibility.', true, 4);
  }

  // normals: how today compares with the season
  const vs = (k, f, nrm, word) => {
    if (f == null || nrm == null) return;
    const d = Math.round(f - nrm);
    put(k, Math.abs(d) <= 1 ? 'Right on normal' : `${Math.abs(d)}° ${d > 0 ? 'above' : 'below'}`, `Today's ${word} is ${temp(f)}.`);
  };
  if (data.normals?.hi != null) vs('Normal high', d0?.hi, data.normals.hi, 'high');
  if (data.normals?.lo != null) vs('Normal low', d0?.lo, data.normals.lo, 'low');

  return notes;
}

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
      `hPa${data.elevation != null ? ' · ' + Math.round(data.elevation) + ' m elevation' : ''}`);
  add('Dew point', c.dewpoint != null ? temp(c.dewpoint) : null);
  add('UV index', c.uv != null ? Math.round(c.uv) : null,
      data.daily?.[0]?.uv != null ? `Peak ${Math.round(data.daily[0].uv)} today` : '');
  add('Visibility', c.visibility != null ? c.visibility.toFixed(c.visibility < 10 ? 1 : 0) : null, 'km');

  if (data.normals?.hi != null) add('Normal high', temp(data.normals.hi));
  if (data.normals?.lo != null) add('Normal low', temp(data.normals.lo));

  if (!tiles.length) return '';
  const notes = detailNotes(data);
  const body = `<div class="grid">${tiles.map((t) => {
    const n = notes[t.k] ?? (t.k === c.feelsLabel ? notes['Feels like'] : null);
    const dot = n?.dot != null ? `<i class="au-dot" style="background:${SCALE_DOT[n.dot]}"></i>` : '';
    return `<div class="tile${n?.warn ? ' warn' : n?.dot === 1 || n?.dot === 2 ? ' mid' : ''}"><div class="k">${esc(t.k)}</div><div class="v">${esc(t.v)}</div>${
      t.s ? `<div class="s">${dot}${esc(t.s)}</div>` : ''}${
      n?.h ? `<div class="h">${t.s ? '' : dot}${esc(n.h)}</div>` : ''}${n?.n ? `<div class="n">${esc(n.n)}</div>` : ''}</div>`;
  }).join('')}</div>`;
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
    ? `<div class="s" style="margin-top:8px;color:var(--on-surface-var);font-size:.78rem">${esc(a.station)}${a.time ? ` · ${timeLabel(a.time, data.tz)}` : ''}</div>`
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
        <div class="s" style="font-size:.75rem;color:var(--on-surface-var)">${isAqhi ? 'Canada AQHI · 1–10+' : 'US AQI'}</div>
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

/* ── aurora ───────────────────────────────────────── */
/* NOAA's aurora forecast made local: the OVATION grid at and poleward of the
   place for right now, the Kp forecast against the place's geomagnetic
   latitude for the nights ahead, and then the things that decide whether you
   would actually see it from here — darkness, the moon and the cloud. */
const CLOUD_OF = {
  clear: 5, mainlyclear: 20, partly: 45, haze: 30, smoke: 40, wind: 40,
};
const cloudAt = (h) => h?.cloud ?? CLOUD_OF[h?.condition] ?? 90;

const sunAltAt = (d, lat, lon) => { const n = days2000(d); return skyPos(sunEq(n), n, lat, lon).alt / DEG; };
const moonAltAt = (d, lat, lon) => { const n = days2000(d); return skyPos(moonEq(n), n, lat, lon).alt / DEG; };
const DARK = -12;           // nautical twilight: below this a display can show

function nearestHour(hourly, t) {
  let best = null, bd = Infinity;
  for (const h of hourly ?? []) {
    const d = Math.abs(h.time - t);
    if (d < bd) { bd = d; best = h; }
  }
  return bd <= 90 * 60e3 ? best : null;
}

/* The dark stretches over the next three days, each with the strongest Kp
   forecast inside it and the average cloud where the hourly forecast reaches. */
function auroraNights(data, lat, lon, kp) {
  const nights = [];
  const start = new Date(); start.setMinutes(0, 0, 0);
  let cur = null;
  for (let i = 0; i <= 80; i++) {
    const t = new Date(start.getTime() + i * 3600e3);
    const dark = sunAltAt(t, lat, lon) < DARK;
    if (dark && !cur) cur = { from: t, hours: [] };
    if (dark) cur.hours.push(t);
    if ((!dark || i === 80) && cur) { nights.push(cur); cur = null; if (nights.length === 3) break; }
  }
  for (const n of nights) {
    n.to = n.hours[n.hours.length - 1];
    const blocks = kp.filter((k) => k.time.getTime() + 3 * 3600e3 > n.from.getTime() && k.time <= n.to);
    n.kp = blocks.length ? Math.max(...blocks.map((k) => k.kp)) : null;
    const clouds = n.hours.map((t) => nearestHour(data.cloudHours ?? data.hourly, t)).filter(Boolean).map(cloudAt);
    n.cloud = clouds.length >= Math.min(3, n.hours.length) ? Math.round(clouds.reduce((a, b) => a + b, 0) / clouds.length) : null;
    const mid = n.hours[Math.floor(n.hours.length / 2)];
    n.moonUp = n.hours.filter((t) => moonAltAt(t, lat, lon) > 0).length / n.hours.length;
    n.moonLit = moonPhase(mid).illum;
  }
  return nights;
}

/* What a Kp number means, in NOAA's own storm scale words. */
const KP_WORDS = [[3, 'Quiet'], [4, 'Unsettled'], [5, 'Active'], [6, 'Minor storm'],
  [7, 'Moderate storm'], [8, 'Strong storm'], [9, 'Severe storm'], [Infinity, 'Extreme storm']];
const kpWord = (kp) => KP_WORDS.find(([t]) => kp < t)[1];
const KP_GRAD = 'linear-gradient(90deg, #3ec46d 0%, #3ec46d 25%, #f7c948 47%, #f5a623 58%, #f2704b 70%, #d9434f 82%, #7d3550 100%)';
const KP_DOT = (kp) => kp < 4 ? '#3ec46d' : kp < 5 ? '#f7c948' : kp < 6 ? '#f5a623' : kp < 7 ? '#f2704b' : kp < 8 ? '#d9434f' : '#7d3550';
const kpFmt = (kp) => kp.toFixed(kp % 1 ? 1 : 0);

/* Kp 0–9 as a gradient, quiet to extreme, with a line at the forecast for
   right now. Underneath, where this place sits on it: from which Kp the
   aurora shows low on the horizon, and from which it is overhead — the part
   a bare number never tells you. */
function kpScale(kpNow, m, dir) {
  const pct = (kp) => `${(Math.max(0, Math.min(9, kp)) / 9 * 100).toFixed(1)}%`;
  const kpOver = (66.5 - m) / 2.05;
  const kpLow = (66.5 - HORIZON_REACH - m) / 2.05;
  const up = (k) => kpFmt(Math.ceil(Math.max(0, k) * 10) / 10);
  let here;
  if (kpOver <= 0) here = 'Here, even a quiet night can put the aurora overhead.';
  else if (kpOver > 9) here = kpLow <= 9
    ? `Here it takes Kp ${up(kpLow)}+ to see it low to the ${dir}.`
    : 'This far south only an extreme storm reaches you.';
  else if (kpLow <= 0.5) here = `Here any activity can show low to the ${dir}; Kp ${up(kpOver)}+ puts it overhead.`;
  else here = `Here: Kp ${up(kpLow)}+ to see it low to the ${dir}, Kp ${up(kpOver)}+ for overhead.`;
  const line = kpNow != null ? `
        <i class="au-line" style="left:${pct(kpNow)}"></i>
        <b class="au-linelbl" style="left:${pct(kpNow)};transform:translateX(${kpNow < 2 ? '-10%' : kpNow > 7 ? '-90%' : '-50%'})">Now · Kp ${kpFmt(kpNow)} ${kpWord(kpNow).toLowerCase()}</b>` : '';
  return `
    <div class="au-scale">
      <div class="au-bar" style="background:${KP_GRAD}">${line}</div>
      <div class="au-ticks"><span>Low · quiet</span><span>Storm</span><span>High · extreme</span></div>
      <p class="au-here">${esc(here)}</p>
    </div>`;
}

function nightVerdict(n, m) {
  if (n.kp == null) return { label: 'No forecast', tone: 0 };
  const edge = ovalEdge(n.kp);
  if (m >= edge) return { label: 'Overhead', tone: 3 };
  if (m >= edge - HORIZON_REACH / 2) return { label: 'Likely to the ' + n.dir, tone: 2 };
  if (m >= edge - HORIZON_REACH) return { label: 'Low to the ' + n.dir, tone: 1 };
  return { label: 'Unlikely', tone: 0 };
}

export function auroraCard(data) {
  const { lat, lon } = data.coords ?? {};
  if (lat == null) return '';
  const m = Math.abs(magLat(lat, lon));
  const a = data.aurora;
  const dir = lat >= 0 ? 'north' : 'south';
  const always = m >= 55;        // aurora country: the card earns its place every night

  if (!a) {
    return always ? card('Aurora', G.aurora, '<div class="skel" style="height:120px;border-radius:14px;background:var(--surface-2)"></div>') : '';
  }

  const nights = auroraNights(data, lat, lon, a.kp ?? []);
  for (const n of nights) { n.dir = dir; n.v = nightVerdict(n, m); }
  const now = localChance(a.ovation, lat, lon);

  const tNow = new Date();
  const darkNow = sunAltAt(tNow, lat, lon) < DARK;
  const hNow = nearestHour(data.cloudHours ?? data.hourly, tNow);
  const cloudNow = hNow ? cloudAt(hNow) : null;

  const interesting = (now?.chance ?? 0) >= 5 || nights.some((n) => n.v.tone >= 1);
  if (!always && !interesting) return '';

  /* Right now: the forecast chance, then what stands in the way of it. */
  const ch = now?.chance ?? null;
  let label, why;
  if (ch == null) { label = 'No live forecast'; why = 'NOAA\'s 30-minute forecast didn\'t load.'; }
  else {
    label = ch >= 50 ? 'Good chance' : ch >= 20 ? 'Possible' : ch >= 5 ? 'Slight chance' : 'Unlikely';
    const bits = [];
    if (!darkNow) {
      const first = nights[0]?.from;
      bits.push(first ? `Dark enough from ${timeLabel(first, data.tz)}` : 'Not dark enough tonight');
    }
    if (now.overhead >= 5) bits.push('Aurora overhead');
    else if (ch >= 5) bits.push(`Aurora to the ${dir}`);
    if (cloudNow != null) bits.push(cloudNow >= 70 ? `Cloudy (${cloudNow}%)` : `${cloudNow}% cloud`);
    const mp = moonPhase();
    if (darkNow && mp.illum > 0.6 && moonAltAt(tNow, lat, lon) > 0) bits.push('Bright moon up');
    why = bits.join(' · ');
    if (ch >= 5 && !darkNow) label = `${label} · not dark yet`;
    else if (ch >= 5 && (cloudNow ?? 0) >= 80) label = `${label} · but cloudy`;
  }

  const day = (n, i) => {
    if (i === 0 && n.from <= tNow) return 'Tonight';
    return i === 0 && n.from - tNow < 18 * 3600e3 ? 'Tonight' : dayLabel(n.from, data.tz);
  };
  const cols = nights.map((n, i) => `
    <div class="au-night t${n.v.tone}">
      <b>${day(n, i)}</b>
      <span class="au-kp">${n.kp != null
        ? `<i class="au-dot" style="background:${KP_DOT(n.kp)}"></i>Kp ${kpFmt(n.kp)} · ${kpWord(n.kp)}`
        : 'Kp –'}</span>
      <span class="au-v">${esc(n.v.label)}</span>
      <span class="au-s${n.cloud >= 80 ? ' cloudy' : ''}">${n.cloud != null ? (n.cloud >= 80 ? `Cloudy · ${n.cloud}%` : `${n.cloud}% cloud`) : 'Cloud n/a'}${
        n.moonUp > 0.4 && n.moonLit > 0.5 ? ' · moon' : ''}</span>
    </div>`).join('');

  const upd = a.ovation ? timeLabel(a.ovation.forecast, data.tz) : null;
  // the 3-hour Kp block we are in now, else the next one forecast
  const kpRow = (a.kp ?? []).find((k) => k.time <= tNow && tNow - k.time < 3 * 3600e3)
    ?? (a.kp ?? []).find((k) => k.time > tNow);
  const kpNow = kpRow?.kp ?? null;
  return card('Aurora', G.aurora, `
    <div class="au-now">
      <div class="au-val">${ch != null ? `${ch}<small>%</small>` : '–'}</div>
      <div class="au-txt"><b>${esc(label)}</b><span>${esc(why)}</span></div>
    </div>
    <div class="au-nights">${cols}</div>
    <button class="au-map" data-open-radar="aurora">See it on the map</button>
    ${kpScale(kpNow, m, dir)}
    <p class="au-src">NOAA Space Weather Prediction Center${upd ? ` · forecast for ${upd}` : ''} · geomagnetic latitude ${Math.round(m)}°</p>`);
}

/* ── historical ───────────────────────────────────── */
/* Same column-and-chart shape as the daily panel, so a fortnight of the past
   reads the way the week ahead does. Fourteen columns rather than seven, which
   is why it scrolls: today sits in the middle with a week either side. */
export function historyCard(data, opts = {}) {
  measure();
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
  const padT = Math.round(FS * 1.7), padB = Math.round(FS * 1.7);
  const y = (v) => padT + (1 - (v - min) / span) * (CHART_H - padT - padB);
  const x = (i) => i * COL + COL / 2;

  const line = (key, dy, cls) => {
    const pts = days.map((d, i) => (d[key] == null ? null : `${x(i)},${y(d[key]).toFixed(1)}`))
                    .filter(Boolean).join(' ');
    if (!pts) return '';
    const labels = days.map((d, i) => d[key] == null ? '' :
      `<text x="${x(i)}" y="${(y(d[key]) + dy).toFixed(1)}" text-anchor="middle"
         font-size="${FS}" font-weight="600" fill="currentColor">${esc(temp(d[key]))}</text>`).join('');
    return `<polyline points="${pts}" fill="none" stroke="var(--on-surface-var)" stroke-width="2.5"
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
          ${line('hi', -Math.round(FS * 0.65), 'dp-hi')}
          ${line('lo', Math.round(FS * 1.25), 'dp-lo')}
        </svg>
        <div class="dp-row hist-feet">${feet}</div>
      </div>
    </div>
    ${monthlyChart(h)}`);
}

/* The chosen year month by month against this year: mean high and low as two
   curves, precipitation as paired bars with the millimetres written on them.
   Twelve columns wide enough to carry numbers means it scrolls, like the daily
   panel — the alternative was a chart that fits but says nothing. The chosen
   year is the labelled one; this year is drawn behind it for shape, since a
   dozen extra numbers would bury the twelve you came for. */
function monthlyChart(h) {
  const past = h.monthlyPast ?? [], now = h.monthlyNow ?? [];
  const tp = h.monthlyTempPast ?? { hi: [], lo: [] }, tn = h.monthlyTempNow ?? { hi: [], lo: [] };
  if (!past.some((v) => v != null) && !now.some((v) => v != null)) return '';

  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MC = 64;                                  // px per month column
  const W = 12 * MC;
  const x = (i) => i * MC + MC / 2;

  /* ── temperature: mean high and low ── */
  const temps = [...tp.hi, ...tp.lo, ...tn.hi, ...tn.lo].filter((v) => v != null);
  let tempSvg = '';
  if (temps.length) {
    const TH = 104, padT = 22, padB = 22;
    const max = Math.max(...temps), min = Math.min(...temps);
    const span = Math.max(max - min, 1);
    const y = (v) => padT + (1 - (v - min) / span) * (TH - padT - padB);

    const path = (arr) => arr.map((v, i) => (v == null ? null : `${x(i)},${y(v).toFixed(1)}`))
                             .filter(Boolean).join(' ');
    const line = (arr, cls, extra = '') => {
      const pts = path(arr);
      return pts ? `<polyline points="${pts}" fill="none" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${extra}/>` : '';
    };
    /* Label this year's months; the months it hasn't reached yet fall back to
       last year's value, in the comparison grey. */
    const labels = (now, past, dy) => M.map((_, i) => {
      const v = now[i] ?? past[i];
      if (v == null) return '';
      const fill = now[i] != null ? 'currentColor' : 'var(--on-surface-var)';
      return `<text x="${x(i)}" y="${(y(v) + dy).toFixed(1)}" text-anchor="middle"
         font-size="12.5" font-weight="600" fill="${fill}">${esc(temp(v))}</text>`;
    }).join('');

    tempSvg = `<svg class="dp-chart" width="${W}" height="${TH}" viewBox="0 0 ${W} ${TH}">
        ${line(tp.hi, 'mo-line-past', 'stroke-dasharray="2 5"')}
        ${line(tp.lo, 'mo-line-past', 'stroke-dasharray="2 5"')}
        ${line(tn.hi, 'mo-line-now')}
        ${line(tn.lo, 'mo-line-now dp-lo')}
        ${labels(tn.hi, tp.hi, -8)}${labels(tn.lo, tp.lo, 16)}
      </svg>`;
  }

  /* ── precipitation: paired bars, each with its total ── */
  const peak = Math.max(1, ...past.filter((v) => v != null), ...now.filter((v) => v != null));
  const BH = 92, base = BH - 6, top = 18;
  const mm = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
  const bars = M.map((_, i) => {
    const bar = (v, dx, cls) => {
      if (v == null) return '';
      const hgt = Math.max(v > 0 ? 2 : 0, (v / peak) * (base - top));
      const cx = x(i) + dx;
      return `<rect x="${(cx - 7).toFixed(1)}" y="${(base - hgt).toFixed(1)}"
          width="14" height="${hgt.toFixed(1)}" rx="3" class="${cls}"/>
        <text x="${cx}" y="${(base - hgt - 5).toFixed(1)}" text-anchor="middle"
          font-size="10" font-weight="700" class="${cls}-txt">${mm(v)}</text>`;
    };
    return bar(now[i], -9, 'mo-now') + bar(past[i], 9, 'mo-past');
  }).join('');
  const barSvg = `<svg class="dp-chart" width="${W}" height="${BH}" viewBox="0 0 ${W} ${BH}">${bars}</svg>`;

  const heads = M.map((m) => `<div class="dp-col mo-col"><b>${m}</b></div>`).join('');

  const total = (a) => { const v = a.filter((x) => x != null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0)) : null; };
  const tPast = total(past), tNow = total(now);

  return `
    <div class="mo-wrap">
      <div class="mo-key">
        <span><i class="mo-sw mo-now"></i>${h.nowYear}${tNow != null ? ` · ${tNow} mm` : ''}</span>
        <span><i class="mo-sw mo-past"></i>${h.year}${tPast != null ? ` · ${tPast} mm` : ''}</span>
      </div>
      <div class="dp-scroll">
        <div style="width:${W}px">
          <div class="dp-row">${heads}</div>
          ${tempSvg}
          ${barSvg}
        </div>
      </div>
      <p class="mo-note">Mean daily high and low, and total precipitation in mm, for each
        month of ${h.nowYear}, with ${h.year} dotted behind for comparison. ${h.nowYear} runs to
        the last few days: reanalysis lags real time, so the current month is partial.</p>
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
  aurora:  { label: 'Aurora',               fn: auroraCard },
  history: { label: 'Historical',           fn: (d, o) => historyCard(d, o) },
};

/* Daily leads: with the shortened hero it is the card already on screen when a
   location opens, which is the one worth seeing first. */
export const DEFAULT_ORDER = ['daily', 'hourly', 'radar', 'details', 'air', 'sun', 'aurora', 'history'];

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

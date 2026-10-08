/* Breezy PWA — main controller. */

import { state, set, save, addPlace, removePlace, activePlace, cacheWeather, readCache } from './store.js';
import { loadWeather } from './sources/index.js';
import { geocode, flagOf } from './sources/openmeteo.js';
import { icon, sky, fxKind, TINTS, PALETTES, accentFor, paletteRoles } from './icons.js';
import { startFx, stopFx } from './fx.js';
import { createRadar } from './radar.js';
import { fetchHistory } from './sources/history.js';
import { renderCards, alertsMarkup, temp, timeLabel, CARDS, DEFAULT_ORDER, normalizeOrder } from './render.js';
import { publishWidget } from './native.js';
import { fetchAurora, auroraCached, localChance } from './aurora.js';
import { headsUp } from './headsup.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let current = null;      // last rendered payload
let busy = false;

/* ── toast ────────────────────────────────────────── */
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

/* ── panels ───────────────────────────────────────── */
function openPanel(id) {
  $$('.panel').forEach((p) => p.classList.toggle('on', p.id === id));
  $('#scrim').classList.add('on');
  document.body.style.overflow = 'hidden';
}
function closePanels() {
  $$('.panel').forEach((p) => p.classList.remove('on'));
  $('#scrim').classList.remove('on');
  document.body.style.overflow = '';
}

/* ── historical ───────────────────────────────────── */
/* Fetched after the forecast is already on screen rather than blocking it:
   nobody opens a weather app for 1976. The card paints a placeholder, this
   fills it in, and the result is cached per place and span so flipping between
   spans is instant on the second visit. */
let histBusy = null;
const histCache = new Map();

async function loadHistory(place) {
  if (!place) return;
  const years = state.historyYears;
  const key = `${place.id}|${years}`;

  /* Only repaint when this is genuinely new. paint() calls loadHistory(), so
     repainting on every cache hit meant paint -> loadHistory -> repaint ->
     paint, recursing until the main thread was wedged. The symptom was not an
     error but a stall: renders caught half-finished, and a deck showing two
     cards because the loop re-entered before the rest had been appended. */
  if (histCache.has(key)) {
    const hit = histCache.get(key);
    if (current && current.history !== hit) {
      current.history = hit;
      repaintCard();
    }
    return;
  }
  if (histBusy === key) return;
  histBusy = key;
  try {
    const h = await fetchHistory(place.lat, place.lon, years);
    histCache.set(key, h);
    if (current && state.historyYears === years && activePlace()?.id === place.id) {
      current.history = h;
      repaintCard('history');
    }
  } catch (e) {
    console.warn('history failed', e);
  } finally { if (histBusy === key) histBusy = null; }
}

/* ── aurora ───────────────────────────────────────── */
/* One global forecast, not per place, fetched after the page is up like the
   historical card. Repaint only when a new forecast actually arrives, for the
   same reason loadHistory is careful about it. */
/* What the sky animation needs to choose its seasonal extras. */
function fxOpts(data) {
  const c = data?.current ?? {}, ll = data?.coords;
  const a = auroraCached();
  return {
    condition: c.condition, night: !!c.night, temp: c.temp, month: new Date().getMonth() + 1,
    lat: ll?.lat, aurora: a?.ovation && ll ? localChance(a.ovation, ll.lat, ll.lon)?.chance ?? 0 : 0,
  };
}
const runFx = () => current && startFx($('#fx'), fxKind(current.current.condition), state.fx === 'on', fxOpts(current));

function paintHeadsUp(data) {
  const el = $('#hero-quote');
  if (!el) return;
  let lines = [];
  try { lines = headsUp(data); } catch (e) { console.warn('heads-up failed', e); }
  el.innerHTML = lines.map((t, i) => `<span class="${i ? 'hq-2' : 'hq-1'}">${t.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch])}</span>`).join('');
  el.hidden = !lines.length;
}

async function loadAurora() {
  const before = auroraCached();
  try {
    const a = await fetchAurora();
    if (a !== before && current) { current.aurora = a; repaintCard(); paintHeadsUp(current); if (!radar) runFx(); }
  } catch (e) { console.warn('aurora failed', e); }
}

/* Park the historical strip so the matching day sits in the middle, leaving
   room to scroll into the weeks either side of it. */
function centreHistoryScroll() {
  const box = $('[data-hist-scroll]');
  if (!box) return;
  const cols = box.querySelectorAll('.dp-row .dp-col');
  const i = Number(box.dataset.centre || 0);
  const col = cols[i];
  if (!col) return;
  box.scrollLeft = Math.max(0, col.offsetLeft + col.offsetWidth / 2 - box.clientWidth / 2);
}

/* Park the daily strip with today in the first column. The recorded week sits
   to the left of it, reachable by sliding back, but a forecast panel that opens
   on last Tuesday has its priorities wrong. */
function parkDailyScroll() {
  const box = $('[data-daily-scroll]');
  if (!box) return;
  const cols = box.querySelectorAll('.dp-row .dp-col');
  const col = cols[Number(box.dataset.start || 0)];
  // measured against the first column, not the box: the box has inner padding
  // that offsetLeft includes, which parked the strip 18px past today
  box.scrollLeft = col ? col.offsetLeft - cols[0].offsetLeft : 0;
}

/* Repaint the whole deck but hold the scroll position, so a card filling in
   underneath you doesn't move the page.
   The re-entrancy guard is belt and braces: paint() kicks off loadHistory(),
   which can call back here, and one wrong condition in that chain wedges the
   main thread rather than throwing anything you could see. */
let repainting = false;
function repaintCard() {
  if (!current || repainting) return;
  repainting = true;
  try {
    const y = window.scrollY;
    paint(current, activePlace());
    window.scrollTo(0, y);
  } finally { repainting = false; }
}

/* ── active alerts banner ─────────────────────────── */
function paintAlertBanner(data) {
  const bar = $('#alert-banner');
  const drop = $('#alert-drop');
  const alerts = data?.alerts ?? [];

  bar.hidden = !alerts.length;
  bar.setAttribute('aria-expanded', 'false');
  drop.hidden = true;
  drop.innerHTML = alerts.length ? alertsMarkup(data) : '';
  if (!alerts.length) return;

  const title = alerts[0].title.replace(/^\w/, (c) => c.toUpperCase());
  $('#alert-banner-text').textContent = alerts.length === 1
    ? title
    : `${alerts.length} active alerts`;
}

function closeAlerts() {
  $('#alert-drop').hidden = true;
  $('#alert-banner').setAttribute('aria-expanded', 'false');
}

function toggleAlerts() {
  const bar = $('#alert-banner');
  const drop = $('#alert-drop');
  if (!drop.innerHTML) return;
  const opening = drop.hidden;
  drop.hidden = !opening;
  bar.setAttribute('aria-expanded', String(opening));
}

/* ── location paging ──────────────────────────────── */
function renderDots() {
  const dots = $('#place-dots');
  if (!dots) return;
  const n = state.places.length;
  dots.innerHTML = n > 1
    ? state.places.map((p) => `<i class="${p.id === state.activeId ? 'on' : ''}"></i>`).join('')
    : '';
}

function stepPlace(dir) {
  if (state.places.length < 2) return;
  const i = state.places.findIndex((p) => p.id === state.activeId);
  const next = state.places[(i + dir + state.places.length) % state.places.length];
  if (!next) return;

  set('activeId', next.id);
  current = null;
  renderDots();

  // slide the hero the way the finger went, so the change reads directionally
  const hero = $('#hero');
  hero.classList.remove('slide-l', 'slide-r');
  void hero.offsetWidth;                     // restart the animation
  hero.classList.add(dir > 0 ? 'slide-l' : 'slide-r');

  renderSaved();
  refresh();
}

/* ── radar ────────────────────────────────────────── */
let radar = null;

function openRadar(focus = null) {
  const place = activePlace();
  if (!place || radar) return;
  closePanels();
  const host = $('#radar');
  host.classList.add('on');
  host.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  stopFx();                       // the sky canvas is hidden behind the map
  // push a history entry so the phone's back gesture closes the radar
  history.pushState({ radar: true }, '');
  radar = createRadar(host, { lat: place.lat, lon: place.lon, tz: place.tz, focus });
}

function closeRadar() {
  if (!radar) return;
  radar.destroy();
  radar = null;
  const host = $('#radar');
  host.classList.remove('on');
  host.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  // the radar panel can flip the renderer itself; keep Settings honest
  $$('#seg-radarrender button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.radarRender));
  runFx();
}

/* ── rendering ────────────────────────────────────── */

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function mixHex(hex, target, t) {
  const [r, g, b] = hexToRgb(hex), [R, G, B] = hexToRgb(target);
  const m = (a, z) => Math.round(a + (z - a) * t).toString(16).padStart(2, '0');
  return `#${m(r, R)}${m(g, G)}${m(b, B)}`;
}

/* The accent the cards, charts and controls use. A fixed tint from Settings,
   or with 'sky' the weather's own accent as before. The sky accent is tuned to
   sit on the dark hero gradient; reused as text inside a white card it drops
   to ~2:1 contrast, so a darkened variant is published alongside it and the
   stylesheet's media query chooses between them. */
function applyAccent() {
  const root = document.documentElement.style;
  const c = current?.current ?? {};
  const tint = accentFor(state.accent, c.condition, c.night);   // palettes follow the weather
  if (tint) {
    root.setProperty('--accent', tint.dark);
    root.setProperty('--accent-dark', tint.light);
  } else {
    const a = root.getPropertyValue('--sky-accent') || '#8ab4f8';
    root.setProperty('--accent', a);
    root.setProperty('--accent-dark', mixHex(a, '#0b2038', 0.55));
  }
  applyPaletteCards();
}

/* With a palette chosen, each colour has one job everywhere: a wash on the
   cards, highs and lows (their lines and their numbers), and a calm, medium
   and risky colour for the status words and percentages. The CSS reads
   these as variables with the accent as the fallback, so without a palette
   nothing changes. Written as a small stylesheet so both modes are covered. */
const ROLE_VARS = { hiLine: '--hi-line', hiText: '--hi-text', loLine: '--lo-line', loText: '--lo-text', calm: '--calm', mid: '--mid', risk: '--risk' };
function applyPaletteCards() {
  const r = paletteRoles(state.accent);
  let el = document.getElementById('pal-style');
  if (!r) { if (el) el.textContent = ''; return; }
  if (!el) { el = document.createElement('style'); el.id = 'pal-style'; document.head.append(el); }
  const vars = (mode) => Object.entries(ROLE_VARS).map(([k, v]) => `${v}:${r[k][mode]};`).join('');
  el.textContent = `:root{${vars('dark')}--pal-card:${r.card};--lo-op:.9;}
@media (prefers-color-scheme: light){:root{${vars('light')}}}
#cards > .card{background:color-mix(in srgb,var(--pal-card) 9%,var(--surface));}
#cards .tile{background:color-mix(in srgb,var(--pal-card) 16%,var(--surface-2));}
#cards .tile.warn{background:color-mix(in srgb,var(--risk) 16%,var(--surface-2));}`;
}

/* The palette's sky colour, deepened so white text still reads, blended
   into the weather's own gradient: strongest at the top, fading out. */
function paletteSky(g) {
  const r = paletteRoles(state.accent);
  if (!r) return g;
  const tone = mixHex(r.sky, '#0b1530', 0.35);
  return g.map((c, i) => mixHex(c, tone, [0.55, 0.42, 0.3][i]));
}

function paint(data, place, stale = false) {
  current = data;
  const c = data.current;

  const { g: weatherSky, accent } = sky(c.condition, c.night);
  const g = paletteSky(weatherSky);
  const root = document.documentElement.style;
  root.setProperty('--sky-1', g[0]);
  root.setProperty('--sky-2', g[1]);
  root.setProperty('--sky-3', g[2]);
  root.setProperty('--sky-accent', accent);
  applyAccent();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', g[0]);

  $('#place-name').textContent = place.name;
  const bits = [];
  if (data.place && data.place !== place.name) bits.push(data.place);
  /* ECCC stamps its data with when it was issued, which only moves when ECCC
     publishes (roughly hourly), so a successful refresh could look like it
     did nothing. Show when the app last checked, and the issue time beside it
     when that is meaningfully older. */
  const checked = data.checked ? new Date(data.checked) : null;
  const issued = data.updated ? new Date(data.updated) : null;
  if (stale) bits.push(`Offline · ${timeLabel(issued, place.tz)}`);
  else if (checked && issued && checked - issued > 5 * 60e3) bits.push(`Checked ${timeLabel(checked, place.tz)} · ${data.source?.short ?? 'data'} from ${timeLabel(issued, place.tz)}`);
  else bits.push(`Updated ${timeLabel(checked ?? issued, place.tz)}`);
  $('#place-sub').textContent = bits.join(' · ');

  renderDots();
  paintAlertBanner(data);
  $('#hero-icon').innerHTML = icon(c.condition, c.night);
  $('#hero-temp').innerHTML = `${temp(c.temp, false)}<span class="deg">°</span>`;
  $('#hero-cond').textContent = c.text || '—';

  /* Assemble only the parts that exist. Opened in the evening, ECCC's first
     forecast block is "Tonight", which carries a low but no daytime high —
     rendering that as "H --°" looks broken rather than simply absent. */
  const d0 = data.daily?.[0];
  const range = [];
  if (d0?.hi != null) range.push(`H ${temp(d0.hi)}`);
  if (d0?.lo != null) range.push(`L ${temp(d0.lo)}`);
  if (c.feelsLike != null) range.push(`${c.feelsLabel} ${temp(c.feelsLike)}`);
  $('#hero-range').textContent = range.join('  ·  ');

  data.tz = place.tz;
  data.coords = { lat: place.lat, lon: place.lon };
  data.aurora = auroraCached();
  $('#cards').innerHTML = renderCards(data, {
    dailyMode: state.dailyMode,
    historyYears: state.historyYears,
    order: state.order ?? DEFAULT_ORDER,
  });
  loadHistory(place);
  loadAurora();
  parkDailyScroll();
  centreHistoryScroll();

  const srcBits = [data.source.name];
  if (data.supplement) srcBits.push(`+ ${data.supplement}`);
  $('#source-line').textContent = `Data from ${srcBits.join(' ')}`;

  paintHeadsUp(data);
  startFx($('#fx'), fxKind(c.condition), state.fx === 'on', fxOpts(data));

  /* The Home Screen widget shows the starred location, or whatever the app
     last painted when nothing is starred. */
  if (!stale && (!state.widgetPlaceId || state.widgetPlaceId === place.id)) publishWidget(data, place);
}

/* Keep a starred location's widget current even while a different location is
   open in the app: reuse its cached forecast when that is under half an hour
   old, otherwise fetch it quietly. Never touches what is on screen. */
/* Runs on the same 15-minute clock as the app's own refresh, and only when the
   starred place's forecast is older than that — so pinning a location costs
   one extra fetch per refresh cycle, never one per swipe. */
let widgetBusy = false;
async function refreshWidgetPlace(force = false) {
  const id = state.widgetPlaceId;
  if (!id) { if (current) publishWidget(current, activePlace(), { force }); return; }
  const place = state.places.find((p) => p.id === id);
  if (!place || widgetBusy) return;
  if (current && activePlace()?.id === id) { publishWidget(current, place, { force }); return; }
  const cached = readCache(id, 15 * 60e3);
  if (cached && !force) { publishWidget(cached.data, place); return; }
  if (cached && force) { publishWidget(cached.data, place, { force: true }); return; }
  widgetBusy = true;
  try {
    const data = await loadWeather(place, state.source);
    cacheWeather(id, data);
    publishWidget(data, place);
  } catch (e) { console.warn('widget place refresh failed', e); }
  finally { widgetBusy = false; }
}

function skeleton(place) {
  $('#place-name').textContent = place?.name ?? 'Breezy';
  $('#place-sub').textContent = 'Fetching forecast…';
  $('#hero-temp').innerHTML = `--<span class="deg">°</span>`;
  $('#hero-cond').textContent = '';
  $('#hero-range').textContent = '';
  $('#cards').innerHTML = `<section class="card skel" style="height:150px"></section>
                           <section class="card skel" style="height:250px"></section>`;
}

/* ── data flow ────────────────────────────────────── */
async function refresh({ silent = false, force = false } = {}) {
  const place = activePlace();
  if (!place) { showEmpty(); return; }
  if (busy) return;
  busy = true;

  // an explicit refresh should go to the network, not repaint the cache
  const cached = force ? null : readCache(place.id);
  if (cached && !current) paint(cached.data, place, true);
  else if (!silent && !current) skeleton(place);

  try {
    const data = await loadWeather(place, state.source);
    cacheWeather(place.id, data);
    paint(data, place, false);
    return true;
  } catch (e) {
    console.error(e);
    if (cached) {
      paint(cached.data, place, true);
      toast('Offline — showing saved forecast');
    } else {
      $('#place-sub').textContent = 'Could not load forecast';
      $('#cards').innerHTML = `<section class="card"><p style="margin:0;color:var(--on-surface-var)">
        ${e.message || 'Network error'}. Pull down or tap the location button to retry.</p></section>`;
      toast('Could not reach the weather service');
    }
  } finally {
    busy = false;
  }
}

function showEmpty() {
  $('#place-name').textContent = 'Breezy';
  $('#place-sub').textContent = 'Add a location to begin';
  $('#hero-temp').innerHTML = `--<span class="deg">°</span>`;
  $('#cards').innerHTML = `<section class="card"><p style="margin:0 0 14px;color:var(--on-surface-var)">
    No location yet. Search for a city or use your current position.</p>
    <button class="pill" id="empty-add">Add a location</button></section>`;
  $('#empty-add')?.addEventListener('click', () => openPanel('panel-places'));
  openPanel('panel-places');
}

/* ── locations ────────────────────────────────────── */
function renderSaved() {
  const list = $('#saved-list');
  if (!state.places.length) { list.innerHTML = `<p class="empty">Nothing saved yet.</p>`; return; }
  list.innerHTML = state.places.map((p) => {
    const wx = readCache(p.id, 24 * 3600e3);
    const t = wx?.data?.current?.temp;
    const active = p.id === state.activeId;
    const starred = p.id === state.widgetPlaceId;
    return `<div class="res${active ? ' active' : ''}" data-place="${p.id}">
      <span class="flag">${p.current ? '📍' : flagOf(p.cc)}</span>
      <span class="rn"><b>${p.name}</b><span>${p.admin ?? ''}</span></span>
      <span class="rt">${t != null ? temp(t) : ''}</span>
      <button class="star${starred ? ' on' : ''}" data-star="${p.id}" aria-label="${starred ? 'Widget follows this location' : 'Show this location on the widget'}" title="Widget location">
        <svg viewBox="0 0 24 24"><path d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z"/></svg>
      </button>
      <button class="del" data-del="${p.id}" aria-label="Delete ${p.name}" title="Delete">
        <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
      </button>
    </div>`;
  }).join('');
}

/* ── settings: card order ─────────────────────────── */
function renderOrder() {
  const box = $('#order-list');
  if (!box) return;
  const order = normalizeOrder(state.order ?? DEFAULT_ORDER);
  box.innerHTML = order.map((k, i) => `
    <div class="ord" data-key="${k}">
      <span class="ord-name">${CARDS[k].label}</span>
      <button class="ord-btn" data-move="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">
        <svg viewBox="0 0 24 24"><path d="M12 8l6 6H6z"/></svg>
      </button>
      <button class="ord-btn" data-move="down" data-i="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Move down">
        <svg viewBox="0 0 24 24"><path d="M12 16l-6-6h12z"/></svg>
      </button>
    </div>`).join('');
}

function moveCard(i, dir) {
  const order = normalizeOrder(state.order ?? DEFAULT_ORDER);
  const j = i + (dir === 'up' ? -1 : 1);
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  set('order', order);
  renderOrder();
  if (current) {
    const y = window.scrollY;
    paint(current, activePlace());
    window.scrollTo(0, y);
  }
}

let searchTimer;
function onSearch(e) {
  const q = e.target.value;
  clearTimeout(searchTimer);
  if (q.trim().length < 2) { $('#search-results').innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    try {
      const res = await geocode(q);
      $('#search-results').innerHTML = res.length
        ? res.map((r) => `<button class="res" data-add='${JSON.stringify(r).replace(/'/g, '&#39;')}'>
            <span class="flag">${flagOf(r.cc)}</span>
            <span class="rn"><b>${r.name}</b><span>${r.admin}</span></span></button>`).join('')
        : `<p class="empty">No matches.</p>`;
    } catch {
      $('#search-results').innerHTML = `<p class="empty">Search unavailable offline.</p>`;
    }
  }, 300);
}

function useMyLocation() {
  if (!navigator.geolocation) { toast('Geolocation not supported'); return; }
  toast('Locating…', 8000);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      addPlace({
        id: 'here',
        name: 'My location',
        admin: `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
        cc: '', lat, lon,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        current: true,
      });
      current = null;
      closePanels();
      renderSaved();
      refresh();
      toast('Location set');
    },
    (err) => toast(err.code === 1 ? 'Location permission denied' : 'Could not get location'),
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 },
  );
}

/* ── events ───────────────────────────────────────── */
function wire() {
  $('#btn-places').addEventListener('click', () => { renderSaved(); openPanel('panel-places'); });
  $('#btn-settings').addEventListener('click', () => openPanel('panel-settings'));
  $('#scrim').addEventListener('click', closePanels);
  $$('[data-close]').forEach((b) => b.addEventListener('click', closePanels));

  $('#search-input').addEventListener('input', onSearch);
  $('#btn-locate').addEventListener('click', useMyLocation);

  $('#search-results').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const p = JSON.parse(btn.dataset.add);
    const isNew = !state.places.some((x) => x.id === p.id);
    addPlace(p);
    current = null;
    $('#search-input').value = '';
    $('#search-results').innerHTML = '';
    closePanels();
    renderSaved();
    toast(isNew ? `Saved ${p.name}` : `Switched to ${p.name}`);
    refresh();
  });

  $('#saved-list').addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      e.stopPropagation();
      const id = star.dataset.star;
      const was = state.widgetPlaceId === id;
      set('widgetPlaceId', was ? null : id);
      renderSaved();
      const name = state.places.find((p) => p.id === id)?.name ?? 'location';
      toast(was ? 'Widgets follow whichever location is open' : `Widgets pinned to ${name}`);
      refreshWidgetPlace(true);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      const place = state.places.find((p) => p.id === id);
      // deleting a saved place is easy to hit by accident on a phone
      if (!window.confirm(`Delete ${place?.name ?? 'this location'}?`)) return;
      removePlace(id);
      renderSaved();
      current = null;
      toast(`Deleted ${place?.name ?? 'location'}`);
      if (state.places.length) refresh(); else showEmpty();
      return;
    }
    const row = e.target.closest('[data-place]');
    if (!row) return;
    set('activeId', row.dataset.place);
    current = null;
    closePanels();
    refresh();
  });

  // expandable alert text, daily series pills, radar launcher
  $('#cards').addEventListener('click', (e) => {
    const a = e.target.closest('.alert');
    if (a) { a.classList.toggle('open'); return; }

    const hy = e.target.closest('[data-history-years]');
    if (hy) {
      set('historyYears', Number(hy.dataset.historyYears));
      const p = activePlace();
      if (current) { current.history = histCache.get(`${p?.id}|${state.historyYears}`) ?? null; }
      repaintCard();
      loadHistory(p);
      return;
    }

    const pill = e.target.closest('[data-daily-mode]');
    if (pill) {
      set('dailyMode', pill.dataset.dailyMode);
      // repaint just the daily card so the page doesn't jump back to the top
      const scroll = window.scrollY;
      if (current) paint(current, activePlace());
      window.scrollTo(0, scroll);
      return;
    }

    const or = e.target.closest('[data-open-radar]');
    if (or) openRadar(or.dataset.openRadar || null);
  });

  $('#alert-banner').addEventListener('click', toggleAlerts);
  $('#alert-drop').addEventListener('click', (e) => {
    if (e.target.closest('[data-close-alerts]')) { closeAlerts(); return; }
    const a = e.target.closest('.alert');
    if (a) a.classList.toggle('open');
  });
  // tapping the sky behind it dismisses, like any other drop-down
  $('#hero').addEventListener('click', (e) => {
    if (!$('#alert-drop').hidden
        && !e.target.closest('#alert-drop')
        && !e.target.closest('#alert-banner')) closeAlerts();
  });
  $('#radar').addEventListener('radar-toast', (e) => toast(e.detail));
  window.addEventListener('breezy-toast', (e) => toast(e.detail, 4000));

  // route the close button through history so it matches the back gesture
  $('#radar').addEventListener('radar-close', () => {
    if (history.state?.radar) history.back(); else closeRadar();
  });
  window.addEventListener('popstate', closeRadar);

  // settings segments
  const seg = (id, key, after) => {
    const el = $(id);
    el.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === state[key]);
      b.addEventListener('click', () => {
        set(key, b.dataset.v);
        el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        after?.();
      });
    });
  };
  seg('#seg-unit', 'unit', () => current && paint(current, activePlace()));
  seg('#seg-wind', 'wind', () => current && paint(current, activePlace()));
  seg('#seg-source', 'source', () => { current = null; refresh(); });
  seg('#seg-fx', 'fx', runFx);
  seg('#seg-maptheme', 'mapTheme', () => { if (current) paint(current, activePlace()); });
  seg('#seg-radarrender', 'radarRender');
  seg('#seg-radardebug', 'radarDebug');
  seg('#seg-textsize', 'textSize', applyTextScale);
  $('#seg-accent').innerHTML = Object.entries(TINTS).map(([k, t]) => `
    <button data-v="${k}" role="radio" aria-label="${t.name}" title="${t.name}"
      style="--sw:${t.dark ?? 'conic-gradient(#FFC44D 0 25%, #8EC5F5 0 50%, #9BB8E8 0 75%, #BFE0F5 0)'}"></button>`).join('');
  $('#seg-palette').innerHTML = Object.entries(PALETTES).map(([k, p]) => `
    <button data-v="${k}" role="radio" aria-label="${p.name} palette" title="${p.name}"
      style="--sw:linear-gradient(90deg, ${p.colors.map((c, i, a) => `${c} ${i / a.length * 100}% ${(i + 1) / a.length * 100}%`).join(', ')})"></button>`).join('');
  const accentName = () => { $('#accent-name').textContent = TINTS[state.accent]?.name ?? (PALETTES[state.accent] ? `${PALETTES[state.accent].name} palette` : ''); };
  const markAccent = () => $$('#seg-accent button, #seg-palette button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === state.accent);
    b.setAttribute('aria-checked', b.dataset.v === state.accent);
  });
  accentName();
  const pickAccent = () => { accentName(); applyAccent(); markAccent(); refreshWidgetPlace(true); };
  seg('#seg-accent', 'accent', pickAccent);
  seg('#seg-palette', 'accent', pickAccent);
  markAccent();

  renderOrder();
  $('#order-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-move]');
    if (b && !b.disabled) moveCard(Number(b.dataset.i), b.dataset.move);
  });

  $('#scroll-cue').addEventListener('click', () =>
    $('#sheet').scrollIntoView({ behavior: 'smooth' }));

  // retire the hint as soon as it has served its purpose
  const cue = $('#scroll-cue');
  window.addEventListener('scroll', () => {
    cue.classList.toggle('gone', window.scrollY > 24);
  }, { passive: true });

  // refresh when the app comes back to the foreground
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && current && Date.now() - (current.checked ?? current.updated) > 10 * 60e3) { refresh({ silent: true }); refreshWidgetPlace(); }
  });

  /* Horizontal swipe on the hero pages between saved locations.
     Guarded so it can't hijack a vertical scroll, and ignored inside the
     hourly/daily strips and the radar, which have their own horizontal
     scrolling. */
  let sw = null;
  const SWIPE_X = 60;          // minimum horizontal travel
  const SWIPE_RATIO = 1.7;     // how much more horizontal than vertical

  window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { sw = null; return; }
    if (e.target.closest('.hourly-wrap, .dp-scroll, .dp-pills, .radar, .panel')) { sw = null; return; }
    const t = e.touches[0];
    sw = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    const s = sw;
    sw = null;
    if (!s || state.places.length < 2) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < SWIPE_X || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
    stepPlace(dx < 0 ? 1 : -1);   // swipe left -> next location
  }, { passive: true });

  /* Pull-to-refresh, deliberately hard to trigger by accident.
     The first version fired on any downward swipe past 110px while scrollY
     was 0, so simply scrolling back up to the hero re-fetched the forecast
     over and over. It now needs a long pull that both starts and ends pinned
     at the very top, with a cooldown so a flick can't chain refreshes. */
  /* iOS reports a NEGATIVE window.scrollY while rubber-banding at the top, so
     the previous `scrollY === 0` test rejected exactly the gesture it was
     meant to detect — the pull never fired on the phone. Treat anything at or
     above the top as the top. */
  const atTop = () => window.scrollY <= 0;
  const PULL_PX = 110;
  const PULL_COOLDOWN = 8000;
  let y0 = null, lastPull = 0;

  window.addEventListener('touchstart', (e) => {
    y0 = atTop() && e.touches.length === 1 ? e.touches[0].clientY : null;
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    const start = y0;
    y0 = null;
    if (start === null || !atTop()) return;
    if (e.changedTouches[0].clientY - start < PULL_PX) return;
    if (busy || Date.now() - lastPull < PULL_COOLDOWN) return;
    doRefresh();
  }, { passive: true });

  // tapping the "Updated …" line is the discoverable way to refresh
  $('#place-sub').addEventListener('click', doRefresh);

  function doRefresh() {
    if (busy) return;
    lastPull = Date.now();
    toast('Updating forecast…', 1400);
    refresh({ silent: true, force: true }).then((ok) => { if (ok) toast('Forecast up to date', 1400); });
  }
}

/* ── keyboard-aware viewport ──────────────────────── */
/* visualViewport is the only thing that knows where the keyboard is. Publish
   its geometry as CSS variables so fixed sheets can sit above the keys rather
   than under them. Also undo the page scroll iOS performs to reveal a focused
   field, since the sheet is what should move, not the page behind it. */
function trackViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const root = document.documentElement.style;
    root.setProperty('--kb', `${kb}px`);
    root.setProperty('--vv-h', `${Math.round(vv.height)}px`);
    document.body.classList.toggle('kb-open', kb > 60);
    if (kb > 60 && document.querySelector('.panel.on') && window.scrollY !== 0 && document.body.style.overflow === 'hidden') {
      window.scrollTo(0, 0);
    }
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}

/* ── text size ────────────────────────────────────── */
/* Follow the phone's Text Size. WebKit exposes Dynamic Type through the
   -apple-system-body font: at the default ("Large") setting it resolves to
   17px, at the smallest to 14px, at the largest accessibility size to 53px.
   Measuring it gives the factor the user asked for, which then scales the
   root font every rem in the stylesheet hangs off. Other browsers resolve
   the keyword to nothing useful and get a factor of 1. */
const TEXT_SIZES = { small: 0.88, normal: 1, large: 1.12 };

function dynamicTypeFactor() {
  try {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;font:-apple-system-body';
    probe.textContent = 'x';
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    if (!px || px < 8 || px > 80) return 1;
    // clamp: the largest accessibility sizes would push the hero off screen
    return Math.min(1.6, Math.max(0.75, px / 17));
  } catch { return 1; }
}

function applyTextScale() {
  const f = dynamicTypeFactor() * (TEXT_SIZES[state.textSize] ?? 1);
  document.documentElement.style.setProperty('--text-scale', f.toFixed(3));
}

/* ── boot ─────────────────────────────────────────── */
async function boot() {
  /* The daily panel's series persists while the app is open, since flipping
     between wind and UV should be cheap. But it resets on launch: opening the
     app to whichever chart you last poked at means the temperatures — the
     reason you opened a weather app — are a tap away rather than in front of
     you. Same reasoning as the radar opening on precipitation. */
  if (state.dailyMode !== 'conditions') set('dailyMode', 'conditions');

  applyTextScale();
  applyAccent();
  trackViewport();
  /* The charts are sized to the card width when painted. On iPad, rotating or
     resizing in Split View changes that width (and the number of card
     columns), so repaint once the size settles. */
  let lastW = window.innerWidth, rz = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (Math.abs(window.innerWidth - lastW) < 40) return;
      lastW = window.innerWidth;
      if (current) paint(current, activePlace());
    }, 250);
  });
  // iOS re-resolves system fonts when Text Size changes; re-measure on return
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyTextScale(); });

  wire();
  renderSaved();

  if (!state.places.length) showEmpty();
  else refresh();

  setInterval(() => { if (!document.hidden) { refresh({ silent: true }); refreshWidgetPlace(); } }, 15 * 60e3);
  refreshWidgetPlace();

  if ('serviceWorker' in navigator) {
    try {
      // updateViaCache: 'none' — sw.js is served with max-age=600 like
      // everything else on Pages, so without this the update check itself can
      // be answered from cache and a new worker goes unnoticed for ten minutes.
      const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      reg.update().catch(() => {});

      /* When a new worker takes over, the page is still running the old code it
         was loaded with. Reload once so the update actually applies on this
         launch rather than the next one — which on an installed PWA can be days
         away. The sessionStorage guard stops this becoming a reload loop. */
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (sessionStorage.getItem('breezy.swReloaded')) return;
        sessionStorage.setItem('breezy.swReloaded', '1');
        location.reload();
      });
    } catch (e) { console.warn('SW registration failed', e); }
  }
}

boot();

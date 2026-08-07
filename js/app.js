/* Breezy PWA — main controller. */

import { state, set, save, addPlace, removePlace, activePlace, cacheWeather, readCache } from './store.js';
import { loadWeather } from './sources/index.js';
import { geocode, flagOf } from './sources/openmeteo.js';
import { icon, sky, fxKind } from './icons.js';
import { startFx, stopFx } from './fx.js';
import { createRadar } from './radar.js';
import { renderCards, temp, timeLabel } from './render.js';

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

/* ── radar ────────────────────────────────────────── */
let radar = null;

function openRadar() {
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
  radar = createRadar(host, { lat: place.lat, lon: place.lon, tz: place.tz });
}

function closeRadar() {
  if (!radar) return;
  radar.destroy();
  radar = null;
  const host = $('#radar');
  host.classList.remove('on');
  host.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (current) startFx($('#fx'), fxKind(current.current.condition), state.fx === 'on');
}

/* ── rendering ────────────────────────────────────── */

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function mixHex(hex, target, t) {
  const [r, g, b] = hexToRgb(hex), [R, G, B] = hexToRgb(target);
  const m = (a, z) => Math.round(a + (z - a) * t).toString(16).padStart(2, '0');
  return `#${m(r, R)}${m(g, G)}${m(b, B)}`;
}

function paint(data, place, stale = false) {
  current = data;
  const c = data.current;

  const { g, accent } = sky(c.condition, c.night);
  const root = document.documentElement.style;
  root.setProperty('--sky-1', g[0]);
  root.setProperty('--sky-2', g[1]);
  root.setProperty('--sky-3', g[2]);
  root.setProperty('--accent', accent);

  /* The sky accent is tuned to sit on the dark hero gradient; reused as text
     inside a white card it drops to ~2:1 contrast. Publish a darkened variant
     alongside it and let the stylesheet's media query choose between them. */
  root.setProperty('--accent-dark', mixHex(accent, '#0b2038', 0.55));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', g[0]);

  $('#place-name').textContent = place.name;
  const bits = [];
  if (data.place && data.place !== place.name) bits.push(data.place);
  bits.push(stale ? `Offline · ${timeLabel(data.updated, place.tz)}` : `Updated ${timeLabel(data.updated, place.tz)}`);
  $('#place-sub').textContent = bits.join(' · ');

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
  $('#cards').innerHTML = renderCards(data);

  const srcBits = [data.source.name];
  if (data.supplement) srcBits.push(`+ ${data.supplement}`);
  $('#source-line').textContent = `Data from ${srcBits.join(' ')}`;

  startFx($('#fx'), fxKind(c.condition), state.fx === 'on');
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
async function refresh({ silent = false } = {}) {
  const place = activePlace();
  if (!place) { showEmpty(); return; }
  if (busy) return;
  busy = true;

  const cached = readCache(place.id);
  if (cached && !current) paint(cached.data, place, true);
  else if (!silent && !current) skeleton(place);

  try {
    const data = await loadWeather(place, state.source);
    cacheWeather(place.id, data);
    paint(data, place, false);
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
    return `<div class="res" data-place="${p.id}">
      <span class="flag">${p.current ? '📍' : flagOf(p.cc)}</span>
      <span class="rn"><b>${p.name}</b><span>${p.admin ?? ''}</span></span>
      <span class="rt">${t != null ? temp(t) : ''}</span>
      <button class="del" data-del="${p.id}" aria-label="Remove">
        <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
      </button>
    </div>`;
  }).join('');
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
    addPlace(p);
    current = null;
    $('#search-input').value = '';
    $('#search-results').innerHTML = '';
    closePanels();
    renderSaved();
    refresh();
  });

  $('#saved-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      removePlace(del.dataset.del);
      renderSaved();
      current = null;
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

  // expandable alert text + radar launcher
  $('#cards').addEventListener('click', (e) => {
    const a = e.target.closest('.alert');
    if (a) { a.classList.toggle('open'); return; }
    if (e.target.closest('[data-open-radar]')) openRadar();
  });

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
  seg('#seg-fx', 'fx', () => current && startFx($('#fx'), fxKind(current.current.condition), state.fx === 'on'));

  $('#scroll-cue').addEventListener('click', () =>
    $('#sheet').scrollIntoView({ behavior: 'smooth' }));

  // refresh when the app comes back to the foreground
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && current && Date.now() - current.updated > 10 * 60e3) refresh({ silent: true });
  });

  // pull-to-refresh at the very top of the hero
  let y0 = null;
  window.addEventListener('touchstart', (e) => {
    y0 = window.scrollY <= 0 ? e.touches[0].clientY : null;
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (y0 !== null && e.changedTouches[0].clientY - y0 > 110 && window.scrollY <= 0) {
      toast('Refreshing…', 1200);
      refresh({ silent: true });
    }
    y0 = null;
  }, { passive: true });
}

/* ── boot ─────────────────────────────────────────── */
async function boot() {
  wire();
  renderSaved();

  if (!state.places.length) showEmpty();
  else refresh();

  setInterval(() => { if (!document.hidden) refresh({ silent: true }); }, 15 * 60e3);

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch (e) { console.warn('SW registration failed', e); }
  }
}

boot();

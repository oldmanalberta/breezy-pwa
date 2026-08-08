/* Precipitation radar, drawn on a minimal Web Mercator map.
 *
 * Imagery comes from ECCC's MSC GeoMet WMS (geo.weather.gc.ca), the same
 * North American 1 km radar composite the WeatherCAN app shows. GeoMet sends
 * CORS headers and needs no key.
 *
 * There's no map library here on purpose: the app is dependency-free and a
 * radar view only needs pan, zoom and a frame slider. Base map is a tile grid
 * of <img>; the radar itself is a single WMS image sized to the viewport,
 * which avoids tiling the WMS and keeps it to one request per layer per frame.
 */

import { state, set } from './store.js';
import { hasWebGL2, createFlowRenderer } from './flow.js';

const GEOMET = 'https://geo.weather.gc.ca/geomet';
const RAIN = 'RADAR_1KM_RRAI';
const SNOW = 'RADAR_1KM_RSNO';

const A = 20037508.342789244;          // half the Mercator world, in metres
const TILE = 256;
const MIN_Z = 3, MAX_Z = 11;

/* The composite covers North America; hide the feature elsewhere. */
export const radarAvailable = (lat, lon) =>
  lat >= 22 && lat <= 84 && lon >= -172 && lon <= -48;

/* ── projection ───────────────────────────────────── */
const lonToWorld = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const latToWorld = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};
const worldToLon = (x, z) => (x / (TILE * 2 ** z)) * 360 - 180;
const worldToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
/* world pixel → Mercator metres (what the WMS bbox wants) */
const worldToMercX = (x, z) => (x / (TILE * 2 ** z)) * 2 * A - A;
const worldToMercY = (y, z) => A - (y / (TILE * 2 ** z)) * 2 * A;

/* ── WMS urls ─────────────────────────────────────── */
/* The radar composite is 1 km data, so asking for it at CSS-pixel size throws
   away detail on a retina screen and the result looks blocky. Render at the
   device pixel ratio (capped) and let the browser scale it back down. */
export const RES_SCALE = () => Math.min(2, Math.max(1, window.devicePixelRatio || 1));

function wmsUrl(layer, bbox, w, h, time, scale = 1) {
  const p = new URLSearchParams({
    service: 'WMS', version: '1.3.0', request: 'GetMap',
    layers: layer, crs: 'EPSG:3857',
    bbox: bbox.join(','),
    width: Math.min(2048, Math.round(w * scale)),
    height: Math.min(2048, Math.round(h * scale)),
    format: 'image/png', transparent: 'true',
  });
  if (time) p.set('time', time);
  return `${GEOMET}?${p}`;
}

export const legendUrl = (layer = RAIN) =>
  `${GEOMET}?service=WMS&version=1.3.0&request=GetLegendGraphic&layer=${layer}&format=image/png&sld_version=1.1.0`;

/* ── base maps ────────────────────────────────────────
   Plain light/dark tiles are clean but nearly featureless under radar, so the
   default is a terrain map that actually shows roads and towns — the reference
   you need to tell where a cell is heading. */
export const BASEMAPS = {
  terrain: {
    label: 'Terrain',
    url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
    max: 19,
    attrib: 'Map © <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, USGS, NOAA',
    dark: false,
  },
  streets: {
    label: 'Streets',
    url: (x, y, z) => `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
    max: 20,
    attrib: 'Map © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    dark: false,
  },
  satellite: {
    label: 'Satellite',
    url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    max: 19,
    attrib: 'Imagery © <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
    dark: true,
  },
  light: {
    label: 'Light',
    url: (x, y, z) => `https://basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`,
    max: 20,
    attrib: 'Map © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    dark: false,
  },
  dark: {
    label: 'Dark',
    url: (x, y, z) => `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`,
    max: 20,
    attrib: 'Map © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    dark: true,
  },
};

export const currentBasemap = () => BASEMAPS[state.mapTheme] ?? BASEMAPS.terrain;

export const baseTileUrl = (x, y, z, map = currentBasemap()) => map.url(x, y, z);

/* Whether the active base map is dark, so overlays can pick a readable tint. */
export const mapIsDark = () => currentBasemap().dark;

/* Everything needed to draw a non-interactive w×h map centred on a point:
   the base tiles with their offsets, plus radar images for that exact bbox.
   Used by the card preview, which shares this projection so the overlay lines
   up with the tiles without a map engine. */
export function staticMapSpec(lat, lon, w, h, z = 6) {
  const cx = lonToWorld(lon, z), cy = latToWorld(lat, z);
  const left = cx - w / 2, top = cy - h / 2;
  const n = 2 ** z;
  const map = currentBasemap();

  const tiles = [];
  for (let x = Math.floor(left / TILE); x <= Math.floor((left + w) / TILE); x++) {
    for (let y = Math.floor(top / TILE); y <= Math.floor((top + h) / TILE); y++) {
      if (y < 0 || y >= n) continue;
      tiles.push({
        url: baseTileUrl(((x % n) + n) % n, y, z, map),
        left: x * TILE - left,
        top: y * TILE - top,
      });
    }
  }

  const bbox = [
    worldToMercX(left, z), worldToMercY(top + h, z),
    worldToMercX(left + w, z), worldToMercY(top, z),
  ];
  return { tiles, rain: wmsUrl(RAIN, bbox, w, h), snow: wmsUrl(SNOW, bbox, w, h) };
}

/* ── frame times ──────────────────────────────────── */
/* GeoMet advertises the run as "start/end/PT6M" on the time dimension. */
export async function fetchFrameTimes(limit = 12) {
  const url = `${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&LAYERS=${RAIN}`;
  const xml = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/xml');
  const dim = [...xml.getElementsByTagNameNS('*', 'Dimension')]
    .find((d) => d.getAttribute('name') === 'time');
  if (!dim) throw new Error('Radar time dimension unavailable');

  const [startS, endS, stepS] = dim.textContent.trim().split('/');
  const start = new Date(startS), end = new Date(endS);
  const stepMin = Number(/PT(\d+)M/.exec(stepS || 'PT6M')?.[1] ?? 6);

  const times = [];
  for (let t = start.getTime(); t <= end.getTime(); t += stepMin * 60000) times.push(new Date(t));
  return times.slice(-limit);
}

/* ── the map ──────────────────────────────────────── */
export function createRadar(host, { lat, lon, tz }) {
  let z = 7;
  let cx = lonToWorld(lon, z), cy = latToWorld(lat, z);   // centre, world px
  let W = 0, H = 0;
  let frames = [], idx = 0, playing = false, timer = null, loadedFor = null, ready = false;
  let raf = null;

  /* Motion interpolation needs WebGL2; without it we fall back to the
     cross-fade path, which still works everywhere. */
  let useFlow = state.radarFlow !== 'off' && hasWebGL2();
  const glCanvas = document.createElement('canvas');
  glCanvas.className = 'rd-gl';
  let flowR = null;
  if (useFlow) {
    try {
      flowR = createFlowRenderer(glCanvas);
      useFlow = !!flowR;
      flowR?.setStrength(state.radarFlow === 'subtle' ? 0.5 : 1);
    } catch (e) { console.warn('WebGL2 radar unavailable', e); useFlow = false; }
  }

  host.innerHTML = `
    <div class="rd-map" id="rd-map">
      <div class="rd-tiles"></div>
      <div class="rd-frames"></div>
      <div class="rd-pin" title="Your location"></div>
      <div class="rd-empty" id="rd-empty" hidden>
        <b>Little or no precipitation in view</b>
        <span>The radar is working — there is simply nothing falling here right now. Zoom out to look further afield.</span>
      </div>
    </div>
    <div class="rd-top">
      <button class="icon-btn" data-rd="close" aria-label="Close radar">
        <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
      <div class="rd-title"><b>Radar</b><span id="rd-stamp">Loading…</span></div>
    </div>
    <div class="rd-zoom">
      <button data-rd="in" aria-label="Zoom in">+</button>
      <button data-rd="out" aria-label="Zoom out">&minus;</button>
      <button data-rd="theme" aria-label="Map theme" title="Map theme">
        <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18zm0 2.2v13.6a6.8 6.8 0 0 1 0-13.6z"/></svg>
      </button>
    </div>
    <div class="rd-bottom">
      <div class="rd-loading" id="rd-loading" hidden>
        <span class="rd-loadtext">Loading radar…</span>
        <span class="rd-loadbar"><i class="rd-loadfill"></i></span>
      </div>
      <div class="rd-controls">
        <button class="rd-play" data-rd="play" aria-label="Play animation">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <input class="rd-slider" id="rd-slider" type="range" min="0" max="0" value="0" step="1" aria-label="Radar time">
        <button class="rd-legendbtn" data-rd="legend" aria-label="Show legend">mm/h</button>
      </div>
      <div class="rd-maps" id="rd-maps">
        ${Object.entries(BASEMAPS).map(([k, m]) =>
          `<button class="rd-map-pill${k === state.mapTheme ? ' on' : ''}" data-map="${k}">${m.label}</button>`).join('')}
      </div>
      <p class="rd-attrib" id="rd-attrib"></p>
    </div>
    <div class="rd-legendbox" id="rd-legendbox" hidden>
      <div class="rd-legendhead">Rain<span>mm/h</span></div>
      <img alt="Precipitation rate legend" src="${legendUrl()}">
    </div>`;

  const map = host.querySelector('#rd-map');
  const tileLayer = host.querySelector('.rd-tiles');
  const frameLayer = host.querySelector('.rd-frames');
  const stamp = host.querySelector('#rd-stamp');
  const slider = host.querySelector('#rd-slider');
  const playBtn = host.querySelector('.rd-play');

  // attach the GL surface once and leave it there; rebuilds swap textures
  // underneath rather than tearing the element out of the DOM
  if (useFlow) frameLayer.appendChild(glCanvas);

  /* ── base tiles ── */
  function drawTiles() {
    const left = cx - W / 2, top = cy - H / 2;
    const n = 2 ** z;
    const map = currentBasemap();
    const x0 = Math.floor(left / TILE), x1 = Math.floor((left + W) / TILE);
    const y0 = Math.floor(top / TILE), y1 = Math.floor((top + H) / TILE);

    const want = new Map();
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= n) continue;
        const wx = ((x % n) + n) % n;                 // wrap around the globe
        want.set(`${z}/${x}/${y}`, { x, y, wx });
      }
    }

    for (const el of [...tileLayer.children]) {
      if (!want.has(el.dataset.key)) el.remove(); else want.delete(el.dataset.key);
    }
    for (const [key, t] of want) {
      const img = new Image();
      img.className = 'rd-tile';
      img.dataset.key = key;
      img.loading = 'eager';
      img.src = baseTileUrl(t.wx, t.y, z, map);
      img.style.transform = `translate(${t.x * TILE - left}px, ${t.y * TILE - top}px)`;
      tileLayer.appendChild(img);
    }
    // reposition survivors (needed after a pan)
    for (const el of tileLayer.children) {
      const [, tx, ty] = el.dataset.key.split('/').map(Number);
      el.style.transform = `translate(${tx * TILE - left}px, ${ty * TILE - top}px)`;
    }
  }

  const currentBbox = () => {
    const left = cx - W / 2, top = cy - H / 2;
    return [
      worldToMercX(left, z), worldToMercY(top + H, z),
      worldToMercX(left + W, z), worldToMercY(top, z),
    ];
  };

  /* ── radar frames ── */
  function frameKey() { return `${z}|${Math.round(cx)}|${Math.round(cy)}|${Math.round(W)}x${Math.round(H)}`; }

  /* Fetch one time step's rain and snow layers and merge them into a single
     canvas. Going through fetch + createImageBitmap (rather than an <img>)
     keeps the result CORS-clean so WebGL can sample it — GeoMet sends
     Access-Control-Allow-Origin: *. */
  async function loadComposite(bbox, iso, scale) {
    const [rain, snow] = await Promise.all([RAIN, SNOW].map(async (layer) => {
      // A wide bbox makes GeoMet render a lot; without a ceiling one slow
      // layer holds up the whole run.
      const ac = new AbortController();
      const kill = setTimeout(() => ac.abort(), 20000);
      try {
        const r = await fetch(wmsUrl(layer, bbox, W, H, iso, scale), { signal: ac.signal });
        if (!r.ok) return null;
        return await createImageBitmap(await r.blob());
      } catch { return null; }
      finally { clearTimeout(kill); }
    }));

    const w = Math.min(2048, Math.round(W * scale));
    const h = Math.min(2048, Math.round(H * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (rain) { ctx.drawImage(rain, 0, 0, w, h); rain.close?.(); }
    if (snow) { ctx.drawImage(snow, 0, 0, w, h); snow.close?.(); }

    /* Note whether this frame contains any echo at all. A clear sky renders
       exactly like a broken radar — blank — so the panel needs to be able to
       say which it is rather than leaving you guessing. Checked on a small
       downscale: reading back a full-resolution frame costs megabytes per
       frame and this only needs presence, not a count. */
    let pct = 100;               // unreadable: assume there is data
    try {
      const t = document.createElement('canvas');
      t.width = 64; t.height = 64;
      const tx = t.getContext('2d', { willReadFrequently: true });
      tx.drawImage(c, 0, 0, 64, 64);
      const d = tx.getImageData(0, 0, 64, 64).data;
      let hits = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 12) hits++;
      pct = (hits / 4096) * 100;
    } catch { /* keep the optimistic default */ }
    c.echoPct = pct;
    return c;
  }

  /* Run `fn` over `items` with bounded concurrency. Fetching the twelve frames
     one after another meant twenty-four sequential WMS renders, which at a wide
     bbox is slow enough to look like a hang. */
  async function mapLimit(items, limit, fn, onDone) {
    const out = new Array(items.length);
    let next = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const k = next++;
        if (k >= items.length) return;
        out[k] = await fn(items[k], k);
        onDone?.(++done);
      }
    }));
    return out;
  }

  /* Animation must not start until every frame has arrived, otherwise Play
     runs through blank frames that read as "no precipitation" rather than
     "not downloaded yet". */
  async function drawFrames() {
    const key = frameKey();
    if (key === loadedFor || !frames.length || !W) return;
    loadedFor = key;
    const myKey = key;

    ready = false;
    if (playing) stop();

    const total = frames.length;
    updateLoading(0, total, 'Loading radar');

    // Flow interpolation holds every frame in GPU memory, so cap the texture
    // size rather than pushing full 2x on a large viewport.
    const scale = useFlow
      ? Math.min(RES_SCALE(), 1400 / Math.max(W, H))
      : RES_SCALE();

    const bbox = currentBbox();
    const composites = await mapLimit(
      frames, 4,
      (t) => loadComposite(bbox, t.toISOString().replace(/\.\d+Z$/, 'Z'), Math.max(1, scale)),
      (n) => updateLoading(n, total, 'Loading radar'),
    );
    if (loadedFor !== myKey) return;            // a pan/zoom superseded this load

    /* A few stray pixels of echo are invisible at a glance, so treating "not
       exactly zero" as "there is weather here" still leaves you staring at an
       apparently broken map. Anything under a third of a percent of the view
       counts as nothing worth showing. */
    const anyEcho = composites.some((c) => c.echoPct > 0.3);
    host.querySelector('#rd-empty').hidden = anyEcho;

    if (useFlow && flowR) {
      try {
        updateLoading(0, 1, 'Tracking motion');
        const committed = await flowR.build(
          composites,
          (p) => updateLoading(p, 1, 'Tracking motion'),
          () => loadedFor !== myKey,
        );
        if (!committed) return;          // superseded; previous view left intact
        // the canvas lives in the layer permanently, so nothing to re-attach
        ready = true;
        updateLoading(1, 1);
        showFrame(idx, 0);
        return;
      } catch (e) {
        console.warn('flow renderer failed, falling back to cross-fade', e);
        useFlow = false;
        glCanvas.remove();
      }
    }

    // Fallback: stack the composited frames and cross-fade between them.
    frameLayer.innerHTML = '';
    composites.forEach((c, i) => {
      const g = document.createElement('div');
      g.className = 'rd-frame';
      g.style.opacity = i === idx ? '1' : '0';
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      g.appendChild(c);
      frameLayer.appendChild(g);
    });
    ready = true;
    updateLoading(total, total);
    showFrame(idx, 0);
  }

  function updateLoading(done, total, label = 'Loading radar') {
    const bar = host.querySelector('#rd-loading');
    if (!bar) return;
    if (done >= total) {
      bar.hidden = true;
      playBtn.disabled = false;
      playBtn.removeAttribute('aria-disabled');
      return;
    }
    bar.hidden = false;
    bar.querySelector('.rd-loadtext').textContent =
      `${label}… ${Math.round((done / total) * 100)}%`;
    bar.querySelector('.rd-loadfill').style.width = `${(done / total) * 100}%`;
    playBtn.disabled = true;
    playBtn.setAttribute('aria-disabled', 'true');
  }

  /* `frac` is how far past frame `i` we are, 0..1. In flow mode that drives
     the GPU warp; in fallback mode only whole frames exist so it is ignored. */
  function showFrame(i, frac = 0) {
    idx = Math.max(0, Math.min(frames.length - 1, i));

    if (useFlow && flowR && ready) {
      flowR.draw(idx, frac);
    } else {
      [...frameLayer.children].forEach((g, k) => { g.style.opacity = k === idx ? '1' : '0'; });
    }

    slider.value = String(idx);
    const t = frames[idx];
    if (t) {
      const time = new Intl.DateTimeFormat('en-CA',
        { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }).format(t);
      stamp.textContent = idx === frames.length - 1 ? `${time} · latest` : time;
    }
  }

  function setBasemap(key) {
    set('mapTheme', key);
    host.querySelectorAll('[data-map]').forEach((b) =>
      b.classList.toggle('on', b.dataset.map === key));
    // some sources stop short of the deepest zooms
    const max = BASEMAPS[key].max ?? MAX_Z;
    if (z > max) setZoom(max);
    tileLayer.innerHTML = '';
    drawTiles();
    updateAttrib();
  }

  function updateAttrib() {
    const el = host.querySelector('#rd-attrib');
    if (el) el.innerHTML = `Radar © Environment and Climate Change Canada · ${currentBasemap().attrib}`;
  }

  function render() { drawTiles(); drawFrames(); }

  function resize() {
    const r = map.getBoundingClientRect();
    if (Math.round(r.width) === W && Math.round(r.height) === H) return;
    W = Math.round(r.width); H = Math.round(r.height);
    loadedFor = null;
    render();
    placePin();
  }

  function placePin() {
    const pin = host.querySelector('.rd-pin');
    const px = lonToWorld(lon, z) - (cx - W / 2);
    const py = latToWorld(lat, z) - (cy - H / 2);
    pin.style.transform = `translate(${px}px, ${py}px)`;
    pin.style.display = px < 0 || py < 0 || px > W || py > H ? 'none' : 'block';
  }

  function setZoom(nz, ax = W / 2, ay = H / 2) {
    nz = Math.max(MIN_Z, Math.min(MAX_Z, nz));
    if (nz === z) return;
    // keep the point under (ax, ay) fixed across the zoom
    const gx = cx - W / 2 + ax, gy = cy - H / 2 + ay;
    const f = 2 ** (nz - z);
    cx = gx * f - ax + W / 2;
    cy = gy * f - ay + H / 2;
    z = nz;
    tileLayer.innerHTML = '';
    loadedFor = null;
    render();
    placePin();
  }

  /* ── gestures ──
     The radar image is fetched for one exact bbox, so during a drag we slide
     the already-loaded frames by the distance panned rather than refetching on
     every pointermove; `anchor` remembers the centre the current image was
     rendered for. Pan offset and pinch scale go through separate CSS custom
     properties so neither clobbers the other's transform. */
  let drag = null, pinch = null, settle = null;
  const anchor = { cx: null, cy: null };

  const deferFrames = () => {
    clearTimeout(settle);
    settle = setTimeout(() => { drawFrames(); showFrame(idx); }, 220);
  };

  const setPan = (dx, dy) => {
    map.style.setProperty('--rd-dx', `${dx}px`);
    map.style.setProperty('--rd-dy', `${dy}px`);
  };

  map.addEventListener('pointerdown', (e) => {
    if (pinch || e.pointerType === 'touch' && e.isPrimary === false) return;
    map.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
    anchor.cx = cx;
    anchor.cy = cy;
  });
  map.addEventListener('pointermove', (e) => {
    if (!drag || pinch) return;
    cx -= e.clientX - drag.x;
    cy -= e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    drawTiles();
    placePin();
    setPan(anchor.cx - cx, anchor.cy - cy);
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    setPan(0, 0);
    anchor.cx = anchor.cy = null;
    deferFrames();
  };
  map.addEventListener('pointerup', endDrag);
  map.addEventListener('pointercancel', endDrag);

  map.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      drag = null;
      const [a, b] = e.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z };
    }
  }, { passive: true });
  map.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const scale = d / pinch.d;
    map.style.setProperty('--rd-scale', String(scale));
  }, { passive: true });
  map.addEventListener('touchend', (e) => {
    if (!pinch || e.touches.length) return;
    const scale = Number(map.style.getPropertyValue('--rd-scale')) || 1;
    map.style.setProperty('--rd-scale', '1');
    setZoom(Math.round(pinch.z + Math.log2(scale)));
    pinch = null;
    deferFrames();
  });

  map.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = map.getBoundingClientRect();
    setZoom(z + (e.deltaY < 0 ? 1 : -1), e.clientX - r.left, e.clientY - r.top);
    deferFrames();
  }, { passive: false });

  map.addEventListener('dblclick', (e) => {
    const r = map.getBoundingClientRect();
    setZoom(z + 1, e.clientX - r.left, e.clientY - r.top);
    deferFrames();
  });

  /* ── controls ── */
  function stop() {
    playing = false;
    clearInterval(timer);
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    playBtn.classList.remove('on');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  }

  function play() {
    if (frames.length < 2 || !ready) return;
    playing = true;
    playBtn.classList.add('on');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
    clearInterval(timer);
    if (raf) cancelAnimationFrame(raf);

    if (useFlow && flowR) {
      /* Advance a continuous cursor and render the interpolated moment on every
         animation frame, so motion is genuinely smooth rather than stepped. */
      let pos = idx;
      let last = performance.now();
      const STEP_PER_SEC = 1 / 0.9;         // ~0.9s of wall clock per radar scan

      const tick = (now) => {
        if (!playing) return;
        pos += ((now - last) / 1000) * STEP_PER_SEC;
        last = now;
        if (pos >= frames.length - 1) pos = 0;
        showFrame(Math.floor(pos), pos - Math.floor(pos));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return;
    }

    // Fallback: step whole frames and let CSS cross-fade cover the gap.
    timer = setInterval(() => {
      showFrame(idx >= frames.length - 1 ? 0 : idx + 1);
    }, 620);
  }

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-rd]')?.dataset.rd;
    if (act === 'in')  { setZoom(z + 1); deferFrames(); }
    if (act === 'out') { setZoom(z - 1); deferFrames(); }
    if (act === 'play') { playing ? stop() : play(); }
    const mapKey = e.target.closest('[data-map]')?.dataset.map;
    if (mapKey && BASEMAPS[mapKey]) { setBasemap(mapKey); return; }

    if (act === 'theme') {
      // cycle through the base maps in declaration order
      const keys = Object.keys(BASEMAPS);
      setBasemap(keys[(keys.indexOf(state.mapTheme) + 1) % keys.length]);
    }
    if (act === 'legend') {
      const box = host.querySelector('#rd-legendbox');
      box.hidden = !box.hidden;
      e.target.closest('[data-rd]').classList.toggle('on', !box.hidden);
    }
    if (act === 'close') host.dispatchEvent(new CustomEvent('radar-close', { bubbles: true }));
  });

  slider.addEventListener('input', () => { stop(); showFrame(Number(slider.value)); });

  const ro = new ResizeObserver(resize);
  ro.observe(map);

  /* ── start ── */
  (async () => {
    resize();
    updateAttrib();
    try {
      /* Nine scans is ~54 minutes of history. Twelve pushed the open-to-ready
         time to roughly nine seconds, since every extra frame costs two WMS
         renders and another motion-estimation pass. */
      frames = await fetchFrameTimes(9);
      idx = frames.length - 1;
      slider.max = String(frames.length - 1);
      loadedFor = null;
      drawFrames();
      showFrame(idx);
    } catch (err) {
      stamp.textContent = 'Radar unavailable';
      console.warn('radar frames failed', err);
    }
  })();

  return {
    destroy() {
      stop();
      ro.disconnect();
      try { flowR?.destroy(); } catch { /* context may already be gone */ }
      host.innerHTML = '';
    },
  };
}

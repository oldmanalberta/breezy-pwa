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
import { createWindLayer, fetchWindGrid } from './wind.js';

const GEOMET = 'https://geo.weather.gc.ca/geomet';
const RAIN = 'RADAR_1KM_RRAI';
const SNOW = 'RADAR_1KM_RSNO';

/* ── overlay layers ───────────────────────────────────
 * Precipitation is the only one that animates: it is a 1 km radar composite
 * published every six minutes. Smoke and wind are model output on an hourly
 * step, so a loop of the last hour would show almost nothing moving — they
 * render as a single current field instead, with playback disabled.
 *
 * On smoke specifically: firesmoke.ca (BlueSky Canada) has no public map
 * service — every path returns the site's HTML — so there is nothing to
 * consume directly. RAQDPS.SFC_PM2.5 is ECCC's own modelled surface PM2.5,
 * the same quantity firesmoke.ca maps, on the same GeoMet service as the radar.
 */
export const LAYERS = {
  precip: {
    label: 'Precipitation',
    wms: [RAIN, SNOW],
    legend: RAIN,
    legendTitle: 'Rain',
    unit: 'mm/h',
    animated: true,
    icon: '<svg viewBox="0 0 24 24"><path d="M12 2.7s6 6.9 6 11a6 6 0 0 1-12 0c0-4.1 6-11 6-11z"/></svg>',
  },
  smoke: {
    label: 'Smoke',
    wms: ['RAQDPS.SFC_PM2.5'],
    /* Of ECCC's discrete PM2.5 ramps this is the one that reads like
       firesmoke.ca: pale cyan at trace levels through blue, yellow, orange and
       red to near-black at the top, with its detail concentrated in the low
       range where smoke actually matters. The others are either a single-hue
       dark red wash or a purple-heavy 0–500 scale that leaves ordinary smoke
       events almost invisible. firesmoke.ca's own palette could not be used
       directly — the site publishes no data service and no colour table. */
    /* ECCC's own discrete ramp: pale cyan at trace levels through blue, yellow
       and orange to red, with its resolution concentrated in the low range
       where smoke actually matters. The CWFIS brown was tried here and pulled
       back out — a single-hue earth tone over terrain and satellite base maps
       is nearly indistinguishable from the ground beneath it, whereas the
       blue-to-red ramp separates cleanly from every base map on offer. */
    style: 'PM2.5_0to100ugm3_Dis',
    legend: 'RAQDPS.SFC_PM2.5',
    legendTitle: 'Surface PM2.5',
    unit: 'µg/m³',
    animated: true,
    timeMode: 'future',        // a forecast loop, like firesmoke.ca's
    frames: 12,
    /* Softened, unlike the radar. This is a ~10km model grid drawn with a
       discrete ramp, so it arrives with both coarse cells and hard colour
       steps baked into the image — blur is recovering the smooth field the
       banding was drawn from, not hiding detail. Radar is 1km observed data
       where the same treatment destroyed real structure. */
    soft: 7,
    /* Smoke covers whole regions rather than the scattered cells radar draws,
       so at radar's opacity it reads as a sheet laid over the map. Kept light
       enough that roads and place names stay legible through the thick of it. */
    opacity: 0.38,
    icon: '<svg viewBox="0 0 24 24"><path d="M4 15h13a3 3 0 1 0-2.6-4.5A4.5 4.5 0 0 0 6 11.2 2 2 0 0 0 4 15zm1.5 3h10a1 1 0 0 1 0 2h-10a1 1 0 0 1 0-2zm3 3h8a1 1 0 0 1 0 2h-8a1 1 0 0 1 0-2z"/></svg>',
  },
};

/* Wind sits outside LAYERS on purpose. It is not an alternative to seeing rain
   or smoke — it is the thing that explains where they are going, so it belongs
   on top of them rather than instead of them. Its button cycles three ways.
   Drawn as moving particles (see js/wind.js) because GeoMet styles wind only as
   arrows and barbs, which is a static picture of a moving thing. */
export const WIND_MODES = ['off', 'particles', 'full'];
export const WIND_ICON =
  '<svg viewBox="0 0 24 24"><path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5h-2A4.5 4.5 0 1 1 14 10H3zm0 4h16a2.5 2.5 0 1 1-2.5 2.5h-2A4.5 4.5 0 1 0 19 10H3zm0 5h8a2 2 0 1 1-2 2H7a4 4 0 1 0 4-4H3z"/></svg>';
export const windLabel = (m) =>
  m === 'particles' ? 'Wind on' : m === 'full' ? 'Wind + speed shading' : 'Wind off';

export const currentLayer = () => LAYERS[state.radarLayer] ?? LAYERS.precip;

const A = 20037508.342789244;          // half the Mercator world, in metres
const TILE = 256;
const MIN_Z = 3, MAX_Z = 11;

/* Nine scans is ~54 minutes of history. Twelve pushed the open-to-ready time to
   roughly nine seconds, since every extra frame costs two WMS renders. */
const FRAMES = 9;

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

function wmsUrl(layer, bbox, w, h, time, scale = 1, style = null) {
  const p = new URLSearchParams({
    service: 'WMS', version: '1.3.0', request: 'GetMap',
    layers: layer, crs: 'EPSG:3857',
    bbox: bbox.join(','),
    width: Math.min(2048, Math.round(w * scale)),
    height: Math.min(2048, Math.round(h * scale)),
    format: 'image/png', transparent: 'true',
  });
  if (time) p.set('time', time);
  if (style) p.set('styles', style);
  return `${GEOMET}?${p}`;
}

export const legendUrl = (layer = RAIN, style = null) =>
  `${GEOMET}?service=WMS&version=1.3.0&request=GetLegendGraphic&layer=${layer}` +
  `&format=image/png&sld_version=1.1.0${style ? `&style=${encodeURIComponent(style)}` : ''}`;

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
export async function fetchFrameTimes(limit = 12, layerName = RAIN, mode = 'past') {
  const url = `${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&LAYERS=${layerName}`;
  const xml = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/xml');
  const dim = [...xml.getElementsByTagNameNS('*', 'Dimension')]
    .find((d) => d.getAttribute('name') === 'time');
  if (!dim) throw new Error('Radar time dimension unavailable');

  const [startS, endS, stepS] = dim.textContent.trim().split('/');
  const start = new Date(startS), end = new Date(endS);

  /* Parse hours as well as minutes. Radar advertises PT6M, but the air-quality
     model advertises PT1H — and a minutes-only parser silently fell back to six
     minutes, so the smoke layer was requested twelve times inside one model
     hour. GeoMet answers those with empty tiles, which reads as a broken layer
     rather than a malformed query. */
  const step = stepS || 'PT6M';
  const hours = Number(/PT(\d+)H/.exec(step)?.[1] ?? 0);
  const mins = Number(/T?(?:\d+H)?(\d+)M/.exec(step)?.[1] ?? 0);
  const stepMin = (hours * 60 + mins) || 6;

  const times = [];
  for (let t = start.getTime(); t <= end.getTime(); t += stepMin * 60000) times.push(new Date(t));

  /* Radar is a record of what has happened, so it ends at the newest scan.
     The air-quality model runs days ahead, and the useful loop there is the one
     firesmoke.ca shows — where the smoke is going, starting from now. */
  if (mode === 'future') {
    const from = Date.now() - 3600e3;
    const ahead = times.filter((t) => t.getTime() >= from);
    return (ahead.length ? ahead : times).slice(0, limit);
  }
  return times.slice(-limit);
}

/* ── the map ──────────────────────────────────────── */
export function createRadar(host, { lat, lon, tz }) {
  /* Always open on precipitation. The layer choice persists while the panel is
     up so switching back and forth is cheap, but carrying it across sessions
     meant a glance at smoke last week decided what you saw when you opened the
     radar to check for rain. Precipitation is what the panel is for. */
  if (state.radarLayer !== 'precip') set('radarLayer', 'precip');

  let z = 7;
  let cx = lonToWorld(lon, z), cy = latToWorld(lat, z);   // centre, world px
  let W = 0, H = 0;
  let frames = [], idx = 0, playing = false, timer = null, loadedFor = null, ready = false;
  let raf = null;
  /* Once you've been told the sky is clear, being told again on every pan is
     just something in the way while you hunt for weather elsewhere. */
  let emptyDismissed = false;
  let windLayer = null, windLoading = false, windKey = null;

  /* Images are the default renderer because they are the ones that reliably
     work: the same mechanism drives the card, which renders correctly on
     hardware where the WebGL path draws a blank canvas with no error to catch.
     Motion interpolation is opt-in until that is understood. */
  let useFlow = state.radarRender === 'flow' && hasWebGL2();
  const glCanvas = document.createElement('canvas');
  glCanvas.className = 'rd-gl';
  let flowR = null;
  if (useFlow) {
    try {
      flowR = createFlowRenderer(glCanvas);
      useFlow = !!flowR;
      flowR?.setStrength(1);
    } catch (e) { console.warn('WebGL2 radar unavailable', e); useFlow = false; }
  }

  host.innerHTML = `
    <div class="rd-map" id="rd-map">
      <div class="rd-tiles"></div>
      <div class="rd-frames"></div>
      <!-- wind rides above the data overlay and outlives its reloads -->
      <canvas class="rd-wind-speed" id="rd-wind-speed" hidden></canvas>
      <canvas class="rd-wind" id="rd-wind" hidden></canvas>
      <div class="rd-pin" title="Your location"></div>
      <div class="rd-empty rd-fail" id="rd-fail" hidden>
        <b id="rd-fail-title">Layer unavailable</b>
        <span id="rd-fail-text"></span>
        <button class="rd-empty-x" data-rd="dismiss-fail">Got it</button>
      </div>
      <div class="rd-empty" id="rd-empty" hidden>
        <b>Little or no precipitation in view</b>
        <span>The radar is working — there is simply nothing falling here right now. Zoom out to look further afield.</span>
        <button class="rd-empty-x" data-rd="dismiss-empty">Got it</button>
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
    </div>
    <div class="rd-layers" id="rd-layers">
      ${Object.entries(LAYERS).map(([k, l]) =>
        `<button class="rd-layer${k === state.radarLayer ? ' on' : ''}" data-layer="${k}"
           aria-label="${l.label}" title="${l.label}">${l.icon}</button>`).join('')}
      <button class="rd-layer rd-windbtn" id="rd-windbtn" data-rd="wind"
        aria-label="Wind overlay">${WIND_ICON}<i class="rd-winddot"></i></button>
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
    <div class="rd-legendbox" id="rd-legendbox" data-rd="close-legend" hidden>
      <div class="rd-legendhead">Rain<span>mm/h</span></div>
      <img alt="Precipitation rate legend" src="${legendUrl()}">
      <div class="rd-legendramp" id="rd-legendramp" hidden></div>
      <div class="rd-legendhint">Tap to close</div>
    </div>`;

  const map = host.querySelector('#rd-map');
  const tileLayer = host.querySelector('.rd-tiles');
  const frameLayer = host.querySelector('.rd-frames');
  const stamp = host.querySelector('#rd-stamp');
  const slider = host.querySelector('#rd-slider');
  const playBtn = host.querySelector('.rd-play');

  // attach the GL surface once and leave it there; rebuilds swap textures
  // underneath rather than tearing the element out of the DOM
  if (useFlow) {
    frameLayer.appendChild(glCanvas);
    /* A lost context leaves a permanently blank canvas. iOS reclaims GPU
       resources aggressively when memory is tight, so treat it as a signal to
       stop using WebGL for the rest of the session rather than retry into the
       same wall. */
    glCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost; reverting radar to images');
      useFlow = false;
      ready = false;
      glCanvas.remove();
      loadedFor = null;
      drawFrames();
    });
  }

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

  /* The visible extent in degrees, for services that speak lat/lon. */
  const currentBounds = () => {
    const left = cx - W / 2, top = cy - H / 2;
    return {
      west: worldToLon(left, z), east: worldToLon(left + W, z),
      north: worldToLat(top, z), south: worldToLat(top + H, z),
    };
  };

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
    // Deliberately NOT willReadFrequently: this canvas is uploaded as a WebGL
    // texture, and hinting it for CPU readback pushes it to a software surface
    // on some engines. The echo check below reads a small copy instead.
    const ctx = c.getContext('2d');
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

  /* Legend per overlay. Precipitation uses ECCC's own graphic; the other two
     are recoloured or drawn locally, so their legends are built here to match
     what is actually on screen rather than what GeoMet would have drawn. */
  function paintLegend(l) {
    const box = host.querySelector('#rd-legendbox');
    const img = box.querySelector('img');
    const ramp = box.querySelector('#rd-legendramp');
    host.querySelector('.rd-legendhead').innerHTML = `${l.legendTitle}<span>${l.unit}</span>`;

    /* Wind shading has its own scale and can be on over either data layer, so
       the legend has to be able to show both at once rather than one or the
       other. */
    const showWind = state.windMode === 'full';
    ramp.hidden = !showWind;
    if (showWind) {
      ramp.innerHTML = `
        <div class="rd-ramp rd-ramp-wind"></div>
        <div class="rd-ramp-keys"><span>90+</span><span>45</span><span>0</span></div>
        <div class="rd-ramp-cap">Wind km/h</div>`;
    }

    if (l.legend) {
      img.hidden = false;
      img.src = legendUrl(l.legend, l.style);
      return;
    } else {
      img.hidden = true;
    }
  }

  const closeLegend = () => {
    host.querySelector('#rd-legendbox').hidden = true;
    host.querySelector('.rd-legendbtn')?.classList.remove('on');
  };

  /* Blur radius is per-layer and scaled by device pixel ratio, since the images
     are fetched at that ratio — a fixed radius would soften twice as hard on a
     1x screen as on a retina one. */
  const applySoftening = (l) => {
    frameLayer.style.setProperty('--rd-soft', l.soft ? `${(l.soft * RES_SCALE()).toFixed(1)}px` : '0px');
    frameLayer.classList.toggle('soft', !!l.soft);
  };

  /* Says which layer failed and leaves precipitation one tap away, because a
     failed smoke forecast should not strand you on a blank map. */
  function showLayerError(layer) {
    const box = host.querySelector('#rd-fail');
    if (!box) return;
    host.querySelector('#rd-fail-title').textContent = `${layer.label} unavailable`;
    host.querySelector('#rd-fail-text').textContent =
      `Environment Canada did not return the ${layer.label.toLowerCase()} forecast just now.`
      + ' It is usually brief — try again shortly, or switch back to precipitation.';
    box.hidden = false;
  }
  const hideLayerError = () => { const b = host.querySelector('#rd-fail'); if (b) b.hidden = true; };

  const setEmptyNotice = (anyEcho) => {
    host.querySelector('#rd-empty').hidden = anyEcho || emptyDismissed;
  };

  /* Is there any worthwhile echo in this view? One small request answers it,
     which is all the empty-state notice needs — the image renderer never reads
     pixels back, so there is nothing else to inspect. Returns true when there
     IS echo (i.e. the notice should stay hidden). */
  async function probeEcho(bbox) {
    const S = 96;
    try {
      const urls = [RAIN, SNOW].map((l) => `${GEOMET}?${new URLSearchParams({
        service: 'WMS', version: '1.3.0', request: 'GetMap', layers: l,
        crs: 'EPSG:3857', bbox: bbox.join(','), width: S, height: S,
        format: 'image/png', transparent: 'true',
      })}`);
      const c = document.createElement('canvas');
      c.width = S; c.height = S;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      for (const u of urls) {
        const r = await fetch(u);
        if (!r.ok) continue;
        ctx.drawImage(await createImageBitmap(await r.blob()), 0, 0, S, S);
      }
      const d = ctx.getImageData(0, 0, S, S).data;
      let hits = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 12) hits++;
      return (hits / (S * S)) * 100 > 0.3;
    } catch {
      return true;                 // unknown: don't claim the sky is empty
    }
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
    const layer = currentLayer();
    const key = `${state.radarLayer}|${frameKey()}`;
    if (key === loadedFor || !W) return;
    if (layer.animated && !frames.length) return;
    loadedFor = key;
    const myKey = key;

    ready = false;
    if (playing) stop();
    /* Drop the old imagery the moment a reload starts. It was rendered for the
       previous extent, so once the map has moved it is showing precipitation in
       the wrong place — worse than showing nothing, because it looks current. */
    frameLayer.classList.add('reloading');

    const bbox = currentBbox();

    const total = frames.length;

    /* ── image renderer (default) ──
       Plain <img> per layer per frame, exactly what the radar card does and the
       one arrangement confirmed to render on every device tested. The previous
       version decoded each frame into a full-resolution canvas so both
       renderers could share one code path; nine of those on a tall phone is
       roughly 47MB of canvas backing store, and iOS silently blanks canvases
       once its budget is gone — no error, no warning, just an empty map after a
       loading bar that ran to 100%. Letting the browser own the decoded images
       sidesteps the whole problem. */
    if (!useFlow) {
      updateLoading(0, total, `Loading ${layer.label.toLowerCase()}`);
      frameLayer.style.setProperty('--rd-op', String(layer.opacity ?? 0.88));
      // the empty notice only means anything for radar
      const echo = layer.timeMode === 'future' ? Promise.resolve(true) : probeEcho(bbox);

      const groups = frames.map((t, i) => {
        const iso = t.toISOString().replace(/\.\d+Z$/, 'Z');
        const g = document.createElement('div');
        g.className = 'rd-frame';
        g.style.opacity = i === idx ? '1' : '0';
        for (const name of layer.wms) {
          const img = new Image();
          img.alt = '';
          img.decoding = 'async';
          img.src = wmsUrl(name, bbox, W, H, iso, RES_SCALE(), layer.style);
          g.appendChild(img);
        }
        return g;
      });

      /* Every image gets a deadline. Without one a single request that hangs —
         and GeoMet's model layers do occasionally sit there — left the layer
         never ready, so the previous layer's imagery stayed on screen with its
         own timestamp. That reads as the radar refusing to leave rather than
         as smoke failing to arrive. */
      const LOAD_MS = 15000;
      const settled = await Promise.all(groups.flatMap((g) => [...g.children].map((img) =>
        new Promise((res) => {
          if (img.complete && img.naturalWidth > 0) return res(true);
          const done = (ok) => { clearTimeout(timer); res(ok); };
          const timer = setTimeout(() => { img.src = ''; done(false); }, LOAD_MS);
          img.addEventListener('load', () => done(true), { once: true });
          img.addEventListener('error', () => done(false), { once: true });
        }))));

      if (loadedFor !== myKey) return;

      const okCount = settled.filter(Boolean).length;
      if (!okCount) {
        // nothing arrived: drop the old layer's imagery rather than implying it
        frameLayer.innerHTML = '';
        frameLayer.classList.remove('reloading');
        ready = false;
        updateLoading(1, 1);
        stamp.innerHTML = `${layer.label} <span class="rd-age">unavailable</span>`;
        showLayerError(layer);
        return;
      }

      frameLayer.innerHTML = '';
      for (const g of groups) frameLayer.appendChild(g);
      setEmptyNotice(await echo);
      ready = true;
      frameLayer.classList.remove('reloading');
      updateLoading(total, total);
      showFrame(idx, 0);
      return;
    }

    /* ── motion renderer ──
       Holds every frame in GPU memory at once, so the texture budget matters
       more than the last bit of sharpness. */
    updateLoading(0, total, 'Loading radar');
    const scale = Math.min(RES_SCALE(), 1100 / Math.max(W, H));
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
    setEmptyNotice(anyEcho);

    if (useFlow && flowR) {
      try {
        updateLoading(0, 1, 'Tracking motion');
        const committed = await flowR.build(
          composites,
          (p) => updateLoading(p, 1, 'Tracking motion'),
          () => loadedFor !== myKey,
        );
        if (!committed) return;          // superseded; previous view left intact

        /* Confirm the GPU actually drew the echo we know is in these frames.
           On some devices WebGL yields a blank canvas with no error at all, and
           the radar then looks broken while the plain-image card beside it works
           fine. Rather than diagnose every cause, check the result and switch
           to images if it came out empty. */
        const drawn = flowR.probe(idx);
        if (anyEcho && drawn === 0) {
          console.warn('WebGL radar produced an empty frame; using images instead');
          useFlow = false;
          glCanvas.remove();
        } else {
          ready = true;
          frameLayer.classList.remove('reloading');
          updateLoading(1, 1);
          showFrame(idx, 0);
          return;
        }
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
    frameLayer.classList.remove('reloading');
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
    paintStamp();
  }

  /* The scan time is the whole point of a radar loop — which moment am I
     looking at, and how current is it. Shows the age too, because "7:42" tells
     you nothing unless you also know what time it is now. */
  function paintStamp() {
    const t = frames[idx];
    if (!t) return;
    const layer = currentLayer();
    const time = new Intl.DateTimeFormat('en-CA',
      { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }).format(t);
    const deltaMin = Math.round((t.getTime() - Date.now()) / 60000);

    /* A forecast loop and an observation loop need opposite wording: "50 min
       ago" is simply wrong for a model hour that has not happened yet. */
    if (layer.timeMode === 'future') {
      const h = Math.round(deltaMin / 60);
      const when = h <= 0 ? 'now' : h === 1 ? 'in 1 hour' : `in ${h} hours`;
      stamp.innerHTML = `${time} <span class="rd-age">forecast · ${when}</span>`;
      return;
    }

    const mins = Math.max(0, -deltaMin);
    const age = mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : `${mins} min ago`;
    const newest = idx === frames.length - 1;
    stamp.innerHTML = `${time} <span class="rd-age">${newest ? `latest · ${age}` : age}</span>`;
  }

  function setLayer(key) {
    if (key === state.radarLayer) return;
    set('radarLayer', key);
    host.querySelectorAll('[data-layer]').forEach((b) =>
      b.classList.toggle('on', b.dataset.layer === key));

    const l = LAYERS[key];
    host.querySelector('.rd-legendbtn').textContent = l.unit;
    host.querySelector('.rd-title b').textContent = l.label;
    paintLegend(l);
    applySoftening(l);
    // an open legend describing the layer you just left is worse than none
    closeLegend();

    slider.disabled = !l.animated;
    playBtn.hidden = !l.animated;
    slider.hidden = !l.animated;
    stop();
    if (!l.particles) { windLayer?.stop(); windLayer?.clear(); }

    emptyDismissed = false;
    setEmptyNotice(true);
    hideLayerError();
    // loadLayerTimes owns the reload: it rebuilds the frame list for this
    // layer's own time axis and only then redraws. Calling drawFrames here as
    // well raced it, rendering the new layer against the old layer's times.
    loadLayerTimes();
  }

  /* Each overlay carries its own time axis — radar looks back over the last
     hour of scans, smoke looks forward over the model run — so the frame list
     has to be rebuilt whenever the layer changes, not just at startup. Getting
     this wrong is subtle: the smoke layer requested at radar timestamps returns
     mostly nothing, which looks like a broken layer rather than a wrong query. */
  async function loadLayerTimes() {
    const l = currentLayer();
    frames = [];
    if (!l.animated) { loadedFor = null; drawFrames(); return; }
    try {
      const t = await fetchFrameTimes(l.frames ?? FRAMES, l.wms[0], l.timeMode ?? 'past');
      frames = t;
      idx = l.timeMode === 'future' ? 0 : Math.max(0, t.length - 1);
      slider.max = String(Math.max(0, t.length - 1));
      slider.value = String(idx);
      loadedFor = null;
      await drawFrames();
    } catch (e) {
      /* Same reasoning as a failed image: with no frame list the draw bails out
         early and whatever the previous layer left behind stays on screen,
         timestamp and all. Clear it and say so. */
      console.warn('layer times failed', e);
      frameLayer.innerHTML = '';
      frameLayer.classList.remove('reloading');
      ready = false;
      updateLoading(1, 1);
      stamp.innerHTML = `${l.label} <span class="rd-age">unavailable</span>`;
      showLayerError(l);
    }
  }

  /* ── wind overlay ──
     Independent of the data layer: it has its own canvases, its own fetch and
     its own idea of when it is stale, so switching between rain and smoke does
     not disturb it and reloading rain frames does not restart it. */
  const windCanvas = host.querySelector('#rd-wind');
  const windSpeedCanvas = host.querySelector('#rd-wind-speed');

  function paintWindButton() {
    const btn = host.querySelector('#rd-windbtn');
    if (!btn) return;
    btn.classList.toggle('on', state.windMode !== 'off');
    btn.classList.toggle('full', state.windMode === 'full');
    btn.setAttribute('aria-label', windLabel(state.windMode));
    btn.title = windLabel(state.windMode);
  }

  function cycleWind() {
    const next = WIND_MODES[(WIND_MODES.indexOf(state.windMode) + 1) % WIND_MODES.length];
    set('windMode', next);
    paintWindButton();
    host.dispatchEvent(new CustomEvent('radar-toast', {
      bubbles: true, detail: windLabel(next),
    }));
    applyWind();
  }

  async function applyWind() {
    const mode = state.windMode;
    const showSpeed = mode === 'full';

    if (mode === 'off') {
      windLayer?.stop();
      windLayer?.clear();
      windCanvas.hidden = true;
      windSpeedCanvas.hidden = true;
      return;
    }

    windCanvas.hidden = false;
    windSpeedCanvas.hidden = !showSpeed;
    windLayer ??= createWindLayer(windCanvas);
    windLayer.resize(W, H);

    // only refetch when the view actually moved
    const key = frameKey();
    if (key !== windKey && !windLoading) {
      windLoading = true;
      try {
        const grid = await fetchWindGrid(currentBounds());
        windLayer.setField(grid);
        windKey = key;
      } catch (e) {
        console.warn('wind grid failed', e);
      } finally { windLoading = false; }
    }
    if (showSpeed) windLayer.renderSpeedField(windSpeedCanvas);
    windLayer.start();
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
    settle = setTimeout(() => { drawFrames(); showFrame(idx); applyWind(); }, 220);
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

    const layerKey = e.target.closest('[data-layer]')?.dataset.layer;
    if (layerKey && LAYERS[layerKey]) { setLayer(layerKey); return; }
    if (act === 'dismiss-fail') { hideLayerError(); return; }
    if (act === 'dismiss-empty') {
      emptyDismissed = true;
      host.querySelector('#rd-empty').hidden = true;
    }
    if (act === 'wind') { cycleWind(); paintLegend(currentLayer()); return; }
    if (act === 'close-legend') { closeLegend(); return; }
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

  /* Keep the panel live: tick the "x min ago" every half minute, and every two
     minutes ask GeoMet whether a newer scan has published. ECCC issues one
     every six minutes, so leaving the radar open should follow the weather
     rather than freeze at whatever was current when it opened. */
  const ageTimer = setInterval(paintStamp, 30000);
  const pollTimer = setInterval(async () => {
    if (document.hidden || !ready) return;
    try {
      const latest = await fetchFrameTimes(FRAMES);
      const newest = latest[latest.length - 1];
      const had = frames[frames.length - 1];
      if (!newest || (had && newest.getTime() <= had.getTime())) return;

      const wasAtNewest = idx === frames.length - 1;
      frames = latest;
      slider.max = String(frames.length - 1);
      if (wasAtNewest) idx = frames.length - 1;   // follow the leading edge
      loadedFor = null;
      await drawFrames();
    } catch { /* transient; the next tick tries again */ }
  }, 120000);

  /* ── start ── */
  (async () => {
    resize();
    updateAttrib();
    // reflect whichever overlay was last selected, not always the radar
    const l = currentLayer();
    host.querySelector('.rd-title b').textContent = l.label;
    host.querySelector('.rd-legendbtn').textContent = l.unit;
    paintLegend(l);
    applySoftening(l);
    playBtn.hidden = !l.animated;
    slider.hidden = !l.animated;
    paintWindButton();
    await loadLayerTimes();
    applyWind();
  })();

  return {
    destroy() {
      stop();
      clearInterval(ageTimer);
      clearInterval(pollTimer);
      ro.disconnect();
      try { flowR?.destroy(); } catch { /* context may already be gone */ }
      host.innerHTML = '';
    },
  };
}

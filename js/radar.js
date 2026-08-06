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
function wmsUrl(layer, bbox, w, h, time) {
  const p = new URLSearchParams({
    service: 'WMS', version: '1.3.0', request: 'GetMap',
    layers: layer, crs: 'EPSG:3857',
    bbox: bbox.join(','), width: Math.round(w), height: Math.round(h),
    format: 'image/png', transparent: 'true',
  });
  if (time) p.set('time', time);
  return `${GEOMET}?${p}`;
}

export const legendUrl = (layer = RAIN) =>
  `${GEOMET}?service=WMS&version=1.3.0&request=GetLegendGraphic&layer=${layer}&format=image/png&sld_version=1.1.0`;

export const baseTileUrl = (x, y, z, dark) =>
  `https://basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/${z}/${x}/${y}.png`;

/* Everything needed to draw a non-interactive w×h map centred on a point:
   the base tiles with their offsets, plus radar images for that exact bbox.
   Used by the card preview, which shares this projection so the overlay lines
   up with the tiles without a map engine. */
export function staticMapSpec(lat, lon, w, h, z = 6, dark = true) {
  const cx = lonToWorld(lon, z), cy = latToWorld(lat, z);
  const left = cx - w / 2, top = cy - h / 2;
  const n = 2 ** z;

  const tiles = [];
  for (let x = Math.floor(left / TILE); x <= Math.floor((left + w) / TILE); x++) {
    for (let y = Math.floor(top / TILE); y <= Math.floor((top + h) / TILE); y++) {
      if (y < 0 || y >= n) continue;
      tiles.push({
        url: baseTileUrl(((x % n) + n) % n, y, z, dark),
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
  let frames = [], idx = 0, playing = false, timer = null, loadedFor = null;

  host.innerHTML = `
    <div class="rd-map" id="rd-map">
      <div class="rd-tiles"></div>
      <div class="rd-frames"></div>
      <div class="rd-pin" title="Your location"></div>
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
    <div class="rd-bottom">
      <div class="rd-controls">
        <button class="rd-play" data-rd="play" aria-label="Play animation">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <input class="rd-slider" id="rd-slider" type="range" min="0" max="0" value="0" step="1" aria-label="Radar time">
        <button class="rd-legendbtn" data-rd="legend" aria-label="Show legend">mm/h</button>
      </div>
      <p class="rd-attrib">Radar © Environment and Climate Change Canada ·
        Map © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>,
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></p>
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

  const dark = () => !window.matchMedia('(prefers-color-scheme: light)').matches;

  /* ── base tiles ── */
  function drawTiles() {
    const left = cx - W / 2, top = cy - H / 2;
    const n = 2 ** z;
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
      img.src = baseTileUrl(t.wx, t.y, z, dark());
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

  function drawFrames() {
    const key = frameKey();
    if (key === loadedFor || !frames.length || !W) return;
    loadedFor = key;
    const bbox = currentBbox();
    frameLayer.innerHTML = '';
    frames.forEach((t, i) => {
      const iso = t.toISOString().replace(/\.\d+Z$/, 'Z');
      const g = document.createElement('div');
      g.className = 'rd-frame';
      g.style.opacity = i === idx ? '1' : '0';
      for (const layer of [RAIN, SNOW]) {
        const img = new Image();
        img.src = wmsUrl(layer, bbox, W, H, iso);
        img.alt = '';
        g.appendChild(img);
      }
      frameLayer.appendChild(g);
    });
  }

  function showFrame(i) {
    idx = Math.max(0, Math.min(frames.length - 1, i));
    [...frameLayer.children].forEach((g, k) => { g.style.opacity = k === idx ? '1' : '0'; });
    slider.value = String(idx);
    const t = frames[idx];
    if (t) {
      const time = new Intl.DateTimeFormat('en-CA',
        { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined }).format(t);
      stamp.textContent = idx === frames.length - 1 ? `${time} · latest` : time;
    }
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
    playBtn.classList.remove('on');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  }
  function play() {
    if (frames.length < 2) return;
    playing = true;
    playBtn.classList.add('on');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
    clearInterval(timer);
    timer = setInterval(() => {
      // pause a beat on the newest frame so the loop reads clearly
      showFrame(idx >= frames.length - 1 ? 0 : idx + 1);
    }, 520);
  }

  host.addEventListener('click', (e) => {
    const act = e.target.closest('[data-rd]')?.dataset.rd;
    if (act === 'in')  { setZoom(z + 1); deferFrames(); }
    if (act === 'out') { setZoom(z - 1); deferFrames(); }
    if (act === 'play') { playing ? stop() : play(); }
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
    try {
      frames = await fetchFrameTimes(12);
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
    destroy() { stop(); ro.disconnect(); host.innerHTML = ''; },
  };
}

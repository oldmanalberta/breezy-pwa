/* Wind as moving particles, in the manner of windy.com and earth.nullschool.
 *
 * GeoMet styles its wind layers only as arrows and barbs — a static picture of
 * a moving thing, and unreadable at a glance on a phone. What that needs
 * instead is the vector field itself, which no WMS will hand over as numbers.
 *
 * Open-Meteo will: it accepts a list of coordinates in one request and returns
 * hourly speed and direction for each. A coarse grid over the visible extent is
 * enough — particles interpolate bilinearly between grid points, so the flow
 * reads as continuous even though the samples are ~50km apart.
 *
 * Drawn on a plain 2D canvas at CSS resolution. That is deliberate after the
 * WebGL radar rendered nothing on the reporting device: this is one modest
 * canvas rather than a dozen full-resolution ones, well inside any budget.
 */

const API = 'https://api.open-meteo.com/v1/forecast';

const COLS = 13;          // grid samples across the view
const ROWS = 11;
const PARTICLES = 620;
const MAX_AGE = 90;       // frames before a particle respawns
/* Screen px per frame per km/h. Successive attempts to make windy areas obvious
   kept overshooting into something frantic. The point is to read the flow at a
   glance while the map underneath stays calm, so this errs slow: a gale still
   plainly outruns a light breeze, but nothing races. */
const SPEED = 0.3;

/* Speed shading under the particles, on the same blue-to-red reading as the
   precipitation scale: calm is blue, gale is red. Stops are km/h. */
const SPEED_RAMP = [
  [0,  [ 60, 110, 190]],
  [10, [ 58, 158, 190]],
  [20, [ 70, 178, 130]],
  [30, [180, 190,  70]],
  [45, [226, 160,  56]],
  [65, [220, 100,  50]],
  [90, [198,  52,  46]],
];

function rampRGB(kmh) {
  if (kmh <= SPEED_RAMP[0][0]) return SPEED_RAMP[0][1];
  for (let i = 0; i < SPEED_RAMP.length - 1; i++) {
    const [v0, c0] = SPEED_RAMP[i], [v1, c1] = SPEED_RAMP[i + 1];
    if (kmh <= v1) {
      const t = (kmh - v0) / (v1 - v0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t));
    }
  }
  return SPEED_RAMP[SPEED_RAMP.length - 1][1];
}

/* Fetch speed/direction on a lat-lon grid covering the given bounds. */
export async function fetchWindGrid({ north, south, east, west }, signal) {
  const lats = [], lons = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      lats.push(+(south + ((north - south) * r) / (ROWS - 1)).toFixed(4));
      lons.push(+(west + ((east - west) * c) / (COLS - 1)).toFixed(4));
    }
  }

  const url = `${API}?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
    `&current=wind_speed_10m,wind_direction_10m&timeformat=unixtime&timezone=UTC`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`wind grid ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];

  // u is eastward, v is northward; direction is where the wind comes FROM
  const u = new Float32Array(COLS * ROWS);
  const v = new Float32Array(COLS * ROWS);
  let peak = 0;
  for (let i = 0; i < list.length && i < u.length; i++) {
    const spd = list[i]?.current?.wind_speed_10m ?? 0;
    const dir = list[i]?.current?.wind_direction_10m ?? 0;
    const rad = ((dir + 180) % 360) * Math.PI / 180;   // flip to "blowing toward"
    u[i] = Math.sin(rad) * spd;
    v[i] = Math.cos(rad) * spd;
    if (spd > peak) peak = spd;
  }
  return { u, v, cols: COLS, rows: ROWS, peak };
}

export function createWindLayer(canvas) {
  const ctx = canvas.getContext('2d');
  let field = null, parts = [], raf = null, W = 0, H = 0, running = false;

  /* Bilinear sample. Grid row 0 is the SOUTH edge, screen y 0 is the north, so
     the row index is flipped. */
  function sample(px, py) {
    if (!field) return [0, 0];
    const gx = (px / W) * (field.cols - 1);
    const gy = (1 - py / H) * (field.rows - 1);
    const x0 = Math.max(0, Math.min(field.cols - 1, Math.floor(gx)));
    const y0 = Math.max(0, Math.min(field.rows - 1, Math.floor(gy)));
    const x1 = Math.min(field.cols - 1, x0 + 1);
    const y1 = Math.min(field.rows - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0;

    const at = (x, y, arr) => arr[y * field.cols + x];
    const lerp = (a, b, t) => a + (b - a) * t;
    const u = lerp(lerp(at(x0, y0, field.u), at(x1, y0, field.u), fx),
                   lerp(at(x0, y1, field.u), at(x1, y1, field.u), fx), fy);
    const v = lerp(lerp(at(x0, y0, field.v), at(x1, y0, field.v), fx),
                   lerp(at(x0, y1, field.v), at(x1, y1, field.v), fx), fy);
    return [u, v];
  }

  const spawn = () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    age: Math.random() * MAX_AGE,
  });

  function step() {
    if (!running || !field) return;

    /* Fade rather than clear, so each particle leaves a short trail — that is
       what makes the flow legible instead of a swarm of dots. */
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';

    for (const p of parts) {
      const [u, v] = sample(p.x, p.y);
      const spd = Math.hypot(u, v);
      const nx = p.x + u * SPEED;
      const ny = p.y - v * SPEED;             // screen y grows downward

      if (p.age++ > MAX_AGE || nx < 0 || nx > W || ny < 0 || ny > H) {
        Object.assign(p, spawn(), { age: 0 });
        continue;
      }

      /* White, not speed-tinted. Colouring the streaks as well as the shading
         underneath meant two encodings of the same quantity fighting each
         other; plain white reads as motion over any base map and leaves speed
         to be told by the shading and by how far a particle travels. */
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.55 + Math.min(0.35, spd / 90);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();

      p.x = nx; p.y = ny;
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(step);
  }

  return {
    get peak() { return field?.peak ?? 0; },

    resize(w, h) {
      W = Math.max(1, Math.round(w));
      H = Math.max(1, Math.round(h));
      canvas.width = W;
      canvas.height = H;
      parts = Array.from({ length: PARTICLES }, spawn);
    },

    setField(f) {
      field = f;
      if (!parts.length) parts = Array.from({ length: PARTICLES }, spawn);
    },

    /* Speed shading, drawn once onto its own canvas beneath the particles.
       The particle layer fades itself every frame to make trails, so this
       cannot share that surface — it would be erased within a second.
       Rendered at grid resolution and scaled up with smoothing, which is what
       turns thirteen samples across into a continuous wash. */
    renderSpeedField(target) {
      if (!field) return;
      const small = document.createElement('canvas');
      small.width = field.cols;
      small.height = field.rows;
      const sctx = small.getContext('2d');
      const img = sctx.createImageData(field.cols, field.rows);

      for (let r = 0; r < field.rows; r++) {
        for (let c = 0; c < field.cols; c++) {
          const i = r * field.cols + c;
          const kmh = Math.hypot(field.u[i], field.v[i]);
          const [rr, gg, bb] = rampRGB(kmh);
          // grid row 0 is the south edge; image row 0 is the north
          const o = ((field.rows - 1 - r) * field.cols + c) * 4;
          img.data[o] = rr; img.data[o + 1] = gg; img.data[o + 2] = bb;
          img.data[o + 3] = 255;
        }
      }
      sctx.putImageData(img, 0, 0);

      target.width = Math.max(1, Math.round(W));
      target.height = Math.max(1, Math.round(H));
      const tctx = target.getContext('2d');
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = 'high';
      tctx.clearRect(0, 0, target.width, target.height);
      tctx.drawImage(small, 0, 0, target.width, target.height);
    },

    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(step);
    },

    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    },

    clear() { ctx.clearRect(0, 0, W, H); },

    legendStops: SPEED_RAMP.map(([kmh, rgb]) => ({ kmh, rgb })),
  };
}

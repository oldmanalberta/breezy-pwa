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
const SPEED = 0.55;       // screen px per frame per km/h

/* windy-ish ramp: calm teal through green and yellow to red for gales */
const RAMP = [
  [0, '#3fb3c8'], [12, '#4fc48b'], [24, '#c9d24a'],
  [40, '#f0a93b'], [60, '#e4643a'], [90, '#d4372f'],
];

function rampColour(kmh) {
  let a = RAMP[0], b = RAMP[RAMP.length - 1];
  for (let i = 0; i < RAMP.length - 1; i++) {
    if (kmh >= RAMP[i][0] && kmh <= RAMP[i + 1][0]) { a = RAMP[i]; b = RAMP[i + 1]; break; }
  }
  return kmh >= b[0] ? b[1] : a[1];
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

      ctx.strokeStyle = rampColour(spd);
      ctx.globalAlpha = 0.75;
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

    legendStops: RAMP.map(([kmh, hex]) => ({ kmh, hex })),
  };
}

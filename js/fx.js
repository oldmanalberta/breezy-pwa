/* Canvas weather effects behind the hero — Breezy's animated backgrounds,
   kept deliberately cheap so it doesn't chew battery on a phone. */

let raf = null, canvas = null, ctx = null;
let parts = [], kind = 'clouds', W = 0, H = 0, dpr = 1;
let running = false;
let opts = {}, extras = [];
/* Cross-fade: when the weather changes, the outgoing scene keeps moving and
   fades out while the new one fades in, rather than one replacing the other
   in a single frame. M is the opacity every draw call is multiplied by. */
const FADE_S = 1.6;
let fading = null, fadeT = 0, M = 1, sig = '';

const rand = (a, b) => a + Math.random() * (b - a);

/* Returns false when the canvas has no layout yet. On a phone the first paint
   can land before the sky element has been measured, and seeding a field into a
   zero-area canvas leaves it permanently empty with nothing to retry it. */
function resize() {
  if (!canvas || !ctx) return false;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;

  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = w; H = h;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  seed();
  return true;
}

function seed() {
  parts = [];
  const area = (W * H) / 1000;
  if (kind === 'rain') {
    for (let i = 0; i < Math.min(220, area * 0.5); i++)
      parts.push({ x: rand(0, W), y: rand(0, H), l: rand(9, 22), v: rand(420, 760), o: rand(.18, .5) });
  } else if (kind === 'snow') {
    for (let i = 0; i < Math.min(140, area * 0.34); i++)
      parts.push({ x: rand(0, W), y: rand(0, H), r: rand(1.2, 3.4), v: rand(22, 62), d: rand(0, 6.28), o: rand(.4, .9) });
  } else if (kind === 'stars') {
    for (let i = 0; i < Math.min(110, area * 0.26); i++)
      parts.push({ x: rand(0, W), y: rand(0, H * 0.72), r: rand(.5, 1.5), tw: rand(0, 6.28), sp: rand(.6, 2.2) });
  } else if (kind === 'fog') {
    for (let i = 0; i < 7; i++)
      parts.push({ x: rand(-W * .3, W), y: rand(H * .18, H * .82), w: rand(W * .5, W * 1.1), h: rand(46, 120), v: rand(4, 13), o: rand(.05, .13) });
  } else {
    for (let i = 0; i < 6; i++)
      parts.push({ x: rand(-W * .3, W), y: rand(H * .08, H * .55), w: rand(W * .35, W * .8), h: rand(30, 76), v: rand(5, 16), o: rand(.05, .12) });
  }
  extras = pickExtras().map((e) => ({ ...e, ps: e.seed() }));
}

function blob(p) {
  ctx.globalAlpha = (p.o) * M;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(p.x + p.w / 2, p.y, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

/* ── little extras ─────────────────────────────────
   Small touches layered over the base effect, picked from the weather, the
   season and the hour: falling leaves on a cool autumn day, petals in spring,
   fireflies on a warm summer night, a butterfly on a warm afternoon, the odd
   shooting star on a clear night, an aurora curtain when NOAA says it's up,
   lightning in a thunderstorm and diamond dust on a bitter clear day.
   Each is a handful of sprites at most, so the battery cost stays tiny. */

function crystal(x, y, size, rot) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, size);
    ctx.moveTo(0, size * .55); ctx.lineTo(size * .22, size * .75);
    ctx.moveTo(0, size * .55); ctx.lineTo(-size * .22, size * .75);
    ctx.stroke();
  }
  ctx.restore();
}

function leafShape(len, wid) {
  ctx.beginPath();
  ctx.moveTo(0, -len);
  ctx.quadraticCurveTo(wid, 0, 0, len);
  ctx.quadraticCurveTo(-wid, 0, 0, -len);
  ctx.fill();
}

const FALL = ['#E8762C', '#D9472B', '#F2B33D', '#B5562A', '#E89B2F'];
const SPRING = ['#FFD3E2', '#FFFFFF', '#FFC0D6', '#9FD98A', '#7CCB6A'];

const LEAVES = (palette, n, big) => ({
  seed: () => Array.from({ length: n }, () => ({
    x: rand(0, W), y: rand(-H, H), s: rand(.7, 1.2) * big, v: rand(28, 58),
    sw: rand(0, 6.28), sp: rand(.8, 1.8), rot: rand(0, 6.28), c: palette[Math.floor(rand(0, palette.length))],
  })),
  draw(ps, dt) {
    for (const p of ps) {
      p.sw += dt * p.sp; p.rot += dt * p.sp * .9;
      p.y += p.v * dt; p.x += Math.sin(p.sw) * 22 * dt + 8 * dt;
      if (p.y > H + 20) { p.y = -20; p.x = rand(-20, W); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.scale(1, .55 + .45 * Math.abs(Math.cos(p.sw)));   // tumbling
      ctx.globalAlpha = (.85) * M; ctx.fillStyle = p.c;
      leafShape(6 * p.s, 4.2 * p.s);
    }
  },
});

const FIREFLIES = {
  seed: () => Array.from({ length: 12 }, () => ({ x: rand(0, W), y: rand(H * .18, H * .5), a: rand(0, 6.28), ph: rand(0, 6.28), sp: rand(.6, 1.4) })),
  draw(ps, dt) {
    for (const p of ps) {
      p.a += rand(-1, 1) * dt * 2; p.ph += dt * p.sp;
      p.x += Math.cos(p.a) * 9 * dt; p.y += Math.sin(p.a) * 6 * dt;
      if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
      p.y = Math.max(H * .12, Math.min(H * .55, p.y));
      const glow = Math.max(0, Math.sin(p.ph));
      if (glow < .05) continue;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7);
      g.addColorStop(0, `rgba(230,255,140,${.9 * glow})`); g.addColorStop(1, 'rgba(230,255,140,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 6.28); ctx.fill();
    }
  },
};

const BUTTERFLY = {
  seed: () => [{ x: -30, y: H * .3, t: rand(2, 6), f: 0, c: Math.random() < .5 ? '#F2A33A' : '#FFFFFF', vy: 0 }],
  draw(ps, dt) {
    const p = ps[0];
    if (p.t > 0) { p.t -= dt; return; }                 // waits off-screen between visits
    p.f += dt * 14; p.x += 34 * dt; p.vy += rand(-60, 60) * dt; p.vy *= .96; p.y += p.vy * dt;
    p.y = Math.max(H * .1, Math.min(H * .45, p.y));
    if (p.x > W + 30) { p.x = -30; p.y = rand(H * .15, H * .4); p.t = rand(8, 18); }
    ctx.translate(p.x, p.y);
    const k = .35 + .65 * Math.abs(Math.sin(p.f));     // wing beat
    ctx.globalAlpha = (.9) * M; ctx.fillStyle = p.c;
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(side * 4.5 * k, -2.5, 4.5 * k, 4, side * .5, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.ellipse(side * 3.2 * k, 3, 3.2 * k, 2.6, -side * .4, 0, 6.28); ctx.fill();
    }
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-.7, -4, 1.4, 9);
  },
};

const SHOOTING = {
  seed: () => [{ t: rand(2, 6), life: 0 }],
  draw(ps, dt) {
    const p = ps[0];
    if (p.life <= 0) {
      p.t -= dt;
      if (p.t <= 0) Object.assign(p, { life: .9, x: rand(W * .2, W), y: rand(H * .04, H * .3), a: rand(2.6, 2.9), v: rand(380, 560) });
      return;
    }
    p.life -= dt; p.x += Math.cos(p.a) * p.v * dt; p.y -= Math.sin(p.a) * p.v * dt * -1;
    if (p.life <= 0) p.t = rand(6, 15);
    const tail = 70, tx = p.x - Math.cos(p.a) * tail, ty = p.y - Math.sin(p.a) * tail;
    const g = ctx.createLinearGradient(p.x, p.y, tx, ty);
    const o = Math.min(1, p.life * 2);
    g.addColorStop(0, `rgba(255,255,255,${o})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(tx, ty); ctx.stroke();
  },
};

/* A curtain of light along the top of the sky: vertical rays whose height
   ripples slowly, green at the base fading to violet. Brighter for a better
   chance. */
const AURORA = (strength) => ({
  seed: () => [{ t: 0 }],
  draw(ps, dt) {
    const p = ps[0]; p.t += dt;
    const base = H * .3, step = 2;
    for (let x = 0; x <= W; x += step) {
      const u = x / W;
      const wave = Math.sin(u * 7 + p.t * .5) * .5 + Math.sin(u * 13 - p.t * .8) * .3 + Math.sin(u * 3 + p.t * .2) * .6;
      const y0 = base + wave * H * .05;
      const h = H * (.16 + .14 * (Math.sin(u * 9 + p.t * .7) * .5 + .5));
      const g = ctx.createLinearGradient(0, y0, 0, y0 - h);
      const a = (.3 + .3 * strength) * (.75 + .25 * Math.sin(u * 11 + p.t * 1.3));
      g.addColorStop(0, `rgba(90,255,150,${a})`);
      g.addColorStop(.6, `rgba(80,220,170,${a * .5})`);
      g.addColorStop(1, `rgba(170,90,230,0)`);
      ctx.fillStyle = g; ctx.fillRect(x, y0 - h, step + .5, h);
    }
  },
});

const LIGHTNING = {
  seed: () => [{ t: rand(2, 6), f: 0, bolt: null }],
  draw(ps, dt) {
    const p = ps[0];
    p.t -= dt;
    if (p.t <= 0) {
      p.f = .45; p.t = rand(5, 13);
      // a jagged bolt from the top of the sky
      let x = rand(W * .15, W * .85), y = 0; p.bolt = [[x, y]];
      while (y < H * .42) { x += rand(-18, 18); y += rand(12, 26); p.bolt.push([x, y]); }
    }
    if (p.f <= 0) return;
    p.f -= dt;
    const o = p.f > .3 ? 1 : p.f / .3;
    ctx.fillStyle = `rgba(220,230,255,${.22 * o})`; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(255,255,255,${.85 * o})`; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    ctx.beginPath(); p.bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  },
};

const SPARKLE = {
  seed: () => Array.from({ length: 26 }, () => ({ x: rand(0, W), y: rand(0, H * .6), ph: rand(0, 6.28), sp: rand(1.5, 4), v: rand(4, 10) })),
  draw(ps, dt) {
    ctx.fillStyle = '#fff';
    for (const p of ps) {
      p.ph += dt * p.sp; p.y += p.v * dt;
      if (p.y > H * .6) { p.y = 0; p.x = rand(0, W); }
      const o = Math.max(0, Math.sin(p.ph)) ** 6;
      if (o < .05) continue;
      ctx.globalAlpha = (o) * M;
      ctx.fillRect(p.x - 2.5, p.y - .4, 5, .8); ctx.fillRect(p.x - .4, p.y - 2.5, .8, 5);
    }
  },
};

/* opts: { condition, night, temp, month (1–12), lat, aurora (0–100) } */
function pickExtras() {
  const o = opts, out = [];
  if (!o.month) return out;
  const north = (o.lat ?? 1) >= 0;
  const m = north ? o.month : ((o.month + 5) % 12) + 1;          // southern seasons flip
  const season = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'fall' : 'winter';
  const wet = kind === 'rain' || kind === 'snow';
  const tag = (id, e) => ({ ...e, id });
  const t = o.temp ?? 10;
  const clearish = ['clear', 'mainlyclear', 'partly'].includes(o.condition);

  if (/thunder|hail/.test(o.condition || '')) out.push(tag('lightning', LIGHTNING));
  if (o.night && (o.aurora ?? 0) >= 25 && !['overcast', 'cloudy', 'fog'].includes(o.condition) && !wet) out.push(tag(`aurora${Math.round(Math.min(1, o.aurora / 70) * 3)}`, AURORA(Math.min(1, o.aurora / 70))));
  if (o.night && kind === 'stars') out.push(tag('shooting', SHOOTING));
  if (!wet) {
    if (season === 'fall' && t < 16) out.push(tag('fall', LEAVES(FALL, 14, 1.7)));
    else if (season === 'spring' && t > 4 && !o.night) out.push(tag('spring', LEAVES(SPRING, 14, 1.2)));
    else if (season === 'summer' && o.night && t > 14) out.push(tag('fireflies', FIREFLIES));
    else if (season === 'summer' && !o.night && t > 16 && clearish) out.push(tag('butterfly', BUTTERFLY));
    if (!o.night && t <= -15 && clearish) out.push(tag('sparkle', SPARKLE));
  }
  return out;
}

let last = 0;
function frame(ts) {
  if (!running) return;
  const dt = Math.min((ts - last) / 1000 || 0, 0.05);
  last = ts;
  ctx.clearRect(0, 0, W, H);

  if (fading) {
    fadeT += dt;
    const f = Math.min(1, fadeT / FADE_S), ease = f * f * (3 - 2 * f);
    M = 1 - ease; drawScene(fading.kind, fading.parts, fading.extras, dt, ts);
    M = ease; drawScene(kind, parts, extras, dt, ts);
    if (f >= 1) fading = null;
  } else {
    M = 1; drawScene(kind, parts, extras, dt, ts);
  }
  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(frame);
}

function drawScene(kind, parts, extras, dt, ts) {
  if (!kind) return;
  if (kind === 'rain') {
    ctx.strokeStyle = '#cfe4f7'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    for (const p of parts) {
      ctx.globalAlpha = (p.o) * M;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.l * 0.22, p.y + p.l);
      ctx.stroke();
      p.y += p.v * dt; p.x -= p.v * dt * 0.22;
      if (p.y > H) { p.y = -20; p.x = rand(0, W * 1.2); }
    }
  } else if (kind === 'snow') {
    ctx.fillStyle = '#fff';
    for (const p of parts) {
      p.d += dt * 1.1;
      ctx.globalAlpha = (p.o) * M;
      if (p.r > 3.1) crystal(p.x + Math.sin(p.d) * 9, p.y, p.r * 2.2, p.d * .4);
      else {
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(p.d) * 9, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      p.y += p.v * dt;
      if (p.y > H + 6) { p.y = -6; p.x = rand(0, W); }
    }
  } else if (kind === 'stars') {
    ctx.fillStyle = '#fff';
    for (const p of parts) {
      p.tw += dt * p.sp;
      ctx.globalAlpha = (0.35 + Math.sin(p.tw) * 0.32) * M;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (const p of parts) {
      blob(p);
      p.x += p.v * dt;
      if (p.x > W + 40) p.x = -p.w - 40;
    }
  }
  for (const e of extras) { ctx.save(); ctx.globalAlpha = M; e.draw(e.ps, dt, ts); ctx.restore(); }
}

let wantOn = false, retry = null;

export function startFx(el, newKind, enabled = true, extra = {}) {
  if (!el) return;
  // re-acquire the context if the canvas element itself changed
  if (el !== canvas) { canvas = el; ctx = canvas.getContext('2d'); }
  ctx = ctx || canvas.getContext('2d');
  clearTimeout(retry);

  /* Already running and asked again (every refresh repaints): keep the scene
     if nothing about it would change, otherwise fade across to the new one. */
  if (running && enabled) {
    const prev = { kind, parts, extras };
    kind = newKind; opts = extra || {};
    const next = sceneSig();
    if (next === sig) { kind = prev.kind; return; }
    fading = prev; fadeT = 0; sig = next;
    seed();
    return;
  }

  kind = newKind;
  opts = extra || {};
  wantOn = !!enabled;

  stopFx();

  /* The OS "Reduce Motion" preference used to veto this outright, which made
     the settings toggle look broken: switching it on changed nothing and said
     nothing. It is a default, not an override — asking for the animation in
     this app's own settings is a more specific instruction than a system-wide
     preference, so an explicit On wins. iOS enables Reduce Motion far more
     often than people realise, including via some battery and accessibility
     profiles, which is why this only ever failed on the phone. */
  if (!wantOn) {
    if (W && H) ctx.clearRect(0, 0, W, H);
    return;
  }

  if (!resize()) {
    // no layout yet — try again once the browser has measured the element
    retry = setTimeout(() => startFx(el, newKind, enabled, extra), 120);
    return;
  }

  sig = sceneSig();
  fading = { kind: null, parts: [], extras: [] }; fadeT = 0;   // fade in from an empty sky
  running = true;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

/* What makes one scene different from another: the base effect and which
   extras it carries. Temperature or wind drifting within the same scene is
   not worth restarting the particles for. */
function sceneSig() {
  return kind + '|' + pickExtras().map((e) => e.id).join(',');
}

/* Whether the animation should be running, for callers that need to restart it
   without knowing the setting themselves. */
export const fxEnabled = () => wantOn;

export function stopFx() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = null;
}

window.addEventListener('resize', () => { if (running) resize(); });

/* Coming back from the background needs a re-measure, not just a restart: iOS
   hides and reveals the URL bar and rotates behind your back, so the canvas is
   frequently a different size than when it was suspended. Restarting against
   stale dimensions drew into a region no longer on screen. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopFx(); return; }
  if (!canvas || !kind || !wantOn) return;
  if (!resize()) return;
  running = true;
  last = performance.now();
  raf = requestAnimationFrame(frame);
});

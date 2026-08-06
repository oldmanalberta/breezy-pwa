/* Canvas weather effects behind the hero — Breezy's animated backgrounds,
   kept deliberately cheap so it doesn't chew battery on a phone. */

let raf = null, canvas = null, ctx = null;
let parts = [], kind = 'clouds', W = 0, H = 0, dpr = 1;
let running = false;

const rand = (a, b) => a + Math.random() * (b - a);

function resize() {
  if (!canvas) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = canvas.clientWidth; H = canvas.clientHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  seed();
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
}

function blob(p) {
  ctx.globalAlpha = p.o;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(p.x + p.w / 2, p.y, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

let last = 0;
function frame(ts) {
  if (!running) return;
  const dt = Math.min((ts - last) / 1000 || 0, 0.05);
  last = ts;
  ctx.clearRect(0, 0, W, H);

  if (kind === 'rain') {
    ctx.strokeStyle = '#cfe4f7'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    for (const p of parts) {
      ctx.globalAlpha = p.o;
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
      ctx.globalAlpha = p.o;
      ctx.beginPath();
      ctx.arc(p.x + Math.sin(p.d) * 9, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      p.y += p.v * dt;
      if (p.y > H + 6) { p.y = -6; p.x = rand(0, W); }
    }
  } else if (kind === 'stars') {
    ctx.fillStyle = '#fff';
    for (const p of parts) {
      p.tw += dt * p.sp;
      ctx.globalAlpha = 0.35 + Math.sin(p.tw) * 0.32;
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
  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(frame);
}

export function startFx(el, newKind, enabled = true) {
  canvas = el;
  if (!canvas) return;
  ctx = ctx || canvas.getContext('2d');
  kind = newKind;

  stopFx();
  if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ctx.clearRect(0, 0, W, H);
    return;
  }
  resize();
  running = true;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

export function stopFx() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = null;
}

window.addEventListener('resize', () => { if (running) resize(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopFx();
  else if (canvas && kind) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
});

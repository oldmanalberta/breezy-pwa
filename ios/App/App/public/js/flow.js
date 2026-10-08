/* Motion-compensated radar interpolation.
 *
 * ECCC publishes a radar scan every 6 minutes. Played back directly that is a
 * slideshow, and cross-fading only dissolves one still into the next — a squall
 * line fades out in the old position and in at the new one rather than moving.
 *
 * Every in-between image is made from the two real scans either side of it:
 *
 *   1. Read each scan back as precipitation LEVELS, not colours. The radar
 *      PNG is drawn with the legend's colour ramp (a smooth gradient from pale
 *      blue through green, yellow and red to purple), so each pixel's colour
 *      is looked up along that ramp, taken from ECCC's own legend graphic, to
 *      give how far up the scale it sits.
 *   2. Work out where the precipitation went between the two scans by
 *      matching those level maps, coarse to fine (CPU, on a small grid).
 *   3. On the GPU, carry scan A forward and scan B back along that motion to
 *      the in-between moment, interpolate the LEVEL at each pixel, and paint
 *      it with the legend colour for that level.
 *
 * Interpolating levels rather than mixing RGB is what keeps the in-betweens
 * looking like radar. Mixing colours made shades that are not on the legend
 * and half-transparent ghosts wherever a cell grew or died; this way every
 * pixel on screen is a colour from the legend with a clean edge, a cell that
 * is weakening slides down the scale, and one that is building climbs it.
 *
 * Layers without a legend ramp (the softened smoke field) keep the plain
 * warp-and-blend.
 *
 * Block matching is a deliberately modest choice over a full variational
 * optical flow solve: radar advection over a small map is close to locally
 * uniform translation. It will not capture rotation, which the level
 * interpolation absorbs as growth on one side and decay on the other.
 */

export const hasWebGL2 = () => {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
};

/* ── legend palettes ──────────────────────────────── */

export const MAX_LEVELS = 512;

/* Pull the colour ramp out of a GeoMet legend graphic, in the order it is
   drawn. Each row of the colour bar is one solid colour several pixels wide;
   label text is thin and antialiased, so taking each row's longest run of
   identical, coloured pixels reads the bar without knowing the layout. That
   works for a bar of discrete swatches and for the continuous gradient ECCC
   actually draws its radar with — an earlier version expected swatches,
   collected only the first 32 colours from the top of a 338-step gradient,
   and matched none of the radar. ECCC lists its ramp heavy-first; the ramp
   is turned so it always runs light to heavy, judging by which end is
   lighter, since every precipitation scale starts pale. */
export async function loadLegendPalette(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`legend ${r.status}`);
  const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return paletteFromPixels(ctx.getImageData(0, 0, c.width, c.height));
}

export function paletteFromPixels({ data, width, height }) {
  const RUN = 6;
  const out = [];
  let last = -1;
  for (let y = 0; y < height; y++) {
    let run = 0, prev = -1, best = -1, bestRun = 0;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const key = data[p + 3] > 250 ? (r << 16) | (g << 8) | b : -1;
      run = key === prev ? run + 1 : 1;
      prev = key;
      if (key < 0 || run < RUN || run <= bestRun) continue;
      // background and label ink: near-white, and greys with no hue
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      if (lo > 235 || (hi - lo < 18 && hi < 200)) continue;
      best = key; bestRun = run;
    }
    if (best < 0 || best === last) continue;
    last = best;
    out.push([best >> 16, (best >> 8) & 255, best & 255]);
  }
  if (out.length > MAX_LEVELS) out.length = MAX_LEVELS;
  const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
  if (out.length > 1 && lum(out[0]) < lum(out.at(-1))) out.reverse();
  return { colors: out };
}

/* Rain and snow can share one ramp (ECCC's do); one copy is then enough, and
   two would make every colour ambiguous between them. */
function sameRamp(a, b) {
  return a.colors.length === b.colors.length
    && a.colors.every((c, i) => c.join() === b.colors[i].join());
}

/* Nearest legend entry for a colour, as 1-based level (0 = no echo). */
function makeClassifier(ramps) {
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = Infinity;
    hit = 0;
    ramps.forEach((ramp, k) => {
      ramp.colors.forEach(([pr, pg, pb], i) => {
        const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
        if (d < best) { best = d; hit = { ramp: k, level: i + 1, n: ramp.colors.length, d }; }
      });
    });
    cache.set(key, hit);
    return hit;
  };
}

/* ── level maps (CPU) ─────────────────────────────── */

const FINE_W = 96;          // grid the motion is resolved on
const COARSE = 3;           // fine cells per coarse cell
const CLASS_SAMPLES = 2;    // classified samples per fine cell, each way

/* Reduce a composited frame to a small map of precipitation intensity, 0..1.
   With ramps, intensity is the legend level, which gives the inside of a storm
   texture to match on; alpha alone is flat across the whole echo, so matching
   on it could only ever see the outline. */
function levelMap(source, gw, gh, scratch, classify, stats) {
  const sw = gw * CLASS_SAMPLES, sh = gh * CLASS_SAMPLES;
  scratch.width = sw; scratch.height = sh;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, sw, sh);
  // nearest sampling: averaged colours would classify as the wrong level
  ctx.imageSmoothingEnabled = !classify;
  ctx.drawImage(source, 0, 0, sw, sh);
  const d = ctx.getImageData(0, 0, sw, sh).data;

  const out = new Float32Array(gw * gh);
  const k = 1 / (CLASS_SAMPLES * CLASS_SAMPLES);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const p = (y * sw + x) * 4;
      if (d[p + 3] < 128) continue;
      let v = d[p + 3] / 255;
      if (classify) {
        const c = classify(d[p], d[p + 1], d[p + 2]);
        if (!c) continue;
        v = c.level / c.n;
        stats.total++;
        if (c.d > 900) stats.misses++;            // > ~30 RGB units from any entry
      }
      out[((y / CLASS_SAMPLES) | 0) * gw + ((x / CLASS_SAMPLES) | 0)] += v * k;
    }
  }
  return out;
}

/* A frame at full size as legend positions for the GPU: R is how far up the
   ramp the pixel sits, G repeats R when that ramp is the second one (snow),
   and B is whether there is echo at all. Filtering blends all three toward
   zero at an echo's edge, so the shader divides by B to recover the real
   level and decides the edge from B alone. Deciding it from the level instead
   let every faint pixel bleed into its neighbours: on a 338-step gradient
   "anything above half a step" is almost everything. */
function levelPixels(source, scratch, classify) {
  const w = source.width, h = source.height;
  scratch.width = w; scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  let lastKey = -1, lastV = 0, lastG = 0;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (d[p + 3] < 128) continue;
    const key = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2];
    if (key !== lastKey) {
      const c = classify(d[p], d[p + 1], d[p + 2]);
      lastKey = key;
      lastV = c ? Math.max(1, Math.round((c.level / c.n) * 255)) : 0;
      lastG = c && c.ramp ? lastV : 0;
    }
    if (!lastV) continue;
    out[i * 4] = lastV;
    out[i * 4 + 1] = lastG;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function downsample(a, gw, gh, f) {
  const cw = Math.ceil(gw / f), ch = Math.ceil(gh / f);
  const out = new Float32Array(cw * ch), n = new Float32Array(cw * ch);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = ((y / f) | 0) * cw + ((x / f) | 0);
      out[i] += a[y * gw + x]; n[i]++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= n[i];
  return { map: out, w: cw, h: ch };
}

/* ── flow estimation (CPU) ────────────────────────── */

const BLOCK = 3;            // half-size of the patch compared
const COARSE_SEARCH = 8;    // coarse cells — about a quarter of the view
const FINE_SEARCH = 2;      // fine cells either side of the coarse estimate
const SMOOTH_PASSES = 2;
const OUTLIER = 2.5;        // cells away from the storm's overall motion

/* Mean absolute difference between patches centred at (ax,ay) and (bx,by).
   Beyond the edge of the map B counts as empty rather than being left out.
   Leaving it out meant a patch shifted mostly off the map was compared on a
   handful of empty pixels, scored a near-perfect match, and dragged the echo
   toward the edge at speed — the "fast and backwards" motion seen after
   zooming out, where many small cells sit near the edges. */
function sad(a, b, gw, gh, ax, ay, bx, by) {
  let s = 0, n = 0;
  for (let dy = -BLOCK; dy <= BLOCK; dy++) {
    const ya = ay + dy, yb = by + dy;
    if (ya < 0 || ya >= gh) continue;
    const yIn = yb >= 0 && yb < gh;
    for (let dx = -BLOCK; dx <= BLOCK; dx++) {
      const xa = ax + dx, xb = bx + dx;
      if (xa < 0 || xa >= gw) continue;
      const vb = yIn && xb >= 0 && xb < gw ? b[yb * gw + xb] : 0;
      s += Math.abs(a[ya * gw + xa] - vb);
      n++;
    }
  }
  return n ? s / n : Infinity;
}

/* Patch energy: is there anything here to match at all? */
function mass(a, gw, gh, x, y) {
  let s = 0;
  for (let dy = -BLOCK; dy <= BLOCK; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= gh) continue;
    for (let dx = -BLOCK; dx <= BLOCK; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < gw) s += a[yy * gw + xx];
    }
  }
  return s;
}

/* Refine a best match to a fraction of a cell from the costs either side of
   it. A storm moving 5 km in a scan is under one cell at most zooms, and
   whole-cell answers snapped it between standing still and jumping, which
   read as a stutter. */
function subcell(m, c0, p) {
  const den = m - 2 * c0 + p;
  if (!Number.isFinite(den) || den <= 1e-9) return 0;
  return Math.max(-0.5, Math.min(0.5, (m - p) / (2 * den)));
}

/* Best displacement for each cell within `search` of a starting guess, plus a
   confidence: how much better that match is than standing still. */
function match(a, b, gw, gh, search, guess, limit = Infinity) {
  const vec = new Float32Array(gw * gh * 2);
  const conf = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (mass(a, gw, gh, x, y) < 0.05) continue;
      const gx = guess ? Math.round(guess[i * 2]) : 0;
      const gy = guess ? Math.round(guess[i * 2 + 1]) : 0;
      let best = Infinity, bdx = gx, bdy = gy;
      for (let dy = gy - search; dy <= gy + search; dy++) {
        for (let dx = gx - search; dx <= gx + search; dx++) {
          if (Math.hypot(dx, dy) > limit + 0.5) continue;
          // bias slightly toward the guess so ties resolve to it
          const e = sad(a, b, gw, gh, x, y, x + dx, y + dy)
            + Math.hypot(dx - gx, dy - gy) * 0.002;
          if (e < best) { best = e; bdx = dx; bdy = dy; }
        }
      }
      const stay = sad(a, b, gw, gh, x, y, x, y);
      const gain = stay > 1e-6 ? (stay - best) / stay : 0;
      const c0 = sad(a, b, gw, gh, x, y, x + bdx, y + bdy);
      vec[i * 2] = bdx + subcell(sad(a, b, gw, gh, x, y, x + bdx - 1, y + bdy), c0,
        sad(a, b, gw, gh, x, y, x + bdx + 1, y + bdy));
      vec[i * 2 + 1] = bdy + subcell(sad(a, b, gw, gh, x, y, x + bdx, y + bdy - 1), c0,
        sad(a, b, gw, gh, x, y, x + bdx, y + bdy + 1));
      conf[i] = Math.max(0, Math.min(1, gain * 2.5));
    }
  }
  return { vec, conf };
}

function median(xs) {
  if (!xs.length) return 0;
  const s = Float32Array.from(xs).sort();
  return s[s.length >> 1];
}

/* Fill in cells the matcher could not vouch for with the motion of the storm
   as a whole. Precipitation fields mostly drift together with the steering
   wind, so "same as everything around it" is a far better guess than "not
   moving". Empty cells matter too: echo that only exists in the second scan —
   the leading edge of a band sliding into view — is placed using the motion
   at its own position, and a zero there pinned it in place to fade in.
   `hint`, when given, replaces the storm motion this pair would infer for
   itself (see the steadying pass in build). */
function settle(vec, conf, gw, gh, hint = null) {
  const xs = [], ys = [];
  for (let i = 0; i < conf.length; i++) {
    if (conf[i] > 0.4) { xs.push(vec[i * 2]); ys.push(vec[i * 2 + 1]); }
  }
  const support = xs.length;
  const px = hint ? hint[0] : support >= 4 ? median(xs) : 0;
  const py = hint ? hint[1] : support >= 4 ? median(ys) : 0;
  let field = new Float32Array(gw * gh * 2);
  for (let i = 0; i < conf.length; i++) {
    /* A vector far out of step with the rest of the storm is almost always a
       false match — a decaying cell resembling a weaker patch somewhere else —
       and warping along it tears the echo apart. */
    const off = Math.hypot(vec[i * 2] - px, vec[i * 2 + 1] - py);
    const c = off > OUTLIER ? 0 : conf[i];
    field[i * 2] = vec[i * 2] * c + px * (1 - c);
    field[i * 2 + 1] = vec[i * 2 + 1] * c + py * (1 - c);
  }
  for (let i = 0; i < SMOOTH_PASSES; i++) field = boxSmooth(field, gw, gh);
  return { field, prior: [px, py], support };
}

function boxSmooth(field, gw, gh) {
  const out = new Float32Array(field.length);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let sx = 0, sy = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= gh || xx < 0 || xx >= gw) continue;
          sx += field[(yy * gw + xx) * 2];
          sy += field[(yy * gw + xx) * 2 + 1];
          n++;
        }
      }
      out[(y * gw + x) * 2] = sx / n;
      out[(y * gw + x) * 2 + 1] = sy / n;
    }
  }
  return out;
}

/* Motion from frame A to frame B, as a gw*gh field of UV-space vectors.
   Coarse to fine: a coarse pass finds large moves cheaply (a fast band at a
   close zoom crosses a good part of the view in six minutes), and the fine
   pass sharpens it locally.

   `maxShift` is the furthest precipitation can physically travel between the
   two scans, as a fraction of the view's width. Zoomed out, that is a cell or
   two; letting the search roam a quarter of the view there only gives a busy
   field of showers the chance to match the wrong shower.

   `hint` is the storm's overall motion for this pair in fine cells, to use in
   place of the pair's own estimate. Returns the field with that overall
   motion and how many cells backed it. Exported so it can be checked against
   a known displacement. */
export function estimateFlow(a, b, gw, gh, maxShift = Infinity, hint = null) {
  const limit = Math.max(1, maxShift * gw);          // in fine cells
  const A = downsample(a, gw, gh, COARSE), B = downsample(b, gw, gh, COARSE);
  const coarseLimit = Math.max(1, limit / COARSE);
  const coarse = match(A.map, B.map, A.w, A.h,
    Math.min(COARSE_SEARCH, Math.ceil(coarseLimit)), null, coarseLimit);
  const cs = settle(coarse.vec, coarse.conf, A.w, A.h,
    hint && [hint[0] / COARSE, hint[1] / COARSE]);

  const guess = new Float32Array(gw * gh * 2);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const ci = Math.min(A.h - 1, (y / COARSE) | 0) * A.w + Math.min(A.w - 1, (x / COARSE) | 0);
      guess[(y * gw + x) * 2] = cs.field[ci * 2] * COARSE;
      guess[(y * gw + x) * 2 + 1] = cs.field[ci * 2 + 1] * COARSE;
    }
  }
  const fine = match(a, b, gw, gh, FINE_SEARCH, guess, limit);
  // where the fine pass found nothing to match, carry the coarse estimate
  for (let i = 0; i < fine.conf.length; i++) {
    if (fine.conf[i] === 0 && fine.vec[i * 2] === 0 && fine.vec[i * 2 + 1] === 0) {
      fine.vec[i * 2] = guess[i * 2]; fine.vec[i * 2 + 1] = guess[i * 2 + 1];
      fine.conf[i] = 0.5;
    }
  }
  const { field, prior, support } = settle(fine.vec, fine.conf, gw, gh, hint);

  for (let i = 0; i < gw * gh; i++) {
    const m = Math.hypot(field[i * 2], field[i * 2 + 1]);
    const k = m > limit ? limit / m : 1;
    field[i * 2] *= k / gw;
    field[i * 2 + 1] *= k / gh;
  }
  return { field, prior, support };
}

/* Mean difference between two level maps: is the later scan new data at all? */
function mapDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/* ── GL ───────────────────────────────────────────── */

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uA;      // mode 0: colours; mode 1: legend positions
uniform sampler2D uB;
uniform sampler2D uFlow;
uniform sampler2D uRamp;   // the legend ramps, one row each
uniform float uT;          // 0..1 between A and B
uniform float uOpacity;
uniform float uStrength;   // how much of the estimated motion to apply
uniform int uMode;         // 0 = blend colours, 1 = interpolate legend levels
uniform float uN0;         // entries in each ramp
uniform float uN1;
uniform float uRampW;      // ramp texture width

void main() {
  vec2 flow = texture(uFlow, vUv).rg * uStrength;

  // Carry A forward along the motion and B back along it, so both land on
  // where the echo should be at time uT.
  vec4 a = texture(uA, vUv - flow * uT);
  vec4 b = texture(uB, vUv + flow * (1.0 - uT));

  if (uMode == 0) {
    vec4 c = mix(a, b, uT);
    // warping can drag faint halos out of nothing; drop them rather than smear
    if (c.a < 0.06) discard;
    fragColor = vec4(c.rgb, c.a * uOpacity);
    return;
  }

  /* Echo where the two scans, carried to this moment, agree there is some.
     Where only one has it — a cell forming or dying, an edge advancing — it
     shows from halfway, at half its level, so it grows in or dwindles out. */
  if (mix(a.b, b.b, uT) < 0.5) discard;
  float la = a.b > 0.0 ? a.r / a.b : 0.0;
  float lb = b.b > 0.0 ? b.r / b.b : 0.0;
  float level = mix(la, lb, uT);

  // rain or snow: whichever scan is nearer in time, unless only one has echo
  float sa = a.r > 0.0 ? a.g / a.r : -1.0;
  float sb = b.r > 0.0 ? b.g / b.r : -1.0;
  float snow = sa < 0.0 ? sb : sb < 0.0 ? sa : (uT < 0.5 ? sa : sb);
  float row = snow > 0.5 ? 1.0 : 0.0;
  float n = row > 0.5 ? uN1 : uN0;

  float idx = level * n;            // 1-based position along the ramp
  vec3 c = texture(uRamp, vec2((clamp(idx, 1.0, n) - 0.5) / uRampW, (row + 0.5) / 2.0)).rgb;
  fragColor = vec4(c, uOpacity);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

export function createFlowRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true, premultipliedAlpha: false, antialias: false,
  });
  if (!gl) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {
    a: gl.getUniformLocation(prog, 'uA'),
    b: gl.getUniformLocation(prog, 'uB'),
    flow: gl.getUniformLocation(prog, 'uFlow'),
    t: gl.getUniformLocation(prog, 'uT'),
    opacity: gl.getUniformLocation(prog, 'uOpacity'),
    strength: gl.getUniformLocation(prog, 'uStrength'),
    mode: gl.getUniformLocation(prog, 'uMode'),
    ramp: gl.getUniformLocation(prog, 'uRamp'),
    n0: gl.getUniformLocation(prog, 'uN0'),
    n1: gl.getUniformLocation(prog, 'uN1'),
    rampW: gl.getUniformLocation(prog, 'uRampW'),
  };
  gl.uniform1i(U.a, 0);
  gl.uniform1i(U.b, 1);
  gl.uniform1i(U.flow, 2);
  gl.uniform1i(U.ramp, 3);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  /* frameTex holds only the scans that are new data; keys[k] is the frame
     index each one belongs to, and flowTex[k] runs from key k to key k+1. */
  let frameTex = [], flowTex = [], keys = [], total = 0;
  let opacity = 0.9, strength = 1, mode = 0, rampTex = null;
  let lastReport = '';

  function makeTex(source, linear = true) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  }

  /* Flow is stored as half floats rather than packed into bytes: at a
     2048px frame, byte precision quantised every vector to ~4px steps, which
     shows as a faint shimmer on a slowly drifting edge. RG16F is filterable
     in core WebGL2, so it still interpolates smoothly between grid cells. */
  function makeFlowTex(field, w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.FLOAT, field);
    return t;
  }

  /* Legend positions (see levelPixels). Filtered, so an echo's edge comes
     out smooth instead of stair-stepped when it is carried along. */
  function makeLevelTex(px, w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return t;
  }

  /* Both ramps as a 2-row texture, filtered along its length, so a level
     between two legend entries is painted with the colour between them. */
  function setRamps(ramps) {
    const n0 = ramps[0]?.colors.length ?? 0, n1 = ramps[1]?.colors.length ?? n0;
    const rw = Math.max(1, n0, n1);
    const px = new Uint8Array(rw * 2 * 4);
    [ramps[0], ramps[1] ?? ramps[0]].forEach((r, row) => {
      (r?.colors ?? []).forEach(([cr, cg, cb], i) => px.set([cr, cg, cb, 255], (row * rw + i) * 4));
    });
    if (rampTex) gl.deleteTexture(rampTex);
    rampTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rampTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.uniform1f(U.n0, n0);
    gl.uniform1f(U.n1, n1);
    gl.uniform1f(U.rampW, rw);
  }

  function clearTextures() {
    for (const t of frameTex) gl.deleteTexture(t);
    for (const t of flowTex) gl.deleteTexture(t);
    frameTex = []; flowTex = []; keys = []; total = 0;
  }

  return {
    get frameCount() { return total; },

    /* What the last build decided, for the radar diagnostics toasts. */
    get report() { return lastReport; },

    setOpacity(v) { opacity = v; },

    /* 1 applies the full estimated motion; lower values ease toward a plain
       blend, which is steadier when the estimate is noisy. */
    setStrength(v) { strength = Math.max(0, Math.min(1, v)); },

    /* `composites` are canvases/bitmaps, one per time step, already merged.
     * `ramps` are the legend palettes the frames were drawn with (rain, snow);
     * without them the frames are blended as colours. `maxShifts[i]` caps the
     * motion between frames i and i+1 (see estimateFlow).
     *
     * Builds into local arrays and only swaps them in at the very end. An
     * earlier version cleared the textures up front, so a zoom that arrived
     * mid-build left the radar permanently blank — the old frames were gone
     * and the new ones never committed. `shouldAbort` lets a superseded build
     * bail without touching what is currently on screen.
     */
    async build(composites, onProgress, shouldAbort = () => false, ramps = null, maxShifts = []) {
      if (!composites.length) return false;

      const w = composites[0].width, h = composites[0].height;
      const nextFrames = [], nextFlow = [];
      let nextKeys = [];
      const discard = () => {
        for (const t of nextFrames) gl.deleteTexture(t);
        for (const t of nextFlow) gl.deleteTexture(t);
      };
      const usable = [];
      for (const r of ramps ?? []) {
        if (r?.colors.length >= 3 && !usable.some((u) => sameRamp(u, r))) usable.push(r);
      }
      let levels = usable.length > 0;

      try {
        const gw = FINE_W;
        const gh = Math.max(12, Math.round(FINE_W * (h / w)));
        const scratch = document.createElement('canvas');

        const stats = { total: 0, misses: 0 };
        const classify = levels ? makeClassifier(usable) : null;
        const maps = [];
        for (const c of composites) {
          maps.push(levelMap(c, gw, gh, scratch, classify, stats));
          await new Promise((r) => setTimeout(r, 0));
        }

        /* If a good share of the echo matches nothing on the legend, the
           frames were not drawn with these ramps — a changed GeoMet style, or
           a legend that did not parse. Interpolating levels would then paint
           the wrong colours, so fall back to blending what is there. */
        if (levels && stats.total > 500 && stats.misses / stats.total > 0.1) {
          levels = false;
          lastReport = `legend mismatch (${Math.round((stats.misses / stats.total) * 100)}% unmatched), blending colours`;
          for (let i = 0; i < maps.length; i++) maps[i] = levelMap(composites[i], gw, gh, scratch, null, stats);
        } else if (levels) {
          lastReport = `legend levels ${usable.map((r) => r.colors.length).join('+')}`;
        } else {
          lastReport = 'no legend, blending colours';
        }

        /* Scans that repeat the one before are not new data — the composite
           had not updated yet. Treated as frames in their own right they gave
           a pair with no motion (the echo stalls) followed by a pair carrying
           two scans' worth (it lurches). Interpolating across them instead
           spreads the real motion evenly over the time it took. */
        nextKeys = [0];
        for (let i = 1; i < maps.length; i++) {
          if (mapDiff(maps[i], maps[nextKeys.at(-1)]) > 2e-5) nextKeys.push(i);
        }
        const repeats = maps.length - nextKeys.length;

        for (const k of nextKeys) {
          if (shouldAbort()) { discard(); return false; }
          nextFrames.push(levels
            ? makeLevelTex(levelPixels(composites[k], scratch, classify), w, h)
            : makeTex(composites[k]));
          await new Promise((r) => setTimeout(r, 0));
        }

        const span = (s) => nextKeys[s + 1] - nextKeys[s];
        const reach = (s) => {
          let m = 0;
          for (let i = nextKeys[s]; i < nextKeys[s + 1]; i++) m += maxShifts[i] ?? Infinity;
          return m;
        };
        const pairs = nextKeys.length - 1;
        const flows = [];
        for (let s = 0; s < pairs; s++) {
          if (shouldAbort()) { discard(); return false; }
          flows.push(estimateFlow(maps[nextKeys[s]], maps[nextKeys[s + 1]], gw, gh, reach(s)));
          onProgress?.((s + 1) / (pairs + 1));
          // yield so the loading UI can paint between pairs
          await new Promise((r) => setTimeout(r, 0));
        }

        /* Precipitation keeps a steady course over an hour. A pair whose own
           estimate had little to go on, or disagrees sharply with the rest,
           made the loop crawl through one interval and race through the
           next; those pairs are redone with the storm's motion over the whole
           loop instead. */
        const backed = flows.map((f, s) => ({ f, s })).filter(({ f }) => f.support >= 12);
        let steadied = 0;
        if (backed.length >= 2) {
          const rate = [0, 1].map((k) => median(backed.map(({ f, s }) => f.prior[k] / span(s))));
          for (let s = 0; s < pairs; s++) {
            const f = flows[s], n = span(s);
            const want = [rate[0] * n, rate[1] * n];
            const off = Math.hypot(f.prior[0] - want[0], f.prior[1] - want[1]);
            if (f.support >= 12 && off <= Math.max(1, 0.35 * Math.hypot(...want))) continue;
            if (shouldAbort()) { discard(); return false; }
            flows[s] = estimateFlow(maps[nextKeys[s]], maps[nextKeys[s + 1]], gw, gh, reach(s), want);
            steadied++;
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        for (const f of flows) nextFlow.push(makeFlowTex(f.field, gw, gh));
        onProgress?.(1);

        lastReport += `; ${pairs} motion pairs`
          + `${repeats ? `, ${repeats} repeated scan${repeats > 1 ? 's' : ''} bridged` : ''}`
          + `${steadied ? `, ${steadied} steadied` : ''}`;
      } catch (e) {
        discard();
        throw e;
      }

      if (shouldAbort()) { discard(); return false; }

      clearTextures();
      frameTex = nextFrames;
      flowTex = nextFlow;
      keys = nextKeys;
      total = composites.length;
      mode = levels ? 1 : 0;
      setRamps(levels ? usable : []);
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      return true;
    },

    /* i = frame index, t = 0..1 toward the next frame. Mapped onto the scans
       that are new data, so time between them advances evenly. */
    draw(i, t) {
      if (!frameTex.length) return;
      const pos = Math.max(0, Math.min(total - 1, i + Math.max(0, Math.min(1, t))));
      let k = 0;
      while (k < keys.length - 1 && keys[k + 1] <= pos) k++;
      const last = keys.length - 1;
      const b = Math.min(last, k + 1);
      // past the newest new scan there is nothing to move toward: hold it
      const tt = k === b ? 0 : (pos - keys[k]) / (keys[b] - keys[k]);
      const f = flowTex[Math.min(k, flowTex.length - 1)];

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!f && k !== b) return;

      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, frameTex[k]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, frameTex[b]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, f ?? null);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, rampTex);
      gl.uniform1f(U.t, Math.max(0, Math.min(1, tt)));
      gl.uniform1f(U.opacity, opacity);
      gl.uniform1f(U.strength, strength);
      gl.uniform1i(U.mode, mode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    /* Did the last draw actually put anything on the buffer?
     *
     * WebGL can fail silently — a lost context, an exhausted texture budget, a
     * driver that refuses a large upload — and the result is a blank canvas
     * with no thrown error and no GL error code. Since the caller knows
     * independently whether the frames contain echo, comparing that against
     * what actually rasterised is the only reliable way to catch it. Must be
     * called in the same task as a draw: without preserveDrawingBuffer the
     * buffer is cleared once the frame is composited.
     */
    probe(i = 0) {
      if (!frameTex.length) return 0;
      this.draw(i, 0);
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return 0;
      /* Read the whole buffer, not a band. Precipitation is frequently off to
         one side of the view — a first attempt sampled only the middle rows and
         reported "nothing rendered" for a perfectly good frame whose echo sat
         north of centre, which would have disabled WebGL for no reason. */
      const px = new Uint8Array(w * h * 4);
      try { gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      catch { return -1; }                 // unreadable: don't claim failure
      let hits = 0;
      for (let p = 3; p < px.length; p += 4 * 7) if (px[p] > 8) hits++;
      return hits;
    },

    get contextLost() { return gl.isContextLost(); },

    destroy() {
      clearTextures();
      if (rampTex) gl.deleteTexture(rampTex);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
    },
  };
}

/* Motion-compensated radar interpolation.
 *
 * ECCC publishes a radar scan every 6 minutes. Played back directly that is a
 * slideshow, and cross-fading only dissolves one still into the next — a squall
 * line fades out in the old position and in at the new one rather than moving.
 *
 * This estimates where precipitation actually went between consecutive scans
 * and renders the in-between moments:
 *
 *   1. Composite each frame's rain+snow layers into one image (CPU, 2D canvas).
 *   2. Downsample to a small grid and block-match consecutive frames to get a
 *      coarse motion vector field, then smooth it (CPU — cheap at this size).
 *   3. Upload frames and flow fields as textures; a fragment shader samples
 *      frame A pulled forward along the flow and frame B pulled back along it,
 *      and blends. Sub-frame time steps then read as continuous movement.
 *
 * Block matching is a deliberately modest choice over a full variational
 * optical flow solve: it is a fraction of the code, runs in a few hundred
 * milliseconds of plain JavaScript, and radar advection over a small map is
 * close enough to locally uniform translation for it to hold up. It will not
 * capture rotation or growth/decay of a cell.
 */

export const hasWebGL2 = () => {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
};

/* ── flow estimation (CPU) ────────────────────────── */

const GRID_W = 64;          // downsample width used for matching
const BLOCK = 5;            // half-size of the patch compared
const SEARCH = 7;           // search radius, in downsampled pixels
const SMOOTH_PASSES = 3;
export const FLOW_MAX = 0.25;   // largest encodable flow, in UV units

/* Reduce a composited frame to a small alpha map. Alpha is the useful signal:
   the radar PNG is transparent wherever there is no echo. */
function alphaMap(source, gw, gh, scratch) {
  scratch.width = gw; scratch.height = gh;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, gw, gh);
  ctx.drawImage(source, 0, 0, gw, gh);
  const d = ctx.getImageData(0, 0, gw, gh).data;
  const out = new Float32Array(gw * gh);
  for (let i = 0, p = 3; i < out.length; i++, p += 4) out[i] = d[p] / 255;
  return out;
}

/* Sum of absolute differences between patches centred at (ax,ay) and (bx,by). */
function sad(a, b, gw, gh, ax, ay, bx, by) {
  let s = 0, n = 0;
  for (let dy = -BLOCK; dy <= BLOCK; dy++) {
    const ya = ay + dy, yb = by + dy;
    if (ya < 0 || ya >= gh || yb < 0 || yb >= gh) continue;
    for (let dx = -BLOCK; dx <= BLOCK; dx++) {
      const xa = ax + dx, xb = bx + dx;
      if (xa < 0 || xa >= gw || xb < 0 || xb >= gw) continue;
      s += Math.abs(a[ya * gw + xa] - b[yb * gw + xb]);
      n++;
    }
  }
  return n ? s / n : Infinity;
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
   Exported so the estimator can be checked against a known displacement. */
export function estimateFlow(a, b, gw, gh) {
  let field = new Float32Array(gw * gh * 2);

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      // Skip empty neighbourhoods — no echo means no motion to find, and
      // matching noise there produces a chaotic field.
      if (a[y * gw + x] < 0.02) continue;

      let best = Infinity, bdx = 0, bdy = 0;
      for (let dy = -SEARCH; dy <= SEARCH; dy++) {
        for (let dx = -SEARCH; dx <= SEARCH; dx++) {
          const e = sad(a, b, gw, gh, x, y, x + dx, y + dy);
          // bias slightly toward smaller motion so ties resolve to stillness
          const cost = e + Math.hypot(dx, dy) * 0.0015;
          if (cost < best) { best = cost; bdx = dx; bdy = dy; }
        }
      }
      field[(y * gw + x) * 2] = bdx / gw;
      field[(y * gw + x) * 2 + 1] = bdy / gh;
    }
  }

  for (let i = 0; i < SMOOTH_PASSES; i++) field = boxSmooth(field, gw, gh);
  return field;
}

function encodeFlow(field, gw, gh) {
  const px = new Uint8Array(gw * gh * 4);
  for (let i = 0; i < gw * gh; i++) {
    const fx = Math.max(-FLOW_MAX, Math.min(FLOW_MAX, field[i * 2]));
    const fy = Math.max(-FLOW_MAX, Math.min(FLOW_MAX, field[i * 2 + 1]));
    px[i * 4] = Math.round(((fx / FLOW_MAX) * 0.5 + 0.5) * 255);
    px[i * 4 + 1] = Math.round(((fy / FLOW_MAX) * 0.5 + 0.5) * 255);
    px[i * 4 + 2] = 0;
    px[i * 4 + 3] = 255;
  }
  return px;
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

uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uFlow;
uniform float uT;         // 0..1 between A and B
uniform float uFlowMax;
uniform float uOpacity;

void main() {
  vec2 flow = (texture(uFlow, vUv).rg - 0.5) * 2.0 * uFlowMax;

  // Pull A forward along the motion and B backward along it, so both land on
  // where the echo should be at time uT, then blend.
  vec4 a = texture(uA, vUv - flow * uT);
  vec4 b = texture(uB, vUv + flow * (1.0 - uT));

  vec4 c = mix(a, b, uT);

  // Premultiplied-ish cleanup: warping can drag faint halos out of nothing,
  // so drop near-transparent samples rather than smear them.
  if (c.a < 0.06) discard;
  fragColor = vec4(c.rgb, c.a * uOpacity);
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
    max: gl.getUniformLocation(prog, 'uFlowMax'),
    opacity: gl.getUniformLocation(prog, 'uOpacity'),
  };
  gl.uniform1i(U.a, 0);
  gl.uniform1i(U.b, 1);
  gl.uniform1i(U.flow, 2);
  gl.uniform1f(U.max, FLOW_MAX);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let frameTex = [], flowTex = [], opacity = 0.9;

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

  function makeDataTex(px, w, h) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return t;
  }

  function clearTextures() {
    for (const t of frameTex) gl.deleteTexture(t);
    for (const t of flowTex) gl.deleteTexture(t);
    frameTex = []; flowTex = [];
  }

  return {
    get frameCount() { return frameTex.length; },

    setOpacity(v) { opacity = v; },

    /* `composites` are canvases/bitmaps, one per time step, already merged. */
    async build(composites, onProgress) {
      clearTextures();
      if (!composites.length) return;

      const w = composites[0].width, h = composites[0].height;
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);

      for (const c of composites) frameTex.push(makeTex(c));

      const gw = GRID_W;
      const gh = Math.max(8, Math.round(GRID_W * (h / w)));
      const scratch = document.createElement('canvas');

      const maps = composites.map((c) => alphaMap(c, gw, gh, scratch));

      for (let i = 0; i < maps.length - 1; i++) {
        const field = estimateFlow(maps[i], maps[i + 1], gw, gh);
        flowTex.push(makeDataTex(encodeFlow(field, gw, gh), gw, gh));
        onProgress?.((i + 1) / (maps.length - 1));
        // yield so the loading UI can paint between pairs
        await new Promise((r) => setTimeout(r, 0));
      }
    },

    /* i = frame index, t = 0..1 toward the next frame */
    draw(i, t) {
      if (!frameTex.length) return;
      const last = frameTex.length - 1;
      const a = Math.max(0, Math.min(last, i));
      const b = Math.min(last, a + 1);
      const f = flowTex[Math.min(a, flowTex.length - 1)];

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!f) return;

      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, frameTex[a]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, frameTex[b]);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, f);
      gl.uniform1f(U.t, a === b ? 0 : Math.max(0, Math.min(1, t)));
      gl.uniform1f(U.opacity, opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    destroy() {
      clearTextures();
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
    },
  };
}

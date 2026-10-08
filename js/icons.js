/* Weather icon set + condition mapping.
   Canonical condition keys are shared by every source adapter so the UI
   never has to care whether a reading came from ECCC or Open-Meteo. */

const C = {
  sun:   '#FFC44D',
  sunHi: '#FFDE8A',
  moon:  '#E6EDF7',
  cloud: '#E2E9F1',
  cloudBack: '#AFBCCC',
  rain:  '#5AA9E6',
  snow:  '#D5E9F7',
  bolt:  '#FFD54F',
  fog:   '#C2CCD8',
};

/* ── primitive shapes ─────────────────────────────── */
const sun = (cx = 32, cy = 30, r = 11) => `
  <circle cx="${cx}" cy="${cy}" r="${r + 5}" fill="${C.sunHi}" opacity=".22"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.sun}"/>
  ${Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 4.5), y1 = cy + Math.sin(a) * (r + 4.5);
    const x2 = cx + Math.cos(a) * (r + 8.5), y2 = cy + Math.sin(a) * (r + 8.5);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
             stroke="${C.sun}" stroke-width="3.4" stroke-linecap="round"/>`;
  }).join('')}`;

const moon = (cx = 32, cy = 30, r = 12) => `
  <circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="${C.moon}" opacity=".16"/>
  <path d="M${cx + r * 0.42} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.72} ${r * 1.5}
           a${r * 0.86} ${r * 0.86} 0 1 1 ${-r * 0.72} ${-r * 1.5}z" fill="${C.moon}"/>`;

const cloud = (x = 32, y = 38, s = 1, fill = C.cloud) => `
  <path transform="translate(${x} ${y}) scale(${s}) translate(-32 -38)"
        d="M20.5 48q-6.3 0-10.4-4.2Q6 39.6 6 33.4q0-5.5 3.5-9.6 3.5-4.2 8.9-4.9 2-4.9 6.4-7.9 4.4-3 9.9-3 6.9 0 11.7 4.8 4.8 4.8 4.8 11.7v1.2q4.6.3 7.7 3.7 3.1 3.4 3.1 8 0 4.8-3.4 8.2-3.4 3.4-8.2 3.4z"
        fill="${fill}"/>`;

const drops = (n = 3, color = C.rain, y0 = 46) => Array.from({ length: n }, (_, i) => {
  const x = 22 + i * 10;
  return `<line x1="${x}" y1="${y0}" x2="${x - 3}" y2="${y0 + 9}"
           stroke="${color}" stroke-width="3.4" stroke-linecap="round"/>`;
}).join('');

const flakes = (n = 3, y0 = 48) => Array.from({ length: n }, (_, i) => {
  const x = 22 + i * 10;
  return `<g stroke="${C.snow}" stroke-width="2.6" stroke-linecap="round">
    <line x1="${x - 3.4}" y1="${y0}" x2="${x + 3.4}" y2="${y0 + 5}"/>
    <line x1="${x + 3.4}" y1="${y0}" x2="${x - 3.4}" y2="${y0 + 5}"/>
    <line x1="${x}" y1="${y0 - 1.6}" x2="${x}" y2="${y0 + 6.6}"/>
  </g>`;
}).join('');

const bolt = () => `<path d="M34 41 25 55h6l-2 10 10-15h-6l3-9z" fill="${C.bolt}"/>`;

const lines = (color = C.fog, ys = [40, 47, 54], w = 3.4) => ys.map((y, i) =>
  `<line x1="${13 + (i % 2) * 5}" y1="${y}" x2="${51 - (i % 2) * 6}" y2="${y}"
    stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`).join('');

const wrap = (inner) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

/* ── canonical icons ──────────────────────────────── */
const ART = {
  clear:      (n) => wrap(n ? moon() : sun()),
  mainlyclear:(n) => wrap((n ? moon(26, 26, 10) : sun(25, 25, 9.5)) + cloud(37, 42, .78)),
  partly:     (n) => wrap((n ? moon(24, 25, 10) : sun(24, 24, 10)) + cloud(36, 41, .86)),
  cloudy:     ()  => wrap(cloud(27, 33, .72, C.cloudBack) + cloud(36, 40, .9)),
  overcast:   ()  => wrap(cloud(32, 37, 1, C.cloudBack)),
  fog:        ()  => wrap(cloud(32, 31, .84) + lines()),
  haze:       (n) => wrap((n ? moon(32, 26, 10) : sun(32, 25, 10)) + lines(C.fog, [44, 52])),
  drizzle:    ()  => wrap(cloud(32, 33, .92) + drops(3, C.rain, 45)),
  rain:       ()  => wrap(cloud(32, 32, .95) + drops(3, C.rain, 44)),
  heavyrain:  ()  => wrap(cloud(32, 31, 1) + drops(4, C.rain, 43) + drops(3, C.rain, 49)),
  rainshower: (n) => wrap((n ? moon(21, 22, 8) : sun(21, 21, 8)) + cloud(36, 34, .84) + drops(3, C.rain, 46)),
  freezing:   ()  => wrap(cloud(32, 32, .95) + drops(2, C.rain, 44) + flakes(1, 46)),
  sleet:      ()  => wrap(cloud(32, 32, .95) + drops(2, C.rain, 45) + flakes(2, 47)),
  snow:       ()  => wrap(cloud(32, 32, .95) + flakes(3, 47)),
  heavysnow:  ()  => wrap(cloud(32, 31, 1) + flakes(3, 45) + flakes(2, 53)),
  snowshower: (n) => wrap((n ? moon(21, 22, 8) : sun(21, 21, 8)) + cloud(36, 34, .84) + flakes(3, 48)),
  thunder:    ()  => wrap(cloud(32, 31, .98, C.cloudBack) + bolt()),
  thunderrain:()  => wrap(cloud(32, 30, .98) + bolt() + drops(2, C.rain, 44)),
  hail:       ()  => wrap(cloud(32, 32, .95) +
                     `<circle cx="24" cy="50" r="3.2" fill="${C.snow}"/>
                      <circle cx="34" cy="53" r="3.2" fill="${C.snow}"/>
                      <circle cx="43" cy="49" r="3.2" fill="${C.snow}"/>`),
  wind:       ()  => wrap(`
    <g stroke="${C.cloud}" stroke-width="4" stroke-linecap="round" fill="none">
      <path d="M10 24h27a6 6 0 1 0-6-6"/>
      <path d="M10 36h33a6 6 0 1 1-6 6"/>
      <path d="M10 48h19"/>
    </g>`),
  smoke:      ()  => wrap(cloud(32, 33, .9, '#B9A99A') + lines('#B9A99A', [46, 53])),
};

/* ── ECCC icon code → canonical ───────────────────── */
/* Codes 30-48 are the night twins of 00-18 for the first ten slots. */
const ECCC = {
  0: 'clear', 1: 'mainlyclear', 2: 'partly', 3: 'cloudy', 4: 'cloudy', 5: 'partly',
  6: 'rainshower', 7: 'sleet', 8: 'snowshower', 9: 'thunderrain',
  10: 'overcast', 11: 'drizzle', 12: 'rain', 13: 'heavyrain', 14: 'freezing',
  15: 'sleet', 16: 'snow', 17: 'snow', 18: 'heavysnow', 19: 'thunder',
  23: 'haze', 24: 'fog', 25: 'snow', 26: 'snow', 27: 'hail', 28: 'rain',
  30: 'clear', 31: 'mainlyclear', 32: 'partly', 33: 'cloudy', 34: 'cloudy', 35: 'partly',
  36: 'rainshower', 37: 'sleet', 38: 'snowshower', 39: 'thunderrain',
  40: 'snow', 41: 'wind', 42: 'wind', 43: 'wind', 44: 'smoke',
  45: 'smoke', 46: 'hail', 47: 'thunder', 48: 'wind',
};

export function ecccCondition(code) {
  const n = Number(code);
  return { key: ECCC[n] ?? 'cloudy', night: n >= 30 && n <= 39 };
}

/* ── WMO code → canonical (Open-Meteo) ────────────── */
const WMO = {
  0: 'clear', 1: 'mainlyclear', 2: 'partly', 3: 'overcast',
  45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
  56: 'freezing', 57: 'freezing',
  61: 'rain', 63: 'rain', 65: 'heavyrain',
  66: 'freezing', 67: 'freezing',
  71: 'snow', 73: 'snow', 75: 'heavysnow', 77: 'snow',
  80: 'rainshower', 81: 'rainshower', 82: 'heavyrain',
  85: 'snowshower', 86: 'heavysnow',
  95: 'thunder', 96: 'hail', 99: 'hail',
};

const WMO_TEXT = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle',
  56: 'Freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm',
};

export const wmoCondition = (c) => WMO[Number(c)] ?? 'cloudy';
export const wmoText = (c) => WMO_TEXT[Number(c)] ?? '—';

/* ── render ───────────────────────────────────────── */
export function icon(key, night = false) {
  return (ART[key] ?? ART.cloudy)(night);
}

/* ── sky palettes, keyed by canonical condition ───── */
const SKY_DAY = {
  clear:       ['#2E6FD4', '#4E96E8', '#8FC4F2'],
  mainlyclear: ['#3172CE', '#5B9AE0', '#9AC6EE'],
  partly:      ['#3B76BE', '#6A9CCF', '#A6C4DE'],
  cloudy:      ['#4A6076', '#6C8298', '#9BAAB9'],
  overcast:    ['#48566A', '#6A7686', '#95A0AE'],
  fog:         ['#5C6874', '#828C97', '#AEB6BE'],
  haze:        ['#7A7460', '#A79B7C', '#CDC3A4'],
  drizzle:     ['#3C5470', '#587189', '#8497AB'],
  rain:        ['#2F4560', '#47617C', '#71879E'],
  heavyrain:   ['#233649', '#375065', '#5B7387'],
  rainshower:  ['#37567C', '#557496', '#8AA3BB'],
  freezing:    ['#405A78', '#5D7A96', '#8EA4B8'],
  sleet:       ['#48607A', '#67809A', '#95A9BC'],
  snow:        ['#5A6B80', '#7E8FA3', '#B0BDC9'],
  heavysnow:   ['#4C5C6F', '#6E7F92', '#A0AEBC'],
  snowshower:  ['#55697F', '#7A8DA2', '#ACB9C6'],
  thunder:     ['#2A2C42', '#454764', '#6B6D8B'],
  thunderrain: ['#252A3E', '#3F4560', '#646A86'],
  hail:        ['#33445C', '#4E6178', '#7A8B9E'],
  wind:        ['#43647E', '#63849C', '#95AEC0'],
  smoke:       ['#6A5B4E', '#8E7C6C', '#B5A493'],
};

const SKY_NIGHT = {
  clear:       ['#0B1533', '#152449', '#2C3E6B'],
  mainlyclear: ['#0C1734', '#182749', '#31446E'],
  partly:      ['#111B36', '#1F2C4B', '#39496D'],
  cloudy:      ['#161B28', '#252C3D', '#3D4557'],
  overcast:    ['#14181F', '#212733', '#363D4B'],
  fog:         ['#1A1E24', '#2A2F37', '#434A54'],
  haze:        ['#1E1B18', '#2F2A24', '#484034'],
  drizzle:     ['#111A28', '#1E2A3C', '#344257'],
  rain:        ['#0D1521', '#1A2534', '#2E3D50'],
  heavyrain:   ['#0A111B', '#151E2C', '#273347'],
  rainshower:  ['#101B2C', '#1D2B41', '#33445E'],
  freezing:    ['#131E2C', '#212F41', '#38485C'],
  sleet:       ['#151F2C', '#233043', '#3A4A5D'],
  snow:        ['#1A2230', '#2A3442', '#454F5E'],
  heavysnow:   ['#161E2A', '#252F3C', '#3E4857'],
  snowshower:  ['#182130', '#283242', '#424C5C'],
  thunder:     ['#100F1E', '#1E1D33', '#34324F'],
  thunderrain: ['#0D0D19', '#1A192C', '#2E2C46'],
  hail:        ['#101825', '#1D2736', '#333F52'],
  wind:        ['#121E29', '#20303E', '#374A5B'],
  smoke:       ['#1C1813', '#2C251D', '#443A2E'],
};

const ACCENT_DAY = {
  clear: '#FFC44D', mainlyclear: '#FFC44D', partly: '#8EC5F5',
  thunder: '#FFD54F', thunderrain: '#FFD54F',
  snow: '#BFE0F5', heavysnow: '#BFE0F5', snowshower: '#BFE0F5',
  smoke: '#D8B98F', haze: '#E0CE96',
};

/* Accent choices for Settings → Accent colour. Each is one of Apple's system
   tint colours in its Increase Contrast form, because those are the variants
   that clear 4.5:1 as text: `dark` sits on the dark surfaces and the hero sky
   (and fills the selected pills, under #06121f text), `light` is the ink on
   white cards in light mode. Green's light variant is nudged a shade darker
   than Apple's #248A3D, which measures 4.4:1 on white. Red is left out on
   purpose: the HIG keeps it for destructive actions, and here for warnings.
   'sky' is the original behaviour, where the accent follows the weather. */
export const TINTS = {
  sky:    { name: 'Sky' },
  blue:   { name: 'Blue',   dark: '#409CFF', light: '#0040DD' },
  indigo: { name: 'Indigo', dark: '#7D7AFF', light: '#3634A3' },
  purple: { name: 'Purple', dark: '#DA8FFF', light: '#8944AB' },
  pink:   { name: 'Pink',   dark: '#FF6482', light: '#D30F45' },
  orange: { name: 'Orange', dark: '#FFB340', light: '#C93400' },
  yellow: { name: 'Yellow', dark: '#FFD426', light: '#B25000' },
  green:  { name: 'Green',  dark: '#30DB5B', light: '#1F7A36' },
  teal:   { name: 'Teal',   dark: '#5DE6FF', light: '#008299' },
  /* Solid row: fully saturated primaries, a step deeper than the softer
     system tints above so the two rows read apart, and taken darker again in
     light mode so they still read as text on white. */
  red:     { name: 'Solid red',    dark: '#FF3326', light: '#D91A10' },
  sgreen:  { name: 'Solid green',  dark: '#12C043', light: '#0F8A31' },
  sblue:   { name: 'Solid blue',   dark: '#1A7DFF', light: '#0059DB' },
  syellow: { name: 'Solid yellow', dark: '#FFC400', light: '#B98800' },
  spurple: { name: 'Solid purple', dark: '#B44DF0', light: '#8E2FC4' },
};

/* Palettes: sets of colours that work together, from which the accent is
   picked to suit the weather, the way Sky follows it. Each condition has a
   mood (a hue to aim for, or "grey" for the muted ones); the palette colour
   closest to it wins, then it is lightened for dark mode and deepened for
   light mode until it reads at 4.5:1 on the cards, so any palette stays
   legible whatever it contains. */
export const PALETTES = {
  dusk:    { name: 'Dusk',    colors: ['#13205C', '#F5CF7E', '#9ABDBE', '#847E8A'] },
  retro:   { name: 'Retro',   colors: ['#10304F', '#3C5A90', '#60C9A5', '#E95E4A', '#BA2B53'] },
  sage:    { name: 'Sage',    colors: ['#CFD48A', '#8E9C5E', '#2F4D45', '#9EAFA2', '#A4764F', '#807B6E'] },
  pastel:  { name: 'Pastel',  colors: ['#D9667A', '#C0D6F0', '#C6D9C4', '#B8BAD2'] },
  garden:  { name: 'Garden',  colors: ['#3F5A6B', '#D9565C', '#F2DD73', '#719563', '#E8BED3'] },
  prairie: { name: 'Prairie', colors: ['#D2C88A', '#5E676A', '#6B3A1E', '#9C8746', '#5C5B39'] },
  peach:   { name: 'Peach',   colors: ['#D2E1CC', '#FAFDE6', '#FCFCB5', '#C0937F', '#D3A262'] },
  forest:  { name: 'Forest',  colors: ['#C4AE7C', '#4F331C', '#2B3329', '#464E27', '#5E5B3A'] },
  coast:   { name: 'Coast',   colors: ['#2E6E75', '#93C3BF', '#FDEFC8', '#FBE46A', '#EF9C7B'] },
  sunset:  { name: 'Sunset',  colors: ['#9A1D6C', '#3F86A5', '#EEB04F', '#E06C30', '#C9E8C0'] },
};

const MOOD = {
  clear: 45, mainlyclear: 45, partly: 200, wind: 165,
  drizzle: 205, rain: 210, heavyrain: 215, rainshower: 205,
  freezing: 190, sleet: 190, snow: 195, heavysnow: 195, snowshower: 195,
  thunder: 325, thunderrain: 325, hail: 300,
  cloudy: 'grey', overcast: 'grey', fog: 'grey', haze: 'grey', smoke: 'grey',
};

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgbHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
function rgbHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hslRgb([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* Walk the lightness up (for dark cards) or down (for light ones) until the
   colour clears 4.5:1, keeping its hue and most of its character. */
function readable(hex, bg, up) {
  let [h, s, l] = rgbHsl(hexRgb(hex));
  const B = hexRgb(bg);
  s = Math.max(s, 0.18);
  for (let i = 0; i < 60 && contrast(hslRgb([h, s, l]), B) < 4.5; i++) l = up ? Math.min(0.97, l + 0.015) : Math.max(0.05, l - 0.015);
  return rgbHex(hslRgb([h, s, l]));
}

function pickFromPalette(colors, condition, night) {
  const want = night && (condition === 'clear' || condition === 'mainlyclear') ? 230 : MOOD[condition] ?? 210;
  let best = colors[0], score = Infinity;
  for (const c of colors) {
    const rgb = hexRgb(c), [h, , l] = rgbHsl(rgb);
    const chroma = Math.max(...rgb) - Math.min(...rgb);   // how colourful, unlike HSL's saturation, which flatters pastels
    const edge = l > 0.93 || l < 0.08 ? 0.6 : 0;          // near-white or near-black make poor accents
    const sc = want === 'grey'
      ? chroma + edge
      : Math.min(Math.abs(h - want), 360 - Math.abs(h - want)) / 180 + (1 - chroma) * 0.6 + edge;
    if (sc < score) { score = sc; best = c; }
  }
  return best;
}

/* Every colour of a palette made readable for both modes, the weather's
   pick first, the rest in the palette's own order. Used to give each card
   (and each Details tile) its own colour from the palette. */
export function paletteInks(key, condition = 'cloudy', night = false) {
  const p = PALETTES[key];
  if (!p) return null;
  const first = pickFromPalette(p.colors, condition, night);
  return [first, ...p.colors.filter((c) => c !== first)]
    .map((c) => ({ dark: readable(c, '#171B22', true), light: readable(c, '#FFFFFF', false) }));
}

/* The accent pair for a setting: { dark, light } (dark-mode and light-mode
   ink), or null for Sky, which follows the hero's own accent. */
export function accentFor(key, condition = 'cloudy', night = false) {
  const t = TINTS[key];
  if (t?.dark) return { dark: t.dark, light: t.light };
  const p = PALETTES[key];
  if (!p) return null;
  const c = pickFromPalette(p.colors, condition, night);
  return { dark: readable(c, '#1E232C', true), light: readable(c, '#EEF2F7', false), base: c };
}

export function sky(key, night) {
  const table = night ? SKY_NIGHT : SKY_DAY;
  const g = table[key] ?? table.cloudy;
  const accent = night ? '#9BB8E8' : (ACCENT_DAY[key] ?? '#7FB3EA');
  return { g, accent };
}

/* which particle effect the canvas should draw */
export function fxKind(key) {
  if (['rain', 'heavyrain', 'drizzle', 'rainshower', 'thunderrain'].includes(key)) return 'rain';
  if (['snow', 'heavysnow', 'snowshower', 'sleet', 'freezing'].includes(key)) return 'snow';
  if (['clear', 'mainlyclear'].includes(key)) return 'stars';
  if (['fog', 'haze', 'smoke'].includes(key)) return 'fog';
  return 'clouds';
}

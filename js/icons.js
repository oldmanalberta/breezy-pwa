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

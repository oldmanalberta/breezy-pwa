/* Native shell hooks. Everything here is a no-op in a plain browser, so the
   web app stays exactly what it was; inside the Capacitor build the same
   calls reach Swift.

   The one job so far: hand the widget a forecast. Widgets cannot run the web
   app, so the app publishes a compact, already-formatted snapshot into the
   App Group container every time it paints, and WidgetKit redraws from it. */

import { state } from './store.js';
import { toF } from './render.js';
import { accentFor } from './icons.js';

const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);

export const isNative = () => !!cap()?.isNativePlatform?.();

/* The page does not bundle @capacitor/core, so the friendly registerPlugin()
   API is not here. The native bridge script Capacitor injects still exposes
   nativePromise(plugin, method, options), which is what registerPlugin wraps. */
function callNative(plugin, method, options) {
  const c = cap();
  if (!c) return Promise.reject(new Error('no Capacitor'));
  if (typeof c.nativePromise === 'function') return c.nativePromise(plugin, method, options);
  if (typeof c.registerPlugin === 'function') return c.registerPlugin(plugin)[method](options);
  if (c.Plugins?.[plugin]?.[method]) return c.Plugins[plugin][method](options);
  return Promise.reject(new Error('Capacitor bridge has no callable entry point'));
}

const iso = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString() : null);
const round = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v));
// temperatures go over already converted, so the widget never needs to know
// about units beyond the label it prints
const t = (c) => (c == null ? null : round(state.unit === 'F' ? toF(c) : c));

export function widgetPayload(data, place) {
  const c = data.current ?? {};
  const d0 = data.daily?.[0];
  return {
    v: 1,
    updated: iso(data.updated) ?? new Date().toISOString(),
    place: place?.name ?? '',
    unit: state.unit === 'F' ? '°F' : '°C',
    tz: place?.tz ?? data.tz ?? null,
    current: {
      temp: t(c.temp),
      feels: t(c.feelsLike),
      condition: c.condition ?? 'cloudy',
      night: !!c.night,
      text: c.text ?? '',
      hi: t(d0?.hi),
      lo: t(d0?.lo),
    },
    hourly: (data.hourly ?? []).slice(0, 24).map((h) => ({
      t: iso(h.time),
      temp: t(h.temp),
      condition: h.condition ?? 'cloudy',
      night: !!h.night,
      pop: round(h.pop),
    })),
    daily: (data.daily ?? []).slice(0, 7).map((d) => ({
      d: iso(d.date),
      label: d.label ?? null,
      hi: t(d.hi),
      lo: t(d.lo),
      condition: d.condition ?? 'cloudy',
      pop: round(d.pop),
    })),
    alert: data.alerts?.[0]?.title ?? null,
    // [light, dark] ink as 0xRRGGBB; absent for 'sky', where the widget keeps its own
    accent: (() => {
      const a = accentFor(state.accent, data.current?.condition, data.current?.night);
      return a ? [a.light, a.dark].map((h) => parseInt(h.slice(1), 16)) : null;
    })(),
  };
}

/* Fire-and-forget: a widget that is a minute stale is not worth a failed
   paint, so nothing here can throw into the caller. */
/* Diagnostics go out as a window event so the UI can toast them without
   this module knowing anything about the page. */
const tell = (msg) => window.dispatchEvent(new CustomEvent('breezy-toast', { detail: msg }));

/* Publish only when the forecast the widget would get has actually changed.
   Every publish wakes WidgetKit to redraw, and repainting the same cached
   forecast on every swipe between locations was doing that several times a
   minute — a real cost on the battery for no change on the Home Screen. */
let lastKey = null;

export function publishWidget(data, place, { force = false } = {}) {
  if (!isNative()) return;
  const key = `${place?.id}|${state.unit}|${state.accent}|${data.updated instanceof Date ? data.updated.getTime() : data.updated}`;
  if (!force && key === lastKey) return;
  lastKey = key;
  const debug = state.radarDebug === 'on';
  try {
    callNative('WidgetBridge', 'publish', { json: JSON.stringify(widgetPayload(data, place)) })
      .then((r) => {
        if (r?.stored === false) tell('Widget: App Group not available — check the App Groups capability');
        else if (debug) tell(`Widget updated · ${place?.name ?? ''}`);
      })
      .catch((e) => tell(`Widget publish failed: ${e?.message ?? e}`));
  } catch (e) { tell(`Widget publish failed: ${e?.message ?? e}`); }
}

# Breezy PWA

A weather app for iPhone, modelled on the layout and look of
[Breezy Weather](https://github.com/breezy-weather/breezy-weather) (Android),
using **Environment and Climate Change Canada** as its primary source.

It is a Progressive Web App: plain HTML/CSS/JavaScript with no build step and no
dependencies. You host the folder, add it to your iPhone home screen, and it
behaves like an installed app — full screen, own icon, works offline.

## Why a PWA and not a port

The Android app is ~130,000 lines of Kotlin built on Jetpack Compose, Room, Hilt
and WorkManager. None of that runs on iOS, and building a real iOS app requires
Xcode, which is macOS-only. This is written from scratch to match the *design*,
and it installs on an iPhone from a Windows PC with no Mac, no Apple Developer
account, and no 7-day expiry.

## Features

- **Condition-driven sky** — the background gradient and animated effects (rain,
  snow, stars, drifting cloud, fog) change with the weather and time of day.
- **Daily panel** — horizontally scrolling day columns with a chart across
  them, and pills to switch what the chart plots: Conditions, Precipitation,
  Wind, UV index, Air quality, Feels like, Sunshine.
- **Cards** — hourly forecast with temperature curve, details grid, air
  quality, sun & moon with arc and moon phase. Reorderable from Settings.
- **Precipitation radar** — ECCC's North American 1 km radar composite over a
  pannable, zoomable map. A card shows the latest frame centred on your
  location; tap it for the full-screen map with a 12-frame animation covering
  roughly the last 70 minutes, a scrub slider, and the official ECCC legend.
  Playback is held until every frame has downloaded, so the animation never
  runs through blank frames. Five base maps — Terrain (default, shows roads
  and towns), Streets, Satellite, Light, Dark. Imagery is requested at the
  device pixel ratio. **Motion interpolation** estimates where precipitation is
  actually travelling between the 6-minute scans and renders the moments in
  between on the GPU, so a moving cell slides rather than dissolving. Falls
  back to cross-fading where WebGL2 is unavailable.
- **Weather alerts** — active ECCC warnings and watches, colour-coded by risk,
  tap to expand the full bulletin.
- **Canadian AQHI** — the actual Air Quality Health Index Canadians use, not a
  converted US AQI (falls back to US AQI outside Canada).
- Multiple saved locations with swipe left/right to page between them,
  device geolocation, °C/°F, km/h · m/s · mph.
- Light and dark themes, offline launch from the last saved forecast.

## Weather sources

| Source | Coverage | Notes |
| --- | --- | --- |
| **Environment and Climate Change Canada** | Canada | Official government forecasts, current conditions, alerts, AQHI. Via the [MSC GeoMet API](https://api.weather.gc.ca). |
| **Open-Meteo** | Worldwide | Free and keyless. Used outside Canada, and to fill in UV/visibility/apparent temperature that ECCC's current-conditions feed omits. |
| **Open-Meteo · Canadian GEM** | Worldwide | ECCC's own GEM/HRDPS model, available anywhere. |
| **ECCC radar (MSC GeoMet WMS)** | North America | `RADAR_1KM_RRAI` (rain) and `RADAR_1KM_RSNO` (snow), the same composite WeatherCAN shows. The radar card only appears inside coverage. |

The radar's base map tiles come from [CARTO](https://carto.com/attributions),
built on [OpenStreetMap](https://www.openstreetmap.org/copyright) data — the one
external dependency in the app, and the only reason the radar view needs a
connection. Everything else degrades to the cached forecast when offline.

Set the preference under **Settings → Weather source**. *Automatic* uses ECCC
inside Canada and Open-Meteo elsewhere.

---

## Putting it on your iPhone

You need to host the folder somewhere with **HTTPS** — iOS will not install a
PWA or grant location access over plain HTTP. GitHub Pages is free and takes
about five minutes.

### 1. Publish to GitHub Pages

Create a free account at [github.com](https://github.com), then make a new
**public** repository named `breezy-pwa`. Leave it empty (no README).

From this folder:

```bash
git init -b main
```

```bash
git add -A
```

```bash
git commit -m "Breezy PWA"
```

Then connect it to your repository and push — replace `YOUR-USERNAME`:

```bash
git remote add origin https://github.com/YOUR-USERNAME/breezy-pwa.git
```

```bash
git push -u origin main
```

In the repository on github.com, go to **Settings → Pages**, set **Source** to
*Deploy from a branch*, pick branch **main** and folder **/ (root)**, and save.
After a minute your app is live at:

```
https://YOUR-USERNAME.github.io/breezy-pwa/
```

> Prefer not to use git? On the repository page choose **Add file → Upload
> files**, drag in everything from this folder (keep the `css`, `js`, `icons`
> folders intact), and commit. Then do the Pages step above.

### 2. Install on the iPhone 16e

1. Open that URL in **Safari**. It has to be Safari — other iOS browsers make a
   bookmark instead of a real installed app.
2. Tap the **Share** button (the square with the arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Launch it from the new **Breezy** icon.

Opened from the home screen it runs full screen with no browser chrome, keeps
your locations, and loads the last forecast when you have no signal.

The first time you tap **Use my location**, iOS asks for permission — allow it.
You can also just search for your city instead.

### Updating later

Edit the files, commit, and push again. The service worker fetches from the
network first, so a reload picks up changes immediately.

---

## Running it locally

```bash
python tools/serve.py
```

Then open `http://localhost:8712`. Service workers and geolocation are allowed
on `localhost` without HTTPS, so everything works. Note that visiting the same
server from your phone by LAN IP will *not* let you install it — that needs
HTTPS, which is why hosting matters.

Use `tools/serve.py` rather than `python -m http.server`: the stock server
sends no cache headers, so browsers hold on to stale ES modules and an edited
file keeps reporting the *old* module's exports. This one sends `no-store` and
fixes a couple of MIME types.

To regenerate the app icons after changing the artwork in `tools/make_icons.py`:

```bash
python tools/make_icons.py
```

## What it does not do

These are iOS platform limits, not missing work:

- **No home-screen widgets.** Apple does not let web apps provide them. A native
  app is the only way, and that needs a Mac.
- **No background alert notifications.** iOS supports web push for installed
  PWAs, but it needs a push server; this is a static site with no backend.
- Must be installed from Safari, as described above.

## Layout

```
index.html              app shell
manifest.webmanifest    PWA metadata (name, icons, standalone display)
sw.js                   service worker — offline app shell
css/app.css             Material 3 Expressive styling
fonts/                  Aileron (Light / Regular / Bold), self-hosted
js/app.js               controller: state, rendering, events
js/render.js            card renderers
js/icons.js             SVG weather icons, condition mapping, sky palettes
js/fx.js                canvas rain/snow/stars/cloud effects
js/radar.js             radar map: projection, WMS urls, pan/zoom, animation
js/flow.js              radar motion estimation + WebGL warp/blend renderer
js/store.js             localStorage settings, places, forecast cache
js/sources/index.js     source dispatcher and fallback logic
js/sources/eccc.js      Environment and Climate Change Canada adapter
js/sources/openmeteo.js Open-Meteo adapter and geocoding
tools/make_icons.py     icon generator (standard library only)
tools/serve.py          dev server with caching disabled
```

## Credits and licensing

Design and layout follow **Breezy Weather** by the Breezy Weather contributors,
licensed LGPL-3.0. This is an independent reimplementation for personal use; no
Breezy Weather code was copied, and the name and logo are not used as branding.

- Weather data © **Environment and Climate Change Canada**, used under the
  [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
- Weather data from **[Open-Meteo](https://open-meteo.com)**, licensed CC BY 4.0.
- Radar base maps © **[CARTO](https://carto.com/attributions)**, map data ©
  **[OpenStreetMap](https://www.openstreetmap.org/copyright)** contributors,
  and **[Esri](https://www.esri.com)** (World Topo / World Imagery) with USGS,
  NOAA and Maxar. Attribution is shown live in the radar view and changes with
  the selected base map.
- **[Aileron](https://dotcolon.net/font/aileron)** by Sora Sagano, released
  into the public domain (CC0).

Note that publishing an app under a GPL-family licence to Apple's App Store
conflicts with the App Store terms; installing your own build to your own device
this way does not.

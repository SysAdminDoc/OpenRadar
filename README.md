# OpenRadar

![Version](https://img.shields.io/badge/version-0.1.0-68d7ff)
![License](https://img.shields.io/badge/license-MIT-8bd5ca)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-89b4fa)

OpenRadar is a map-first desktop weather radar. Pan around the planet, zoom from a globe to a neighborhood, tilt the camera, switch projections, and scrub through live radar frames without moving the map.

![OpenRadar radar workspace](assets/screenshots/openradar-main.png)

The app is being rebuilt as a free desktop tool with no ads or paid feature gates. This first release establishes the navigation, radar timeline, map and layer controls, presets, tools, forecast surface, and readable settings storage.

## What works

- Mouse-driven pan, zoom, bearing, and pitch with flat and globe projection
- A live two-hour NOAA radar loop at two-minute steps with pause, scrub, speed, and opacity controls
- Automatic failover between radar sources, with per-source status and a request budget
- Optional future radar: up to six hours of HRRR forecast reflectivity on the tail of the same timeline
- GOES-East GeoColor satellite imagery under the radar, following the same timeline
- NWS watches and warnings, USGS earthquakes, and NIFC wildfire perimeters, each with click-through detail and a freshness line
- An Alerts panel listing what is active in the current view, worst first, with a link to the official product
- Hurricane cones, forecast tracks, coastal watches, and development outlooks, with a storm list you can fly the map to
- Seven map styles, layer controls, saved views, linked dual panes, draw, range, and point inspection tools
- Route weather: a drive coloured by the chance of rain at the hour you reach each stretch
- Place search, map-centered forecasts, local GeoJSON and GRLevelX placefile import, shareable camera links, dark and light themes
- Readable settings storage, stale-data feedback, in-app notifications, and rotating desktop logs

## Run it

Requirements: Node.js 22 or newer, Rust 1.85 or newer, and the platform requirements for Tauri 2.

```powershell
npm install
npm run tauri dev
```

For a browser preview:

```powershell
npm run dev
```

## Build an installer

```powershell
npm run tauri build -- --bundles nsis
```

The Windows installer is written to `src-tauri/target/release/bundle/nsis/`.

The v0.1.0 installer was exercised with a silent install and uninstall. It is not Authenticode-signed because no code-signing certificate is configured on the build machine.

## Data and map credits

- Basemap data comes from OpenStreetMap through OpenFreeMap.
- Aerial imagery is USGS orthoimagery from The National Map, and the topographic style is OpenTopoMap under CC-BY-SA.
- Radar comes from NOAA. The NWS RIDGE II base reflectivity mosaic leads, NOAA nowCOAST takes over when RIDGE is unreachable, and both are credited in the map.
- RainViewer only appears for viewports the NOAA mosaics do not reach.
- Forecast radar is HRRR reflectivity from the Iowa State Mesonet, and satellite imagery is GOES-East GeoColor through NASA GIBS.
- Watches and warnings come from the NWS event-driven map service, earthquakes from the USGS, and fire perimeters from NIFC.
- Tropical cones, tracks, watches, and outlooks come from the NHC tropical map service.

OpenRadar v0.1.0 is an early working release. It is not an official source for warnings or life-safety decisions.

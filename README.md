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
- Animated GFS wind particles on the flat map and the globe, decoded from GRIB2 locally
- Canadian radar from Environment and Climate Change Canada, with a rain rate scale of its own, wherever the NOAA mosaics stop
- Lightning two ways: the MRMS cloud-to-ground density grid, and GOES-East total lightning decoded from the satellite's own files
- NOAA MRMS leads on the desktop: the one kilometre national grid decoded locally from GRIB2, with rotation tracks and hail size as their own layers
- Single-site NEXRAD Level II up close: past zoom 8 the nearest site's own sweep replaces the mosaic, with tilt and product selection, decoded locally in Rust
- Automatic failover between radar sources, with per-source status and a request budget
- Optional future radar: up to six hours of HRRR forecast reflectivity on the tail of the same timeline
- GOES-East GeoColor satellite imagery under the radar, following the same timeline
- NWS watches and warnings, USGS earthquakes, and NIFC wildfire perimeters, each with click-through detail and a freshness line
- An Alerts panel listing what is active in the current view, worst first, with a link to the official product
- Hurricane cones, forecast tracks, coastal watches, and development outlooks, with a storm list you can fly the map to
- Seven map styles, layer controls, saved views, linked dual panes, draw, range, and point inspection tools
- A watched place that tells you about warnings near it wherever the map is pointed
- Export the current view as a picture or the whole loop as a video, with the time and credits burned in
- Route weather: a drive coloured by the chance of rain at the hour you reach each stretch
- Storm history: every Atlantic and eastern Pacific cyclone since 1851, with its best track drawn by intensity, and archive radar replay of the ones since 2003
- GRLevelX `.pal` colour tables applied to the locally decoded radar, with the legend rebuilt from the table
- Place search, map-centered forecasts, local GeoJSON and GRLevelX placefile import, shareable camera links, dark and light themes
- English and Spanish, switched in Settings and applied where you are standing rather than on the next launch
- An offline last view: tiles, radar frames, and alert polygons are kept on disk, so a launch with no network opens on the last picture you saw and says how old it is
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

## Install it

Download `OpenRadar_<version>_x64-setup.exe` from the [releases page](https://github.com/SysAdminDoc/OpenRadar/releases) and run it. It installs for the current user, so it needs no administrator rights.

Windows will show a SmartScreen warning on first run. The installer is not signed with an Authenticode certificate yet, and SmartScreen warns about anything it has not seen before. Choose More info, then Run anyway. If you would rather check the download first, every release ships a `SHA256SUMS` file:

```powershell
Get-FileHash OpenRadar_0.1.0_x64-setup.exe -Algorithm SHA256
```

Once installed, OpenRadar checks for new versions when you ask it to, from Diagnostics. Updates are signed with the project's own key and refused if the signature does not match, so the SmartScreen gap does not extend to what arrives afterwards.

## Build an installer

```powershell
npm run tauri build -- --bundles nsis
```

The Windows installer is written to `src-tauri/target/release/bundle/nsis/`.

The v0.1.0 installer was exercised with a silent install and uninstall. It is not Authenticode-signed because no code-signing certificate is configured on the build machine.

## Data and map credits

- Basemap data comes from OpenStreetMap through OpenFreeMap.
- Aerial imagery is USGS orthoimagery from The National Map, and the topographic style is OpenTopoMap under CC-BY-SA.
- Wind comes from the NOAA GFS open data bucket on AWS, read a field at a time through the run index.
- Lightning flashes come from the GOES-19 Geostationary Lightning Mapper on AWS. This is total lightning, not a strike report, and it is not a warning source.
- MRMS grids come from the NOAA MRMS open data bucket on AWS and are decoded on your machine, as is single-site NEXRAD Level II from the Unidata archive.
- Radar comes from NOAA. The NWS RIDGE II base reflectivity mosaic leads, NOAA nowCOAST takes over when RIDGE is unreachable, and both are credited in the map.
- RainViewer only appears for viewports the NOAA mosaics do not reach.
- Forecast radar is HRRR reflectivity from the Iowa State Mesonet, and satellite imagery is GOES-East GeoColor through NASA GIBS.
- Watches and warnings come from the NWS event-driven map service, earthquakes from the USGS, and fire perimeters from NIFC.
- Canadian radar comes from Environment and Climate Change Canada through GeoMet, under their open data licence.
- Tropical cones, tracks, watches, and outlooks come from the NHC tropical map service.
- Past storm tracks come from the NOAA HURDAT2 best track, and archive radar for a replay comes from the Iowa State Mesonet.

OpenRadar v0.1.0 is an early working release. It is not an official source for warnings or life-safety decisions.

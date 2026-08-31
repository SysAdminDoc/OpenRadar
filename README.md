<div align="center">

# OpenRadar

**A desktop weather radar that reads the raw data itself.**

[![Version](https://img.shields.io/badge/version-0.5.0-68d7ff)](https://github.com/SysAdminDoc/OpenRadar/releases)
[![License](https://img.shields.io/badge/license-MIT-8bd5ca)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-89b4fa)](https://github.com/SysAdminDoc/OpenRadar/releases)
[![Built with](https://img.shields.io/badge/built%20with-Tauri%202%20%C2%B7%20Rust%20%C2%B7%20React-cba6f7)](#how-it-is-put-together)

[Download](#install) · [What it does](#what-it-does) · [Build from source](#build-from-source) · [Where the data comes from](#where-the-data-comes-from)

<img width="1487" height="1058" alt="OpenRadar alerts workspace" src="assets/screenshots/openradar-main.png" />

</div>

---

OpenRadar decodes NEXRAD Level II volumes, MRMS national grids, GOES lightning and GFS wind on your own machine, in Rust, and draws them on a GPU vector map. No account, no API key, no subscription, no ads, and nothing held back behind a paid tier like MyRadar.

It is one window. Pan the planet, zoom from a globe down to a street, and scrub two hours of radar without the map moving under you.

## Why it exists

Good radar on Windows is either a web page that throttles you, or an app that charges by the month for the tilt selector. The data underneath all of it is public: NOAA publishes every Level II volume, every MRMS grid and every warning polygon, free, to anyone who asks.

So OpenRadar asks directly. The Rust side is a decoder, not a wrapper around somebody else's rendering service:

- **Single-site NEXRAD Level II** volumes, unpacked from the archive bucket and drawn as a sweep, with tilt and moment selection.
- **MRMS** GRIB2 grids at one kilometre, including the products that usually cost money: rotation tracks, hail size, echo tops, liquid held aloft.
- **GOES lightning** from the satellite's own NetCDF files, filtered on the instrument's quality flag.
- **GFS wind** fields, read a field at a time by byte range out of the run index.

Because the decoding happens here, the picture is not a screenshot of somebody's server. Load your own GRLevelX colour table and the legend rebuilds from it. Set a threshold in dBZ and the gates below it come off the picture.

## What it does

### Radar

- A two-hour NOAA mosaic loop at two-minute steps, with pause, scrub, speed and opacity.
- Past zoom 8 the nearest site that is actually publishing takes over with its own Level II sweep. Tilt, moment, and a hide-below threshold per product.
- Open any local Archive II volume without a network connection, or choose a NEXRAD site and UTC time from NOAA's public archive. Historical volumes keep their own source and time on the timeline, and current warnings stay off the historical picture.
- **Live volumes.** The archive object for a volume only lands once the radar has finished sweeping it, which puts the picture four to six minutes behind. Switch on "Volume in progress" and the sector the radar has reached right now is drawn over the last finished sweep, seconds old, with the legend counting the seconds.
- Velocity unfolded before it is drawn, so a wind faster than the radar can measure is not shown blowing the other way.
- Up to six hours of HRRR forecast reflectivity on the tail of the same timeline.
- Automatic failover between sources, with per-source status and a request budget you can watch in Diagnostics.

### Severe weather

- NWS watches and warnings, filtered by hazard rather than by a list of a hundred product names, with damage threat tags drawn heavier and named in the popup.
- **Storm cells** from the radar's own tracking algorithm: which blobs are one storm, where each is going, and where it will be in fifteen, thirty, forty-five and sixty minutes. Rotation is ringed.
- **Severe probability** from the National Severe Storms Laboratory model: how likely each storm is to turn severe in the next hour, and separately for hail, wind and a tornado. It is guidance, it draws under the warnings, and it says so.
- Storm reports, SPC convective outlooks and mesoscale discussions.
- A watched place that speaks up when a warning reaches it, wherever the map is pointed, with an optional tone.

### Beyond the United States

- **Canada** from Environment and Climate Change Canada, on its own rain-rate scale.
- **Germany** from the DWD composite of its seventeen radars, painted in the colours the service publishes it in.
- Alaska, Hawaii, Guam and the Caribbean each get their own MRMS grid rather than falling through to a personal-use feed.

### Tropical

- Cones, forecast tracks, coastal watches and development outlooks, with a storm list you can fly the map to.
- **Storm surge risk**: how far the water could reach for a hurricane of each category, from the National Hurricane Center's own maps.
- **Tides** from the nearest NOAA station, with the next high and low water, because surge rides on top of the tide.
- **Storm history**: every Atlantic and eastern Pacific cyclone since 1851, drawn by intensity, and archive radar replay for the ones since 2003.

### The rest of the sky

- GOES-East GeoColor satellite imagery under the radar, on the same timeline.
- Lightning two ways: the MRMS cloud-to-ground density grid, and GOES total lightning.
- Animated wind particles on the flat map and on the globe.
- Model guidance: what GFS, ECMWF, ICON and GEM each say about the middle of the map, side by side, so you can see where they disagree.

### Working with it

- Seven map styles, flat and globe projection, pitch and bearing, saved views, linked dual panes.
- Draw, range and point inspection tools. Beam height at the cursor for the sweep on screen.
- Per-overlay opacity and a drawing order you choose. Warnings are not in the arrangement, because nothing should be able to put a wildfire perimeter over one.
- **Export** the view as a picture, or the loop as a video or a GIF, with the time and the credits burned in.
- **Route weather**: a drive coloured by the chance of rain at the hour you reach each stretch.
- Place search, map-centred forecasts, GeoJSON and GRLevelX placefile import, shareable `openradar://` links.
- English and Spanish, switched in Settings and applied where you are standing rather than on the next launch.
- **An offline last view.** Tiles, radar frames and alert polygons are kept on disk, so a launch with no network opens on the last picture you saw and tells you how old it is.

## Install

Download `OpenRadar_<version>_x64-setup.exe` from the [releases page](https://github.com/SysAdminDoc/OpenRadar/releases) and run it. It installs for the current user, so it needs no administrator rights.

Windows will show a SmartScreen warning the first time. The installer is not Authenticode-signed yet, and SmartScreen warns about anything it has not seen before. Choose **More info**, then **Run anyway**. Every release ships a `SHA256SUMS` file if you would rather check the download first:

```powershell
Get-FileHash OpenRadar_0.5.0_x64-setup.exe -Algorithm SHA256
```

Updates are a different matter. OpenRadar checks for them only when you ask it to, from Diagnostics, and an update is signed with the project's own key and refused if the signature does not match. The SmartScreen gap does not extend to what arrives afterwards.

Windows x64 is the only target that is built and tested. Tauri 2 itself runs on macOS and Linux and nothing here is deliberately Windows-only, but no installer is produced for them and no release has been run on either, so treat a build there as untested.

## Privacy

OpenRadar has no account, telemetry, crash reporting or sync. Settings and logs stay on this machine.

The app sends the information needed to answer a request to fixed public providers. Typed place names and forecast coordinates go to Open-Meteo. Route start and end points go to the FOSSGIS routing service, which is told the app is OpenRadar, and points along that route go to Open-Meteo for the weather check. Map and radar requests go to the sources listed in Diagnostics. Those services receive the request and your IP address. Rust limits the desktop app to its configured hosts.

## Build from source

You will need Node.js 22 or newer, Rust 1.85 or newer, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm install
npm run tauri dev
```

For a browser preview, without any of the local decoding:

```powershell
npm run dev
```

To produce the Windows installer:

```powershell
npm run release
```

The command runs every local check, builds and verifies the signed updater installer, then places the installer, signature, update manifest, commit proof, and checksums in `artifacts/`. Add `-- --publish` to create the matching tag and GitHub release after the verified build. Builds happen on the machine in front of you, never on a runner.

### Checks

```powershell
npm run check        # format, lint, unit tests, type-check, build
npm run test:e2e     # Playwright, headless
npm run check:live   # asks every live provider whether it still answers
cargo test --lib     # from src-tauri/
```

The normal gate never touches the network. `npm run check:live` is the one that does: it walks every provider this app reads, in both the browser and the native half, spaced out so it stays a check rather than a small flood, and prints whether each one passed, failed, or was skipped. Add `-- --json` for the machine-readable form, or `-- --only=mrms` for a single source. It exits non-zero only when a source a release depends on is genuinely broken, and it refuses to run on shared build infrastructure, because these are public services that owe this project nothing.

The Rust suite has a second half that reaches the live NOAA buckets and is skipped by default. `npm run check:live` runs it for you, and `cargo test --lib -- --ignored` runs it directly when you want the full output.

## How it is put together

Tauri 2 shell, React 19 and TypeScript in the window, MapLibre GL for the map, and Rust for everything that has to read a binary format. Decoded products reach the map through registered URI schemes, so a grid decoded on your machine is an ordinary tile source rather than a special case in the timeline. Every native fetch goes through one host allowlist and one disk cache, which is also what makes the offline view possible.

There is more detail in [docs/architecture.md](docs/architecture.md), and the changelog is in [CHANGELOG.md](CHANGELOG.md).

## Where the data comes from

Everything OpenRadar draws is public data, and every source below is credited in the app as well as here.

| What               | Source                                                                                |
| ------------------ | ------------------------------------------------------------------------------------- |
| Radar mosaic       | NWS RIDGE II, with NOAA nowCOAST behind it                                            |
| National grids     | NOAA MRMS open data on AWS, decoded locally                                           |
| Single-site radar  | NEXRAD Level II from the Unidata archive and real-time chunk buckets, decoded locally |
| Forecast radar     | HRRR reflectivity via Iowa State Mesonet                                              |
| Canadian radar     | Environment and Climate Change Canada, GeoMet                                         |
| German radar       | Deutscher Wetterdienst GeoServer                                                      |
| Satellite          | GOES-East GeoColor through NASA GIBS                                                  |
| Lightning          | GOES-19 Geostationary Lightning Mapper on AWS                                         |
| Wind               | NOAA GFS open data on AWS                                                             |
| Warnings           | NWS event-driven map service                                                          |
| Severe probability | NSSL ProbSevere                                                                       |
| Tropical           | National Hurricane Center map service, HURDAT2 best track                             |
| Tides              | NOAA CO-OPS                                                                           |
| Earthquakes        | USGS                                                                                  |
| Wildfires          | NIFC                                                                                  |
| Basemap            | OpenStreetMap via OpenFreeMap; USGS orthoimagery; OpenTopoMap under CC-BY-SA          |
| Road routing       | FOSSGIS public Valhalla, on OpenStreetMap data                                        |
| Fallback radar     | RainViewer, only where the NOAA mosaics do not reach                                  |

We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).

RainViewer is licensed for personal and small community use, which is why it sits at the end of the chain rather than in front of it.

## Not a warning source

OpenRadar is a viewer for public data and nothing more. It is not an official source for warnings, and it is not something to make a life-safety decision on. When the weather is dangerous, listen to your local National Weather Service office, a NOAA Weather Radio, or whatever your country's equivalent is.

## Reporting a security problem

Use GitHub's private vulnerability reporting on this repository, from the Security tab. [SECURITY.md](SECURITY.md) covers which versions get fixes, what to expect after you send something, and the boundaries worth knowing about before you go looking.

## Licence

[MIT](LICENSE).

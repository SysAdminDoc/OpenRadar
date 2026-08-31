<div align="center">

# OpenRadar

**A desktop weather radar that reads the raw data itself.**

[![Version](https://img.shields.io/badge/version-0.6.0-68d7ff)](https://github.com/SysAdminDoc/OpenRadar/releases)
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
- **MRMS** GRIB2 grids at one kilometre, including the products that usually cost money: rotation tracks, hail size, echo tops, liquid held aloft, and what kind of precipitation is falling.
- **GOES lightning** from the satellite's own NetCDF files, filtered on the instrument's quality flag.
- **GFS wind** fields, read a field at a time by byte range out of the run index.

Because the decoding happens here, the picture is not a screenshot of somebody's server. Load your own GRLevelX colour table and the legend rebuilds from it. Set a threshold in dBZ and the gates below it come off the picture.

## What it does

### Radar

- A two-hour NOAA mosaic loop at two-minute steps, with pause, scrub, speed and opacity.
- Past zoom 8 the nearest site that is actually publishing takes over with its own Level II sweep. Tilt, moment, and a hide-below threshold per product.
- Open any local Archive II volume without a network connection, or choose a NEXRAD site and UTC time from NOAA's public archive. Historical volumes keep their own source and time on the timeline, and current warnings stay off the historical picture. The archive search crosses UTC midnight so it does not skip the nearest scan.
- **Live volumes.** The archive object for a volume only lands once the radar has finished sweeping it, which puts the picture four to six minutes behind. Switch on "Volume in progress" and the sector the radar has reached right now is drawn over the last finished sweep, seconds old, with the legend counting the seconds.
- Velocity unfolded before it is drawn, so a wind faster than the radar can measure is not shown blowing the other way.
- Up to six hours of HRRR forecast reflectivity on the tail of the same timeline.
- Automatic failover between sources, with per-source status and a request budget you can watch in Diagnostics.

### Severe weather

- NWS watches and warnings, filtered by hazard rather than by a list of a hundred product names, with damage threat tags drawn heavier and named in the popup.
- **Storm cells** from the radar's own tracking algorithm: which blobs are one storm, where each is going, and where it will be in fifteen, thirty, forty-five and sixty minutes. Rotation is ringed.
- **Severe probability** from the National Severe Storms Laboratory model: how likely each storm is to turn severe in the next hour, and separately for hail, wind and a tornado. It is guidance, it draws under the warnings, and it says so.
- Storm reports, SPC convective outlooks and mesoscale discussions.
- Up to ten watched places that speak up when a warning reaches them, wherever the map is pointed, each with its own radius, severity floor, tone and quiet hours. One warning covering several of them is announced once and names them all.

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
- **Cross-section**: draw a line between two points and the Level II volume is cut along it, height against distance. Heights no beam passed through stay empty rather than being filled from the nearest cut.
- Per-overlay opacity and a drawing order you choose. Warnings are not in the arrangement, because nothing should be able to put a wildfire perimeter over one.
- **Export** the view as a picture, or the loop as a video or a GIF, with the time and the credits burned in. The video is encoded as fast as the frames can be drawn rather than recorded in real time. A JSON record lands beside the file naming the source of every frame that reached it. See [What the export record holds](#what-the-export-record-holds).
- **Route weather**: a drive coloured by the chance of rain at the hour you reach each stretch.
- Place search, map-centred forecasts, shareable `openradar://` links.
- **Imported shapes as a managed set**: up to eight GeoJSON or GRLevelX placefiles on the map at once, each with its own name, switch, opacity and place in the drawing order. Importing a file you already have replaces it rather than adding a second copy. All of them draw under the warnings.
- English and Spanish, switched in Settings and applied where you are standing rather than on the next launch.
- **More contrast, if Windows is set to ask for it.** Every locally drawn picture switches to a scale measured under three kinds of colour blindness, and the bar beside the map is built from whichever scale painted what you are looking at. Warning outlines and storm tracks are stroked heavier. A colour table you loaded yourself is left exactly as you supplied it.
- **An offline last view.** Tiles, radar frames and alert polygons are kept on disk, so a launch with no network opens on the last picture you saw and tells you how old it is.
- **Prepared offline regions.** Settings can turn the current map view and a chosen zoom range into a PMTiles pack. Downloads pause and resume, each finished archive is checked before use and checked again after a restart, and a disk ceiling keeps simultaneous pack writes bounded.

## Install

Download `OpenRadar_<version>_x64-setup.exe` from the [releases page](https://github.com/SysAdminDoc/OpenRadar/releases) and run it. It installs for the current user, so it needs no administrator rights.

Windows will show a SmartScreen warning the first time. The installer is not Authenticode-signed yet, and SmartScreen warns about anything it has not seen before. Choose **More info**, then **Run anyway**. Every release ships a `SHA256SUMS` file if you would rather check the download first:

```powershell
Get-FileHash OpenRadar_0.6.0_x64-setup.exe -Algorithm SHA256
```

Updates are a different matter. OpenRadar checks for them only when you ask it to, from Diagnostics, and an update is signed with the project's own key and refused if the signature does not match. The SmartScreen gap does not extend to what arrives afterwards.

## Which platforms this runs on

Windows x64, and only Windows x64. That is the target the installer is built for, the one every release is tested on, and the one the whole test suite runs against.

Tauri 2 itself runs on macOS and Linux, and nothing in this project is deliberately Windows-only. What is missing is not code, it is evidence: no installer is produced for either, no release has ever been launched on one, and the parts most likely to differ are exactly the parts nobody has checked there. The updater, the file dialog, the custom URI schemes the map fetches its own tiles over, and the paths the cache and the offline packs are written to all behave differently per platform, and none of that has been exercised anywhere but Windows.

So a build on macOS or Linux may well work, and it is untested and unsupported. Concretely, that means:

- A bug that only happens on macOS or Linux is written down and left open, because there is no machine here to reproduce it on. It is not a promise of a fix.
- A patch is welcome, with the evidence a claim of support needs: a locally built installer, a real launch on real hardware, the core flows exercised, and the updater and the file dialog checked.
- Until that exists, the platform badge and the release page say Windows, and nothing else should read as a claim otherwise.

## Reporting something that is wrong

Open **Diagnostics** in the app and press **Copy**, then open an issue and paste the block in with what you did and what you expected. The [issue form](https://github.com/SysAdminDoc/OpenRadar/issues/new/choose) asks for both.

What the block contains: the version, this machine's renderer and platform, which sources answered and what they failed with, what is held on disk, a count of the recent warnings and errors by area, and the last forty log lines. What it does not contain: your watched place, your routes, your account name, or full file paths. Coordinates in the log are rounded to about a kilometre and account names are cut out of paths before anything reaches the clipboard. If where you are is part of the problem, there is a switch beside the Copy button that adds your watched place, still rounded.

None of it is sent anywhere. It goes to the clipboard, and you paste it, having read it.

## Privacy

OpenRadar has no account, telemetry, crash reporting or sync. Settings and logs stay on this machine.

Prepared incident packs stay in the app's data folder until you delete them. Workspace backups carry the pack name, bounds, size and hash so the reference survives, but they do not copy the map archive into the backup.

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
npm run check        # format, lint, unit tests, type-check, build, bundle budget
npm run test:e2e     # Playwright, headless, at 1024, 1440 and 1920 wide
npm run check:live   # asks every live provider whether it still answers
cargo test --lib     # from src-tauri/
```

The build ends on a size gate. `scripts/bundle-budget.mjs` measures each chunk in `dist`, raw and gzipped, against budgets written down beside them, and fails when one grows past its budget. The main chunk is 77 per cent MapLibre GL and React DOM by module bytes, both on the path to the first interactive map, so there is nothing to split out of it that would not put the map behind a second download; the panels, the export encoders and the storm archive already load only when a reader opens them. `node scripts/bundle-report.mjs` says what is inside a chunk when the gate trips, and `--detail` breaks the app's own files out one by one.

The normal gate never touches the network. `npm run check:live` is the one that does: it walks every provider this app reads, in both the browser and the native half, spaced out so it stays a check rather than a small flood, and prints whether each one passed, failed, or was skipped. Add `-- --json` for the machine-readable form, or `-- --only=mrms` for a single source. It exits non-zero only when a source a release depends on is genuinely broken, and it refuses to run on shared build infrastructure, because these are public services that owe this project nothing.

The Rust suite has a second half that reaches the live NOAA buckets and is skipped by default. `npm run check:live` runs it for you, and `cargo test --lib -- --ignored` runs it directly when you want the full output.

## How it is put together

Tauri 2 shell, React 19 and TypeScript in the window, MapLibre GL for the map, and Rust for everything that has to read a binary format. Decoded products reach the map through registered URI schemes, so a grid decoded on your machine is an ordinary tile source rather than a special case in the timeline. Every native fetch goes through one host allowlist. Short-lived responses use a bounded cache; prepared PMTiles packs use a separate durable store so clearing ordinary cache data cannot erase them.

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
| Basemap            | OpenStreetMap via OpenFreeMap; USGS imagery and The National Map Topo; OpenTopoMap    |
| Road routing       | FOSSGIS public Valhalla, on OpenStreetMap data                                        |
| Fallback radar     | RainViewer, only where the NOAA mosaics do not reach                                  |

We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).

RainViewer is licensed for personal and small community use, which is why it sits at the end of the chain rather than in front of it.

### What the export record holds

A caption has room for a time and a credit, which is enough to know what you are looking at and not enough to check it. So every export writes a second file next to the picture, named after it: `openradar-loop-2026-08-31T18-04-11-provenance.json` beside `openradar-loop-2026-08-31T18-04-11.webm`.

It is plain JSON with a `format` of `openradar-provenance` and a `formatVersion` of `1`. The version only moves if the shape changes in a way that would break a reader.

```json
{
  "format": "openradar-provenance",
  "formatVersion": 1,
  "application": "OpenRadar 0.6.0",
  "writtenAt": "2026-08-31T18:04:12.318Z",
  "picture": "openradar-loop-2026-08-31T18-04-11.webm",
  "basemap": "OpenStreetMap",
  "frames": [
    {
      "index": 0,
      "sourceId": "mrms",
      "label": "MRMS",
      "attribution": "NOAA MRMS",
      "attributionUrl": "https://www.nssl.noaa.gov/projects/mrms/",
      "kind": "observation",
      "observed": "2026-08-31T18:00:00.000Z",
      "valid": "2026-08-31T18:00:00.000Z",
      "fetched": "2026-08-31T18:03:57.001Z",
      "freshForMs": 120000,
      "cachedAgeSeconds": null
    }
  ]
}
```

One entry per frame that reached the file, in timeline order. A loop is not one source: its observed frames and its forecast tail come from different services, and a GIF holds only the last two dozen frames, so a single record for the whole file would be wrong for most of it.

`kind` is `observation`, `forecast` or `derived`, and it decides the rest. A forecast has no `observed` time, because nothing measured it; it carries a `modelRun` with the run's `initUtc` and `leadMinutes`, or `runUnknown` when the source will not say which run it used. A `derived` frame carries `derivedFrom` saying what was done to the values. `cachedAgeSeconds` is null when the bytes came off the network and a number when the disk cache served them, which is what separates a current picture from one that survived an outage.

The times are ISO strings rather than the milliseconds the app uses internally, because a file outlives the program that wrote it and a number with no units is a guess.

OpenRadar is a viewer for public data and nothing more. It is not an official source for warnings, and it is not something to make a life-safety decision on. When the weather is dangerous, listen to your local National Weather Service office, a NOAA Weather Radio, or whatever your country's equivalent is.

## Reporting a security problem

Use GitHub's private vulnerability reporting on this repository, from the Security tab. [SECURITY.md](SECURITY.md) covers which versions get fixes, what to expect after you send something, and the boundaries worth knowing about before you go looking.

## Licence

[MIT](LICENSE).

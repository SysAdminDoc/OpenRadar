# Architecture

OpenRadar is a Tauri 2 desktop app: a Rust binary that decodes weather data and a React 19 interface drawn with MapLibre GL, built with TypeScript and Vite. The shell stays small, and the map renders vector tiles and raster weather on the GPU.

## Why the Rust side is not a thin wrapper

Most of the weather this app draws arrives as a format a browser cannot open: GRIB2 grids, NEXRAD Level II volumes, NetCDF satellite files, PMTiles archives. Decoding those in Rust keeps the work off the thread drawing the map, and it means no service has to render the data first and hand over a picture somebody else has already made decisions about.

A decoded product reaches the map through a registered URI scheme, so it is an ordinary tile source rather than a special case in the timeline. Everything the native side fetches goes through one host allowlist and one bounded cache, which is what lets the app open on the last view with no network.

## The native modules

Every module in `src-tauri/src/`:

**The network boundary.** `http` is the one place a Rust-side fetch happens, and every address is checked against the allowlist first. `cache` is the disk cache behind the offline last view: entries are written beside their name and renamed into place, the format version is the directory name, and the budget is 2,048 entries or 256 MiB with the oldest going first. A hash collision is a miss rather than the wrong tile, because the address is written into the entry and checked on the way out. `tiles` serves the `cached` scheme to the webview, falling back to what was kept when a fetch fails. The cache can also be read and emptied from Settings, and emptying it touches only its own version directory: incident packs and replay bundles sit beside it and are downloads a reader asked for.

**Radar.** `mrms` decodes the national mosaic. Those files are GRIB2 with data representation template 41, which is a 16-bit PNG plus a linear scale, so the decode needs no GRIB library at all. `level2` is single-site NEXRAD: it lists the recent and historical archive buckets, opens local Archive II files, decodes volumes and draws one sweep as a Web Mercator PNG laid over the site's own extent. `chunks` is the same radar a few minutes earlier, assembling the pieces of a volume the radar is still sweeping. `level3` reads the products a site publishes ready-made, and `tdwr` is the FAA's airport radars, which publish only in that form. `dealias` unfolds velocity, and `vad` fits the wind a sweep is moving in so storm-relative velocity has something to subtract. `cross_section` cuts a volume along a line between two points. `radar_status` asks the NWS what each radar says about itself, which is how the picker knows a site is restarting rather than merely quiet. `crash` is the small second process that watches this one: a decoder walking off the end of a buffer takes the app down with no panic and no line in the log, and this leaves a minidump behind on the machine so the next launch has something to point at.

**Everything else in the sky.** `lightning` reads GOES flash centroids out of NetCDF-4, which is HDF5 underneath. `gfs` and `hrrr` decode the model fields the wind particles and the forecast tail are drawn from, including HRRR's near-surface smoke. `probsevere` reads the severe-probability model.

**Leaving with something.** `exports` writes the picture, the video and the GIF. `data_export` writes the readings rather than the picture, and `geotiff` is the single-band float raster half of that. `bundles` reads and writes the `.orb` replay file, whose layout is documented in full at the top of the module. `palette` holds the colour tables, and `contrast` is the colour-vision measurement they are held to; it is compiled into the tests only, because what ships is the ramps it vouches for rather than the arithmetic.

**Kept on the machine.** `incident_packs` owns durable offline basemaps, separately from the disposable cache: a bounded tile set is journaled with per-tile hashes, written to PMTiles, read back tile by tile and hashed before an atomic rename makes it selectable. `journal` is the reader's own record, one JSON row per line so a damaged line costs one entry rather than the file.

**The desktop itself.** `tray` owns the icon, its menu and the small glance window; `glance` is what that window reads. `wallpaper` writes one PNG and points the desktop at it, remembering what was there before so it can be put back. `sound` reads the alert sound a reader chose, refusing anything too large or of a kind the picker does not offer. `host` answers for the WebView2 runtime's version, which updates on Microsoft's schedule rather than with the app. `window_geometry` centres the window at the size the app opens at, which is the one piece of the arrangement that lives outside the settings file: the crash screen's Reset layout calls it so a window restored onto a monitor that is no longer there can be recovered.

**Testing.** `fixture` writes Level II volumes byte by byte to the published layout, so a test has a volume with known readings in it. A real one is ten megabytes, cannot be committed, and would make the weather part of the test.

## The interface

`src/components/MapViewport.tsx` owns the MapLibre instance and the camera bridge. `src/lib/overlays/` holds one adapter per non-radar layer, each owning its fetch, its layer specs and its popup text, driven from the viewport by `src/hooks/useOverlays.ts`. `src/lib/providers/` holds the radar source chain, its rolling request budget and its per-source health. `src/App.tsx` wires the hooks together and lays out three pieces: the panes, everything the command bar opens, and the chrome around the map.

Camera state is kept independent of radar playback, which is what lets a loop run while the camera moves. Settings are stored as readable JSON. The MapLibre worker stays on the app origin.

`src/i18n/` holds the copy. English is the source and the other languages are typed against it, so a string added on one side and not the others is a build error rather than a blank label. Each translation is a chunk fetched on demand.

`src/lib/theme.ts` is the boundary between how the workspace looks and how the data looks. A theme can reach eleven chrome tokens and nothing else: not a reflectivity ramp, not a warning outline, not a hazard colour. That boundary is a test rather than a promise.

MapLibre 6 requires WebGL2 and has no software fallback, so the app checks for it before mounting and explains the failure rather than letting the renderer throw.

## Rules live in functions, not in components

A rule a component applies inline can only be tested by a test that writes the rule out again, and a test that restates a rule passes against code that no longer follows it. Three did here before anybody noticed. So a rule of any weight is pulled out into a named function next to the code that calls it, exported, and driven directly by its test: which frames fall inside the loop, when an overlay is worth refetching, how long to wait before trying a stale forecast cycle again, which warnings pair with which layer.

That means about a hundred and fifty exported symbols in `src/` whose only caller outside their own file is a test. They are not dead code and they are not an oversight. `scripts/unused-exports.mjs`, which `npm run check` runs, reports a symbol nothing in the tree names at all, and says nothing about one a test drives.

## Why this stack

WPF with WebView2 would be Windows-only and still carry two runtimes. Avalonia has a weaker path for the raster and custom radar layers this needs. Electron adds a much larger desktop runtime. Qt brings licensing and distribution friction that does not help this project.

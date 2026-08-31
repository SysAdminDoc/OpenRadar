# Architecture decision

OpenRadar uses Tauri 2 with React 19, TypeScript, Vite, and MapLibre GL. This keeps the desktop shell small while letting the app render vector maps and raster weather data on the GPU.

The Rust side is not a thin wrapper. It decodes the weather data itself, away from the interface thread and away from any service that would otherwise have to render it first: the MRMS national grid and its rotation, hail and lightning products from GRIB2, single-site NEXRAD Level II volumes, GOES-East lightning from the satellite's own NetCDF files, and GFS wind fields. Decoded tiles reach the map through registered URI schemes, so a locally decoded product is an ordinary tile source rather than a special case in the timeline. Everything native fetches goes through one host allowlist and a bounded cache, which is what lets the app open on the last view with no network.

Prepared incident packs use a different store because they are user-kept data, not disposable cache entries. Rust downloads a bounded USGS tile set into an append-only hash journal, builds one PMTiles archive, reads every tile back, and hashes the finished file before an atomic rename makes it selectable. The `incident` URI scheme reads only that local archive, with no network fallback. Pack bytes stay in app data until deletion; workspace backups contain portable references rather than the archives.

Settings are stored as readable JSON. The MapLibre worker stays on the app origin. Globe projection, pitch, bearing, center, and zoom are first-class camera state, kept independent of radar playback, which is what lets a loop run while the camera moves.

MapLibre 6 requires WebGL2 and has no software fallback, so the app checks for it before mounting and explains the failure rather than letting the renderer throw.

WPF with WebView2 would be Windows-only and still carry two runtimes. Avalonia has a weaker path for the raster and custom radar layers this needs. Electron adds a much larger desktop runtime. Qt brings licensing and distribution friction that does not help this project.

The product name is OpenRadar. GitHub has unrelated projects with the same words, mainly mmWave and software issue trackers, but no repository exists under the selected owner and no exact weather app listing surfaced in the Microsoft Store search.

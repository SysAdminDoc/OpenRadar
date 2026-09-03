# Asset ledger

Everything OpenRadar ships or fetches, where it comes from, and what using it obliges.

The host table below is held to `ALLOWED_HOSTS` in `src-tauri/src/http.rs` by `src/lib/assetLedger.test.ts`, which fails if the two ever disagree. That list is the only set of addresses a native fetch may reach. The webview has its own narrower content security policy in `src-tauri/tauri.conf.json`, checked separately by `src/lib/csp.test.ts`.

## Bundled with the app

| Asset | Source | Licence | Obligation |
| --- | --- | --- | --- |
| OpenRadar brand mark | New asset | Project's own | None |
| Command icons | Lucide | ISC | Named accessibly in the app; the licence text travels with the package |
| Colour ramps | Written for this project from the published NWS reflectivity and velocity scales | Project's own | None. A loaded GRLevelX table replaces them at the user's choosing |
| Interface reference mockups | Original OpenRadar design studies | Project's own | Kept under `docs/mockups/` as design history; not packaged with the app |
| README workspace screenshot | Live OpenRadar browser capture | Project's own | Documentation only |
| `public/hurdat/` | NOAA HURDAT2 best track, Atlantic and eastern Pacific | US Government work, no copyright | Credited in the History panel. One index and one file per decade, rebuilt by `scripts/build-hurdat.mjs` |
| `public/tide-stations.json` | NOAA CO-OPS station list | US Government work, no copyright | Credited in the Tides panel. Rebuilt by `scripts/build-tide-stations.mjs` |
| `public/counties.json` | US Census cartographic boundary outlines, counties and states, 1:20,000,000, 2024 vintage | US Government work, no copyright | Credited in the provenance record for the Counties layer. Rebuilt by `scripts/build-counties.mjs`, which refuses anything over a megabyte |
| Reference application screenshots | Local audit evidence only | Not licensed for redistribution | Never copied into the app or the repository |

## Fetched at runtime

Every one of these is reached over HTTPS with no account, no API key and no credentials. "Cached" says whether the bytes are kept on disk, which is what makes the offline last view possible. "What the service learns" is the honest answer to what leaves this machine, and in every case it includes your IP address, because that is how a request works.

| Host | What it serves | Licence or terms | Credit shown | Cached | What the service learns |
| --- | --- | --- | --- | --- | --- |
| `tiles.openfreemap.org` | Vector basemap, sprites, glyphs | ODbL data, free service, no key | OpenFreeMap and OpenStreetMap, in the map credits | Yes, through the native cache | Which map tiles you looked at, so roughly where you were looking |
| `basemap.nationalmap.gov` | USGS orthoimagery for the aerial style | US Government work | USGS The National Map, in the map credits | Yes, through the native cache | Which tiles you looked at, when the aerial style is on |
| `tile.opentopomap.org` | Topographic style | CC-BY-SA 3.0 | The exact line OpenTopoMap asks for, in `src/lib/mapStyles.ts` | Yes, through the native cache | Which tiles you looked at, when the topographic style is on |
| `opengeo.ncep.noaa.gov` | NWS RIDGE II reflectivity mosaic | US Government work | NWS RIDGE II, in the timeline credit | Yes, through the native cache | The area and times you asked for radar over |
| `nowcoast.noaa.gov` | NOAA nowCOAST radar, the RIDGE fallback | US Government work | NOAA nowCOAST, in the timeline credit | Yes, through the native cache | The area and times you asked for radar over |
| `noaa-mrms-pds.s3.amazonaws.com` | MRMS GRIB2 grids and ProbSevere, decoded here | US Government work, AWS Open Data | NOAA MRMS, in the timeline and legend | Yes, decoded and kept natively | Which national grids you asked for, not where you are looking within them |
| `unidata-nexrad-level2.s3.amazonaws.com` | NEXRAD Level II volumes, decoded here | US Government work, AWS Open Data | The site and tilt, in the legend | Yes, decoded and kept natively | Which radar site you are watching, which is roughly where you are |
| `unidata-nexrad-level2-chunks.s3.amazonaws.com` | The volume a radar is sweeping right now, in pieces | US Government work, AWS Open Data | The site, tilt and live age, in the legend | Yes, decoded and kept natively | Which radar site you are watching, polled while a live sweep is on |
| `unidata-nexrad-level3.s3.amazonaws.com` | Storm cell tracking, mesocyclone and hydrometeor classification products, and the terminal radars' base products | US Government work, AWS Open Data | The site, in the storm cell detail | Yes, decoded and kept natively | Which radar site you are watching, when storm cells are on |
| `noaa-goes19.s3.amazonaws.com` | GOES-19 lightning mapper files, decoded here | US Government work, AWS Open Data | GOES-East, in the lightning legend, with the not-a-strike-report note | Yes, decoded and kept natively | That you asked for a lightning window, not where you were looking |
| `noaa-gfs-bdp-pds.s3.amazonaws.com` | GFS wind fields, read by byte range | US Government work, AWS Open Data | The model run, in the wind banner | Yes, decoded and kept natively | Which model run and fields you asked for |
| `noaa-hrrr-bdp-pds.s3.amazonaws.com` | HRRR near-surface smoke, one hour at a time by byte range, for the forecast tail | US Government work, AWS Open Data | The model cycle and lead, in the forecast smoke legend | Yes, decoded and kept natively | Which cycle and hours you scrubbed to, when forecast smoke is on |
| `gibs.earthdata.nasa.gov` | GOES-East imagery: GeoColor, and the Band 13 clean infrared window | Free, no key | NASA GIBS and NOAA NESDIS, plus the acknowledgement GIBS asks for, in the README credits | Yes, through the native cache | Which tiles and times you asked for, when satellite is on |
| `mesonet.agron.iastate.edu` | HRRR forecast reflectivity, the radar archive for replays, local storm reports, the storm-based warning archive that draws the warnings in force during a replay, and the upper air soundings behind the Skew-T | Free for any lawful purpose, no key | Iowa State Mesonet, in the timeline credit | Yes, through the native cache | The area and times you asked for, including which past event you replayed |
| `geo.weather.gc.ca` | Environment and Climate Change Canada radar | ECCC open data licence, attribution required | ECCC GeoMet, in the timeline credit and legend | Yes, through the native cache | The area and times you asked for radar over, inside Canada |
| `maps.dwd.de` (warnings) | Deutscher Wetterdienst public weather warnings | DWD open data, CC BY 4.0, with "Datenbasis: Deutscher Wetterdienst" and the BKG geometry credit the service carries in its own `EC_LICENSE` field | Named as the office on every German warning in the popup and the panel | Yes, through the native cache | The area you are looking at, when it reaches Germany |
| `api.weather.gc.ca` | Environment and Climate Change Canada public weather alerts | ECCC open data licence, attribution required, and the content and intent of an alert may not be altered | Named as the office on every Canadian warning in the popup and the panel | Yes, through the native cache | The area you are looking at, when it reaches Canada |
| `maps.dwd.de` | Deutscher Wetterdienst composite of its national radars | DWD open data, attribution required | DWD, in the timeline credit and legend | Yes, through the native cache | The area and times you asked for radar over, inside Germany |
| `mapservices.weather.noaa.gov` | NWS watches and warnings, SPC outlooks and discussions, WPC excessive rainfall and winter storm severity, NHC tropical, storm surge risk | US Government work | NWS and NHC, in each layer's detail | Yes, through the native cache | The area you have on screen, refreshed while the layer is on |
| `earthquake.usgs.gov` | Earthquake feed | US Government work | USGS, in the popup | Yes, through the native cache | The area you have on screen, when earthquakes are on |
| `services3.arcgis.com` | NIFC wildfire perimeters | Public, no key | NIFC, in the popup | Yes, through the native cache | The area you have on screen, when wildfires are on |
| `satepsanone.nesdis.noaa.gov` | NOAA HMS daily smoke analysis | US Government work | NOAA Hazard Mapping System, in the popup | Yes, through the native cache | Nothing about you; one file a day for the whole country |
| `aviationweather.gov` | Surface observations (METAR) | US Government work, no key | NOAA Aviation Weather Center, in the popup | Yes, through the native cache | The area you have on screen, when surface observations are on; and, when the weather on the chrome is switched on, a box of about a degree and a half around your watched place, once every ten minutes while the window is in front |
| `api.water.noaa.gov` | River gauges: what each forecast point reads now and what it is expected to reach | US Government work, no key | NOAA National Water Prediction Service, in the popup | Yes, through the native cache | The area you have on screen, when river gauges are on and the view is zoomed in far enough to read them |
| `api.weather.gov` | Alert detail | US Government work, User-Agent required | NWS, in the alert detail | Yes, through the native cache | Which alert you opened |
| `api.open-meteo.com` | Forecast and model guidance; and the pressure-level column behind a forecast sounding | CC-BY 4.0, non-commercial free tier | Open-Meteo, in each panel | Yes, through the native cache | The exact coordinates you asked a forecast for, including a watched place and every point along a route |
| `previous-runs-api.open-meteo.com` | What each model said about the same hours in an earlier run | CC-BY 4.0, non-commercial free tier | Open-Meteo, in the Guidance panel | Yes, through the native cache | The coordinates you asked guidance for, and only while the comparison is switched on |
| `geocoding-api.open-meteo.com` | Place search | CC-BY 4.0, non-commercial free tier | Open-Meteo, in the Search panel | No, a search is asked fresh | The place names you typed |
| `api.tidesandcurrents.noaa.gov` | Tide predictions | US Government work | NOAA CO-OPS, in the Tides panel | Yes, through the native cache | Which tide station is nearest to you |
| `valhalla1.openstreetmap.de` | Road shape for route weather | FOSSGIS public Valhalla on OpenStreetMap data, ODbL, fair use, one request a second, apps handed to others identify themselves | OpenStreetMap and FOSSGIS, named in the Route panel itself | No, a route is asked fresh | Where you are driving from and to, and that the app is OpenRadar |
| `api.rainviewer.com`, `tilecache.rainviewer.com` | Radar outside the NOAA, ECCC and DWD mosaics only | Personal and educational use since 2026-01-01 | RainViewer, in the timeline credit | Yes, through the native cache | The area and times you asked for radar over, outside the mosaics |

Nothing here needs an account or an API key. RainViewer's terms are the tightest of the set, which is why it is the last source in the chain rather than the first. The two entries with the most to learn about you are Open-Meteo, which is handed coordinates rather than tiles, and the router, which is handed both ends of a drive. Neither is reached until you ask for a forecast or a route.

Routing moved from the OSRM demo server to the FOSSGIS Valhalla instance on 2026-08-31. The reason was a rule this app could not keep: OSRM's usage policy requires a request to carry an identifying User-Agent, and a browser will not let a page set that header at all, so every route request from here was anonymous whether it wanted to be or not. FOSSGIS asks instead for a header a page can send, and names it in its own CORS policy, which makes it the first routing service this app can actually comply with. The straight-line estimate is still what a reader gets when the router cannot be reached, and it still says that is what it is.

# Asset ledger

Everything OpenRadar ships or fetches, where it comes from, and what using it obliges. The host column matches `ALLOWED_HOSTS` in `src-tauri/src/http.rs`, which is the only list a native fetch may reach.

## Bundled with the app

| Asset | Source | Licence | Obligation |
| --- | --- | --- | --- |
| OpenRadar brand mark | New asset | Project's own | None |
| Command icons | Lucide | ISC | Named accessibly in the app; the licence text travels with the package |
| Colour ramps | Written for this project from the published NWS reflectivity and velocity scales | Project's own | None. A loaded GRLevelX table replaces them at the user's choosing |
| Interface reference mockups | Original OpenRadar design studies | Project's own | Kept under `docs/mockups/` as design history; not packaged with the app |
| README workspace screenshot | Live OpenRadar browser capture | Project's own | Documentation only |
| `public/hurdat.json` | NOAA HURDAT2 best track, Atlantic and eastern Pacific | US Government work, no copyright | Credited in the History panel |
| `public/tide-stations.json` | NOAA CO-OPS station list | US Government work, no copyright | Credited in the Tides panel |
| Reference application screenshots | Local audit evidence only | Not licensed for redistribution | Never copied into the app or the repository |

## Fetched at runtime

| Host | What it serves | Licence or terms | Credit shown |
| --- | --- | --- | --- |
| `tiles.openfreemap.org` | Vector basemap, sprites, glyphs | ODbL data, free service, no key | OpenFreeMap and OpenStreetMap, in the map credits |
| `basemap.nationalmap.gov` | USGS orthoimagery for the aerial style | US Government work | USGS The National Map, in the map credits |
| `tile.opentopomap.org` | Topographic style | CC-BY-SA 3.0 | The exact line OpenTopoMap asks for, in `src/lib/mapStyles.ts` |
| `opengeo.ncep.noaa.gov` | NWS RIDGE II reflectivity mosaic | US Government work | NWS RIDGE II, in the timeline credit |
| `nowcoast.noaa.gov` | NOAA nowCOAST radar, the RIDGE fallback | US Government work | NOAA nowCOAST, in the timeline credit |
| `noaa-mrms-pds.s3.amazonaws.com` | MRMS GRIB2 grids, decoded here | US Government work, AWS Open Data | NOAA MRMS, in the timeline and legend |
| `unidata-nexrad-level2.s3.amazonaws.com` | NEXRAD Level II volumes, decoded here | US Government work, AWS Open Data | The site and tilt, in the legend |
| `noaa-goes19.s3.amazonaws.com` | GOES-19 lightning mapper files, decoded here | US Government work, AWS Open Data | GOES-East, in the lightning legend, with the not-a-strike-report note |
| `noaa-gfs-bdp-pds.s3.amazonaws.com` | GFS wind fields, decoded here | US Government work, AWS Open Data | The model run, in the wind banner |
| `gibs.earthdata.nasa.gov` | GOES-East GeoColor imagery | Free, no key | NASA GIBS and NOAA NESDIS, plus the acknowledgement GIBS asks for, in the README credits |
| `mesonet.agron.iastate.edu` | HRRR forecast reflectivity and the radar archive for replays | Free for any lawful purpose, no key | Iowa State Mesonet, in the timeline credit |
| `geo.weather.gc.ca` | Environment and Climate Change Canada radar | ECCC open data licence, attribution required | ECCC GeoMet, in the timeline credit and legend |
| `mapservices.weather.noaa.gov` | NWS watches and warnings, NHC tropical, storm surge risk | US Government work | NWS and NHC, in each layer's detail |
| `earthquake.usgs.gov` | Earthquake feed | US Government work | USGS, in the popup |
| `services3.arcgis.com` | NIFC wildfire perimeters | Public, no key | NIFC, in the popup |
| `api.weather.gov` | Alert detail | US Government work, User-Agent required | NWS, in the alert detail |
| `api.open-meteo.com`, `geocoding-api.open-meteo.com` | Forecast, model guidance, place search | CC-BY 4.0, non-commercial free tier | Open-Meteo, in each panel |
| `api.tidesandcurrents.noaa.gov` | Tide predictions | US Government work | NOAA CO-OPS, in the Tides panel |
| `router.project-osrm.org` | Road shape for route weather | Demo server, non-commercial, one request a second | OSRM, in the Route panel |
| `api.rainviewer.com`, `tilecache.rainviewer.com` | Radar outside the NOAA and ECCC mosaics only | Personal and educational use since 2026-01-01 | RainViewer, in the timeline credit |

Nothing here needs an account or an API key. RainViewer's terms are the tightest of the set, which is why it is the last source in the chain rather than the first.

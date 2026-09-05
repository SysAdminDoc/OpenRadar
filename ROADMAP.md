# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items, including `AUD-001`, `AUD-002`, and `AUD-011` through `AUD-066`, are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

Items numbered `AUD-` come from the audit register and are ordered P0 through P3. Items numbered `JOY-` come from a separate 2026-08-31 intake about character and personalization, and they live in their own section. Nothing in that section outranks a correctness, security, or release item. `AUD-093` onward and `JOY-021` were added by the 2026-08-31 evening research pass and sit under Research-Driven Additions at the end, each carrying its own priority. `AUD-206` through `AUD-232` were added by the 2026-09-03 research pass in their own section at the end.

## P1

## P2


## P3

## Character and personalization

These came out of a different question than the audit did: what makes somebody keep a weather app open on a second monitor for a year rather than opening it twice during a storm and forgetting it. None of it outranks a correctness, security, or release item, which is why it sits after P3 instead of being folded into the priority ladder.

Every item below obeys the same rules, and one that cannot obey them is not worth building.

- Data is never decoration. A theme, an effect, or a mode may restyle the interface around the map. It may not change a reflectivity ramp, a warning outline, a probability figure, or a timestamp. Anything that does change how hazard information reads has to say so where the reader turns it on.
- Nothing new leaves the machine. No account, no sync, no usage reporting, and no new host in the native allowlist unless the item names it and the ledger carries it.
- Everything is reversible in one action, and the workspace opens plain for a reader who wants it plain.
- `prefers-reduced-motion` removes the motion, not the feature.
- Nothing applies pressure. No streaks to break, no badges to chase, and no notification that is about the app rather than about the weather.
- Playful surfaces stand down during danger. While a warning is active at a watched place, themes stay quiet, effects stop, and nothing discoverable reveals itself; the map is a serious instrument for as long as the warning stands. (Added 2026-08-31; the safety precedent and the backlash record are in `RESEARCH.md`.)

## Audit Findings, 2026-09-02

Read-only audit of `d608d27` (v0.7.0). Baseline at that commit, all green: `npm run check` 146 files / 1282 passed / 19 skipped, lint clean, every bundle inside budget; `npx playwright test` 424 passed across chromium, compact and wide; `cargo test` 353 passed / 26 ignored; `npm run release` staged a signed `OpenRadar_0.7.0_x64-setup.exe`. GitHub issues are enabled but the tracker holds zero issues (open or closed) and zero pull requests, so there was nothing to take in from reporters. Every P1 below survived a fresh-context refutation pass. Items are numbered on from `AUD-126`.

Two things to know before draining. First, most of what follows lives where the e2e suite cannot see: inside the packaged Tauri window (the ACL, the opener plugin, the asset protocol) and in the light theme with a panel open. Second, the browser probe that found the light-theme items is not in the repo; the acceptance lines say what to assert instead.

### P1

### P2

### P3

### Unaudited, needs a pass

These could not be observed in this pass, which ran headless browser automation and read the packaged binary's configuration but did not drive the installed app on a screen. Each is a place where the e2e suite also cannot see.

- [ ] AUD-166: Long-session memory and the two-day-old cached view
      Category: perf
      Where: `src/hooks/useRadarTimeline.ts`, `src-tauri/src/cache.rs`, the map's tile sources
      Problem: The product is meant to be left open on a second monitor for days. Nothing in this pass ran longer than a few minutes; whether the webview's memory stays flat over a day of loops, palette changes and panel opens is unmeasured.
      Evidence: No soak test exists in `e2e/` or `scripts/`. (2026-09-03: a 17-point Hacker News thread on the Windows 11 Weather app using 1.2 GB of RAM, https://news.ycombinator.com/item?id=49290078, says a native app should fit in 100 MB; the measured number belongs in the README once this runs. Measure the `msedgewebview2` children, not the Rust process alone.)
      Fix: A soak script that opens the workspace, runs the loop at the slowed ambient cadence for eight hours with a stubbed radar host, and samples `performance.memory` and the Rust process RSS every ten minutes.
      Acceptance: A recorded run with flat memory, or a leak logged here with the sampler's trace.
      Confidence: Needs-repro
      Effort: M

## Research-Driven Additions

Added by the 2026-09-02 research pass (`RESEARCH.md` of the same date carries the evidence). Numbered `AUD-168` onward; `AUD-168` moved to `Roadmap_Blocked.md` behind the release gate and `AUD-169` through `AUD-172` shipped the same day, with `AUD-201` recording what the loop left unfinished. Every host named below is either already in `ALLOWED_HOSTS` or is named in the item, and any new one needs the ledger row, the CSP entry and a `check:live` contract like the rest. Nothing here outranks an open audit item of the same priority.

### P1

### P2

### P3
  Note 2026-09-04: Retention evidence: a Bluesky reader stays on RadarScope for being "the lightest running" (2026-08-26); Anvil's memory sampler (`0f5972d`) shows a 26-frame replay retaining 2,178 MB, which is the comparison the README number would sit against.
- [ ] AUD-189 (P3): Azimuthal shear from the volume itself, with a rotation product and a debris flag
  Why: MRMS AzShear is a 2-minute national grid; the same LLSD method on the held site's own dealiased velocity gives rotation at gate resolution seconds after the sweep, which is what GR2Analyst's NROT is and what no open-source app ships; a tornado debris flag needs it.
  Evidence: Mahalik et al. 2019 (NOAA IR PDF): 2500 m azimuthal by 750 m radial kernel, radial count adapted per range, cap 51 radials, minimum 3x3, 3x3 median pre-filter, mask to reflectivity at or above 20 dBZ; WDTD thresholds; the RLX NROT deck (5x5 fit, range-normalised, above 1.0 significant, above 2.5 extreme); PyMeso as a reference implementation; TDS criteria (correlation coefficient below 0.8, ZDR below 0.5 dB, reflectivity above 30 dBZ, collocated with strong shear).
  Touches: new `src-tauri/src/shear.rs`, `src-tauri/src/level2/ramp.rs` product table (`azimuthal-shear`, `rotation`) and `src-tauri/src/level2/sweep.rs` for the cut it reads, ramps with the colour-vision test, `RadarProductPanel.tsx`, legends and catalogues, `data_export.rs` (`derivation` records the kernel).
  Acceptance: An azimuthal shear product draws for any Doppler cut with the kernel documented in the legend; a normalised rotation product follows the NROT range curve; a debris flag marks gates meeting the four criteria within two kilometres of shear at or above 0.006 s⁻¹ and is labelled as a signature, not a confirmation; a planted couplet in the fixture volume produces the expected shear magnitude in a test.
  Complexity: M

- [ ] AUD-190 (P3): Single-site vertical products: composite, echo tops, VIL and hail size from the volume
  Why: GR2Analyst ships ET, VIL, VILD, POSH and MEHS from the volume and readers compare them against MRMS; the app has the MRMS grids and the sounding heights the hail algorithm needs, but nothing derived from the site.
  Evidence: ROC algorithm descriptions (echo tops NX-DR-03-013, VIL NX-DR-03-006 with the 56 dBZ ice cap), WDTD SHI/POSH/MESH pages (Witt et al. 1998: ramp 40 to 50 dBZ, weights between the 0 °C and −20 °C heights, POSH = 29 ln(SHI/WT) + 50, MESH = 2.54·SHI^0.5), the Skew-T in `src/lib/sounding.ts` already supplying those heights.
  Touches: new `src-tauri/src/derive.rs`, `src-tauri/src/level2/ramp.rs` product table with `src-tauri/src/level2/decode.rs` for the whole volume it reads, `src/lib/sounding.ts` (expose the freezing levels to the native side), legends, ramps, catalogues, `data_export.rs`.
  Acceptance: Composite reflectivity, 18.5 dBZ echo top (interpolated between cuts), VIL, VIL density and MESH draw for a held site on a 1 km grid; MESH names the sounding it took its heights from and falls back to stated defaults when none is loaded; a fixture volume with a known column produces known values in tests.
  Complexity: M

- [ ] AUD-191 (P3): Specific differential phase from the volume's differential phase
  Why: KDP is the dual-pol field that locates heavy rain and the KDP foot, it exists only as a Level III product, and the raw differential phase is already in the decoded volume.
  Evidence: `src-tauri/src/level2/ramp.rs` `product_from_name` has no KDP; Vulpiani et al. 2012 iterative finite-difference method (Py-ART `kdp_vulpiani`, wradlib `kdp_from_phidp`) with unfolding and a correlation-coefficient censor at 0.9.
  Touches: `src-tauri/src/level2/sweep.rs` (or `derive.rs`), the product table in `src-tauri/src/level2/ramp.rs`, ramp, legend, catalogues, `data_export.rs` (`derivation` names the method and window).
  Acceptance: A KDP product draws in degrees per kilometre from the volume's PHI with the method in the legend; gates with correlation below 0.9 are censored; a synthetic ramp in PHI produces the expected constant KDP in a test.
  Complexity: M

- [ ] AUD-192 (P3): Continuity across tilts in the dealiaser
  Why: The region method fixes a sweep only up to a whole Nyquist interval and can flip a whole region in strong shear; UNRAVEL's 3D pass uses the cut above and below to settle the interval, at modest cost on top of the existing core.
  Evidence: `src-tauri/src/dealias.rs` (region growing, largest patch keeps its reading); Louf et al. 2020 (JTECH) and the MIT numba implementation at `vlouf/dealias`; the live multi-site test in `src-tauri/src/level2/decode_tests.rs` that measures refold recovery.
  Touches: `src-tauri/src/dealias.rs` (a pass that votes a cut's interval against its neighbours in elevation), `src-tauri/src/level2/sweep.rs` (hand adjacent cuts to the unfolder), the live aggregate test.
  Acceptance: The six-site refold test's aggregate recovery does not fall and the whole-sweep-out-by-one case is caught in a planted fixture; runtime per cut stays under the current half-second budget.
  Complexity: M

- [ ] AUD-193 (P3): Buoys and observed water levels beside the tides
  Why: Surge rides on the tide and the app shows predicted tide only; NDBC buoys and CO-OPS observed water levels are keyless and say what the water is doing now.
  Evidence: Verified live 2026-09-02: `https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt` (107 KB fixed-width, `max-age=600`, no CORS: native fetch), `activestations.xml` (1,353 stations); CO-OPS `datagetter?product=water_level&date=latest` (6-minute, CORS `*`) beside the predictions already used in `src/lib/tides.ts`; NDBC asks for minimal retrieval.
  Touches: new `src/lib/overlays/buoys.ts` (native, one national file per ten minutes), `src/lib/tides.ts` (observed against predicted), `src/panels/TidesPanel.tsx`, `src-tauri/src/http.rs` and CSP (`www.ndbc.noaa.gov`), ledger, live contract, catalogues.
  Acceptance: Buoys draw with wind, wave height and pressure in the popup; the Tides panel shows observed water level against the prediction with the difference named; the buoy file is fetched at most once per ten minutes for the whole country regardless of pans.
  Complexity: M

- [ ] AUD-194 (P3): Aviation hazards: SIGMETs, G-AIRMETs, centre weather advisories and pilot reports
  Why: MyRadar charges $59.99 a year for aviation charts; the AWC publishes the hazard polygons and PIREPs keyless on a host the app already reaches for METARs.
  Evidence: Verified live 2026-09-02: `aviationweather.gov/api/data/isigmet`, `airsigmet`, `gairmet?format=geojson`, `cwa?format=geojson`, `pirep?format=geojson&bbox=` (bbox required), all keyless, no CORS (native), 100 requests a minute, 400 entries per response.
  Touches: new `src/lib/overlays/aviation.ts`, `registry.ts`, legends, catalogues, live contract (host already allowed).
  Acceptance: Convective and non-convective SIGMETs, G-AIRMET turbulence, icing and IFR, and CWAs draw as polygons with their valid times; PIREPs draw as points with altitude and remark; the layer says it is not for flight planning; requests stay under one per minute per product.
  Complexity: M
  Note 2026-09-04: The same hazards are on `mapservices.weather.noaa.gov/vector/rest/services/aviation/awc_aviation_weather` (ArcGIS, `f=geojson`, CORS), a host already allowed, which avoids aviationweather.gov's no-CORS and 100 req/min.
- [ ] AUD-195 (P3): Snowfall analysis for the winter lane
  Why: Precipitation type shipped in 0.6.0 and nothing says how much fell; NOHRSC's national snowfall analysis is the official 24/48/72-hour answer and is keyless.
  Evidence: Verified live 2026-09-02: `https://www.nohrsc.noaa.gov/snowfall_v2/data/{YYYYMM}/sfav2_CONUS_{6h|24h|48h|72h}_{YYYYMMDDHH}.tif` (00Z and 12Z for 24/48/72 h, no CORS: native), or the rendered `raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export` on the allowed mapservices host (daily, not time-enabled).
  Touches: either `src-tauri/src/geotiff.rs` gains a reader for the sfav2 GeoTIFF and a new native tile lane, or a raster overlay adapter for the ArcGIS export; `http.rs`/CSP for `www.nohrsc.noaa.gov` if native; legends, ramps, catalogues, ledger, live contract.
  Acceptance: A snowfall layer draws 24, 48 or 72-hour totals with the analysis time in the legend and the NOHRSC credit; provenance says `observation` with a daily cadence; the winter lane's product entry names it beside precipitation type.
  Complexity: M
  Note 2026-09-04: `raster/rest/services/snow/NOHRSC_Snow_Analysis` (ImageServer) is on the allowed host; SCN26-75 makes the Probabilistic Precipitation Portal operational on 2026-10-01 as the PWPF successor (`ftp-wpc.ncep.noaa.gov/prob_precip_portal/`), which is the snow and ice probability source for this lane.
- [ ] AUD-196 (P3): CoCoRaHS daily precipitation, hail and significant weather reports
  Why: Storm reports are one feed; CoCoRaHS is the densest volunteer rain and hail network in North America, CC BY 4.0, keyless and CORS-open.
  Evidence: Verified live 2026-09-02: `https://data.cocorahs.org/export/exportreports.aspx?Format=json&ReportType=Daily&State=IA&Date=MM/DD/YYYY` (also `Hail`, `SigWx`, `MultiDay`; CORS `*`); licence CC BY 4.0 in the site footer.
  Touches: new `src/lib/overlays/cocorahs.ts` (by state within view), `registry.ts`, `http.rs`/CSP (`data.cocorahs.org`), ledger, legends, catalogues, live contract.
  Acceptance: Daily totals and hail reports draw as points with the observation time and the CoCoRaHS credit; a state is fetched once per hour while in view; the popup names the observer's station id and never a person.
  Complexity: S

- [ ] AUD-197 (P3): Observed air quality and active fire detections, keyless
  Why: HRRR smoke is a model; readers under a plume want the monitor reading, and the earlier rejection of AirNow was of its keyed REST API, not of its public file bucket; FIRMS detections give the fire behind the NIFC perimeter.
  Evidence: Verified live 2026-09-02: `https://files.airnowtech.org/airnow/today/HourlyData_{YYYYMMDDHH}.dat` and `reportingarea.dat` (public S3, CORS `*`, pipe-delimited, AQI with lat/lon); FIRMS `https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires/?LAYERS=fires_viirs_24` answers without a key (CORS `*`), CSV/KML 24-hour files keyless without CORS.
  Touches: new `src/lib/overlays/airnow.ts` and `firms.ts`, `registry.ts`, `http.rs`/CSP for both hosts, ledger, legends (EPA AQI colours), catalogues, live contracts.
  Acceptance: Monitor AQI draws as points with the EPA category and the hour; VIIRS detections draw as points with confidence and acquisition time; both are labelled observations distinct from the HRRR model layer; fetched at most hourly.
  Complexity: M

- [ ] AUD-198 (P3): German catalogue
  Why: The app draws the DWD composite and will draw DWD warnings; the i18n machinery was built for exactly this and French proved the workflow; German is the follow-on the 2026-08-31 pass sequenced.
  Evidence: `src/i18n/` (en, es, fr, pseudo; 1,404 keys typed against `en.ts`; lazy chunks; pseudolocale clipping test); DWD WarnWetter's 6M downloads as the market signal (2026-08-31 pass).
  Touches: `src/i18n/de.ts`, `src/i18n/index.ts` (`LanguageId`), `src/lib/units.ts` (metric defaults, comma decimals), `e2e/language.spec.ts`, settings language list, `docs/listings.json`.
  Acceptance: Every key in `en.ts` has a German string; the clipping test passes in German at 1024x720; a German reader gets km/h, °C and comma decimals by default; the README and listings name four languages.
  Complexity: L

## Research-Driven Additions, 2026-09-03

Added by the 2026-09-03 research pass (`RESEARCH.md` of the same date carries the evidence). Numbered `AUD-206` onward. Every host named below is either already in `ALLOWED_HOSTS` or is named in the item, and any new one needs the ledger row, the CSP entry and a `check:live` contract like the rest. Nothing here outranks an open audit item of the same priority.

### P1

### P2

### P3

- [ ] AUD-222 (P3): Save the volume on screen as the file it came from
  Why: A reader who found the sweep that matters can export a picture, a CSV or a GeoTIFF but not the Archive II object itself, so the case study cannot be reopened in the app or handed to another tool; Supercell Wx has a pull request for the same ask.
  Evidence: `src-tauri/src/exports.rs:24` (`png`, `webm`, `gif`, `json`, `jsonl`, `md` only); the app opens local Archive II files already (`src-tauri/src/level2/decode.rs` local mode); https://github.com/dpaulat/supercell-wx/pull/688.
  Touches: `src-tauri/src/exports.rs` (allow the bucket object's own name and extension; bytes are the fetched object unmodified), `src-tauri/src/level2/decode.rs` (hold or refetch the raw bytes of the drawn volume by key), `src/panels/ExportPanel.tsx`, provenance sidecar (the object's SHA-256), `src/i18n/*`, `every_file_this_app_writes_can_be_written`.
  Acceptance: The saved file's SHA-256 equals the bucket object's; reopening it through the Upload panel draws the same sweep; a terminal radar's Level III product saves the same way; the write allowlist test lists the extension.
  Complexity: S

- [ ] AUD-223 (P3): Hail and rotation thresholds per watched place
  Why: The watch answers warnings; a reader who wants "tell me when the radar estimates hail over an inch within ten miles of the ballfield" has MESH and rotation tracks on screen and no rule to set on them. MyRadar 7.122 added hail alerts and Watch Duty's flood alerts are personal gauge thresholds; the arrival (`AUD-178`) and lightning (`AUD-179`) rules give this its shape.
  Evidence: `src/lib/watch.ts` (warning rules only); `src-tauri/src/mrms.rs` (`MESH_00.50`, `RotationTrack60min_00.50` decoded); https://apps.apple.com/us/app/myradar-accurate-weather-radar/id322439990; https://support.watchduty.org/hc/en-us/articles/46400067603341-Flooding-Notifications-FAQs.
  Touches: `src/lib/watch.ts` (rules: MESH at or above a size within a radius, rotation track within a radius), `src/hooks/useAlertWatch.ts` (sample the decoded grid at the place, not a new fetch), `src/panels/MapOptionsPanels.tsx` watch settings, the `appendJournalRow` writers gate, `src/i18n/*`, e2e with planted grids.
  Acceptance: A place with a hail rule announces once when MESH within its radius first meets the size, labelled as a radar estimate, silent by default, standing down under quiet hours, and again only after the grid has been quiet for thirty minutes; the journal gate still lists exactly its documented writers.
  Complexity: M

- [ ] AUD-224 (P3): A lightning jump on each tracked cell
  Why: A sudden rise in a cell's flash rate precedes severe weather by minutes and the app has both halves, cells and GLM flashes, with nothing joining them; HookEcho ships a lightning proximity alarm and no open-source app ships the jump.
  Evidence: `src/lib/cells.ts` (cells with motion); `src-tauri/src/lightning.rs` (flash centroids with quality flags); Erdmann et al. 2023 (sigma level and minimum rate dominate skill on GLM) https://journals.ametsoc.org/view/journals/apme/62/11/JAMC-D-22-0144.1.xml; Tian et al. 2025 https://doi.org/10.1155/adme/4280862.
  Touches: new `src/lib/lightningJump.ts` (two-minute flash-rate series per cell within the cell's radius, rate of change against two sigma of the prior ten minutes, a minimum rate), the cell popup and a badge in `src/panels/RadarProductPanel.tsx`, `src/i18n/*`, tests with planted series.
  Acceptance: A planted flash series that doubles over two bins produces a jump badge on the cell with the time; a steady series does not; the badge says it is a signal, not a warning; the GLM "not a strike report" note is carried.
  Complexity: M
  Note 2026-09-04: Half overtaken: `lightning-jump` and `lightning-jump-max` grids shipped in `AUD-217` (`mrms.rs`), so "no open-source app ships the jump" no longer describes this one. The per-cell join of `cells.ts` to the flash feed is what remains; the FMI graph tracker (AMT 19:1853, MIT) is the reference if a cell must be followed through a merge.
- [ ] AUD-225 (P3): The melting layer from the volume's own top tilt
  Why: The hail size item (`AUD-190`) needs the freezing level and takes it from a sounding that may be hours old and far away; the volume's own high tilt carries the bright band, and a published method finds it without model data to about 250 m.
  Evidence: Giangrande-style automated detection, AMT 14:2873 (2021): normalised Z, ZDR and (1 − ρhv) product on the tilt at or above 9°, threshold 0.08, second-derivative weight 0.75 (https://amt.copernicus.org/articles/14/2873/2021/); `src-tauri/src/level2/ramp.rs` has no melting-layer product; `MRMS BrightBandTopHeight` exists on the bucket but is 17.9 MB per file.
  Touches: `src-tauri/src/level2/sweep.rs` (or the `derive` module): azimuth-average the top cut, normalise, threshold, expose top and bottom heights; a line in `src/panels/RadarProductPanel.tsx`; a ring on the sweep at the melting height; `AUD-190` consumes the height when it lands; `src/i18n/*`.
  Acceptance: A fixture volume with a planted bright band at 3 km yields 3.0 ± 0.25 km; the sweep legend names the height and its source; when no cut at or above 9° exists the product says why; the CSV export is unchanged.
  Complexity: M

- [ ] AUD-226 (P3): Keyless European radar from MET Norway and the OPERA composite
  Why: Outside NOAA, ECCC and DWD coverage the timeline falls to RainViewer, which now calls itself personal-use only and caps zoom at 7; MET Norway serves its radar with no usage restrictions and EUMETNET's OPERA composites are on MeteoGate with an anonymous tier under CC BY 4.0, which changes the `Roadmap_Blocked.md` verdict that European radar needs keys.
  Evidence: https://api.met.no/weatherapi/radar/2.0/documentation and https://api.met.no/doc/TermsOfService (User-Agent required, 20 requests a second, CC BY 4.0); https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/ (three composites as ODIM HDF5 and cloud-optimised GeoTIFF, anonymous tier with low rate limits, key optional); https://www.rainviewer.com/api/transition-faq.html. Needs live validation: the anonymous rate limit is undocumented as a number.
  Touches: `src/lib/providers/` (a MET Norway PNG provider by area; a MeteoGate GeoTIFF lane through `src-tauri/src/geotiff.rs`), `src-tauri/src/http.rs` and the CSP (`api.met.no`, `api.meteogate.eu`), `docs/asset-ledger.md`, `src/lib/providers/coverage.ts` (Norway, then OPERA members), two live contracts that measure the anonymous limit, `src/i18n/*`.
  Acceptance: Over Norway the timeline draws MET Norway radar with the CC BY credit; over OPERA members the composite draws with the EUMETNET credit and its cadence in the legend; the live contract records the anonymous limit and the provider budget stays under it; RainViewer remains only where neither reaches.
  Complexity: L
  Note 2026-09-04: FMI renames every radar layer in autumn 2026 (`Radar:suomi_dbz_eureffin` becomes `Radar:radar_finland_cappi_dbzh`, old names removed end of November 2026); KNMI rotated its anonymous key on 2026-06-30 (old key dead 2026-08-01); SMHI's old API docs page 404s. Use the new FMI names from the start if FMI is wired.
- [ ] AUD-227 (P3): MeteoAlarm warnings for the rest of Europe
  Why: Canadian and German warnings proved the adapter shape and MeteoAlarm publishes every other European service's warnings under CC BY 4.0 with no registration; HookEcho reads it, and a reader in France or Italy with the DWD composite on has no warnings at all.
  Evidence: https://feeds.meteoalarm.org/ (CC BY 4.0, attribution to EUMETNET members, Atom only since 2026-01-14); `src/lib/overlays/dwdWarnings.ts` and `ecccAlerts.ts`; the 2026-09-02 lesson that every ECCC alert shared one identity because the watch keyed on `url`.
  Touches: new `src/lib/overlays/meteoalarm.ts` (Atom per country, CAP links, awareness type and level mapped in `src/lib/alertTypes.ts`), `src-tauri/src/http.rs` and the CSP, ledger, `src/lib/watch.ts` (identity per CAP identifier), `src/i18n/*`, live contract, fixture e2e.
  Acceptance: Warnings for MeteoAlarm members draw on the alerts layer with the EUMETNET credit and the issuing service named; the watch announces one at a watched place in Europe; German warnings defer to the DWD adapter so nothing draws twice; a fixture with two countries asserts distinct identities.
  Complexity: L

- [ ] AUD-228 (P3): Import a PMTiles basemap of your own
  Why: Basemap dependence broke two open-source radar tools this fortnight when Carto began requiring a key; the app's incident packs already store verified PMTiles, but only USGS sets the app fetches itself, so a reader with a licensed regional archive cannot use it.
  Evidence: `src-tauri/src/incident_packs.rs` (fetch-only USGS sets); https://github.com/jpettitt/weather-radar-card/issues/253 and https://github.com/JoshuaKimsey/LibreWXR/issues (Carto breakage, 2026-08-26 to 08-29); https://github.com/jhammon88219/Anvil (offline PMTiles with editable style); `C:\repos\StormDeck` importer with validation and licence text.
  Touches: `src-tauri/src/incident_packs.rs` (accept a user file: header, tile type, bounds and size checks; copy into the store under the same hashing; an attribution string stored beside), `src/panels/IncidentPackManager.tsx`, `src/panels/UtilityPanels.tsx` accept list, `docs/asset-ledger.md`, `src/i18n/*`, tests with a small fixture archive.
  Acceptance: A valid PMTiles v3 raster or vector archive imports and is selectable as the offline basemap with its own attribution shown; a malformed or oversize file is refused with the reason; the quota and journaling tests cover an imported pack.
  Complexity: M

- [ ] AUD-229 (P3): A keyboard cursor that reads the sweep aloud
  Why: The Nearby panel gives a screen-reader user the summary; the map itself is a canvas they cannot enter, so "what is the radar showing ten miles north of me" has no answer; the arrow-key virtual cursor is the pattern the accessible-maps field settled on.
  Evidence: `src/components/MapViewport.tsx` (keyboard handling for the map, no cursor), `src/components/LiveRegion.tsx`; Esri's "Pressing the Up Arrow" pattern https://www.esri.com/about/newsroom/arcnews/pressing-the-up-arrow-big-step-forward-in-accessibility; Audiom, the only WCAG-conformant map viewer https://gaad.foundation/what-we-do/gaadys/winners/audiom.
  Touches: `src/components/MapViewport.tsx` (arrow keys step a cursor in map space by a reader-chosen distance when the map has focus; the readout sampling already used by the pointer), `src/components/LiveRegion.tsx`, `src/i18n/*`, `e2e/accessibility.spec.ts`.
  Acceptance: With the map focused, arrow keys move a visible cursor and the live region announces the reflectivity, the velocity and the nearest place with bearing and distance; Escape returns focus to the rail; the pseudolocale clipping test covers the announcement; the cursor is off the export.
  Complexity: M

## Audit Findings, 2026-09-03 (evening)

Read-only audit of `168271b` (v0.9.0). Baseline at that commit, all green: `npm run check` 176 files / 1622 passed / 37 skipped, lint 0 errors 1 pre-existing warning, every bundle inside budget; `cargo test` 412 passed / 28 ignored; `cargo clippy --all-targets` clean; `cargo audit` 0 vulnerabilities with 17 documented allowances; `gitleaks` 344 commits clean; `npm audit --omit=dev` 0; `grype` one Medium in `glib`, already documented as unreachable in `src-tauri/.cargo/audit.toml`. The GitHub tracker holds zero issues and zero pull requests (open or closed), so there was nothing to take in from reporters. Every P1 below survived a fresh-context refutation pass. Items are numbered on from `AUD-236`.

Where this pass dug: the three items drained on 2026-09-03 after the last refutation pass (`AUD-182`, `AUD-183`, `AUD-184`) and the two before it that never had one (`AUD-179`, `AUD-181`), which is where the correctness findings are; then the seams between the newer watches and the feeds they read.

### P1

### P2

### P3


## Audit Findings, 2026-09-04
  Note 2026-09-04: `consecutiveFailures` moved to `src/lib/diagnostics.ts:295-296` and `src/lib/providers/health.ts:8,25,47,60`; the cited lines are stale. A Bluesky post (2026-09-03) of RadarScope and RadarOmega both losing their feed in a storm is the reader-facing reason for the history.
## Research-Driven Additions

Seventh pass, 2026-09-04. Evidence in RESEARCH.md of the same date.

### P1

### P2

### P3

- [ ] AUD-270 (P3): Speak a warning at a watched place with the Windows voice, off by default
      Why: HookEcho made spoken warnings the default on 2026-09-03 (#298: county, towns in path, distance and bearing from a saved place, a tone then speech, a queue); Supercell Wx #581 asks for voice lightning alerts. The app's watched places already compose the sentence (which place, which warning, how many minutes); speaking it through the page's own `speechSynthesis` is offline and keyless, and is the one form a reader away from the screen can take in.
      Evidence: https://github.com/d4vid87/HookEcho/pull/298 ; https://github.com/dpaulat/supercell-wx/issues/581 ; `src/lib/notify.ts`, `src/hooks/useAlertWatch.ts`, `src/hooks/useApproachWatch.ts`.
      Touches: `src/lib/notify.ts` (a `speak` beside `announceOnDesktop`, queued, cancelled by a newer warning for the same place), the watch settings (per place, off by default, honouring quiet hours and calm mode), `src/i18n/*` (the spoken sentence in the reader's language), tests with a stubbed `speechSynthesis`.
      Acceptance: With voice on for a place, a warning reaching it is spoken once in the catalogue language after the tone; quiet hours and calm mode silence it exactly as they silence the sound; two warnings queue rather than overlap; nothing is spoken by default.
      Complexity: S

- [ ] AUD-271 (P3): A search box over the settings
      Why: `src/panels/MapOptionsPanels.tsx` is 2,847 lines of settings with no filter; `searchCommands` (`src/lib/commands.ts:619`) exists for the palette and nothing points it at settings. Every setting has a catalogue label already, which is the index.
      Evidence: `grep -rn 'searchSettings\|filterSettings' src` empty; the palette's own search as the pattern; StormDeck's settings search in the sibling repo.
      Touches: `src/panels/MapOptionsPanels.tsx` (each row carries its label key; a box at the top hides rows whose label and detail do not match), `src/lib/commands.ts` (share the matcher), `src/i18n/*`, `src/panels/LayersPanel.test.tsx`.
      Acceptance: Typing "lightning" leaves only the rows whose label or detail mention it, in every language; clearing the box restores everything; the box is reachable from the command palette.
      Complexity: M

- [ ] AUD-272 (P3): Split `App.tsx` and `MapOptionsPanels.tsx` along the seams the churn shows
      Why: Since 2026-08-25, `App.tsx` was touched by 143 commits and `MapOptionsPanels.tsx` by 85, and they are 2,814 and 2,847 lines: four of the six largest files are the four hottest, and `level2.rs` was the only one with a split item until it got one. Every layer added this week edited both.
      Evidence: `git log --since=2026-08-25 --format=%H -- src/App.tsx | wc -l` and the same for the panel; `wc -l`; the ten-place list in `CLAUDE.md` for adding a switch group.
      Touches: `src/App.tsx` (the watches, the replay wiring, the panel props each into a hook or component), `src/panels/MapOptionsPanels.tsx` (one file per section: layers, radar, watches, appearance, storage), `src/components/PanelSurfaces.tsx`, the tests that import them.
      Acceptance: Neither file is above 1,500 lines; adding a switch group edits one panel section file rather than the panel; `npm run check` and the e2e suite unchanged.
      Complexity: M
      Note 2026-09-04: this is no longer only hygiene. `npm run check` exits 1 at `check:bundle`: the settings chunk is 72 kB against its 70 kB budget, and `scripts/bundle-budget.mjs` says in its own comment that reaching the budget means the settings panel has stopped being one panel. Verified pre-existing by building 9d27982. The three panels share one module, so opening Layers fetches Settings too; splitting them into a module each is what drops the chunk.
      Note 2026-09-05: the bundle half is done: at a9407d4 `check:bundle` passes with the settings chunk at 12 kB gzip against 14 (the 2026-09-04 panel split did it). The file half has got worse: `src/App.tsx` is 3,011 lines (was 2,814), `src/components/MapViewport.tsx` 2,516, `src/lib/settings.ts` 2,121, and `src/panels/LayersPanel.tsx` 1,440 after the split; `AUD-330` carries the same ask for `src-tauri/src/mrms.rs`.

## Audit Findings, 2026-09-04 (afternoon)

Read-only audit of `4f9a18a` (v0.9.0 tree, v0.10.0 unreleased in the changelog). Baseline at that commit: `npm run check` 182 files / 1710 passed / 38 skipped, lint 0 errors 1 pre-existing warning, coverage 65.3 / 59.4 / 60.17 / 66.5 above every floor, and **exit 1 at `check:bundle`** (settings chunk 72 kB against 70 kB, pre-existing baseline, already carried on `AUD-272`); `npx playwright test` 622 passed across chromium, compact and wide in 14.6 minutes; `cargo test` 420 passed / 29 ignored; `cargo clippy --all-targets` clean; `gitleaks` 372 commits clean; `npm audit` 0 with and without dev; `cargo audit` 0 vulnerabilities, 17 default-allowed warnings (the `lru` one is in `Roadmap_Blocked.md`); `grype` one Medium in `glib`, the documented Linux-only case. The GitHub tracker holds zero issues and zero pull requests, open or closed, and discussions are disabled, so there was nothing to take in from reporters. Every P1 below survived a fresh-context refutation, and the two storm-report items were confirmed against the live service rather than by reading. Items are numbered on from `AUD-275`.

Where this pass dug: the eleven items drained on 2026-09-04 that had no refutation of their own (`AUD-263`, `AUD-265`, `AUD-267`, `AUD-268` and the `AUD-185` frontend), the seams between them and the chrome, the secondary panels' failure states, the light theme with panels open in a real browser, and the keyboard paths axe cannot see.

### P1

### P2

### P3

- [ ] AUD-295 (P3): Microcopy consistency sweep
      Category: ux
      Where: `src/i18n/en.ts` and the two translations
      Problem: Small things a reader notices without naming: (1) trailing periods on `*Detail` strings are a coin flip, 52 with and 62 without, with adjacent rows differing (`layers.countiesDetail` between `qpeDayDetail` and `precipTypeDetail`; `satellite.geocolorDetail` beside `redVisibleDetail`), while `*Body` is 42 of 42 with; (2) layer and panel names mix Title Case ("Storm Cells", "Map Type", "Wind Profile", 44 of them) with sentence case ("Rain, gauge corrected", "Storm history", "Nearby weather"); (3) `radar.archiveReading` is the only in-progress line ending in "..."; (4) "WDTD" appears twice (`layers.lightningJumpWindowDetail` L467, `azShearLevel.midNote` L1143) and is the one acronym no reader would know; (5) the isotherm labels use a hyphen and no degree sign (`-10 C`, L476-477, L486-487) where `satellite.cleanIrLegend` L880 uses `−92 to +57 °C`; (6) `layers.note` L1200 says the same thing twice; (7) `es.ts:698` says "Nivel II" where every other Spanish string keeps "Level II"; (8) the file header at L7-10 forbids positional placeholders and 21 `radar.error.*`, `bundle.error.*`, `dataExport.error.*` keys use `{0}`/`{1}`.
      Evidence: A pass over all 1,683 keys on 2026-09-04; es and fr mirror en exactly on periods (0 mismatches) so the rule chosen has to be applied three times.
      Fix: Decide "one-sentence fragment: no period; two or more sentences: periods", sweep the details; Title Case for `layer.*` and `panel.*` names, sentence case for everything else; drop the dots; "NWS training guidance" for WDTD; `−10 °C`; rewrite `layers.note`; "Level II" in es; named parameters for the 21 keys with the Rust `parts()` callers updated.
      Acceptance: A gate in `coverage.test.ts` that asserts the period rule over `*Detail` and refuses `{0}`-style placeholders; the es/fr parity test still passes.
      Confidence: Verified
      Effort: M

### Unaudited, needs a pass


## Audit Findings, 2026-09-05 (evening)

Read-only audit of `a9407d4` (v0.11.0). Baseline at that commit, all green: `npm run check` 200 files / 1956 passed / 39 skipped, lint 0 errors 1 pre-existing warning (`react-refresh/only-export-components`), 1308 exports all named, coverage 67.1 / 62.17 / 63.39 / 68.29, every bundle inside budget (the settings chunk is 12 kB gzip against 14, so the `check:bundle` failure `AUD-272` carried is gone); `cargo fmt --check` clean, `cargo clippy --all-targets` clean, `cargo test` 466 passed / 31 ignored; `npx playwright test` 690 passed / 2 skipped in 16.7 minutes, exit 0, but with 184 `[Unhandled rejection]` lines in the page console of a green run (`AUD-332`); `gitleaks` 447 commits clean; `npm audit` 0 with and without dev; `cargo audit` 0 vulnerabilities and the 17 documented allowances; `grype` the one documented Linux-only `glib` Medium. The GitHub tracker holds zero issues and zero pull requests, open or closed, and discussions are disabled, so there was nothing to take in from reporters. Every P2 below was measured in a running browser rather than read, and handed to a fresh-context refutation pass. Items are numbered on from `AUD-318`.

Where this pass dug: the six commits of 2026-09-05 that landed after the last refutation pass (the day-and-night wash, the display hold, the MRMS smoothing and zoom ceiling, the level2 split, the legend keys), the native command surface and the three URI schemes, the light theme with Layers, Settings, Diagnostics, the command list and the full-screen view open in a real browser at 1440x900 and at the 1024x680 minimum, and the rail at both sizes.

### P2

- [ ] AUD-318 (P2): The day-and-night wash is drawn for the wall clock while the map shows another moment
      Category: correctness
      Where: `src/components/MapStage.tsx:217` (`nightAt: clock`), `src/App.tsx:323` (`const clock = useMinuteClock()`), `src/components/MapViewport.tsx:1760-1764` (`useMapSync(night && nightAt > 0 ? nightAt : 0, ...)` calling `nightPolygon(at)`), `src/lib/terminator.ts`.
      Problem: The polygon is computed from the workspace minute clock and never from the frame on screen. Scrubbing to the start of a two-hour loop leaves the terminator thirty degrees of longitude east of where it stood when that frame was observed; a replay from Storm history (a 2011 outbreak, a 2022 hurricane) draws tonight's night over that afternoon's storms; the exported still, the wallpaper and the postcard burn that in. The switch's own detail copy says "worked out from the clock", so the setting is honest about the mechanism and wrong about the picture. The layer is off by default, so only readers who turned it on see it.
      Evidence: `MapStage.tsx:217` passes `clock`; `activeFrame` is in scope on the same props (`MapStageProps.activeFrame`) and `App.tsx:1221` already derives `frameTime: activeFrame?.time` for another consumer. Nothing between MapStage and MapViewport substitutes a frame time, and nothing hides the lane during a replay. `src/lib/terminator.test.ts` covers the arithmetic only. Frame times are seconds (`framesWithinLoop` in `useRadarTimeline.ts` subtracts `loopMinutes * 60`), the clock is milliseconds.
      Fix: In MapStage pass `nightAt: activeFrame ? activeFrame.time * 1000 : clock` for the primary pane and the compare frame's time for the second pane, rounded down to the minute so `useMapSync` (which keys on the raw number) does not rebuild the polygon on every frame of a loop; keep the minute clock only while there is no frame, since the `nightAt > 0` guard at `MapViewport.tsx:1760` would otherwise take the wash off an empty timeline. Reword `layers.nightDetail` (`en.ts:892`) in en/es/fr to say the wash follows the frame on screen. The refutation pass noted the alerts layer already goes dark during a replay at `App.tsx:1215-1217` for the same reason; this is the same rule applied to the wash.
      Acceptance: A test that renders `MapStage` with an `activeFrame` at 2011-04-27T21:00Z and asserts the night source's `properties.subsolarLongitude` equals `subsolarLongitude(Date.UTC(2011, 3, 27, 21))` rather than the value for now; in `e2e/layers.spec.ts`, scrubbing the timeline with the layer on moves the wash; the exported still of a replay frame carries that frame's night.
      Confidence: Verified
      Effort: S

- [ ] AUD-319 (P2): A panel docked on the right buries the compare card and the coordinate readout
      Category: visual
      Where: `src/index.css:1230-1234` (`.pane-compare`, `right: 12px`, `z-index: 18`), `src/index.css:1267-1279` (`.map-readout`, `right: 216px`, `z-index: 16`), `src/index.css:4572-4576` and its narrow twin at `:4685-4689` (the `[data-panel-side="right"]` shift, which lists `.zoom-controls`, `.product-legends`, `.source-attribution` and `.map-watermark` and not these two).
      Problem: Settings opens on the right. With it open and Dual Pane on, the compare offsets (Live, 3 back, 6 back, 12 back) and the compare time sit under the panel and cannot be seen or clicked, and the pointer coordinate readout is drawn under the panel too. The attribution beside it moves out of the way because it is on the shift list; these two were left off it.
      Evidence: Measured 2026-09-05 in the browser at 1440x900, light theme, Dual Pane on, Settings open: `.pane-compare` rect [1139, 68, 1428, 166], `.surface-panel` rect [1104, 56, 1440, 812] with `z-index` 45, `document.elementFromPoint` at the card's centre returns `surface-panel__header`; `.map-readout` rect [1117, 784, 1224, 804] with `elementFromPoint` returning a `<strong>` inside the panel; `.source-attribution` had moved to [877, 788, 1088, 804].
      Fix: Add `.pane-compare` and `.map-readout` to both `[data-panel-side="right"]` rules, the card at `right: calc(var(--panel-width) + 16px)` and the readout at `right: calc(var(--panel-width) + 216px)` so it keeps its lead over the attribution.
      Acceptance: A test in `e2e/workspace.spec.ts` that opens Dual Pane and Settings at 1440x900, hovers the map, and asserts `elementFromPoint` at the centre of `.pane-compare` and of `.map-readout` lands inside those elements; clicking "3 back" with Settings open changes the compare frame.
      Confidence: Verified
      Effort: S

- [ ] AUD-320 (P2): In Dual Pane the compare card's time sits under the zoom controls at every width
      Category: visual
      Where: `src/index.css:1230-1234` (`.pane-compare`, `top: 12px; right: 12px`, `z-index: 18`), `src/index.css:4362-4368` (`.zoom-controls`, `right: 16px; top: calc(var(--chrome-top) + 16px)`, `z-index: 31`), `src/components/MapStage.tsx:319` (the card is a plain div over the second pane).
      Problem: Both are anchored to the same corner of the same pane, so whenever Dual Pane is on the compare time (`.pane-compare small`) is drawn under the zoom buttons and its right end is unreadable, at every window width. At the 1024 minimum the buttons also cover the card's last offset button.
      Evidence: Measured 2026-09-05. At 1024x680: `.pane-compare` [723, 68, 1012, 166], `.pane-compare small` [940, 110, 1001, 125], `.zoom-controls` [968, 72, 1008, 188], `elementFromPoint` at the time text returns a zoom `BUTTON`; the screenshot showed "4:58 P" cut. The refutation pass repeated it with no panel open at 1440 wide (time 1356..1417 against zoom 1384..1424, hit BUTTON) and 1280 wide (1196..1257 against 1224..1264, hit BUTTON): there is no width at which they clear, and no `is-dual-pane` rule in `index.css`.
      Fix: Move the card out of the zoom stack's column: `right: 64px` (the stack is 40px wide plus its 16px inset), or place it under the stack with `top: calc(var(--chrome-top) + 140px)`; give it `max-width: calc(100% - 96px)` so a long localised time wraps. Apply the `AUD-319` panel shift to it in the same change, and check it against the alert badge the comment at `index.css:5698` says shares that corner.
      Acceptance: With Dual Pane on at 1024x680, 1280x800 and 1440x900 the bounding boxes of `.pane-compare` and `.zoom-controls` do not intersect (asserted across the three e2e projects) and the time reads in full in the pseudolocale.
      Confidence: Verified
      Effort: S

- [ ] AUD-321 (P2): The full-screen view's source line is unreadable over a light basemap
      Category: a11y
      Where: `src/index.css:2992-2994` (`.ambient-readout small { color: #a9b6c6 }`), `src/index.css:2976-2979` (`.ambient-readout[data-over-light]`, which recolours the parent and sets a white halo but not `small`), `src/index.css:2999-3006` (`.ambient-readout__leave`, a fixed dark chip), `src/components/AmbientReadout.tsx` (`overLight` sets the attribute).
      Problem: Over a light basemap (Light theme with Auto, or Roads, Daylight, Radar Light) the clock flips to dark ink with a white halo but the line under it, the one that says which source the picture is and how old it is, stays pale grey on a white halo: about 1.8:1 against the map's land, far under the 4.5:1 the rest of the app is held to by `e2e/support/contrast.ts`. That line is what the view exists to show across a room.
      Evidence: Measured 2026-09-05, Light theme, `pro-light` basemap, full-screen view on: `.ambient-readout` carried `data-over-light="1"` with color rgb(15, 23, 42); `.ambient-readout small` computed color rgb(169, 182, 198) with text-shadow rgba(255, 255, 255, 0.85); the screenshot shows "NWS RIDGE II · 5 minutes old" nearly invisible over the Yucatán. `data-over-light` appears once in `index.css` (line 2976) with no `small` or `__leave` counterpart.
      Fix: Add `.ambient-readout[data-over-light] small { color: #334155; }` beside the existing rule (the light palette's muted ink), and a light chip for `.ambient-readout[data-over-light] .ambient-readout__leave`; extend `e2e/ambient-screen.spec.ts` to run the contrast helper on the source line over `pro-light` as well as `pro-dark`.
      Acceptance: The ambient contrast check reads at or above 4.5:1 for `.ambient-readout small` over both basemaps.
      Confidence: Verified
      Effort: S

- [ ] AUD-322 (P2): The rail's tool list cuts off mid-button with nothing that reads as "more below"
      Category: ux
      Where: `src/index.css:4113-4168` (`.command-scroll-region`: `scrollbar-width: none`, the `[data-more-below]` mask of 12px, a scrollbar only on hover), `src/components/CommandBar.tsx:165-175` (sets `data-more-above` and `data-more-below`).
      Problem: The middle of the rail is a scroller with its scrollbar hidden and a 12px fade as its only sign. At 1440x900 the region is 390px tall against 948px of content: the cut lands through the Range button (icon drawn, caption gone), and Inspector, Cross-section, Sounding, Wind Profile, Tropical, Route, Guidance, Tides, Export, Share and Upload are off screen with no scrollbar, no arrow, and a fade shorter than the gap between an icon and its caption. At the window's declared default (1600x1000) the region is 490px and still hides eight tools; at the 680 minimum it hides nearly all of them. The stylesheet's comment at `:4129-4132` names this exact symptom as the reason for the mask, and the mask does not cure it: the rail reads as a stray unlabeled icon above Settings, and Export and Upload, the two a first-time reader looks for, are among the hidden.
      Evidence: Measured 2026-09-05 at 1440x900: `.command-scroll-region` rect top 400 bottom 790, `scrollHeight` 948, `clientHeight` 390, `data-more-below` set, computed `mask-image: linear-gradient(to top, transparent, black 12px)`; button rects Range 755-803 (clipped at 790), Inspector 803-851 through Upload 1300-1348. An element screenshot of the rail shows the Range icon with no caption and no scrollbar. `e2e/support/layout.ts` skips elements inside a scroller, so the reachability gate cannot see it.
      Fix: Three things together: (1) a fade one button tall (48px) so the last visible button visibly dims; (2) `scroll-snap-type: y mandatory` on the region with `scroll-snap-align: start` on the buttons, or `scroll-padding-bottom`, so the region never ends mid-button; (3) a focusable chevron pinned at the bottom of the region while `data-more-below` is set, which pages the list. The chevron takes its height from the region, so it costs one more button below the fold at 900px; the hover scrollbar at `:4155` stays as it is (the refutation pass could not see it in headless Chromium, which hides scrollbars, so do not rely on it in the acceptance test). Consider promoting Export and Upload into the primary group.
      Acceptance: At 1440x900 and 1600x1000 every rail button is either wholly visible or wholly hidden; a chevron is visible whenever content is hidden; an assertion in `e2e/wide.spec.ts` and the compact project checks that no rail button's caption is clipped by the region.
      Confidence: Verified
      Effort: M

### P3

- [ ] AUD-323 (P3): Escape does nothing in the full-screen and capture views, and the code says it does
      Category: a11y
      Where: `src/App.tsx:1729-1735` (`if (capture || ambientScreen) return;` under a comment saying "the same press is already what leaves them"), `src/components/AmbientReadout.tsx:100-110` (leave button, no key handler), `src/components/CaptureBar.tsx:140-150`, `src/components/PanelShell.tsx:80` (the only other Escape handler).
      Problem: Neither of the app's two Escape handlers leaves the full-screen view or the capture layout, and the comment claims one does, so the early return looks intentional and the promise is unkept. The keyboard way out is the focused 26x30 leave button (Enter or Space), which works only while it holds focus.
      Evidence: 2026-09-05 in the browser: entered the full-screen view from the command list; `.app-shell` dataset `{ambientScreen: "1", capture: "1"}`; `document.activeElement` was `.ambient-readout__leave`; pressed Escape; dataset unchanged 400 ms later. `grep -rn '"Escape"' src` outside tests lists only `App.tsx:1734` and `PanelShell.tsx:80`.
      Fix: In the App effect, before the panel branch, run the readout's `onLeave` body when `ambientScreen` (`setAmbientAsked(false); setTouchedAt(Date.now())`) and `setCapture(false)` when `capture`, then return; correct the comment. Raise both leave buttons to 44x44.
      Acceptance: `e2e/ambient-screen.spec.ts` and `e2e/capture.spec.ts` press Escape and assert the workspace returns with the panel that was open; both leave buttons measure at least 44x44.
      Confidence: Verified
      Effort: S

- [ ] AUD-324 (P3): The incident-pack ceiling slider writes the store config on every drag step, unguarded
      Category: reliability
      Where: `src/panels/IncidentPackManager.tsx:155-161` (the effect on `settings.incidentPacks.diskLimitMb`), `:355-390` (`<input type="range" min={256} max={32_768} step={256}>` whose `onChange` writes settings), `src-tauri/src/incident_packs.rs:1490-1500` (`incident_pack_set_limit` takes the store write lock, writes `config.json` atomically, then lists the whole library).
      Problem: A range input fires `change` on every step of a drag, so one drag across the slider is up to 128 settings saves, 128 native config writes under the store lock (each an atomic JSON write plus a directory listing), and 128 unguarded `setLibrary` calls whose replies can land out of order. The effect has no cancellation flag and no cleanup, unlike its neighbours at `:131` and `:163`. A download in progress waits on the same lock in `write_tile_under_quota`. On mount the effect also writes the current value back once for nothing.
      Evidence: Code as cited; no debounce between the input and the effect; effect deps `[available, settings.incidentPacks.diskLimitMb]`.
      Fix: Debounce the native write (a `window.setTimeout` of 250 ms after the last change, cleared in the effect cleanup), guard with `let open = true` like the poll effect, and skip the write when the value equals the library's reported limit. The settings save is already queued and can stay.
      Acceptance: A test in `IncidentPackManager.test.tsx` that fires ten `change` events within 100 ms and asserts `incident_pack_set_limit` is invoked once with the last value, and that an unmount before the reply does not set state.
      Confidence: Verified
      Effort: S

- [ ] AUD-325 (P3): A crafted replay bundle can make the cached scheme's response builder panic
      Category: reliability
      Where: `src-tauri/src/lib.rs:203-227` (the `cached` handler builds `Content-Type` from `served.content_type` and `X-OpenRadar-Bundle` from `served.bundle`, then `.expect("a cached response is well formed")`), `src-tauri/src/bundles.rs:468-545` (`read_bundle` accepts any UTF-8 `content_type` and any `manifest.id`), `src-tauri/src/tiles.rs:106-118` (an open bundle answers first).
      Problem: The content type and the bundle id come out of the `.orb` file a reader opens with `replay_bundle_open`, which is a file somebody else may have made. `read_bundle` checks only that the entry's type equals the manifest's record, and both live in the same file. A value with a control byte or a non-ASCII character (`image/png\r\nX: 1`, an id with an accent) fails `HeaderValue` construction; the builder returns `Err` at `.body()` and the `.expect` panics inside the spawned task. The process survives, the tile request never answers, and the reader sees a map that stops drawing with nothing said.
      Evidence: `http::Response::builder().header(...)` defers an invalid value to `.body()`'s `Result`, and `lib.rs:226` unwraps it with `expect`. `bundles.rs` has no character check on `content_type` or `id`; the `text/html` test at `:1032` covers only a mismatch between entry and manifest; `slug()` at `:625` constrains ids on the write side only.
      Fix: In `read_bundle`, refuse a `content_type` that is not visible ASCII in `type/subtype` form and an `id` that is not `[a-z0-9-]{1,40}` (the shape `slug()` produces); in `lib.rs` replace the three `.expect` calls on the scheme responders with a fallback 500 response so a builder error can never take the task down.
      Acceptance: Unit tests in `bundles.rs` where a manifest with `content_type: "image/png\r\nX: 1"` and one with `id: "café"` are refused as `Corrupt`; a test in `tiles.rs` that the three scheme registrations in `lib.rs` no longer contain `.expect(` (the way `the_cached_scheme_serves_nothing_a_browser_will_guess_at` already reads that source).
      Confidence: Verified
      Effort: S

- [ ] AUD-326 (P3): The map panes keep a dark ground in the light theme
      Category: visual
      Where: `src/index.css:90-101` (`.map-stage`, its radial glow and `#0b1018`), `:110-116` (`.map-viewport`, `background: #0c111a`), `:3961` (`.map-stage { background: #0b1018 }` inside the palette block, also dark-only).
      Problem: In the light theme every tile that has not painted yet shows as a near-black block: the second pane the moment Dual Pane is switched on, the whole stage on a cold start before the style loads, any gap while panning fast. The chrome around it is light, so it reads as a broken pane.
      Evidence: Computed `.map-viewport` background rgb(12, 17, 26) and `.map-stage` rgb(11, 16, 24) with `data-theme="light"` on 2026-09-05; the full-screen view screenshot in the light theme showed the right pane as dark blocks while it re-tiled. No `[data-theme="light"]` rule names either selector.
      Fix: Put both on a token, `background: var(--map-ground)`, with `--map-ground: #0b1018` in the dark palette and `#e9edf2` in the light one at `index.css:3929-3958`, and keep the radial glow dark-only.
      Acceptance: With `data-theme="light"`, `getComputedStyle(document.querySelector(".map-viewport")).backgroundColor` is the light ground, asserted in `e2e/theme.spec.ts`.
      Confidence: Verified
      Effort: S

- [ ] AUD-327 (P3): Settings files desktop and character controls under "Appearance", and puts language, units and clock last
      Category: ux
      Where: `src/panels/SettingsPanel.tsx:168` (the Appearance section, which runs to about `:520` and holds theme, accent, weather on the chrome, the full-screen view and its screen hold, the tray icon, Start with Windows, close-to-tray, the glance window, the wallpaper, calm mode, curiosities, catch-up, on-this-date and the seasonal look), `:540` Language, `:576` Backup, `:619` Units, `:648` Clock, `:674` Text size, `:698` Radar, `:819` Camera.
      Problem: "Appearance · Applies immediately" heads fourteen rows of which four are about looks. Start with Windows, the tray, close-to-tray and the glance window are desktop integration; calm mode, curiosities, catch-up, on-this-date and the seasonal look are the character set the roadmap treats as its own thing. Language, units and clock, the three a new reader wants first, come after the record, the packs and the storage row. A reader scanning headings cannot find "start with Windows".
      Evidence: The panel's accessibility tree on 2026-09-05 (section titles in that order); line numbers as cited.
      Fix: Reorder and re-head: a "Reading" section first (language, units, clock, text size), then Appearance (theme, accent, seasonal look, weather on the chrome), Desktop (tray, start with Windows, close-to-tray, glance window, wallpaper, full-screen view and its screen hold), Character (calm, curiosities, catch-up, on this date), then Radar, Camera, the record, packs, storage and backup. New section headings need catalogue keys in en/es/fr; the 2026-09-04 split into panel section files makes this a move rather than a rewrite. Coordinate with `AUD-271` and `AUD-272`.
      Acceptance: The `settings-section__title` sequence matches the order above in all three languages; `SettingsPanel` tests updated; the pseudolocale clipping run stays green.
      Confidence: Verified
      Effort: M

- [ ] AUD-328 (P3): Forty-seven layer switches in one unbroken list
      Category: ux
      Where: `src/panels/LayersPanel.tsx:234` (`LAYER_OPTIONS`), `:600` (rendered as one list), `:627` (the first section title, after all of them).
      Problem: The Layers panel opens on 47 switches with no heading between Weather Alerts and Custom Overlay: hazards, the MRMS hail family, rainfall, flood guidance, lightning, satellite, wind and the reader's own files run together in the order they were added. Finding "Rain or Snow" means reading past thirty rows; the command list, which sorts by kind, is the only grouped view of them.
      Evidence: The panel's accessibility snapshot on 2026-09-05: 47 checkboxes as siblings under one container, the first `settings-section__title` being "How the national grids are drawn".
      Fix: Give each `LAYER_OPTIONS` entry a `group` (Hazards, Radar-derived, Rain and flood, Lightning, Sky, Reference, Your files) and render a `settings-section__title` per group, collapsed state remembered in settings; keep switch order within a group. Pair with `AUD-271`, whose search box filters across groups.
      Acceptance: The panel shows the seven headings; `LayersPanel.test.tsx` asserts every option belongs to a group and every group renders; the pseudolocale clipping test covers the headings.
      Confidence: Verified
      Effort: M

- [ ] AUD-329 (P3): Two whole-record reads a minute while Settings is open
      Category: perf
      Where: `src/panels/RecapSection.tsx:52-64` (`journalRows()` in an effect keyed on `clock`, no cancellation guard), `src/panels/JournalSection.tsx:123-127` (the same read, deliberately, on the same clock), `src/panels/SettingsPanel.tsx:475` and `:521` (both fed the minute clock from `App.tsx:323`).
      Problem: Every minute Settings is open, both sections invoke `journal_rows`, which reads and parses the whole JSONL record (up to 4 MB) on the native side, twice. The recap's read has no guard, so a slow reply can land after a faster one.
      Evidence: Code as cited; `clock` is `useMinuteClock()`.
      Fix: Lift the read into `SettingsPanel` (one guarded `journalRows()` per tick) and hand `rows` to both sections, or read once on mount in the recap and re-read only when the journal section's reload runs.
      Acceptance: With Settings open for three minutes a spy on `journalRows` counts three calls, not six; an unmounted `RecapSection` does not set state.
      Confidence: Verified
      Effort: S

- [ ] AUD-330 (P3): `mrms.rs` is 6,237 lines with three test modules inside it
      Category: maintainability
      Where: `src-tauri/src/mrms.rs` (6,237 lines; `#[cfg(test)]` at `:109`, `:2418` and `:2673`; 85 functions).
      Problem: The largest file in the repository by a factor of two, holding the GRIB reader, the grid cache and its byte budget, the tile renderer and the smoothing, the product table with its ramps, the frame listing, the export window and three test modules. `level2.rs` was split into a directory on 2026-09-05 for the same reason at sixty percent of this size, and every MRMS item since (`AUD-217`, `AUD-218`, the smoothing, the zoom ceiling) edited this one file.
      Evidence: `wc -l src-tauri/src/mrms.rs` on 2026-09-05; commit `63d33bc` as the pattern (`mod.rs` plus one module per concern, `#[path = "..._tests.rs"]` test modules, `pub(crate) use` re-exports).
      Fix: The same split: `mrms/mod.rs` (types, constants, the cache), `grib.rs` (decode), `products.rs` (table and ramps), `tiles.rs` (rendering, smoothing, tile cache), `listing.rs`, `window.rs` (the export window), each with a sibling `_tests.rs`. Three frontend gates read this file as text and must be pointed at the new one: `src/lib/providers/mrms.test.ts` reads `zoom > (\d+)`, `src/hooks/useMrmsOverlays.test.ts` reads the `Sampling` verdicts, and `src/test/rustSource.ts` is the helper the level2 split introduced for exactly this.
      Acceptance: No file under `src-tauri/src/mrms/` above 1,500 lines; the `cargo test` count unchanged at 466; the three frontend gates pass; `docs/architecture.md` names the directory the way it names `level2/`.
      Confidence: Verified
      Effort: M

- [ ] AUD-331 (P3): Small things outside `AUD-295`'s list
      Category: ux
      Where: `src/i18n/en.ts:1010` (`panel.tropical: "Tropical panel"`) and `:1011` (`panel.history: "Storm history"`); `src/panels/UtilityPanels.tsx:171-175` (`clockLabel` with `hour: "2-digit"`); `index.html` and `glance.html` (no `<link rel="icon">`).
      Problem: (1) The command list renders "Tropical panel · Panel" and the rail says "Tropical"; every other panel command is the panel's own title. (2) The Diagnostics event list reads "05:34:03 PM" while every other clock in the app uses `hour: "numeric"` and reads "3:44 PM"; the leading zero is the only one in the product. (3) Neither page declares an icon, so the webview requests `/favicon.ico` and logs a 404 on every load; `assets/brand/openradar-icon.png` exists.
      Evidence: The command list's accessibility tree and the Diagnostics panel's on 2026-09-05; the page console's first error on load is the favicon 404.
      Fix: `panel.tropical` becomes "Tropical" in the three catalogues (the rail already says so); `clockLabel` drops to `hour: "numeric"`; a `<link rel="icon" href="/openradar-icon.png">` in both pages with the file copied under `public/`.
      Acceptance: The command list shows "Tropical · Panel"; the Diagnostics list shows "5:34:03 PM"; a fresh load logs no 404.
      Confidence: Verified
      Effort: S

- [ ] AUD-332 (P3): A green browser run carries 184 unhandled rejections, and two of them are the app's own
      Category: testing
      Where: `src/App.tsx:826` (`void journalRows().then(...)` with no catch: the catch-up read on launch), `src/panels/JournalSection.tsx:120` (`void journalPath().then(setWhere)`, no catch), `src/App.tsx:753-755` (`whenGlanceOpens(...).then((unlisten) => { if (alive) stop = unlisten; else unlisten(); })`), `e2e/support/fixtures.ts` (the `__TAURI_INTERNALS__` stub, which throws "`<command>` is not stubbed" for any command a spec did not stub, and has no `__TAURI_EVENT_PLUGIN_INTERNALS__`).
      Problem: The 2026-09-05 full run passed 690 tests and logged 184 `[Unhandled rejection]` lines in the page console: 114 `journal_rows is not stubbed` from `App.tsx:826`, 20 `journal_path is not stubbed` from `JournalSection.tsx:120`, and 50 `Cannot read properties of undefined (reading 'unregisterListener')` from `App.tsx:755` when an effect was torn down before `listen` resolved. Two things follow. In the desktop build, a `journal_rows` failure on launch (an unreadable app-data folder) leaves the catch-up card silently absent with an unhandled rejection in the log, and `JournalSection` would leave its path line blank the same way; `JournalSection.tsx:111` catches the sibling call three lines above and explains why. And nothing in the fixture turns an unhandled rejection into a failure, so a real one anywhere in the app passes the suite.
      Evidence: The run's `[WebServer]` output, counted with `grep -c "Unhandled rejection"`; the callers as cited; `useWorkspaceActions.ts:853` has the same early-`unlisten()` shape.
      Fix: Catch at `App.tsx:826` and `JournalSection.tsx:120` the way `:111` does (log and fall back); wrap the early `unlisten()` at `App.tsx:755` and `useWorkspaceActions.ts:853` in a try that logs; stub `journal_rows` (`[]`), `journal_path` (`null`) and `window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }` in the desktop fixture; and register a `page.on("pageerror")` plus a console filter for "Unhandled rejection" in the fixture that fails the test at teardown, with an allowlist for the known network refusals.
      Acceptance: The full suite runs with zero "Unhandled rejection" lines in its output; a planted `Promise.reject()` in a spec's page fails that spec.
      Confidence: Verified
      Effort: S

### Unaudited, needs a pass

- [ ] AUD-333: The secondary panels in the light theme, and the map overlay colours over a light basemap
      Category: visual
      Where: `src/panels/AlertsPanel.tsx`, `HistoryPanel.tsx`, `ExportPanel.tsx`, `UtilityPanels.tsx` (Upload), `SoundingPanel.tsx`, `TidesPanel.tsx`, `TropicalPanel.tsx`, `RoutePanel.tsx`, `GuidancePanel.tsx`, `NearbyPanel.tsx`, `VwpPanel.tsx`, `CrossSectionPanel.tsx`, `RadarProductPanel.tsx`; `src/components/MapViewport.tsx:1241`, `:1256`, `:1290` (cell track and forecast strokes `#f8fafc`), `:609` and `:622` (tool line and point stroke `#7dd3fc`), `:1501` and `:1567` (overlay point strokes).
      Problem: This pass observed the light theme with Layers, Settings, Diagnostics, the command list, the full-screen view and the compact layout open, and not the thirteen panels above; they rest on `e2e/theme.spec.ts` and `e2e/accessibility.spec.ts`. On the map, the county lane consults `isLightBasemap` (`MapViewport.tsx:965`) and the cited strokes do not, so near-white cell tracks and forecast dots may wash out over Roads, Daylight or Radar Light; there were no storm cells on the live feed at audit time to see it.
      Evidence: The 2026-09-05 pass; the colour sweep of `MapViewport.tsx`.
      Fix: Open each panel in both themes with its error and empty states (the fixtures in `e2e/support/fixtures.ts` can refuse each host); draw the cells fixture from `e2e/layers.spec.ts` over `pro-light` and read the stroke pixels back the way the magenta-line test does.
      Acceptance: Each panel observed and any defect logged here; the cell strokes either pass the pixel read over a light basemap or gain a light variant keyed on `isLightBasemap`.
      Confidence: Needs-repro
      Effort: M

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
      Note 2026-09-07: Anvil measured this instead of estimating it (commit 0f5972d, 2026-09-04): a retained-geometry sampler walking the frames every 5 s, deduped by ArrayBuffer identity, beside performance.memory. The ceiling was a per-renderer V8 heap cap of about 4,192 MB unrelated to machine RAM, a 26-frame replay retained 2,178 MB, and capping the dual-pol prefetch at 12 frames on that evidence took a 39-frame peak from 3,427 to 2,042 MB. That sampler is the shape this item's soak script wants.
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
      Note 2026-09-07: The published kernel is Mahalik et al. 2019 (LLSD with every off-diagonal term kept; the older simplification is what draws a false shear ring at 5 to 10 km): AzShear 2,500 m azimuthal by 750 m radial, DivShear 750 by 1,500 m, a 3 by 3 median prefilter needing five of eight valid neighbours, at most 51 radials at 0.5 degrees, masked to reflectivity over 20 dBZ. The debris flag is reflectivity over 30 dBZ, correlation under 0.85 to 0.90, differential reflectivity near zero and a collocated couplet, with the couplet dilated by the 95th percentile of AzShear over 4 radials by 8 gates (Snyder and Ryzhkov 2015) so advected debris still scores. Sources in RESEARCH.md of the same date.
  Why: MRMS AzShear is a 2-minute national grid; the same LLSD method on the held site's own dealiased velocity gives rotation at gate resolution seconds after the sweep, which is what GR2Analyst's NROT is and what no open-source app ships; a tornado debris flag needs it.
  Evidence: Mahalik et al. 2019 (NOAA IR PDF): 2500 m azimuthal by 750 m radial kernel, radial count adapted per range, cap 51 radials, minimum 3x3, 3x3 median pre-filter, mask to reflectivity at or above 20 dBZ; WDTD thresholds; the RLX NROT deck (5x5 fit, range-normalised, above 1.0 significant, above 2.5 extreme); PyMeso as a reference implementation; TDS criteria (correlation coefficient below 0.8, ZDR below 0.5 dB, reflectivity above 30 dBZ, collocated with strong shear).
  Touches: new `src-tauri/src/shear.rs`, `src-tauri/src/level2/ramp.rs` product table (`azimuthal-shear`, `rotation`) and `src-tauri/src/level2/sweep.rs` for the cut it reads, ramps with the colour-vision test, `RadarProductPanel.tsx`, legends and catalogues, `data_export.rs` (`derivation` records the kernel).
  Acceptance: An azimuthal shear product draws for any Doppler cut with the kernel documented in the legend; a normalised rotation product follows the NROT range curve; a debris flag marks gates meeting the four criteria within two kilometres of shear at or above 0.006 s⁻¹ and is labelled as a signature, not a confirmation; a planted couplet in the fixture volume produces the expected shear magnitude in a test.
  Complexity: M

- [ ] AUD-190 (P3): Single-site vertical products: composite, echo tops, VIL and hail size from the volume
      Note 2026-09-07: Use the Murillo and Homeyer 2019 MESH refit (5,897 reports against Witt's 107; the 75th and 95th percentile fits are in Zenodo record 13887225) rather than Witt 1998 alone, VIL density as VIL over the 18 dBZ echo top, and the three-body scatter spike (Lemon 1998: under 20 dBZ, 10 to 30 km down the radial of a 60 dBZ core, aloft only) as a cheap flag beside the size.
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
      Note 2026-09-07: WSR-88D Build 24.0 carried 2DVDA fixes for dealiasing failures under high vertical shear (ROC software engineering page; Likely). Read them before choosing the interval rule.
      Note 2026-09-07 (evening): R2D2 works top down, highest elevation first (larger Nyquist, cleaner velocities), each settled sweep guiding the one below, matched by azimuth and ground range `r cos(elev)`; UNRAVEL's `unfolding_3D` (`unravel/continuity.py`, lines 1037-1110) is a readable implementation of that mapping with a four-branch cascade at `alpha Vnyq` that leaves a gate alone rather than forcing it; 4DD seeds only where the sweep above and the previous volume agree within 0.25 Vn; Py-ART's own header lists 3D region finding as unimplemented, so there is nothing to copy there.
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
      Note 2026-09-07 (evening): Ritvanen et al. 2026 (AMT 19:1853) link cells as a directed acyclic graph: VIL at or above 1.0 kg/m2, at least 10 km2, a 3 km open and close, two steps linked when the overlap is at least 10 per cent of the smaller cell after advection by the mean field motion; merges and splits occur in 7.2 per cent of 735,163 cells and 17.9 per cent above 20 kg/m2. TINT's defaults: `FIELD_THRESH 32` dBZ, `MIN_SIZE 8` km2, `SEARCH_MARGIN 4000` m, `FLOW_MARGIN 10000` m, `MAX_FLOW_MAG 50` m/s. SCIT: 30 to 60 dBZ in 5 dB steps, 50 km2 components on two consecutive scans.
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
      Note 2026-09-07: HookEcho v0.12.0-beta.2 (2026-08-31) reads OPERA through a WMS bridge it hosts, which is the server class the blocked note rules out; MET Norway stays the keyless half of this item.
      Note 2026-09-07 (evening): Nembo (fabioscarparo, 2026-09-04) reads Italian DPC radar with a 30-minute nowcast; whether the DPC API is keyless and answers cross-origin needs live validation before Italy joins this item.
  Why: Outside NOAA, ECCC and DWD coverage the timeline falls to RainViewer, which now calls itself personal-use only and caps zoom at 7; MET Norway serves its radar with no usage restrictions and EUMETNET's OPERA composites are on MeteoGate with an anonymous tier under CC BY 4.0, which changes the `Roadmap_Blocked.md` verdict that European radar needs keys.
  Evidence: https://api.met.no/weatherapi/radar/2.0/documentation and https://api.met.no/doc/TermsOfService (User-Agent required, 20 requests a second, CC BY 4.0); https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/ (three composites as ODIM HDF5 and cloud-optimised GeoTIFF, anonymous tier with low rate limits, key optional); https://www.rainviewer.com/api/transition-faq.html. Needs live validation: the anonymous rate limit is undocumented as a number.
  Touches: `src/lib/providers/` (a MET Norway PNG provider by area; a MeteoGate GeoTIFF lane through `src-tauri/src/geotiff.rs`), `src-tauri/src/http.rs` and the CSP (`api.met.no`, `api.meteogate.eu`), `docs/asset-ledger.md`, `src/lib/providers/coverage.ts` (Norway, then OPERA members), two live contracts that measure the anonymous limit, `src/i18n/*`.
  Acceptance: Over Norway the timeline draws MET Norway radar with the CC BY credit; over OPERA members the composite draws with the EUMETNET credit and its cadence in the legend; the live contract records the anonymous limit and the provider budget stays under it; RainViewer remains only where neither reaches.
  Complexity: L
  Note 2026-09-04: FMI renames every radar layer in autumn 2026 (`Radar:suomi_dbz_eureffin` becomes `Radar:radar_finland_cappi_dbzh`, old names removed end of November 2026); KNMI rotated its anonymous key on 2026-06-30 (old key dead 2026-08-01); SMHI's old API docs page 404s. Use the new FMI names from the start if FMI is wired.
- [ ] AUD-227 (P3): MeteoAlarm warnings for the rest of Europe
      Note 2026-09-07: MeteoAlarm deprecated its legacy RSS feeds on 2026-01-14; target the Atom feeds (meteoalarm-legacy-atom-<country>). HookEcho ranks the warnings on its own severity scale rather than each service's.
  Why: Canadian and German warnings proved the adapter shape and MeteoAlarm publishes every other European service's warnings under CC BY 4.0 with no registration; HookEcho reads it, and a reader in France or Italy with the DWD composite on has no warnings at all.
  Evidence: https://feeds.meteoalarm.org/ (CC BY 4.0, attribution to EUMETNET members, Atom only since 2026-01-14); `src/lib/overlays/dwdWarnings.ts` and `ecccAlerts.ts`; the 2026-09-02 lesson that every ECCC alert shared one identity because the watch keyed on `url`.
  Touches: new `src/lib/overlays/meteoalarm.ts` (Atom per country, CAP links, awareness type and level mapped in `src/lib/alertTypes.ts`), `src-tauri/src/http.rs` and the CSP, ledger, `src/lib/watch.ts` (identity per CAP identifier), `src/i18n/*`, live contract, fixture e2e.
  Acceptance: Warnings for MeteoAlarm members draw on the alerts layer with the EUMETNET credit and the issuing service named; the watch announces one at a watched place in Europe; German warnings defer to the DWD adapter so nothing draws twice; a fixture with two countries asserts distinct identities.
  Complexity: L

- [ ] AUD-228 (P3): Import a PMTiles basemap of your own
  Note 2026-09-07: the fuzz target for the PMTiles reader belongs with this item rather than with `AUD-338`, which shipped the `.orb` half. Today every pack the reader opens is one this app downloaded, hashed tile by tile and renamed into place under its own app-data folder, and no command opens a pack from anywhere else, so those bytes are not a stranger's. The moment a reader can hand the app an archive they are, and `AsyncPmTilesReader` begins by parsing a header and a directory tree somebody else wrote. Fuzzing it wants an in-memory `AsyncBackend` over a slice and a current-thread runtime per case, because the shipped backend reads a file.
  Why: Basemap dependence broke two open-source radar tools this fortnight when Carto began requiring a key; the app's incident packs already store verified PMTiles, but only USGS sets the app fetches itself, so a reader with a licensed regional archive cannot use it.
  Evidence: `src-tauri/src/incident_packs.rs` (fetch-only USGS sets); https://github.com/jpettitt/weather-radar-card/issues/253 and https://github.com/JoshuaKimsey/LibreWXR/issues (Carto breakage, 2026-08-26 to 08-29); https://github.com/jhammon88219/Anvil (offline PMTiles with editable style); `C:\repos\StormDeck` importer with validation and licence text.
  Touches: `src-tauri/src/incident_packs.rs` (accept a user file: header, tile type, bounds and size checks; copy into the store under the same hashing; an attribution string stored beside), `src/panels/IncidentPackManager.tsx`, `src/panels/UtilityPanels.tsx` accept list, `docs/asset-ledger.md`, `src/i18n/*`, tests with a small fixture archive.
  Acceptance: A valid PMTiles v3 raster or vector archive imports and is selectable as the offline basemap with its own attribution shown; a malformed or oversize file is refused with the reason; the quota and journaling tests cover an imported pack.
  Complexity: M

- [ ] AUD-229 (P3): A keyboard cursor that reads the sweep aloud
      Note 2026-09-07: wxaccess (w9fyi, macOS, pushed 2026-08-06) reads the probed gate aloud, hides the canvas from the screen reader, and sonifies radar values along a bearing as a tone; the UXPA sonified-map prototypes were evaluated with blind users. A tone along the cursor's bearing is a natural second step for this item.
      Note 2026-09-07 (evening): arw (stevo399, 2026-09-07) speaks a scene summary ("57 rain objects detected. Strongest: severe core, 31 miles E of the radar, moving SE at 8 mph. Note: 11 storms merged in the last scan"), which is a sentence the Nearby panel could already say from the cell products in hand; Audiom's pattern is neighbour traversal (arrow keys from a region to an adjacent one, each announced with its name and value); Esri added keyboard entry for its measurement toolbar in Fall 2025, the shape for the measure tool here.
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
      Note 2026-09-07: HookEcho #302 (2026-09-05) lets an emergency pre-empt the speech queue, and #298 plays the tone before the words; both belong in the queue this item builds.
      Note 2026-09-07 (evening): WebView2 returns local SAPI voices only: Microsoft disabled its cloud Natural voices in WebView2 by design (WebView2Feedback #2660, "We don't have plans to re-enable"), and `getVoices()` fills asynchronously, so wait for `voiceschanged` and write the sentence for a SAPI voice.
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

### P3

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
      Note 2026-09-07: Pair with AUD-345, which puts a fresh, stale or failed state and an age on the same rows.
      Category: ux
      Where: `src/panels/LayersPanel.tsx:234` (`LAYER_OPTIONS`), `:600` (rendered as one list), `:627` (the first section title, after all of them).
      Problem: The Layers panel opens on 47 switches with no heading between Weather Alerts and Custom Overlay: hazards, the MRMS hail family, rainfall, flood guidance, lightning, satellite, wind and the reader's own files run together in the order they were added. Finding "Rain or Snow" means reading past thirty rows; the command list, which sorts by kind, is the only grouped view of them.
      Evidence: The panel's accessibility snapshot on 2026-09-05: 47 checkboxes as siblings under one container, the first `settings-section__title` being "How the national grids are drawn".
      Fix: Give each `LAYER_OPTIONS` entry a `group` (Hazards, Radar-derived, Rain and flood, Lightning, Sky, Reference, Your files) and render a `settings-section__title` per group, collapsed state remembered in settings; keep switch order within a group. Pair with `AUD-271`, whose search box filters across groups.
      Acceptance: The panel shows the seven headings; `LayersPanel.test.tsx` asserts every option belongs to a group and every group renders; the pseudolocale clipping test covers the headings.
      Confidence: Verified
      Effort: M

- [ ] AUD-330 (P3): `mrms.rs` is 6,237 lines with three test modules inside it
      Category: maintainability
      Where: `src-tauri/src/mrms.rs` (6,237 lines; `#[cfg(test)]` at `:109`, `:2418` and `:2673`; 85 functions).
      Problem: The largest file in the repository by a factor of two, holding the GRIB reader, the grid cache and its byte budget, the tile renderer and the smoothing, the product table with its ramps, the frame listing, the export window and three test modules. `level2.rs` was split into a directory on 2026-09-05 for the same reason at sixty percent of this size, and every MRMS item since (`AUD-217`, `AUD-218`, the smoothing, the zoom ceiling) edited this one file.
      Evidence: `wc -l src-tauri/src/mrms.rs` on 2026-09-05; commit `63d33bc` as the pattern (`mod.rs` plus one module per concern, `#[path = "..._tests.rs"]` test modules, `pub(crate) use` re-exports).
      Fix: The same split: `mrms/mod.rs` (types, constants, the cache), `grib.rs` (decode), `products.rs` (table and ramps), `tiles.rs` (rendering, smoothing, tile cache), `listing.rs`, `window.rs` (the export window), each with a sibling `_tests.rs`. Three frontend gates read this file as text and must be pointed at the new one: `src/lib/providers/mrms.test.ts` reads `zoom > (\d+)`, `src/hooks/useMrmsOverlays.test.ts` reads the `Sampling` verdicts, and `src/test/rustSource.ts` is the helper the level2 split introduced for exactly this.
      Acceptance: No file under `src-tauri/src/mrms/` above 1,500 lines; the `cargo test` count unchanged at 466; the three frontend gates pass; `docs/architecture.md` names the directory the way it names `level2/`.
      Confidence: Verified
      Effort: M

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

## Research-Driven Additions, 2026-09-07

Eighth pass. Evidence in RESEARCH.md of the same date. Three of the live contracts were red when this pass ran, all three for reasons inside the tests, and those come first.

### P1

### P2

### P3

- [ ] AUD-345 (P3): Say fresh, fetching, stale or failed on every layer row, with an age
      Why: Feed loss is the complaint of the season: two paid apps lost their feed on 2026-09-03, five radars were down at once in July, and a Windy reader watched months of rain the radar did not show. HookEcho answered it on 2026-09-05 with fresh, fetching, stale, failed and waiting plus a compact age on every network layer row, a popover with attempts and the last error, and stale imagery kept on screen marked degraded. The app knows all of that per adapter and shows it in Diagnostics and the legend; the Layers panel, where a reader switches a layer on and wonders why nothing changed, says nothing.
      Evidence: https://github.com/d4vid87/hookecho/pull/306 (merged 2026-09-05); https://community.windy.com/topic/44326/weather-radar-constantly-malfunctioning ; `src/hooks/useOverlays.ts` (per-adapter status), `src/panels/LayersPanel.tsx` (no status text on any row), `src/lib/providers/health.ts`.
      Touches: `src/panels/LayersPanel.tsx` (a small state and age per row, from the snapshot the hook already holds), `src/hooks/useOverlays.ts` (expose the state), `src/i18n/*`, `e2e/layers.spec.ts`. Pair with `AUD-328`, which regroups the same rows.
      Acceptance: A row whose adapter failed says so with the last error in a popover, a stale row says how old, a fetching row says so; a Playwright test fails one adapter's route and reads the row; the pseudolocale clipping test covers the new text.
      Complexity: M

- [ ] AUD-344 (P3): Replay a day through the watch rules and list what would have fired
      Why: Ten watched places carry arrival, lightning and warning rules, and the only way to know what they would have said on 2011-04-27 is to have been there. HookEcho shipped "alert-rule backtests run in the browser" on 2026-08-31. The app has the archive warnings and reports for any day, the replayed lightning window, the rules, and the sentences; a backtest is those four joined and told to a panel instead of a toast.
      Evidence: https://github.com/d4vid87/hookecho/releases/tag/v0.12.0-beta.2 ; `src/lib/archiveWarnings.ts`, `src/hooks/useAlertWatch.ts`, `useApproachWatch.ts`, `useLightningWatch.ts`, `src/lib/approach.ts`; `AUD-216` (the replayed day's outlook and reports).
      Touches: a `src/lib/backtest.ts` that runs the three rule functions over a day's archive without side effects, a section in the watch settings or the History panel, `src/i18n/*`, tests with a fixed day.
      Acceptance: Pick a replayed day and each watched place lists what it would have been told and when, in the reader's language, with nothing notified, nothing written to the record, and quiet hours shown as applied.
      Complexity: M

- [ ] AUD-346 (P3): Write the provenance into the picture itself
      Why: Every export writes a `-provenance.json` beside the picture, and the picture is the file that gets sent on, without the sidecar. PNG carries text chunks for exactly this, the `png` crate the exporter already uses exposes `add_itxt_chunk`, and a viewer or a script can then ask the picture what it is.
      Evidence: `README.md` "What the export record holds"; `src-tauri/src/exports.rs` (no text chunk written); https://docs.rs/png/latest/png/struct.Encoder.html (`add_text_chunk`, `add_ztxt_chunk`, `add_itxt_chunk`, png 0.18.1).
      Touches: `src/hooks/useExport.ts` and a new `src/lib/pngText.ts`, not `src-tauri/src/exports.rs`. Corrected 2026-09-07: the still is encoded by the browser and `save_export` only writes the bytes it is handed, so the `png` crate never sees the picture. The chunk has to go in on the frontend, where the blob and the provenance document are already in hand together, which means writing the `iTXt` chunk by hand: length, type, the keyword and the text, and a CRC-32 over both, inserted before `IEND`.
      Acceptance: A PNG export carries the provenance JSON in an `iTXt` chunk that `pngcheck` or the test's own reader returns byte for byte equal to the sidecar; the sidecar stays.
      Complexity: S

- [ ] AUD-353 (P3): Keep the last good settings file beside the live one
      Why: A store file that will not parse falls to defaults with no way back; the reader's ten places, palettes and themes are gone with nothing said. PowerToys backs its settings up before every update and restores them when it detects corruption, and Supercell Wx's export writing five-byte files (#675) is what the loss looks like in practice. A copy taken before each write, offered back with a toast, is a few lines and an undo.
      Evidence: `src/lib/settings.ts:2073-2079` (`loadSettings` swallows every read failure and answers with the defaults) and `:2091-2105` (`readSettings`, the store `get` on the desktop and a bare `JSON.parse` in the browser); https://learn.microsoft.com/en-us/windows/powertoys/general (2026-08-25); https://github.com/dpaulat/supercell-wx/issues/675. Corrected 2026-09-07: an earlier draft cited `:2033`, which is `looksLikeSettings` and has nothing to do with the load.
      Note 2026-09-07: not S, and not a second key in the same store. A store file that will not parse loses every key in it at once, so the copy has to be its own file in app data, which means a Rust command each way rather than a frontend-only change. There is a smaller piece worth splitting out if this stays too big: `loadSettings` cannot currently tell "nothing stored yet" from "stored and unreadable", and the second case then writes the defaults back over the file on the next save, which is where the reader actually loses the places.
      Touches: the settings store write path (`src/hooks/useSettings.ts` or the store plugin call), a `settings.previous.json` beside the live file, a toast with Undo on a failed parse, `e2e/storage.spec.ts`.
      Acceptance: A corrupt store file at launch restores the previous good one and says so; the corrupt file is kept renamed; a spec plants a corrupt file and finds the reader's places intact.
      Complexity: M

- [ ] AUD-349 (P3): Snow-squall colour tables in the box
      Why: The NWS trains forecasters on two AWIPS colour tables built for squalls, reflectivity over 30 dBZ and velocity over 30 kt lit and everything else dimmed, and publishes them. The app already holds up to twelve GRLevelX tables per product; shipping these two, named for what they are, gives the winter reader the office's own view with no file to find.
      Evidence: https://vlab.noaa.gov/web/snow-squalls-and-snow-squall-warnings/radar-color-tables ; `src/lib/palette.ts`; the palette legend (`src/lib/legend.ts`).
      Touches: `src-tauri/src/palette.rs` or `src/lib/palette.ts` (two built-in tables), the palette picker in `src/panels/RadarProductPanel.tsx`, `src/i18n/*`, the contrast gate the built-in ramps are held to.
      Acceptance: The two tables appear in the picker, the legend names them, they pass the contrast test the other ramps pass, and the README's colour-table paragraph names them.
      Complexity: S

- [ ] AUD-355 (P3): Raise the toolchain floor and take the routine bumps
      Note 2026-09-07 (evening): add `maplibre-gl` 6.8.0 (2026-09-07: empty and HTTP 204 raster tiles render transparent instead of erroring, a throwing render task no longer freezes the map, `setTiles` no longer hands out stale URLs when `loadTile` runs in the same frame, `getCameraAltitude` no longer NaN under globe; the package shape is identical to 6.7.0 and the worker path is unchanged), TypeScript 5.9.3 (the last 5.x; `typescript-eslint` 8.70.0 still caps at `<6.1.0`), `sha2` 0.11.0 (see `AUD-380`), `image` 0.25.10, Playwright 1.63.0 (bundles Chromium 153, ahead of WebView2 152), `lucide-react` 1.42.0, `eslint` 10.10.0, `typescript-eslint` 8.70.0, `@types/node` 26.5.0. The acceptance gains one line: a 204 tile counts as empty and not as a failed fetch in `src/lib/providers/health.ts`, pinned by a test.
      Why: Tauri 2.12 carries an `msrv-1.90` change and the tree says `rust-version = 1.85` while stable is 1.98.1; a floor raised before the release forces it is a floor raised on a quiet day. Beside it: `@playwright/test` 1.63.0, `eslint` 10.10.0, `typescript-eslint` 8.70.0, `lucide-react` 1.42.0, `image` 0.25.10. TypeScript stays on 5.8: 7.0 ships no programmatic API until 7.1 and `typescript-eslint` caps at `<6.1.0`.
      Evidence: https://github.com/tauri-apps/tauri/tree/dev/.changes (`msrv-1.90`); https://github.com/rust-lang/rust/releases (1.98.1, 2026-09-03); `npm outdated` on 2026-09-07; https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.70.0 ; https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/.
      Touches: `src-tauri/Cargo.toml` (`rust-version`, `image`), `package.json`, `package-lock.json`, `Cargo.lock`, `CLAUDE.md` build notes.
      Acceptance: `cargo clippy --all-targets` clean at the new floor, `npm run check` and `cargo test` green, the browser suite green on Playwright 1.63, TypeScript unchanged.
      Complexity: S

- [ ] AUD-352 (P3): Size the full-screen view's type from a viewing distance
      Why: The full-screen view is meant to be read across a room, and its type is a fixed size chosen for a desk. The human-factors rule for a glanceable display is a glyph subtending about nineteen arcminutes from the furthest viewer, which at four metres is a different number from one metre. One setting, "how far away is the screen", and the view sizes itself.
      Evidence: https://www.rocketcom.com/insights/designing-ux-for-giant-screens/ ; `CHANGELOG.md` v0.11.0 ("not readable at arm's length let alone across a room"); `src/index.css` (`.ambient-readout` sizes).
      Touches: the ambient settings in `src/lib/settings.ts`, a rule function in `src/lib/ambient.ts` (distance and the monitor's physical size to a font size, with `window.screen` and `devicePixelRatio` as the inputs the page has), `src/index.css` (a custom property), `e2e/ambient-screen.spec.ts`.
      Acceptance: The rule is a tested function; at the default distance nothing changes; at four metres the clock and the source line grow to the computed size and stay inside the viewport at 1024 by 680.
      Complexity: S

- [ ] AUD-351 (P3): Pick the monitor for the full-screen view and the glance window
      Why: The full-screen view takes whichever monitor the window happens to be on, so the second-monitor reader drags the window across first, every time. OBS opens a projector on a named display and reopens it there next launch; Sunshine remembers a monitor by its device id because indices reorder. Nothing in the tree asks Tauri which monitors exist.
      Evidence: no `availableMonitors` or `currentMonitor` in `src` or `src-tauri` (2026-09-07); https://obsproject.com/kb/power-of-projectors ; https://github.com/LizardByte/Sunshine/releases/tag/v2026.906.222525 ; `src-tauri/src/display.rs`, `src-tauri/src/tray.rs`.
      Touches: `src/lib/settings.ts` (a remembered monitor name and position for each of the two windows), `src-tauri/src/display.rs` or a new `monitors.rs` (list, match by name then by position, fall back to the current one), the full-screen entry in `src/App.tsx`, the glance window in `src-tauri/src/tray.rs`, Settings.
      Acceptance: With two monitors, the full-screen view opens on the chosen one and returns the window to where it was; a monitor that is gone falls back to the current one with a toast; the choice survives a restart.
      Complexity: M

- [ ] AUD-347 (P3): First paint of a held site from a range read of the first cut
      Why: A held site's first picture waits for a whole archive volume, five to ten megabytes, when the lowest cut is the first megabyte and a half of it. FX-Net-NextGen reads exactly that by HTTP range and has the 0.5 degree cut in 1.6 to 1.9 s, choosing the cut by median radial elevation because the first radial's header is written while the antenna settles. The app already reads GFS fields by byte range and the chunk bucket for the live sector; the archive path reads whole objects.
      Evidence: https://github.com/Cuevman81/FX-Net-NextGen/commit/7eed8f1 (2026-09-04); `src-tauri/src/http.rs` (`get_range`), `src-tauri/src/level2/listing.rs` and `decode.rs`; the truncated-volume sweep in `level2::tests::malformed`.
      Touches: `src-tauri/src/level2/decode.rs` (decode what a truncated object holds and say which cuts arrived), `commands.rs` (first paint from the range, the rest of the volume behind it for the tilts, the profile and the cross-section), `src/hooks/useSingleSiteRadar.ts` (a legend note while the rest loads).
      Acceptance: Holding a site paints reflectivity from the first range read inside two seconds on the fixture volume served with latency, the higher tilts appear when the rest lands, the wind profile and the cross-section wait for the whole volume, and nothing is drawn twice.
      Complexity: M

- [ ] AUD-348 (P3): A non-weather echo mask for the single-site sweep
      Note 2026-09-07 (evening): Py-ART's texture gate filter defaults (`wind_size 7`, `max_textrhv 0.3`, `min_rhv 0.6`, `max_textrefl 8.0`, `max_textzdr 2.85`, `max_textphi 20`); wradlib's Gabella filter (`wsize 5`, `tr1 6.0`, `n_p 6`, `tr2 1.3`) needs no dual-pol field and so answers the TDWR case the acceptance greys out; NSSL's bird-detection report and the depolarisation-ratio study find dense insect layers reaching RhoHV 0.96, which defeats a plain correlation gate and is why depolarisation ratio is used; RadrView draws biological scatter in a palette of its own instead of masking it, an alternative worth offering; Sweep 2.6.x holds the last clean frame when the mask cannot run rather than flashing the bloom. Sources in RESEARCH.md of 2026-09-07 (evening).
      Why: Bird blooms, wind farms and chaff draw like rain, and the office's own quality control removes them with four thresholds on fields the app already decodes: correlation coefficient under 0.95, its texture over 0.10, only under 0.7 inside the melting layer, with hail let back in by echo top and reflectivity. Sweep 2.6.0 (2026-09-06) added the same idea as a third noise-filter state and made the legend say when the mask did not run.
      Evidence: https://vlab.noaa.gov/web/wdtd/-/dual-pol-quality-control ; https://github.com/Aryeh95/pi-weather-station/commits/main (2.6.0); `src-tauri/src/level2/draw.rs`, `sweep.rs` (the clutter exclusion for the fit), `src/lib/level2.ts` (the correlation product).
      Touches: `src-tauri/src/level2/draw.rs` (a mask computed from the correlation and reflectivity cuts of the same volume), `commands.rs` (a switch beside smoothing), `src/panels/RadarProductPanel.tsx`, the legend (says the mask is on, or that it could not run on a single-pol or terminal radar), `src/i18n/*`. The readout, the export and the cross-section keep the gate.
      Acceptance: With the mask on, a fixture volume with a planted low-correlation bloom draws without it and a planted hail core stays; the legend says so; greyed with the reason on a TDWR; off by default.
      Complexity: M

- [ ] AUD-350 (P3): A flash-flood severity readout from the four grids
      Why: The Central Region's four-panel method reads one-hour QPE, its return period, the QPE-to-guidance ratio and the FLASH unit streamflow against published thresholds (advisory, warning, considerable, catastrophic) and calls the tier when three of four agree. The app draws the QPE, the ratio and the unit streamflow already; the readout is the thresholds and the rule, and the rule is the part a reader in a flood cannot do in their head.
      Evidence: https://www.weather.gov/media/crh/publications/TA/TA_2303.pdf (thresholds: QPE 1.5/2.0/2.5/2.7 in, ARI 1/5/125/175 yr, ratio 125/140/325/375 per cent, unit streamflow 200/230/850/1100); `src-tauri/src/mrms.rs` (the QPE, ratio and FLASH products); `CHANGELOG.md` v0.9.0 (rain against the guidance).
      Touches: `src-tauri/src/mrms.rs` (the ARI product, if `CONUS/` publishes it; Needs live validation), `src/lib/flashFlood.ts` (the tier rule as a tested function), the readout and the Nearby panel, `src/i18n/*`.
      Acceptance: Under the cursor and at each watched place the four values and the tier are shown with the thresholds editable in Settings; a fixture where three of four panels agree yields that tier and one where two do yields none; the ARI product is verified on the bucket before the layer is added.
      Complexity: M

- [ ] AUD-356 (P3): Read the 5 km composite for the national loop when zoomed out
      Why: `noaa-mrms-pds` publishes `CONUS_5KM/` with the composite and the lowest-altitude reflectivity at a twenty-fifth of the cells of the 1 km grid. The national loop decodes about sixty 1 km composites for a two-hour loop whatever the zoom, and at zoom 5 the map cannot show the difference. The fold already trades resolution for memory at the fine grids' zoom; this is the same trade one step further out, on a product the bucket already publishes.
      Evidence: https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=CONUS_5KM/&delimiter=/ (two products, 2026-09-07); `src-tauri/src/mrms.rs` (`DOMAINS`, `listing_url`, the fold); commit `82c8699`.
      Touches: `src-tauri/src/mrms.rs` (a domain-like source for the 5 km composite chosen by the tile's zoom, the same key replaced on zoom-in), `src/lib/providers/mrms.ts`, the live contract (the 5 km product's cadence and history depth need live validation before the loop depends on it).
      Acceptance: Zoomed out, the loop's decode time and memory drop by an order of magnitude in the diagnostics history; zooming past the switch draws the 1 km grid with no gap; the export still reads the 1 km grid.
      Complexity: M

- [ ] AUD-340 (P3): Colour the national grids on the GPU
      Note 2026-09-07 (evening): MapLibre #7029 (colour-relief styling for any raster) was closed as a duplicate of style-spec #1490, a declarative `encoding` expression; nothing shipped in 6.7 or 6.8, so the `raster-dem` custom encoding stays the route. 6.7.0 moved `color-relief` to `texelFetch` for exact stops and added a `resampling` paint property. `maplibre-contour` derives contour tiles from the same value-encoded raster through `addProtocol`, which is the isopleth follow-on once this lands.
      Why: Colour is applied in Rust and a palette load, a threshold or a contrast toggle bumps a generation into every tile address and cache key, so each one re-renders and re-fetches the whole screen of tiles. MapLibre has no `raster-color`, and the request for one has been open since 2024-07-31, but 6.7.0 ships a `color-relief` layer over a `raster-dem` source with a custom encoding: the tile carries the value, the style carries the ramp as an expression, and a new ramp is a style change with no fetch. The value under the cursor comes from the same tile.
      Evidence: https://maplibre.org/maplibre-style-spec/sources/ (raster-dem `custom` encoding, `redFactor`, `greenFactor`, `blueFactor`, `baseShift`, added 3.4.0); https://maplibre.org/maplibre-gl-js/docs/examples/add-a-color-relief-layer/ (6.7.0); https://github.com/maplibre/maplibre-gl-js/issues/4479 ; `CLAUDE.md` (the palette generation in the tile address); `src-tauri/src/mrms.rs` (`tile_from_cache`, `TileLook`).
      Touches: `src-tauri/src/mrms.rs` (a value-encoded PNG per tile, the missing value below `baseShift`), `src/lib/providers/mrms.ts` and `MapViewport.tsx` (a `raster-dem` source and a `color-relief` layer per product, the ramp built from `src/lib/palette.ts`, the threshold as a transparent stop), the compare pane, the export caption, the between-the-cells smoothing (`b81d5e0`), the readout.
      Acceptance: Loading a colour table redraws with zero `mrms:` requests in the network log (a Playwright test proves it); the drawn colours match the Rust ramp within one step on the fixture; the readout still reports the value; the fine grids and the sparse products (rotation, hail, lightning) draw as before.
      Complexity: L

## Audit Findings, 2026-09-07 (late)

Read-only audit of `74cf9be` (v0.11.0, unreleased; the published release is still v0.4.0). Baseline at that commit, all green: `npm run check` 202 files / 1,999 passed / 39 skipped, lint 0 errors 1 pre-existing warning (`react-refresh/only-export-components` in `src/glance.tsx`), 1,318 exports all named, coverage 67.2 / 62.37 / 63.35 / 68.39 above every floor, every chunk inside its budget; `cargo fmt --check` clean, `cargo clippy --all-targets` clean, `cargo test --lib` 471 passed / 33 ignored; `npx playwright test` 712 passed / 2 skipped at `ac6967f` (only Rust changed after it) after four specs killed by machine load re-ran clean on their own; `gitleaks` 473 commits clean; `npm audit` 0 with and without dev; `cargo audit` 0 vulnerabilities and the 17 documented allowances; `grype` the one documented Linux-only `glib` Medium; `npm run check:live` green at `04a9a49`. The GitHub tracker holds zero issues and zero pull requests, open or closed, and discussions are disabled, so there was nothing to take in from reporters. The P1 below was reproduced by two independent fresh-context probes in scratch crates, not read. Items are numbered on from `AUD-362`.

Where this pass dug: the three drains since the last refutation (`AUD-359`, the third refutation's fixes, and `AUD-360`), the light theme with thirteen secondary panels open in a real browser at 1440x900 (which is the half of `AUD-333` that could be done from here), the dark theme over a light basemap, the native trust boundaries against the recorded gotchas, and the stylesheet's colour literals. Not observable from here and still open: the panels' error states under a refused host (the browser preview cannot stub a host the way the fixture does), Windows forced-colours mode, and the long session in `AUD-166`.

### P1

### P2

### P3


- [ ] AUD-377 (P3): Chrome colour written outside the theme system, and rules that no longer win
      Category: visual
      Where: `src/hooks/useAppearance.ts:13-16` (`CHROME_COLOR` `#090b10` / `#eef2f6`) and `index.html:10` and `:46` (the same pair twice more) against `--bg` `#070b10` / `#e9eef4` at `src/index.css:3901` and `:3978`; dead declarations overridden later at equal specificity by the rail rules: `.command-bar` `:219` (`background: rgba(31, 35, 41, 0.97)`, `box-shadow`) against `:4143` (`background: #0b1118`), `.brand-mark` `:150-161` against `:4041`, the forced-colours `.command-bar { background: Canvas }` inside `@media (forced-colors: active)` at about `:3233` against `:4143`, and `.product-legend` `:3529` (`var(--surface-raised, rgb(15 23 42 / 82%))`, a fallback behind a token that is always defined); single-look chrome literals with no light counterpart: `.legend-ramp` border `:591` (`rgba(255, 255, 255, 0.18)`), `.track-swatch` border `:3313`, `@keyframes ambient-flash` `:345` and `:351` (pale blue on `--border-strong`), `.fatal-error__mark` `:2761` (`#130309` on `--danger`); the capture bar block `:5842-5967` (about fifteen literals, no light look); `src/glance.css:15-31` (a five-token palette of its own outside `THEME_TOKENS`).
      Problem: The window's `theme-color` is a hand-copied near-match of the palette in three places, so a change to `--bg` leaves a differently coloured strip before first paint. The overridden rules are the first thing a reader edits and do nothing; the forced-colours one is the only rule in that block that loses to a later plain selector. The single-look literals are invisible or wrong under the light theme (a white 18 per cent ramp border on a white panel), and the capture bar is the one chrome surface with no light look at all. None of this is covered by `theme.test.ts`, which pins token use, not literals.
      Evidence: `grep` of the cited lines on 2026-09-07; `.command-bar {` at `:219` and `:4143` are both bare selectors in source order; the light theme observed in the browser with the capture bar not exercised.
      Fix: Derive `theme-color` from the palette in one place (read `--bg` after the stylesheet loads, or generate both values from one constant the CSS also uses); delete the dead declarations and move the forced-colours rule after the rail rules or raise its specificity; tokenise the two borders and the flash colour, give the error mark `--accent-ink`-style ink, and either give the capture bar a light look or state in its rule that it is fixed dark because it is a recording surface; add a `stylesheet.test.ts` assertion that every colour literal in `index.css` outside the READINGS blocks either has a light counterpart or is on an allowlist with a reason.
      Acceptance: `theme-color` equals `--bg` for both themes; no bare-selector rule is fully overridden by a later bare-selector rule for the same properties (a small script can check this); the new stylesheet assertion passes and fails when a literal is planted.
      Confidence: Verified
      Effort: M

### Notes on existing items

- `AUD-333`: observed on 2026-09-07 at 1440x900 in the light theme, in a real browser, all thirteen panels (Alerts, History, Export, Upload, Sounding, Tides, Tropical, Route, Guidance, Nearby, Wind Profile, Cross-section, Radar Products) plus Map Type, Settings and Diagnostics; screenshots in the session scratchpad. Defects found were logged as `AUD-363`, `AUD-364`, `AUD-365`, `AUD-372`, `AUD-373` and `AUD-374`; the first three shipped on 2026-09-07 and the last three are still open below. Not yet observed: each panel's error state under a refused host, which the browser preview cannot produce without the fixture's `stubHost`; the item stays open for that half and for the cell-stroke pixel read.
- `AUD-295`: the 2026-09-07 sweep of `en.ts` adds these to the list: `export.note` says "Both" under four export buttons (`ExportPanel.tsx:121-168`); `toast.bundleMissing` has no plural block, so one missing frame reads "1 of them could not be fetched and are listed"; `packs.error.httpStatus` and `radar.error.httpStatus` end in a bare status ("could not be reached. 404"); `wpc.serviceStatus` drops the word "service" and the full stop every sibling has; `settings.watching` (`WatchSection.tsx:611`, `:802`) prints raw coordinates where the toast beside it names the place; `toast.placesFull` ("That is every place") has no next step while `settings.placesFull` for the same condition does; `search.none` and `journal.noneMatch` are dead ends beside `history.none` and `palette.none`, which coach; `toast.notABackupBody` refers to "the button beside it", a positional reference; `chrome.nextPiece` says "piece" where every neighbour says volume or sweep; terminology runs two ways for colour table and palette, loop and animation, site and station, tilt (camera) and tilt (radar), and six namings of the watched place. The `{0}` family and the WDTD, isotherm and Title Case points already listed stand.


## Research-Driven Additions, 2026-09-07 (evening)

Ninth pass. Evidence in RESEARCH.md of the same date. Numbered on from `AUD-378`. Every host named below is already in `ALLOWED_HOSTS`. Nothing here outranks an open audit item of the same priority; `AUD-378` is the first thing to drain.

### P1

### P2

### P3

- [ ] AUD-381 (P3): A 0.3 degree base tilt where a site has one
  Why: Build 24.1 gave KBOX a supplemental 0.3 degree base tilt (SCN26-20, effective 2026-03-23) with a Level III set of its own, and says the lower angle is the one SAILS and MRLE repeat when the base tilt is on. The Level II path matches cuts by angle, so the 0.3 degree cut should already draw as the lowest tilt; nothing asserts it, `CLASSIFICATION_PRODUCTS` reads `N0H` where KBOX now publishes `NZH` a cut lower, and the fixture writer has never emitted a cut below 0.5.
  Evidence: https://www.weather.gov/media/notification/pdf_2026/scn26-20_WSR-88D_BaseTilt_Level-III_KBOX.pdf (`NZQ`, `NZB`, `NZU`, `NZG`, `NZF`, `NZX`, `NZC`, `NZK`, `NZH`, `NZM`; base-tilt state in GSM bit 7 of the VCP supplemental data); `src-tauri/src/level3.rs:1487` (`CLASSIFICATION_PRODUCTS: [("N0H", ...), ("HHC", ...)]`); `src-tauri/src/fixture.rs` (every pattern starts at 0.5).
  Touches: `src-tauri/src/fixture.rs` (a pattern whose first cut is 0.3 degrees), `src-tauri/src/level2/sweep_tests.rs` (the lowest cut chosen is 0.3 and the tilt list names it), `src-tauri/src/level3.rs` (prefer `NZH` over `N0H` when the day's listing has it, falling back otherwise), `src/i18n/*` if any tilt copy assumes 0.5.
  Acceptance: A fixture volume whose first cut is 0.3 degrees draws that cut as tilt one with the picker naming 0.3; a listing that holds `NZH` is read for the classification and one without it falls back to `N0H`, both pinned in tests; `cargo test --lib` green.
  Complexity: S

- [ ] AUD-382 (P3): Draw the radius each watch rule uses as a ring around its place
  Why: Every watched place carries a radius the rules are judged against (`radiusMiles` for the warning, arrival and lightning rules) and the map never shows it, so a reader who set "within ten miles" cannot see which storms are inside the circle and which are not. Range rings have been a fixture of radar displays from the beginning, and tar1090 keeps the same convention for aircraft.
  Evidence: `src/lib/watch.ts:47`, `:222`, `:263-265`, `:366` (`radiusMiles` in the rules and in the distance test); `grep -rn "rangeRing\|range ring" src` is empty on 2026-09-07; https://github.com/wiedehopf/tar1090 (range rings from the layers control).
  Touches: `src/components/MapViewport.tsx` (a GeoJSON circle per watched place at its radius, a line layer keyed on `isLightBasemap` for its ink, off the export unless asked), `src/panels/WatchSection.tsx` (a switch "Show the radius on the map", off by default), `src/lib/settings.ts`, `src/i18n/*`, the watch or layers spec in `e2e/`.
  Acceptance: With the switch on, each watched place draws a ring at its own radius in the reader's units, labelled once with the distance; the ring follows the radius when it is changed; it is absent from the export by default; the pseudolocale clipping test covers the label.
  Complexity: S

- [ ] AUD-383 (P3): Start plain after two unclean exits in a row
  Why: An imported overlay, a placefile, a theme file or a saved camera that takes the window down at boot takes it down on every boot, and the only recovery today is the crash screen's Reset layout, which a reader never reaches if the page dies before it renders. OBS writes a zero-byte sentinel at launch and deletes it on clean shutdown; finding it on the next launch offers Safe Mode. Firefox's Troubleshoot Mode disables customisations temporarily and puts them back on exit. The roadmap's own rule is that the workspace opens plain for a reader who wants it plain.
  Evidence: https://github.com/obsproject/obs-studio/pull/8455 ; https://support.mozilla.org/en-US/kb/diagnose-firefox-issues-using-troubleshoot-mode ; `src-tauri/src/crash.rs:317-331` (`crash_last_dump`, `crash_last_webview_report`: the record of the last crash, and nothing that changes the next start); `src/components/ErrorBoundary.tsx` (Reset layout, reachable only once React has mounted); `src/lib/settings.ts` (imported overlays, palettes, themes and the camera all restored at boot).
  Touches: `src-tauri/src/crash.rs` or `lib.rs` (a `running` sentinel in app data written in the setup hook and removed on a clean exit, with a count of consecutive unclean starts), `src/hooks/useSettings.ts` (on the second unclean start in a row, load with imported overlays, placefiles, the custom theme and the seasonal look off and the camera at home, and say so in a toast with one press to put everything back), `src/i18n/*`, `e2e/storage.spec.ts` with a planted sentinel.
  Acceptance: A planted sentinel with a count of two at launch opens the workspace plain with the toast; pressing Restore puts every switch back and clears the count; a clean exit removes the sentinel; a single unclean exit changes nothing; the spec covers all three.
  Complexity: M

## Verification Findings, 2026-09-08

Raised by a second adversarial review, of `ca36e7a..ddebfd1`, instructed to refute rather than confirm. Every one is a defect in this session's own work or in a claim it made.

### P1

### P2

### P3



## Audit Findings, 2026-09-08

Read-only pass at `2424f13`. Baseline: `npm run check` exit 0 (205 files, 2043 tests, 39 skipped, one standing lint warning), `cargo fmt --check` clean, `cargo clippy --all-targets` clean, `cargo test --lib -- --test-threads=4` 484 passed / 34 ignored, `cargo check --lib --features fuzzing` compiles with 914 warnings, Playwright chromium 361 passed / 1 skipped, wide and compact 366 passed with one failure that did not reproduce alone (`AUD-424` below). The tracker is empty: 0 open issues, 0 closed, 0 pull requests, discussions off, not a fork, so there were no reports to disposition.

### P2

### P3





- [ ] AUD-420 (P3): Uninstalling with the desktop wallpaper switched on leaves the desktop pointing at OpenRadar's picture
      Category: reliability
      Where: `src-tauri/src/wallpaper.rs:44-54` (the picture is written to `<app data>/wallpaper.png` and the reader's own wallpaper is remembered in `wallpaper-previous.txt` beside it); `src/App.tsx:1552-1563` (the only call to `restoreWallpaper`, when `wallpaperMinutes` goes to 0); `src-tauri/tauri.conf.json` (no `installerHooks`); nothing in `src/` or `src-tauri/src` restores on window close or app exit.
      Problem: The feature restores the reader's wallpaper only when they switch it off in Settings. Closing the app leaves the last frame on the desktop with its age burned in, which is the documented design. Uninstalling is not: nothing runs at uninstall, so the desktop is left set to a file in a folder the uninstaller may remove, and the note that could put the original back goes with it. The reader ends up with either a stale radar picture they cannot switch off without reinstalling, or a blank desktop, and their own picture is gone in both cases.
      Evidence: Read on 2026-09-08; `grep -rn wallpaper_restore src/` shows one caller; the config has no NSIS hooks. Not run, because the uninstaller needs a built installer and a desktop session.
      Fix: An NSIS pre-uninstall hook (`bundle.windows.nsis.installerHooks` with `NSIS_HOOK_PREUNINSTALL`) that reads `wallpaper-previous.txt` and applies it with `SystemParametersInfo` through the same path `restore_with` uses, or a small `--restore-wallpaper` mode in the binary the hook invokes. Say in `README.md`'s wallpaper paragraph what closing the app leaves on the desktop.
      Acceptance: With the wallpaper on, running the uninstaller puts the reader's previous wallpaper back; a scripted check reads `HKCU\Control Panel\Desktop\Wallpaper` before install and after uninstall and finds the same value.
      Confidence: Likely
      Effort: M


- [ ] AUD-423 (P3): `settings.ts` is 2,138 lines that import nineteen leaf modules, and every ring this week ran through it
      Category: maintainability
      Where: `src/lib/settings.ts` (2,138 lines; 32 import lines from 19 modules: `alertTypes`, `approach`, `cappi`, `classification`, `gaugeQpe`, `level2`, `lightningGrids`, `lightningWatch`, `palette`, `rotationTrack`, `runtime`, `satelliteBands`, `siteLoop`, `spcHazards`, `surge`, `theme`, `units`, `watch`; imported by 36 non-test files); `src/lib/layering.test.ts` (the three rules that now guard it).
      Problem: The module holds the types, the defaults, thirty-odd private normalisers and the store, and to normalise each section it imports the leaf that owns that section's vocabulary. Every one of those leaves must therefore never import `settings.ts` back, and three did in the last week (`AUD-375`, `AUD-392`, `AUD-403`), each found by an adversarial review rather than by the build. The gate now catches the ring; it does not remove the shape that keeps producing one. `AUD-272` splits `App.tsx` for the same reason and does not cover this file.
      Evidence: `wc -l`, the import list and `grep -rl` counts on 2026-09-08; the three commits named.
      Fix: Split along the seams the file already has: `settings/types.ts` (the interfaces, no imports), `settings/defaults.ts`, one normaliser per section beside the leaf that owns it (`normalizeWatch` in `watch.ts`, `normalizePalette` in `palette.ts`, and so on, each taking `unknown` and returning its own type), and `settings.ts` left as the store plus `normalizeSettings` composing them. The leaves then import the types module only, which cannot close a ring.
      Acceptance: `settings.ts` is under 600 lines and imports no module that imports it; `layering.test.ts` still green; `npm run check` green.
      Confidence: Verified
      Effort: M



- [ ] AUD-440 (P3): The detail ceiling is a fraction of the disc, so a terminal radar reaches it long before it runs out of picture
  Why: `FINEST_DETAIL_STEPS` is 16, and its reasoning is written against a WSR-88D: a sixteenth of a 460 kilometre disc is 28 metres a pixel, nine times finer than a 250 metre gate, so there is nothing left in the data to resolve past it. A terminal radar's base products cover 177.6 kilometres in the same 1,024 pixels, which is 173 metres a pixel against 150 metre bins, so one halving already resolves every bin and the remaining three cost a Level III fetch, a decode and a 1024 square render each to interpolate. `TZL`, the long-range product, is 834 kilometres and does want the depth. The ceiling is expressed in the wrong units: it should be a ground resolution held against the bin or gate the sweep actually carries, not a share of whatever disc happens to be underneath.
  Evidence: Measured by an adversarial review of `5e33650..5ef138a` on 2026-09-08. WSR-88D 460 km / 1024 px = 449 m per pixel against 250 m gates; TDWR base (`BASE_RANGE_KM = 88.8`, `BASE_BIN_KM = 0.15`) 177.6 km = 173 m per pixel against 150 m bins; TDWR long range (`LONG_RANGE_KM`, `LONG_BIN_KM = 0.3`) 834 km = 814 m per pixel against 300 m bins. `src/lib/level2.ts` (`FINEST_DETAIL_STEPS` and its doc comment); `src-tauri/src/tdwr.rs:50-54`.
  Touches: `src/lib/level2.ts` (`sweepDetailBox`, whose ceiling would come from the sweep rather than from a constant), `src/hooks/useSingleSiteRadar.ts` (the box is worked out from `disc`, which would have to carry the gate or bin size the site publishes at), `src-tauri/src/level2/mod.rs` and `src-tauri/src/tdwr.rs` if the sweep has to carry it, and `src/lib/level2.test.ts`, whose halving test pins the current progression.
  Acceptance: The box stops narrowing once a pixel is comfortably finer than the gate or bin the sweep carries, whichever radar it is; a terminal base product stops at the step that resolves its bins and the long-range one keeps its depth; a WSR-88D is no worse off than it is today; the halving test pins the new rule rather than a constant.
  Complexity: M

- [ ] AUD-445 (P3): `misplaced` mixes the boundary's mistakes with the wind's, so neither can be bounded on its own
  Why: `misplaced` counts gates that never folded and came back on a branch other than the picture's own, whatever put them there. Two different passes can do it: a boundary vote that gets a whole patch wrong, and the reference wind placing an unreached group. The first dominates. Recorded over the week of 2026-09-01 to 2026-09-07, 159,771 of these exist with no reference pass running at all, against 167,180 with the pass and its plausibility bar. That is why `AUD-388` could not be finished as written: a per-station line drawn on the total clears the recorded week at 1.285 and still clears it at 1.329 with the bar removed, so no line both leaves room for the weather and answers for the wind. Split at the point of placement and the wind's own contribution becomes a number that can carry a line.
  Evidence: measured 2026-09-08 while draining `AUD-388`, from two full runs of `recording_the_days_unfolding_is_held_against`, 42 station-days with the plausibility bar and 38 comparable without. Per-station worst with the bar 0.166, 0.633, 0.835, 0.953, 1.263, 1.285; without it 0.200, 0.699, 0.910, 0.962, 1.285, 1.329. Worst single station-day movement 0.122, aggregate over the shared days 152,398 against 160,430. `src-tauri/src/level2/testing.rs` (where `misplaced` is counted), `src-tauri/src/level2/decode_tests.rs` (the bound and the reasoning beside it).
  Touches: `src-tauri/src/level2/testing.rs` (carry which pass placed a gate through to the count, as two fields rather than one), `src-tauri/src/level2/decode_tests.rs` (a line on the wind's share, recorded from a week), `src-tauri/src/dealias.rs` if the placement has to be reported out.
  Acceptance: the recorder prints boundary-placed and wind-placed separately; a per-station line on the wind's share is drawn from a recorded week and fails when the plausibility bar is removed, which the combined figure cannot do; the existing bound on the total stays.
  Complexity: M

- [ ] AUD-446 (P3): A forecast column in a system nothing can convert is still drawn under this app's own label
  Why: `parseGuidance` converts a reply that came back in the other system, which covers every token the request can ask for: celsius, fahrenheit, kmh, mph, mm and inch. A token outside those six is left exactly as it arrived, because nothing here knows what it means, and `GuidancePanel` still labels the column from `variableUnit(reading.variable)`. So a reply in kelvin would be drawn as 299 under a heading reading °C. The reading carries the truth in its own `unit` field and nothing renders it. Never observed: the service answers in what the request asked for or in its own default, and both are in the table, which is why this is filed rather than guessed at. What it needs is a decision about what a reader should see, and the options are not equal: dropping the column loses a forecast, drawing the service's raw token puts `mp/h` on screen where the rest of the app writes `mph`, and a per-column note is a sentence in three catalogues for a case nobody has hit.
  Evidence: measured 2026-09-08 by an adversarial review of `72d7530..452a264`, which found the log-only version of this and is what the conversion answers. `src/lib/guidance.ts` (`intoAsked`, which returns the answered token and no converter), `src/panels/GuidancePanel.tsx:303,306` (`variableUnit`, which never reads `reading.unit`), and `src/lib/guidance.test.ts` (`leaves a system nothing here can convert exactly as it arrived`, which pins today's behaviour).
  Touches: `src/panels/GuidancePanel.tsx`, `src/lib/guidance.ts` if the reading needs to say more than the token, `src/i18n/*` if the answer is a sentence.
  Acceptance: a reply in a token outside the six is never drawn under a label that contradicts it; whichever answer is chosen is asserted in `GuidancePanel.test.tsx` against a planted kelvin reply, and planting the mislabel fails it.
  Complexity: S


### Notes on existing items

- `AUD-377`: the dead-rule class it names is about ten times larger than it lists, and its line numbers past about 2760 have drifted by 87 to 135 lines. Implementing its own acceptance script on 2026-09-08 finds 31 duplicate bare-selector groups and 89 dead declarations, all beaten by the incident-rail block that starts at `src/index.css:4011`. The colour-bearing ones it does not name: `.map-stage` (`:90`, its radial vignette at `:96-101`, beaten by `:4142`), `.app-brand` (`:139` by `:4159`), `.top-status__center` (`:182` by `:4192`), `.command-button[aria-pressed="true"]` (`:467` by `:4463`), `.play-button` (`:617` by `:4540`), `.zoom-controls` (`:731` by `:4589`). The forced-colours rule at `:3337-3340` loses `border-color: Highlight` to `:4465` `border-color: transparent`, and only its `outline` half survives, so the comment saying the pressed state "is said with a border as well" is no longer true. Where its cited lines are today: `.fatal-error__mark` `:2855`, `.track-swatch` `:3406`, the forced-colours `.command-bar` `:3320`, `.product-legend` `:3624`, `--bg` `:4032` and `:4109`, the rail rules `:4274` and `:4172`, the capture bar block `:5963-6102`. The rest of the item stands.
- `AUD-333`: the three cell-stroke lines it cites have moved to `src/components/MapViewport.tsx:1245`, `:1260` and `:1294`; the file's own light-basemap reasoning at `:608-618` is applied to `COUNTY_LANE` at `:969` and still not to `CELL_LANE`, and the same shape is at `:1491` (`#e2e8f0` track default) and `:1571` (`#eff6ff` placefile point stroke). The error-state half of the item was observed on 2026-09-08 for Alerts, Nearby, Tropical, History, Route, Guidance, Sounding, Tides, Forecast and Search with each panel's host refused, answering 503 and answering 429, in both themes; what it found is `AUD-425` and `AUD-426`, and the rest read correctly.
- `AUD-295`: its note that `packs.error.httpStatus` and `radar.error.httpStatus` "end in a bare status" is out of date; `nativeError.ts` now replaces the status with a `serviceAnswer` verb phrase, which is `AUD-414`. The three strings in `AUD-417` and the terminology in `AUD-416` are additions to its list, not repeats. Two more for its list, seen in the running window on 2026-09-08: `forecast.rainNow` ("{value} {unit} now", `en.ts:348`) renders "0.00 in now" under imperial, where the abbreviation for inches reads as the preposition; and the loop export buttons read "Export loop (WebM) (3 frames)", two bracketed clauses in a row.
- `AUD-370`: `scripts/build-counties.mjs` (94 statements, 0 per cent) is a third script with no test; the one rule it carries, refusing an output over a megabyte, is the kind the item's fix pins for the other two.
- `AUD-272`: `src/panels/MapOptionsPanels.tsx` no longer exists; it was split into `LayersPanel.tsx` (1,440 lines), `SettingsPanel.tsx` (900), `WatchSection.tsx` (825) and the sections beside them, which is the panel half of the item done. `src/App.tsx` is 3,138 lines on 2026-09-08 against the 2,814 the item measured and the 1,500 it asks for, so the other half has moved the wrong way. `AUD-423` is the same shape in `settings.ts`.

### Unaudited, needs a pass

- The installed build's desktop-only paths were read and not run: the updater against a published `latest.json`, the tray and glance window on a real desktop, wallpaper restore through the registry, the autostart entry, an `openradar://` link arriving from another program while the app is running, and an incident pack download against the live USGS host. `Roadmap_Blocked.md` records why: no signing key on this machine and no desktop session for a terminal pass. `AUD-420` is the one finding from that reading.
- The export encoders' output was not played back: whether the WebM, MP4 and GIF a loop writes open cleanly in the players the README names (iMessage, a phone gallery, QGIS for the GeoTIFF). The unit tests hold the container layouts, not a player.
- The Rust decoders' internals were not re-read this pass. They are fuzzed (seven targets, `README.md` "Fuzzing the decoders") and the sweep of panic sites in the network-facing modules on 2026-09-08 found none outside `gfs.rs`, whose eight `unwrap()` calls sit behind length checks the `grib_complex` target exercises.
- Spanish and French were swept as text and rendered only by the existing `language.spec.ts` at 1024 wide; the panels were not opened in either language by hand. The thirteen keys `AUD-416` lists as clipping risks (`storm.status.LO`, `chrome.now`, `palette.on`, `timeline.live`, `chrome.rainRate`, `panel.upload`, `bar.locate`, `chrome.justIn` and their siblings, each 1.6 to 3.3 times its English length) should be looked at in the running window in both languages, not only in the pseudolocale.
- The German radar and warnings (DWD) and the Canadian radar (GeoMet) were not driven against their live services this pass; `npm run check:live` covers them and was not run because it is a network gate the read-only pass keeps off.

## Research-Driven Additions, 2026-09-08 (evening)

Tenth research pass, at `beae469`. Everything below came from the third refutation report of 2026-09-08 (against `db461ff..4450979`), the full browser run that landed `AUD-334`, the recon of the tree, and a twenty-four hour watch of the ecosystem. Each finding was re-verified by reading the code or by arithmetic before it was written down; the arithmetic is in `RESEARCH.md`. Items are numbered on from `AUD-447`.

### P1

- [ ] AUD-447 (P1): The sweep box no longer covers the map, and nothing asserts that it must
  Why: `AUD-438` (`4450979`) moved `DISC_IS_ENOUGH_BELOW_ZOOM` from 10 to 8 so the raster would match the screen pixel for pixel. A 1,024 pixel raster at one raster pixel per CSS pixel covers 1,024 CSS pixels of map, and the box centre snaps to a grid of half the box's width (`sweepDetailBox`), so a reader is guaranteed a quarter of the box either side of where they are looking: about 504 CSS pixels at zooms 8 to 11 and 1,008 at 12. The mosaic is driven to opacity zero the moment a single-site sweep is set, so outside the box there is bare basemap. On any window wider than that, which is every window, the reader sees a rectangle of radar with nothing around it, from the zoom the single-site view opens at. The old progression covers about 2,016 CSS pixels at KDMX and is the largest narrowing that does: at zoom 8 a 1,920 pixel window already spans 5.27 degrees against a disc of 5.54, so there is no room to narrow at all, and at zoom 9 the only step that covers the window is the whole disc. The item's own goal was not achievable with this raster.
  Evidence: refutation report of 2026-09-08 on `db461ff..4450979`, HIGH 1, confirmed by arithmetic: MapLibre's world is 512 times two to the zoom over 360 degrees, so a window's half width in degrees is `W * 180 / (512 * 2^z)`; the box guarantees `wide / (4 * steps)`. `src/lib/level2.ts:477` (the constant) and `:530-548` (the exponent and the snap), `src/components/MapViewport.tsx:684-688` (the mosaic at zero under a sweep), `src-tauri/src/level2/mod.rs:49,51` (1,024 pixels, 230 km). `src/lib/level2.test.ts:333-335` says its disc is a real KDMX disc and is 4.56 degrees wide; the real one is 5.54 (230 km at 41.7 north is 2.77 degrees of longitude either side), so a coverage test against that fixture would demand more than the real disc requires. `CHANGELOG.md` opens `v0.12.0` with the sentence describing this change. Four comments still say "past about zoom ten" and `e2e/level2.spec.ts:668-671` asserts a floor under every box that a box clipped at the disc edge legitimately fails.
  Touches: `src/lib/level2.ts` (constant back to 10; docstring rewritten to say the two-sided constraint and the 2,016 pixel figure), `src/lib/level2.test.ts` (the disc corrected to west -96.55 and east -91.01, the zooms in the halving and quantising cases back to 10 to 13, and a new case that computes the guaranteed half span at 1,920 pixels for zooms 10 to 18 and asserts it covers the half window), `src/hooks/useSingleSiteRadar.test.tsx` (zooms back to 12 and 13), `e2e/level2.spec.ts` (the floor assertion skipping a box that touches the disc edge, and the opening assertion back to the disc at zoom 8), `CHANGELOG.md` (the entry removed), `src/lib/level2.ts:152` and `src/hooks/useSingleSiteRadar.ts` (the "zoom ten" comments).
  Acceptance: the coverage case fails with the constant at 8 and passes at 10; the whole disc is asked for at zooms 8 and 9 and a box from 10; `npm run check` and the level2 browser spec green in both projects; no test's assertion is weaker than before.
  Complexity: S

### P2

- [ ] AUD-448 (P2): A shader that will not build leaves the wind layer switched on and drawing nothing
  Why: `createWindLayer` compiles two programs in `onAdd`, catches a compile or link failure and hands the message to `onError`; `MapViewport` writes it to the log and nothing else. The layer stays in the style, the Layers switch stays on, and the reader sees a map with no wind on it and no word about why. The catalogue already carries the sentence (`wind.noDraw`, "The wind layer could not be drawn on this graphics card.") and nothing shows it. Omastorm's first-week tracker holds two independent reports of exactly this shape on a radar layer, where a const array initialiser compiled on one driver and not another and the map read as a clear night; that is the worst failure a hazard display can have. The `onError` fallback string "The wind layer could not start." is also English written into the code, which the failure-path gate does not see because `onError` is not one of its sinks.
  Evidence: `src/lib/windLayer.ts:127-151` (the throws) and `:304-309` (the catch and `onError`), `src/components/MapViewport.tsx:1082-1086` (`onError: (message) => log.warn("wind", message)`), `src/i18n/en.ts:2204` (`wind.noDraw`, used by no component); https://github.com/wesleygrimes/omastorm/pull/16 (2026-09-08, GLSL ES 100) and https://github.com/wesleygrimes/omastorm/pull/22 (2026-09-08, GLSL 120).
  Touches: `src/components/MapViewport.tsx` (on `onError`, remove the layer, switch the setting off through the same path a reader's click takes, and toast `wind.noDraw` with the driver's line in the log), `src/lib/windLayer.ts` (the English literal becomes the catalogue key), `src/panels/LayersPanel.tsx` if the row should say why it went off, `src/lib/failurePaths.test.ts` (`onError` added to the sinks), `src/components/MapViewport.test.tsx` with `compileShader` stubbed to fail.
  Acceptance: with `getShaderParameter` stubbed to return false, adding the wind layer leaves no wind layer in the style, the wind switch off, and the `wind.noDraw` toast on screen; the failure-path gate goes red when the literal is put back; the pseudolocale clipping test covers the toast.
  Complexity: S

- [ ] AUD-449 (P2): A file opened after another file is measured on the first file's disc, and the per-site disc map has no test that would notice its collapse
  Why: `AUD-439` (`0f1fb56`) keyed a file's box on the station of the sweep on screen, which is null on the first open and correct once the file is up. Between two files it is the previous file's station: `fileStation` reads `sweep.station` while `sweep.source.kind` is still "local" for the old file, so the new file's first ask carries a box measured on the old file's disc, which is the intersection sliver the item removed, moved to file-to-file switches, and `rememberDisc` is skipped because the ask was not null. It self-corrects on the next decode, so the cost is one wrong picture and one wasted decode per switch. The per-station disc record that fix introduced is untested: every station in `sweepFor` shares the corners (-96.5, 39.6, -91, 43.8), the assertion only checks the box is inside those, and collapsing the record to a single shared disc leaves 26 of 26 green. The request counter bump in the `already` branch is load-bearing (without it a late archive answer writes the request key to the old value and the wrong picture sticks) and deleting it also leaves 26 of 26 green. Two comments the fix made false still stand: `fetchLocalSweep`'s `within` "Always null from the app today" and the same sentence in `commands.rs`.
  Evidence: refutation report of 2026-09-08, MEDIUM 2 and 3 and LOW 10, 12 and 14, the first proved with a probe in an isolated copy that recorded file B's first ask carrying a box where null was expected. `src/hooks/useSingleSiteRadar.ts:447-465` (`fileStation`, `fileDisc`, `fileWithin`), `:707-721` (`historicalWithin`), `:990` (the bump), `src/hooks/useSingleSiteRadar.test.tsx:70-110` (`sweepFor`), `src/lib/level2.ts:374-376`, `src-tauri/src/level2/commands.rs:302-305`.
  Touches: `src/hooks/useSingleSiteRadar.ts` (a path-to-station record learned from a local answer, so `fileStation` is looked up by the path being asked for rather than read off the sweep on screen; `fileWithin` keyed on it), `src/hooks/useSingleSiteRadar.test.tsx` (distinct corners per station in `sweepFor`, a file-A-then-file-B case asserting B's first ask is null and its second is inside B's own disc, and a case that fails when the `already` branch's bump is removed), the two comments.
  Acceptance: opening a KVNX file while a KTLX file is on screen asks with null first and then with a box inside KVNX's disc; collapsing the disc record to one entry fails at least one case; removing the bump fails at least one case; the two comments describe what the code does.
  Complexity: M

- [ ] AUD-450 (P2): The second-source status sentence in the reports adapter carries the engine's words
  Why: when the first reports source rejects, `failed` is set to the error's own message, which for a refused connection is Chromium's "Failed to fetch", in English whatever the app's language. If the second source's first page then answers a bad status, that string is interpolated into `reports.serviceStatus` and thrown as a plain `Error`. `useOverlays` runs it through `failureSentence`, which passes a plain `Error`'s own message through by design, and writes it into overlay state as `error`, which the panels render. Reachable whenever the first host is down and the second answers 5xx, which is the day both are struggling.
  Evidence: `src/lib/overlays/reports.ts:386` (the message captured into `failed`) and `:410-414` (the throw with `answer: failed || serviceAnswer(answer.status)`), `src/hooks/useOverlays.ts:246` (`failureSentence(error)`) and `:270-273` (`error: message` into state), `src/lib/serviceAnswer.ts` (`isOwnError` passes a plain `Error`'s message). Found by the refutation report of 2026-09-08 (MEDIUM 5); the gate could not see it because the taint travels through a `throw` and a property key.
  Touches: `src/lib/overlays/reports.ts` (`failed = failureSentence(error, translate("service.unreachable"))`, or the `serviceAnswer` vocabulary directly), `src/lib/overlays/reports.test.ts` (first source rejecting with a `TypeError("Failed to fetch")`, second answering 503 on page 0; the thrown message contains no "Failed to fetch").
  Acceptance: the planted pair yields a sentence made only of catalogue text in all three languages; reverting the one line fails the test.
  Complexity: S

- [ ] AUD-451 (P2): The failure-path gate reads a JSX attribute as an assignment and cannot follow a message through a `throw`
  Why: the gate's reassignment pattern matches a JSX attribute such as `label={t("radar.retry")}` as an assignment to `label` and runs to the next semicolon, which in JSX is past the element and into whatever follows, so a developer log two lines down convicts an unrelated `label` handed bare to a sink. The tree is green today because the only non-declaration match is `reports.ts:386`, whose name is never passed bare; that is luck, not construction. Separately, a message that reaches a reader by being thrown (`reports.ts:410`) or by being written under a property key (`answer:`) is invisible, because `valueNames` drops property keys on purpose and `throw` is not a sink. Two live leaks were found by reading on 2026-09-08 after the gate was extended to the whole of `src`, which says the gate is a floor.
  Evidence: `src/lib/failurePaths.test.ts` (`taintedName` and its reassignment regex, `valueNames`, `SINKS`), the refutation report of 2026-09-08 (MEDIUM 5, with the JSX capture reproduced), `AUD-450` and `AUD-448` for the two misses.
  Touches: `src/lib/failurePaths.test.ts` (reject an `=` immediately followed by `{` as an assignment, or bound the body at braces; treat `throw new Error(...)` whose argument is tainted as a sink; add `onError` to `SINKS`), plus a self-test that plants the JSX shape in a fixture string and asserts no conviction, and plants the `throw` shape and asserts one.
  Acceptance: a fixture with a JSX `label` attribute followed by a bare `label` sink passes; a fixture that captures a message into a local and throws it inside a translated sentence fails; the live tree stays green with `AUD-450` and `AUD-448` in place and goes red with either reverted.
  Complexity: M

- [ ] AUD-452 (P2): The README says updates are checked only when asked; the app checks hourly and then daily
  Why: `README.md:152` reads "OpenRadar checks for them only when you ask it to, from Diagnostics". `useUpdates` asks an hour after launch and once a day after that, and the CHANGELOG entry that introduced the poll says so. SECURITY.md's claim is the narrower one, that nothing downloads unasked, and it is still true. A public document that understates what the app does over the network is the one kind of documentation error a privacy-first app cannot carry, however benign the request.
  Evidence: `README.md:152`; `src/hooks/useUpdates.ts:114-133` (the effect and its comment: "once an hour after launch and once a day after that"); `CHANGELOG.md:87` (the same, said to readers); `SECURITY.md:47` (downloads only when asked).
  Touches: `README.md` (the sentence rewritten to say it asks on its own, hourly then daily, and that pressing the button is the only thing that installs), `src/lib/docs.test.ts` if the README is already read there for other claims (add this one: the README must not say "only when you ask").
  Acceptance: the README describes the poll; a doc test fails if the old sentence returns.
  Complexity: S

- [ ] AUD-453 (P2): One 1,024 pixel raster cannot both cover the window and match its resolution, and the ceiling is a maximised window at low latitude
  Why: with the box's guaranteed half span `wide / (4 * steps)` and the window's half width `W * 180 / (512 * 2^z)`, the widest window the progression covers at every zoom it applies to is `wide * 2^z / (1.40625 * steps)`: about 2,016 CSS pixels at KDMX (41.7 north, disc 5.54 degrees wide) and about 1,670 at KAMX (25.6 north, 4.58 degrees), because a 460 km disc is fewer degrees of longitude nearer the equator. A maximised 1,920 window over Miami at zoom 10 already shows basemap along one edge in the worst snap position, about 125 CSS pixels of it, with `AUD-447` in place. `AUD-440` wants the ceiling expressed as ground resolution against the gate the sweep carries, and cannot move it without meeting this bound. Three answers exist and they are a design decision, not a constant: a larger raster (2,048 square is 16 MB decoded against 4, times a hold of thirty loop frames and eight historical), more than one raster per sweep (a tiling the loop, the compare pane and the export would follow), or the mosaic left under the sweep at some opacity so the edge of the box is a national picture rather than nothing.
  Evidence: arithmetic in `RESEARCH.md` (2026-09-08 evening) from `src/lib/level2.ts:530-548`, `src-tauri/src/level2/mod.rs:49,51`, `src/components/MapViewport.tsx:684-688`, and the pinned `nexrad-model` crate's `sweep_extent` (the four cardinal points at 230 km, `geo.rs:188`), which gives KDMX west -96.55 and east -91.01. Needs live validation on a 1,920 window over KAMX at zoom 10 to see the edge.
  Touches: `src/lib/level2.ts` (`sweepDetailBox` or `FINEST_DETAIL_STEPS`, depending on the answer), `src-tauri/src/level2/mod.rs` (`IMAGE_SIZE`) if the raster grows, `src/hooks/useSingleSiteRadar.ts` and `src/lib/siteLoop.ts` (the hold's memory budget), `src/components/MapViewport.tsx` if the mosaic stays under, `src/lib/level2.test.ts` (the coverage case from `AUD-447` extended to the KAMX disc and to a 2,560 window).
  Acceptance: the coverage case passes for a 1,920 window at KAMX and a 2,560 window at KDMX at every zoom from 10; the loop's memory at thirty frames is stated in the commit and stays under the decoded budget; `AUD-440` can be built on top.
  Complexity: L

### P3

- [ ] AUD-454 (P3): The historical hold evicts the oldest inserted rather than the least used, and is never released on return to live
  Why: `trimHeld` keeps the last `keep` entries by Map insertion order, a set on an existing key does not reorder, and the `already` branch never re-inserts, so a reader moving between two boxes across nine cells evicts the two they use most. `resumeRecent` clears the request key and the source and leaves `historicalHeldRef` alone, so up to eight decoded sweeps, about 4 MB each by the module's own estimate, stay pinned for the life of the window after the reader has gone back to live.
  Evidence: refutation report of 2026-09-08 (LOW 11); `src/lib/siteLoop.ts:149-157` (`trimHeld`), `src/hooks/useSingleSiteRadar.ts` (`HISTORICAL_HELD = 8`, `historicalHeldRef`, the `already` branch, and `resumeRecent` at `:970`, which touches neither ref).
  Touches: `src/hooks/useSingleSiteRadar.ts` (delete and re-set on a hit so the map's order is recency; clear `historicalHeldRef` in `resumeRecent`), `src/hooks/useSingleSiteRadar.test.tsx` (nine boxes visited as A, B, A, B, then seven others: A and B still held; `resumeRecent` empties the hold).
  Acceptance: both new cases fail on the current code and pass after; the existing hold cases stay green.
  Complexity: S

- [ ] AUD-455 (P3): An advisory allowance's `needs <crate> <version>` accepts a release candidate of the version it names
  Why: `holds` treats a version that starts with the wanted one and continues with `.`, `-` or `+` as a match, so `needs nexrad-model 1.0.0` holds against `1.0.0-rc.2`, `1.0.0-rc.9` and `1.0.0` alike, and a crate moving from a release candidate onto the real release never re-opens the allowance that was written for the candidate. Only `+` (build metadata) needed the prefix rule; `-` is the prerelease boundary the rule exists to respect. Writing the allowance as `needs nexrad-model 1.0.0-rc.2` matches by equality today, so the tree is not wrong, but the gate accepts a spelling that is.
  Evidence: refutation report of 2026-09-08 (LOW 8); `scripts/advisories-lib.mjs` (`holds`), `src-tauri/.cargo/advisories.txt` (the allowances as written).
  Touches: `scripts/advisories-lib.mjs` (drop `-` from the set; a `needs` on a bare version does not hold against a prerelease of it), `scripts/advisories-lib.test.mjs` (`needs x 1.0.0` against `1.0.0-rc.2` is unmet; `needs x 1.0.0` against `1.0.0+build.3` holds; `needs x 1.0.0-rc.2` against `1.0.0-rc.2` holds).
  Acceptance: the three cases pass; `npm run check:advisories` still passes on the tree as written.
  Complexity: S

- [ ] AUD-456 (P3): `isChunkFailure` does not match Vite's own CSS preload rejection
  Why: the detector covers the three engines' wordings for a dynamic import that did not arrive. Vite's preload helper rejects a lazy import whose CSS did not arrive with "Unable to preload CSS for" and the path, which matches none of them, so that failure is rethrown past the panel boundary to the whole-window recovery screen, which is the outcome `AUD-443` exists to prevent. Not reachable today, because no lazily imported module in the tree imports CSS; it is exactly the "generous direction" the docblock argues for and the first panel that gains a stylesheet of its own reaches it.
  Evidence: refutation report of 2026-09-08 (LOW 9); `src/components/LazyPanel.tsx` (`isChunkFailure`, the regex), `node_modules/vite/dist/node/chunks/node.js:28912` (the rejection).
  Touches: `src/components/LazyPanel.tsx` (the regex gains the Vite wording), `src/components/LazyPanel.test.tsx` (a boundary given that error shows the fetch failure frame rather than rethrowing).
  Acceptance: the new case fails before and passes after; the existing render-failure rethrow case stays green.
  Complexity: S

- [ ] AUD-457 (P3): The export caption's ellipsis is length-neutral, not width-neutral, and the test's `measureText` cannot tell
  Why: a truncated caption line drops its last two characters and appends a space and an ellipsis. In the caption's font (Segoe UI, then system-ui) the two dropped may be narrow glyphs at about 7 px together and the added pair about 13 px, so the line grows by about 6 px and can creep into the right margin. When the line is two characters or shorter the ellipsis is appended with nothing removed. The fake canvas in the test returns a width proportional to character count, which is monospace, so the test passes a change it cannot measure.
  Evidence: refutation report of 2026-09-08 (LOW 6); `src/lib/export.ts:171` (the slice), `:189-191` (the width measured after truncation, which is why the damage is bounded to the margin), `src/lib/export.test.ts:38-40` (the fake `measureText`).
  Touches: `src/lib/export.ts` (trim by measured width: drop characters until the head plus the ellipsis measures no wider than the box), `src/lib/export.test.ts` (a fake `measureText` with two glyph widths, narrow for i, l and t and wide for the rest, and a case with a line ending in narrow glyphs asserting the truncated line is no wider than the box).
  Acceptance: the new case fails on the current slice and passes after; the three caption cases from `AUD-444` stay green.
  Complexity: S

- [ ] AUD-458 (P3): The stand-in for an arriving panel has no accessible name
  Why: while a panel's chunk downloads, the frame on screen is a section with `aria-busy` and, since `77c8240`, a heading with `role="presentation"`. A screen reader user who presses a surface button hears nothing until the panel arrives, which was measured at about 1,100 ms for a cold chunk, and nothing tells them the press took. Before `AUD-443` there was nothing on screen at all, so this is not a regression, but a stand-in that holds the room visually and says nothing aurally is half a stand-in.
  Evidence: `src/components/LazyPanel.tsx` (`PanelPlaceholder`: no `aria-label`, no role, no live region), `e2e/panel-chunks.spec.ts` (the 1,100 ms figure in the comment).
  Touches: `src/components/LazyPanel.tsx` (`role="status"` with an `aria-label` of `panelChunk.loading` plus the title, so the press is announced once), `src/components/LazyPanel.test.tsx` (the placeholder has an accessible name containing the title), `e2e/accessibility.spec.ts` (axe over the stand-in with the chunk held).
  Acceptance: a status role named for the panel resolves while the chunk is held and is gone when the panel lands; axe is clean over the held state.
  Complexity: S

- [ ] AUD-459 (P3): Browser cases that set their own viewport run identically in both projects
  Why: the `chromium` and `compact` projects differ only by viewport. A case that calls `page.setViewportSize` or sits under `test.use` with a viewport overrides that, so it does the same work twice and proves nothing the second time. The sixteen-load overflow case is 35 seconds in each project; the full suite is 25 minutes at two workers, and `AUD-334` made a full run the acceptance for any change to a spec.
  Evidence: `e2e/workspace.spec.ts` (two `setViewportSize` loops, one of them at `:1495`, the sixteen-load case), `e2e/capture.spec.ts`, `e2e/language.spec.ts` (viewport overrides at `:109`, `:276` and `:474` and one `setViewportSize`), `e2e/mrms.spec.ts`, `e2e/screenshot.spec.ts:38`; `playwright.config.ts:19-35` (the two projects); the full run of 2026-09-08 evening (794 passed, 2 skipped, 25.1 minutes).
  Touches: `playwright.config.ts` (a `grepInvert` on the `compact` project for a tag), the cases above (an `@ownViewport` tag in the title), `README.md`'s testing section if it lists the projects.
  Acceptance: the tagged cases run once per suite run; every other case still runs in both; the suite's wall time drops by at least the duplicated sixteen-load case's 35 seconds.
  Complexity: S

- [ ] AUD-460 (P3): A live scan that keeps failing is logged at debug and reaches nothing a reader can open
  Why: when the chunk bucket cannot be listed or a live volume cannot be assembled, the command logs the reason at debug and hands back the finished volume, which is the right picture to show. The age beside the sweep climbs, so a reader can see it is behind; what nobody can see is why, or that it has been failing for hours rather than once. Omastorm's first live-polling report had a poller sit silent for four hours, and the incidental finding there was that the failure left no trace to read afterwards. Diagnostics here lists source health per adapter and says nothing about the live Level II path.
  Evidence: `src-tauri/src/level2/commands.rs:113-118` (the debug line and the fallback); https://github.com/wesleygrimes/omastorm/pull/7 (2026-09-08); `src/panels/UtilityPanels.tsx` (the Diagnostics source list, which has no Level II live row).
  Touches: `src-tauri/src/level2/commands.rs` (warn after the second consecutive failure for a station, with the count), `src-tauri/src/level2/mod.rs` (a per-station consecutive-failure count the sweep answer carries), `src/lib/level2.ts` (the field on `SweepImage`), `src/panels/UtilityPanels.tsx` (a Level II live row: last success, consecutive failures, last reason), `src/i18n/*`.
  Acceptance: two failed live scans in a row for one station produce one warn line and a Diagnostics row that says so; a success resets it; the row is covered by the pseudolocale clipping test.
  Complexity: S

### Notes on existing items

- `AUD-355`: add `maplibre-gl` 6.8.0 (2026-09-07 22:23 UTC; programs are linked before compile status is read, the default marker is cloned, HTTP 204 raster-DEM tiles are no-data, the render-task-throw freeze is fixed), `reqwest` 0.13.5 (2026-09-08; the wrong proxy credentials were sent when several proxies matched a URL) and `rustls` 0.23.44 (2026-09-07), both inside the caret ranges, and `lucide-react` 1.43.0. Hold `typescript-eslint` 8.70.0 for a sitting of its own: it adds `no-generated-empty-object-type`, and a new rule under `--max-warnings 0` can turn the lint gate red on its own. The critical `maplibre-gl` advisory of 2026-09-08 (CVE-2026-85061) caps at 6.4.0; the tree is past it. `rust-version = 1.85` matches the MSRV wry 0.57 and tao 0.37 declare, so the floor is not behind them.
- `AUD-440`: whatever expresses the ceiling as ground resolution against the gate has to keep the coverage bound in `AUD-453`; the two are one constraint read from opposite ends. A TDWR's 177.6 km disc is 2.14 degrees wide at 41.7 north, so it cannot cover a 1,920 window at zoom 10 at any step, including the whole disc; that is the radar's reach rather than the box's, and the coverage case has to say so rather than fail on it.
- `AUD-378`: re-verified live on 2026-09-08. `api.weather.gov/radar/stations` lists 159 ids including KHDC (295 objects on the bucket that day), KBHX, KDOX, KLGX and PAPD; KLIX answers 404 and has zero objects on 2026-09-07 and 09-08 and no folders in the chunk bucket. `danielway/nexrad` PR #148 is open with zero comments and no crate has been published since 2026-04-03. The app's own table remains the route.
- `AUD-345`: three more sources for the same ask since 2026-09-07, none of them a radar app's tracker: a Substack post on syncing a phone video to MRMS that found acquisitions "up to 10 minutes late" (on Hacker News 2026-09-07), a Hacker News comment on rain cut off at a tile boundary, and HookEcho's six rendering fixes of 2026-09-08 evening, all of which are about a reader being able to tell what the picture is doing.
- `AUD-273` (blocked): wry 0.57.0 shipped 2026-09-08 (MSRV 1.85, the `windows` crate at 0.62, drops Windows 7) and PR #15996 pulls it into the 2.12 milestone, which is at 15 open and 32 closed with 76 pending change files. The tree stays on wry 0.55.1 until 2.12 ships.
- The placefile-host decision in `Roadmap_Blocked.md`: MesoPulse has not launched. The PlacefileNation countdown still reads "launching September 1, 2026" a week later, `/mesopulse` is 404 and `mesopulse.com` does not resolve (2026-09-08). The argument the ninth pass built on it is weaker than written; the decision is still the owner's.

## Research-Driven Additions, 2026-09-08 (late evening)

Eleventh research pass, at `8c19165`, an hour after the tenth. It ran the headless UI inspection the tenth had no machine for (108 captures, both themes, both widths, axe and the overflow check on every one: zero violations, zero overflow, so what follows is what a person sees), read the destructive, import and recovery flows in code, and refreshed the academic, platform and curated-list source classes against 2026. Every finding below was verified against the code and, where there is one, the screenshot; `RESEARCH.md` records what was looked at and judged fine or an artefact so it is not re-filed. Items are numbered on from `AUD-461`.

### P2

- [ ] AUD-461 (P2): The loop speed is shown as a raw slider position, so the product panel reads "-0.1 Speed" on a fresh install
  Why: `animationSpeed` is a position on a scale from -0.8 to 0.5 that `animationIntervalMs` turns into a frame interval from 1,800 to 350 ms; the default is -0.1. The radar product panel prints that number with one decimal under the label "Speed", and the Settings slider prints the same into its `<output>`. A negative, unitless speed is a number that means nothing to the reader and looks like a fault. The value the reader can reason about is the one the code already computes: how long each frame stays on screen, or how many frames a second.
  Evidence: seen in the headless capture `dark-chromium-product.png` (2026-09-08) as the chip "-0.1 / Speed"; `src/panels/RadarProductPanel.tsx:246-251` (`formatNumber(radar.animationSpeed, 1)` under `t("radar.speed")`), `src/panels/SettingsPanel.tsx:768-777` (the same into `<output>`), `src/lib/radar.ts:7-11` (`animationIntervalMs`: `1800 - normalized * 1450`), `src/lib/settings.ts:699` (default -0.1) and `:1674-1679` (clamped to -0.8 to 0.5).
  Touches: `src/lib/radar.ts` (a formatter beside `animationIntervalMs` that says the interval in the reader's words, seconds with one decimal, or frames a second), `src/panels/RadarProductPanel.tsx` and `src/panels/SettingsPanel.tsx` (print through it; the slider keeps its internal range), `src/i18n/*` (a unit string if seconds is chosen), `src/panels/RadarProductPanel.test.tsx` and `src/panels/SettingsPanel.test.tsx` (the default renders as a positive figure with a unit and never as "-0.1").
  Acceptance: at the default the chip and the slider output show the same positive figure with a unit in all three languages; the slider's stored value and `animationIntervalMs` are unchanged; a test fails if either surface prints the raw position.
  Complexity: S

### P3

- [ ] AUD-462 (P3): "Forget source history" is the one removal in the app with no way back
  Why: five destructive actions carry an undo toast (removing a file layer, a sound file, a pack, a watched place, and the curiosity list, the last added explicitly under the character rules' "everything is reversible in one action"). The Diagnostics button empties the incident ring, writes the empty ring to disk and flips a label, and the incidents are the record of what every source did on this machine that day, which a reader cannot rebuild by pressing anything. The pattern for it is already in the file beside the curiosity handler: hold what was there, offer `toast.undo`, put it back on press.
  Evidence: `src/panels/UtilityPanels.tsx:328-336` (`clearIncidents(); setForgotten(true)` and the label at `:339`), `src/lib/providers/health.ts:135-139` (`clearIncidents` empties and saves), `src/panels/SettingsPanel.tsx:532-560` (the curiosity handler with its `undo`), `src/i18n/en.ts:1683` (`toast.undo`); `ROADMAP.md`, Character and personalization, "Everything is reversible in one action".
  Touches: `src/lib/providers/health.ts` (`clearIncidents` returns what it removed, or a `restoreIncidents(list)` beside it), `src/panels/UtilityPanels.tsx` (a toast with `toast.undo` through the panel's `onRemoved` or `pushToast`, restoring the held list), `src/i18n/*` (a title and body for the toast), `src/panels/UtilityPanels.test.tsx` (forget, then undo, and the incidents are back in order; the saved ring matches).
  Acceptance: pressing the button shows a toast with Undo; pressing Undo restores every incident in its original order and writes them back; without Undo they stay gone; the test fails if `clearIncidents` is called without the toast.
  Complexity: S

- [ ] AUD-463 (P3): Wind Profile and Cross-section open to a sentence naming a precondition and no control for meeting it
  Why: both panels, opened from the rail with no site held, show one paragraph in a 756 px panel and nothing else: "Hold a single radar site and this reads its own wind, height by height." and the cross-section's "Zoom in over a NEXRAD site to slice its volume." The reader is told what has to be true and given no way to make it true from where they are, and the Upload panel in the same shell shows the pattern that works: an icon, a title, a sentence, and the one button that starts the thing. The controls exist elsewhere (the product panel's single-site switch and station list; the map's zoom); the empty state only has to reach them.
  Evidence: headless captures `dark-chromium-vwp.png` (69 px of content in 756) and `dark-chromium-section.png` (55 px), against `dark-chromium-upload.png` (icon, title, sentence, "Choose a file"), 2026-09-08; `src/i18n/en.ts:495-496` (`vwp.needsSite`), `src/panels/VwpPanel.tsx` and `src/panels/CrossSectionPanel.tsx` (the empty branches), `src/panels/UtilityPanels.tsx:45-70` (`UploadPanel`, the pattern), `src/components/PanelSurfaces.tsx:211,309` (`onCommand`, the runner the palette already uses) and `src/App.tsx:2512-2516` (the `surface: "radar-product"` action, which opens the product panel).
  Touches: `src/panels/VwpPanel.tsx` and `src/panels/CrossSectionPanel.tsx` (an empty-state block in the Upload shape: icon, the existing sentence, and a button that opens the radar product panel with the single-site switch focused, or flies the map to the nearest site at the single-site zoom; both reach `App.tsx` through the `onCommand` prop `PanelSurfaces` already hands the palette, so no new plumbing), `src/i18n/*` (the button label), the two panels' tests (the button is present in the empty state and absent once a site is held), `e2e/wind.spec.ts` or `e2e/level2.spec.ts` (pressing it from the empty state ends with a site held).
  Acceptance: each empty state has one button; pressing it leaves the reader holding a site or looking at the nearest one at the single-site zoom; the button is gone when the panel has data; the pseudolocale clipping test covers the label.
  Complexity: M

- [ ] AUD-464 (P3): The postcard heading in Export is spaced as a caption on the button above it
  Why: "Send it to somebody" sits 8 px below the GIF button and 26 px above its own paragraph, so it reads as a label for the button rather than as the heading of the block that follows. `.settings-section` carries bottom padding, a bottom margin and a border and no top margin, so it is spaced from a section above it; here the element above is a button, and nothing supplies the gap.
  Evidence: headless captures `dark-chromium-export.png` and `dark-compact-export.png` (2026-09-08), measured; `src/panels/ExportPanel.tsx:172-180` (four `export-button`s then `<div className="settings-section" data-postcard>`), `src/index.css:1744-1750` (`.settings-section`: `padding-bottom: 16px; margin-bottom: 15px; border-bottom` and no top spacing), `:1796-1801` (`.settings-section__title`, `margin-bottom: 5px`).
  Touches: `src/index.css` (a top margin on `[data-postcard]`, or a rule that gives a `.settings-section` following an `.export-button` the same gap a section gets from the section above it), `e2e/export.spec.ts` (the heading's top is at least as far from the button above as from the paragraph below, measured with `boundingBox`).
  Acceptance: the gap above the heading is no smaller than the gap below it in both projects and both themes; the export spec asserts it; nothing else in the panel moves.
  Complexity: S

### Notes on existing items

- `AUD-295`: four more for its list, all seen in the headless captures of 2026-09-08. The Guidance footer reads "read 0 min ago" at zero minutes (`guidance.answeredFor`, `en.ts:2124`; a "just now" branch in `formatAge`, or the same handling the timeline's age chip has). A warning card headed EXTREME reads "Issued unknown · expires unknown" when the feed omits both times (`alerts.unknownTime`, `en.ts:91`); on a life-safety card the two unknowns should be one sentence or none. The radar product panel shows Opacity twice, as a chip at the top and as a slider 200 px below, with the chip putting the value above the label and the sliders putting it to the right. The Guidance blocks' right-aligned "they disagree, in °F" and "in inches" read as sentence remnants and could carry their subject ("Models disagree, in °F").
- `AUD-333`: the headless inspection of 2026-09-08 opened every surface in the light theme at 1440 and 1024 and found zero axe violations and zero overflow; by eye the light theme was correct on Settings, Search, Layers, Commands, Diagnostics and the first-run card, where the map attribution gets its white pill and the timeline and legend repaint. Not reviewed by eye in light: Nearby, Tropical, Route, Tides, Map Type, Forecast. The error-state half of the item was not exercised (the aborted-route capture was held for about two seconds); the item's own fixture-based instructions stand.
- `AUD-348`: two 2026 papers for its reading list. Bölz et al. (Ulm and DWD), EGUsphere 2026-992 (2026-03-18), a U-Net for non-meteorological echo removal trained on synthetic composites (clean winter precipitation pasted onto cluttered summer scans) that beats DWD's operational classifier at precipitation edges, which removes the hand-labelling cost; CC-BY, no code link. Frech, Boehm and Tracksdorf (DWD), AMT 19:1711 (2026-03-10), wind-turbine clutter detected dynamically above 80 per cent when rotors exceed 5 rpm, polarimetric moments more sensitive than reflectivity, code on request; the static-mask-plus-dynamic-test shape is the one for a wind-farm filter.
- `AUD-351`: Tauri's pending 2.12 change files move monitor queries to the main thread and make `primary_monitor`, `monitor_from_point` and `available_monitors` return `Result`; nothing in `src-tauri` calls them today, so this item will be the first caller and should be written against the 2.12 signatures.
- `AUD-355`: MapLibre style-spec 26.4.2 (2026-09-08) beside GL JS 6.8.0. Checked and not affected: Edge 152's `unload` deprecation (the tree saves on `pagehide` and `visibilitychange` and has no `unload` or `beforeunload` handler) and the `-webkit-app-region` rename to `window-drag` (not used). WebView2 moved to a two-week release cadence at 152.
- `AUD-228`: veritiles (awesome-maplibre, 2026-08-27) integrity-checks PMTiles from untrusted hosting; a hash beside an imported basemap is the same idea in one line and belongs in this item's acceptance.

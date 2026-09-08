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

- [ ] AUD-334 (P3): Fail any spec that drops a promise, not just the one that asks
      Category: testing
      Where: `e2e/support/fixtures.ts` (`recordRejections`, `unhandledRejections`), `e2e/level2.spec.ts` (the one spec that asserts), every other spec's `import { expect, test } from "@playwright/test"`.
      Problem: The three unhandled rejections a green run used to carry are caught at the source now, and `routeWorkspace` records any that happen, but only one spec asks. A new one somewhere else still passes silently, which is the condition that let 184 of them accumulate.
      Evidence: `grep -c "unhandledRejections" e2e/*.spec.ts` is 1. The recorder is installed for every spec that calls `routeWorkspace`, so the data is already there; nothing reads it.
      Fix: Export a `test` from `e2e/support/fixtures.ts` built with `base.extend({ page: async ({ page }, use) => { await use(page); expect(await unhandledRejections(page)).toEqual([]); } })`, and change every spec's import of `test` to come from there. A spec that provokes a rejection on purpose opts out by clearing the record. Roughly 40 import lines, mechanical; run the whole suite after, because a spec that has been quietly dropping one will start failing and that is the point.
      Acceptance: A planted `void Promise.reject(new Error("x"))` in any spec's page fails that spec; the full suite passes without one.
      Confidence: Verified
      Effort: M

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

- [ ] AUD-339 (P2): Draw the single-site sweep at the zoom the reader is at
      Why: The sweep is rendered once in Rust as a 1,024 pixel Mercator raster over a 460 km disc, 449 m per pixel against 250 m super-resolution gates, and placed on the map as one image source that MapLibre stretches. At zoom 12 (about 29 m per screen pixel at 40 degrees) one raster pixel covers fifteen screen pixels, so a reader zoomed in on a couplet is looking at the raster's grid, not the radar's. The national grids had exactly this defect until 2026-09-05, when `a9407d4` rendered them per zoom through the `mrms` scheme; the sweep can take the same road.
      Evidence: `src-tauri/src/level2/mod.rs:50` (`IMAGE_SIZE = 1024`), `:52` (`MAX_RANGE_KM = 230.0`); `src-tauri/src/level2/render.rs:23-70`; `src/components/MapViewport.tsx:1693` (`type: "image"`); https://maplibre.org/maplibre-gl-js/docs/API/classes/ImageSource/ ; commit `a9407d4`; https://github.com/wesleygrimes/omastorm (gates drawn as glyphs, 2026-09-04).
      Touches: `src-tauri/src/level2/render.rs` and `commands.rs` (a per-tile render that samples the polar field for a Web Mercator tile at any zoom, reusing `geo_to_polar`), a `sweep` URI scheme beside `mrms` in `src-tauri/src/lib.rs` and `tauri.conf.json` (`src/lib/csp.test.ts` holds the policy to what is registered), `src/hooks/useSingleSiteRadar.ts` and `MapViewport.tsx` (a raster tile source in place of the image source), the smoothing switch, the readout, and the export, which keep reading the gate.
      Acceptance: At zoom 12 over a storm the gate wedges are drawn as wedges rather than as blocks; a Playwright test renders the fixture volume at zooms 8 and 12 and finds edges at different pixel spacings; the readout, the cross-section and the CSV still read the nearest gate; the compare pane and the loop stay in step.
      Complexity: L

### P2

- [ ] AUD-385 (P2): A fragmented sweep still comes back folded, and the wind cannot help it
  Why: The reference-wind pass placed nothing at all on the five station-days it was written for. On those days the settled echo covers a sliver of the circle, no ring can be trusted, and `reference_wind` returns nothing, so every unreached patch keeps its fold: KTLX on 2026-09-04 came back with 26,425 of 26,486 broken pairs and 41 of 16,528 folded gates back on their own branch, exactly as it did before the pass existed. The reader on those afternoons is looking at a velocity cut with the folds still in it. This is `AUD-360`'s original acceptance, which the wind cannot meet on its own, and the legend now at least says so.
  Evidence: `recording_the_days_unfolding_is_held_against` over 2026-09-01 to 09-07, three variants on identical volumes, recorded 2026-09-07 evening. With no reference pass 0.6221 of the folded pairs stay broken, with the pass as first shipped 0.5391, with the plausibility bar it has now 0.5866; the five bad days are identical in the first and third. Settling those groups by their own boundary votes was tried the same evening, took the aggregate to 0.4710, and was reverted: it reads a velocity couplet as a fold, measured at a 40 m/s couplet coming back at -10, which `a_couplet_that_never_folded_is_not_read_as_a_fold` now holds down.
  Note: the shape that makes boundary evidence usable inside an isolated group is R2D2's (Feldmann et al. 2020, JTECH 37(12), 2341-2355): mark every gate whose difference from a neighbour exceeds 0.8 of the Nyquist velocity as shear, dilate that mark over a 5 by 5 window, exclude those gates from region placement entirely, and settle what is left. A couplet is then a buffer rather than a boundary, and the boundaries that remain are the ones worth voting on. R2D2 also runs top down through the tilts, each settled sweep guiding the one below, which is `AUD-192`.
  Touches: `src-tauri/src/dealias.rs` (a shear mark before `grow_regions`, carried through the traversal; the settling of unreached groups, which is currently deliberately absent and commented as such), `src-tauri/src/level2/decode_tests.rs` (the recorded figures), the couplet test as the thing that must stay green.
  Acceptance: WHEN a sweep fragments so that no ring can be trusted, THEN the dealiaser SHALL still take the folds out of each group of touching patches, AND a planted couplet of 40 m/s shear SHALL come back with its shear unchanged; the five station-days above each show a materially better figure than the ones recorded here; no recorded day gets worse; `invented` stays at zero.
  Complexity: L

### P3

- [ ] AUD-386 (P3): The unfolding generator never builds the shapes the reference pass acts on
  Why: `no_sweep_comes_out_more_discontinuous_than_it_went_in` runs 300 generated sweeps and is the property test standing behind the whole module, and almost none of them reach the code under test: 1,119 of 3,023,990 valid gates, 0.037 per cent, reach the reference vote at all. Its field is a smooth cosine plus symmetric noise, so unreached patches read alike, vote alike, and never build the two shapes that went wrong on 2026-09-07: a group of touching patches that disagree, and an isolated cell reported correctly whose velocity is far from the ambient wind. A mutation that reverted the vote to one patch at a time survived the entire suite.
  Evidence: measured on 2026-09-07 by a refutation pass; `src-tauri/src/dealias.rs` `generated_sweep` is byte-identical to `74cf9be`.
  Touches: `src-tauri/src/dealias.rs` (`generated_sweep`: seeds that plant an isolated patch at a velocity unrelated to the field, and a group of two or three touching patches straddling a fold edge), the property test's own assertions.
  Acceptance: over 300 seeds, at least one in ten sweeps holds a group of two or more touching unreached patches and at least one in ten holds an isolated correctly reported cell; reverting the vote to one patch at a time fails the suite; the existing bar still passes.
  Complexity: M

- [ ] AUD-387 (P3): The unplaced share describes the newer half of a composite and none of a cross-section
  Why: A live sweep is drawn as the volume in progress composited over the last finished one, and both halves go through the same unfolding. Only the newer half's report reaches the legend, so a reader looking at a composite whose older half is a third unplaced is told nothing about it. The cross-section drops the counts entirely and carries only whether anything was unfolded.
  Evidence: `src-tauri/src/level2/draw.rs` destructures `under: Prepared` and never reads `under.unfolding`; `src-tauri/src/level2/section.rs:132` keeps only `dealiased |= ... .moved > 0` and `CrossSection` carries no share.
  Touches: `src-tauri/src/level2/draw.rs` (take the larger of the two shares, or report them separately), `src-tauri/src/level2/section.rs` and `src/lib/crossSection.ts`, `src/panels/CrossSectionPanel.tsx`.
  Acceptance: a composite whose older half is largely unplaced says so; the cross-section panel says it too; both pinned by a test with a planted field.
  Complexity: S

- [ ] AUD-388 (P3): `misplaced` is aggregated where the damage is per station
  Why: The refold contract asserts only aggregates across six stations, and one station can be badly wrong inside a green run. On 2026-09-07 KFWS moved 2,247 gates that never folded onto a foreign branch while putting only 568 folded gates back, and the contract passed. A per-station relation between the two is the shape that would have caught it, and it is the measure that separates a wrong boundary vote from a wrong wind placement.
  Evidence: the live run of `unfolding_a_live_velocity_sweep_takes_the_folds_out` on 2026-09-07 evening; `src-tauri/src/level2/decode_tests.rs`, where `misplaced` is printed and not asserted, with the reasoning for that written in.
  Touches: `src-tauri/src/level2/decode_tests.rs` (a per-station bound recorded from a week rather than an afternoon, in the way the two aggregate lines already are), `src-tauri/src/level2/testing.rs` if the measure needs splitting into gates the boundary placed and gates the wind placed.
  Acceptance: a per-station line that the recorded week clears with room and that fails when the wind's plausibility bar is removed; the recorder prints whatever the line is drawn against.
  Complexity: M

- [ ] AUD-361 (P3): Convert the 30 hand-rolled `open` guards to `useLatestReply`
      Why: `useLatestReply` exists so one tested helper answers "is this run still the current one", and 30 effects across 16 files still answer it with `let open = true` and a cleanup that sets it false. Every one is correct as written, which is why this is a conversion and not a fix, but the gate that was supposed to stop new ones was blind to `open` for two days while calling itself complete. The list is the second time that has happened, after `mounted`.
      Evidence: `src/hooks/useLatestReply.test.ts` holds the 16 files in `outstanding`, with the ratchet that fails if a converted file stays on the list or an unconverted file leaves it. `src/hooks/useWind.ts:40-72` is the shape: `let open = true`, three `if (!open) return` guards, `open = false` in the cleanup.
      Touches: the 16 files named in `outstanding`, and that list itself, which shrinks with each one.
      Acceptance: WHEN an effect in one of those files needs to know whether its run is still current, it SHALL ask `useLatestReply` rather than a local boolean, with one token per effect; the file leaves `outstanding` in the same commit, and the scan stays green in both directions. `src/App.tsx` keeps its exemption for the listener handle, which is a different thing and stays.
      Complexity: M

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

- [ ] AUD-370 (P3): The bundle-budget and unused-exports gates have no tests of their own
      Category: testing
      Where: `scripts/bundle-budget.mjs` and `scripts/unused-exports.mjs` (0 per cent coverage in the `npm run check` run of 2026-09-07); `scripts/release-lib.test.mjs`, `live-contracts-lib.test.mjs` and `hurdat-parse.test.mjs` are the pattern for the scripts that do have tests.
      Problem: These two are what stop a chunk growing past its written budget and an export going unused, and neither has ever been shown to fail. The bundle gate has already been the thing that caught a settings chunk over budget (`AUD-272`'s note), so it matters, and a comparison that reads `>=` where it should read `>` would pass forever.
      Evidence: The coverage table in the baseline run: `bundle-budget.mjs 0 | 0 | 0 | 0 | 21-283`, `unused-exports.mjs 0 | 0 | 0 | 0 | 38-166`; no `scripts/bundle-budget.test.mjs` or `scripts/unused-exports.test.mjs` exists.
      Fix: Split each into a lib module the way `release.mjs` and `release-lib.mjs` are split, and pin: a chunk one kilobyte over its budget fails, at the budget passes, a chunk named in the budget and missing from `dist/` fails, the first-load row sums the right chunks; an export with no importer is reported, one imported only by its own file is counted in that bucket, a re-export is followed.
      Acceptance: Both scripts are covered above zero; each new test fails when the comparison it pins is flipped.
      Confidence: Verified
      Effort: S

- [ ] AUD-389 (P3): `data-over-light` describes the basemap that was chosen, not the one being drawn
  Why: An incident pack replaces the basemap with its own tiles, and the flag that tells the map's own chrome which ground it sits on is computed from `settings.mapStyle`. A reader with a pack open therefore gets the attribution, the watermark and the readout dressed for the style they picked rather than for the tiles under them. Measured at 8.4:1 either way on the packs shipped today, so it is a rule that does not describe what it claims rather than something a reader can see.
  Evidence: `src/hooks/useAppearance.ts` reads `resolvedMapStyle(settings.mapStyle, settings.theme)`; `src/components/MapViewport.tsx` builds the drawn style with `mapStyleDefinition(mapStyle, incidentPack)`. A refutation pass composited both cases on 2026-09-07 and found no readability failure. The same pass found the comment at `src/index.css` claiming "the light theme always draws a light basemap", which Aerial and Radar Dark disprove.
  Touches: `src/hooks/useAppearance.ts` (take the flag from whatever the viewport actually draws, or move it to where the style is resolved), `src/index.css` (the claim in the comment), `e2e/theme.spec.ts` (a pack case).
  Acceptance: With an incident pack open, the flag matches the tiles being drawn; the comment says what is true; a test covers a dark basemap under the light theme.
  Complexity: S

- [ ] AUD-390 (P3): Only one of the three map-surface rules has a test
  Why: `AUD-363` gave `.source-attribution`, `.map-watermark` and `.map-readout` the same treatment and `readableOnTheMap` is parameterised to check any of them, but it is only ever called with the attribution. The other two carry their own pills, which is why they survived the defect, and nothing holds them to it.
  Evidence: `e2e/theme.spec.ts`, where `readableOnTheMap(page, selector)` takes a selector and is called twice with the same one.
  Touches: `e2e/theme.spec.ts`.
  Acceptance: All three are checked in both the light theme and the dark theme over a light basemap; removing any one of the three CSS selectors fails the spec.
  Complexity: S

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

- [ ] AUD-379 (P2): Hold the unfolded velocity against the radar's own dealiased product, gate for gate
  Why: The refold contract and the recorder measure differences between neighbours (`broken_pairs`), branch recovery of gates that wrapped (`wrapped`, `rejoined`) and non-whole moves (`invented`), and `AUD-362` showed all three are blind to a whole patch moving. Every operational dealiaser in the literature is scored per gate against a reference, and the reference is free: the RPG runs its own two-dimensional dealiaser and publishes the result as the super-resolution digital base velocity product (154, `N0G` at the lowest cut), 0.25 km by 0.5 degrees, the same geometry as the Level II cut the app unfolds, on a bucket already in the ledger.
  Evidence: `https://unidata-nexrad-level3.s3.amazonaws.com/?list-type=2&prefix=TLX_N0G_2026_09_07` (objects present, `TLX_N0G_2026_09_07_00_04_08` among them; `N1G`, `N2G`, `N3G`, `NAG` and `NBG` beside it); `src-tauri/src/level3.rs:1204` (`keys_for_day`) and `:1487` (the radial decoder used for `N0H` and `HHC`, the same packet type); `src-tauri/src/level2/testing.rs:660-790` (the three measures); Zittel and Jing (ROC) put the 2DVDA's error rate at 0.85 per cent on Irene against 11.98 for the legacy VDA; Veillette et al. 2023 used ORPG output as the truth for a learned dealiaser; BowEcho's bench doc on the boundary-pair measure: "NEVER read alone (a consistently wrong field scores ~0)". Sources in RESEARCH.md of 2026-09-07 (evening).
  Touches: `src-tauri/src/level3.rs` (decode product 154 at a named cut and time, with the resolution and the Nyquist velocity from the product description block), `src-tauri/src/level2/testing.rs` (a `disagreed_with_rpg` measure: gates the app placed more than half a Nyquist velocity from the RPG's reading, counted over the gates both hold and both consider valid), `src-tauri/src/level2/decode_tests.rs` (the contract asserts the share under a floor written in from the first run, and the recorder prints it per station-day beside the existing columns), `scripts/live-contracts-lib.mjs` (the skip list if the recorder grows a second entry).
  Acceptance: WHEN the refold contract runs, THEN for each station it also fetches the RPG's `N0G` nearest the volume time and asserts that the share of gates disagreeing with the RPG by a whole interval is below the floor written into the test; the recorder prints the share for the 39 station-days; probe C from `AUD-362` (a correctly reported isolated cell) is caught by the measure on the fixture with a planted reference, asserted in a unit test; `npm run check:live` green.
  Complexity: M

### P3

- [ ] AUD-380 (P3): The advisory gates match crate names as spelled, and one advisory in the tree is spelled the other way
  Why: `SECURITY.md` says `cargo audit` reports known advisories in what ships. `Cargo.lock` carries `block-buffer 0.10.4`, and GHSA-qwgh-2vcv-g2f7 (2026-08-19, medium: "A caught panic may leave the cursor position of `EagerBuffer` or `ReadBuffer` in a corrupted state; this in turn allows out-of-bounds reads/writes", fixed in 0.12.1) names the package `block_buffer` with an underscore, which crates.io treats as the same name. RustSec has no entry, and `grype` with a database built 2026-09-07 and `osv-scanner` both report clean because neither normalises the spelling. The path is not reachable here (it needs a panic caught inside a hash update, and the tree's one `catch_unwind` wraps the NetCDF read in `lightning.rs`), so the finding is the gate, not the crate.
  Evidence: `https://api.osv.dev/v1/vulns/GHSA-qwgh-2vcv-g2f7` (`crates.io block_buffer`, introduced 0, fixed 0.12.1); `cargo tree -i block-buffer` on 2026-09-07 (`block-buffer 0.10.4` under `digest 0.10.7` under `sha2 0.10.9`, required by `openradar`, `nexrad-decode`, `nexrad-model` and `tauri-codegen`); `src-tauri/Cargo.toml` (`sha2 = "0.10.9"`); the three clean scanner runs of 2026-09-07; `SECURITY.md`, "What is already checked here".
  Touches: a `scripts/advisories.mjs` that reads `Cargo.lock`, asks `api.osv.dev/v1/querybatch` for every crate under both spellings and fails on any hit not listed with a reason in an allowance file beside `src-tauri/.cargo/audit.toml`; `SECURITY.md` (name the third scanner and the spelling rule); `src-tauri/Cargo.toml` (`sha2` to 0.11 for the app's own hashing in `incident_packs.rs` and `bundles.rs`, with the resolved `block-buffer` checked to be 0.12.1 or later; the 0.10 line stays in the lock through `nexrad-*` and `tauri-codegen` and becomes the documented allowance); `scripts/release.mjs` if the gate joins the release checklist.
  Acceptance: The new gate reports GHSA-qwgh-2vcv-g2f7 against the current lock and passes once the allowance names it with the reachability note; planting `lru` without its allowance fails it; `SECURITY.md` describes the gate; `cargo test --lib` green after the `sha2` bump.
  Complexity: S

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

## Verification Findings, 2026-09-07

Raised by an adversarial review of `293424c..f027953` instructed to refute rather than confirm. Every one is a defect in this session's own work or in a claim it made.

### P1

- [ ] AUD-391 (P1): The layering gate cannot detect the import ring it was written to stop
      Category: correctness
      Where: `src/lib/layering.test.ts:47-59` (`valueImports`), used by both rules at `:70-79` and `:81-96`.
      Problem: The regex is `/^\s*(?:import|export)\s+([\s\S]*?)from\s+"([^"]+)"/gm`, and the rule then filters specifiers against `^\./(providers|overlays)/`. Seven shapes that close the exact ring the test's own docblock describes are not seen at all: a side-effect `import "./overlays/spc";` (no `from`), `await import("./overlays/spc")`, single-quoted specifiers, a second `import` on the same line as a first, and a barrel `import { OVERLAY_ADAPTERS } from "./overlays"` with no trailing slash. The barrel is the damaging one: `src/lib/overlays/index.ts:1` imports `./alerts`, which imports `../tileCache`, which imports `./settings`, so that one line reintroduces the ring with the gate green. Rule two misses `../hooks/useClock` written as a side-effect import and any barrel import of `../hooks`. It also has false positives in the safe direction: `import { type A } from "x"` is erased by the compiler but flagged, and three such clauses already live in the tree (`src/lib/overlays/metar.ts`, `rivers.ts`, `smoke.ts`).
      Evidence: Harness run against the verbatim regex on 2026-09-07; each of the seven inputs above returned no violation. `src/lib/overlays/index.ts:1`.
      Fix: Read the imports with the TypeScript compiler rather than a regex, which is already a dependency: walk each source file's statements for `ImportDeclaration`, `ExportDeclaration` and dynamic `import()` calls, skip a declaration whose `importClause.isTypeOnly` is set and named bindings that are individually type-only, and resolve the specifier to a file so a barrel is followed rather than matched by spelling. Then state both rules against the resolved graph: `settings.ts` must not reach `providers/` or `overlays/`, and nothing under `lib/` may reach `hooks/`, `panels/` or `components/`.
      Acceptance: Each of the seven shapes above, planted one at a time, fails the gate; the three existing `{ type A }` clauses do not; a barrel import of `./overlays` in `settings.ts` fails; `npm run check` green.
      Confidence: Verified
      Effort: M

- [ ] AUD-392 (P1): `settings.ts` is still inside a runtime import cycle, which AUD-375 said it had left
      Category: correctness
      Where: `src/lib/settings.ts:4` and `src/lib/level2.ts:1`; `src/lib/settings.ts:76` through `watch.ts:6`, `overlays/alerts.ts:8`, `tileCache.ts:14`; `src/lib/settings.ts:29` through `approach.ts:2`, `cells.ts:1`.
      Problem: Tarjan over the value-import graph of `src/` finds exactly one cyclic component with the same 24 members before AUD-375 and after it, `settings.ts` included. The commit removed one edge, `settings.ts` to `overlays/spc.ts`, and the ring it names in its own message, "settings imports the adapter, the adapter imports the tile cache, the tile cache imports settings", is still closed one hop longer through `watch.ts`. There is also a plain two-cycle with `level2.ts`. The runtime hazard the commit describes is unchanged: it still works only because nothing in the ring reads a half-initialised module during evaluation, which is a property of the order the bundler happens to choose.
      Evidence: Module graph built with the TypeScript parser on 2026-09-07, value edges only, run against both `5030b1e` and `f027953`: one cyclic component, 24 members, identical membership.
      Fix: Take the three named edges out of `settings.ts`. `isLevel2Product` and its neighbours move to a leaf beside `spcHazards.ts` and `satelliteBands.ts`; the same for whatever `settings.ts:29` and `:76` reach into `approach.ts` and `watch.ts`. Then hold the whole graph rather than three spellings: the gate from AUD-391 gains a third rule that finds no cycle containing `settings.ts`.
      Acceptance: The cycle finder reports no cyclic component containing `src/lib/settings.ts`; putting any one of the three removed edges back fails the gate; `npm run check` green.
      Confidence: Verified
      Effort: M

### P2

- [ ] AUD-393 (P2): The generator's backslash test contains no backslash
      Category: testing
      Where: `scripts/build-radar-sites.test.mjs:128-142` (`roundTrip("Back\slash")`).
      Problem: In JavaScript `"Back\slash"` is `"Backslash"`, nine characters with no backslash in them, because `\s` is not an escape and the backslash is dropped. The test that was written to pin the escaping fix therefore feeds it a string it could never have broken. Weakening `unescaped()` back to handling quotes only, which restores the exact doubling bug the commit says it fixed, leaves all three tests passing while a real backslash in a city name doubles on every regeneration: `Back\slash` becomes `Back\\slash`, then `Back\\\\slash`.
      Evidence: `node -e 'console.log("Back\slash".length)'` prints 9 on 2026-09-07. Mutation run with `unescaped()` weakened: three tests passed, the name drifted on each of three runs.
      Fix: `roundTrip("Back\\slash")`.
      Acceptance: With `unescaped()` weakened to quotes only the test fails; with it whole the test passes and a regenerated table is byte-identical.
      Confidence: Verified
      Effort: S

- [ ] AUD-394 (P2): The two export extensions can be swapped with nothing failing
      Category: testing
      Where: `src-tauri/src/data_export.rs:59` (`const EXTENSIONS: &[&str] = &["csv", "tif"]`), read as `EXTENSIONS[0]` at `:511` and `EXTENSIONS[1]` at `:677`.
      Problem: The test added with the constant iterates the array and is order-agnostic, and the two tests that do pin extensions pass `"csv"` and `"tif"` as literals rather than through the constant. Swapping the array's two entries makes every CSV export write a `.tif` and every GeoTIFF export write a `.csv`, and the suite stays green.
      Evidence: Mutation run on 2026-09-07 with `&["tif", "csv"]`: `cargo test --lib` 483 passed, 0 failed.
      Fix: Name them rather than index them: two consts, `CSV_EXTENSION` and `GEOTIFF_EXTENSION`, with the allowlist check iterating both. The call sites then say which they mean.
      Acceptance: Swapping the two values fails a test; `cargo test --lib` green.
      Confidence: Verified
      Effort: S

- [ ] AUD-395 (P2): A dead branch in the bundle validator, with a comment saying why it is not dead
      Category: correctness
      Where: `src-tauri/src/bundles.rs:405-409`, inside `addresses`.
      Problem: `addresses` calls `validate(request)?` at `:380`, after which tiles are at most `MAX_TILES` (`:393`) and extra URLs at most `MAX_EXTRA_URLS` (`:372`), so `urls.len() > MAX_TILES + MAX_EXTRA_URLS` cannot hold. The comment says "the two are reached by different callers", which is not true: `addresses` is the only entry and it calls `validate` itself. The new test proves the branch is unreachable rather than covering it, because it matches `TooManyDocuments`, which only `validate` produces, while the dead branch returns `TooManyTiles`.
      Evidence: Deleting `:405-409` on 2026-09-07: `cargo test --lib` 483 passed, 0 failed.
      Fix: Delete the branch and the comment. If the belt-and-braces check is wanted, make it a `debug_assert!` so it says it is an invariant rather than a code path.
      Acceptance: `cargo test --lib` green with the branch gone; `cargo clippy --all-targets` clean.
      Confidence: Verified
      Effort: S

- [ ] AUD-396 (P2): A corrupt KMZ still reports the browser engine's empty error
      Category: correctness
      Where: `src/lib/kmz.ts:79-115` (`inflate`), surfaced by `src/hooks/useWorkspaceActions.ts:388`.
      Problem: AUD-366 closed the directory-name case, which is the rarer one. Compression method 8 is what virtually every real KMZ uses, and `inflate` catches nothing around `DecompressionStream`. Three ordinary corruptions each throw `TypeError` with an empty message: bytes that are not deflate, a stream truncated by two bytes, and a deflate entry with zero compressed bytes. The reader sees "Overlay could not be added" with nothing after it, because the handler falls through to `failure.message` and that is the empty string. `kmz.tooBigUnpacked` and `kmz.truncated` exist in the catalogue and neither is reached.
      Evidence: Probe against the bundled module on 2026-09-07: all three cases threw `TypeError: ""`. Same at `5030b1e`, so it is not a regression.
      Fix: Wrap the decompression and turn anything thrown into the catalogue's own sentence, the way the directory read already does.
      Acceptance: Each of the three corruptions raises the catalogue sentence rather than an empty message; a good KMZ is unaffected; the three cases are pinned in `src/lib/kmz.test.ts`.
      Confidence: Verified
      Effort: S

### P3

- [ ] AUD-397 (P3): The new KMZ bound is stricter than the read it guards
      Category: correctness
      Where: `src/lib/kmz.ts:61`.
      Problem: The check is `at + 46 + nameLength + extraLength + commentLength > byteLength`, but the read it guards, at `:64-66`, only needs `at + 46 + nameLength`, and the advance of `at` is already guarded by the `at + 46 > byteLength` break at `:49`. So an archive whose last entry carries a bogus comment length, with the name intact, was read before and is refused now.
      Evidence: Probe on 2026-09-07, last entry with `commentLength` `0xffff`: `5030b1e` returns `<kml/>`, `f027953` throws "That archive is cut short."
      Fix: Bound the name read at `at + 46 + nameLength`, and check the full advance separately where `at` is advanced.
      Acceptance: The bogus-comment archive reads again; a name longer than the file still refuses with the catalogue sentence; both pinned.
      Confidence: Verified
      Effort: S

- [ ] AUD-398 (P3): `normalizePalette` quietly stopped reporting two kinds of skipped field
      Category: correctness
      Where: `src/lib/settings.ts`, `normalizePalette` after AUD-370's rewrite through `writePalette`.
      Problem: A differential run against the previous implementation over 33 hostile inputs differs on eight. A `product` or `units` that is not a string, `5`, `true`, `["BR"]`, `{}`, used to be kept stringified and reported in `skipped`; it is now dropped and `skipped` comes back empty, so the panel says nothing was skipped when something was. Separately, `solid: true` with a valid `toColor` used to keep the second colour and clear the flag, and now keeps the flag and drops the colour; that one is documented and intended, but it silently discards a stored value.
      Evidence: Differential harness on 2026-09-07 driving both implementations through the real `parsePalette` and `writePalette`; 8 of 33 differ, listed above. No difference on the other 25, which include the value, colour, step, name, stops and injection cases.
      Fix: Report a non-string `product` or `units` in `skipped` the way the old code did, whether or not it is kept.
      Acceptance: Each of the six non-string cases reports its field in `skipped`; the 25 agreeing cases still agree; `npm run check` green.
      Confidence: Verified
      Effort: S

- [ ] AUD-399 (P3): The palette round-trip test passes on a fixture that hides what it claims to check
      Category: testing
      Where: `src/lib/palette.test.ts`, "comes back the way it went in"; `src/lib/palette.ts:103`, `:114`, `:167`.
      Problem: `parsePalette` recomputes `skipped` from whether a `Product:` or `Step:` line is present rather than reading it back, so `skipped` does not round-trip. The test survives only because its fixture happens to set both. A stored `skipped` of `["color4 alpha", "product", "step"]` comes back as `["product", "step"]`, and a palette with `product: null, step: null, skipped: ["product", "step"]` comes back with `skipped` empty.
      Evidence: Measured on 2026-09-07 against both cases. Same behaviour before this session's changes.
      Fix: Either carry `skipped` through the written form so it round-trips, or say in the test's name and its docblock that `skipped` is recomputed rather than restored, and add a case that pins the recomputation.
      Acceptance: The test fails if the fixture drops its `Product:` line while claiming `skipped: ["product"]` survives; the recomputation is pinned by name.
      Confidence: Verified
      Effort: S

- [ ] AUD-400 (P3): Two media queries written twice after the consolidation that was meant to end that
      Category: correctness
      Where: `src/hooks/useClock.ts:84` (`REDUCED_MOTION`) and `:133` (`MORE_CONTRAST`) against `src/lib/displayPreference.ts:15-16` (`MORE_CONTRAST`, `LESS_MOTION`).
      Problem: AUD-375 moved the getters into a leaf module and left the subscriptions reading their own copies of the same two query strings. They are character-identical today. If one moves, `useReducedMotion()` subscribes to one query and reads another, and stops re-rendering when the preference changes, which is the failure that is hardest to notice. The `typeof window === "undefined"` guard added to the leaf was also not applied to `subscribeMedia` at `:112` or `forcedColoursActive` at `:163`.
      Evidence: Read on 2026-09-07 at `f027953`.
      Fix: Export the two query strings from `displayPreference.ts` and have `useClock.ts` subscribe with those; carry the guard to both remaining readers.
      Acceptance: `grep` finds each query string written once in `src/`; a test drives the subscription and the getter from the same constant; `npm run check` green.
      Confidence: Verified
      Effort: S

- [ ] AUD-401 (P3): Two comments that say something the code does not do
      Category: documentation
      Where: `src/lib/displayPreference.ts:9`; `src-tauri/src/level3.rs:2766`.
      Problem: The first says "two modules under `lib/` want the answer" and exactly one does, `src/lib/overlays/alerts.ts:17`. The second says the URL is built "the same shape in `mrms.rs` and `hrrr.rs`"; `mrms.rs:2736` is that shape, but `hrrr.rs` splices no listing key at all, since its only URL at `:567` is built entirely from integers.
      Evidence: Read on 2026-09-07 at `f027953`.
      Fix: Say what is true in both.
      Acceptance: Both comments match the code they sit on.
      Confidence: Verified
      Effort: S

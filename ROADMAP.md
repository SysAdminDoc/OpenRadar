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
- [ ] AUD-187 (P3): Scan the staged installer with Defender in the release gate
  Why: HookEcho and BowEcho, both unsigned Rust desktop apps, were flagged `Win32/Wacapew.A!ml` and publish false-positive FAQs; nothing here would know before a reader did.
  Evidence: r/stormchasing HookEcho thread (2026-08); BowEcho README FAQ; `scripts/release.mjs` verifies the signature and hashes but never scans.
  Touches: `scripts/release.mjs` (`MpCmdRun.exe -Scan -ScanType 3 -File <installer>` when present), `release-metadata.json` (the verdict and engine version), README install section (what to do if Defender objects).
  Acceptance: A release run records the Defender verdict beside the hashes and refuses to publish on a detection; when Defender is absent the step is reported skipped, not passed.
  Complexity: S

- [ ] AUD-188 (P3): Use the chunk timing projection for the live sweep
  Why: `chunks.rs` treats the live stream as an eleven-second cadence and detects a stall by silence; the pinned `nexrad-data` release carries a physics-based projection of when each remaining chunk and the next volume will land.
  Evidence: docs.rs `nexrad_data::aws::realtime` (rc.7): `project_scan_timing`, `project_full_scan_timing`, `estimate_chunk_availability_time`, `ChunkTimingModel`, `ElevationChunkMapper`; `src-tauri/src/chunks.rs` has no reference to them.
  Touches: `src-tauri/src/chunks.rs`, the live legend in `WorkspaceChrome.tsx` ("next piece due in 8 s", "this volume finishes at 21:42"), diagnostics.
  Acceptance: The live legend states when the next chunk is expected and when the volume will complete, from the projection; a stall is declared when a chunk is late by more than the model's tolerance rather than by a fixed timeout; the ring-position logic is unchanged and its tests still pass.
  Complexity: S

- [ ] AUD-189 (P3): Azimuthal shear from the volume itself, with a rotation product and a debris flag
  Why: MRMS AzShear is a 2-minute national grid; the same LLSD method on the held site's own dealiased velocity gives rotation at gate resolution seconds after the sweep, which is what GR2Analyst's NROT is and what no open-source app ships; a tornado debris flag needs it.
  Evidence: Mahalik et al. 2019 (NOAA IR PDF): 2500 m azimuthal by 750 m radial kernel, radial count adapted per range, cap 51 radials, minimum 3x3, 3x3 median pre-filter, mask to reflectivity at or above 20 dBZ; WDTD thresholds; the RLX NROT deck (5x5 fit, range-normalised, above 1.0 significant, above 2.5 extreme); PyMeso as a reference implementation; TDS criteria (correlation coefficient below 0.8, ZDR below 0.5 dB, reflectivity above 30 dBZ, collocated with strong shear).
  Touches: new `src-tauri/src/shear.rs`, `level2.rs` product table (`azimuthal-shear`, `rotation`), ramps with the colour-vision test, `RadarProductPanel.tsx`, legends and catalogues, `data_export.rs` (`derivation` records the kernel).
  Acceptance: An azimuthal shear product draws for any Doppler cut with the kernel documented in the legend; a normalised rotation product follows the NROT range curve; a debris flag marks gates meeting the four criteria within two kilometres of shear at or above 0.006 s⁻¹ and is labelled as a signature, not a confirmation; a planted couplet in the fixture volume produces the expected shear magnitude in a test.
  Complexity: M

- [ ] AUD-190 (P3): Single-site vertical products: composite, echo tops, VIL and hail size from the volume
  Why: GR2Analyst ships ET, VIL, VILD, POSH and MEHS from the volume and readers compare them against MRMS; the app has the MRMS grids and the sounding heights the hail algorithm needs, but nothing derived from the site.
  Evidence: ROC algorithm descriptions (echo tops NX-DR-03-013, VIL NX-DR-03-006 with the 56 dBZ ice cap), WDTD SHI/POSH/MESH pages (Witt et al. 1998: ramp 40 to 50 dBZ, weights between the 0 °C and −20 °C heights, POSH = 29 ln(SHI/WT) + 50, MESH = 2.54·SHI^0.5), the Skew-T in `src/lib/sounding.ts` already supplying those heights.
  Touches: new `src-tauri/src/derive.rs`, `level2.rs` product table, `src/lib/sounding.ts` (expose the freezing levels to the native side), legends, ramps, catalogues, `data_export.rs`.
  Acceptance: Composite reflectivity, 18.5 dBZ echo top (interpolated between cuts), VIL, VIL density and MESH draw for a held site on a 1 km grid; MESH names the sounding it took its heights from and falls back to stated defaults when none is loaded; a fixture volume with a known column produces known values in tests.
  Complexity: M

- [ ] AUD-191 (P3): Specific differential phase from the volume's differential phase
  Why: KDP is the dual-pol field that locates heavy rain and the KDP foot, it exists only as a Level III product, and the raw differential phase is already in the decoded volume.
  Evidence: `src-tauri/src/level2.rs:326-345` has no KDP; Vulpiani et al. 2012 iterative finite-difference method (Py-ART `kdp_vulpiani`, wradlib `kdp_from_phidp`) with unfolding and a correlation-coefficient censor at 0.9.
  Touches: `src-tauri/src/level2.rs` (or `derive.rs`), product table, ramp, legend, catalogues, `data_export.rs` (`derivation` names the method and window).
  Acceptance: A KDP product draws in degrees per kilometre from the volume's PHI with the method in the legend; gates with correlation below 0.9 are censored; a synthetic ramp in PHI produces the expected constant KDP in a test.
  Complexity: M

- [ ] AUD-192 (P3): Continuity across tilts in the dealiaser
  Why: The region method fixes a sweep only up to a whole Nyquist interval and can flip a whole region in strong shear; UNRAVEL's 3D pass uses the cut above and below to settle the interval, at modest cost on top of the existing core.
  Evidence: `src-tauri/src/dealias.rs` (region growing, largest patch keeps its reading); Louf et al. 2020 (JTECH) and the MIT numba implementation at `vlouf/dealias`; the live multi-site test in `level2.rs` that measures refold recovery.
  Touches: `src-tauri/src/dealias.rs` (a pass that votes a cut's interval against its neighbours in elevation), `level2.rs` (hand adjacent cuts to the unfolder), the live aggregate test.
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

- [ ] AUD-199 (P3): An ARM64 Windows build
  Why: Arm was 15.3% of client CPUs in Q2 2026 and Snapdragon X laptops are the second-monitor machines this app is meant to sit on; Tauri builds `aarch64-pc-windows-msvc` with NSIS today and BowEcho already ships it.
  Evidence: Tauri Windows installer docs (aarch64 NSIS supported, MSI not; needs the VS "C++ ARM64 build tools"); BowEcho README; Mercury Research via The Register (2026-08-21).
  Touches: `scripts/release.mjs` (a second target and asset name `OpenRadar_<version>_arm64-setup.exe`), `latest.json` platforms (`windows-aarch64`), `README.md` asset table, `docs/listings.json`, `SHA256SUMS`.
  Acceptance: The release stages an ARM64 installer with its own updater signature and `latest.json` entry; the asset-name promise in the README lists it; a Defender scan (AUD-187) covers both; a launch on ARM hardware is recorded in the working notes or the badge stays x64.
  Complexity: M
  Note 2026-09-04: Verified 2026-09-04 in the Tauri bundler source: NSIS maps `aarch64` to `arm64` and the updater accepts a `windows-aarch64` target, so `--target aarch64-pc-windows-msvc` works today without a Tauri change.
- [ ] AUD-200 (P3): Re-capture the README screenshot
  Why: `assets/screenshots/openradar-main.png` is from 2026-08-31 and predates the light-theme repairs, French, the rail rework, the dark form controls and the accent changes described in the 0.8.0 changelog; a stale picture misleads the first reader.
  Evidence: `git log -1 -- assets/screenshots` (2026-08-31, "Rebuild the weather workspace around the map"); `CHANGELOG.md` 0.8.0 visual entries.
  Touches: `assets/screenshots/openradar-main.png`, `README.md` alt text, `docs/listings.json` screenshot reference.
  Acceptance: A fresh 1487x1058 capture of the dark workspace with Alerts open, taken headless per `screenshots.md`, replaces the file in the same commit as the next visual change; the alt text names the state.
  Complexity: S

## Research-Driven Additions, 2026-09-03

Added by the 2026-09-03 research pass (`RESEARCH.md` of the same date carries the evidence). Numbered `AUD-206` onward. Every host named below is either already in `ALLOWED_HOSTS` or is named in the item, and any new one needs the ledger row, the CSP entry and a `check:live` contract like the rest. Nothing here outranks an open audit item of the same priority.

### P1

### P2

- [ ] AUD-218 (P2): MRMS reflectivity, correlation and differential reflectivity at a chosen height
  Why: The composite is the column's maximum; a reader who wants the picture at 3 km or the ZDR column at 6 km has nothing, and the bucket carries the merged 3D cube at 33 heights for reflectivity, RhoHV and ZDR in the packing already decoded; HookEcho draws CAPPIs from single volumes, and a national one at 1 km would be the first in the field.
  Evidence: Verified 2026-09-03 from the CONUS prefix listing: `MergedReflectivityQC_00.50` … `_19.00`, `MergedRhoHV_00.50` … `_19.00`, `MergedZdr_00.50` … `_19.00` (33 levels each); the fold and table machinery in `src-tauri/src/mrms.rs:1055-1218`; https://github.com/d4vid87/hookecho (CAPPI).
  Touches: `src-tauri/src/mrms.rs` (a level parameter on a product family rather than 99 table rows; the cache slot rule counts one per family), `src/lib/providers/mrms.ts`, `src/panels/RadarProductPanel.tsx` (a height slider in the reader's units), legends (height named), `src/i18n/*`, `every_product_decodes` sampling three levels per family.
  Acceptance: A national reflectivity picture at any of the 33 heights draws under the same ramp, with RhoHV and ZDR selectable at the same height; the slider names the height in the reader's units; the cache counts one slot for the family; the live test decodes 0.5, 3.0 and 10.0 km for each field.
  Complexity: M

### P3
  Note 2026-09-04: The cited line range is stale (the products table now ends past 1090). The switch-group shape from `AUD-217` (`lightningGrids.ts`, `productFor`, the two `EVERY_CHOICE` fixtures) is the pattern; a level parameter on a family should replace rows, and `EVERY_CHOICE` must cross the level or the family is checked by nothing.
- [ ] AUD-233 (P3): The finer MRMS grids at their own resolution, on demand
  Why: `AUD-175` shipped merged azimuthal shear, which MRMS publishes at 0.005 degrees, and it draws folded by two to the 0.01 degree grid the rest of the app uses. That is a deliberate memory decision from commit `9fcfc11` and not an oversight: one unfolded grid is 196 MB against 49, the cache budget is 768 MB, and `CACHE_CAPACITY > LAYERS_AT_ONCE` stops holding. It also means the item's own acceptance line, "at full 0.005 degree resolution", was not met, and the detail is real: a shear couplet is a few hundred metres across.
  Evidence: `src-tauri/src/mrms.rs` `MAX_SOURCE_REDUCTION`, `GRID_BYTES`, `CACHE_BUDGET_BYTES` and the two const assertions beneath them; `mrms::tests::a_finer_grid_is_folded_and_costs_what_a_coarse_one_does` measures the fold and its cost (330 ms to decode, 3.9 ms a tile on 2026-09-03).
  Touches: `src-tauri/src/mrms.rs` (a per-product reduction rather than one for the table, and a cache that budgets by bytes held rather than by slots of a fixed size), the cache tests.
  Acceptance: With a reader zoomed past the point the fold is visible, the shear grids draw unfolded, and a screen with eight layers on still never evicts a grid it is about to want; the budget is measured in bytes and the const assertions still hold.
  Complexity: M

- [ ] AUD-234 (P3): A legend for the overlay layers
  Why: `AUD-176` asked for the excessive rainfall outlook to carry its issue and valid time "in the popup and legend". The popup does. There is no legend to put it in: the two legend surfaces in the app are the radar ramp (`MapChrome.tsx`) and the satellite chip (`MapStage.tsx`), and neither knows an overlay exists. Every overlay with bands the reader has to interpret has the same gap, the SPC outlook and the storm surge ramp included, and a reader with three of them on has three sets of colours and nothing naming any of them.
  Evidence: `grep -rn "legend" src/components` finds `radar-legend` and `satellite-chip__legend` only; `src/lib/legend.ts` is the radar ramp; the WPC popup lines are `wpc.validWindow` and `wpc.issued` in `src/lib/overlays/wpc.ts`.
  Touches: a legend surface fed from the overlay adapters (each already knows its own bands and colours), `src/lib/overlays/registry.ts` for what an adapter says about its own key, `src/components/MapChrome.tsx` or a surface of its own, `src/i18n/*`, the layer-stack and clipping tests.
  Acceptance: With an overlay on that has bands, the map carries a key naming them in the reader’s language and in the service’s own colours, with the issue and valid time for the ones that are forecasts; it is off the export unless the reader asked for it; the pseudolocale clipping test covers it.
  Complexity: M

- [ ] AUD-219 (P3): Split `level2.rs` before the derived products land
  Why: The file is 6,467 lines and four open items (`AUD-189`, `AUD-190`, `AUD-191`, `AUD-192`) all land in it; a split into listing, decode, render, loop and status modules costs nothing now and a great deal after.
  Evidence: `wc -l src-tauri/src/level2.rs` (6,467 on 2026-09-03, up from 6,328 on 2026-09-02); the 2026-09-02 research assessment said the split should precede the derived products and no item carried it.
  Touches: `src-tauri/src/level2/{mod,listing,decode,render,loop,status}.rs`, `src-tauri/src/lib.rs` paths, tests move with their code, the working notes' architecture line, `docs/architecture.md`.
  Acceptance: No file under `level2/` exceeds 2,000 lines; `cargo test` passes the same count; clippy is clean; the four derived-product items name their target module.
  Complexity: M
  Note 2026-09-04: `level2.rs` is 7,019 lines on 2026-09-04 (+552 in one day, with `level2_vwp` beside `level2_cross_section`); `mrms.rs` is 4,467. See also `AUD-272` for the four hottest frontend files, which have no split item.
- [ ] AUD-220 (P3): Tests for the twelve panels that have none
  Why: Coverage floors are 63/56/57/64 and the panels are most of what is missing; twelve panels have no sibling test, so their empty, loading and error states are held only by e2e specs that stub the world.
  Evidence: `src/panels/` listing against `*.test.tsx` on 2026-09-03: CuriositySection, ExportPanel, GuidancePanel, IncidentPackManager, JournalSection, MapOptionsPanels, RecapSection, RoutePanel, SearchPanel, SoundingPanel, TidesPanel, UtilityPanels; `vitest.config.ts:34-47`.
  Touches: one `*.test.tsx` per panel, `vitest.config.ts` floors.
  Acceptance: Each panel has a sibling test covering its empty, loading and error states with the catalogue's copy; every floor rises by at least two points and none falls.
  Complexity: M
  Note 2026-09-04: The list is stale: `IncidentPackManager.test.tsx` now exists, and `StorageSection.tsx` and `VwpPanel.tsx` have no test. Thirteen panels, different membership; derive the list from `src/panels/*.tsx` minus `*.test.tsx` rather than naming them.
- [ ] AUD-222 (P3): Save the volume on screen as the file it came from
  Why: A reader who found the sweep that matters can export a picture, a CSV or a GeoTIFF but not the Archive II object itself, so the case study cannot be reopened in the app or handed to another tool; Supercell Wx has a pull request for the same ask.
  Evidence: `src-tauri/src/exports.rs:24` (`png`, `webm`, `gif`, `json`, `jsonl`, `md` only); the app opens local Archive II files already (`src-tauri/src/level2.rs` local mode); https://github.com/dpaulat/supercell-wx/pull/688.
  Touches: `src-tauri/src/exports.rs` (allow the bucket object's own name and extension; bytes are the fetched object unmodified), `src-tauri/src/level2.rs` (hold or refetch the raw bytes of the drawn volume by key), `src/panels/ExportPanel.tsx`, provenance sidecar (the object's SHA-256), `src/i18n/*`, `every_file_this_app_writes_can_be_written`.
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
  Evidence: Giangrande-style automated detection, AMT 14:2873 (2021): normalised Z, ZDR and (1 − ρhv) product on the tilt at or above 9°, threshold 0.08, second-derivative weight 0.75 (https://amt.copernicus.org/articles/14/2873/2021/); `src-tauri/src/level2.rs` has no melting-layer product; `MRMS BrightBandTopHeight` exists on the bucket but is 17.9 MB per file.
  Touches: `src-tauri/src/level2.rs` (or the `derive` module after `AUD-219`): azimuth-average the top cut, normalise, threshold, expose top and bottom heights; a line in `src/panels/RadarProductPanel.tsx`; a ring on the sweep at the melting height; `AUD-190` consumes the height when it lands; `src/i18n/*`.
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

- [ ] AUD-230 (P3): Day and night on the map
  Why: A globe with no terminator gives no sense of where it is dark, which matters to a reader watching an overnight line of storms; the shading needs no network and no data source, and the owner's StormScope already ships it below every data layer.
  Evidence: no terminator or solar code in `src/` (`grep -ri terminator src` matches only unrelated Rust); `C:\repos\StormScope\README.md` "Day/Night Orientation".
  Touches: new `src/lib/terminator.ts` (NOAA solar position equations), a vector layer under the overlays in `src/lib/layerStack.ts`, `src/panels/MapOptionsPanels.tsx` switch, `src/i18n/*`, the layer-stack and provenance tests.
  Acceptance: Day/night shading draws with no request, updates each minute, sits below every data layer, is off by default, and is listed in the provenance table as computed locally.
  Complexity: S

- [ ] AUD-231 (P3): Provider failure history in diagnostics
  Why: Diagnostics says how many times a source failed in a row and nothing about when or why, so an outage that ended an hour ago leaves no trace and a report cannot say which service was down.
  Evidence: `src/lib/diagnostics.ts:199-200` (`consecutiveFailures` only); `src/lib/providers/health.ts`; `C:\repos\StormDeck` keeps 200 redacted provider incidents for 30 days.
  Touches: `src/lib/providers/health.ts` (a bounded ring of the last fifty transitions with times and typed reasons), `src/lib/diagnostics.ts`, `src/panels/UtilityPanels.tsx`, the store, tests.
  Acceptance: The diagnostics report lists each source's last transitions with times and reasons; the ring is bounded, survives a restart and can be cleared; nothing in it names a place or a URL with a place in it.
  Complexity: S

## Audit Findings, 2026-09-03 (evening)

Read-only audit of `168271b` (v0.9.0). Baseline at that commit, all green: `npm run check` 176 files / 1622 passed / 37 skipped, lint 0 errors 1 pre-existing warning, every bundle inside budget; `cargo test` 412 passed / 28 ignored; `cargo clippy --all-targets` clean; `cargo audit` 0 vulnerabilities with 17 documented allowances; `gitleaks` 344 commits clean; `npm audit --omit=dev` 0; `grype` one Medium in `glib`, already documented as unreachable in `src-tauri/.cargo/audit.toml`. The GitHub tracker holds zero issues and zero pull requests (open or closed), so there was nothing to take in from reporters. Every P1 below survived a fresh-context refutation pass. Items are numbered on from `AUD-236`.

Where this pass dug: the three items drained on 2026-09-03 after the last refutation pass (`AUD-182`, `AUD-183`, `AUD-184`) and the two before it that never had one (`AUD-179`, `AUD-181`), which is where the correctness findings are; then the seams between the newer watches and the feeds they read.

### P1

### P2

### P3


## Audit Findings, 2026-09-04
  Note 2026-09-04: `consecutiveFailures` moved to `src/lib/diagnostics.ts:295-296` and `src/lib/providers/health.ts:8,25,47,60`; the cited lines are stale. A Bluesky post (2026-09-03) of RadarScope and RadarOmega both losing their feed in a storm is the reader-facing reason for the history.
- [ ] AUD-247 (P3): A placefile icon sheet cannot be stubbed in the browser suite, so the path where an icon really draws has no end-to-end test
      Category: testing
      Where: `e2e/support/fixtures.ts` (the `https://mesonet.agron.iastate.edu/**` stub, whose default branch answers `emptyCollection` as JSON); `src/components/MapViewport.tsx` `loadPlacefileIcons`; `src/lib/placefileIcons.test.ts` (the source-reading gate standing in for it today)
      Problem: The regression that broke every placefile icon (a `coalesce` onto a fallback image, which made the tile record the fallback as its only icon dependency so the real sheet never reloaded behind it) was invisible to the whole browser suite. An attempt to cover it failed on the fixture rather than on the product: a test-local `page.route` for a sheet on `mesonet.agron.iastate.edu` never answered the request, the fetch was still pending after two and a half seconds, and `performance.getEntriesByType("resource")` listed no request for it. The gate that covers it now reads the layer expression out of `MapViewport.tsx` as text, which catches this exact mistake and nothing else about whether an icon reaches the screen.
      Evidence: Reproduced 2026-09-04 with a probe logging inside `loadPlacefileIcons`. The wanted id is correct and the fetch starts against the right address; nothing is drawn, and neither the sheet's own colour nor the fallback dot appears on the canvas. The import toast reports one shape with no "left out" note, so the parser accepted the sheet, and the icon layer is on the published stack.
      Fix: Work out which route actually answers the request, either by giving the mesonet stub a branch that serves a real PNG for an image path, or by registering the test-local stub through the fixture's own `stubHost` so ordering is not in question. Then write the test the product needs: a placefile whose `IconFile` is a solid-colour fifteen by twenty-five PNG on an allowed host, an `Icon` at the camera centre, and a pixel count for that colour above fifty; plus the same with the sheet stubbed 404 and a pixel count for the fallback dot instead.
      Acceptance: Both cases pass, and reverting the layer expression to a coalesce turns the first one red.
      Confidence: Verified
      Effort: M

- [ ] AUD-248 (P3): A request the workspace fixture does not recognise can hang forever instead of failing
      Category: testing
      Where: `e2e/support/fixtures.ts`, every `stub(...)` handler that branches on the URL
      Problem: A handler that falls off its last branch without calling `fulfill`, `abort` or `continue` leaves the request pending for the life of the page. A test that then waits on whatever that request feeds fails by timing out somewhere else entirely, which is most of what AUD-247 cost. Several handlers do have a default; whether all of them do has not been checked, and the ones that do sometimes answer with the wrong content type for the request.
      Evidence: The mesonet handler's default answers JSON for any path it does not recognise, including an image request, and the same shape of handler is repeated for a dozen hosts in the same file.
      Fix: Read every `stub` handler in `fixtures.ts` and give each a default that fulfils with something the caller can use. Then add a guard so the next one cannot go unnoticed: a check in `routeWorkspace` that no request is left pending when a spec ends.
      Acceptance: Every handler answers on every path; a deliberately unrecognised URL on a stubbed host comes back with a status rather than hanging.
      Confidence: Verified
      Effort: S


## Research-Driven Additions

Seventh pass, 2026-09-04. Evidence in RESEARCH.md of the same date.

### P1

- [ ] AUD-261 (P1): A failed hatch layer is dropped silently, so an outlook draws without its significant areas and nothing says so
      Why: `src/lib/overlays/spc.ts:449-452` catches the significant-hazard query's failure and returns the bands alone. A reader sees a 15% tornado band with no hatching and reads it as "not significant", which is the opposite of "the service did not answer". It is the only swallowed error in `src/` without copy.
      Evidence: the catch at the cited lines; every other swallowed catch in `src/` is commented as deliberate (`ErrorBoundary.tsx:125,133`, `MapViewport.tsx:2156`, `glance.tsx:134`, `autostart.ts:68`, `export.ts:177`).
      Touches: `src/lib/overlays/spc.ts`, `src/lib/overlays/registry.ts` (a partial-answer note on `OverlayData` if none exists), the legend or provenance line for the layer, `src/i18n/*`, `src/lib/overlays/spc.test.ts`.
      Acceptance: With the significant query stubbed to fail, the bands draw and the layer's provenance line says the hatched area could not be read; a test asserts the note; with both queries succeeding the note is absent.
      Complexity: S

### P2

- [ ] AUD-262 (P2): The README, SECURITY.md, the architecture note and the export policy script lag the code by two releases
      Why: README.md:59 says "SPC convective outlooks" for what is now all 26 layers with day and hazard controls; :87 "Lightning two ways" for what is now ten grids; popups on imported shapes, smoothing greyed on a TDWR, and replay-day outlooks and reports are not mentioned; :93 "Seven map styles" against :380 "five of the eight" and `MAP_STYLES` with eight entries. `SECURITY.md:9-10` lists 0.9.x and 0.7.x and earlier, leaving 0.8.x unclassified. `docs/architecture.md:45` and `scripts/unused-exports.mjs:14-16` say about a hundred and fifty exports where the count is 205 test-only and 148 file-local. `CHANGELOG.md` carries no dates except v0.1.0.
      Evidence: the cited lines; `src/lib/mapStyles.ts:16-59, 81`; the counts measured 2026-09-04.
      Touches: `README.md`, `SECURITY.md`, `docs/architecture.md`, `scripts/unused-exports.mjs`, `CHANGELOG.md` (a date on each version heading), `src/lib/settings.ts:79` (retire the `"dark"` id no picker offers, keeping the resolver for old files), `src/lib/docs.test.ts`.
      Acceptance: Every shipped v0.9.0 and v0.10.0 feature has a README line; the style count is stated once and matches `MAP_STYLES`; SECURITY.md classifies every minor since 0.7; the two export counts are measured by the script rather than written in; `docs.test.ts` fails if a CHANGELOG heading has no date. AUD-200 (the screenshot) stays its own item.
      Complexity: S

- [ ] AUD-263 (P2): Vitest 5.0.0, and the three routine bumps beside it
      Why: Vitest 5.0.0 (2026-09-03) changes defaults the suite relies on implicitly: `clearMocks` on by default (62 explicit clear or reset calls become redundant), `expect.poll` rejects on timeout, unawaited `.resolves` fails, artifacts move under `.vitest/`. The tree already satisfies the removals (0 `sequential`, 0 `toHaveTextContent`, all 38 `vi.mock` at top level). `lucide-react` 1.41.0 and `@types/react-dom` 19.2.7 are trivial.
      Evidence: https://github.com/vitest-dev/vitest/releases/tag/v5.0.0 ; https://vitest.dev/guide/migration.html ; `npm outdated` 2026-09-04.
      Touches: `package.json`, `package-lock.json`, `.gitignore` (`.vitest/`), `vitest.config.ts` if coverage patterns need the relative-path form, the redundant clear calls.
      Acceptance: `npm run check` green on Vitest 5 and coverage-v8 5 with the same floors; no `vi.clearAllMocks` left where `clearMocks` covers it; `.vitest/` ignored.
      Complexity: S

- [ ] AUD-264 (P2): Time since the last flash, and how far the nearest one was, per watched place
      Why: The 2026 Hazardous Weather Testbed found forecasters wanted the Lightning Stoplight's colouring by time since the last strike, decaying slowly, beside any probability, and were told never to message an all-clear from probabilities alone after a strike six miles out while both tools trended clear. A reader on Bluesky (2026-09-04) paid for a lightning tier to know when to unplug. The app has the flashes, the places, and a 30-minute quiet rule (`useLightningWatch.ts`); it shows neither the age of the last flash nor its distance.
      Evidence: https://inside.nssl.noaa.gov/ewp/topic/lightning-stoplight/ ; https://baronweather.com/baron-news/tag/baron-threat-net (five radii, 30-minute all-clear); `src/hooks/useLightningWatch.ts`, `src/lib/lightningWatch.ts`.
      Touches: `src/lib/lightningWatch.ts` (nearest flash distance and bearing, time since last inside the radius), `src/hooks/useLightningWatch.ts`, the watched-place card and the Nearby panel (a stoplight chip: red under 10 min, amber to 30, green after, with the minutes written), `src/i18n/*`, tests.
      Acceptance: Each watched place shows minutes since the last flash inside its radius and the nearest flash's distance and bearing, from the same feed the watch reads; the chip's colour steps at the stated minutes and never says "clear" from anything but elapsed time; a test drives a flash then advances a fake clock through the three steps.
      Complexity: M

- [ ] AUD-265 (P2): A shared link carries the held site, product, tilt and threshold, not only the camera
      Why: `openradar://view` carries `lon`, `lat`, `zoom`, `bearing`, `pitch` and `projection` (`src/lib/deepLink.ts:23-33`). HookEcho #71 (2026-08-23) is a dashboard user asking for exactly the rest: site, product, tilt and threshold in the link, persisted. A link that opens the camera over a storm and a different product than the sender saw is a link that shows a different picture.
      Evidence: https://github.com/d4vid87/HookEcho/issues/71 ; `src/lib/deepLink.ts`; the share action in `src/hooks/useWorkspaceActions.ts`.
      Touches: `src/lib/deepLink.ts` (optional `site`, `product`, `tilt`, `threshold`, each validated against the same normalisers settings use), the share action, the link handler in `src/App.tsx`, `src/lib/deepLink.test.ts`, README.
      Acceptance: A link made while holding KDMX velocity on tilt 2 with a threshold opens the same; an unknown site or product in a link is ignored with a toast rather than refused whole; the old camera-only form still works; tests cover each field and each rejection.
      Complexity: S

- [ ] AUD-266 (P2): Read the radar's own wind profile product first, and fit the volume only when it has none
      Why: Every WSR-88D and TDWR publishes Level III NVW (product 48), the RPG's own VAD wind profile: 354 objects a day at DMX, 233 at TLX, 235 at TDJT on 2026-09-03. The app fits every ring itself from Level II (`src-tauri/src/level2.rs:1124` `fitted_wind`, `src-tauri/src/vwp.rs`), which is a whole volume fetched and decoded before storm-relative velocity can paint. Anvil reads NVW first and falls back to its own fit, and cut first paint of SRV from 19.7 to 5.9 s.
      Evidence: bucket listings `DMX_NVW_2026_09_03`, `TLX_NVW_2026_09_03`, `DJT_NVW_2026_09_03` verified 2026-09-04; https://github.com/jhammon88219/Anvil/commit/9783bf8 ; ICD 2620001 product 48 packet 8/9 text and the VAD wind profile in 2620003.
      Touches: `src-tauri/src/level3.rs` (the NVW decoder: heights, direction, speed, RMS per level), `src-tauri/src/vwp.rs` (a column from NVW carries the RPG's own RMS as its trust number; the fit remains the fallback and the source is named on the column), `src-tauri/src/level2.rs` (storm motion from NVW when present), `src/panels/VwpPanel.tsx` (which source each column came from), `src/i18n/*`, tests with a real NVW object as fixture.
      Acceptance: With NVW available the panel's column names the product and appears before the volume finishes decoding; with it absent (stub 404) the fitted column appears as today; a level the RPG marked ND stays ND; a fixture NVW decodes to the heights and winds its packet text states.
      Complexity: M

- [ ] AUD-267 (P2): A second live source for storm reports on the NWS map service
      Why: Storm reports come from one host (IEM). Chasers posted on 2026-09-03 that RadarScope and RadarOmega both lost their feed during a storm while WeatherFront stayed up; a report layer that is empty because its one source is down looks like a quiet afternoon. The NWS publishes the same reports on a host the app already reads for warnings and outlooks.
      Evidence: `mapservices.weather.noaa.gov/vector/rest/services/obs/nws_local_storm_reports` listed live 2026-09-04; https://bsky.app/profile/ontariowedges.bsky.social/post/3mul7suzxzc23 ; `src/lib/overlays/reports.ts` (one `fetchData` path); the mosaic failover in `src/lib/providers/` as the pattern.
      Touches: `src/lib/overlays/reports.ts` (a second parser for the ArcGIS fields, tried when the first fails or times out), the provenance line (which source answered), `scripts/live-contracts-lib.mjs` (a contract for the second), `src/lib/overlays/reports.test.ts`.
      Acceptance: With the IEM stub failing, reports still draw from the NWS service and the provenance line names it; with both up, IEM is asked first and the NWS service is not; the archive replay path is unaffected; a live contract reads today's reports from the NWS service.
      Complexity: S

- [ ] AUD-268 (P2): A launch that starts hidden must show a full-size map when the tray opens it
      Why: WebView2 152 reports a roughly 70 by 39 pixel viewport to a host whose window was hidden when the WebView was created (WebView2Feedback #5689, 2026-09), which is the autostart-to-tray path `AUD-209` shipped. `MapViewport.tsx:2129` resizes on a `ResizeObserver`, which should fire on first show, but nothing has watched that path on 152.
      Evidence: https://github.com/MicrosoftEdge/WebView2Feedback/issues/5689 ; `src-tauri/src/lib.rs` (the start-hidden window), `src/components/MapViewport.tsx:2129`.
      Touches: `src/components/MapViewport.tsx` (a `map.resize()` on the window's first `visibilitychange` to visible, cheap and idempotent), `src/App.tsx`, an e2e spec that starts the page hidden (`page.emulateMedia` and a hidden `document.visibilityState`) and asserts the canvas size after show.
      Acceptance: The spec passes; on a desktop session a start-with-Windows launch opened from the tray shows the map at the window's size (recorded in `Roadmap_Blocked.md` if no session is available, as the other desktop checks are).
      Complexity: S

### P3

- [ ] AUD-269 (P3): Keep the display awake while the second-monitor view is showing
      Why: README says the full-screen view "is meant to be left running on the screen you are not typing on"; Windows turns that screen off on its own timer, and the page cannot stop it: the Screen Wake Lock API is unsupported in WebView2. One Win32 call from the native side is.
      Evidence: https://caniwebview.com/features/web-feature-screen-wake-lock/ ; `grep -rn wakeLock src` empty; `SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED)`.
      Touches: `src-tauri/src/lib.rs` (a `display_awake(bool)` command), the ambient-view enter and leave path in `src/App.tsx`, Settings (off by default, beside the ambient options), `src/i18n/*`, a test that the command is asked on enter and released on leave and on window close.
      Acceptance: With the option on, entering the ambient view asks the native side to hold the display and leaving it releases; the hold is released when the app exits; the option is off by default and says what it does.
      Complexity: S

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
      Why: Since 2026-08-25, `App.tsx` was touched by 143 commits and `MapOptionsPanels.tsx` by 85, and they are 2,814 and 2,847 lines: four of the six largest files are the four hottest, and only `level2.rs` has a split item. Every layer added this week edited both.
      Evidence: `git log --since=2026-08-25 --format=%H -- src/App.tsx | wc -l` and the same for the panel; `wc -l`; the ten-place list in `CLAUDE.md` for adding a switch group.
      Touches: `src/App.tsx` (the watches, the replay wiring, the panel props each into a hook or component), `src/panels/MapOptionsPanels.tsx` (one file per section: layers, radar, watches, appearance, storage), `src/components/PanelSurfaces.tsx`, the tests that import them.
      Acceptance: Neither file is above 1,500 lines; adding a switch group edits one panel section file rather than the panel; `npm run check` and the e2e suite unchanged.
      Complexity: M

- [ ] AUD-273 (P3): Tauri 2.12 readiness, when it ships
      Why: The 2.12 milestone (32 closed, 14 open on 2026-09-04) carries tao 0.37 (the process exits on `WM_ENDSESSION` instead of the "cannot move state from Destroyed" crash, which the autostart path is most exposed to), wry 0.56 (a WebView2 teardown crash fix), MSRV 1.90, `noRedirectionBitmap`, `bundle.windows.bundleVCRuntime`, and exit codes propagated from `app_handle().exit(n)`. None reaches this tree until `tauri-runtime-wry` 2.12.
      Evidence: https://github.com/tauri-apps/tauri/milestones ; https://github.com/tauri-apps/tao/blob/dev/CHANGELOG.md ; `src-tauri/Cargo.toml:7` (`rust-version = "1.85"`).
      Touches: `src-tauri/Cargo.toml` (`rust-version` 1.90, the bump), `src-tauri/tauri.conf.json` (`noRedirectionBitmap`, tested against the MapLibre canvas), `src-tauri/src/lib.rs` (the crash handler's exit-code assumption), `tauri-plugin-single-instance` 2.4.4 now.
      Acceptance: On 2.12: `cargo test`, clippy and the release gate green; a shutdown while the app runs in the tray leaves no crash file; the single-instance bump lands ahead of it.
      Complexity: S

- [ ] AUD-274 (P3): A held site that stops publishing says so and names the nearest one that is
      Why: KLWX went down inside a tornado warning on 2026-08-17 (Bluesky). The app reads every site's status from `api.weather.gov/radar/stations` and passes over a downed one when picking; whether a site already held keeps drawing its last volume with nothing but the age to say so has not been verified.
      Evidence: https://bsky.app/profile/mergerson.bsky.social (2026-08-17) ; `src/hooks/useSingleSiteRadar.ts`, `src-tauri/src/radar_status.rs`, the sites-in-reach picker.
      Touches: `src/hooks/useSingleSiteRadar.ts` (when the held site's status turns from Operate, or no volume arrives for two cadences, a line on the chrome naming the nearest publishing site in reach with one action to hold it), `src/components/WorkspaceChrome.tsx`, `src/i18n/*`, an e2e spec with the status stub flipping mid-hold.
      Acceptance: With the held site's status stubbed to Start-Up the chrome says the radar is down and offers the nearest one; taking the offer holds it; the loop's last volume stays on screen with its age until then.
      Complexity: S

# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items, including `AUD-001`, `AUD-002`, and `AUD-011` through `AUD-066`, are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

Items numbered `AUD-` come from the audit register and are ordered P0 through P3. Items numbered `JOY-` come from a separate 2026-08-31 intake about character and personalization, and they live in their own section. Nothing in that section outranks a correctness, security, or release item. `AUD-093` onward and `JOY-021` were added by the 2026-08-31 evening research pass and sit under Research-Driven Additions at the end, each carrying its own priority. `AUD-206` through `AUD-232` were added by the 2026-09-03 research pass in their own section at the end.

## P1

## P2


## P3

- [ ] AUD-475 (P3): Three things the KDP pass does to a ray that need measuring against real volumes
  Why: A refutation pass over `AUD-191` found three defects that are real but cannot be tuned from a fixture, the way `AUD-192` could not be. Each needs a recorded run over station-days the way `recording_the_days_unfolding_is_held_against` does for the dealiaser.
  Evidence: (1) `src-tauri/src/kdp.rs` unfolds at most once per ray: `unfold` takes `position()` of the first gate below the fold threshold and is called once, outside the reconciliation loop, and the band clamp runs before that loop so a second wrap is undetectable in principle. A ray accumulating more than 720 degrees of differential phase, which is about 90 km of 4 deg/km rain in a squall line, keeps its second wrap. wradlib runs its unfold inside the iteration loop for exactly this reason. (2) `integrate` writes a value at every gate using `unwrap_or(0.0)`, so the reconciliation re-derives the slope over rays where censored and despeckled stretches are flat plateaus; a measured gate within half a window of a censored block has up to half its window filled with fabricated zero slope, which biases the reading low along every clutter block, blocked sector and echo edge. The `measured` mask keeps those gates from being drawn but not from being averaged into. (3) `unfold`'s over-correction band is `DESPECKLE_GATES * 2`, ten gates, under a comment claiming it is the processing window, which is 29 at quarter kilometre gates. It happens to be enough at 0.25 km and 1.0 km spacing and would leave about eight gates carrying a spurious 360 degrees at 0.125 km. Latent on current NEXRAD dual-pol.
  Touches: `src-tauri/src/kdp.rs`, `kdp_tests.rs`, and a recording harness over stored volumes.
  Acceptance: A ray with two wraps in it comes back continuous in a planted fixture; the reading at a gate half a window from a censored block is within a stated tolerance of the reading at the same gate with the block absent, measured rather than asserted; the over-correction band is derived from the window rather than from the despeckle length. Each change is measured against stored volumes before and after, and a change that does not improve the measurement is not made.
  Complexity: M

- [ ] AUD-476 (P3): Aviation hazard codes reach a Spanish or French reader in English
  Why: `src/lib/overlays/aviation.ts` passes the service's own hazard codes straight to the popup: `TURB-HI`, `TURB-LO`, `MT_OBSC`, `LLWS`, `SFC_WND`, `FZLVL`, `CONVECTIVE`. Every other layer in the app either translates what it shows or has a written reason for leaving a service's own words alone, and these are codes rather than words: nobody outside aviation reads `MT_OBSC` in any language.
  Evidence: the live `gairmet` feed on 2026-09-10 carried all seven; the popup renders `properties.hazard` unchanged.
  Touches: `src/lib/overlays/aviation.ts`, `src/i18n/*`.
  Acceptance: Every hazard code the two services publish has a phrase in all three catalogues, a code with no phrase falls back to the code itself rather than to nothing, and a test reads the codes off a live answer rather than from a list written by hand.
  Complexity: S

- [ ] AUD-474 (P3): The live refold gate is red on current weather
  Why: `unfolding_a_live_velocity_sweep_takes_the_folds_out` asserts that at least a fifth of the folded gates come back on their own branch across six stations together. The floor was set against seven recorded days reading 0.291 to 0.462, "with room to spare". On 2026-09-10 the same gate on a clean tree read 0.182, and three runs through the day read 0.213, 0.211 and 0.168. It is an `#[ignore]`d live test so it does not affect `npm run check` or `cargo test --lib`, but it is the gate `AUD-192`'s acceptance is written against and that item cannot be closed while it is red for reasons that have nothing to do with it.
  Evidence: on `bb3e2e2` with nothing modified, "over 6 stations: broken pairs 367485 -> 102287, 118528 of 650716 folded gates back on their own branch". The broken-pair clause still passes comfortably at 0.278 against its 0.85 ceiling; it is only the rejoined share that fails.
  Touches: `src-tauri/src/level2/decode_tests.rs`, and `recording_the_days_unfolding_is_held_against`, which is the tool for re-recording the floor.
  Acceptance: Either the floor is re-recorded against a fresh week with the reasoning written down the way the current one is, or the reason today's weather reads half the recorded range is found and named. A floor moved without evidence is not an answer.
  Complexity: S


- [ ] AUD-473 (P3): The three-body scatter spike, done against real volumes
  Why: `AUD-190`'s note asked for the Lemon 1998 signature as a cheap flag beside the hail size. A first attempt shipped in `1cee4e4` and was taken out again the same session because a refutation pass found it fires on ordinary weak echo: the only conditions were a 60 dBZ core somewhere on the radial, a bin 10 to 30 km behind it reading at or below 20 dBZ, and some cut's beam above 3 km. An isolated supercell with clear-air or biological return behind it flags twenty-one consecutive bins on every radial through the core, under a legend that says large hail is falling now.
  Evidence: the removed `spike` in `src-tauri/src/derive.rs` at `1cee4e4`. What it was missing: the flare starts at the back edge of the core rather than ten kilometres behind it, so the stand-off skipped the real signature and caught the air past it; there was no contiguity requirement, so any weak bin in the window counted; and "aloft" only asked that some cut's beam was high there rather than that the echo is present aloft and absent below, which is what separates a flare from ground return. It also had no positive control: no test in the suite ever made the flag fire.
  Touches: `src-tauri/src/derive.rs`, `derive_tests.rs`, the hail size legend, and a stored volume with a known spike in it.
  Acceptance: A flare is flagged on a stored volume that has one, and no gate is flagged on a stored volume with a 60 dBZ core and clear-air return behind it; the test that proves the first is a positive control that fails when the flag is disabled; the mark is labelled a signature rather than a confirmation.
  Complexity: M


- [ ] AUD-472 (P3): The layers panel is above the ceiling AUD-272 set for a panel
  Why: `AUD-272` split the two hottest files and set 1,500 lines as what a file of this kind may be. Its own 2026-09-05 note recorded `src/panels/LayersPanel.tsx` at 1,440 after the September panel split. It is 1,715 now, so the rule that item established is being broken by the file the item was partly about, and the next switch group added makes it worse.
  Evidence: `wc -l src/panels/LayersPanel.tsx` reads 1,715 on 2026-09-09; the `AUD-272` close named only `src/App.tsx` and a `MapOptionsPanels.tsx` that no longer exists, so the panel half went unmeasured.
  Touches: `src/panels/LayersPanel.tsx`, and whatever section files come out of it under `src/panels/`.
  Acceptance: No file under `src/panels/` is above 1,500 lines; adding a switch group edits one section file rather than the panel; a test reads the directory and fails on the next file to cross it, rather than naming files one at a time.
  Complexity: M


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
- [ ] AUD-192 (P3): Continuity across tilts in the dealiaser
      Note 2026-09-07: WSR-88D Build 24.0 carried 2DVDA fixes for dealiasing failures under high vertical shear (ROC software engineering page; Likely). Read them before choosing the interval rule.
      Note 2026-09-07 (evening): R2D2 works top down, highest elevation first (larger Nyquist, cleaner velocities), each settled sweep guiding the one below, matched by azimuth and ground range `r cos(elev)`; UNRAVEL's `unfolding_3D` (`unravel/continuity.py`, lines 1037-1110) is a readable implementation of that mapping with a four-branch cascade at `alpha Vnyq` that leaves a gate alone rather than forcing it; 4DD seeds only where the sweep above and the previous volume agree within 0.25 Vn; Py-ART's own header lists 3D region finding as unimplemented, so there is nothing to copy there.
      Note 2026-09-10: A one-level version was built and measured and does not work, so the next attempt should start from the top rather than from the cut above. A pass that votes the whole sweep's interval against the cut immediately above it, with the reference settled by the boundary traversal on its own terms, was instrumented across the six live stations: the modal offset was zero at all six, over 78,000 to 296,000 matched gates each. The reason is structural rather than a tuning problem. Both cuts are settled by the same method, so when the lower one lands on the wrong branch the reference has usually landed on the wrong branch too and the two agree with each other. R2D2 anchors from the top cut downward for exactly this reason: the highest cut has the largest Nyquist and the least folding, so it is right by construction and every cut below inherits a correct anchor. One level up inherits nothing. Two other things worth keeping: the two-cut section fixture caught a genuine 12 m/s vertical shear being rounded to a whole interval and read as a fold, so the plausibility bar has to scale with the interval rather than be a fixed speed (a fixed 8 m/s is no bar at all on a cut folding at 8); and a whole-sweep shift is safe to apply on this path because it cannot pull two touching gates apart, which a per-gate cascade can.
  Why: The region method fixes a sweep only up to a whole Nyquist interval and can flip a whole region in strong shear; UNRAVEL's 3D pass uses the cut above and below to settle the interval, at modest cost on top of the existing core.
  Evidence: `src-tauri/src/dealias.rs` (region growing, largest patch keeps its reading); Louf et al. 2020 (JTECH) and the MIT numba implementation at `vlouf/dealias`; the live multi-site test in `src-tauri/src/level2/decode_tests.rs` that measures refold recovery.
  Touches: `src-tauri/src/dealias.rs` (a pass that votes a cut's interval against its neighbours in elevation), `src-tauri/src/level2/sweep.rs` (hand adjacent cuts to the unfolder), the live aggregate test.
  Acceptance: The six-site refold test's aggregate recovery does not fall and the whole-sweep-out-by-one case is caught in a planted fixture; runtime per cut stays under the current half-second budget.
  Complexity: M

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

## Audit Findings, 2026-09-04 (afternoon)

Read-only audit of `4f9a18a` (v0.9.0 tree, v0.10.0 unreleased in the changelog). Baseline at that commit: `npm run check` 182 files / 1710 passed / 38 skipped, lint 0 errors 1 pre-existing warning, coverage 65.3 / 59.4 / 60.17 / 66.5 above every floor, and **exit 1 at `check:bundle`** (settings chunk 72 kB against 70 kB, pre-existing baseline, already carried on `AUD-272`); `npx playwright test` 622 passed across chromium, compact and wide in 14.6 minutes; `cargo test` 420 passed / 29 ignored; `cargo clippy --all-targets` clean; `gitleaks` 372 commits clean; `npm audit` 0 with and without dev; `cargo audit` 0 vulnerabilities, 17 default-allowed warnings (the `lru` one is in `Roadmap_Blocked.md`); `grype` one Medium in `glib`, the documented Linux-only case. The GitHub tracker holds zero issues and zero pull requests, open or closed, and discussions are disabled, so there was nothing to take in from reporters. Every P1 below survived a fresh-context refutation, and the two storm-report items were confirmed against the live service rather than by reading. Items are numbered on from `AUD-275`.

Where this pass dug: the eleven items drained on 2026-09-04 that had no refutation of their own (`AUD-263`, `AUD-265`, `AUD-267`, `AUD-268` and the `AUD-185` frontend), the seams between them and the chrome, the secondary panels' failure states, the light theme with panels open in a real browser, and the keyboard paths axe cannot see.

### P1

### P2

### P3

### Unaudited, needs a pass

## Research-Driven Additions, 2026-09-07

Eighth pass. Evidence in RESEARCH.md of the same date. Three of the live contracts were red when this pass ran, all three for reasons inside the tests, and those come first.

### P1

### P2

### P3

- [ ] AUD-344 (P3): Replay a day through the watch rules and list what would have fired
      Why: Ten watched places carry arrival, lightning and warning rules, and the only way to know what they would have said on 2011-04-27 is to have been there. HookEcho shipped "alert-rule backtests run in the browser" on 2026-08-31. The app has the archive warnings and reports for any day, the replayed lightning window, the rules, and the sentences; a backtest is those four joined and told to a panel instead of a toast.
      Evidence: https://github.com/d4vid87/hookecho/releases/tag/v0.12.0-beta.2 ; `src/lib/archiveWarnings.ts`, `src/hooks/useAlertWatch.ts`, `useApproachWatch.ts`, `useLightningWatch.ts`, `src/lib/approach.ts`; `AUD-216` (the replayed day's outlook and reports).
      Touches: a `src/lib/backtest.ts` that runs the three rule functions over a day's archive without side effects, a section in the watch settings or the History panel, `src/i18n/*`, tests with a fixed day.
      Acceptance: Pick a replayed day and each watched place lists what it would have been told and when, in the reader's language, with nothing notified, nothing written to the record, and quiet hours shown as applied.
      Complexity: M

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



### Notes on existing items

- `AUD-295`: the 2026-09-07 sweep of `en.ts` adds these to the list: `export.note` says "Both" under four export buttons (`ExportPanel.tsx:121-168`); `toast.bundleMissing` has no plural block, so one missing frame reads "1 of them could not be fetched and are listed"; `packs.error.httpStatus` and `radar.error.httpStatus` end in a bare status ("could not be reached. 404"); `wpc.serviceStatus` drops the word "service" and the full stop every sibling has; `settings.watching` (`WatchSection.tsx:611`, `:802`) prints raw coordinates where the toast beside it names the place; `toast.placesFull` ("That is every place") has no next step while `settings.placesFull` for the same condition does; `search.none` and `journal.noneMatch` are dead ends beside `history.none` and `palette.none`, which coach; `toast.notABackupBody` refers to "the button beside it", a positional reference; `chrome.nextPiece` says "piece" where every neighbour says volume or sweep; terminology runs two ways for colour table and palette, loop and animation, site and station, tilt (camera) and tilt (radar), and six namings of the watched place. The `{0}` family and the WDTD, isotherm and Title Case points already listed stand.


## Research-Driven Additions, 2026-09-07 (evening)

Ninth pass. Evidence in RESEARCH.md of the same date. Numbered on from `AUD-378`. Every host named below is already in `ALLOWED_HOSTS`. Nothing here outranks an open audit item of the same priority; `AUD-378` is the first thing to drain.

### P1

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


- [ ] AUD-445 (P3): `misplaced` mixes the boundary's mistakes with the wind's, so neither can be bounded on its own
  Why: `misplaced` counts gates that never folded and came back on a branch other than the picture's own, whatever put them there. Two different passes can do it: a boundary vote that gets a whole patch wrong, and the reference wind placing an unreached group. The first dominates. Recorded over the week of 2026-09-01 to 2026-09-07, 159,771 of these exist with no reference pass running at all, against 167,180 with the pass and its plausibility bar. That is why `AUD-388` could not be finished as written: a per-station line drawn on the total clears the recorded week at 1.285 and still clears it at 1.329 with the bar removed, so no line both leaves room for the weather and answers for the wind. Split at the point of placement and the wind's own contribution becomes a number that can carry a line.
  Evidence: measured 2026-09-08 while draining `AUD-388`, from two full runs of `recording_the_days_unfolding_is_held_against`, 42 station-days with the plausibility bar and 38 comparable without. Per-station worst with the bar 0.166, 0.633, 0.835, 0.953, 1.263, 1.285; without it 0.200, 0.699, 0.910, 0.962, 1.285, 1.329. Worst single station-day movement 0.122, aggregate over the shared days 152,398 against 160,430. `src-tauri/src/level2/testing.rs` (where `misplaced` is counted), `src-tauri/src/level2/decode_tests.rs` (the bound and the reasoning beside it).
  Touches: `src-tauri/src/level2/testing.rs` (carry which pass placed a gate through to the count, as two fields rather than one), `src-tauri/src/level2/decode_tests.rs` (a line on the wind's share, recorded from a week), `src-tauri/src/dealias.rs` if the placement has to be reported out.
  Acceptance: the recorder prints boundary-placed and wind-placed separately; a per-station line on the wind's share is drawn from a recorded week and fails when the plausibility bar is removed, which the combined figure cannot do; the existing bound on the total stays.
  Complexity: M

- `AUD-295` (drained 2026-09-09, the parts it did not carry): the period rule, the numbered placeholders, the Title Case names and the six specific strings it listed are done and gated. What it collected in its notes and this pass did not take on, because each needs a decision rather than a sweep: `toast.bundleMissing` has no plural block; `settings.watching` prints raw coordinates where the toast beside it names the place; `toast.placesFull` has no next step where the settings string for the same condition does; `search.none` and `journal.noneMatch` are dead ends beside `history.none` and `palette.none`, which coach; `toast.notABackupBody` refers to "the button beside it"; and terminology still runs two ways for colour table and palette, loop and animation, site and station, and the watched place. Worth a new item when somebody is deciding the wording rather than applying a rule.
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

### P2

### P3




### Notes on existing items

- `AUD-355` (drained 2026-09-09): taken at the versions live on the day rather than the ones the note recorded, which had already gone stale: maplibre-gl 6.9.0 not 6.8.0 and lucide-react 1.43.0 not 1.42.0. Raising `rust-version` to 1.90 turns on clippy lints for APIs stabilised since 1.85, which is twenty-three `chunks_exact` calls, one of them the mutable spelling, and six modulo tests across five lines; TypeScript 5.9 narrows `BlobPart` so that anything handed to a `Blob` has to say its buffer is not shared, which is nine sites and one real narrowing bug in the MP4 encoder's parameter-set copy. The one acceptance line that could not be met as written is the 204 tile: it names `src/lib/providers/health.ts`, and nothing in that file fetches anything, it records what other code reports. Our own catalogue fetches already treat a 204 as a success, because it is a 2xx, and then fail on the empty body, which is the right answer for a catalogue with no frames in it. The tile behaviour the line is about is MapLibre's own and arrives with 6.8.0. What is ours to hold is the floor, so `src/lib/dependencyFloors.test.ts` fails if either the range or the lockfile drops below it, for that fix and for the September advisory.
- `AUD-440` (drained 2026-09-09, and one line of its acceptance that could not be met as written): the item asked for three things at once, and two of them cannot both hold. "A terminal base product stops at the step that resolves its bins" reads as one or two pixels a bin, since 177.6 km over 1,024 pixels is already 173 m against 150 m bins. "A WSR-88D is no worse off than it is today" needs the same rule to allow nine pixels a gate, because that is what a sixteenth of a 460 km disc comes to. One factor cannot be both: a terminal base product needs 1.7297 pixels a gate or fewer to stop at two steps, and anywhere at or below that a WSR-88D falls from sixteen steps to four. The rule shipped honours the WSR-88D line, which is the one the item states as a constraint rather than as a hope, and takes what the other one can have at that factor: a terminal base product loses one of its four halvings rather than three, and the long range product gains one it always had bins for. The remaining two halvings on a terminal base product are still spending a fetch each on interpolation, and closing that means deciding a WSR-88D may be given a wider box than it gets today. That is a decision about what a reader sees, not an arithmetic gap, so it wants its own item and somebody's judgement rather than another pass.
- `AUD-378`: re-verified live on 2026-09-08. `api.weather.gov/radar/stations` lists 159 ids including KHDC (295 objects on the bucket that day), KBHX, KDOX, KLGX and PAPD; KLIX answers 404 and has zero objects on 2026-09-07 and 09-08 and no folders in the chunk bucket. `danielway/nexrad` PR #148 is open with zero comments and no crate has been published since 2026-04-03. The app's own table remains the route.
- `AUD-345`: three more sources for the same ask since 2026-09-07, none of them a radar app's tracker: a Substack post on syncing a phone video to MRMS that found acquisitions "up to 10 minutes late" (on Hacker News 2026-09-07), a Hacker News comment on rain cut off at a tile boundary, and HookEcho's six rendering fixes of 2026-09-08 evening, all of which are about a reader being able to tell what the picture is doing.
- `AUD-273` (blocked): wry 0.57.0 shipped 2026-09-08 (MSRV 1.85, the `windows` crate at 0.62, drops Windows 7) and PR #15996 pulls it into the 2.12 milestone, which is at 15 open and 32 closed with 76 pending change files. The tree stays on wry 0.55.1 until 2.12 ships.
- The placefile-host decision in `Roadmap_Blocked.md`: MesoPulse has not launched. The PlacefileNation countdown still reads "launching September 1, 2026" a week later, `/mesopulse` is 404 and `mesopulse.com` does not resolve (2026-09-08). The argument the ninth pass built on it is weaker than written; the decision is still the owner's.

## Research-Driven Additions, 2026-09-08 (late evening)

Eleventh research pass, at `8c19165`, an hour after the tenth. It ran the headless UI inspection the tenth had no machine for (108 captures, both themes, both widths, axe and the overflow check on every one: zero violations, zero overflow, so what follows is what a person sees), read the destructive, import and recovery flows in code, and refreshed the academic, platform and curated-list source classes against 2026. Every finding below was verified against the code and, where there is one, the screenshot; `RESEARCH.md` records what was looked at and judged fine or an artefact so it is not re-filed. Items are numbered on from `AUD-461`.

### P2

### P3





- [ ] AUD-471 (P3): A probability ramp over a pale basemap has no casing under it
      Why: `MAP_INK` gave the small unbacked marks a lightness the ground is not, and a ramp cannot take that fix: the colour is the value. Measured against `MAP_GROUND_LIGHT` with the same formula the ink table is gated on, the ProbSevere outline and fill at the low end of their ramp (`#fde68a`) read 1.06 to one, the route line at thirty per cent (`#facc15`) reads 1.30 and its "no reading" grey (`#94a3b8`) reads 2.18. All three are lines and outlines rather than fills, so the cartographic answer is the one the county lines already use: a wider stroke of the opposite lightness underneath. `casingFor` in `src/lib/lineOnMap.ts` returns exactly that and nothing on the map calls it yet.
      Evidence: found 2026-09-09 by the refutation pass on `AUD-333`; `src/components/MapViewport.tsx` (the ProbSevere fill and line ramps, the route line ramp), `src/lib/lineOnMap.ts` (`casingFor`, `lightness`), `src/lib/mapStyles.ts` (`MAP_GROUND_LIGHT`).
      Touches: `src/components/MapViewport.tsx` (a casing layer under each of the two ramped lanes, drawn only over a pale ground), `src/lib/lineOnMap.test.ts` (the ramp stops measured against both grounds, the way `MAP_INK` is).
      Acceptance: Over `pro-light` with a pack open and without one, every stop of the ProbSevere and route ramps reads at three to one or better against what is behind it; the ramp's own colours are unchanged, because the colour is what the value means.
      Complexity: S

### Notes on existing items

- `src-tauri/src/mrms.rs` became `src-tauri/src/mrms/` on 2026-09-09 when `AUD-330` drained. Every item above that names the file in its Evidence or Touches means the directory: the product table and its ramps are in `products.rs`, the GRIB reader in `decode.rs`, the bucket listing and `DOMAINS` in `listing.rs`, `parse_tile_path`, `serve_tile`, `tile_pixels` and `TileLook` in `tiles.rs`, the grid cache and `grid_for` in `cache.rs`, and `grid_window` in `window.rs`.
- `AUD-295`: four more for its list, all seen in the headless captures of 2026-09-08. The Guidance footer reads "read 0 min ago" at zero minutes (`guidance.answeredFor`, `en.ts:2124`; a "just now" branch in `formatAge`, or the same handling the timeline's age chip has). A warning card headed EXTREME reads "Issued unknown · expires unknown" when the feed omits both times (`alerts.unknownTime`, `en.ts:91`); on a life-safety card the two unknowns should be one sentence or none. The radar product panel shows Opacity twice, as a chip at the top and as a slider 200 px below, with the chip putting the value above the label and the sliders putting it to the right. The Guidance blocks' right-aligned "they disagree, in °F" and "in inches" read as sentence remnants and could carry their subject ("Models disagree, in °F").
- `AUD-348`: two 2026 papers for its reading list. Bölz et al. (Ulm and DWD), EGUsphere 2026-992 (2026-03-18), a U-Net for non-meteorological echo removal trained on synthetic composites (clean winter precipitation pasted onto cluttered summer scans) that beats DWD's operational classifier at precipitation edges, which removes the hand-labelling cost; CC-BY, no code link. Frech, Boehm and Tracksdorf (DWD), AMT 19:1711 (2026-03-10), wind-turbine clutter detected dynamically above 80 per cent when rotors exceed 5 rpm, polarimetric moments more sensitive than reflectivity, code on request; the static-mask-plus-dynamic-test shape is the one for a wind-farm filter.
- `AUD-351`: Tauri's pending 2.12 change files move monitor queries to the main thread and make `primary_monitor`, `monitor_from_point` and `available_monitors` return `Result`; nothing in `src-tauri` calls them today, so this item will be the first caller and should be written against the 2.12 signatures.
- `AUD-355` (drained 2026-09-09): the style-spec is not a direct dependency, so nothing was pinned to it; GL JS 6.9.0 carries what it needs. Checked and not affected: Edge 152's `unload` deprecation (the tree saves on `pagehide` and `visibilitychange` and has no `unload` or `beforeunload` handler) and the `-webkit-app-region` rename to `window-drag` (not used). WebView2 moved to a two-week release cadence at 152.
- `AUD-228`: veritiles (awesome-maplibre, 2026-08-27) integrity-checks PMTiles from untrusted hosting; a hash beside an imported basemap is the same idea in one line and belongs in this item's acceptance.

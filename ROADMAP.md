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

- [ ] AUD-175 (P2): MRMS rotation and hail families: merged azimuthal shear, rotation-track durations, VIL density, SHI, POSH, VII
  Why: The app ships one rotation track (60 minutes) and MESH; RadarScope sells shear and hail contours at Tier 2 and WeatherFront at Advanced; the missing grids are on the same bucket.
  Evidence: Verified live 2026-09-02: `MergedAzShear_0-2kmAGL_00.50` and `_3-6kmAGL_` (2-min, 0.005°, 14000x7000, 8-bit), `RotationTrackML{30,120,240,1440}min` and non-ML variants, `VIL_Density_00.50`, `SHI_00.50`, `POSH_00.50`, `VII_00.50`, all template 5.41; `mrms.rs:431` holds only `RotationTrack60min_00.50`; WDTD says mid-level AzShear above 0.01 s⁻¹ is a deep mesocyclone signal. (2026-09-03: the same listing also carries `MESH_Max_30/60/120/240/360min`, `VIL_Max_120/1440min`, `EchoTop_30/50/60` and `RotationTrack360min`; WDTD's MESH Tracks page documents the running-max semantics, https://vlab.noaa.gov/web/wdtd/-/mesh-tracks. Commit `9fcfc11` already folds a 0.005° grid by two, so the 0.005° path exists and AzShear rides it.)
  Touches: `src-tauri/src/mrms.rs` (a 0.005° grid path beside the 0.01° one, product table), `mrms.ts`, `RadarProductPanel.tsx` (a duration switch for rotation tracks), legends, ramps, catalogues, live test.
  Acceptance: Low- and mid-level AzShear draw at full 0.005° resolution with a legend in 0.001 s⁻¹ and a note on the WDTD thresholds; rotation tracks offer 30/60/120/240/1440 minutes; SHI, POSH, VII and VIL density draw with measured ramps; tile timing for a 14000x7000 grid stays under the current composite's budget in the live test.
  Complexity: M

- [ ] AUD-176 (P2): WPC hazard outlooks: excessive rainfall and the winter storm severity index
  Why: The Excessive Rainfall Outlook is what forecasters point at before a flood day and RadarScope paywalls it at Tier 2; the WSSI is the winter counterpart; both live on a host already allowed with a CORS policy the page can use.
  Evidence: Verified live 2026-09-02: `https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer` layers 0-4 (Day 1-5, `outlook`, `valid_time`, `f=geojson` works); `outlooks/wpc_wssi/MapServer` (overall impact layers 1-4, components for snow amount, load, ice, blowing snow) and time-enabled `outlooks/wpc_wssi_p`; ACAO echoes the request origin. PNS26-57 proposes a five-tier ERO; PNS26-64 retires PWPF for NBM-based PPP on 2026-10-01, so no PWPF adapter.
  Touches: new `src/lib/overlays/wpc.ts` adapter (two layer families), `registry.ts`, `src/panels/MapOptionsPanels.tsx` (a day selector), legends, provenance (`kind: forecast` with issue and valid times), catalogues, live contract.
  Acceptance: ERO Day 1-5 and WSSI overall impact Day 1-3 draw under warnings with WPC's own category names and colours, each frame carrying issue and valid time in the popup and legend; both say plainly they are outlooks; a fixture e2e switches days and asserts the valid time changes.
  Complexity: M

- [ ] AUD-177 (P2): GOES-West and Himawari on the satellite layer, with more bands
  Why: The satellite layer serves two GOES-East products, so a reader in Seattle or Honolulu looks at an oblique picture from 75°W; GOES-West and Himawari sit on the same endpoint under the same terms.
  Evidence: Verified 2026-09-02 from GIBS WMTS capabilities (`epsg3857/best`): `GOES-West_ABI_GeoColor`, `GOES-West_ABI_Band13_Clean_Infrared`, `GOES-West_ABI_Air_Mass`, `GOES-West_ABI_Band2_Red_Visible_1km`, `GOES-West_ABI_Dust`, `GOES-West_ABI_FireTemp`, the same six for East, `Himawari_AHI_Air_Mass`, `Himawari_AHI_Band13_Clean_Infrared`, `Himawari_AHI_Band3_Red_Visible_1km`; PT10M with gaps and 50 to 90 minutes behind real time; `src/lib/providers/satellite.ts:56-74` lists two layers.
  Touches: `src/lib/providers/satellite.ts` (satellite chosen by view longitude, band chosen by the reader; read the `<Dimension>` values rather than assuming a continuous series), `src/panels/MapOptionsPanels.tsx`, `src/lib/layerProvenance.ts`, catalogues, the GIBS live contract.
  Acceptance: West of 106°W the layer draws GOES-West and over the Pacific Himawari, with the satellite named in the legend; Air Mass, Red Visible, Dust and Fire Temperature are selectable; a missing time slot falls back to the nearest published one and the legend says so; a fixture e2e pans from Miami to Seattle and asserts the source id changes.
  Complexity: M

- [ ] AUD-178 (P2): Arrival estimate for every watched place, and a notice when a tracked cell will reach one
  Why: The app already says "A1 reaches the place you watch in 12 min", but only for home and only inside the Radar Products panel; the patent caution that held this back is over, and Storm Radar sells the same line at $19.99 a year.
  Evidence: `src/lib/cells.ts:122,160` (`minutesUntilArrival`, `soonestArrival`), `src/panels/RadarProductPanel.tsx:129` (home only); US 6,125,328, 6,278,947, 6,401,039 and 6,252,539 all show Expired on Google Patents (2018); RadarScope Tier 2 and WeatherFront Advanced sell storm ETAs.
  Touches: `src/lib/cells.ts` (per-place arrivals), `src/lib/watch.ts` (an `approach` event distinct from a warning, with its own opt-in and no default sound), `src/hooks/useAlertWatch.ts`, `src/panels/NearbyPanel.tsx` and `AlertsPanel.tsx`, `src/lib/journal.ts` writers list (already records a cell within ten miles; keep the gate test honest), catalogues.
  Acceptance: Each watched place shows the soonest cell arrival in the Nearby list; an opt-in notice fires once per cell per place when the estimate first drops under a reader-chosen threshold, labelled as the radar's tracking rather than a warning, silent by default, and standing down under quiet hours; the `appendJournalRow` caller gate still lists exactly its documented writers.
  Complexity: M

- [ ] AUD-179 (P2): Lightning within a radius of a watched place
  Why: Supercell Wx #581 asks for it, RadarScope sells it at Tier 1, and the app already decodes GLM flashes and the NLDN density grid; a reader at a ballfield wants "flashes within 10 miles in the last 5 minutes", not a national picture.
  Evidence: `src/hooks/useLightning.ts` has no watch path; `src-tauri/src/lightning.rs` decodes flash centroids with quality flags; the GLM legend already carries the not-a-strike-report note.
  Touches: `src/lib/watch.ts` (a lightning rule per place: radius, count, window), `src/hooks/useLightning.ts` (a place-bounded query while a rule is on), `src/panels/MapOptionsPanels.tsx` watch settings, `useAlertWatch.ts`, catalogues.
  Acceptance: A place with a lightning rule announces once when flashes within its radius exceed the count in the window and once when the window has been quiet for thirty minutes; the notice says the flashes are satellite-detected, not ground strike reports; the watch's health line covers this poll; a fixture e2e plants flashes inside and outside the radius.
  Complexity: M

- [ ] AUD-181 (P2): KML and KMZ import in the Upload panel
  Why: Supercell Wx #655 asks for it, NHC and NWS publish shapefiles and KML, and the app already parses HMS placemarks from KML for the smoke layer, so the parser is half built and unshared.
  Evidence: `src/lib/workspaceOverlays.ts:46` and `src/panels/UtilityPanels.tsx:63` accept GeoJSON, placefile and `.pal`; `src/lib/overlays/smoke.ts` parses KML placemarks inline.
  Touches: new `src/lib/kml.ts` (Placemark, Point, LineString, Polygon, MultiGeometry, Style colours, KMZ via a bounded zip read), `smoke.ts` (use it), `workspaceOverlays.ts`, `UtilityPanels.tsx`, `src-tauri/src/exports.rs` if a KML export follows, catalogues.
  Acceptance: Dropping a `.kml` or `.kmz` on the window adds it to the imported set with its own name, switch, opacity and colours, bounded by the same size and shape limits as GeoJSON; the smoke layer's parser is the shared one; a malformed file is refused with the reason and nothing on the map changes.
  Complexity: M

- [ ] AUD-182 (P2): Placefile icons, images, time ranges and thresholds
  Why: `Icon`, `IconFile`, `Image`, `TimeRange` and `Threshold` are what METAR, Spotter Network and lightning placefiles are made of; the parser skips or ignores them, so most published placefiles load as a few lines and text.
  Evidence: `src/lib/placefile.ts:175-185` steps over `Object`, `Icon`, `IconFile`, `Font` and drops `Triangles`, `Image`, `Threshold`, `TimeRange` on the default branch; HookEcho's roadmap lists placefile `Image:` as its next item; the GRLevelX placefile ecosystem is the documented switching lever. (2026-09-03: HookEcho PR #276 ships `Image:` with `Object:` nesting and relative URLs; Spotter Network's `gr-all.txt` needs `IconFile`, rotated `Icon`, `Object` and multi-line hover text, and PlacefileNation's 54 free feeds and the saratoga-weather generators all use `TimeRange`; the full statement list is in Supercell Wx's placefile specification.)
  Touches: `src/lib/placefile.ts`, `src/lib/mapLayers/vector.ts` (symbol layers from sprite sheets built from `IconFile`), `src/lib/workspaceOverlays.ts` (`Threshold` by zoom, `TimeRange` by frame time), fixtures under `src/lib/` tests, catalogues.
  Acceptance: A placefile using `IconFile`/`Icon` draws its icons from the referenced sheet (fetched only if the host is on the allowlist, else skipped with a named reason), `Threshold` hides features beyond its zoom, `TimeRange` hides features off the current frame time, `Image` draws a georeferenced picture; the loader reports what it skipped as it does today.
  Complexity: M

- [ ] AUD-183 (P2): MP4 (H.264) export beside WebM
  Why: A WebM will not play in iMessage, most email clients or a phone gallery; RadarScope 5.6.1 (2026-09-02) moved its saved video to MP4 for that reason, and WebView2 Evergreen carries an H.264 WebCodecs encoder.
  Evidence: `src/lib/export.ts:117-119` and `src/lib/webm.ts` (VP9/VP8 Matroska writer of our own); WebView2 runtime notes and codec surveys report `avc1` encode available; MP4 needs an ISO BMFF muxer the way WebM needed Matroska. (2026-09-03: the owner's `C:\repos\StormviewRadar\src\animation-export.js:51-52` already probes `avc1.42E01E` and `avc1.424028` with a runtime fallback, so the codec detection can be lifted from there.)
  Touches: new `src/lib/mp4.ts` (ftyp/moov/mdat or fragmented boxes, avcC from the encoder's description), `src/lib/export.ts` (format choice, fall back to WebM when `avc1` is unsupported), `src/panels/ExportPanel.tsx`, `src-tauri/src/exports.rs` (`.mp4` in the allowlist and its test), provenance sidecar naming, catalogues.
  Acceptance: An MP4 export plays in Windows Media Player and passes `ffprobe` (h264, the frame count and duration of the loop); the caption band survives the encode as the WebM test checks; when the encoder is missing the panel says so and offers WebM; `every_file_this_app_writes_can_be_written` lists `.mp4`.
  Complexity: M

- [ ] AUD-184 (P2): A smoothing option for the single-site sweep, in polar space and never across missing gates
  Why: GR2Analyst, GRLevel3, Supercell Wx and WeatherWise all offer it and readers expect the choice; the sweep here is drawn as hard gates.
  Evidence: `src-tauri/src/level2.rs:4222` interpolates only the colour ramp; Mike Gibson's description of GR's range-dependent weighted average keyed to bin aspect ratio (Stormtrack); WeatherWise's "smoothed radar toggle".
  Touches: `src-tauri/src/level2.rs` renderer (bilinear in range and azimuth with missing and range-folded gates as zero-weight, nearest-neighbour kept for velocity sign boundaries), `src/lib/level2.ts` and `RadarProductPanel.tsx` (the switch, off by default), settings schema, `data_export.rs` (never applied to exported readings), catalogues.
  Acceptance: With smoothing on, a reflectivity sweep interpolates between neighbouring gates in polar space; no colour appears where the radar had no data; velocity keeps the sign boundary; the legend says the picture is smoothed; the CSV export is unchanged bit for bit; the golden test pins one smoothed image.
  Complexity: M

- [ ] AUD-185 (P2): A VAD wind profile panel from the wind the app already fits
  Why: Supercell Wx #383 asks for a VWP, GR2Analyst ships one, and `vad.rs` already computes the wind per ring to make storm-relative velocity and shows nobody.
  Evidence: `src-tauri/src/vad.rs` (`fit_ring`, `median_wind`), no `vad`/`VWP` reference in `src/panels`; NWS VWP conventions (height against time, barbs coloured by RMS error, up to 30 altitudes) and the RPG reference guide (RMS threshold 9.7 kt, symmetry 13.6 kt, at least 25 points).
  Touches: `src-tauri/src/vad.rs` (per-ring RMS and symmetry checks, altitude bins from beam height), a `level2_vwp` command in `lib.rs`, new `src/panels/VwpPanel.tsx` with a hodograph, `src/lib/commands.ts` and the rail's tools group, catalogues.
  Acceptance: For a held site the panel shows barbs by height for the last volumes the loop holds (or the one volume today), marks bins that failed the RMS or symmetry checks as ND, offers a hodograph, and says which volume each column came from; a fixture volume produces a known profile in a test.
  Complexity: M

### P3

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

- [ ] AUD-195 (P3): Snowfall analysis for the winter lane
  Why: Precipitation type shipped in 0.6.0 and nothing says how much fell; NOHRSC's national snowfall analysis is the official 24/48/72-hour answer and is keyless.
  Evidence: Verified live 2026-09-02: `https://www.nohrsc.noaa.gov/snowfall_v2/data/{YYYYMM}/sfav2_CONUS_{6h|24h|48h|72h}_{YYYYMMDDHH}.tif` (00Z and 12Z for 24/48/72 h, no CORS: native), or the rendered `raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export` on the allowed mapservices host (daily, not time-enabled).
  Touches: either `src-tauri/src/geotiff.rs` gains a reader for the sfav2 GeoTIFF and a new native tile lane, or a raster overlay adapter for the ArcGIS export; `http.rs`/CSP for `www.nohrsc.noaa.gov` if native; legends, ramps, catalogues, ledger, live contract.
  Acceptance: A snowfall layer draws 24, 48 or 72-hour totals with the analysis time in the legend and the NOHRSC credit; provenance says `observation` with a daily cadence; the winter lane's product entry names it beside precipitation type.
  Complexity: M

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

- [ ] AUD-209 (P2): Start with Windows, opening to the tray
  Why: The product is meant to sit on a second monitor for a year and the warning watch only runs while the app does, yet after every reboot nothing starts it; a reader who set up ten watched places and quiet hours is unwatched until they remember. The tray and close-to-tray already exist, so this is the missing third switch.
  Evidence: `src-tauri/Cargo.toml:30-77` (no autostart plugin); `src/lib/settings.ts:441-460` (`tray`, `closeToTray`); `tauri-plugin-autostart` 2.5.1 (crates.io, 2025-10-27; docs https://v2.tauri.app/plugin/autostart/ with `enable`/`disable`/`isEnabled` and launch arguments).
  Touches: `src-tauri/Cargo.toml` and `package.json` (the plugin), `src-tauri/capabilities/` (`autostart:allow-enable`, `allow-disable`, `allow-is-enabled`), `src-tauri/src/lib.rs` (init with a `--hidden` argument; when present and close-to-tray is on, the window is created hidden and only the tray shows), `src/panels/MapOptionsPanels.tsx` tray settings (a "Start with Windows" switch disabled with a reason unless the tray icon is on), `src/lib/settings.ts` schema, `src/i18n/*`, `e2e/` with the plugin command stubbed, diagnostics line.
  Acceptance: The switch on registers the current-user Run entry through the plugin and off removes it (round trip through `isEnabled` in a test with a fake); a launch with `--hidden` shows no window and a tray icon; with the tray off the switch is disabled and says why; the diagnostics report names the state; the pseudolocale clipping test covers the new copy.
  Complexity: S

- [ ] AUD-213 (P2): Undo for the removals that have none
  Why: Deleting an incident pack throws away a verified multi-megabyte download on one press with only a toast; removing a palette, an overlay file, a custom sound or a theme is the same; place removal, journal clear and settings reset already offer undo, so the product's own standard is not met everywhere.
  Evidence: `src/panels/IncidentPackManager.tsx:228-236` (delete, toast only); palette, overlay file, sound and theme removal in `src/hooks/useWorkspaceActions.ts`; the held-toast undo pattern at `src/App.tsx:1641-1658`; the 2026-09-02 working note that a toast is the wrong home for undo unless it is held.
  Touches: `src-tauri/src/incident_packs.rs` (delete moves the pack to a held directory for the undo window and reaps it afterwards or on the next start), `src/panels/IncidentPackManager.tsx`, `src/hooks/useWorkspaceActions.ts` (palette, overlay, sound, theme removals through the held-toast undo), `src/components/ToastHost.tsx` if the held pattern needs a second slot, `src/i18n/*`, tests for a second use and a refusal.
  Acceptance: Each removal offers Undo for the same window as place removal and restores exactly what was removed (a pack's archive is rehashed after restore and served again); using Undo twice and refusing it are both tested; a held pack that outlives the window or a restart is reaped and the reaping is logged.
  Complexity: M

- [ ] AUD-215 (P2): SPC probabilistic outlooks and conditional intensity
  Why: The app draws the Day 1 categorical outlook only; the same service carries tornado, hail and wind probabilities with the hatched significant area for Days 1 and 2, a Day 3 probability and Days 4 to 8, which is what a reader planning a week wants and what RadarScope 5.6 (2026-08-12) and MyRadar 7.124 both added this year.
  Evidence: Verified 2026-09-03 from `https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer?f=pjson`: layers 3/5/7 (Day 1 tornado, hail, wind probability), 2/4/6 (conditional intensity), 11/13/15 and 10/12/14 (Day 2), 19 and 18 (Day 3), 21-25 (Days 4-8); `src/lib/overlays/spc.ts:15` reads layer 1 only; RadarScope and MyRadar release notes in `RESEARCH.md`.
  Touches: `src/lib/overlays/spc.ts` (a day and hazard choice; probability polygons with the hatched conditional-intensity overlay), `src/panels/MapOptionsPanels.tsx` (day and hazard selector), legends (SPC's own percentages and colours), `src/lib/layerProvenance.ts` (`kind: forecast` with issue and valid), `src/i18n/*`, `src/lib/overlays/spc.test.ts` fixtures, the `spc` live contract (after `AUD-207`).
  Acceptance: A reader can choose Day 1 tornado, hail or wind probability, Day 2 the same, Day 3 probability or any of Days 4-8, and see percentage bands in SPC's colours with the significant area hatched; the popup names issue and valid times; the Day 1 categorical stays the default; a fixture e2e switches hazard and asserts the legend changes.
  Complexity: M

- [ ] AUD-216 (P2): Outlooks and storm reports at the replayed time
  Why: Replay draws archived warnings and radar for a past event, but the SPC layer and storm reports stay in the present, so a reader replaying 2011-04-27 sees today's outlook over that day's radar; WeatherWise made 1990s archive free on 2026-09-03 and Anvil keys outlooks and reports to the replayed window, so this is where the free field is moving.
  Evidence: Verified 2026-09-03 from `https://mesonet.agron.iastate.edu/api/1/openapi.json`: `/nws/spc_outlook.{fmt}` (`day`, `valid`, `cycle`, `outlook_type`), `/nws/lsrs_by_point.{fmt}` (`begints`, `endts`, radius), `/spc_watch_outline.geojson` (`valid`); `src/lib/archiveWarnings.ts:33` already reads this host; `src/lib/overlays/spc.ts` and `reports.ts` are present-only; https://stormtrack.org/threads/weatherwise-adds-free-archived-radar.33509/; https://github.com/jhammon88219/Anvil.
  Touches: `src/lib/overlays/spc.ts` and `reports.ts` (a replay-time branch keyed on the timeline's parked time, following `useArchiveWarnings.ts`), `src/lib/replayBundle.ts` (carry the outlook and the reports so a bundle replays offline), legends ("as issued {cycle}Z {date}"), `src/i18n/*`, two live contracts on the allowed host, fixture e2e.
  Acceptance: With the timeline parked in the past, the SPC layer draws the outlook valid then with its cycle in the legend, and reports draws the LSRs inside the replayed window; back in the present the live adapters resume without a stale frame; a bundle exported in replay carries both and replays them offline; the IEM host is asked at most once per parked time per layer.
  Complexity: M

- [ ] AUD-217 (P2): The lightning grids on the MRMS bucket
  Why: The app decodes one lightning grid (five-minute NLDN density) and GLM flashes; the same bucket carries the 30- and 60-minute lightning probability, the lightning jump grid, reflectivity at −10 °C and −20 °C (the initiation signal forecasters read) and NLDN at 1, 15 and 30 minutes, all in the packing the decoder already reads; the HWT 2026 experiment ran a "Lightning Stoplight" on exactly these.
  Evidence: Verified 2026-09-03 from the CONUS prefix listing: `LightningProbabilityNext30minGrid_scale_1`, `LightningProbabilityNext60minGrid_scale_1`, `LtgJumpGrid_scale_1`, `LtgJumpGrid_Max_005min_scale_1`, `Reflectivity_-10C_00.50`, `Reflectivity_-20C_00.50`, `NLDN_CG_001min`/`015min`/`030min_AvgDensity`; `src-tauri/src/mrms.rs:533-725` holds `NLDN_CG_005min` only; https://inside.nssl.noaa.gov/ewp/; https://github.com/cwmac/mrms-viewer.
  Touches: `src-tauri/src/mrms.rs` (table rows, ramps for percent and sigma), `src/lib/providers/mrms.ts`, `src/panels/RadarProductPanel.tsx` (a lightning group: density window, probability window, jump, isothermal reflectivity), legends, `src/lib/layerProvenance.ts` (probability is `forecast`), `src/i18n/*`, `mrms::tests::every_product_decodes`.
  Acceptance: Each product draws with a measured ramp and its unit; the probability layers say they are a 30- or 60-minute forecast; the −10 °C reflectivity legend says what it signals; the jump grid draws in sigma with the WDTD threshold noted; `every_product_decodes` covers all nine; cache slots count one per switch group.
  Complexity: M

- [ ] AUD-218 (P2): MRMS reflectivity, correlation and differential reflectivity at a chosen height
  Why: The composite is the column's maximum; a reader who wants the picture at 3 km or the ZDR column at 6 km has nothing, and the bucket carries the merged 3D cube at 33 heights for reflectivity, RhoHV and ZDR in the packing already decoded; HookEcho draws CAPPIs from single volumes, and a national one at 1 km would be the first in the field.
  Evidence: Verified 2026-09-03 from the CONUS prefix listing: `MergedReflectivityQC_00.50` … `_19.00`, `MergedRhoHV_00.50` … `_19.00`, `MergedZdr_00.50` … `_19.00` (33 levels each); the fold and table machinery in `src-tauri/src/mrms.rs:1055-1218`; https://github.com/d4vid87/hookecho (CAPPI).
  Touches: `src-tauri/src/mrms.rs` (a level parameter on a product family rather than 99 table rows; the cache slot rule counts one per family), `src/lib/providers/mrms.ts`, `src/panels/RadarProductPanel.tsx` (a height slider in the reader's units), legends (height named), `src/i18n/*`, `every_product_decodes` sampling three levels per family.
  Acceptance: A national reflectivity picture at any of the 33 heights draws under the same ramp, with RhoHV and ZDR selectable at the same height; the slider names the height in the reader's units; the cache counts one slot for the family; the live test decodes 0.5, 3.0 and 10.0 km for each field.
  Complexity: M

### P3

- [ ] AUD-235 (P3): The Forecast panel is only ever scanned saying it is unavailable
  Why: Every other surface the accessibility gate opens is now scanned with real content in it, either in the gate itself or in the spec that builds the state. Forecast is the exception: nothing in `e2e/` stubs a forecast, so the panel under every scan reads "Forecast is unavailable. The radar and map are still live." The rows, the day headings, the temperature ranges, the precipitation bars and the model note have never been through axe in any theme.
  Evidence: Verified 2026-09-03 by opening each surface through `e2e/support/surfaces.ts` and dumping the dialog's text: `forecast` is 77 characters and is the unavailable line. `grep -rn 'name: "Forecast"' e2e/*.spec.ts` finds one hit, in `sounding.spec.ts`, which uses the button to switch the sounding source rather than to read a forecast.
  Touches: a forecast fixture in `e2e/support/fixtures.ts` (the panel reads the NWS gridpoint forecast, so a stub belongs beside the other host stubs), and an `expectClean` in the spec that uses it, the way `sounding`, `guidance`, `history`, `level2` and `storm-search` now do.
  Acceptance: A spec renders the Forecast panel with rows in it and scans it clean in dark and in light; planting a contrast fault scoped to a forecast row turns that scan red and leaves the other surfaces green.
  Complexity: S

- [ ] AUD-219 (P3): Split `level2.rs` before the derived products land
  Why: The file is 6,467 lines and four open items (`AUD-189`, `AUD-190`, `AUD-191`, `AUD-192`) all land in it; a split into listing, decode, render, loop and status modules costs nothing now and a great deal after.
  Evidence: `wc -l src-tauri/src/level2.rs` (6,467 on 2026-09-03, up from 6,328 on 2026-09-02); the 2026-09-02 research assessment said the split should precede the derived products and no item carried it.
  Touches: `src-tauri/src/level2/{mod,listing,decode,render,loop,status}.rs`, `src-tauri/src/lib.rs` paths, tests move with their code, the working notes' architecture line, `docs/architecture.md`.
  Acceptance: No file under `level2/` exceeds 2,000 lines; `cargo test` passes the same count; clippy is clean; the four derived-product items name their target module.
  Complexity: M

- [ ] AUD-220 (P3): Tests for the twelve panels that have none
  Why: Coverage floors are 63/56/57/64 and the panels are most of what is missing; twelve panels have no sibling test, so their empty, loading and error states are held only by e2e specs that stub the world.
  Evidence: `src/panels/` listing against `*.test.tsx` on 2026-09-03: CuriositySection, ExportPanel, GuidancePanel, IncidentPackManager, JournalSection, MapOptionsPanels, RecapSection, RoutePanel, SearchPanel, SoundingPanel, TidesPanel, UtilityPanels; `vitest.config.ts:34-47`.
  Touches: one `*.test.tsx` per panel, `vitest.config.ts` floors.
  Acceptance: Each panel has a sibling test covering its empty, loading and error states with the catalogue's copy; every floor rises by at least two points and none falls.
  Complexity: M

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



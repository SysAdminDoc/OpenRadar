# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items, including `AUD-001`, `AUD-002`, and `AUD-011` through `AUD-066`, are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

Items numbered `AUD-` come from the audit register and are ordered P0 through P3. Items numbered `JOY-` come from a separate 2026-08-31 intake about character and personalization, and they live in their own section. Nothing in that section outranks a correctness, security, or release item. `AUD-093` onward and `JOY-021` were added by the 2026-08-31 evening research pass and sit under Research-Driven Additions at the end, each carrying its own priority.

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

Two things to know before draining. First, most of what follows lives where the e2e suite cannot see: inside the packaged Tauri window (the ACL, the opener plugin, the asset protocol) and in the light theme with a panel open (the axe gate scans panels in dark only). Second, the browser probe that found the light-theme items is not in the repo; the acceptance lines say what to assert instead.

### P1

### P2

### P3

- [ ] AUD-162: The axe gate never scans most of the app
      Category: testing
      Where: `e2e/accessibility.spec.ts`
      Problem: The gate scans 11 panels in dark, and the light theme, calm and high contrast only on the bare workspace. Never scanned: Commands, History, Guidance, Tides, Sounding, Cross-section, Radar Products, Settings with a watched place or a custom sound, the record with rows, incident packs, toasts, the catch-up and curiosity cards, the first-run reveal, the capture layout, the ambient view, dual pane, map popups, the glance page, French and the pseudolocale, text scale 115 and 130, and the fatal screens. Every light-theme finding above (AUD-130, 131, 134, 140, 141, 142) sits in a state the gate has never opened.
      Evidence: The spec read against the 18 surfaces in `src/components/PanelSurfaces.tsx:200-417`; the probe's light-theme axe runs with panels open produced the violations listed above while the committed gate stays green.
      Fix: Loop the existing panel test over all 18 surfaces, in dark, light and light plus `contrast: "more"`; scan Settings after adding a watched place; scan the glance page with a stubbed record; scan the capture and ambient layouts; scan at 130 percent text scale.
      Acceptance: The spec lists every `SurfaceId` (a test asserts the loop covers the union type), and the light-theme run is red until AUD-130 through AUD-142 land.
      Confidence: Verified
      Effort: M

### Unaudited, needs a pass

These could not be observed in this pass, which ran headless browser automation and read the packaged binary's configuration but did not drive the installed app on a screen. Each is a place where the e2e suite also cannot see.

- [ ] AUD-165: Installed-build behaviour of the tray icon, the glance window, the desktop wallpaper, the updater and incident packs
      Category: testing
      Where: `src-tauri/src/tray.rs`, `glance.rs`, `wallpaper.rs`, `src/lib/updates.ts`, `src-tauri/src/incident_packs.rs`
      Problem: None of these run in the browser suite. The three P1/P2 ACL findings above were found by reading the capability file; whether the icon really disappears on switch-off, whether the wallpaper restore holds across a reboot, whether the passive-mode updater relaunches cleanly and whether a pack survives a pause and a restart have never been observed on a machine, only reasoned about.
      Evidence: `e2e/` stubs `__TAURI_INTERNALS__` in every desktop-flavoured spec; the audit rules forbid driving the reader's screen.
      Fix: A checklist run on a virtual desktop or a second session, recorded in the working notes: tray on/off/on, glance from the tray in French, wallpaper on then off then reboot, an update from 0.6.0 to 0.7.0, a pack paused mid-download and resumed after a restart.
      Acceptance: Each step observed and noted, with any defect logged here.
      Confidence: Needs-repro
      Effort: M

- [ ] AUD-166: Long-session memory and the two-day-old cached view
      Category: perf
      Where: `src/hooks/useRadarTimeline.ts`, `src-tauri/src/cache.rs`, the map's tile sources
      Problem: The product is meant to be left open on a second monitor for days. Nothing in this pass ran longer than a few minutes; whether the webview's memory stays flat over a day of loops, palette changes and panel opens is unmeasured.
      Evidence: No soak test exists in `e2e/` or `scripts/`.
      Fix: A soak script that opens the workspace, runs the loop at the slowed ambient cadence for eight hours with a stubbed radar host, and samples `performance.memory` and the Rust process RSS every ten minutes.
      Acceptance: A recorded run with flat memory, or a leak logged here with the sampler's trace.
      Confidence: Needs-repro
      Effort: M

## Research-Driven Additions

Added by the 2026-09-02 research pass (`RESEARCH.md` of the same date carries the evidence). Numbered on from `AUD-168`. Every host named below is either already in `ALLOWED_HOSTS` or is named in the item, and any new one needs the ledger row, the CSP entry and a `check:live` contract like the rest. Nothing here outranks an open audit item of the same priority.

### P1

- [ ] AUD-201 (P1): The rest of the single-site loop
  Why: AUD-170 shipped the loop itself: the native side lists a site's recent volume times, the timeline's own scrubber picks the volume each step belongs to, and a decoded volume is held rather than fetched twice. Four parts of that item's acceptance did not ship, and each is a place where the loop is visibly half a feature.
  Evidence: `src/hooks/useSingleSiteRadar.ts` (the loop effect, which draws a volume per step); `src/lib/siteLoop.ts` and its tests; `src-tauri/src/level2.rs` `recent_times` / `level2_recent_times`. `e2e/level2.spec.ts` proves the listing is asked for and NOT that a scrub draws an older volume: the mosaic frame count in that spec comes from a live-shaped provider stub and changes underneath a scrub, so the assertion could not be held still.
  Touches: `e2e/level2.spec.ts` (a deterministic frame list for that spec, then a real three-volume scrub), `src/lib/settings.ts` and the Settings panel (the loop length, ten by default and thirty at most, which is `DEFAULT_LOOP_VOLUMES` today and settable by nobody), `src/lib/export.ts` (a saved loop follows the site series rather than the mosaic's), `src/lib/provenance.ts` (one record per volume rather than one for the sweep on screen), `src/components/WorkspaceChrome.tsx` (the legend says which volume of how many).
  Acceptance: A browser test scrubs a stubbed three-volume site loop and asserts the volume time in the legend changes with the step; the loop length is a setting between one and thirty; a saved loop of a held site contains the site's own volumes; each frame carries its own provenance record.
  Confidence: Verified
  Effort: M

### P2

- [ ] AUD-172 (P2): German warnings from the DWD, drawn and watched
  Why: The DWD composite is on the map and nothing says a Gewitterwarnung stands over it; the warning polygons are keyless, CORS-open and on a host already allowed.
  Evidence: Verified live 2026-09-02: `https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dwd:Warnungen_Gemeinden&outputFormat=application/json` (CORS `*`, CAP-style properties `EVENT, SEVERITY Minor|Moderate|Severe|Extreme, ONSET, EXPIRES, HEADLINE, DESCRIPTION, INSTRUCTION, EC_AREA_COLOR`); also `dwd:Warnungen_Landkreise`, `_Kueste`, `_Binnenseen`; CC BY 4.0 with "Datenbasis: Deutscher Wetterdienst" and the BKG geometry credit carried in `EC_LICENSE`.
  Touches: new `src/lib/overlays/dwd-warnings.ts`, `registry.ts`, `alertTypes.ts` (DWD `EC_GROUP`/`EVENT` onto hazard buckets), `useAlertWatch.ts`, `docs/asset-ledger.md`, live contract, three catalogues.
  Acceptance: Over Germany the alerts layer shows DWD polygons in `EC_AREA_COLOR` with headline, description and instruction in the popup; a watched place inside one announces; both credits are in the popup and the ledger; a fixture e2e covers a Hamburg warning.
  Complexity: M

- [ ] AUD-173 (P2): Read radar site status from the NWS rather than inferring it from archive freshness
  Why: The site picker passes over a "down" site by watching whether new archive objects appear, which lags a real outage by minutes and cannot say why; the NWS publishes every RDA's status, operability, alarms and the time Level II was last received.
  Evidence: Verified live 2026-09-02: `https://api.weather.gov/radar/stations` (208 features: 159 WSR-88D, 45 TDWR; `properties.rda.properties.status` Operate|Start-Up, `operabilityStatus`, `alarmSummary`, `mode`, `buildNumber`, `latency.levelTwoLastReceivedTime`; CORS `*`, `max-age=120`; KGLD in Start-Up since 2026-08-24); `src-tauri/src/level2.rs:320-323` `LIVENESS` from archive freshness.
  Touches: `src-tauri/src/level2.rs` (`sites_in_reach` consults status), new `src/lib/radarStatus.ts`, `src/panels/RadarProductPanel.tsx` (site list marks down sites and says since when), `src/lib/diagnostics.ts`, live contract for the endpoint (host already allowed).
  Acceptance: A site whose RDA is not `Operate` or whose Level II is older than fifteen minutes is greyed in the picker with the reason and skipped by the nearest-site choice; the legend for a held site says when Level II was last received when that exceeds ten minutes; the status is refreshed at most every two minutes and only while a site view is open.
  Complexity: S

- [ ] AUD-174 (P2): MRMS flash-flood family: QPE-to-FFG ratio, unit streamflow and gauge-corrected QPE
  Why: Flood is the deadliest US hazard and the app's flood story is river gauges and a 1-hour radar-only QPE; the FLASH products say where rain is beating the flash-flood guidance right now, on the same bucket and packing the decoder already reads.
  Evidence: Verified live 2026-09-02 (bucket listing plus section-5 template of the newest files): `FLASH_QPE_FFG01H_00.00` (2-min, 24-bit, also FFG03H/06H/MAX), `FLASH_QPE_ARI01H_00.00`, `FLASH_HP_MAXUNITSTREAMFLOW_00.00` (10-min), `MultiSensor_QPE_01H_Pass2_00.00` and `_24H_`/`_72H_` (hourly), all discipline 209, template 3.0, packing 5.41; units and missing values in the NSSL table (FFG ratio non-dimensional, missing -999; unit streamflow m³/s/km², missing -9999; QPE mm, missing -1).
  Touches: `src-tauri/src/mrms.rs` `PRODUCTS` (:418-540), `src/lib/providers/mrms.ts` `MRMS_PRODUCT_IDS`, ramps with the colour-vision measurement test, `src/lib/legend.ts`, `src/lib/mosaicLegend.ts`, `src/hooks/useMrmsOverlays.ts`, three catalogues, `every_product_decodes` live test.
  Acceptance: Four new products (FFG ratio 1h and 3h, unit streamflow, gauge-corrected QPE 1h/24h/72h as one product with a period switch) draw with legends that read a ratio of 1.0 as "rain equals guidance"; each passes the colour-vision floor; provenance says `observation` with the product's own cadence; the live test prints values against each ramp.
  Complexity: M

- [ ] AUD-175 (P2): MRMS rotation and hail families: merged azimuthal shear, rotation-track durations, VIL density, SHI, POSH, VII
  Why: The app ships one rotation track (60 minutes) and MESH; RadarScope sells shear and hail contours at Tier 2 and WeatherFront at Advanced; the missing grids are on the same bucket.
  Evidence: Verified live 2026-09-02: `MergedAzShear_0-2kmAGL_00.50` and `_3-6kmAGL_` (2-min, 0.005°, 14000x7000, 8-bit), `RotationTrackML{30,120,240,1440}min` and non-ML variants, `VIL_Density_00.50`, `SHI_00.50`, `POSH_00.50`, `VII_00.50`, all template 5.41; `mrms.rs:431` holds only `RotationTrack60min_00.50`; WDTD says mid-level AzShear above 0.01 s⁻¹ is a deep mesocyclone signal.
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

- [ ] AUD-180 (P2): County boundaries as a switchable layer, bundled
  Why: Supercell Wx #14 (three reactions) and every GRLevelX and RadarScope map draw counties, because warnings and storm reports are read by county; none of the eight map styles here has them.
  Evidence: `src/lib/mapStyles.ts:16-59` and the OpenFreeMap styles carry no US county lines; US Census `cb_2024_us_county_20m.zip` is 879 KB (2025-04-10) and public domain; the app already bundles HURDAT and tide stations the same way.
  Touches: `scripts/build-counties.mjs` (shapefile to simplified GeoJSON or PMTiles under `public/`), `src/lib/mapLayers/vector.ts`, `src/lib/layerStack.ts` (under overlays, over the basemap), `src/panels/MapOptionsPanels.tsx`, `docs/asset-ledger.md` (bundled row), `scripts/bundle-budget.mjs` if it lands in a chunk.
  Acceptance: A Counties switch draws state and county lines that follow the theme's line token and thicken under high contrast, off by default, at or below one megabyte on disk, with the Census credit in the ledger; the layer is in the provenance table and the layer-stack test.
  Complexity: S

- [ ] AUD-181 (P2): KML and KMZ import in the Upload panel
  Why: Supercell Wx #655 asks for it, NHC and NWS publish shapefiles and KML, and the app already parses HMS placemarks from KML for the smoke layer, so the parser is half built and unshared.
  Evidence: `src/lib/workspaceOverlays.ts:46` and `src/panels/UtilityPanels.tsx:63` accept GeoJSON, placefile and `.pal`; `src/lib/overlays/smoke.ts` parses KML placemarks inline.
  Touches: new `src/lib/kml.ts` (Placemark, Point, LineString, Polygon, MultiGeometry, Style colours, KMZ via a bounded zip read), `smoke.ts` (use it), `workspaceOverlays.ts`, `UtilityPanels.tsx`, `src-tauri/src/exports.rs` if a KML export follows, catalogues.
  Acceptance: Dropping a `.kml` or `.kmz` on the window adds it to the imported set with its own name, switch, opacity and colours, bounded by the same size and shape limits as GeoJSON; the smoke layer's parser is the shared one; a malformed file is refused with the reason and nothing on the map changes.
  Complexity: M

- [ ] AUD-182 (P2): Placefile icons, images, time ranges and thresholds
  Why: `Icon`, `IconFile`, `Image`, `TimeRange` and `Threshold` are what METAR, Spotter Network and lightning placefiles are made of; the parser skips or ignores them, so most published placefiles load as a few lines and text.
  Evidence: `src/lib/placefile.ts:175-185` steps over `Object`, `Icon`, `IconFile`, `Font` and drops `Triangles`, `Image`, `Threshold`, `TimeRange` on the default branch; HookEcho's roadmap lists placefile `Image:` as its next item; the GRLevelX placefile ecosystem is the documented switching lever.
  Touches: `src/lib/placefile.ts`, `src/lib/mapLayers/vector.ts` (symbol layers from sprite sheets built from `IconFile`), `src/lib/workspaceOverlays.ts` (`Threshold` by zoom, `TimeRange` by frame time), fixtures under `src/lib/` tests, catalogues.
  Acceptance: A placefile using `IconFile`/`Icon` draws its icons from the referenced sheet (fetched only if the host is on the allowlist, else skipped with a named reason), `Threshold` hides features beyond its zoom, `TimeRange` hides features off the current frame time, `Image` draws a georeferenced picture; the loader reports what it skipped as it does today.
  Complexity: M

- [ ] AUD-183 (P2): MP4 (H.264) export beside WebM
  Why: A WebM will not play in iMessage, most email clients or a phone gallery; RadarScope 5.6.1 (2026-09-02) moved its saved video to MP4 for that reason, and WebView2 Evergreen carries an H.264 WebCodecs encoder.
  Evidence: `src/lib/export.ts:117-119` and `src/lib/webm.ts` (VP9/VP8 Matroska writer of our own); WebView2 runtime notes and codec surveys report `avc1` encode available; MP4 needs an ISO BMFF muxer the way WebM needed Matroska.
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

- [ ] AUD-186 (P2): Dependency refresh: MapLibre 6.7, the Tauri plugins, and pmtiles 0.24
  Why: MapLibre 6.7.0 throws a catchable `GPUInitializationError` and adds `{validate:false}` for batch layer work; the updater, notification, log, opener and deep-link plugins are behind; `pmtiles` is eight releases and five breaking changes behind and the incident-pack tests are the only thing that will catch a regression.
  Evidence: `npm outdated` 2026-09-02 (maplibre-gl 6.6.0 → 6.7.0, plugin-updater 2.10.1 → 2.11.0, plugin-notification 2.3.3 → 2.4.0, lucide-react, typescript-eslint); MapLibre CHANGELOG 6.3 to 6.7 (no breaking changes); pmtiles-rs CHANGELOG (0.18 precision, 0.19 features, 0.20 `TileId::new` returns `Result`, 0.23 version validation, 0.24 TLS-root features removed).
  Touches: `package.json`, `src-tauri/Cargo.toml`, `src/lib/gpu.ts` (catch the new error), `src-tauri/src/incident_packs.rs` and `tiles.rs` for the pmtiles API changes, `scripts/bundle-budget.mjs` if sizes move.
  Acceptance: `npm run check`, `npx playwright test` and `cargo test` green on the new versions; the incident-pack round trip test (write, read back, hash) passes on pmtiles 0.24; TypeScript stays at 5.8 by decision, recorded in the working notes.
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

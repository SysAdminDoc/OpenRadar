# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items, including `AUD-001`, `AUD-002`, and `AUD-011` through `AUD-066`, are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

Items numbered `AUD-` come from the audit register and are ordered P0 through P3. Items numbered `JOY-` come from a separate 2026-08-31 intake about character and personalization, and they live in their own section. Nothing in that section outranks a correctness, security, or release item. `AUD-093` onward and `JOY-021` were added by the 2026-08-31 evening research pass and sit under Research-Driven Additions at the end, each carrying its own priority. `AUD-206` through `AUD-232` were added by the 2026-09-03 research pass in their own section at the end.

## P1

## P2

## P3

- [ ] AUD-536 (P3): The live lightning window downloads its fifteen files again every minute
      Category: perf
      Where: `src-tauri/src/lightning.rs` (`lightning_flashes`), `src-tauri/src/http.rs` (`get_bytes`)
      Problem: Each poll lists the hour and fetches all fifteen files of the five-minute window through `get_bytes`, which goes to the network first and keeps the cache only as a fallback. Twelve of the fifteen were already fetched a minute earlier, so a reader with lightning on pulls about nine megabytes a minute (half a gigabyte an hour on a hurricane afternoon, when a GOES-16 file measured 590 KB on average) where one and a half would do. Every file also goes into the shared cache, three new ones a minute at up to two megabytes each, which turns the 256 MB cache over in a few hours and flushes the tiles and grids the offline view is made of. `get_bytes_uncached` exists for exactly this case and its comment names it.
      Evidence: `lightning_flashes` loops `http::get_bytes(&format!("{BUCKET}/{key}"))` over `recent_keys`; `get_bytes_up_to` calls `fetch_bytes` before `cache::get_async`; the listing of `GLM-L2-LCFA/2022/271/19/` on `noaa-goes16` holds 180 files totalling 106,533,372 bytes (2026-09-24).
      Fix: Keep the decoded flashes of the last window's files in memory keyed by file, fetch only the keys not already held, and fetch those uncached.
      Acceptance: Two polls a minute apart fetch three files between them, not thirty, in a test that counts fetches; the shared cache gains no GLM entries.
      Confidence: Confirmed by reading
      Effort: S

- [ ] AUD-166: Long-session memory and the two-day-old cached view
      Note 2026-09-07: Anvil measured this instead of estimating it (commit 0f5972d, 2026-09-04): a retained-geometry sampler walking the frames every 5 s, deduped by ArrayBuffer identity, beside performance.memory. The ceiling was a per-renderer V8 heap cap of about 4,192 MB unrelated to machine RAM, a 26-frame replay retained 2,178 MB, and capping the dual-pol prefetch at 12 frames on that evidence took a 39-frame peak from 3,427 to 2,042 MB. That sampler is the shape this item's soak script wants.
      Note 2026-09-25: `e2e/soak.spec.ts` and `playwright.soak.config.ts` now provide the soak test. The unfinished work is the eight-hour result, Rust RSS and WebView2 child-process sampling, GPU memory, and the Evergreen WebView2 runtime version so measurements remain comparable across restarts.
      Category: perf
      Where: `src/hooks/useRadarTimeline.ts`, `src-tauri/src/cache.rs`, the map's tile sources
      Problem: The product is meant to be left open on a second monitor for days. Nothing in this pass ran longer than a few minutes; whether the webview's memory stays flat over a day of loops, palette changes and panel opens is unmeasured.
      Evidence: The soak test exists, but no recorded eight-hour result or native/GPU trace is committed. (2026-09-03: a 17-point Hacker News thread on the Windows 11 Weather app using 1.2 GB of RAM, https://news.ycombinator.com/item?id=49290078, says a native app should fit in 100 MB; the measured number belongs in the README once this runs. Measure the `msedgewebview2` children, not the Rust process alone.)
      Fix: Extend the soak test to sample `performance.memory`, Rust RSS, every `msedgewebview2` child, GPU memory and the WebView2 runtime version every ten minutes, then record an eight-hour run.
      Acceptance: A recorded run with flat memory, or a leak logged here with the sampler's trace.
      Confidence: Needs-repro
      Effort: M

## Research-Driven Additions

Added by the 2026-09-02 research pass (`RESEARCH.md` of the same date carries the evidence). Numbered `AUD-168` onward; `AUD-168` moved to `Roadmap_Blocked.md` behind the release gate and `AUD-169` through `AUD-172` shipped the same day, with `AUD-201` recording what the loop left unfinished. Every host named below is either already in `ALLOWED_HOSTS` or is named in the item, and any new one needs the ledger row, the CSP entry and a `check:live` contract like the rest. Nothing here outranks an open audit item of the same priority.

### P1

### P2

### P3
  Note 2026-09-04: Retention evidence: a Bluesky reader stays on RadarScope for being "the lightest running" (2026-08-26); Anvil's memory sampler (`0f5972d`) shows a 26-frame replay retaining 2,178 MB, which is the comparison the README number would sit against.
- [ ] AUD-529 (P3): Patches placed a whole interval out, inside a sweep that is right as a whole
  Why: `AUD-192` asked for continuity across tilts to stop the region method flipping regions. Its whole-sweep half shipped as a ring-mean anchor in `dealias.rs` (`whole_interval`), and measured over the recorder's 41 station-days (2026-09-16 to 09-22, six radars, refolded at a third of the limit) it never fired: every sweep came back on its right interval as a whole. What the recorder still shows is patch-level. Of 983,685 folded gates only 249,046 came back to their own branch, and 117,791 gates that never folded were moved.
  Evidence: probed on KDMX 2026-09-18 21:00 after unfolding: branch 0 held 142,830 gates, branch -1 81,371 and branch +1 65,655, while the twelve trusted rings averaged within 1 m/s of zero. KDMX 2026-09-20 (0: 206,474, +1: 110,712, -1: 63,344) and KFWS 2026-09-20 read the same way. Those are whole patches settled an interval off their neighbours, which a whole-picture anchor cannot see and a boundary vote got wrong. The 2026-09-10 note on the one-level vote still applies: the cut above is settled by the same method and fails the same way, so the anchor has to come from the top cut down (R2D2) or from the previous volume (4DD), per patch rather than per sweep.
  Touches: `src-tauri/src/dealias.rs` (a per-patch vote against a reference built from the cut above, starting at the top of the volume), `src-tauri/src/level2/sweep.rs` (hand the settled cut above to the unfolder), the recorder.
  Acceptance: Over the recorder's station-days the share of folded gates back on their own branch rises and `misplaced` falls, with `broken_after` no worse and `invented` still zero; a planted fixture where one patch is placed an interval off its neighbours is put back; runtime per cut stays under half a second.
  Complexity: L

## Research-Driven Additions, 2026-09-03

Added by the 2026-09-03 research pass (`RESEARCH.md` of the same date carries the evidence). Numbered `AUD-206` onward. Every host named below is either already in `ALLOWED_HOSTS` or is named in the item, and any new one needs the ledger row, the CSP entry and a `check:live` contract like the rest. Nothing here outranks an open audit item of the same priority.

### P1

### P2

### P3

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

- [ ] AUD-340 (P3): Colour the national grids on the GPU
      Note 2026-09-07 (evening): MapLibre #7029 (colour-relief styling for any raster) was closed as a duplicate of style-spec #1490, a declarative `encoding` expression; nothing shipped in 6.7 or 6.8, so the `raster-dem` custom encoding stays the route. 6.7.0 moved `color-relief` to `texelFetch` for exact stops and added a `resampling` paint property. `maplibre-contour` derives contour tiles from the same value-encoded raster through `addProtocol`, which is the isopleth follow-on once this lands.
      Note 2026-09-25: The cited monolithic `src-tauri/src/mrms.rs` has been split. The current tile implementation is `src-tauri/src/mrms/tiles.rs`; provider and listing code live beside it under `src-tauri/src/mrms/`.
      Why: Colour is applied in Rust and a palette load, a threshold or a contrast toggle bumps a generation into every tile address and cache key, so each one re-renders and re-fetches the whole screen of tiles. MapLibre has no `raster-color`, and the request for one has been open since 2024-07-31, but 6.7.0 ships a `color-relief` layer over a `raster-dem` source with a custom encoding: the tile carries the value, the style carries the ramp as an expression, and a new ramp is a style change with no fetch. The value under the cursor comes from the same tile.
      Evidence: https://maplibre.org/maplibre-style-spec/sources/ (raster-dem `custom` encoding, `redFactor`, `greenFactor`, `blueFactor`, `baseShift`, added 3.4.0); https://maplibre.org/maplibre-gl-js/docs/examples/add-a-color-relief-layer/ (6.7.0); https://github.com/maplibre/maplibre-gl-js/issues/4479 ; `CLAUDE.md` (the palette generation in the tile address); `src-tauri/src/mrms/tiles.rs` (`tile_from_cache`, `TileLook`).
      Touches: `src-tauri/src/mrms/tiles.rs` (a value-encoded PNG per tile, the missing value below `baseShift`), `src/lib/providers/mrms.ts` and `MapViewport.tsx` (a `raster-dem` source and a `color-relief` layer per product, the ramp built from `src/lib/palette.ts`, the threshold as a transparent stop), the compare pane, the export caption, the between-the-cells smoothing (`b81d5e0`), the readout.
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

- [ ] AUD-496 (P3): MapViewport.tsx sits above the size ceiling under a waiver that only stops it growing
      Category: maintainability
      Progress 2026-09-23: three of the four files are split and their waivers are gone. `App.tsx` 1,561 to 1,464 (`5f8f279`, useStartupNotices and useNotificationPermission), `useSingleSiteRadar.test.tsx` 2,271 to 1,294 plus a historical suite (`3f2a838`, shared fixtures in `src/test/singleSite.ts`), `useSingleSiteRadar.ts` 1,717 to 1,388 (`fc70ff9`, useHistoricalSweep).
      Where: `src/fileSize.test.ts` `ALREADY_OVER`; `src/components/MapViewport.tsx` (3,094 lines).
      Problem: The ceiling of 1,500 lines was set by `AUD-272` and measured only `src/panels` until the gate was widened, so the files that motivated it were never held to it. Widening it without splitting them would have failed the suite on day one, so each was recorded at its current length and may not grow. `MapViewport.tsx` is the last, and the waiver also blocks every feature that would add a lane to it.
      Evidence: Measured by the gate itself, which prints the name and the length of anything over. The waiver expires by itself: a second test asserts every waived file is still over the ceiling, so splitting one below 1,500 fails until its entry is removed.
      Fix: Split along the lanes, which mostly do not read each other: `MapViewportLanes.ts` (night, county, route, ring, flash, ProbSevere, classification, cell, track, custom, placefile icons), `MapViewportRaster.ts` (satellite, surge, radar, wind, MRMS, sweep, smoke, snow), `MapViewportOverlays.ts` (overlays and the popup), `MapViewportTools.ts` (renderTools and the map's pointer and keyboard tools), each a plain function over a bag of refs so every ref and every effect stays in the component and their order does not move. Six gates read moved text by path and have to be repointed: `MapViewportInk.test.ts`, `lineOnMap.test.ts`, `placefileIcons.test.ts`, `mapStyles.test.ts` (keep the one `overLightRef.current =` write), `calm.test.ts` (keep the `MapViewport` prefix in every new name) and `numbers.test.ts` (the `.toFixed(` at the radar lane moves). `overlayOrderChosen` is module state shared by both panes and needs an exported setter.
      Acceptance: `MapViewport.tsx` is under 1,500 lines and its entry is gone from `ALREADY_OVER`, with no behaviour change: the existing tests for it pass unmodified apart from the six repointed paths, and the full browser suite passes.
      Confidence: Certain
## Research-Driven Additions, 2026-09-08 (late evening)

Eleventh research pass, at `8c19165`, an hour after the tenth. It ran the headless UI inspection the tenth had no machine for (108 captures, both themes, both widths, axe and the overflow check on every one: zero violations, zero overflow, so what follows is what a person sees), read the destructive, import and recovery flows in code, and refreshed the academic, platform and curated-list source classes against 2026. Every finding below was verified against the code and, where there is one, the screenshot; `RESEARCH.md` records what was looked at and judged fine or an artefact so it is not re-filed. Items are numbered on from `AUD-461`.

### P2

### P3

### Notes on existing items

- `AUD-295`: the 2026-09-07 sweep of `en.ts` adds these to the list: `export.note` says "Both" under four export buttons (`ExportPanel.tsx:121-168`); `toast.bundleMissing` has no plural block, so one missing frame reads "1 of them could not be fetched and are listed"; `packs.error.httpStatus` and `radar.error.httpStatus` end in a bare status ("could not be reached. 404"); `wpc.serviceStatus` drops the word "service" and the full stop every sibling has; `settings.watching` (`WatchSection.tsx:611`, `:802`) prints raw coordinates where the toast beside it names the place; `toast.placesFull` ("That is every place") has no next step while `settings.placesFull` for the same condition does; `search.none` and `journal.noneMatch` are dead ends beside `history.none` and `palette.none`, which coach; `toast.notABackupBody` refers to "the button beside it", a positional reference; `chrome.nextPiece` says "piece" where every neighbour says volume or sweep; terminology runs two ways for colour table and palette, loop and animation, site and station, tilt (camera) and tilt (radar), and six namings of the watched place. The `{0}` family and the WDTD, isotherm and Title Case points already listed stand.

## Research-Driven Additions, 2026-09-15

Twelfth research pass, at `4bd9e96` with the 2026-09-10 working copy still uncommitted. Six adversarial reads of the 2026-09-09/10 commits, a headless capture run with scrollbars painted, and four external streams; the evidence and the arithmetic are in `RESEARCH.md` of the same date. Items are numbered on from `AUD-497`. Every host named below is already in `ALLOWED_HOSTS`. Nothing here outranks an open audit item of the same priority; `AUD-497` and `AUD-498` come before everything.

### P1



### P2








### P3




### Notes on existing items

- `AUD-445`: the uncommitted 2026-09-10 working copy in `dealias.rs` and `draw_tests.rs` is the `PlacedBy` recorder and the `moved_by_wind` count this item asks for; it compiles with `cargo check --tests` on 2026-09-15. Finish it or stash it before the next drain.
- `AUD-348`: five community posts in one week asked what a non-weather echo was (bird migration, a KPAH artefact, virga, two mosaic rings), so the mask is also an explainer.
- `AUD-351`: Anvil added a Window Mode settings tab with multi-monitor stubbed on 2026-09-14, the first competitor to move on it.
- `AUD-273` (blocked): Tauri `dev` merged #14479 on 2026-09-15, which closes the app through the Restart Manager and `WM_ENDSESSION` during install and update instead of killing it; when it reaches 2.x the store flush and window-state save have to survive that path. Tauri 3.0.0-alpha shipped 2026-09-13 and is not a target.
- The European radar item in `Roadmap_Blocked.md`: a Spanish Omastorm user (#38) read eleven PVOL sites from the anonymous OPERA `openradar-24h` bucket on CloudFerro as ODIM H5 with DBZH and VRADH at five-minute cadence. New evidence, unverified terms, and a third decoder; the verdict stands until someone reads the bucket's policy.
- `AUD-378`: danielway/nexrad is still silent (no commit since 2026-07-21) and now holds two open PRs, #148 and #149; the app's own table remains the route.
- `AUD-166`: the GOES-19 yaw flip on 2026-09-22 (GLM out 16:30 to 17:15 UTC) and the GOES-18 flush on 2026-09-25 (false events 03:00 to 03:10 UTC) are two scheduled gaps a soak run could be timed to cover.

## Research-Driven Additions

### P0

- [ ] AUD-537 (P0): Patch the Tauri IPC and updater trust chain before the next installer
      Why: The locked graph predates a cross-webview IPC isolation fix and does not bind the version in updater metadata to the version covered by the artifact signature.
      Evidence: https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.11.6 ; https://github.com/tauri-apps/tauri/releases/tag/%40tauri-apps%2Fcli-v2.11.5 ; https://github.com/tauri-apps/plugins-workspace/releases/tag/updater-v2.12.0 ; `package-lock.json`; `src-tauri/Cargo.lock`; `src-tauri/tauri.conf.json`; `scripts/release-lib.mjs`.
      Touches: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, both Cargo lockfiles, `src-tauri/tauri.conf.json`, `scripts/release-lib.mjs`, `scripts/release-lib.test.mjs`.
      Acceptance: The locked graph resolves Tauri core at 2.11.6 or newer, CLI at 2.11.5 or newer, and both updater bindings at 2.12.0 or newer; `requireSignedVersion` is true and `allowDowngrades` is false; a fixture signed for 0.13.0 is accepted, while the same artifact and signature paired with manifest version 0.13.1 is rejected; the release gate, tests, audit, and packaged build pass.
      Complexity: M

### P1

- [ ] AUD-538 (P1): Restrict every custom Tauri command to the windows that need it
      Why: `glance.json` promises a read-only window, but commands registered only through `invoke_handler` are callable by every local window unless the build declares command permissions.
      Evidence: https://v2.tauri.app/security/capabilities/ ; https://docs.rs/tauri-build/latest/tauri_build/struct.AppManifest.html ; `src-tauri/build.rs`; `src-tauri/src/lib.rs`; `src-tauri/capabilities/glance.json`.
      Touches: `src-tauri/build.rs`, generated capability schemas and permissions, `src-tauri/capabilities/default.json`, `src-tauri/capabilities/glance.json`, `src-tauri/src/lib.rs`, native ACL tests.
      Acceptance: `AppManifest::commands` declares every custom command; `main` receives only its required generated permissions; `glance` receives only `glance_read`; a drift test fails when `invoke_handler` and the manifest differ; a native test proves `glance_read` succeeds while cache clearing, journal mutation, export, incident-pack deletion, wallpaper, and sound-byte commands return an ACL denial.
      Complexity: M

- [ ] AUD-539 (P1): Isolate GLM NetCDF decoding from the main process
      Why: The committed deep-nesting reproducer overflows the upstream reader's stack, which terminates the process before `catch_unwind` or `spawn_blocking` can recover.
      Evidence: `Roadmap_Blocked.md` (NetCDF recursion); `src-tauri/src/lightning.rs`; `src-tauri/fuzz/reproducers/netcdf-flashes-access-violation.bin`; the existing hidden crash-monitor launch path in `src-tauri/src/lib.rs`.
      Touches: `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/lightning.rs`, GLM tests, crash logging.
      Acceptance: A hidden no-console worker decodes one bounded granule over framed pipes; the committed reproducer kills only the worker, leaves the main test process alive, records a typed decode failure, retains the last good five-minute window, and accepts the next healthy granule; timeouts and oversized worker output are rejected; normal fixtures produce byte-for-byte equivalent flash records.
      Complexity: L

- [ ] AUD-540 (P1): Resolve live warning identity from CAP references before a VTEC transition
      Why: NWS proposes CAP as the primary alert format, while the app keys updates by VTEC and otherwise falls back to a new CAP identifier for every message.
      Evidence: https://www.weather.gov/media/notification/pdf_2026/PNS26-62_Updated_CAP_Transition_aaa.pdf ; https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html ; `src/lib/overlays/alerts.ts` (`parseAlertTags`); `src/lib/watch.ts` (`alertId`); `src/lib/backtest.ts`.
      Touches: `src/lib/overlays/alerts.ts`, a shared CAP-lineage module, `src/lib/watch.ts`, `src/hooks/useAlertWatch.ts`, `src/hooks/useFollowWarning.ts`, `src/lib/backtest.ts`, their tests.
      Acceptance: NEW, UPDATE, and CANCEL fixtures without VTEC resolve through `references` to one stable event; a trim or continuation does not replay the new-warning sound; a severity escalation still announces; cancellation removes the event; malformed and cyclic references terminate safely; the bounded lineage cache is shared by live watch and backtesting, with VTEC retained as a fallback.
      Complexity: M

- [ ] AUD-541 (P1): Add an explicit Level III Bandwidth Saver for held-site base products
      Why: A 2026-09-25 KTLX sample made the selected Level III product about 97 percent smaller than the matching Level II volume, and weak-cellular operation is a repeated field complaint.
      Evidence: https://unidata-nexrad-level3.s3.amazonaws.com/?list-type=2&prefix=TLX_N0B_2026_09_25&max-keys=5 ; https://unidata-nexrad-level2.s3.amazonaws.com/?list-type=2&prefix=2026/09/25/KTLX/&max-keys=5 ; https://github.com/meridianstudios/auros ; `src-tauri/src/level3.rs`.
      Touches: `src-tauri/src/level3.rs`, `src-tauri/src/level2/`, `src/hooks/useSingleSiteRadar.ts`, `src/lib/level2.ts`, `src/lib/settings.ts`, `src/panels/RadarProductPanel.tsx`, provenance and translations.
      Acceptance: An explicit Bandwidth Saver setting maps every supported base product and elevation to Level III, shows source, code and observed time, and never falls back silently; whole-volume products provide a Load Level II action; a recorded 30-minute KTLX contract transfers at least 90 percent fewer radar bytes for one selected base product; tests cover UTC rollover, missing cuts, stale data, unsupported products, and switching back to Level II.
      Complexity: L

### P2

- [ ] AUD-542 (P2): Upgrade MapLibre to 6.11.2 and close the imported-attribution test gap
      Why: Releases after the locked 6.10.0 add worker-error propagation, stricter attribution sanitization, memory fixes, projection performance work, and sharp raster backing stores at fractional device pixel ratios.
      Evidence: https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.11.0 ; https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.11.1 ; https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.11.2 ; `src/lib/incidentPacks.ts`; `src/lib/mapStyles.ts`.
      Touches: `package.json`, `package-lock.json`, `src/lib/mapStyles.test.ts`, `src/lib/incidentPacks.test.ts`, `src/components/MapViewport.tsx`, packaged visual fixtures.
      Acceptance: The lock resolves 6.11.2; attribution strips scripts, event handlers, `javascript:` URLs, SVG, MathML, and nested controls while retaining plain links and basic emphasis; worker-load errors reach the existing log and visible error path; radar, satellite, surge, and imported PMTiles remain sharp in a packaged capture at device scale 1.25.
      Complexity: S

- [ ] AUD-543 (P2): Freeze NEXRAD Build 25 LTR compatibility before 2027-02-15
      Why: SCN26-54 adds Level II record type 30 after end-of-volume, and the current decoder path has no real Build 25 file proving the extra record cannot disturb frames, timing, or chunk assembly.
      Evidence: https://www.weather.gov/media/notification/pdf_2026/scn26-54_WSR-88D_Level2_Add_LTR.pdf ; https://www.roc.noaa.gov/public-documents/icds/2620010K_draft.pdf ; `src-tauri/src/level2/decode.rs`; `src-tauri/src/chunks.rs`; the pinned `nexrad` release in `src-tauri/Cargo.lock`.
      Touches: `src-tauri/src/level2/decode.rs`, `src-tauri/src/level2/section.rs`, `src-tauri/src/chunks.rs`, Level II fixtures and tests, release live contracts.
      Acceptance: A frozen KCRI Build 25 sample passes full-file, range, and chunk paths; type 30 is skipped or decoded without error; type 31 radial counts, tilts, timestamps, volume boundaries, and Nyquist tables match an equivalent file without LTR; no phantom frame appears; raw export remains byte-identical; nested compression and decoded-length limits are exercised.
      Complexity: M

- [ ] AUD-544 (P2): Include the archive instant in shared radar links
      Why: Historical scans are actively shared for review and teaching, but current links preserve the view without the time and can reopen on live radar.
      Evidence: https://github.com/FahrenheitResearch/meowdar-98#archive-links ; https://www.reddit.com/r/tornado/comments/1wdirxg/ ; `src/lib/deepLink.ts`; `src/hooks/useHistoricalSweep.ts`.
      Touches: `src/lib/deepLink.ts`, `src/hooks/useHistoricalSweep.ts`, `src/hooks/useSingleSiteRadar.ts`, share UI and desktop deep-link tests.
      Acceptance: Sharing a historical view adds `archiveAt=<UTC ISO timestamp>` with the site, product, tilt and camera; opening it selects the nearest valid volume at or before that instant and never falls back to live data; existing links still work; tests cover browser and desktop URLs, UTC midnight, invalid timestamps, and missing objects.
      Complexity: S

- [ ] AUD-545 (P2): Add a concise interpretation guide for every selectable radar product
      Why: The app exposes specialist products without consistently saying what they measure, when they help, or what they cannot prove, which is a repeated beginner complaint.
      Evidence: https://www.weather.gov/jan/dualpolupgrade-products ; https://training.weather.gov/wdtd/courses/dualpol/Outreach/ ; https://www.weather.gov/media/crp/QuickReference-MediaGuide.pdf ; `src/lib/level2.ts`; `src/panels/RadarProductPanel.tsx`.
      Touches: `src/lib/level2.ts`, a typed guide catalogue, `src/panels/RadarProductPanel.tsx`, derived-product metadata, all four locale files, accessibility and coverage tests.
      Acceptance: Every selectable base and derived product has localized Measures, Useful for, and Cannot establish text grounded in its actual algorithm; the guide opens by keyboard and touch without hover; a catalogue test fails for missing product IDs or locales; derived entries cite the implementation or source method in the in-app provenance view.
      Complexity: M

- [ ] AUD-546 (P2): Add NOAA experimental inland inundation extent as an official raster layer
      Why: NOAA now publishes hourly analysis and five-day NWM and RFC maximum inundation extents, which add areal inland flood context not supplied by gauges, surge, or excessive-rain risk.
      Evidence: https://www.weather.gov/media/notification/pdf_2026/pns23-55_Updated_Exp_FIM_Services_ExtExp2026_aad.pdf ; https://maps.water.noaa.gov/server/rest/services/nwm/ana_inundation_extent/MapServer ; https://maps.water.noaa.gov/server/rest/services/rfc/rfc_based_5day_max_inundation_extent/MapServer ; `src/lib/overlays/rivers.ts`; `src/lib/surge.ts`.
      Touches: a FIM adapter, `src/lib/overlays/registry.ts`, the existing raster lane, `src/lib/settings.ts`, `src/panels/LayersPanel.tsx`, `src-tauri/src/http.rs`, `src-tauri/tauri.conf.json`, `docs/asset-ledger.md`, live contracts and all locale files.
      Acceptance: Analysis, NWM five-day maximum, and RFC five-day maximum use fixed MapServer export endpoints rather than an unpaged feature query; each shows reference time, update time, NOAA attribution, Experimental, Extent not depth, and Not an official warning; outside-coverage and unavailable states never read as clear; metadata and image contracts plus mocked visual tests pass.
      Complexity: L

- [ ] AUD-547 (P2): Add WPC surface analysis through a fixed allowlisted adapter
      Why: Fronts, drylines, troughs, and pressure centers add official mesoscale context that radar cannot supply, and WPC publishes a three-hourly transparent analysis series.
      Evidence: https://www.wpc.ncep.noaa.gov/kml/kmlproducts.php ; https://www.wpc.ncep.noaa.gov/kml/conus_png/conus_analysis_latest_transparent.kml ; https://www.wpc.ncep.noaa.gov/html/fntcodes2.shtml ; `src/lib/kml.ts`.
      Touches: a WPC surface adapter, `src/lib/overlays/registry.ts`, the existing raster lane, `src/panels/LayersPanel.tsx`, `src-tauri/src/http.rs`, CSP, asset ledger, cache policy, live contracts and translations.
      Acceptance: The adapter renders the latest analysis and advertised past-24-hour set from fixed WPC URLs, shows issue and valid time with stale state, and hides with an explanation when historical radar predates available analyses; fixture tests cover bounds, URL allowlisting, UTC rollover and malformed KML; arbitrary NetworkLink remains unsupported.
      Complexity: M

### P3

- [ ] AUD-548 (P3): Show scan metadata that changes how velocity should be read
      Why: VCP, exact elevation, Nyquist velocity, and unambiguous range explain cadence, available cuts, and velocity folding, but the decoder's values are not visible in the main readout or export provenance.
      Evidence: https://github.com/kerryhatcher/rustywx ; https://www.grlevelx.com/manuals/gr2analyst/window_info.htm ; `src-tauri/src/level2/`; `src/panels/RadarProductPanel.tsx`.
      Touches: Level II response types, `src/hooks/useSingleSiteRadar.ts`, `src/panels/RadarProductPanel.tsx`, legend/readout components, `src/lib/provenance.ts`, export sidecars and translations.
      Acceptance: The held-site view and export provenance show VCP, exact elevation, Nyquist velocity and unambiguous range when present; absent values read Unavailable rather than zero; split-cut and live-chunk tests prove metadata cannot leak from the prior cut or volume.
      Complexity: S

- [ ] AUD-549 (P3): Derive README build requirements and fuzz inventory from manifests
      Why: README currently says Rust 1.85 while Cargo requires 1.90 and names seven fuzz targets while the manifest defines eight, so the existing prose-only gate passes contradictory setup instructions.
      Evidence: `README.md:251`; `README.md:291`; `src-tauri/Cargo.toml` (`rust-version`); `src-tauri/fuzz/Cargo.toml` (`[[bin]]`); `src/lib/docs.test.ts`.
      Touches: `README.md`, `src/lib/docs.test.ts`.
      Acceptance: README states the manifest's Rust 1.90 minimum and names all eight fuzz targets including `pmtiles_archive`; the documentation test parses `rust-version` and every fuzz `[[bin]].name` from the manifests and fails when either drifts.
      Complexity: S

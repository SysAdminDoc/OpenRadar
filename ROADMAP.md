# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items, including `AUD-001`, `AUD-002`, and `AUD-011` through `AUD-066`, are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

Items numbered `AUD-` come from the audit register and are ordered P0 through P3. Items numbered `JOY-` come from a separate 2026-08-31 intake about character and personalization, and they live in their own section. Nothing in that section outranks a correctness, security, or release item. `AUD-093` onward and `JOY-021` were added by the 2026-08-31 evening research pass and sit under Research-Driven Additions at the end, each carrying its own priority. `AUD-206` through `AUD-232` were added by the 2026-09-03 research pass in their own section at the end.

## P1

## P2

- [ ] AUD-531 (P2): A pilot report of light-to-moderate turbulence is drawn as light icing
  Why: `worse()` in `src/lib/overlays/aviation.ts` ranks a PIREP intensity by its place in `SEVERITY_WORDS`, which is the G-AIRMET list (`lgt`, `lt-mod`, `mod`, `mod-sev`, `sev`). The PIREP spellings `lgt-mod`, `trc`, `extm`, `sev-extm`, `mod-extm`, `trc-lgt`, `smth-lgt` and `hvy` are not in it, so `indexOf` answers -1 and sorts below light. A report of `TB LGT-MOD / IC LGT` is drawn as light icing and the turbulence is thrown away. `hazard: drawn === icing ? "ICE" : "TURB"` also compares values, so `TB MOD / IC MOD` is labelled icing. `EXTM`, `SEV-EXTM`, `MOD-EXTM`, `TRC-LGT` and `HVY` have no phrase and reach a reader as the letters, and the International SIGMET spellings `VA`, `TC` and `MTW` have none either.
  Evidence: a review on 2026-09-10 read `EXTM` and `SEV` live on MapServer layer 0 `turbulence_intensity` and `MOD` on `icing_intensity`, and `MOD-EXTM` and `TRC-LGT` over a 30-day sweep; layer 112 (International SIGMET) answers `hazard` with `ICE, MTW, TC, TS, TURB, VA`. Layer 0 holds about ninety minutes of reports, so a `returnDistinctValues` there is a snapshot, which is why the vocabulary this code was built from missed them. The live contract was green on 2026-09-24 only because none was being published that hour.
  Touches: `src/lib/overlays/aviation.ts` (one ordered PIREP intensity scale for ranking, `worse()` returning which field won, keys for every spelling), `src/i18n/*` (the new phrases), `src/lib/overlays/aviation.test.ts`.
  Acceptance: WHEN a report carries `TB LGT-MOD / IC LGT` the map draws turbulence at light to moderate; WHEN both intensities are equal the hazard is the field that was reported first rather than a guess from the value; every spelling of the FAA PIREP intensity scale and every International SIGMET hazard code has a phrase in all four catalogues, held by a test that lists them from the published scale rather than from a live snapshot.
  Complexity: S

## P3

- [ ] AUD-532 (P3): The lightning jump's rival check keys on which cells are near, not how near
  Why: `rivalsOf` in `src/lib/lightningJump.ts` resets a cell's history when the set of cells within two radii changes. The flashes a cell is given depend on distance, not membership: a neighbour that drifts from 12 to 19 miles away keeps the same set and stops taking the flashes between them, and the cell that inherits them reports a jump with nothing about the weather having changed. The other way round, a third cell 15 miles away that the tracker finds on alternate scans resets the series every other bin, and a real fivefold rise is never reported.
  Evidence: two probes run by a review on 2026-09-10 against `rememberJumps`: a drifting neighbour gave `rate=24 sigma=10.95` from steady flashes; a flickering third cell gave `sigma=null` through a real rise from 10 to 50 a minute. `3fb7dca` changed the coverage floor and sigma threshold and did not touch the rival key. Widening the rival radius to eight radii leaves every test green, so the two-radii figure is held from below only.
  Touches: `src/lib/lightningJump.ts` (a rival key that changes when the share of flashes a neighbour could take changes, or a history rebuilt from stored flashes under the current partition), `src/lib/lightningJump.test.ts`.
  Acceptance: WHEN a neighbour drifts within the two-radius ring far enough to stop claiming flashes it used to, the cell that inherits them does not report a jump; WHEN a distant cell comes and goes on alternate scans without taking any of a cell's flashes, a real rise in that cell is still reported; a test holds the rival distance from above as well as below.
  Complexity: M

- [ ] AUD-533 (P3): Three gates that a planted defect walks past
  Why: `src/fileSize.test.ts` measures `src` only, while `tsc -b` also compiles `e2e` through `tsconfig.e2e.json`, where `e2e/level2.spec.ts` is over two thousand lines; its catalogue check refuses `from "react"` and misses `await import("react")`. `a_tie_point_that_is_not_a_place_is_refused` in `src-tauri/src/snowfall_tests.rs` plants a corner that puts both latitudes off the globe, so only the south check is exercised: deleting both longitude checks and the north one leaves the suite green.
  Evidence: a review on 2026-09-10 planted a 2,001-line `.mts` under `e2e/support` (green), a dynamic React import in `layerCatalogue.ts` (green), and the three snowfall mutations (green).
  Touches: `src/fileSize.test.ts`, `src-tauri/src/snowfall_tests.rs`.
  Acceptance: each of those three plants turns its gate red, proved by planting it; the e2e files already over the ceiling are held at their measured length the way `MapViewport.tsx` is.
  Complexity: S

- [ ] AUD-534 (P3): Four panels draw a loading state without saying they are busy
  Why: `AUD-480` made the accessibility sweep wait on `data-busy` and gave it to five panels. `SoundingPanel.tsx`, `CrossSectionPanel.tsx`, `NearbyPanel.tsx` and `SearchPanel.tsx` also draw a loading state inside `PanelShell` and pass no `busy`, and the sweep opens all four, so the flake `AUD-480` closed can come back on any of them. A reader in a screen reader gets no `aria-busy` there either.
  Evidence: `grep -c "busy=" src/panels/{Sounding,CrossSection,Nearby,Search}Panel.tsx` is 0 for each on 2026-09-24; `e2e/support/surfaces.ts` opens `sounding`, `section`, `nearby` and `search`.
  Touches: those four panels, and a test that a panel drawing its loading state says so.
  Acceptance: WHEN any of the four is waiting on its first answer, the dialog carries `aria-busy="true"` and `data-busy="true"`, and neither once it has an answer or a failure; a test fails if a panel under `src/panels` renders a loading state without passing `busy`.
  Complexity: S

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

- [ ] AUD-530 (P3): Replay the lightning and storm-approach rules, not only the warning watch
  Why: `AUD-344` shipped the backtest for the warning watch (`src/lib/backtest.ts`, the History panel's "What your watch would have said"), and the panel says plainly that lightning and approaching-storm notices can't be replayed. The roadmap item had assumed "the replayed lightning window" existed. It does not: `useLightning` asks the native `lightning_flashes` command for the current window only, and the storm cells have no replay path at all.
  Evidence: `src/hooks/useLightning.ts` (one `invoke("lightning_flashes")`, no time argument); `src/lib/lightningWatch.ts` and `src/lib/approach.ts` are already pure and take a clock, so the rules are ready and the data is what is missing. GLM L2 flash files for past hours are on the public GOES buckets, and the storm tracking product is in the Level III archive the app already reads for other products.
  Touches: `src-tauri/src/lightning.rs` (a window at a past time), the Level III cell reader (reports at past volume times for the replayed site), `src/lib/backtest.ts` (the two rules over those inputs), `WatchBacktest.tsx`, `src/i18n/*`.
  Acceptance: A replayed storm lists the lightning and approach notices each watched place would have had, with the same quiet-hour handling the warnings get; a fixture day with flashes inside a place's radius yields the "started" and "quiet" notices at the right times; the panel stops saying they can't be replayed.
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

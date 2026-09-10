# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items, including `AUD-001`, `AUD-002`, and `AUD-011` through `AUD-066`, are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

Items numbered `AUD-` come from the audit register and are ordered P0 through P3. Items numbered `JOY-` come from a separate 2026-08-31 intake about character and personalization, and they live in their own section. Nothing in that section outranks a correctness, security, or release item. `AUD-093` onward and `JOY-021` were added by the 2026-08-31 evening research pass and sit under Research-Driven Additions at the end, each carrying its own priority. `AUD-206` through `AUD-232` were added by the 2026-09-03 research pass in their own section at the end.

## P1

## P2


## P3

- [ ] AUD-495 (P2): An imported basemap's leaf directories can still panic the parser
      Note 2026-09-10 (late afternoon): the root directory is now covered as well. The gate walks every varint in it at the width the parser reads that field at, refuses a tile-id sum that would overflow the add the parser does without checking, and bounds the zoom before `1 << zoom`; `PackFileBackend` reserves against what the file holds rather than what an entry asked for, which was up to four gigabytes a tile. A ten-minute `cargo fuzz run -O` now reaches the leaf case and nothing else: the remaining panic is `capacity overflow` from a leaf's own entry count.
      Note 2026-09-10 (afternoon): half done. The three archive readers now run on a blocking thread, where a panic out of the leaf walk is caught by the runtime and handed back as a failure instead of unwinding through the tile scheme, so a hostile archive no longer takes anything down: `inspect_archive`, `verify_archive` and `serve_tile` all go through `on_a_blocking_thread`, and a test asserts a panic there comes back as `Worker`. What is not done is this item's own acceptance, which asks for a clean `cargo fuzz run -O`. The target reads the archive directly on purpose, so it still finds the crate's panic, and making that run clean needs either the leaf region validated before the reader sees it or a fix upstream in `pmtiles`.
  Why: The PMTiles fuzz target from `AUD-493` found three crash classes. Two are fixed at this app's own door: a root directory whose offset or length points outside what the reader took, and a root entry count that decides an allocation before an entry is read. The third is in a LEAF directory, which the reader parses on demand inside `get_tile`, and which cannot be checked before the reader sees it without reimplementing the directory walk: a leaf's entry count reaches `vec![DirEntry::default(); n]` and a hostile one panics with "capacity overflow".
  Evidence: `cargo +nightly fuzz run -O pmtiles_archive` on 2026-09-10, which is the shipped profile with overflow checks off, panicked with `capacity overflow` after about 1,500 executions from a seeded corpus. The default profile also panics in `varint-rs` with "attempt to shift left with overflow" at `lib.rs:195` and `:210`; that one is an overflow check and wraps in the shipped build, but the capacity overflow does not. No reproducer file: libFuzzer's Windows fast-fail (0xc0000409) takes the process before it writes the artifact.
  Touches: `src-tauri/src/incident_packs.rs` (`open_archive`, `serve_tile`, `verify_archive`), and either a validation of the leaf region at import time or moving every archive read onto a blocking task where a panic is caught rather than unwound through the runtime.
  Acceptance: A ten-minute `cargo fuzz run -O` from the seeded corpus finds no panic, and the fixture that reproduces one is a test in `incident_packs.rs`.
  Complexity: M

- [ ] AUD-491 (P3): The melting layer drops a named component of the method its threshold comes from
  Why: `src-tauri/src/melting.rs` implements the normalised product of Z, ZDR and one minus rho against a threshold of 0.08, and `AUD-225`'s own Evidence line also names a second-derivative weight of 0.75. There is no second derivative anywhere in the file, so a constant lifted from the published method is calibrated against a quantity this code does not compute.
  Evidence: `git show 835a9de -- ROADMAP.md` for the removed item's Evidence line. The rho term itself is right: `between(-c, -0.97, -0.90)` is arithmetically identical to one minus rho normalised over the same bounds, checked at 0.97, 0.90, 1.0 and 0.5.
  Touches: `src-tauri/src/melting.rs`, `src-tauri/src/melting_tests.rs`.
  Acceptance: Either the second-derivative term is computed and weighted as the method specifies, with the threshold re-checked against real volumes, or the file says in its own words which published variant it implements and why that one has no such term.
  Complexity: M

- [ ] AUD-475 (P3): Three things the KDP pass does to a ray that need measuring against real volumes
  Why: A refutation pass over `AUD-191` found three defects that are real but cannot be tuned from a fixture, the way `AUD-192` could not be. Each needs a recorded run over station-days the way `recording_the_days_unfolding_is_held_against` does for the dealiaser.
  Evidence: (1) `src-tauri/src/kdp.rs` unfolds at most once per ray: `unfold` takes `position()` of the first gate below the fold threshold and is called once, outside the reconciliation loop, and the band clamp runs before that loop so a second wrap is undetectable in principle. A ray accumulating more than 720 degrees of differential phase, which is about 90 km of 4 deg/km rain in a squall line, keeps its second wrap. wradlib runs its unfold inside the iteration loop for exactly this reason. (2) `integrate` writes a value at every gate using `unwrap_or(0.0)`, so the reconciliation re-derives the slope over rays where censored and despeckled stretches are flat plateaus; a measured gate within half a window of a censored block has up to half its window filled with fabricated zero slope, which biases the reading low along every clutter block, blocked sector and echo edge. The `measured` mask keeps those gates from being drawn but not from being averaged into. (3) `unfold`'s over-correction band is `DESPECKLE_GATES * 2`, ten gates, under a comment claiming it is the processing window, which is 29 at quarter kilometre gates. It happens to be enough at 0.25 km and 1.0 km spacing and would leave about eight gates carrying a spurious 360 degrees at 0.125 km. Latent on current NEXRAD dual-pol.
  Touches: `src-tauri/src/kdp.rs`, `kdp_tests.rs`, and a recording harness over stored volumes.
  Acceptance: A ray with two wraps in it comes back continuous in a planted fixture; the reading at a gate half a window from a censored block is within a stated tolerance of the reading at the same gate with the block absent, measured rather than asserted; the over-correction band is derived from the window rather than from the despeckle length. Each change is measured against stored volumes before and after, and a change that does not improve the measurement is not made.
  Complexity: M

- [ ] AUD-473 (P3): The three-body scatter spike, done against real volumes
  Why: `AUD-190`'s note asked for the Lemon 1998 signature as a cheap flag beside the hail size. A first attempt shipped in `1cee4e4` and was taken out again the same session because a refutation pass found it fires on ordinary weak echo: the only conditions were a 60 dBZ core somewhere on the radial, a bin 10 to 30 km behind it reading at or below 20 dBZ, and some cut's beam above 3 km. An isolated supercell with clear-air or biological return behind it flags twenty-one consecutive bins on every radial through the core, under a legend that says large hail is falling now.
  Evidence: the removed `spike` in `src-tauri/src/derive.rs` at `1cee4e4`. What it was missing: the flare starts at the back edge of the core rather than ten kilometres behind it, so the stand-off skipped the real signature and caught the air past it; there was no contiguity requirement, so any weak bin in the window counted; and "aloft" only asked that some cut's beam was high there rather than that the echo is present aloft and absent below, which is what separates a flare from ground return. It also had no positive control: no test in the suite ever made the flag fire.
  Touches: `src-tauri/src/derive.rs`, `derive_tests.rs`, the hail size legend, and a stored volume with a known spike in it.
  Acceptance: A flare is flagged on a stored volume that has one, and no gate is flagged on a stored volume with a 60 dBZ core and clear-air return behind it; the test that proves the first is a positive control that fails when the flag is disabled; the mark is labelled a signature rather than a confirmation.
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

- [ ] AUD-496 (P3): Four files sit above the size ceiling under a waiver that only stops them growing
      Category: maintainability
      Where: `src/fileSize.test.ts` `ALREADY_OVER`; `src/components/MapViewport.tsx` (3,068 lines), `src/hooks/useSingleSiteRadar.test.tsx` (2,294), `src/hooks/useSingleSiteRadar.ts` (1,717), `src/App.tsx` (1,555).
      Problem: The ceiling of 1,500 lines was set by `AUD-272` and measured only `src/panels` until the gate was widened, so the three files that motivated it were never held to it. Widening it without splitting them would have failed the suite on day one, so each is recorded at its current length and may not grow. That stops it getting worse and does not make it better. `useSingleSiteRadar` is the sharpest case: the hook and its test are both over, which is usually what a module doing several jobs looks like.
      Evidence: Measured on 2026-09-10 by the gate itself, which prints the name and the length of anything over. The waiver expires by itself: a second test asserts every waived file is still over the ceiling, so splitting one below 1,500 fails until its entry is removed.
      Fix: Split each along the seam it already has. `MapViewport.tsx` is a stack of independent lanes (vector, raster, cursor, ramps) that mostly do not read each other. `useSingleSiteRadar.ts` holds the volume fetch, the sweep decode and the frame timeline in one hook.
      Acceptance: Each file is under 1,500 lines and its entry is gone from `ALREADY_OVER`, with no behaviour change: the existing tests for each pass unmodified, or a commit says which test was wrong and why.
      Confidence: Certain




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

### Notes on existing items

- `AUD-295`: the 2026-09-07 sweep of `en.ts` adds these to the list: `export.note` says "Both" under four export buttons (`ExportPanel.tsx:121-168`); `toast.bundleMissing` has no plural block, so one missing frame reads "1 of them could not be fetched and are listed"; `packs.error.httpStatus` and `radar.error.httpStatus` end in a bare status ("could not be reached. 404"); `wpc.serviceStatus` drops the word "service" and the full stop every sibling has; `settings.watching` (`WatchSection.tsx:611`, `:802`) prints raw coordinates where the toast beside it names the place; `toast.placesFull` ("That is every place") has no next step while `settings.placesFull` for the same condition does; `search.none` and `journal.noneMatch` are dead ends beside `history.none` and `palette.none`, which coach; `toast.notABackupBody` refers to "the button beside it", a positional reference; `chrome.nextPiece` says "piece" where every neighbour says volume or sweep; terminology runs two ways for colour table and palette, loop and animation, site and station, tilt (camera) and tilt (radar), and six namings of the watched place. The `{0}` family and the WDTD, isotherm and Title Case points already listed stand.

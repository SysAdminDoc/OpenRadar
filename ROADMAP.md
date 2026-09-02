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

- [ ] AUD-167: A map-popup test fails about one run in three under the full suite
      Category: testing
      Where: `e2e/layers.spec.ts:615` (`hands a warning to the layer that explains it`), `playwright.config.ts` (`retries: 0`, `workers: 2`)
      Problem: `expect(page.locator(".map-popup")).toBeVisible()` times out after a click on the middle of the map. It passes every time the file is run alone and every time the compact project is run alone; it failed twice and passed once out of three full three-project runs on 2026-09-02. A test that fails one run in three is a test nobody can read a regression out of, and it cost most of an hour deciding whether a stylesheet change had caused it. The click lands before MapLibre has the alerts fill layer queryable, and nothing in the test waits for that: `data-layer-stack` says the layer was published, not that a query against it will answer.
      Evidence: Full suite at HEAD's stylesheet: 432 passed. Same suite with the stylesheet change: 439 passed 1 failed, twice, then 440 passed. `npx playwright test e2e/layers.spec.ts --project=compact`: 27 passed. `npx playwright test --project=compact`: 217 passed.
      Fix: Wait for the map to answer a query at that point rather than for the layer to exist: poll `map.queryRenderedFeatures` through the existing test hook, or retry the click until the popup appears. Do not paper over it with a longer timeout, and do not turn retries on: a retry hides the next one of these.
      Acceptance: Ten consecutive full-suite runs with no failure in that test, or the underlying wait replaced and the test failing deterministically when the layer is genuinely absent.
      Confidence: Verified
      Effort: S


- [ ] AUD-148: The non-visual data surface and the sounding have no way in except the command search
      Category: ux
      Where: `src/components/CommandBar.tsx` (no button for `nearby` or `sounding`), `src/lib/commands.ts:240-242` (`surface:nearby` registered with search keywords), `e2e/accessibility.spec.ts:143` (comment acknowledging it)
      Problem: Nearby is the panel that answers the map in words for a screen reader, and Sounding is the one meteorologists come for; both open only by searching in Commands. A reader who does not know the word "nearby" never finds the accessible surface, which is the reader it exists for. The rail had room for both in every probe (1440 by 900, 1024 by 680, 1600 by 1000) because it scrolls.
      Evidence: The browser probe's surface tour opened 14 surfaces from the rail and found no button named Nearby or Sounding; both opened through the palette.
      Fix: Add Nearby to the rail's primary group beside Alerts (it is the alerts-and-radar readout in words) and Sounding to the tools group; or, at minimum, add Nearby to the `More` group in the compact layout and mention it in the first-run welcome toast.
      Acceptance: `getByRole("button", { name: "Nearby" })` is visible at 1440 by 900 and reachable in the compact layout's overflow; the accessibility spec opens Nearby from the rail rather than the palette.
      Confidence: Likely
      Effort: S

- [ ] AUD-150: The glance window ignores the light theme
      Category: visual
      Where: `src/glance.css:7-20` (`color-scheme: dark`, fixed `#090b10` / `#e7edf7`), `src/glance.tsx` (never reads `settings.theme`)
      Problem: A reader on the light theme opens a small dark window beside a light workspace. The stylesheet says dark-only is by design ("Dark, quiet, and legible from across a desk"), which is a fair call for an always-on glance, but the reader is never told and the workspace's accent never reaches it either. Once AUD-129 lets the window read settings, following `theme` costs one attribute.
      Evidence: Browser probe of `/glance.html` with `theme: "light"` saved: `html[data-theme]` is null, `.glance` background transparent over a `#090b10` body, text `rgb(231,237,247)`.
      Fix: Either set `data-theme` from the loaded settings and add a light block to `glance.css` (three tokens), or keep it dark and say so in `glance.settingDetail`.
      Acceptance: With `theme: "light"` saved, `html[data-theme="light"]` is set on the glance page and its body is a light surface, or the setting copy says the small window is always dark.
      Confidence: Verified
      Effort: S

- [ ] AUD-159: Dead exports and test-only functions
      Category: maintainability
      Where: `src/lib/cellNames.ts:30` (`nameOf`), `src/lib/classification.ts:26` (`DEFAULT_CLASSIFICATION_PRODUCT`), `src/lib/skewt.ts:188` (`isothermLabel`), `src/lib/thermo.ts:398` (`temperatureAt`): referenced nowhere. Test-only: `alertPairings.groupOf:135`, `alertPairings.UNPAIRED:116`, `hurdat.peakPoint:239`, `occasions.occasionWindows:226`, `palette.paletteColor:161`, `provenance.provenanceValid:190`, `thermo.equivalentPotentialTemperature:160`, `overlays/index.overlayAdapter:25`
      Problem: `noUnusedLocals` cannot see exports, so nothing gates them; the four dead ones are already drifting from the code beside them.
      Evidence: Whole-repo grep per exported symbol, tests included.
      Fix: Delete the four, and either wire the eight into production or move them into their test files.
      Acceptance: A script in `scripts/` (or `knip`) run by `npm run check` reports no unused export outside `src/i18n`.
      Confidence: Verified
      Effort: S

- [ ] AUD-161: Two e2e stubs answer unknown commands with `null`, which crashes Settings the moment a future test opens it
      Category: testing
      Where: `e2e/catch-up.spec.ts:120`, `e2e/glance.spec.ts:29` (bare `return null`); the crash path `src/panels/IncidentPackManager.tsx:150` (`setLibrary(null)` on `incident_pack_set_limit`) and `:268` (`library.packs`)
      Problem: Neither spec opens Settings today, so nothing fails, but the working notes record that this exact fallback took the whole workspace to the error boundary during the wallpaper work. Three other specs handle the two incident-pack commands explicitly and diverge from each other.
      Evidence: The five specs that stub `__TAURI_INTERNALS__` each carry their own `invoke` switch.
      Fix: One `fakeDesktop(page, answers)` helper in `e2e/support/fixtures.ts` that answers the store, journal and incident-pack commands with sane defaults and throws on anything else, so an unhandled command fails the test with its name rather than a `null` deep inside a panel.
      Acceptance: Every spec that sets `__TAURI_INTERNALS__` imports the helper; a spec that invokes an unlisted command fails with that command's name in the message.
      Confidence: Verified
      Effort: S

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

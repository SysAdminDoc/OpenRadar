# Research: OpenRadar

Date: 2026-09-25. Replaces all prior research.

## Executive Summary

OpenRadar is a local-first Windows radar workstation built with Tauri, React, Rust, and MapLibre. Its strongest shape is already broader than the reviewed open-source field: live and archived Level II radar, national grids, derived products, alerts, hydrology, aviation, replay, exports, incident packs, accessibility support, and four interface languages are integrated without an account or paid data feed (`README.md`, `src-tauri/src/lib.rs`, `src/lib/overlays/registry.ts`). The next work should protect those capabilities rather than widen them indiscriminately. Released Tauri fixes expose two concrete trust-boundary gaps, a committed NetCDF reproducer can still kill the main process, NWS is proposing a CAP-first alert future, and a scheduled NEXRAD format addition needs a fixture before 2027-02-15. After those, the best product gains are a low-bandwidth Level III mode, shareable historical views, official inundation and surface-analysis context, and concise product guidance.

Top opportunities, in priority order:

1. **Lock down Tauri IPC, updater metadata, and custom-command permissions.** OpenRadar resolves Tauri 2.11.5 and updater 2.11.0, while Tauri 2.11.6 fixes cross-webview channel leakage and updater 2.12.0 can bind the signed artifact to its declared version. `src-tauri/build.rs` also does not register custom commands with `AppManifest::commands`, so the narrow `glance` capability in `src-tauri/capabilities/glance.json` does not constrain the roughly 70 commands registered in `src-tauri/src/lib.rs`. Verified.
2. **Move GLM NetCDF decoding behind a process boundary.** `src-tauri/fuzz/reproducers/netcdf-flashes-access-violation.bin` causes unbounded recursion in the upstream reader and a stack overflow that `spawn_blocking` or `catch_unwind` cannot contain (`src-tauri/src/lightning.rs`, `Roadmap_Blocked.md`). The existing child-process crash-monitor pattern makes local containment feasible while the upstream defect remains. Verified.
3. **Resolve warning identity from CAP lineage.** NWS PNS26-62 proposes CAP as the primary warning format and possible VTEC discontinuation. `parseAlertTags` currently derives stable identity only from VTEC, while `alertId` falls back to the per-message CAP identifier (`src/lib/overlays/alerts.ts`, `src/lib/watch.ts`). A VTEC-free update or cancellation can therefore look like a new warning. Verified code path; policy transition is proposed, not final.
4. **Add an explicit Level III Bandwidth Saver.** A sampled KTLX Level III base product on 2026-09-25 was about 97 percent smaller than the matching Level II volume, and weak-cellular use is a repeated chaser concern. OpenRadar already has a Level III decoder and bucket access (`src-tauri/src/level3.rs`, `src-tauri/src/http.rs`), so this is a controlled alternate source rather than a new data stack. Verified sample; savings vary by product and scan.
5. **Freeze a NEXRAD Build 25 compatibility fixture.** SCN26-54 schedules Level II LTR record type 30 for about 2027-02-15. `src-tauri/src/level2/decode.rs` and `src-tauri/src/chunks.rs` depend on the pinned decoder's handling of unknown records, but no Build 25 file proves that the added record cannot create a phantom frame or disturb timing. Verified schedule; needs a real KCRI sample.
6. **Upgrade MapLibre to 6.11.2 with hostile-attribution and 125 percent DPI checks.** The locked version is 6.10.0. Releases 6.11.0 through 6.11.2 add worker-error propagation, stricter attribution sanitization, memory fixes, and a fractional-device-pixel-ratio raster fix. Imported PMTiles attribution reaches the map through `src/lib/incidentPacks.ts` and `src/lib/mapStyles.ts`. Verified.
7. **Make historical views shareable.** Current deep links preserve view state but not the archive instant (`src/lib/deepLink.ts`, `src/hooks/useHistoricalSweep.ts`). Meowdar 98 demonstrates a timestamped archive-link contract, and community threads repeatedly share notable historical scans. Verified.
8. **Add official flood extent and surface-analysis context through fixed adapters.** NOAA now publishes hourly NWM inundation analysis and five-day NWM and RFC maximum extents, with expanded experimental coverage announced in PNS23-55. WPC publishes three-hourly fronts, drylines, troughs, and pressure centers. Neither duplicates the point gauges, surge, or excessive-rain layers already present (`src/lib/overlays/rivers.ts`, `src/lib/surge.ts`, `src/lib/overlays/wpc.ts`). Verified; live availability still needs contract tests.
9. **Put interpretation beside every radar product.** The product catalogue is advanced, but the UI mostly names products rather than stating what they measure, when they help, and what they cannot establish (`src/lib/level2.ts`, `src/panels/RadarProductPanel.tsx`). Beginner questions recur across radar communities, and NWS already supplies concise source material. Verified demand signal.
10. **Make README build facts derive from manifests.** `README.md` says Rust 1.85 while `src-tauri/Cargo.toml` requires 1.90, and its fuzz list omits `pmtiles_archive` even though `src-tauri/fuzz/Cargo.toml` defines eight targets. `src/lib/docs.test.ts` checks only the phrase "all eight," so drift passes. Verified.

## Product Map

- **Core workflows:** watch national and held-site radar; inspect tilts, gates, cells, derived fields, cross-sections, and wind profiles; combine alerts with hydrology, aviation, satellite, models, reports, and environmental overlays; replay archives or incident packs; export images, animation, data, and provenance (`README.md`, `src/components/MapViewport.tsx`, `src/hooks/useSingleSiteRadar.ts`, `src/lib/export.ts`).
- **Users:** weather enthusiasts, storm spotters, chasers, streamers, second-monitor users, accessibility users, and people monitoring flood, coastal, winter, fire, air-quality, or aviation conditions (`README.md`, `src/i18n/en.ts`, `e2e/accessibility.spec.ts`).
- **Platform and distribution:** Windows x64, Tauri 2, a current-user NSIS installer, a minisign-style signed updater, system WebView2, and no account or telemetry (`src-tauri/tauri.conf.json`, `scripts/release.mjs`, `src/lib/updates.ts`, `README.md`). The published GitHub release remains v0.4.0 while the repository manifests are v0.13.0 (`CHANGELOG.md`, `package.json`, `src-tauri/Cargo.toml`, `https://github.com/SysAdminDoc/OpenRadar/releases`).
- **Data flow:** the native HTTP boundary uses a fixed host allowlist in `src-tauri/src/http.rs`; browser connections are constrained by the CSP in `src-tauri/tauri.conf.json`; custom protocols serve cached radar, grid, and incident-pack tiles. Core inputs come from NOAA, NWS, Unidata, Iowa Environmental Mesonet, Environment Canada, DWD, MeteoAlarm, USGS, NASA, and public cloud buckets (`docs/asset-ledger.md`, `src/lib/overlays/registry.ts`).

## Competitive Landscape

- **HookEcho:** strong warning narration, GPS integration, and a focused map with an analyst workspace. OpenRadar should copy the explicit warning-message structure and test action, but not bundle a large local voice model when Windows speech voices already support the current locales. Verified at `https://github.com/d4vid87/hookecho`.
- **Omastorm:** fast desktop integration, progressive live behavior, and recent international and aviation work. Its issue history reinforces clean outage states and low-latency newest-sweep handling. OpenRadar should avoid treating its anonymous international sources as ready because provider terms and decoder support remain unresolved in `Roadmap_Blocked.md`. Verified at `https://github.com/wesleygrimes/omastorm`.
- **Supercell Wx:** mature live and archive Level II workflows, alert controls, beam-height context, and Windows packaging. Its long tracker shows real demand for sound-on-escalation, retained decoded data, and export, most of which OpenRadar already addresses. OpenRadar should not copy its broader platform surface before the current memory and desktop gates close. Verified at `https://github.com/dpaulat/supercell-wx`.
- **RadrView:** combines national MRMS with Level II at close zoom and exposes a self-hosted streaming architecture. The source-switch idea supports a Level III Bandwidth Saver, but its server and WebSocket deployment model conflicts with OpenRadar's local-only application boundary. Verified at `https://github.com/cwdaniel/RadrView`.
- **Auros:** proves broad local Level III decoding and adds a NOAA Weather Radio finder. Its product mapping supports Bandwidth Saver. A radio card is useful but lower priority because official transmitter coverage is nominal, not a validated best-signal answer. Verified at `https://github.com/meridianstudios/auros`.
- **Meowdar 98 and BowEcho:** demonstrate newest-first progressive loops, low-data rendering, timestamped archive links, provider health, and many international formats. OpenRadar should adopt the archive-link contract and explicit low-data choice, but not import a provider matrix whose licenses and relays contradict the fixed-host model. Verified at `https://github.com/FahrenheitResearch/meowdar-98` and `https://github.com/FahrenheitResearch/bowecho`.
- **OpenStorm and NexView:** show credible 3D, VR, GPU, and multi-pane analysis. Those are useful references, but 3D remains a poor trade before `AUD-166` proves long-session memory and `AUD-496` splits the 3,094-line map component. Verified at `https://github.com/JordanSchlick/OpenStorm` and `https://github.com/FahrenheitResearch/nexview`.
- **Anvil:** aligns offline basemaps and historical radar with historical outlooks and reports. That validates OpenRadar's incident-pack direction. Its multi-monitor stub also supports the existing `AUD-351`; neither warrants a duplicate. Verified at `https://github.com/jhammon88219/Anvil`.
- **RadarScope:** remains the commercial benchmark for a quick, uncluttered radar view and a low-bandwidth Level III baseline, while Level II and longer archives sit in paid tiers. OpenRadar should preserve a simple path through its breadth rather than turn every analysis tool on by default. Verified at `https://radarscope.zendesk.com/hc/en-us/articles/8991862852754-Upgrading-Your-RadarScope-Experience`.
- **RadarOmega and GR2Analyst:** establish market value for models, WPC analysis, drawing, cross-sections, scan metadata, derived severe-weather products, and longer loops. OpenRadar already covers most of this without a subscription. It should add the missing official WPC context and compact scan metadata, while avoiding a larger always-visible control surface. Verified at `https://www.radaromega.com/`, `https://www.sdsweather.com/PDF/RO_UserGuide_2024NEW.pdf`, and `https://www.grlevelx.com/gr2analyst_3/`.

## Reported Issues

The GitHub tracker is enabled but contains zero open or closed issues, zero pull requests, and no discussions as of 2026-09-25 (`https://github.com/SysAdminDoc/OpenRadar/issues`, `https://github.com/SysAdminDoc/OpenRadar/pulls`). There is no user-reported defect to outrank the verified local findings.

- **Confirmed local bugs and risks:** unrestricted custom commands from the glance webview (`src-tauri/build.rs`, `src-tauri/capabilities/glance.json`, `src-tauri/src/lib.rs`); fatal upstream NetCDF recursion (`src-tauri/src/lightning.rs`, committed reproducer); VTEC-only stable alert identity (`src/lib/overlays/alerts.ts`, `src/lib/watch.ts`); README MSRV and fuzz-target drift (`README.md`, `src-tauri/Cargo.toml`, `src-tauri/fuzz/Cargo.toml`, `src/lib/docs.test.ts`). Verified.
- **Feature requests with outside demand:** low-bandwidth base radar, timestamped archive links, and product interpretation guidance recur across competitor implementations and community threads in Sources. These map to existing decoders and link infrastructure rather than speculative subsystems. Verified.
- **Existing items strengthened, not duplicated:** record the Evergreen WebView2 runtime in `AUD-166`; use `src-tauri/src/mrms/tiles.rs` rather than the deleted monolithic `mrms.rs` in `AUD-340`; keep `AUD-347`, `AUD-351`, `AUD-496`, `AUD-529`, and `AUD-536` as written (`ROADMAP.md`).
- **Reports not carried forward:** global single-site radar remains blocked by source terms and decoder work; a third or fourth pane conflicts with the unresolved memory soak; arbitrary remote KML would widen the network and markup trust boundary; mPING requires credentials and redistribution terms. Verified at `Roadmap_Blocked.md`, `https://github.com/wesleygrimes/omastorm/issues/107`, and `https://mping.ou.edu/static/mping/access.html`.

## Security, Privacy, and Reliability

- **Cross-webview boundaries:** Tauri 2.11.6 binds queued channel payloads and large invoke responses to their originating webview. OpenRadar's main and glance windows make that fix directly relevant (`src-tauri/src/tray.rs`, `src-tauri/capabilities/*.json`, `https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.11.6`). Verified.
- **Custom-command ACL:** plugin capabilities do not automatically constrain commands registered only through `invoke_handler`. `src-tauri/build.rs` must declare the command manifest so generated permissions can give `main` the required commands and `glance` only `glance_read` (`https://docs.rs/tauri-build/latest/tauri_build/struct.AppManifest.html`, `https://v2.tauri.app/security/capabilities/`). Verified.
- **Updater rollback and substitution:** CLI 2.11.5 records the version in the artifact's trusted signature comment; updater 2.12.0 adds backend `requireSignedVersion` and moves downgrade policy out of webview control. `scripts/release-lib.mjs` verifies the signature but does not prove its trusted version equals `tauri.conf.json` (`https://github.com/tauri-apps/tauri/releases/tag/%40tauri-apps%2Fcli-v2.11.5`, `https://github.com/tauri-apps/plugins-workspace/releases/tag/updater-v2.12.0`). Verified.
- **Untrusted decoders:** a stack overflow in `netcdf-reader` terminates the process before Rust can recover. A no-window worker process should decode one granule, return a bounded result, and let the main process retain the last good window if the worker exits abnormally (`src-tauri/src/lightning.rs`, `src-tauri/src/lib.rs`, `Roadmap_Blocked.md`). Verified.
- **Imported markup:** PMTiles metadata can supply attribution that reaches MapLibre. MapLibre 6.11.1 tightened the attribution allowlist and 6.11.2 fixes fractional-DPI raster resampling. Upgrade tests should include active-content payloads and a 1.25 device scale (`src/lib/incidentPacks.ts`, `src/lib/mapStyles.ts`, `https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.11.2`). Verified.
- **Audit baseline:** `npm audit --omit=dev` and `cargo audit` found no unallowed vulnerabilities on 2026-09-25. The transitive `lru` warning is already documented and blocked on the upstream NetCDF dependency chain (`Roadmap_Blocked.md`, `https://rustsec.org/advisories/RUSTSEC-2026-0253.html`). Verified.
- **Privacy:** none of the recommended work adds an account, telemetry, a listening socket, or a general remote-content loader. Fixed official adapters and explicit source modes preserve `src-tauri/src/http.rs` and the CSP as the network policy. Verified design constraint.

## Architecture Assessment

- `src-tauri/src/lib.rs` is both the command registry and a security boundary. Generate command permissions from `src-tauri/build.rs`, keep the capability files authoritative, and add a drift test so a new command cannot silently become callable by every window. Verified.
- `src-tauri/src/lightning.rs` should separate transport, worker supervision, and decode protocol. The worker must have bounded input and output, no visible console, a timeout, and an abnormal-exit path that leaves the UI alive. This contains the upstream recursion without copying an HDF5 parser. Verified.
- `src/lib/overlays/alerts.ts`, `src/lib/watch.ts`, `src/hooks/useAlertWatch.ts`, and `src/lib/backtest.ts` need one CAP lineage resolver. A bounded cache with cycle detection and path compression keeps live polling and replay behavior consistent. Verified.
- `src/components/MapViewport.tsx` remains 3,094 lines and already has `AUD-496`. New FIM and WPC adapters should feed existing raster or overlay lanes rather than add more orchestration to that component. Verified.
- `src-tauri/src/level3.rs` and the Level III bucket already cover the hard part of a low-bandwidth mode. The new boundary is policy: explicit product mapping, no silent Level II fallback, clear disabled states for whole-volume algorithms, byte accounting, and provenance. Verified.
- NEXRAD Build 25 is a migration gate, not a visible feature. Put a real KCRI sample through full-file, range, and live-chunk paths before 2027-02-15 and compare type 31 radials, tilts, volume boundaries, timestamps, and Nyquist tables (`src-tauri/src/level2/`, `https://www.weather.gov/media/notification/pdf_2026/scn26-54_WSR-88D_Level2_Add_LTR.pdf`). Needs live fixture.
- Testing is broad but misses packaged WebView2, updater, custom-command ACL, and restart behavior. The existing native desktop item in `Roadmap_Blocked.md` should use Tauri's Windows WebDriver guidance, capture driver and application logs, and run only in an isolated session (`https://v2.tauri.app/develop/tests/webdriver/`). This is an amendment, not a new checkbox.
- Documentation tests should parse `rust-version` and every fuzz `[[bin]].name` from the manifests. Accessibility and localization already have strong gates; each new guide, FIM state, WPC state, and Bandwidth Saver state must enter all four catalogues and remain available without hover (`src/lib/docs.test.ts`, `src/i18n/coverage.test.ts`, `e2e/accessibility.spec.ts`). Verified.

## Rejected Ideas

- **Cloud sync, telemetry, multi-user state, a plugin marketplace, a hosted service, and mobile clients:** reject because they conflict with the local-only Windows workstation and expand the trusted command and data surface (`README.md`, `src-tauri/src/http.rs`).
- **General remote KML or NetworkLink execution:** reject. Add WPC through a fixed adapter and allowlisted image URLs instead; `src/lib/kml.ts` intentionally accepts local placemarks rather than a remote execution graph (`https://www.wpc.ncep.noaa.gov/kml/kmlproducts.php`).
- **Global single-site radar in this pass:** reject until provider terms, retention, relay policy, and ODIM H5 decoding are settled. Omastorm and Meowdar show demand, but they do not remove the blockers recorded in `Roadmap_Blocked.md` (`https://github.com/wesleygrimes/omastorm/issues/107`, `https://github.com/FahrenheitResearch/meowdar-98`).
- **3D or VR now:** defer. OpenStorm, NexView, GR2Analyst, and RadarOmega prove the feature, but `AUD-166` and `AUD-496` must close before another high-memory rendering mode (`ROADMAP.md`).
- **Automatic suppression from GOES operational notices:** reject. OSPO prose notices are not a stable machine control plane, and a heuristic could hide real lightning (`https://www.ospo.noaa.gov/operations/messages.html`).
- **CfRadial2 export now:** hold. `xradar` gives a credible interoperability target for derived volumes, but OpenRadar already exports raw Archive II and CSV, and no user demand justifies the large schema and round-trip burden yet (`https://github.com/openradar/xradar`).
- **A claimed best NOAA Weather Radio transmitter:** reject without a propagation model. An official county and SAME lookup could be reconsidered, but nominal coverage cannot promise reception at a watched place (`https://www.weather.gov/dsb/counties`, `https://www.weather.gov/nwr/Maps`).
- **Tauri 3, TypeScript 7, or React Server Components:** reject. Tauri 3 is prerelease, the lint stack does not yet support the TypeScript 7 line, and this is a client-only Vite app without an RSC server surface (`package.json`, `src-tauri/Cargo.toml`).
- **PWA or service-worker mode:** reject because incident packs, replay bundles, native caching, and the signed desktop updater already solve the offline and distribution cases without a second runtime (`src-tauri/src/incident_packs.rs`, `src-tauri/src/bundles.rs`).
- **Store, MSIX, winget, or remote CI:** reject under the repository's local build and NSIS distribution policy (`CLAUDE.md`, `scripts/release.mjs`).

## Sources

### Repository and release state

- https://github.com/SysAdminDoc/OpenRadar
- https://github.com/SysAdminDoc/OpenRadar/issues
- https://github.com/SysAdminDoc/OpenRadar/pulls
- https://github.com/SysAdminDoc/OpenRadar/releases
- https://unidata-nexrad-level2.s3.amazonaws.com/?list-type=2&prefix=2026/09/25/KTLX/&max-keys=5
- https://unidata-nexrad-level3.s3.amazonaws.com/?list-type=2&prefix=TLX_N0B_2026_09_25&max-keys=5

### Open-source and adjacent projects

- https://github.com/d4vid87/hookecho
- https://github.com/wesleygrimes/omastorm
- https://github.com/wesleygrimes/omastorm/issues/107
- https://github.com/dpaulat/supercell-wx
- https://github.com/dpaulat/supercell-wx/issues/617
- https://github.com/dpaulat/supercell-wx/issues/691
- https://github.com/cwdaniel/RadrView
- https://github.com/meridianstudios/auros
- https://github.com/FahrenheitResearch/bowecho
- https://github.com/FahrenheitResearch/meowdar-98
- https://github.com/JordanSchlick/OpenStorm
- https://github.com/FahrenheitResearch/nexview
- https://github.com/jhammon88219/Anvil
- https://github.com/kerryhatcher/rustywx
- https://github.com/JoshuaKimsey/LibreWXR
- https://github.com/openradar/openradar.github.io
- https://openradarscience.org/vm-docs/features.html
- https://github.com/MeteoAI/awesome-atmos
- https://github.com/topics/nexrad
- https://openradar.discourse.group/c/announcements/7

### Commercial products

- https://radarscope.zendesk.com/hc/en-us/articles/8991862852754-Upgrading-Your-RadarScope-Experience
- https://www.radaromega.com/
- https://www.sdsweather.com/PDF/RO_UserGuide_2024NEW.pdf
- https://www.grlevelx.com/gr2analyst_3/
- https://www.grlevelx.com/manuals/gr2analyst/
- https://www.grlevelx.com/manuals/gr2analyst/window_info.htm
- https://www.weatherandradar.com/apps/

### Community signal

- https://www.reddit.com/r/stormchasing/comments/10ca3nl/
- https://www.reddit.com/r/stormchasing/comments/1qa9hh6/
- https://stormtrack.org/threads/grlevel2-v-grlevel3.17548/
- https://www.reddit.com/r/stormchasing/comments/1c8savq/
- https://www.reddit.com/r/Radarscope/comments/1j2kzvd/
- https://www.reddit.com/r/stormchasing/comments/1tjjapv/
- https://www.reddit.com/r/Radarscope/comments/1d87nrx/
- https://www.reddit.com/r/tornado/comments/1wdirxg/
- https://www.reddit.com/r/weather/comments/1150r83/
- https://www.reddit.com/r/stormchasing/comments/1kp8gin/

### Standards and official data

- https://www.weather.gov/notification
- https://www.weather.gov/media/notification/pdf_2026/PNS26-62_Updated_CAP_Transition_aaa.pdf
- https://www.weather.gov/documentation/services-web-alerts
- https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html
- https://www.weather.gov/media/notification/pdf_2026/pns23-55_Updated_Exp_FIM_Services_ExtExp2026_aad.pdf
- https://water.noaa.gov/about/data-and-web-services-catalog
- https://maps.water.noaa.gov/server/rest/services/nwm/ana_inundation_extent/MapServer
- https://maps.water.noaa.gov/server/rest/services/nwm/mrf_gfs_5day_max_inundation_extent/MapServer
- https://maps.water.noaa.gov/server/rest/services/rfc/rfc_based_5day_max_inundation_extent/MapServer
- https://www.wpc.ncep.noaa.gov/kml/kmlproducts.php
- https://www.wpc.ncep.noaa.gov/html/fntcodes2.shtml
- https://www.wpc.ncep.noaa.gov/html/about_sfc.shtml
- https://www.weather.gov/jan/dualpolupgrade-products
- https://training.weather.gov/wdtd/courses/dualpol/Outreach/
- https://www.weather.gov/media/crp/QuickReference-MediaGuide.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-54_WSR-88D_Level2_Add_LTR.pdf
- https://www.roc.noaa.gov/public-documents/icds/2620010K_draft.pdf
- https://www.roc.noaa.gov/branches/engineering-branch/software-engineering.php
- https://www.weather.gov/dsb/counties
- https://www.weather.gov/nwr/Maps
- https://mping.ou.edu/static/mping/access.html

### Dependencies, platform, and security

- https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.11.6
- https://github.com/tauri-apps/tauri/releases/tag/%40tauri-apps%2Fcli-v2.11.5
- https://github.com/tauri-apps/plugins-workspace/releases/tag/updater-v2.12.0
- https://v2.tauri.app/plugin/updater/
- https://v2.tauri.app/security/capabilities/
- https://docs.rs/tauri-build/latest/tauri_build/struct.AppManifest.html
- https://v2.tauri.app/develop/tests/webdriver/
- https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.11.0
- https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.11.1
- https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.11.2
- https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579
- https://rustsec.org/advisories/RUSTSEC-2026-0253.html
- https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
- https://learn.microsoft.com/en-us/lifecycle/products/microsoft-edge-webview2

### Research and engineering references

- https://github.com/openradar/xradar
- https://github.com/openradar/xradar/blob/main/docs/history.md
- https://github.com/openradar/erad2026
- https://arm-doe.github.io/pyart/API/generated/pyart.correct.dealias_region_based.html
- https://doi.org/10.5334/jors.119

## Open Questions

None. The items selected for `ROADMAP.md` can be implemented from the cited standards, fixtures, and repository paths. Live service contracts remain acceptance work rather than a prioritization blocker.

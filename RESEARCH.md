# OpenRadar Research

Research snapshot: 2026-08-31. Repository snapshot: `a035805` on `main`, 129 commits, 341 tracked files. This document replaces the 2026-08-30 v0.2.0 research pass. Completed work is intentionally absent from `ROADMAP.md`.

## Executive Summary

OpenRadar is already a credible local-first weather workstation, not a thin radar tile viewer. It combines national mosaics, raw NEXRAD Level II and Level III decoding, live radial chunks, storm cells, ProbSevere, warnings, reports, tropical products, tides, surge, guidance, route weather, replay, local overlays, export, diagnostics, backups, English, and Spanish in one Tauri desktop workspace. The product map comes directly from `README.md`, `src/App.tsx`, `src-tauri/src/lib.rs`, and the native decoder modules under `src-tauri/src/`.

The clearest product direction is dependable incident work. OpenRadar should make it easy to prepare before connectivity degrades, inspect what a source actually said, replay an event with the correct valid-time context, and move through a Level II volume without repeated decode delays. HookEcho, Anvil, NEXRAD Workbench, BowEcho, RadarScope, and GR2Analyst each validate part of that direction. None combines OpenRadar's local-first privacy posture, national context, native decoding, and broad hazard workspace in the same shape. [HookEcho](https://github.com/d4vid87/hookecho), [Anvil](https://github.com/jhammon88219/Anvil), [NEXRAD Workbench](https://github.com/danielway/nexrad-workbench), [BowEcho](https://github.com/FahrenheitResearch/bowecho), [RadarScope](https://www.radarscope.com.au/guide/what-is-radarscope-pro), [GR2Analyst](https://www.grlevelx.com/gr2analyst_3/)

The next release should be a trust release before it becomes a feature release. Version metadata still disagrees, the post-audit build is not published, installed desktop flows remain partly unobserved, and `lru 0.16.4` remains in the NetCDF chain despite an unsoundness advisory fixed in 0.18.2. The first three roadmap additions therefore cover dependency closure, a common provenance contract, and one live provider contract gate. `package.json`, `package-lock.json`, `src/lib/settings.ts`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `scripts/release.mjs`, [RUSTSEC-2026-0253](https://rustsec.org/advisories/RUSTSEC-2026-0253.html)

After that gate, the strongest product investments are local Archive II import and browsing, resumable offline map packs, cached decoded volumes, cross-sections, radar-aware high contrast, and notification controls that prevent alert fatigue. These choices are supported by active open-source implementations and user reports, not feature-count matching. [HookEcho](https://github.com/d4vid87/hookecho), [Anvil](https://github.com/jhammon88219/Anvil), [NEXRAD Workbench](https://github.com/danielway/nexrad-workbench), [HookEcho high-contrast issue](https://github.com/d4vid87/hookecho/issues/12), [Supercell Wx alert issue](https://github.com/dpaulat/supercell-wx/issues/617)

OpenRadar should not chase full 3D, a plugin marketplace, cloud accounts, mobile clients, or generative radar nowcasting. Those choices increase attack surface, distribution burden, or scientific ambiguity before the core workstation path is proven. Cross-sections provide the useful vertical view at a fraction of the interaction and rendering cost. Official ECCC extrapolation is a safer first nowcast than an unlabeled single-flow blend. [GR2Analyst](https://www.grlevelx.com/gr2analyst_3/), [ECCC GeoMet radar](https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radar_geomet_en/), [NowcastNet](https://www.nature.com/articles/s41586-023-06184-4), [DEUCE](https://gmd.copernicus.org/articles/17/3839/2024/)

## Product Map

### Current experience

| Area                       | What exists on 2026-08-31                                                                                                                                                                                                                                 | Evidence                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core map                   | Flat and globe projections, dual panes, map styles, saved views, range, draw, inspect, location, and a command surface                                                                                                                                    | `src/components/MapStage.tsx`, `src/components/MapViewport.tsx`, `src/components/CommandBar.tsx`, `src/lib/commands.ts`                                                                                |
| Radar                      | MRMS mosaics, NOAA RIDGE and nowCOAST fallback, RainViewer worldwide fallback, ECCC and DWD coverage, Level II base moments, dealiased velocity, storm-relative velocity, VAD motion, live radial chunks, Level III storm cells, and custom `.pal` tables | `src/lib/providers/`, `src/hooks/useSingleSiteRadar.ts`, `src-tauri/src/level2.rs`, `src-tauri/src/level3.rs`, `src-tauri/src/chunks.rs`, `src/lib/palette.ts`                                         |
| Hazard context             | NWS alerts, SPC outlooks and discussions, storm reports, ProbSevere, MRMS rotation, hail, echo tops, VIL, rain rate, QPE, lightning, earthquakes, wildfires, tropical tracks, and storm surge                                                             | `src/lib/overlays/`, `src/hooks/useMrmsOverlays.ts`, `src-tauri/src/probsevere.rs`, `src-tauri/src/lightning.rs`, `src/lib/surge.ts`                                                                   |
| Planning                   | Point forecast, multi-model guidance, GFS wind, HRRR reflectivity guidance, tides, and route weather                                                                                                                                                      | `src/lib/weather.ts`, `src/lib/guidance.ts`, `src-tauri/src/gfs.rs`, `src/lib/providers/hrrr.ts`, `src/lib/tides.ts`, `src/lib/route.ts`                                                               |
| History and sharing        | Radar replay, HURDAT storm history, PNG, WebM, GIF, workspace backup and restore, settings backup, local GeoJSON and placefile import                                                                                                                     | `src/hooks/useRadarTimeline.ts`, `src/lib/hurdat.ts`, `src/hooks/useExport.ts`, `src/lib/workspace.ts`, `src/hooks/useWorkspaceActions.ts`                                                             |
| Trust and recovery         | Provider health, cached frame labels, staleness copy, disk cache, logs, diagnostics copy, error boundary, updater signature verification, and atomic file replacement                                                                                     | `src/lib/providers/health.ts`, `src/components/WorkspaceChrome.tsx`, `src-tauri/src/cache.rs`, `src/lib/log.ts`, `src/components/ErrorBoundary.tsx`, `scripts/release.mjs`, `src-tauri/src/exports.rs` |
| Accessibility and language | English, Spanish, pseudolocale tests, 100, 115, and 130 percent text, reduced motion, browser high contrast, keyboard map tools, and live status messages                                                                                                 | `src/i18n/`, `src/lib/units.ts`, `src/index.css`, `src/components/MapViewport.tsx`, `src/components/WorkspaceChrome.tsx`                                                                               |
| Distribution               | Windows x64 current-user NSIS, signed updater payload, local release gate, and no build workflow on GitHub                                                                                                                                                | `src-tauri/tauri.conf.json`, `scripts/release.mjs`, `README.md`                                                                                                                                        |

### Boundaries that shape the roadmap

- The installed app accepts credential-free HTTPS requests only to an exact native allowlist, while the webview also has a narrow CSP. This is a useful safety boundary and the reason arbitrary remote placefiles should not be added casually. `src-tauri/src/http.rs`, `src-tauri/src/tauri.conf.json`, `Roadmap_Blocked.md`
- MapLibre GL 6 requires WebGL2. OpenRadar has a clear GPU failure screen but no software-rendered map path. `src/components/NoGpu.tsx`, `package.json`
- The product has no account, telemetry, crash upload, or sync. Search text, coordinates, route endpoints, tiles, and source requests still reach the named providers. `README.md`, `src/lib/weather.ts`, `src/lib/route.ts`, `src/lib/tileCache.ts`
- Windows x64 is the only built and tested target. The configuration creates an NSIS bundle only. `README.md`, `src-tauri/tauri.conf.json`
- The OSRM public demo has no service guarantee, and RainViewer limits free API use to personal and small-community projects. OpenRadar already throttles and falls back, but it still needs a durable provider decision. `src/lib/route.ts`, `docs/asset-ledger.md`, [OSRM API policy](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy), [RainViewer API](https://www.rainviewer.com/api.html)
- Level II volumes are cached as compressed bytes, then decoded again for each product or tilt request. Fast tilt exploration and cross-section work need a bounded decoded-volume cache. `src-tauri/src/level2.rs`, `src/hooks/useSingleSiteRadar.ts`

## Competitive Landscape

### Open-source radar tools

| Product                          | Evidence observed on 2026-08-31                                                                                                                       | Lesson for OpenRadar                                                                                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HookEcho                         | Active Rust radar viewer with offline chase packs, VAD, SRV, valid-time replay, local sharing, alert controls, and experimental cross-platform builds | Offline preparation and explicit replay time are proven desktop workflows. Do not copy its cloud or platform breadth before OpenRadar's Windows release path is closed. [Repository](https://github.com/d4vid87/hookecho), [roadmap](https://github.com/d4vid87/hookecho/blob/main/ROADMAP.md) |
| BowEcho                          | Native Level II viewer with progressive newest-first work, cancellation, cached data, global radar, cross-section, VAD, SRV, and multi-radar views    | Cross-section and decoded-volume reuse fit OpenRadar. More panes do not. [Repository](https://github.com/FahrenheitResearch/bowecho), [releases](https://github.com/FahrenheitResearch/bowecho/releases)                                                                                       |
| Supercell Wx                     | Mature desktop viewer with many panes, thresholds, drawing, provider choice, and broad product coverage                                               | OpenRadar should keep its simpler workspace while adding radar-aware accessibility and volume speed. [Repository](https://github.com/dpaulat/supercell-wx)                                                                                                                                     |
| NEXRAD Workbench                 | Local Archive II upload, arbitrary archive browsing, zoomable timeline, caching, 3D, and cell analysis                                                | Local import and arbitrary archive access are high-value research and incident tools. Full 3D can wait. [Repository](https://github.com/danielway/nexrad-workbench)                                                                                                                            |
| Anvil                            | Windows workstation with client-side Level II decode, offline PMTiles, full-volume VAD, SPC context, and historical replay                            | PMTiles are a practical offline basemap format for a desktop chase pack. [Repository](https://github.com/jhammon88219/Anvil), [PMTiles](https://github.com/protomaps/PMTiles)                                                                                                                  |
| LibreWXR                         | Open radar and nowcast server with explicit blending choices and a public issue documenting lost precipitation in blended frames                      | Any nowcast must name its method and preserve a way to see observations alone. [Repository](https://github.com/JoshuaKimsey/LibreWXR), [blend issue](https://github.com/JoshuaKimsey/LibreWXR/issues/24)                                                                                       |
| ARTView                          | Scientific radar desktop with PPI, RHI, export, and plugins, but its latest GitHub release is old                                                     | Scientific export is useful. A general plugin system is not justified by current OpenRadar usage. [Repository](https://github.com/nguy/artview)                                                                                                                                                |
| NOAA Weather and Climate Toolkit | Government desktop tool for radar and gridded data visualization and export                                                                           | GeoTIFF, NetCDF, CSV, and GIS interoperability are credible later-stage exports. [Product page](https://www.ncei.noaa.gov/products/weather-climate-toolkit)                                                                                                                                    |

### Commercial and adjacent products

| Product         | Differentiator                                                                                                                       | Implication                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RadarScope      | Paid archive, advanced products, reports, and subscription tiers                                                                     | Archive depth and source truth can support paid products, but OpenRadar can compete through local-first access and no account. [Pro guide](https://www.radarscope.com.au/guide/what-is-radarscope-pro), [App Store](https://apps.apple.com/us/app/radarscope/id288419283) |
| RadarOmega      | Desktop access starts with a yearly subscription and supports many saved locations and lists                                         | Multiple watched places are useful, but OpenRadar should keep them local and bounded. [Official site](https://www.radaromega.com/), [web app pricing](https://app.radaromega.com/)                                                                                        |
| GR2Analyst      | Paid volume analysis, cross-sections, derived products, archives, and 3D                                                             | Cross-section is the best first vertical analysis feature. [Product page](https://www.grlevelx.com/gr2analyst_3/)                                                                                                                                                         |
| RainViewer      | Long radar playback and forecast frames, with stricter API terms than its consumer product suggests                                  | Keep it as a clearly labeled fallback. Do not build core workflows around it. [Features](https://www.rainviewer.com/features.html), [API terms](https://www.rainviewer.com/api.html)                                                                                      |
| Storm Radar     | Consumer app markets a 72-hour weather map                                                                                           | OpenRadar should avoid competing on forecast horizon and focus on observed-source trust. [Product announcement](https://weather.com/safety/news/2026-05-02-new-storm-radar-the-weather-channel)                                                                           |
| Windy           | Forecast runs and radar forecast are subscription differentiators                                                                    | Exact model run identity matters more than adding another anonymous blended chart. [Subscription](https://www.windy.com/subscription), [forecasted-radar discussion](https://community.windy.com/topic/31383/how-to-turn-off-forecasted-radar/5)                          |
| Pivotal Weather | Model soundings and specialist forecast views                                                                                        | Model-run provenance and comparison are useful. A broad forecast workstation would dilute OpenRadar. [Plus FAQ](https://home.pivotalweather.com/plus-faq)                                                                                                                 |
| OpenCPN GRIB    | A mature adjacent workstation exposes a Now control, local or UTC time, data at cursor, opacity, and stale or interpolation warnings | OpenRadar should use the same plain-language trust cues for radar, guidance, and replay. [GRIB manual](https://opencpn-manuals.github.io/main/grib/index.html)                                                                                                            |

### Positioning conclusion

OpenRadar should be the local-first incident workstation that explains its evidence. Its durable advantages are native radar decoding, explicit cache and stale states, broad public hazard context, no account, and a simpler interface than nine-pane analysis tools. The roadmap should deepen those advantages through offline packs, archive import, provenance, alert policy, and vertical inspection. `README.md`, `src-tauri/src/level2.rs`, `src/lib/providers/`, [HookEcho](https://github.com/d4vid87/hookecho), [Supercell Wx](https://github.com/dpaulat/supercell-wx)

## Reported Issues

### OpenRadar tracker state

The OpenRadar repository had no open or closed issues, no open or closed pull requests, no discussions, zero stars, and zero forks on 2026-08-31. The repository was created on 2026-08-30, so this is an absence of field evidence, not evidence that production use is defect-free. [Issues](https://github.com/SysAdminDoc/OpenRadar/issues), [pull requests](https://github.com/SysAdminDoc/OpenRadar/pulls), [repository](https://github.com/SysAdminDoc/OpenRadar)

The latest public release is v0.3.0, while `main` contains 20 later audit commits at this snapshot. The release therefore does not represent the repaired tree. [v0.3.0](https://github.com/SysAdminDoc/OpenRadar/releases/tag/v0.3.0), `git log`, `ROADMAP.md`

### User and maintainer signals from adjacent products

| Signal                                                                                                                           | Evidence                                                                                                                                                                                                                      | Roadmap response                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beginners want professional radar without an overwhelming first screen                                                           | A 2026 Reddit thread contrasts simpler RadarScope use with feature-heavy tools and repeatedly mentions the learning curve. [Thread](https://www.reddit.com/r/weather/comments/1tjj8or/best_overall_radar_app_for_a_beginner/) | Preserve OpenRadar's one-workspace model. Add explanations and provenance, not pane count.                                                                     |
| Alert sounds become noisy when polygons shrink or update without a meaningful threat increase                                    | [Supercell Wx issue 617](https://github.com/dpaulat/supercell-wx/issues/617)                                                                                                                                                  | Add quiet hours, a test action, and an explanation of why an alert fired.                                                                                      |
| A high-contrast theme that changes only chrome misses the actual radar and polygon information                                   | [HookEcho issue 12](https://github.com/d4vid87/hookecho/issues/12)                                                                                                                                                            | Add radar palettes, outline widths, and pattern or text checks to accessibility validation.                                                                    |
| Users want observed and forecast radar to remain distinguishable and independently selectable                                    | [Windy forecast control discussion](https://community.windy.com/topic/31383/how-to-turn-off-forecasted-radar/5), [LibreWXR blend issue](https://github.com/JoshuaKimsey/LibreWXR/issues/24)                                   | Keep observation and extrapolation lanes visually separate. Never silently blend them.                                                                         |
| Users ask to select an individual radar station instead of accepting an opaque composite                                         | [Windy station request](https://community.windy.com/topic/33313/feature-request-selectable-radar-station-views)                                                                                                               | OpenRadar already supports held Level II stations. Keep that control and expose provenance around it. `src/lib/settings.ts`, `src/hooks/useSingleSiteRadar.ts` |
| Desktop projects need real hardware feedback before claiming another operating system                                            | [HookEcho issue 9](https://github.com/d4vid87/hookecho/issues/9)                                                                                                                                                              | Keep macOS and Linux unclaimed until installed tests exist.                                                                                                    |
| Product identity, cache identity, derivation, and capabilities become fragile when they are split across renderers and selectors | [NEXRAD Workbench issue 180](https://github.com/danielway/nexrad-workbench/issues/180)                                                                                                                                        | Introduce one provider and product provenance contract before adding more feeds.                                                                               |
| Community placefiles go stale and users spend time finding working replacements                                                  | [Stormtrack placefile thread](https://stormtrack.org/threads/grlevelx-placefiles-updated-working-placefiles.31427/)                                                                                                           | Keep local placefiles. Do not open arbitrary remote fetching without a trusted-host model. `Roadmap_Blocked.md`                                                |
| Subscription cost and duplicated feature sets drive users to compare tools rather than buy every layer                           | [RadarScope or RadarOmega discussion](https://www.reddit.com/r/weather/comments/1471jwp/radarscope_or_radar_omega/)                                                                                                           | Keep the product free and focused on workflows public data can support reliably.                                                                               |

## Security/Privacy/Reliability

### Dependency state

- `npm audit --omit=dev` reported zero known production vulnerabilities on 2026-08-31. The installed dependency graph is recorded in `package-lock.json`.
- The app uses Tauri 2.11.5, which is newer than the 2.11.1 fix for the 2026 origin-confusion advisory. `src-tauri/Cargo.lock`, [Tauri advisory](https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9)
- The production build uses Vite 8.2.2. The cited Vite issue affects the development server, not the packaged desktop runtime, but keeping the toolchain current remains part of the release gate. `package-lock.json`, [Vite advisory](https://github.com/vitejs/vite/security/advisories/GHSA-p9ff-h696-f583)
- `lru 0.16.4` is present through `netcdf-reader 0.9.1 -> hdf5-reader 0.9.1 -> lru 0.16.4`. RustSec classifies the issue as unsound and fixes it in 0.18.2. `src-tauri/Cargo.lock`, [RUSTSEC-2026-0253](https://rustsec.org/advisories/RUSTSEC-2026-0253.html)
- `glib 0.18.5` appears in all-target scanner output but not in the Windows dependency tree. The affected range is 0.15.0 through 0.19.x and the fix is 0.20.0. `src-tauri/Cargo.lock`, [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
- The NEXRAD crates are release candidates. They need either stable releases or a deliberately pinned fixture and compatibility policy before the decoder boundary is treated as settled. `src-tauri/Cargo.toml`

### Boundary strengths

- Native HTTP requests reject unknown hosts, credentials, custom ports, non-HTTPS schemes, oversized bodies, and invalid byte ranges. `src-tauri/src/http.rs`
- The webview CSP names the exact data hosts and does not allow arbitrary script or connect origins. `src-tauri/src/tauri.conf.json`
- Local imports pass through bounded parsers and the workspace loader reports unknown fields rather than silently accepting them. `src/lib/upload.ts`, `src/lib/workspace.ts`, `src/lib/settings.ts`
- Update payloads are verified against the configured Tauri public key and the release proof binds artifacts to a commit. `src-tauri/tauri.conf.json`, `scripts/release.mjs`, `scripts/release-lib.mjs`

### Remaining reliability gaps

- Source attribution exists, and radar cache age exists, but there is no common record for observed time, valid time, fetched time, expiry, model initialization, derivation, cache state, or stale reason across radar, guidance, overlays, and exports. `src/lib/providers/types.ts`, `src/hooks/useRadarTimeline.ts`, `src/components/WorkspaceChrome.tsx`
- Provider-specific live tests exist under `OPENRADAR_LIVE=1`, and several Rust network checks use `#[ignore]`, but the release script does not provide one command that exercises all current public contracts. `src/lib/guidance.test.ts`, `src/lib/overlays/spc.test.ts`, `src/lib/providers/`, `src-tauri/src/level2.rs`, `src-tauri/src/mrms.rs`, `scripts/release.mjs`
- The OSRM demo and RainViewer fallback can change terms, quotas, or availability independently of an OpenRadar release. `src/lib/route.ts`, `docs/asset-ledger.md`, [OSRM policy](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy), [RainViewer API](https://www.rainviewer.com/api.html)
- `MapViewport.tsx` owns most source and layer lifecycles and contains 15 `react-hooks/exhaustive-deps` suppressions. A stale generation or ordering error in this file can affect many layers at once. `src/components/MapViewport.tsx`
- Toast dismissal timers and delayed preset camera movement do not have complete owner cleanup. `src/hooks/useToasts.ts`, `src/hooks/useWorkspaceActions.ts`
- The public repository has no `SECURITY.md`, so a reporter is not told which versions are supported or how to send a private vulnerability report. Repository root, [repository](https://github.com/SysAdminDoc/OpenRadar)

### Data and standards opportunities

- ECCC publishes six-minute North American radar composites and official extrapolation layers through WMS. This is a safer first extrapolation lane than shipping a local algorithm without growth and decay uncertainty. [ECCC GeoMet radar](https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radar_geomet_en/)
- EUMETNET ORD exposes European volume data, OPERA composites, a 24-hour cache, archive products, API discovery, and MQTT notification links. Anonymous access has low query limits, so a product integration needs a key or distribution plan before it becomes a default. [ORD overview](https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/)
- Open-Meteo now exposes exact individual runs and previous runs. OpenRadar currently compares current seamless model output without recording the run identity. `src/lib/guidance.ts`, [Single Runs API](https://open-meteo.com/en/docs/single-runs-api), [Previous Runs API](https://open-meteo.com/en/docs/previous-runs-api)
- NOAA says operational RRFS and REFS v1 are scheduled for 2026-10-06. OpenRadar should verify that launch before presenting RRFS as a supported replacement for HRRR. [RRFS registry](https://registry.opendata.aws/noaa-rrfs-ops/)
- NOAA distributes NEXRAD Level II and Level III data publicly, and TDWR adds lower-level airport radar products with different coverage and product details. A TDWR adapter belongs behind a tested product descriptor, not hard-coded display strings. [NEXRAD registry](https://registry.opendata.aws/noaa-nexrad/), [RPCCDS](https://www.weather.gov/tg/rpccds), [TDWR specifications](https://www.weather.gov/gsp/tdwr_specs)
- NOAA's National Water Prediction Service exposes stream and flood information through an official API. It is a defensible future hazard layer once core radar workflows are complete. [NWPS API](https://water.noaa.gov/about/api)

## Architecture Assessment

### What is working

The browser and native boundary is clear. React owns interaction and MapLibre state, while Rust owns binary decoding, heavy rendering, bounded network access, and disk work. That division is visible in `src/App.tsx`, `src/components/MapViewport.tsx`, `src-tauri/src/lib.rs`, and `src-tauri/src/http.rs`.

Provider selection is already an adapter chain with coverage checks, traffic budgets, health, abort propagation, cache provenance, and fallbacks. New radar sources should extend that contract instead of adding one-off fetch effects. `src/lib/providers/index.ts`, `src/lib/providers/types.ts`, `src/lib/providers/health.ts`, `src/lib/providers/wms.ts`

The decoder code has meaningful adversarial tests, synthetic fixtures, unknown-message coverage, native body limits, and live checks that can be run manually. This is stronger than relying only on screenshots of a tile server. `src-tauri/src/level2.rs`, `src-tauri/src/level3.rs`, `src-tauri/src/mrms.rs`, `src-tauri/src/gfs.rs`, `src-tauri/src/lightning.rs`

The settings and workspace envelopes normalize untrusted data, preserve defaults, report newer fields, and support backups. That is the right base for future watch lists, offline pack metadata, and replay bundles, but each format change needs an explicit migration test. `src/lib/settings.ts`, `src/lib/workspace.ts`

### Pressure points

| Pressure point              | Evidence                                                                                                                                    | Recommended boundary                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map lifecycle concentration | `src/components/MapViewport.tsx` is 1,793 lines, was touched in 36 of 129 commits, and contains 15 hook dependency suppressions             | Move radar, native-image, and vector-overlay lifecycles behind tested map adapters. Keep one owner for final layer ordering.                                           |
| Decoder concentration       | `src-tauri/src/level2.rs` is 3,684 lines and handles discovery, cache, decode, VAD, motion, rendering, live composition, and commands       | Split acquisition and bounded cache from volume analysis and image rendering after decoded-volume ownership is designed.                                               |
| Repeated decode work        | The cache stores compressed bytes only, while `level2_sweep` constructs and scans a volume for every requested product or tilt              | Cache decoded scans by volume identity with a strict byte budget and generation invalidation. `src-tauri/src/level2.rs`                                                |
| Partial source identity     | `RadarFrame` carries provider, time, URL, attribution, and optional forecast initialization, but overlays and guidance use unrelated shapes | Add a shared provenance envelope that can be serialized into diagnostics and exports. `src/lib/providers/types.ts`, `src/lib/guidance.ts`, `src/lib/overlays/index.ts` |
| Live test fragmentation     | Browser live tests use one environment switch, Rust network tests are individually ignored, and the release gate skips both groups          | Add one explicit local command with timeouts, rate limits, and a machine-readable provider report. `scripts/release.mjs`, `package.json`, `src-tauri/src/`             |
| Distribution uncertainty    | Tauri is cross-platform, but only NSIS is configured and no Apple or Linux hardware result exists                                           | Keep Windows as the only claim until installed acceptance runs are captured. `src-tauri/tauri.conf.json`, `README.md`                                                  |

### Migration and extension rules

- New providers should not enter the map until they can report identity, valid time, freshness, attribution, license, error state, traffic budget, and cache policy. `src/lib/providers/types.ts`, `docs/asset-ledger.md`
- New settings structures need normalization, newer-field reporting, backup round trips, and deterministic fallback. `src/lib/settings.ts`, `src/lib/workspace.ts`
- Offline packs and replay bundles must be resumable, bounded, hash-verified, and removable without orphaned bytes. [PMTiles](https://github.com/protomaps/PMTiles), [MapLibre PMTiles example](https://github.com/makinacorpus/maplibre-offline-pmtiles)
- Forecast or extrapolation frames must occupy a visually distinct timeline segment and retain the last observation as an independent selectable frame. [Windy discussion](https://community.windy.com/topic/31383/how-to-turn-off-forecasted-radar/5), [LibreWXR issue](https://github.com/JoshuaKimsey/LibreWXR/issues/24)

## Rejected Ideas

| Idea                                                                  | Decision and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full 3D volume rendering before cross-section                         | Reject for now. Cross-section answers the vertical question with less GPU work, fewer controls, and a better fit for the current two-dimensional workspace. [GR2Analyst](https://www.grlevelx.com/gr2analyst_3/), [BowEcho](https://github.com/FahrenheitResearch/bowecho)                                                                                                                                                                                                                                            |
| Single-flow local optical nowcast as the immediate next feature       | Replace the old proposal with an official ECCC extrapolation lane first. Optical flow alone cannot represent storm growth, decay, or uncertainty, and blended products can erase precipitation. [ECCC](https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radar_geomet_en/), [DEUCE](https://gmd.copernicus.org/articles/17/3839/2024/), [multi-flow study](https://amt.copernicus.org/articles/17/4121/2024/amt-17-4121-2024.html), [LibreWXR issue](https://github.com/JoshuaKimsey/LibreWXR/issues/24) |
| Generative or learned radar nowcasting in the desktop bundle          | Reject. The model, training data, GPU requirements, calibration, and uncertainty burden do not fit a small local desktop release. Keep the papers as evaluation references, not product dependencies. [NowcastNet](https://www.nature.com/articles/s41586-023-06184-4), [EchoCast](https://doi.org/10.1038/s41612-026-01407-7)                                                                                                                                                                                        |
| Cloud accounts, telemetry, hosted sync, or collaborative workspaces   | Reject. They conflict with the product's no-account privacy position and would create a server, identity, retention, and incident-response program. `README.md`, `src/lib/settings.ts`                                                                                                                                                                                                                                                                                                                                |
| Mobile clients                                                        | Reject. OpenRadar's differentiator is a desktop analysis workspace, and mobile would multiply release, notification, background, battery, and store-policy work before desktop adoption is known. `README.md`, `src-tauri/tauri.conf.json`                                                                                                                                                                                                                                                                            |
| General plugin marketplace or embedded server                         | Reject. Current extensibility needs are satisfied by local palettes, GeoJSON, placefiles, settings, and workspace backups. A plugin runtime would widen the native trust boundary without reported demand. `src/lib/palette.ts`, `src/lib/upload.ts`, `src/lib/workspace.ts`                                                                                                                                                                                                                                          |
| Arbitrary remote placefile URLs                                       | Keep blocked until a trusted-host model exists. The fixed CSP and native allowlist are deliberate controls, and community placefile URLs have a history of staleness. `Roadmap_Blocked.md`, `src-tauri/src/http.rs`, [placefile thread](https://stormtrack.org/threads/grlevelx-placefiles-updated-working-placefiles.31427/)                                                                                                                                                                                         |
| Direct Windy, Pivotal, or other commercial feeds                      | Reject. Their consumer interfaces and subscriptions are not public redistribution contracts. Use official government and open-data sources. [Windy subscription](https://www.windy.com/subscription), [Pivotal FAQ](https://home.pivotalweather.com/plus-faq)                                                                                                                                                                                                                                                         |
| Make RainViewer a primary source                                      | Reject. Keep it as a labeled worldwide fallback because the free API terms are restrictive. `src/lib/providers/rainviewer.ts`, [RainViewer API](https://www.rainviewer.com/api.html)                                                                                                                                                                                                                                                                                                                                  |
| Replace HRRR before RRFS is operationally verified                    | Reject. NOAA schedules RRFS and REFS v1 for 2026-10-06 and asks consumers to monitor service notices. `src/lib/providers/hrrr.ts`, [RRFS registry](https://registry.opendata.aws/noaa-rrfs-ops/)                                                                                                                                                                                                                                                                                                                      |
| Nine-pane or floating-window analysis layout                          | Reject. User reports already describe advanced tools as overwhelming, and OpenRadar's command surface keeps features reachable without permanent clutter. `src/components/CommandBar.tsx`, [beginner thread](https://www.reddit.com/r/weather/comments/1tjj8or/best_overall_radar_app_for_a_beginner/)                                                                                                                                                                                                                |
| Broad METAR, fronts, soundings, and model-layer expansion in one pass | Reject as a bundle. Exact model runs and source truth have a clearer connection to existing guidance. Add later layers only when a concrete incident workflow needs them. `src/lib/guidance.ts`, [Open-Meteo Single Runs](https://open-meteo.com/en/docs/single-runs-api)                                                                                                                                                                                                                                             |
| A generic OGC server or standards plugin layer                        | Reject. OGC EDR, Tiles, and CAP are useful adapter references, but OpenRadar is a client and does not need to become a server. [OGC EDR](https://www.ogc.org/standards/ogcapi-edr/), [OGC Tiles](https://ogcapi.ogc.org/tiles/), [CAP](https://www.oasis-open.org/standard/cap/)                                                                                                                                                                                                                                      |

## Sources

The inventory below contains 77 distinct external URLs, plus repository paths cited throughout the report.

### OpenRadar repository and tracker

- https://github.com/SysAdminDoc/OpenRadar
- https://github.com/SysAdminDoc/OpenRadar/issues
- https://github.com/SysAdminDoc/OpenRadar/pulls
- https://github.com/SysAdminDoc/OpenRadar/releases
- https://github.com/SysAdminDoc/OpenRadar/releases/tag/v0.3.0

### Open-source radar and mapping projects

- https://github.com/d4vid87/hookecho
- https://github.com/d4vid87/hookecho/blob/main/ROADMAP.md
- https://github.com/FahrenheitResearch/bowecho
- https://github.com/FahrenheitResearch/bowecho/releases
- https://github.com/dpaulat/supercell-wx
- https://github.com/danielway/nexrad-workbench
- https://github.com/jhammon88219/Anvil
- https://github.com/JoshuaKimsey/LibreWXR
- https://github.com/nguy/artview
- https://www.ncei.noaa.gov/products/weather-climate-toolkit
- https://github.com/protomaps/PMTiles
- https://github.com/makinacorpus/maplibre-offline-pmtiles
- https://openradarscience.org/pages/projects/
- https://github.com/topics/weather-radar
- https://github.com/maplibre/awesome-maplibre

### Commercial and adjacent products

- https://www.radarscope.com.au/guide/what-is-radarscope-pro
- https://apps.apple.com/us/app/radarscope/id288419283
- https://www.radaromega.com/
- https://app.radaromega.com/
- https://www.grlevelx.com/gr2analyst_3/
- https://www.rainviewer.com/features.html
- https://www.rainviewer.com/api.html
- https://weather.com/safety/news/2026-05-02-new-storm-radar-the-weather-channel
- https://www.windy.com/subscription
- https://www.weatherpulse.com/pages/pricing
- https://home.pivotalweather.com/plus-faq
- https://www.baronthreatnet.com/content/faq
- https://opencpn-manuals.github.io/main/grib/index.html

### User reports and maintainer issues

- https://www.reddit.com/r/weather/comments/1tjj8or/best_overall_radar_app_for_a_beginner/
- https://www.reddit.com/r/weather/comments/1471jwp/radarscope_or_radar_omega/
- https://github.com/d4vid87/hookecho/issues/12
- https://github.com/d4vid87/hookecho/issues/9
- https://github.com/dpaulat/supercell-wx/issues/617
- https://github.com/JoshuaKimsey/LibreWXR/issues/24
- https://github.com/danielway/nexrad-workbench/issues/180
- https://community.windy.com/topic/42998/weather-radar-only-1-hour-forecast-premium
- https://community.windy.com/topic/31383/how-to-turn-off-forecasted-radar/5
- https://community.windy.com/topic/33313/feature-request-selectable-radar-station-views
- https://stormtrack.org/threads/radaromega.32531/
- https://stormtrack.org/threads/open-source-weather-radar-software-supercell-wx.32393/page-2
- https://stormtrack.org/threads/grlevelx-placefiles-updated-working-placefiles.31427/
- https://stackoverflow.com/questions/55551992/plot-nexrad-level-2-file-using-metpy-and-pyart-coordinate-calculation

### Official data, standards, and service policies

- https://www.weather.gov/documentation/services-web-api
- https://registry.opendata.aws/noaa-nexrad/
- https://registry.opendata.aws/noaa-mrms-pds/
- https://www.nssl.noaa.gov/projects/mrms/
- https://www.weather.gov/tg/rpccds
- https://www.weather.gov/gsp/tdwr_specs
- https://www.weather.gov/media/tg/rpccds_radar_products.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-54_WSR-88D_Level2_Add_LTR.pdf
- https://registry.opendata.aws/noaa-rrfs-ops/
- https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radar_geomet_en/
- https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/
- https://open-meteo.com/en/docs/single-runs-api
- https://open-meteo.com/en/docs/previous-runs-api
- https://open-meteo.com/en/terms
- https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy
- https://www.ogc.org/standards/ogcapi-edr/
- https://ogcapi.ogc.org/tiles/
- https://www.oasis-open.org/standard/cap/
- https://water.noaa.gov/about/api

### Research papers

- https://www.nature.com/articles/s41586-023-06184-4
- https://gmd.copernicus.org/articles/17/3839/2024/
- https://amt.copernicus.org/articles/17/4121/2024/amt-17-4121-2024.html
- https://doi.org/10.1175/WAF-D-23-0104.1
- https://doi.org/10.1038/s41612-026-01407-7
- https://amt.copernicus.org/articles/15/261/2022/

### Security and dependency advisories

- https://rustsec.org/advisories/RUSTSEC-2026-0253.html
- https://rustsec.org/advisories/RUSTSEC-2024-0429.html
- https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9
- https://github.com/vitejs/vite/security/advisories/GHSA-p9ff-h696-f583
- https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/CHANGELOG.md

## Open Questions

1. Will EUMETNET issue a redistribution-friendly API key or quota for a desktop application with no central server? Anonymous ORD access is documented as unsuitable for permanent use. [ORD overview](https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/)
2. Does RRFS and REFS v1 enter operations on 2026-10-06 with stable filenames and the products OpenRadar needs, or does NOAA move the service date again? [RRFS registry](https://registry.opendata.aws/noaa-rrfs-ops/)
3. Is macOS or Linux support worth the release and hardware matrix, or should Windows remain the explicit product boundary? `README.md`, `src-tauri/tauri.conf.json`
4. Which incident workflow creates the first sustained users: offline storm preparation, archive review, local volume analysis, or alert monitoring? The OpenRadar tracker has no field reports as of 2026-08-31. [Issues](https://github.com/SysAdminDoc/OpenRadar/issues)

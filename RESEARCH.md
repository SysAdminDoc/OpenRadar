# OpenRadar Research

Research snapshot: 2026-08-31, third pass of the day. Repository snapshot: `e098e40` on `main`, v0.5.0. This document replaces the 2026-08-31 evening pass, which replaced the morning pass, which replaced 2026-08-30. Everything carried forward was re-verified today where cheap to re-verify; everything new is dated and labeled. The repository moved under the previous pass: the 2026-08-31 roadmap drain shipped fifteen items (provenance contract, live-provider gate, SECURITY.md, asset ledger reconciliation, Valhalla routing, quiet hours with emergency override, Level II decoded-volume cache, colour-vision measurement with high-contrast radar ramps, timer ownership, a required warnings contract) and released v0.5.0, so the reliability sections below reflect the post-drain tree, not the one the earlier passes described.

## Executive Summary

OpenRadar is a credible local-first weather workstation: national mosaics, raw NEXRAD Level II and Level III decoded in Rust, live radial chunks, MRMS, warnings, ProbSevere, tropical products, tides, surge, guidance, route weather, replay, export, backups, English and Spanish, in one Tauri window with no account and no telemetry. The morning pass established the incident-workstation direction and the trust-release gate; the evening pass added the retention/character lane (`JOY-001` to `JOY-021`) and the platform verdicts. Both stand. This pass asked what data the app is still missing that its own decoders could already carry, and what the two prior passes structurally under-covered: winter weather, surface observations, historical warnings, soundings, smoke, fuzzing, localization beyond Spanish, and non-visual accessibility.

Top opportunities from this pass, in order:

1. **The winter lane is one product entry away.** MRMS `PrecipFlag_00.00` (surface precipitation type: rain, snow, mix, hail, convection) publishes every 2 minutes on the same bucket, in the same GRIB2 template-41 PNG packing `src-tauri/src/mrms.rs` already decodes — verified 2026-08-31 by downloading the newest file and reading its section-5 template number (41). The app currently draws snow as rain. Supercell Wx has two open/duplicate issues asking for exactly this (#122, #335); RadarScope and MyRadar both ship precip-type products (`AUD-108`). The per-site dual-pol version, Level III N0H/HHC/N0M, was verified still publishing through 2026 by the same bucket-listing method that proved NHI/NTV dead in 2022 (`AUD-109`).
2. **Surface observations are the layer people literally pay for elsewhere.** AllisonHouse sells METAR feeds at ~$12/month for GRLevelX users; a maintained OSS project exists solely to convert AWC data into placefiles. AWC's keyless `api/data/metar?bbox=` endpoint was verified live (compact JSON, minute-fresh cache, 100 req/min, 400-entry cap, no CORS so it must go through the native fetch — which the allowlist architecture handles) (`AUD-110`).
3. **Historical warnings complete the replay the app already has.** IEM's `geojson/sbw.py?ts=` returns the storm-based warning polygons valid at any instant back to 2002 (official product from 2007-10-01), with `polygon_begin`/`polygon_end` modelling mid-lifetime SVS shrinks — verified live against 2011-04-27 22:00 UTC (93 polygons). Policy: any lawful purpose. The host (mesonet.agron.iastate.edu) is already a provider (HRRR reflectivity) (`AUD-111`).
4. **An integrated Skew-T is an open leapfrog.** SHARPpy, the community-standard sounding tool, is abandoned (last release 2020-03, last push 2023-04-07, 64 open issues); no OSS radar app ships one; RadarOmega treats soundings as a paid differentiator. IEM's RAOB JSON endpoint was verified live with open CORS; Open-Meteo pressure-level data (19–44 levels) covers the forecast side keylessly (`AUD-117`).
5. **Smoke is now an annual national event and the data is free.** NOAA HMS smoke polygons (analyst-drawn, Light/Medium/Heavy) and HRRR near-surface smoke (`MASSDEN`, verified present in the public bucket's `.idx`, readable by the existing byte-range GRIB2 path) together beat what MyRadar added after the 2023-06 Quebec event, during which air-quality apps saw a documented national usage spike (`AUD-113`, `AUD-114`).
6. **Blind users call radar the least accessible weather feature, and the fix is known.** The map canvas cannot be made accessible (MapLibre's and Mapbox's own trackers say so); the proven pattern is "radar as data" — nearest-storm distance/bearing/intensity as text, aria-live warning announcements, and a keyboard alternative to drag-panning (WCAG 2.2 §2.5.7). No desktop radar app does this (`AUD-116`).
7. **The decoders are a fuzzing-rich target that has never been fuzzed.** cargo-fuzz works on Windows MSVC now (nightly + the VS AddressSanitizer component); the HDF5 C library had five fuzz-found CVEs in 2025 alone; upstream `netcdf-rust` fuzzes, upstream `nexrad` does not. The realistic bug class here is panic/OOM denial-of-service in hand-written length math (`AUD-112`).

The standing conclusions from the first two passes remain in force: the trust chain before features, the retention lane empty across every radar competitor, customization as the market's switching lever, and the JOY house rules (data never decoration, nothing leaves the machine, playful surfaces stand down during danger).

## Product Map

Core workflows: watch live radar over a place; interrogate a storm (tilts, moments, dealiased velocity, cells, ProbSevere); monitor warnings for a watched place with quiet hours and an emergency override; replay and export an event; plan around weather (route, guidance, tides, tropical). Evidence: `README.md`, `src/App.tsx`, `src/hooks/`, `src-tauri/src/`.

Personas (carried from the evening pass, one added): the subscription-refusing enthusiast; the storm chaser with accumulated palettes and placefiles; the anxious monitor; the second-monitor ambient user; the weather streamer; and — newly evidenced this pass — **the winter-weather user the whole radar market underserves**, who cannot tell from any reflectivity product whether the echo over their house is rain or snow (Supercell Wx #122/#335; RadarScope publishes help articles solely to answer this question). [Supercell Wx #122](https://github.com/dpaulat/supercell-wx/issues/122), [RadarScope](https://radarscope.zendesk.com/hc/en-us/articles/4642837862162-Identifying-Snow-in-RadarScope)

Platforms and distribution: Windows x64, current-user NSIS, signed updater payload, local release gate, no CI builds. Discoverability is currently zero-effort: no GitHub topics strategy, no listing anywhere, and the release asset name pattern is undocumented, which blocks community Scoop manifests from auto-updating (`AUD-119`). Authoring winget manifests remains excluded by owner policy.

Key data flows: everything native goes through one allowlist and one disk cache (`src-tauri/src/http.rs`, `src-tauri/src/cache.rs`); webview requests are bounded by the CSP; Valhalla (FOSSGIS, with `X-Client-Id`) and Open-Meteo are called from the webview. Every switchable layer now carries a provenance record (`src/lib/layerProvenance.ts`), and `npm run check:live` holds fourteen live-provider contracts, four of them release-required.

## Competitive Landscape

### Radar tools (verdicts carried, tracker delta checked 2026-08-31)

- HookEcho: offline chase packs, valid-time replay. Delta since the evening pass: #71 (2026-08-23, closed — reflectivity threshold via URL/config) plus heavy PR velocity. [Repository](https://github.com/d4vid87/hookecho)
- Supercell Wx: the one OSS tracker with a real demand corpus; nothing new past #691 (2026-08-26). The winter items #122/#335 were missed by earlier passes and are directly actionable here. [Tracker](https://github.com/dpaulat/supercell-wx/issues)
- BowEcho (decoded-volume reuse, cross-section), Anvil (PMTiles), NEXRAD Workbench (archive browsing): no new issues since 2026-08-18. GR2Analyst: loyalty through interrogation depth; notably it has **no native soundings**, which users fill with the now-abandoned SHARPpy — an integration gap OpenRadar can take whole. [SHARPpy](https://github.com/sharppy/SHARPpy)
- RadarScope: its winter answer is the proprietary DTN "Precipitation Depiction" (super-res reflectivity + surface obs + model). OpenRadar's answer can be the official MRMS PrecipFlag and the radar's own dual-pol classification, locally decoded, which is more honest about what is measured versus modeled.
- MyRadar: ships an HHC mosaic and added smoke layers after 2023; its review corpus still reads as ad-spam grievance, the wedge the README positions against.

The evening pass's competitive conclusions (customization as switching lever, ~150-table GRLevelX palette culture, placefile ecosystem, Baron arrival-time patent caution) all stand unchanged and are not repeated here; see the roadmap items they already produced (`AUD-094`, `AUD-095`).

### The data gap this pass measured (new)

What the market ships versus what OpenRadar draws today, all sources public and keyless:

- **Precipitation type**: MRMS PrecipFlag categories 0/1/3/6/7/10/91/96 (no precip; warm stratiform; snow; convection; hail; cool stratiform; tropical stratiform; tropical convective), discipline 209 category 6, 2-min cadence, missing −3, no-coverage −1. Verified against the NSSL operational table. There is **no MRMS snow-rate product** — the bucket's 243 CONUS prefixes were enumerated to confirm — so any snow-rate view is a derived product (PrecipRate masked by PrecipFlag=3) and must be labeled derived. [NSSL tables](https://www.nssl.noaa.gov/projects/mrms/operational/tables.php)
- **Per-site hydrometeor classification**: Level III 165/N0H–N3H and 177/HHC, values in steps of 10 (0 ND, 10 biological, 20 clutter, 30 ice crystals, 40 dry snow, 50 wet snow, 60 rain, 70 heavy rain, 80 big drops, 90 graupel, 100 hail+rain, 110 large hail, 120 giant hail, 140 unknown, 150 range-folded); 166/ML melting-layer rings as linked-contour vectors. All verified publishing through 2026 at the Unidata bucket (`TLX_N0H_2026_…` fresh on 2026-08-30), in contrast to NHI/NTV which died 2022-05. [Class table](https://raw.githubusercontent.com/netbymatt/nexrad-level-3-data/master/src/products/165/index.mjs), [RPCCDS](https://www.weather.gov/tg/rpccds)
- **Surface observations**: AWC `https://aviationweather.gov/api/data/metar?bbox={s},{w},{n},{e}&format=json` verified live — compact JSON (~20 KB for a state-sized box), fields for a full station plot (temp, dewpoint, wind, gust, visibility, cover, wxString, altimeter, raw METAR), minute-refreshed cache, keyless, 100 req/min, 400 entries per query, **no CORS by policy** so it is a native-fetch layer. IEM `/api/1/currents.geojson?state=`/`?network=` is the CORS-open, public-domain augmentation (mesonet density), with IEM's own warning that the API is finite-capacity. Station-plot conventions (temp upper-left, dewpoint lower-left, barbs at 5/10/50 kt, sky-cover circle) are documented NOAA standards. [AWC API](https://aviationweather.gov/data/api/), [IEM disclaimer](https://mesonet.agron.iastate.edu/disclaimer.php), [JetStream plots](https://www.noaa.gov/jetstream/wxmaps-max)
- **Historical warnings**: IEM `geojson/sbw.py?ts=` (instant query) and `sts=`/`ets=` (window prefetch, filter client-side on `polygon_begin`/`polygon_end` for smooth scrubbing); `geojson/vtec_event.py` for one event's polygon history. Coverage: polygons 2002+, official 2007-10-01+, county-based TOR/SVR back to 1986 with recorded caveats (backfilled WFOs pre-2005, occasional invalid early geometry). Verified live: `?ts=2011-04-27T22:00:00Z` returned 93 features with `phenomena`, `windtag`, `hailtag`, `damagetag`, `is_emergency`. No official NWS/NCEI queryable archive exists; IEM is the archive of record and states its services are free for any lawful purpose. [Endpoint help](https://mesonet.agron.iastate.edu/geojson/sbw.py?help), [VTEC dataset notes](https://mesonet.agron.iastate.edu/info/datasets/vtec.html)
- **Soundings**: observed — IEM `json/raob.py?ts=&station=` verified live (open CORS, full profile as pres/hght/tmpc/dwpc/drct/sknt); rucsoundings.noaa.gov refused connections during testing and should not be built on; University of Wyoming is scrape-only. Forecast — Open-Meteo pressure-level variables, 19 levels on best-match and 44 on the GFS endpoint. No maintained JS Skew-T library exists (the best references are 12–25-star projects, newest activity 2026-03), so rendering is in-house work on the well-trodden math. [IEM services](https://mesonet.agron.iastate.edu/json/), [Open-Meteo GFS](https://open-meteo.com/en/docs/gfs-api), [skew-t topic](https://github.com/topics/skew-t)
- **Smoke**: HMS polygons at `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/` (Shapefile/KML/GeoTIFF by year/month, `hms_smokeYYYYMMDD`, density Light/Medium/Heavy, finalized next morning ET — poll current day, fall back one). HRRR `MASSDEN` (8 m above ground, µg/m³) and `COLMD` verified present with byte offsets in `hrrr.t00z.wrfsfcf01.grib2.idx` on `noaa-hrrr-bdp-pds` — the same `.idx` byte-range read `src-tauri/src/gfs.rs` already does for wind. Demand: air-quality apps saw a national usage spike during the 2023-06 Quebec event (CNBC, 2023-06-08); NYC activated its emergency plan for Canadian wildfire smoke again on 2026-07-15, its most significant smoke event since 2023; a MyRadar reviewer offers to pay extra for smoke layers. [HMS](https://www.ospo.noaa.gov/products/land/hms.html), [CNBC](https://www.cnbc.com/2023/06/08/air-quality-alert-apps-see-spike-in-usage-as-canada-wildfires-burns.html), [NYCEM](https://www.nyc.gov/site/em/about/press-releases/20260715_pr-NYCEM-NYC-Emergency-Plan-Moves-Into-Thursday-Wildfire-Smoke.page)
- **Satellite beyond GeoColor**: NASA GIBS serves GOES-East/West Band 13 Clean Infrared, Red Visible, and Air Mass as WMTS at 10-min cadence (~40 min latency, 90-day rolling archive) — same provider and terms as the GeoColor layer already shipped. Clean IR is the overnight-convection view enthusiasts ask for. CIRA SLIDER tiles have no published API or terms and are rejected. [GIBS geostationary](https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/)

### Localization and accessibility landscape (new this pass)

- **French**: ECCC operates under the Official Languages Act — every Canadian public weather product is bilingual, so a tool presenting ECCC data to Canada meets an expectation by shipping French. Quebec's Bill 96 requires French UI for software distributed in Quebec (commercial-focused; enforcement against free OSS implausible, but it sets the norm). No OSS desktop radar app ships any localization at all — Supercell Wx is English-only — so ES+FR would be unique in the niche. Mobile OSS weather (Breezy Weather, Overmorrow) ships FR/DE routinely via Weblate. German is the follow-on case (DWD's own WarnWetter app: 6M+ downloads; Kachelmannwetter ~670K monthly visits) but French comes first: OpenRadar already draws ECCC's bilingual-mandated data. Units: CA/DE are metric (km/h), French Canada uses comma decimals. [MSC](https://en.wikipedia.org/wiki/Meteorological_Service_of_Canada), [Bill 96](https://www.weglot.com/blog/bill-96-explained), [WarnWetter](https://www.dwd.de/EN/ourservices/warnwetterapp/warnwetterapp.html)
- **Non-visual access**: the canvas is a dead end (MapLibre issues #359/#360/#362 are cosmetic AT bugs; Mapbox's own accessibility RFC #10114 concedes the map cannot describe itself). The working pattern is parallel accessible surfaces: aria-live regions pre-rendered at load (`polite` for updates, `assertive` for warnings), keyboard-queryable point readouts replacing hover, and single-pointer/keyboard alternatives to drag-panning (WCAG 2.2 §2.5.7 Dragging Movements — W3C's own example is a map; §2.4.11 Focus Not Obscured applies to the panel rails). Weather Gods is the blind-community gold standard ("radar as data": nearest-storm distance, bearing, intensity as text); AppleVis threads confirm radar is the feature blind users give up on. Nothing on desktop does this. [WCAG 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [Mapbox RFC](https://github.com/mapbox/mapbox-gl-js/issues/10114), [AFB on Weather Gods](https://afb.org/aw/18/10/15272)
- **Distribution without packaging**: Scoop manifests are community-submitted with `checkver: github` + `autoupdate` regenerating on every release — the developer's only obligations are a stable asset-name pattern and documented silent-install switches (Tauri NSIS supports `/S`). Chocolatey works the same way with heavier moderation. Neither requires authoring anything, so both fit inside the owner's no-winget-authoring rule. Discovery channels that matter in 2026: GitHub topics, AlternativeTo, awesome-windows and definitive-opensource lists (both accept PRs). [Scoop autoupdate](https://github.com/ScoopInstaller/Scoop/wiki/App-Manifest-Autoupdate), [Tauri NSIS flags](https://v2.tauri.app/distribute/windows-installer/)

### Retention and platform sections

The evening pass's retention landscape (Carrot, Discord Snowsgiving, Wrapped, streak backlash, calm-mode clinical evidence, phosphor nostalgia, easter-egg boundaries) and Windows platform verdicts (tray green with pitfalls, widget red, wallpaper green via `IDesktopWallpaper`, ambient in-app not `.scr`, toasts text-only with the AUMID silent-drop trap) were re-used unchanged by the JOY items and are preserved in those items' notes. Not repeated here; the sources remain listed below.

## Reported Issues

### OpenRadar tracker

Re-verified 2026-08-31 at `e098e40`: zero open or closed issues, zero pull requests, discussions disabled, zero stars, zero forks. Still an absence of field evidence, not evidence of defect-free use. The newest published release is v0.4.0; v0.5.0 is built and staged but unpublished (`npm run release -- --publish` is the next release act).

### Known red gate in the repo itself

Resolved while this pass was closing: the route e2e fallback fixture had still intercepted the retired OSRM endpoint after routing moved to FOSSGIS Valhalla, so the fallback case was never exercised and the full browser gate failed in both Playwright projects. A parallel working session fixed the fixture and removed the item (`AUD-107`) on 2026-08-31 (`52951cc`). No known-failing check remains in the tree.

### Demand corpus

The adjacent-tracker corpus from the evening pass stands with one addition this pass: Supercell Wx #122 "Radar with Precipitation Type Display" (open) and #335 (closed duplicate, 2026-07) — the winter demand the earlier passes missed. Delta since 2026-08-18 across all five adjacent trackers is otherwise essentially empty (HookEcho #71 only).

## Security, Privacy, and Reliability

### Dependency state (verified 2026-08-31, evening pass; unchanged by the drain except as noted)

- `npm audit --omit=dev` and `cargo audit` were clean on 2026-08-31 apart from the two documented items: `lru 0.16.4` (RUSTSEC-2026-0253, unreachable here, blocked on an upstream decision — full analysis in `Roadmap_Blocked.md`) and all-target-only `glib 0.18.5` (`AUD-009`).
- Tauri 2.11.5, Vite 8.2.2, React 19.2.8, MapLibre 6.6.0 all current with no applicable advisories. NEXRAD crates remain release candidates with the upstream `decode_angle` sign fix unreleased (`AUD-092` carries it).
- **New gap identified this pass: none of the native decoders have ever been fuzzed.** The threat model fits: Level II, GRIB2 (two templates decoded by hand), and NetCDF-4/HDF5 all parse remote bytes; the HDF5 C library's 2025 CVE wave (CVE-2025-2923, -2914, -2912, -44905, -6269 — all ASan fuzz finds) shows the format family's density of edge cases; RUSTSEC's trophy history (image/HDR RUSTSEC-2019-0014, libflate RUSTSEC-2019-0010, claxon RUSTSEC-2018-0004) shows pure-Rust decoders yield real findings too. In this codebase the realistic class is panic/OOM DoS in length math rather than memory corruption (little `unsafe`; bzip2 bindings are the one C-adjacent spot deserving ASan scrutiny). cargo-fuzz works on Windows MSVC now (nightly toolchain + VS "C++ AddressSanitizer" component + Developer PowerShell; rough edges tracked in cargo-fuzz #358); `proptest`/`arbitrary` on stable is the friction-free layer that runs in every `cargo test`. Upstream `netcdf-rust` already fuzzes (so the GLM path's parser has coverage); upstream `nexrad` does not, meaning OpenRadar's Level II path relies on unfuzzed release candidates. (`AUD-112`) [Fuzzing on Windows](https://rust-fuzz.github.io/book/cargo-fuzz/windows.html), [HDF5 2025](https://github.com/HDFGroup/hdf5/issues/5381), [trophy case](https://github.com/rust-fuzz/trophy-case)

### Provider terms and continuity

All evening-pass verdicts stand (RRFS 2026-10-06 wait-and-verify; Level II TGFTP move not affecting the AWS path; GLM safe through the GOES-R life; Open-Meteo terms compatible-by-example; OpenFreeMap healthy but single-maintainer; RainViewer fallback-only). New hosts implied by this pass's items, each needing the usual ledger entry and live contract if adopted: `aviationweather.gov` (METARs — cross-origin sharing explicitly not permitted, so native-only, 100 req/min, custom User-Agent recommended and possible from Rust), `satepsanone.nesdis.noaa.gov` (HMS smoke), `noaa-hrrr-bdp-pds.s3.amazonaws.com` (HRRR smoke fields). IEM (`mesonet.agron.iastate.edu`) is already a provider; its API self-describes as finite-capacity, so archived-warning and RAOB queries must be user-action-driven, never polled.

### Alert sound law

Carried verbatim in force: 47 CFR 11.45 (EAS attention signal), 47 CFR 10.520(d) (WEA cadence), NWR 1050 Hz — never shipped, imitated, or user-installable as defaults; the boundary is tested in `JOY-015`'s acceptance. [Rule](https://www.law.cornell.edu/cfr/text/47/11.45)

### Remaining reliability gaps (post-drain refresh)

The evening pass listed four; the drain closed three (provenance record shipped in `src/lib/provenance.ts` + `src/lib/layerProvenance.ts`; `npm run check:live` shipped; `SECURITY.md` and timer ownership shipped). Remaining, all already tracked: `MapViewport.tsx` lifecycle concentration at 1,793 lines (`AUD-086`); WebM export still drives the live timeline (`AUD-097`); export captions read three fields instead of serializing the record (`AUD-102`); the red route-fallback e2e (`AUD-107`).

## Architecture Assessment

Carried: clear browser/native boundary, adapter-chain providers, adversarially tested decoders; pressure points `MapViewport.tsx` (1,793 lines) and `level2.rs` (now 4,217 lines after the decoded-volume cache). The JOY foundations (`JOY-001` token boundary, `JOY-007` local log) and the one-frame-renderer-many-consumers rule stand.

What this pass adds:

- **The MRMS product registry is the app's cheapest growth surface.** Ten products ship today; PrecipFlag rides the identical decode-render-cache path (verified template 41) and differs only in being categorical, which the ramp/legend model must learn once — after which the melting-layer-height, wet-bulb, and FLASH families on the same bucket become S-complexity follow-ons. A categorical ramp is also what Level III N0H needs, so `AUD-108` builds shared vocabulary for `AUD-109`.
- **Every new layer this pass proposes is native-fetch-first.** METARs (CORS forbidden), HMS (no CORS), HRRR smoke (S3) and archived warnings (capacity-limited) all belong behind `http.rs`, the ledger, and per-source provenance — the contracts the drain just shipped exist precisely so these arrive uniform.
- **Accessibility work should produce one parallel data surface, not per-layer patches.** The "radar as data" readout, the aria-live warning channel, and the keyboard pan alternative are one coherent subsystem consulted by existing layers, mirroring how the suppression rule was centralized for the JOY lane.
- The i18n architecture (typed catalogues, pseudolocale clipping test, coverage scan) was built for exactly the French expansion; the cost is translation authorship and review, not plumbing.

## Rejected Ideas

Carried from prior passes, all still correct: full 3D before cross-section; local single-flow nowcast before the ECCC lane; generative nowcasting; cloud accounts, telemetry, sync; mobile clients; plugin marketplace; arbitrary remote placefile URLs; RainViewer as primary; HRRR replacement before RRFS verification; Windows 11 widget (MSIX); `.scr` screensaver; EAS/SAME/WEA/1050 Hz imitation; per-place arrival clocks pending patent reading; streaks and guilt notifications; default-on seasonal sounds; second live MapLibre map in secondary surfaces; runtime-generated personality copy.

New rejections from this pass:

| Idea | Decision and evidence |
| --- | --- |
| CIRA/RAMMB SLIDER as a tile source | Reject. No published API or terms for third-party tile consumption; scraping a research institute's viewer is unpermitted-by-silence. GIBS carries Band 13 legitimately; CIRA composites would mean decoding ABI L1b/L2 from `noaa-goes19` natively. [SLIDER](https://rammb-slider.cira.colostate.edu/) |
| AirNow / EPA AQS air quality | Reject. Both require registered API keys, violating the no-keys rule. [AirNow API](https://docs.airnowapi.org/) |
| Open-Meteo air-quality AQI layer | Defer, under consideration only. Keyless and CORS-open but CAMS-modeled (~25–40 km), not US monitor observations; it will disagree with AirNow during sharp smoke gradients and would need prominent "modeled" labeling. HRRR MASSDEN is the honest key-free US answer. [Docs](https://open-meteo.com/en/docs/air-quality-api) |
| NWS gridpoint forecast raster overlay | Reject. Per-gridpoint REST cannot scale to a pan/zoom raster; no radar competitor renders forecast grids; the real route (NDFD GRIB2 from NOMADS) has no demand signal. Point-tap forecasts already exist. [API](https://www.weather.gov/documentation/services-web-api) |
| Building soundings on rucsoundings.noaa.gov or UWyo scraping | Reject as foundations. rucsoundings refused connections during testing; UWyo is HTML-scrape-only with no CORS guarantee. IEM RAOB JSON is verified, CORS-open, and policy-clean. |
| Taking a JS Skew-T library as a dependency | Reject. The field is 12–25-star projects, newest touched 2026-03; the math is textbook and the rendering must match the app's theme/a11y contracts anyway. Use them as references only. [Topic](https://github.com/topics/skew-t) |
| An MRMS "snow rate" layer presented as measured | Reject as measured; possible later as explicitly derived. The bucket's 243 CONUS products contain no snow-rate grid (enumerated 2026-08-31); PrecipRate masked by PrecipFlag=3 is a derivation and the provenance contract would have to say so. |
| NWS api.weather.gov as the surface-obs source | Reject. Latest-obs is per-station only; a CONUS layer would mean hundreds of calls per refresh against a service that requests identifying User-Agents. AWC bbox query is the designed bulk path. |
| German localization before French | Sequence, not reject. The DWD market signal is real, but OpenRadar draws ECCC's bilingual-mandated data today and the francophone claim is normative, not just commercial. German follows the same (already-built) mechanism once French proves the translation workflow. |
| Chocolatey package maintained from this repo | Reject maintaining one; welcome community packages. Moderation overhead and distribution-rights paperwork for zero control gain; Scoop's autoupdate model needs only stable asset names, which `AUD-119` provides. |

## Sources

Prior passes' source lists (167 entries across retention, community, Windows platform, dependencies, and data-services law) remain valid and are not re-listed; the most load-bearing are retained below beside this pass's new sources.

### Winter and dual-pol
- https://www.nssl.noaa.gov/projects/mrms/operational/tables.php
- https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=CONUS/&delimiter=/
- https://unidata-nexrad-level3.s3.amazonaws.com/?list-type=2&prefix=TLX_N0H_&delimiter=_
- https://www.weather.gov/tg/rpccds
- https://raw.githubusercontent.com/netbymatt/nexrad-level-3-data/master/src/products/165/index.mjs
- https://github.com/dpaulat/supercell-wx/issues/122
- https://radarscope.zendesk.com/hc/en-us/articles/4642837862162-Identifying-Snow-in-RadarScope
- https://www.pivotalweather.com/maps.php?ds=mrms

### Surface observations
- https://aviationweather.gov/data/api/
- https://mesonet.agron.iastate.edu/api/1/currents.geojson?network=IA_ASOS (verified CORS-open)
- https://mesonet.agron.iastate.edu/disclaimer.php
- https://github.com/ktrue/metar-placefile
- https://saratoga-weather.org/grlevelx-placefiles.php
- https://support.allisonhouse.com/hc/en-us/articles/206870333-Integrate-Radar-Data-with-Gibson-Ridge
- https://www.noaa.gov/jetstream/wxmaps-max

### Historical warnings and soundings
- https://mesonet.agron.iastate.edu/geojson/sbw.py?help
- https://mesonet.agron.iastate.edu/info/datasets/vtec.html
- https://mesonet.agron.iastate.edu/json/ (raob.py, vtec_events)
- https://mesonet.agron.iastate.edu/cow/
- https://github.com/sharppy/SHARPpy
- https://open-meteo.com/en/docs/gfs-api
- https://stormtrack.org/threads/viewing-archived-soundings-in-sharppy.29574/
- https://github.com/topics/skew-t

### Smoke and satellite
- https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/
- https://www.ospo.noaa.gov/products/land/hms.html
- https://noaa-hrrr-bdp-pds.s3.amazonaws.com/ (wrfsfc .idx MASSDEN/COLMD)
- https://www.cnbc.com/2023/06/08/air-quality-alert-apps-see-spike-in-usage-as-canada-wildfires-burns.html
- https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/

### Fuzzing
- https://rust-fuzz.github.io/book/cargo-fuzz/windows.html
- https://github.com/rust-fuzz/cargo-fuzz/issues/358
- https://github.com/HDFGroup/hdf5/issues/5381
- https://rustsec.org/advisories/RUSTSEC-2019-0014.html
- https://github.com/rust-fuzz/trophy-case
- https://github.com/camshaft/bolero

### Localization, accessibility, distribution
- https://en.wikipedia.org/wiki/Meteorological_Service_of_Canada
- https://www.weglot.com/blog/bill-96-explained
- https://www.dwd.de/EN/ourservices/warnwetterapp/warnwetterapp.html
- https://github.com/breezy-weather/breezy-weather
- https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- https://github.com/mapbox/mapbox-gl-js/issues/10114
- https://afb.org/aw/18/10/15272
- https://www.applevis.com/forum/ios-ipados/accessible-weather-radar
- https://github.com/ScoopInstaller/Scoop/wiki/App-Manifest-Autoupdate
- https://v2.tauri.app/distribute/windows-installer/
- https://github.com/0pandadev/awesome-windows

### Carried load-bearing sources from prior passes
- https://github.com/dpaulat/supercell-wx/issues
- https://stormtrack.org/threads/open-source-weather-radar-software-supercell-wx.32393/page-2
- https://grlevelxusers.com/grlevelx-goodies/categories/color-tables/
- https://developer.apple.com/news/?id=kf623ldf
- https://www.weather.gov/oun/stormanxiety
- https://www.law.cornell.edu/cfr/text/47/11.45
- https://rustsec.org/advisories/RUSTSEC-2026-0253.html
- https://www.weather.gov/media/notification/pdf_2026/scn26-048_RRFS_and_REFS_Implementation.aab.pdf
- https://open-meteo.com/en/terms
- https://valhalla.openstreetmap.de/
- https://openfreemap.org/

## Open Questions

1. The Baron arrival-time patent (reported on Stormtrack, unread): still needs a reading before any per-place arrival clock. Carried.
2. IEM capacity etiquette: the API self-describes as finite; the proposed usage (user-action-driven archive queries, single-station RAOBs) is far below "highly trafficked website," but if archived-warning replay becomes a headline feature, IEM's bulk shapefile downloads may be the polite prefetch path for famous events. A judgment call at implementation time, not a blocker.
3. Whether the owner wants to submit the AlternativeTo / awesome-list entries personally or have them drafted (publishing under an identity is a person's act, like the upstream `lru` issue). Blocks nothing; `AUD-119` words its acceptance around what the repo controls.
4. Carried: the four operator-gated blockers (isolated desktop session, clean VM, Authenticode certificate, upstream issue filing) in `Roadmap_Blocked.md`.

# Research: OpenRadar

Date: 2026-09-08, evening. Replaces all prior research. Repository snapshot: `f891337` on `main` with three commits unpushed and the `AUD-334` retarget of forty-two e2e specs uncommitted in the tree while its full-suite run finishes; manifests at v0.12.0 with an unreleased `v0.12.0` section in `CHANGELOG.md`; published release still v0.4.0 (2026-08-31). Tenth pass; the ninth ran on 2026-09-07 evening at `74cf9be`. Eighty-nine commits landed between the two: the drain of `AUD-411` through `AUD-429`, then `AUD-388`, `434`, `437`, `438`, `439`, `441`, `442`, `443`, `444` and the advisory gate, three refutation rounds, and the repairs the third round forced tonight. This pass re-verified the ninth where the world had moved in twenty-four hours, which was little, and dug where the day's own work had exposed something the ninth could not have seen: the geometry of the sweep box, the frame a panel is awaited in, the reach of the failure-path gate, and a competitor tracker that filled with real users in forty-eight hours.

## Executive Summary

OpenRadar remains the most complete keyless desktop radar workstation in the open-source field, and the field moved toward it this week rather than past it: HookEcho published a comparison table on 2026-09-07 staking the same claims (free, no account, Level II at every tilt, dual-pol, dealiasing, MRMS, GLM, archive), so the wedge is now contested on paper, and Omastorm went from nothing to fifty-three stars and nineteen issues in two days, which makes its tracker the best record of what first-week users of a radar app actually hit. Nothing found tonight changes the direction. What changed is that the day's own drain shipped one reader-visible regression that has to come out, and the refutation pass that found it also found the shape of a constraint nobody had written down: one 1,024-pixel raster cannot both cover the window and match its resolution, and the code had been silently choosing coverage all along.

Top opportunities, in order:

1. **`AUD-438` must be reverted.** It moved the sweep's narrowing two zoom levels earlier so the raster matched the screen pixel for pixel, and a raster that matches the screen covers exactly 1,024 CSS pixels of it. With the centre snapped to a grid of half the box width, a reader is guaranteed a quarter of the box either side of where they are looking, so the progression in the tree covers a window about 504 pixels wide at zooms 8 to 11 and the mosaic is at opacity zero under a single-site sweep: a rectangle of radar in bare basemap on every window wider than that. The old progression covers about 2,016 pixels and is the maximum narrowing that does, because at zoom 8 a 1,920-pixel window already spans 5.27 degrees against a 5.54 degree disc. Nothing asserted coverage, which is how it shipped. Verified by arithmetic against `src/lib/level2.ts:530-548` and `MapViewport.tsx:684-688`; `AUD-447`.
2. **The coverage ceiling is a real limit today, not only after the regression.** The bound scales with the disc's width in degrees, which shrinks toward the equator: about 2,016 CSS pixels at KDMX (41.7 north) and about 1,670 at KAMX (25.6 north), so a maximised 1,920 window over Miami at zoom 10 already shows basemap at one edge in the worst snap position. The remedy is a design decision (a larger raster, more than one raster, or the mosaic kept under the sweep), not a constant. Verified arithmetic; `AUD-453`, and the constraint `AUD-440` has to respect.
3. **A shader that will not build fails open.** Omastorm's first-week tracker holds two independent reports of a radar layer that compiled on one driver, failed on another, and drew nothing while the map read as a clear night. The wind layer here has the same shape: `windLayer.ts:304-309` catches the compile or link failure, `MapViewport.tsx:1085` writes it to the log, the layer stays in the style with its switch on, and the catalogue string that names the failure (`wind.noDraw`, `en.ts:2204`) is shown by nothing. Verified; `AUD-448`.
4. **The frame drawn while a panel's chunk arrives was standing in for the wrong panel** (title, width and side), and rendered a heading that six e2e cases took for the panel itself. Fixed tonight in `77c8240` with a source-reading test that pins the copy to the panel components; recorded here because the class (a stand-in that outruns what it stands in for) is worth knowing when the next lazy boundary is added. Verified.
5. **The README makes a claim the code stopped honouring.** `README.md:152` says the app checks for updates "only when you ask it to"; `useUpdates.ts:114-119` asks an hour after launch and once a day after that, and the CHANGELOG says so. SECURITY.md's narrower claim (nothing downloads unasked) is still true. Verified; `AUD-452`.
6. **The failure-path gate has a hole and a false-positive class.** `reports.ts:386` writes a fetch `TypeError`'s message into a translated sentence and throws it as a plain `Error`, which `failureSentence` passes through verbatim into overlay state that panels render; the gate cannot see a message travel through a `throw`. Its reassignment regex also treats a JSX attribute as an assignment and runs to the next semicolon, which is past the element. Verified; `AUD-450`, `AUD-451`.
7. **File-to-file switches still get the sliver.** `AUD-439` measured a file from disk on its own site's disc, keyed on the sweep on screen; when the sweep on screen is the previous file, the new file gets the previous file's box, and the per-site disc map that fix introduced has no test that would notice its collapse (every fixture station shares one set of corners, and collapsing the map to a single disc leaves 26 of 26 green). Verified in an isolated copy by the refutation pass and by reading; `AUD-449`.
8. **Small, evidenced follow-ups from the third refutation:** the historical hold evicts oldest-inserted rather than least-used and is never released on return to live (`AUD-454`); the advisory gate's prefix rule accepts a release candidate of a named version (`AUD-455`); the chunk-failure detector misses Vite's own CSS preload rejection (`AUD-456`); the export caption's ellipsis is length-neutral in a proportional font (`AUD-457`); the stand-in has no accessible name while a chunk loads (`AUD-458`); viewport-overriding e2e cases run twice for nothing (`AUD-459`); a live scan that keeps failing is logged at debug only (`AUD-460`).
9. **Dependencies: quiet.** MapLibre 6.8.0 shipped 2026-09-07 22:23 UTC; reqwest 0.13.5 (a proxy-auth fix) and rustls 0.23.44 are a `cargo update` away; typescript-eslint 8.70.0 adds a rule that can go red under `--max-warnings 0`. The critical MapLibre XSS published 2026-09-08 (CVE-2026-85061) caps at 6.4.0 and the tree has been past it since before the ninth pass. Chrome 153 shipped 230 fixes on 2026-09-08, four critical in WebGL, while WebView2 Evergreen is still on the 152 line; that is Microsoft's to ship. Verified; noted on `AUD-355`.
10. **Corrections to the ninth pass:** MesoPulse has not launched (the PlacefileNation countdown still reads "launching September 1" and `mesopulse.com` does not resolve), so the trusted-host argument it carried is weaker than written; `nexrad` PR #148 is still open with zero comments, so `AUD-378` stays the app's own table. Verified.

## Product Map

- Core workflows: watch live radar over a place (a two-hour national loop, a nearest-site Level II view looping across up to thirty volumes, the office's own word on whether each radar is running, the next one offered when a held site stops); interrogate a storm (tilts, six moments, dealiased and storm-relative velocity, the sweep drawn over the ground the reader is looking at from zoom 10, smoothing, a wind profile from the radar's own NVW product first, cross-sections that say how much of their volume stayed folded, gate readout, beam height, cell tracks, hydrometeor class, ProbSevere, MRMS grids across five domains); understand the day (the SPC outlook set with conditional intensity, WPC rain and winter outlooks, mesoscale discussions, warnings from three countries each credited to its own office, reports from two sources, rivers, tides, surge); replay a past day, or a `.orb` bundle offline; be told (ten watched places, quiet hours, calm mode); leave it running (tray, autostart, glance, wallpaper, full-screen); take it away (PNG with a credit that fits, WebM, MP4, GIF, CSV, GeoTIFF with a provenance sidecar, incident packs, `.pal` tables).
- Personas: the subscription-refusing enthusiast, the chaser with palettes and placefiles, the anxious monitor, the second-monitor ambient reader, the flood-prone reader, the winter-weather reader, the streamer, the screen-reader user.
- Platform and distribution: Windows x64 only, NSIS current-user installer, minisign-signed updater that checks hourly then daily and downloads nothing unasked, no Authenticode; ARM64 blocked. Release gate in `scripts/release.mjs`; the advisory gate (`npm run check:advisories`) queries OSV under both spellings of every crate name and refuses an allowance with nothing written above it.
- Data flow: every native request through `src-tauri/src/http.rs`, the page CSP for browser-side fetches, thirteen overlay adapters, MRMS from the `noaa-mrms-pds` bucket (`mrms.rs:2071`), Level II from the Unidata bucket and its chunk bucket, so neither SCN26-67 (Level II leaves NOMADS 2026-09-15) nor the 403s on `mrms.ncep.noaa.gov/data/ALASKA` touch this tree. The site list is still the pinned `nexrad-model` registry (`AUD-378`).
- Baseline tonight: `npm run check` 214 files / 2,187 passed / 39 skipped, every chunk inside budget; `cargo test --lib` 498 passed per the day's last recorded run; the full browser suite 796 cases across three projects, green through 663 at the time of writing with the `AUD-334` fixture installed, which fails any spec that drops a promise. Tracker: zero issues, zero pull requests, discussions disabled, two stars, and a first fork (`marcusdax/OpenRadar`, 2026-09-08 18:58 UTC, an unmodified snapshot 26 commits behind).

## Competitive Landscape

### Open source

- **HookEcho** (d4vid87, Rust, MIT, 59 stars). Twenty-eight commits since 2026-09-07, the author's launch post on Bluesky at 22:15 UTC that day, and a public comparison table at `hookecho.io/compare` against RadarScope, MyRadar, Windy, RadarOmega and RainViewer whose claimed differentiators are this app's: free, no ads, no account, Level II at every tilt, ZDR/CC/KDP/PhiDP, dealiased and storm-relative velocity, full-resolution MRMS, GLM, archive to 1991. The 2026-09-08 evening burst (#316 to #321) is all map-rendering repair: zoom stutter and basemap flashing, tessellation off the UI thread, road strokes swelling through zoom, labels vanishing across tile transitions, a permalink resetting zoom, a WebGL startup crash from misaligned camera uniforms. Learn: the list is what a map-based radar UI hits at scale, and the basemap is a provider's problem here by design. Avoid: the browser build, the label work. Still no release past v0.12.0-beta.2 (2026-08-31). Verified.
- **StormDesk** (d4vid87, JS, MIT, 43 stars): v4.1.0 on 2026-09-07 and v4.2.0 on 2026-09-08, a rebrand from WeatherDesk with an OLED-black desk, alerts as a scrolling banner, and a degraded renderer for Samsung appliance browsers. A dashboard that embeds HookEcho; the fleet's shape for this is the glance window. Verified.
- **Omastorm** (wesleygrimes, Rust plus Quickshell, MIT): 0 to 53 stars, two beta releases on 2026-09-07, nineteen open issues and nine pull requests from outside contributors within forty-eight hours. Two clusters. Live chunk polling: a poller that sat silent for four hours on an `IncompleteMessage` (#7), one that idled at a volume boundary when the last chunk arrived as `-E` (#19), and two transient resets latching a false OFFLINE (#20). Checked here: `chunks.rs:262-336` re-lists the bucket on every poll and `commands.rs:113-118` degrades a failed live scan to the finished volume rather than holding a connection, so there is no state to latch; the one thing worth carrying is that the reason goes to `log::debug!` (`AUD-460`). Shader portability: a `const` array initialiser invalid on GLSL ES 100 (#16) and GLSL 120 (#22), so the radar layer compiled nowhere and drew nothing, and the map read as clear. This does reproduce here for the wind layer (`AUD-448`). Also: draw neighbouring stations for a place between sites, argued from beam height (#23); home view on a point rather than a station (#1, #5); AQI (#3); smoke (#2, which this app has); an ARM64 binary (#4, #15). Verified.
- **Anvil** (jhammon88219, C#, AGPL): ten commits since 2026-09-07, all performance (a byte-capped decoded-frame cache, one tilt extracted from a legacy volume instead of seventeen, a parallel cold first paint, a before-and-after harness), and the in-app style editor removed. Still no release, no issues. Verified.
- **The `nexrad` crates** (danielway): no commit since 2026-07-21; PR #148 (the registry fix, 2026-09-04) untouched, zero comments; no crate published after 2026-04-03. Verified.
- **ClassicRadar** dropped CARTO basemaps on 2026-09-08 because CARTO began watermarking keyless raster tiles in late August; this tree uses OpenFreeMap and USGS and names no CARTO host. **LibreWXR** (JoshuaKimsey, Python, AGPL, 78 stars), a self-hosted RainViewer replacement, added a Windy-style colour scheme on 2026-09-08. **GenericRadar** (FahrenheitResearch, Rust egui plus wgpu, Apache-2.0, last push 2026-08-25) is the BowEcho author's second radar codebase and had not been listed before. **arw** spent 2026-09-07 on storm-relative velocity and a rotation-signal corpus. **BowEcho**, **Supercell Wx**, **RadrView**, **WxLens**, **MRMS-browser**, **radar-ng**, **Py-ART**, **TINT**, **vlouf/dealias**: no change. Verified.
- New repositories since 2026-09-06: no serious desktop product. Five unlicensed Python placefile generators (wind profilers, CWOP, field mills) pushed 2026-09-08 to 09-09 say the placefile-authoring culture is active; a Chrome extension (`weather-maid-daily`), a Level II archive downloader, and an MRMS federated-nowcasting reproduction (`pegasus-isi/fedcast-workflow`). Verified.

### Commercial

- **MyRadar** v7.125.0 (2026-09-08): SPC mesoscale discussions as a toolbar layer. The app has had `spcDiscussions` since the layer registry was built (`src/lib/overlays/registry.ts:16`). Verified.
- **RadarScope** iOS 5.6.2 (2026-09-03, a crash fix); **RadarOmega**, **GRLevelX**, **WSV3** (V7.11, the V6 rewrite still "2027"), **Weather Pulse**, **Baron**, **Windy**, **WeatherWise**, **Carrot**, **Weatherfront**: no change found. Verified or Likely per Sources.
- **PlacefileNation / MesoPulse**: the homepage still says "54 operational placefiles" and the MesoPulse countdown still reads "LAUNCHING SEPTEMBER 1, 2026"; `/mesopulse` is 404 and `mesopulse.com` does not resolve. It has not shipped, which corrects the ninth pass. Verified.

### Community signal

- **Basemap and label quality is what readers judge**: six HookEcho fixes in two days on labels, strokes and zoom stutter; a Bluesky reader leaving Rain Alarm because it names a lake wrong (2026-09-08); a Hacker News comment on rain cut off at a tile boundary (2026-09-08). Three sources, one theme; the basemaps here are the providers', which is the right call and a known limit. Verified.
- **Latency honesty**: a Substack post (2026-09-07, on HN) on syncing a phone video to public radar found MRMS acquisitions "up to 10 minutes late" because it blends stations. The app puts an age beside every frame and the single-site sweep (four call sites of `frameAgeMinutes` and `sweepAgeMinutes`); the gap is per-layer rows, which is `AUD-345`. Verified.
- **"Free, open, no account" is now a public claim of a direct competitor** (HookEcho's table). The evidence-on-screen posture (the folded share on the legend, the credit in the picture, the office on every warning) is the differentiator that table does not list. Verified.
- HN on other apps this window: "they effed up the UI" (Apple Weather), "very very very low information density" (a new app), "reliability of the infra has suffered" (a pilot on NWS feeds). Nothing radar-specific on Reddit, Mastodon or Stack Overflow since 2026-09-07. Verified.

### Adjacent

- **MapLibre 6.8.0** (2026-09-07): terrain mipmapping, `getStyleUrl()`, lazy `Intl.Segmenter`, programs linked before compile status is read (parallel driver compiles), a cloned default marker (about twice as fast for mass markers, which the report and lightning layers are), HTTP 204 raster-DEM tiles as no-data, a warn-once on canvas clamping, and the render-task-throw freeze fixed. `main` has fifteen more commits on 2026-09-08 (drape re-render bounding, hidden-layer clipping skip, a zero-width resize fix). Verified.
- **Windows App SDK** 2.4.0 (2026-08-13) unchanged; **WebView2** docs unchanged; **awesome-maplibre** unchanged; no new map-accessibility guidance since 2026-09-01. Verified.
- Naming: the GitHub `openradar` organisation is the open radar science community (Py-ART, `openradarscience.org`); the name is shared in this space. Recorded, not acted on.

## Reported Issues

The tracker holds zero issues, zero pull requests and no discussions (`gh`, 2026-09-08 evening). The effective tracker is the three refutation reports of 2026-09-08 (the third landed tonight against `db461ff..4450979`), the live contracts, and the trackers of the projects this one depends on or competes with.

- **A bug reported upstream that this app has**: danielway/nexrad #148, unchanged. Re-verified live 2026-09-08: `api.weather.gov/radar/stations` lists 159 ids including KHDC, KBHX, KDOX, KLGX and PAPD; KLIX answers 404 and has zero objects on the bucket for 2026-09-07 and 2026-09-08 while KHDC has 295. `AUD-378`.
- **From the third refutation, confirmed by reading or by an isolated copy**: the coverage regression (`AUD-447`, HIGH); the file-to-file sliver and the untested disc map (`AUD-449`); the frame's title, width and side (fixed, `77c8240`); the `reports.ts` leak and the JSX false positive (`AUD-450`, `AUD-451`); the hold's eviction and release (`AUD-454`); the prefix rule (`AUD-455`); the CSS preload message (`AUD-456`); the ellipsis (`AUD-457`); two comments made false (folded into `AUD-449`); the e2e floor that can flake at a disc edge (folded into `AUD-447`).
- **From the full e2e run tonight**: two guidance cases pinned Celsius under a Fahrenheit label (the test was wrong; corrected in `da29985`), and a sixteen-load case ran on a single-load budget (`f891337`). Neither relaxed an assertion.
- **Adjacent-tracker asks still unmet here**: Omastorm #23 (a neighbouring site chosen by beam height for a place between radars; the picker here ranks by distance and shows beam height on readout), Supercell Wx #480, #617, #691 as before.
- **Judged stale or not actionable**: Omastorm's poller cluster (does not reproduce, see above); CARTO's watermark (no CARTO host here); SCN26-67 (Level II comes from the Unidata bucket, not NOMADS); the `mrms.ncep.noaa.gov/data/ALASKA` 403 (MRMS comes from the bucket); `goes-r.gov` retiring 2026-09-30 (not linked anywhere in the tree); MyRadar's mesoscale discussions (already a layer).

## Security, Privacy, and Reliability

- **Dependency state, 2026-09-08 evening.** `npm outdated`: `maplibre-gl` 6.7.0 to 6.8.0, `@playwright/test` 1.62.1 to 1.63.0, `eslint` 10.9.1 to 10.10.0, `typescript-eslint` 8.69.0 to 8.70.0 (new rule `no-generated-empty-object-type`; a new rule under `--max-warnings 0` can turn the lint gate red), `lucide-react` 1.41.0 to 1.43.0, `@types/node` 26.4.1 to 26.5.0, `typescript` held at 5.8.3. Cargo: `reqwest` 0.13.5 (2026-09-08, fixes the wrong proxy credentials being sent when several proxies match) and `rustls` 0.23.44 (2026-09-07) are inside the caret ranges; `image` still pinned `=0.25.8` against 0.25.10; everything else at latest or deliberately pinned. Verified.
- **Advisories since 2026-09-06.** npm: GHSA-jrc7-96c5-q579 (CVE-2026-85061, critical, `maplibre-gl <= 6.4.0`, zero-click XSS through `DOM.sanitize` on a live `NamedNodeMap`; tree on 6.7.0, not affected) and GHSA-82fw-gwwq-j7x9 (CVE-2026-84373, moderate, `vitest`/`@vitest/mocker` path traversal, fixed in 5.0.0-rc.2; lock holds 5.0.0). RustSec: rojo and greentic-setup only; on 2026-09-08 the eleven gtk3-rs "unmaintained" entries were withdrawn, and none of the allowances in `src-tauri/.cargo/advisories.txt` or `audit.toml` rests on them (RUSTSEC-2024-0429 on `glib` is still live). OSV still answers `block_buffer` and not `block-buffer`, so the two-spelling query the gate makes remains necessary. Verified.
- **Platform.** Chrome 153 stable on 2026-09-08 with 230 security fixes, five critical (four WebGL use-after-free or out-of-bounds, one Cast); Edge and WebView2 Evergreen still on 152.0.4191.66 (2026-09-04), so every installed copy runs a renderer one Edge release behind that set until Microsoft ships 153. CISA KEV added two Windows local privilege escalations on 2026-09-08 (CVE-2026-81963, CVE-2026-85880), fixed in that day's Patch Tuesday; nothing named touches WebView2, notifications or the shell. Tauri 2.12 still unreleased (milestone 15 open / 32 closed, 76 pending change files); wry 0.57.0 shipped 2026-09-08 (MSRV 1.85, `windows` 0.62, drops Windows 7) and PR #15996 pulls it into 2.12, so this tree stays on wry 0.55.1 until then. Node 24.21.0 (2026-09-08) is inside the engines range. Verified.
- **Service changes.** NCO reported an inbound dataflow delay 2026-09-07 04:29 to 06:16 UTC naming METARs, LSRs and model data. No SCN or PNS dated 2026-09-07 or 09-08; PNS26-62 (CAP primary, possible VTEC discontinuation) and PNS26-63 (SBN retirement from 2027-08-31) close for comment 2026-09-21. ROC: 24.2 "expected September 2026", 25.0 mid-2027. No GLM anomaly; ABI solar calibration scans 2026-09-14 (GOES-18) and 09-15 (GOES-19). Open-Meteo: two server-side accounting commits, no API change. ECCC, DWD, MeteoAlarm, NWPS, tides, SPC, Hazard Simplification: unchanged. RRFS and REFS operational 2026-10-06 (SCN26-48); HRRR not retired that day. Verified.
- **Reliability findings in the tree, this pass**: the wind layer fails open on a shader that will not build (`AUD-448`); a persistent live-scan failure is invisible outside a debug log (`AUD-460`); the historical hold pins up to eight decoded sweeps for the life of the window after the reader returns to live (`AUD-454`); the README's update claim is false (`AUD-452`).
- **Privacy posture holds**: nothing proposed adds a socket, an account or telemetry. The update poll is the one unasked request the app makes and it is documented in CHANGELOG and SECURITY.md; the README line is the outlier.

## Architecture Assessment

- **Pressure points by size** (2026-09-08): `index.css` 6,322, `mrms.rs` 6,322 (`AUD-330`), `App.tsx` 3,214 (`AUD-272`, up 76 lines in a day), `level3.rs` 2,909, `incident_packs.rs` 2,597, `MapViewport.tsx` 2,526, the three catalogues 2,240 to 2,307, `settings.ts` 2,138 (`AUD-423`), `dealias.rs` 1,511, `useSingleSiteRadar.ts` 1,368. **By churn since 2026-09-07**: the catalogues 23 to 25 touches each, `index.css` 15, `level2.ts` 11, `App.tsx` 8, `level2/testing.rs` 8, `level2/draw.rs` 8. Twelve commits in two days touch sweep geometry, gate placement or the box; that is the hotspot and where the regression came from. Verified.
- **A constraint the code chose without saying so.** `sweepDetailBox` narrows the raster for resolution and snaps its centre for cache stability, and the two together bound the window it can cover. The old exponent happened to satisfy a 2,000-pixel window; nothing in the file, the tests or the roadmap said that was the requirement, so a change that improved resolution walked straight through it. The fix is an assertion (`AUD-447`) and then a decision (`AUD-453`); `AUD-440`, which wants the ceiling expressed as ground resolution against the gate, has to keep the same bound.
- **A stand-in that outran its subject.** `LazyPanel`'s placeholder carried a heading and a class chosen by the frame outside the chunk, and both were wrong for most panels. The repair copies title and class out of the panel components into `SURFACE_FRAMES` and has a test read the components back on every run, which joins the failure-path, asset-ledger and CSP tests as a test that reads source. The pattern is established: when a copy of a literal must exist outside a module, a test reads the module.
- **The failure-path gate**: reads all of `src`, follows a value through a local and a helper, and still cannot follow it through a `throw` or into a property key; and its reassignment regex is grammar-blind to JSX. Two more rounds of "found by reading" on 2026-09-08 (`reports.ts`, the wind layer's `onError`) say the gate is a floor, not a ceiling. `AUD-451` names the two extensions.
- **Tests**: 214 vitest files, 42 browser specs across three projects (796 cases; the `AUD-334` fixture now fails any of them that drops a promise), 34 annotated `#[ignore]`s (live network and corpus generators), seven fuzz targets, zero TODO or FIXME markers in the tree. Missing after this pass: a coverage assertion on the box (`AUD-447`), a disc fixture that differs per station (`AUD-449`), a shader-failure test with a stubbed `compileShader` (`AUD-448`), and a real KDMX disc in `level2.test.ts` (it is 4.56 degrees wide while claiming to be a 230 km disc, which is 5.54; folded into `AUD-447`).
- **Documentation**: `README.md` 8,942 words with Install at line 140 of 466; one line false (`AUD-452`). `docs/architecture.md` current. The gitignored working notes are read at every session start in this repo and are 48 KB tonight, down from 182 KB on 2026-09-07 after `AUD-384`; still above the 30 KB budget.

## Rejected Ideas

Carried, all still correct: cloud accounts, telemetry, sync; mobile clients; plugin marketplace; arbitrary remote placefile URLs without a trusted-host decision; RainViewer as primary; generative nowcasting; commercial feed scraping; a headless or hosted server; MCP servers; NWWS-OI; Blitzortung; 3D volume before the cross-section is fast; a second MapLibre instance per pane; Spotter Network before the owner contacts them; optical-flow frames; a tracker of its own; ML tornado detection before `AUD-189`; TypeScript 7; `noRedirectionBitmap` on first availability; more than two panes; Windows Widgets; NEXRAD SNS over a websocket; MQTT and headless render; a portable zip; multi-user; a browser entry point; a git pin of `nexrad-decode` (hold); MTG-LI; Icechunk mirrors; deck.gl-raster; WebGPU (hold); a ticking arrival countdown; the full-screen view brought up by a warning; winget or a Store listing.

| Idea | Decision and evidence |
| --- | --- |
| Keep `AUD-438` and raise the raster to 2,048 pixels instead | Reject as the fix. A 2,048 square RGBA sweep is 16 MB decoded against 4 today, times a hold of thirty loop frames and eight historical ones; that is `AUD-453`'s decision to make with numbers, not a way to keep a regression green. |
| Narrow the box to the viewport itself rather than to a fraction of the disc | Hold, inside `AUD-453`. It removes the snap grid that keeps a held loop frame worth holding; every pan would be a fetch. |
| Choose the single site by beam height over a place rather than by distance (Omastorm #23) | Under consideration, M. The picker ranks `sites_in_reach` by distance and the readout shows beam height; the argument that a farther radar can see lower over a place between two is sound, and nothing here asks for it yet. |
| A restart-the-poller watchdog (Omastorm #7, #19, #20) | Not applicable. The live path lists the bucket fresh on every poll and falls back to the finished volume; there is no long-lived connection to watch. |
| Drop CARTO basemaps (ClassicRadar, 2026-09-08) | Not applicable. No CARTO host in `http.rs` or the CSP; the basemaps are OpenFreeMap's and USGS's. |
| SPC mesoscale discussions as a layer (MyRadar 7.125.0) | Already has it: `spcDiscussions` in the overlay registry. |
| Add a per-frame "data age" chip (HN and the Substack post) | Already has it for frames and the sweep; the per-layer form is `AUD-345`. |
| Rename the project because `openradar` is the radar-science organisation | Reject for now. Recorded so the next pass does not re-raise it; the owner's call. |
| Replace the source-reading tests with rendered-tree comparisons | Reject. `surfaceFrames.test.ts` compares two literals; rendering nineteen panels to read two attributes would need every one of their props. |

## Sources

### Repository, upstream and release state
- https://github.com/SysAdminDoc/OpenRadar/releases
- https://github.com/marcusdax/OpenRadar
- https://github.com/danielway/nexrad/pull/148
- https://crates.io/api/v1/crates/nexrad-model/versions
- https://api.weather.gov/radar/stations?stationType=WSR-88D
- https://api.weather.gov/radar/stations/KLIX
- https://unidata-nexrad-level2.s3.amazonaws.com/?list-type=2&prefix=2026/09/08/KHDC/
- https://unidata-nexrad-level2.s3.amazonaws.com/?list-type=2&prefix=2026/09/08/KLIX/

### Competitors and community
- https://github.com/d4vid87/hookecho/commits/main and https://hookecho.io/compare
- https://bsky.app/profile/d4vid87.bsky.social/post/3muxjv4dqxc2g
- https://github.com/d4vid87/stormdesk/releases
- https://github.com/wesleygrimes/omastorm/issues (#7, #16, #19, #20, #22, #23) and /pulls
- https://github.com/jhammon88219/Anvil/commits/main
- https://github.com/extrosy-sys/ClassicRadar/commits/main
- https://github.com/JoshuaKimsey/LibreWXR
- https://github.com/FahrenheitResearch/GenericRadar
- https://github.com/stevo399/arw/commits/main
- https://itunes.apple.com/lookup?id=288419283 (RadarScope) and ?id=322439990 (MyRadar)
- https://www.wsv3.com/ and https://weatherpulse.com/blog
- https://placefilenation.com/
- https://news.ycombinator.com/item?id=49604167 and ?id=49604669
- https://bsky.app/profile/cindy-cdr.bsky.social/post/3muxshc7hgk2g
- https://carto.com/basemaps/apikey/

### Data services and notices
- https://www.weather.gov/notification/
- https://www.nco.ncep.noaa.gov/status/messages/
- https://www.ospo.noaa.gov/operations/messages.html
- https://www.roc.noaa.gov/branches/engineering-branch/software-engineering.php
- https://www.roc.noaa.gov/spg-documents.php
- https://www.weather.gov/documentation/services-web-api
- https://github.com/open-meteo/open-meteo/commits/main
- https://github.com/eccc-msc/open-data
- https://noaa-rrfs-ops-pds.s3.amazonaws.com/?list-type=2&delimiter=/
- https://www.weather.gov/media/notification/pdf_2026/scn26-67_NEXRAD_Level_%202_radar_data_move_NOMADS_to_TGFTP.pdf

### Dependencies, platform, security
- https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.8.0 and /commits/main
- https://github.com/maplibre/maplibre-style-spec/issues/1490
- https://github.com/maplibre/maplibre-gl-js/pull/7411
- https://github.com/advisories/GHSA-jrc7-96c5-q579
- https://github.com/advisories/GHSA-82fw-gwwq-j7x9
- https://github.com/rustsec/advisory-db/commits/main
- https://api.osv.dev/v1/query
- https://github.com/seanmonstar/reqwest/releases/tag/v0.13.5
- https://github.com/tauri-apps/tauri/milestone/10 and /pull/15996
- https://github.com/tauri-apps/wry/releases/tag/wry-v0.57.0
- https://chromereleases.googleblog.com/ (Stable Channel Update for Desktop, 2026-09-08)
- https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel
- https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
- https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.70.0
- https://github.com/nodejs/node/releases/tag/v24.21.0

## Open Questions

1. `AUD-453` is a decision before it is code: a larger raster (memory times the hold), more than one raster per sweep (a tiling scheme the loop and the compare pane would have to follow), or the mosaic left under the sweep (a national picture showing through the edges of a site's). The arithmetic is in the item; which trade the owner wants is not.
2. Does the owner want the single site chosen by beam height over a watched place rather than by distance (Omastorm #23)? It changes which radar a reader between two sites is handed by default.
3. Carried unchanged: the registry route for `AUD-378` (the app's own table, recommended; #148 is unreviewed); the trusted placefile-host decision (weaker now that MesoPulse has not shipped); comments on PNS26-62 and PNS26-63 close 2026-09-21; the publish of 0.5 through 0.12, the isolated desktop session, the clean VM and the code-signing purchase, all in `Roadmap_Blocked.md`.

# OpenRadar Research

Research snapshot: 2026-08-31, second pass of the day. Repository snapshot: `0b3c654` on `main`, 131 commits. This document replaces the 2026-08-31 morning pass, which itself replaced 2026-08-30. Everything carried forward from the morning pass was re-verified today; everything new is dated. A parallel working session held uncommitted chrome and stylesheet changes in the tree during this pass (`src/App.tsx`, `src/components/WorkspaceChrome.tsx`, `src/index.css`, `docs/mockups/`); nothing below depends on that in-flight work.

## Executive Summary

OpenRadar is a credible local-first weather workstation: national mosaics, raw NEXRAD Level II and Level III decoded in Rust, live radial chunks, MRMS, warnings, ProbSevere, tropical products, tides, surge, guidance, route weather, replay, export, backups, English and Spanish, in one Tauri window with no account and no telemetry. The morning pass established the incident-workstation direction (offline packs, archive import, decoded-volume reuse, cross-sections, alert policy, provenance) and the trust-release gate that precedes it. Both were re-verified and stand. This pass adds the research behind the new character-and-personalization backlog (`JOY-001` through `JOY-021`) and refreshes every dependency, provider, and tracker snapshot.

The headline finding: the retention lane is genuinely empty. Across the trackers, docs, and marketing of RadarScope, RadarOmega, GRLevelX, WSV3, Supercell Wx, HookEcho, BowEcho, and Anvil, checked 2026-08-31, no radar product ships personality, seasonal themes, a journal, a recap, an ambient mode, or easter eggs. The adjacent evidence says these features work when done right: Carrot Weather built a durable paid business and a 2021 Apple Design Award on an opt-out personality and collectible secret locations, and The Weather Channel itself shipped an official WeatherStar 4000 nostalgia emulator on 2026-04-01. Nobody in the radar niche has tried. There is opportunity here, and no rejection evidence. [Carrot profile](https://developer.apple.com/news/?id=kf623ldf), [ws4kp](https://github.com/netbymatt/ws4kp), [TWC stunt](https://www.retroist.com/p/weatherstar-4000-then-and-now)

Top opportunities, in order:

1. The trust release first, unchanged from the morning pass: close the `lru` advisory, land the provenance contract and the live-provider gate, publish the post-audit build (`AUD-067`, `AUD-068`, `AUD-069`, `AUD-002`). Version metadata synchronization (`AUD-001`) was completed to 0.4.0 by a parallel working session on 2026-08-31 while this pass was closing.
2. The switching lever in this market is accumulated customization, not the renderer. A Stormtrack user announced leaving GRLevelX for Supercell Wx on 2025-02-15 with one reason: "all of my placefiles and colortables is working." A palette library and placefile quality-of-life work convert that lever into an on-ramp (`AUD-094`, `AUD-095`). [Thread](https://stormtrack.org/threads/open-source-weather-radar-software-supercell-wx.32393/page-2)
3. The storm journal (`JOY-008`) appears to be unshipped territory anywhere: nothing found auto-drafts a journal entry from radar or warning events. Nearest neighbors are Day One's weather metadata and Apple Journal's suggestion drafts. [Day One](https://dayoneapp.com/guides/day-one-on-the-web/auto-add-location-and-weather-to-entries/), [Apple Journal](https://www.apple.com/newsroom/2023/12/apple-launches-journal-app-a-new-app-for-reflecting-on-everyday-moments/)
4. A streamer capture mode has zero competition in any tracker and proven bolt-on demand (AtmosphericX exists solely to make weather coverage OBS-friendly; Ryan Hall's overlay kit is community-cloned) (`AUD-093`). [AtmosphericX](https://github.com/AtmosphericX/AtmosphericX), [rh-stream-overlays](https://github.com/dutchdronesquad/rh-stream-overlays)
5. Platform verdicts for the JOY desktop-presence items are now settled: tray plus glance window, wallpaper writer, and ambient mode are green with concrete APIs and pitfalls; a Windows 11 widget is red for an NSIS app. Details in the platform section.
6. WebM export can leave real time behind: it currently records the live timeline through MediaRecorder, and WebCodecs `VideoEncoder` is available in every evergreen WebView2 (`AUD-097`). `src/lib/export.ts`, [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
7. Alert toasts can carry a radar snapshot and an action button by dropping to WinRT, and the AUMID must be right or Windows silently drops them (`AUD-098`). [Toast docs](https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/toast-desktop-apps)
8. `AUD-070` now has its answer for routing: the FOSSGIS Valhalla instance explicitly welcomes distributed end-user apps (announce the app, send `X-Client-Id`), which the OSRM demo policy never did. [Valhalla](https://valhalla.openstreetmap.de/)
9. The legal boundary for alert sounds is settled and verified: 47 CFR 11.45 prohibits transmitting the EAS attention signal or simulations of it, with a $1M consent decree on record; a desktop app's own original tones are plainly outside it, and the actual EAS tones, SAME bursts, WEA cadence, and the NWR 1050 Hz tone stay out of the product. [Rule text](https://www.law.cornell.edu/cfr/text/47/11.45)

## Product Map

Core workflows: watch live radar over a place; interrogate a storm (tilts, moments, dealiased velocity, cells, ProbSevere); monitor warnings for a watched place; replay and export an event; plan around weather (route, guidance, tides, tropical). Evidence: `README.md`, `src/App.tsx`, `src/hooks/`, `src-tauri/src/`.

Personas, updated this pass: the weather enthusiast who refuses subscriptions (the cohort Stormtrack calls out directly, and the AlternativeTo lists confirm: free OSS options dominate requested alternatives to RadarScope and MyRadar); the storm chaser with accumulated palettes and placefiles; the anxious monitor who checks compulsively during events (about 1 in 8 people report weather-related anxiety, and the NWS publishes storm-anxiety guidance); the second-monitor ambient user (MagicMirror's 23,500 stars and DAKboard's business prove the dedicated-display habit); and, newly evidenced, the weather streamer compositing radar into OBS. [Stormtrack](https://stormtrack.org/threads/best-free-radar-software.32006/), [AlternativeTo](https://alternativeto.net/software/radarscope/), [NWS anxiety page](https://www.weather.gov/eax/stormanxiety-wxinfo), [MagicMirror survey](https://www.pistack.xyz/posts/2026-06-05-self-hosted-smart-mirror-digital-display-platforms-guide/)

Platforms and distribution: Windows x64, current-user NSIS, signed updater payload, local release gate, no CI builds. Unchanged. `src-tauri/tauri.conf.json`, `scripts/release.mjs`.

Key data flows: everything native goes through one allowlist and one disk cache (`src-tauri/src/http.rs`, `src-tauri/src/cache.rs`); webview requests are bounded by the CSP; OSRM and Open-Meteo are called from the webview. Attribution for Open-Meteo and OSRM already exists in panel copy (`src/i18n/en.ts` lines 34, 146, 219), and the native User-Agent carries a contact address (`src-tauri/src/http.rs`).

## Competitive Landscape

### Radar tools (verdicts re-verified 2026-08-31, condensed from the morning pass)

- HookEcho: offline chase packs, valid-time replay, alert controls prove the incident direction. Newest issue is a GPU-fallback question (#13, 2026-08-10); nothing on sounds, journaling, or tray. [Repository](https://github.com/d4vid87/hookecho)
- BowEcho: decoded-volume reuse, cross-section, cancellation. One open issue, macOS signing (2026-06-09). [Repository](https://github.com/FahrenheitResearch/bowecho)
- Supercell Wx: the only OSS tracker with a real demand corpus; see Reported Issues. Keep OpenRadar's simpler workspace. [Repository](https://github.com/dpaulat/supercell-wx)
- NEXRAD Workbench: local Archive II import and arbitrary archive browsing are the high-value research workflows. [Repository](https://github.com/danielway/nexrad-workbench)
- Anvil: PMTiles offline basemaps on desktop. Zero open issues. [Repository](https://github.com/jhammon88219/Anvil)
- GR2Analyst: loyalty comes from interrogation depth and a decade of tutorial culture (AllisonHouse and Convective Chronicles series keep the workflow entrenched). Cross-section remains the right first vertical feature. [Tutorials](https://support.allisonhouse.com/hc/en-us/articles/206870353--GR2AE-Introduction-to-GR2Analyst-Edition)
- RadarScope, RadarOmega, Windy, Storm Radar, Pivotal: subscription differentiators unchanged; OpenRadar competes on local-first access and no account. Morning-pass citations stand.
- MyRadar on Windows: two Store SKUs; the dominant grievance in review aggregates is ad spam and upsell ("deceptive virus warning ads", subscriptions that do not transfer), plus enough Windows breakage for a dedicated vendor support tree. This is the wedge the README already positions against. [Support tree](https://acmeaom.freshdesk.com/support/solutions/folders/44001197238), [reviews](https://justuseapp.com/en/app/322439990/myradar-weather-radar/reviews)

One competitive-moat caution surfaced on Stormtrack (2023-04-15, reported claim, not verified against the patent itself): Baron holds a patent said to block geographic-grid storm arrival-time overlays ("arrives at your location at 3:42"), which WSV3 licenses and GRLevelX lacks. OpenRadar's cell layer draws projected positions, not per-place arrival clocks. Before anyone builds "reaches your house in N minutes", the patent claim needs reading. [Thread](https://stormtrack.org/threads/open-source-weather-radar-software-supercell-wx.32393/)

### The customization ecosystem (new this pass)

- grlevelxusers.com hosts about 150 color tables across 12 categories with uploads dated into 2026 and per-file download counts up to 179; the site notes its tables also work in RadarScope, Supercell Wx, and WeatherFront. `.pal` is the de facto interchange format, which validates OpenRadar's existing import. [Color tables](https://grlevelxusers.com/grlevelx-goodies/categories/color-tables/)
- Palette authoring has its own tooling (Mods for GRX Color Table Creator) and palette-hunting is a recurring forum behavior (WXForum request threads). [CTC](https://mods-for-grx.com/ctc), [WXForum](https://www.wxforum.net/index.php?topic=39549.0)
- The OSS world is rebuilding the paid placefile ecosystem as free directories (placefiles.supercellwx.net). Remote placefile URLs stay blocked in OpenRadar until a trusted-host model exists (`Roadmap_Blocked.md`), but local placefile quality-of-life is where the loyalty sits. [Directory](https://placefiles.supercellwx.net/)

### Retention and personality landscape (new this pass)

What the adjacent evidence says about each JOY lane:

- Personality: Carrot Weather is the proof. Five personality levels with a full professional off-switch, over 100 secret locations collected by exploring the map, content updates shipped like live-ops, a 2021 Apple Design Award, and reviewers crediting the character as the reason they open the app on clear days. The moat is fresh writing plus collectibles plus total opt-out. [Behind the Design](https://developer.apple.com/news/?id=kf623ldf), [secret locations](https://forums.macrumors.com/threads/carrot-weather-secret-locations.1862623/), [v5 notes](http://www.meetcarrot.com/weather/v5.html)
- Seasonal themes: welcomed when visual, ambient, and one click to dismiss; resented when they touch functional surfaces. The canonical failure is Discord Snowsgiving, December 2021: festive notification sounds shipped default-on, coverage was entirely "how to turn this off", and Discord flipped to opt-in within hours. The visual halves of the same event built goodwill. AOL Mail users filed feedback demanding holiday themes back when they were removed. This is why `JOY-002` keeps occasions chrome-only and dismissible, and why anything audible is opt-in. [Newsweek](https://www.newsweek.com/turn-off-discord-christmas-snowsgiving-sound-alerts-1656889), [AOL feedback](https://aol.uservoice.com/forums/939516-aol-mail-norrin/suggestions/47198477-add-more-holiday-themes)
- Journaling: demand exists in fragments (Weather Diary apps, paper five-year weather logbooks selling steadily, chasearchive.com, Storm Chaser Atlas auto-logging chase routes), and no product auto-drafts entries from weather events. `JOY-008` would be first. [Weather Diary Pro](https://apps.apple.com/us/app/weather-diary-pro/id6757074943), [logbook](https://www.amazon.com/Year-Weather-Logbook-Watching-Notebook/dp/B09NRCZT96), [Storm Chaser Atlas](https://apps.apple.com/us/app/storm-chaser-atlas/id6758031108)
- Recaps: the Wrapped pattern is ubiquitous and its failure modes are documented. Identity claims share; stat tables do not. Privacy criticism of the genre is structural, and OpenRadar's local-only computation is immune to it, which is itself worth saying out loud. Strava put Year in Sport behind its subscription in December 2025 and the response was overwhelmingly negative. The recap stays free and local forever (`JOY-011`). [Axios](https://www.axios.com/2022/12/21/wrapped-spotify-year-review-personal-data), [road.cc](https://road.cc/content/news/strava-year-sport-now-only-subscribers-317425)
- Milestones: record, do not obligate. Duolingo streak guilt and Apple Watch ring anxiety are the documented backlash; watchOS 11's rest days were the celebrated correction. Personal weather records are observations about the world, not performance to fail at, which is why `JOY-012` bans streaks and prompts outright. [Streak Creep](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification), [Fortune](https://www.fortune.com/well/2025/01/24/apple-watch-bullied-burn-calories-close-rings-obsession-fitness-trackers-notifications)
- Calm mode: about 1 in 8 people report weather-related anxiety, the NWS publishes storm-anxiety guidance, a 2021 controlled study found app warning design directly feeds the compulsive checking loop, and no radar or mainstream weather app ships an anxiety-aware mode. The clinical guidance (bounded checking, plain language, when the threat ends) effectively writes the `JOY-016` spec. [NWS](https://www.weather.gov/oun/stormanxiety), [study](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8392799/)
- Phosphor and ambient nostalgia: cool-retro-term carries 25,700 GitHub stars twelve years after release; WeatherStar 4000+ has an active fork ecosystem and a hosted instance; The Weather Channel shipped an official WeatherStar emulator as its 2026-04-01 stunt. The phosphor look also has an honest functional story: persistence was how a scope showed contact history, which is exactly what a radar trail is (`JOY-004`, `JOY-017`). [cool-retro-term on HN](https://news.ycombinator.com/item?id=46036895), [ws4kp](https://github.com/netbymatt/ws4kp)
- Easter eggs: they build loyalty in serious tools (Excel 97's flight simulator, Android's version eggs, ForeFlight's hidden gems) with two documented boundaries: Microsoft banned undocumented hidden code under Trustworthy Computing in 2002 (an open-source app with eggs visible in the repo sidesteps this), and Tesla's Passenger Play drew an NHTSA investigation because play was reachable during the safety-critical moment. The rule that falls out: playful surfaces suppress themselves while a warning is active at a watched place. That rule is now in the roadmap's house rules. [Excel](https://weeklyrecess.com/article/the-story-of-the-hidden-flight-simulator-game-in-microsoft-excel-97/), [NHTSA](https://www.washingtonpost.com/technology/2021/12/22/tesla-video-games/)

### Windows platform feasibility (new this pass, all checked 2026-08-31)

- Tray and glance window (`JOY-018`): green. Tauri 2 tray is core and Windows is its best platform; dynamic `set_icon` works for hazard-state badges. Pitfalls: ghost tray icons linger after exit unless the icon is dropped explicitly, and config-declared plus programmatic trays duplicate. A second `WebviewWindow` costs roughly one renderer process, but a second live MapLibre map can cost hundreds of MB, so the glance window gets pre-rendered frames, never a second GL map. Always-on-top has a report of differing dev and release behavior; test packaged. [Tray docs](https://v2.tauri.app/learn/system-tray/), [ghost icons](https://github.com/tauri-apps/tauri/discussions/4668), [process model](https://github.com/tauri-apps/tauri/discussions/7904)
- Windows 11 widget: red for an NSIS app. Widget providers require package identity (MSIX or PWA), the UI is Adaptive Cards only, and Microsoft sidelined the Widgets Board at Build 2026. Whether sparse packaging honors the widget extension is undocumented. Rejected below. [Widget providers](https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-providers)
- Wallpaper writer (`JOY-019`): green via the `IDesktopWallpaper` COM interface (per-monitor, no elevation, callable from the `windows` crate); `SystemParametersInfoW` is the single-monitor fallback. The cautionary tale is Microsoft's own Bing Wallpaper app, panned in November 2024 for bundling everything but wallpaper. Single-purpose, opt-in, restore-on-disable. Wallpaper Engine's roughly 80,000 concurrent Steam users show the appetite for a living desktop. [IDesktopWallpaper](https://learn.microsoft.com/en-us/windows/desktop/api/shobjidl_core/nf-shobjidl_core-idesktopwallpaper-setwallpaper), [Bing Wallpaper](https://www.techspot.com/news/105673-official-bing-wallpaper-app-does-nasty-malware-like.html), [Steam charts](https://steamdb.info/app/431960/charts/)
- Notifications (`AUD-098`): tauri-plugin-notification on Windows is text-only (actions are mobile-only; last release 2025-10-27), and toasts are silently dropped without a Start-menu shortcut carrying the right AUMID. Rich toasts (image, buttons, urgent scenario) need WinRT toast XML from Rust, with images as local file paths. [Plugin docs](https://v2.tauri.app/plugin/notification/), [toast requirements](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/send-local-toast-other-apps), [silent drop](https://github.com/Ivy-Interactive/Rustino/issues/11)
- Ambient mode (`JOY-017`): green as an in-app fullscreen mode, which is what MagicMirror and DAKboard users actually run; shipping a real `.scr` is legacy fragility with no verified 2026 demand. Long-run display care: app-level pixel shift, scheduled auto-dim, no pure-white static text, a frame-rate cap gated on radar cadence, and a docs note that mostly-static dashboards belong on LCD rather than OLED. [Lively's approach](https://github.com/rocksdanister/lively/wiki/Screen-Saver), [burn-in guidance](https://www.viewsonic.com/library/gaming/oled-burn-in-what-it-is-why-it-happens-and-how-to-stop-it/)

## Reported Issues

### OpenRadar tracker

Re-verified 2026-08-31 at `0b3c654`: zero open or closed issues, zero pull requests, discussions disabled, zero stars, zero forks. The repository is two days old; this is an absence of field evidence, not evidence of defect-free use. The public v0.3.0 release still predates the audit repairs on `main`. [Issues](https://github.com/SysAdminDoc/OpenRadar/issues), [v0.3.0](https://github.com/SysAdminDoc/OpenRadar/releases/tag/v0.3.0)

### Demand corpus from adjacent trackers (2026 filings a prior pass had not seen, checked 2026-08-31)

Supercell Wx is the only OSS competitor with a real demand corpus. New in 2026: SPS as a dedicated layer (#685, 2026-08-18); free layer reordering (#691, shipped in OpenRadar already); follow-alerts auto-zoom to new warnings (#637); color tables failing to persist across restart (#639, which shows palette persistence is a felt stake); placefile renaming, quick toggles, and per-file icon scaling (#614); movable toolbox panels (#611); multi-site radar caching (#613); cursor readout across panes (#616); freehand annotation with arrows, text, and measurement (#590, the nearest thing to journaling demand in the niche); voice lightning alerts announcing strike distance (#581); KML/KMZ import (#655); settings export corruption (#675). Nothing anywhere requests tray modes, theming beyond color tables, or multi-location alert profiles, consistent with the retention lane being unexplored rather than rejected. [Tracker](https://github.com/dpaulat/supercell-wx/issues)

HookEcho added one issue since the morning pass (#13, GPU wind fallback question). BowEcho has one open issue (macOS signing). Anvil has none.

The morning pass's standing signals remain in force and are not repeated in full here: alert fatigue on polygon updates (Supercell Wx #617), chrome-only high contrast missing the data (HookEcho #12), observed and forecast radar must stay distinguishable (Windy forum, LibreWXR #24), platform claims need hardware evidence (HookEcho #9), provenance fragility (NEXRAD Workbench #180), beginner overwhelm (r/weather threads).

## Security, Privacy, and Reliability

### Dependency state (all verified 2026-08-31)

- `npm audit --omit=dev`: zero known production vulnerabilities.
- `cargo audit`: only unmaintained-crate warnings for Linux-only GTK3 transitives, plus the two known items below.
- `lru 0.16.4` remains via `netcdf-reader 0.9.1 -> hdf5-reader 0.9.1`, and the fix cannot arrive by `cargo update`: hdf5-reader pins `lru = "^0.16.3"`, so RUSTSEC-2026-0253 (patched in lru 0.18.2, issued 2026-08-11) needs an upstream bump, a `[patch]`, or a vendored fork. The advisory trigger requires a panicking `Drop` on cache keys, so practical risk is low, but the scanner will keep flagging it. This sharpens `AUD-067`. [Advisory](https://rustsec.org/advisories/RUSTSEC-2026-0253.html), [pin](https://crates.io/api/v1/crates/hdf5-reader/0.9.1/dependencies)
- `glib 0.18.5` remains in all-target scans only (`AUD-009` unchanged). [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)
- Tauri 2.11.5 is current and clean: no advisories after the origin-confusion fix in 2.11.1 (2026-05-06). Vite 8.2.2 contains every 2026 dev-server fix (all advisories were dev-server-only, including the Windows NTFS short-name bypass patched 2026-06-01); none affect production builds. React 19.2.8 is current; the December 2025 React CVEs were server-component packages this app does not use. [Tauri advisories](https://github.com/tauri-apps/tauri/security/advisories), [Vite advisories](https://github.com/vitejs/vite/security/advisories)
- The frontend lockfile already resolves maplibre-gl 6.6.0, vite 8.2.2, react 19.2.8, and tauri-plugin-log 2.9.0; the manifest minimums lag but the tree is current. RustSec has nothing new in 2026 for reqwest, tokio, png, chrono, flate2, or bzip2.
- NEXRAD crates: still release candidates (nexrad-data 1.0.0-rc.7, decode rc.3, model rc.2 are the newest published). Upstream is active (pushed 2026-07-21, zero open issues) and holds an unreleased fix worth watching: `decode_angle` in the VCP decoder does not honor the sign bit, reading roughly 360 degrees for negative elevations (issue #144, fixed on main 2026-07-21). OpenRadar is not bitten today because cut matching reads the median of radial-measured angles (`src-tauri/src/level2.rs` lines 442 to 449), not the VCP message, but this belongs in the `AUD-092` compatibility watch. [nexrad](https://github.com/danielway/nexrad)

### Provider terms and continuity (verified 2026-08-31)

- RRFS and REFS v1 remain scheduled operational for 2026-10-06 (SCN 26-48 AAB, issued 2026-07-06; parallel feeds moved to NOMADS 2026-08-11, and the old prototype AWS bucket stopped updating then). `AUD-080`'s wait-and-verify posture is correct. [SCN 26-48 AAB](https://www.weather.gov/media/notification/pdf_2026/scn26-048_RRFS_and_REFS_Implementation.aab.pdf)
- SCN 26-67 moves real-time Level II from NOMADS to TGFTP on 2026-09-15; OpenRadar's AWS chunk path is untouched. SCN 26-54 confirms the 2027 Level II change is an additive hourly LTR message from about 2027-02-15; the decoder's unknown-type sweep already covers it, and the repo's own bucket listing shows the KCRI testbed stream has no public archive copy to test against. SCN 26-30 changed only the CO-OPS SHEF text feed; the REST API the tides panel uses is unaffected. The only 2026 MRMS notice is the v12.3.1 patch (2026-02-04), which improved Rotation Tracks quality and removed nothing. [Notices index](https://www.weather.gov/notification/)
- GOES-19 ABI and GLM are green (OSPO status, updated 2026-08-04). New on the five-year horizon: NOAA discontinued the GeoXO Lightning Mapper contract as of 2026-07-24 under the FY2026 restructuring. GLM continuity is safe through the GOES-R series life (first GeoXO launch around 2032), so no action now, but the lightning layer should stay source-pluggable. FY2026 appropriations resolved toward continuity for NWS and open data; no reduction to NEXRAD, Level II dissemination, MRMS, or the AWS open-data buckets was found. [OSPO](https://www.ospo.noaa.gov/operations/goes/status.html), [CRS IF12898](https://www.congress.gov/crs-product/IF12898)
- Open-Meteo free tier: non-commercial, under 10,000 calls per day and 600 per minute per client, CC-BY attribution. A free app with no ads or subscriptions, where each user's own IP calls the API, fits their own stated examples; the distributed-app case is not explicitly addressed, so this is labeled: terms compatible by their examples, not an explicit blessing. Panel attribution already exists; an app-identifying User-Agent is not possible from the webview, which is acceptable. [Terms](https://open-meteo.com/en/terms)
- OSRM demo policy is unchanged (non-commercial, one request per second, identifying User-Agent mandatory, withdrawal at any time). The webview cannot send a custom User-Agent, which OpenRadar cannot fix while calling OSRM directly. The durable answer for `AUD-070` is the FOSSGIS Valhalla instance: full-planet, fair use of one call per user per second, and distributed end-user apps are explicitly invited to announce themselves and send an `X-Client-Id` header, which a webview can set. Stadia's hosted Valhalla and a self-hosted US-extract container are the fallbacks. [OSRM policy](https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy), [FOSSGIS Valhalla](https://valhalla.openstreetmap.de/)
- OpenFreeMap: no limits, no keys, commercial use allowed, and it survived an accidental 100,000 requests-per-second incident. It is also one maintainer funded by about $500 a month in donations with sponsored bandwidth, so the style and tile endpoints should stay configurable and the self-hosting docs are the contingency. [Site](https://openfreemap.org/), [incident writeup](https://blog.hyperknot.com/p/openfreemap-survived-100000-requests)
- RainViewer terms unchanged since 2026-01-01 (personal use, zoom 7, fallback only). Morning-pass posture stands.

### Alert sound law (new this pass, verified 2026-08-31)

47 CFR 11.45(a): no person may transmit the EAS codes or attention signal, or a recording or simulation thereof, outside an actual emergency or authorized test. Enforcement history is entirely against regulated transmission (iHeart $1M in 2015 after aired tones triggered downstream EAS boxes; ABC, AMC, Discovery consent decrees in 2019; Fox $504,000 forfeiture ordered 2024). No action against an app has been found, and commentators treat the online edge as open. The practical rule for OpenRadar: original synthesized tones are plainly fine; the EAS attention signal (853+960 Hz), SAME data bursts, the NWR 1050 Hz tone, and the WEA cadence (47 CFR 10.520(d)) are never shipped, imitated, or user-installable defaults, because a user's speakers can be picked up by a live stream or trip a nearby SAME receiver, which is exactly how the iHeart cascade happened. `JOY-015` carries this as a tested boundary. [Rule](https://www.law.cornell.edu/cfr/text/47/11.45), [iHeart](https://www.fcc.gov/document/iheart-pay-1m-misusing-eas-tones-during-bobby-bones-show), [Fox forfeiture](https://docs.fcc.gov/public/attachments/FCC-24-109A1.pdf)

### Remaining reliability gaps (carried, still true at 0b3c654)

- No common provenance record across radar, overlays, guidance, exports (`AUD-068`).
- No single local live-provider contract command (`AUD-069`).
- `MapViewport.tsx` lifecycle concentration and suppressions (`AUD-086`); toast and preset timer ownership (`AUD-089`); no `SECURITY.md` (`AUD-090`).
- New, small: WebM loop export drives the live timeline in real time through MediaRecorder (`src/lib/export.ts` line 136, `src/hooks/useExport.ts`), so a long loop export occupies the workspace for its full wall-clock duration and any interaction risk is handled by restore-in-finally rather than by isolation. WebCodecs encoding removes the real-time bound (`AUD-097`).

## Architecture Assessment

The morning-pass assessment stands (clear browser and native boundary, adapter-chain providers, adversarially tested decoders, normalizing settings envelopes; pressure points in `MapViewport.tsx` at 1,793 lines and `level2.rs` at 3,684 lines, repeated decode work, fragmented live tests). What this pass adds:

- The JOY lane has two load-bearing foundations and they are the right ones: the chrome-token boundary (`JOY-001`) is what makes every theme, seasonal pack, and calm mode safe to build, and the local event log (`JOY-007`) is the storage contract behind journal, recap, catch-up, and almanac. Neither should be improvised inside a feature item.
- Anything that presents radar outside the main window (glance window, wallpaper, ambient snapshot, streamer surface, toast image) should consume pre-rendered frames from the existing providers and cache, never a second live map. The cost evidence is in the platform section; the architectural consequence is one frame-rendering path with many consumers.
- The suppression rule (playful surfaces stand down while a warning is active at a watched place) belongs in one place that themes, effects, eggs, and ambient mode all consult, not in each feature.
- A parallel session is reworking `WorkspaceChrome` and the stylesheet; the `AUD-086` decomposition and the `JOY-001` token boundary should land after that pass settles to avoid conflicting ownership of the same files.

## Rejected Ideas

Carried from the morning pass, all still correct: full 3D before cross-section; local single-flow nowcast before the official ECCC extrapolation lane; generative nowcasting in the bundle; cloud accounts, telemetry, sync; mobile clients; plugin marketplace; arbitrary remote placefile URLs; commercial feed scraping; RainViewer as primary; replacing HRRR before RRFS is verified operational; nine-pane layouts; broad model-layer expansion in one pass; becoming an OGC server.

New rejections from this pass:

| Idea                                                                          | Decision and evidence                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows 11 Widgets Board widget                                               | Reject. Requires MSIX package identity and Adaptive Cards UI, Microsoft sidelined the board at Build 2026, and the sparse-package route is undocumented for widgets. The tray glance window delivers the value without dual packaging. [Widget providers](https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-providers) |
| Shipping a real `.scr` screensaver                                            | Reject. Legacy format, WebView2 bootstrap inside the screensaver context is fragile, no verified demand; in-app ambient mode is the proven pattern. [Lively](https://github.com/rocksdanister/lively/wiki/Screen-Saver)                                                                                                                    |
| EAS, SAME, NWR, or WEA tone imitation in any sound setting                    | Reject permanently, including as user-importable defaults. 47 CFR 11.45 and the enforcement record; the boundary is tested in `JOY-015`. [Rule](https://www.law.cornell.edu/cfr/text/47/11.45)                                                                                                                                             |
| Per-place storm arrival-time overlay ("reaches you at 3:42")                  | Defer pending patent review. A Baron patent is reported to cover geographic-grid arrival-time overlays; projected cell positions remain fine. [Thread](https://stormtrack.org/threads/open-source-weather-radar-software-supercell-wx.32393/)                                                                                              |
| Daily-open streaks, guilt notifications, usage badges                         | Reject. Documented backlash (Duolingo streak anxiety, Apple Watch ring obsession); `JOY-012` ships facts without obligation. [Streak Creep](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification)                                                                                        |
| Default-on seasonal sounds or sounds bundled into theme packs                 | Reject. Discord Snowsgiving 2021 is the failure template; audible anything is opt-in and separate from visual packs. [PC Gamer](https://www.pcgamer.com/discord-snowsgiving-sounds-alerts-turn-off/)                                                                                                                                       |
| A second live MapLibre map in the glance window or ambient snapshot consumers | Reject on cost. A heavy webview renderer runs hundreds of MB; pre-rendered frames serve every secondary surface. [Process model](https://github.com/tauri-apps/tauri/discussions/7904)                                                                                                                                                     |
| Personality copy generated by a language model at runtime                     | Reject. Carrot's moat is authored writing with a consistent voice; generated copy adds a network or model dependency, an unpredictable tone, and nothing the catalogue cannot do. Authored strings in `src/i18n/` keep the voice testable and translatable. [Behind the Design](https://developer.apple.com/news/?id=kf623ldf)             |

## Sources

The morning pass's 77-source inventory remains valid and is not repeated; the entries below are the sources this second pass added or re-verified. Repository paths are cited inline throughout.

### Retention, personality, and product culture

- https://developer.apple.com/news/?id=kf623ldf
- https://techcrunch.com/2015/03/20/carrot-weather-delivers-your-daily-forecast-with-a-side-of-snark/
- https://yourstory.com/2022/12/carrot-weather-app-personality-political-opinions
- https://forums.macrumors.com/threads/carrot-weather-secret-locations.1862623/
- http://www.meetcarrot.com/weather/v5.html
- https://www.macrumors.com/2021/06/10/2021-apple-design-awards/
- https://problem2product.substack.com/p/does-carrot-weather-solve-a-problem
- https://www.newsweek.com/turn-off-discord-christmas-snowsgiving-sound-alerts-1656889
- https://www.pcgamer.com/discord-snowsgiving-sounds-alerts-turn-off/
- https://sensortower.com/blog/liveops-for-the-holiday-season
- https://aol.uservoice.com/forums/939516-aol-mail-norrin/suggestions/47198477-add-more-holiday-themes
- https://dayoneapp.com/guides/day-one-on-the-web/auto-add-location-and-weather-to-entries/
- https://www.apple.com/newsroom/2023/12/apple-launches-journal-app-a-new-app-for-reflecting-on-everyday-moments/
- https://apps.apple.com/us/app/weather-diary-pro/id6757074943
- https://apps.apple.com/us/app/storm-chaser-atlas/id6758031108
- https://chasearchive.com/
- https://techcrunch.com/2025/12/06/spotify-wrapped-2024-is-almost-here-its-time-to-explore-all-the-copycats/
- https://www.axios.com/2022/12/21/wrapped-spotify-year-review-personal-data
- https://road.cc/content/news/strava-year-sport-now-only-subscribers-317425
- https://news.slashdot.org/story/25/12/19/2158235/strava-puts-popular-year-in-sport-recap-behind-an-80-paywall
- https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification
- https://www.fortune.com/well/2025/01/24/apple-watch-bullied-burn-calories-close-rings-obsession-fitness-trackers-notifications
- https://www.tomsguide.com/wellness/smartwatches/watchos-11-apple-watch-is-finally-getting-the-fitness-feature-ive-been-waiting-for
- https://www.weather.gov/eax/stormanxiety-wxinfo
- https://www.weather.gov/oun/stormanxiety
- https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8392799/
- https://www.theglobeandmail.com/canada/article-weather-apps-data-wildfires-storms-preparation-obsession-social-media/
- https://news.ycombinator.com/item?id=46036895
- https://github.com/netbymatt/ws4kp
- https://www.retroist.com/p/weatherstar-4000-then-and-now
- https://weeklyrecess.com/article/the-story-of-the-hidden-flight-simulator-game-in-microsoft-excel-97/
- https://www.androidauthority.com/android-easter-eggs-818694/
- https://ipadpilotnews.com/2016/11/8-hidden-features-foreflight-8/
- https://www.washingtonpost.com/technology/2021/12/22/tesla-video-games/

### Community, ecosystem, and competitors

- https://stormtrack.org/threads/open-source-weather-radar-software-supercell-wx.32393/
- https://stormtrack.org/threads/what-software-do-you-guys-use.26739/
- https://stormtrack.org/threads/best-free-radar-software.32006/
- https://grlevelxusers.com/grlevelx-goodies/categories/color-tables/
- https://itim.co/grlevelx-resources/
- https://mods-for-grx.com/ctc
- https://www.wxforum.net/index.php?topic=39549.0
- https://grlevelx.com/manuals/color_tables/
- https://placefiles.supercellwx.net/
- https://github.com/dpaulat/supercell-wx/issues
- https://github.com/AtmosphericX/AtmosphericX
- https://obsproject.com/forum/threads/weather-alert-notification-in-stream.155531/
- https://github.com/dutchdronesquad/rh-stream-overlays
- https://wsv3.com/
- https://alternativeto.net/software/radarscope/
- https://alternativeto.net/software/myradar/
- https://justuseapp.com/en/app/322439990/myradar-weather-radar/reviews
- https://acmeaom.freshdesk.com/support/solutions/folders/44001197238
- https://support.allisonhouse.com/hc/en-us/articles/206870353--GR2AE-Introduction-to-GR2Analyst-Edition

### Windows platform

- https://v2.tauri.app/learn/system-tray/
- https://github.com/tauri-apps/tauri/discussions/4668
- https://github.com/tauri-apps/tauri/issues/8982
- https://github.com/tauri-apps/tauri/discussions/7904
- https://learn.microsoft.com/en-us/windows/apps/develop/widgets/widget-providers
- https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/grant-identity-to-nonpackaged-apps-overview
- https://learn.microsoft.com/en-us/windows/desktop/api/shobjidl_core/nf-shobjidl_core-idesktopwallpaper-setwallpaper
- https://www.techspot.com/news/105673-official-bing-wallpaper-app-does-nasty-malware-like.html
- https://steamdb.info/app/431960/charts/
- https://v2.tauri.app/plugin/notification/
- https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/send-local-toast-other-apps
- https://github.com/Ivy-Interactive/Rustino/issues/11
- https://github.com/tauri-apps/tauri/issues/11461
- https://www.xda-developers.com/3-reasons-eartrumpet-is-a-must-have-for-windows-power-users/
- https://www.pistack.xyz/posts/2026-06-05-self-hosted-smart-mirror-digital-display-platforms-guide/
- https://github.com/rocksdanister/lively/wiki/Screen-Saver
- https://www.viewsonic.com/library/gaming/oled-burn-in-what-it-is-why-it-happens-and-how-to-stop-it/

### Dependencies and toolchain

- https://github.com/maplibre/maplibre-gl-js/releases
- https://maplibre.org/maplibre-gl-js/docs/examples/pmtiles-source-and-protocol/
- https://tauri.app/release/tauri/all-versions/
- https://v2.tauri.app/release/
- https://github.com/tauri-apps/tauri/security/advisories
- https://crates.io/api/v1/crates/hdf5-reader/0.9.1/dependencies
- https://github.com/danielway/nexrad
- https://rustsec.org/advisories/RUSTSEC-2026-0253.html
- https://github.com/vitejs/vite/security/advisories
- https://react.dev/versions
- https://blogs.windows.com/msedgedev/2026/08/24/webview2-is-moving-to-a-2-week-release-cadence/
- https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API

### Data services, terms, and law

- https://www.weather.gov/notification/
- https://www.weather.gov/media/notification/pdf_2026/scn26-048_RRFS_and_REFS_Implementation.aab.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-67_NEXRAD_Level_%202_radar_data_move_NOMADS_to_TGFTP.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-54_WSR-88D_Level2_Add_LTR.pdf
- https://www.weather.gov/media/notification/pdf_2026/scn26-30_CO-OPS_SHEF_Water_Level_Data_Changes.pdf
- https://www.ospo.noaa.gov/operations/goes/status.html
- https://www.congress.gov/crs-product/IF12898
- https://spacenews.com/omb-suggests-noaa-scale-back-plans-for-geostationary-satellites/
- https://www.law.cornell.edu/cfr/text/47/11.45
- https://www.fcc.gov/document/iheart-pay-1m-misusing-eas-tones-during-bobby-bones-show
- https://docs.fcc.gov/public/attachments/FCC-24-109A1.pdf
- https://www.broadcastlawblog.com/2019/09/articles/how-far-does-the-fcc-authority-over-false-eas-alerts-go-could-online-programming-be-subject-to-its-reach/
- https://open-meteo.com/en/terms
- https://openfreemap.org/
- https://blog.hyperknot.com/p/openfreemap-survived-100000-requests
- https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy
- https://valhalla.openstreetmap.de/
- https://www.congress.gov/crs-product/IF13024

## Open Questions

1. Will EUMETNET issue a redistribution-friendly ORD key or quota for a desktop app with no central server? Unchanged from the morning pass. [ORD overview](https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/)
2. Does RRFS v1 actually enter operations on 2026-10-06 with stable filenames? The date was reconfirmed 2026-07-06 (SCN 26-48 AAB) with the standard critical-weather-day slip clause; verify after the day itself.
3. What does the reported Baron arrival-time patent actually claim, and does it read on anything beyond geographic-grid ETA overlays? Needs the patent number and a reading before any per-place arrival feature is scoped.
4. Is macOS or Linux support worth the release and hardware matrix, or does Windows remain the explicit boundary? Unchanged.
5. Which retention feature earns the first sustained users: the journal, the ambient mode, the almanac, or the streamer surface? The tracker has no field evidence yet; the first published release with any of them is the experiment.

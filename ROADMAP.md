# OpenRadar Roadmap

Actionable work only. Completed items are deleted; blocked items live in Roadmap_Blocked.md.

## Research-Driven Additions

### P0

### P1

- [ ] P1 — Storm cell attributes from Level III NST, NMD, NTV and NHI with tracks, motion, and arrival time to the watched place
  Why: "reaches you in N minutes" is the headline of the 2026 Storm Radar relaunch and a Baron/RadarScope Tier 2 paywall; OpenRadar has the watched place and no cells. StormviewRadar has a working JS implementation to port.
  Evidence: https://registry.opendata.aws/noaa-nexrad/ (`unidata-nexrad-level3`, flat keys `SSS_PPP_YYYY_MM_DD_HH_MM_SS`, products NST, NMD, NTV, NHI verified on the bucket 2026-08-30); https://weather.com/storm-radar ; https://www.baronthreatnet.com/content/faq ; https://www.radarscope.com.au/guide/what-is-radarscope-pro ; C:\repos\StormviewRadar README "Storm Tracks".
  Touches: src-tauri/src/level3.rs (new: NST/NMD/NTV/NHI decode via nexrad-decode Level III or a small own parser), src-tauri/src/http.rs (add `unidata-nexrad-level3.s3.amazonaws.com`), src/lib/overlays/cells.ts, src/components/MapViewport.tsx, src/panels/AlertsPanel.tsx or a new cells panel, src/hooks/useAlertWatch.ts, src-tauri/tauri.conf.json (Rust-only host, no CSP change)
  Acceptance: at a single-site zoom the map shows cell markers with 30/60-minute projected positions and TVS/meso/hail badges; the watched place reports the soonest arrival as "in N min" in the watch card; a Rust test decodes a fixture NST for KTLX; an e2e test with a stubbed cell list shows the ETA.
  Complexity: L

### P2

- [ ] P2 — ProbSevere storm objects from the MRMS bucket as a layer with probability badges
  Why: NOAA publishes ProbSevere as JSON every two minutes on the same bucket OpenRadar already reads; only HookEcho draws it, and it is the machine-learning severe probability behind the paid apps' cell badges.
  Evidence: https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&prefix=ProbSevere/&max-keys=5 (`ProbSevere/YYYYMMDD/MRMS_PROBSEVERE_YYYYMMDD_HHMMSS.json`); https://www.weather.gov/idp/MRMS_v12.3_Supplemental (v3 attributes); https://github.com/d4vid87/hookecho
  Touches: src-tauri/src/mrms.rs (a listing and fetch of the newest JSON via the existing single-flight cache), src/lib/overlays/probsevere.ts, MapViewport.tsx, MapOptionsPanels.tsx, settings.ts, i18n
  Acceptance: polygons with ProbTor/ProbHail/ProbWind percentages draw above MRMS and below warnings; a popup lists the v3 attributes; a Rust test parses a fixture file; an e2e test asserts stack order.
  Complexity: M

- [ ] P2 — MRMS for Alaska, Hawaii, Guam and the Caribbean
  Why: the domains exist on the bucket today with 148 to 166 products each; the map falls to RainViewer's personal-use tier there now.
  Evidence: https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&delimiter=/ (`ALASKA/`, `HAWAII/`, `GUAM/`, `CARIB/`); `src/lib/providers/mrms.ts` coverage box.
  Touches: src-tauri/src/mrms.rs (domain-aware grid geometry from the GRIB2 section 3), src/lib/providers/mrms.ts (per-domain boxes), src/lib/providers/index.ts chain
  Acceptance: a viewport over Anchorage, Honolulu, Guam or San Juan draws the MRMS composite from that domain; a Rust test reads the grid definition of a fixture from each domain; RainViewer no longer appears in Diagnostics for those views.
  Complexity: M

- [ ] P2 — Real-time Level II from the chunks bucket, drawing arriving radials over the previous tilt
  Why: the archive object lands only after a volume completes, so the single-site view runs several minutes behind; the chunks bucket updates every 11 to 12 seconds. RadarOmega sells this as RapidSweep at $84.99/yr; BowEcho v0.35.0 ships it free.
  Evidence: https://unidata-nexrad-level2-chunks.s3.amazonaws.com/?list-type=2&prefix=KTLX/&max-keys=8 (`SITE/VOLUME/YYYYMMDD-HHMMSS-NNN-{S,I,E}`); https://registry.opendata.aws/noaa-nexrad/ ; https://www.radaromega.com/ ; https://github.com/FahrenheitResearch/bowecho/releases
  Touches: src-tauri/src/level2.rs (chunk listing, bzip2 message-block decode, partial sweep raster), src-tauri/src/http.rs (add the chunks host), src/hooks/useSingleSiteRadar.ts, legend copy
  Acceptance: the single-site image updates within 30 seconds of a new chunk with the swept sector drawn over the previous full sweep; the legend says "live, N s old"; a Rust test assembles a fixture volume from chunks; the live test compares the chunk sweep with the archive sweep for the same volume.
  Complexity: L

- [ ] P2 — Warning impact tags and escalation tiers in the alert layer and panel
  Why: NWS alerts carry tornado and thunderstorm damage-threat parameters that distinguish a considerable or destructive warning; RadarScope 5.6 added the tags in 2026 and HookEcho draws escalation tiers.
  Evidence: https://apps.apple.com/us/app/radarscope/id288419283 (5.6 notes); https://github.com/d4vid87/hookecho ; https://api.weather.gov/openapi.json (`parameters.tornadoDamageThreat`, `thunderstormDamageThreat`).
  Touches: src/lib/overlays/alerts.ts (parse parameters, style by tier), src/panels/AlertsPanel.tsx, src/hooks/useAlertWatch.ts (announce an upgrade once), src/i18n
  Acceptance: a considerable or destructive warning draws with a heavier outline and a badge in the panel; the watch announces an upgrade of an already-announced warning exactly once; fixtures cover both tags.
  Complexity: M

- [ ] P2 — Per-type alert filters and opt-in sounds
  Why: every competitor filters by warning type; Supercell Wx users ask for sound only on a tornado upgrade (#617) and per-type sounds (#652).
  Evidence: https://github.com/dpaulat/supercell-wx/issues/617 ; https://github.com/dpaulat/supercell-wx/discussions/652 ; https://www.dtn.com/radarscope-4-0/ (per-type warning filters).
  Touches: src/lib/settings.ts (alerts.types, alerts.sound), src/panels/AlertsPanel.tsx, src/lib/overlays/alerts.ts, src/hooks/useAlertWatch.ts, a small Web Audio tone in src/lib/sound.ts, src/i18n
  Acceptance: unchecking a type removes it from the map and the panel; the sound is off by default, plays once per new or upgraded alert at the watched place, and a master mute silences it; e2e stubs verify the filter and a unit test proves one tone per alert id.
  Complexity: M

- [ ] P2 — Per-layer opacity and a layer order list
  Why: the two most-requested layer controls in Supercell Wx in 2026 (#682 merged, #691 open); ForeFlight's per-layer sliders are the reference UX.
  Evidence: https://github.com/dpaulat/supercell-wx/pull/682 ; https://github.com/dpaulat/supercell-wx/issues/691 ; https://www.foreflight.com/support/video-library/watch/?v=foreflight-quick-tip-opacity-sliders ; `src/components/MapViewport.tsx` declared layer stack.
  Touches: src/lib/settings.ts (layers.opacity map, layers.order), src/panels/MapOptionsPanels.tsx, src/components/MapViewport.tsx, e2e/layers.spec.ts
  Acceptance: each overlay row has an opacity slider that applies live and persists; drag handles reorder overlays within the overlay band without letting them pass warnings; `data-layer-stack` reflects the order and the e2e test asserts it.
  Complexity: M

- [ ] P2 — Remember window size, position and monitor between launches
  Why: a 1600x1000 window re-centres on every launch; every desktop peer restores it and the Tauri plugin is one line.
  Evidence: `src-tauri/tauri.conf.json` window block; https://www.npmjs.com/package/@tauri-apps/plugin-window-state (2.4.1).
  Touches: src-tauri/Cargo.toml, src-tauri/src/lib.rs, src-tauri/capabilities, package.json
  Acceptance: after moving and resizing, a relaunch restores the same bounds on the same monitor and clamps to a visible area when that monitor is gone; noted in CHANGELOG.
  Complexity: S

- [ ] P2 — Bucket lightning flashes by age once per fetch instead of rebuilding the collection every clock tick
  Why: `flashPoints` maps the entire GLM window on every tick and pushes it through `setData`.
  Evidence: `src/hooks/useLightning.ts:44-60,132`; `src/components/MapViewport.tsx:769`.
  Touches: src/hooks/useLightning.ts, src/components/MapViewport.tsx (opacity as an expression over an `age` property and the clock)
  Acceptance: `setData` runs once per fetch; fading still advances every tick; the lightning e2e test and `useLightning.test.ts` stay green with a new assertion counting `setData` calls.
  Complexity: S

- [ ] P2 — Prove the Level II decoder survives the LTR message arriving in 2027
  Why: SCN26-54 adds an hourly LTR message to the Level II stream from about 2027-02-15 and the testbed KCRI already emits it; the pinned rc decoder must skip an unknown message type rather than fail the volume.
  Evidence: https://www.weather.gov/media/notification/pdf_2026/scn26-54_WSR-88D_Level2_Add_LTR.pdf ; `src-tauri/Cargo.toml` `nexrad-decode = "=1.0.0-rc.3"`.
  Touches: src-tauri/src/level2.rs tests, possibly a nexrad-decode bump
  Acceptance: an ignored live test decodes the newest KCRI volume without error; a unit test feeds a volume with an unknown message type and asserts the sweep still renders.
  Complexity: S

- [ ] P2 — Tie the basemap to the theme unless the user has chosen a style
  Why: choosing Light in Settings leaves the dark basemap under white panels.
  Evidence: `src/hooks/useSettings.ts:106-114` (theme sets only `data-theme`); v0.2.0 headless screenshots of the light theme.
  Touches: src/hooks/useSettings.ts, src/lib/settings.ts (mapStyle "auto" value), src/panels/MapOptionsPanels.tsx, src/i18n
  Acceptance: with map style on Auto, switching theme swaps dark and light basemaps; an explicit style choice is left alone; e2e asserts the style id after a theme switch.
  Complexity: S

- [ ] P2 — Tests for the untested hooks and the render-path components
  Why: `MapViewport.tsx` (1,365 lines) and eight hooks have no tests; the v0.2.0 review found its only showstopper in a path no test covered.
  Evidence: recon memo section 7 list; `src/lib/csp.test.ts` history in CHANGELOG.
  Touches: src/hooks/*.test.ts (useAlertWatch, useExport, useUpdates, useWind, useWorkspaceActions, useWorkspaceOverlays), src/components/MapViewport.test.tsx with a MapLibre stub, src/lib/providers/{budget,health,nowcoast,ridge}.test.ts
  Acceptance: each listed module has a test file whose assertions go red under at least one mutation recorded in the commit message; overall vitest count rises by at least 40.
  Complexity: M

### P3

- [ ] P3 — Optical-flow radar nowcast for the next 60 minutes on the timeline tail
  Why: free at Windy and paywalled at RainViewer, Zoom Earth and CARROT; LibreWXR and HookEcho both ship Lucas-Kanade extrapolation; OpenRadar has HRRR for hours but nothing for the next hour.
  Evidence: https://github.com/pySTEPS/pysteps ; https://github.com/JoshuaKimsey/LibreWXR (and its #24 on blending erasing precipitation); https://community.windy.com/topic/31772 ; https://www.rainviewer.com/premium-features.html
  Touches: src-tauri/src/nowcast.rs (dense flow on consecutive MRMS composites, semi-Lagrangian advection), src/lib/providers/mrms.ts frame list, src/hooks/useRadarTimeline.ts (a "nowcast" segment before HRRR), timeline copy
  Acceptance: six 10-minute extrapolated frames follow the last observation and are drawn with a dotted timeline segment labelled as extrapolation; a Rust test advects a translating blob by the expected distance; pure extrapolation only, no model blend.
  Complexity: L

- [ ] P3 — Cross-section (RHI) between two clicked points from the Level II volume
  Why: the cheap half of the 3D ask; BowEcho draws it from two clicks and GR2Analyst charges for it.
  Evidence: https://github.com/FahrenheitResearch/bowecho ; http://www.grlevelx.com/gr2analyst_3/
  Touches: src-tauri/src/level2.rs (all tilts already decoded; sample along the segment), a new panel, MapViewport.tsx draw tool reuse
  Acceptance: choosing two points inside the site range shows a height-versus-distance image of reflectivity or dealiased velocity with beam heights labelled; a Rust test slices a synthetic volume.
  Complexity: L

- [ ] P3 — German composite radar from the DWD GeoServer where GeoMet and MRMS stop
  Why: RadarScope 4.0 added 17 German radars and LibreWXR serves the DWD composite; it is the one keyless European feed with a WMS view service.
  Evidence: https://www.dwd.de/EN/ourservices/geoservices/geodienste.html (`https://maps.dwd.de/geoserver/wms`, no availability guarantee); https://opendata.dwd.de/weather/radar/ ; https://www.dtn.com/radarscope-4-0/
  Touches: src/lib/providers/dwd.ts (WMS adapter like geomet.ts), providers/index.ts chain, http.rs and CSP hosts, credits
  Acceptance: a viewport over Germany draws the DWD composite with its own rain-rate legend and credit line; a unit test parses the capabilities time dimension; RainViewer no longer appears there.
  Complexity: M

- [ ] P3 — GIF export beside WebM
  Why: the most-reacted export ask on Supercell Wx (#414) and what RadarOmega advertises; WebM will not paste into most chats.
  Evidence: https://github.com/dpaulat/supercell-wx/issues/414 ; https://www.radaromega.com/
  Touches: src/lib/export.ts, src/panels/ExportPanel.tsx, src/i18n
  Acceptance: Export offers GIF with a frame cap of 24 and the same burned-in credits; the file opens in Windows Photos; `export.test.ts` covers the palette quantisation.
  Complexity: M

- [ ] P3 — First-launch hint toast pointing at Commands and the Layers panel
  Why: there is no onboarding of any kind; the command list is the discoverability feature and nothing surfaces it. A single dismissible toast fits the no-dialog rule.
  Evidence: recon memo section 4 (no first-run state anywhere); `src/components/CommandPalette.tsx`.
  Touches: src/lib/settings.ts (a `seenWelcome` flag), src/App.tsx, src/i18n
  Acceptance: the toast appears once, never again after dismissal or after any command is used; e2e asserts both.
  Complexity: S

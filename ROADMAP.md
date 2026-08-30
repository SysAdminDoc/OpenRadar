# OpenRadar Roadmap

Actionable work only. Completed items are deleted; blocked items live in Roadmap_Blocked.md.

## Research-Driven Additions

### P0

### P1

### P2

- [ ] P2 — Real-time Level II from the chunks bucket, drawing arriving radials over the previous tilt
  Why: the archive object lands only after a volume completes, so the single-site view runs several minutes behind; the chunks bucket updates every 11 to 12 seconds. RadarOmega sells this as RapidSweep at $84.99/yr; BowEcho v0.35.0 ships it free.
  Evidence: https://unidata-nexrad-level2-chunks.s3.amazonaws.com/?list-type=2&prefix=KTLX/&max-keys=8 (`SITE/VOLUME/YYYYMMDD-HHMMSS-NNN-{S,I,E}`); https://registry.opendata.aws/noaa-nexrad/ ; https://www.radaromega.com/ ; https://github.com/FahrenheitResearch/bowecho/releases
  Touches: src-tauri/src/level2.rs (chunk listing, bzip2 message-block decode, partial sweep raster), src-tauri/src/http.rs (add the chunks host), src/hooks/useSingleSiteRadar.ts, legend copy
  Acceptance: the single-site image updates within 30 seconds of a new chunk with the swept sector drawn over the previous full sweep; the legend says "live, N s old"; a Rust test assembles a fixture volume from chunks; the live test compares the chunk sweep with the archive sweep for the same volume.
  Complexity: L

- [ ] P2 — Per-layer opacity and a layer order list
  Why: the two most-requested layer controls in Supercell Wx in 2026 (#682 merged, #691 open); ForeFlight's per-layer sliders are the reference UX.
  Evidence: https://github.com/dpaulat/supercell-wx/pull/682 ; https://github.com/dpaulat/supercell-wx/issues/691 ; https://www.foreflight.com/support/video-library/watch/?v=foreflight-quick-tip-opacity-sliders ; `src/components/MapViewport.tsx` declared layer stack.
  Touches: src/lib/settings.ts (layers.opacity map, layers.order), src/panels/MapOptionsPanels.tsx, src/components/MapViewport.tsx, e2e/layers.spec.ts
  Acceptance: each overlay row has an opacity slider that applies live and persists; drag handles reorder overlays within the overlay band without letting them pass warnings; `data-layer-stack` reflects the order and the e2e test asserts it.
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

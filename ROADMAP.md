# OpenRadar Roadmap

Actionable work only. Completed items are deleted; blocked items live in Roadmap_Blocked.md.

## Research-Driven Additions

### P0

- [ ] P1 — The live unfolding test asserts a share that one real station does not reach
  Why: it demands a quarter of the broken pairs come back, which KDMX and four others manage and KFWS does not (13 per cent). It is hard-coded to KDMX, so it passes only because of which station it asks.
  Evidence: parameterised over five stations on 2026-08-31: KDMX 22457 to 9342 ok, KFWS 3766 to 3270 FAILED, KTLX 7911 to 5072 ok, KAMX 40248 to 18750 ok, KTBW 24114 to 8176 ok.
  Touches: src-tauri/src/level2.rs
  Acceptance: the test states what it measures over more than one station and passes on all of them, or says plainly which claim it is making about which; it must still fail against the grower it replaced.

- [ ] P1 — The claim that unfolding went from four per cent to forty-four does not reproduce
  Why: the figure came from the absolute-recovery measure the same commit discards as wrong. Under the differential measure the two growers are within a few points on most stations, identical on KDMX for folds actually put back, and the old one is better on KTBW.
  Evidence: nine stations, both growers, folds put back new/old: KDMX 27/27, KTLX 42/2, KJAX 16/2, KTBW 60/65, KGRR 74/71, KAMX 22/0, KFWS 16/11, KLOT 56/55, KOKX 83/0.
  Touches: CHANGELOG.md, CLAUDE.md
  Acceptance: what the docs claim is what was measured, including the station where the change is a loss.

- [ ] P1 — `broken_pairs` cannot tell a gate recovered from a gate recovered onto the wrong branch
  Why: it is a differential measure, so a whole region shifted a full interval off scores perfectly. On KJAX it read 84 per cent while only 16 per cent of gates were on the right branch. The `invented == 0` guard only rules out shifts that are not a whole number of intervals.
  Evidence: the nine-station table above, where the two columns disagree by up to 68 points.
  Touches: src-tauri/src/level2.rs
  Acceptance: the live test reports both what the picture looks like and how many gates are actually on the branch they started on, and says which of the two it is asserting.

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

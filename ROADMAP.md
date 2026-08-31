# OpenRadar Roadmap

Actionable work only. Completed items are deleted; blocked items live in Roadmap_Blocked.md.

## Research-Driven Additions

### P0

### P1

- [ ] P1 — Tsunami and the civil-emergency products sit behind a switch labelled "Tornado"
  Why: the grouping is right (they are all extreme, and they belong with the products people act on immediately) but the label is not. A reader in Honolulu who turns off "Tornado" because tornadoes are not their weather silently loses tsunami warnings from the map and from the watch.
  Evidence: all 118 CAP event values through `alertType`: the tornado bucket holds Civil Danger, Evacuation Immediate, Extreme Wind, Hazardous Materials, Nuclear Power Plant, Radiological Hazard, Shelter In Place, Tornado Warning and Watch, and all three Tsunami products. `en.ts` renders the switch as the bare word "Tornado".
  Touches: src/i18n/en.ts, src/i18n/es.ts, src/panels/MapOptionsPanels.tsx, src/lib/alertTypes.ts
  Acceptance: the switch names what it actually covers and carries a detail line listing the life-safety products in it; a test asserts the label mentions more than tornadoes whenever the bucket holds more than tornadoes.

- [ ] P1 — Nothing is checking the same-volume gate on storm rotation
  Why: replacing the gate in `level3.rs` with `if true` leaves the whole suite green. The test added for it reimplements the comparison as a local closure and asserts on the constant, so it passes whatever production does. Clippy says so too: "this assertion has a constant value".
  Evidence: `if true {` at src-tauri/src/level3.rs:743 gives `cargo test --lib` 142 passed and the ignored level3 test passed.
  Touches: src-tauri/src/level3.rs
  Acceptance: widening the window to forever and closing it to never each turn a test red; the test drives the real path rather than a copy of it.

- [ ] P1 — The severe-probability layer fails blank
  Why: `useProbSevere` computes an error and `App.tsx` passes only `.features`, so a reader who switches the layer on when there is no publication gets nothing at all and no message. The hook's own comment says this is a layer somebody might act on.
  Evidence: `.error` and `.reading` are read nowhere in src/App.tsx, src/components or src/panels.
  Touches: src/App.tsx, src/panels (wherever the layer's note goes)
  Acceptance: a failed or stale reading shows the reason where the reader is looking; a test asserts the message reaches the panel.

- [ ] P1 — The severe-probability freshness check only works in one direction
  Why: `readingTime` uses `Date.UTC`, which rolls month 99 and minute 61 over rather than rejecting them, and the staleness test is `<= STALE_MINUTES`, so any stamp at or after now passes forever. A stamp years ahead, or nonsense, is drawn as current; an ISO stamp or a missing one is silently not drawn. The Rust side has the same one-sidedness.
  Evidence: `20990101_000000` and `99999999_999999` drawn as current; `2026-08-30T23:08:41Z` and an absent stamp not drawn with no error.
  Touches: src/lib/probsevere.ts, src/hooks/useProbSevere.ts, src-tauri/src/probsevere.rs
  Acceptance: a stamp that cannot be read is refused and says so; a stamp implausibly far ahead of the clock is refused; the table of eight cases is a test.

- [ ] P1 — One malformed key throws away a whole ProbSevere listing
  Why: `newest_in` uses `?` on `after.find("</Key>")` inside the loop, so an unterminated tag returns None from the function and discards keys already found.
  Evidence: a truncated listing returns None even though a good key preceded the truncation (src-tauri/src/probsevere.rs:206).
  Touches: src-tauri/src/probsevere.rs
  Acceptance: a listing that is good up to a truncation still yields the newest good key; a test plants the truncation after a valid key.

- [ ] P1 — Two hook tests assert nothing about the lines they name
  Why: deleting `offerRef.current = null` from the update check's failure path leaves useUpdates.test.ts green, and the line is unreachable anyway. Deleting `setError(null)` on a successful wind read leaves useWind.test.ts green, so the panel would keep reporting a failure while the particles animate.
  Evidence: both mutants survive their own suites.
  Touches: src/hooks/useUpdates.ts, src/hooks/useUpdates.test.ts, src/hooks/useWind.ts, src/hooks/useWind.test.ts
  Acceptance: a wind error clears when the next run arrives, proven by a test that goes red without the line; the unreachable branch in useUpdates is either made reachable and tested or removed.

### P2


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

# OpenRadar Roadmap

Actionable work is listed first. The audit register is retained even when a fix is already on `main`, as requested on 2026-08-31. Checked entries have code and focused regression coverage but are not considered shipped until the final release gate is complete. Unchecked entries are deliberately left for a later repair session. External blockers are explained in `Roadmap_Blocked.md`.

## 2026-08-30 End-to-End Audit Register

Audit base: `459eb52`. Register snapshot: `b9c04fe`.

### Release, packaging, and verification

- [ ] AUD-001: Synchronize `0.4.0` across `package.json`, the root package-lock entries, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, the in-app version, the README badge, and the changelog. The current files disagree between 0.1.0, 0.2.0, and 0.3.0.
- [ ] AUD-002: Run the final clean release gate from a commit that matches `origin/main`, verify the updater signature, and publish a new tag and GitHub release. The existing `v0.3.0` tag points to the pre-audit build.
- [ ] AUD-003: Install the new build and watch it replace an older installed version in an isolated Windows desktop session. Confirm the running app reports the new version after restart.
- [ ] AUD-004: Exercise deep links, single-instance reuse, Windows notifications, desktop exports, and log-file creation in an isolated desktop session. Unit and headless coverage exists, but the real window flows have not been observed.
- [ ] AUD-005: Add Authenticode signing when a certificate is available. The updater payload has its own cryptographic signature, but Windows SmartScreen still warns on first install.
- [ ] AUD-006: Re-run the clean Windows VM install and uninstall check when the validation VM is online.
- [ ] AUD-007: Decide whether macOS and Linux are supported targets, then build and exercise them if support is claimed. Only Windows x64 is currently built and tested.
- [ ] AUD-008: Reduce or isolate the remaining large initial map bundle. Lazy panel loading removed about 21.6 kB gzip from startup, but Vite still reports a 1.4 MB minified main chunk and the MapLibre worker is about 630 kB.
- [ ] AUD-009: Review the transitive `glib 0.18.5` advisory reported by Grype and move to a fixed dependency when the upstream chain permits it. The package is not on the Windows runtime path, but the scan remains noisy.
- [ ] AUD-010: Repeat the visual audit in an isolated viewport wider than 1248 pixels. The in-app capture backend capped the wide reference at 1248 pixels, so the current wide layout evidence does not cover the full 1916-pixel README view.

### Native boundary and untrusted data

- [x] AUD-011: Add the DWD radar host to the Rust allowlist used by installed builds. Browser preview and native routing previously disagreed. Fixed in `857fc7c`.
- [x] AUD-012: Bound HTTP body reads and validate byte ranges before allocating or slicing. Hostile or truncated provider replies could otherwise grow memory or panic. Fixed in `857fc7c`.
- [x] AUD-013: Harden GFS, MRMS, and Level III parsing against malformed dimensions, offsets, compressed payloads, and short files. Fixed in `857fc7c`.
- [x] AUD-014: Remove unused Tauri permissions for opening arbitrary addresses and changing unrelated store keys. Fixed in `857fc7c`.
- [x] AUD-015: Allow remote overlay links only when they are credential-free HTTPS URLs. Fixed in `857fc7c`.
- [x] AUD-016: Wait for the native palette renderer to accept a colour table before reporting success. Fixed in `524335f`.
- [x] AUD-017: Reject empty GeoJSON collections instead of enabling an invisible custom layer. Fixed in `524335f`.
- [x] AUD-018: Replace the broad secret-scan exception with an exact allowlist for the synthetic radar test key. Full Git history now scans clean. Fixed in `b087e56`.

### Async ownership and truthful state

- [x] AUD-019: Prevent a delayed camera save from restoring an older copy of theme, unit, or layer settings. Fixed in `74e625a`.
- [x] AUD-020: Make Forecast survive React Strict Mode setup and cleanup without treating the cancelled first request as completed. Fixed in `74e625a`.
- [x] AUD-021: Keep the national NWS damage-threat request independent from viewport alert cancellation. Fixed in `74e625a`.
- [x] AUD-022: Start alert monitoring immediately when the watched place changes and fall back to an in-app notice when desktop notification delivery fails. Fixed in `74e625a`.
- [x] AUD-023: Check the current alert-watch generation after every notification permission or delivery await. An old watch could previously notify after the location changed. Fixed in `07cbe53`.
- [x] AUD-024: Make the newest radar refresh win when overlapping timeline requests finish in reverse order. Fixed in `74e625a`.
- [x] AUD-025: Keep cache age attached to the provider that returned it, so a failed cached source cannot label a live fallback as cached. Fixed in `74e625a`.
- [x] AUD-026: Make radar cache provenance request-local. A concurrent overlay response could previously mark an unrelated live radar timeline as cached. Fixed in `015fcc1`.
- [x] AUD-027: Make the newest storm-history selection win and clear the old error when a new selection begins. Fixed in `dbc3851`.
- [x] AUD-028: Share one in-flight lightning request instead of starting duplicate native work for the same refresh. Fixed in `dbc3851`.
- [x] AUD-029: Clear stale forecast results as soon as the requested point changes. Fixed in `dbc3851`.
- [x] AUD-030: Clear stale place-search results as soon as the query changes. Fixed in `dbc3851`.
- [x] AUD-031: Clear stale tide results when the requested coast point changes. Fixed in `dbc3851`.
- [x] AUD-032: Clear an old route before planning a new one, and offer a straight-line estimate only when the road router fails. Fixed in `dbc3851`.
- [x] AUD-033: Show enabled-layer failures beside their switches instead of leaving a blank map to look like valid empty data. Fixed in `dbc3851`.
- [x] AUD-034: Give Alerts and Tropical explicit loading and unavailable states instead of false empty results. Fixed in `dbc3851`.
- [x] AUD-035: Validate the full workspace envelope before normalizing defaults. A truncated file containing only the format name could silently reset settings. Fixed in `5c4283a`.
- [x] AUD-036: Report unknown nested settings from newer backups rather than dropping them silently. Fixed in `524335f`.

### Workspace, export, and local files

- [x] AUD-037: Include the custom overlay, camera, settings, and undo state in workspace backups. Restores now put both settings and overlay state back. Fixed in `524335f`.
- [x] AUD-038: Extend the end-to-end workspace test to validate the complete backup envelope and reject malformed envelopes without changing current settings. Fixed in `47eea3e` and `5c4283a`.
- [x] AUD-039: Write exports beside their target, flush them, then replace the destination atomically. A failed save can no longer truncate the last good file. Fixed in `353c244`.
- [x] AUD-040: Support GIF export in the packaged desktop path instead of only in browser preview. Fixed in `353c244`.
- [x] AUD-041: Move GIF colour reduction and compression into a worker, cap output width at 960 pixels, bound palette sampling, and store encoded bytes in chunks. Fixed in `0121113`.
- [x] AUD-042: Restore the selected radar frame and playback state after loop export, including failure paths. Fixed in `dbc3851`.
- [x] AUD-043: Move blocking disk-cache work away from async workers that carry desktop commands and network replies. Fixed in `353c244`.
- [x] AUD-044: Removing an imported overlay from its toast now switches the layer off as well as clearing the shapes. Fixed in `857fc7c`.

### Controls, accessibility, and layout

- [x] AUD-045: Keep Commands reachable in the compact layout, including at 130 percent text size. Fixed in `dbc3851`.
- [x] AUD-046: Add Storm Cells, ProbSevere, Wind, and radar products to Commands so hidden compact controls remain reachable. Fixed in `dbc3851`.
- [x] AUD-047: Keep stacked radar legends inside short windows with their own scroll area. Fixed in `dbc3851`.
- [x] AUD-048: Remove imperative camera and map transitions when reduced motion is requested. Fixed in `dbc3851`.
- [x] AUD-049: Give the radar timeline slider an accessible timestamp through `aria-valuetext`. Fixed in `dbc3851`.
- [x] AUD-050: Write alert severity as text, not colour alone, and replace pill-shaped severity and threat labels with the product's 6-pixel radius. Fixed in `dbc3851` and `b9c04fe`.
- [x] AUD-051: Let keyboard users run map tools at map centre, return focus correctly, and hear the result through a live status region. Fixed in `dbc3851`.
- [x] AUD-052: Apply the saved language before first meaningful paint, translate the visible Show control, and format large counts with the active locale. Fixed in `dbc3851`.
- [x] AUD-053: Match forecast icons to the reported weather rather than using one static symbol. Fixed in `dbc3851`.
- [x] AUD-054: Keep guidance comparison at a minimum of two models. Fixed in `dbc3851`.
- [x] AUD-055: Say that comparison history is unavailable when there are too few frames instead of relabelling the first frame as a comparison. Fixed in `dbc3851`.
- [x] AUD-056: Leaving single-site mode for Composite Reflectivity now restores the composite source and truthful active control. Fixed in `dbc3851`.
- [x] AUD-057: Stop labelling the number of storm cells as minutes. Fixed in `dbc3851`.
- [x] AUD-058: Give Range one semantic result and avoid repeating the same feedback in both button and status text. Fixed in `ef95f0e`.
- [x] AUD-059: Defer panel code until a panel opens. This reduced the initial gzip payload while preserving every cold-open flow. Fixed in `8a26faf`.

### Release tooling and test reliability

- [x] AUD-060: Bind release artifacts to the exact verified commit, verify the updater signature against the configured public key, and refuse a stale skipped build. Fixed in `6216d93`.
- [x] AUD-061: Push an existing verified release tag when publishing instead of assuming tag creation and push happen together. Fixed in `40e0a9a`.
- [x] AUD-062: Reuse already loaded storm selections rather than fetching the same archive a second time. Fixed in `3b8d74d`.
- [x] AUD-063: Use a local `DOMException` in abort tests so the suite does not depend on the host's implementation details. Fixed in `0121113`.
- [x] AUD-064: Document the actual network privacy boundary. Search text, coordinates, route endpoints, map requests, and the client's IP reach the named public providers even though accounts, telemetry, crash reports, and sync do not exist. Fixed in `b9c04fe`.
- [x] AUD-065: Run the final frontend gate after the adversarial fixes. Formatting, lint, type-check, production build, 574 unit tests, and 200 headless desktop scenarios pass at the register snapshot.
- [x] AUD-066: Complete a fresh-context adversarial review after the main audit. It confirmed every code and product finding above, with version and release integrity left open as AUD-001 and AUD-002.

## Research-Driven Additions

### P0

### P1

### P2

### P3

- [ ] P3: Optical-flow radar nowcast for the next 60 minutes on the timeline tail
  Why: free at Windy and paywalled at RainViewer, Zoom Earth and CARROT; LibreWXR and HookEcho both ship Lucas-Kanade extrapolation; OpenRadar has HRRR for hours but nothing for the next hour.
  Evidence: https://github.com/pySTEPS/pysteps ; https://github.com/JoshuaKimsey/LibreWXR (and its #24 on blending erasing precipitation); https://community.windy.com/topic/31772 ; https://www.rainviewer.com/premium-features.html
  Touches: src-tauri/src/nowcast.rs (dense flow on consecutive MRMS composites, semi-Lagrangian advection), src/lib/providers/mrms.ts frame list, src/hooks/useRadarTimeline.ts (a "nowcast" segment before HRRR), timeline copy
  Acceptance: six 10-minute extrapolated frames follow the last observation and are drawn with a dotted timeline segment labelled as extrapolation; a Rust test advects a translating blob by the expected distance; pure extrapolation only, no model blend.
  Complexity: L

- [ ] P3: Cross-section (RHI) between two clicked points from the Level II volume
  Why: the cheap half of the 3D ask; BowEcho draws it from two clicks and GR2Analyst charges for it.
  Evidence: https://github.com/FahrenheitResearch/bowecho ; http://www.grlevelx.com/gr2analyst_3/
  Touches: src-tauri/src/level2.rs (all tilts already decoded; sample along the segment), a new panel, MapViewport.tsx draw tool reuse
  Acceptance: choosing two points inside the site range shows a height-versus-distance image of reflectivity or dealiased velocity with beam heights labelled; a Rust test slices a synthetic volume.
  Complexity: L


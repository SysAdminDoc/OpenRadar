# OpenRadar Roadmap

Only unfinished work appears here. This backlog was reconciled against the repository, tracker, external research, and completed 2026-08-30 audit register on 2026-08-31. Historical completed items, including `AUD-001`, `AUD-002`, and `AUD-011` through `AUD-066`, are omitted. External blockers remain documented in `Roadmap_Blocked.md`.

Items numbered `AUD-` come from the audit register and are ordered P0 through P3. Items numbered `JOY-` come from a separate 2026-08-31 intake about character and personalization, and they live in their own section. Nothing in that section outranks a correctness, security, or release item. `AUD-093` onward and `JOY-021` were added by the 2026-08-31 evening research pass and sit under Research-Driven Additions at the end, each carrying its own priority.

## P1

## P2

## P3

## Character and personalization

These came out of a different question than the audit did: what makes somebody keep a weather app open on a second monitor for a year rather than opening it twice during a storm and forgetting it. None of it outranks a correctness, security, or release item, which is why it sits after P3 instead of being folded into the priority ladder.

Every item below obeys the same rules, and one that cannot obey them is not worth building.

- Data is never decoration. A theme, an effect, or a mode may restyle the interface around the map. It may not change a reflectivity ramp, a warning outline, a probability figure, or a timestamp. Anything that does change how hazard information reads has to say so where the reader turns it on.
- Nothing new leaves the machine. No account, no sync, no usage reporting, and no new host in the native allowlist unless the item names it and the ledger carries it.
- Everything is reversible in one action, and the workspace opens plain for a reader who wants it plain.
- `prefers-reduced-motion` removes the motion, not the feature.
- Nothing applies pressure. No streaks to break, no badges to chase, and no notification that is about the app rather than about the weather.
- Playful surfaces stand down during danger. While a warning is active at a watched place, themes stay quiet, effects stop, and nothing discoverable reveals itself; the map is a serious instrument for as long as the warning stands. (Added 2026-08-31; the safety precedent and the backlash record are in `RESEARCH.md`.)

- [ ] JOY-015: Replace the single tone with a small sound kit
      Why: There is one synthesised note today, at one pitch, for every alert that reaches the watched place. A tornado warning and a special weather statement should not sound identical. A short set of tones by severity, still synthesised so nothing has to ship or be fetched, plus the option to point at your own audio file, is the difference between a sound somebody keeps on and a sound somebody switches off in the first week.
      Evidence: `src/lib/sound.ts`; `src/hooks/useAlertWatch.ts`; `src/lib/settings.ts`; AUD-075; 47 CFR 11.45
      Touches: Tone definitions by severity; volume and preview; optional local audio files and their validation; quiet hours; settings and migration
      Acceptance: Each severity has a distinguishable tone that a reader can hear before committing to it; a supplied audio file is size-capped, format-checked, refused rather than half-played when unreadable, and referenced by path so backups do not swallow it; the app never synthesises or plays anything resembling the Emergency Alert System attention signal or a SAME data burst, and a test holds that boundary along with a note saying why; everything stays off until asked for; quiet hours and the emergency override from AUD-075 apply to every sound here; a machine with no audio degrades to the notification alone without an error.
      Note (2026-08-31): The boundary is verified law, not caution: 47 CFR 11.45 prohibits transmitting the EAS attention signal or simulations, with a $1M consent decree on record for tones that tripped downstream receivers. Extend the tested ban to the WEA cadence (47 CFR 10.520(d)) and the NOAA Weather Radio 1050 Hz tone, and apply it to user-supplied files presented as defaults.
      Complexity: M

- [ ] JOY-016: Add a calm presentation for readers who find severe weather distressing
      Why: A significant number of people follow weather closely because it frightens them, and this app is currently tuned for the person who wants more detail rather than less. A calm mode that keeps every fact and removes the pressure, with muted hazard styling, no motion, no probability figures pushed at the reader, and plainer language, is a thoughtful thing to ship and costs very little once JOY-001 exists.
      Evidence: `src/index.css`; `src/lib/alertTypes.ts`; `src/hooks/useProbSevere.ts`; `src/panels/AlertsPanel.tsx`; `src/i18n/en.ts`; JOY-001
      Touches: The mode and its token set; hazard styling under the mode; which layers default off; alert copy variants; settings; accessibility scenarios
      Acceptance: The mode never hides or downgrades an active warning and never delays one, and the mode says so where it is turned on; muting applies to styling and to speculative guidance, not to the warning itself; probability and threat figures remain reachable rather than removed; alert copy in the mode states what to do rather than how bad it could get, and is written by hand in both languages instead of generated; every existing accessibility scenario passes in the mode; leaving the mode restores everything with no residue.
      Complexity: M

- [ ] JOY-017: Add an ambient mode for a second screen
      Why: The most loyal thing a desktop app can achieve is a permanent place on somebody's second monitor. That needs a view with no chrome, a legible clock, the current conditions, and a loop that keeps running, plus a slowly rotating globe for the times when nothing is happening anywhere near you.
      Evidence: `src/App.tsx`; `src/components/MapStage.tsx`; `src/hooks/useRadarTimeline.ts`; `src/hooks/useClock.ts`; `src/lib/providers/budget.ts`
      Touches: A chrome-free presentation; idle detection and entry; the clock and condition readout; the globe idle motion; provider budget under long unattended playback; exit
      Acceptance: The mode fills the window with the map, keeps time, place, source, and frame age visible, and leaves the workspace exactly as it was on exit; unattended playback respects the request budget and slows rather than hammering a provider overnight; a warning reaching a watched place interrupts the mode visibly; reduced motion stops the globe rotation and keeps the loop; the mode can be entered deliberately and, if idle entry is offered, only after a configured delay that defaults to off.
      Note (2026-08-31): Build it as in-app fullscreen, never a `.scr` (legacy format, fragile WebView2 bootstrap, no verified demand). Long-run display care goes in from the start: app-level pixel drift every few minutes, scheduled auto-dim, no pure-white static text, a frame-rate cap gated on radar cadence, and a docs note that mostly-static ambient displays belong on LCD rather than OLED. The nostalgia demand is real (WeatherStar 4000+ fork culture; The Weather Channel shipped an official emulator as its 2026-04-01 stunt).
      Complexity: L

- [ ] JOY-018: Add a tray presence and a glance window
      Why: A radar app that has to be brought to the front to answer whether it is about to rain is a radar app that gets closed. The Tauri tray API is available and the window state plugin is already a dependency, so a small always-on-top window showing the home place, and a tray icon that carries the current hazard state, are both reachable without new infrastructure.
      Evidence: `src-tauri/src/lib.rs`; `src-tauri/Cargo.toml`; `src/hooks/useAlertWatch.ts`; JOY-006
      Touches: Tray icon and its menu; icon state driven by the watch; a small secondary window; single-instance interaction; close and minimise behaviour; settings
      Acceptance: Closing the window does what the reader chose, defaulting to actually closing, because an app that silently keeps running after a close is an app people uninstall; the tray icon reflects the current hazard state at named places and nothing else; the glance window is small, always-on-top only when asked, resizable, and shows source and frame age like every other surface; the single-instance path still reuses the existing window; the whole feature can be switched off and leaves no tray icon behind.
      Note (2026-08-31): Platform verdict is green with three named pitfalls: drop the tray icon explicitly on exit or Windows leaves a ghost until mouse-over; create the tray one way only (config or code, never both); and test always-on-top in the packaged build, which has a report of differing from dev. The glance window must consume pre-rendered frames, never a second live MapLibre map, whose renderer alone can run hundreds of megabytes.
      Complexity: L

- [ ] JOY-019: Write the current view to the desktop wallpaper on a schedule
      Why: This is the quiet showpiece. A composed radar picture of your own area, refreshed on the desktop every fifteen minutes, is something people notice and talk about, and it needs no new data path at all because the still export already exists.
      Evidence: `src/hooks/useExport.ts`; `src/lib/export.ts`; `src-tauri/src/exports.rs`; `src-tauri/src/lib.rs`
      Touches: A native wallpaper write on Windows; the schedule and its bounds; the composed frame including time, place, and credits; the previous wallpaper; failure reporting; settings
      Acceptance: The reader's previous wallpaper is recorded before the first write and restored when the feature is switched off; the schedule has a floor that keeps provider requests inside the budget, and it stops while the machine is offline rather than writing an empty map; every written picture carries its time, its source credits, and its own age; a failed write reaches a toast and the log instead of failing silently; the feature is Windows-only for now and says so; nothing is written anywhere except the configured wallpaper path.
      Note (2026-08-31): Use the `IDesktopWallpaper` COM interface from the `windows` crate (per-monitor, no elevation); `SystemParametersInfoW` is the single-monitor fallback. The cautionary tale is Microsoft's own Bing Wallpaper app, panned in November 2024 for bundling everything but wallpaper: this feature does one thing, opt-in, and restores what it found.
      Complexity: L

- [ ] JOY-020: Compose a shareable postcard rather than a bare screenshot
      Why: The export produces an accurate picture with credits burned in, which is right for evidence and slightly plain for the thing somebody wants to send a relative. A composed card with the place, the time, an optional line the reader writes, and sensible dimensions for sharing costs little and is how the app travels to people who have not heard of it.
      Evidence: `src/hooks/useExport.ts`; `src/panels/ExportPanel.tsx`; `src/lib/export.ts`; JOY-008
      Touches: Card layout and sizes; the caption field; attribution placement; the existing export path; translations
      Acceptance: The card carries observed time, source credits, and the app name in every variant, and the caption cannot displace any of them; the reader's location is included only when they choose to include it; the picture is never presented as an official product and carries the same not-a-warning-source position the app takes; sizes are documented and the layout holds at each of them in both languages; the plain export stays exactly as it is, because evidence and a postcard are different jobs.
      Complexity: M

The record, the named places and the token boundary are all in place now, so the rest of this section can be taken in any order.

## Research-Driven Additions

Added 2026-08-31 from the second research pass of that day (see `RESEARCH.md`). IDs continue the existing schemes. Ordered by priority.

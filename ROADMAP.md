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

- [ ] JOY-001: Separate interface styling from data styling and make the interface themeable
      Why: The workspace has exactly two looks, written as two blocks of custom properties in one stylesheet, and every accent in the app reads from them. There is no way to give the window any character without risking the colours that carry meaning. The boundary between chrome colour and data colour half exists already, since ramps and hazard styling live in their own modules, but nothing holds it, so any theming work done without this first is one careless commit away from restyling a warning polygon.
      Evidence: `src/index.css`; `src/lib/settings.ts`; `src/lib/legend.ts`; `src/lib/mosaicLegend.ts`; `src/lib/mapStyles.ts`; `src-tauri/src/palette.rs`
      Touches: The token contract; a theme record in settings and its migration; a small theme file format; the settings surface; a contract test; the accessibility scenarios
      Acceptance: A named theme can set surface, border, accent, shadow, and heading weight through tokens and nothing else; an enumerated test fails if a data colour becomes reachable from a theme; a theme loaded from a file is re-parsed from its own text rather than trusted as an object, the way a colour table already is; dark and light remain the built-ins and remain the default; `e2e/accessibility.spec.ts` passes for every shipped theme; a personal accent colour is one of the things a theme can carry, so somebody can have the app in their own colour without writing a file.
      Complexity: L

- [ ] JOY-002: Ship seasonal and occasion theme packs that arrive on their own
      Why: An app that looks slightly different in late October than it does in March is an app people notice they live with. This is cheap to do and easy to do badly, so the constraints matter more than the packs: it is chrome only, it is a local date calculation, and it can be told to go away for good.
      Evidence: `src/hooks/useClock.ts`; `src/lib/settings.ts`; `src/i18n/en.ts`; JOY-001
      Touches: Theme pack definitions; a local occasion calendar; the one-line notice and its dismissal; settings and migration; fixed-clock tests
      Acceptance: Occasion windows are computed from the local clock with no network call and no bundled calendar service; each occasion can be declined once for that year or switched off for good, and the master switch returns the plain workspace immediately; nothing about hazard rendering, ramps, or legends changes in any pack; the notice is one line that is dismissed rather than a dialog; fixed-clock tests cover the first and last day of each window, a machine crossing midnight, a machine in a different time zone from its data, and 29 February.
      Complexity: M

- [ ] JOY-003: Add ambient weather effects to the chrome, driven by real conditions
      Why: Rain running down the edge of a panel while it is actually raining where you are watching is the sort of small thing people show other people. The catch is that it must be driven by observed conditions rather than invented, must never sit over the map, and must cost almost nothing, because a decorative animation that drops the radar loop below its frame budget is a bug wearing a costume.
      Evidence: `src/components/MapChrome.tsx`; `src/components/WorkspaceChrome.tsx`; `src/lib/weather.ts`; `src/hooks/useLightning.ts`; `src/index.css`
      Touches: A chrome effect layer outside the map canvas; the condition source and its staleness rule; a frame and CPU budget; the reduced-motion path; settings
      Acceptance: Effects are chosen from an observed condition with a named source and an age, and stop when that observation goes stale rather than continuing on the last thing they knew; nothing draws over the map canvas or over any legend, readout, or alert surface; a measured budget caps the cost and the effect drops itself if the radar loop misses frames; reduced motion leaves a still treatment or nothing at all; the feature is off until asked for, and one switch removes it everywhere.
      Complexity: M

- [ ] JOY-004: Give the single-site sweep optional phosphor persistence
      Why: A radar disc that shows where the beam is now, with the previous sweep fading behind it, is the picture everybody has in their head when they think of radar, and this app is one of the few that actually has the beam position to draw it honestly. The live volume path already composites a partial sweep over a finished one, so the geometry is in hand. It stays optional and it stays labelled, because a decayed picture is older than an undecayed one and the reader has to be able to tell.
      Evidence: `src-tauri/src/level2.rs`; `src-tauri/src/chunks.rs`; `src/hooks/useSingleSiteRadar.ts`; `src/components/MapViewport.tsx`
      Touches: Sweep compositing; a decay parameter and its bounds; the legend and its age text; settings; the fixture tests
      Acceptance: With persistence on, gate values are unchanged and only the drawn opacity decays with the age of the cut that produced it; the legend states the age of the oldest visible sweep, not just the newest; the picture is identical to today's when persistence is off, proved against the synthetic volume; reduced motion keeps the composite and drops the animated leading edge; a reader inspecting a gate gets the value and the time of the sweep it came from.
      Complexity: L

- [ ] JOY-005: Replace the welcome toast with a first-run reveal and one honest opening line
      Why: The current onboarding is a single toast pointing at the commands, and a first launch is otherwise a map with nothing to say. Two small things fix that. The radar disc drawing itself once, on the very first run, is a signature people remember. A one-line summary of what the weather is actually doing near the opening view is more useful than a hint and is the reason to open the app on a calm day.
      Evidence: `src/hooks/useWelcomeHint.ts`; `src/components/ToastHost.tsx`; `src/lib/weather.ts`; `src/lib/settings.ts`
      Touches: The first-run animation and its skip; the opening summary and its data source; the seen flag and its migration; translations
      Acceptance: The reveal plays once, can be skipped by any interaction, never delays the map becoming usable, and does not play at all under reduced motion; the opening line names a real observation with a source and a time and says plainly when it has nothing to report; it never invents a hazard or softens one; both strings live in the catalogue and pass the pseudolocale clipping test; a reader who has seen it once never sees it again, and a reader who wants it back can ask.
      Complexity: M

- [ ] JOY-006: Let a reader name their home place and their radar
      Why: Every attachment this app can earn starts here. Right now the watched place is a coordinate pair with a radius, and the single-site radar is whichever station the view happens to be over. Somebody who can call a place Home and a station Ours, see the call sign on the legend, and get back to both in one action has a workspace rather than a viewer.
      Evidence: `src/lib/watch.ts`; `src/hooks/useAlertWatch.ts`; `src/hooks/useSingleSiteRadar.ts`; `src/lib/settings.ts`; `src/panels/MapOptionsPanels.tsx`; AUD-077
      Touches: Named place and station records; the home action; the legend and station badge; search and command entries; settings migration; workspace backup
      Acceptance: A place carries a name the reader chose and that name appears in the watch surface, in alert text, and in the journal; a held station shows its call sign, its distance from home, and whether it is currently publishing; one action returns the camera home from anywhere including the globe; names round-trip through workspace backup; nothing about naming changes what is polled or how often.
      Complexity: M

- [ ] JOY-007: Keep a bounded local log of observations and events at the reader's places
      Why: Almost everything below wants a memory the app does not have. There is a disk cache for tiles and frames, which is about not refetching, and there is nothing that records that it hailed here on the fourteenth. This is the foundation item for the journal, the recap, and any local climate context, and it needs designing once, carefully, because it is a file of somebody's whereabouts.
      Evidence: `src-tauri/src/cache.rs`; `src/lib/settings.ts`; `src/hooks/useAlertWatch.ts`; `src/lib/workspaceBackup.ts`; JOY-006
      Touches: A local log store and its schema; a retention and size budget; write points in the alert and observation paths; export and deletion; documentation of what is written
      Acceptance: The log records observation and event rows for named places only, each with source, observed time, and how it was obtained, and it never records anything about how the app was used; a stated retention period and a hard size ceiling both hold, with the oldest going first; the reader can see the whole file in plain form, export it, and delete all of it in one action; it never leaves the machine and never enters diagnostics output; corrupt or partial files are refused without losing the good rows; a documented note says exactly what is stored, because this is the one feature here that writes down where somebody lives.
      Complexity: L

- [ ] JOY-008: Add a storm journal that writes its own first draft
      Why: This is the item that earns a year of use. When a warning reaches a named place, when a cell passes within a few miles, or when the reader exports a picture, the app can open an entry with the time, the place, the hazard, and a thumbnail of the frame that was on screen, and leave room for a sentence in the reader's own words. Over a couple of seasons that becomes a personal weather history nothing else has, and it is the thing somebody would refuse to switch away from.
      Evidence: `src/hooks/useAlertWatch.ts`; `src/hooks/useExport.ts`; `src/lib/export.ts`; `src/hooks/useStormCells.ts`; JOY-007; AUD-083
      Touches: Journal entries and their storage; automatic draft triggers; a thumbnail budget; a journal surface with search by place, date, and hazard; export and deletion; workspace backup
      Acceptance: An entry is created automatically for a defined and documented set of events, is always editable and deletable, and is never created for anything the reader did rather than anything the weather did; each entry keeps the source and observed time of what it depicts, so a picture in the journal can still be dated years later; thumbnails obey a byte budget with the whole journal bounded; the journal exports as readable files rather than as an opaque blob; nothing about it is notified, counted, or scored.
      Complexity: XL

- [ ] JOY-009: Add an offline almanac card for the day
      Why: The best track archive back to 1851 is already bundled, sitting in the repository doing nothing on a calm afternoon. A card that says what happened on this date, with a way to fly the map to it and replay the radar where the archive reaches, gives somebody a reason to open the app on the three hundred days a year when the weather is boring. It costs one bundled data file and no network at all.
      Evidence: `src/lib/hurdat.ts`; `public/hurdat/`; `src/panels/HistoryPanel.tsx`; `scripts/build-hurdat.mjs`; https://www.nhc.noaa.gov/data/hurdat/ ; https://registry.opendata.aws/noaa-nexrad/
      Touches: A date index over the bundled track record; a small curated events file with sources; the card and its dismissal; the fly-to and replay handoff; the data rebuild script and its documentation
      Acceptance: The card is built entirely from bundled data and works with networking off; every entry names its source and its date and distinguishes a track record from a curated note; a curated entry carries a citation and no editorialising about casualties; the fly-to sets the camera and the date without disturbing live layers, and offers replay only where the archive actually covers it; the card can be switched off and it never appears while a warning is active for a watched place.
      Complexity: L

- [ ] JOY-010: Say what was missed since the last time the app was open
      Why: Opening a weather app after four days away and getting a live map is a small missed opportunity. The log knows what happened at the named places while nobody was looking, and a short, dismissible summary of it is the most natural reason to come back.
      Evidence: JOY-007; JOY-006; `src/hooks/useAlertWatch.ts`; `src/components/ToastHost.tsx`
      Touches: A last-seen marker; the catch-up summary and its bounds; the surface it appears on; settings
      Acceptance: The summary covers only named places, only since the recorded last close, and only events that were logged rather than events reconstructed from a fresh query; it is capped in length with the rest reachable in the journal; it never shows an expired warning as though it were live and every line carries its own time; one dismissal removes it for that session and one setting removes it for good; an absence of anything to report says so in one line rather than showing an empty panel.
      Complexity: M

- [ ] JOY-011: Build a local year in weather from what the app already recorded
      Why: A recap of the year at your own places, assembled on your machine from your own log, is the strongest loyalty feature in this list and the one most likely to be shared as a picture. It is also the one that would be most obviously wrong to build on top of collected data, which is exactly why it should be built here, where the log never leaves the machine.
      Evidence: JOY-007; JOY-008; `src/hooks/useExport.ts`; `src/lib/export.ts`
      Touches: Recap aggregation over the log; the recap surface; a composed image export; coverage and honesty rules; translations
      Acceptance: Every figure in the recap is derived only from the local log and states the period and the number of days actually covered, so a partial year cannot read as a full one; missing coverage is shown as missing rather than as zero; the exported picture carries the period, the place name only if the reader includes it, and the data credits; nothing is compared against other users, ranked, or scored; the recap is available on any date rather than only in December, because somebody who installed the app in March should not wait.
      Complexity: L

- [ ] JOY-012: Show honest usage and coverage figures without turning them into a game
      Why: People do like knowing they have tracked ninety storms and watched two hundred hours of radar. They do not like being nudged about a streak, and a weather app that manufactures engagement pressure around severe weather would be genuinely distasteful. The figures belong in the journal as facts, with no reward layer on top.
      Evidence: JOY-007; JOY-008; JOY-011
      Touches: Journal statistics; the presentation; an explicit exclusion list
      Acceptance: Figures are shown only where the reader has gone to look for them and are never notified, badged, or celebrated; there is no streak, no level, no comparison against a previous period framed as a target, and no prompt to return; every figure names the period it covers and the log it came from; turning the log off leaves the figures unavailable rather than estimated.
      Complexity: S

- [ ] JOY-013: Let a reader name a storm cell and keep the name as it moves
      Why: The tracking algorithm already decides which blobs are one storm across frames, and it labels them with identifiers that mean nothing to a person. Somebody watching a supercell for two hours will call it something. Letting the app carry that name across the loop, into the journal, and into an export is a very small change with a disproportionate hold on the person doing the watching.
      Evidence: `src/lib/cells.ts`; `src/hooks/useStormCells.ts`; `src/components/MapViewport.tsx`; JOY-008
      Touches: A name attached to a tracked cell identity; label rendering and collision; the journal handoff; expiry when the track ends
      Acceptance: A name follows the cell the algorithm says is the same storm and disappears when that track ends rather than jumping to a different cell; the algorithm's own identifier stays visible somewhere, because the name is the reader's and the identity is the data's; names never overlap warning text or obscure a polygon; a named cell can be carried into a journal entry; names are local, bounded in number and length, and cleared with the session unless saved deliberately.
      Complexity: M

- [ ] JOY-014: Answer a storm name in search with its track
      Why: Typing Katrina into the place search currently asks a geocoder about a town. The best track record is bundled and covers every Atlantic and eastern Pacific cyclone since 1851, so the app can answer with the storm instead, draw the track, and offer the archive replay where it reaches. It reads like an easter egg and it is actually the fastest path to a feature the app already has.
      Evidence: `src/panels/SearchPanel.tsx`; `src/lib/hurdat.ts`; `src/panels/HistoryPanel.tsx`; `public/hurdat/`
      Touches: Search result types; storm name matching and disambiguation; the handoff to history and replay; result copy and its translations
      Acceptance: A name that matches one or more storms returns them alongside place results, clearly distinguished, with year, basin, and peak intensity, and reused names return every storm that carried it; matching happens against the bundled index with no network; choosing a storm draws its track and offers replay only for the years the archive covers; a name that is also a place still returns the place; no result implies a storm is current.
      Complexity: M

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

The three worth starting with are JOY-007 and JOY-008 together, since the journal is what a year of use turns into, JOY-006, because naming a place is what makes the rest of it personal, and JOY-001, because every visual item here is unsafe to attempt before the token boundary is held by a test.

## Research-Driven Additions

Added 2026-08-31 from the second research pass of that day (see `RESEARCH.md`). IDs continue the existing schemes. Ordered by priority.

- [ ] JOY-021: P3. Hide a small set of map curiosities worth finding
      Why: Collectible secret locations are a proven loyalty mechanic in exactly one weather app, which built a business partly on people hunting them. OpenRadar's version is truthful rather than fictional: a curated set of places where the weather made history, each telling its story when found, with the bundled track archive already able to draw many of them.
      Evidence: https://forums.macrumors.com/threads/carrot-weather-secret-locations.1862623/ ; https://developer.apple.com/news/?id=kf623ldf ; `src/lib/hurdat.ts`; `public/hurdat/`; JOY-009; JOY-014
      Touches: A curated locations file with citations; discovery detection from the camera; the reveal card; a found-so-far list in the journal; translations
      Acceptance: Each curiosity has a real, cited story and appears only when the reader explores to it; finding one is quiet (a card, never a toast or sound); the found list lives with the journal and carries no count toward anything; discovery detection costs nothing measurable during normal panning; the whole system honours the standing suppression rule during active warnings; the set ships with the app and works offline.
      Complexity: M

Added 2026-08-31 from the third research pass of that day (see `RESEARCH.md`), which covered the source classes the first two passes had not: winter weather, surface observations, historical warnings, soundings, smoke, decoder fuzzing, localization, and non-visual accessibility. IDs continue the audit scheme at `AUD-108` (the last assigned identifier, `AUD-107`, was completed and removed the same day). Ordered by priority, then trust before features.

- [ ] AUD-115: P3. Offer Clean IR satellite for the overnight hours
      Why: GeoColor goes effectively dark at night for storm tops; Band 13 Clean Infrared is the overnight-convection view enthusiasts ask for, and it is served by NASA GIBS at 10-minute cadence under the same provider, terms, and WMTS pattern as the GeoColor layer already shipped.
      Evidence: https://nasa-gibs.github.io/gibs-api-docs/available-visualizations/ (GOES-East/West ABI Band 13 Clean Infrared, Red Visible, Air Mass); the existing GeoColor provider in `src/lib/providers/`
      Touches: A satellite product selector where there is currently one product; the GIBS layer identifiers; legend and attribution copy; timeline behaviour identical to GeoColor
      Acceptance: Band 13 is selectable beside GeoColor, drawn with a labeled brightness-temperature presentation, on the same timeline with the same latency accounting; attribution still names GIBS/ESDIS; switching products invalidates nothing outside the satellite layer; the provider is covered by the existing satellite live contract.
      Complexity: S

- [ ] AUD-120: P3. Hand a warning to the layer that explains it
      Why: The app often already holds the data that explains a warning (flash flood and the QPE accumulation grids, snow squall and reflectivity/precip type, tornado and velocity) but the reader has to know to go find it. A one-action handoff from the warning popup to the relevant layer turns the alert stream into a teaching surface, and competitors do nothing here beyond push notifications.
      Evidence: The warnings adapter popup in `src/lib/overlays/alerts.ts`; the MRMS registry in `src-tauri/src/mrms.rs`; hazard filtering in `src/lib/alertTypes.ts`; competitor absence per `RESEARCH.md` (2026-08-31 pass three)
      Touches: A hazard-to-layer mapping with copy; a popup action that enables the paired layer and, where relevant, sets its product; state restore when the reader turns the pairing off
      Acceptance: A flash flood warning popup offers one action that shows rainfall accumulation, a snow squall offers precipitation type or reflectivity, and a tornado warning offers velocity at the nearest held site; the action changes layer switches only, never the warning's own presentation; each pairing is enumerated in one tested table so a new hazard without a pairing is a visible decision rather than a silent gap.
      Complexity: S

- [ ] AUD-117: P3. Build an integrated Skew-T and hodograph
      Why: The community-standard sounding tool is dead software (SHARPpy: last release 2020-03, last push 2023-04-07) and no OSS radar application ships an integrated sounding view; RadarOmega treats one as a paid differentiator. The observed side (IEM RAOB JSON, verified live with open CORS) and the forecast side (Open-Meteo pressure levels, 19 to 44 levels, the API the guidance panel already uses) are both keyless.
      Evidence: https://github.com/sharppy/SHARPpy ; https://mesonet.agron.iastate.edu/json/ (raob.py verified 2026-08-31); https://open-meteo.com/en/docs/gfs-api ; https://stormtrack.org/threads/viewing-archived-soundings-in-sharppy.29574/ ; `src/lib/guidance.ts`
      Touches: A sounding panel with in-house Skew-T rendering (skewed isotherms, dry and moist adiabats, mixing-ratio lines; existing small OSS implementations as references, not dependencies) and a hodograph; observed soundings by nearest launch site and time; forecast soundings for the map centre by model and run; derived parameters (CAPE, CIN, shear) labeled as computed here; provenance and units
      Acceptance: A reader can view the nearest observed sounding with its launch site and valid time, and a forecast sounding for the map centre with model and run labeled; observed and forecast are never blended and each says which it is; derived parameters state their parcel assumptions; rendering passes the clipping test in both languages and respects both themes; parsing and parameter math are held by fixtures against published values for a known sounding.
      Complexity: XL

- [ ] AUD-118: P3. Ship French
      Why: The app draws ECCC's data, and every Canadian public weather product is bilingual under the Official Languages Act; Quebec's Bill 96 sets French UI as the norm for software distributed there. No OSS desktop radar application ships any localization at all, so English, Spanish, and French would be unique in the niche. The typed-catalogue architecture (es.ts typed against en.ts, pseudolocale clipping test, coverage scan) was built for exactly this; the cost is authorship, not plumbing.
      Evidence: https://en.wikipedia.org/wiki/Meteorological_Service_of_Canada ; https://www.weglot.com/blog/bill-96-explained ; https://github.com/breezy-weather/breezy-weather (OSS precedent shipping FR); `src/i18n/en.ts`; `src/i18n/es.ts`; `src/i18n/coverage.test.ts`
      Touches: A hand-written `fr.ts` typed against the English catalogue; the language selector; number and unit formatting for French Canada (comma decimals, km/h); the clipping and coverage tests; README language note
      Acceptance: Every catalogue string has a hand-written French translation that type-checks against the English shape; the clipping test passes for French at the standard viewport; alert and safety copy reads naturally rather than machine-translated, including the not-a-warning-source position; the coverage scan finds no untranslated surface; Spanish behaviour is unchanged.
      Complexity: L

- [ ] AUD-119: P3. Make releases discoverable and community-packagable without authoring packages
      Why: Community Scoop manifests auto-update from GitHub releases only when the asset-name pattern is stable and the silent-install switches are documented, and the repository currently documents neither; discovery channels that move OSS desktop apps (GitHub topics, AlternativeTo, curated Windows lists) have zero presence. Authoring winget manifests stays excluded by owner policy; this item only makes outside packaging possible.
      Evidence: https://github.com/ScoopInstaller/Scoop/wiki/App-Manifest-Autoupdate ; https://v2.tauri.app/distribute/windows-installer/ (NSIS /S and related switches); https://github.com/0pandadev/awesome-windows ; `scripts/release.mjs`; the repository's topic list
      Touches: A README installation subsection documenting the silent-install switches and the guaranteed asset-name pattern; a release-script check that the pattern holds; GitHub repository topics; a short list of listing venues with what a submission needs, so the owner can post them
      Acceptance: The README states the exact asset-name pattern and that it is stable across releases, with the silent switches shown; the release gate fails if a built asset departs from the pattern; repository topics name the niche (weather radar, NEXRAD, Tauri); the listing venues and prepared descriptions exist in the repo for the owner to submit, since publishing under an identity is a person's act.
      Complexity: S

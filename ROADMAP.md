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

- [ ] JOY-019: Write the current view to the desktop wallpaper on a schedule
      Why: This is the quiet showpiece. A composed radar picture of your own area, refreshed on the desktop every fifteen minutes, is something people notice and talk about, and it needs no new data path at all because the still export already exists.
      Evidence: `src/hooks/useExport.ts`; `src/lib/export.ts`; `src-tauri/src/exports.rs`; `src-tauri/src/lib.rs`
      Touches: A native wallpaper write on Windows; the schedule and its bounds; the composed frame including time, place, and credits; the previous wallpaper; failure reporting; settings
      Acceptance: The reader's previous wallpaper is recorded before the first write and restored when the feature is switched off; the schedule has a floor that keeps provider requests inside the budget, and it stops while the machine is offline rather than writing an empty map; every written picture carries its time, its source credits, and its own age; a failed write reaches a toast and the log instead of failing silently; the feature is Windows-only for now and says so; nothing is written anywhere except the configured wallpaper path.
      Note (2026-08-31): Use the `IDesktopWallpaper` COM interface from the `windows` crate (per-monitor, no elevation); `SystemParametersInfoW` is the single-monitor fallback. The cautionary tale is Microsoft's own Bing Wallpaper app, panned in November 2024 for bundling everything but wallpaper: this feature does one thing, opt-in, and restores what it found.
      Complexity: L

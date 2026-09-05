# OpenRadar Blocked Work

## Three releases are built and never published, and only the owner can publish them

Re-checked 2026-09-04: the published manifest still answers v0.4.0; the tree is v0.9.0 with an unreleased v0.10.0 in the changelog, so the gap is now five releases and the one-release gate below refuses to stage a build until the owner publishes.

Found 2026-09-02, and confirmed live the same day: `https://github.com/SysAdminDoc/OpenRadar/releases/latest/download/latest.json` answers with `version: 0.4.0`, dated 31 August, while every manifest in this tree says 0.7.0 and the changelog carries an unreleased 0.8.0. The updater is the only channel an installed copy has, and it reads that one file, so every installed copy has been told it is up to date through 0.5, 0.6 and 0.7. Among the fixes sitting unpublished is the one that made every external link in the packaged build work again: in an installed 0.4.0, clicking the weather office's own page for a warning does nothing at all.

**Done here.** `npm run release` now reads the published manifest, prints it beside the repository version, and refuses to stage a build when the gap is more than one release, naming the publish as the owner's act. `publishedLag` and `publishedLagLine` in `scripts/release-lib.mjs` carry the rule, with the live 0.4.0-against-0.7.0 case pinned as a test. The README's install section says what an installed copy is actually being offered and why that can lag this repository.

**Not doable here.** Publishing means tagging, pushing, building a signed installer with the updater key at `~/.tauri/openradar_updater.key`, and creating public GitHub releases under the owner's identity. Every part of that is outward-facing and cannot be taken back once it is done. The command is `npm run release -- --publish`, run from a clean `main` that matches `origin/main`, once per version that should exist as a release.

Blocked on: the owner running that publish. When the live manifest matches the newest tag, this entry goes and the gate stays.

## The NetCDF reader recurses without bound, and only upstream can stop it

Found 2026-08-31 by the `netcdf_flashes` fuzz target, in the first minutes of its first session. Two distinct findings on the GOES lightning path, both from files that pass the HDF5 magic check `decode_flashes` opens with, which is the last thing OpenRadar gets to look at before the reader takes over.

**Fixed here.** A 215-byte file works the element count out as a product of dimension sizes that overflows. With debug assertions that is a panic; without them it is a wrapped count that nothing checks, which is worse. It is contained by a panic guard around the whole read in `src-tauri/src/lightning.rs`, held by `lightning::tests::a_malformed_lightning_file_is_refused_rather_than_fatal`, with the bytes at `src-tauri/fuzz/reproducers/netcdf-flashes-multiply-overflow.bin`.

**Not fixable here.** A 202-byte file sends the reader into unbounded recursion. A stack overflow is not a panic: `catch_unwind` never sees it, Windows raises it as an access violation or STATUS_STACK_OVERFLOW, and the process is gone with no chance to say anything. Nothing outside the reader can bound the nesting depth of an HDF5 structure without parsing HDF5, which is the job the reader exists to do. The bytes are at `src-tauri/fuzz/reproducers/netcdf-flashes-access-violation.bin`.

What that means in practice: the file has to arrive from NOAA's public GOES bucket over TLS, so producing one takes the bucket or the connection, and the realistic case is a corrupt download that happens to nest deeply. The window closing with no message is still the worst outcome this decoder has.

It is checked on every run without taking the suite down: `lightning::tests::a_file_that_nests_too_deep_takes_the_reader_down_and_is_upstreams` runs the bytes in a child process and asserts the child dies. The day the reader stops recursing, that test fails and says to promote it to an ordinary one and delete this entry.

Blocked on: a fix in `netcdf-reader` or `hdf5-reader`, or a depth limit either of them is willing to expose. Reporting it is a person's act under a person's identity, so the reproducers are committed and ready rather than filed.

## Release prerequisites

- Authenticode signing needs a code-signing certificate, and buying one is a spending decision rather than an implementation detail. No suitable certificate is installed in the current user or local machine certificate store. Azure Trusted Signing admits individuals at about ten dollars a month, which is the cheapest route found; until someone signs up for it, Windows will warn on first run and the README says so. Everything else about releases works without it: the installer builds, the updater signature is a separate key that costs nothing, and the manifest is published beside the installer.
- Watching an installed v0.1.x replace itself with v0.1.y needs the desktop app on a real display, and this machine reserves that for an isolated session. What has been checked instead: the build produces the installer and an updater signature beside it, the signature verifies cryptographically against the public key in `tauri.conf.json` using the same BLAKE2b prehash the updater client uses, and `latest.json` carries that exact signature and a download URL matching the installer's own name. The version comparison the offer is judged by has its own tests.
- The clean Windows validation VM at `192.168.1.12` was offline during the v0.1.0 build. A silent install and uninstall passed locally in a disposable directory.

## Verification that needs a desktop session

- Confirming that a start-with-Windows launch opened from the tray shows the map at the window's own size needs the desktop app on a real display, and a WebView2 152 runtime. WebView2Feedback #5689 reports that a host whose window was hidden when the WebView was created is handed a viewport of about seventy by forty pixels; the resize observer cannot recover it, because the container never changes when the window it sits in appears. The repair, a resize when the document becomes visible, is in `src/components/MapViewport.tsx` and held by `src/lib/hiddenStart.test.ts`, which cannot reproduce the platform bug: no browser can be told to hand back a viewport smaller than its own window.
- Confirming that an `openradar://view?...` link focuses the running window and flies the camera needs the desktop app on a real display, as does confirming that a second launch reuses the window. The link format, the parser, and the Share button are covered by unit and end-to-end tests, and the Rust side registers both the scheme and the single-instance plugin.
- Confirming that a watched-area warning raises a Windows notification while the app is minimised needs the desktop app on a real display. Which alerts qualify, and the in-app fallback, are covered by unit and end-to-end tests, and the notification plugin and its permission are registered.
- Confirming that an export lands in the downloads folder of the desktop build needs the Tauri window on a real display. The browser path is covered end to end, including the burned-in caption and the file headers, and the Rust side that picks the folder and sanitizes the name has its own tests.
- Confirming that a frontend log line lands in the app log directory, which on Windows is under `%LOCALAPPDATA%\com.sysadmindoc.openradar\logs\`, needs the Tauri window on a real display. This machine reserves GUI validation for an isolated monitor or a virtual session, so the file itself has not been observed. The wiring is covered by the Diagnostics panel and an end-to-end test, and the Rust side already registers the LogDir target.

## Placefile parts the security model rules out

- Loading a placefile from a URL the user types cannot work under a fixed content security policy, and the Rust boundary refuses an address handed over by the frontend for the same reason. Allowing arbitrary placefile hosts is a security decision, not an implementation detail, so it needs a call on whether to add a trusted-host list and what belongs on it. Local placefiles load today through the Upload panel, and the refresh interval the file asks for is read and reported back when it loads, even though nothing refetches a local file.


## Hail probability and tornado vortex signatures from Level III

The storm cell item was scoped around four products: NST (storm tracking), NMD (mesocyclone), NHI (hail index) and NTV (tornado vortex signature). NST and NMD shipped on 2026-08-30. The other two cannot.

NHI and NTV stopped publishing in May 2022. This was checked against the bucket itself rather than taken from documentation, by listing the year and month prefixes for each site and product, for example `https://unidata-nexrad-level3.s3.amazonaws.com/?list-type=2&prefix=TLX_NHI_&delimiter=_`. Ten sites were checked (TLX, JAX, TBW, DMX, GRR, FWS, MOB, LWX, DTX, AMX). Every one has exactly `_2021_` and `_2022_` for NHI and NTV, while NST runs `_2020_` through `_2026_` without a gap. TLX's last NHI and NTV day is 2022-05-24. Nothing has been published for either in the last three years, at any site.

So there are no hail probability badges and no TVS markers in the cell layer, and there cannot be from this source. What would deliver them:

- Hail size: MRMS MESH, which this app already decodes as the `mesh` product. It is a grid rather than a per-cell number, so it would have to be sampled at each cell's position. That is a real option and worth its own item.
- Tornado vortex signatures: nothing equivalent is published. The detection would have to run here against the Level II velocity volume, which is a much larger piece of work than reading a product.

Worth recording, since it was found the same way: the symbology block's hail size field is the expected size rounded to whole inches, a display bucket rather than a measurement. Calibrated across 740 cells in 122 archived NHI files, raw 0 covers everything from under half an inch to half an inch, raw 1 covers three quarters to an inch and a quarter, and so on. The quarter-inch value exists only in the tabular text, so even with a live feed the symbology packet alone could not give a hail size worth printing.

## Confirming the window comes back where it was

The window-state plugin is registered and its restore path is the plugin's own: it writes the position and size on exit, and on start it restores the position only if it still intersects one of the available monitors, otherwise it leaves the placement to the system. Watching a real window move, close, and come back needs the desktop app on a real display, and this machine reserves that for an isolated session, so it has not been observed. Maximised and fullscreen are deliberately not saved: a window that comes back covering the screen because it was left that way once is a surprise, and the map is usable at any size.

## Decoding the testbed radar's own Level II stream

The LTR item asked for a live test against KCRI, the National Weather Service testbed radar that already emits the message the rest of the network gets in 2027. KCRI does not publish to the public archive bucket: listing `unidata-nexrad-level2` for `YYYY/MM/DD/KCRI/` returns nothing for any of the last five days, while the operational sites return hundreds of objects each. There is no public copy of that stream to test against.

What replaced it is stronger in the way that matters. Rather than hoping one site's stream happens to contain the new message, a message of every type number from 0 to 255 is fed through the real decoder in a real frame layout, and the whole stream has to survive each one. The specific number the notice names is checked as well: it comes back recognised as unknown, is skipped, and does not swallow the message after it. That covers whatever the message ends up being called and anything added after it.

## The `lru 0.16.4` advisory cannot be cleared from this tree

`AUD-067` asked for `cargo tree` to contain no affected `lru`. That cannot be reached from here, and the reason is worth writing down because the advisory will keep appearing in every scan.

The chain is `openradar -> netcdf-reader 0.9.1 -> hdf5-reader 0.9.1 -> lru 0.16.4`, confirmed with `cargo tree -i lru` on 2026-08-31. `hdf5-reader` requires `lru = "^0.16.3"`, so Cargo may only resolve inside the 0.16 line. There is no fixed release in that line: crates.io lists 0.16.0 through 0.16.4 and nothing further, and RUSTSEC-2026-0253 is fixed first in 0.18.2. `cargo update` therefore cannot help, and a `[patch.crates-io]` entry pointing `lru` at 0.18.2 cannot help either, because a patch still has to satisfy the requirement it replaces. Upstream has published nothing newer: `hdf5-reader`, `hdf5-core` and `netcdf-reader` are all 0.9.1, last released 2026-07-29.

The advisory is also not reachable through this dependency, which is what makes forking the wrong trade rather than merely an expensive one. RUSTSEC-2026-0253 is a panic-safety hole: `LruCache::pop()` leaves dangling pointers if a `Drop` unwinds part-way through, which turns into a use-after-free or a double free. That needs a key or value whose `Drop` can panic. `hdf5-reader` keeps three caches and every one of them is built from types that cannot panic on drop: `ChunkKey { u64, SmallVec<[u64; 4]> }` and `ChunkEntryCacheKey { u64, SmallVec<[u64; 4]>, SmallVec<[u64; 4]> }` as keys, plus a plain `u64` key in the block cache, holding `Arc<Vec<u8>>`, `Arc<[u8]>` and `Arc<Vec<ChunkEntry>>` as values. Integers, small vectors of integers, and reference-counted byte buffers do not run user code when they are dropped.

Three routes exist and each needs a decision rather than an edit:

- Ask upstream to move. This is the real fix and the repository is alive (`roteiro-gis/netcdf-rust`, last push 2026-07-29). The lru API that `hdf5-reader` actually uses is `new`, `get`, `put`, `pop_lru`, `peek`, `len` and `is_empty`, all of which are unchanged in 0.18, so the upstream change is close to a one-line version bump. Filing that issue publishes a message under the maintainer's own account and belongs to a person, not to a drain loop.
- Carry a fork. A `[patch.crates-io]` entry aimed at a fork of `hdf5-reader` with the bump applied would clear the scanner. It would also put a fork of a ten-thousand-line HDF5 decoder permanently in the supply chain of the GLM lightning path, where it would need rebasing on every upstream release and would quietly stop receiving upstream fixes if it were ever forgotten. For an unreachable unsoundness that is a worse position than the one it leaves.
- Silence the specific advisory with a dated, expiring `cargo audit` ignore carrying the analysis above, so that the scan stays useful for everything else instead of being trained into noise. This keeps the crate in the tree, so it does not satisfy the item as written.

Nothing here blocks a release on its own terms: the risk is theoretical for this usage, and `npm audit --omit=dev` and the rest of `cargo audit` were clean on 2026-08-31. What it blocks is the promise the item made, which was to have the crate gone.

## Audit items that need a desktop session, a clean VM, or a certificate

Four audit items ask for evidence that cannot be produced from a terminal on this machine. They are the same blockers already described above, carried here with their identifiers so nothing looks unaccounted for.

- `AUD-003`, observing an installed updater replacement end to end. It needs an older build installed on a real display, updating itself and restarting. See the release prerequisites above: the signature, the manifest, and the version comparison are all covered by tests, and the replacement itself is not.
- `AUD-004`, exercising the real native desktop workflows: deep links, single-instance reuse, Windows notifications, native save dialogs, log file creation, and file reveal. Every one of these is covered by unit and headless tests, and every one of them ends in a window somebody has to look at. This machine reserves GUI validation for an isolated monitor or a virtual session, so it cannot be done here without taking over the screen in front of the user.
- `AUD-005`, Authenticode-signing the installer. This is a purchase before it is an implementation. Azure Trusted Signing at about ten dollars a month remains the cheapest route found, and until somebody signs up for it, SmartScreen warns on first run and the README says so.
- `AUD-006`, the clean Windows install and uninstall validation. It needs a throwaway Windows image that no session has touched, plus a display to watch the first run on. The virtual machine on the network is not clean and installing into it would stop it being a useful control.
- `AUD-165`, watching the tray icon, the glance window, the desktop wallpaper, the updater and an incident pack behave in an installed build. Its own acceptance line asks for a checklist run on a virtual desktop or a second session, which is the blocker the other four share. Everything it names is covered by unit and headless tests and none of it has been observed on a machine: whether the icon really disappears on switch-off, whether the wallpaper restore holds across a reboot, whether the passive updater relaunches cleanly, whether a pack survives a pause and a restart.

What would unblock all five in one go is an isolated desktop session, either a second physical display this machine may drive or a virtual machine with its own console, plus a certificate for the signing half of `AUD-005`.

`AUD-165` kept whole so it can go back to `ROADMAP.md` unchanged:

    - [ ] AUD-165: Installed-build behaviour of the tray icon, the glance window, the desktop wallpaper, the updater and incident packs
          Category: testing
          Where: `src-tauri/src/tray.rs`, `glance.rs`, `wallpaper.rs`, `src/lib/updates.ts`, `src-tauri/src/incident_packs.rs`
          Problem: None of these run in the browser suite. The three P1/P2 ACL findings above were found by reading the capability file; whether the icon really disappears on switch-off, whether the wallpaper restore holds across a reboot, whether the passive-mode updater relaunches cleanly and whether a pack survives a pause and a restart have never been observed on a machine, only reasoned about.
          Evidence: `e2e/` stubs `__TAURI_INTERNALS__` in every desktop-flavoured spec; the audit rules forbid driving the reader's screen.
          Fix: A checklist run on a virtual desktop or a second session, recorded in the working notes: tray on/off/on, glance from the tray in French, wallpaper on then off then reboot, an update from 0.6.0 to 0.7.0, a pack paused mid-download and resumed after a restart.
          Acceptance: Each step observed and noted, with any defect logged here.
          Confidence: Needs-repro
          Effort: M


## Rich alert toasts, and proving a toast is attributed at all

`AUD-093` belongs with the four above rather than in the active backlog, because every clause of what it asks for ends at a window somebody has to look at.

The useful half of it is a real finding and worth writing down while it is fresh. Windows drops a toast silently when the Start-menu shortcut does not carry a correct application user model identifier, so the alert notification path may already be failing on some installs with nothing said. Nothing in a headless test can tell the difference between a toast that was raised and one that was swallowed, which is exactly why the item asks for an installed build.

The other half is that `tauri-plugin-notification` is text-only on Windows: its actions are mobile-only and it carries no image, while WinRT toast XML supports a radar snapshot, an open action and the urgent scenario a tornado warning deserves. Writing that module without being able to see a single toast come out of it would be building the one thing whose whole acceptance is visual.

What would unblock it is the same isolated desktop session the four above need, plus a packaged build to install.

## RRFS cannot be evaluated before it is operational

`AUD-080` asks for the replacement of HRRR by NOAA's Rapid Refresh Forecast System to begin only once the operational launch is confirmed. The launch is scheduled for 2026-10-06, which has not happened: SCN 26-48 AAB (2026-07-06) reconfirms that date and carries the usual clause allowing a slip for a critical weather day.

There is nothing to build against in the meantime. The parallel feeds moved to NOMADS on 2026-08-11 and the old prototype AWS bucket stopped updating then, so fixtures taken now would be taken from paths that will not be the operational ones. The item's own acceptance says the same thing in its first line, and writing an adapter against a bucket that is about to be replaced is how a forecast enhancement becomes a release risk.

Unblocked by: the operational service notice for RRFS v1, at which point the bucket layout and the product inventory are worth fixturing. Check after 2026-10-06.

The item, kept whole so it can go back to `ROADMAP.md` unchanged:

    - [ ] AUD-080: Evaluate RRFS and REFS only after operational launch is verified
          Why: NOAA schedules v1 for 2026-10-06. Replacing HRRR before the bucket and product inventory stabilize would turn a forecast enhancement into a release risk.
          Evidence: `src/lib/providers/hrrr.ts`; https://registry.opendata.aws/noaa-rrfs-ops/
          Touches: Experimental forecast adapter; provider provenance; product inventory fixtures; fallback policy
          Acceptance: Work begins only after the operational service notice is confirmed; public bucket filenames and required reflectivity products have fixtures; RRFS is labeled experimental until live contract checks are stable; HRRR remains available as a fallback; no prototype path is presented as operational.
          Note (2026-08-31): SCN 26-48 AAB (2026-07-06) reconfirms 2026-10-06 with the standard critical-weather-day slip clause; parallel feeds moved to NOMADS on 2026-08-11 and the old prototype AWS bucket stopped updating then, so do not fixture against the prototype paths.
          Complexity: L

## ECCC publishes no extrapolation layer to build a lane out of

`AUD-078` assumed Environment and Climate Change Canada serves North American radar extrapolation on the same operational WMS as the observed composite. Checked against the service itself on 2026-08-31, it does not.

`GetCapabilities` on `https://geo.weather.gc.ca/geomet` lists 3,362 layers. Everything radar-shaped among them is an observation or a mask: `RADAR_1KM_RRAI` and `RADAR_1KM_RSNO` for rain and snow, the `RADAR_COVERAGE_*` outlines and hatches, the `RADARURPPRECIP*` styles those are drawn in, and the `RDPA`/`HRDPA` precipitation analyses, which are analyses of what fell rather than a forecast of what will. There is no `NOWCAST`, no `EXTRAP`, and nothing else that names a lead time.

The observed layer's own time dimension does not reach forward either. It answered `2026-08-31T17:12:00Z/2026-08-31T20:12:00Z/PT6M` at 20:16Z, so it ends at the present and a frame past `now` cannot be asked for. The `geomet-beta` endpoint that used to carry experimental layers returns 404, and `geomet-climate` has nothing radar in it at all.

So there is no official lane to separate, label and put on a dotted segment of the timeline. What the item deliberately ruled out, shipping a local single-flow extrapolation of our own, remains ruled out: the whole reason for preferring the official layer was that a nowcast the app invented would be presented beside observations with nothing but our own word behind it.

Unblocked by: ECCC publishing an extrapolation or nowcast layer on GeoMet. Worth re-running the capabilities check when the MSC open data announcements mention one.

The item, kept whole so it can go back to `ROADMAP.md` unchanged:

    - [ ] AUD-078: Add an official, clearly separated ECCC extrapolation lane
          Why: ECCC publishes North American extrapolation layers on the same operational WMS already used for observed Canadian radar. This offers a bounded nowcast without shipping a local single-flow algorithm first.
          Evidence: `src/lib/providers/geomet.ts`; `src/hooks/useRadarTimeline.ts`; https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radar_geomet_en/ ; https://community.windy.com/topic/31383/how-to-turn-off-forecasted-radar/5 ; https://github.com/JoshuaKimsey/LibreWXR/issues/24
          Touches: GeoMet provider; timeline segmentation; provenance; legend and source copy; archive controls
          Acceptance: Extrapolated frames appear only where the official layer covers and occupy a distinct dotted timeline segment labeled with method, source, issue time, valid time, and horizon; the last observation remains separately selectable; observations are never blended or relabeled; stale extrapolation disappears before fresh observations do.
          Complexity: M

## European radar through EUMETNET ORD is a no-go for a shipped desktop app

`AUD-082` allowed for closing with a documented no-go if there is no sustainable way for a distributed desktop application to query the Open Radar Data API. Read against the service on 2026-08-31, there is not.

ORD now sits behind the MeteoGate gateway, and its own overview lists three ways in. Anonymous access, which it describes as "suitable for trying out the ORD service, but it is not recommended for permanent usage because anonymous users have low query limits". An API key, "this option allows you to query data with a higher rate limit". Or a subscription to the MQTT notification service, which is the efficient path and wants credentials of its own.

None of those is a shipped desktop app. Anonymous is the tier the service asks people not to rely on, and every copy of OpenRadar in the world would be drawing on the same anonymous pool, which is exactly the load that tier is protected against. A key cannot be shipped: a secret in a downloadable binary is not a secret, and the item forbade embedding one for that reason. Asking each reader to register for their own MeteoGate key is technically possible and is an account, and this project's first promise is that it needs no account, no API key and no subscription.

What is not lost by saying no: Germany's radar already works, through the DWD's own WMS, which needs nothing. What a European reader loses is the OPERA composite and the national products beside it, which is real and is the reason to revisit this rather than delete it.

Unblocked by: a MeteoGate access tier that a redistributed desktop client can use without each reader holding a key, or a decision to change the no-account promise. The overview page is the thing to re-read: https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/

The item, kept whole so it can go back to `ROADMAP.md` unchanged:

    - [ ] AUD-082: Validate a sustainable EUMETNET ORD path for European radar
          Why: ORD exposes European volumes and composites with useful archives, but anonymous users have low query limits and member licenses can differ.
          Evidence: `src/lib/providers/dwd.ts`; https://eumetnet.github.io/openradardata-documentation/1-ORD-API-overview/
          Touches: Provider feasibility note; credentials strategy; license metadata; OPERA composite adapter; cache and traffic budget
          Acceptance: The item may close with a documented no-go if a desktop redistribution quota is unavailable; any shipped adapter embeds no secret, names product-level license and attribution, respects rate limits, distinguishes OPERA composite from national products, and has 24-hour cache and schema fixtures.
          Complexity: XL

## AUD-247: a placefile icon that really paints cannot be asserted from the browser suite

The fixture half of this is fixed and shipped: the sheet is fetched, and the
half that can be asserted is now a test. `e2e/layers.spec.ts` covers a sheet
that answers 404, where the position keeps a dot and none of the sheet's own
colour reaches the canvas. What could not be made to work is the other
direction, a sheet that loads and paints.

Traced on 2026-09-05, with the loader instrumented and the map exposed to the
spec. Everything up to the last step is right:

- the request reaches the stub, once, at the sheet's own address, which is
  what the earlier attempt could not get past (a plain `page.route` is never
  consulted, because the fetch goes through the cached scheme; registering
  through the fixture's own `stubHost` fixes that);
- the sheet decodes at 15 by 25, `sliceIcon` cuts a 15 by 49 image with 375
  solid magenta pixels in it, and `map.addImage` is called with it;
- the feature is on the map at the camera centre with `kind: "icon"` and the
  matching id, the icons layer is on the published stack, `map.hasImage(id)`
  is true, and `map.queryRenderedFeatures` for that layer returns the symbol.

And nothing of the sheet's colour appears in a canvas readback, over fifteen
seconds, with the camera centred on the point. The readback itself works: the
same read returns a fully painted frame, and the same method is what the
magenta-line test in that file asserts on today.

So the last step is unexplained. Two candidates, neither settled: the symbol
is placed and reported as rendered but painted with something other than the
image, or the readback is a frame that predates the `addImage` reload and
never catches up. Worth an hour with a headed browser and the MapLibre debug
overlay, which is what this pass did not have.

Note that no pixel-free assertion discriminates the regression this item
exists for: under the `coalesce` the icon id is still added and the symbol is
still rendered, so `hasImage` and `queryRenderedFeatures` both stay true. The
source-reading gate in `placefileIcons.test.ts` remains the only thing
holding that mistake down.

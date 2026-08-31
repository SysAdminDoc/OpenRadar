# OpenRadar Blocked Work

## Release prerequisites

- Authenticode signing needs a code-signing certificate, and buying one is a spending decision rather than an implementation detail. No suitable certificate is installed in the current user or local machine certificate store. Azure Trusted Signing admits individuals at about ten dollars a month, which is the cheapest route found; until someone signs up for it, Windows will warn on first run and the README says so. Everything else about releases works without it: the installer builds, the updater signature is a separate key that costs nothing, and the manifest is published beside the installer.
- Watching an installed v0.1.x replace itself with v0.1.y needs the desktop app on a real display, and this machine reserves that for an isolated session. What has been checked instead: the build produces the installer and an updater signature beside it, the signature verifies cryptographically against the public key in `tauri.conf.json` using the same BLAKE2b prehash the updater client uses, and `latest.json` carries that exact signature and a download URL matching the installer's own name. The version comparison the offer is judged by has its own tests.
- The clean Windows validation VM at `192.168.1.12` was offline during the v0.1.0 build. A silent install and uninstall passed locally in a disposable directory.

## Verification that needs a desktop session

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

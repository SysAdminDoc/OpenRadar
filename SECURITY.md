# Security

OpenRadar reads public weather data and draws it. It has no account, no server of its own, and no telemetry, so the interesting security questions here are about what it parses and what it trusts: binary radar formats decoded on your machine, files you hand it, and the update it installs over itself.

## Supported versions

| Version | Fixes |
| ------- | ----- |
| 0.13.x  | Yes   |
| Anything older | No |

This is a small project with one maintainer. Only the newest release gets fixes, and the honest reason is capacity rather than policy. If you are running something older, updating is the fix.

The newest build you can download is v0.4.0. The lines above it exist as tags in this repository and have not been published, so if you are running an installed copy it is that one. The table said 0.9.x and 0.8.x and skipped 0.10.x altogether, which told a reader on the only downloadable build that their version was not covered by a policy whose supported line had never shipped.

The same goes for platforms. Windows x64 is what is built, tested and released, so it is what gets fixes. Nothing here is deliberately Windows-only and Tauri 2 runs elsewhere, but a build on macOS or Linux has never been launched by anyone here and is not covered. There is more on that in the README.

## Reporting something

Use GitHub's private vulnerability reporting on this repository: open the **Security** tab and choose **Report a vulnerability**. That opens a private thread only the maintainer can read, which is why it is the route named here instead of an address. Please do not open a public issue for something exploitable.

Include what you were running, what you did, what happened, and how sure you are. A rough report of something real is worth more than a polished report of something theoretical, so send it even if you have not finished working it out.

What to expect, honestly stated for a solo project: an acknowledgement within about a week, and a fix in the next release once the problem is confirmed. If a week passes with no reply, assume the notification was missed rather than ignored, and add a comment to the thread. There is no automation behind any of this and no other channel that reaches somebody faster.

Nothing here is a bug bounty. There is no money, and there is credit in the release notes if you want it and anonymity if you prefer that.

## Disclosure

Report privately, and give the fix time to reach people before writing it up. Once a release carrying the fix is out, publish whatever you like. If a problem is being exploited, or you have reason to think somebody else has found it, say so in the report and the timeline stops mattering.

## What is already checked here

Every gate below runs locally, on the machine doing the build, because this project publishes no build workflow.

- `npm audit --omit=dev` and `cargo audit` for known advisories in what ships. `cargo audit` reads every target's dependencies out of the lockfile, including the GTK3 bindings that only a Linux build would use, so a few of its warnings are about code Windows never compiles. Exactly one is silenced, in `src-tauri/.cargo/audit.toml`, and the file carries the evidence for it: which target graph the crate is absent from, the command that shows it, which upstream dependency has to move before it can go for real, and the date the exception gets looked at again. Nothing else is ignored, so the scan still reports the rest.
- `npm run check` for the frontend gates, and `cargo test --lib` for the decoders, including adversarial cases for malformed radar files and unknown message types.
- `npm run check:advisories` for the advisories `cargo audit` cannot see. It reads `Cargo.lock` and asks OSV about every crate in it, under both spellings of every name. That last part is the point: crates.io treats a dash and an underscore as the same character in a package name and the advisory databases do not, so GHSA-qwgh-2vcv-g2f7 sits under `block_buffer` while the lock says `block-buffer`, and `cargo audit`, grype and osv-scanner all called this tree clean in September 2026. Everything it finds has to be named in `src-tauri/.cargo/advisories.txt` with the reasoning above it, the same rules as the file beside it, and an identifier written there with nothing above it fails the run rather than being honoured. An entry can also name what its reasoning rests on, as in `needs sha2 0.11`, and the run stands it down when the lock stops holding that. Without that line an allowance outlives its own argument: putting this app's hashing back on the old buffer restored exactly the position one of those entries says has been fixed, and the run stayed green, because the advisory's own identifier, crate and version had not moved. It needs the network, so it sits beside `check:live` rather than inside `npm run check`.
- `npm run check:live` for whether the public services still answer the way the decoders expect.
- The release command verifies the updater signature against the public key in the app's own configuration and refuses a build whose artifacts do not match the commit it claims.

## The boundaries worth knowing about

- **Every native request goes through one allowlist.** `src-tauri/src/http.rs` decides which hosts Rust may reach, refuses anything that is not HTTPS, refuses credentials and unusual ports, and caps how much it will read. The webview has a separate and narrower content security policy in `src-tauri/tauri.conf.json`. A custom URI scheme the page can call is deliberately narrower than what Rust itself may reach.
- **Remote input is treated as remote input.** GRIB section lengths, declared grid dimensions and message headers all arrive from the network, so they are validated before anything is indexed or allocated from them, and decompression is capped separately from the download.
- **Local files are parsed, not trusted.** Colour tables, GeoJSON, placefiles and workspace backups go through bounded parsers, and a stored colour table is re-read from its own text rather than trusted as an object, so a hand-edited settings file cannot put anything on the map the parser would not have produced.
- **Updates are signed.** The installer downloads an update only when you ask it to, verifies it against the project's own key, and refuses it if the signature does not match. The installer itself is not yet Authenticode-signed, so Windows SmartScreen warns on first install. That gap is known, it is written down in the README, and it does not extend to what arrives afterwards.

## Things that are not vulnerabilities

- SmartScreen warning on first install. See above: the installer is unsigned, and the README says so.
- A forecast being wrong. OpenRadar is a viewer for public data and not an official source for warnings.
- A public data service being down, slow, or rate-limiting you.
- Reports produced only by a scanner, with no path showing the code can actually reach the problem. Send the path.

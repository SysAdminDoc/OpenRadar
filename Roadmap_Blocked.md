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


# OpenRadar Blocked Work

## Release prerequisites

- Authenticode signing needs a code-signing certificate. No suitable certificate is installed in the current user or local machine certificate store.
- The clean Windows validation VM at `192.168.1.12` was offline during the v0.1.0 build. A silent install and uninstall passed locally in a disposable directory.

## Verification that needs a desktop session

- Confirming that an `openradar://view?...` link focuses the running window and flies the camera needs the desktop app on a real display, as does confirming that a second launch reuses the window. The link format, the parser, and the Share button are covered by unit and end-to-end tests, and the Rust side registers both the scheme and the single-instance plugin.
- Confirming that a frontend log line lands in the app log directory, which on Windows is under `%LOCALAPPDATA%\com.sysadmindoc.openradar\logs\`, needs the Tauri window on a real display. This machine reserves GUI validation for an isolated monitor or a virtual session, so the file itself has not been observed. The wiring is covered by the Diagnostics panel and an end-to-end test, and the Rust side already registers the LogDir target.

## Placefile parts the security model rules out

- Loading a placefile from a URL the user types cannot work under a fixed content security policy, and the Rust boundary refuses an address handed over by the frontend for the same reason. Allowing arbitrary placefile hosts is a security decision, not an implementation detail, so it needs a call on whether to add a trusted-host list and what belongs on it. Local placefiles load today through the Upload panel, including their refresh interval, which is read and reported.
- Applying a GRLevel3  colour table to reflectivity needs raw values to colour. Radar arrives as tiles the NOAA services have already drawn, so a palette has nothing to act on until the Level II or MRMS decoding work lands.

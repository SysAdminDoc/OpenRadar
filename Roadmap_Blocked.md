# OpenRadar Blocked Work

## Release prerequisites

- Authenticode signing needs a code-signing certificate. No suitable certificate is installed in the current user or local machine certificate store.
- The clean Windows validation VM at `192.168.1.12` was offline during the v0.1.0 build. A silent install and uninstall passed locally in a disposable directory.

## Verification that needs a desktop session

- Confirming that a frontend log line lands in `%APPDATA%com.sysadmindoc.openradarlogsopenradar.log` needs the Tauri window on a real display. This machine reserves GUI validation for an isolated monitor or a virtual session, so the file itself has not been observed. The wiring is covered by the Diagnostics panel and an end-to-end test, and the Rust side already registers the LogDir target.

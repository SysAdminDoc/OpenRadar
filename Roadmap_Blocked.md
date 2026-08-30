# OpenRadar Blocked Work

## Release prerequisites

- Authenticode signing needs a code-signing certificate. No suitable certificate is installed in the current user or local machine certificate store.
- The clean Windows validation VM at `192.168.1.12` was offline during the v0.1.0 build. A silent install and uninstall passed locally in a disposable directory.

; Macros the Tauri installer script inserts at fixed points. Each one is held
; by a test in src-tauri/src/wallpaper.rs, because nothing else in the build
; runs this file before an installer is made.

; Before anything is removed, the reader's own desktop picture goes back.
;
; The radar wallpaper writes its picture into the app's data and keeps a note
; of what it replaced beside it. Closing the app leaves the last picture up,
; which is the design. Uninstalling is not the same: nothing would ever change
; that picture again, and the note goes with the app's data. So the binary is
; asked to put the reader's own wallpaper back while it and the note are both
; still here, and it does that only if the desktop is still showing ours.
;
; Not during an update. The new installer runs this uninstaller with /UPDATE
; to replace the old copy, and the app comes straight back to keep its picture.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-wallpaper "$APPDATA\${BUNDLEID}"'
  ${EndIf}
!macroend

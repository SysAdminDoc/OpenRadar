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
; The app is closed first, with the uninstaller's own check. The template
; makes that check after this hook, so a reader who pressed Cancel at
; "OpenRadar is running" had already lost the note while the app kept
; running, and its next picture went up with nothing recorded to put back.
; Asked here, Cancel stops the uninstall before anything is touched, and the
; template's own check afterwards finds nothing left to close.
;
; An update never reaches this: the updater's installer skips the old
; uninstaller altogether. The guard is for somebody running it with /UPDATE
; by hand. A reinstall that uninstalls first does come through here, and that
; is right, because the new copy notes the restored wallpaper the next time it
; puts a picture up.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-wallpaper "$APPDATA\${BUNDLEID}"'
  ${EndIf}
!macroend

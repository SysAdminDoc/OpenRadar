//! Keeping the screen on while the second-monitor view is showing.
//!
//! The full-screen ambient view is meant to be left running on the screen
//! nobody is typing on, and Windows turns that screen off on its own timer.
//! The page cannot stop it: the Screen Wake Lock API is not implemented in
//! WebView2, so a browser-side lock is not an option in this app however it
//! is written. One Win32 call is.
//!
//! `SetThreadExecutionState` is per thread, and its `ES_CONTINUOUS` state
//! lasts until that thread changes it or ends. A Tauri command runs on
//! whichever runtime worker picked it up, and the next call may land on a
//! different one, so the hold is taken on the main thread: it lives as long
//! as the process, which is also what releases the hold when the app exits
//! without anything having to remember to.

use tauri::AppHandle;

/// Whether this build can hold the display awake at all.
///
/// False everywhere but Windows, and the setting says so rather than
/// offering a switch that does nothing.
#[tauri::command]
pub fn display_awake_available() -> bool {
    cfg!(windows)
}

/// Holds the display awake, or lets it go.
///
/// Idempotent on purpose: the ambient view can be entered and left faster
/// than a round trip, and `ES_CONTINUOUS` is a state rather than a count, so
/// asking twice for the same thing is the same as asking once.
#[tauri::command]
pub fn display_awake(app: AppHandle, hold: bool) -> Result<(), String> {
    hold_display(&app, hold)
}

#[cfg(windows)]
fn hold_display(app: &AppHandle, hold: bool) -> Result<(), String> {
    /// The state persists on the thread that set it until it is changed.
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    /// And while it is set, the display does not go to sleep. The system may
    /// still sleep; this is about the screen, which is what a reader watching
    /// a radar loop from across the room is asking for.
    const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    let flags = if hold {
        ES_CONTINUOUS | ES_DISPLAY_REQUIRED
    } else {
        ES_CONTINUOUS
    };
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        // SAFETY: a call taking one integer and returning one, with no
        // pointers and no state of ours behind it.
        let previous = unsafe { SetThreadExecutionState(flags) };
        let _ = send.send(previous);
    })
    .map_err(|failure| failure.to_string())?;

    // Waited for, because a zero is the only way the call says it refused and
    // a caller that never looked would report a hold it does not have.
    match receive.recv() {
        Ok(0) => Err("the system refused the display request".into()),
        Ok(_) => Ok(()),
        Err(_) => Err("the main thread did not answer".into()),
    }
}

#[cfg(not(windows))]
fn hold_display(_app: &AppHandle, _hold: bool) -> Result<(), String> {
    // Nothing to do and nothing to claim. The setting is not offered here.
    Ok(())
}

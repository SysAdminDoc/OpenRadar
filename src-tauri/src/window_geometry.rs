//! Putting the window back the size and place it opens at.
//!
//! Where the window was and how big it was is kept between launches by
//! `tauri_plugin_window_state`, in a file of its own beside the settings. That
//! makes it the one piece of the arrangement the crash screen's Reset layout
//! cannot reach by writing settings, and it is a piece that can genuinely
//! wedge a workspace: a window restored onto a monitor that is no longer
//! there, or at a size nothing fits in, leaves a reader with nothing to click
//! and no way to say so.

use tauri::{LogicalSize, Manager, Runtime};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Centres the main window at the size the app is configured to open at.
///
/// The size comes out of the running configuration rather than being written
/// down again here: a second copy of 1600 by 1000 would drift from
/// `tauri.conf.json` the first time somebody changed one of them.
#[tauri::command]
pub fn window_reset_geometry<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "there is no main window to put back".to_string())?;

    let opens_at = app
        .config()
        .app
        .windows
        .first()
        .map(|configured| (configured.width, configured.height))
        .ok_or_else(|| "the configuration names no window".to_string())?;

    // Maximised is not one of the flags the plugin keeps, but a window can be
    // maximised right now, and setting a size on one does nothing visible.
    let _ = window.unmaximize();
    window
        .set_size(LogicalSize::new(opens_at.0, opens_at.1))
        .map_err(|failure| failure.to_string())?;
    window.center().map_err(|failure| failure.to_string())?;

    // The plugin writes the file when the app exits. Written now as well,
    // because the reader is about to reload into whatever crashed, and a
    // second crash before a clean exit would otherwise leave the geometry
    // this call was asked to undo still on disk.
    app.save_window_state(StateFlags::POSITION | StateFlags::SIZE)
        .map_err(|failure| failure.to_string())?;
    Ok(())
}

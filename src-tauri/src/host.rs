//! Facts about the machine and the runtime this build is drawing in.
//!
//! The diagnostics report names the GPU renderer, which is what the page can
//! see for itself. What it could not say is which Chromium drew the picture:
//! the window is WebView2 and its runtime updates on Microsoft's schedule
//! rather than with the app, so two reports of the same GPU crash from the
//! same build can be two different browsers.

/// The WebView2 runtime's version, or nothing outside a native window.
///
/// `webview_version` answers for whatever webview the platform gave this
/// build, so the same command is useful wherever it is asked. An error means
/// the runtime would not say, which is worth reporting as "unknown" rather
/// than as a failure a reader has to act on.
#[tauri::command]
pub fn host_webview_version() -> Option<String> {
    tauri::webview_version().ok()
}

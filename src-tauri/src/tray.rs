//! A tray icon that says what the weather is doing where somebody watches.
//!
//! A radar app that has to be brought to the front to answer whether it is
//! about to rain is a radar app that gets closed. This is the smallest thing
//! that answers it without one: an icon in the tray whose look follows the
//! warning state at the reader's own places, and a menu that opens the window,
//! opens the small glance window, or quits.
//!
//! Four rules, and three of them are Windows being Windows:
//!
//! - **The icon says one thing.** Whether a warning stands at a place the
//!   reader named. Not how many, not what the app is doing, not whether it is
//!   busy: an icon that reports on the app rather than on the weather is an
//!   icon nobody reads.
//! - **Closing the window closes the app**, unless the reader has said
//!   otherwise. An app that silently keeps running after a close is an app
//!   people uninstall, and finding it in the tray afterwards is not a happy
//!   surprise.
//! - **The icon is dropped on the way out.** Windows leaves a ghost of a tray
//!   icon behind until somebody moves the mouse over it, so it is removed
//!   explicitly rather than left to the process ending.
//! - **It is built in exactly one place.** Declaring a tray in the config as
//!   well as here gives two icons, one of which nothing is listening to.

use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// What the tray is saying about the reader's places.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Hazard {
    /// Nothing standing anywhere the reader named.
    Quiet,
    /// A warning stands at a place the reader named.
    Warning,
}

static TRAY: Mutex<Option<TrayIcon>> = Mutex::new(None);

/// The label under the icon, which is what a hover actually shows.
fn tooltip(hazard: Hazard) -> &'static str {
    match hazard {
        Hazard::Quiet => "OpenRadar",
        Hazard::Warning => "OpenRadar — a warning stands where you watch",
    }
}

/// The icon itself, drawn here rather than shipped as two files.
///
/// Sixteen pixels of a filled circle, in the one colour that means anything:
/// the app's own blue when it is quiet, and the warning red when it is not.
/// Drawn rather than bundled because two more PNGs in the installer for
/// thirty-two coloured pixels is not a trade worth making.
fn icon(hazard: Hazard) -> Image<'static> {
    const SIZE: u32 = 16;
    let (r, g, b) = match hazard {
        Hazard::Quiet => (0x4b, 0xc0, 0xff),
        Hazard::Warning => (0xff, 0x51, 0x4b),
    };
    let middle = (SIZE as f32 - 1.0) / 2.0;
    let mut pixels = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - middle;
            let dy = y as f32 - middle;
            let away = (dx * dx + dy * dy).sqrt();
            // A soft edge, so it does not look like a sixteen-pixel staircase
            // on a display that is not scaling it.
            let alpha = ((6.6 - away) * 255.0).clamp(0.0, 255.0) as u8;
            pixels.extend_from_slice(&[r, g, b, alpha]);
        }
    }
    Image::new_owned(pixels, SIZE, SIZE)
}

/// Builds the tray icon and its menu. Called once, at startup.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open OpenRadar", true, None::<&str>)?;
    let glance = MenuItem::with_id(app, "glance", "Glance", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &glance, &quit])?;

    let tray = TrayIconBuilder::with_id("openradar")
        .icon(icon(Hazard::Quiet))
        .tooltip(tooltip(Hazard::Quiet))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "glance" => {
                if let Err(error) = open_glance(app) {
                    log::warn!("OpenRadar could not open the glance window: {error}");
                }
            }
            "quit" => {
                // The icon goes first. Windows leaves a ghost behind until
                // somebody moves the mouse over it otherwise.
                drop_tray();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // A left click is the shortest way back to the window, which is
            // what somebody clicking a tray icon almost always wants.
            if let TrayIconEvent::Click { button, .. } = event {
                if button == tauri::tray::MouseButton::Left {
                    show_main(tray.app_handle());
                }
            }
        })
        .build(app)?;

    *TRAY.lock().unwrap_or_else(|held| held.into_inner()) = Some(tray);
    Ok(())
}

/// Takes the icon out of the tray, explicitly.
pub fn drop_tray() {
    let mut held = TRAY.lock().unwrap_or_else(|held| held.into_inner());
    *held = None;
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Opens the small always-there window, or brings it back to the front.
fn open_glance(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("glance") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    // Its own page rather than the workspace in a small window. A second live
    // map is a second WebGL context and a few hundred megabytes for something
    // that only has to say whether it is about to rain.
    tauri::WebviewWindowBuilder::new(app, "glance", tauri::WebviewUrl::App("glance.html".into()))
        .title("OpenRadar")
        .inner_size(320.0, 220.0)
        .min_inner_size(240.0, 160.0)
        .resizable(true)
        .always_on_top(false)
        .skip_taskbar(false)
        .build()?;
    Ok(())
}

/// Says what the tray should be showing. Called from the workspace.
#[tauri::command]
pub fn tray_hazard(warning: bool) -> Result<(), String> {
    let hazard = if warning {
        Hazard::Warning
    } else {
        Hazard::Quiet
    };
    let held = TRAY.lock().unwrap_or_else(|held| held.into_inner());
    let Some(tray) = held.as_ref() else {
        return Ok(());
    };
    tray.set_icon(Some(icon(hazard)))
        .map_err(|error| error.to_string())?;
    tray.set_tooltip(Some(tooltip(hazard)))
        .map_err(|error| error.to_string())
}

/// Whether a close hides the window instead of ending the app.
///
/// False, and that is the default the reader gets. An app that silently keeps
/// running after a close is an app people uninstall, and finding it in the
/// tray afterwards is not a happy surprise.
static CLOSE_TO_TRAY: Mutex<bool> = Mutex::new(false);

/// What a close should do. Said by the workspace, read by the window.
#[tauri::command]
pub fn tray_close_behaviour(hide: bool) {
    *CLOSE_TO_TRAY
        .lock()
        .unwrap_or_else(|held| held.into_inner()) = hide;
}

/// Whether a close should hide the window rather than end the app.
pub fn closes_to_tray() -> bool {
    *CLOSE_TO_TRAY
        .lock()
        .unwrap_or_else(|held| held.into_inner())
}

/// Always-on-top for the small window, when the reader asks for it.
#[tauri::command]
pub fn glance_on_top(app: AppHandle, on: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window("glance") else {
        return Ok(());
    };
    window
        .set_always_on_top(on)
        .map_err(|error| error.to_string())
}

/// Opens the small window from the workspace, as the tray menu does.
#[tauri::command]
pub fn glance_open(app: AppHandle) -> Result<(), String> {
    open_glance(&app).map_err(|error| error.to_string())
}

/// Whether the tray is there at all, so the reader can switch it off.
#[tauri::command]
pub fn tray_enabled(app: AppHandle, on: bool) -> Result<(), String> {
    if on {
        if TRAY
            .lock()
            .unwrap_or_else(|held| held.into_inner())
            .is_some()
        {
            return Ok(());
        }
        return init(&app).map_err(|error| error.to_string());
    }
    // Switched off leaves nothing behind, which on Windows means removing it
    // rather than hiding it.
    drop_tray();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_icon_says_one_thing_and_says_it_in_colour() {
        let quiet = icon(Hazard::Quiet);
        let warning = icon(Hazard::Warning);
        assert_eq!(quiet.width(), 16);
        assert_eq!(quiet.height(), 16);
        // The two states have to be told apart at sixteen pixels across a
        // desk, which means colour rather than shape.
        assert_ne!(quiet.rgba(), warning.rgba());

        // The middle is solid and the corners are empty, so it reads as a dot
        // rather than as a square.
        let middle = ((8 * 16 + 8) * 4) as usize;
        assert_eq!(quiet.rgba()[middle + 3], 255);
        assert_eq!(quiet.rgba()[3], 0);
    }

    #[test]
    fn the_tooltip_says_what_the_icon_means() {
        // An icon nobody can read is an icon that needs words on hover.
        assert!(tooltip(Hazard::Warning).contains("warning"));
        assert!(!tooltip(Hazard::Quiet).contains("warning"));
    }
}

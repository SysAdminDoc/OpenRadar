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
    /// The watch has stopped hearing back from the service.
    ///
    /// Not a colour of its own on purpose. The icon means one thing, which is
    /// whether there is weather where the reader watches, and an amber dot
    /// for "the app is having trouble" would compete with that. It says it in
    /// the words under the icon instead, where somebody who wondered why it
    /// has been quiet will look.
    Unreachable,
}

static TRAY: Mutex<Option<TrayIcon>> = Mutex::new(None);

/// The id the tray is built under, and the only handle that removes it.
const TRAY_ID: &str = "openradar";

/// The words on the menu and under the icon.
///
/// English until the workspace says otherwise. The glance window goes out of
/// its way not to be the one English surface in a French app, and the menu
/// that opens it should not be either.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Copy {
    pub open: String,
    pub glance: String,
    pub quit: String,
    pub quiet: String,
    pub warning: String,
    pub unreachable: String,
}

impl Default for Copy {
    fn default() -> Self {
        Self {
            open: "Open OpenRadar".to_string(),
            glance: "Small window".to_string(),
            quit: "Quit".to_string(),
            quiet: "OpenRadar".to_string(),
            warning: "OpenRadar: a warning stands where you watch".to_string(),
            unreachable: "OpenRadar: the watch is not reaching the service".to_string(),
        }
    }
}

static COPY: Mutex<Option<Copy>> = Mutex::new(None);

/// What the icon is currently saying.
///
/// Held because rebuilding the icon builds a quiet one, and the workspace
/// only speaks when the alert state changes. A reader who changed language
/// while a warning stood got a blue dot saying nothing was happening until
/// the warning ended, which is the opposite of the icon's one job.
static HAZARD: Mutex<Hazard> = Mutex::new(Hazard::Quiet);

fn copy() -> Copy {
    COPY.lock()
        .unwrap_or_else(|held| held.into_inner())
        .clone()
        .unwrap_or_default()
}

/// The words the tray shows. Said by the workspace once it knows the language.
#[tauri::command]
pub fn tray_copy(
    app: AppHandle,
    open: String,
    glance: String,
    quit: String,
    quiet: String,
    warning: String,
    unreachable: String,
) -> Result<(), String> {
    let next = Copy {
        open,
        glance,
        quit,
        quiet,
        warning,
        unreachable,
    };
    let changed = take_copy(next);
    // A menu cannot be relabelled in place, so the icon is rebuilt. Only when
    // the words actually changed: rebuilding on every settings write would
    // make the icon flicker out and back on a machine that is doing nothing.
    if changed
        && TRAY
            .lock()
            .unwrap_or_else(|held| held.into_inner())
            .is_some()
    {
        drop_tray(&app);
        init(&app).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// The label under the icon, which is what a hover actually shows.
fn tooltip(hazard: Hazard) -> String {
    let words = copy();
    match hazard {
        Hazard::Quiet => words.quiet,
        Hazard::Warning => words.warning,
        Hazard::Unreachable => words.unreachable,
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
        Hazard::Quiet | Hazard::Unreachable => (0x4b, 0xc0, 0xff),
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
    let words = copy();
    // Whatever it was saying before, not "quiet". A rebuild happens while the
    // app is running, and a warning that stands through one has to still be
    // on the icon afterwards.
    let hazard = *HAZARD.lock().unwrap_or_else(|held| held.into_inner());
    let show = MenuItem::with_id(app, "show", &words.open, true, None::<&str>)?;
    let glance = MenuItem::with_id(app, "glance", &words.glance, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", &words.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &glance, &quit])?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon(hazard))
        .tooltip(tooltip(hazard))
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
                drop_tray(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // A left click is the shortest way back to the window, which is
            // what somebody clicking a tray icon almost always wants.
            // On the release, not the press. The event carries both, so
            // ignoring the state brought the window forward twice for one
            // click.
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == tauri::tray::MouseButton::Left
                    && button_state == tauri::tray::MouseButtonState::Up
                {
                    show_main(tray.app_handle());
                }
            }
        })
        .build(app)?;

    *TRAY.lock().unwrap_or_else(|held| held.into_inner()) = Some(tray);
    Ok(())
}

/// Takes the icon out of the tray, explicitly.
///
/// Both halves are needed. Tauri keeps its own clone of the icon in the app's
/// resource table for the life of the app, so dropping ours only made the
/// icon unaddressable: it stayed on screen, frozen at whatever colour it last
/// had, and switching the tray back on built a second one beside it.
pub fn drop_tray(app: &AppHandle) {
    app.remove_tray_by_id(TRAY_ID);
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

/// Whether the small window should sit above everything else.
///
/// Held here rather than only on the window, because the reader can ask for
/// it before the window exists and the answer has to survive until it does.
static GLANCE_ON_TOP: Mutex<bool> = Mutex::new(false);

/// Opens the small always-there window, or brings it back to the front.
fn open_glance(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("glance") {
        let _ = window.show();
        let _ = window.set_focus();
        told_it_opened(app);
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
        .always_on_top(
            *GLANCE_ON_TOP
                .lock()
                .unwrap_or_else(|held| held.into_inner()),
        )
        .skip_taskbar(false)
        .build()?;
    told_it_opened(app);
    Ok(())
}

/// Tells the workspace the small window is up.
///
/// The workspace stops composing a still when nothing is looking at it, and
/// it found out by asking once a minute. Opened from the tray menu, which the
/// workspace never hears about, that meant up to a minute of a small window
/// with words and no map. Said rather than waited for.
fn told_it_opened(app: &AppHandle) {
    use tauri::Emitter;
    if let Err(error) = app.emit("glance-opened", ()) {
        log::warn!("OpenRadar could not say the glance window opened: {error}");
    }
}

/// Takes the new words and answers whether the icon has to be rebuilt.
///
/// Compared against the words the icon was actually built with, which before
/// anybody has said anything are the English defaults. Against "nothing said
/// yet" the first call was always a change, so every launch by an English
/// reader tore the icon down and built it again: on Windows that is the icon
/// vanishing from the tray and reappearing, which is what the guard exists to
/// prevent. Separate from the command so a test can drive it; the command
/// needs an `AppHandle` and the tray types pull in a library the test harness
/// does not load.
fn take_copy(next: Copy) -> bool {
    let mut held = COPY.lock().unwrap_or_else(|held| held.into_inner());
    let changed = held.clone().unwrap_or_default() != next;
    *held = Some(next);
    changed
}

/// Writes down what the tray should be showing, and answers with it.
///
/// Separate from the command because it is the half that has to survive a
/// rebuild, and because a test cannot call the command itself: the tray types
/// pull in a library the test harness does not load.
/// What the icon should be saying, given what the workspace knows.
///
/// Pure, and separate from writing it down, because the write goes to a
/// static that every test in this file shares: a test asserting the mapping
/// used to set that static out from under the test asserting the write.
///
/// A warning outranks everything. A reader whose watch is failing still needs
/// to know about the one it did hear about, and the icon has room for one
/// answer.
fn hazard_for(warning: bool, reaching: bool) -> Hazard {
    if warning {
        Hazard::Warning
    } else if reaching {
        Hazard::Quiet
    } else {
        Hazard::Unreachable
    }
}

fn remember_hazard(warning: bool, reaching: bool) -> Hazard {
    let hazard = hazard_for(warning, reaching);
    // Remembered whether or not there is an icon to put it on, so one built
    // later starts out telling the truth.
    *HAZARD.lock().unwrap_or_else(|held| held.into_inner()) = hazard;
    hazard
}

/// Says what the tray should be showing. Called from the workspace.
#[tauri::command]
pub fn tray_hazard(warning: bool, reaching: bool) -> Result<(), String> {
    let hazard = remember_hazard(warning, reaching);
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
    // Recorded whether or not the window is there. Asked for before it opens,
    // the answer used to be thrown away and the window opened behind
    // everything with the setting still ticked.
    *GLANCE_ON_TOP
        .lock()
        .unwrap_or_else(|held| held.into_inner()) = on;
    let Some(window) = app.get_webview_window("glance") else {
        return Ok(());
    };
    window
        .set_always_on_top(on)
        .map_err(|error| error.to_string())
}

/// Whether the small window is open and visible.
///
/// Asked so the workspace can stop composing a picture for a window nobody
/// has open. The tray menu can open it without the workspace hearing, so it
/// is asked rather than remembered.
#[tauri::command]
pub fn glance_showing(app: AppHandle) -> bool {
    app.get_webview_window("glance")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
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
    // The icon is the only way back to a window that is not on screen, so it
    // cannot be the last thing taken away. A launch the machine made opens to
    // the tray, and switching the icon off from the small window's settings
    // would otherwise leave a process nobody can reach.
    if let Some(window) = app.get_webview_window("main") {
        if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    // Switched off leaves nothing behind, which on Windows means removing it
    // rather than hiding it.
    drop_tray(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The held copy and the held hazard are shared, so the tests that write
    /// them have to take turns.
    ///
    /// Every other module with static state has one of these; this one did
    /// not, and the default runner runs these in parallel. A test that set
    /// French copy and a test that cleared it could read each other, so a
    /// tooltip assertion could see the wrong language and an icon assertion
    /// the wrong hazard. It passed every time it was run, which is the
    /// problem: nothing was stopping it from not passing.
    ///
    /// A panicking test poisons this; the next one carries on rather than
    /// failing for a reason that has nothing to do with it.
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

    fn alone() -> std::sync::MutexGuard<'static, ()> {
        ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|held| held.into_inner())
    }

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
        let _alone = alone();
        // An icon nobody can read is an icon that needs words on hover.
        *COPY.lock().unwrap_or_else(|held| held.into_inner()) = None;
        assert!(tooltip(Hazard::Warning).contains("warning"));
        assert!(!tooltip(Hazard::Quiet).contains("warning"));
    }

    #[test]
    fn the_words_are_the_readers_own() {
        let _alone = alone();
        // The glance window goes out of its way not to be the one English
        // surface in a French app. The menu that opens it should not be
        // either.
        *COPY.lock().unwrap_or_else(|held| held.into_inner()) = Some(Copy {
            open: "Ouvrir OpenRadar".to_string(),
            glance: "Coup d'oeil".to_string(),
            quit: "Quitter".to_string(),
            quiet: "OpenRadar".to_string(),
            warning: "OpenRadar : une alerte est en cours".to_string(),
            unreachable: "OpenRadar : la surveillance n'atteint pas le service".to_string(),
        });
        assert_eq!(
            tooltip(Hazard::Warning),
            "OpenRadar : une alerte est en cours"
        );
        assert_eq!(copy().quit, "Quitter");
        *COPY.lock().unwrap_or_else(|held| held.into_inner()) = None;
        assert_eq!(copy().quit, "Quit");
    }

    #[test]
    fn saying_the_same_words_does_not_rebuild_the_icon() {
        let _alone = alone();
        // An English reader's workspace hands over exactly what the icon was
        // built with. Compared against "nothing said yet" that read as a
        // change, so every launch made the icon vanish from the tray and come
        // back, which is what this guard exists to prevent.
        *COPY.lock().unwrap_or_else(|held| held.into_inner()) = None;
        let english = Copy {
            open: "Open OpenRadar".to_string(),
            glance: "Small window".to_string(),
            quit: "Quit".to_string(),
            quiet: "OpenRadar".to_string(),
            warning: "OpenRadar: a warning stands where you watch".to_string(),
            unreachable: "OpenRadar: the watch is not reaching the service".to_string(),
        };
        // The catalogue and the fallback have to agree, or the words differ
        // and the guard cannot help.
        assert_eq!(Copy::default(), english);
        assert!(
            !take_copy(english.clone()),
            "the same words are not a change"
        );
        assert!(!take_copy(english.clone()), "and still are not");

        let french = Copy {
            open: "Ouvrir OpenRadar".to_string(),
            ..english.clone()
        };
        assert!(take_copy(french.clone()), "different words are a change");
        assert!(!take_copy(french), "said twice, they are not");
        *COPY.lock().unwrap_or_else(|held| held.into_inner()) = None;
    }

    #[test]
    fn a_warning_survives_the_icon_being_rebuilt() {
        let _alone = alone();
        // Changing language rebuilds the icon, and a rebuild builds one from
        // whatever it was last told. The workspace only speaks when the alert
        // state changes, so without this a warning standing through a
        // language change left a blue dot saying nothing was happening, which
        // is the opposite of the icon's one job.
        assert_eq!(remember_hazard(true, true), Hazard::Warning);
        assert_eq!(
            *HAZARD.lock().unwrap_or_else(|held| held.into_inner()),
            Hazard::Warning
        );
        // And what a rebuild would draw with.
        assert_eq!(
            icon(*HAZARD.lock().unwrap_or_else(|held| held.into_inner())).rgba(),
            icon(Hazard::Warning).rgba()
        );

        assert_eq!(remember_hazard(false, true), Hazard::Quiet);
        assert_eq!(
            *HAZARD.lock().unwrap_or_else(|held| held.into_inner()),
            Hazard::Quiet
        );
    }

    /// The third thing the icon can be saying.
    ///
    /// The watch polls every forty-five seconds whether or not the map is
    /// looking, and when it stopped reaching the service it wrote one line to
    /// the log and nothing else. The icon stayed blue, which is the icon
    /// saying nothing is happening where the reader watches, which nobody
    /// knew any more.
    #[test]
    fn says_when_the_watch_has_stopped_hearing_back() {
        let _alone = alone();
        assert_eq!(hazard_for(false, false), Hazard::Unreachable);
        assert_eq!(
            tooltip(Hazard::Unreachable),
            Copy::default().unreachable,
            "the words under the icon are the only place this is said"
        );
        assert_ne!(tooltip(Hazard::Unreachable), tooltip(Hazard::Quiet));

        // And it is not a colour. The icon means weather, and an amber dot
        // for "the app is having trouble" would compete with the one thing
        // it exists to say.
        assert_eq!(
            icon(Hazard::Unreachable).rgba(),
            icon(Hazard::Quiet).rgba(),
            "a third colour would compete with the warning"
        );

        // A warning outranks it: a reader whose watch is failing still needs
        // the one it did hear about, and the icon has room for one answer.
        assert_eq!(hazard_for(true, false), Hazard::Warning);
    }

    #[test]
    fn nothing_it_says_carries_a_dash_nobody_types() {
        // The repository's own rule about prose a reader sees. The Rust side
        // is invisible to the i18n coverage test, so it is checked here.
        let words = Copy::default();
        for line in [
            words.open,
            words.glance,
            words.quit,
            words.quiet,
            words.unreachable,
            words.warning,
        ] {
            assert!(!line.contains('—'), "{line}");
            assert!(!line.contains('–'), "{line}");
        }
    }
}

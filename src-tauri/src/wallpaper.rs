//! The current view on the desktop, refreshed on a schedule.
//!
//! The quiet showpiece: a composed radar picture of the reader's own area,
//! behind whatever they are working on. It needs no new data path, because
//! the still export already exists and this is where its bytes go instead of
//! into a file the reader has to look for.
//!
//! Five rules, and the first one is the whole reason this is safe to ship:
//!
//! - **What was there before is written down first, and put back.** The
//!   reader's own wallpaper is read before the first write and restored the
//!   moment the feature is switched off. A feature that takes something away
//!   and cannot give it back is not a feature.
//! - **Nothing is written anywhere else.** One file, in the app's own data
//!   directory, overwritten each time. Not the pictures folder, not the
//!   desktop, not a growing directory of yesterdays.
//! - **A failure is said out loud.** A write that fails answers with why, and
//!   the workspace puts it in front of somebody rather than leaving a stale
//!   picture up and saying nothing.
//! - **Windows only, and it says so.** `IDesktopWallpaper` is a Windows COM
//!   interface; there is no cross-platform way to do this and pretending
//!   otherwise would mean a button that silently does nothing on a Mac.
//! - **The reader's own picture is theirs.** This never reads the wallpaper
//!   for any purpose except putting it back.

use std::path::PathBuf;
use std::sync::Mutex;

/// Where the picture is written. One file, overwritten, in the app's own data.
static TARGET: Mutex<Option<PathBuf>> = Mutex::new(None);

/// What was on the desktop before this feature first wrote anything.
static PREVIOUS: Mutex<Option<String>> = Mutex::new(None);

/// Points the wallpaper writer at a directory. Called once, at startup.
pub fn init(dir: &std::path::Path) {
    if let Err(error) = std::fs::create_dir_all(dir) {
        log::warn!("OpenRadar has nowhere to write a wallpaper: {error}");
        return;
    }
    *TARGET.lock().unwrap_or_else(|held| held.into_inner()) =
        Some(dir.join("wallpaper.png"));
}

fn target() -> Option<PathBuf> {
    TARGET
        .lock()
        .unwrap_or_else(|held| held.into_inner())
        .clone()
}

/// Whether this machine can have its wallpaper set at all.
#[tauri::command]
pub fn wallpaper_available() -> bool {
    cfg!(windows)
}

/// Writes the picture and puts it on the desktop.
///
/// The bytes are the composed still the workspace already draws, so nothing
/// here knows anything about radar: it writes a file and asks the desktop to
/// show it.
#[tauri::command]
pub fn wallpaper_set(bytes: Vec<u8>) -> Result<(), String> {
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Err("a wallpaper has to be a PNG".to_string());
    }
    let Some(path) = target() else {
        return Err("OpenRadar has nowhere to write a wallpaper".to_string());
    };

    // Read what is there before the first write, and only before the first:
    // reading it again after this feature has written one would record our
    // own picture as the thing to go back to.
    remember_previous();

    std::fs::write(&path, &bytes).map_err(|error| error.to_string())?;
    apply(&path.to_string_lossy())
}

/// Puts back whatever was on the desktop before.
#[tauri::command]
pub fn wallpaper_restore() -> Result<(), String> {
    let held = PREVIOUS
        .lock()
        .unwrap_or_else(|held| held.into_inner())
        .clone();
    let Some(was) = held else {
        // Nothing was ever taken away, so there is nothing to give back.
        return Ok(());
    };
    apply(&was)?;
    *PREVIOUS.lock().unwrap_or_else(|held| held.into_inner()) = None;
    Ok(())
}

fn remember_previous() {
    let mut held = PREVIOUS.lock().unwrap_or_else(|held| held.into_inner());
    if held.is_some() {
        return;
    }
    *held = current().ok().flatten();
}

#[cfg(windows)]
fn current() -> Result<Option<String>, String> {
    // The registry rather than COM for the read. `IDesktopWallpaper` answers
    // per monitor and this only has to put one thing back; the value under
    // `Control Panel\Desktop` is what the shell itself restores from.
    let output = std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Control Panel\Desktop",
            "/v",
            "Wallpaper",
        ])
        .output()
        .map_err(|error| error.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout);
    let value = text
        .lines()
        .find_map(|line| line.split("REG_SZ").nth(1))
        .map(|rest| rest.trim().to_string())
        .filter(|rest| !rest.is_empty());
    Ok(value)
}

#[cfg(not(windows))]
fn current() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(windows)]
fn apply(path: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    // SystemParametersInfoW with SPI_SETDESKWALLPAPER. Per-monitor wallpapers
    // want `IDesktopWallpaper`, which is COM and needs an apartment; this sets
    // every monitor to the same picture, which is what one radar view of one
    // area actually is.
    const SPI_SETDESKWALLPAPER: u32 = 0x0014;
    const SPIF_UPDATEINIFILE: u32 = 0x01;
    const SPIF_SENDCHANGE: u32 = 0x02;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn SystemParametersInfoW(
            action: u32,
            param: u32,
            data: *mut core::ffi::c_void,
            winini: u32,
        ) -> i32;
    }

    let wide: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: the pointer is to a null-terminated wide string that outlives
    // the call, and the action takes exactly that.
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            wide.as_ptr() as *mut core::ffi::c_void,
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
    };
    if ok == 0 {
        return Err("Windows refused the wallpaper".to_string());
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply(_path: &str) -> Result<(), String> {
    Err("setting the wallpaper is a Windows thing for now".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_that_is_not_one_is_refused() {
        // This ends up as the desktop background of somebody's machine, so
        // the format is checked rather than trusted.
        let answer = wallpaper_set(b"<svg onload=alert(1)>".to_vec());
        assert!(answer.is_err());
    }

    #[test]
    fn it_says_where_it_works() {
        // A button that silently does nothing on a Mac is worse than one that
        // is not there, so the workspace asks first.
        assert_eq!(wallpaper_available(), cfg!(windows));
    }

    #[test]
    fn putting_it_back_with_nothing_taken_away_is_not_a_failure() {
        *PREVIOUS.lock().unwrap_or_else(|held| held.into_inner()) = None;
        assert!(wallpaper_restore().is_ok());
    }
}

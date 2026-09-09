//! The settings file's last good copy, and what to do when the live one rots.
//!
//! Everything a reader sets up lives in one file: the places they watch, the
//! colour tables they loaded, the packs they downloaded, the presets they
//! built. The store reads that file as a whole, so a single bad byte anywhere
//! in it loses all of it at once, and what the workspace did about that was
//! open on the defaults and say nothing. The next thing that changed a
//! setting then wrote the defaults over the file, and the reader's afternoon
//! of setting up was gone with no way back.
//!
//! Three files, then. The live one the store reads and writes; a copy taken
//! before each write, which is the state the reader had before whatever went
//! wrong; and the unreadable one kept under a name of its own rather than
//! deleted, because a reader who hand-edited it wants to see what they did.
//!
//! The recovery runs in the setup hook, before the webview asks for anything,
//! so the store finds a file it can read and never learns any of this
//! happened. What the workspace does learn is that it happened at all, which
//! is what the toast is for: a restore nobody is told about is a reader
//! wondering why one of their places went back to where it was yesterday.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

/// What the store reads. Named by the store plugin, not by us.
const LIVE: &str = "settings.json";

/// The copy taken before each write.
const PREVIOUS: &str = "settings.previous.json";

/// Where a file that would not parse is kept.
const KEPT: &str = "settings.unreadable.json";

/// Where the three files live. The app's own data directory.
static DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// What happened at startup, for the workspace to say out loud.
static RECOVERED: Mutex<Option<Recovery>> = Mutex::new(None);

/// A settings file that would not parse, and what was done about it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    /// Where the unreadable file was kept, so a reader can go and look.
    pub kept_at: String,
    /// Whether the copy went back in its place, or the workspace is opening
    /// on the defaults because there was no copy to go back to.
    pub restored: bool,
}

/// Points the backup at a directory and recovers the live file if it needs
/// it. Called once, at startup, before the webview loads the store.
pub fn init(dir: &Path) {
    if let Err(error) = std::fs::create_dir_all(dir) {
        log::warn!("OpenRadar cannot reach its settings directory: {error}");
        return;
    }
    *DIR.lock().unwrap_or_else(|held| held.into_inner()) = Some(dir.to_path_buf());
    *RECOVERED.lock().unwrap_or_else(|held| held.into_inner()) = recover(dir);
}

/// Whether a file holds a settings document rather than rubbish.
///
/// The whole object, not a prefix: a file truncated by a power cut parses as
/// far as it goes and then does not, which is exactly the case this exists
/// for. A JSON array or a bare number is a file that loads and then has
/// nothing in it, so the top level has to be an object as well.
fn readable(path: &Path) -> bool {
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    matches!(
        serde_json::from_slice::<serde_json::Value>(&bytes),
        Ok(serde_json::Value::Object(_))
    )
}

/// Puts a readable settings file back in place, if the live one is not.
///
/// Answers with what it did, or `None` when there was nothing to do, which is
/// every ordinary start.
fn recover(dir: &Path) -> Option<Recovery> {
    let live = dir.join(LIVE);
    // Nothing stored yet is a first run, not a loss.
    if !live.exists() || readable(&live) {
        return None;
    }
    let kept = dir.join(KEPT);
    // Kept, not deleted. A reader who edited the file by hand wants to see
    // what they wrote, and a reader who did not wants to send it to somebody.
    if let Err(error) = std::fs::rename(&live, &kept) {
        log::warn!("OpenRadar could not keep the unreadable settings file: {error}");
        // Removed instead, because leaving it is worse: the store fails to
        // load it on every start from here on and the reader is stuck on the
        // defaults for good, with every save failing behind them.
        if let Err(error) = std::fs::remove_file(&live) {
            // Neither moved nor removed, which on Windows is a file something
            // else has open. Said anyway rather than passing in silence: the
            // store will fall to its defaults, the copy beside it is still
            // good, and a reader who is told can close whatever is holding it
            // and start again. Returning nothing here left them on the
            // defaults with no notice, which is the silence this module was
            // written to remove.
            log::warn!("OpenRadar could not move the unreadable settings file: {error}");
            return Some(Recovery {
                kept_at: live.display().to_string(),
                restored: false,
            });
        }
    }
    let previous = dir.join(PREVIOUS);
    let restored = readable(&previous) && std::fs::copy(&previous, &live).is_ok();
    log::warn!(
        "OpenRadar could not read its settings file; kept at {} and {}",
        kept.display(),
        if restored {
            "put the last good copy back"
        } else {
            "opened on the defaults"
        }
    );
    Some(Recovery {
        kept_at: kept.display().to_string(),
        restored,
    })
}

/// Takes the copy. Answers with whether there is now one to go back to.
fn keep(dir: &Path) -> bool {
    let live = dir.join(LIVE);
    // Only a file that parses is worth copying forward. Without this the
    // first write after a corruption would put the bad file over the good
    // copy and there would be nothing left to restore.
    if !readable(&live) {
        return false;
    }
    match std::fs::copy(&live, dir.join(PREVIOUS)) {
        Ok(_) => true,
        Err(error) => {
            log::warn!("OpenRadar could not copy its settings file: {error}");
            false
        }
    }
}

fn dir() -> Option<PathBuf> {
    DIR.lock().unwrap_or_else(|held| held.into_inner()).clone()
}

/// The workspace saying it is about to write the settings file.
#[tauri::command]
pub fn settings_keep_previous() -> bool {
    dir().map(|dir| keep(&dir)).unwrap_or(false)
}

/// The workspace asking whether anything was recovered at startup.
#[tauri::command]
pub fn settings_recovered() -> Option<Recovery> {
    RECOVERED
        .lock()
        .unwrap_or_else(|held| held.into_inner())
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("openradar-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a scratch directory");
        dir
    }

    /// A settings file with one thing in it worth losing.
    fn good(dir: &Path, place: &str) {
        std::fs::write(
            dir.join(LIVE),
            format!("{{\"settings\":{{\"schemaVersion\":1,\"places\":[\"{place}\"]}}}}"),
        )
        .expect("a settings file");
    }

    #[test]
    fn an_ordinary_start_does_nothing() {
        let dir = scratch("ordinary");
        good(&dir, "Casa");
        assert_eq!(recover(&dir), None);
        assert!(!dir.join(KEPT).exists());
    }

    #[test]
    fn a_first_run_is_not_a_loss() {
        let dir = scratch("first");
        assert_eq!(recover(&dir), None);
        assert!(!dir.join(LIVE).exists());
    }

    #[test]
    fn the_copy_goes_back_and_the_bad_file_is_kept() {
        let dir = scratch("restore");
        good(&dir, "Casa");
        assert!(keep(&dir), "the copy was not taken");
        // A power cut mid-write, which is what a torn file is.
        std::fs::write(dir.join(LIVE), "{\"settings\":{\"schemaVer").expect("a torn file");

        let recovery = recover(&dir).expect("a recovery");
        assert!(recovery.restored);
        let back = std::fs::read_to_string(dir.join(LIVE)).expect("the settings");
        assert!(back.contains("Casa"), "{back}");
        let kept = std::fs::read_to_string(dir.join(KEPT)).expect("the unreadable file");
        assert_eq!(kept, "{\"settings\":{\"schemaVer");
    }

    #[test]
    fn a_bad_file_is_never_copied_forward() {
        // The write path runs on every settings change, including the first
        // one after a corruption. Copying that file forward would destroy the
        // only good copy there is.
        let dir = scratch("poison");
        good(&dir, "Casa");
        assert!(keep(&dir));
        std::fs::write(dir.join(LIVE), "not json at all").expect("a bad file");
        assert!(!keep(&dir), "an unreadable file was copied forward");
        let copy = std::fs::read_to_string(dir.join(PREVIOUS)).expect("the copy");
        assert!(copy.contains("Casa"), "{copy}");
    }

    #[test]
    fn a_file_that_parses_to_a_list_is_not_settings() {
        // `serde_json` reads `[]` and `3` happily. Either one loads into a
        // store with nothing in it, which is the loss this is here to stop.
        let dir = scratch("shape");
        std::fs::write(dir.join(LIVE), "[]").expect("a list");
        assert!(recover(&dir).is_some());
    }

    #[test]
    fn with_no_copy_it_still_gets_the_bad_file_out_of_the_way() {
        // Otherwise the store fails to load on every start from here on and
        // the reader is left on the defaults for good, with no way to save.
        let dir = scratch("nocopy");
        std::fs::write(dir.join(LIVE), "{oh dear").expect("a bad file");
        let recovery = recover(&dir).expect("a recovery");
        assert!(!recovery.restored);
        assert!(!dir.join(LIVE).exists());
        assert!(dir.join(KEPT).exists());
    }
}

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
//! The recovery runs when the workspace asks what happened, which it does
//! before it opens the store, so the store finds a file it can read and never
//! learns any of this happened. Asked for rather than done in the setup hook:
//! Tauri builds the configured windows first and calls the setup closure
//! after, so a recovery there is ahead of the store's own read only because
//! the frontend's first message arrives on a later turn of the event loop.
//! That was true and nothing made it true. Here the order is the order the
//! caller writes.
//!
//! What the workspace does learn is that it happened at all, which is what
//! the toast is for: a restore nobody is told about is a reader wondering why
//! one of their places went back to where it was yesterday.

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
    /// Whether the unreadable file is still in place.
    ///
    /// True means it could be neither renamed nor removed, because something
    /// else has it open. Worth telling the reader apart from the rest: it is
    /// the one case where every launch from here on ends the same way until
    /// they do something about it, and the one where a good copy is sitting
    /// beside it unused.
    pub stuck: bool,
}

/// Points the backup at a directory. Called once, at startup.
pub fn init(dir: &Path) {
    if let Err(error) = std::fs::create_dir_all(dir) {
        log::warn!("OpenRadar cannot reach its settings directory: {error}");
        return;
    }
    *DIR.lock().unwrap_or_else(|held| held.into_inner()) = Some(dir.to_path_buf());
}

/// Whether the recovery has been run for this launch.
///
/// Once, however many times it is asked for: the second window to open must
/// not file the file the first one just restored away as unreadable.
static ASKED: Mutex<bool> = Mutex::new(false);

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
    let Ok(serde_json::Value::Object(document)) =
        serde_json::from_slice::<serde_json::Value>(&bytes)
    else {
        return false;
    };
    // And it has to hold what the store keeps. An object on its own is too
    // weak: an empty one passes, loads as a workspace with nothing in it, and
    // the next save would copy it forward as the last good copy, destroying
    // the real one.
    document.contains_key("settings")
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
                stuck: true,
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
        stuck: false,
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

/// The workspace asking what it will find when it opens the store.
///
/// Runs the recovery on the first call, which is what puts it ahead of the
/// store's own read: the caller asks this and then opens the store, in that
/// order, in one place.
#[tauri::command]
pub fn settings_recovered() -> Option<Recovery> {
    let mut asked = ASKED.lock().unwrap_or_else(|held| held.into_inner());
    if !*asked {
        // Latched only once there is somewhere to look. Set before the check,
        // a question that arrived before `init` had a directory, or after it
        // failed to make one, would mark the recovery as done and it would
        // never be tried again for the life of the process.
        if let Some(dir) = dir() {
            *asked = true;
            *RECOVERED.lock().unwrap_or_else(|held| held.into_inner()) = recover(&dir);
        }
    }
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
    fn the_recovery_runs_once_however_often_it_is_asked() {
        // A second window asking must not file the file the first one just
        // put back away as unreadable.
        let dir = scratch("once");
        *DIR.lock().unwrap() = Some(dir.clone());
        *ASKED.lock().unwrap() = false;
        *RECOVERED.lock().unwrap() = None;
        good(&dir, "Casa");
        assert!(keep(&dir));
        std::fs::write(dir.join(LIVE), "{oh dear").expect("a torn file");

        let first = settings_recovered().expect("a recovery");
        assert!(first.restored);
        let again = settings_recovered().expect("the same answer");
        assert_eq!(again, first);
        // And the file that was put back is still the one in place.
        let live = std::fs::read_to_string(dir.join(LIVE)).expect("the settings");
        assert!(live.contains("Casa"), "{live}");
        assert!(
            !dir.join(KEPT).exists()
                || std::fs::read_to_string(dir.join(KEPT)).unwrap() == "{oh dear"
        );
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
        assert!(!recovery.stuck);
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
    #[cfg(windows)]
    fn a_file_that_cannot_be_moved_says_so() {
        // The one case where every launch from here on ends the same way
        // until the reader closes whatever has the file open, and the one
        // where the copy beside it is still good. Told apart from the rest,
        // because the sentence for the rest is wrong about both halves here.
        let dir = scratch("locked");
        good(&dir, "Casa");
        assert!(keep(&dir));
        std::fs::write(dir.join(LIVE), "{oh dear").expect("a torn file");
        // Held open, which on Windows refuses both the rename and the
        // removal. That is the real shape of this: a backup tool, an editor
        // or a virus scanner with the file open at the moment of the launch.
        use std::os::windows::fs::OpenOptionsExt;
        let held = std::fs::OpenOptions::new()
            .read(true)
            // Shared with nobody, which is how a backup tool or a scanner
            // holds a file it is reading. Windows then refuses both the
            // rename and the removal, which is the case being described.
            .share_mode(0)
            .open(dir.join(LIVE))
            .expect("the torn file");
        // A directory in the way of the name it would be renamed to, so the
        // rename fails on any platform that would have allowed it.
        std::fs::create_dir_all(dir.join(KEPT)).expect("something in the way");

        let recovery = recover(&dir).expect("a recovery");
        assert!(recovery.stuck);
        assert!(!recovery.restored);
        // And the file is still there, which is what makes it the same story
        // on every launch.
        assert!(dir.join(LIVE).exists());
        drop(held);
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
    fn an_object_with_nothing_of_ours_in_it_is_not_settings() {
        // The narrower shape. An empty object parses, loads as a workspace
        // with nothing in it, and would then be copied forward as the last
        // good one, which destroys the copy that could have put the reader
        // back. Same for a file of somebody else's that landed on the name.
        let dir = scratch("empty");
        std::fs::write(dir.join(LIVE), "{}").expect("an empty object");
        assert!(recover(&dir).is_some());
        assert!(!readable(&dir.join(KEPT)));
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

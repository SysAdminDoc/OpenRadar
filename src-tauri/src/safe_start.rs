//! Whether the last launch finished, and how many did not in a row.
//!
//! Something the reader imported can take the window down before there is a
//! window: a colour table applied to a product, a theme file given tokens by
//! hand, a camera the projection cannot show. The remedy the app has is the
//! crash screen's Reset layout, and a page that dies before it renders never
//! shows the crash screen, so the one way out is the one way that is shut.
//!
//! A file written at startup and removed on a clean exit answers the
//! question. Finding it at the next startup means the last run did not
//! finish; the number in it is how many have not finished in a row. Two is
//! the threshold, because one is a power cut, a killed process or a reader
//! who closed the laptop, and standing the workspace down for that would be
//! its own annoyance.
//!
//! Nothing here decides what "plain" means. That is the workspace's business,
//! and it is written where the settings are, next to the values it turns off.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The file that exists while the app is running.
const SENTINEL: &str = "running.txt";

/// Where it lives, so the exit can find it again.
static PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// How many launches in a row did not finish, this one included.
static STARTS: Mutex<u32> = Mutex::new(0);

/// Reads the sentinel, counts, and writes it back. Called once, at startup.
pub fn init(dir: &Path) {
    if let Err(error) = std::fs::create_dir_all(dir) {
        log::warn!("OpenRadar cannot reach its data directory: {error}");
        return;
    }
    let path = dir.join(SENTINEL);
    let unclean = count(&path);
    if let Err(error) = std::fs::write(&path, unclean.to_string()) {
        // Not fatal. Without the file every start looks clean, which is the
        // behaviour this whole module replaced, so the app runs on.
        log::warn!("OpenRadar could not mark itself as running: {error}");
    }
    *PATH.lock().unwrap_or_else(|held| held.into_inner()) = Some(path);
    *STARTS.lock().unwrap_or_else(|held| held.into_inner()) = unclean;
    if unclean > 0 {
        log::warn!("OpenRadar did not finish its last {unclean} start(s)");
    }
}

/// How many starts in a row have not finished, given the sentinel on disk.
///
/// The file being absent is the ordinary case and means the last run exited
/// cleanly. A file with rubbish in it counts as one: the run it belongs to
/// still did not finish, and refusing to count it would let a damaged
/// sentinel switch the protection off for good.
fn count(path: &Path) -> u32 {
    match std::fs::read_to_string(path) {
        Err(_) => 0,
        Ok(text) => text.trim().parse::<u32>().unwrap_or(0).saturating_add(1),
    }
}

/// The app closing in the ordinary way. Called from the one place every
/// graceful exit passes through.
pub fn clean_exit() {
    let path = PATH.lock().unwrap_or_else(|held| held.into_inner()).clone();
    let Some(path) = path else {
        return;
    };
    if let Err(error) = std::fs::remove_file(&path) {
        log::warn!("OpenRadar could not clear its running mark: {error}");
    }
}

/// The workspace asking how many starts in a row did not finish.
#[tauri::command]
pub fn unclean_starts() -> u32 {
    *STARTS.lock().unwrap_or_else(|held| held.into_inner())
}

/// The workspace saying the reader has put their arrangement back.
///
/// The count goes to nothing rather than the file going away: the app is
/// still running, and removing the sentinel here would make this run look
/// like one that had already finished.
#[tauri::command]
pub fn clear_unclean_starts() {
    *STARTS.lock().unwrap_or_else(|held| held.into_inner()) = 0;
    let path = PATH.lock().unwrap_or_else(|held| held.into_inner()).clone();
    if let Some(path) = path {
        if let Err(error) = std::fs::write(&path, "0") {
            log::warn!("OpenRadar could not clear its unclean count: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("openradar-safestart-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a scratch directory");
        dir
    }

    #[test]
    fn a_clean_exit_leaves_nothing_behind() {
        let dir = scratch("clean");
        assert_eq!(count(&dir.join(SENTINEL)), 0);
    }

    #[test]
    fn one_start_that_did_not_finish_counts_one() {
        // And one is not two: a power cut, a killed process or a closed
        // laptop is exactly this, and standing the workspace down for it
        // would be its own annoyance.
        let dir = scratch("one");
        std::fs::write(dir.join(SENTINEL), "0").expect("a sentinel");
        assert_eq!(count(&dir.join(SENTINEL)), 1);
    }

    #[test]
    fn two_in_a_row_count_two() {
        let dir = scratch("two");
        std::fs::write(dir.join(SENTINEL), "1").expect("a sentinel");
        assert_eq!(count(&dir.join(SENTINEL)), 2);
    }

    #[test]
    fn a_damaged_sentinel_still_counts_as_one() {
        // Otherwise a single unreadable byte in it switches the protection
        // off for as long as the file stays that way.
        let dir = scratch("damaged");
        std::fs::write(dir.join(SENTINEL), "oh dear").expect("a sentinel");
        assert_eq!(count(&dir.join(SENTINEL)), 1);
    }

    #[test]
    fn the_count_does_not_wrap() {
        let dir = scratch("ceiling");
        std::fs::write(dir.join(SENTINEL), u32::MAX.to_string()).expect("a sentinel");
        assert_eq!(count(&dir.join(SENTINEL)), u32::MAX);
    }
}

//! Whether the last launch got as far as a window, and how many did not.
//!
//! Something the reader imported can take the window down before there is a
//! window: a colour table applied to a product, a theme file given tokens by
//! hand, a camera the projection cannot show. The remedy the app has is the
//! crash screen's Reset layout, and a page that dies before it renders never
//! shows the crash screen, so the one way out is the one way that is shut.
//!
//! A file written at startup and removed the moment the workspace says it is
//! up answers the question. Finding it at the next startup means the last run
//! never got that far; the number in it is how many have not, in a row. Two
//! is the threshold, because one is a power cut or a laptop lid closed at the
//! wrong moment, and standing the workspace down for that would be its own
//! annoyance.
//!
//! Cleared on the workspace drawing rather than on a clean exit, which is the
//! difference between counting the failure this is about and counting every
//! way a process can stop. This app closes to the tray and is meant to be
//! left open for days, so it is normally still running when Windows restarts:
//! counted on the exit, two restarts in a row would have stood the workspace
//! down for a reader whose arrangement was never the problem. A crash an hour
//! into an afternoon is also not this, and it is not counted either.
//!
//! The clean exit still clears it, for the reader who quits during a slow
//! start: a window they closed themselves is not a window that would not
//! draw.
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

/// The workspace saying it has drawn.
///
/// The mark goes at once. From here on this launch counts as one that reached
/// a window, whatever happens to the process afterwards. The workspace says
/// this once the map has painted rather than once its settings have parsed:
/// the theme, the colour table a product is drawn with and the camera the
/// projection has to show are all applied after that, and they are three of
/// the things this exists to catch.
#[tauri::command]
pub fn workspace_drawn() {
    clean_exit();
}

/// The app closing in the ordinary way, or the workspace reporting that it
/// drew. Either one means this launch is not the failure being counted.
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
/// The mark goes with the count. This is asked for by a reader pressing a
/// button in a window that has drawn, so the launch already stopped counting
/// when it drew; writing a zero back instead put the mark on a run that had
/// finished with it, and the next crash was then the first of two rather than
/// the second.
#[tauri::command]
pub fn clear_unclean_starts() {
    *STARTS.lock().unwrap_or_else(|held| held.into_inner()) = 0;
    // The mark goes rather than being written back as a zero. This is asked
    // for by a reader pressing a button in a window that has drawn, so the
    // launch is already one that got there; writing a zero put the mark back
    // and made the next crash the first of two rather than the second.
    clean_exit();
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
    fn the_whole_round_trip() {
        // The helper above is arithmetic; this is the part that writes the
        // file the next start reads, through the same globals the commands
        // use. Nothing else in the crate touches them.
        let dir = scratch("roundtrip");
        init(&dir);
        assert_eq!(unclean_starts(), 0);
        assert!(dir.join(SENTINEL).exists(), "nothing marked this run");

        // A start that never got as far as a window: the mark is still there.
        init(&dir);
        assert_eq!(unclean_starts(), 1);
        init(&dir);
        assert_eq!(unclean_starts(), 2);

        // The workspace drawing clears it, so the next start is clean.
        workspace_drawn();
        assert!(!dir.join(SENTINEL).exists());
        init(&dir);
        assert_eq!(unclean_starts(), 0);

        // And the reader putting their arrangement back starts the count
        // again. The window they pressed the button in is one that drew, so
        // the mark goes with the count: written back as a zero instead, the
        // next start read it as a run that had not finished and one crash
        // stood the workspace down where it should have taken two.
        init(&dir);
        assert_eq!(unclean_starts(), 1);
        clear_unclean_starts();
        assert_eq!(unclean_starts(), 0);
        assert!(!dir.join(SENTINEL).exists());
        init(&dir);
        assert_eq!(unclean_starts(), 0);
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

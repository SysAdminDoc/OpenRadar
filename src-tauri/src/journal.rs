//! A bounded local record of what the weather did at the reader's own places.
//!
//! This is the one file in the project that writes down where somebody lives,
//! so the rules are the point and the storage is an afterthought:
//!
//! - **Only named places.** A coordinate the reader never called anything is
//!   not a place they have claimed, and nothing is written for it.
//! - **Only the weather.** Every row is an observation or an event with a
//!   source, the time it was observed, and how it was obtained. Nothing is
//!   ever written about how the app was used: no panel opened, no command
//!   run, no launch, no session.
//! - **Bounded twice.** A stated retention period and a hard byte ceiling,
//!   with the oldest going first, so it cannot grow into a life history.
//! - **Plain.** One JSON object per line, readable in any editor, exported as
//!   itself, and deleted in one action.
//! - **Local.** It never leaves the machine, it is never fetched, and it is
//!   not in the diagnostics report. `diagnostics.rs` builds that block from a
//!   fixed list and this is not on it.
//!
//! A line that will not parse is skipped and the good rows around it are
//! kept. A file that has been half-written by a crash loses its last line and
//! nothing else, which is the reason the format is one row per line rather
//! than one array.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

/// How long a row is kept. Stated here because the note in the panel says it.
pub const RETENTION_DAYS: i64 = 400;

/// The most the file may weigh, whatever the retention period allows.
///
/// Four hundred days of one place's weather is a few hundred kilobytes; this
/// is the ceiling for somebody watching ten places through a bad year, and it
/// is enforced by dropping the oldest rows rather than by refusing new ones.
pub const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// The longest any single field may be, so one row cannot fill the file.
const MAX_FIELD: usize = 240;

/// What a row is: the weather, and how it came to be written down.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JournalRow {
    /// When the row was written, which is not when the weather happened.
    pub at: String,
    /// The reader's own name for the place. Never a coordinate.
    pub place: String,
    /// `alert` for a warning that reached the place, `observation` otherwise.
    pub kind: String,
    /// Who said it: a station, an office, a service.
    pub source: String,
    /// When the thing being recorded was observed or issued.
    pub observed: String,
    /// How it was obtained, in the reader's own words rather than a URL.
    pub obtained: String,
    /// What was recorded, as one short line.
    pub text: String,
}

struct State {
    path: PathBuf,
}

static STATE: OnceLock<Mutex<Option<State>>> = OnceLock::new();

fn state() -> &'static Mutex<Option<State>> {
    STATE.get_or_init(|| Mutex::new(None))
}

/// Points the journal at a directory. Called once, at startup.
pub fn init(dir: &Path) {
    let path = dir.join("journal.jsonl");
    if let Err(error) = fs::create_dir_all(dir) {
        log::warn!("OpenRadar has nowhere to keep its journal: {error}");
        return;
    }
    *state().lock().expect("journal state") = Some(State { path });
}

fn path() -> Option<PathBuf> {
    state()
        .lock()
        .expect("journal state")
        .as_ref()
        .map(|held| held.path.clone())
}

fn trimmed(value: &str) -> String {
    let mut out: String = value
        .chars()
        // A newline would make one row into two, and a control character in a
        // file somebody is going to open in an editor is nobody's friend.
        .map(|one| if one.is_control() { ' ' } else { one })
        .collect();
    out = out.trim().to_string();
    if out.chars().count() > MAX_FIELD {
        out = out.chars().take(MAX_FIELD).collect();
    }
    out
}

fn tidy(row: &JournalRow) -> JournalRow {
    JournalRow {
        at: trimmed(&row.at),
        place: trimmed(&row.place),
        kind: trimmed(&row.kind),
        source: trimmed(&row.source),
        observed: trimmed(&row.observed),
        obtained: trimmed(&row.obtained),
        text: trimmed(&row.text),
    }
}

/// Every row in the file, oldest first, with anything unreadable left out.
pub fn read_rows() -> Vec<JournalRow> {
    let Some(path) = path() else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    text.lines()
        .filter(|line| !line.trim().is_empty())
        // A line that will not parse is one row lost, not a file lost. A
        // crash mid-write leaves exactly one of these, at the end.
        .filter_map(|line| serde_json::from_str::<JournalRow>(line).ok())
        .collect()
}

fn write_rows(path: &Path, rows: &[JournalRow]) -> std::io::Result<()> {
    // Written beside and renamed into place, so a crash cannot leave a file
    // that is half of two versions.
    let temporary = path.with_extension("jsonl.writing");
    {
        let mut file = fs::File::create(&temporary)?;
        for row in rows {
            let line = serde_json::to_string(row).unwrap_or_default();
            if line.is_empty() {
                continue;
            }
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;
    }
    fs::rename(&temporary, path)
}

/// Drops what is past the retention period, then what is past the ceiling.
fn bounded(mut rows: Vec<JournalRow>, now: DateTime<Utc>) -> Vec<JournalRow> {
    let cutoff = now - Duration::days(RETENTION_DAYS);
    rows.retain(|row| match DateTime::parse_from_rfc3339(&row.at) {
        // A row with no readable time cannot be aged, and a row that cannot
        // age is a row that would live for ever.
        Err(_) => false,
        Ok(at) => at.with_timezone(&Utc) >= cutoff,
    });
    let mut total: u64 = rows
        .iter()
        .map(|row| serde_json::to_string(row).unwrap_or_default().len() as u64 + 1)
        .sum();
    let mut from = 0;
    while total > MAX_BYTES && from < rows.len() {
        total -= serde_json::to_string(&rows[from]).unwrap_or_default().len() as u64 + 1;
        from += 1;
    }
    rows.split_off(from)
}

/// Adds one row, then holds the file to its bounds.
#[tauri::command]
pub fn journal_append(row: JournalRow) -> Result<usize, String> {
    let Some(path) = path() else {
        return Ok(0);
    };
    let mut rows = read_rows();
    rows.push(tidy(&row));
    let kept = bounded(rows, Utc::now());
    write_rows(&path, &kept).map_err(|error| error.to_string())?;
    Ok(kept.len())
}

/// Everything the file holds, for the reader to look at or export.
#[tauri::command]
pub fn journal_rows() -> Vec<JournalRow> {
    read_rows()
}

/// Removes the whole file, in one action, with nothing kept back.
#[tauri::command]
pub fn journal_clear() -> Result<(), String> {
    let Some(path) = path() else {
        return Ok(());
    };
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Where the file is, so the panel can say it and a reader can open it.
#[tauri::command]
pub fn journal_path() -> Option<String> {
    path().map(|held| held.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;

    /// One test at a time: the journal is one file behind a global.
    static LOCK: Mutex<()> = Mutex::new(());

    fn journal_test(dir: &Path) -> MutexGuard<'static, ()> {
        let guard = LOCK.lock().unwrap_or_else(|held| held.into_inner());
        init(dir);
        let _ = journal_clear();
        guard
    }

    fn row(at: &str, place: &str, text: &str) -> JournalRow {
        JournalRow {
            at: at.to_string(),
            place: place.to_string(),
            kind: "observation".to_string(),
            source: "KDAL".to_string(),
            observed: at.to_string(),
            obtained: "read from the station's own report".to_string(),
            text: text.to_string(),
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openradar-journal-{name}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_row_goes_in_and_comes_back_out() {
        let dir = scratch("round-trip");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        journal_append(row(&now, "Casa", "rain")).expect("written");
        let rows = journal_rows();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].place, "Casa");
        assert_eq!(rows[0].text, "rain");
        assert_eq!(rows[0].obtained, "read from the station's own report");
    }

    #[test]
    fn one_unreadable_line_does_not_lose_the_rest() {
        let dir = scratch("corrupt");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        journal_append(row(&now, "Casa", "first")).expect("written");
        journal_append(row(&now, "Casa", "second")).expect("written");
        // A crash mid-write leaves exactly this: a last line that is half a
        // row. The good rows above it are still good.
        let file = path().expect("a path");
        let mut text = fs::read_to_string(&file).expect("readable");
        text.push_str("{\"at\":\"2026-09-0");
        fs::write(&file, text).expect("written");
        let rows = journal_rows();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].text, "second");
    }

    #[test]
    fn nothing_survives_the_retention_period() {
        let dir = scratch("retention");
        let _guard = journal_test(&dir);
        let old = (Utc::now() - Duration::days(RETENTION_DAYS + 1)).to_rfc3339();
        let fresh = Utc::now().to_rfc3339();
        journal_append(row(&old, "Casa", "last year")).expect("written");
        journal_append(row(&fresh, "Casa", "today")).expect("written");
        let rows = journal_rows();
        assert_eq!(rows.len(), 1, "{rows:?}");
        assert_eq!(rows[0].text, "today");
    }

    #[test]
    fn the_ceiling_drops_the_oldest_first() {
        let now = Utc::now();
        let rows: Vec<JournalRow> = (0..50_000)
            .map(|index| {
                row(
                    &(now - Duration::seconds(50_000 - index)).to_rfc3339(),
                    "Casa",
                    &format!("row {index}"),
                )
            })
            .collect();
        let kept = bounded(rows, now);
        let weight: u64 = kept
            .iter()
            .map(|row| serde_json::to_string(row).unwrap_or_default().len() as u64 + 1)
            .sum();
        assert!(weight <= MAX_BYTES, "{weight} bytes");
        assert!(!kept.is_empty());
        // The oldest go first, so what is left is the recent end of the run.
        assert_eq!(kept.last().expect("a row").text, "row 49999");
        assert_ne!(kept.first().expect("a row").text, "row 0");
    }

    #[test]
    fn a_row_cannot_carry_a_newline_or_a_novel() {
        let dir = scratch("tidy");
        let _guard = journal_test(&dir);
        let mut awkward = row(&Utc::now().to_rfc3339(), "Casa", "a\nb");
        awkward.source = "x".repeat(1000);
        journal_append(awkward).expect("written");
        let rows = journal_rows();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "a b");
        assert_eq!(rows[0].source.chars().count(), MAX_FIELD);
    }

    #[test]
    fn clearing_it_leaves_nothing_at_all() {
        let dir = scratch("clear");
        let _guard = journal_test(&dir);
        journal_append(row(&Utc::now().to_rfc3339(), "Casa", "rain")).expect("written");
        journal_clear().expect("cleared");
        assert!(journal_rows().is_empty());
        // And clearing an empty journal is not an error.
        journal_clear().expect("cleared again");
    }
}

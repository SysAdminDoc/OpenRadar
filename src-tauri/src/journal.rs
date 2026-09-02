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
//!   not in the diagnostics report. That block is built on the frontend, in
//!   `src/lib/diagnostics.ts`, from a fixed list of inputs; nothing here is
//!   on it, and `src/lib/journal.test.ts` holds that by handing the builder a
//!   log line naming a place and asserting the name does not come out.
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

/// Held across a whole read-modify-write.
///
/// An append reads the file, adds a row, bounds it and writes it back. Two of
/// those interleaved lose rows, and eight of them lose most of them. Tauri
/// happens to run synchronous commands inline today, which is not a guarantee
/// worth resting a reader's own record on.
static WRITING: Mutex<()> = Mutex::new(());

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

/// Whether a row is one at all.
///
/// Every row carries a place, a source and a time the thing was observed, or
/// it is not a record of anything. A row with a date nothing can read is the
/// worst of them: it can never be aged out, so it would live for ever.
fn worth_keeping(row: &JournalRow) -> bool {
    !row.place.is_empty()
        && !row.source.is_empty()
        && !row.text.is_empty()
        && DateTime::parse_from_rfc3339(&row.at).is_ok()
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
        // A row already on the disk that this cannot date is still the
        // reader's. It is kept, and the ceiling below takes it first, because
        // deleting somebody's record to tidy the file is the one thing this
        // must never do. Nothing new can arrive in that state: `worth_keeping`
        // refuses a row whose date is not one.
        Err(_) => true,
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
///
/// Async, and the work is on a blocking thread: an append reads and rewrites
/// the whole file, which on a full one is a tenth of a second, and a warning
/// reaching ten named places is ten of those. On the IPC thread that is a
/// second of frozen window at the exact moment warnings are being announced.
#[tauri::command]
pub async fn journal_append(row: JournalRow) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || append_row(row))
        .await
        .map_err(|error| error.to_string())?
}

fn append_row(row: JournalRow) -> Result<usize, String> {
    let Some(path) = path() else {
        return Ok(0);
    };
    let row = tidy(&row);
    // Refused rather than dropped in silence. A caller that hands over a row
    // with no source, or a date nothing can read, has a bug worth hearing
    // about; the old code answered `Ok(0)` and wrote nothing.
    if !worth_keeping(&row) {
        return Err(format!(
            "a journal row needs a place, a source, some text and an RFC 3339 time: {row:?}"
        ));
    }
    let _guard = WRITING.lock().unwrap_or_else(|held| held.into_inner());
    let mut rows = read_rows();
    rows.push(row);
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
    let _guard = WRITING.lock().unwrap_or_else(|held| held.into_inner());
    // Both of them. A crash between the write and the rename leaves a whole
    // copy of the record under the temporary name, and the one action that
    // promises to remove it has to remove that too.
    let gone = |at: PathBuf| match fs::remove_file(&at) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    };
    gone(path.with_extension("jsonl.writing"))?;
    gone(path)
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
        append_row(row(&now, "Casa", "rain")).expect("written");
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
        append_row(row(&now, "Casa", "first")).expect("written");
        append_row(row(&now, "Casa", "second")).expect("written");
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
        append_row(row(&old, "Casa", "last year")).expect("written");
        append_row(row(&fresh, "Casa", "today")).expect("written");
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
        append_row(awkward).expect("written");
        let rows = journal_rows();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "a b");
        assert_eq!(rows[0].source.chars().count(), MAX_FIELD);
    }

    #[test]
    fn a_row_that_is_not_one_is_refused_out_loud() {
        let dir = scratch("refused");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        // A row nothing can date could never be aged out, so it would live
        // for ever. A row with no place or no source is a record of nothing.
        // All of them are refused rather than reported as written, which is
        // what `Ok(0)` used to do.
        for broken in [
            row("not a date", "Casa", "rain"),
            row(&now, "   ", "rain"),
            JournalRow {
                source: String::new(),
                ..row(&now, "Casa", "rain")
            },
            JournalRow {
                text: String::new(),
                ..row(&now, "Casa", "rain")
            },
        ] {
            let refused = append_row(broken).expect_err("a refusal");
            assert!(refused.contains("journal row"), "{refused}");
        }
        assert!(journal_rows().is_empty());
    }

    #[test]
    fn a_row_it_cannot_date_is_kept_rather_than_swept_away() {
        let dir = scratch("undatable");
        let _guard = journal_test(&dir);
        let file = path().expect("a path");
        // A hand-edited file, or one from a build that wrote dates another
        // way. Deleting somebody's record to tidy the file is the one thing
        // this must never do.
        let stubborn = JournalRow {
            at: "2026/09/02 13:05".to_string(),
            ..row("2026-09-02T13:05:00Z", "Casa", "kept")
        };
        fs::write(
            &file,
            format!("{}\n", serde_json::to_string(&stubborn).expect("json")),
        )
        .expect("written");
        append_row(row(&Utc::now().to_rfc3339(), "Casa", "new")).expect("written");
        let rows = journal_rows();
        assert_eq!(rows.len(), 2, "{rows:?}");
        assert!(rows.iter().any(|row| row.text == "kept"));
    }

    #[test]
    fn appends_from_several_threads_all_land() {
        let dir = scratch("threads");
        let _guard = journal_test(&dir);
        let now = Utc::now();
        std::thread::scope(|scope| {
            for index in 0..8 {
                scope.spawn(move || {
                    append_row(row(
                        &(now + Duration::seconds(index)).to_rfc3339(),
                        "Casa",
                        &format!("row {index}"),
                    ))
                    .expect("written");
                });
            }
        });
        // Read, add, bound, write. Two of those interleaved lose rows; this
        // used to lose six of eight.
        assert_eq!(journal_rows().len(), 8);
    }

    #[test]
    fn clearing_it_takes_a_half_written_copy_with_it() {
        let dir = scratch("half-written");
        let _guard = journal_test(&dir);
        append_row(row(&Utc::now().to_rfc3339(), "Casa", "rain")).expect("written");
        // A crash between the write and the rename leaves a whole copy of the
        // record under the temporary name.
        let file = path().expect("a path");
        let leftover = file.with_extension("jsonl.writing");
        fs::copy(&file, &leftover).expect("copied");
        journal_clear().expect("cleared");
        assert!(!file.exists());
        assert!(!leftover.exists(), "the record survived being deleted");
    }

    #[test]
    fn clearing_it_leaves_nothing_at_all() {
        let dir = scratch("clear");
        let _guard = journal_test(&dir);
        append_row(row(&Utc::now().to_rfc3339(), "Casa", "rain")).expect("written");
        journal_clear().expect("cleared");
        assert!(journal_rows().is_empty());
        // And clearing an empty journal is not an error.
        journal_clear().expect("cleared again");
    }
}

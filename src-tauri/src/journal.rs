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
//!   itself, and deleted in one action, whole or a row at a time.
//! - **The reader's.** Every row can be given a sentence in their own words
//!   and can be removed on its own. A picture of the frame that was on screen
//!   is kept beside the file, under a byte budget of its own, and is dropped
//!   the moment nothing refers to it.
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

/// The longest a reader's own note may be.
///
/// Longer than a field, because this is the one part of a row a person writes
/// rather than the app, and a paragraph about a storm is a reasonable thing to
/// want. Short enough that a thousand of them are still a small file.
const MAX_NOTE: usize = 2_000;

/// The most one thumbnail may weigh.
///
/// A 320-pixel-wide PNG of a radar frame is twenty to sixty kilobytes. This
/// leaves room for a busy one and refuses anything that is plainly not a
/// thumbnail.
pub const MAX_THUMB_BYTES: usize = 128 * 1024;

/// The most all the thumbnails together may weigh.
///
/// Separate from the file's own ceiling, because pictures and text age out at
/// completely different rates: the oldest pictures go first and their rows
/// stay, which is the right trade when the row is the record and the picture
/// is the illustration.
pub const MAX_THUMBS_BYTES: u64 = 8 * 1024 * 1024;

/// Where the pictures live, beside the file rather than inside it.
const THUMBS_DIR: &str = "journal-thumbs";

/// What a row is: the weather, and how it came to be written down.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JournalRow {
    /// This row and no other, so a note reaches it and a delete finds it.
    ///
    /// Written by the app. A row from an older build arrives without one and
    /// is given a stable id derived from its own content on the way out of
    /// `read_rows`, so the same row keeps the same id across reads and the
    /// next write puts it on the disk.
    #[serde(default)]
    pub id: String,
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
    /// The reader's own sentence about it, or empty. Theirs to write and edit.
    #[serde(default)]
    pub note: String,
    /// The file name of the frame that was on screen, or empty.
    ///
    /// A name inside the thumbnails directory, never a path: the row is going
    /// to be read back off a disk somebody can edit.
    #[serde(default)]
    pub thumb: String,
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

/// A reader's own words, kept as they wrote them apart from what breaks a file.
///
/// Line breaks survive, because somebody writing about a storm uses them and
/// JSON carries them escaped. Everything else that is a control character does
/// not, and the whole thing is capped.
fn note_text(value: &str) -> String {
    let out: String = value
        .chars()
        .map(|one| {
            if one == '\n' || !one.is_control() {
                one
            } else {
                ' '
            }
        })
        .collect();
    let out = out.trim().to_string();
    if out.chars().count() > MAX_NOTE {
        return out.chars().take(MAX_NOTE).collect();
    }
    out
}

/// A file name, and only a file name.
///
/// The row this comes from was read off a disk a person can edit, so a name
/// carrying `..` or a separator is refused rather than cleaned: a cleaned path
/// is still a path somebody chose.
fn thumb_name(name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 80 {
        return None;
    }
    if !name.ends_with(".png") {
        return None;
    }
    // Letters, digits, a dot and a dash. This is the whole of the guard: a
    // name that cannot hold a separator or a colon cannot leave the directory
    // it is joined to, on Windows or anywhere else, so there is no traversal
    // check below to go stale. Widening this set is what would need one.
    if !name
        .chars()
        .all(|one| one.is_ascii_alphanumeric() || one == '.' || one == '-')
    {
        return None;
    }
    Some(name.to_string())
}

/// A row's own id, from its own content, the same every time it is read.
///
/// FNV-1a over the fields that make a row what it is. This exists so a row
/// written by an older build can still be given a note or deleted on its own;
/// a row written from now on arrives with an id already.
fn derived_id(row: &JournalRow) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in [&row.at, &row.place, &row.kind, &row.source, &row.text] {
        for byte in part.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn tidy(row: &JournalRow) -> JournalRow {
    JournalRow {
        id: trimmed(&row.id),
        note: note_text(&row.note),
        thumb: thumb_name(&row.thumb).unwrap_or_default(),
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
        .map(|mut row| {
            if row.id.is_empty() {
                row.id = derived_id(&row);
            }
            row
        })
        .collect()
}

/// Where the pictures are kept, made if it is not there yet.
fn thumbs_dir() -> Option<PathBuf> {
    let dir = path()?.parent()?.join(THUMBS_DIR);
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Holds the pictures to what the rows actually refer to, and to their budget.
///
/// Two jobs, in order. A picture nothing refers to is deleted, which is what
/// happens to every thumbnail whose row aged out of the file. Then, while the
/// rest weigh more than the budget, the oldest are deleted and their rows are
/// told so, because a row pointing at a picture that is gone is worse than a
/// row that never had one.
fn sweep_thumbs(rows: &mut [JournalRow]) {
    let Some(dir) = thumbs_dir() else {
        return;
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    let wanted: std::collections::HashSet<String> = rows
        .iter()
        .filter(|row| !row.thumb.is_empty())
        .map(|row| row.thumb.clone())
        .collect();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !wanted.contains(&name) {
            let _ = fs::remove_file(entry.path());
        }
    }

    let weight = |row: &JournalRow| -> u64 {
        if row.thumb.is_empty() {
            return 0;
        }
        fs::metadata(dir.join(&row.thumb))
            .map(|found| found.len())
            .unwrap_or(0)
    };
    let mut total: u64 = rows.iter().map(weight).sum();
    for row in rows.iter_mut() {
        if total <= MAX_THUMBS_BYTES {
            break;
        }
        if row.thumb.is_empty() {
            continue;
        }
        total -= weight(row);
        let _ = fs::remove_file(dir.join(&row.thumb));
        row.thumb.clear();
    }
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
pub async fn journal_append(row: JournalRow) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || append_row(row))
        .await
        .map_err(|error| error.to_string())?
}

/// Answers with the id the row was given.
///
/// The caller needs it: a picture of the frame that was on screen is attached
/// straight afterwards, and there is no other way to say which row it belongs
/// to. Empty when there is nowhere to write.
fn append_row(row: JournalRow) -> Result<String, String> {
    let Some(path) = path() else {
        return Ok(String::new());
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
    let mut row = row;
    if row.id.is_empty() {
        row.id = derived_id(&row);
    }
    // Two rows that agree on every field would agree on their derived id as
    // well, and an id that names two rows is not an id.
    let mut suffix = 1;
    while rows.iter().any(|held| held.id == row.id) {
        row.id = format!("{}-{suffix}", derived_id(&row));
        suffix += 1;
    }
    let id = row.id.clone();
    rows.push(row);
    commit(&path, rows)?;
    Ok(id)
}

/// Bounds what is there, drops the pictures nothing refers to, and writes it.
///
/// Every path that changes the file goes through this, so the bounds and the
/// picture budget are enforced by writing rather than by remembering to.
fn commit(path: &Path, rows: Vec<JournalRow>) -> Result<usize, String> {
    let mut kept = bounded(rows, Utc::now());
    sweep_thumbs(&mut kept);
    write_rows(path, &kept).map_err(|error| error.to_string())?;
    Ok(kept.len())
}

/// Puts the reader's own words on one row, or takes them off again.
#[tauri::command]
pub async fn journal_note(id: String, note: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || set_note(&id, &note))
        .await
        .map_err(|error| error.to_string())?
}

fn set_note(id: &str, note: &str) -> Result<usize, String> {
    {
        let Some(path) = path() else {
            return Ok(0);
        };
        let _guard = WRITING.lock().unwrap_or_else(|held| held.into_inner());
        let mut rows = read_rows();
        let Some(row) = rows.iter_mut().find(|row| row.id == id) else {
            return Err(format!("no journal row is called {id}"));
        };
        row.note = note_text(note);
        commit(&path, rows)
    }
}

/// Removes one row, and the picture that belonged to it.
#[tauri::command]
pub async fn journal_remove(id: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || remove_row(&id))
        .await
        .map_err(|error| error.to_string())?
}

fn remove_row(id: &str) -> Result<usize, String> {
    {
        let Some(path) = path() else {
            return Ok(0);
        };
        let _guard = WRITING.lock().unwrap_or_else(|held| held.into_inner());
        let mut rows = read_rows();
        let before = rows.len();
        rows.retain(|row| row.id != id);
        if rows.len() == before {
            return Err(format!("no journal row is called {id}"));
        }
        // The sweep inside `commit` deletes the picture: nothing refers to it
        // any more, which is the same reason an aged-out row's picture goes.
        commit(&path, rows)
    }
}

/// Keeps the frame that was on screen beside a row, under its own budget.
#[tauri::command]
pub async fn journal_thumb(id: String, bytes: Vec<u8>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || write_thumb(&id, &bytes))
        .await
        .map_err(|error| error.to_string())?
}

fn write_thumb(id: &str, bytes: &[u8]) -> Result<String, String> {
    {
        let Some(path) = path() else {
            return Ok(String::new());
        };
        if bytes.len() > MAX_THUMB_BYTES {
            return Err(format!(
                "a journal thumbnail may weigh {MAX_THUMB_BYTES} bytes and this one weighs {}",
                bytes.len()
            ));
        }
        // The one format the app writes. Checked rather than trusted, because
        // this ends up in an `img` on a page.
        if !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
            // The one format the app writes, checked rather than trusted.
            return Err("a journal thumbnail has to be a PNG".to_string());
        }
        let _guard = WRITING.lock().unwrap_or_else(|held| held.into_inner());
        let mut rows = read_rows();
        let Some(dir) = thumbs_dir() else {
            return Err("OpenRadar has nowhere to keep journal pictures".to_string());
        };
        let Some(row) = rows.iter_mut().find(|row| row.id == id) else {
            return Err(format!("no journal row is called {id}"));
        };
        // The row's own id, not a hash of its contents. Two rows that agree on
        // every field are separated by `append_row` into `X` and `X-1`, and
        // naming both pictures after the hash wrote one over the other: one
        // warning reaching two places a reader had both called Home destroyed
        // the first picture and left the first row showing the second's.
        let name = format!("{}.png", row.id);
        let Some(name) = thumb_name(&name) else {
            return Err("that row cannot be given a picture".to_string());
        };
        fs::write(dir.join(&name), bytes).map_err(|error| error.to_string())?;
        row.thumb = name.clone();
        commit(&path, rows)?;
        // Not necessarily kept: the budget sweep may have taken it straight
        // back off again, and saying so is better than reporting a picture
        // that is not there.
        Ok(if dir.join(&name).exists() {
            name
        } else {
            String::new()
        })
    }
}

/// Puts rows back, for an undo.
///
/// Every destructive action in this app is one press with no dialog, which
/// only works if the press is reversible. A row put back keeps its id, its
/// time and the reader's own note; its picture does not come back, because
/// deleting the row deleted the file, and a restored row that pointed at a
/// picture which is gone would be worse than one that never had one.
///
/// Rows already there are left alone, so pressing undo twice puts nothing
/// back twice.
#[tauri::command]
pub async fn journal_restore(rows: Vec<JournalRow>) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || restore_rows(rows))
        .await
        .map_err(|error| error.to_string())?
}

fn restore_rows(putting: Vec<JournalRow>) -> Result<usize, String> {
    let Some(path) = path() else {
        return Ok(0);
    };
    let _guard = WRITING.lock().unwrap_or_else(|held| held.into_inner());
    let mut rows = read_rows();
    for row in putting {
        let mut row = tidy(&row);
        row.thumb.clear();
        if row.id.is_empty() {
            row.id = derived_id(&row);
        }
        if !worth_keeping(&row) {
            continue;
        }
        if rows.iter().any(|held| held.id == row.id) {
            continue;
        }
        rows.push(row);
    }
    // Back into the order the file keeps, oldest first, or a restored row
    // would sit at the end whatever its time says.
    rows.sort_by(|left, right| left.at.cmp(&right.at));
    commit(&path, rows)
}

/// One picture's bytes, for the panel to show.
#[tauri::command]
pub fn journal_thumb_data(name: String) -> Result<Vec<u8>, String> {
    let Some(name) = thumb_name(&name) else {
        return Err("that is not a journal picture".to_string());
    };
    let Some(dir) = thumbs_dir() else {
        return Err("OpenRadar has nowhere to keep journal pictures".to_string());
    };
    fs::read(dir.join(name)).map_err(|error| error.to_string())
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
    // The pictures are part of the record, so the one action that promises to
    // remove all of it removes them too.
    if let Some(dir) = thumbs_dir() {
        let _ = fs::remove_dir_all(dir);
    }
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
            id: String::new(),
            note: String::new(),
            thumb: String::new(),
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
        let id = append_row(row(&now, "Casa", "rain")).expect("written");
        let rows = journal_rows();
        assert_eq!(rows.len(), 1);
        // The id comes back out of the append itself. A picture of the frame
        // that was on screen is attached straight afterwards, and there is
        // nothing else that says which row it belongs to.
        assert_eq!(rows[0].id, id);
        assert!(!id.is_empty());
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

    /// A PNG as far as anything that checks a header is concerned.
    fn png(size: usize) -> Vec<u8> {
        let mut bytes = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        bytes.resize(size.max(8), 0x42);
        bytes
    }

    #[test]
    fn a_reader_can_write_on_a_row_and_take_it_off_again() {
        let dir = scratch("note");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        append_row(row(&now, "Casa", "hail")).expect("written");
        let id = journal_rows()[0].id.clone();
        assert!(!id.is_empty());

        set_note(&id, "  Woke us up.\nThe car did not survive.  ").expect("noted");
        let kept = journal_rows();
        assert_eq!(kept[0].note, "Woke us up.\nThe car did not survive.");
        // The line break is the reader's and survives; the row it is on does
        // not become two rows.
        let text = fs::read_to_string(path().expect("a path")).expect("readable");
        assert_eq!(text.lines().count(), 1);

        set_note(&id, "").expect("cleared");
        assert_eq!(journal_rows()[0].note, "");
        assert!(set_note("not-an-id", "x").is_err());
    }

    #[test]
    fn a_row_from_an_older_build_still_has_an_id() {
        let dir = scratch("legacy-id");
        let _guard = journal_test(&dir);
        // No id, no note, no thumb: exactly what the first build wrote.
        let line = r#"{"at":"2026-09-01T10:00:00Z","place":"Casa","kind":"alert","source":"NWS","observed":"2026-09-01T09:58:00Z","obtained":"the office's own feed","text":"Severe Thunderstorm Warning"}"#;
        fs::write(path().expect("a path"), format!("{line}\n")).expect("written");
        let first = journal_rows();
        assert_eq!(first.len(), 1);
        assert!(!first[0].id.is_empty());
        // The same id on every read, or a note written now would land on a
        // different row after a restart.
        assert_eq!(journal_rows()[0].id, first[0].id);
        set_note(&first[0].id, "Loud").expect("noted");
        assert_eq!(journal_rows()[0].note, "Loud");
    }

    #[test]
    fn two_identical_rows_still_have_two_ids() {
        let dir = scratch("collision");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        append_row(row(&now, "Casa", "rain")).expect("written");
        append_row(row(&now, "Casa", "rain")).expect("written");
        let rows = journal_rows();
        assert_eq!(rows.len(), 2);
        assert_ne!(rows[0].id, rows[1].id, "an id that names two rows is none");
    }

    #[test]
    fn one_row_can_go_without_taking_the_rest() {
        let dir = scratch("remove-one");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        for text in ["first", "second", "third"] {
            append_row(row(&now, "Casa", text)).expect("written");
        }
        let id = journal_rows()[1].id.clone();
        remove_row(&id).expect("removed");
        let kept = journal_rows();
        assert_eq!(kept.len(), 2);
        assert!(kept.iter().all(|row| row.text != "second"));
        assert!(remove_row(&id).is_err(), "removing it twice is a mistake");
    }

    #[test]
    fn a_picture_is_kept_beside_the_row_and_goes_with_it() {
        let dir = scratch("thumb");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        append_row(row(&now, "Casa", "hail")).expect("written");
        let id = journal_rows()[0].id.clone();

        let name = write_thumb(&id, &png(2_000)).expect("written");
        assert!(name.ends_with(".png"));
        assert_eq!(journal_rows()[0].thumb, name);
        assert_eq!(journal_thumb_data(name.clone()).expect("read").len(), 2_000);

        remove_row(&id).expect("removed");
        // The row is gone, so nothing refers to the picture, so the picture is
        // gone. A journal that deletes rows and keeps their pictures is a
        // journal that quietly keeps what somebody deleted.
        assert!(!thumbs_dir().expect("a directory").join(&name).exists());
        assert!(journal_thumb_data(name).is_err());
    }

    #[test]
    fn two_rows_that_read_alike_keep_their_own_pictures() {
        let dir = scratch("thumb-collision");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        // One warning reaching two places the reader called the same thing,
        // in the same millisecond: every field agrees, so the two rows are
        // told apart by their ids alone.
        append_row(row(&now, "Home", "Tornado Warning")).expect("written");
        append_row(row(&now, "Home", "Tornado Warning")).expect("written");
        let rows = journal_rows();
        let first = write_thumb(&rows[0].id, &png(1_000)).expect("written");
        let second = write_thumb(&rows[1].id, &png(2_000)).expect("written");
        assert_ne!(first, second, "one picture cannot serve two rows");

        let held = thumbs_dir().expect("a directory");
        assert_eq!(fs::metadata(held.join(&first)).expect("kept").len(), 1_000);
        assert_eq!(fs::metadata(held.join(&second)).expect("kept").len(), 2_000);
        let after = journal_rows();
        assert_eq!(after[0].thumb, first);
        assert_eq!(after[1].thumb, second);
    }

    #[test]
    fn a_deleted_row_can_be_put_back() {
        let dir = scratch("restore");
        let _guard = journal_test(&dir);
        let now = Utc::now();
        for index in 0..3 {
            let at = (now + Duration::seconds(index)).to_rfc3339();
            append_row(row(&at, "Casa", &format!("row {index}"))).expect("written");
        }
        let taken = journal_rows()[1].clone();
        set_note(&taken.id, "Loud").expect("noted");
        let taken = journal_rows()[1].clone();
        let name = write_thumb(&taken.id, &png(500)).expect("written");
        remove_row(&taken.id).expect("removed");
        assert_eq!(journal_rows().len(), 2);

        restore_rows(vec![taken.clone()]).expect("restored");
        let back = journal_rows();
        assert_eq!(back.len(), 3);
        // Its own place in the file, its own id, and the reader's own words.
        assert_eq!(back[1].id, taken.id);
        assert_eq!(back[1].text, "row 1");
        assert_eq!(back[1].note, "Loud");
        // The picture is not claimed back, because deleting the row deleted
        // the file, and a row pointing at a picture that is gone is worse
        // than one that never had a picture.
        assert_eq!(back[1].thumb, "");
        assert!(!thumbs_dir().expect("a directory").join(&name).exists());

        // Twice puts nothing back twice.
        restore_rows(vec![taken]).expect("restored");
        assert_eq!(journal_rows().len(), 3);
    }

    #[test]
    fn the_whole_record_can_be_put_back() {
        let dir = scratch("restore-all");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        for text in ["first", "second", "third"] {
            append_row(row(&now, "Casa", text)).expect("written");
        }
        let all = journal_rows();
        journal_clear().expect("cleared");
        assert!(journal_rows().is_empty());
        restore_rows(all.clone()).expect("restored");
        assert_eq!(journal_rows().len(), 3);
        assert_eq!(
            journal_rows()
                .iter()
                .map(|row| row.text.clone())
                .collect::<Vec<_>>(),
            vec!["first", "second", "third"]
        );
    }

    #[test]
    fn a_picture_that_is_not_one_is_refused() {
        let dir = scratch("thumb-refused");
        let _guard = journal_test(&dir);
        let now = Utc::now().to_rfc3339();
        append_row(row(&now, "Casa", "hail")).expect("written");
        let id = journal_rows()[0].id.clone();

        assert!(write_thumb(&id, b"<svg onload=alert(1)>").is_err());
        assert!(write_thumb(&id, &png(MAX_THUMB_BYTES + 1)).is_err());
        assert!(write_thumb("not-an-id", &png(100)).is_err());
        assert_eq!(journal_rows()[0].thumb, "");
        // A name out of the file, which somebody can edit, is a name that can
        // try to leave the directory.
        for name in [
            "../journal.jsonl",
            "..\\journal.jsonl",
            "a.png/../b",
            "C:/windows/system32/x.png",
            "a.txt",
            "",
        ] {
            assert!(thumb_name(name).is_none(), "{name}");
            assert!(journal_thumb_data(name.to_string()).is_err(), "{name}");
        }
    }

    #[test]
    fn pictures_stop_at_their_own_budget_and_the_rows_stay() {
        let dir = scratch("thumb-budget");
        let _guard = journal_test(&dir);
        let now = Utc::now();
        // Enough of them to pass the ceiling twice over, oldest first.
        let each = MAX_THUMB_BYTES;
        let wanted = (MAX_THUMBS_BYTES as usize / each) + 3;
        for index in 0..wanted {
            let at = (now + Duration::seconds(index as i64)).to_rfc3339();
            append_row(row(&at, "Casa", &format!("storm {index}"))).expect("written");
            let id = journal_rows()
                .last()
                .expect("the row just written")
                .id
                .clone();
            let _ = write_thumb(&id, &png(each));
        }
        let rows = journal_rows();
        assert_eq!(rows.len(), wanted, "the rows are the record");
        let held = thumbs_dir().expect("a directory");
        let total: u64 = fs::read_dir(&held)
            .expect("readable")
            .flatten()
            .filter_map(|entry| entry.metadata().ok())
            .map(|found| found.len())
            .sum();
        assert!(total <= MAX_THUMBS_BYTES, "{total} bytes of pictures");
        // The oldest went and the newest stayed, and every row that still
        // names a picture names one that is there.
        assert_eq!(rows[0].thumb, "");
        assert_ne!(rows[wanted - 1].thumb, "");
        for row in &rows {
            if !row.thumb.is_empty() {
                assert!(held.join(&row.thumb).exists(), "{}", row.thumb);
            }
        }
    }

    #[test]
    fn an_aged_out_row_takes_its_picture_with_it() {
        let dir = scratch("thumb-retention");
        let _guard = journal_test(&dir);
        let old = (Utc::now() - Duration::days(RETENTION_DAYS - 1)).to_rfc3339();
        append_row(row(&old, "Casa", "nearly a year ago")).expect("written");
        let id = journal_rows()[0].id.clone();
        let name = write_thumb(&id, &png(1_000)).expect("written");
        assert!(thumbs_dir().expect("a directory").join(&name).exists());

        // Two days on, that row is past the retention period.
        let mut rows = read_rows();
        rows[0].at = (Utc::now() - Duration::days(RETENTION_DAYS + 1)).to_rfc3339();
        write_rows(&path().expect("a path"), &rows).expect("written");
        append_row(row(&Utc::now().to_rfc3339(), "Casa", "today")).expect("written");

        assert_eq!(journal_rows().len(), 1);
        assert!(!thumbs_dir().expect("a directory").join(&name).exists());
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

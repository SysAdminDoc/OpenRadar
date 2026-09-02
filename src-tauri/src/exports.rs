//! Saving an exported picture or loop to disk.
//!
//! The frontend hands over a suggested name and the bytes. The name is treated
//! as untrusted: only the sanitized stem is used, and the file always lands in
//! one directory this module chooses.

use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager};

const MAX_STEM: usize = 80;
const MAX_BYTES: usize = 64 * 1024 * 1024;
/// Pictures, loops, the workspace file, and the record.
///
/// Anything else is refused, so a name from the page can only ever produce one
/// of the kinds of file this app writes. Adding a kind of export means adding
/// it here as well, and `every_file_this_app_writes_can_be_written` is the
/// test that says so out loud: the journal export shipped writing nothing at
/// all for as long as `jsonl` was missing from this list.
const ALLOWED_EXTENSIONS: &[&str] = &["png", "webm", "gif", "json", "jsonl", "md"];
/// Windows addresses these as devices no matter the extension or folder.
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

static TEMPORARY_WRITES: AtomicU64 = AtomicU64::new(0);
const TEMPORARY_ATTEMPTS: usize = 16;

/// The allowed kinds as a reader would say them: "png, webm, gif and md".
///
/// Joining the whole list with " and " read as "png and webm and json" the
/// moment there were three of them, and this message goes to the screen.
fn allowed_in_words() -> String {
    match ALLOWED_EXTENSIONS.split_last() {
        Some((last, [])) => (*last).to_string(),
        Some((last, rest)) => format!("{} and {last}", rest.join(", ")),
        None => String::new(),
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("that file name cannot be used")]
    BadName,
    #[error("only {0} files can be exported", allowed_in_words())]
    BadExtension,
    #[error("the export is larger than the {MAX_BYTES} byte limit")]
    TooLarge,
    #[error("no folder is available to save into")]
    NoFolder,
    #[error("the file could not be written: {0}")]
    Write(String),
}

impl serde::Serialize for ExportError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Keeps letters, digits, dashes, and underscores; everything else in the stem
/// becomes a dash. Separators and parent references cannot survive, so the
/// result can only ever name a file inside the folder we picked, and a name
/// that would address a DOS device instead of a file is refused.
pub fn sanitize_file_name(name: &str) -> Result<String, ExportError> {
    let (stem, extension) = name.rsplit_once('.').ok_or(ExportError::BadName)?;
    let extension = extension.to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(ExportError::BadExtension);
    }

    let cleaned: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches('-').to_string();
    if cleaned.is_empty() {
        return Err(ExportError::BadName);
    }

    let stem: String = cleaned.chars().take(MAX_STEM).collect();
    if RESERVED_NAMES.contains(&stem.to_ascii_uppercase().as_str()) {
        return Err(ExportError::BadName);
    }
    Ok(format!("{stem}.{extension}"))
}

pub(crate) fn export_folder(app: &AppHandle) -> Result<PathBuf, ExportError> {
    let path = app.path();
    path.download_dir()
        .or_else(|_| path.app_data_dir())
        .map_err(|_| ExportError::NoFolder)
}

/// Writes beside the destination, flushes the bytes, then publishes them in
/// one rename. `std::fs::rename` has replace-existing semantics for files on
/// Windows as well as Unix, so a failed replacement leaves the previous export
/// in place.
pub(crate) fn write_atomically(target: &Path, bytes: &[u8]) -> io::Result<()> {
    write_atomically_with(target, bytes, |from, to| fs::rename(from, to))
}

/// The replacement operation is passed in so its failure path can be proved
/// without depending on a filesystem race or filling a disk in a test.
fn write_atomically_with(
    target: &Path,
    bytes: &[u8],
    replace: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let (temporary, mut file) = temporary_file(target)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }

    if let Err(error) = replace(&temporary, target) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn temporary_file(target: &Path) -> io::Result<(PathBuf, File)> {
    let name = target.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "the export has no file name")
    })?;
    for _ in 0..TEMPORARY_ATTEMPTS {
        let mut temporary_name = OsString::from(name);
        temporary_name.push(format!(
            ".{}.{}.tmp",
            std::process::id(),
            TEMPORARY_WRITES.fetch_add(1, Ordering::Relaxed)
        ));
        let temporary = target.with_file_name(temporary_name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => return Ok((temporary, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "no unique temporary export name was available",
    ))
}

/// Writes the bytes and answers with the full path, so the caller can offer to
/// show the file.
#[tauri::command]
pub fn save_export(
    app: AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, ExportError> {
    if bytes.len() > MAX_BYTES {
        return Err(ExportError::TooLarge);
    }

    let name = sanitize_file_name(&file_name)?;
    let folder = export_folder(&app)?;
    fs::create_dir_all(&folder).map_err(|error| ExportError::Write(error.to_string()))?;

    let target = folder.join(name);
    write_atomically(&target, &bytes).map_err(|error| ExportError::Write(error.to_string()))?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every kind of file this app actually offers to save.
    ///
    /// This exists because the settings export was impossible in a packaged
    /// build for as long as json was missing from the list, and nothing
    /// noticed. It happened again with the record: the journal export asked
    /// for `.jsonl` and `.md`, the first call threw, and the reader got an
    /// error toast and no files whatever. Every caller that names a file is
    /// spelled out here.
    #[test]
    fn every_file_this_app_writes_can_be_written() {
        for name in [
            "openradar-2026-08-30.png",
            "openradar-loop.webm",
            "openradar-loop.gif",
            "openradar-workspace.json",
            "openradar-journal.jsonl",
            "openradar-journal.md",
            "openradar-journal-a1b2c3.png",
            "openradar-year-2026-09-02.png",
        ] {
            assert!(
                sanitize_file_name(name).is_ok(),
                "{name} is a file this app offers to save"
            );
        }
        // And nothing else, however it is spelled.
        for name in ["notes.txt", "script.exe", "page.html", "archive.zip"] {
            assert!(matches!(
                sanitize_file_name(name),
                Err(ExportError::BadExtension)
            ));
        }
    }

    #[test]
    fn the_refusal_reads_as_a_sentence() {
        // Joining the whole list with " and " gave a repeated conjunction as
        // soon as there were three of them, and this reaches the screen.
        let said = ExportError::BadExtension.to_string();
        assert_eq!(
            said,
            "only png, webm, gif, json, jsonl and md files can be exported"
        );
    }

    #[test]
    fn keeps_a_plain_name() {
        assert_eq!(
            sanitize_file_name("openradar-loop-2026-08-30.webm").unwrap(),
            "openradar-loop-2026-08-30.webm"
        );
        assert_eq!(
            sanitize_file_name("Radar_View.PNG").unwrap(),
            "Radar_View.png"
        );
    }

    #[test]
    fn cannot_be_talked_out_of_its_folder() {
        assert_eq!(
            sanitize_file_name("../../windows/system32/evil.png").unwrap(),
            "windows-system32-evil.png"
        );
        assert_eq!(
            sanitize_file_name("C:\\Users\\x\\notes.png").unwrap(),
            "C--Users-x-notes.png"
        );
        for name in [
            "../../windows/system32/evil.png",
            "C:\\Users\\x\\notes.png",
            "loop/../../escape.webm",
        ] {
            let cleaned = sanitize_file_name(name).unwrap();
            assert!(!cleaned.contains('/'));
            assert!(!cleaned.contains('\\'));
            assert!(!cleaned.contains(".."));
        }
    }

    #[test]
    fn refuses_a_name_that_is_not_a_picture_or_a_loop() {
        assert!(matches!(
            sanitize_file_name("payload.exe"),
            Err(ExportError::BadExtension)
        ));
        assert!(matches!(
            sanitize_file_name("noextension"),
            Err(ExportError::BadName)
        ));
        assert!(matches!(
            sanitize_file_name("....png"),
            Err(ExportError::BadName)
        ));
    }

    #[test]
    fn refuses_a_name_windows_would_treat_as_a_device() {
        for name in ["CON.png", "nul.webm", "Lpt1.png"] {
            assert!(matches!(
                sanitize_file_name(name),
                Err(ExportError::BadName)
            ));
        }
        assert!(sanitize_file_name("console.png").is_ok());
    }

    #[test]
    fn caps_a_very_long_name() {
        let name = format!("{}.png", "a".repeat(500));
        let cleaned = sanitize_file_name(&name).unwrap();
        assert_eq!(cleaned.len(), MAX_STEM + 4);
    }

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "openradar-export-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("a clock after 1970")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("an export scratch directory");
        directory
    }

    #[test]
    fn replaces_an_existing_export_atomically() {
        let directory = scratch("replace");
        let target = directory.join("openradar-workspace.json");
        fs::write(&target, b"old settings").expect("the old export");

        write_atomically(&target, b"new settings").expect("the replacement");

        assert_eq!(fs::read(&target).expect("the new export"), b"new settings");
        assert_eq!(
            fs::read_dir(&directory)
                .expect("the export directory")
                .count(),
            1,
            "a temporary export was left behind"
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn a_failed_replacement_preserves_the_old_export_and_cleans_up() {
        let directory = scratch("failed-replace");
        let target = directory.join("openradar-workspace.json");
        fs::write(&target, b"last good settings").expect("the old export");

        let error = write_atomically_with(&target, b"incomplete settings", |_from, _to| {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "replacement refused for the test",
            ))
        })
        .expect_err("the replacement must fail");

        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(
            fs::read(&target).expect("the old export remains"),
            b"last good settings"
        );
        assert_eq!(
            fs::read_dir(&directory)
                .expect("the export directory")
                .count(),
            1,
            "the failed replacement left temporary residue"
        );
        let _ = fs::remove_dir_all(directory);
    }
}

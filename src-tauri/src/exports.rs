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
const ALLOWED_EXTENSIONS: &[&str] = &["png", "webm", "mp4", "gif", "json", "jsonl", "md"];
/// Windows addresses these as devices no matter the extension or folder.
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

static TEMPORARY_WRITES: AtomicU64 = AtomicU64::new(0);
const TEMPORARY_ATTEMPTS: usize = 16;

/// The allowed kinds as a reader would say them: "png, webm, mp4 and md".
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

/// The name a raw-body request carries its file name under.
pub const FILE_NAME_HEADER: &str = "x-file-name";

/// Reads the file name and the bytes out of a raw-body request.
///
/// The bytes used to arrive as a JSON array of numbers, which is three and a
/// half bytes of string per byte of file: a sixteen megabyte loop took 411 ms
/// to convert and 141 ms to serialise on the machine this was measured on,
/// and produced a 57 MB string, on the interface thread, while the reader
/// waited. The ceiling here is 64 MB, so the worst case was a 230 MB string.
///
/// Takes the two halves rather than the request, because a test cannot build
/// one: `tauri::ipc::Request` has no public constructor.
fn unpack(
    body: &tauri::ipc::InvokeBody,
    headers: &tauri::http::HeaderMap,
) -> Result<(String, Vec<u8>), ExportError> {
    let tauri::ipc::InvokeBody::Raw(bytes) = body else {
        return Err(ExportError::BadName);
    };
    let name = headers
        .get(FILE_NAME_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or(ExportError::BadName)?;
    Ok((name.to_string(), bytes.clone()))
}

/// Writes the bytes and answers with the full path, so the caller can offer to
/// show the file.
#[tauri::command]
pub fn save_export(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, ExportError> {
    let (file_name, bytes) = unpack(request.body(), request.headers())?;
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

    /// The bytes and the name, out of a raw body and a header.
    ///
    /// They used to arrive as a JSON array of numbers, which is three and a
    /// half bytes of string per byte of file, built on the thread drawing the
    /// map while the reader waited. Nothing else in the suite can see the
    /// shape of an invoke, so this is where it is held.
    #[test]
    fn reads_the_name_out_of_a_header_and_the_bytes_out_of_the_body() {
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert(FILE_NAME_HEADER, "loop.webm".parse().unwrap());
        let body = tauri::ipc::InvokeBody::Raw(vec![1, 2, 3]);
        let (name, bytes) = unpack(&body, &headers).expect("a raw body");
        assert_eq!(name, "loop.webm");
        assert_eq!(bytes, vec![1, 2, 3]);
    }

    #[test]
    fn refuses_a_body_that_is_not_bytes() {
        // A caller still spelling the file out as a JSON array gets an error
        // rather than an empty file with a plausible name.
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert(FILE_NAME_HEADER, "loop.webm".parse().unwrap());
        let body = tauri::ipc::InvokeBody::Json(serde_json::json!([1, 2, 3]));
        assert!(unpack(&body, &headers).is_err());
    }

    #[test]
    fn refuses_a_request_that_names_no_file() {
        let headers = tauri::http::HeaderMap::new();
        let body = tauri::ipc::InvokeBody::Raw(vec![1, 2, 3]);
        assert!(unpack(&body, &headers).is_err());
    }

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
            "openradar-loop.mp4",
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
            "only png, webm, mp4, gif, json, jsonl and md files can be exported"
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

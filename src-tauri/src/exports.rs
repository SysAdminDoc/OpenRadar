//! Saving an exported picture or loop to disk.
//!
//! The frontend hands over a suggested name and the bytes. The name is treated
//! as untrusted: only the sanitized stem is used, and the file always lands in
//! one directory this module chooses.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const MAX_STEM: usize = 80;
const MAX_BYTES: usize = 64 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &["png", "webm"];

#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    #[error("that file name cannot be used")]
    BadName,
    #[error("only {0} files can be exported", ALLOWED_EXTENSIONS.join(" and "))]
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

/// Keeps letters, digits, dashes, underscores, and dots; everything else
/// becomes a dash. Separators and parent references cannot survive, so the
/// result can only ever name a file inside the folder we picked.
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
    Ok(format!("{stem}.{extension}"))
}

fn export_folder(app: &AppHandle) -> Result<PathBuf, ExportError> {
    let path = app.path();
    path.download_dir()
        .or_else(|_| path.app_data_dir())
        .map_err(|_| ExportError::NoFolder)
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
    std::fs::create_dir_all(&folder).map_err(|error| ExportError::Write(error.to_string()))?;

    let target = folder.join(name);
    std::fs::write(&target, bytes).map_err(|error| ExportError::Write(error.to_string()))?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn caps_a_very_long_name() {
        let name = format!("{}.png", "a".repeat(500));
        let cleaned = sanitize_file_name(&name).unwrap();
        assert_eq!(cleaned.len(), MAX_STEM + 4);
    }
}

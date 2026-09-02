//! Reading the alert sound a reader chose from their own disk.
//!
//! The webview cannot open a file by path, and the page's content policy does
//! not let it fetch one either. The app shipped for a version doing exactly
//! that: `convertFileSrc` and `fetch`, against an asset protocol this binary
//! is not built with, so choosing your own alert sound could not work on any
//! machine and the toast blamed the file. This is the one way those bytes get
//! in, and it is deliberately narrow.
//!
//! What it will not do: open anything whose name is not one of the six audio
//! extensions the picker offers, and read past two megabytes. The size is
//! asked twice, once of the directory entry and once while reading, because a
//! file can grow between the two and the first answer is only a hint.

use std::fs::File;
use std::io::Read;
use std::path::Path;

/// The same ceiling `MAX_SOUND_BYTES` carries on the page.
///
/// Two megabytes is about a minute of ordinary stereo wav, and the sound is
/// cut off after six seconds anyway. The point of the limit is that this
/// command reads whatever path it is handed into memory.
const MAX_BYTES: u64 = 2 * 1024 * 1024;

/// What the file picker offers, and nothing else.
const ALLOWED_EXTENSIONS: &[&str] = &["wav", "mp3", "ogg", "oga", "flac", "m4a"];

#[derive(Debug, thiserror::Error)]
pub enum SoundError {
    #[error("that is not one of the audio files this can open")]
    BadName,
    #[error("the file is larger than the {MAX_BYTES} byte limit")]
    TooLarge,
    #[error("the file could not be read: {0}")]
    Read(String),
}

impl SoundError {
    /// The word the settings panel turns into a sentence.
    ///
    /// The page has three of these already, written for a reader ("It is
    /// larger than 2 MB."), so what crosses is which one to say rather than an
    /// English message from the operating system.
    fn reason(&self) -> &'static str {
        match self {
            Self::BadName => "name",
            Self::TooLarge => "size",
            Self::Read(_) => "decode",
        }
    }
}

impl serde::Serialize for SoundError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("reason", self.reason())?;
        map.serialize_entry("message", &self.to_string())?;
        map.end()
    }
}

/// Whether this is a name the reader could have picked in the dialog.
fn name_allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase())
        .is_some_and(|name| ALLOWED_EXTENSIONS.contains(&name.as_str()))
}

/// Reads the file, refusing before rather than after the damage.
fn read_bounded(path: &Path) -> Result<Vec<u8>, SoundError> {
    if !name_allowed(path) {
        return Err(SoundError::BadName);
    }

    let file = File::open(path).map_err(|error| SoundError::Read(error.to_string()))?;
    let size = file
        .metadata()
        .map_err(|error| SoundError::Read(error.to_string()))?
        .len();
    if size > MAX_BYTES {
        return Err(SoundError::TooLarge);
    }

    // Asked again while reading. The entry said how big it was a moment ago,
    // and a file being written to is bigger now.
    let mut bytes = Vec::with_capacity(size as usize);
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| SoundError::Read(error.to_string()))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(SoundError::TooLarge);
    }
    Ok(bytes)
}

/// Hands the page the bytes of the reader's own alert sound.
///
/// The answer is a raw body rather than a list of numbers, because two
/// megabytes of audio spelled as JSON is seven megabytes of string built on
/// the interface thread.
#[tauri::command]
pub fn alert_sound_bytes(path: String) -> Result<tauri::ipc::Response, SoundError> {
    read_bounded(Path::new(&path)).map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn scratch(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("openradar-sound-tests");
        std::fs::create_dir_all(&dir).expect("scratch directory");
        let path = dir.join(name);
        let mut file = File::create(&path).expect("scratch file");
        file.write_all(bytes).expect("scratch write");
        path
    }

    #[test]
    fn reads_a_small_sound() {
        let path = scratch("small.wav", b"RIFF....WAVEfmt ");
        let bytes = read_bounded(&path).expect("a small wav is readable");
        assert_eq!(bytes, b"RIFF....WAVEfmt ");
    }

    /// The picker offers six extensions and this list has to be the same six,
    /// or a file a reader can choose is one this refuses to open.
    #[test]
    fn opens_every_kind_the_picker_offers() {
        for extension in ALLOWED_EXTENSIONS {
            let path = scratch(&format!("kind.{extension}"), b"sound");
            assert!(
                read_bounded(&path).is_ok(),
                "{extension} is offered in the dialog and refused here"
            );
        }
    }

    #[test]
    fn refuses_a_name_that_is_not_audio() {
        let path = scratch("payload.exe", b"MZ");
        let error = read_bounded(&path).expect_err("an exe is not an alert sound");
        assert_eq!(error.reason(), "name");
    }

    #[test]
    fn refuses_a_file_over_the_ceiling() {
        let path = scratch("big.wav", &vec![0u8; (MAX_BYTES + 1) as usize]);
        let error = read_bounded(&path).expect_err("over the ceiling");
        assert_eq!(error.reason(), "size");
    }

    #[test]
    fn keeps_a_file_exactly_at_the_ceiling() {
        let path = scratch("edge.wav", &vec![0u8; MAX_BYTES as usize]);
        assert!(read_bounded(&path).is_ok(), "the ceiling is inclusive");
    }

    #[test]
    fn says_which_sentence_to_show_rather_than_an_operating_system_message() {
        let missing = std::env::temp_dir().join("openradar-sound-tests/not-there.wav");
        let _ = std::fs::remove_file(&missing);
        let error = read_bounded(&missing).expect_err("a missing file");
        assert_eq!(error.reason(), "decode");

        let json = serde_json::to_value(&error).expect("serializes");
        assert_eq!(json["reason"], "decode");
        assert!(
            json["message"]
                .as_str()
                .is_some_and(|text| !text.is_empty()),
            "the log still gets the real reason"
        );
    }
}

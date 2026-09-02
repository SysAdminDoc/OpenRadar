//! What the small window is showing, held between the two windows.
//!
//! The workspace draws; this holds the last thing it drew. The glance window
//! reads it and nothing else: it fetches no radar, decodes no tiles and opens
//! no second map, which is the whole reason it can be a two-hundred-kilobyte
//! window beside a workspace that is not.
//!
//! In memory rather than on disk. It is a picture of the last few minutes and
//! it is worth nothing once the app has closed, so writing it down would be
//! keeping a record of what somebody was looking at for no benefit at all.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// One glance: the place, the state, and a still of the map.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Glance {
    /// The reader's own word for the place, or empty.
    pub place: String,
    /// Whether a warning stands there.
    pub warning: bool,
    /// The headline, when there is one.
    pub headline: String,
    /// A still of the map as a data URL, or empty.
    pub picture: String,
    /// When the frame it shows was observed, in milliseconds.
    pub observed_ms: Option<f64>,
    /// Who it came from.
    pub source: String,
    /// When the workspace wrote this.
    pub at: f64,
}

/// The most a still may weigh.
///
/// A 320-pixel-wide PNG of a radar frame is tens of kilobytes; this is the
/// ceiling for a busy one. It is held in memory and handed across an IPC
/// boundary twice a minute, so it is not a place to be generous.
const MAX_PICTURE: usize = 256 * 1024;

static HELD: Mutex<Option<Glance>> = Mutex::new(None);

/// The workspace saying what it is showing.
#[tauri::command]
pub fn glance_write(glance: Glance) -> Result<(), String> {
    let mut glance = glance;
    if glance.picture.len() > MAX_PICTURE {
        // Refused rather than truncated: half a data URL is a broken image,
        // and the rest of the glance is still worth showing.
        glance.picture = String::new();
    }
    *HELD.lock().unwrap_or_else(|held| held.into_inner()) = Some(glance);
    Ok(())
}

/// The small window asking what to show.
#[tauri::command]
pub fn glance_read() -> Option<Glance> {
    HELD.lock().unwrap_or_else(|held| held.into_inner()).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glance(picture: &str) -> Glance {
        Glance {
            place: "Casa".to_string(),
            warning: true,
            headline: "Tornado Warning".to_string(),
            picture: picture.to_string(),
            observed_ms: Some(1.0),
            source: "MRMS".to_string(),
            at: 2.0,
        }
    }

    #[test]
    fn what_goes_in_comes_out() {
        glance_write(glance("data:image/png;base64,AAAA")).expect("written");
        let held = glance_read().expect("something to show");
        assert_eq!(held.place, "Casa");
        assert!(held.warning);
        assert_eq!(held.picture, "data:image/png;base64,AAAA");
    }

    #[test]
    fn an_oversized_picture_is_dropped_rather_than_cut() {
        // Half a data URL is a broken image, and the words beside it are
        // still worth showing.
        let huge = format!("data:image/png;base64,{}", "A".repeat(MAX_PICTURE));
        glance_write(glance(&huge)).expect("written");
        let held = glance_read().expect("something to show");
        assert_eq!(held.picture, "");
        assert_eq!(held.headline, "Tornado Warning");
    }
}

//! Total lightning from the GOES Geostationary Lightning Mapper.
//!
//! NOAA publishes a small NetCDF-4 file every twenty seconds holding every
//! flash the satellite saw. This reads the flash centroids rather than the far
//! larger event and group tables: one mark per flash is what a map wants, and
//! it keeps a five-minute window inside a few thousand points.
//!
//! This is not a warning source. Cloud-to-ground strikes are what hurt people,
//! and GLM sees total lightning without telling the two apart. The panel says
//! so, and the NLDN density grid is the product to reach for instead.

use chrono::{DateTime, Datelike, Duration, NaiveDateTime, Timelike, Utc};
use netcdf_reader::{NcFile, NcMetadataMode, NcOpenOptions};
use serde::Serialize;

use crate::http;

/// GOES-East, which is the satellite that sees the whole country.
const BUCKET: &str = "https://noaa-goes19.s3.amazonaws.com";
const PRODUCT: &str = "GLM-L2-LCFA";
/// Long enough to show where a storm is active, short enough to stay current.
const WINDOW_MINUTES: i64 = 5;
/// One file every twenty seconds, so five minutes is fifteen of them.
const MAX_FILES: usize = 15;
/// A quiet file is a few hundred kilobytes; a busy one is under two megabytes.
const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
/// More than this on screen is a smear rather than a picture.
const MAX_FLASHES: usize = 20_000;
const MAX_FLASHES_PER_FILE: usize = 100_000;

#[derive(Debug, thiserror::Error)]
pub enum LightningError {
    #[error("the flash listing could not be read")]
    BadListing,
    #[error("no lightning files have been published in the last {0} minutes")]
    NoFiles(i64),
    #[error("the flash file could not be read: {0}")]
    Decode(String),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Serialize for LightningError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Flash {
    pub latitude: f32,
    pub longitude: f32,
    pub energy_joules: f32,
    pub area_square_km: f32,
    /// Seconds since the epoch, taken from the file the flash arrived in.
    pub time: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashWindow {
    pub satellite: String,
    pub window_minutes: i64,
    /// The newest file read, which is how fresh the picture is.
    pub observed: i64,
    pub flashes: Vec<Flash>,
    /// True when the cap trimmed the window, so the panel can say so.
    pub trimmed: bool,
}

/// `OR_GLM-L2-LCFA_G19_s20262420900000_e20262420900200_c20262420900214.nc`
pub fn key_time(key: &str) -> Option<i64> {
    let name = key.rsplit('/').next()?;
    let start = name.split('_').find(|part| part.starts_with('s'))?;
    // Year, day of year, hour, minute, second, tenth of a second.
    let digits = &start[1..];
    if digits.len() < 13 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let year: i32 = digits[0..4].parse().ok()?;
    let day: u32 = digits[4..7].parse().ok()?;
    let hour: u32 = digits[7..9].parse().ok()?;
    let minute: u32 = digits[9..11].parse().ok()?;
    let second: u32 = digits[11..13].parse().ok()?;
    let date = chrono::NaiveDate::from_yo_opt(year, day)?;
    Some(
        NaiveDateTime::new(date, chrono::NaiveTime::from_hms_opt(hour, minute, second)?)
            .and_utc()
            .timestamp(),
    )
}

fn listing_url(at: DateTime<Utc>) -> String {
    format!(
        "{BUCKET}/?list-type=2&prefix={PRODUCT}/{}/{:03}/{:02}/",
        at.year(),
        at.ordinal(),
        at.hour()
    )
}

/// Every key in a listing, with the time it covers.
pub fn keys_from_listing(listing: &str) -> Vec<(i64, String)> {
    let mut found = Vec::new();
    let mut rest = listing;
    while let Some(start) = rest.find("<Key>") {
        let after = &rest[start + 5..];
        let Some(end) = after.find("</Key>") else {
            break;
        };
        let key = &after[..end];
        if key.ends_with(".nc") {
            if let Some(time) = key_time(key) {
                found.push((time, key.to_string()));
            }
        }
        rest = &after[end + 6..];
    }
    found.sort_by_key(|(time, _)| *time);
    found
}

/// The files covering the last few minutes, newest last. The order the caller
/// happened to have them in does not decide which ones are kept.
pub fn recent_keys(mut keys: Vec<(i64, String)>, now: i64) -> Vec<String> {
    keys.sort_by_key(|(time, _)| *time);
    let cutoff = now - WINDOW_MINUTES * 60;
    let mut recent: Vec<String> = keys
        .into_iter()
        .filter(|(time, _)| *time >= cutoff && *time <= now + 60)
        .map(|(_, key)| key)
        .collect();
    if recent.len() > MAX_FILES {
        recent.drain(..recent.len() - MAX_FILES);
    }
    recent
}

/// Reads the flash centroids out of one file.
pub fn decode_flashes(bytes: &[u8], time: i64) -> Result<Vec<Flash>, LightningError> {
    if bytes.len() < 8 || bytes[..8] != *b"\x89HDF\r\n\x1a\n" {
        return Err(LightningError::Decode(
            "the file is not the NetCDF-4 the feed publishes".into(),
        ));
    }

    let file = NcFile::from_bytes_with_options(
        bytes,
        NcOpenOptions {
            metadata_mode: NcMetadataMode::Lossy,
            ..NcOpenOptions::default()
        },
    )
    .map_err(|error| LightningError::Decode(error.to_string()))?;

    let latitudes = read_variable(&file, "flash_lat")?;
    let longitudes = read_variable(&file, "flash_lon")?;
    let energies = read_variable(&file, "flash_energy")?;
    let areas = read_variable(&file, "flash_area")?;
    let quality = read_variable(&file, "flash_quality_flag")?;

    let count = latitudes.len();
    if count > MAX_FLASHES_PER_FILE {
        return Err(LightningError::Decode(format!(
            "the file holds {count} flashes, far more than the feed ever publishes"
        )));
    }
    if [longitudes.len(), energies.len(), areas.len(), quality.len()]
        .iter()
        .any(|length| *length != count)
    {
        return Err(LightningError::Decode(
            "the flash columns are different lengths".into(),
        ));
    }

    Ok((0..count)
        .filter_map(|index| {
            let latitude = latitudes[index] as f32;
            let longitude = longitudes[index] as f32;
            let energy_joules = energies[index] as f32;
            let area_square_km = areas[index] as f32;
            // Anything but zero means the instrument flagged the flash itself.
            (quality[index] == 0.0
                && latitude.is_finite()
                && longitude.is_finite()
                && energy_joules.is_finite()
                && area_square_km.is_finite()
                && (-90.0..=90.0).contains(&latitude)
                && (-180.0..=180.0).contains(&longitude))
            .then_some(Flash {
                latitude,
                longitude,
                energy_joules,
                area_square_km,
                time,
            })
        })
        .collect())
}

fn read_variable(file: &NcFile, name: &str) -> Result<Vec<f64>, LightningError> {
    // Energy and area arrive as packed unsigned shorts with a signed fill
    // value, and the reader's masking treats a valid high-bit value as fill.
    // Unpacking first and checking the quality flag afterwards is what keeps
    // real flashes from being thrown away.
    let values = file
        .read_variable_unpacked(name)
        .map_err(|error| LightningError::Decode(format!("{name}: {error}")))?;
    if values.ndim() != 1 {
        return Err(LightningError::Decode(format!(
            "{name} is not a single column"
        )));
    }
    Ok(values.iter().copied().collect())
}

/// The flashes GOES-East saw in the last few minutes.
#[tauri::command]
pub async fn lightning_flashes() -> Result<FlashWindow, LightningError> {
    let now = Utc::now();
    // A window that has just crossed the hour needs the previous folder too.
    let mut keys = Vec::new();
    for at in [now - Duration::hours(1), now] {
        let listing = http::get_bytes(&listing_url(at)).await?;
        let listing = String::from_utf8_lossy(&listing);
        if !listing.contains("<ListBucketResult") {
            return Err(LightningError::BadListing);
        }
        keys.extend(keys_from_listing(&listing));
    }
    keys.sort_by_key(|(time, _)| *time);
    keys.dedup_by(|left, right| left.1 == right.1);

    let wanted = recent_keys(keys, now.timestamp());
    if wanted.is_empty() {
        return Err(LightningError::NoFiles(WINDOW_MINUTES));
    }

    let mut flashes = Vec::new();
    let mut observed = 0i64;
    for key in &wanted {
        let time = key_time(key).unwrap_or_else(|| now.timestamp());
        let bytes = http::get_bytes(&format!("{BUCKET}/{key}")).await?;
        if bytes.len() > MAX_FILE_BYTES {
            continue;
        }
        // Decoding is CPU work and there are fifteen files, so it must not sit
        // on the async runtime.
        let decoded = tauri::async_runtime::spawn_blocking(move || decode_flashes(&bytes, time))
            .await
            .map_err(|error| LightningError::Decode(error.to_string()))??;
        observed = observed.max(time);
        flashes.extend(decoded);
    }

    // The newest flashes are the ones worth keeping when there are too many.
    flashes.sort_by_key(|flash| flash.time);
    let trimmed = flashes.len() > MAX_FLASHES;
    if trimmed {
        flashes.drain(..flashes.len() - MAX_FLASHES);
    }

    Ok(FlashWindow {
        satellite: "GOES-19 East".into(),
        window_minutes: WINDOW_MINUTES,
        observed,
        flashes,
        trimmed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_start_time_out_of_a_key() {
        // Day 242 of 2026 is the thirtieth of August.
        assert_eq!(
            key_time(
                "GLM-L2-LCFA/2026/242/09/OR_GLM-L2-LCFA_G19_s20262420900000_e20262420900200_c20262420900214.nc"
            ),
            Some(
                chrono::NaiveDate::from_ymd_opt(2026, 8, 30)
                    .unwrap()
                    .and_hms_opt(9, 0, 0)
                    .unwrap()
                    .and_utc()
                    .timestamp()
            )
        );
        assert!(key_time("GLM-L2-LCFA/2026/242/09/index.html").is_none());
        // A name with no start field at all.
        assert!(key_time("OR_GLM-L2-LCFA_G19.nc").is_none());
    }

    #[test]
    fn a_listing_address_names_the_day_of_the_year_and_the_hour() {
        let at = chrono::NaiveDate::from_ymd_opt(2026, 8, 30)
            .unwrap()
            .and_hms_opt(9, 14, 0)
            .unwrap()
            .and_utc();
        assert_eq!(
            listing_url(at),
            "https://noaa-goes19.s3.amazonaws.com/?list-type=2&prefix=GLM-L2-LCFA/2026/242/09/"
        );
    }

    #[test]
    fn keeps_only_the_files_inside_the_window() {
        let now = 1_788_083_202i64;
        // Deliberately newest first, because the order a listing arrives in
        // is not something this should depend on.
        let keys: Vec<(i64, String)> = (0..40)
            .map(|index| (now - index * 20, format!("file-{index}")))
            .collect();
        let recent = recent_keys(keys, now);
        // Five minutes of twenty second files, capped at fifteen.
        assert_eq!(recent.len(), MAX_FILES);
        // Newest last, which is the order the window is built in.
        assert_eq!(recent.last().map(String::as_str), Some("file-0"));
        assert!(!recent.iter().any(|key| key == "file-20"));
    }

    #[test]
    fn ignores_a_file_from_after_the_window_or_long_before_it() {
        let now = 1_788_083_202i64;
        let keys = vec![
            (now - 3600, "an hour ago".to_string()),
            (now - 60, "a minute ago".to_string()),
            (now + 600, "ten minutes from now".to_string()),
        ];
        assert_eq!(recent_keys(keys, now), vec!["a minute ago".to_string()]);
    }

    #[test]
    fn reads_keys_out_of_a_listing_in_order() {
        let listing = "<ListBucketResult>\
            <Contents><Key>GLM-L2-LCFA/2026/242/09/OR_GLM-L2-LCFA_G19_s20262420900200_e1_c1.nc</Key></Contents>\
            <Contents><Key>GLM-L2-LCFA/2026/242/09/OR_GLM-L2-LCFA_G19_s20262420900000_e1_c1.nc</Key></Contents>\
            <Contents><Key>GLM-L2-LCFA/2026/242/09/notes.txt</Key></Contents>\
            </ListBucketResult>";
        let keys = keys_from_listing(listing);
        assert_eq!(keys.len(), 2);
        assert!(keys[0].0 < keys[1].0);
        assert!(keys[1].1.contains("s20262420900200"));
    }

    #[test]
    fn refuses_anything_that_is_not_the_file_the_feed_publishes() {
        assert!(matches!(
            decode_flashes(b"not a netcdf file at all", 0),
            Err(LightningError::Decode(_))
        ));
        assert!(matches!(
            decode_flashes(b"", 0),
            Err(LightningError::Decode(_))
        ));
        // A classic NetCDF-3 file, which the feed does not publish.
        assert!(matches!(
            decode_flashes(b"CDF\x01\0\0\0\0", 0),
            Err(LightningError::Decode(_))
        ));
    }

    /// Talks to NOAA, so it is ignored with the other live tests.
    #[test]
    #[ignore = "fetches live flashes from the GOES archive"]
    fn reads_live_flashes_from_the_satellite() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        let started = std::time::Instant::now();
        let window = runtime
            .block_on(lightning_flashes())
            .expect("GOES publishes a flash file every twenty seconds");
        let took = started.elapsed();

        assert_eq!(window.window_minutes, WINDOW_MINUTES);
        // The newest file read must be inside the window it claims.
        let age = Utc::now().timestamp() - window.observed;
        assert!(
            age < WINDOW_MINUTES * 60 + 120,
            "the newest file is {age}s old"
        );
        assert!(window.flashes.len() <= MAX_FLASHES);

        // Somewhere on Earth is always having a thunderstorm, and the satellite
        // sees a third of the planet.
        assert!(
            !window.flashes.is_empty(),
            "five minutes of GOES-East with no lightning anywhere is not credible"
        );
        for flash in &window.flashes {
            assert!((-90.0..=90.0).contains(&flash.latitude));
            assert!((-180.0..=180.0).contains(&flash.longitude));
            assert!(flash.energy_joules.is_finite());
            assert!(flash.time > 0);
        }
        // GOES-East looks at the Americas, so the flashes cluster there rather
        // than being scattered over the whole globe.
        let western = window
            .flashes
            .iter()
            .filter(|flash| flash.longitude < 0.0)
            .count();
        assert!(
            western * 2 > window.flashes.len(),
            "only {western} of {} flashes were in the western hemisphere",
            window.flashes.len()
        );

        println!(
            "{} flashes in {WINDOW_MINUTES} min, fetched and decoded in {took:?}",
            window.flashes.len()
        );
        assert!(
            took < std::time::Duration::from_secs(30),
            "the window took {took:?}"
        );
    }
}

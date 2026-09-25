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
use futures_util::stream::{self, StreamExt as _};
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
    #[error("a lightning replay covers at most {0} hours, and a radius of more than nothing")]
    ReplaySpan(i64),
    #[error("none of the {0} flash files for that time could be read")]
    Unreadable(usize),
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
    /// The newest file actually read, which is how fresh the picture is.
    pub observed: i64,
    pub flashes: Vec<Flash>,
    /// True when the cap trimmed the window, so the panel can say so.
    pub trimmed: bool,
    /// How many of the files in the window were read, and how many there were.
    /// A window built from half its files is not the same picture as a whole
    /// one, and the panel says which it is looking at.
    pub files_read: usize,
    pub files_expected: usize,
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
    listing_url_in(BUCKET, at)
}

fn listing_url_in(bucket: &str, at: DateTime<Utc>) -> String {
    format!(
        "{bucket}/?list-type=2&prefix={PRODUCT}/{}/{:03}/{:02}/",
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

    // The reader is third-party code walking a container format designed for
    // scientific archives, over bytes a public server sent, and a fuzz target
    // found a 215-byte file that takes the process down inside it: the element
    // count comes out of a product of dimension sizes that overflows. With
    // debug assertions that is a panic, and without them it is a wrapped count
    // nothing checks, which is worse.
    //
    // It cannot be fixed where it happens, so it is contained here. Nothing
    // survives a panic in this block: the file, the columns and the reader all
    // go, and the caller is told the file could not be read, which is what a
    // corrupt download deserves anyway. The guard covers every panic in that
    // reader rather than the one that has been seen, because the interesting
    // property is that a malformed file cannot take the window down, not that
    // one particular malformed file cannot.
    let columns = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let file = NcFile::from_bytes_with_options(
            bytes,
            NcOpenOptions {
                metadata_mode: NcMetadataMode::Lossy,
                ..NcOpenOptions::default()
            },
        )
        .map_err(|error| LightningError::Decode(error.to_string()))?;

        Ok::<_, LightningError>([
            read_variable(&file, "flash_lat")?,
            read_variable(&file, "flash_lon")?,
            read_variable(&file, "flash_energy")?,
            read_variable(&file, "flash_area")?,
            read_variable(&file, "flash_quality_flag")?,
        ])
    }))
    .map_err(|_| {
        LightningError::Decode("the file is not readable as the NetCDF-4 the feed publishes".into())
    })??;
    let [latitudes, longitudes, energies, areas, quality] = columns;

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
            let flash = Flash {
                latitude: latitudes[index] as f32,
                longitude: longitudes[index] as f32,
                energy_joules: energies[index] as f32,
                area_square_km: areas[index] as f32,
                time,
            };
            keep_flash(&flash, quality[index]).then_some(flash)
        })
        .collect())
}

/// Whether a decoded row is a flash worth drawing.
///
/// The quality flag is the instrument's own verdict: anything but zero means
/// it does not stand behind the fix, and a bad fix on a map is worse than a
/// missing one. The rest guards against the packed fill values coming through
/// as real numbers, which is what putting a flash in the middle of the ocean
/// or off the edge of the world would look like.
pub fn keep_flash(flash: &Flash, quality_flag: f64) -> bool {
    quality_flag == 0.0
        && flash.latitude.is_finite()
        && flash.longitude.is_finite()
        && flash.energy_joules.is_finite()
        && flash.area_square_km.is_finite()
        && (-90.0..=90.0).contains(&flash.latitude)
        && (-180.0..=180.0).contains(&flash.longitude)
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
    let mut read = 0usize;
    for key in &wanted {
        let time = key_time(key).unwrap_or_else(|| now.timestamp());
        // One file that will not come or will not decode is a gap in the
        // window, not the end of the layer. A five minute window is fifteen
        // files and losing one of them is barely visible; losing all fifteen
        // because of one is not.
        let bytes = match http::get_bytes(&format!("{BUCKET}/{key}")).await {
            Ok(bytes) if bytes.len() <= MAX_FILE_BYTES => bytes,
            Ok(bytes) => {
                log::warn!("GLM file {key} is {} bytes, past the cap", bytes.len());
                continue;
            }
            Err(error) => {
                log::warn!("GLM file {key} could not be fetched: {error}");
                continue;
            }
        };
        // Decoding is CPU work and there are fifteen files, so it must not sit
        // on the async runtime.
        let decoded = tauri::async_runtime::spawn_blocking(move || decode_flashes(&bytes, time))
            .await
            .map_err(|error| LightningError::Decode(error.to_string()))?;
        match decoded {
            Ok(decoded) => {
                observed = observed.max(time);
                read += 1;
                flashes.extend(decoded);
            }
            Err(error) => log::warn!("GLM file {key} could not be read: {error}"),
        }
    }

    // Nothing readable at all is a failure, not an empty sky.
    if read == 0 {
        return Err(LightningError::NoFiles(WINDOW_MINUTES));
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
        files_read: read,
        files_expected: wanted.len(),
    })
}

/// GOES-16's bucket, which holds the lightning mapper's files from the years
/// it was GOES-East.
const GOES16_BUCKET: &str = "https://noaa-goes16.s3.amazonaws.com";

/// When GOES-19 took over as GOES-East: the seventh of April 2025. Both
/// buckets hold that whole day, so its first second is where one ends and the
/// other begins.
const GOES19_FROM: i64 = 1_743_984_000;

/// A file covers twenty seconds and is published once they are over, so a
/// moment can only have read a file that ended before it.
const FILE_SECONDS: i64 = 20;

/// The longest replay the history panel asks for is six hours. Twice that is
/// room for a longer one later and a ceiling on what a bad request can cost:
/// every hour is a hundred and eighty files of half a megabyte each.
const MAX_REPLAY_HOURS: i64 = 12;

/// How many files are fetched at once. The live window reads fifteen one after
/// another; a replay reads a thousand, and one at a time is ten minutes.
const REPLAY_CONCURRENCY: usize = 12;

/// Kept a little wider than the radius asked for, so the page's own distance,
/// worked out the same way the live watch works it out, decides the edge.
const REPLAY_MARGIN_MILES: f64 = 1.0;

const KM_PER_MILE: f64 = 1.609_344;

/// A watched place, as the replay is told it.
#[derive(Debug, Clone, Copy, serde::Deserialize)]
pub struct ReplayPoint {
    pub latitude: f64,
    pub longitude: f64,
}

/// One file of a replay: when it began, whether it was read, and how many
/// flashes it held anywhere, which is what the live window's cap is counted
/// against.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayFile {
    pub time: i64,
    pub read: bool,
    pub flashes: usize,
}

/// A flash near a watched place, with where it sat in its file. The live
/// window trims its oldest flashes when there are too many, and the order is
/// what lets a replay trim the same ones.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayFlash {
    #[serde(flatten)]
    pub flash: Flash,
    pub order: usize,
}

/// Every file over a replayed stretch, and the flashes in them that fell near
/// a watched place.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashReplay {
    pub satellite: String,
    pub window_minutes: i64,
    pub file_seconds: i64,
    pub max_files: usize,
    pub max_flashes: usize,
    pub files: Vec<ReplayFile>,
    pub flashes: Vec<ReplayFlash>,
}

/// Which bucket held GOES-East's lightning at a moment, and what it is called.
fn goes_east_at(time: i64) -> (&'static str, &'static str) {
    if time >= GOES19_FROM {
        (BUCKET, "GOES-19 East")
    } else {
        (GOES16_BUCKET, "GOES-16 East")
    }
}

/// The files a replay from `from` to `to` has to read, oldest first.
///
/// The watch at any moment reads the five minutes of files before it, and
/// only files that have finished, so the first moment needs files from five
/// minutes before the replay starts and the last needs none that end after it.
pub fn replay_keys(mut keys: Vec<(i64, String)>, from: i64, to: i64) -> Vec<(i64, String)> {
    keys.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    keys.dedup_by(|left, right| left.1 == right.1);
    keys.retain(|(time, _)| *time >= from - WINDOW_MINUTES * 60 && *time + FILE_SECONDS <= to);
    keys
}

fn distance_km(from: ReplayPoint, latitude: f64, longitude: f64) -> f64 {
    let lat1 = from.latitude.to_radians();
    let lat2 = latitude.to_radians();
    let d_lat = lat2 - lat1;
    let d_lon = (longitude - from.longitude).to_radians();
    let a = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);
    6371.0 * 2.0 * a.sqrt().asin()
}

/// The flashes of one file that fell within a radius of any watched place,
/// each with its place in the file.
pub fn flashes_near(
    flashes: &[Flash],
    points: &[ReplayPoint],
    radius_miles: f64,
) -> Vec<ReplayFlash> {
    let reach_km = (radius_miles + REPLAY_MARGIN_MILES) * KM_PER_MILE;
    flashes
        .iter()
        .enumerate()
        .filter(|(_, flash)| {
            points.iter().any(|point| {
                distance_km(
                    *point,
                    f64::from(flash.latitude),
                    f64::from(flash.longitude),
                ) <= reach_km
            })
        })
        .map(|(order, flash)| ReplayFlash {
            flash: *flash,
            order,
        })
        .collect()
}

/// Every flash GOES-East saw near the watched places over a stretch of the
/// past, for replaying the lightning watch.
///
/// Only the flashes near a place come back: an hour is a hundred megabytes of
/// files and the page needs a few hundred points out of them. With them comes
/// every file's time, whether it was read, and how many flashes it held in
/// all, which is what the page needs to build the window the live watch would
/// have read at each moment, cap and gaps included.
///
/// The files are fetched without keeping a copy. A replay reads a thousand of
/// them once, and the shared cache holds two thousand entries: keeping these
/// would flush the tiles and grids the offline view is made of.
#[tauri::command]
pub async fn lightning_replay(
    from: i64,
    to: i64,
    points: Vec<ReplayPoint>,
    radius_miles: f64,
) -> Result<FlashReplay, LightningError> {
    if to < from || to - from > MAX_REPLAY_HOURS * 3600 {
        return Err(LightningError::ReplaySpan(MAX_REPLAY_HOURS));
    }
    if !radius_miles.is_finite() || radius_miles <= 0.0 {
        return Err(LightningError::ReplaySpan(MAX_REPLAY_HOURS));
    }

    // One listing per hour folder, from the one holding the first file the
    // first moment reads to the one holding the last moment.
    let first = from - WINDOW_MINUTES * 60;
    let mut listed: Vec<(i64, String)> = Vec::new();
    let mut satellites: Vec<&'static str> = Vec::new();
    let mut hour = first - first.rem_euclid(3600);
    while hour <= to {
        let at = DateTime::<Utc>::from_timestamp(hour, 0).ok_or(LightningError::BadListing)?;
        let (bucket, satellite) = goes_east_at(hour);
        if !satellites.contains(&satellite) {
            satellites.push(satellite);
        }
        let listing = http::get_bytes(&listing_url_in(bucket, at)).await?;
        let listing = String::from_utf8_lossy(&listing);
        if !listing.contains("<ListBucketResult") {
            return Err(LightningError::BadListing);
        }
        // The whole address rather than the key, because the handover day
        // puts two buckets in one replay.
        for (time, key) in keys_from_listing(&listing) {
            listed.push((time, format!("{bucket}/{key}")));
        }
        hour += 3600;
    }
    // An archive with nothing for the stretch is an answer rather than a
    // failure: GOES-16's files start in 2018, and a storm before that had no
    // lightning mapper over it at all.
    let wanted = replay_keys(listed, from, to);
    let expected = wanted.len();

    // A file that will not come or will not decode is a gap in the replay,
    // as it is in the live window, and the page builds its windows around it.
    let fetched: Vec<(ReplayFile, Vec<ReplayFlash>)> =
        stream::iter(wanted.into_iter().map(|(time, key)| {
            let points = points.clone();
            async move {
                let missing = ReplayFile {
                    time,
                    read: false,
                    flashes: 0,
                };
                let bytes = match http::get_bytes_uncached(&key).await {
                    Ok(bytes) if bytes.len() <= MAX_FILE_BYTES => bytes,
                    Ok(bytes) => {
                        log::warn!("GLM file {key} is {} bytes, past the cap", bytes.len());
                        return (missing, Vec::new());
                    }
                    Err(error) => {
                        log::warn!("GLM file {key} could not be fetched: {error}");
                        return (missing, Vec::new());
                    }
                };
                let decoded = tauri::async_runtime::spawn_blocking(move || {
                    decode_flashes(&bytes, time).map(|flashes| {
                        (flashes.len(), flashes_near(&flashes, &points, radius_miles))
                    })
                })
                .await
                .map_err(|error| LightningError::Decode(error.to_string()))
                .and_then(|decoded| decoded);
                match decoded {
                    Ok((count, near)) => (
                        ReplayFile {
                            time,
                            read: true,
                            flashes: count,
                        },
                        near,
                    ),
                    Err(error) => {
                        log::warn!("GLM file {key} could not be read: {error}");
                        (missing, Vec::new())
                    }
                }
            }
        }))
        .buffer_unordered(REPLAY_CONCURRENCY)
        .collect()
        .await;

    let mut files = Vec::with_capacity(fetched.len());
    let mut flashes = Vec::new();
    for (file, near) in fetched {
        files.push(file);
        flashes.extend(near);
    }
    if expected > 0 && !files.iter().any(|file| file.read) {
        return Err(LightningError::Unreadable(expected));
    }
    files.sort_by_key(|file| file.time);
    flashes.sort_by_key(|near| (near.flash.time, near.order));

    Ok(FlashReplay {
        satellite: satellites.join(" and "),
        window_minutes: WINDOW_MINUTES,
        file_seconds: FILE_SECONDS,
        max_files: MAX_FILES,
        max_flashes: MAX_FLASHES,
        files,
        flashes,
    })
}

#[cfg(test)]
mod tests {
    /// A file the fuzzer found that takes the process down.
    ///
    /// 215 bytes, and it passes the HDF5 magic check the decoder opens with,
    /// which is as far as anything of ours gets to look before the reader
    /// takes over. Somewhere in the dimension arithmetic below that, the
    /// element count is worked out as a product that overflows: a panic with
    /// debug assertions on, and a wrapped count without them, which is worse
    /// because nothing says anything went wrong.
    ///
    /// Committed as `fuzz/reproducers/netcdf-flashes-multiply-overflow.bin`
    /// and read from there rather than pasted in, so the file the fuzzer
    /// produced and the file this checks cannot drift apart.
    /// Set on the child this test spawns, and on nothing else.
    const DEEP_CHILD: &str = "OPENRADAR_NETCDF_DEEP_CHILD";
    /// Where the child should send a crash, when the parent is listening.
    const DEEP_SOCKET: &str = "OPENRADAR_NETCDF_DEEP_SOCKET";

    /// The fuzzer's other find on this path, which nothing here can contain.
    ///
    /// 202 bytes that send the reader into unbounded recursion. A stack
    /// overflow is not a panic: `catch_unwind` never sees it, Windows raises
    /// it as an access violation or STATUS_STACK_OVERFLOW, and the process is
    /// gone. It is upstream's to fix, and it is written down in
    /// `Roadmap_Blocked.md` with this reproducer beside it.
    ///
    /// So the bytes are run in a child process, and what is asserted is that
    /// the child dies. That keeps the case checked on every run without the
    /// suite dying with it, and the day the reader stops recursing this test
    /// fails and says to promote it to an ordinary one.
    #[test]
    fn a_file_that_nests_too_deep_takes_the_reader_down_and_is_upstreams() {
        let bytes = std::fs::read("fuzz/reproducers/netcdf-flashes-access-violation.bin")
            .expect("the committed reproducer");

        if std::env::var(DEEP_CHILD).is_ok() {
            // The child. Reaching the line after this is the interesting
            // outcome, and the parent reads it from the exit status.
            //
            // It attaches to the monitor the parent is running first, so the
            // fault leaves a file behind rather than only an exit code. The
            // handler is forgotten rather than dropped: dropping it takes it
            // back off before the crash it was installed for.
            if let Ok(socket) = std::env::var(DEEP_SOCKET) {
                if let Some(handler) = crate::crash::attach_to(std::path::Path::new(&socket)) {
                    std::mem::forget(handler);
                }
            }
            let _ = decode_flashes(&bytes, 1_756_600_000);
            return;
        }

        // The monitor, on a thread here rather than in a process of its own:
        // the same arrangement the app uses with the parts swapped round, and
        // the test binary cannot be started as one because its entry point is
        // the harness rather than ours.
        let room = std::env::temp_dir().join(format!("openradar-crash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&room);
        std::fs::create_dir_all(&room).expect("a directory");
        let socket = room.join("crash.sock");
        let dumps = room.join("dumps");
        let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let monitor = {
            let (socket, dumps, shutdown) = (socket.clone(), dumps.clone(), shutdown.clone());
            std::thread::spawn(move || crate::crash::serve(&socket, &dumps, &shutdown))
        };
        // The client cannot connect until the listener is up.
        for _ in 0..100 {
            if socket.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        let status = std::process::Command::new(
            std::env::current_exe().expect("this test binary"),
        )
        .args([
            "lightning::tests::a_file_that_nests_too_deep_takes_the_reader_down_and_is_upstreams",
            "--exact",
            "--test-threads=1",
        ])
        .env(DEEP_CHILD, "1")
        .env(DEEP_SOCKET, &socket)
        .output()
        .expect("the child runs");

        assert!(
            !status.status.success(),
            "the reader survived a file that used to take it down. Upstream \
             has fixed the recursion: turn this into an ordinary test that \
             asserts an error, and take the entry out of Roadmap_Blocked.md.",
        );

        // And it left something behind. Before this, a reader whose window
        // vanished had an exit code nobody sees and nothing to send.
        let mut wrote = None;
        for _ in 0..250 {
            if let Some(record) = crate::crash::latest(&dumps) {
                if record.bytes > 0 {
                    wrote = Some(record);
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        shutdown.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = monitor.join();

        let record = wrote.expect("the crash left a dump behind");
        assert!(record.path.ends_with(".dmp"), "{}", record.path);
        // A minidump has a header before anything else; a file that exists
        // and holds nothing is the failure this is watching for.
        let written = std::fs::read(&record.path).expect("the dump");
        assert!(written.len() > 1024, "{} bytes", written.len());
        assert_eq!(&written[..4], b"MDMP", "not a minidump");

        let _ = std::fs::remove_dir_all(&room);
    }

    #[test]
    fn a_malformed_lightning_file_is_refused_rather_than_fatal() {
        let bytes = std::fs::read("fuzz/reproducers/netcdf-flashes-multiply-overflow.bin")
            .expect("the committed reproducer");
        assert!(decode_flashes(&bytes, 1_756_600_000).is_err());
    }

    use super::*;

    fn flash(latitude: f32, longitude: f32) -> Flash {
        Flash {
            latitude,
            longitude,
            energy_joules: 1.2e-14,
            area_square_km: 128.0,
            time: 1_788_083_202,
        }
    }

    #[test]
    fn keeps_only_the_flashes_the_instrument_stands_behind() {
        assert!(keep_flash(&flash(27.5, -83.5), 0.0));

        // Every non-zero flag is a flash the instrument itself doubted.
        for flag in [1.0, 3.0, 5.0, -1.0] {
            assert!(
                !keep_flash(&flash(27.5, -83.5), flag),
                "a flash flagged {flag} was drawn anyway"
            );
        }
    }

    #[test]
    fn throws_out_a_fill_value_that_came_through_as_a_number() {
        // What an unpacked fill value looks like once it is a float.
        assert!(!keep_flash(&flash(f32::NAN, -83.5), 0.0));
        assert!(!keep_flash(&flash(27.5, f32::INFINITY), 0.0));
        assert!(!keep_flash(&flash(900.0, -83.5), 0.0));
        assert!(!keep_flash(&flash(27.5, -999.0), 0.0));

        let mut odd = flash(27.5, -83.5);
        odd.energy_joules = f32::NAN;
        assert!(!keep_flash(&odd, 0.0));
        odd = flash(27.5, -83.5);
        odd.area_square_km = f32::NEG_INFINITY;
        assert!(!keep_flash(&odd, 0.0));

        // The corners of the world are real places.
        assert!(keep_flash(&flash(90.0, 180.0), 0.0));
        assert!(keep_flash(&flash(-90.0, -180.0), 0.0));
    }

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
        assert!(window.files_read > 0);
        assert!(window.files_read <= window.files_expected);
        assert!(window.observed > 0, "a window with files read has a time");
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
    #[test]
    fn a_replay_reads_the_five_minutes_before_it_and_nothing_that_ends_after_it() {
        let from = 1_664_391_600i64;
        let to = from + 600;
        // Every file from ten minutes before to ten minutes after, newest
        // first, with one listed twice, which the handover day does.
        let mut keys: Vec<(i64, String)> = (-30..=60)
            .rev()
            .map(|step| (from + step * 20, format!("file{step:+}")))
            .collect();
        keys.push((from, "file+0".to_string()));
        let wanted = replay_keys(keys, from, to);
        // The first moment reads back five minutes.
        assert_eq!(wanted.first().map(|(time, _)| *time), Some(from - 300));
        // The last reads only a file that had finished by then.
        assert_eq!(wanted.last().map(|(time, _)| *time), Some(to - 20));
        assert!(wanted.windows(2).all(|pair| pair[0].0 < pair[1].0));
        assert_eq!(wanted.len(), 15 + 30);
    }

    #[test]
    fn a_replay_asks_the_satellite_that_was_goes_east_then() {
        assert_eq!(goes_east_at(GOES19_FROM - 1).1, "GOES-16 East");
        assert_eq!(goes_east_at(GOES19_FROM).1, "GOES-19 East");
        assert!(goes_east_at(GOES19_FROM - 1).0.contains("noaa-goes16"));
        assert!(goes_east_at(GOES19_FROM).0.contains("noaa-goes19"));
        // Both addresses are ones the native side may reach.
        for time in [GOES19_FROM - 1, GOES19_FROM] {
            let (bucket, _) = goes_east_at(time);
            let at = DateTime::<Utc>::from_timestamp(time, 0).unwrap();
            let url = reqwest::Url::parse(&listing_url_in(bucket, at)).unwrap();
            assert!(crate::http::is_allowed(&url), "{url} is refused");
        }
    }

    #[test]
    fn a_replay_keeps_the_flashes_near_a_place_and_where_they_sat_in_the_file() {
        let place = ReplayPoint {
            latitude: 26.64,
            longitude: -81.87,
        };
        let at = |latitude: f32, longitude: f32| Flash {
            latitude,
            longitude,
            energy_joules: 1.0,
            area_square_km: 1.0,
            time: 7,
        };
        // A tenth of a degree of latitude is about seven miles, so with ten
        // asked for the second is in, the third is past the mile of slack at
        // about twelve, and the fourth is on the other side of the continent.
        // The last is ten and a half miles out: past the radius and inside
        // the slack, which is there so the page's own distance decides it.
        let file = [
            at(26.64, -81.87),
            at(26.74, -81.87),
            at(26.81, -81.87),
            at(40.0, -100.0),
            at(26.60, -81.90),
            at(26.792, -81.87),
        ];
        let near = flashes_near(&file, &[place], 10.0);
        assert_eq!(
            near.iter().map(|flash| flash.order).collect::<Vec<_>>(),
            vec![0, 1, 4, 5]
        );
        // A second place brings in what is near it, and nothing twice.
        let far = ReplayPoint {
            latitude: 40.0,
            longitude: -100.0,
        };
        assert_eq!(flashes_near(&file, &[place, far], 10.0).len(), 5);
        assert!(flashes_near(&file, &[], 10.0).is_empty());
    }

    #[test]
    fn a_replay_refuses_a_stretch_it_would_not_ask_for() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let point = ReplayPoint {
            latitude: 26.64,
            longitude: -81.87,
        };
        for (from, to, radius) in [
            (1_000, 0, 10.0),
            (0, MAX_REPLAY_HOURS * 3600 + 1, 10.0),
            (0, 600, 0.0),
            (0, 600, f64::NAN),
        ] {
            assert!(matches!(
                runtime.block_on(lightning_replay(from, to, vec![point], radius)),
                Err(LightningError::ReplaySpan(_))
            ));
        }
    }

    /// Talks to NOAA, so it is ignored with the other live tests.
    #[test]
    #[ignore = "fetches past flashes from the GOES-16 archive"]
    fn replays_the_lightning_at_ians_landfall() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        // Ian came ashore at Cayo Costa at about 19:05 UTC on the 28th of
        // September 2022, under GOES-16.
        let from = chrono::NaiveDate::from_ymd_opt(2022, 9, 28)
            .unwrap()
            .and_hms_opt(19, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp();
        let fort_myers = ReplayPoint {
            latitude: 26.64,
            longitude: -81.87,
        };
        let started = std::time::Instant::now();
        let replay = runtime
            .block_on(lightning_replay(from, from + 600, vec![fort_myers], 25.0))
            .expect("the archive holds GOES-16's files for that day");
        let took = started.elapsed();

        assert_eq!(replay.satellite, "GOES-16 East");
        // Five minutes before and ten after, a file every twenty seconds,
        // the last of them ending as the stretch does.
        assert_eq!(replay.files.len(), 45, "{:?}", replay.files.first());
        assert!(replay.files.iter().all(|file| file.read));
        assert!(replay.files.iter().all(|file| file.flashes > 0));
        assert!(
            !replay.flashes.is_empty(),
            "no flashes near Fort Myers at landfall"
        );
        for near in &replay.flashes {
            let miles = distance_km(
                fort_myers,
                f64::from(near.flash.latitude),
                f64::from(near.flash.longitude),
            ) / KM_PER_MILE;
            assert!(miles <= 26.0, "a flash {miles} miles out came back");
            assert!(replay.files.iter().any(|file| file.time == near.flash.time));
        }
        println!(
            "{} flashes near Fort Myers from {} files in {took:?}",
            replay.flashes.len(),
            replay.files.len()
        );
    }
}

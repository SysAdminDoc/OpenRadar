//! Bytes to a scan, and the two caches that keep it from happening twice.

use super::*;

pub(crate) fn cached(key: &str) -> Option<Vec<u8>> {
    let cache = CACHE.lock().ok()?;
    cache
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| entry.data.clone())
}

pub(crate) fn remember(key: &str, data: &[u8]) {
    let Ok(mut cache) = CACHE.lock() else {
        return;
    };
    if cache.iter().any(|entry| entry.key == key) {
        return;
    }
    cache.push_back(CachedVolume {
        key: key.to_string(),
        data: data.to_vec(),
    });
    while cache.len() > CACHE_CAPACITY {
        cache.pop_front();
    }
}

/// A volume as a scan, decoding it only if it has not been decoded already.
///
/// Every product and every tilt of one volume is the same scan looked at
/// differently, so a reader walking up the tilts was paying for the whole
/// decode once per step, and paying for the folding velocities again on top of
/// it. This is the one place a volume becomes a scan.
///
/// Only finished volumes reach here. The one the radar is sweeping now is
/// assembled from chunks and is a different thing under the same site's name:
/// it holds fewer cuts, it changes every few seconds, and caching it under the
/// volume's own key would let a partial sweep be served as the finished one.
pub(crate) fn decoded_volume(key: &str, data: Vec<u8>) -> Result<Decoded, Level2Error> {
    decode_volume(key, data, true)
}

/// The same decode, taking a hit but never leaving one behind.
///
/// For a caller that reads a volume once and is done with it. The wind
/// profile asks for as many volumes as the decoded cache holds, so keeping
/// them evicted whatever the map was drawing and the next tilt or threshold
/// change on that frame decoded the whole volume again. Taking the hit still
/// matters: the newest column is usually the volume on screen, and that one
/// should cost nothing.
pub(crate) fn decoded_volume_once(key: &str, data: Vec<u8>) -> Result<Decoded, Level2Error> {
    decode_volume(key, data, false)
}

pub(crate) fn decode_volume(key: &str, data: Vec<u8>, keep: bool) -> Result<Decoded, Level2Error> {
    if let Some(hit) = decoded_hit(key) {
        return Ok(hit);
    }

    let source_bytes = data.len();
    // Older Archive II downloads may wrap the whole volume in gzip. Modern
    // volumes instead bzip each LDM record, which File::scan handles itself.
    let file = normalized_volume(data)?;
    let scan = Arc::new(
        file.scan()
            .map_err(|error| Level2Error::Decode(error.to_string()))?,
    );
    // One pass for every cut's folding velocity, rather than one pass per cut
    // asked about. A volume whose records will not read still decodes: without
    // the table there is no unfolding, which is a worse picture and not a
    // failure.
    let nyquist = Arc::new(
        file.records()
            .map(|records| nyquist_table(&records))
            .unwrap_or_default(),
    );
    DECODES.fetch_add(1, Ordering::Relaxed);
    if keep {
        remember_decoded(key, &scan, &nyquist, source_bytes);
    }
    Ok((scan, nyquist))
}

/// The Archive II volume header, which every file has to begin with.
///
/// `nexrad-data` slices past this without checking that there is anything
/// behind it: `File::records` does `&bytes[size_of::<Header>()..]`, so a file
/// shorter than the header panics with "range start index 24 out of range"
/// rather than returning an error. This runs inside a Tauri command, where a
/// panic is worse than an error: the promise never settles either way, so the
/// panel waits forever on a file that will never open.
///
/// A reader can hand over any file on their machine through the local Archive
/// II picker, so this is reachable by pointing it at anything small. The
/// length is checked here, once, on the way in to every path.
pub(crate) const ARCHIVE_HEADER_BYTES: usize = 24;

pub(crate) fn normalized_volume(data: Vec<u8>) -> Result<volume::File, Level2Error> {
    if !data.starts_with(&[0x1f, 0x8b]) {
        return checked_volume(data);
    }

    let decoder = flate2::read::GzDecoder::new(data.as_slice());
    let mut limited = decoder.take(EXPANDED_VOLUME_MAX_BYTES + 1);
    let mut expanded = Vec::new();
    limited
        .read_to_end(&mut expanded)
        .map_err(|error| Level2Error::Decode(error.to_string()))?;
    if expanded.len() as u64 > EXPANDED_VOLUME_MAX_BYTES {
        return Err(Level2Error::Decode(
            "the expanded volume is larger than 256 MB".to_string(),
        ));
    }
    checked_volume(expanded)
}

/// One volume's bytes, all the way through the parser to a scan.
///
/// The whole Archive II path in one call, for a fuzz target: the gzip wrapper
/// if there is one, the length guard, the LDM records, the bzip inside each of
/// them, and every message the records hold. Rendering is deliberately not
/// part of it. Drawing a sweep is a megapixel of work per call and the bugs
/// worth finding here are in the length arithmetic that runs first.
///
/// The app itself never calls it: it asks for a sweep, not a whole scan. So
/// it is compiled only where something does, rather than sitting in a shipped
/// binary as a function with no callers.
#[cfg(any(test, feature = "fuzzing"))]
pub fn scan_volume(data: Vec<u8>) -> Result<Scan, Level2Error> {
    normalized_volume(data)?
        .scan()
        .map_err(|error| Level2Error::Decode(error.to_string()))
}

pub(crate) fn checked_volume(data: Vec<u8>) -> Result<volume::File, Level2Error> {
    if data.len() < ARCHIVE_HEADER_BYTES {
        return Err(Level2Error::Decode(format!(
            "the file is {} bytes, which is shorter than an Archive II header",
            data.len()
        )));
    }
    Ok(volume::File::new(data))
}

pub(crate) struct LocalVolume {
    pub(crate) station: String,
    pub(crate) key: String,
    pub(crate) label: String,
    pub(crate) data: Vec<u8>,
}

pub(crate) fn read_local_volume(path: &Path) -> Result<LocalVolume, Level2Error> {
    let file = FsFile::open(path).map_err(|error| Level2Error::LocalRead(error.to_string()))?;
    let size = file
        .metadata()
        .map_err(|error| Level2Error::LocalRead(error.to_string()))?
        .len();
    if size > LOCAL_VOLUME_MAX_BYTES {
        return Err(Level2Error::LocalTooLarge);
    }

    let mut data = Vec::with_capacity(size as usize);
    file.take(LOCAL_VOLUME_MAX_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|error| Level2Error::LocalRead(error.to_string()))?;
    if data.len() as u64 > LOCAL_VOLUME_MAX_BYTES {
        return Err(Level2Error::LocalTooLarge);
    }

    let file = normalized_volume(data)?;
    let station = file
        .header()
        .and_then(|header| header.icao_of_radar())
        .map(|id| id.to_ascii_uppercase())
        .ok_or_else(|| {
            Level2Error::Decode("the Archive II header does not name a radar".to_string())
        })?;
    wsr88d_only(&station)?;

    let data = file.data().to_vec();
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    let key = format!("local:{:016x}", hasher.finish());
    let label = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Archive II file")
        .to_string();
    Ok(LocalVolume {
        station,
        key,
        label,
        data,
    })
}

pub(crate) fn decoded_hit(key: &str) -> Option<Decoded> {
    let decoded = DECODED.lock().ok()?;
    decoded
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| (Arc::clone(&entry.scan), Arc::clone(&entry.nyquist)))
}

pub(crate) fn remember_decoded(
    key: &str,
    scan: &Arc<Scan>,
    nyquist: &Arc<BTreeMap<u8, f32>>,
    source_bytes: usize,
) {
    let Ok(mut decoded) = DECODED.lock() else {
        return;
    };
    if decoded.iter().any(|entry| entry.key == key) {
        return;
    }
    decoded.push_back(DecodedVolume {
        key: key.to_string(),
        scan: Arc::clone(scan),
        nyquist: Arc::clone(nyquist),
        source_bytes,
    });
    // Oldest first, on either limit, and never the one just put in: a single
    // volume larger than the whole budget is still the one being drawn.
    while decoded.len() > DECODED_CAPACITY
        || (decoded.len() > 1
            && decoded
                .iter()
                .map(|entry| entry.source_bytes)
                .sum::<usize>()
                > DECODED_BUDGET_BYTES)
    {
        decoded.pop_front();
    }
}

#[cfg(test)]
pub fn clear_cache() {
    if let Ok(mut cache) = CACHE.lock() {
        cache.clear();
    }
    if let Ok(mut decoded) = DECODED.lock() {
        decoded.clear();
    }
}

/// How many volumes have been decoded, for tests that care that one was not.
#[cfg(test)]
pub fn decode_count() -> usize {
    DECODES.load(Ordering::Relaxed)
}

/// How many decoded volumes are being held.
#[cfg(test)]
pub fn decoded_len() -> usize {
    DECODED.lock().map(|decoded| decoded.len()).unwrap_or(0)
}

/// What the volume cache is holding, in bytes.
#[cfg(test)]
pub fn cached_bytes() -> usize {
    CACHE
        .lock()
        .map(|cache| cache.iter().map(|entry| entry.data.len()).sum())
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "decode_tests.rs"]
mod tests;

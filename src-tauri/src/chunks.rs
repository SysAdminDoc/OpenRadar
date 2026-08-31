//! The volume being scanned right now, rather than the one that finished.
//!
//! The archive object for a volume lands only once the radar has finished
//! sweeping it, so a single-site view built from the archive is four to six
//! minutes behind by definition, and worst at exactly the moment somebody is
//! watching a storm develop. The same data is also published in pieces as the
//! radar produces them, every eleven or twelve seconds, to a second bucket.
//!
//! A volume there is a numbered folder holding a start chunk with the volume
//! header, then intermediate chunks, then an end chunk. The folders cycle from
//! one to nine hundred and ninety-nine and are reused, so which one is current
//! is a question about upload times rather than about names.
//!
//! What comes out is the same `Scan` the archive path produces, so everything
//! downstream is unchanged: the same sweep chooser, the same unfolding, the
//! same drawing. What is different is how much of it there is. A volume in
//! progress has the tilts the radar has swept so far and no more.

use std::collections::BTreeMap;
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use nexrad_data::aws::realtime::Chunk;
use nexrad_model::data::Scan;

use crate::http;
use crate::level2;

const BUCKET: &str = "https://unidata-nexrad-level2-chunks.s3.amazonaws.com";

/// The folders cycle through this many before starting again.
const VOLUMES: u32 = 999;

/// How old the newest chunk may be before the volume is a finished one rather
/// than one in progress.
///
/// A chunk arrives every eleven or twelve seconds while a volume is being
/// swept, so a gap of a minute means the radar has moved on.
const LIVE_SECONDS: i64 = 60;

#[derive(Debug, thiserror::Error)]
pub enum ChunkError {
    #[error("the chunk listing for {0} could not be read")]
    BadListing(String),
    #[error("{0} is not publishing chunks right now")]
    NotLive(String),
    #[error("the chunks could not be assembled: {0}")]
    Assemble(String),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

/// One chunk in the bucket: `KTLX/114/20260830-161604-017-I`.
#[derive(Debug, Clone, PartialEq)]
pub struct ChunkKey {
    pub key: String,
    pub uploaded: DateTime<Utc>,
}

/// The keys and upload times in one listing, newest last.
///
/// The listing carries both, which is the whole reason this reads the XML
/// rather than the key: the name says when the volume started, and what is
/// wanted is when the chunk arrived.
pub fn chunks_in_listing(listing: &str) -> Vec<ChunkKey> {
    let mut out = Vec::new();
    let mut rest = listing;
    while let Some(start) = rest.find("<Contents>") {
        let after = &rest[start..];
        let Some(end) = after.find("</Contents>") else {
            break;
        };
        let entry = &after[..end];
        rest = &after[end..];

        let Some(key) = between(entry, "<Key>", "</Key>") else {
            continue;
        };
        // A folder marker rather than a chunk.
        if key.ends_with('/') {
            continue;
        }
        let Some(when) = between(entry, "<LastModified>", "</LastModified>") else {
            continue;
        };
        let Ok(uploaded) = DateTime::parse_from_rfc3339(when) else {
            continue;
        };
        out.push(ChunkKey {
            key: key.to_string(),
            uploaded: uploaded.with_timezone(&Utc),
        });
    }
    out.sort_by(|left, right| left.key.cmp(&right.key));
    out
}

fn between<'a>(text: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = text.find(open)? + open.len();
    let end = text[start..].find(close)? + start;
    Some(&text[start..end])
}

async fn listing(station: &str, volume: u32, most: usize) -> Result<Vec<ChunkKey>, ChunkError> {
    let url = format!("{BUCKET}/?list-type=2&prefix={station}/{volume}/&max-keys={most}");
    let body = http::get_bytes(&url).await?;
    let body = String::from_utf8_lossy(&body);
    if !body.contains("<ListBucketResult") {
        return Err(ChunkError::BadListing(station.to_string()));
    }
    Ok(chunks_in_listing(&body))
}

/// Which numbered folder the radar is filling now.
///
/// The folders are a ring: nine hundred and ninety-nine of them, reused in
/// order, so their upload times run up and then wrap. Reading all of them
/// would be a thousand requests every few minutes for a number that changes
/// once a scan, so this walks backward from the last one it knew about and
/// falls back to a coarse sweep when it has nothing to go on.
pub async fn newest_volume(
    station: &str,
    known: Option<u32>,
) -> Result<(u32, Vec<ChunkKey>), ChunkError> {
    // Somewhere near where it was last time: a scan is one folder, so the next
    // few forward and the last few back cover any gap short of an outage.
    if let Some(known) = known {
        let mut best: Option<(u32, Vec<ChunkKey>, DateTime<Utc>)> = None;
        for step in 0..6u32 {
            let volume = wrap(known + step);
            let found = listing(station, volume, 200).await?;
            let Some(newest) = found.iter().map(|chunk| chunk.uploaded).max() else {
                continue;
            };
            if best.as_ref().is_none_or(|(_, _, held)| newest > *held) {
                best = Some((volume, found, newest));
            }
        }
        if let Some((volume, found, newest)) = best {
            if (Utc::now() - newest).num_seconds() <= LIVE_SECONDS * 10 {
                return Ok((volume, found));
            }
        }
    }

    // Nothing to go on. Sample the ring coarsely for the folder with the
    // newest upload, then look either side of it.
    let mut best: Option<(u32, DateTime<Utc>)> = None;
    for volume in (1..=VOLUMES).step_by(50) {
        let found = listing(station, volume, 1).await?;
        let Some(newest) = found.first().map(|chunk| chunk.uploaded) else {
            continue;
        };
        if best.as_ref().is_none_or(|(_, held)| newest > *held) {
            best = Some((volume, newest));
        }
    }
    let Some((around, _)) = best else {
        return Err(ChunkError::NotLive(station.to_string()));
    };

    // Then forward from there while the folders keep getting newer, and stop
    // at the first that does not. The sample lands within fifty of the current
    // folder, and walking the whole fifty every time would be fifty requests
    // for a number that moves once a scan.
    let mut found_best: Option<(u32, Vec<ChunkKey>, DateTime<Utc>)> = None;
    let mut misses = 0;
    for step in 0..60u32 {
        let volume = wrap(around + step);
        let found = listing(station, volume, 200).await?;
        let newest = found.iter().map(|chunk| chunk.uploaded).max();
        match newest {
            Some(newest)
                if found_best
                    .as_ref()
                    .is_none_or(|(_, _, held)| newest > *held) =>
            {
                found_best = Some((volume, found, newest));
                misses = 0;
            }
            _ => {
                misses += 1;
                // Three folders in a row that are older than what has been
                // found is the far side of the ring's join.
                if found_best.is_some() && misses >= 3 {
                    break;
                }
            }
        }
    }

    found_best
        .map(|(volume, found, _)| (volume, found))
        .ok_or_else(|| ChunkError::NotLive(station.to_string()))
}

/// The folder before this one in the ring.
#[cfg(test)]
pub fn previous(volume: u32) -> u32 {
    wrap(volume + VOLUMES - 1)
}

/// Keeps a folder number inside the ring.
///
/// Nothing outside the ring is a folder, including zero, which arithmetic on
/// an unsigned number turns into a panic rather than an answer.
fn wrap(volume: u32) -> u32 {
    (volume.max(1) - 1) % VOLUMES + 1
}

/// What was read last time, so the next read is not the whole volume again.
///
/// A chunk key names a published object that never changes, so a piece already
/// in hand never needs asking for twice. Without this the live path fetched
/// every piece of the volume every twenty seconds: for one site that is around
/// six thousand objects and the better part of a gigabyte an hour, and about
/// seventy-eight cache entries a refresh against a budget of two thousand,
/// which turned the whole disk cache over every nine minutes and took the
/// tiles and grids the offline view is made of with it.
///
/// One site's worth, because the map draws one at a time and a volume is eight
/// megabytes.
struct Remembered {
    station: String,
    volume: u32,
    pieces: BTreeMap<String, Vec<u8>>,
}

static HELD: Mutex<Option<Remembered>> = Mutex::new(None);

/// Forgets what was read, so a test does not carry it between cases.
#[cfg(test)]
pub fn forget() {
    if let Ok(mut held) = HELD.lock() {
        *held = None;
    }
}

/// The pieces already in hand that belong to this read.
///
/// A different folder means the radar has moved on and the pieces of the one
/// before are of no further use; a different site means they were never this
/// site's pieces. Either way what is held is dropped rather than mixed in,
/// because a chunk from the wrong volume assembles into a picture of two
/// different moments and nothing downstream could tell.
fn carried_over(
    before: Option<Remembered>,
    station: &str,
    volume: u32,
) -> BTreeMap<String, Vec<u8>> {
    match before {
        Some(before) if before.station == station && before.volume == volume => before.pieces,
        _ => BTreeMap::new(),
    }
}

/// The keys that still have to be fetched, in the order they were published.
fn still_wanted(pieces: &BTreeMap<String, Vec<u8>>, keys: &[ChunkKey]) -> Vec<String> {
    keys.iter()
        .filter(|chunk| !pieces.contains_key(&chunk.key))
        .map(|chunk| chunk.key.clone())
        .collect()
}

/// Which folder this site was last found in, as a hint for where to look now.
fn known_volume(station: &str) -> Option<u32> {
    let held = HELD.lock().ok()?;
    held.as_ref()
        .filter(|held| held.station == station)
        .map(|held| held.volume)
}

/// How much of the volume in progress the radar has published.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveVolume {
    /// Which numbered folder it came from, so the next read can start there.
    pub volume: u32,
    /// When the newest chunk was uploaded.
    pub uploaded: String,
    /// How many chunks went into it.
    pub chunks: usize,
}

use serde::Serialize;

/// The volume being swept right now, with what is needed to draw it.
pub struct LiveScan {
    pub scan: Scan,
    pub volume: LiveVolume,
    /// Each cut's folding velocity, collected as the pieces arrived. There is
    /// no file to read it back out of afterwards.
    pub nyquist: BTreeMap<u8, f32>,
}

/// The volume being swept right now, as a scan the rest of the app can read.
pub async fn live_scan(station: &str) -> Result<LiveScan, ChunkError> {
    let (volume, keys) = newest_volume(station, known_volume(station)).await?;
    let Some(newest) = keys.iter().map(|chunk| chunk.uploaded).max() else {
        return Err(ChunkError::NotLive(station.to_string()));
    };
    // A volume nobody has added to for a minute is one the radar has finished,
    // and the archive path already draws those with the whole scan rather than
    // whatever part of it arrived first.
    if (Utc::now() - newest).num_seconds() > LIVE_SECONDS {
        return Err(ChunkError::NotLive(station.to_string()));
    }

    assemble(station, volume, keys, newest).await
}

/// Whatever is in one numbered folder, finished or not.
///
/// The ring keeps a volume in its folder for a while after the radar moves on,
/// which is how a test can hold the same volume in both hands: assembled from
/// the chunks here, and downloaded whole from the archive once it lands there.
#[cfg(test)]
pub async fn scan_in_folder(station: &str, volume: u32) -> Result<LiveScan, ChunkError> {
    let keys = listing(station, volume, 400).await?;
    let Some(newest) = keys.iter().map(|chunk| chunk.uploaded).max() else {
        return Err(ChunkError::NotLive(station.to_string()));
    };
    assemble(station, volume, keys, newest).await
}

async fn assemble(
    station: &str,
    volume: u32,
    keys: Vec<ChunkKey>,
    newest: DateTime<Utc>,
) -> Result<LiveScan, ChunkError> {
    // Whatever is already in hand and still belongs to this read.
    let before = HELD.lock().ok().and_then(|mut held| held.take());
    let mut pieces = carried_over(before, station, volume);

    // Only the pieces that are new. Fetched in the order they were published,
    // because the start chunk carries the volume header and the coverage
    // pattern everything after it is read against.
    for key in still_wanted(&pieces, &keys) {
        // A piece that will not download is a gap in the picture rather than a
        // reason to show nothing: the radar is still sweeping, the rest of the
        // volume is here, and the next read will have it.
        match http::get_bytes_uncached(&format!("{BUCKET}/{key}")).await {
            Ok(bytes) => {
                pieces.insert(key, bytes);
            }
            Err(reason) => {
                log::debug!("{station} chunk {key} did not arrive: {reason}");
            }
        }
    }

    let mut nyquist: BTreeMap<u8, f32> = BTreeMap::new();
    let mut readable = Vec::with_capacity(pieces.len());
    for (key, bytes) in &pieces {
        match Chunk::new(bytes.clone()) {
            Ok(piece) => {
                collect_nyquist(&piece, &mut nyquist);
                readable.push(piece);
            }
            Err(reason) => {
                log::debug!("{station} chunk {key} would not read: {reason}");
            }
        }
    }

    let held_count = pieces.len();
    if let Ok(mut held) = HELD.lock() {
        *held = Some(Remembered {
            station: station.to_string(),
            volume,
            pieces,
        });
    }

    let scan = nexrad_data::aws::realtime::assemble_volume(readable)
        .map_err(|failure| ChunkError::Assemble(failure.to_string()))?;

    Ok(LiveScan {
        scan,
        volume: LiveVolume {
            volume,
            uploaded: newest.to_rfc3339(),
            chunks: held_count,
        },
        nyquist,
    })
}

/// Notes down every folding velocity one chunk carries.
///
/// Velocity folds at a limit the cut publishes in its own radial headers, and
/// the assembled scan does not keep them. Reading them as the chunks arrive is
/// the only chance: after assembly there is no file left to go back to.
fn collect_nyquist(piece: &Chunk<'_>, into: &mut BTreeMap<u8, f32>) {
    let found = match piece {
        Chunk::Start(file) => match file.records() {
            Ok(records) => level2::nyquist_table(&records),
            Err(_) => return,
        },
        Chunk::IntermediateOrEnd(record) => level2::nyquist_table(std::slice::from_ref(record)),
    };
    for (elevation, nyquist) in found {
        into.entry(elevation).or_insert(nyquist);
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use nexrad_model::data::{GateStatus, Product, SweepField};

    use super::*;
    use crate::fixture;

    #[test]
    fn a_listing_gives_its_chunks_in_order_with_their_upload_times() {
        // The key says when the volume started and the listing says when the
        // chunk arrived. Only the second one answers whether the radar is
        // still sweeping, which is the whole question this asks.
        let listing = "<ListBucketResult>\
            <Contents><Key>KTLX/114/20260830-161604-002-I</Key>\
            <LastModified>2026-08-30T16:16:20.000Z</LastModified></Contents>\
            <Contents><Key>KTLX/114/20260830-161604-001-S</Key>\
            <LastModified>2026-08-30T16:16:08.000Z</LastModified></Contents>\
            <Contents><Key>KTLX/114/</Key>\
            <LastModified>2026-08-30T16:16:00.000Z</LastModified></Contents>\
            </ListBucketResult>";
        let found = chunks_in_listing(listing);
        assert_eq!(found.len(), 2, "the folder marker is not a chunk");
        // Sorted by key, so the start chunk comes first however the listing
        // was written: the header it carries has to be read before the rest.
        assert!(found[0].key.ends_with("-001-S"), "{}", found[0].key);
        assert!(found[1].key.ends_with("-002-I"), "{}", found[1].key);
        assert_eq!(found[1].uploaded.to_rfc3339(), "2026-08-30T16:16:20+00:00");
    }

    #[test]
    fn nothing_in_an_empty_or_broken_listing_becomes_a_chunk() {
        assert!(chunks_in_listing("").is_empty());
        assert!(chunks_in_listing("<ListBucketResult/>").is_empty());
        // A chunk with no upload time cannot be judged, so it is not used.
        assert!(chunks_in_listing("<Contents><Key>KTLX/1/a-001-S</Key></Contents>").is_empty());
        // Nor one whose time is not a time.
        assert!(chunks_in_listing(
            "<Contents><Key>KTLX/1/a-001-S</Key><LastModified>soon</LastModified></Contents>"
        )
        .is_empty());
    }

    #[test]
    fn the_ring_of_folders_wraps_rather_than_running_off_the_end() {
        assert_eq!(wrap(1), 1);
        assert_eq!(wrap(999), 999);
        assert_eq!(wrap(1000), 1);
        assert_eq!(wrap(1001), 2);
        assert_eq!(wrap(1998), 999);
        // Every folder in the ring is reachable and stays in range.
        for volume in 1..=VOLUMES {
            for step in 0..60u32 {
                let landed = wrap(volume + step);
                assert!((1..=VOLUMES).contains(&landed), "{volume} + {step}");
            }
        }
    }

    /// The site the built volumes stand at, which is Oklahoma City's.
    fn test_site() -> fixture::Site {
        fixture::Site {
            id: *b"KTLX",
            latitude: 35.3333,
            longitude: -97.2778,
            height_metres: 370,
        }
    }

    /// A volume in progress, cut into chunks the way the radar publishes them.
    ///
    /// The start chunk carries the Archive II header and the first record; the
    /// rest carry one record each, exactly as the bucket holds them.
    fn chunked_volume(cuts: &[Vec<fixture::Radial>]) -> Vec<Vec<u8>> {
        let site = test_site();
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let mut pieces = Vec::new();
        for (index, cut) in cuts.iter().enumerate() {
            let messages: Vec<Vec<u8>> = cut
                .iter()
                .map(|radial| fixture::radial_message(&site, radial))
                .collect();
            let record = fixture::ldm_record(&messages);
            if index == 0 {
                let mut start = fixture::volume_header(&site, at);
                // The pattern message rides in the start chunk, the way the
                // radar publishes it: without it a volume cannot be assembled
                // at all, so a start chunk that went missing is not silent.
                let angles: Vec<f32> = cuts
                    .iter()
                    .filter_map(|cut| cut.first())
                    .map(|radial| radial.elevation_degrees)
                    .collect();
                start.extend_from_slice(&fixture::ldm_record(&[
                    fixture::coverage_pattern_message(at, &angles),
                ]));
                start.extend_from_slice(&record);
                pieces.push(start);
            } else {
                pieces.push(record);
            }
        }
        pieces
    }

    #[test]
    fn a_volume_cut_into_chunks_assembles_back_into_its_own_readings() {
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        // Two cuts with different readings, so a chunk landing in the wrong
        // sweep would change what comes back rather than pass unnoticed.
        let cuts = vec![
            fixture::flat_cut(
                at,
                fixture::Cut {
                    gates: 40,
                    reflectivity: fixture::Gate::Reading(35.0),
                    velocity: Some(fixture::Gate::Reading(12.0)),
                    ..fixture::Cut::default()
                },
            ),
            fixture::flat_cut(
                at,
                fixture::Cut {
                    number: 2,
                    degrees: 1.5,
                    gates: 40,
                    velocity: Some(fixture::Gate::Reading(-6.0)),
                    ..fixture::Cut::default()
                },
            ),
        ];
        let pieces = chunked_volume(&cuts);
        assert_eq!(pieces.len(), 2);
        // The first piece has to be recognised as the start of a volume, and
        // the rest as continuations, or the header never gets read.
        assert!(matches!(
            Chunk::new(pieces[0].clone()).expect("a start chunk"),
            Chunk::Start(_)
        ));
        assert!(matches!(
            Chunk::new(pieces[1].clone()).expect("a later chunk"),
            Chunk::IntermediateOrEnd(_)
        ));

        let chunks: Vec<Chunk<'_>> = pieces
            .iter()
            .map(|piece| Chunk::new(piece.clone()).expect("a readable chunk"))
            .collect();
        let scan = nexrad_data::aws::realtime::assemble_volume(chunks).expect("an assembled scan");

        let mut angles: Vec<f32> = scan
            .sweeps()
            .iter()
            .filter_map(|sweep| sweep.elevation_angle_degrees())
            .collect();
        angles.sort_by(f32::total_cmp);
        assert_eq!(angles, vec![0.5, 1.5], "both cuts have to survive assembly");

        for sweep in scan.sweeps() {
            let wanted = if sweep.elevation_number() == 1 {
                35.0
            } else {
                20.0
            };
            assert_eq!(sweep.radials().len(), 360);
            let field = SweepField::from_radials(sweep.radials(), Product::Reflectivity)
                .expect("reflectivity in the assembled sweep");
            assert_eq!(field.gate_count(), 40);
            let (value, status) = field.get(0, 0);
            assert_eq!(status, GateStatus::Valid);
            assert!(
                (value - wanted).abs() < 0.5,
                "cut {} came back at {value} rather than {wanted}",
                sweep.elevation_number()
            );
        }

        // The site travels in the volume block of every radial, not only in
        // the Archive II header, so a chunk path that dropped it would draw
        // the sweep over the wrong ground.
        let site = scan.site().expect("the site the volume was built at");
        assert!((site.latitude() - 35.3333).abs() < 0.001);
        assert!((site.longitude() - (-97.2778)).abs() < 0.001);
    }

    #[test]
    fn the_folding_velocity_is_read_off_the_chunks_as_they_arrive() {
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        // Two cuts folding at different speeds, which is what a real pattern
        // does: the wide cuts fold low and the tight ones fold high.
        let cuts = vec![
            fixture::flat_cut(
                at,
                fixture::Cut {
                    radials: 8,
                    gates: 4,
                    reflectivity: fixture::Gate::Reading(35.0),
                    velocity: Some(fixture::Gate::Reading(12.0)),
                    nyquist_ms: 8.25,
                    ..fixture::Cut::default()
                },
            ),
            fixture::flat_cut(
                at,
                fixture::Cut {
                    number: 2,
                    degrees: 1.5,
                    radials: 8,
                    gates: 4,
                    velocity: Some(fixture::Gate::Reading(-6.0)),
                    nyquist_ms: 31.5,
                    ..fixture::Cut::default()
                },
            ),
        ];
        let mut found = BTreeMap::new();
        for piece in chunked_volume(&cuts) {
            collect_nyquist(&Chunk::new(piece).expect("a readable chunk"), &mut found);
        }
        assert_eq!(found.get(&1).copied(), Some(8.25));
        assert_eq!(found.get(&2).copied(), Some(31.5));
    }

    #[test]
    fn nothing_outside_the_ring_is_a_folder_number() {
        // Zero is not a folder, and on an unsigned number the arithmetic that
        // keeps a number inside the ring turned it into a panic rather than an
        // answer. Unreachable only while the folder number is never fed back,
        // which is exactly what remembering it between reads now does.
        for volume in [0u32, 1, 2, VOLUMES - 1, VOLUMES, VOLUMES + 1, u32::MAX] {
            let landed = wrap(volume);
            assert!(
                (1..=VOLUMES).contains(&landed),
                "{volume} landed on {landed}"
            );
        }
        assert_eq!(wrap(0), 1);
        assert_eq!(previous(1), VOLUMES);
    }

    #[test]
    fn a_volume_already_in_hand_is_not_asked_for_again() {
        // A chunk key names a published object that never changes, so a piece
        // in hand never needs asking for twice. Without this the live path
        // fetched the whole volume every twenty seconds: for one site about
        // six thousand objects and the better part of a gigabyte an hour, and
        // enough cache entries to turn the whole disk cache over every nine
        // minutes and take the tiles with it.
        forget();
        assert_eq!(known_volume("KTLX"), None);

        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let pieces = chunked_volume(&[fixture::flat_cut(
            at,
            fixture::Cut {
                gates: 8,
                ..fixture::Cut::default()
            },
        )]);
        if let Ok(mut held) = HELD.lock() {
            *held = Some(Remembered {
                station: "KTLX".to_string(),
                volume: 210,
                pieces: pieces
                    .iter()
                    .enumerate()
                    .map(|(at, bytes)| (format!("KTLX/210/piece-{at}"), bytes.clone()))
                    .collect(),
            });
        }

        // The folder is remembered, so the ring walk starts where it left off
        // rather than sampling the whole thousand folders again.
        assert_eq!(known_volume("KTLX"), Some(210));
        // And nothing is remembered for anywhere else.
        assert_eq!(known_volume("KDMX"), None);
        forget();
        assert_eq!(known_volume("KTLX"), None);
    }

    /// What a read of one folder would find already in hand.
    fn remembered(station: &str, volume: u32, keys: &[&str]) -> Remembered {
        Remembered {
            station: station.to_string(),
            volume,
            pieces: keys
                .iter()
                .map(|key| ((*key).to_string(), vec![0u8; 4]))
                .collect(),
        }
    }

    fn listed(keys: &[&str]) -> Vec<ChunkKey> {
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        keys.iter()
            .map(|key| ChunkKey {
                key: (*key).to_string(),
                uploaded: at,
            })
            .collect()
    }

    #[test]
    fn only_the_pieces_that_are_new_are_asked_for() {
        let keys = listed(&["KTLX/210/a", "KTLX/210/b", "KTLX/210/c"]);
        let held = carried_over(
            Some(remembered("KTLX", 210, &["KTLX/210/a", "KTLX/210/b"])),
            "KTLX",
            210,
        );
        assert_eq!(held.len(), 2);
        assert_eq!(still_wanted(&held, &keys), vec!["KTLX/210/c".to_string()]);

        // Nothing new is nothing to ask for, which is what most refreshes are
        // between one chunk and the next.
        let all = carried_over(
            Some(remembered(
                "KTLX",
                210,
                &["KTLX/210/a", "KTLX/210/b", "KTLX/210/c"],
            )),
            "KTLX",
            210,
        );
        assert!(still_wanted(&all, &keys).is_empty());
    }

    #[test]
    fn pieces_of_another_volume_or_another_site_are_not_reused() {
        // A chunk from the wrong volume assembles into a picture of two
        // different moments and nothing downstream could tell, so what is held
        // is dropped rather than mixed in.
        let keys = listed(&["KTLX/210/a", "KTLX/210/b"]);
        let before = remembered("KTLX", 210, &["KTLX/210/a"]);

        // The radar has moved on to the next folder.
        let moved_on = carried_over(Some(remembered("KTLX", 209, &["KTLX/209/a"])), "KTLX", 210);
        assert!(moved_on.is_empty());
        assert_eq!(still_wanted(&moved_on, &keys).len(), 2);

        // And another site's pieces are never this site's.
        let elsewhere = carried_over(Some(remembered("KDMX", 210, &["KDMX/210/a"])), "KTLX", 210);
        assert!(elsewhere.is_empty());

        // The one case that does carry over.
        assert_eq!(carried_over(Some(before), "KTLX", 210).len(), 1);
        assert!(carried_over(None, "KTLX", 210).is_empty());
    }

    #[test]
    fn a_volume_missing_one_of_its_pieces_is_still_a_volume() {
        // One piece that will not download is a gap in the picture rather than
        // a reason to show nothing: the radar is still sweeping and the next
        // read will have it. The fetch used to give up on the whole volume,
        // with a comment three lines below saying the opposite.
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let cuts = vec![
            fixture::flat_cut(
                at,
                fixture::Cut {
                    gates: 8,
                    ..fixture::Cut::default()
                },
            ),
            fixture::flat_cut(
                at,
                fixture::Cut {
                    number: 2,
                    degrees: 1.5,
                    gates: 8,
                    ..fixture::Cut::default()
                },
            ),
        ];
        let pieces = chunked_volume(&cuts);
        assert_eq!(pieces.len(), 2);

        // The start chunk and nothing else: the second cut is missing, and
        // what is left still assembles into the first.
        let only_start: Vec<Chunk<'_>> =
            vec![Chunk::new(pieces[0].clone()).expect("a start chunk")];
        let scan = nexrad_data::aws::realtime::assemble_volume(only_start)
            .expect("a volume that has only reached its first cut is a volume");
        assert_eq!(scan.sweeps().len(), 1);

        // Without the start chunk there is no header and no pattern, and that
        // is refused rather than drawn as an empty sky.
        let without_start: Vec<Chunk<'_>> =
            vec![Chunk::new(pieces[1].clone()).expect("a later chunk")];
        assert!(nexrad_data::aws::realtime::assemble_volume(without_start).is_err());
    }

    #[test]
    #[ignore = "asks the live chunks bucket for a volume in progress"]
    fn reads_the_volume_a_radar_is_sweeping_now() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        // Whichever site happens to be scanning. A radar can be down, so no
        // single one of them is allowed to fail this on its own.
        let mut read = 0;
        for station in ["KTLX", "KJAX", "KDMX", "KTBW", "KGRR"] {
            let Ok(found) = runtime.block_on(live_scan(station)) else {
                continue;
            };
            read += 1;
            let sweeps = found.scan.sweeps().len();
            println!(
                "{station}: volume {} with {} chunks, {sweeps} sweeps, newest {}, folds at {:?}",
                found.volume.volume, found.volume.chunks, found.volume.uploaded, found.nyquist
            );
            assert!(sweeps > 0, "{station} assembled to nothing");
            assert!(found.volume.chunks > 0);
            // Velocity folds at a limit only the raw radial headers carry, and
            // the assembled scan drops them. A chunk path that lost them would
            // draw velocity it could not unfold and never say so.
            assert!(
                !found.nyquist.is_empty(),
                "{station} came back with no folding velocity for any cut"
            );
        }
        assert!(
            read > 0,
            "no site was sweeping, which after five tries means the bucket or \
             the key format moved rather than the weather being quiet"
        );
    }
}

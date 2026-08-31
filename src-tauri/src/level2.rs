//! Single-site NEXRAD Level II radar: fetch a volume, decode one sweep, and
//! draw it as a Web Mercator image the map can lay over its own bounds.
//!
//! The mosaics OpenRadar leads with are national and smoothed. This is the
//! radar itself, one site at a time, which is what a close-in view wants.

use std::collections::{hash_map::DefaultHasher, BTreeMap, VecDeque};
use std::fs::File as FsFile;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine;
use chrono::{DateTime, Datelike, Duration, Utc};
use nexrad_data::volume;
use nexrad_decode::messages::MessageContents;
use nexrad_model::data::{GateStatus, Product, Scan, SweepField};
use nexrad_model::geo::{GeoPoint, RadarCoordinateSystem};
use nexrad_model::meta::registry;
use serde::Serialize;

use crate::chunks;
use crate::dealias;
use crate::http;
use crate::palette;
use crate::palette::Palette;
use crate::vad;

const ARCHIVE_HOST: &str = "https://unidata-nexrad-level2.s3.amazonaws.com";
/// The image is square because a sweep is a circle; this is its side in pixels.
const IMAGE_SIZE: usize = 1024;
/// A WSR-88D surveillance cut reaches this far, and the extent follows it.
const MAX_RANGE_KM: f64 = 230.0;
/// How far a viewport may sit from a site and still be worth handing over to
/// it. Past this the view is outside the site's coverage and the national
/// mosaic is the only honest picture, so nothing is offered.
///
/// The same distance the sweep is drawn to, deliberately. A site further away
/// than its own surveillance cut reaches would be handed a view its rendered
/// disc does not contain, and the viewer would zoom in on a hole. That did not
/// matter while only the nearest site was ever chosen; it does now that a
/// downed one is passed over for the next.
const SITE_REACH_KM: f64 = MAX_RANGE_KM;
/// Four volumes, as the roadmap asks. They are held compressed, not decoded.
const CACHE_CAPACITY: usize = 4;

/// How many decoded volumes to keep beside the compressed ones.
///
/// Fewer than the compressed cache holds, because a decoded volume is the
/// expensive one to keep: the compressed bytes are what came off the network
/// and the scan is what they turn into, several times larger.
const DECODED_CAPACITY: usize = 3;

/// The ceiling on what the decoded cache may hold, counted in the source bytes
/// each volume arrived as.
///
/// Counted that way deliberately. The decoded scan's own footprint cannot be
/// measured cheaply through this model's API: a radial's moments expose their
/// readings only by iterating or by allocating a vector of them, so asking a
/// volume how large it is would cost most of what decoding it did. The source
/// length is exact, known before anything is decoded, and moves with the
/// decoded size rather than independently of it, which is what a budget needs.
const DECODED_BUDGET_BYTES: usize = 64 * 1024 * 1024;

/// How old a site's newest volume may be before it counts as down.
const STALE_AFTER_MINUTES: i64 = 20;

/// How long a site's answer about its own archive is reused for.
const LIVENESS_TTL_SECONDS: i64 = 120;

/// How long a failure to reach the archive is remembered.
///
/// Shorter than an answer, because unreachable is a passing condition and a
/// site coming back should be seen quickly. Long enough that panning across a
/// region with no network does not fire the whole burst again for every tenth
/// of a degree.
const LIVENESS_FAILURE_TTL_SECONDS: i64 = 20;

/// How many sites are asked before the nearest one is used regardless.
const MAX_SITE_CANDIDATES: usize = 4;

/// How far two elevation angles may be and still be the same cut.
///
/// A sweep's angle is the median of what its radials actually measured, and
/// the pedestal does not put the antenna in the same place twice. Across
/// consecutive volumes KTLX moved a cut from 3.08 degrees to 3.12 and KOKX
/// from 4.04 to 4.00. Held to a hundredth of a degree, about one cut in ten
/// stopped matching between the finished volume and the one in progress, and
/// the live sweep for that tilt went missing with no message.
///
/// A tenth of a degree is well inside the gap between cuts, which is half a
/// degree at its narrowest in any pattern the network runs, so this cannot
/// reach the cut above or below.
const SAME_CUT_DEGREES: f32 = 0.1;

/// Local imports are bounded before they are read. Published Archive II files
/// are normally under 20 MB; this leaves room for unusually long volumes
/// without letting an accidental multi-gigabyte selection become an allocation.
const LOCAL_VOLUME_MAX_BYTES: u64 = 128 * 1024 * 1024;
/// A gzip wrapper may be much smaller than what it expands to. Keep that
/// second boundary independent of the selected file's size.
const EXPANDED_VOLUME_MAX_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum Level2Error {
    #[error("{0} is not a NEXRAD site")]
    UnknownSite(String),
    #[error("no radar volume has been published for {0} yet today or yesterday")]
    NoVolume(String),
    #[error("the volume listing could not be read")]
    BadListing,
    #[error("the volume could not be decoded: {0}")]
    Decode(String),
    #[error("{0} has no {1} sweep at that tilt")]
    NoSweep(String, String),
    #[error("the wind at {0} could not be read, so nothing can be taken out of it")]
    NoStormMotion(String),
    #[error("the image could not be encoded: {0}")]
    Encode(String),
    #[error("{0} is not a UTC date and time")]
    InvalidTime(String),
    #[error("the selected file could not be read: {0}")]
    LocalRead(String),
    #[error("the selected file is larger than 128 MB")]
    LocalTooLarge,
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Level2Error {
    /// A name for this kind of failure, and whatever it names.
    ///
    /// The workspace is translated and these are not, so a Spanish reader used
    /// to get an English sentence in a panel where everything else was in
    /// Spanish. Sending a code and its parts lets the page write the sentence
    /// itself, and the English text still rides along for anything the page
    /// has no wording for.
    fn parts(&self) -> (&'static str, Vec<String>) {
        match self {
            Self::UnknownSite(site) => ("unknownSite", vec![site.clone()]),
            Self::NoVolume(site) => ("noVolume", vec![site.clone()]),
            Self::BadListing => ("badListing", Vec::new()),
            Self::Decode(why) => ("decode", vec![why.clone()]),
            Self::NoSweep(site, product) => ("noSweep", vec![site.clone(), product.clone()]),
            Self::NoStormMotion(site) => ("noStormMotion", vec![site.clone()]),
            Self::Encode(why) => ("encode", vec![why.clone()]),
            Self::InvalidTime(at) => ("invalidTime", vec![at.clone()]),
            Self::LocalRead(why) => ("localRead", vec![why.clone()]),
            Self::LocalTooLarge => ("localTooLarge", Vec::new()),
            Self::Http(_) => ("http", vec![self.to_string()]),
        }
    }
}

impl Serialize for Level2Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, args) = self.parts();
        let mut out = serializer.serialize_struct("Level2Error", 3)?;
        out.serialize_field("code", code)?;
        out.serialize_field("args", &args)?;
        // What the native side would have said, for anything the page has no
        // wording of its own for.
        out.serialize_field("text", &self.to_string())?;
        out.end()
    }
}

/// What a sweep looks like once it is ready to draw.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepImage {
    pub station: String,
    pub site_name: String,
    /// The product that was asked for, so a caller can tell whether the sweep
    /// in hand is an answer to the question it is asking now.
    pub product_id: String,
    pub product: String,
    /// True when a loaded colour table drew this rather than the built-in ramp.
    pub palette_applied: bool,
    /// True when the velocity in this sweep has been unfolded, so the legend
    /// can say the picture is no longer the radar's raw reading.
    pub dealiased: bool,
    /// The motion taken out of a storm relative sweep, in metres a second and
    /// the compass direction it comes from. Absent on every other product.
    pub storm_motion: Option<StormMotion>,
    pub unit: String,
    pub elevation_degrees: f32,
    /// Every tilt this volume holds, ascending, so the panel can offer them.
    pub tilts: Vec<f32>,
    pub tilt_index: usize,
    /// True when this came from the volume the radar is sweeping now rather
    /// than the last one it finished, so the legend can say the picture is
    /// live and how much of it there is.
    pub live: bool,
    /// How many tilts the radar has published of this volume so far. Only
    /// meaningful on a live sweep, where the answer grows as it is watched.
    pub live_tilts: usize,
    /// When the volume was collected, not when it was fetched.
    pub collected: String,
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
    /// The rendered sweep as a data URL, ready for a MapLibre image source.
    pub image: String,
    /// The volume key, so a caller can tell one scan from the next.
    pub volume: String,
    /// Where the bytes on screen came from. Historical and local sources are
    /// explicit so the timeline never calls them live.
    pub source: SweepSource,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepSource {
    /// `recent`, `archive`, or `local`.
    pub kind: String,
    /// A filename for local data, otherwise the provider's name.
    pub label: String,
    /// Public attribution for provider data. Local files have no link.
    pub url: Option<String>,
}

/// What was subtracted to make a sweep storm relative.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StormMotion {
    pub speed_ms: f32,
    pub from_degrees: f32,
    /// True when the viewer gave the motion rather than the sweep being read
    /// for it, so the panel can say which it is looking at.
    pub manual: bool,
}

struct CachedVolume {
    key: String,
    data: Vec<u8>,
}

static CACHE: Mutex<VecDeque<CachedVolume>> = Mutex::new(VecDeque::new());

/// One volume that has already been turned into a scan.
///
/// Both halves are here because both cost a pass over the volume. The scan is
/// the obvious one. The folding velocities are the other: they live only in the
/// raw radial headers, which the model's scan does not carry, so reading them
/// back meant walking the whole file again for every cut asked about.
struct DecodedVolume {
    key: String,
    scan: Arc<Scan>,
    /// Every cut's folding velocity, by elevation number.
    nyquist: Arc<BTreeMap<u8, f32>>,
    /// What the volume arrived as, which is what the budget counts.
    source_bytes: usize,
}

static DECODED: Mutex<VecDeque<DecodedVolume>> = Mutex::new(VecDeque::new());

/// How many volumes have actually been decoded since this build started.
///
/// The whole point of the cache is that changing tilt or product does not
/// decode anything again, and that is invisible from the outside: the picture
/// is identical either way, only slower. A counter is what lets a test say the
/// work did not happen rather than that the answer looked right.
static DECODES: AtomicUsize = AtomicUsize::new(0);

/// A decoded volume as it is handed out: the scan, and every cut's folding
/// velocity beside it. Both are shared rather than copied, because the whole
/// point is that neither is built again.
type Decoded = (Arc<Scan>, Arc<BTreeMap<u8, f32>>);

/// A site's newest volume time, when the archive was asked, and whether the
/// asking failed rather than came back empty.
type Liveness = BTreeMap<String, (DateTime<Utc>, Option<DateTime<Utc>>, bool)>;

/// What the archive last held for each site.
static LIVENESS: Mutex<Liveness> = Mutex::new(BTreeMap::new());

/// The products a caller may ask for, kept as plain names the frontend can send.
pub fn product_from_name(name: &str) -> Option<(Product, &'static str, &'static str)> {
    match name {
        "reflectivity" => Some((Product::Reflectivity, "Reflectivity", "dBZ")),
        "velocity" => Some((Product::Velocity, "Velocity", "m/s")),
        // Drawn from the same moment, with the storm's own motion taken out.
        "storm-relative-velocity" => Some((Product::Velocity, "Storm relative velocity", "m/s")),
        "spectrum-width" => Some((Product::SpectrumWidth, "Spectrum width", "m/s")),
        "differential-reflectivity" => Some((
            Product::DifferentialReflectivity,
            "Differential reflectivity",
            "dB",
        )),
        "correlation-coefficient" => Some((
            Product::CorrelationCoefficient,
            "Correlation coefficient",
            "",
        )),
        _ => None,
    }
}

/// The NWS reflectivity ramp, the same stops the legend gradient is drawn from.
const REFLECTIVITY_RAMP: &[(f32, [u8; 3])] = &[
    (5.0, [0x04, 0xe9, 0xe7]),
    (10.0, [0x01, 0x9f, 0xf4]),
    (15.0, [0x03, 0x00, 0xf4]),
    (20.0, [0x02, 0xfd, 0x02]),
    (25.0, [0x01, 0xc5, 0x01]),
    (30.0, [0x00, 0x8e, 0x00]),
    (35.0, [0xfd, 0xf8, 0x02]),
    (40.0, [0xe5, 0xbc, 0x00]),
    (45.0, [0xfd, 0x95, 0x00]),
    (50.0, [0xfd, 0x00, 0x00]),
    (55.0, [0xd4, 0x00, 0x00]),
    (60.0, [0xbc, 0x00, 0x00]),
    (65.0, [0xf8, 0x00, 0xfd]),
    (70.0, [0x98, 0x54, 0xc6]),
    (75.0, [0xfd, 0xfd, 0xfd]),
];

/// Green toward the radar, red away from it, grey where the air is still.
const VELOCITY_RAMP: &[(f32, [u8; 3])] = &[
    (-35.0, [0x00, 0xff, 0x00]),
    (-20.0, [0x00, 0xb4, 0x00]),
    (-5.0, [0x00, 0x5a, 0x00]),
    (0.0, [0x6b, 0x6b, 0x6b]),
    (5.0, [0x5a, 0x00, 0x00]),
    (20.0, [0xb4, 0x00, 0x00]),
    (35.0, [0xff, 0x00, 0x00]),
];

/// The same ramp carried out to where unfolding puts things.
///
/// A radar folds somewhere between about 8 and 35 metres a second depending on
/// the cut, so an unfolded gate can legitimately read twice that. Drawn on the
/// ramp above, everything past 35 saturates to the same red, which hides the
/// difference between a strong wind and the one the unfolding recovered.
const WIDE_VELOCITY_RAMP: &[(f32, [u8; 3])] = &[
    (-70.0, [0x99, 0xff, 0x99]),
    (-35.0, [0x00, 0xff, 0x00]),
    (-20.0, [0x00, 0xb4, 0x00]),
    (-5.0, [0x00, 0x5a, 0x00]),
    (0.0, [0x6b, 0x6b, 0x6b]),
    (5.0, [0x5a, 0x00, 0x00]),
    (20.0, [0xb4, 0x00, 0x00]),
    (35.0, [0xff, 0x00, 0x00]),
    (70.0, [0xff, 0x99, 0x99]),
];

/// The reflectivity ramp for a reader who has asked for more contrast.
///
/// The ordinary NWS scale is the one everybody knows, and it is built out of
/// the two hues red-green colour blindness collapses. Measured with
/// `crate::contrast`, its closest pair of neighbouring stops is 4.9 under
/// deuteranopia, between 40 and 45 dBZ: about twice the point at which two
/// colours become distinguishable at all, for the difference between a strong
/// storm and a severe one.
///
/// This one is built the other way round. Lightness climbs from one end to the
/// other, so the reading survives even where hue is lost completely, and the
/// hue that remains swings along the blue-yellow axis that both red-green
/// deficiencies keep. Eight bands rather than fifteen, because separation is
/// what contrast is for: fifteen steps cannot be told apart by anybody once
/// the range is divided among them.
const HIGH_CONTRAST_REFLECTIVITY_RAMP: &[(f32, [u8; 3])] = &[
    (5.0, [0x00, 0x25, 0x6c]),
    (15.0, [0x00, 0x44, 0x7e]),
    (25.0, [0x00, 0x65, 0x62]),
    (35.0, [0x44, 0x85, 0x49]),
    (45.0, [0x8a, 0x9f, 0x37]),
    (55.0, [0xcf, 0xb5, 0x3c]),
    (65.0, [0xff, 0xb6, 0x92]),
    (75.0, [0xff, 0xf2, 0xe3]),
];

/// Velocity for the same reader: toward the radar is blue, away is orange.
///
/// Green and red are the worst possible pair for this. They are far apart to
/// ordinary vision, which is why they were chosen, and under deuteranopia the
/// two ends of the scale come within 14 of each other, so the one thing the
/// layer exists to say stops being said. Blue against orange holds them 39
/// apart for the same eyes, and it is still an obvious pair of opposites for
/// everybody else.
const HIGH_CONTRAST_VELOCITY_RAMP: &[(f32, [u8; 3])] = &[
    (-35.0, [0x00, 0x78, 0xba]),
    (-20.0, [0x00, 0xa3, 0xd1]),
    (-5.0, [0x9c, 0xd4, 0xed]),
    (0.0, [0xe8, 0xe8, 0xe8]),
    (5.0, [0xf5, 0xc0, 0xab]),
    (20.0, [0xd7, 0x7f, 0x57]),
    (35.0, [0xb3, 0x4f, 0x1f]),
];

/// The same, carried out to where unfolding puts things.
const HIGH_CONTRAST_WIDE_VELOCITY_RAMP: &[(f32, [u8; 3])] = &[
    (-70.0, [0x00, 0x4f, 0x9f]),
    (-35.0, [0x00, 0x78, 0xba]),
    (-20.0, [0x00, 0xa3, 0xd1]),
    (-5.0, [0x9c, 0xd4, 0xed]),
    (0.0, [0xe8, 0xe8, 0xe8]),
    (5.0, [0xf5, 0xc0, 0xab]),
    (20.0, [0xd7, 0x7f, 0x57]),
    (35.0, [0xb3, 0x4f, 0x1f]),
    (70.0, [0x8c, 0x19, 0x00]),
];

/// Low to high across whatever the moment's own range is.
const GENERIC_RAMP: &[(f32, [u8; 3])] = &[
    (0.0, [0x1e, 0x29, 0x3b]),
    (0.25, [0x38, 0xbd, 0xf8]),
    (0.5, [0x4a, 0xde, 0x80]),
    (0.75, [0xfa, 0xcc, 0x15]),
    (1.0, [0xf4, 0x3f, 0x5e]),
];

/// Range-folded velocity is its own thing, not a speed, so it gets its own colour.
const RANGE_FOLDED: [u8; 3] = [0x7d, 0x26, 0xcd];

/// How solidly a gate is drawn once it is worth drawing at all.
const MAX_ALPHA: u8 = 235;
/// Level II at half a degree picks up dust, insects, and birds, and a bare
/// threshold paints that as a field of speckles across the whole sweep. Weak
/// returns fade in instead of arriving at full strength, so a storm reads as a
/// storm without any of the data being thrown away.
const FADE_FLOOR_DBZ: f32 = 5.0;
const FADE_CEILING_DBZ: f32 = 20.0;
const MIN_ALPHA: u8 = 70;

fn reflectivity_alpha(dbz: f32) -> u8 {
    if dbz >= FADE_CEILING_DBZ {
        return MAX_ALPHA;
    }
    let position = ((dbz - FADE_FLOOR_DBZ) / (FADE_CEILING_DBZ - FADE_FLOOR_DBZ)).clamp(0.0, 1.0);
    MIN_ALPHA + ((MAX_ALPHA - MIN_ALPHA) as f32 * position).round() as u8
}

fn ramp_color(ramp: &[(f32, [u8; 3])], value: f32) -> [u8; 3] {
    if value <= ramp[0].0 {
        return ramp[0].1;
    }
    for pair in ramp.windows(2) {
        let (low, low_color) = pair[0];
        let (high, high_color) = pair[1];
        if value <= high {
            let span = high - low;
            let position = if span > 0.0 {
                (value - low) / span
            } else {
                0.0
            };
            return [
                blend(low_color[0], high_color[0], position),
                blend(low_color[1], high_color[1], position),
                blend(low_color[2], high_color[2], position),
            ];
        }
    }
    ramp[ramp.len() - 1].1
}

fn blend(low: u8, high: u8, position: f32) -> u8 {
    (low as f32 + (high as f32 - low as f32) * position).round() as u8
}

fn mercator_y(latitude: f64) -> f64 {
    let clamped = latitude.clamp(-85.051_129, 85.051_129);
    (std::f64::consts::FRAC_PI_4 + clamped.to_radians() / 2.0)
        .tan()
        .ln()
}

fn inverse_mercator_y(y: f64) -> f64 {
    (2.0 * y.exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees()
}

/// The archive publishes one object per volume under a day prefix.
fn listing_url(station: &str, day: DateTime<Utc>) -> String {
    format!(
        "{ARCHIVE_HOST}/?list-type=2&prefix={:04}/{:02}/{:02}/{station}/",
        day.year(),
        day.month(),
        day.day()
    )
}

/// The newest key in an S3 listing. The bucket returns keys in order, and a
/// volume's name ends with its collection time, so the last one is the newest.
pub fn newest_key(listing: &str) -> Option<String> {
    let mut newest: Option<String> = None;
    let mut rest = listing;
    while let Some(start) = rest.find("<Key>") {
        let after = &rest[start + 5..];
        let end = after.find("</Key>")?;
        let key = &after[..end];
        // A partial upload is published as `_V06_MDM`; only whole volumes draw.
        if (key.ends_with("_V06") || key.ends_with("_V03"))
            && newest.as_deref().is_none_or(|current| current < key)
        {
            newest = Some(key.to_string());
        }
        rest = &after[end + 6..];
    }
    newest
}

/// The volume nearest a requested UTC moment in one day's listing.
///
/// The archive can have gaps while a radar is down, so the actual collection
/// time travels with the result and the timeline names it. Choosing the nearest
/// whole volume is more useful than pretending the requested minute exists.
pub fn closest_key(listing: &str, wanted: DateTime<Utc>) -> Option<String> {
    let mut closest: Option<(i64, String)> = None;
    let mut rest = listing;
    while let Some(start) = rest.find("<Key>") {
        let after = &rest[start + 5..];
        let end = after.find("</Key>")?;
        let key = &after[..end];
        if key.ends_with("_V06") || key.ends_with("_V03") {
            if let Some(at) = key_time(key) {
                let distance = at.signed_duration_since(wanted).num_seconds().abs();
                if closest.as_ref().is_none_or(|(best, current)| {
                    distance < *best || (distance == *best && key < current.as_str())
                }) {
                    closest = Some((distance, key.to_string()));
                }
            }
        }
        rest = &after[end + 6..];
    }
    closest.map(|(_, key)| key)
}

/// The collection time a volume key carries, as `KDMX20260830_092159_V06`.
pub fn key_time(key: &str) -> Option<DateTime<Utc>> {
    let name = key.rsplit('/').next()?;
    let stamp = name.get(4..19)?;
    let parsed = chrono::NaiveDateTime::parse_from_str(stamp, "%Y%m%d_%H%M%S").ok()?;
    Some(parsed.and_utc())
}

async fn latest_volume(station: &str) -> Result<(String, Vec<u8>), Level2Error> {
    let now = Utc::now();
    let mut key = None;
    // Just after midnight UTC the day's prefix can still be empty.
    for day in [now, now - Duration::days(1)] {
        let listing = http::get_bytes(&listing_url(station, day)).await?;
        let listing = String::from_utf8_lossy(&listing);
        if !listing.contains("<ListBucketResult") {
            return Err(Level2Error::BadListing);
        }
        if let Some(found) = newest_key(&listing) {
            key = Some(found);
            break;
        }
    }
    let key = key.ok_or_else(|| Level2Error::NoVolume(station.to_string()))?;

    if let Some(hit) = cached(&key) {
        return Ok((key, hit));
    }
    let data = http::get_bytes(&format!("{ARCHIVE_HOST}/{key}")).await?;
    remember(&key, &data);
    Ok((key, data))
}

async fn archive_volume_at(
    station: &str,
    wanted: DateTime<Utc>,
) -> Result<(String, Vec<u8>), Level2Error> {
    let listing = http::get_bytes(&listing_url(station, wanted)).await?;
    let listing = String::from_utf8_lossy(&listing);
    if !listing.contains("<ListBucketResult") {
        return Err(Level2Error::BadListing);
    }
    let key =
        closest_key(&listing, wanted).ok_or_else(|| Level2Error::NoVolume(station.to_string()))?;
    if let Some(hit) = cached(&key) {
        return Ok((key, hit));
    }
    let data = http::get_bytes(&format!("{ARCHIVE_HOST}/{key}")).await?;
    remember(&key, &data);
    Ok((key, data))
}

fn cached(key: &str) -> Option<Vec<u8>> {
    let cache = CACHE.lock().ok()?;
    cache
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| entry.data.clone())
}

fn remember(key: &str, data: &[u8]) {
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
fn decoded_volume(key: &str, data: Vec<u8>) -> Result<Decoded, Level2Error> {
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
    remember_decoded(key, &scan, &nyquist, source_bytes);
    Ok((scan, nyquist))
}

fn normalized_volume(data: Vec<u8>) -> Result<volume::File, Level2Error> {
    if !data.starts_with(&[0x1f, 0x8b]) {
        return Ok(volume::File::new(data));
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
    Ok(volume::File::new(expanded))
}

struct LocalVolume {
    station: String,
    key: String,
    label: String,
    data: Vec<u8>,
}

fn read_local_volume(path: &Path) -> Result<LocalVolume, Level2Error> {
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
    if registry::site_by_id(&station).is_none() {
        return Err(Level2Error::UnknownSite(station));
    }

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

fn decoded_hit(key: &str) -> Option<Decoded> {
    let decoded = DECODED.lock().ok()?;
    decoded
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| (Arc::clone(&entry.scan), Arc::clone(&entry.nyquist)))
}

fn remember_decoded(
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

/// Every distinct tilt in a scan, ascending, rounded the way a panel shows them.
pub fn tilts(scan: &Scan) -> Vec<f32> {
    let mut angles: Vec<f32> = scan
        .sweeps()
        .iter()
        .filter_map(|sweep| sweep.elevation_angle_degrees())
        .map(|angle| (angle * 100.0).round() / 100.0)
        .collect();
    angles.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    angles.dedup();
    angles
}

/// A sweep chosen to draw: the field, the elevation it was cut at, and when
/// it was actually collected.
pub struct ChosenSweep {
    pub field: SweepField,
    pub elevation_degrees: f32,
    /// The cut's number within the volume, which is how the raw messages name
    /// it and therefore how its Nyquist velocity is found again.
    pub elevation_number: u8,
    pub collected: Option<DateTime<Utc>>,
}

/// The velocity a cut folds at.
///
/// Only the tests reach for this now. Everything the app draws goes through
/// the decoded-volume cache, which builds the whole table once per volume
/// rather than walking the records again for each cut asked about.
///
/// The sweep the model hands back does not carry it, so it is read from the
/// radial header in the raw messages. Only the first radial of the cut is
/// needed, and records are read in order, so this stops as soon as it finds one
/// rather than parsing the whole volume a second time.
#[cfg(test)]
fn nyquist_velocity(file: &volume::File, elevation_number: u8) -> Option<f32> {
    let records = file.records().ok()?;
    nyquist_from_records(&records, elevation_number)
}

/// The same, from records rather than a whole file.
///
/// The volume being swept right now arrives as loose records rather than as a
/// file, and it needs this as much as the finished one does: without it there
/// is no unfolding, and storm relative velocity refuses outright.
#[cfg(test)]
pub fn nyquist_from_records(records: &[volume::Record<'_>], elevation_number: u8) -> Option<f32> {
    nyquist_table(records).get(&elevation_number).copied()
}

/// Every cut's folding velocity, from whatever records are in hand.
///
/// The chunk path never holds a whole file, so it collects these as the pieces
/// arrive rather than reading a volume back a second time.
pub fn nyquist_table(records: &[volume::Record<'_>]) -> BTreeMap<u8, f32> {
    let mut found = BTreeMap::new();
    for record in records {
        let decompressed;
        let record = if record.compressed() {
            match record.decompress() {
                Ok(plain) => {
                    decompressed = plain;
                    &decompressed
                }
                Err(_) => continue,
            }
        } else {
            record
        };
        let Ok(messages) = record.messages() else {
            continue;
        };
        for message in messages {
            let MessageContents::DigitalRadarData(data) = message.contents() else {
                continue;
            };
            let Some(block) = data.radial_data_block() else {
                continue;
            };
            // Published as hundredths of a metre per second.
            let nyquist = block.nyquist_velocity_raw() as f32 * 0.01;
            if nyquist > 0.0 {
                found
                    .entry(data.header().elevation_number())
                    .or_insert(nyquist);
            }
        }
    }
    found
}

/// How close in a ring may be and still be the wind rather than the ground.
///
/// The first few kilometres of any sweep are ground clutter: buildings, trees
/// and terrain sitting still, which drags a fit toward nothing at all.
const WIND_NEAR_KM: f64 = 20.0;

/// How far out a ring may be and still be the wind anyone means.
///
/// The beam climbs with range, so past this the fit is describing air a couple
/// of kilometres up rather than the flow the storm is moving in.
const WIND_FAR_KM: f64 = 150.0;

/// How many rings are fitted across the sweep. More is slower and no more
/// certain, since the median of a dozen honest rings is already stable.
const WIND_RINGS: usize = 60;

/// How many rings the preferred band needs before it speaks for the sweep.
///
/// Preferring the band whenever it holds anything at all put the answer in the
/// hands of whatever was in it. A sweep with ground clutter out to thirty
/// kilometres and its only weather beyond a hundred and sixty had two rings in
/// the band, both of them sitting still, and they outvoted the thirty rings
/// that had the wind in them: the fit came back as no wind at all, which the
/// caller cannot tell from a light one.
const WIND_BAND_MIN_RINGS: usize = 4;

/// And what share of everything found it needs, for the same reason.
const WIND_BAND_MIN_SHARE: f64 = 0.25;

/// The wind the sweep is moving in, fitted from the readings themselves.
///
/// Rings are searched for across the whole sweep and then the ones between
/// twenty and a hundred and fifty kilometres are preferred: close in the beam
/// is too low and full of clutter, far out it is above the wind anyone means.
/// A sweep whose echo is all within thirty kilometres has nothing in that band
/// at all, and rather than return no wind for it the search falls back to
/// whatever rings it did find. Each ring is fitted on its own and the middle
/// answer kept, so one ring sitting inside a storm cannot carry the result
/// away with it.
fn fitted_wind(field: &SweepField) -> Option<vad::Wind> {
    let azimuths = field.azimuth_count();
    let gates = field.gate_count();
    if azimuths == 0 || gates == 0 {
        return None;
    }
    let elevation = field.elevation_degrees();
    let angles = field.azimuths();
    let first_km = field.first_gate_range_km();
    let interval_km = field.gate_interval_km();

    // Every ring that fits, right across the sweep, with how far out it was.
    // Walking the whole range is what separates this from picking rings by
    // position: the first twelve that happen to fit are all in the clutter.
    let stride = (gates / WIND_RINGS).max(1);
    let mut found: Vec<(f64, vad::Wind)> = Vec::new();
    let mut gate = 0;
    while gate < gates {
        let mut samples = Vec::with_capacity(azimuths);
        for azimuth in 0..azimuths {
            let (value, status) = field.get(azimuth, gate);
            if !matches!(status, GateStatus::Valid) {
                continue;
            }
            let Some(angle) = angles.get(azimuth) else {
                continue;
            };
            samples.push((*angle, value));
        }
        if let Some(wind) = vad::fit_ring(&samples, elevation) {
            found.push((first_km + gate as f64 * interval_km, wind));
        }
        gate += stride;
    }

    vad::median_wind(&rings_that_speak_for_the_sweep(&found))
}

/// Which of the fitted rings the answer is taken from.
///
/// Pulled out so the choice can be tested on its own: whether a ring inside
/// the clutter is excluded is a fact about this function, and a median over
/// enough rings is robust enough to hide it from an end-to-end assertion.
fn rings_that_speak_for_the_sweep(found: &[(f64, vad::Wind)]) -> Vec<vad::Wind> {
    let middle: Vec<vad::Wind> = found
        .iter()
        .filter(|(range, _)| *range >= WIND_NEAR_KM && *range <= WIND_FAR_KM)
        .map(|(_, wind)| *wind)
        .collect();
    // The band speaks for the sweep only when enough of the sweep is in it. A
    // handful of rings inside it cannot outvote everything outside.
    let enough = middle.len() >= WIND_BAND_MIN_RINGS
        && middle.len() as f64 >= found.len() as f64 * WIND_BAND_MIN_SHARE;
    if enough {
        return middle;
    }
    found.iter().map(|(_, wind)| *wind).collect()
}

/// Takes a wind out of a velocity field, in place.
///
/// What is left is what the picture would look like if the whole storm were
/// standing still, which is the only way a couplet shows through sixty knots of
/// ambient flow.
fn make_storm_relative(field: &mut SweepField, wind: vad::Wind) {
    let azimuths = field.azimuth_count();
    let gates = field.gate_count();
    let elevation = field.elevation_degrees();
    let angles = field.azimuths().to_vec();
    for azimuth in 0..azimuths {
        let Some(angle) = angles.get(azimuth).copied() else {
            continue;
        };
        let along = wind.along_beam(angle, elevation);
        for gate in 0..gates {
            let (value, status) = field.get(azimuth, gate);
            if !matches!(status, GateStatus::Valid) {
                continue;
            }
            field.set(azimuth, gate, value - along, GateStatus::Valid);
        }
    }
}

/// Shifts a velocity field back onto the flow it belongs to, in place.
///
/// Answers whether anything moved, which is the same question as whether the
/// picture on screen is still the radar's own reading. Nothing is written when
/// nothing moved.
///
/// It used to answer by looking for a reading outside the radar's limit, with
/// a little slack for the arithmetic, and that slack was a hole: a gate the
/// radar reported at 24.8 with a limit of 25 comes back at 25.2 when its fold
/// is taken out, which is inside the slack, so eighteen hundred rewritten
/// gates could be reported as no change at all and drawn on the narrow scale.
/// Every gate a fold is taken out of lands at or beyond the limit by
/// definition, since it started inside it and moved a whole interval, so
/// counting them answers the same question with no hole in it.
fn unfold_velocity(field: &mut SweepField, nyquist: f32) -> bool {
    let azimuths = field.azimuth_count();
    let gates = field.gate_count();
    let mut values = field.values().to_vec();
    let valid: Vec<bool> = field
        .statuses()
        .iter()
        .map(|status| matches!(status, GateStatus::Valid))
        .collect();

    let moved = dealias::dealias(&mut values, &valid, azimuths, gates, nyquist);
    if moved == 0 {
        return false;
    }

    // Whatever moved is written back. An earlier version threw the whole
    // correction away unless a set share of the sweep had moved, which meant a
    // sweep folded in only one place kept its fold: on a real KDMX cut folded
    // at 21 m/s, 410 gates wrapped, 0.5 per cent of the sweep, and every one of
    // them stayed wrapped. A fold in a hundred gates is still a fold, and it is
    // over the storm somebody is looking at.
    for azimuth in 0..azimuths {
        for gate in 0..gates {
            let at = azimuth * gates + gate;
            if valid[at] {
                field.set(azimuth, gate, values[at], GateStatus::Valid);
            }
        }
    }
    true
}

/// The sweep for a tilt, as a field of one product. A tilt past the end of the
/// list falls back to the lowest, which is the one a viewer wants by default.
///
/// A volume holds more than one cut at the same elevation: split cuts for
/// reflectivity and velocity, and under MESO-SAILS four separate looks at the
/// lowest tilt spread over five minutes. The one to draw is the one that
/// carries the product at the finest resolution, and of those the latest,
/// because the point of the extra looks is to see what just happened.
pub fn sweep_field(scan: &Scan, product: Product, tilt_index: usize) -> Option<ChosenSweep> {
    let angles = tilts(scan);
    let wanted = *angles.get(tilt_index).or_else(|| angles.first())?;
    sweep_field_at(scan, product, wanted)
}

/// The same, asked for by elevation angle rather than by position in the list.
///
/// A volume in progress holds only the cuts the radar has finished, so the
/// third entry in its list is not the third cut of the pattern. Asking by angle
/// is the only way to put the same cut of two volumes side by side.
pub fn sweep_field_at(scan: &Scan, product: Product, wanted: f32) -> Option<ChosenSweep> {
    let mut best: Option<ChosenSweep> = None;
    for sweep in scan.sweeps() {
        let Some(angle) = sweep.elevation_angle_degrees() else {
            continue;
        };
        if ((angle * 100.0).round() / 100.0 - wanted).abs() > SAME_CUT_DEGREES {
            continue;
        }
        let Some(field) = SweepField::from_radials(sweep.radials(), product) else {
            continue;
        };
        let collected = sweep.time_range().map(|(start, _)| start);
        let better = match &best {
            None => true,
            Some(held) => {
                (field.gate_count(), collected) > (held.field.gate_count(), held.collected)
            }
        };
        if better {
            best = Some(ChosenSweep {
                field,
                elevation_degrees: angle,
                elevation_number: sweep.elevation_number(),
                collected,
            });
        }
    }
    best
}

/// Paints one sweep into a Web Mercator RGBA image over the site's own extent.
/// How a sweep is to be drawn, as opposed to what is in it.
///
/// Three separate answers to the same question, which had been travelling as
/// loose positional arguments: whether the velocity has been unfolded, what to
/// hide, and which ramps to use. Two of them are bare booleans, so a call site
/// reading `false, false` said nothing about which was which.
#[derive(Clone, Copy)]
pub struct Shading {
    /// True when the velocity in this sweep has been unfolded past the
    /// radar's own limit, which decides how wide a scale it is drawn on.
    pub unfolded: bool,
    /// Hide anything weaker than this, in the product's own unit.
    pub threshold: Option<f32>,
    /// Draw with the ramps built for a reader who asked for more contrast.
    pub high_contrast: bool,
}

pub fn render_sweep(
    field: &SweepField,
    coordinates: &RadarCoordinateSystem,
    product: Product,
    unit: &str,
    shading: Shading,
) -> (Vec<u8>, [f64; 4]) {
    // A loaded colour table replaces the built-in ramp for the product it says
    // it is for, and nothing else. That is the whole point of loading one: two
    // people comparing the same storm see the same colours.
    let table = palette::for_unit(unit);
    let extent = coordinates.sweep_extent(MAX_RANGE_KM);
    let west = extent.min.longitude;
    let east = extent.max.longitude;
    let south = extent.min.latitude;
    let north = extent.max.latitude;

    let top = mercator_y(north);
    let bottom = mercator_y(south);
    let elevation = field.elevation_degrees();

    // A generic moment has no standard ramp, so it is scaled to what it holds.
    let range = match product {
        Product::Reflectivity | Product::Velocity => None,
        _ => field.value_range(),
    };

    let mut pixels = vec![0u8; IMAGE_SIZE * IMAGE_SIZE * 4];
    for row in 0..IMAGE_SIZE {
        let y = top + (bottom - top) * ((row as f64 + 0.5) / IMAGE_SIZE as f64);
        let latitude = inverse_mercator_y(y);
        for column in 0..IMAGE_SIZE {
            let longitude = west + (east - west) * ((column as f64 + 0.5) / IMAGE_SIZE as f64);
            let polar = coordinates.geo_to_polar(
                GeoPoint {
                    latitude,
                    longitude,
                },
                elevation,
            );
            let Some((value, status)) = field.value_at_polar(polar.azimuth_degrees, polar.range_km)
            else {
                continue;
            };

            let Some((color, alpha)) =
                gate_color(&status, value, product, table.as_ref(), range, shading)
            else {
                continue;
            };

            let at = (row * IMAGE_SIZE + column) * 4;
            pixels[at] = color[0];
            pixels[at + 1] = color[1];
            pixels[at + 2] = color[2];
            pixels[at + 3] = alpha;
        }
    }

    (pixels, [west, south, east, north])
}

/// The colour and opacity one gate is drawn in, or None to leave it clear so
/// the map shows through.
fn gate_color(
    status: &GateStatus,
    value: f32,
    product: Product,
    table: Option<&Palette>,
    range: Option<(f32, f32)>,
    shading: Shading,
) -> Option<([u8; 3], u8)> {
    let Shading {
        unfolded,
        threshold,
        high_contrast,
    } = shading;
    match status {
        GateStatus::Valid => {
            // Velocity runs either side of zero and both sides are the storm,
            // so its threshold is on how fast rather than on which way.
            // Everything else reads low to high and compares as it is.
            let measured = if matches!(product, Product::Velocity) {
                value.abs()
            } else {
                value
            };
            if threshold.is_some_and(|floor| measured < floor) {
                return None;
            }
            match table {
                Some(table) => {
                    if value < table.floor() {
                        return None;
                    }
                    Some((table.color(value), MAX_ALPHA))
                }
                None => match product {
                    Product::Reflectivity => {
                        // Below the lowest ramp stop there is nothing the
                        // legend could name, so the ground shows through.
                        if value < FADE_FLOOR_DBZ {
                            return None;
                        }
                        Some((
                            ramp_color(
                                if high_contrast {
                                    HIGH_CONTRAST_REFLECTIVITY_RAMP
                                } else {
                                    REFLECTIVITY_RAMP
                                },
                                value,
                            ),
                            reflectivity_alpha(value),
                        ))
                    }
                    Product::Velocity => {
                        let ramp = match (high_contrast, unfolded) {
                            (true, true) => HIGH_CONTRAST_WIDE_VELOCITY_RAMP,
                            (true, false) => HIGH_CONTRAST_VELOCITY_RAMP,
                            (false, true) => WIDE_VELOCITY_RAMP,
                            (false, false) => VELOCITY_RAMP,
                        };
                        Some((ramp_color(ramp, value), MAX_ALPHA))
                    }
                    _ => {
                        let (low, high) = range.unwrap_or((0.0, 1.0));
                        let span = high - low;
                        let scaled = if span > 0.0 {
                            (value - low) / span
                        } else {
                            0.0
                        };
                        Some((ramp_color(GENERIC_RAMP, scaled), MAX_ALPHA))
                    }
                },
            }
        }
        // A folded gate has no value on the scale, so it takes the colour the
        // loaded table names for it and falls back to the built-in purple. A
        // threshold cannot speak to it either way: there is no reading to
        // compare, so hiding it would be inventing an answer.
        GateStatus::RangeFolded => Some((
            table
                .and_then(|table| table.range_folded)
                .unwrap_or(RANGE_FOLDED),
            MAX_ALPHA,
        )),
        GateStatus::BelowThreshold | GateStatus::NoData => None,
    }
}

fn encode_png(pixels: &[u8]) -> Result<Vec<u8>, Level2Error> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, IMAGE_SIZE as u32, IMAGE_SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| Level2Error::Encode(error.to_string()))?;
        writer
            .write_image_data(pixels)
            .map_err(|error| Level2Error::Encode(error.to_string()))?;
    }
    Ok(out)
}

fn data_url(png_bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png_bytes)
    )
}

/// Decodes a volume and draws one of its sweeps. Split out from the command so
/// a test can run it against a file without touching the network.
/// What the reader asked to see, past which volume it came from.
#[derive(Debug, Clone, Copy, Default)]
pub struct SweepRequest<'a> {
    pub product_name: &'a str,
    pub tilt_index: usize,
    pub unfold: bool,
    /// A motion the viewer gave, rather than one read off the sweep.
    pub manual_motion: Option<vad::Wind>,
    /// Gates weaker than this are left clear, in the product's own unit.
    pub threshold: Option<f32>,
    /// Draw with the ramps built for a reader who has asked for more contrast.
    pub high_contrast: bool,
}

pub fn sweep_from_volume(
    station: &str,
    volume_key: &str,
    data: Vec<u8>,
    asked: SweepRequest<'_>,
) -> Result<SweepImage, Level2Error> {
    let (scan, nyquist) = decoded_volume(volume_key, data)?;
    let folding = |elevation: u8| nyquist.get(&elevation).copied();
    sweep_from_scan(station, volume_key, &scan, &folding, asked)
}

/// The same, from a scan that has already been put together.
///
/// The volume being swept right now arrives as chunks rather than as a file,
/// and everything past this point is the same either way: the same sweep
/// chooser, the same unfolding, the same drawing. Only how the readings got
/// here differs, and that is settled before this is called.
pub fn sweep_from_scan(
    station: &str,
    volume_key: &str,
    scan: &Scan,
    nyquist_for: &dyn Fn(u8) -> Option<f32>,
    asked: SweepRequest<'_>,
) -> Result<SweepImage, Level2Error> {
    let prepared = prepare_sweep(station, scan, nyquist_for, asked, None)?;
    draw_sweep(
        station,
        volume_key,
        tilts(scan),
        asked.tilt_index,
        prepared,
        None,
        asked,
        scan.time_range().map(|(start, _)| start),
        None,
    )
}

/// One sweep found and worked on, before anything has been drawn.
///
/// Splitting this from the drawing is what lets a volume in progress be laid
/// over the last finished one: both go through the same choosing, the same
/// unfolding and the same subtraction, and only then are they put together.
struct Prepared {
    chosen: ChosenSweep,
    dealiased: bool,
    storm_motion: Option<StormMotion>,
    product: Product,
    label: &'static str,
    unit: &'static str,
}

fn prepare_sweep(
    station: &str,
    scan: &Scan,
    nyquist_for: &dyn Fn(u8) -> Option<f32>,
    asked: SweepRequest<'_>,
    // The cut to look for by angle rather than by position. A volume in
    // progress holds only the tilts it has reached, so counting into its list
    // would land on a different cut than the same number does in a full one.
    angle: Option<f32>,
) -> Result<Prepared, Level2Error> {
    let SweepRequest {
        product_name,
        tilt_index,
        unfold,
        manual_motion,
        threshold: _,
        high_contrast: _,
    } = asked;
    let (product, label, unit) = product_from_name(product_name)
        .ok_or_else(|| Level2Error::NoSweep(station.to_string(), product_name.to_string()))?;

    let mut chosen = match angle {
        Some(wanted) => sweep_field_at(scan, product, wanted),
        None => sweep_field(scan, product, tilt_index),
    }
    .ok_or_else(|| Level2Error::NoSweep(station.to_string(), label.to_string()))?;

    // Velocity past the folding limit wraps around, so a strong outbound wind
    // is drawn as if it were inbound. Only velocity folds, and only if the
    // volume says what it folds at.
    // Reported only when gates actually moved. A sweep that never folded is
    // the radar's own reading, and saying otherwise would have the legend claim
    // a change that was not made.
    let storm_relative = product_name == "storm-relative-velocity";
    // Storm relative is the same moment with the ambient wind taken out, and
    // the wind is read off the sweep, so a folded sweep has to be unfolded
    // first whatever the switch says. A fit against a folded field collapses:
    // measured on a 20 m/s wind folded at 8, it comes back with 1.4.
    let mut dealiased = false;
    if (unfold || storm_relative) && product == Product::Velocity {
        if let Some(nyquist) = nyquist_for(chosen.elevation_number) {
            dealiased = unfold_velocity(&mut chosen.field, nyquist);
        } else if storm_relative && manual_motion.is_none() {
            // No Nyquist velocity means no unfolding, and a wind read off a
            // sweep that may still be folded is not a wind. A motion the
            // viewer gave is theirs to stand behind, so that still goes ahead.
            return Err(Level2Error::NoStormMotion(station.to_string()));
        }
    }

    let mut storm_motion = None;
    if storm_relative {
        let wind = match manual_motion {
            Some(given) => Some(given),
            None => fitted_wind(&chosen.field),
        };
        // Nothing to subtract is not the same as nothing to take out. Drawing
        // raw velocity under the storm relative label would be the worst of
        // both: the picture unchanged and the reader told otherwise.
        let wind = wind.ok_or_else(|| Level2Error::NoStormMotion(station.to_string()))?;
        make_storm_relative(&mut chosen.field, wind);
        storm_motion = Some(StormMotion {
            speed_ms: wind.speed(),
            from_degrees: wind.coming_from_degrees(),
            manual: manual_motion.is_some(),
        });
    }

    Ok(Prepared {
        chosen,
        dealiased,
        storm_motion,
        product,
        label,
        unit,
    })
}

/// Paints a prepared sweep, optionally over the one before it.
#[allow(clippy::too_many_arguments)]
fn draw_sweep(
    station: &str,
    volume_key: &str,
    // The cuts the picker should offer, which for a live sweep is the list from
    // the last finished volume rather than the part-built one on screen.
    tilts_offered: Vec<f32>,
    tilt_index: usize,
    prepared: Prepared,
    // The last finished volume's sweep, drawn under the sector this one covers.
    beneath: Option<Prepared>,
    asked: SweepRequest<'_>,
    // The volume's own start time, used when the cut does not carry one.
    volume_time: Option<DateTime<Utc>>,
    // How many cuts the volume in progress has published, when this is live.
    live_tilts: Option<usize>,
) -> Result<SweepImage, Level2Error> {
    let Prepared {
        chosen,
        dealiased,
        storm_motion,
        product,
        label,
        unit,
    } = prepared;
    let threshold = asked.threshold;

    let site = registry::site_by_id(station).map(|entry| entry.to_site());
    let site = site.ok_or_else(|| Level2Error::UnknownSite(station.to_string()))?;
    let coordinates = RadarCoordinateSystem::new(&site);

    let (mut pixels, [west, south, east, north]) = render_sweep(
        &chosen.field,
        &coordinates,
        product,
        unit,
        Shading {
            unfolded: dealiased,
            threshold,
            high_contrast: asked.high_contrast,
        },
    );

    if let Some(under) = beneath {
        // Every render covers the same extent at the same size, so the two
        // line up pixel for pixel and the sector decides which one shows.
        let (older, _) = render_sweep(
            &under.chosen.field,
            &coordinates,
            under.product,
            under.unit,
            Shading {
                unfolded: under.dealiased,
                threshold,
                high_contrast: asked.high_contrast,
            },
        );
        pixels = lay_over(older, pixels, &swept_pixels(&chosen.field, &coordinates));
    }

    let png_bytes = encode_png(&pixels)?;

    // The sweep's own time, not the volume's: under MESO-SAILS the lowest tilt
    // is cut four times across five minutes, and saying which one is on screen
    // is the difference between a current picture and a stale one.
    let collected = chosen
        .collected
        .or(volume_time)
        .or_else(|| key_time(volume_key))
        .unwrap_or_else(Utc::now);

    let entry = registry::site_by_id(station);
    Ok(SweepImage {
        station: station.to_string(),
        product_id: asked.product_name.to_string(),
        palette_applied: palette::for_unit(unit).is_some(),
        site_name: entry
            .map(|site| format!("{}, {}", site.city, site.state))
            .unwrap_or_else(|| station.to_string()),
        product: label.to_string(),
        unit: unit.to_string(),
        dealiased,
        storm_motion,
        elevation_degrees: (chosen.elevation_degrees * 100.0).round() / 100.0,
        tilts: tilts_offered,
        tilt_index,
        live: live_tilts.is_some(),
        live_tilts: live_tilts.unwrap_or(0),
        collected: collected.to_rfc3339(),
        west,
        south,
        east,
        north,
        image: data_url(&png_bytes),
        volume: volume_key.to_string(),
        source: SweepSource {
            kind: "recent".to_string(),
            label: "NOAA NEXRAD Level II".to_string(),
            url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
        },
    })
}

/// How finely the swept sector is measured, in slots around the circle.
const SECTOR_SLOTS: usize = 3600;

/// Which pixels the sweep in hand actually swept.
///
/// Outside the sector a volume in progress has reached, the last finished
/// volume is all there is to show. Inside it the new sweep is the whole answer,
/// empty gates included: a storm that has moved on has to come off the picture
/// rather than be left painted where it used to be.
fn swept_pixels(field: &SweepField, coordinates: &RadarCoordinateSystem) -> Vec<bool> {
    let mut ring = vec![false; SECTOR_SLOTS];
    let per_slot = 360.0 / SECTOR_SLOTS as f32;
    // A radial stands for the wedge it was measured across, not for a line.
    let half = field.azimuth_spacing_degrees().abs().max(per_slot) / 2.0;
    for azimuth in field.azimuths() {
        let first = ((azimuth - half) / per_slot).floor() as i64;
        let last = ((azimuth + half) / per_slot).ceil() as i64;
        for slot in first..=last {
            let slot = slot.rem_euclid(SECTOR_SLOTS as i64) as usize;
            ring[slot] = true;
        }
    }

    let near = field.first_gate_range_km();
    let far = field.max_range_km();
    let extent = coordinates.sweep_extent(MAX_RANGE_KM);
    let west = extent.min.longitude;
    let east = extent.max.longitude;
    let top = mercator_y(extent.max.latitude);
    let bottom = mercator_y(extent.min.latitude);
    let elevation = field.elevation_degrees();

    let mut swept = vec![false; IMAGE_SIZE * IMAGE_SIZE];
    for row in 0..IMAGE_SIZE {
        let y = top + (bottom - top) * ((row as f64 + 0.5) / IMAGE_SIZE as f64);
        let latitude = inverse_mercator_y(y);
        for column in 0..IMAGE_SIZE {
            let longitude = west + (east - west) * ((column as f64 + 0.5) / IMAGE_SIZE as f64);
            let polar = coordinates.geo_to_polar(
                GeoPoint {
                    latitude,
                    longitude,
                },
                elevation,
            );
            if polar.range_km < near || polar.range_km >= far {
                continue;
            }
            let slot = (polar.azimuth_degrees.rem_euclid(360.0) / per_slot) as usize;
            if ring[slot.min(SECTOR_SLOTS - 1)] {
                swept[row * IMAGE_SIZE + column] = true;
            }
        }
    }
    swept
}

/// Puts the newer picture over the older one, but only where it was swept.
fn lay_over(older: Vec<u8>, newer: Vec<u8>, swept: &[bool]) -> Vec<u8> {
    let mut out = older;
    for (index, covered) in swept.iter().enumerate() {
        if !covered {
            continue;
        }
        let at = index * 4;
        out[at..at + 4].copy_from_slice(&newer[at..at + 4]);
    }
    out
}

fn great_circle_km(
    latitude: f64,
    longitude: f64,
    other_latitude: f64,
    other_longitude: f64,
) -> f64 {
    let lat1 = latitude.to_radians();
    let lat2 = other_latitude.to_radians();
    let d_lat = lat2 - lat1;
    let d_lon = (other_longitude - longitude).to_radians();
    let a = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);
    6371.0 * 2.0 * a.sqrt().asin()
}

/// Every site whose coverage reaches a point, nearest first.
fn sites_in_reach(latitude: f32, longitude: f32) -> Vec<&'static registry::SiteEntry> {
    let mut found: Vec<(f64, &'static registry::SiteEntry)> = registry::sites()
        .iter()
        .filter_map(|site| {
            let distance = great_circle_km(
                latitude as f64,
                longitude as f64,
                site.latitude as f64,
                site.longitude as f64,
            );
            (distance <= SITE_REACH_KM).then_some((distance, site))
        })
        .collect();
    found.sort_by(|left, right| left.0.total_cmp(&right.0));
    found.into_iter().map(|(_, site)| site).collect()
}

/// Whether a site's newest volume is recent enough to be worth drawing.
///
/// A radar down for maintenance, or one whose upload to the archive has
/// stalled, stops publishing volumes while its entry in the registry stays
/// exactly where it was. The archive is the direct evidence: if no volume has
/// landed in the last twenty minutes there is nothing to draw, whatever the
/// site's published status says.
fn volume_is_current(newest: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    let Some(at) = newest else {
        return false;
    };
    let age = now.signed_duration_since(at);
    // A clock skewed the other way would otherwise read as infinitely stale.
    age <= Duration::minutes(STALE_AFTER_MINUTES) && age >= Duration::minutes(-5)
}

/// The first site that has something to draw, or the nearest one if none of
/// them has.
///
/// Falling back to the nearest matters: when the whole region is quiet, or the
/// archive itself is unreachable, the panel should report that site's own
/// failure rather than behave as though the viewport were out of coverage.
fn first_site_with_a_volume<'a>(
    sites: &[&'a registry::SiteEntry],
    newest: impl Fn(&str) -> Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Option<&'a registry::SiteEntry> {
    sites
        .iter()
        .find(|site| volume_is_current(newest(site.id), now))
        .or_else(|| sites.first())
        .copied()
}

/// The newest volume time the archive holds for a site, remembered briefly so
/// that panning across a region does not re-list the bucket for every site it
/// passes over.
async fn newest_volume_time(station: &str) -> Option<DateTime<Utc>> {
    let now = Utc::now();
    if let Ok(seen) = LIVENESS.lock() {
        if let Some((checked, newest, failed)) = seen.get(station) {
            let ttl = if *failed {
                LIVENESS_FAILURE_TTL_SECONDS
            } else {
                LIVENESS_TTL_SECONDS
            };
            if now.signed_duration_since(*checked) < Duration::seconds(ttl) {
                return *newest;
            }
        }
    }

    let mut newest = None;
    for day in [now, now - Duration::days(1)] {
        let Ok(listing) = http::get_bytes(&listing_url(station, day)).await else {
            // Unreachable is not the same as down. It is remembered briefly all
            // the same, or panning with no network fires the whole burst again
            // every tenth of a degree.
            if let Ok(mut seen) = LIVENESS.lock() {
                seen.insert(station.to_string(), (now, None, true));
            }
            return None;
        };
        let listing = String::from_utf8_lossy(&listing);
        if let Some(key) = newest_key(&listing) {
            newest = key_time(&key);
            break;
        }
    }

    if let Ok(mut seen) = LIVENESS.lock() {
        seen.insert(station.to_string(), (now, newest, false));
    }
    newest
}

/// The nearest site to a point that is actually publishing volumes, so the
/// frontend never has to ship its own table. A point no site can see gets no
/// answer rather than the least distant one, which would otherwise draw
/// Alaska's radar over the mid-Atlantic.
#[tauri::command]
pub async fn level2_nearest_site(latitude: f32, longitude: f32) -> Option<String> {
    let sites = sites_in_reach(latitude, longitude);
    if sites.is_empty() {
        return None;
    }

    // Only the closest few are worth asking about. Past that the beam is high
    // enough over the viewport that a nearer site being down is the smaller
    // problem, and each question costs a listing.
    let asked: Vec<&'static registry::SiteEntry> =
        sites.iter().take(MAX_SITE_CANDIDATES).copied().collect();
    let mut times: Vec<(&str, Option<DateTime<Utc>>)> = Vec::with_capacity(asked.len());
    for site in &asked {
        times.push((site.id, newest_volume_time(site.id).await));
        // The first one that answers is the answer; the rest go unasked.
        if volume_is_current(times.last().expect("just pushed").1, Utc::now()) {
            break;
        }
    }

    first_site_with_a_volume(
        &asked,
        |id| {
            times
                .iter()
                .find(|(site, _)| *site == id)
                .and_then(|(_, at)| *at)
        },
        Utc::now(),
    )
    .map(|site| site.id.to_string())
}

fn requested_sweep<'a>(
    product: &'a str,
    tilt: usize,
    dealias: bool,
    motion: Option<(f32, f32)>,
    threshold: Option<f32>,
    high_contrast: bool,
) -> SweepRequest<'a> {
    let manual_motion = motion.map(|(speed, from_degrees)| {
        // A wind named by where it comes from, turned back into the components
        // the subtraction needs.
        let towards = (from_degrees + 180.0).to_radians();
        vad::Wind {
            east: speed * towards.sin(),
            north: speed * towards.cos(),
        }
    });
    SweepRequest {
        product_name: product,
        tilt_index: tilt,
        unfold: dealias,
        manual_motion,
        threshold,
        high_contrast,
    }
}

#[tauri::command]
// A Tauri command takes its arguments by name from the page, so the list is the
// contract with the frontend rather than a signature free to be reshaped. The
// three that belong together are grouped into `Shading` the moment they are
// past this boundary.
#[allow(clippy::too_many_arguments)]
pub async fn level2_sweep(
    station: String,
    product: String,
    tilt: usize,
    dealias: bool,
    // Speed in metres a second and the direction it comes from, when the viewer
    // would rather say than have the sweep read for it.
    motion: Option<(f32, f32)>,
    // Hide gates weaker than this, in the product's own unit. A value that is
    // not a number is no threshold rather than a threshold of nothing.
    threshold: Option<f32>,
    // Read the volume the radar is sweeping now rather than the last one it
    // finished. The archive object lands only when a volume is complete, so
    // that picture is four to six minutes behind by definition.
    live: bool,
    // Draw with the ramps built for a reader who has asked for more contrast.
    // Sent by the page rather than read here, because the preference belongs to
    // the window and the native side has no view of the media query.
    high_contrast: bool,
) -> Result<SweepImage, Level2Error> {
    let station = station.to_uppercase();
    if registry::site_by_id(&station).is_none() {
        return Err(Level2Error::UnknownSite(station));
    }
    let (key, data) = latest_volume(&station).await?;

    // The volume in progress is drawn over the last finished one, so the live
    // path needs both. A site that is not publishing chunks, or one between
    // volumes, simply gets the finished picture: that is what the archive path
    // has always shown and it is never wrong, only behind.
    let live = if live {
        match chunks::live_scan(&station).await {
            Ok(found) => Some(found),
            Err(reason) => {
                log::debug!("no live volume for {station}: {reason}");
                None
            }
        }
    } else {
        None
    };

    // Decoding and drawing a volume is CPU work; it must not sit on the async
    // runtime the whole time.
    tauri::async_runtime::spawn_blocking(move || {
        let asked = requested_sweep(&product, tilt, dealias, motion, threshold, high_contrast);
        match live {
            Some(found) => {
                // The finished volume underneath a live sweep is the same
                // archive volume as ever, so it comes from the same cache. It
                // was being decoded again on every refresh, which is once every
                // few seconds while a live sweep is on.
                let (older, folding) = decoded_volume(&key, data)?;
                sweep_over(
                    &station,
                    &found.volume.volume.to_string(),
                    &older,
                    &|elevation| folding.get(&elevation).copied(),
                    &found.scan,
                    &|elevation| found.nyquist.get(&elevation).copied(),
                    asked,
                )
            }
            None => sweep_from_volume(&station, &key, data, asked),
        }
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn level2_archive_sweep(
    station: String,
    at: String,
    product: String,
    tilt: usize,
    dealias: bool,
    motion: Option<(f32, f32)>,
    threshold: Option<f32>,
    high_contrast: bool,
) -> Result<SweepImage, Level2Error> {
    let station = station.to_uppercase();
    if registry::site_by_id(&station).is_none() {
        return Err(Level2Error::UnknownSite(station));
    }
    let wanted = DateTime::parse_from_rfc3339(&at)
        .map_err(|_| Level2Error::InvalidTime(at.clone()))?
        .with_timezone(&Utc);
    let (key, data) = archive_volume_at(&station, wanted).await?;

    tauri::async_runtime::spawn_blocking(move || {
        let asked = requested_sweep(&product, tilt, dealias, motion, threshold, high_contrast);
        let mut sweep = sweep_from_volume(&station, &key, data, asked)?;
        sweep.source = SweepSource {
            kind: "archive".to_string(),
            label: "NOAA NEXRAD Level II archive".to_string(),
            url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
        };
        Ok(sweep)
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn level2_local_sweep(
    path: String,
    product: String,
    tilt: usize,
    dealias: bool,
    motion: Option<(f32, f32)>,
    threshold: Option<f32>,
    high_contrast: bool,
) -> Result<SweepImage, Level2Error> {
    tauri::async_runtime::spawn_blocking(move || {
        let local = read_local_volume(&PathBuf::from(path))?;
        let asked = requested_sweep(&product, tilt, dealias, motion, threshold, high_contrast);
        let mut sweep = sweep_from_volume(&local.station, &local.key, local.data, asked)?;
        sweep.source = SweepSource {
            kind: "local".to_string(),
            label: local.label,
            url: None,
        };
        Ok(sweep)
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

/// Draws the volume in progress over the last one the radar finished.
///
/// The sector the radar has swept since the last volume closed is the new
/// picture; everywhere else the finished volume is still the best there is.
/// If the cut being asked for has not been reached yet, there is nothing live
/// to show for it and the finished volume is the whole answer.
fn sweep_over(
    station: &str,
    volume_key: &str,
    older: &Scan,
    older_nyquist: &dyn Fn(u8) -> Option<f32>,
    live: &Scan,
    live_nyquist: &dyn Fn(u8) -> Option<f32>,
    asked: SweepRequest<'_>,
) -> Result<SweepImage, Level2Error> {
    let offered = tilts(older);
    // The picker counts into the finished volume's cuts, because the one in
    // progress has only the cuts it has reached so far and its third entry is
    // not the pattern's third cut.
    let angle = offered
        .get(asked.tilt_index)
        .or_else(|| offered.first())
        .copied();
    let Some(angle) = angle else {
        return Err(Level2Error::NoSweep(
            station.to_string(),
            asked.product_name.to_string(),
        ));
    };

    let beneath = prepare_sweep(station, older, older_nyquist, asked, Some(angle));
    let Ok(newer) = prepare_sweep(station, live, live_nyquist, asked, Some(angle)) else {
        // The radar has not reached this cut in the volume it is sweeping now,
        // so the finished volume is the whole picture and says nothing about
        // being live, because none of what is on screen is.
        return draw_sweep(
            station,
            volume_key,
            offered,
            asked.tilt_index,
            beneath?,
            None,
            asked,
            older.time_range().map(|(start, _)| start),
            None,
        );
    };

    draw_sweep(
        station,
        volume_key,
        offered,
        asked.tilt_index,
        newer,
        beneath.ok(),
        asked,
        live.time_range().map(|(start, _)| start),
        Some(tilts(live).len()),
    )
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;
    use crate::fixture;

    /// A sweep in a steady wind, with echo only over the range band given.
    ///
    /// Everything outside the band reads as no data, which is what a sweep
    /// looks like when the weather is all in one place.
    fn sweep_in_a_wind(
        wind: vad::Wind,
        elevation: f32,
        echo_from_km: f64,
        echo_to_km: f64,
    ) -> SweepField {
        let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
        let gates = 1200;
        let first_km = 2.125;
        let interval_km = 0.25;
        let mut field = SweepField::new_empty(
            "Velocity",
            "m/s",
            elevation,
            azimuths.clone(),
            1.0,
            first_km,
            interval_km,
            gates,
        );
        for (index, azimuth) in azimuths.iter().enumerate() {
            for gate in 0..gates {
                let range = first_km + gate as f64 * interval_km;
                if range < echo_from_km || range > echo_to_km {
                    continue;
                }
                field.set(
                    index,
                    gate,
                    wind.along_beam(*azimuth, elevation),
                    GateStatus::Valid,
                );
            }
        }
        field
    }

    /// A sweep with echo everywhere and a different wind in each range band.
    ///
    /// The beam climbs with range, so range is height, and a real wind changes
    /// with height. That is the whole reason it matters which part of the
    /// sweep the rings come from.
    fn layered_sweep(bands: &[(f64, f64, vad::Wind)], elevation: f32) -> SweepField {
        let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
        let gates = 1200;
        let first_km = 2.125;
        let interval_km = 0.25;
        let mut field = SweepField::new_empty(
            "Velocity",
            "m/s",
            elevation,
            azimuths.clone(),
            1.0,
            first_km,
            interval_km,
            gates,
        );
        for (index, azimuth) in azimuths.iter().enumerate() {
            for gate in 0..gates {
                let range = first_km + gate as f64 * interval_km;
                let Some((_, _, wind)) = bands
                    .iter()
                    .find(|(from, to, _)| range >= *from && range < *to)
                else {
                    continue;
                };
                field.set(
                    index,
                    gate,
                    wind.along_beam(*azimuth, elevation),
                    GateStatus::Valid,
                );
            }
        }
        field
    }

    /// Twenty metres a second from the given direction.
    fn wind_from(degrees: f32, speed: f32) -> vad::Wind {
        let toward = (degrees + 180.0).to_radians();
        vad::Wind {
            east: speed * toward.sin(),
            north: speed * toward.cos(),
        }
    }

    #[test]
    fn the_wind_is_read_from_across_the_whole_sweep() {
        // The search walks every gate. A version that stopped after the first
        // twelve rings it could fit never got past the innermost fifth, so a
        // squall line eighty kilometres out was invisible to it and the wind
        // came back as nothing at all.
        let truth = wind_from(225.0, 20.0);
        let field = sweep_in_a_wind(truth, 0.5, 80.0, 140.0);
        let read = fitted_wind(&field).expect("a wind from where the echo is");
        assert!((read.speed() - 20.0).abs() < 1.0, "{}", read.speed());
        assert!(
            (read.coming_from_degrees() - 225.0).abs() < 5.0,
            "{}",
            read.coming_from_degrees()
        );
    }

    #[test]
    fn the_flow_the_storm_is_in_outvotes_the_layer_at_each_end() {
        // Three winds stacked the way a real sounding stacks them: a light
        // surface layer, the flow the storm is actually moving in, and
        // something else again above it. The middle one is the answer.
        //
        // A search that stops after twelve rings never leaves the surface
        // layer and returns the four metres a second, which is what it did on
        // a live volume. One with no preferred band takes the median across
        // all three and lands between them, pointing nowhere in particular.
        let surface = wind_from(180.0, 4.0);
        let flow = wind_from(225.0, 20.0);
        let aloft = wind_from(45.0, 20.0);
        let field = layered_sweep(
            &[
                (0.0, 60.0, surface),
                (60.0, WIND_FAR_KM, flow),
                (WIND_FAR_KM, 300.0, aloft),
            ],
            0.5,
        );
        let read = fitted_wind(&field).expect("a wind");
        assert!(
            (read.speed() - 20.0).abs() < 2.0,
            "read {} m/s, wanted the flow at 20",
            read.speed()
        );
        let apart = (read.coming_from_degrees() - 225.0).abs();
        assert!(
            apart.min(360.0 - apart) < 10.0,
            "read from {}, wanted 225",
            read.coming_from_degrees()
        );
    }

    /// A field of one steady value, for the render tests below.
    fn flat_field(value: f32, product: Product) -> (SweepField, RadarCoordinateSystem) {
        let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
        let gates = 400;
        let mut field = SweepField::new_empty(
            if matches!(product, Product::Velocity) {
                "Velocity"
            } else {
                "Reflectivity"
            },
            if matches!(product, Product::Velocity) {
                "m/s"
            } else {
                "dBZ"
            },
            0.5,
            azimuths.clone(),
            1.0,
            2.125,
            0.25,
            gates,
        );
        for azimuth in 0..azimuths.len() {
            for gate in 0..gates {
                field.set(azimuth, gate, value, GateStatus::Valid);
            }
        }
        let site = registry::site_by_id("KDMX").expect("KDMX").to_site();
        let coordinates = RadarCoordinateSystem::new(&site);
        (field, coordinates)
    }

    #[test]
    fn the_threshold_reaches_the_picture_that_is_drawn() {
        // gate_color is tested on its own, but nothing proved the value the
        // reader set ever arrived there: passing None from render_sweep, or
        // from the command below it, left every test green.
        let drawn = |value: f32, floor: Option<f32>| {
            let (field, coordinates) = flat_field(value, Product::Reflectivity);
            let (pixels, _) = render_sweep(
                &field,
                &coordinates,
                Product::Reflectivity,
                "dBZ",
                Shading {
                    unfolded: false,
                    threshold: floor,
                    high_contrast: false,
                },
            );
            pixels.chunks_exact(4).filter(|p| p[3] > 0).count()
        };

        let whole = drawn(40.0, None);
        assert!(whole > 0, "the fixture has to draw something");
        assert_eq!(drawn(40.0, Some(35.0)), whole, "40 dBZ is over 35");
        assert_eq!(drawn(40.0, Some(45.0)), 0, "40 dBZ is under 45");

        // And it can only hide. Under the ramp's own floor nothing comes back.
        assert_eq!(drawn(FADE_FLOOR_DBZ - 5.0, Some(-100.0)), 0);
    }

    #[test]
    fn a_sweep_the_radar_read_cleanly_is_left_as_it_gave_it() {
        // Unfolding writes back only when enough of the sweep moved. Below
        // that bar it used to write anyway and report the sweep as not
        // unfolded, which drew gates outside the limit on the narrow scale.
        let (mut field, _) = flat_field(3.0, Product::Velocity);
        let before: Vec<f32> = (0..field.azimuth_count())
            .flat_map(|azimuth| (0..field.gate_count()).map(move |gate| (azimuth, gate)))
            .map(|(azimuth, gate)| field.get(azimuth, gate).0)
            .collect();

        // Every reading is well inside the folding limit, so there is nothing
        // to unfold and nothing should be written.
        let moved = unfold_velocity(&mut field, 30.0);
        assert!(!moved, "a sweep with no folds in it was called unfolded");

        let after: Vec<f32> = (0..field.azimuth_count())
            .flat_map(|azimuth| (0..field.gate_count()).map(move |gate| (azimuth, gate)))
            .map(|(azimuth, gate)| field.get(azimuth, gate).0)
            .collect();
        assert_eq!(before, after, "the field was written to anyway");
    }

    #[test]
    fn a_ring_in_the_ground_clutter_is_not_asked_what_the_wind_is() {
        // The near edge exists because the first few kilometres of any sweep
        // are buildings and terrain sitting still. A median over enough rings
        // resists a minority, so whether they are excluded cannot be seen from
        // the fitted wind alone: it is a fact about which rings are chosen.
        let ground = wind_from(0.0, 0.2);
        let flow = wind_from(225.0, 20.0);
        // Twenty kilometres and a hundred and fifty are written out rather
        // than read from the constants, so moving a constant cannot quietly
        // move the fixture with it and leave the test passing.
        let found: Vec<(f64, vad::Wind)> = (0..40)
            .map(|at| {
                let range = 2.0 + at as f64 * 5.0;
                (range, if range < 20.0 { ground } else { flow })
            })
            .collect();
        assert!(
            found.iter().any(|(range, _)| *range < 20.0),
            "the fixture has to hold some clutter to exclude"
        );

        let chosen = rings_that_speak_for_the_sweep(&found);
        assert!(
            !chosen.contains(&ground),
            "a ring from inside twenty kilometres was asked what the wind is"
        );
        // And nothing from outside the band at either end: above the far edge
        // the beam is over the weather rather than in it.
        assert_eq!(
            chosen.len(),
            found
                .iter()
                .filter(|(range, _)| *range >= 20.0 && *range <= 150.0)
                .count()
        );
    }

    #[test]
    fn a_band_with_almost_nothing_in_it_hands_back_the_whole_sweep() {
        // Two rings of clutter inside the band and thirty of weather outside
        // it. Trusting the band because it held anything at all handed the
        // answer to the two.
        let ground = wind_from(0.0, 0.2);
        let flow = wind_from(225.0, 20.0);
        let mut found: Vec<(f64, vad::Wind)> = vec![(22.0, ground), (27.0, ground)];
        for at in 0..30 {
            found.push((160.0 + at as f64 * 4.0, flow));
        }
        assert_eq!(rings_that_speak_for_the_sweep(&found).len(), found.len());

        // With the band properly filled it speaks for the sweep on its own.
        let full: Vec<(f64, vad::Wind)> =
            (0..30).map(|at| (25.0 + at as f64 * 4.0, flow)).collect();
        assert_eq!(rings_that_speak_for_the_sweep(&full).len(), full.len());
    }

    #[test]
    fn a_handful_of_rings_in_the_band_cannot_outvote_the_rest_of_the_sweep() {
        // Ground clutter out to thirty kilometres, sitting still, and the only
        // weather in a line from a hundred and sixty out. Two rings fall in
        // the preferred band and thirty do not. Preferring the band whenever
        // it held anything at all handed the answer to the clutter and came
        // back with no wind, which the caller cannot tell from a light one.
        let still = vad::Wind {
            east: 0.0,
            north: 0.0,
        };
        let flow = wind_from(225.0, 20.0);
        let field = layered_sweep(&[(0.0, 30.0, still), (160.0, 280.0, flow)], 0.5);
        let read = fitted_wind(&field).expect("a wind");
        assert!(
            (read.speed() - 20.0).abs() < 2.0,
            "the clutter took the sweep with it: {} m/s from {}",
            read.speed(),
            read.coming_from_degrees()
        );
    }

    #[test]
    fn the_clutter_close_in_is_outvoted_when_the_band_is_full() {
        // The other half of the band: with returns right across the sweep, the
        // rings inside twenty kilometres are ground rather than wind and must
        // not be counted. Moving the near edge to zero lets them in.
        let still = vad::Wind {
            east: 0.2,
            north: 0.0,
        };
        let flow = wind_from(225.0, 20.0);
        // Enough clutter to swing a median that included it: sixteen rings of
        // ground against twenty-four of weather.
        let field = layered_sweep(
            &[
                (0.0, WIND_NEAR_KM, still),
                (WIND_NEAR_KM, 130.0, flow),
                (130.0, 300.0, still),
            ],
            0.5,
        );
        let read = fitted_wind(&field).expect("a wind");
        assert!(
            (read.speed() - 20.0).abs() < 2.0,
            "read {} m/s, wanted the flow at 20",
            read.speed()
        );
    }

    #[test]
    fn a_sweep_whose_echo_is_all_close_in_still_gives_a_wind() {
        // The case the search was changed for. Everything within thirty
        // kilometres means nothing at all in the preferred band, and picking
        // rings by position returned no wind rather than the one available.
        let truth = vad::Wind {
            east: 0.0,
            north: -18.0,
        };
        let field = sweep_in_a_wind(truth, 0.5, 3.0, 18.0);
        let read = fitted_wind(&field).expect("a wind from what there is");
        assert!((read.speed() - 18.0).abs() < 1.0, "{}", read.speed());
        assert!(
            (read.coming_from_degrees() - 0.0).abs() < 5.0
                || (read.coming_from_degrees() - 360.0).abs() < 5.0,
            "{}",
            read.coming_from_degrees()
        );
    }

    #[test]
    fn a_sweep_with_nothing_in_it_has_no_wind_rather_than_a_made_up_one() {
        let field = sweep_in_a_wind(
            vad::Wind {
                east: 10.0,
                north: 0.0,
            },
            0.5,
            // A band outside the sweep, so every gate stays as no data.
            9000.0,
            9001.0,
        );
        assert!(fitted_wind(&field).is_none());
    }

    /// A gate the reader has asked to hide leaves the map showing through, and
    /// one exactly at the threshold is kept.
    #[test]
    fn a_threshold_hides_what_is_under_it_and_keeps_what_is_on_it() {
        let draw = |value: f32, product: Product, floor: Option<f32>| {
            gate_color(
                &GateStatus::Valid,
                value,
                product,
                None,
                Some((0.0, 100.0)),
                Shading {
                    unfolded: false,
                    threshold: floor,
                    high_contrast: false,
                },
            )
        };

        // Reflectivity reads low to high, so the comparison is on the value.
        assert!(draw(35.0, Product::Reflectivity, Some(35.0)).is_some());
        assert!(draw(34.9, Product::Reflectivity, Some(35.0)).is_none());
        // Without one, the product's own floor is the only thing hiding gates.
        assert!(draw(34.9, Product::Reflectivity, None).is_some());
        assert!(draw(FADE_FLOOR_DBZ - 1.0, Product::Reflectivity, None).is_none());

        // Velocity runs either side of zero and both sides are the storm, so a
        // threshold of 15 has to keep a 20 metre a second inbound gate. On the
        // signed value that gate reads -20 and would vanish.
        assert!(draw(-20.0, Product::Velocity, Some(15.0)).is_some());
        assert!(draw(20.0, Product::Velocity, Some(15.0)).is_some());
        assert!(draw(-9.0, Product::Velocity, Some(15.0)).is_none());
        assert!(draw(9.0, Product::Velocity, Some(15.0)).is_none());

        // A folded gate carries no reading on the scale, so a threshold has
        // nothing to compare and must not silently drop it.
        assert!(gate_color(
            &GateStatus::RangeFolded,
            0.0,
            Product::Velocity,
            None,
            None,
            Shading {
                unfolded: false,
                threshold: Some(60.0),
                high_contrast: false,
            },
        )
        .is_some());

        // And a gate the radar itself marked as nothing stays nothing.
        assert!(gate_color(
            &GateStatus::NoData,
            0.0,
            Product::Reflectivity,
            None,
            None,
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
        )
        .is_none());
    }

    fn table(range_folded: Option<&str>) -> Palette {
        Palette::with_range_folded(
            Some("dBZ".into()),
            range_folded,
            &[
                palette::Stop {
                    value: 5.0,
                    color: "#04e9e7".into(),
                    to_color: None,
                    solid: false,
                },
                palette::Stop {
                    value: 50.0,
                    color: "#fd0000".into(),
                    to_color: None,
                    solid: false,
                },
            ],
        )
        .expect("a palette")
    }

    /// A loaded table names a colour for folded gates. Drawing the built-in
    /// purple instead puts a colour on screen that is on no legend the user
    /// can see, in the one place the format was explicit about.
    #[test]
    fn a_folded_gate_takes_the_loaded_table_s_colour() {
        let named = table(Some("#77007d"));
        assert_eq!(
            gate_color(
                &GateStatus::RangeFolded,
                0.0,
                Product::Velocity,
                Some(&named),
                None,
                Shading {
                    unfolded: false,
                    threshold: None,
                    high_contrast: false,
                },
            ),
            Some(([0x77, 0x00, 0x7d], MAX_ALPHA))
        );

        // A table that says nothing about folding keeps the built-in colour,
        // and so does having no table at all.
        let silent = table(None);
        assert_eq!(
            gate_color(
                &GateStatus::RangeFolded,
                0.0,
                Product::Velocity,
                Some(&silent),
                None,
                Shading {
                    unfolded: false,
                    threshold: None,
                    high_contrast: false,
                },
            ),
            Some((RANGE_FOLDED, MAX_ALPHA))
        );
        assert_eq!(
            gate_color(
                &GateStatus::RangeFolded,
                0.0,
                Product::Velocity,
                None,
                None,
                Shading {
                    unfolded: false,
                    threshold: None,
                    high_contrast: false,
                },
            ),
            Some((RANGE_FOLDED, MAX_ALPHA))
        );
    }

    #[test]
    fn a_gate_under_the_table_s_floor_is_left_clear() {
        let named = table(None);
        assert_eq!(
            gate_color(
                &GateStatus::Valid,
                4.9,
                Product::Reflectivity,
                Some(&named),
                None,
                Shading {
                    unfolded: false,
                    threshold: None,
                    high_contrast: false,
                },
            ),
            None,
            "a value below the lowest stop was painted the lowest stop's colour"
        );
        assert_eq!(
            gate_color(
                &GateStatus::Valid,
                5.0,
                Product::Reflectivity,
                Some(&named),
                None,
                Shading {
                    unfolded: false,
                    threshold: None,
                    high_contrast: false,
                },
            ),
            Some(([0x04, 0xe9, 0xe7], MAX_ALPHA))
        );
        // Nothing is drawn where the radar saw nothing.
        assert_eq!(
            gate_color(
                &GateStatus::NoData,
                40.0,
                Product::Reflectivity,
                Some(&named),
                None,
                Shading {
                    unfolded: false,
                    threshold: None,
                    high_contrast: false,
                },
            ),
            None
        );
        assert_eq!(
            gate_color(
                &GateStatus::BelowThreshold,
                40.0,
                Product::Reflectivity,
                None,
                None,
                Shading {
                    unfolded: false,
                    threshold: None,
                    high_contrast: false,
                },
            ),
            None
        );
    }

    #[test]
    fn picks_the_newest_whole_volume_from_a_listing() {
        let listing = "<ListBucketResult>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_090749_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092159_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092900_V06_MDM</Key></Contents>\
            </ListBucketResult>";
        assert_eq!(
            newest_key(listing).as_deref(),
            Some("2026/08/30/KDMX/KDMX20260830_092159_V06")
        );
        assert_eq!(newest_key("<ListBucketResult></ListBucketResult>"), None);
    }

    #[test]
    fn picks_the_whole_volume_nearest_the_requested_utc_time() {
        let listing = "<ListBucketResult>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_090749_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092159_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_091800_V06_MDM</Key></Contents>\
            </ListBucketResult>";
        let wanted = Utc
            .with_ymd_and_hms(2026, 8, 30, 9, 18, 0)
            .single()
            .expect("a UTC time");
        assert_eq!(
            closest_key(listing, wanted).as_deref(),
            Some("2026/08/30/KDMX/KDMX20260830_092159_V06")
        );
        assert_eq!(
            closest_key("<ListBucketResult></ListBucketResult>", wanted),
            None
        );
    }

    fn local_archive_fixture(uncompressed: bool) -> (DateTime<Utc>, Vec<u8>) {
        let at = Utc
            .with_ymd_and_hms(2026, 8, 30, 9, 21, 59)
            .single()
            .expect("a UTC time");
        let site = fixture::Site {
            id: *b"KDMX",
            latitude: 41.731,
            longitude: -93.723,
            height_metres: 299,
        };
        let cuts = vec![fixture::flat_cut(
            at,
            fixture::Cut {
                radials: 36,
                gates: 40,
                reflectivity: fixture::Gate::Reading(35.0),
                ..fixture::Cut::default()
            },
        )];
        let data = if uncompressed {
            fixture::uncompressed_volume(&site, at, &cuts)
        } else {
            fixture::volume(&site, at, &cuts)
        };
        (at, data)
    }

    #[test]
    fn local_import_draws_compressed_and_uncompressed_archive_ii_files() {
        let _guard = decoded_cache_test();
        clear_cache();
        for (name, uncompressed) in [("compressed", false), ("uncompressed", true)] {
            let (at, data) = local_archive_fixture(uncompressed);
            let path = std::env::temp_dir()
                .join(format!("openradar-{name}-{}-KDMX.ar2v", std::process::id()));
            std::fs::write(&path, data).expect("write the local fixture");
            let local = read_local_volume(&path).expect("read the selected Archive II file");
            std::fs::remove_file(&path).expect("remove the local fixture");

            assert_eq!(local.station, "KDMX");
            assert!(local.key.starts_with("local:"));
            let sweep = sweep_from_volume(
                &local.station,
                &local.key,
                local.data,
                SweepRequest {
                    product_name: "reflectivity",
                    ..SweepRequest::default()
                },
            )
            .expect("draw the selected Archive II file");
            assert_eq!(sweep.station, "KDMX");
            assert_eq!(sweep.collected, at.to_rfc3339());
            assert!(sweep.image.starts_with("data:image/png;base64,"));
        }
        clear_cache();
    }

    /// A volume is nine megabytes or so. Four of them held as they arrived is
    /// a fraction of the budget; four of them decoded would not be, which is
    /// why the cache keeps the bytes and decodes on demand.
    /// The roadmap's budget is 512 MB with four volumes cached. A volume as
    /// it arrives is about nine megabytes, so the cache is a rounding error
    /// against that; what would breach it is caching decoded scans instead,
    /// which is why this holds the bytes and decodes on demand.
    const BUDGET_BYTES: usize = 512 * 1024 * 1024;
    /// Comfortably larger than any volume the archive publishes.
    const LARGEST_VOLUME_BYTES: usize = 32 * 1024 * 1024;

    /// The worst case the cache can ever be in, checked when the crate is
    /// compiled rather than when the tests are run: a capacity or a limit that
    /// breaks the budget should not build at all.
    const _: () = assert!(CACHE_CAPACITY * LARGEST_VOLUME_BYTES < BUDGET_BYTES);

    #[test]
    fn holds_four_volumes_and_no_more() {
        clear_cache();

        let volume = vec![0u8; 10 * 1024 * 1024];
        for index in 0..7 {
            remember(&format!("KDMX/{index}"), &volume);
        }
        assert_eq!(cached_bytes(), CACHE_CAPACITY * volume.len());

        // The oldest went first, and the newest is still there.
        assert!(cached("KDMX/0").is_none());
        assert!(cached("KDMX/6").is_some());

        // Asking twice for the same volume does not store it twice.
        remember("KDMX/6", &volume);
        assert_eq!(cached_bytes(), 4 * volume.len());
        clear_cache();
    }

    #[test]
    fn reads_the_collection_time_out_of_a_key() {
        let at = key_time("2026/08/30/KDMX/KDMX20260830_092159_V06").expect("a time");
        assert_eq!(at.to_rfc3339(), "2026-08-30T09:21:59+00:00");
        assert!(key_time("2026/08/30/KDMX/rubbish").is_none());
    }

    /// One Level II message, framed as the archive frames it.
    ///
    /// Twelve bytes the RPG puts in front, then the header the document
    /// describes: size in halfwords, channel, type, sequence, date, time,
    /// segment count and number. Every message sits in a frame of its own,
    /// two thousand four hundred and thirty-two bytes whatever it holds, and
    /// the reader steps frame by frame: a message written any shorter than
    /// that is read as the start of the next one.
    const FRAME_BYTES: usize = 2432;

    fn framed_message(message_type: u8, payload: &[u8]) -> Vec<u8> {
        const HEADER_BYTES: usize = 16;
        let mut out = vec![0u8; 12];
        let halfwords = ((HEADER_BYTES + payload.len()) / 2) as u16;
        out.extend_from_slice(&halfwords.to_be_bytes());
        out.push(8); // single channel
        out.push(message_type);
        out.extend_from_slice(&1u16.to_be_bytes()); // sequence
        out.extend_from_slice(&20_696u16.to_be_bytes()); // days since 1970
        out.extend_from_slice(&43_200_000u32.to_be_bytes()); // milliseconds
        out.extend_from_slice(&1u16.to_be_bytes()); // one segment
        out.extend_from_slice(&1u16.to_be_bytes()); // segment one
        out.extend_from_slice(payload);
        out.resize(FRAME_BYTES, 0);
        out
    }

    #[test]
    fn a_message_type_this_build_has_never_heard_of_is_skipped() {
        // The National Weather Service is adding an hourly LTR message to the
        // Level II stream from about February 2027 (SCN26-54). A decoder that
        // treats an unfamiliar type as a broken file would stop showing radar
        // on the day it arrives, at every site, with no warning.
        //
        // The archive's own messages come first so this is a real stream
        // rather than one message on its own, and the unknown one is put in
        // the middle where it would actually appear.
        let payload = vec![0x5au8; 80];
        let mut stream = Vec::new();
        // A status message, which this decoder does understand.
        stream.extend_from_slice(&framed_message(2, &[0u8; 80]));
        // Then the one it does not.
        stream.extend_from_slice(&framed_message(34, &payload));
        stream.extend_from_slice(&framed_message(2, &[0u8; 80]));

        let messages = nexrad_decode::messages::decode_messages(&stream)
            .expect("an unfamiliar message must not fail the stream");
        assert_eq!(
            messages.len(),
            3,
            "the unknown message should be skipped, not swallow what follows it"
        );

        // And it is recognised as unknown rather than mistaken for something.
        let types: Vec<String> = messages
            .iter()
            .map(|message| format!("{:?}", message.header().message_type()))
            .collect();
        assert!(
            types[1].contains("Unknown"),
            "type 34 came back as {}",
            types[1]
        );
    }

    #[test]
    fn every_type_number_the_stream_could_carry_is_survivable() {
        // Not only the one number the notice names. Whatever the message ends
        // up being called, and whatever else is added after it, an unfamiliar
        // number in that byte must not cost anybody their radar.
        for message_type in 0u8..=255 {
            let mut stream = framed_message(message_type, &[0u8; 60]);
            stream.extend_from_slice(&framed_message(2, &[0u8; 80]));
            // Some types are variable-length and will read the rest as their
            // own payload; what matters is that nothing panics and nothing
            // reports the stream as broken.
            let read = nexrad_decode::messages::decode_messages(&stream);
            assert!(
                read.is_ok(),
                "message type {message_type} made the whole stream unreadable"
            );
        }
    }

    #[test]
    fn the_reflectivity_ramp_matches_the_legend_it_is_drawn_beside() {
        // The stops the legend gradient is built from, exactly.
        assert_eq!(ramp_color(REFLECTIVITY_RAMP, 5.0), [0x04, 0xe9, 0xe7]);
        assert_eq!(ramp_color(REFLECTIVITY_RAMP, 50.0), [0xfd, 0x00, 0x00]);
        assert_eq!(ramp_color(REFLECTIVITY_RAMP, 75.0), [0xfd, 0xfd, 0xfd]);
        // Between stops it interpolates rather than stepping.
        let midway = ramp_color(REFLECTIVITY_RAMP, 52.5);
        assert!(midway[0] > 0xd4 && midway[0] < 0xfd);
        // Past either end it holds the end colour instead of wrapping.
        assert_eq!(ramp_color(REFLECTIVITY_RAMP, -20.0), [0x04, 0xe9, 0xe7]);
        assert_eq!(ramp_color(REFLECTIVITY_RAMP, 200.0), [0xfd, 0xfd, 0xfd]);
    }

    #[test]
    fn velocity_reads_green_toward_the_radar_and_red_away_from_it() {
        let inbound = ramp_color(VELOCITY_RAMP, -30.0);
        let outbound = ramp_color(VELOCITY_RAMP, 30.0);
        assert!(inbound[1] > inbound[0], "inbound should be green");
        assert!(outbound[0] > outbound[1], "outbound should be red");
    }

    #[test]
    fn weak_returns_fade_in_and_strong_ones_arrive_solid() {
        assert_eq!(reflectivity_alpha(5.0), MIN_ALPHA);
        assert_eq!(reflectivity_alpha(20.0), MAX_ALPHA);
        assert_eq!(reflectivity_alpha(60.0), MAX_ALPHA);
        // Nothing in between is more solid than what is stronger than it.
        let mut previous = 0u8;
        for step in 0..=30 {
            let alpha = reflectivity_alpha(5.0 + step as f32);
            assert!(
                alpha >= previous,
                "alpha fell at {step} dBZ above the floor"
            );
            previous = alpha;
        }
    }

    #[test]
    fn mercator_round_trips_the_latitudes_a_sweep_covers() {
        for latitude in [-60.0, -1.0, 0.0, 27.5, 41.7, 64.0] {
            let back = inverse_mercator_y(mercator_y(latitude));
            assert!(
                (back - latitude).abs() < 1e-9,
                "{latitude} came back as {back}"
            );
        }
    }

    #[test]
    fn only_the_products_the_panel_offers_are_accepted() {
        assert!(product_from_name("reflectivity").is_some());
        assert!(product_from_name("velocity").is_some());
        assert!(product_from_name("../../etc/passwd").is_none());
        assert!(product_from_name("").is_none());
    }

    // The site a viewport is handed to is chosen in two steps: which sites can
    // see it at all, and which of those has published anything lately. Only the
    // second one needs the network, so the first is tested on its own here.

    #[test]
    fn the_nearest_site_is_the_one_a_viewer_is_standing_over() {
        assert_eq!(
            sites_in_reach(35.4676, -97.5164)
                .first()
                .map(|site| site.id),
            Some("KTLX")
        );
        assert_eq!(
            sites_in_reach(41.73, -93.72).first().map(|site| site.id),
            Some("KDMX")
        );
        // Puerto Rico and Hawaii have their own sites and are not the mainland.
        assert_eq!(
            sites_in_reach(18.4, -66.1).first().map(|site| site.id),
            Some("TJUA")
        );
    }

    #[test]
    fn a_place_no_site_can_see_gets_no_site() {
        // Mid-Atlantic, the middle of the Pacific, and central Europe.
        for (latitude, longitude) in [(30.0, -45.0), (10.0, -150.0), (48.9, 2.4)] {
            assert!(
                sites_in_reach(latitude, longitude).is_empty(),
                "{latitude},{longitude} is not in anyone's coverage"
            );
        }
    }

    #[test]
    fn every_site_in_reach_can_actually_see_the_point() {
        // The sweep is drawn to the site's own surveillance range. A site
        // further off than that would be handed a view its picture does not
        // reach, and the viewer would zoom in on a hole in the middle of it.
        for (latitude, longitude) in [
            (35.4676, -97.5164),
            (41.73, -93.72),
            (43.5, -123.5),
            (18.4, -66.1),
        ] {
            for site in sites_in_reach(latitude, longitude) {
                let distance = great_circle_km(
                    latitude as f64,
                    longitude as f64,
                    site.latitude as f64,
                    site.longitude as f64,
                );
                assert!(
                    distance <= MAX_RANGE_KM,
                    "{} is {distance:.0} km from {latitude},{longitude}, past the {MAX_RANGE_KM} km its sweep is drawn to",
                    site.id
                );
            }
        }
    }

    #[test]
    fn the_command_offers_nothing_outside_every_site_s_coverage() {
        // The command itself, not the helper underneath it: a point no site can
        // see must get no answer rather than the least distant one, or the map
        // draws Alaska's radar over the mid-Atlantic. It answers without
        // touching the network, because there is nothing to ask about.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        for (latitude, longitude) in [(30.0, -45.0), (10.0, -150.0), (48.9, 2.4)] {
            assert_eq!(
                runtime.block_on(level2_nearest_site(latitude, longitude)),
                None,
                "{latitude},{longitude} is not in anyone's coverage"
            );
        }
    }

    #[test]
    fn sites_in_reach_come_back_nearest_first() {
        let near_oklahoma_city = sites_in_reach(35.4676, -97.5164);
        assert!(
            near_oklahoma_city.len() > 1,
            "central Oklahoma is covered by more than one site"
        );
        let distances: Vec<f64> = near_oklahoma_city
            .iter()
            .map(|site| {
                great_circle_km(
                    35.4676,
                    -97.5164,
                    site.latitude as f64,
                    site.longitude as f64,
                )
            })
            .collect();
        for pair in distances.windows(2) {
            assert!(pair[0] <= pair[1], "{distances:?} is not sorted");
        }
    }

    #[test]
    fn a_site_that_stopped_publishing_is_passed_over() {
        let now = "2026-08-30T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let sites = sites_in_reach(35.4676, -97.5164);
        let nearest = sites[0].id;
        let next = sites[1].id;

        // The nearest site went down an hour ago; the next one is current.
        let chosen = first_site_with_a_volume(
            &sites,
            |id| {
                if id == nearest {
                    Some(now - Duration::hours(1))
                } else {
                    Some(now - Duration::minutes(3))
                }
            },
            now,
        );
        assert_eq!(chosen.map(|site| site.id), Some(next));

        // With the nearest one publishing again it takes the view straight back.
        let chosen = first_site_with_a_volume(&sites, |_| Some(now - Duration::minutes(3)), now);
        assert_eq!(chosen.map(|site| site.id), Some(nearest));

        // A site the archive holds nothing for is skipped the same way.
        let chosen = first_site_with_a_volume(
            &sites,
            |id| (id != nearest).then(|| now - Duration::minutes(3)),
            now,
        );
        assert_eq!(chosen.map(|site| site.id), Some(next));
    }

    #[test]
    fn a_region_that_is_entirely_quiet_still_names_the_nearest_site() {
        // Otherwise the viewport looks like it is outside coverage, and the
        // panel says nothing at all rather than reporting the site's failure.
        let now = "2026-08-30T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        let sites = sites_in_reach(35.4676, -97.5164);
        let chosen = first_site_with_a_volume(&sites, |_| None, now);
        assert_eq!(chosen.map(|site| site.id), Some(sites[0].id));
    }

    #[test]
    fn only_a_recent_volume_counts_as_current() {
        let now = "2026-08-30T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
        assert!(volume_is_current(Some(now - Duration::minutes(4)), now));
        assert!(volume_is_current(Some(now - Duration::minutes(19)), now));
        assert!(!volume_is_current(Some(now - Duration::minutes(21)), now));
        assert!(!volume_is_current(None, now));
        // A volume stamped slightly ahead of this machine's clock is a skewed
        // clock, not a stale site.
        assert!(volume_is_current(Some(now + Duration::minutes(2)), now));
        assert!(!volume_is_current(Some(now + Duration::hours(3)), now));
    }

    #[test]
    fn distance_is_measured_around_the_earth_not_across_the_grid() {
        // Des Moines to Oklahoma City, about 700 km.
        let far = great_circle_km(41.73, -93.72, 35.47, -97.52);
        assert!((far - 745.0).abs() < 40.0, "got {far} km");
        assert_eq!(great_circle_km(41.73, -93.72, 41.73, -93.72), 0.0);
    }

    /// The one test that talks to NOAA. It is ignored by default so the normal
    /// gate stays offline, and run with
    /// `cargo test --lib -- --ignored level2` when the pipeline changes.
    #[test]
    #[ignore = "asks the live NEXRAD archive which sites are publishing"]
    fn the_site_chosen_for_a_live_view_has_something_to_draw() {
        // The whole point of choosing by the archive rather than by distance
        // alone: whatever comes back has to have a volume recent enough to
        // render, or the handover shows an error where radar should be.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        // Des Moines, which several sites can see.
        let chosen = runtime
            .block_on(level2_nearest_site(41.73, -93.72))
            .expect("central Iowa is inside NEXRAD coverage");
        let sites = sites_in_reach(41.73, -93.72);
        assert!(
            sites.iter().any(|site| site.id == chosen),
            "{chosen} is not one of the sites that can see the point"
        );

        let newest = runtime.block_on(newest_volume_time(&chosen));
        assert!(
            volume_is_current(newest, Utc::now()),
            "{chosen} was chosen but its newest volume is {newest:?}"
        );
    }

    #[test]
    #[ignore = "fetches a live volume from the NEXRAD archive"]
    fn decodes_and_draws_a_live_kdmx_volume() {
        clear_cache();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        let started = std::time::Instant::now();
        let (key, data) = runtime
            .block_on(latest_volume("KDMX"))
            .expect("KDMX publishes a volume every few minutes");
        let fetched = started.elapsed();
        assert!(key.contains("KDMX"), "{key} should name the site");
        assert!(
            data.len() > 1_000_000,
            "a volume is megabytes, got {}",
            data.len()
        );

        let drawing = std::time::Instant::now();
        let sweep = sweep_from_volume(
            "KDMX",
            &key,
            data.clone(),
            SweepRequest {
                product_name: "reflectivity",
                ..SweepRequest::default()
            },
        )
        .expect("the lowest reflectivity tilt should decode");
        let drawn = drawing.elapsed();

        assert_eq!(sweep.station, "KDMX");
        assert_eq!(sweep.product_id, "reflectivity");
        assert_eq!(sweep.unit, "dBZ");
        // The lowest surveillance cut is half a degree.
        assert!(
            sweep.elevation_degrees < 1.0,
            "tilt 0 should be the lowest cut, got {}",
            sweep.elevation_degrees
        );
        assert!(sweep.tilts.len() >= 4, "a volume has several tilts");
        assert!(
            sweep.tilts.windows(2).all(|pair| pair[0] < pair[1]),
            "tilts should be ascending and unique: {:?}",
            sweep.tilts
        );
        // The same volume with a threshold on it. render_sweep is tested on
        // its own, but only asking through the command can say whether what
        // the reader set arrives there.
        let floored = sweep_from_volume(
            "KDMX",
            &key,
            data.clone(),
            SweepRequest {
                product_name: "reflectivity",
                threshold: Some(60.0),
                ..SweepRequest::default()
            },
        )
        .expect("the same tilt decodes with a threshold on it");
        assert!(
            floored.image.len() < sweep.image.len(),
            "sixty dBZ drew as much as no threshold at all: {} against {}",
            floored.image.len(),
            sweep.image.len()
        );

        assert!(sweep.image.starts_with("data:image/png;base64,"));
        // Well past an empty transparent square.
        assert!(
            sweep.image.len() > 20_000,
            "the drawing came out too small to hold radar: {} bytes",
            sweep.image.len()
        );

        // What was actually painted: a filled disc around the site, not a
        // square, not a scattering, and not the whole image.
        let site_object = registry::site_by_id("KDMX").expect("KDMX").to_site();
        let coordinates = RadarCoordinateSystem::new(&site_object);
        let field = {
            let file = volume::File::new(data.clone());
            let scan = file.scan().expect("the volume decodes");
            sweep_field(&scan, Product::Reflectivity, 0)
                .expect("a sweep")
                .field
        };
        let (pixels, _) = render_sweep(
            &field,
            &coordinates,
            Product::Reflectivity,
            "dBZ",
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
        );
        let painted = pixels.chunks_exact(4).filter(|p| p[3] > 0).count();
        let total = IMAGE_SIZE * IMAGE_SIZE;
        assert!(
            painted > total / 100,
            "only {painted} of {total} pixels were painted"
        );
        assert!(
            painted < total * 4 / 5,
            "{painted} of {total} pixels painted: a sweep is a disc, not a square"
        );
        // The corners sit outside the 230 km circle and must stay empty.
        for (row, column) in [(2, 2), (2, IMAGE_SIZE - 3), (IMAGE_SIZE - 3, 2)] {
            let at = (row * IMAGE_SIZE + column) * 4;
            assert_eq!(
                pixels[at + 3],
                0,
                "the corner at {row},{column} was painted"
            );
        }
        if let Ok(out) = std::env::var("OPENRADAR_SWEEP_DUMP") {
            std::fs::write(
                &out,
                base64::engine::general_purpose::STANDARD
                    .decode(sweep.image.trim_start_matches("data:image/png;base64,"))
                    .expect("the image decodes"),
            )
            .expect("the dump is written");
        }

        // The extent is the sweep's own circle around the site, not the world.
        let site = registry::site_by_id("KDMX").expect("KDMX is in the registry");
        assert!(sweep.west < site.longitude as f64 && sweep.east > site.longitude as f64);
        assert!(sweep.south < site.latitude as f64 && sweep.north > site.latitude as f64);
        assert!(
            (sweep.east - sweep.west) < 12.0,
            "230 km is not twelve degrees"
        );

        // Velocity comes off the same volume, so the second product is free.
        let velocity = sweep_from_volume(
            "KDMX",
            &key,
            data,
            SweepRequest {
                product_name: "velocity",
                tilt_index: 1,
                unfold: true,
                ..SweepRequest::default()
            },
        )
        .expect("a Doppler cut should decode");
        assert_eq!(velocity.product_id, "velocity");
        assert_eq!(velocity.unit, "m/s");
        assert!(velocity.elevation_degrees >= sweep.elevation_degrees);

        // The acceptance is a sweep on screen within five seconds.
        println!("fetch {fetched:?}, decode and draw {drawn:?}, {painted} pixels painted");
        assert!(
            fetched + drawn < std::time::Duration::from_secs(5),
            "fetch took {fetched:?} and drawing took {drawn:?}"
        );
    }

    /// Reports a sweep again at a lower folding limit.
    ///
    /// A fold cannot be planted by moving readings about. Every reading the
    /// radar published is already inside its own limit, so shifting one by a
    /// whole interval and wrapping it back gives the same number again, and
    /// shifting it without wrapping puts it where no radar could have reported
    /// it, which is not a fold but a value the algorithm has never been asked
    /// to handle. The earlier version of this test did the second of those and
    /// then measured whether the wedge came back; it never did, on any volume.
    ///
    /// What does work is to take the sweep as the truth and report it again at
    /// a limit low enough that some of it wraps. That is exactly what a fold
    /// is, it happens to the real readings of a real day, and the answer is
    /// known in advance because it is the sweep that was started with.
    fn refold(field: &mut SweepField, nyquist: f32) -> usize {
        let interval = 2.0 * nyquist;
        let mut wrapped = 0;
        for azimuth in 0..field.azimuth_count() {
            for gate in 0..field.gate_count() {
                let (value, status) = field.get(azimuth, gate);
                if !matches!(status, GateStatus::Valid) {
                    continue;
                }
                // Into the half-open band the radar reports in.
                let folded = value - interval * ((value + nyquist) / interval).floor();
                if (folded - value).abs() > 0.001 {
                    wrapped += 1;
                }
                field.set(azimuth, gate, folded, GateStatus::Valid);
            }
        }
        wrapped
    }

    /// Neighbouring pairs that are not as far apart as they were in the truth.
    ///
    /// The measure has to be one a constant cannot move. Region dealiasing
    /// places each patch relative to its neighbours and the largest patch keeps
    /// whatever it read, so the sweep as a whole is recovered up to a whole
    /// interval and no further: with no still air anywhere in it, nothing in
    /// the data says which interval the picture belongs to. Asking every pair
    /// of touching gates to be the distance apart it was asks exactly what
    /// unfolding promises, and nothing it does not.
    fn broken_pairs(now: &SweepField, truth: &SweepField, interval: f32) -> (usize, usize) {
        let azimuths = now.azimuth_count();
        let gates = now.gate_count();
        let mut broken = 0;
        let mut pairs = 0;
        for azimuth in 0..azimuths {
            for gate in 0..gates {
                let (a_now, a_now_status) = now.get(azimuth, gate);
                let (a_was, a_was_status) = truth.get(azimuth, gate);
                if !matches!(a_now_status, GateStatus::Valid)
                    || !matches!(a_was_status, GateStatus::Valid)
                {
                    continue;
                }
                for (next_azimuth, next_gate) in
                    [((azimuth + 1) % azimuths, gate), (azimuth, gate + 1)]
                {
                    if next_gate >= gates {
                        continue;
                    }
                    let (b_now, b_now_status) = now.get(next_azimuth, next_gate);
                    let (b_was, b_was_status) = truth.get(next_azimuth, next_gate);
                    if !matches!(b_now_status, GateStatus::Valid)
                        || !matches!(b_was_status, GateStatus::Valid)
                    {
                        continue;
                    }
                    pairs += 1;
                    if ((a_now - b_now) - (a_was - b_was)).abs() > interval / 2.0 {
                        broken += 1;
                    }
                }
            }
        }
        (broken, pairs)
    }

    /// What unfolding did to one station's velocity cut.
    struct Measured {
        /// How the picture reads: touching gates that are not the distance
        /// apart the truth had them. A constant cannot move this.
        broken_before: usize,
        broken_after: usize,
        /// How the gates read: how many of the ones that wrapped came back to
        /// the branch they started on. The measure above cannot see this at
        /// all, because a whole region put back a full interval out is still
        /// perfectly continuous with itself.
        wrapped: usize,
        rejoined: usize,
        /// Gates that moved by something other than a whole interval, which is
        /// not unfolding but invention.
        invented: usize,
    }

    fn measure_unfolding(runtime: &tokio::runtime::Runtime, station: &str) -> Option<Measured> {
        let (_key, data) = runtime.block_on(latest_volume(station)).ok()?;
        let file = volume::File::new(data);
        let scan = file.scan().ok()?;
        let chosen = sweep_field(&scan, Product::Velocity, 1)?;
        let nyquist = nyquist_velocity(&file, chosen.elevation_number)?;
        if !(5.0..80.0).contains(&nyquist) {
            return None;
        }

        let truth = chosen.field;
        // A third of the radar's own limit, which is roughly what the lowest
        // cut of a real pattern runs at: KTBW folds its lowest cut at 8.4 m/s
        // and its tight ones at 28.
        let tight = nyquist / 3.0;
        let interval = 2.0 * tight;
        let mut folded = truth.clone();
        let wrapped_gates = refold(&mut folded, tight);
        if wrapped_gates < 500 {
            return None;
        }

        let (broken_before, comparable) = broken_pairs(&folded, &truth, interval);
        if comparable < 10_000 || broken_before < 500 {
            return None;
        }
        if !unfold_velocity(&mut folded, tight) {
            return None;
        }
        let (broken_after, _) = broken_pairs(&folded, &truth, interval);

        let mut wrapped = 0usize;
        let mut rejoined = 0usize;
        let mut invented = 0usize;
        for azimuth in 0..truth.azimuth_count() {
            for gate in 0..truth.gate_count() {
                let (now, now_status) = folded.get(azimuth, gate);
                let (was, was_status) = truth.get(azimuth, gate);
                if !matches!(now_status, GateStatus::Valid)
                    || !matches!(was_status, GateStatus::Valid)
                {
                    continue;
                }
                let apart = (now - was) / interval;
                if (apart - apart.round()).abs() > 0.01 {
                    invented += 1;
                    continue;
                }
                // Whether this gate wrapped when the limit was brought in.
                let refolded = was - interval * ((was + tight) / interval).floor();
                if (refolded - was).abs() <= 0.001 {
                    continue;
                }
                wrapped += 1;
                if apart.round() == 0.0 {
                    rejoined += 1;
                }
            }
        }

        Some(Measured {
            broken_before,
            broken_after,
            wrapped,
            rejoined,
            invented,
        })
    }

    #[test]
    #[ignore = "fetches a live volume from the NEXRAD archive"]
    fn unfolding_a_live_velocity_sweep_takes_the_folds_out() {
        clear_cache();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        // More than one station, because the answer depends on the weather and
        // an assertion held against a single site is an assertion about that
        // site's afternoon. An earlier version asked KDMX alone and demanded a
        // quarter of the folds come back, which KDMX manages and KFWS, on the
        // same day, does not: 3766 broken pairs became 3270.
        let mut measured = Vec::new();
        for station in ["KDMX", "KTLX", "KAMX", "KTBW", "KGRR", "KFWS"] {
            let Some(found) = measure_unfolding(&runtime, station) else {
                continue;
            };
            println!(
                "{station}: broken pairs {} -> {}, {} of {} folded gates back on \
                 their own branch, {} invented",
                found.broken_before,
                found.broken_after,
                found.rejoined,
                found.wrapped,
                found.invented
            );
            measured.push(found);
        }
        assert!(
            measured.len() >= 3,
            "only {} stations answered with a Doppler cut worth measuring, which \
             after six tries is the archive rather than the weather",
            measured.len()
        );

        // What has to hold everywhere, whatever the day.
        for found in &measured {
            // Unfolding may move a reading by a whole number of intervals and
            // by nothing else, because that is what a fold is. Everything
            // below counts discontinuities, and a field of one constant value
            // is perfectly continuous, so a dealiaser that threw the readings
            // away and wrote zeros would score perfectly on all of them.
            assert_eq!(
                found.invented, 0,
                "{} gates came back at a value the radar never measured",
                found.invented
            );
            // And it must never leave the picture more broken than it found it.
            assert!(
                found.broken_after <= found.broken_before,
                "unfolding took {} broken pairs to {}",
                found.broken_before,
                found.broken_after
            );
            // Some of the folded gates have to come back to the branch they
            // started on. Not most: a patch with no boundary to anything
            // outside itself has nothing to be placed by, and how much of a
            // sweep is isolated like that is a property of the weather.
            assert!(
                found.rejoined * 20 > found.wrapped,
                "only {} of {} folded gates came back to their own branch",
                found.rejoined,
                found.wrapped
            );
        }

        // And across the stations together, which is far steadier than any one
        // of them, most of the picture has to come back. This is the claim the
        // grower it replaced fails: on the same six stations it left the
        // broken pairs where it found them at two of them.
        let before: usize = measured.iter().map(|found| found.broken_before).sum();
        let after: usize = measured.iter().map(|found| found.broken_after).sum();
        let wrapped: usize = measured.iter().map(|found| found.wrapped).sum();
        let rejoined: usize = measured.iter().map(|found| found.rejoined).sum();
        println!(
            "over {} stations: broken pairs {before} -> {after}, {rejoined} of \
             {wrapped} folded gates back on their own branch",
            measured.len()
        );
        assert!(
            after * 4 < before * 3,
            "folding broke {before} pairs across {} stations and unfolding left \
             {after} of them",
            measured.len()
        );
        assert!(
            rejoined * 5 > wrapped,
            "only {rejoined} of {wrapped} folded gates came back to their own branch"
        );
    }

    #[test]
    #[ignore = "fetches a live volume from the NEXRAD archive"]
    fn the_wind_read_off_a_live_sweep_is_a_wind() {
        // The fit has to hold up on real returns, not only on a ring drawn from
        // the formula it inverts. There is no truth to compare against out of
        // the archive, so what is checked is that the answer is a wind a
        // forecaster would recognise, and that taking it out is what storm
        // relative velocity means: the ambient flow goes to about nothing while
        // anything rotating keeps its own signature.
        clear_cache();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let (_key, data) = runtime
            .block_on(latest_volume("KDMX"))
            .expect("KDMX publishes a volume every few minutes");

        let file = volume::File::new(data);
        let scan = file.scan().expect("the volume should decode");
        let mut chosen =
            sweep_field(&scan, Product::Velocity, 1).expect("a volume carries a Doppler cut");
        if let Some(nyquist) = nyquist_velocity(&file, chosen.elevation_number) {
            unfold_velocity(&mut chosen.field, nyquist);
        }

        let wind = fitted_wind(&chosen.field).expect("a sweep with returns has a wind in it");
        println!(
            "wind {:.1} m/s from {:.0} degrees",
            wind.speed(),
            wind.coming_from_degrees()
        );
        assert!(
            wind.speed() < 60.0,
            "{} m/s is not a wind, it is a fit that ran away",
            wind.speed()
        );
        assert!((0.0..360.0).contains(&wind.coming_from_degrees()));

        // Taking it out has to leave the sweep centred on nothing: that is the
        // whole point, and a sign error would leave it centred on twice the
        // wind instead.
        let mean = |field: &SweepField| {
            let mut total = 0.0f64;
            let mut count = 0usize;
            for azimuth in 0..field.azimuth_count() {
                for gate in 0..field.gate_count() {
                    let (value, status) = field.get(azimuth, gate);
                    if matches!(status, GateStatus::Valid) {
                        total += value as f64;
                        count += 1;
                    }
                }
            }
            if count == 0 {
                0.0
            } else {
                total / count as f64
            }
        };

        let before = mean(&chosen.field);
        make_storm_relative(&mut chosen.field, wind);
        let after = mean(&chosen.field);
        println!("mean radial velocity {before:.2} -> {after:.2} m/s");
        assert!(
            after.abs() <= before.abs() + 0.5,
            "taking the wind out moved the sweep further from still air,              {before:.2} to {after:.2}"
        );
    }

    #[test]
    fn a_listing_address_names_the_day_and_the_site() {
        let day = chrono::NaiveDate::from_ymd_opt(2026, 8, 30)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap()
            .and_utc();
        assert_eq!(
            listing_url("KDMX", day),
            "https://unidata-nexrad-level2.s3.amazonaws.com/?list-type=2&prefix=2026/08/30/KDMX/"
        );
    }

    /// The chunk path and the archive path have to agree about one volume.
    ///
    /// A folder in the chunks ring keeps its volume for a while after the radar
    /// moves on, and the archive object for that same volume lands a minute or
    /// so after it closes. In that window both are readable, so the two paths
    /// can be put side by side over exactly the same sweep of the sky rather
    /// than over two volumes five minutes apart.
    #[test]
    #[ignore = "downloads one volume twice, from the chunks bucket and the archive"]
    fn the_chunk_sweep_and_the_archive_sweep_agree_about_one_volume() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        let mut compared = 0;
        let mut why: Vec<String> = Vec::new();
        for station in ["KTLX", "KDMX", "KJAX", "KTBW", "KGRR"] {
            let Ok((newest, _)) = runtime.block_on(chunks::newest_volume(station, None)) else {
                why.push(format!("{station}: nothing in the chunks ring"));
                continue;
            };
            let Ok((key, data)) = runtime.block_on(latest_volume(station)) else {
                why.push(format!("{station}: no archive volume"));
                continue;
            };
            let file = volume::File::new(data);
            let Ok(archive) = file.scan() else {
                why.push(format!("{station}: the archive volume would not decode"));
                continue;
            };
            let Some((archive_start, _)) = archive.time_range() else {
                why.push(format!("{station}: the archive volume carries no time"));
                continue;
            };

            // Walk back through the finished folders for the one holding the
            // volume the archive just published. Which folder that is depends
            // on how long the object took to land, so it is found by time.
            let mut folder = chunks::previous(newest);
            let mut same = None;
            for _ in 0..4 {
                if let Ok(found) = runtime.block_on(chunks::scan_in_folder(station, folder)) {
                    if let Some((start, _)) = found.scan.time_range() {
                        if (start - archive_start).num_seconds().abs() <= 30 {
                            same = Some(found);
                            break;
                        }
                    }
                }
                folder = chunks::previous(folder);
            }
            let Some(found) = same else {
                why.push(format!(
                    "{station}: no folder held the archive volume from {archive_start}"
                ));
                continue;
            };

            let from_chunks = sweep_field(&found.scan, Product::Reflectivity, 0)
                .expect("the lowest cut, assembled from chunks");
            let from_archive = sweep_field(&archive, Product::Reflectivity, 0)
                .expect("the lowest cut, out of the archive");

            assert_eq!(
                from_chunks.elevation_number, from_archive.elevation_number,
                "{station} put the lowest cut at a different elevation number"
            );
            assert!(
                (from_chunks.elevation_degrees - from_archive.elevation_degrees).abs() < 0.05,
                "{station}: {} against {}",
                from_chunks.elevation_degrees,
                from_archive.elevation_degrees
            );
            assert_eq!(
                from_chunks.field.gate_count(),
                from_archive.field.gate_count(),
                "{station} disagreed about how many gates the cut has"
            );
            assert!(
                (from_chunks.field.gate_interval_km() - from_archive.field.gate_interval_km())
                    .abs()
                    < 1e-6,
                "{station} disagreed about how far apart the gates are"
            );

            // The readings are the same radar's, so they have to be the same
            // numbers. Anything else means the chunk path is misreading the
            // bytes rather than showing a slightly different moment.
            let mut checked = 0usize;
            let mut apart = 0usize;
            for azimuth in 0..from_chunks.field.azimuth_count() {
                let angle = from_chunks.field.azimuths()[azimuth];
                for gate in (0..from_chunks.field.gate_count()).step_by(7) {
                    let range = from_chunks.field.first_gate_range_km()
                        + gate as f64 * from_chunks.field.gate_interval_km();
                    let (mine, my_status) = from_chunks.field.get(azimuth, gate);
                    let Some((theirs, their_status)) =
                        from_archive.field.value_at_polar(angle, range)
                    else {
                        continue;
                    };
                    if my_status != GateStatus::Valid || their_status != GateStatus::Valid {
                        continue;
                    }
                    checked += 1;
                    if (mine - theirs).abs() > 0.6 {
                        apart += 1;
                    }
                }
            }
            assert!(
                checked > 1000,
                "{station}: only {checked} gates were valid in both, which is too few to judge"
            );
            let share = apart as f64 / checked as f64;
            println!(
                "{station}: volume {} against {key}, {checked} gates compared, {apart} apart",
                found.volume.volume
            );
            assert!(
                share < 0.02,
                "{station}: {apart} of {checked} gates disagreed, which is the chunk path \
                 reading the bytes differently rather than the weather moving"
            );
            compared += 1;
            break;
        }

        assert!(
            compared > 0,
            "no site could be compared, which after five tries is the paths moving \
             rather than the weather being quiet: {}",
            why.join("; ")
        );
    }

    /// A volume built to order, from the site's own registered position.
    fn built_volume(cuts: &[Vec<fixture::Radial>]) -> Scan {
        let entry = registry::site_by_id("KTLX").expect("Oklahoma City is in the registry");
        let site = fixture::Site {
            id: *b"KTLX",
            latitude: entry.latitude,
            longitude: entry.longitude,
            height_metres: 370,
        };
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let bytes = fixture::volume(&site, at, cuts);
        volume::File::new(bytes)
            .scan()
            .expect("a volume built to the ICD decodes")
    }

    /// The pixels of a drawn sweep, back out of the PNG it was handed over as.
    fn drawn_pixels(sweep: &SweepImage) -> Vec<u8> {
        let encoded = sweep
            .image
            .strip_prefix("data:image/png;base64,")
            .expect("a PNG data url");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("valid base64");
        let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        let mut reader = decoder.read_info().expect("a readable PNG");
        let mut out = vec![0u8; reader.output_buffer_size().expect("a known size")];
        let info = reader.next_frame(&mut out).expect("one frame");
        out.truncate(info.buffer_size());
        out
    }

    /// The colour at a bearing and a distance from the site, off a drawn sweep.
    fn pixel_at(sweep: &SweepImage, pixels: &[u8], bearing_degrees: f64, km: f64) -> [u8; 4] {
        let entry = registry::site_by_id(&sweep.station).expect("a known site");
        // Far enough north or east that a degree of latitude is close to
        // constant, which is all this needs to land inside the right wedge.
        let north = km * bearing_degrees.to_radians().cos() / 111.32;
        let east = km * bearing_degrees.to_radians().sin()
            / (111.32 * (entry.latitude as f64).to_radians().cos());
        let latitude = entry.latitude as f64 + north;
        let longitude = entry.longitude as f64 + east;

        let top = mercator_y(sweep.north);
        let bottom = mercator_y(sweep.south);
        let row = ((mercator_y(latitude) - top) / (bottom - top) * IMAGE_SIZE as f64) as usize;
        let column =
            ((longitude - sweep.west) / (sweep.east - sweep.west) * IMAGE_SIZE as f64) as usize;
        let at = (row.min(IMAGE_SIZE - 1) * IMAGE_SIZE + column.min(IMAGE_SIZE - 1)) * 4;
        [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]]
    }

    /// Radials over one sector only, which is what a volume in progress holds.
    fn sector(
        from_degrees: f32,
        to_degrees: f32,
        reading: fixture::Gate,
        at: DateTime<Utc>,
    ) -> Vec<fixture::Radial> {
        // Half a degree apart, which is what a real super-resolution cut is
        // and what the header will say. Declaring one spacing and writing
        // another leaves the drawing sizing each wedge wrong, which showed up
        // as 29 per cent of a swept sector keeping the volume underneath.
        let spacing = 0.5f32;
        let mut out = Vec::new();
        let mut angle = from_degrees;
        let mut number = 1u16;
        while angle < to_degrees {
            out.push(fixture::Radial {
                azimuth_degrees: angle,
                azimuth_number: number,
                elevation_number: 1,
                elevation_degrees: 0.5,
                nyquist_ms: 8.0,
                collected: at,
                azimuth_spacing_degrees: spacing,
                reflectivity: vec![reading; 200],
                velocity: Vec::new(),
            });
            angle += spacing;
            number += 1;
        }
        out
    }

    #[test]
    fn what_the_fixture_declares_is_what_it_writes() {
        // The drawing reads the header to decide how wide a wedge each radial
        // stands for, and reads the reserved counts to know the radar looked
        // and found nothing. A fixture that got either wrong would have tests
        // passing against a picture nobody would accept: declaring half a
        // degree while writing whole ones left 29 per cent of a swept sector
        // showing the volume underneath, with the tests green.
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        for (radials, spacing) in [(360u16, 1.0f32), (720, 0.5)] {
            let scan = built_volume(&[fixture::flat_cut(
                at,
                fixture::Cut {
                    radials,
                    gates: 8,
                    ..fixture::Cut::default()
                },
            )]);
            let field = sweep_field(&scan, Product::Reflectivity, 0)
                .expect("the cut decodes")
                .field;
            assert_eq!(
                field.azimuth_spacing_degrees(),
                spacing,
                "{radials} radials are {spacing} degrees apart"
            );
            assert_eq!(field.azimuth_count(), radials as usize);
        }

        // And the two reserved counts, which no test could reach before.
        let mut cut = fixture::flat_cut(
            at,
            fixture::Cut {
                radials: 360,
                gates: 4,
                ..fixture::Cut::default()
            },
        );
        cut[0].reflectivity[1] = fixture::Gate::Nothing;
        cut[0].reflectivity[2] = fixture::Gate::RangeFolded;
        let scan = built_volume(&[cut]);
        let field = sweep_field(&scan, Product::Reflectivity, 0)
            .expect("the cut decodes")
            .field;
        assert_eq!(field.get(0, 0).1, GateStatus::Valid);
        assert_eq!(
            field.get(0, 1).1,
            GateStatus::BelowThreshold,
            "the radar looked there and found nothing"
        );
        assert_eq!(field.get(0, 2).1, GateStatus::RangeFolded);
    }

    #[test]
    fn a_cut_whose_angle_has_drifted_is_still_the_same_cut() {
        // A sweep's angle is the median of what its radials measured, and the
        // pedestal does not put the antenna in the same place twice: across
        // consecutive real volumes KTLX moved a cut from 3.08 to 3.12 degrees.
        // Matched to a hundredth of a degree, about one cut in ten stopped
        // matching between the finished volume and the one in progress, and
        // the live sweep for that tilt went missing with no message.
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let older = built_volume(&[
            fixture::flat_cut(
                at,
                fixture::Cut {
                    degrees: 3.08,
                    ..fixture::Cut::default()
                },
            ),
            fixture::flat_cut(
                at,
                fixture::Cut {
                    number: 2,
                    degrees: 4.30,
                    reflectivity: fixture::Gate::Reading(35.0),
                    ..fixture::Cut::default()
                },
            ),
        ]);
        // The same two cuts a volume later, each a quantisation step away.
        let live = built_volume(&[
            fixture::flat_cut(
                at,
                fixture::Cut {
                    degrees: 3.12,
                    reflectivity: fixture::Gate::Reading(50.0),
                    ..fixture::Cut::default()
                },
            ),
            fixture::flat_cut(
                at,
                fixture::Cut {
                    number: 2,
                    degrees: 4.26,
                    reflectivity: fixture::Gate::Reading(55.0),
                    ..fixture::Cut::default()
                },
            ),
        ]);

        let asked = SweepRequest {
            product_name: "reflectivity",
            ..SweepRequest::default()
        };
        let none = |_: u8| None;
        for (tilt, degrees) in [(0usize, 3.12f32), (1, 4.26)] {
            let sweep = sweep_over(
                "KTLX",
                "live",
                &older,
                &none,
                &live,
                &none,
                SweepRequest {
                    tilt_index: tilt,
                    ..asked
                },
            )
            .expect("both volumes hold the cut");
            assert!(
                sweep.live,
                "cut {tilt} drifted a quantisation step and lost its live sweep"
            );
            assert!((sweep.elevation_degrees - degrees).abs() < 0.01);
        }

        // And a cut a real tilt away is still a different cut.
        let far = built_volume(&[fixture::flat_cut(
            at,
            fixture::Cut {
                degrees: 4.30,
                ..fixture::Cut::default()
            },
        )]);
        let sweep = sweep_over("KTLX", "live", &older, &none, &far, &none, asked)
            .expect("the finished volume answers");
        assert!(
            !sweep.live,
            "the live volume has nothing at 3.08 and must not offer its 4.30 cut"
        );
    }

    #[test]
    fn the_swept_sector_is_drawn_over_the_volume_before_it() {
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        // The finished volume reads 20 dBZ everywhere. The volume in progress
        // has reached the north-east quarter only, and reads 50 there.
        let older = built_volume(&[fixture::flat_cut(at, fixture::Cut::default())]);
        let live = built_volume(&[sector(0.0, 90.0, fixture::Gate::Reading(50.0), at)]);

        let asked = SweepRequest {
            product_name: "reflectivity",
            ..SweepRequest::default()
        };
        let none = |_: u8| None;
        let sweep = sweep_over("KTLX", "live", &older, &none, &live, &none, asked)
            .expect("a sweep drawn over the one before it");
        assert!(sweep.live, "a sweep with live radials in it has to say so");

        let both = drawn_pixels(&sweep);
        let older_only =
            sweep_from_scan("KTLX", "older", &older, &none, asked).expect("the finished sweep");
        let older_pixels = drawn_pixels(&older_only);
        let live_only =
            sweep_from_scan("KTLX", "live", &live, &none, asked).expect("the sweep in progress");
        let live_pixels = drawn_pixels(&live_only);

        // The whole of the swept quarter, not a sample of it. Sampling three
        // bearings hid a picture striped with the volume underneath: each
        // radial was being given a wedge narrower than the gap to the next
        // one, so 29 per cent of the sector kept the old sweep, and all three
        // samples happened to land on a radial.
        let mut new_sweep = 0usize;
        let mut old_sweep = 0usize;
        let mut neither = 0usize;
        for tenth in 0..900 {
            let bearing = tenth as f64 / 10.0;
            let here = pixel_at(&sweep, &both, bearing, 30.0);
            if here == pixel_at(&live_only, &live_pixels, bearing, 30.0) {
                new_sweep += 1;
            } else if here == pixel_at(&older_only, &older_pixels, bearing, 30.0) {
                old_sweep += 1;
            } else {
                neither += 1;
            }
        }
        assert_eq!(
            (old_sweep, neither),
            (0, 0),
            "{new_sweep} of 900 bearings across the swept quarter took the new              sweep, {old_sweep} kept the old one and {neither} took neither"
        );

        // Inside the swept quarter the new reading shows; outside it the old
        // one does. Both are checked at the same distance, so the only thing
        // that differs is the bearing.
        for bearing in [15.0, 45.0, 75.0] {
            assert_eq!(
                pixel_at(&sweep, &both, bearing, 30.0),
                pixel_at(&live_only, &live_pixels, bearing, 30.0),
                "at {bearing} degrees the swept sector should be the new reading"
            );
        }
        for bearing in [135.0, 200.0, 300.0] {
            assert_eq!(
                pixel_at(&sweep, &both, bearing, 30.0),
                pixel_at(&older_only, &older_pixels, bearing, 30.0),
                "at {bearing} degrees the volume before should still be showing"
            );
            assert_ne!(
                pixel_at(&sweep, &both, bearing, 30.0),
                pixel_at(&live_only, &live_pixels, bearing, 30.0),
                "at {bearing} degrees the radar has not swept yet"
            );
        }
        // And the two readings do have to look different, or none of the above
        // would be measuring anything.
        assert_ne!(
            pixel_at(&live_only, &live_pixels, 45.0, 30.0),
            pixel_at(&older_only, &older_pixels, 45.0, 30.0)
        );
    }

    #[test]
    fn a_storm_that_has_moved_on_comes_off_the_swept_sector() {
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        // A core in the finished volume, and a volume in progress that has
        // swept the same quarter and found nothing there.
        let older = built_volume(&[fixture::flat_cut(
            at,
            fixture::Cut {
                reflectivity: fixture::Gate::Reading(55.0),
                ..fixture::Cut::default()
            },
        )]);
        let live = built_volume(&[sector(0.0, 90.0, fixture::Gate::Nothing, at)]);

        let asked = SweepRequest {
            product_name: "reflectivity",
            ..SweepRequest::default()
        };
        let none = |_: u8| None;
        let sweep = sweep_over("KTLX", "live", &older, &none, &live, &none, asked)
            .expect("a sweep drawn over the one before it");
        let pixels = drawn_pixels(&sweep);

        // Nothing below the lowest ramp stop is drawn at all, so the swept
        // quarter has to come back clear rather than keeping the old core.
        assert_eq!(
            pixel_at(&sweep, &pixels, 45.0, 30.0)[3],
            0,
            "the swept sector kept a storm the radar has just looked at and not found"
        );
        assert_ne!(
            pixel_at(&sweep, &pixels, 200.0, 30.0)[3],
            0,
            "outside the swept sector the volume before it is still the picture"
        );
    }

    #[test]
    fn a_cut_the_live_volume_has_not_reached_falls_back_to_the_finished_one() {
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let older = built_volume(&[
            fixture::flat_cut(at, fixture::Cut::default()),
            fixture::flat_cut(
                at,
                fixture::Cut {
                    number: 2,
                    degrees: 1.5,
                    reflectivity: fixture::Gate::Reading(35.0),
                    ..fixture::Cut::default()
                },
            ),
        ]);
        // The radar is still on the lowest cut of the volume in progress.
        let live = built_volume(&[sector(0.0, 90.0, fixture::Gate::Reading(50.0), at)]);

        let asked = SweepRequest {
            product_name: "reflectivity",
            tilt_index: 1,
            ..SweepRequest::default()
        };
        let none = |_: u8| None;
        let sweep = sweep_over("KTLX", "live", &older, &none, &live, &none, asked)
            .expect("the finished volume's second cut");
        assert!(
            !sweep.live,
            "nothing on screen came from the volume in progress, so it must not claim to be live"
        );
        assert_eq!(sweep.live_tilts, 0);
        assert!((sweep.elevation_degrees - 1.5).abs() < 0.05);
        // The picker offers the finished volume's cuts, not the one-cut list
        // the volume in progress happens to hold right now.
        assert_eq!(sweep.tilts.len(), 2);
    }

    #[test]
    fn the_tilt_asked_for_is_matched_by_angle_across_the_two_volumes() {
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let older = built_volume(&[
            fixture::flat_cut(at, fixture::Cut::default()),
            fixture::flat_cut(
                at,
                fixture::Cut {
                    number: 2,
                    degrees: 1.5,
                    reflectivity: fixture::Gate::Reading(35.0),
                    ..fixture::Cut::default()
                },
            ),
        ]);
        // The volume in progress has reached the second cut but not the first,
        // which is what SAILS does: its list starts at 1.5, so counting into
        // it would put the reader on the wrong cut without saying so.
        let live = built_volume(&[fixture::flat_cut(
            at,
            fixture::Cut {
                number: 2,
                degrees: 1.5,
                reflectivity: fixture::Gate::Reading(50.0),
                ..fixture::Cut::default()
            },
        )]);

        let asked = SweepRequest {
            product_name: "reflectivity",
            tilt_index: 1,
            ..SweepRequest::default()
        };
        let none = |_: u8| None;
        let sweep = sweep_over("KTLX", "live", &older, &none, &live, &none, asked)
            .expect("the cut both volumes hold");
        assert!(sweep.live);
        assert!(
            (sweep.elevation_degrees - 1.5).abs() < 0.05,
            "the live volume's only cut is at 1.5 and that is the one asked for"
        );

        // Asking for the lowest cut, which the volume in progress has not got,
        // has to fall back rather than serve its 1.5 cut as if it were 0.5.
        let lowest = SweepRequest {
            tilt_index: 0,
            ..asked
        };
        let sweep = sweep_over("KTLX", "live", &older, &none, &live, &none, lowest)
            .expect("the finished volume's lowest cut");
        assert!(!sweep.live);
        assert!((sweep.elevation_degrees - 0.5).abs() < 0.05);
    }

    #[test]
    fn a_sweep_that_was_changed_never_reports_itself_unchanged() {
        // What the answer is for is the legend and the scale: the reader is
        // being told whether what they are looking at is the radar's own
        // reading. Answering that by hunting for a value past the limit, with
        // slack for the arithmetic, left a hole exactly one interval wide: a
        // gate the radar reported at 24.8 with a limit of 25 comes back at
        // 25.2 once its fold is out, which the slack swallowed, so eighteen
        // hundred rewritten gates were reported as no change and drawn on the
        // narrow scale.
        let nyquist = 25.0f32;
        let azimuths: Vec<f32> = (0..180).map(|step| step as f32 * 2.0).collect();
        let gates = 20usize;
        let mut field =
            SweepField::new_empty("Velocity", "m/s", 0.5, azimuths, 2.0, 2.125, 0.25, gates);
        // Half the sweep just under the limit one way, half just under it the
        // other. The step between them is a whole interval, so it is a fold.
        for azimuth in 0..180 {
            for gate in 0..gates {
                let value = if azimuth < 90 { 24.8 } else { -24.8 };
                field.set(azimuth, gate, value, GateStatus::Valid);
            }
        }
        let before: Vec<f32> = field.values().to_vec();

        let answered = unfold_velocity(&mut field, nyquist);
        let changed = field
            .values()
            .iter()
            .zip(&before)
            .filter(|(now, was)| (**now - **was).abs() > 0.01)
            .count();
        assert!(
            changed > 0,
            "the sweep has to be changed for this to measure"
        );
        assert!(
            answered,
            "{changed} gates were rewritten and the sweep reported itself untouched"
        );
    }

    #[test]
    fn a_sweep_with_nothing_to_unfold_is_left_alone_and_says_so() {
        // The other side of the same answer. A calm sweep must not be reported
        // as unfolded, or the legend claims a change that was not made and the
        // picture is drawn on a scale twice as wide as it needs.
        let nyquist = 25.0f32;
        let azimuths: Vec<f32> = (0..180).map(|step| step as f32 * 2.0).collect();
        let gates = 20usize;
        let mut field =
            SweepField::new_empty("Velocity", "m/s", 0.5, azimuths, 2.0, 2.125, 0.25, gates);
        for azimuth in 0..180 {
            for gate in 0..gates {
                field.set(azimuth, gate, 3.0, GateStatus::Valid);
            }
        }
        let before: Vec<f32> = field.values().to_vec();
        assert!(!unfold_velocity(&mut field, nyquist));
        assert_eq!(field.values(), before.as_slice());
    }

    #[test]
    fn a_fold_over_one_corner_of_a_sweep_is_still_taken_out() {
        // A sweep folded in one place is folded, and the one place is where the
        // storm is. An earlier version threw the whole correction away unless
        // half a per cent of the gates had moved, so on a real KDMX cut folded
        // at 21 m/s all 410 wrapped gates stayed wrapped and the legend
        // reported the picture as the radar's own reading.
        let nyquist = 25.0f32;
        let interval = 2.0 * nyquist;
        let azimuths: Vec<f32> = (0..360).map(|step| step as f32).collect();
        let gates = 200usize;
        let mut field =
            SweepField::new_empty("Velocity", "m/s", 0.5, azimuths, 1.0, 2.125, 0.25, gates);

        // Still air, with one smooth hill of outbound wind in it that just
        // tops the radar's limit. Smooth is the point: a fold is a step of a
        // whole interval between two gates that are otherwise the same air,
        // and a hill planted as a cliff would be a real wind shift rather than
        // a fold, which is not something any dealiaser can or should undo.
        let peak = 28.0f32;
        let (from_azimuth, to_azimuth) = (40usize, 90usize);
        let (from_gate, to_gate) = (40usize, 140usize);
        let mut truth = vec![0.0f32; 360 * gates];
        for azimuth in from_azimuth..to_azimuth {
            let across = (azimuth - from_azimuth) as f32 / (to_azimuth - from_azimuth) as f32;
            for gate in from_gate..to_gate {
                let along = (gate - from_gate) as f32 / (to_gate - from_gate) as f32;
                let hill =
                    (across * std::f32::consts::PI).sin() * (along * std::f32::consts::PI).sin();
                truth[azimuth * gates + gate] = peak * hill;
            }
        }

        let mut wrapped = 0usize;
        for azimuth in 0..360 {
            for gate in 0..gates {
                let value = truth[azimuth * gates + gate];
                let folded = value - interval * ((value + nyquist) / interval).floor();
                if (folded - value).abs() > 0.001 {
                    wrapped += 1;
                }
                field.set(azimuth, gate, folded, GateStatus::Valid);
            }
        }
        assert!(
            wrapped > 50,
            "only {wrapped} gates folded, which is nothing to measure"
        );
        let share = wrapped as f32 / (360 * gates) as f32;
        assert!(
            share < 0.005,
            "the fold has to be small enough that a share test would drop it, not {share}"
        );

        assert!(
            unfold_velocity(&mut field, nyquist),
            "a sweep with {wrapped} folded gates in it is a folded sweep"
        );

        let mut back = 0usize;
        let mut adrift = 0usize;
        for azimuth in 0..360 {
            for gate in 0..gates {
                let now = field.get(azimuth, gate).0;
                let was = truth[azimuth * gates + gate];
                if (now - was).abs() < 0.01 {
                    back += 1;
                } else {
                    adrift += 1;
                }
            }
        }
        assert_eq!(
            adrift, 0,
            "{adrift} gates did not come back to the wind that was planted, {back} did"
        );
    }

    /// The decoded-volume cache and its counter are global, so the tests that
    /// look at them take turns. A panicking test poisons this; the next one
    /// carries on rather than failing for a reason that is not its own.
    static DECODED_CACHE_TESTS: Mutex<()> = Mutex::new(());

    fn decoded_cache_test() -> std::sync::MutexGuard<'static, ()> {
        DECODED_CACHE_TESTS
            .lock()
            .unwrap_or_else(|held| held.into_inner())
    }

    /// A volume as bytes, so a test can hand the same ones over twice.
    fn volume_bytes(id: &[u8; 4], at: DateTime<Utc>) -> Vec<u8> {
        let entry = registry::site_by_id("KTLX").expect("Oklahoma City is in the registry");
        let site = fixture::Site {
            id: *id,
            latitude: entry.latitude,
            longitude: entry.longitude,
            height_metres: 370,
        };
        let cut = fixture::flat_cut(
            at,
            fixture::Cut {
                velocity: Some(fixture::Gate::Reading(4.0)),
                ..fixture::Cut::default()
            },
        );
        fixture::volume(&site, at, &[cut])
    }

    fn ask(tilt_index: usize, product_name: &str) -> SweepRequest<'_> {
        SweepRequest {
            product_name,
            tilt_index,
            unfold: false,
            manual_motion: None,
            threshold: None,
            high_contrast: false,
        }
    }

    /// The decoded-volume cache, which is invisible except in what it does not
    /// do: the picture is identical either way, only slower without it.
    #[test]
    fn a_volume_is_decoded_once_however_many_ways_it_is_looked_at() {
        let _guard = decoded_cache_test();
        clear_cache();
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let bytes = volume_bytes(b"KTLX", at);
        let before = decode_count();

        let first = sweep_from_volume("KTLX", "one", bytes.clone(), ask(0, "reflectivity"))
            .expect("the fixture volume draws");
        assert_eq!(decode_count(), before + 1, "the first look has to decode");

        // The same volume, asked about differently. Neither is a new volume.
        let same_tilt_other_product =
            sweep_from_volume("KTLX", "one", bytes.clone(), ask(0, "velocity"))
                .expect("the same volume draws a second product");
        let again = sweep_from_volume("KTLX", "one", bytes.clone(), ask(0, "reflectivity"))
            .expect("the same volume draws again");
        assert_eq!(
            decode_count(),
            before + 1,
            "changing product or asking again must not decode the volume a second time"
        );

        // Reuse is only worth anything if it is the same picture.
        assert_eq!(
            first.image, again.image,
            "the reused scan drew a different picture"
        );
        assert_ne!(
            first.image, same_tilt_other_product.image,
            "two products of one volume should not be the same picture"
        );
    }

    #[test]
    fn a_different_volume_is_a_different_entry() {
        let _guard = decoded_cache_test();
        clear_cache();
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let bytes = volume_bytes(b"KTLX", at);
        let before = decode_count();

        sweep_from_volume("KTLX", "one", bytes.clone(), ask(0, "reflectivity"))
            .expect("the first volume draws");
        sweep_from_volume("KTLX", "two", bytes.clone(), ask(0, "reflectivity"))
            .expect("the second volume draws");
        assert_eq!(
            decode_count(),
            before + 2,
            "a volume under a new key is a new volume and has to be decoded"
        );
        assert_eq!(decoded_len(), 2);
    }

    #[test]
    fn the_oldest_decoded_volume_goes_first() {
        let _guard = decoded_cache_test();
        clear_cache();
        let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
        let bytes = volume_bytes(b"KTLX", at);

        // One more than the cache holds, so the first one has to leave.
        for index in 0..=DECODED_CAPACITY {
            sweep_from_volume(
                "KTLX",
                &format!("volume-{index}"),
                bytes.clone(),
                ask(0, "reflectivity"),
            )
            .expect("each volume draws");
        }
        assert_eq!(
            decoded_len(),
            DECODED_CAPACITY,
            "the cache must not grow past what it says it holds"
        );

        // The oldest is gone, so asking for it again decodes it again. The
        // newest is still there, so asking for it does not.
        let before = decode_count();
        sweep_from_volume("KTLX", "volume-0", bytes.clone(), ask(0, "reflectivity"))
            .expect("the evicted volume draws again");
        assert_eq!(
            decode_count(),
            before + 1,
            "the oldest should have been evicted"
        );

        let held = decode_count();
        sweep_from_volume(
            "KTLX",
            &format!("volume-{DECODED_CAPACITY}"),
            bytes.clone(),
            ask(0, "reflectivity"),
        )
        .expect("the newest volume draws");
        assert_eq!(decode_count(), held, "the newest should still be held");
    }

    /// The colour-vision gate on the ramps this app draws with.
    ///
    /// The numbers are multiples of the point at which two colours become
    /// distinguishable at all, which is about 2.3 in this measure, rather than
    /// thresholds chosen to let a particular ramp through.
    mod colour_vision {
        use super::*;
        use crate::contrast::{
            closest_neighbours, lightness_climbs, opposite_directions, worst_pair, ColorVision,
            EVERY_VISION,
        };

        /// Neighbouring steps have to stay apart for every kind of vision.
        const NEIGHBOURS_APART: f32 = 10.0;
        /// A diverging scale has to keep its two directions apart.
        const DIRECTIONS_APART: f32 = 25.0;

        #[test]
        fn the_high_contrast_reflectivity_ramp_keeps_its_steps_apart() {
            for vision in EVERY_VISION {
                let (apart, from, to) = worst_pair(HIGH_CONTRAST_REFLECTIVITY_RAMP, vision);
                assert!(
                    apart >= NEIGHBOURS_APART,
                    "{} brings {from} and {to} dBZ within {apart:.1}",
                    vision.name()
                );
            }
        }

        /// The property that makes the ramp readable when hue is gone entirely,
        /// on a failing screen or in sunlight: more rain is always lighter.
        #[test]
        fn the_high_contrast_reflectivity_ramp_climbs_in_lightness() {
            assert!(lightness_climbs(HIGH_CONTRAST_REFLECTIVITY_RAMP, 0.5));
        }

        /// What the ordinary scale actually does, kept as a test so the reason
        /// the other ramp exists is on the record and not in an argument.
        #[test]
        fn the_ordinary_reflectivity_ramp_is_the_one_with_the_problem() {
            let (apart, from, to) = worst_pair(REFLECTIVITY_RAMP, ColorVision::Deuteranopia);
            assert!(
                apart < 6.0,
                "the NWS scale was expected to collapse somewhere under deuteranopia, \
                 closest was {apart:.1} between {from} and {to}"
            );
            // And the high-contrast ramp is better at its own worst point than
            // the ordinary one is at that one.
            let better =
                closest_neighbours(HIGH_CONTRAST_REFLECTIVITY_RAMP, ColorVision::Deuteranopia);
            assert!(better > apart * 2.0);
        }

        #[test]
        fn the_high_contrast_velocity_ramps_keep_toward_apart_from_away() {
            for ramp in [
                HIGH_CONTRAST_VELOCITY_RAMP,
                HIGH_CONTRAST_WIDE_VELOCITY_RAMP,
            ] {
                for vision in EVERY_VISION {
                    let apart = opposite_directions(ramp, vision);
                    assert!(
                        apart >= DIRECTIONS_APART,
                        "{} brings the two directions within {apart:.1}",
                        vision.name()
                    );
                }
            }
        }

        /// Green toward and red away is the pair the commonest colour blindness
        /// takes apart, which is the whole reason for a second velocity scale.
        #[test]
        fn the_ordinary_velocity_ramp_loses_its_direction() {
            let ordinary = opposite_directions(VELOCITY_RAMP, ColorVision::Deuteranopia);
            let replacement =
                opposite_directions(HIGH_CONTRAST_VELOCITY_RAMP, ColorVision::Deuteranopia);
            assert!(
                ordinary < DIRECTIONS_APART,
                "green against red was expected to lose the direction, got {ordinary:.1}"
            );
            assert!(
                replacement > ordinary * 2.0,
                "the replacement should hold the direction: {replacement:.1} against {ordinary:.1}"
            );
        }

        /// Neither ramp may be quietly reordered: the values have to ascend, or
        /// the colour a reading gets is not the colour the legend shows.
        #[test]
        fn every_ramp_runs_in_order() {
            for ramp in [
                REFLECTIVITY_RAMP,
                HIGH_CONTRAST_REFLECTIVITY_RAMP,
                VELOCITY_RAMP,
                WIDE_VELOCITY_RAMP,
                HIGH_CONTRAST_VELOCITY_RAMP,
                HIGH_CONTRAST_WIDE_VELOCITY_RAMP,
            ] {
                assert!(ramp.windows(2).all(|pair| pair[1].0 > pair[0].0));
            }
        }

        /// The two reflectivity ramps have to cover the same range, or asking
        /// for more contrast would quietly change which readings are drawn.
        #[test]
        fn the_two_reflectivity_ramps_cover_the_same_ground() {
            assert_eq!(REFLECTIVITY_RAMP[0].0, HIGH_CONTRAST_REFLECTIVITY_RAMP[0].0);
            assert_eq!(
                REFLECTIVITY_RAMP[REFLECTIVITY_RAMP.len() - 1].0,
                HIGH_CONTRAST_REFLECTIVITY_RAMP[HIGH_CONTRAST_REFLECTIVITY_RAMP.len() - 1].0
            );
        }
    }
}

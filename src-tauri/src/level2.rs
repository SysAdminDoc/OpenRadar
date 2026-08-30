//! Single-site NEXRAD Level II radar: fetch a volume, decode one sweep, and
//! draw it as a Web Mercator image the map can lay over its own bounds.
//!
//! The mosaics OpenRadar leads with are national and smoothed. This is the
//! radar itself, one site at a time, which is what a close-in view wants.

use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;

use base64::Engine;
use chrono::{DateTime, Datelike, Duration, Utc};
use nexrad_data::volume;
use nexrad_decode::messages::MessageContents;
use nexrad_model::data::{GateStatus, Product, Scan, SweepField};
use nexrad_model::geo::{GeoPoint, RadarCoordinateSystem};
use nexrad_model::meta::registry;
use serde::Serialize;

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
            Self::NoSweep(site, product) => {
                ("noSweep", vec![site.clone(), product.clone()])
            }
            Self::NoStormMotion(site) => ("noStormMotion", vec![site.clone()]),
            Self::Encode(why) => ("encode", vec![why.clone()]),
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

#[cfg(test)]
pub fn clear_cache() {
    if let Ok(mut cache) = CACHE.lock() {
        cache.clear();
    }
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
/// The sweep the model hands back does not carry it, so it is read from the
/// radial header in the raw messages. Only the first radial of the cut is
/// needed, and records are read in order, so this stops as soon as it finds one
/// rather than parsing the whole volume a second time.
fn nyquist_velocity(file: &volume::File, elevation_number: u8) -> Option<f32> {
    let records = file.records().ok()?;
    for record in records {
        let record = if record.compressed() {
            record.decompress().ok()?
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
            if data.header().elevation_number() != elevation_number {
                continue;
            }
            let Some(block) = data.radial_data_block() else {
                continue;
            };
            // Published as hundredths of a metre per second.
            let nyquist = block.nyquist_velocity_raw() as f32 * 0.01;
            if nyquist > 0.0 {
                return Some(nyquist);
            }
        }
    }
    None
}

/// How much of a sweep has to move before the picture is a different one.
///
/// A calm volume has a handful of noisy gates that unfold, a few hundred in
/// nearly a million. Calling that sweep unfolded, drawing it on a scale twice
/// as wide and telling the reader it is no longer the radar's own reading, is
/// three claims none of which the change supports.
const MIN_UNFOLD_SHARE: f32 = 0.005;

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

    let middle: Vec<vad::Wind> = found
        .iter()
        .filter(|(range, _)| *range >= WIND_NEAR_KM && *range <= WIND_FAR_KM)
        .map(|(_, wind)| *wind)
        .collect();
    if !middle.is_empty() {
        return vad::median_wind(&middle);
    }
    let rings: Vec<vad::Wind> = found.into_iter().map(|(_, wind)| wind).collect();
    vad::median_wind(&rings)
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
/// Answers whether the picture actually changed: enough readings moved that
/// the sweep is a different one and has to be drawn and labelled as such. When
/// it answers no, nothing is written and the field is left as the radar gave
/// it.
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
    let readings = valid.iter().filter(|held| **held).count();
    if readings == 0 {
        return false;
    }
    // Deciding here rather than at the call site is what keeps the two
    // answers together. Writing back a handful of moved gates and then
    // reporting the sweep as not unfolded drew it on the narrow scale with
    // readings pushed outside the limit that scale is drawn to.
    if (moved as f32 / readings as f32) < MIN_UNFOLD_SHARE {
        return false;
    }
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

    let mut best: Option<ChosenSweep> = None;
    for sweep in scan.sweeps() {
        let Some(angle) = sweep.elevation_angle_degrees() else {
            continue;
        };
        if ((angle * 100.0).round() / 100.0 - wanted).abs() > 0.01 {
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
pub fn render_sweep(
    field: &SweepField,
    coordinates: &RadarCoordinateSystem,
    product: Product,
    unit: &str,
    unfolded: bool,
    // Hide anything weaker than this. The reader sets it per product to clear
    // the light returns off the picture and leave the cores.
    threshold: Option<f32>,
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
                gate_color(
                    &status,
                    value,
                    product,
                    table.as_ref(),
                    range,
                    unfolded,
                    threshold,
                )
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
    unfolded: bool,
    // Hide anything weaker than this, set by the reader per product.
    threshold: Option<f32>,
) -> Option<([u8; 3], u8)> {
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
                            ramp_color(REFLECTIVITY_RAMP, value),
                            reflectivity_alpha(value),
                        ))
                    }
                    Product::Velocity => {
                        let ramp = if unfolded {
                            WIDE_VELOCITY_RAMP
                        } else {
                            VELOCITY_RAMP
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
pub fn sweep_from_volume(
    station: &str,
    volume_key: &str,
    data: Vec<u8>,
    product_name: &str,
    tilt_index: usize,
    unfold: bool,
    manual_motion: Option<vad::Wind>,
    // Gates weaker than this are left clear, in the product's own unit.
    threshold: Option<f32>,
) -> Result<SweepImage, Level2Error> {
    let (product, label, unit) = product_from_name(product_name)
        .ok_or_else(|| Level2Error::NoSweep(station.to_string(), product_name.to_string()))?;

    let file = volume::File::new(data);
    let scan = file
        .scan()
        .map_err(|error| Level2Error::Decode(error.to_string()))?;

    let mut chosen = sweep_field(&scan, product, tilt_index)
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
        if let Some(nyquist) = nyquist_velocity(&file, chosen.elevation_number) {
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

    // The volume carries its own site position; the registry is only the
    // fallback for a header that did not survive.
    let site = scan
        .site()
        .cloned()
        .or_else(|| registry::site_by_id(station).map(|entry| entry.to_site()));
    let site = site.ok_or_else(|| Level2Error::UnknownSite(station.to_string()))?;
    let coordinates = RadarCoordinateSystem::new(&site);

    let (pixels, [west, south, east, north]) =
        render_sweep(&chosen.field, &coordinates, product, unit, dealiased, threshold);
    let png_bytes = encode_png(&pixels)?;

    // The sweep's own time, not the volume's: under MESO-SAILS the lowest tilt
    // is cut four times across five minutes, and saying which one is on screen
    // is the difference between a current picture and a stale one.
    let collected = chosen
        .collected
        .or_else(|| scan.time_range().map(|(start, _)| start))
        .or_else(|| key_time(volume_key))
        .unwrap_or_else(Utc::now);

    let entry = registry::site_by_id(station);
    Ok(SweepImage {
        station: station.to_string(),
        product_id: product_name.to_string(),
        palette_applied: palette::for_unit(unit).is_some(),
        site_name: entry
            .map(|site| format!("{}, {}", site.city, site.state))
            .unwrap_or_else(|| station.to_string()),
        product: label.to_string(),
        unit: unit.to_string(),
        dealiased,
        storm_motion,
        elevation_degrees: (chosen.elevation_degrees * 100.0).round() / 100.0,
        tilts: tilts(&scan),
        tilt_index,
        collected: collected.to_rfc3339(),
        west,
        south,
        east,
        north,
        image: data_url(&png_bytes),
        volume: volume_key.to_string(),
    })
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

#[tauri::command]
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
) -> Result<SweepImage, Level2Error> {
    let station = station.to_uppercase();
    if registry::site_by_id(&station).is_none() {
        return Err(Level2Error::UnknownSite(station));
    }
    let (key, data) = latest_volume(&station).await?;
    // Decoding and drawing a volume is CPU work; it must not sit on the async
    // runtime the whole time.
    tauri::async_runtime::spawn_blocking(move || {
        let manual = motion.map(|(speed, from_degrees)| {
            // A wind named by where it comes from, turned back into the
            // components the subtraction needs.
            let towards = (from_degrees + 180.0).to_radians();
            vad::Wind {
                east: speed * towards.sin(),
                north: speed * towards.cos(),
            }
        });
        sweep_from_volume(&station, &key, data, &product, tilt, dealias, manual, threshold)
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

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
                false,
                floor,
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
            false,
            Some(60.0),
        )
        .is_some());

        // And a gate the radar itself marked as nothing stays nothing.
        assert!(gate_color(
            &GateStatus::NoData,
            0.0,
            Product::Reflectivity,
            None,
            None,
            false,
            None,
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
                false,
                None,
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
                false,
                None,
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
                false,
                None,
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
                false,
                None,
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
                false,
                None,
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
                false,
                None,
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
                false,
                None,
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
            sites_in_reach(35.4676, -97.5164).first().map(|site| site.id),
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
        let sweep = sweep_from_volume("KDMX", &key, data.clone(), "reflectivity", 0, false, None, None)
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
        let (pixels, _) =
            render_sweep(&field, &coordinates, Product::Reflectivity, "dBZ", false, None);
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
        let velocity = sweep_from_volume("KDMX", &key, data, "velocity", 1, true, None, None)
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

    /// How many neighbouring gate pairs jump further than the radar could
    /// have measured, which is the signature a fold leaves.
    ///
    /// Both directions, because a fold runs along the radial as often as it
    /// runs around the sweep, and measuring only one axis misses half of them.
    ///
    /// A sign change on its own is not evidence: every sweep has a line across
    /// it where the flow crosses the beam and the velocity passes through zero
    /// honestly. A jump of more than the Nyquist velocity between two gates a
    /// quarter of a degree apart is not honest.
    fn fold_jumps(field: &SweepField, nyquist: f32) -> (usize, usize) {
        let azimuths = field.azimuth_count();
        let gates = field.gate_count();
        let mut jumps = 0;
        let mut pairs = 0;
        let mut consider = |here: (f32, GateStatus), there: (f32, GateStatus)| {
            if !matches!(here.1, GateStatus::Valid) || !matches!(there.1, GateStatus::Valid) {
                return;
            }
            pairs += 1;
            if (here.0 - there.0).abs() > nyquist {
                jumps += 1;
            }
        };
        for azimuth in 0..azimuths {
            let next = (azimuth + 1) % azimuths;
            for gate in 0..gates {
                consider(field.get(azimuth, gate), field.get(next, gate));
                if gate + 1 < gates {
                    consider(field.get(azimuth, gate), field.get(azimuth, gate + 1));
                }
            }
        }
        (jumps, pairs)
    }

    /// A sweep with folds put into it on purpose, so the live test has
    /// something to measure on a quiet day.
    ///
    /// The archive gives whatever the weather was, and most days it is calm
    /// enough that a real cut folds in a handful of places out of a quarter of
    /// a million. Asserting the folds went away is then satisfied by doing
    /// nothing at all. Folding a wedge of the real sweep by hand gives a known
    /// number to take back out.
    fn fold_a_wedge(field: &mut SweepField, nyquist: f32) -> Vec<(usize, usize, f32)> {
        let azimuths = field.azimuth_count();
        let gates = field.gate_count();
        let interval = 2.0 * nyquist;
        let mut folded = Vec::new();
        for azimuth in (azimuths / 4)..(azimuths / 2) {
            for gate in 0..gates {
                let (value, status) = field.get(azimuth, gate);
                if !matches!(status, GateStatus::Valid) {
                    continue;
                }
                // An interval down, which puts the wedge outside the range the
                // radar itself could report. That is deliberate and it is the
                // only thing that works: a fold is invisible in a single
                // reading and shows only as a step between neighbours, so
                // wrapping the wedge back into range would hand back the exact
                // values it started with and plant nothing at all. What this
                // does plant is the spatial signature unfolding exists to
                // remove, which is what the test is about.
                field.set(azimuth, gate, value - interval, GateStatus::Valid);
                folded.push((azimuth, gate, value));
            }
        }
        folded
    }

    #[test]
    #[ignore = "fetches a live volume from the NEXRAD archive"]
    fn unfolding_a_live_velocity_sweep_takes_the_folds_out() {
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
        let nyquist = nyquist_velocity(&file, chosen.elevation_number)
            .expect("the radial header carries the velocity the cut folds at");
        assert!(
            (5.0..80.0).contains(&nyquist),
            "{nyquist} m/s is not a plausible Nyquist velocity"
        );

        let (untouched, pairs) = fold_jumps(&chosen.field, nyquist);
        assert!(pairs > 10_000, "only {pairs} gate pairs had readings");

        // The whole sweep as it arrived, to measure against afterwards.
        let azimuths = chosen.field.azimuth_count();
        let gates = chosen.field.gate_count();
        let before: Vec<f32> = chosen.field.values().to_vec();

        let planted = fold_a_wedge(&mut chosen.field, nyquist);
        assert!(
            planted.len() > 1_000,
            "only {} gates were folded",
            planted.len()
        );

        let unfolded = unfold_velocity(&mut chosen.field, nyquist);
        let (after, _) = fold_jumps(&chosen.field, nyquist);
        assert!(unfolded, "nothing was unfolded");

        // How far each gate ended up from where it started, in whole intervals.
        let interval = 2.0 * nyquist;
        let wedge: std::collections::BTreeSet<(usize, usize)> =
            planted.iter().map(|(a, g, _)| (*a, *g)).collect();
        let mut outside: BTreeMap<i32, usize> = BTreeMap::new();
        let mut inside: BTreeMap<i32, usize> = BTreeMap::new();
        for azimuth in 0..azimuths {
            for gate in 0..gates {
                let (now, status) = chosen.field.get(azimuth, gate);
                if !matches!(status, GateStatus::Valid) {
                    continue;
                }
                let was = before[azimuth * gates + gate];
                let steps = ((now - was) / interval).round() as i32;
                if wedge.contains(&(azimuth, gate)) {
                    *inside.entry(steps).or_default() += 1;
                } else {
                    *outside.entry(steps).or_default() += 1;
                }
            }
        }

        // The sweep as a whole can come back a whole interval out, because
        // boundaries only place patches relative to each other. Whichever way
        // it went, the wedge has to have rejoined the rest of it: the gates
        // outside the wedge and the gates inside it must have taken the same
        // step, or the seam is still there.
        let common = outside
            .iter()
            .max_by_key(|(_, count)| **count)
            .map(|(steps, _)| *steps)
            .unwrap_or(0);
        let rejoined = inside.get(&common).copied().unwrap_or(0);

        println!(
            "nyquist {nyquist:.1} m/s, {untouched} natural folds, {} planted,              sweep moved {common} intervals, {rejoined} of the wedge came with it,              the sweep counted as unfolded: {unfolded}, {after} jumps of {pairs} pairs"
        , planted.len());

        assert!(
            rejoined * 20 > planted.len() * 19,
            "only {rejoined} of {} planted gates rejoined the sweep; steps inside {inside:?} outside {outside:?}",
            planted.len()
        );
        let share = after as f64 / pairs as f64;
        assert!(
            share < 0.01,
            "{after} of {pairs} neighbouring gates still jump a fold apart"
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
            if count == 0 { 0.0 } else { total / count as f64 }
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
}

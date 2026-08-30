//! Single-site NEXRAD Level II radar: fetch a volume, decode one sweep, and
//! draw it as a Web Mercator image the map can lay over its own bounds.
//!
//! The mosaics OpenRadar leads with are national and smoothed. This is the
//! radar itself, one site at a time, which is what a close-in view wants.

use std::collections::VecDeque;
use std::sync::Mutex;

use base64::Engine;
use chrono::{DateTime, Datelike, Duration, Utc};
use nexrad_data::volume;
use nexrad_model::data::{GateStatus, Product, Scan, SweepField};
use nexrad_model::geo::{GeoPoint, RadarCoordinateSystem};
use nexrad_model::meta::registry;
use serde::Serialize;

use crate::http;

const ARCHIVE_HOST: &str = "https://unidata-nexrad-level2.s3.amazonaws.com";
/// The image is square because a sweep is a circle; this is its side in pixels.
const IMAGE_SIZE: usize = 1024;
/// A WSR-88D surveillance cut reaches this far, and the extent follows it.
const MAX_RANGE_KM: f64 = 230.0;
/// How far a viewport may sit from a site and still be worth handing over to
/// it. Past this the view is outside the site's coverage and the national
/// mosaic is the only honest picture, so nothing is offered.
const SITE_REACH_KM: f64 = 250.0;
/// Four volumes, as the roadmap asks. They are held compressed, not decoded.
const CACHE_CAPACITY: usize = 4;

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
    #[error("the image could not be encoded: {0}")]
    Encode(String),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Serialize for Level2Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
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

struct CachedVolume {
    key: String,
    data: Vec<u8>,
}

static CACHE: Mutex<VecDeque<CachedVolume>> = Mutex::new(VecDeque::new());

/// The products a caller may ask for, kept as plain names the frontend can send.
pub fn product_from_name(name: &str) -> Option<(Product, &'static str, &'static str)> {
    match name {
        "reflectivity" => Some((Product::Reflectivity, "Reflectivity", "dBZ")),
        "velocity" => Some((Product::Velocity, "Velocity", "m/s")),
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
    pub collected: Option<DateTime<Utc>>,
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
) -> (Vec<u8>, [f64; 4]) {
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

            let (color, alpha) = match status {
                GateStatus::Valid => match product {
                    Product::Reflectivity => {
                        // Below the lowest ramp stop there is nothing the
                        // legend could name, so the ground shows through.
                        if value < FADE_FLOOR_DBZ {
                            continue;
                        }
                        (
                            ramp_color(REFLECTIVITY_RAMP, value),
                            reflectivity_alpha(value),
                        )
                    }
                    Product::Velocity => (ramp_color(VELOCITY_RAMP, value), MAX_ALPHA),
                    _ => {
                        let (low, high) = range.unwrap_or((0.0, 1.0));
                        let span = high - low;
                        let scaled = if span > 0.0 {
                            (value - low) / span
                        } else {
                            0.0
                        };
                        (ramp_color(GENERIC_RAMP, scaled), MAX_ALPHA)
                    }
                },
                GateStatus::RangeFolded => (RANGE_FOLDED, MAX_ALPHA),
                GateStatus::BelowThreshold | GateStatus::NoData => continue,
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
) -> Result<SweepImage, Level2Error> {
    let (product, label, unit) = product_from_name(product_name)
        .ok_or_else(|| Level2Error::NoSweep(station.to_string(), product_name.to_string()))?;

    let file = volume::File::new(data);
    let scan = file
        .scan()
        .map_err(|error| Level2Error::Decode(error.to_string()))?;

    let chosen = sweep_field(&scan, product, tilt_index)
        .ok_or_else(|| Level2Error::NoSweep(station.to_string(), label.to_string()))?;

    // The volume carries its own site position; the registry is only the
    // fallback for a header that did not survive.
    let site = scan
        .site()
        .cloned()
        .or_else(|| registry::site_by_id(station).map(|entry| entry.to_site()));
    let site = site.ok_or_else(|| Level2Error::UnknownSite(station.to_string()))?;
    let coordinates = RadarCoordinateSystem::new(&site);

    let (pixels, [west, south, east, north]) = render_sweep(&chosen.field, &coordinates, product);
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
        site_name: entry
            .map(|site| format!("{}, {}", site.city, site.state))
            .unwrap_or_else(|| station.to_string()),
        product: label.to_string(),
        unit: unit.to_string(),
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

/// The nearest site to a point, so the frontend never has to ship its own
/// table. A point no site can see gets no answer rather than the least distant
/// one, which would otherwise draw Alaska's radar over the mid-Atlantic.
#[tauri::command]
pub fn level2_nearest_site(latitude: f32, longitude: f32) -> Option<String> {
    let site = registry::nearest_site(latitude, longitude)?;
    let distance = great_circle_km(
        latitude as f64,
        longitude as f64,
        site.latitude as f64,
        site.longitude as f64,
    );
    (distance <= SITE_REACH_KM).then(|| site.id.to_string())
}

#[tauri::command]
pub async fn level2_sweep(
    station: String,
    product: String,
    tilt: usize,
) -> Result<SweepImage, Level2Error> {
    let station = station.to_uppercase();
    if registry::site_by_id(&station).is_none() {
        return Err(Level2Error::UnknownSite(station));
    }
    let (key, data) = latest_volume(&station).await?;
    // Decoding and drawing a volume is CPU work; it must not sit on the async
    // runtime the whole time.
    tauri::async_runtime::spawn_blocking(move || {
        sweep_from_volume(&station, &key, data, &product, tilt)
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn the_nearest_site_is_the_one_a_viewer_is_standing_over() {
        assert_eq!(
            level2_nearest_site(35.4676, -97.5164).as_deref(),
            Some("KTLX")
        );
        assert_eq!(level2_nearest_site(41.73, -93.72).as_deref(), Some("KDMX"));
        // Puerto Rico and Hawaii have their own sites and are not the mainland.
        assert_eq!(level2_nearest_site(18.4, -66.1).as_deref(), Some("TJUA"));
    }

    #[test]
    fn a_place_no_site_can_see_gets_no_site() {
        // Mid-Atlantic, the middle of the Pacific, and central Europe.
        for (latitude, longitude) in [(30.0, -45.0), (10.0, -150.0), (48.9, 2.4)] {
            assert_eq!(
                level2_nearest_site(latitude, longitude),
                None,
                "{latitude},{longitude} is not in anyone's coverage"
            );
        }
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
        let sweep = sweep_from_volume("KDMX", &key, data.clone(), "reflectivity", 0)
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
        let (pixels, _) = render_sweep(&field, &coordinates, Product::Reflectivity);
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
        let velocity = sweep_from_volume("KDMX", &key, data, "velocity", 1)
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

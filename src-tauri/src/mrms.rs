//! MRMS: the national grid NOAA builds by merging every radar in the network,
//! at one kilometre and two minutes.
//!
//! The files are GRIB2 with data representation template 41, which means the
//! payload is a plain 16-bit PNG and a linear scale to turn its samples back
//! into physical values. That is the whole decode: no GRIB maths beyond the
//! headers, and nothing to unpack but an image.

use std::collections::VecDeque;
use std::io::{Cursor, Read};
use std::sync::Mutex;

use chrono::{DateTime, Datelike, Duration, NaiveDateTime, Utc};
use serde::Serialize;

use crate::http;

const BUCKET: &str = "https://noaa-mrms-pds.s3.amazonaws.com";
/// Every product on the map keeps one grid live at a time, and the composite
/// loop wants the next frame as well. Fewer slots than products means every
/// tile evicts the grid the next tile needs, and one screen re-downloads the
/// country once per layer.
const CACHE_CAPACITY: usize = PRODUCTS.len() + 1;
/// A decoded grid is columns × rows u16, which is fifty megabytes for the
/// published CONUS domain. Checked when the crate is compiled.
const GRID_BYTES: usize = 7000 * 3500 * 2;
const CACHE_BUDGET_BYTES: usize = 512 * 1024 * 1024;
const _: () = assert!(CACHE_CAPACITY * GRID_BYTES < CACHE_BUDGET_BYTES);
/// A drawn tile is a few kilobytes, so thousands of them cost less than one
/// grid. This is what makes a loop replay cheap: the second pass over a frame
/// never decodes anything.
const TILE_CACHE_CAPACITY: usize = 3_000;
const TILE_SIZE: usize = 256;
/// Web Mercator only reaches this far, and MRMS stops well short of it anyway.
#[cfg(test)]
const MERCATOR_LIMIT: f64 = 85.051_129;

#[derive(Debug, thiserror::Error)]
pub enum MrmsError {
    #[error("{0} is not an MRMS product OpenRadar reads")]
    UnknownProduct(String),
    #[error("the product listing could not be read")]
    BadListing,
    #[error("no {0} grid has been published yet")]
    NoFrames(String),
    #[error("the file is not GRIB2")]
    NotGrib,
    #[error("the grid is packed a way OpenRadar does not read: {0}")]
    Unsupported(String),
    #[error("the packed image could not be read: {0}")]
    Decode(String),
    #[error("the tile could not be encoded: {0}")]
    Encode(String),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Serialize for MrmsError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// How a product's grid is put onto a tile.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Sampling {
    /// One grid cell per pixel. Right for a field that covers the map, where
    /// neighbouring cells are alike and a missed cell changes nothing.
    Nearest,
    /// Every cell in view painted, at least a pixel each. Rotation, hail, and
    /// lightning are scattered single cells: a five-minute lightning grid can
    /// have a couple of hundred live cells in twenty-four million, and asking
    /// each pixel what is under its centre would draw an empty map.
    Cells,
}

/// One MRMS product: where it lives in the bucket and how it is drawn.
#[derive(Clone)]
pub struct MrmsProduct {
    pub id: &'static str,
    pub folder: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    pub ramp: &'static [(f32, [u8; 3])],
    /// Values at or below this are not drawn at all.
    pub floor: f32,
    pub sampling: Sampling,
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

/// Azimuthal shear, in hundredths of a reciprocal second. Anything this strong
/// is worth looking at, and the top of the ramp is tornadic.
const ROTATION_RAMP: &[(f32, [u8; 3])] = &[
    (0.002, [0x38, 0xbd, 0xf8]),
    (0.004, [0x4a, 0xde, 0x80]),
    (0.006, [0xfa, 0xcc, 0x15]),
    (0.008, [0xfb, 0x92, 0x3c]),
    (0.010, [0xf4, 0x3f, 0x5e]),
    (0.014, [0xc0, 0x26, 0xd3]),
];

/// Maximum estimated hail size in millimetres, banded the way warnings are:
/// quarter, golf ball, baseball.
const MESH_RAMP: &[(f32, [u8; 3])] = &[
    (6.0, [0x38, 0xbd, 0xf8]),
    (19.0, [0x4a, 0xde, 0x80]),
    (25.0, [0xfa, 0xcc, 0x15]),
    (45.0, [0xfb, 0x92, 0x3c]),
    (70.0, [0xf4, 0x3f, 0x5e]),
    (100.0, [0xc0, 0x26, 0xd3]),
];

/// Cloud-to-ground flashes per square kilometre per minute, over five
/// minutes. Even a busy storm rarely passes four.
const LIGHTNING_RAMP: &[(f32, [u8; 3])] = &[
    (0.01, [0x38, 0xbd, 0xf8]),
    (0.10, [0x4a, 0xde, 0x80]),
    (0.50, [0xfa, 0xcc, 0x15]),
    (1.00, [0xfb, 0x92, 0x3c]),
    (2.00, [0xf4, 0x3f, 0x5e]),
    (4.00, [0xc0, 0x26, 0xd3]),
];

pub const PRODUCTS: &[MrmsProduct] = &[
    MrmsProduct {
        id: "composite",
        folder: "MergedReflectivityQCComposite_00.50",
        label: "MRMS composite",
        unit: "dBZ",
        ramp: REFLECTIVITY_RAMP,
        floor: 5.0,
        sampling: Sampling::Nearest,
    },
    MrmsProduct {
        id: "rotation",
        folder: "RotationTrack60min_00.50",
        label: "Rotation tracks, past hour",
        unit: "1/s",
        ramp: ROTATION_RAMP,
        floor: 0.002,
        sampling: Sampling::Cells,
    },
    MrmsProduct {
        id: "mesh",
        folder: "MESH_00.50",
        label: "Maximum estimated hail size",
        unit: "mm",
        ramp: MESH_RAMP,
        floor: 6.0,
        sampling: Sampling::Cells,
    },
    MrmsProduct {
        id: "lightning",
        folder: "NLDN_CG_005min_AvgDensity_00.00",
        label: "Cloud-to-ground lightning, 5 min",
        unit: "flashes/km2/min",
        ramp: LIGHTNING_RAMP,
        floor: 0.01,
        sampling: Sampling::Cells,
    },
];

pub fn product_by_id(id: &str) -> Option<&'static MrmsProduct> {
    PRODUCTS.iter().find(|entry| entry.id == id)
}

/// A published grid: when it was valid and the object it lives in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MrmsFrame {
    /// Seconds since the epoch, which is what the timeline works in.
    pub time: i64,
    pub key: String,
}

/// A decoded grid, held as the packed integers rather than floats.
pub struct Grid {
    pub columns: usize,
    pub rows: usize,
    /// Degrees of the north-west cell centre.
    pub north: f64,
    pub west: f64,
    pub d_lat: f64,
    pub d_lon: f64,
    /// value = (reference + sample * 2^binary) / 10^decimal
    pub reference: f32,
    pub binary: i16,
    pub decimal: i16,
    pub samples: Vec<u16>,
}

impl Grid {
    pub fn value(&self, row: usize, column: usize) -> f32 {
        let sample = self.samples[row * self.columns + column] as f32;
        (self.reference + sample * 2f32.powi(self.binary as i32)) / 10f32.powi(self.decimal as i32)
    }

    /// The row and column a point falls in, or None when it is off the grid.
    pub fn locate(&self, latitude: f64, longitude: f64) -> Option<(usize, usize)> {
        let row = ((self.north - latitude) / self.d_lat).round();
        let column = ((longitude - self.west) / self.d_lon).round();
        if row < 0.0 || column < 0.0 {
            return None;
        }
        let (row, column) = (row as usize, column as usize);
        if row >= self.rows || column >= self.columns {
            return None;
        }
        Some((row, column))
    }
}

struct CachedGrid {
    key: String,
    grid: Grid,
}

static CACHE: Mutex<VecDeque<CachedGrid>> = Mutex::new(VecDeque::new());

struct CachedTile {
    key: String,
    bytes: Vec<u8>,
}

static TILES: Mutex<VecDeque<CachedTile>> = Mutex::new(VecDeque::new());

/// Only one grid is fetched and decoded at a time. A screen of tiles all miss
/// the cache at once, and without this every one of them would download and
/// decode the same fifty megabytes.
static DECODING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn tile_key(key: &str, zoom: u32, x: u32, y: u32) -> String {
    format!("{key}|{zoom}/{x}/{y}")
}

fn cached_tile(key: &str) -> Option<Vec<u8>> {
    let cache = TILES.lock().ok()?;
    cache
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| entry.bytes.clone())
}

fn remember_tile(key: String, bytes: &[u8]) {
    let Ok(mut cache) = TILES.lock() else {
        return;
    };
    if cache.iter().any(|entry| entry.key == key) {
        return;
    }
    cache.push_back(CachedTile {
        key,
        bytes: bytes.to_vec(),
    });
    while cache.len() > TILE_CACHE_CAPACITY {
        cache.pop_front();
    }
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

/// Walks the GRIB2 sections for the grid definition, the packing parameters,
/// and the PNG the data lives in. Only what OpenRadar reads is understood; a
/// file packed any other way is refused rather than guessed at.
pub fn decode_grib(bytes: &[u8]) -> Result<Grid, MrmsError> {
    if bytes.len() < 16 || &bytes[0..4] != b"GRIB" || bytes[7] != 2 {
        return Err(MrmsError::NotGrib);
    }

    let mut at = 16usize;
    let mut geometry: Option<(usize, usize, f64, f64, f64, f64)> = None;
    let mut packing: Option<(f32, i16, i16)> = None;
    let mut payload: Option<&[u8]> = None;

    while at + 5 <= bytes.len() {
        if &bytes[at..at + 4] == b"7777" {
            break;
        }
        let length = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        if length < 5 || at + length > bytes.len() {
            return Err(MrmsError::NotGrib);
        }
        let section = &bytes[at..at + length];

        match section[4] {
            3 => {
                let template = u16::from_be_bytes([section[12], section[13]]);
                if template != 0 {
                    return Err(MrmsError::Unsupported(format!(
                        "grid definition template {template}"
                    )));
                }
                let columns = u32::from_be_bytes(section[30..34].try_into().unwrap()) as usize;
                let rows = u32::from_be_bytes(section[34..38].try_into().unwrap()) as usize;
                let north = i32::from_be_bytes(section[46..50].try_into().unwrap()) as f64 / 1e6;
                let west = u32::from_be_bytes(section[50..54].try_into().unwrap()) as f64 / 1e6;
                let d_lon = u32::from_be_bytes(section[63..67].try_into().unwrap()) as f64 / 1e6;
                let d_lat = u32::from_be_bytes(section[67..71].try_into().unwrap()) as f64 / 1e6;
                let scan_mode = section[71];
                // Bit 1 set means west to east, bit 2 clear means north to
                // south. Anything else would be drawn upside down or mirrored.
                if scan_mode & 0b1100_0000 != 0 {
                    return Err(MrmsError::Unsupported(format!("scan mode {scan_mode}")));
                }
                // The bucket publishes eastward longitudes; the map works in
                // signed degrees.
                let west = if west > 180.0 { west - 360.0 } else { west };
                geometry = Some((columns, rows, north, west, d_lat, d_lon));
            }
            5 => {
                let template = u16::from_be_bytes([section[9], section[10]]);
                if template != 41 {
                    return Err(MrmsError::Unsupported(format!(
                        "data representation template {template}"
                    )));
                }
                let reference = f32::from_be_bytes(section[11..15].try_into().unwrap());
                let binary = i16::from_be_bytes(section[15..17].try_into().unwrap());
                let decimal = i16::from_be_bytes(section[17..19].try_into().unwrap());
                packing = Some((reference, signed_grib(binary), signed_grib(decimal)));
            }
            7 => payload = Some(&section[5..]),
            _ => {}
        }
        at += length;
    }

    let (columns, rows, north, west, d_lat, d_lon) =
        geometry.ok_or_else(|| MrmsError::Unsupported("no grid definition".into()))?;
    let (reference, binary, decimal) =
        packing.ok_or_else(|| MrmsError::Unsupported("no packing parameters".into()))?;
    let payload = payload.ok_or_else(|| MrmsError::Unsupported("no data section".into()))?;

    let samples = decode_png_samples(payload, columns * rows)?;

    Ok(Grid {
        columns,
        rows,
        north,
        west,
        d_lat,
        d_lon,
        reference,
        binary,
        decimal,
        samples,
    })
}

/// GRIB writes a signed integer as a sign bit plus magnitude, not two's
/// complement, so a negative exponent read the usual way comes out enormous.
fn signed_grib(raw: i16) -> i16 {
    if raw < 0 {
        -(raw & 0x7fff)
    } else {
        raw
    }
}

fn decode_png_samples(payload: &[u8], expected: usize) -> Result<Vec<u16>, MrmsError> {
    let decoder = png::Decoder::new(Cursor::new(payload));
    let mut reader = decoder
        .read_info()
        .map_err(|error| MrmsError::Decode(error.to_string()))?;
    let info = reader.info();
    let (color_type, bit_depth) = (info.color_type, info.bit_depth);
    if color_type != png::ColorType::Grayscale {
        return Err(MrmsError::Unsupported(format!("a {color_type:?} image")));
    }

    let mut samples = Vec::with_capacity(expected);
    while let Some(line) = reader
        .next_row()
        .map_err(|error| MrmsError::Decode(error.to_string()))?
    {
        let bytes = line.data();
        match bit_depth {
            png::BitDepth::Sixteen => {
                for pair in bytes.chunks_exact(2) {
                    samples.push(u16::from_be_bytes([pair[0], pair[1]]));
                }
            }
            png::BitDepth::Eight => samples.extend(bytes.iter().map(|value| *value as u16)),
            depth => return Err(MrmsError::Unsupported(format!("{depth:?} bit samples"))),
        }
    }

    if samples.len() != expected {
        return Err(MrmsError::Decode(format!(
            "the image holds {} values, the grid wants {expected}",
            samples.len()
        )));
    }
    Ok(samples)
}

fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, MrmsError> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(bytes)
        .read_to_end(&mut out)
        .map_err(|error| MrmsError::Decode(error.to_string()))?;
    Ok(out)
}

fn listing_url(folder: &str, day: DateTime<Utc>) -> String {
    format!(
        "{BUCKET}/?list-type=2&prefix=CONUS/{folder}/{:04}{:02}{:02}/",
        day.year(),
        day.month(),
        day.day()
    )
}

/// `MRMS_MergedReflectivityQCComposite_00.50_20260830-094642.grib2.gz`
pub fn key_time(key: &str) -> Option<i64> {
    let name = key.rsplit('/').next()?;
    let stamp = name.strip_suffix(".grib2.gz")?;
    let stamp = stamp.get(stamp.len().checked_sub(15)?..)?;
    NaiveDateTime::parse_from_str(stamp, "%Y%m%d-%H%M%S")
        .ok()
        .map(|at| at.and_utc().timestamp())
}

/// The object a product's grid for one moment lives in. The folder name is
/// repeated inside the file name, which is what makes this derivable rather
/// than something the frontend has to carry around.
pub fn key_for(entry: &MrmsProduct, time: i64) -> Option<String> {
    let at = DateTime::from_timestamp(time, 0)?;
    let day = at.format("%Y%m%d");
    let stamp = at.format("%Y%m%d-%H%M%S");
    Some(format!(
        "CONUS/{folder}/{day}/MRMS_{folder}_{stamp}.grib2.gz",
        folder = entry.folder
    ))
}

/// Reads `/product/time/z/x/y.png` off a tile request.
pub fn parse_tile_path(path: &str) -> Option<(&'static MrmsProduct, i64, u32, u32, u32)> {
    let path = path.trim_start_matches('/');
    let stem = path.strip_suffix(".png").unwrap_or(path);
    let mut parts = stem.split('/');
    let entry = product_by_id(parts.next()?)?;
    let time = parts.next()?.parse::<i64>().ok()?;
    let zoom = parts.next()?.parse::<u32>().ok()?;
    let x = parts.next()?.parse::<u32>().ok()?;
    let y = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() || zoom > 12 {
        return None;
    }
    Some((entry, time, zoom, x, y))
}

/// Answers one tile request: the bytes of a PNG, always. A tile with nothing
/// in it is a transparent pixel rather than an error, because a raster source
/// that gets a 404 logs a warning for every empty corner of the map.
pub async fn serve_tile(path: &str) -> Vec<u8> {
    let Some((entry, time, zoom, x, y)) = parse_tile_path(path) else {
        return EMPTY_TILE.to_vec();
    };
    let Some(key) = key_for(entry, time) else {
        return EMPTY_TILE.to_vec();
    };

    // A frame that has been drawn once never decodes again, which is what
    // makes replaying the loop cheap.
    let drawn = tile_key(&key, zoom, x, y);
    if let Some(bytes) = cached_tile(&drawn) {
        return bytes;
    }
    if grid_for(&key).await.is_err() {
        return EMPTY_TILE.to_vec();
    }
    let bytes = tile_from_cache(&key, entry, zoom, x, y).unwrap_or_else(|| EMPTY_TILE.to_vec());
    remember_tile(drawn, &bytes);
    bytes
}

pub fn frames_from_listing(listing: &str, limit: usize) -> Vec<MrmsFrame> {
    let mut frames = Vec::new();
    let mut rest = listing;
    while let Some(start) = rest.find("<Key>") {
        let after = &rest[start + 5..];
        let Some(end) = after.find("</Key>") else {
            break;
        };
        let key = &after[..end];
        if let Some(time) = key_time(key) {
            frames.push(MrmsFrame {
                time,
                key: key.to_string(),
            });
        }
        rest = &after[end + 6..];
    }
    frames.sort_by_key(|frame| frame.time);
    if frames.len() > limit {
        frames.drain(..frames.len() - limit);
    }
    frames
}

/// A product as the panel and the legend need it: what it is called, what it
/// is measured in, and the colours it is drawn with, so the legend on screen
/// is built from the same ramp the tiles are.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MrmsProductInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    pub floor: f32,
    /// Each ramp stop as its value and its colour in hex.
    pub stops: Vec<(f32, String)>,
}

#[tauri::command]
pub fn mrms_products() -> Vec<MrmsProductInfo> {
    PRODUCTS
        .iter()
        .map(|entry| MrmsProductInfo {
            id: entry.id,
            label: entry.label,
            unit: entry.unit,
            floor: entry.floor,
            stops: entry
                .ramp
                .iter()
                .map(|(value, color)| {
                    (
                        *value,
                        format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2]),
                    )
                })
                .collect(),
        })
        .collect()
}

/// The newest grids a product has published, oldest first.
#[tauri::command]
pub async fn mrms_frames(product: String, limit: usize) -> Result<Vec<MrmsFrame>, MrmsError> {
    let entry = product_by_id(&product).ok_or(MrmsError::UnknownProduct(product.clone()))?;
    let limit = limit.clamp(1, 60);
    let now = Utc::now();

    let mut frames = Vec::new();
    // Just after midnight UTC the day's folder holds only a frame or two, so
    // yesterday has to make up the rest of the loop.
    for day in [now - Duration::days(1), now] {
        let listing = http::get_bytes(&listing_url(entry.folder, day)).await?;
        let listing = String::from_utf8_lossy(&listing);
        if !listing.contains("<ListBucketResult") {
            return Err(MrmsError::BadListing);
        }
        frames.extend(frames_from_listing(&listing, limit));
    }
    frames.sort_by_key(|frame| frame.time);
    frames.dedup_by_key(|frame| frame.time);
    if frames.len() > limit {
        frames.drain(..frames.len() - limit);
    }
    if frames.is_empty() {
        return Err(MrmsError::NoFrames(entry.label.to_string()));
    }
    Ok(frames)
}

/// Only the inverse is needed to draw a tile; this is here so the inverse can
/// be checked against something.
#[cfg(test)]
fn mercator_y(latitude: f64) -> f64 {
    let clamped = latitude.clamp(-MERCATOR_LIMIT, MERCATOR_LIMIT);
    (std::f64::consts::FRAC_PI_4 + clamped.to_radians() / 2.0)
        .tan()
        .ln()
}

/// The mercator y of a latitude, which the cell walk needs to place a row.
fn mercator_of(latitude: f64) -> f64 {
    let clamped = latitude.clamp(-85.051_129, 85.051_129);
    (std::f64::consts::FRAC_PI_4 + clamped.to_radians() / 2.0)
        .tan()
        .ln()
}

/// The grid row a latitude falls in, which may be off either end.
fn grid_row_of(grid: &Grid, latitude: f64) -> i64 {
    ((grid.north - latitude) / grid.d_lat).floor() as i64
}

fn grid_column_of(grid: &Grid, longitude: f64) -> i64 {
    ((longitude - grid.west) / grid.d_lon).floor() as i64
}

fn inverse_mercator_y(y: f64) -> f64 {
    (2.0 * y.exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees()
}

/// Draws one slippy-map tile out of a decoded grid, as the RGBA it becomes
/// before it is encoded. None when the tile holds nothing worth sending,
/// which is most of the world.
pub fn tile_pixels(grid: &Grid, entry: &MrmsProduct, zoom: u32, x: u32, y: u32) -> Option<Vec<u8>> {
    let scale = 2f64.powi(zoom as i32);
    if x as f64 >= scale || y as f64 >= scale {
        return None;
    }

    let top = std::f64::consts::PI * (1.0 - 2.0 * y as f64 / scale);
    let bottom = std::f64::consts::PI * (1.0 - 2.0 * (y + 1) as f64 / scale);
    let left = (x as f64 / scale) * 360.0 - 180.0;
    let right = ((x + 1) as f64 / scale) * 360.0 - 180.0;

    // The grid covers the lower forty-eight and no more, so most tiles can be
    // answered without looking at a single sample.
    let south = grid.north - grid.d_lat * grid.rows as f64;
    let east = grid.west + grid.d_lon * grid.columns as f64;
    if right < grid.west || left > east {
        return None;
    }
    if inverse_mercator_y(top) < south || inverse_mercator_y(bottom) > grid.north {
        return None;
    }

    let mut pixels = vec![0u8; TILE_SIZE * TILE_SIZE * 4];
    let mut painted = false;
    let mut paint = |row: usize, column: usize, value: f32| {
        let color = ramp_color(entry.ramp, value);
        let at = (row * TILE_SIZE + column) * 4;
        pixels[at] = color[0];
        pixels[at + 1] = color[1];
        pixels[at + 2] = color[2];
        pixels[at + 3] = 235;
        painted = true;
    };

    match entry.sampling {
        Sampling::Nearest => {
            for row in 0..TILE_SIZE {
                let mercator = top + (bottom - top) * ((row as f64 + 0.5) / TILE_SIZE as f64);
                let latitude = inverse_mercator_y(mercator);
                for column in 0..TILE_SIZE {
                    let longitude =
                        left + (right - left) * ((column as f64 + 0.5) / TILE_SIZE as f64);
                    let Some((grid_row, grid_column)) = grid.locate(latitude, longitude) else {
                        continue;
                    };
                    let value = grid.value(grid_row, grid_column);
                    if !value.is_finite() || value < entry.floor {
                        continue;
                    }
                    paint(row, column, value);
                }
            }
        }
        Sampling::Cells => {
            // The grid rows and columns this tile can see, so a tile over one
            // state never walks the whole country.
            // One cell either side, so a cell whose centre is just outside the
            // tile but whose body reaches into it is still drawn.
            let first_row = (grid_row_of(grid, inverse_mercator_y(top)) - 1).max(0) as usize;
            let last_row = (grid_row_of(grid, inverse_mercator_y(bottom)) + 1)
                .min(grid.rows as i64 - 1)
                .max(0) as usize;
            let first_column = (grid_column_of(grid, left) - 1).max(0) as usize;
            let last_column = (grid_column_of(grid, right) + 1)
                .min(grid.columns as i64 - 1)
                .max(0) as usize;
            if first_row > last_row || first_column > last_column {
                return None;
            }

            // Several cells can land on one pixel at a wide zoom, and the
            // strongest of them is the one worth seeing. Zoomed in the
            // opposite is true: one cell covers many pixels, and painting a
            // single one of them turns a solid hail swath into a dot lattice.
            // Each cell is drawn over the pixels it actually covers, so both
            // ends behave.
            let mut strongest = vec![f32::NEG_INFINITY; TILE_SIZE * TILE_SIZE];
            let to_row =
                |latitude: f64| ((top - mercator_of(latitude)) / (top - bottom)) * TILE_SIZE as f64;
            let to_column =
                |longitude: f64| ((longitude - left) / (right - left)) * TILE_SIZE as f64;

            for grid_row in first_row..=last_row {
                // The cell spans half a step either side of its centre.
                let north_edge = grid.north - grid.d_lat * (grid_row as f64 - 0.5);
                let south_edge = north_edge - grid.d_lat;
                let row_from = to_row(north_edge).floor().max(0.0) as usize;
                let row_to = (to_row(south_edge).ceil() as i64 - 1)
                    .min(TILE_SIZE as i64 - 1)
                    .max(-1);
                if row_to < row_from as i64 {
                    continue;
                }

                for grid_column in first_column..=last_column {
                    let value = grid.value(grid_row, grid_column);
                    if !value.is_finite() || value < entry.floor {
                        continue;
                    }
                    let west_edge = grid.west + grid.d_lon * (grid_column as f64 - 0.5);
                    let east_edge = west_edge + grid.d_lon;
                    // A cell whose centre sits west of this tile belongs to the
                    // tile before it, and without this the cast saturates and
                    // draws it down column zero.
                    let column_from = to_column(west_edge).floor();
                    let column_to = to_column(east_edge).ceil() - 1.0;
                    if column_to < 0.0 || column_from > TILE_SIZE as f64 - 1.0 {
                        continue;
                    }
                    let column_from = column_from.max(0.0) as usize;
                    let column_to = (column_to as i64).min(TILE_SIZE as i64 - 1) as usize;

                    for row in row_from..=(row_to as usize) {
                        for column in column_from..=column_to {
                            let at = row * TILE_SIZE + column;
                            if value > strongest[at] {
                                strongest[at] = value;
                            }
                        }
                    }
                }
            }
            for (at, value) in strongest.iter().enumerate() {
                if *value > f32::NEG_INFINITY {
                    paint(at / TILE_SIZE, at % TILE_SIZE, *value);
                }
            }
        }
    }

    if !painted {
        return None;
    }
    Some(pixels)
}

fn encode_png(pixels: &[u8]) -> Result<Vec<u8>, MrmsError> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, TILE_SIZE as u32, TILE_SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| MrmsError::Encode(error.to_string()))?;
        writer
            .write_image_data(pixels)
            .map_err(|error| MrmsError::Encode(error.to_string()))?;
    }
    Ok(out)
}

/// A one pixel transparent PNG, which is what an empty tile answers with.
pub const EMPTY_TILE: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
];

#[cfg(test)]
pub static FETCHES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[cfg(test)]
pub static DECODES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn is_cached(key: &str) -> bool {
    CACHE
        .lock()
        .map(|cache| cache.iter().any(|entry| entry.key == key))
        .unwrap_or(false)
}

/// Fetches and decodes a grid, or hands back the one already in hand.
///
/// A screen of tiles arrives as a dozen concurrent misses on the same grid, so
/// the fetch and the decode are behind a gate and the cache is checked again on
/// the other side of it. Without that, one screen downloads and decodes the
/// same fifty megabytes a dozen times over.
pub async fn grid_for(key: &str) -> Result<(), MrmsError> {
    if is_cached(key) {
        return Ok(());
    }
    let _gate = DECODING.lock().await;
    // Whoever was ahead in the queue may have been fetching this very grid.
    if is_cached(key) {
        return Ok(());
    }

    #[cfg(test)]
    FETCHES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let bytes = http::get_bytes(&format!("{BUCKET}/{key}")).await?;
    let owned = key.to_string();
    let grid = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(test)]
        DECODES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let plain = gunzip(&bytes)?;
        decode_grib(&plain)
    })
    .await
    .map_err(|error| MrmsError::Decode(error.to_string()))??;

    if let Ok(mut cache) = CACHE.lock() {
        if !cache.iter().any(|entry| entry.key == owned) {
            cache.push_back(CachedGrid { key: owned, grid });
            while cache.len() > CACHE_CAPACITY {
                cache.pop_front();
            }
        }
    }
    Ok(())
}

/// Draws a tile from a grid already decoded, without holding it across an await.
pub fn tile_from_cache(
    key: &str,
    entry: &MrmsProduct,
    zoom: u32,
    x: u32,
    y: u32,
) -> Option<Vec<u8>> {
    // The lock is held for the drawing, which reads the grid, and dropped
    // before the encode, which does not. Holding it across the encode
    // serialises every tile on the screen behind the slowest one.
    let pixels = {
        let cache = CACHE.lock().ok()?;
        let held = cache.iter().find(|held| held.key == key)?;
        tile_pixels(&held.grid, entry, zoom, x, y)?
    };
    encode_png(&pixels).ok()
}

/// Drops the decoded grids but keeps the drawn tiles, so a test can prove a
/// tile came from the tile cache rather than from a fresh decode.
#[cfg(test)]
pub fn clear_grid_cache() {
    if let Ok(mut cache) = CACHE.lock() {
        cache.clear();
    }
}

#[cfg(test)]
pub fn clear_caches() {
    if let Ok(mut cache) = CACHE.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = TILES.lock() {
        cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The grid cache, the tile cache, and the fetch counters are all shared,
    /// so the live tests that touch them have to take turns. A panicking test
    /// poisons this; the next one carries on rather than failing for a reason
    /// that has nothing to do with it.
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

    fn live_test() -> std::sync::MutexGuard<'static, ()> {
        ONE_AT_A_TIME
            .lock()
            .unwrap_or_else(|held| held.into_inner())
    }

    fn grid() -> Grid {
        // Four cells covering a degree, packed the way MRMS packs dBZ.
        Grid {
            columns: 2,
            rows: 2,
            north: 41.0,
            west: -94.0,
            d_lat: 0.5,
            d_lon: 0.5,
            reference: -9990.0,
            binary: 0,
            decimal: 1,
            samples: vec![9990, 10240, 10490, 0],
        }
    }

    #[test]
    fn unpacks_samples_into_the_values_they_stand_for() {
        let grid = grid();
        assert_eq!(grid.value(0, 0), 0.0);
        assert_eq!(grid.value(0, 1), 25.0);
        assert_eq!(grid.value(1, 0), 50.0);
        // Zero is the missing marker, far below anything drawn.
        assert_eq!(grid.value(1, 1), -999.0);
    }

    #[test]
    fn finds_the_cell_a_point_falls_in_and_says_when_there_is_none() {
        let grid = grid();
        assert_eq!(grid.locate(41.0, -94.0), Some((0, 0)));
        assert_eq!(grid.locate(40.5, -93.5), Some((1, 1)));
        // Outside the grid in every direction.
        assert_eq!(grid.locate(45.0, -94.0), None);
        assert_eq!(grid.locate(41.0, -100.0), None);
        assert_eq!(grid.locate(30.0, -94.0), None);
        assert_eq!(grid.locate(41.0, -60.0), None);
    }

    #[test]
    fn reads_a_negative_grib_exponent_as_negative() {
        // GRIB writes -1 as a sign bit plus one, not as two's complement.
        assert_eq!(signed_grib(0x8001u16 as i16), -1);
        assert_eq!(signed_grib(1), 1);
        assert_eq!(signed_grib(0), 0);
    }

    #[test]
    fn reads_the_valid_time_out_of_a_key() {
        assert_eq!(
            key_time("CONUS/MESH_00.50/20260830/MRMS_MESH_00.50_20260830-094642.grib2.gz"),
            Some(1788083202)
        );
        assert_eq!(key_time("CONUS/MESH_00.50/20260830/index.html"), None);
    }

    #[test]
    fn keeps_the_newest_frames_a_listing_offers_in_order() {
        let listing = "<ListBucketResult>\
            <Contents><Key>CONUS/MESH_00.50/20260830/MRMS_MESH_00.50_20260830-094642.grib2.gz</Key></Contents>\
            <Contents><Key>CONUS/MESH_00.50/20260830/MRMS_MESH_00.50_20260830-094442.grib2.gz</Key></Contents>\
            <Contents><Key>CONUS/MESH_00.50/20260830/MRMS_MESH_00.50_20260830-094242.grib2.gz</Key></Contents>\
            <Contents><Key>CONUS/MESH_00.50/20260830/nonsense</Key></Contents>\
            </ListBucketResult>";
        let frames = frames_from_listing(listing, 2);
        assert_eq!(frames.len(), 2);
        assert!(frames[0].time < frames[1].time);
        assert!(frames[1].key.ends_with("094642.grib2.gz"));
    }

    /// The other test that talks to NOAA, ignored for the same reason. Run it
    /// with `cargo test --lib --release -- --ignored mrms`.
    #[test]
    #[ignore = "fetches a live grid from the MRMS archive"]
    fn decodes_and_draws_a_live_mrms_composite() {
        let _turn = live_test();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let entry = product_by_id("composite").expect("the composite product");

        let frames = runtime
            .block_on(mrms_frames("composite".into(), 10))
            .expect("MRMS publishes a grid every two minutes");
        assert!(frames.len() >= 5, "got {} frames", frames.len());
        assert!(
            frames.windows(2).all(|pair| pair[0].time < pair[1].time),
            "frames should be oldest first"
        );
        // Two minutes apart, which is the cadence the product claims.
        let step = frames[1].time - frames[0].time;
        assert!((110..=130).contains(&step), "frames are {step}s apart");
        // And the newest is recent, not a leftover from yesterday.
        let age = Utc::now().timestamp() - frames.last().unwrap().time;
        assert!(age < 900, "the newest grid is {age}s old");

        let newest = frames.last().unwrap();
        assert_eq!(
            key_for(entry, newest.time).as_deref(),
            Some(newest.key.as_str()),
            "the derived key has to match the one the bucket published"
        );

        let started = std::time::Instant::now();
        runtime
            .block_on(grid_for(&newest.key))
            .expect("the grid decodes");
        let decoded = started.elapsed();

        // The grid is the published one kilometre CONUS domain.
        {
            let cache = CACHE.lock().expect("the cache");
            let held = cache
                .iter()
                .find(|held| held.key == newest.key)
                .expect("the grid is cached");
            assert_eq!((held.grid.columns, held.grid.rows), (7000, 3500));
            assert!((held.grid.d_lat - 0.01).abs() < 1e-9);
            assert!(
                (held.grid.west + 129.995).abs() < 0.01,
                "west is {}",
                held.grid.west
            );
            assert!(
                (held.grid.north - 54.995).abs() < 0.01,
                "north is {}",
                held.grid.north
            );

            // Real weather somewhere in the country, and clear air elsewhere.
            let values: Vec<f32> = (0..held.grid.rows)
                .step_by(37)
                .flat_map(|row| {
                    (0..held.grid.columns)
                        .step_by(37)
                        .map(move |column| (row, column))
                })
                .map(|(row, column)| held.grid.value(row, column))
                .collect();
            let strongest = values.iter().cloned().fold(f32::MIN, f32::max);
            assert!(
                strongest > 20.0,
                "nowhere in the country had more than {strongest} dBZ"
            );
            assert!(
                values.iter().any(|value| *value < -90.0),
                "the grid should have gaps outside radar coverage"
            );
        }

        // A tile over the middle of the country draws; one over Europe does not.
        let drawing = std::time::Instant::now();
        let tile = tile_from_cache(&newest.key, entry, 4, 3, 5);
        let drawn = drawing.elapsed();
        assert!(
            tile.as_ref().is_some_and(|bytes| bytes.len() > 200),
            "the tile over the plains came out empty"
        );
        assert!(tile_from_cache(&newest.key, entry, 4, 8, 5).is_none());

        println!("decode {decoded:?}, tile {drawn:?}");
        assert!(
            decoded < std::time::Duration::from_secs(3),
            "decoding took {decoded:?}"
        );
        assert!(
            drawn < std::time::Duration::from_millis(200),
            "one tile took {drawn:?}"
        );
    }

    /// The whole native path exactly as the webview drives it: a URL in, PNG
    /// bytes out. Ignored with the other live tests.
    #[test]
    #[ignore = "fetches a live grid from the MRMS archive"]
    fn serves_a_tile_the_way_the_map_asks_for_one() {
        let _turn = live_test();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        let frames = runtime
            .block_on(mrms_frames("composite".into(), 3))
            .expect("MRMS publishes grids");
        let time = frames.last().expect("a frame").time;

        // Zoom 4 tile 3/5 covers the middle of the country.
        let plains = runtime.block_on(serve_tile(&format!("/composite/{time}/4/3/5.png")));
        assert_eq!(&plains[1..4], b"PNG");
        assert!(plains.len() > EMPTY_TILE.len(), "the tile came back empty");

        // Over the Atlantic there is nothing to draw, and an empty tile is the
        // answer rather than an error the map would log for every corner.
        let ocean = runtime.block_on(serve_tile(&format!("/composite/{time}/4/8/5.png")));
        assert_eq!(ocean, EMPTY_TILE);

        // A moment nothing was published for is a real tile request for an
        // object that does not exist, and the answer is an empty tile rather
        // than an error the map would log for every corner of the country.
        let missing = runtime.block_on(serve_tile("/composite/0/4/3/5.png"));
        assert_eq!(missing, EMPTY_TILE);

        // A request that is not a tile request at all is answered the same way,
        // never with a panic or a file from somewhere else.
        for path in ["/../../../etc/passwd", "/nonsense", ""] {
            let answer = runtime.block_on(serve_tile(path));
            assert_eq!(&answer[1..4], b"PNG", "{path} did not answer with a PNG");
        }
    }

    /// Builds the smallest file the walker will accept, so each guard can be
    /// tried against a file that is otherwise perfectly good.
    fn synthetic_grib(
        grid_template: u16,
        drt_template: u16,
        scan_mode: u8,
        columns: u32,
        rows: u32,
        image: (u32, u32),
        samples: &[u16],
    ) -> Vec<u8> {
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, image.0, image.1);
            encoder.set_color(png::ColorType::Grayscale);
            encoder.set_depth(png::BitDepth::Sixteen);
            let mut writer = encoder.write_header().expect("a header");
            let raw: Vec<u8> = samples.iter().flat_map(|s| s.to_be_bytes()).collect();
            writer.write_image_data(&raw).expect("image data");
        }

        let mut out = Vec::new();
        out.extend_from_slice(b"GRIB");
        out.extend_from_slice(&[0, 0, 209, 2]);
        out.extend_from_slice(&0u64.to_be_bytes());

        let mut section3 = vec![0u8; 72];
        section3[0..4].copy_from_slice(&72u32.to_be_bytes());
        section3[4] = 3;
        section3[12..14].copy_from_slice(&grid_template.to_be_bytes());
        section3[30..34].copy_from_slice(&columns.to_be_bytes());
        section3[34..38].copy_from_slice(&rows.to_be_bytes());
        // 54.995 N, 230.005 E, hundredths of a degree apart.
        section3[46..50].copy_from_slice(&54_995_000i32.to_be_bytes());
        section3[50..54].copy_from_slice(&230_005_000u32.to_be_bytes());
        section3[63..67].copy_from_slice(&10_000u32.to_be_bytes());
        section3[67..71].copy_from_slice(&10_000u32.to_be_bytes());
        section3[71] = scan_mode;
        out.extend_from_slice(&section3);

        let mut section5 = vec![0u8; 21];
        section5[0..4].copy_from_slice(&21u32.to_be_bytes());
        section5[4] = 5;
        section5[5..9].copy_from_slice(&(columns * rows).to_be_bytes());
        section5[9..11].copy_from_slice(&drt_template.to_be_bytes());
        section5[11..15].copy_from_slice(&(-9990f32).to_be_bytes());
        section5[15..17].copy_from_slice(&0i16.to_be_bytes());
        section5[17..19].copy_from_slice(&1i16.to_be_bytes());
        section5[19] = 16;
        out.extend_from_slice(&section5);

        let mut section7 = Vec::new();
        section7.extend_from_slice(&((png_bytes.len() + 5) as u32).to_be_bytes());
        section7.push(7);
        section7.extend_from_slice(&png_bytes);
        out.extend_from_slice(&section7);

        out.extend_from_slice(b"7777");
        out
    }

    #[test]
    fn reads_a_well_formed_file_the_way_the_bucket_writes_them() {
        let bytes = synthetic_grib(0, 41, 0, 2, 2, (2, 2), &[9990, 10240, 10490, 0]);
        let grid = decode_grib(&bytes).expect("a file in the shape MRMS publishes");
        assert_eq!((grid.columns, grid.rows), (2, 2));
        assert_eq!(grid.value(0, 1), 25.0);
        // Eastward longitudes are turned into the signed degrees the map uses.
        assert!((grid.west + 129.995).abs() < 1e-6, "west is {}", grid.west);
        assert!((grid.north - 54.995).abs() < 1e-6);
    }

    #[test]
    fn refuses_a_file_packed_a_way_it_cannot_read() {
        let samples = [9990u16, 10240, 10490, 0];
        // Simple packing rather than the PNG the reader is built around.
        let simple = synthetic_grib(0, 40, 0, 2, 2, (2, 2), &samples);
        assert!(
            matches!(decode_grib(&simple), Err(MrmsError::Unsupported(_))),
            "template 40 should be refused, not read as if it were 41"
        );
        // A projection other than plain latitude and longitude.
        let lambert = synthetic_grib(30, 41, 0, 2, 2, (2, 2), &samples);
        assert!(matches!(
            decode_grib(&lambert),
            Err(MrmsError::Unsupported(_))
        ));
        // A scan that runs the other way would draw the country upside down.
        let flipped = synthetic_grib(0, 41, 0b0100_0000, 2, 2, (2, 2), &samples);
        assert!(matches!(
            decode_grib(&flipped),
            Err(MrmsError::Unsupported(_))
        ));
        // And a grid whose image holds the wrong number of values.
        // A grid that says four by four but ships a two by two image.
        let short = synthetic_grib(0, 41, 0, 4, 4, (2, 2), &samples);
        assert!(matches!(decode_grib(&short), Err(MrmsError::Decode(_))));
    }

    #[test]
    fn a_tile_with_nothing_above_the_floor_is_not_sent_at_all() {
        let entry = product_by_id("composite").expect("the composite product");
        // A grid in the right place, holding only values below the ramp floor.
        let quiet = Grid {
            columns: 2,
            rows: 2,
            north: 41.0,
            west: -94.0,
            d_lat: 0.5,
            d_lon: 0.5,
            reference: -9990.0,
            binary: 0,
            decimal: 1,
            samples: vec![9990, 9991, 0, 0],
        };
        // Zoom 4 tile 3/5 covers the middle of the country, so this tile does
        // overlap the grid; it simply has nothing worth drawing.
        assert!(
            tile_pixels(&quiet, entry, 4, 3, 5).is_none(),
            "a tile of clear air should not be sent"
        );

        // The same tile with one gate of real rain in it does get sent.
        let mut wet = quiet;
        wet.samples = vec![10490, 10490, 10490, 10490];
        assert!(tile_pixels(&wet, entry, 4, 3, 5).is_some());
    }

    /// One screen is a dozen tiles arriving at once, all wanting the same
    /// fifty megabyte grid. Live, because the cost being measured is a real
    /// download and a real decode.
    #[test]
    #[ignore = "fetches a live grid from the MRMS archive"]
    fn a_screen_of_tiles_pays_for_the_grid_once() {
        let _turn = live_test();
        use std::sync::atomic::Ordering;

        clear_caches();
        FETCHES.store(0, Ordering::Relaxed);
        DECODES.store(0, Ordering::Relaxed);

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .expect("a runtime");
        let frames = runtime
            .block_on(mrms_frames("composite".into(), 1))
            .expect("MRMS publishes grids");
        let time = frames.last().expect("a frame").time;

        // The tiles MapLibre asks for to cover the country at zoom four.
        let wanted: Vec<String> = (2..=5)
            .flat_map(|x| (5..=6).map(move |y| format!("/composite/{time}/4/{x}/{y}.png")))
            .collect();
        assert_eq!(wanted.len(), 8);

        let started = std::time::Instant::now();
        let tiles = runtime.block_on(async {
            let mut work = Vec::new();
            for path in wanted.clone() {
                work.push(tauri::async_runtime::spawn(async move {
                    serve_tile(&path).await
                }));
            }
            let mut out = Vec::new();
            for handle in work {
                out.push(handle.await.expect("a tile"));
            }
            out
        });
        let took = started.elapsed();

        let fetches = FETCHES.load(Ordering::Relaxed);
        let decodes = DECODES.load(Ordering::Relaxed);
        println!(
            "{} tiles, {fetches} fetches, {decodes} decodes, {took:?}",
            tiles.len()
        );
        assert_eq!(fetches, 1, "the grid was downloaded {fetches} times");
        assert_eq!(decodes, 1, "the grid was decoded {decodes} times");
        assert!(tiles.iter().all(|bytes| &bytes[1..4] == b"PNG"));

        // Asking again is answered from the drawn tiles, with no grid at all.
        clear_grid_cache();
        let again = runtime.block_on(serve_tile(&wanted[0]));
        assert_eq!(
            FETCHES.load(Ordering::Relaxed),
            1,
            "a drawn tile was redrawn"
        );
        assert_eq!(again, tiles[0]);
    }

    /// A five-minute lightning grid has a couple of hundred live cells in
    /// twenty-four million. Asking each pixel what is under its centre draws an
    /// empty map, so the sparse products walk the cells instead. Live, because
    /// the sparseness is the point.
    #[test]
    #[ignore = "fetches a live grid from the MRMS archive"]
    fn a_sparse_product_is_drawn_rather_than_missed() {
        let _turn = live_test();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        // Rotation tracks hold an hour of shear, so there is nearly always
        // something somewhere in the country to draw.
        let entry = product_by_id("rotation").expect("the rotation product");
        let frames = runtime
            .block_on(mrms_frames("rotation".into(), 1))
            .expect("MRMS publishes rotation tracks");
        let key = frames.last().expect("a frame").key.clone();
        runtime.block_on(grid_for(&key)).expect("the grid decodes");

        let cache = CACHE.lock().expect("the cache");
        let grid = &cache
            .iter()
            .find(|held| held.key == key)
            .expect("the grid is cached")
            .grid;

        let live = (0..grid.rows)
            .flat_map(|row| (0..grid.columns).map(move |column| (row, column)))
            .filter(|(row, column)| grid.value(*row, *column) >= entry.floor)
            .count();
        assert!(live > 0, "no rotation anywhere in the country to draw");

        // The same product drawn the other way, so the comparison does not
        // depend on how busy the weather happens to be.
        let by_pixel = MrmsProduct {
            sampling: Sampling::Nearest,
            ..*entry
        };

        // The country at zoom four, which is where a sparse product is easiest
        // to lose.
        let tiles: Vec<(u32, u32)> = (2..=5).flat_map(|x| (5..=6).map(move |y| (x, y))).collect();
        let count = |product: &MrmsProduct| {
            tiles
                .iter()
                .filter_map(|(x, y)| tile_pixels(grid, product, 4, *x, *y))
                .map(|pixels| pixels.chunks_exact(4).filter(|p| p[3] > 0).count())
                .sum::<usize>()
        };
        let walked = count(entry);
        let sampled = count(&by_pixel);

        println!("{live} live cells: {walked} pixels walking cells, {sampled} sampling pixels");
        assert!(walked > 0, "{live} live cells and not one pixel drew any");
        assert!(
            walked > sampled,
            "walking the cells drew {walked} pixels, sampling drew {sampled}"
        );
    }

    /// The reason the sparse products walk their cells: one live cell in a
    /// wide grid falls between pixel centres, and asking each pixel what is
    /// under it draws nothing at all.
    #[test]
    fn a_lone_cell_is_drawn_rather_than_fallen_between_pixels() {
        // A degree of grid at MRMS resolution, with a single live cell in it.
        let mut samples = vec![0u16; 100 * 100];
        samples[50 * 100 + 50] = 10_500;
        let grid = Grid {
            columns: 100,
            rows: 100,
            north: 42.0,
            west: -95.0,
            d_lat: 0.01,
            d_lon: 0.01,
            reference: -9990.0,
            binary: 0,
            decimal: 1,
            samples,
        };

        let walking = product_by_id("mesh").expect("a sparse product");
        let walking = MrmsProduct {
            ramp: REFLECTIVITY_RAMP,
            floor: 5.0,
            sampling: Sampling::Cells,
            ..*walking
        };
        let sampling = MrmsProduct {
            sampling: Sampling::Nearest,
            ..walking.clone()
        };

        // Zoom four over the plains: one pixel covers about forty grid cells,
        // so a single live cell is a needle.
        let painted = |product: &MrmsProduct| {
            tile_pixels(&grid, product, 4, 3, 5)
                .map(|pixels| pixels.chunks_exact(4).filter(|p| p[3] > 0).count())
                .unwrap_or(0)
        };

        assert_eq!(
            painted(&sampling),
            0,
            "the lone cell happened to sit under a pixel centre; move it"
        );
        assert_eq!(
            painted(&walking),
            1,
            "walking the cells has to draw the one live cell, and only it"
        );
    }

    /// A block of live cells over the plains, for the zoom tests below.
    fn solid_block() -> Grid {
        Grid {
            columns: 100,
            rows: 100,
            north: 41.5,
            west: -94.5,
            d_lat: 0.01,
            d_lon: 0.01,
            reference: -9990.0,
            binary: 0,
            decimal: 1,
            samples: vec![10_500; 100 * 100],
        }
    }

    fn painted_count(grid: &Grid, entry: &MrmsProduct, zoom: u32, x: u32, y: u32) -> usize {
        tile_pixels(grid, entry, zoom, x, y)
            .map(|pixels| pixels.chunks_exact(4).filter(|p| p[3] > 0).count())
            .unwrap_or(0)
    }

    /// The tile covering a point at a zoom, which is how a viewer gets there.
    fn tile_of(latitude: f64, longitude: f64, zoom: u32) -> (u32, u32) {
        let scale = 2f64.powi(zoom as i32);
        let x = ((longitude + 180.0) / 360.0 * scale) as u32;
        let mercator = mercator_of(latitude);
        let y = ((1.0 - mercator / std::f64::consts::PI) / 2.0 * scale) as u32;
        (x, y)
    }

    /// Painting one pixel per cell only works while a cell is smaller than a
    /// pixel. Zoomed in, a cell is several pixels across, and a solid swath
    /// drawn a pixel at a time comes out as a lattice of dots with almost
    /// nothing between them.
    #[test]
    fn a_solid_field_stays_solid_all_the_way_in() {
        let grid = solid_block();
        let entry = product_by_id("mesh").expect("a sparse product");
        let entry = MrmsProduct {
            ramp: REFLECTIVITY_RAMP,
            floor: 5.0,
            sampling: Sampling::Cells,
            ..*entry
        };

        for zoom in [6u32, 8, 9, 10] {
            let (x, y) = tile_of(41.0, -94.0, zoom);
            let walked = painted_count(&grid, &entry, zoom, x, y);
            let sampled = painted_count(
                &grid,
                &MrmsProduct {
                    sampling: Sampling::Nearest,
                    ..entry.clone()
                },
                zoom,
                x,
                y,
            );
            assert!(
                walked >= sampled,
                "at zoom {zoom} walking the cells drew {walked} pixels and sampling drew {sampled}"
            );
        }

        // Zoom ten is the source's own maximum and a cell is seven pixels
        // across there, so the field covers the whole tile.
        let (x, y) = tile_of(41.0, -94.0, 10);
        let deep = painted_count(&grid, &entry, 10, x, y);
        assert!(
            deep > TILE_SIZE * TILE_SIZE / 2,
            "a solid field covered only {deep} of {} pixels at zoom ten",
            TILE_SIZE * TILE_SIZE
        );
    }

    /// A cell whose centre sits west of a tile belongs to the tile before it.
    /// Casting a negative offset to an index saturates to zero, which draws a
    /// stripe of somebody else's weather down the left edge.
    #[test]
    fn a_cell_west_of_a_tile_is_not_drawn_down_its_left_edge() {
        let entry = product_by_id("mesh").expect("a sparse product");
        let entry = MrmsProduct {
            ramp: REFLECTIVITY_RAMP,
            floor: 5.0,
            sampling: Sampling::Cells,
            ..*entry
        };

        let zoom = 10u32;
        let (x, y) = tile_of(41.0, -94.0, zoom);
        let scale = 2f64.powi(zoom as i32);
        let left = (x as f64 / scale) * 360.0 - 180.0;

        // One cell, two whole cells west of this tile's left edge.
        let grid = Grid {
            columns: 1,
            rows: 1,
            north: 41.0,
            west: left - 0.02,
            d_lat: 0.01,
            d_lon: 0.01,
            reference: -9990.0,
            binary: 0,
            decimal: 1,
            samples: vec![10_500],
        };

        assert_eq!(
            painted_count(&grid, &entry, zoom, x, y),
            0,
            "a cell west of the tile was drawn inside it"
        );
        // And it is drawn on the tile it does belong to.
        assert!(painted_count(&grid, &entry, zoom, x - 1, y) > 0);
    }

    #[test]
    fn a_moment_names_the_object_it_was_published_in() {
        let entry = product_by_id("composite").expect("the composite product");
        assert_eq!(
            key_for(entry, 1788083202).as_deref(),
            Some(
                "CONUS/MergedReflectivityQCComposite_00.50/20260830/MRMS_MergedReflectivityQCComposite_00.50_20260830-094642.grib2.gz"
            )
        );
    }

    #[test]
    fn a_tile_request_is_read_strictly() {
        let (entry, time, zoom, x, y) =
            parse_tile_path("/composite/1788075402/6/14/24.png").expect("a tile");
        assert_eq!(entry.id, "composite");
        assert_eq!((time, zoom, x, y), (1788075402, 6, 14, 24));
        // The same path without the extension, which is how a source may ask.
        assert!(parse_tile_path("mesh/1788075402/3/1/2").is_some());

        // Nothing that is not exactly that shape is served.
        for path in [
            "/composite/1788075402/6/14",
            "/composite/1788075402/6/14/24/extra.png",
            "/../../etc/passwd/6/14/24.png",
            "/composite/notatime/6/14/24.png",
            "/composite/1788075402/40/14/24.png",
            "",
        ] {
            assert!(parse_tile_path(path).is_none(), "{path} should be refused");
        }
    }

    #[test]
    fn the_legend_is_built_from_the_ramp_the_tiles_are_drawn_with() {
        let products = mrms_products();
        assert_eq!(products.len(), PRODUCTS.len());

        let composite = products
            .iter()
            .find(|entry| entry.id == "composite")
            .expect("the composite product");
        assert_eq!(composite.unit, "dBZ");
        assert_eq!(composite.floor, 5.0);
        // The same stops the raster uses, in the same order.
        assert_eq!(composite.stops.len(), REFLECTIVITY_RAMP.len());
        assert_eq!(composite.stops[0], (5.0, "#04e9e7".to_string()));
        assert_eq!(composite.stops.last().unwrap().1, "#fdfdfd");
        assert!(
            composite.stops.windows(2).all(|pair| pair[0].0 < pair[1].0),
            "a ramp has to climb"
        );

        for entry in &products {
            assert!(!entry.label.is_empty());
            assert!(!entry.stops.is_empty());
        }
    }

    /// Which products walk their cells and which sample per pixel is not a
    /// detail: a five-minute lightning grid sampled per pixel draws an empty
    /// map, and a full reflectivity field walked cell by cell is slower for no
    /// gain.
    /// Every product on the map keeps one grid live. Fewer slots than that and
    /// each tile evicts the grid the next tile wants, so one screen downloads
    /// and decodes the whole country once per layer.
    #[test]
    fn the_cache_holds_every_product_at_once() {
        assert!(
            CACHE_CAPACITY > PRODUCTS.len(),
            "{} slots for {} products leaves nothing for the next frame",
            CACHE_CAPACITY,
            PRODUCTS.len()
        );

        clear_caches();
        let grid = || Grid {
            columns: 1,
            rows: 1,
            north: 41.0,
            west: -94.0,
            d_lat: 0.01,
            d_lon: 0.01,
            reference: -9990.0,
            binary: 0,
            decimal: 1,
            samples: vec![10_500],
        };
        // One grid per product, as a screen with every layer on would have.
        for entry in PRODUCTS {
            if let Ok(mut cache) = CACHE.lock() {
                cache.push_back(CachedGrid {
                    key: entry.id.to_string(),
                    grid: grid(),
                });
            }
        }
        for entry in PRODUCTS {
            assert!(
                is_cached(entry.id),
                "{}'s grid was evicted before the screen was drawn",
                entry.id
            );
        }
        clear_caches();
    }

    #[test]
    fn every_product_is_drawn_the_way_its_data_is_shaped() {
        let expected = [
            ("composite", Sampling::Nearest),
            ("rotation", Sampling::Cells),
            ("mesh", Sampling::Cells),
            ("lightning", Sampling::Cells),
        ];
        assert_eq!(expected.len(), PRODUCTS.len(), "a product has no verdict");
        for (id, sampling) in expected {
            let entry = product_by_id(id).unwrap_or_else(|| panic!("{id} is missing"));
            assert_eq!(entry.sampling, sampling, "{id} is drawn the wrong way");
        }
    }

    #[test]
    fn only_the_products_the_panel_offers_are_accepted() {
        assert_eq!(
            product_by_id("composite").map(|entry| entry.folder),
            Some("MergedReflectivityQCComposite_00.50")
        );
        assert!(product_by_id("rotation").is_some());
        assert!(product_by_id("mesh").is_some());
        assert!(product_by_id("../../secrets").is_none());
    }

    #[test]
    fn a_tile_outside_the_grid_is_not_drawn_at_all() {
        let grid = grid();
        let entry = product_by_id("composite").expect("the composite product");
        // Zoom 4 tile over western Europe, nowhere near the grid.
        assert!(tile_pixels(&grid, entry, 4, 8, 5).is_none());
        // A tile index that does not exist at its zoom.
        assert!(tile_pixels(&grid, entry, 1, 4, 0).is_none());
    }

    #[test]
    fn a_grib_that_is_not_one_is_refused_rather_than_guessed_at() {
        assert!(matches!(
            decode_grib(b"not a grib"),
            Err(MrmsError::NotGrib)
        ));
        let mut header = b"GRIB\0\0\xd1\x01".to_vec();
        header.resize(32, 0);
        assert!(matches!(decode_grib(&header), Err(MrmsError::NotGrib)));
    }

    #[test]
    fn mercator_round_trips_the_latitudes_the_grid_covers() {
        for latitude in [20.005, 35.0, 41.7, 54.995] {
            let back = inverse_mercator_y(mercator_y(latitude));
            assert!(
                (back - latitude).abs() < 1e-9,
                "{latitude} came back {back}"
            );
        }
    }
}

//! Wind from the GFS model, for the particle layer.
//!
//! The particles need the wind as vectors, and there is no service that
//! publishes them as pictures. GFS does publish them, as GRIB2 on AWS, with a
//! sidecar index that says which bytes hold which field, so only the two
//! fields wanted are ever downloaded rather than the whole four hundred
//! megabyte file.
//!
//! The packing is data representation template 3: complex packing with
//! spatial differencing. That is arithmetic rather than an image codec, so it
//! needs no library, but it is fiddly enough to be worth reading carefully.

use chrono::{DateTime, Datelike, Duration, Timelike, Utc};
use serde::Serialize;

use crate::http;

const BUCKET: &str = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";
/// Ten metres above ground, which is the wind people mean.
const LEVEL: &str = "10 m above ground";
/// A quarter degree, which is 1440 by 721 points.
const RESOLUTION: &str = "0p25";
/// One field is about a megabyte packed; this is a generous ceiling.
const MAX_FIELD_BYTES: u64 = 8 * 1024 * 1024;
/// The published grid, before it is thinned for the map.
const GRID_COLUMNS: usize = 1440;
const GRID_ROWS: usize = 721;
/// Every other point, which is half a degree and a quarter of the data. Fine
/// for particles: they interpolate between grid points anyway.
const STRIDE: usize = 2;

#[derive(Debug, thiserror::Error)]
pub enum GfsError {
    #[error("no GFS run has been published in the last day")]
    NoRun,
    #[error("the run index did not name the wind fields")]
    NoWind,
    #[error("the field is packed a way OpenRadar does not read: {0}")]
    Unsupported(String),
    #[error("the field could not be read: {0}")]
    Decode(String),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Serialize for GfsError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// The wind field as the map wants it: two components on a regular grid,
/// scaled into a byte each so it can travel as an image.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindField {
    pub columns: usize,
    pub rows: usize,
    /// Degrees of the north-west corner and the step between points.
    pub north: f64,
    pub west: f64,
    pub d_lat: f64,
    pub d_lon: f64,
    /// The range the bytes are scaled over, in metres a second.
    pub min_u: f32,
    pub max_u: f32,
    pub min_v: f32,
    pub max_v: f32,
    /// When the run was initialised and how far ahead this field is.
    pub init: String,
    pub lead_hours: i64,
    /// The two components as a data URL: red is u, green is v.
    pub image: String,
}

/// A field the index named, and the bytes it lives in.
#[derive(Debug, Clone, PartialEq)]
pub struct IndexEntry {
    pub name: String,
    pub start: u64,
    pub end: Option<u64>,
}

/// Reads the `.idx` sidecar. Each line is `n:offset:date:field:level:...`, and
/// a field runs from its own offset to the next line's.
pub fn parse_index(text: &str) -> Vec<IndexEntry> {
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let mut entries = Vec::new();
    for (at, line) in lines.iter().enumerate() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() < 5 {
            continue;
        }
        let Ok(start) = parts[1].parse::<u64>() else {
            continue;
        };
        let end = lines
            .get(at + 1)
            .and_then(|next| next.split(':').nth(1))
            .and_then(|offset| offset.parse::<u64>().ok())
            .and_then(|next| next.checked_sub(1))
            .filter(|end| *end >= start);
        entries.push(IndexEntry {
            name: format!("{}:{}", parts[3], parts[4]),
            start,
            end,
        });
    }
    entries
}

pub fn find_field<'a>(entries: &'a [IndexEntry], field: &str) -> Option<&'a IndexEntry> {
    entries
        .iter()
        .find(|entry| entry.name == format!("{field}:{LEVEL}"))
}

/// Reads bits out of a buffer, most significant first, which is how GRIB packs
/// everything that is not a whole number of octets.
struct Bits<'a> {
    bytes: &'a [u8],
    at: usize,
    exhausted: bool,
}

impl<'a> Bits<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Bits {
            bytes,
            at: 0,
            exhausted: false,
        }
    }

    fn take(&mut self, width: u8) -> u64 {
        if width == 0 {
            return 0;
        }
        let Some(end) = self.at.checked_add(width as usize) else {
            self.exhausted = true;
            return 0;
        };
        if end > self.bytes.len().saturating_mul(8) {
            self.exhausted = true;
            self.at = end;
            return 0;
        }
        let mut value = 0u64;
        for _ in 0..width {
            let byte = self.bytes.get(self.at >> 3).copied().unwrap_or(0);
            let bit = (byte >> (7 - (self.at & 7))) & 1;
            value = (value << 1) | bit as u64;
            self.at += 1;
        }
        value
    }

    fn align(&mut self) {
        self.at = self.at.saturating_add(7) & !7;
    }

    fn was_exhausted(&self) -> bool {
        self.exhausted
    }
}

fn signed(raw: u64, octets: u8) -> i64 {
    if octets == 0 {
        return 0;
    }
    let bits = octets as u32 * 8;
    let sign = 1u64 << (bits - 1);
    if raw & sign != 0 {
        -((raw & (sign - 1)) as i64)
    } else {
        raw as i64
    }
}

/// GRIB writes a signed integer as a sign bit plus magnitude.
fn signed_grib(raw: i16) -> i16 {
    if raw < 0 {
        -(raw & 0x7fff)
    } else {
        raw
    }
}

struct Packing {
    reference: f32,
    binary: i16,
    decimal: i16,
    bits: u8,
    groups: usize,
    width_reference: u8,
    width_bits: u8,
    length_reference: u32,
    length_increment: u8,
    last_group_length: u32,
    length_bits: u8,
    spatial_order: u8,
    extra_octets: u8,
    points: usize,
}

/// Undoes complex packing with spatial differencing, which is what GFS uses.
pub fn decode_complex(section5: &[u8], section7: &[u8]) -> Result<Vec<f32>, GfsError> {
    if section5.len() < 49 {
        return Err(GfsError::Decode("the packing header is truncated".into()));
    }
    let template = u16::from_be_bytes([section5[9], section5[10]]);
    if template != 3 {
        return Err(GfsError::Unsupported(format!(
            "data representation template {template}"
        )));
    }
    let packing = Packing {
        points: u32::from_be_bytes(section5[5..9].try_into().unwrap()) as usize,
        reference: f32::from_be_bytes(section5[11..15].try_into().unwrap()),
        binary: signed_grib(i16::from_be_bytes(section5[15..17].try_into().unwrap())),
        decimal: signed_grib(i16::from_be_bytes(section5[17..19].try_into().unwrap())),
        bits: section5[19],
        groups: u32::from_be_bytes(section5[31..35].try_into().unwrap()) as usize,
        width_reference: section5[35],
        width_bits: section5[36],
        length_reference: u32::from_be_bytes(section5[37..41].try_into().unwrap()),
        length_increment: section5[41],
        last_group_length: u32::from_be_bytes(section5[42..46].try_into().unwrap()),
        length_bits: section5[46],
        spatial_order: section5[47],
        extra_octets: section5[48],
    };

    if packing.spatial_order != 1 && packing.spatial_order != 2 {
        return Err(GfsError::Unsupported(format!(
            "spatial differencing of order {}",
            packing.spatial_order
        )));
    }
    if section5[22] != 0 {
        return Err(GfsError::Unsupported("missing value management".into()));
    }
    if packing.points == 0 || packing.points > GRID_COLUMNS * GRID_ROWS {
        return Err(GfsError::Decode(format!(
            "the packing header claims {} grid points",
            packing.points
        )));
    }
    if packing.groups == 0 || packing.groups > packing.points {
        return Err(GfsError::Decode(format!(
            "the packing header claims {} groups for {} points",
            packing.groups, packing.points
        )));
    }
    if packing.points < packing.spatial_order as usize {
        return Err(GfsError::Decode(
            "the grid is shorter than its spatial differencing order".into(),
        ));
    }
    if packing.extra_octets == 0 || packing.extra_octets > 8 {
        return Err(GfsError::Decode(format!(
            "the spatial differencing width is {} octets",
            packing.extra_octets
        )));
    }
    if packing.bits > 64 || packing.width_bits > 64 || packing.length_bits > 64 {
        return Err(GfsError::Decode(
            "a packed integer is wider than 64 bits".into(),
        ));
    }
    if !packing.reference.is_finite() {
        return Err(GfsError::Decode(
            "the packing reference is not finite".into(),
        ));
    }

    let mut bits = Bits::new(section7);

    // The values the differencing starts from, then the overall minimum, all
    // in the width the header named.
    let order = packing.spatial_order as usize;
    let mut first = Vec::with_capacity(order);
    for _ in 0..order {
        first.push(bits.take(packing.extra_octets * 8) as i64);
    }
    let minimum = signed(bits.take(packing.extra_octets * 8), packing.extra_octets);
    bits.align();

    let mut references = Vec::with_capacity(packing.groups);
    for _ in 0..packing.groups {
        references.push(bits.take(packing.bits));
    }
    bits.align();

    let mut widths = Vec::with_capacity(packing.groups);
    for _ in 0..packing.groups {
        let width = (packing.width_reference as u64)
            .checked_add(bits.take(packing.width_bits))
            .ok_or_else(|| GfsError::Decode("a group width overflowed".into()))?;
        if width > 64 {
            return Err(GfsError::Decode(format!(
                "a group value is {width} bits wide"
            )));
        }
        widths.push(width as u8);
    }
    bits.align();

    let mut lengths = Vec::with_capacity(packing.groups);
    for _ in 0..packing.groups {
        let length = bits
            .take(packing.length_bits)
            .checked_mul(packing.length_increment as u64)
            .and_then(|extra| (packing.length_reference as u64).checked_add(extra))
            .ok_or_else(|| GfsError::Decode("a group length overflowed".into()))?;
        lengths.push(length);
    }
    if let Some(last) = lengths.last_mut() {
        *last = packing.last_group_length as u64;
    }
    bits.align();

    let total = lengths.iter().try_fold(0u64, |held, length| {
        held.checked_add(*length)
            .ok_or_else(|| GfsError::Decode("the group lengths overflowed".into()))
    })?;
    if usize::try_from(total).ok() != Some(packing.points) {
        return Err(GfsError::Decode(format!(
            "the groups hold {total} values and the grid wants {}",
            packing.points
        )));
    }

    let mut differences = Vec::with_capacity(packing.points);
    for group in 0..packing.groups {
        let width = widths[group];
        let reference = references[group];
        for _ in 0..lengths[group] {
            let packed = reference
                .checked_add(bits.take(width))
                .and_then(|value| i64::try_from(value).ok())
                .and_then(|value| value.checked_add(minimum))
                .ok_or_else(|| GfsError::Decode("a packed value overflowed".into()))?;
            differences.push(packed);
        }
    }
    if bits.was_exhausted() {
        return Err(GfsError::Decode("the packed data is truncated".into()));
    }

    // Undo the differencing. The first values are the ones the header carried,
    // not the ones the groups did.
    let mut values = differences;
    for (at, value) in first.iter().enumerate() {
        values[at] = *value;
    }
    if order == 1 {
        for at in 1..values.len() {
            values[at] = values[at]
                .checked_add(values[at - 1])
                .ok_or_else(|| GfsError::Decode("spatial differencing overflowed".into()))?;
        }
    } else {
        for at in 2..values.len() {
            values[at] =
                values[at]
                    .checked_add(values[at - 1].checked_mul(2).ok_or_else(|| {
                        GfsError::Decode("spatial differencing overflowed".into())
                    })?)
                    .and_then(|value| value.checked_sub(values[at - 2]))
                    .ok_or_else(|| GfsError::Decode("spatial differencing overflowed".into()))?;
        }
    }

    let decimal_scale = 10f32.powi(packing.decimal as i32);
    let scale = 2f32.powi(packing.binary as i32) / decimal_scale;
    let reference = packing.reference / decimal_scale;
    if !decimal_scale.is_finite()
        || decimal_scale == 0.0
        || !scale.is_finite()
        || !reference.is_finite()
    {
        return Err(GfsError::Decode("the packing scale is not finite".into()));
    }
    let values: Vec<f32> = values
        .into_iter()
        .map(|value| reference + value as f32 * scale)
        .collect();
    if values.iter().any(|value| !value.is_finite()) {
        return Err(GfsError::Decode("the decoded field is not finite".into()));
    }
    Ok(values)
}

/// Walks a single GRIB2 message for the sections the decoder needs.
pub fn decode_message(bytes: &[u8]) -> Result<Vec<f32>, GfsError> {
    if bytes.len() < 16 || &bytes[0..4] != b"GRIB" || bytes[7] != 2 {
        return Err(GfsError::Decode("the field is not GRIB2".into()));
    }
    let mut at = 16usize;
    let mut section5: Option<&[u8]> = None;
    let mut section7: Option<&[u8]> = None;

    while at + 5 <= bytes.len() {
        if &bytes[at..at + 4] == b"7777" {
            break;
        }
        let length = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        if length < 5 || at + length > bytes.len() {
            return Err(GfsError::Decode("a section ran off the end".into()));
        }
        match bytes[at + 4] {
            5 => section5 = Some(&bytes[at..at + length]),
            7 => section7 = Some(&bytes[at + 5..at + length]),
            _ => {}
        }
        at += length;
    }

    let section5 = section5.ok_or_else(|| GfsError::Decode("no packing header".into()))?;
    let section7 = section7.ok_or_else(|| GfsError::Decode("no data".into()))?;
    decode_complex(section5, section7)
}

/// The most recent run that could have published, which is the one before last
/// so the files have had time to appear.
pub fn recent_runs(now: DateTime<Utc>) -> Vec<(DateTime<Utc>, u32)> {
    let mut runs = Vec::new();
    let mut at = now - Duration::hours(4);
    for _ in 0..4 {
        let hour = (at.hour() / 6) * 6;
        let start = at
            .date_naive()
            .and_hms_opt(hour, 0, 0)
            .map(|naive| naive.and_utc());
        if let Some(start) = start {
            if !runs
                .iter()
                .any(|(held, _): &(DateTime<Utc>, u32)| *held == start)
            {
                runs.push((start, hour));
            }
        }
        at -= Duration::hours(6);
    }
    runs
}

fn index_url(run: DateTime<Utc>, hour: u32) -> String {
    format!(
        "{BUCKET}/gfs.{:04}{:02}{:02}/{:02}/atmos/gfs.t{:02}z.pgrb2.{RESOLUTION}.f000.idx",
        run.year(),
        run.month(),
        run.day(),
        hour,
        hour
    )
}

fn field_url(run: DateTime<Utc>, hour: u32) -> String {
    format!(
        "{BUCKET}/gfs.{:04}{:02}{:02}/{:02}/atmos/gfs.t{:02}z.pgrb2.{RESOLUTION}.f000",
        run.year(),
        run.month(),
        run.day(),
        hour,
        hour
    )
}

/// Thins the published grid and scales the two components into bytes.
fn to_image(u: &[f32], v: &[f32]) -> Result<(Vec<u8>, usize, usize, [f32; 4]), GfsError> {
    if u.len() != GRID_COLUMNS * GRID_ROWS || v.len() != u.len() {
        return Err(GfsError::Decode(format!(
            "the field holds {} values and the grid wants {}",
            u.len(),
            GRID_COLUMNS * GRID_ROWS
        )));
    }
    if u.iter().chain(v).any(|value| !value.is_finite()) {
        return Err(GfsError::Decode("the wind field is not finite".into()));
    }
    let columns = GRID_COLUMNS / STRIDE;
    let rows = GRID_ROWS.div_ceil(STRIDE);

    let bounds = |values: &[f32]| {
        values
            .iter()
            .fold((f32::MAX, f32::MIN), |(low, high), value| {
                (low.min(*value), high.max(*value))
            })
    };
    let (min_u, max_u) = bounds(u);
    let (min_v, max_v) = bounds(v);
    let span_u = (max_u - min_u).max(f32::EPSILON);
    let span_v = (max_v - min_v).max(f32::EPSILON);

    let mut pixels = vec![0u8; columns * rows * 4];
    for row in 0..rows {
        for column in 0..columns {
            let source = (row * STRIDE) * GRID_COLUMNS + column * STRIDE;
            let at = (row * columns + column) * 4;
            pixels[at] = (((u[source] - min_u) / span_u) * 255.0).round() as u8;
            pixels[at + 1] = (((v[source] - min_v) / span_v) * 255.0).round() as u8;
            pixels[at + 2] = 0;
            pixels[at + 3] = 255;
        }
    }

    Ok((pixels, columns, rows, [min_u, max_u, min_v, max_v]))
}

fn encode_png(pixels: &[u8], columns: usize, rows: usize) -> Result<Vec<u8>, GfsError> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, columns as u32, rows as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| GfsError::Decode(error.to_string()))?;
        writer
            .write_image_data(pixels)
            .map_err(|error| GfsError::Decode(error.to_string()))?;
    }
    Ok(out)
}

/// The newest wind field GFS has published.
#[tauri::command]
pub async fn gfs_wind() -> Result<WindField, GfsError> {
    let mut last: Option<GfsError> = None;

    for (run, hour) in recent_runs(Utc::now()) {
        match wind_for_run(run, hour).await {
            Ok(field) => return Ok(field),
            Err(error) => last = Some(error),
        }
    }
    Err(last.unwrap_or(GfsError::NoRun))
}

async fn wind_for_run(run: DateTime<Utc>, hour: u32) -> Result<WindField, GfsError> {
    let index = http::get_bytes(&index_url(run, hour)).await?;
    let entries = parse_index(&String::from_utf8_lossy(&index));
    let u_entry = find_field(&entries, "UGRD").ok_or(GfsError::NoWind)?;
    let v_entry = find_field(&entries, "VGRD").ok_or(GfsError::NoWind)?;

    let url = field_url(run, hour);
    let u_bytes = fetch_field(&url, u_entry).await?;
    let v_bytes = fetch_field(&url, v_entry).await?;

    let init = run.to_rfc3339();
    tauri::async_runtime::spawn_blocking(move || {
        let u = decode_message(&u_bytes)?;
        let v = decode_message(&v_bytes)?;
        let (pixels, columns, rows, [min_u, max_u, min_v, max_v]) = to_image(&u, &v)?;
        let png = encode_png(&pixels, columns, rows)?;
        Ok(WindField {
            columns,
            rows,
            north: 90.0,
            west: 0.0,
            d_lat: 0.25 * STRIDE as f64,
            d_lon: 0.25 * STRIDE as f64,
            min_u,
            max_u,
            min_v,
            max_v,
            init,
            lead_hours: 0,
            image: format!(
                "data:image/png;base64,{}",
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png)
            ),
        })
    })
    .await
    .map_err(|error| GfsError::Decode(error.to_string()))?
}

async fn fetch_field(url: &str, entry: &IndexEntry) -> Result<Vec<u8>, GfsError> {
    let end = entry.end.ok_or(GfsError::NoWind)?;
    if end < entry.start || end - entry.start + 1 > MAX_FIELD_BYTES {
        return Err(GfsError::Decode("the field is an unreasonable size".into()));
    }
    Ok(http::get_range(url, entry.start, end).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const INDEX: &str = "\
1:0:d=2026083000:PRMSL:mean sea level:anl:
2:1000:d=2026083000:UGRD:10 m above ground:anl:
3:3000:d=2026083000:VGRD:10 m above ground:anl:
4:5500:d=2026083000:TMP:2 m above ground:anl:
";

    #[test]
    fn reads_the_index_and_the_bytes_each_field_lives_in() {
        let entries = parse_index(INDEX);
        assert_eq!(entries.len(), 4);

        let u = find_field(&entries, "UGRD").expect("the wind is in there");
        assert_eq!(u.start, 1000);
        // A field runs to the byte before the next one starts.
        assert_eq!(u.end, Some(2999));

        let v = find_field(&entries, "VGRD").expect("the other component");
        assert_eq!(v.start, 3000);
        assert_eq!(v.end, Some(5499));

        // The last field has no next line to bound it.
        assert_eq!(entries[3].end, None);
        assert!(find_field(&entries, "NOSUCH").is_none());
        // The level matters: there is a UGRD at every level in the real file.
        assert!(!entries.iter().any(|entry| entry.name == "UGRD:100 mb"));
    }

    #[test]
    fn ignores_a_line_that_is_not_an_index_line() {
        let entries = parse_index("nonsense\n\n:::\n1:0:d=1:UGRD:10 m above ground:anl:\n");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].start, 0);

        let malformed = parse_index(
            "1:10:d=1:UGRD:10 m above ground:anl:\n2:0:d=1:VGRD:10 m above ground:anl:\n",
        );
        assert_eq!(malformed[0].end, None);
    }

    #[test]
    fn reads_bits_most_significant_first() {
        // 1011 0010 0110 1001
        let bytes = [0b1011_0010u8, 0b0110_1001];
        let mut bits = Bits::new(&bytes);
        assert_eq!(bits.take(4), 0b1011);
        assert_eq!(bits.take(4), 0b0010);
        assert_eq!(bits.take(8), 0b0110_1001);
        // Past the end is marked as truncated rather than silently accepted.
        assert_eq!(bits.take(8), 0);
        assert!(bits.was_exhausted());

        let mut widths = Bits::new(&bytes);
        assert_eq!(widths.take(0), 0);
        assert_eq!(widths.take(12), 0b1011_0010_0110);
        widths.align();
        assert_eq!(widths.at, 16);
    }

    #[test]
    fn reads_a_sign_and_magnitude_integer() {
        // Two octets: 0x8005 is minus five, not thirty-two thousand.
        assert_eq!(signed(0x8005, 2), -5);
        assert_eq!(signed(0x0005, 2), 5);
        assert_eq!(signed(0, 2), 0);
        assert_eq!(signed_grib(0x8001u16 as i16), -1);
        assert_eq!(signed_grib(3), 3);
    }

    #[test]
    fn picks_the_runs_that_have_had_time_to_publish() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 8, 30)
            .unwrap()
            .and_hms_opt(7, 30, 0)
            .unwrap()
            .and_utc();
        let runs = recent_runs(now);
        // Half past seven, so the three o'clock lookback lands on the midnight
        // run rather than the six that is still uploading.
        assert_eq!(runs[0].1, 0);
        assert_eq!(runs[0].0.day(), 30);
        // Then back through the previous runs, newest first, no repeats.
        assert!(runs.windows(2).all(|pair| pair[0].0 > pair[1].0));
        assert_eq!(runs.len(), 4);
    }

    /// Talks to NOAA, so it is ignored with the other live tests.
    ///
    /// The decode is checked against the model itself rather than against a
    /// number written down here: the field is looked up at a handful of places
    /// and compared with what Open-Meteo says the GFS wind is at the same hour
    /// and the same points. Two independent readings of the same model landing
    /// within a couple of metres a second is what makes the arithmetic right.
    #[test]
    #[ignore = "fetches a live wind field from the GFS archive"]
    fn decodes_a_live_wind_field() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        let started = std::time::Instant::now();
        let field = runtime
            .block_on(gfs_wind())
            .expect("GFS publishes a run every six hours");
        let took = started.elapsed();

        assert_eq!(field.columns, GRID_COLUMNS / STRIDE);
        assert_eq!(field.rows, GRID_ROWS.div_ceil(STRIDE));
        assert!((field.north - 90.0).abs() < 1e-9);
        assert!((field.d_lon - 0.5).abs() < 1e-9);
        assert!(field.image.starts_with("data:image/png;base64,"));

        // Ten metre wind is a few tens of metres a second at the very most.
        // A decode that has gone wrong produces enormous numbers.
        for (low, high, name) in [
            (field.min_u, field.max_u, "u"),
            (field.min_v, field.max_v, "v"),
        ] {
            assert!(
                low > -120.0 && high < 120.0,
                "{name} ran from {low} to {high}, which is not wind"
            );
            assert!(
                high - low > 20.0,
                "{name} ran from {low} to {high}, which is too flat to be wind"
            );
            assert!(low < 0.0 && high > 0.0, "{name} never changes sign");
        }

        println!(
            "u {:.1} to {:.1}, v {:.1} to {:.1}, init {}, in {took:?}",
            field.min_u, field.max_u, field.min_v, field.max_v, field.init
        );
        assert!(
            took < std::time::Duration::from_secs(30),
            "the field took {took:?}"
        );
    }

    /// The same field read against a second opinion. Open-Meteo serves the
    /// global GFS, so the two should agree closely at the same hour and the
    /// same point. The model has to be named: the default is a blend that
    /// downscales onto local terrain, and comparing against that would be
    /// comparing against a different forecast.
    #[test]
    #[ignore = "fetches a live wind field and a second opinion"]
    fn agrees_with_a_second_reading_of_the_same_model() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        let (run, hour) = recent_runs(Utc::now())[0];
        let index = runtime
            .block_on(http::get_bytes(&index_url(run, hour)))
            .expect("the index");
        let entries = parse_index(&String::from_utf8_lossy(&index));
        let url = field_url(run, hour);

        let u_entry = find_field(&entries, "UGRD").expect("u");
        let v_entry = find_field(&entries, "VGRD").expect("v");
        let u = decode_message(
            &runtime
                .block_on(http::get_range(&url, u_entry.start, u_entry.end.unwrap()))
                .expect("u bytes"),
        )
        .expect("u decodes");
        let v = decode_message(
            &runtime
                .block_on(http::get_range(&url, v_entry.start, v_entry.end.unwrap()))
                .expect("v bytes"),
        )
        .expect("v decodes");

        // A spread of places, away from the poles and the date line.
        let places = [
            (41.7, -93.7, "Des Moines"),
            (51.5, -0.1, "London"),
            (-33.9, 151.2, "Sydney"),
            (35.7, 139.7, "Tokyo"),
            (-23.5, -46.6, "Sao Paulo"),
        ];

        let at = |latitude: f64, longitude: f64| {
            let row = ((90.0 - latitude) / 0.25).round() as usize;
            let east = if longitude < 0.0 {
                longitude + 360.0
            } else {
                longitude
            };
            let column = (east / 0.25).round() as usize % GRID_COLUMNS;
            let index = row * GRID_COLUMNS + column;
            (u[index], v[index])
        };

        let hour_iso = run.format("%Y-%m-%dT%H:00").to_string();
        let mut checked = 0;
        for (latitude, longitude, name) in places {
            let (u_value, v_value) = at(latitude, longitude);
            let speed = (u_value * u_value + v_value * v_value).sqrt();

            let url = format!(
                "https://api.open-meteo.com/v1/gfs?latitude={latitude}&longitude={longitude}&hourly=wind_speed_10m&wind_speed_unit=ms&start_hour={hour_iso}&end_hour={hour_iso}&models=gfs_global"
            );
            let Ok(body) = runtime.block_on(http::get_bytes(&url)) else {
                continue;
            };
            let text = String::from_utf8_lossy(&body);
            let Some(start) = text.find("\"wind_speed_10m\":[") else {
                continue;
            };
            let rest = &text[start + 18..];
            let Some(end) = rest.find(']') else { continue };
            let Ok(theirs) = rest[..end].trim().parse::<f32>() else {
                continue;
            };

            println!("{name}: ours {speed:.1} m/s, theirs {theirs:.1} m/s");
            assert!(
                (speed - theirs).abs() < 1.0,
                "{name}: this decode says {speed:.1} m/s and Open-Meteo says {theirs:.1}"
            );
            checked += 1;
        }

        assert!(checked >= 3, "only {checked} places could be compared");
    }

    #[test]
    fn names_the_files_a_run_publishes() {
        let run = chrono::NaiveDate::from_ymd_opt(2026, 8, 30)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();
        assert_eq!(
            index_url(run, 0),
            "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20260830/00/atmos/gfs.t00z.pgrb2.0p25.f000.idx"
        );
        assert_eq!(
            field_url(run, 18),
            "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20260830/18/atmos/gfs.t18z.pgrb2.0p25.f000"
        );
    }

    use arbitrary::Arbitrary;

    /// The complex-packing header, as fields rather than as 49 bytes.
    ///
    /// Random bytes are refused at the template check nine times in ten and
    /// never reach the arithmetic worth testing, so the header is built from
    /// typed fields and only the fields are arbitrary.
    #[derive(Debug, Arbitrary)]
    struct PackedHeader {
        points: u16,
        reference_bits: u32,
        binary: i16,
        decimal: i16,
        bits: u8,
        groups: u8,
        width_reference: u8,
        width_bits: u8,
        length_reference: u32,
        length_increment: u8,
        last_group_length: u32,
        length_bits: u8,
        spatial_order: u8,
        extra_octets: u8,
        missing: u8,
    }

    impl PackedHeader {
        fn bytes(&self) -> Vec<u8> {
            let mut out = vec![0u8; 49];
            out[5..9].copy_from_slice(&u32::from(self.points).to_be_bytes());
            // Template 3, or nothing below this line is ever reached.
            out[9..11].copy_from_slice(&3u16.to_be_bytes());
            out[11..15].copy_from_slice(&self.reference_bits.to_be_bytes());
            out[15..17].copy_from_slice(&self.binary.to_be_bytes());
            out[17..19].copy_from_slice(&self.decimal.to_be_bytes());
            out[19] = self.bits;
            out[22] = self.missing;
            out[31..35].copy_from_slice(&u32::from(self.groups).to_be_bytes());
            out[35] = self.width_reference;
            out[36] = self.width_bits;
            out[37..41].copy_from_slice(&self.length_reference.to_be_bytes());
            out[41] = self.length_increment;
            out[42..46].copy_from_slice(&self.last_group_length.to_be_bytes());
            out[46] = self.length_bits;
            out[47] = self.spatial_order;
            out[48] = self.extra_octets;
            out
        }

        /// The same fields, moved into the set the decoder can accept.
        ///
        /// Every rejection in `decode_complex` is a guard, and a generator that
        /// trips one has tested that guard and nothing behind it. In
        /// particular the group lengths have to sum to exactly the number of
        /// points, which arbitrary values never do, so the length fields are
        /// computed rather than drawn: no bits per length, so every group is
        /// the reference length, and the last group holds the remainder.
        ///
        /// The counts are kept small because the body is drawn from the same
        /// finite stream, and a header wanting more bits than the body has is
        /// refused as truncated before the differencing runs.
        fn consistent(&self) -> Self {
            let points = u16::max(self.points % 32, 2);
            let groups = u8::max(self.groups % 8, 1);
            let per_group = points / u16::from(groups);
            let last = points - per_group * (u16::from(groups) - 1);
            Self {
                points,
                // A reference that is not a number is its own guard.
                reference_bits: 1.0f32.to_bits(),
                binary: self.binary % 8,
                decimal: self.decimal % 4,
                bits: self.bits % 9,
                groups,
                width_reference: self.width_reference % 9,
                width_bits: 0,
                length_reference: u32::from(per_group),
                length_increment: 0,
                last_group_length: u32::from(last),
                length_bits: 0,
                spatial_order: 1 + self.spatial_order % 2,
                extra_octets: 1 + self.extra_octets % 8,
                missing: 0,
            }
        }
    }

    /// A deterministic stream of bytes for `Unstructured` to shape.
    ///
    /// Deterministic so a failure is reproducible from its seed rather than
    /// only from whatever the machine felt like that afternoon.
    fn pseudo_random(seed: u64, length: usize) -> Vec<u8> {
        let mut state = seed | 1;
        (0..length)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                (state >> 24) as u8
            })
            .collect()
    }

    /// What complex packing must hold for, on any bytes at all.
    ///
    /// This is the layer the fuzz target covers on nightly, written so it also
    /// runs in the ordinary gate on stable. The fuzzer explores far further;
    /// this stops a regression reaching a commit between fuzzing sessions.
    ///
    /// Each seed is tried twice: once with the header exactly as it was drawn,
    /// which mostly exercises the guards, and once moved into the set the
    /// decoder accepts, which is the only way the differencing and the
    /// overflow checks behind those guards are ever reached.
    #[test]
    fn complex_packing_holds_its_shape_on_arbitrary_input() {
        let mut decoded = 0usize;
        for seed in 0..4000u64 {
            let raw = pseudo_random(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15), 512);
            let mut source = arbitrary::Unstructured::new(&raw);
            let Ok(drawn) = PackedHeader::arbitrary(&mut source) else {
                continue;
            };
            let body = source.take_rest();

            for header in [drawn.consistent(), drawn] {
                // The only hard rule is that no input reaches a panic.
                // Everything here comes off the network.
                let Ok(values) = decode_complex(&header.bytes(), body) else {
                    continue;
                };
                decoded += 1;

                // A field that decoded holds exactly the number of points its
                // own header claimed. Anything else is a picture drawn from a
                // grid of the wrong size, which is worse than a refusal.
                assert_eq!(
                    values.len(),
                    usize::from(header.points),
                    "seed {seed} decoded {} values for {} points",
                    values.len(),
                    header.points,
                );
                assert!(
                    values.iter().all(|value| value.is_finite()),
                    "seed {seed} produced a value that is not a number",
                );
            }
        }
        // And the sweep has to actually reach the decoder, or it is four
        // thousand repetitions of the template check. A floor on coverage,
        // not a measurement of it.
        assert!(
            decoded >= 50,
            "only {decoded} shaped inputs decoded; the generator has drifted \
             away from the header the decoder accepts",
        );
    }

    #[test]
    fn refuses_a_field_packed_a_way_it_cannot_read() {
        assert!(matches!(
            decode_complex(&[0u8; 10], &[]),
            Err(GfsError::Decode(_))
        ));

        let mut section5 = vec![0u8; 49];
        section5[4] = 5;
        // Template 2 is complex packing without the differencing.
        section5[9..11].copy_from_slice(&2u16.to_be_bytes());
        assert!(matches!(
            decode_complex(&section5, &[]),
            Err(GfsError::Unsupported(_))
        ));

        // And anything that is not a GRIB2 message at all.
        assert!(matches!(
            decode_message(b"not a grib file"),
            Err(GfsError::Decode(_))
        ));
    }
}

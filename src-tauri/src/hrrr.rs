//! Near-surface smoke from the HRRR model, for the forecast tail.
//!
//! The HMS analysis says where smoke was seen. This says where the model
//! expects it to go, an hour at a time out to eighteen hours, read the same
//! way the GFS wind is: one field out of a large file, by byte range off the
//! sidecar index, unpacked from complex packing with spatial differencing.
//!
//! What is new is the grid. GFS publishes on a latitude-longitude grid, so a
//! row of values is a row of pixels. HRRR runs on a Lambert conformal cone at
//! three kilometres, 1799 by 1059 points with the first at 21.1N 122.7W, and
//! a row of that is a curve on a map. So the picture is drawn the other way
//! round: every pixel of a Web Mercator image asks which grid point it sits
//! on, through the inverse of the projection, rather than every grid point
//! being placed. Nearest neighbour is enough at three kilometres, and it keeps
//! a pixel honest: it holds one model value rather than a blend of four.

use std::collections::{HashMap, VecDeque};
use std::f64::consts::{FRAC_PI_4, PI};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration as StdDuration, Instant};

use chrono::{DateTime, Datelike, Duration, Timelike, Utc};
use serde::Serialize;

use crate::{gfs, http};

const BUCKET: &str = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com";
/// Smoke mass density eight metres up, which is the air people breathe.
const FIELD: &str = "MASSDEN:8 m above ground";
/// A packed field is about a megabyte; this is a generous ceiling.
const MAX_FIELD_BYTES: u64 = 8 * 1024 * 1024;
/// The surface file runs to eighteen hours on every cycle.
pub const MAX_LEAD_HOURS: u32 = 18;
/// How many hourly cycles back to try when the newest has not landed.
pub const RUN_LOOKBACK: u32 = 4;
/// A cycle's files land about an hour after its start.
const PUBLISH_LAG_HOURS: i64 = 1;
/// The width of the picture. The grid is 1799 across, so a pixel is a grid
/// point or two, and the data URL stays a few hundred kilobytes.
pub const OUTPUT_COLUMNS: usize = 1200;
/// How long a cycle that was not there is left alone before being asked for
/// again. Every frame of the tail would otherwise probe it.
const MISSING_FOR: StdDuration = StdDuration::from_secs(10 * 60);
/// How many painted fields are kept. A six-hour tail is six of them.
const CACHE_ENTRIES: usize = 24;
/// The sphere the grid is defined on, GRIB shape 6.
const EARTH_RADIUS_M: f64 = 6_371_229.0;
/// Below this the picture is left clear: it is the model's noise floor, not
/// smoke anybody could see.
pub const CLEAR_BELOW_UGM3: f32 = 3.0;
/// The field arrives in kilograms a cubic metre.
const KG_PER_M3_TO_UG: f32 = 1.0e9;

/// The scale, in micrograms a cubic metre, and what each step is drawn in.
///
/// The steps are the PM2.5 breakpoints of the air quality index, because
/// those are the numbers a reader has heard: twelve is the top of good,
/// thirty-five of moderate, fifty-five of unhealthy for sensitive groups, a
/// hundred and fifty of unhealthy. The colours are warm and get darker as the
/// number gets worse, so the order survives any colour vision, which a test
/// holds. The last value is the alpha: faint smoke is drawn faint.
pub const RAMP: [(f32, [u8; 3], u8); 6] = [
    (CLEAR_BELOW_UGM3, [0xfd, 0xe6, 0x8a], 0x80),
    (12.0, [0xfb, 0xbf, 0x24], 0xa0),
    (35.0, [0xf9, 0x73, 0x16], 0xb8),
    (55.0, [0xdc, 0x26, 0x26], 0xc8),
    (150.0, [0x7e, 0x22, 0xce], 0xd8),
    (250.0, [0x58, 0x1c, 0x1c], 0xe8),
];

#[derive(Debug, thiserror::Error)]
pub enum HrrrError {
    #[error("no HRRR cycle has published this hour yet")]
    NoRun,
    #[error("the forecast tail asks for whole hours, and this is not one")]
    OffHour,
    #[error("the cycle index did not name the smoke field")]
    NoField,
    #[error("the grid is one OpenRadar does not draw: {0}")]
    Unsupported(String),
    #[error("the field could not be read: {0}")]
    Decode(String),
    #[error(transparent)]
    Gfs(#[from] gfs::GfsError),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Serialize for HrrrError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// One step of the scale, as the legend draws it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RampStop {
    pub at: f32,
    pub color: String,
}

/// One hour of forecast smoke, painted and pinned.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmokeField {
    /// When the cycle started, RFC 3339.
    pub init: String,
    pub lead_hours: u32,
    /// The hour the field is for, RFC 3339.
    pub valid: String,
    /// The box the picture is pinned to, in degrees. The picture's rows are
    /// spaced in Web Mercator so the corners are all a map needs.
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
    pub columns: usize,
    pub rows: usize,
    /// The most smoke anywhere in the field, in micrograms a cubic metre.
    pub max_ugm3: f32,
    /// The scale the picture was painted with, so the legend cannot drift.
    pub ramp: Vec<RampStop>,
    /// A PNG data URL, transparent where the model says clear.
    pub image: String,
}

fn ramp_stops() -> Vec<RampStop> {
    RAMP.iter()
        .map(|(at, [r, g, b], _)| RampStop {
            at: *at,
            color: format!("#{r:02x}{g:02x}{b:02x}"),
        })
        .collect()
}

/// What a reading is drawn in, or clear.
pub fn colour(ugm3: f32) -> [u8; 4] {
    for (at, [r, g, b], alpha) in RAMP.iter().rev() {
        if ugm3 >= *at {
            return [*r, *g, *b, *alpha];
        }
    }
    [0, 0, 0, 0]
}

/// A Lambert conformal grid, as GRIB2 grid definition template 30 states it.
///
/// Kept in metres in the cone's own frame, with the first grid point's
/// position remembered, so a place on the ground becomes a fractional grid
/// index in two subtractions and a divide.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lambert {
    pub nx: usize,
    pub ny: usize,
    /// Grid spacing, in metres.
    pub dx: f64,
    pub dy: f64,
    /// The cone constant.
    n: f64,
    /// The scale constant, already multiplied by the radius.
    rf: f64,
    /// The distance from the apex to the reference parallel.
    rho0: f64,
    /// The central meridian, in radians.
    lambda0: f64,
    /// Where the first grid point sits, in metres.
    x1: f64,
    y1: f64,
}

/// The numbers grid definition template 30 carries, in degrees and metres.
///
/// `lo1` and `lov` may be east-positive to 360 as GRIB writes them, or
/// signed; both are read.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LambertSpec {
    pub nx: usize,
    pub ny: usize,
    /// The first grid point.
    pub la1: f64,
    pub lo1: f64,
    /// The central meridian.
    pub lov: f64,
    /// The parallel the spacing is true on.
    pub lad: f64,
    /// The standard parallels of the cone.
    pub latin1: f64,
    pub latin2: f64,
    pub dx: f64,
    pub dy: f64,
}

impl Lambert {
    /// A grid from the numbers the template carries.
    pub fn new(spec: LambertSpec) -> Self {
        let LambertSpec {
            nx,
            ny,
            la1,
            lo1,
            lov,
            lad,
            latin1,
            latin2,
            dx,
            dy,
        } = spec;
        let phi1 = latin1.to_radians();
        let phi2 = latin2.to_radians();
        let n = if (latin1 - latin2).abs() < 1e-9 {
            phi1.sin()
        } else {
            (phi1.cos() / phi2.cos()).ln()
                / ((FRAC_PI_4 + phi2 / 2.0).tan() / (FRAC_PI_4 + phi1 / 2.0).tan()).ln()
        };
        let f = phi1.cos() * (FRAC_PI_4 + phi1 / 2.0).tan().powf(n) / n;
        let rf = EARTH_RADIUS_M * f;
        let rho0 = rf / (FRAC_PI_4 + lad.to_radians() / 2.0).tan().powf(n);
        let mut grid = Self {
            nx,
            ny,
            dx,
            dy,
            n,
            rf,
            rho0,
            lambda0: signed_longitude(lov).to_radians(),
            x1: 0.0,
            y1: 0.0,
        };
        let (x1, y1) = grid.forward(la1, signed_longitude(lo1));
        grid.x1 = x1;
        grid.y1 = y1;
        grid
    }

    /// Metres in the cone's frame for a place on the ground.
    fn forward(&self, lat: f64, lon: f64) -> (f64, f64) {
        let rho = self.rf / (FRAC_PI_4 + lat.to_radians() / 2.0).tan().powf(self.n);
        let theta = self.n * wrap(lon.to_radians() - self.lambda0);
        (rho * theta.sin(), self.rho0 - rho * theta.cos())
    }

    /// The fractional grid index of a place, i east and j north, which may
    /// fall outside the grid.
    pub fn grid(&self, lat: f64, lon: f64) -> (f64, f64) {
        let (x, y) = self.forward(lat, lon);
        ((x - self.x1) / self.dx, (y - self.y1) / self.dy)
    }

    /// Where a grid index is on the ground, as longitude and latitude in
    /// degrees.
    pub fn lon_lat(&self, i: f64, j: f64) -> (f64, f64) {
        let x = self.x1 + i * self.dx;
        let y = self.y1 + j * self.dy;
        let rho = (x * x + (self.rho0 - y) * (self.rho0 - y)).sqrt() * self.n.signum();
        let theta = (x * self.n.signum()).atan2((self.rho0 - y) * self.n.signum());
        let lat = 2.0 * (self.rf / rho).powf(1.0 / self.n).atan() - PI / 2.0;
        let lon = self.lambda0 + theta / self.n;
        (wrap(lon).to_degrees(), lat.to_degrees())
    }

    /// The box the whole grid fits in, as west, south, east, north.
    ///
    /// Walked along all four edges rather than read off the corners: the top
    /// edge of a cone's grid is an arc, and its middle is further north than
    /// either corner.
    pub fn bounds(&self) -> [f64; 4] {
        let mut west = f64::MAX;
        let mut south = f64::MAX;
        let mut east = f64::MIN;
        let mut north = f64::MIN;
        let mut take = |i: usize, j: usize| {
            let (lon, lat) = self.lon_lat(i as f64, j as f64);
            west = west.min(lon);
            east = east.max(lon);
            south = south.min(lat);
            north = north.max(lat);
        };
        for i in 0..self.nx {
            take(i, 0);
            take(i, self.ny - 1);
        }
        for j in 0..self.ny {
            take(0, j);
            take(self.nx - 1, j);
        }
        [west, south, east, north]
    }
}

/// GRIB writes longitudes east of Greenwich to 360.
fn signed_longitude(degrees: f64) -> f64 {
    if degrees > 180.0 {
        degrees - 360.0
    } else {
        degrees
    }
}

fn wrap(radians: f64) -> f64 {
    let mut at = radians;
    while at > PI {
        at -= 2.0 * PI;
    }
    while at < -PI {
        at += 2.0 * PI;
    }
    at
}

/// A GRIB2 signed integer: sign in the top bit, magnitude below it.
fn grib_i32(bytes: &[u8]) -> i32 {
    let raw = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let magnitude = (raw & 0x7fff_ffff) as i32;
    if raw & 0x8000_0000 != 0 {
        -magnitude
    } else {
        magnitude
    }
}

fn be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

/// The grid a message is on, from its grid definition section.
///
/// Only template 30 on the standard sphere, scanned west to east and south
/// to north, which is what every HRRR file is. Anything else is refused by
/// name rather than drawn somewhere it is not.
pub fn parse_grid(section3: &[u8]) -> Result<Lambert, HrrrError> {
    if section3.len() < 81 || section3[4] != 3 {
        return Err(HrrrError::Decode("the grid definition is short".into()));
    }
    let template = u16::from_be_bytes([section3[12], section3[13]]);
    if template != 30 {
        return Err(HrrrError::Unsupported(format!(
            "grid definition template {template}"
        )));
    }
    let d = &section3[14..];
    let shape = d[0];
    if shape != 6 {
        return Err(HrrrError::Unsupported(format!("earth shape {shape}")));
    }
    let nx = be_u32(&d[16..20]) as usize;
    let ny = be_u32(&d[20..24]) as usize;
    if nx < 2 || ny < 2 || nx > 10_000 || ny > 10_000 {
        return Err(HrrrError::Unsupported(format!("a {nx} by {ny} grid")));
    }
    let points = be_u32(&section3[6..10]) as usize;
    if points != nx * ny {
        return Err(HrrrError::Decode(format!(
            "the grid says {points} points and {nx} by {ny} is not that"
        )));
    }
    let la1 = f64::from(grib_i32(&d[24..28])) / 1e6;
    let lo1 = f64::from(grib_i32(&d[28..32])) / 1e6;
    let lad = f64::from(grib_i32(&d[33..37])) / 1e6;
    let lov = f64::from(grib_i32(&d[37..41])) / 1e6;
    let dx = f64::from(be_u32(&d[41..45])) / 1e3;
    let dy = f64::from(be_u32(&d[45..49])) / 1e3;
    let centre = d[49];
    let scan = d[50];
    let latin1 = f64::from(grib_i32(&d[51..55])) / 1e6;
    let latin2 = f64::from(grib_i32(&d[55..59])) / 1e6;
    if centre & 0x80 != 0 {
        return Err(HrrrError::Unsupported("a south pole projection".into()));
    }
    // +i west to east, +j south to north, i consecutive: the only order the
    // sampler below understands.
    if scan & 0xe0 != 0x40 {
        return Err(HrrrError::Unsupported(format!("scanning mode {scan:#04x}")));
    }
    // None of these can be NaN: they were whole numbers a moment ago.
    if dx <= 0.0 || dy <= 0.0 || la1.abs() > 90.0 || latin1.abs() >= 89.0 {
        return Err(HrrrError::Decode(
            "the grid's numbers are not a grid".into(),
        ));
    }
    if latin1.abs() < 1e-6 && (latin1 - latin2).abs() < 1e-9 {
        // A cone tangent at the equator has no cone constant.
        return Err(HrrrError::Unsupported(
            "a cone tangent at the equator".into(),
        ));
    }
    Ok(Lambert::new(LambertSpec {
        nx,
        ny,
        la1,
        lo1,
        lov,
        lad,
        latin1,
        latin2,
        dx,
        dy,
    }))
}

/// The grid and the values of one GRIB2 message, in micrograms a cubic metre.
pub fn read_message(bytes: &[u8]) -> Result<(Lambert, Vec<f32>), HrrrError> {
    if bytes.len() < 16 || &bytes[0..4] != b"GRIB" || bytes[7] != 2 {
        return Err(HrrrError::Decode("the field is not GRIB2".into()));
    }
    let mut at = 16usize;
    let mut grid: Option<Lambert> = None;
    while at + 5 <= bytes.len() {
        if &bytes[at..at + 4] == b"7777" {
            break;
        }
        let length = be_u32(&bytes[at..at + 4]) as usize;
        if length < 5 || at + length > bytes.len() {
            return Err(HrrrError::Decode("a section ran off the end".into()));
        }
        if bytes[at + 4] == 3 {
            grid = Some(parse_grid(&bytes[at..at + length])?);
        }
        at += length;
    }
    let grid = grid.ok_or_else(|| HrrrError::Decode("no grid definition".into()))?;
    let raw = gfs::decode_message(bytes)?;
    if raw.len() != grid.nx * grid.ny {
        return Err(HrrrError::Decode(format!(
            "the field holds {} values and the grid wants {}",
            raw.len(),
            grid.nx * grid.ny
        )));
    }
    if raw.iter().any(|value| !value.is_finite()) {
        return Err(HrrrError::Decode("the field is not finite".into()));
    }
    let values = raw
        .iter()
        .map(|value| (value * KG_PER_M3_TO_UG).max(0.0))
        .collect();
    Ok((grid, values))
}

/// The field as pixels, pinned to a box.
pub struct Picture {
    pub pixels: Vec<u8>,
    pub columns: usize,
    pub rows: usize,
    pub bounds: [f64; 4],
    pub max_ugm3: f32,
}

fn mercator(lat_degrees: f64) -> f64 {
    (FRAC_PI_4 + lat_degrees.to_radians() / 2.0).tan().ln()
}

fn from_mercator(y: f64) -> f64 {
    (2.0 * y.exp().atan() - PI / 2.0).to_degrees()
}

/// Paints the field into a Web Mercator picture of the grid's bounding box.
///
/// Rows are spaced in Mercator rather than in degrees, so the picture can be
/// pinned by its four corners and land where the grid is at every latitude.
/// Each pixel takes the nearest grid point, or nothing where it falls off
/// the cone's grid.
pub fn to_image(values: &[f32], grid: &Lambert, columns: usize) -> Result<Picture, HrrrError> {
    if values.len() != grid.nx * grid.ny {
        return Err(HrrrError::Decode(format!(
            "the field holds {} values and the grid wants {}",
            values.len(),
            grid.nx * grid.ny
        )));
    }
    let bounds = grid.bounds();
    let [west, south, east, north] = bounds;
    let top = mercator(north);
    let bottom = mercator(south);
    let rows = ((top - bottom) / (east - west).to_radians() * columns as f64)
        .round()
        .max(1.0) as usize;
    let mut pixels = vec![0u8; columns * rows * 4];
    let nx = grid.nx as f64;
    let ny = grid.ny as f64;
    for row in 0..rows {
        let lat = from_mercator(top - (row as f64 + 0.5) / rows as f64 * (top - bottom));
        for column in 0..columns {
            let lon = west + (column as f64 + 0.5) / columns as f64 * (east - west);
            let (i, j) = grid.grid(lat, lon);
            let (i, j) = (i.round(), j.round());
            if i < 0.0 || j < 0.0 || i >= nx || j >= ny {
                continue;
            }
            let value = values[j as usize * grid.nx + i as usize];
            let [r, g, b, a] = colour(value);
            if a == 0 {
                continue;
            }
            let at = (row * columns + column) * 4;
            pixels[at] = r;
            pixels[at + 1] = g;
            pixels[at + 2] = b;
            pixels[at + 3] = a;
        }
    }
    let max_ugm3 = values.iter().copied().fold(0.0f32, f32::max);
    Ok(Picture {
        pixels,
        columns,
        rows,
        bounds,
        max_ugm3,
    })
}

fn floor_hour(at: DateTime<Utc>) -> DateTime<Utc> {
    at.date_naive()
        .and_hms_opt(at.hour(), 0, 0)
        .map(|naive| naive.and_utc())
        .unwrap_or(at)
}

/// The cycles worth asking for an hour, newest first.
///
/// The newest is the one that has had time to publish, or the one the
/// reflectivity tail was drawn from when that is older, so the two agree
/// whenever they can. Each earlier cycle reaches the same hour with one
/// more hour of lead, which is what "falls back to the previous one" means.
pub fn candidate_runs(
    valid: DateTime<Utc>,
    preferred: Option<DateTime<Utc>>,
) -> Vec<(DateTime<Utc>, u32)> {
    let mut newest = floor_hour(valid - Duration::hours(PUBLISH_LAG_HOURS));
    if let Some(preferred) = preferred.map(floor_hour) {
        if preferred < newest {
            newest = preferred;
        }
    }
    (0..RUN_LOOKBACK)
        .filter_map(|back| {
            let init = newest - Duration::hours(i64::from(back));
            let minutes = (valid - init).num_minutes();
            if minutes <= 0 || minutes % 60 != 0 {
                return None;
            }
            let lead = u32::try_from(minutes / 60).ok()?;
            (1..=MAX_LEAD_HOURS).contains(&lead).then_some((init, lead))
        })
        .collect()
}

fn index_url(init: DateTime<Utc>, lead: u32) -> String {
    format!("{}.idx", field_url(init, lead))
}

fn field_url(init: DateTime<Utc>, lead: u32) -> String {
    format!(
        "{BUCKET}/hrrr.{:04}{:02}{:02}/conus/hrrr.t{:02}z.wrfsfcf{lead:02}.grib2",
        init.year(),
        init.month(),
        init.day(),
        init.hour()
    )
}

struct Held {
    fields: HashMap<(String, u32), SmokeField>,
    order: VecDeque<(String, u32)>,
    missing: HashMap<String, Instant>,
}

fn held() -> &'static Mutex<Held> {
    static HELD: OnceLock<Mutex<Held>> = OnceLock::new();
    HELD.get_or_init(|| {
        Mutex::new(Held {
            fields: HashMap::new(),
            order: VecDeque::new(),
            missing: HashMap::new(),
        })
    })
}

fn cached(key: &(String, u32)) -> Option<SmokeField> {
    held().lock().ok()?.fields.get(key).cloned()
}

fn remember(key: (String, u32), field: SmokeField) {
    let Ok(mut held) = held().lock() else { return };
    if held.fields.insert(key.clone(), field).is_none() {
        held.order.push_back(key);
    }
    while held.order.len() > CACHE_ENTRIES {
        if let Some(oldest) = held.order.pop_front() {
            held.fields.remove(&oldest);
        }
    }
}

fn recently_missing(init: &str) -> bool {
    held()
        .lock()
        .ok()
        .and_then(|held| held.missing.get(init).map(|at| at.elapsed() < MISSING_FOR))
        .unwrap_or(false)
}

fn mark_missing(init: String) {
    if let Ok(mut held) = held().lock() {
        held.missing.insert(init, Instant::now());
    }
}

fn parse_time(text: &str) -> Result<DateTime<Utc>, HrrrError> {
    DateTime::parse_from_rfc3339(text)
        .map(|at| at.with_timezone(&Utc))
        .map_err(|_| HrrrError::Decode(format!("{text} is not a time")))
}

/// The smoke the model expects at an hour, from the newest cycle that has it.
#[tauri::command]
pub async fn hrrr_smoke(
    valid: String,
    preferred_init: Option<String>,
) -> Result<SmokeField, HrrrError> {
    let valid_at = parse_time(&valid)?;
    if valid_at.minute() != 0 || valid_at.second() != 0 {
        return Err(HrrrError::OffHour);
    }
    let preferred = preferred_init
        .as_deref()
        .and_then(|text| parse_time(text).ok());
    let candidates = candidate_runs(valid_at, preferred);
    if candidates.is_empty() {
        return Err(HrrrError::NoRun);
    }

    let mut last: Option<HrrrError> = None;
    for (init, lead) in candidates {
        let key = (init.to_rfc3339(), lead);
        if let Some(field) = cached(&key) {
            return Ok(field);
        }
        if recently_missing(&key.0) {
            continue;
        }
        match smoke_for_run(init, lead, valid_at).await {
            Ok(field) => {
                remember(key, field.clone());
                return Ok(field);
            }
            Err(error) => {
                log::info!("OpenRadar had no smoke from the {} cycle: {error}", key.0);
                mark_missing(key.0);
                last = Some(error);
            }
        }
    }
    Err(last.unwrap_or(HrrrError::NoRun))
}

async fn smoke_for_run(
    init: DateTime<Utc>,
    lead: u32,
    valid: DateTime<Utc>,
) -> Result<SmokeField, HrrrError> {
    let index = http::get_bytes(&index_url(init, lead)).await?;
    let entries = gfs::parse_index(&String::from_utf8_lossy(&index));
    let entry = entries
        .iter()
        .find(|entry| entry.name == FIELD)
        .ok_or(HrrrError::NoField)?;
    let end = entry.end.ok_or(HrrrError::NoField)?;
    if end < entry.start || end - entry.start + 1 > MAX_FIELD_BYTES {
        return Err(HrrrError::Decode(
            "the field is an unreasonable size".into(),
        ));
    }
    let bytes = http::get_range(&field_url(init, lead), entry.start, end).await?;

    let init_text = init.to_rfc3339();
    let valid_text = valid.to_rfc3339();
    tauri::async_runtime::spawn_blocking(move || {
        let (grid, values) = read_message(&bytes)?;
        let picture = to_image(&values, &grid, OUTPUT_COLUMNS)?;
        let png = gfs::encode_png(&picture.pixels, picture.columns, picture.rows)?;
        let [west, south, east, north] = picture.bounds;
        Ok(SmokeField {
            init: init_text,
            lead_hours: lead,
            valid: valid_text,
            west,
            south,
            east,
            north,
            columns: picture.columns,
            rows: picture.rows,
            max_ugm3: picture.max_ugm3,
            ramp: ramp_stops(),
            image: format!(
                "data:image/png;base64,{}",
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png)
            ),
        })
    })
    .await
    .map_err(|error| HrrrError::Decode(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contrast::{closest_neighbours, lightness_climbs, EVERY_VISION};

    /// One hour of smoke from the 17Z cycle on the first of September 2026,
    /// as the bucket served it: the whole message, byte range and all.
    const MASSDEN: &[u8] =
        include_bytes!("../tests/fixtures/HRRR_MASSDEN_2026_09_01_17Z_F01.grib2");

    /// The grid every HRRR CONUS file is on, as the message states it.
    fn hrrr() -> Lambert {
        read_message(MASSDEN).expect("the fixture decodes").0
    }

    fn haversine_km(a: (f64, f64), b: (f64, f64)) -> f64 {
        let (lon1, lat1) = (a.0.to_radians(), a.1.to_radians());
        let (lon2, lat2) = (b.0.to_radians(), b.1.to_radians());
        let h = ((lat2 - lat1) / 2.0).sin().powi(2)
            + lat1.cos() * lat2.cos() * ((lon2 - lon1) / 2.0).sin().powi(2);
        2.0 * EARTH_RADIUS_M / 1000.0 * h.sqrt().asin()
    }

    #[test]
    fn reads_the_grid_the_message_states() {
        let grid = hrrr();
        assert_eq!((grid.nx, grid.ny), (1799, 1059));
        assert!((grid.dx - 3000.0).abs() < 1e-9 && (grid.dy - 3000.0).abs() < 1e-9);
        // The first point is where the message says it is, by construction,
        // and the inverse gives it back.
        let (lon, lat) = grid.lon_lat(0.0, 0.0);
        assert!((lat - 21.138123).abs() < 1e-6, "first latitude {lat}");
        assert!((lon + 122.719528).abs() < 1e-6, "first longitude {lon}");
    }

    #[test]
    fn the_central_meridian_runs_straight_up_the_cone() {
        // Along the meridian the cone is cut on, theta is zero, so every row
        // crosses it at the same longitude. That is true of the projection
        // whatever anybody remembers about the grid, which is what makes it
        // worth holding: it checks n, F and the origin without a second copy
        // of the numbers they were derived from.
        let grid = hrrr();
        let i0 = -grid.x1 / grid.dx;
        let mut last_lat = -90.0;
        for j in [0.0, 250.0, 529.0, 800.0, 1058.0] {
            let (lon, lat) = grid.lon_lat(i0, j);
            assert!((lon + 97.5).abs() < 1e-6, "row {j} crosses at {lon}");
            assert!(lat > last_lat, "latitude has to climb with j");
            last_lat = lat;
        }
    }

    #[test]
    fn three_kilometres_between_points_on_the_true_scale_parallel() {
        // A conformal cone is true to scale on its standard parallel and
        // stretches away from it. So the spacing is exactly three kilometres
        // on the row nearest 38.5N and a few percent off at the grid's edges.
        let grid = hrrr();
        let i0 = -grid.x1 / grid.dx;
        let (mut nearest, mut gap) = (0usize, f64::MAX);
        for j in 0..grid.ny {
            let (_, lat) = grid.lon_lat(i0, j as f64);
            if (lat - 38.5).abs() < gap {
                gap = (lat - 38.5).abs();
                nearest = j;
            }
        }
        assert!(
            gap < 0.02,
            "no row near the parallel, closest {gap} degrees"
        );
        for i in [100.0, 899.0, 1700.0] {
            let step = haversine_km(
                grid.lon_lat(i, nearest as f64),
                grid.lon_lat(i + 1.0, nearest as f64),
            );
            assert!((step - 3.0).abs() < 0.006, "spacing {step} km at i {i}");
        }
        // Away from the parallel the projection is stretched, so three
        // kilometres on the cone is less on the ground: the southern edge at
        // 21N gets about 2.91 km between points.
        let south = haversine_km(grid.lon_lat(899.0, 0.0), grid.lon_lat(900.0, 0.0));
        assert!(south > 2.85 && south < 2.95, "southern spacing {south} km");
    }

    #[test]
    fn a_place_comes_back_from_the_index_it_was_sent_to() {
        let grid = hrrr();
        for (i, j) in [
            (0.0, 0.0),
            (1798.0, 1058.0),
            (899.5, 529.5),
            (12.25, 1000.75),
        ] {
            let (lon, lat) = grid.lon_lat(i, j);
            let (back_i, back_j) = grid.grid(lat, lon);
            assert!((back_i - i).abs() < 1e-6 && (back_j - j).abs() < 1e-6);
        }
        // Somewhere the grid does not reach comes back outside it rather
        // than clamped onto an edge.
        let (i, j) = grid.grid(60.0, -150.0);
        assert!(
            i < 0.0 || j >= grid.ny as f64,
            "Anchorage landed at {i}, {j}"
        );
    }

    #[test]
    fn the_grid_covers_the_lower_forty_eight_and_not_the_pole() {
        let [west, south, east, north] = hrrr().bounds();
        // The published corners are 21.138N 122.720W and 47.842N 60.919W
        // (wgrib2 prints them for every HRRR file); the box's east and the
        // corner's latitude land on them, which is the projection agreeing
        // with the people who defined the grid.
        assert!(west < -134.0 && west > -135.0, "west {west}");
        assert!((east + 60.9187).abs() < 0.01, "east {east}");
        assert!((south - 21.1).abs() < 0.1, "south {south}");
        // The top edge is an arc, so the box reaches further north than the
        // corners do: 47.8 at the corners, past 52 in the middle.
        assert!(north > 52.0 && north < 53.0, "north {north}");
        let (_, corner) = hrrr().lon_lat(1798.0, 1058.0);
        assert!(
            (corner - 47.8424).abs() < 0.01,
            "north-east corner {corner}"
        );
    }

    #[test]
    fn decodes_a_real_hour_of_smoke() {
        let (grid, values) = read_message(MASSDEN).expect("the fixture decodes");
        assert_eq!(values.len(), grid.nx * grid.ny);
        assert!(values
            .iter()
            .all(|value| value.is_finite() && *value >= 0.0));
        let max = values.iter().copied().fold(0.0f32, f32::max);
        // A September afternoon in fire season: smoke somewhere, in amounts
        // a person could measure, and nowhere that reads as a decode error.
        assert!(
            max > 5.0 && max < 5000.0,
            "the worst gate reads {max} ug/m3"
        );
        let smoky = values
            .iter()
            .filter(|value| **value >= CLEAR_BELOW_UGM3)
            .count();
        assert!(smoky > 1000, "only {smoky} gates hold smoke");
        assert!(
            smoky < values.len() / 2,
            "{smoky} gates hold smoke, which is the whole country"
        );
    }

    #[test]
    fn paints_the_field_where_the_grid_is_and_clear_where_it_is_not() {
        let (grid, values) = read_message(MASSDEN).expect("the fixture decodes");
        let picture = to_image(&values, &grid, 600).expect("paints");
        assert_eq!(picture.columns, 600);
        let fine = to_image(&values, &grid, OUTPUT_COLUMNS).expect("paints at full size");
        // Mercator rows for the box. The lower forty-eight are wider than
        // they are tall even after Mercator stretches the north: 73 degrees
        // across against 0.70 of Mercator height comes to about 332 rows for
        // 600 columns.
        assert!(
            picture.rows > 320 && picture.rows < 345,
            "{} rows",
            picture.rows
        );
        assert_eq!(picture.pixels.len(), picture.columns * picture.rows * 4);
        let max = values.iter().copied().fold(0.0f32, f32::max);
        assert!((picture.max_ugm3 - max).abs() < 1e-6);

        let alpha =
            |column: usize, row: usize| picture.pixels[(row * picture.columns + column) * 4 + 3];
        // The corners of the box are off the cone's grid, so nothing is
        // painted there even if the model had smoke at its own corner.
        assert_eq!(alpha(0, 0), 0);
        assert_eq!(alpha(picture.columns - 1, 0), 0);

        // The pixel over the heaviest gate is painted from that gate or one
        // beside it. A pixel at this size spans a grid point or two, so the
        // nearest point to its centre can be a neighbour; what must hold is
        // that the sampler lands within one step of where the gate is, which
        // is the projection and the row spacing agreeing with each other.
        let worst = values
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(at, _)| at)
            .unwrap();
        let (gi, gj) = ((worst % grid.nx) as i64, (worst / grid.nx) as i64);
        let (lon, lat) = grid.lon_lat(gi as f64, gj as f64);
        let [west, south, east, north] = fine.bounds;
        let column = ((lon - west) / (east - west) * fine.columns as f64) as usize;
        let row = ((mercator(north) - mercator(lat)) / (mercator(north) - mercator(south))
            * fine.rows as f64) as usize;
        let at = (row * fine.columns + column) * 4;
        let painted = &fine.pixels[at..at + 4];
        let nearby: Vec<[u8; 4]> = (-1..=1)
            .flat_map(|dj| (-1..=1).map(move |di| (di, dj)))
            .filter_map(|(di, dj)| {
                let (i, j) = (gi + di, gj + dj);
                (i >= 0 && j >= 0 && i < grid.nx as i64 && j < grid.ny as i64)
                    .then(|| colour(values[(j * grid.nx as i64 + i) as usize]))
            })
            .collect();
        assert!(
            nearby.iter().any(|shade| shade == painted),
            "the pixel over the heaviest gate holds {painted:?}, which no gate within a step of it wears"
        );
        assert!(painted[3] > 0, "the pixel over the heaviest gate is clear");

        let painted = (0..picture.rows)
            .flat_map(|row| (0..picture.columns).map(move |column| (column, row)))
            .filter(|(column, row)| alpha(*column, *row) > 0)
            .count();
        assert!(painted > 100, "{painted} pixels painted");
    }

    #[test]
    fn the_scale_darkens_as_the_air_gets_worse() {
        // The order has to survive any eye, so it is carried by lightness:
        // every step is darker than the one before it.
        let reversed: Vec<(f32, [u8; 3])> =
            RAMP.iter().rev().map(|(at, rgb, _)| (*at, *rgb)).collect();
        assert!(
            lightness_climbs(&reversed, 0.5),
            "a step gets lighter as the number rises"
        );
        let forward: Vec<(f32, [u8; 3])> = RAMP.iter().map(|(at, rgb, _)| (*at, *rgb)).collect();
        for vision in EVERY_VISION {
            let closest = closest_neighbours(&forward, vision);
            assert!(
                closest >= 10.0,
                "two neighbouring steps are {closest:.1} apart under {}",
                vision.name()
            );
        }
        // Faint smoke is drawn faint, and the alpha climbs with the number.
        assert!(RAMP.windows(2).all(|pair| pair[1].2 > pair[0].2));
    }

    #[test]
    fn clear_air_is_left_clear() {
        assert_eq!(colour(0.0), [0, 0, 0, 0]);
        assert_eq!(colour(2.9), [0, 0, 0, 0]);
        assert_eq!(colour(3.0)[3], RAMP[0].2);
        assert_eq!(colour(12.0)[..3], RAMP[1].1);
        assert_eq!(colour(1e6)[..3], RAMP[5].1);
        assert_eq!(colour(f32::NAN), [0, 0, 0, 0]);
    }

    #[test]
    fn asks_the_cycles_that_can_answer_an_hour() {
        let at = |h: u32| {
            chrono::NaiveDate::from_ymd_opt(2026, 9, 1)
                .unwrap()
                .and_hms_opt(h, 0, 0)
                .unwrap()
                .and_utc()
        };
        // No preference: the newest cycle that has had an hour to publish,
        // then the three before it, each reaching the hour with more lead.
        let runs = candidate_runs(at(20), None);
        assert_eq!(
            runs,
            vec![(at(19), 1), (at(18), 2), (at(17), 3), (at(16), 4)]
        );
        // The reflectivity tail is drawn from 17Z, so start there.
        let runs = candidate_runs(at(20), Some(at(17)));
        assert_eq!(runs[0], (at(17), 3));
        assert_eq!(runs.len(), 4);
        // A preference newer than the cycle that could have published is not
        // taken at its word.
        assert_eq!(candidate_runs(at(20), Some(at(19)))[0], (at(19), 1));
        // Past eighteen hours nothing can answer.
        let far = at(20) + Duration::hours(30);
        assert!(candidate_runs(far, Some(at(20))).is_empty());
    }

    #[test]
    fn names_the_files_a_cycle_publishes() {
        let init = chrono::NaiveDate::from_ymd_opt(2026, 9, 1)
            .unwrap()
            .and_hms_opt(17, 0, 0)
            .unwrap()
            .and_utc();
        assert_eq!(
            index_url(init, 1),
            "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20260901/conus/hrrr.t17z.wrfsfcf01.grib2.idx"
        );
        assert_eq!(
            field_url(init, 12),
            "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20260901/conus/hrrr.t17z.wrfsfcf12.grib2"
        );
    }

    #[test]
    fn refuses_a_grid_it_cannot_draw() {
        // Section 3 of the fixture, with one number changed at a time.
        let section = {
            let mut at = 16usize;
            loop {
                let length = be_u32(&MASSDEN[at..at + 4]) as usize;
                if MASSDEN[at + 4] == 3 {
                    break MASSDEN[at..at + length].to_vec();
                }
                at += length;
            }
        };
        assert!(parse_grid(&section).is_ok());

        let mut latlon = section.clone();
        latlon[12..14].copy_from_slice(&0u16.to_be_bytes());
        assert!(matches!(
            parse_grid(&latlon),
            Err(HrrrError::Unsupported(_))
        ));

        let mut backwards = section.clone();
        backwards[14 + 50] = 0x00;
        assert!(matches!(
            parse_grid(&backwards),
            Err(HrrrError::Unsupported(_))
        ));

        let mut miscounted = section.clone();
        miscounted[6..10].copy_from_slice(&7u32.to_be_bytes());
        assert!(matches!(parse_grid(&miscounted), Err(HrrrError::Decode(_))));

        assert!(parse_grid(&section[..40]).is_err());
        assert!(read_message(b"not a grib file").is_err());
    }

    #[test]
    fn a_grid_definition_of_any_bytes_never_panics() {
        // Every grid comes off the network. The template check refuses most
        // of these; what matters is that the ones it lets through fail by
        // returning rather than by dividing by zero or indexing past an end.
        let mut state = 0x2545_f491_4f6c_dd1du64;
        let mut accepted = 0;
        for _ in 0..4000 {
            let mut section = vec![0u8; 81];
            for byte in section.iter_mut() {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                *byte = (state >> 24) as u8;
            }
            section[4] = 3;
            section[12..14].copy_from_slice(&30u16.to_be_bytes());
            section[14] = 6;
            section[14 + 50] = 0x40;
            section[14 + 49] = 0;
            // A small grid whose point count agrees with its shape, so the
            // arithmetic behind the count guard is what gets exercised.
            let nx = 2 + u32::from(section[14 + 16] % 40);
            let ny = 2 + u32::from(section[14 + 20] % 40);
            section[14 + 16..14 + 20].copy_from_slice(&nx.to_be_bytes());
            section[14 + 20..14 + 24].copy_from_slice(&ny.to_be_bytes());
            section[6..10].copy_from_slice(&(nx * ny).to_be_bytes());
            if let Ok(grid) = parse_grid(&section) {
                accepted += 1;
                let _ = grid.bounds();
                let _ = grid.grid(40.0, -100.0);
            }
        }
        assert!(
            accepted > 0,
            "the guards refused every grid, so nothing behind them ran"
        );
    }

    /// Talks to NOAA, so it is ignored with the other live tests.
    #[test]
    #[ignore = "fetches a live smoke field from the HRRR bucket"]
    fn fetches_a_live_hour_of_smoke() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let valid = floor_hour(Utc::now() + Duration::hours(2)).to_rfc3339();
        let started = std::time::Instant::now();
        let field = runtime
            .block_on(hrrr_smoke(valid.clone(), None))
            .expect("HRRR publishes every hour");
        let took = started.elapsed();
        assert_eq!(field.valid, valid);
        assert!((1..=MAX_LEAD_HOURS).contains(&field.lead_hours));
        assert_eq!(field.columns, OUTPUT_COLUMNS);
        assert!(field.image.starts_with("data:image/png;base64,"));
        assert!(field.west < -130.0 && field.east > -65.0);
        assert!(field.max_ugm3 >= 0.0 && field.max_ugm3 < 10_000.0);
        println!(
            "{} +{} h, {} by {}, worst {:.1} ug/m3, {} bytes, in {took:?}",
            field.init,
            field.lead_hours,
            field.columns,
            field.rows,
            field.max_ugm3,
            field.image.len()
        );
        // The picture itself, for looking at: set OPENRADAR_SMOKE_PNG to a
        // path and the PNG is written there.
        if let Ok(path) = std::env::var("OPENRADAR_SMOKE_PNG") {
            let encoded = field.image.trim_start_matches("data:image/png;base64,");
            let png = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
                .expect("the data URL holds base64");
            std::fs::write(&path, png).expect("the PNG can be written");
            println!("wrote {path}");
        }
        // And the second ask is answered from memory.
        let again = runtime
            .block_on(hrrr_smoke(valid, None))
            .expect("the cache answers");
        assert_eq!(again.init, field.init);
    }
}

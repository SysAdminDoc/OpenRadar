//! The readings themselves, out of the app and into somebody else's tool.
//!
//! Everything the app exports today is a picture: a PNG, a GIF, a WebM. A
//! picture communicates, but a colour is a lossy account of a number, and
//! nobody can take a screenshot into a rain gauge comparison, a case study or
//! a thesis. NOAA's own Weather and Climate Toolkit exists because that gap
//! matters, and this is the same idea in the app that drew the picture.
//!
//! Two shapes of radar data, because they are not the same problem:
//!
//!   * A **polar** sweep is a fan of gates at azimuths and ranges. Putting it
//!     on a regular grid means resampling, which is exactly the loss this is
//!     supposed to avoid, so it goes out as CSV with one row per gate and its
//!     own geometry in the header. Every reader on earth opens a CSV.
//!   * A **grid** is already a raster, so it goes out as a single-band float
//!     GeoTIFF that QGIS, GDAL, rasterio and ArcGIS open directly, with NaN
//!     for the cells that hold nothing.
//!
//! Both carry a JSON sidecar naming the source, the observed time, the units,
//! the missing-value rule and the derivation. Colour is not involved anywhere:
//! a loaded colour table and the high contrast ramps change what a reader
//! sees, not what the radar measured, and neither reaches this file. Display
//! thresholds are the same and are recorded as not applied. What does travel
//! is derivation that changes the numbers, unfolding and storm relative
//! motion, because a value that has had a wind subtracted is a different
//! reading and the file has to say so.

use std::path::{Path, PathBuf};

use chrono::{DateTime, SecondsFormat, Utc};
use nexrad_model::data::GateStatus;
use nexrad_model::geo::RadarCoordinateSystem;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use tauri::AppHandle;

use crate::exports;
use crate::geotiff;
use crate::level2::{self, Level2Error};
use crate::mrms;

/// The app's own version, for the provenance sidecar.
const APP: &str = concat!("OpenRadar ", env!("CARGO_PKG_VERSION"));

/// The readings, which a spreadsheet opens.
const CSV_EXTENSION: &str = "csv";

/// The grid, which is a single-band float raster.
const GEOTIFF_EXTENSION: &str = "tif";

/// An Archive II volume, saved as the bucket published it.
const VOLUME_EXTENSION: &str = "ar2v";

/// A Level III product, which is what a terminal radar publishes instead.
const LEVEL3_EXTENSION: &str = "nids";

/// Every kind of file this module writes, and the one place it is written
/// down.
///
/// This module builds its own names and writes through `write_atomically`, so
/// `save_export`'s allowlist never sees them and the test named for every file
/// this app writes was true of the other writer alone. This list is what
/// `every_name_this_module_writes_is_one_the_app_allows` reads, so a new kind
/// of export here fails that test until it is allowed there too. Nothing that
/// ships reads it, because a writer names its own kind of file rather than
/// picking one out of a list by position.
#[cfg(test)]
const EXTENSIONS: &[&str] = &[
    CSV_EXTENSION,
    GEOTIFF_EXTENSION,
    VOLUME_EXTENSION,
    LEVEL3_EXTENSION,
];

/// How many gates one CSV may hold.
///
/// A full 0.5 degree reflectivity cut is 720 azimuths by 1832 gates, and only
/// the gates that measured something are written, so a wall-to-wall storm
/// lands around a million rows and 60 MB. The cap is above that and well below
/// anything a spreadsheet or a text editor will not open.
const MAX_ROWS: usize = 4_000_000;

/// How many cells one GeoTIFF may hold, at four bytes each.
///
/// The MRMS grid is a hundredth of a degree, so this is a view about twenty
/// degrees on a side. Beyond that the answer is to zoom in rather than to
/// write a hundred megabyte raster nobody asked for.
const MAX_CELLS: usize = 4_000_000;

#[derive(Debug, thiserror::Error)]
pub enum DataExportError {
    #[error("{0}")]
    Sweep(#[from] Level2Error),
    #[error("{0}")]
    Grid(#[from] mrms::MrmsError),
    #[error("that grid could not be decoded, so there is nothing to write")]
    NotDrawn,
    #[error("there is no product called {0}")]
    NoProduct(String),
    #[error("the view holds no part of this grid")]
    NothingInView,
    #[error("that export would hold {0} readings, which is more than one file should")]
    TooLarge(usize),
    #[error("there is nowhere to write the export")]
    NoFolder,
    #[error("the export could not be written: {0}")]
    Write(String),
    #[error("that is not the name of a volume this app has drawn")]
    NotAVolume,
}

impl DataExportError {
    fn parts(&self) -> (&'static str, Vec<String>) {
        match self {
            // A failure fetching or decoding keeps the radar wording it
            // already has, so the page says the same thing it would have said
            // about the picture.
            Self::Sweep(inner) => inner.parts(),
            Self::Grid(inner) => inner.parts(),
            Self::NotDrawn => ("notDrawn", Vec::new()),
            Self::NoProduct(id) => ("noProduct", vec![id.clone()]),
            Self::NothingInView => ("nothingInView", Vec::new()),
            Self::TooLarge(count) => ("tooLarge", vec![count.to_string()]),
            Self::NoFolder => ("noFolder", Vec::new()),
            Self::Write(why) => ("write", vec![why.clone()]),
            Self::NotAVolume => ("notAVolume", Vec::new()),
        }
    }
}

impl Serialize for DataExportError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, args) = self.parts();
        let mut out = serializer.serialize_struct("DataExportError", 3)?;
        out.serialize_field("code", code)?;
        out.serialize_field("args", &args)?;
        out.serialize_field("text", &self.to_string())?;
        out.end()
    }
}

/// Which sweep to write, named the way the picture on screen was asked for.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepDataRequest {
    pub station: String,
    pub product: String,
    pub tilt: usize,
    #[serde(default)]
    pub dealias: bool,
    #[serde(default)]
    pub motion: Option<(f32, f32)>,
    /// An archive moment, when the picture is a replay rather than the latest.
    #[serde(default)]
    pub at: Option<String>,
    /// A volume the reader opened off their own disk.
    #[serde(default)]
    pub path: Option<String>,
}

/// Which volume to save, by the name the bucket published it under.
///
/// The key rather than a station and a moment, because the key is what the
/// picture on screen already carries and it names one object exactly: asking
/// for "the newest volume at KDMX" a minute after drawing one can answer with
/// a different file, and a copy of a volume that is not the volume on screen
/// is the one thing this is for.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeFileRequest {
    pub station: String,
    pub volume: String,
}

/// Which grid to write, and the corner of the world to cut it to.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridDataRequest {
    pub product: String,
    /// Seconds since the epoch, as the timeline holds them.
    pub time: i64,
    #[serde(default)]
    pub domain: Option<String>,
    /// Which height of the merged grid, for the three products published at
    /// more than one. Absent for every other product, and for a stale request
    /// that predates the height being askable.
    #[serde(default)]
    pub level: Option<String>,
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

/// What was written, for the page to say so.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataExportReport {
    /// The data file, and the sidecar beside it.
    pub path: String,
    pub sidecar: String,
    pub bytes: u64,
    /// Rows for a CSV, cells for a raster.
    pub readings: usize,
    /// Gates left out because they measured nothing, for a polar export. A
    /// gate is never left out for any other reason: an export too big to
    /// write is refused rather than truncated.
    pub omitted: usize,
    pub sha256: String,
}

/// The sidecar: everything needed to know what the numbers are.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Provenance {
    format: &'static str,
    format_version: u32,
    application: &'static str,
    written_at: String,
    data_file: String,
    sha256: String,
    /// `polar`, `grid`, or `volume` for the source object saved unmodified.
    kind: &'static str,
    /// Absent on a saved volume, which holds every product the radar
    /// collected rather than the one that was on screen.
    #[serde(skip_serializing_if = "Option::is_none")]
    product: Option<ProvenanceProduct>,
    /// The bucket object this file is a byte-for-byte copy of. Absent on an
    /// export the app computed from one.
    #[serde(skip_serializing_if = "Option::is_none")]
    object: Option<ProvenanceObject>,
    /// When the radar collected it, not when it was fetched.
    observed: Option<String>,
    source: ProvenanceSource,
    geometry: serde_json::Value,
    coordinate_reference: &'static str,
    /// What was done to the readings between the radar and the file. Empty
    /// when they are as measured.
    derivation: Vec<String>,
    /// How a reading that is not there is written, in words.
    missing: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceProduct {
    id: String,
    label: String,
    unit: String,
}

/// Where the bytes came from, said precisely enough to fetch them again.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceObject {
    bucket: String,
    key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceSource {
    kind: &'static str,
    label: String,
    url: Option<String>,
}

fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// What goes on the end of a data file's name to make its sidecar's.
///
/// A constant because two places have to agree about it: the writer, and the
/// test that holds every name this module writes. The sidecar is the one
/// write here that does not go through `sanitize_file_name`, and it cannot:
/// it carries two dots on purpose and that guard turns the inner one into a
/// dash. What makes it safe is that it is a name already checked plus a
/// suffix with nothing in it a path could use, and that is what the test
/// checks rather than an argument in a comment.
const SIDECAR_SUFFIX: &str = ".provenance.json";

fn sha256_hex(bytes: &[u8]) -> String {
    crate::hex::lower(&Sha256::digest(bytes))
}

/// A file name that is the same shape every time and safe on every disk.
fn file_name(parts: &[&str], extension: &str) -> String {
    let stem: Vec<String> = parts
        .iter()
        .map(|part| {
            part.chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() {
                        c.to_ascii_lowercase()
                    } else {
                        '-'
                    }
                })
                .collect::<String>()
                .trim_matches('-')
                .to_string()
        })
        .filter(|part| !part.is_empty())
        .collect();
    format!("openradar-{}.{extension}", stem.join("-"))
}

/// The moment a reading was taken, in the shape a file name wants.
///
/// Not `stamp`, which writes the same moment as RFC 3339 for the provenance
/// sidecar. A colon is fine in JSON and is not allowed in a file name.
fn named_moment(at: Option<DateTime<Utc>>) -> String {
    at.map(|at| at.format("%Y%m%d-%H%M%S").to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// What one sweep's readings are saved as.
///
/// Named rather than built inline at the call site, so which extension goes on
/// which export is something a test can ask directly. The two used to be read
/// out of one array by index, and swapping the array's two entries, which
/// makes every CSV export write a `.tif` and every raster write a `.csv`, left
/// the whole suite green.
fn sweep_file_name(station: &str, product: &str, collected: Option<DateTime<Utc>>) -> String {
    file_name(&[station, product, &named_moment(collected)], CSV_EXTENSION)
}

/// What one grid is saved as.
fn grid_file_name(product: &str, at: i64) -> String {
    file_name(
        &[product, &named_moment(DateTime::from_timestamp(at, 0))],
        GEOTIFF_EXTENSION,
    )
}

/// One sweep as CSV: a header of everything needed to place the numbers, then
/// a row per gate that measured something.
///
/// Gates below the radar's detection threshold and gates with no data are left
/// out rather than written as blanks. They are the great majority of a cut,
/// they carry no reading, and the header says how many there were and what the
/// geometry is, so the full array can still be rebuilt from the indices. A
/// range folded gate is written, with an empty value and its status, because
/// "the velocity here is ambiguous" is a measurement and not an absence.
fn polar_csv(
    values: &level2::SweepValues,
    written_at: DateTime<Utc>,
) -> Result<(String, usize, usize), DataExportError> {
    polar_csv_capped(values, written_at, MAX_ROWS)
}

/// The same, with the cap as an argument.
///
/// A test cannot build four million gates in any reasonable time, and a
/// refusal nothing exercises is a refusal that quietly becomes a truncation
/// again. The cap is the only thing that moves.
fn polar_csv_capped(
    values: &level2::SweepValues,
    written_at: DateTime<Utc>,
    max_rows: usize,
) -> Result<(String, usize, usize), DataExportError> {
    let field = &values.field;
    let coordinates = RadarCoordinateSystem::new(&values.site);
    let azimuths = field.azimuths();
    let first_km = field.first_gate_range_km();
    let interval_km = field.gate_interval_km();
    let elevation = field.elevation_degrees();

    let mut derivation: Vec<String> = Vec::new();
    if values.dealiased {
        derivation.push("velocity unfolded past the radar's Nyquist limit".to_string());
    }
    if let Some(line) = values.derivation.clone() {
        derivation.push(line);
    }
    if let Some(motion) = values.storm_motion {
        derivation.push(format!(
            "storm motion of {:.1} m/s from {:.0} degrees subtracted",
            motion.speed_ms, motion.from_degrees
        ));
    }
    let derivation = if derivation.is_empty() {
        "none; these are the readings as decoded".to_string()
    } else {
        derivation.join("; ")
    };

    let mut out = String::with_capacity(1024 + field.azimuth_count() * 64);
    let mut header = |line: String| {
        out.push_str("# ");
        out.push_str(&line);
        out.push('\n');
    };
    header("OpenRadar radar data export".to_string());
    header("format: openradar-polar-csv/1".to_string());
    header(format!(
        "station: {} ({})",
        values.station, values.site_name
    ));
    header(format!("radar: {}", values.radar));
    header(format!(
        "product: {} [{}]",
        values.product, values.product_id
    ));
    header(format!("unit: {}", values.unit));
    header(format!("elevation_degrees: {elevation:.2}"));
    header(format!(
        "collected: {}",
        values
            .collected
            .map(stamp)
            .unwrap_or_else(|| "unknown".to_string())
    ));
    header(format!("volume: {}", values.volume));
    header(format!("site_latitude: {:.4}", coordinates.latitude()));
    header(format!("site_longitude: {:.4}", coordinates.longitude()));
    header(format!(
        "antenna_height_m: {:.1}",
        coordinates.antenna_height_meters()
    ));
    header(format!("azimuth_count: {}", field.azimuth_count()));
    header(format!("gate_count: {}", field.gate_count()));
    header(format!("first_gate_km: {first_km}"));
    header(format!("gate_interval_km: {interval_km}"));
    header(format!("derivation: {derivation}"));
    header("display_threshold: not applied; every gate the radar reported is here".to_string());
    header(
        "geometry: gate centres by the 4/3 effective earth radius beam model; \
         latitude and longitude in degrees on WGS 84, height in metres above sea level"
            .to_string(),
    );
    header(
        "missing: gates below the detection threshold and gates with no data are not \
         written; a range folded gate is written with an empty value and status rangeFolded"
            .to_string(),
    );

    let mut rows = String::new();
    let mut written = 0usize;
    let mut omitted = 0usize;
    for (azimuth_index, azimuth) in azimuths.iter().enumerate() {
        for gate_index in 0..field.gate_count() {
            let (value, status) = field.get(azimuth_index, gate_index);
            let status_name = match status {
                GateStatus::Valid => "value",
                GateStatus::RangeFolded => "rangeFolded",
                GateStatus::BelowThreshold | GateStatus::NoData => {
                    omitted += 1;
                    continue;
                }
            };
            if written >= max_rows {
                // Refused rather than truncated: a file that quietly stops at
                // four million rows is a file whose last row is a lie about
                // where the storm ended.
                // The whole cut rather than the row it stopped on: a
                // reader deciding whether to zoom in needs to know how much
                // there is, not where the cap fell.
                return Err(DataExportError::TooLarge(
                    field.azimuth_count() * field.gate_count(),
                ));
            }
            let at =
                coordinates.gate_location(*azimuth, elevation, gate_index, first_km, interval_km);
            let range_km = first_km + gate_index as f64 * interval_km;
            let reading = match status {
                GateStatus::Valid => format!("{value}"),
                _ => String::new(),
            };
            rows.push_str(&format!(
                "{azimuth_index},{gate_index},{azimuth:.2},{range_km:.4},{:.6},{:.6},{:.1},{reading},{status_name}\n",
                at.latitude, at.longitude, at.altitude_meters
            ));
            written += 1;
        }
    }

    header(format!(
        "gates_written: {written} of {}",
        field.azimuth_count() * field.gate_count()
    ));
    header(format!("written: {} by {APP}", stamp(written_at)));
    out.push_str(
        "azimuth_index,gate_index,azimuth_deg,range_km,latitude,longitude,height_m,value,status\n",
    );
    out.push_str(&rows);
    Ok((out, written, omitted))
}

/// Writes a data file and its sidecar, and says what landed where.
fn write_pair(
    folder: &Path,
    name: String,
    data: &[u8],
    mut provenance: Provenance,
    readings: usize,
    omitted: usize,
) -> Result<DataExportReport, DataExportError> {
    // Held to the whole of the guard a name from the page is held to, rather
    // than to the extension half of it. This module writes through
    // `write_atomically`, which checks nothing, so nothing was holding these
    // names to anything at all until the extension check went in; and the
    // extension check on its own rested on an argument about its callers
    // instead of on a property of the name. The argument was wrong.
    // `volume_file_name` keeps the bucket's own object name and puts nothing
    // in front of it, so a key of `2026/CON` produced `CON.ar2v`, which is a
    // DOS device on Windows whatever folder it is written in.
    //
    // Asked as a comparison rather than by calling it for its answer, because
    // rewriting a name here would be a file quietly saved under a name nobody
    // asked for. A name this would have to change is refused instead.
    match exports::sanitize_file_name(&name) {
        Ok(safe) if safe == name => {}
        _ => {
            return Err(DataExportError::Write(format!(
                "{name} is not a name this app writes"
            )))
        }
    }
    let checksum = sha256_hex(data);
    provenance.data_file = name.clone();
    provenance.sha256 = checksum.clone();
    let sidecar_name = format!("{name}{SIDECAR_SUFFIX}");
    let sidecar = serde_json::to_vec_pretty(&provenance)
        .map_err(|error| DataExportError::Write(error.to_string()))?;

    let target = folder.join(&name);
    exports::write_atomically(&target, data)
        .map_err(|error| DataExportError::Write(error.to_string()))?;
    let beside = folder.join(&sidecar_name);
    if let Err(error) = exports::write_atomically(&beside, &sidecar) {
        // Numbers with nothing beside them saying what they are is the one
        // outcome this whole module exists to prevent, and the page has
        // already been told the export failed. Take the data file back out.
        let _ = std::fs::remove_file(&target);
        return Err(DataExportError::Write(error.to_string()));
    }

    Ok(DataExportReport {
        path: target.to_string_lossy().into_owned(),
        sidecar: beside.to_string_lossy().into_owned(),
        bytes: data.len() as u64,
        readings,
        omitted,
        sha256: checksum,
    })
}

/// The gates of one cut, as numbers, with a sidecar saying what they are.
#[tauri::command]
pub async fn export_sweep_data(
    app: AppHandle,
    request: SweepDataRequest,
) -> Result<DataExportReport, DataExportError> {
    let station = request.station.to_uppercase();
    let folder = exports::export_folder(&app).map_err(|_| DataExportError::NoFolder)?;

    let (station, key, data, source) = match &request.path {
        Some(path) => {
            // The label comes from the reader's own volume, which already
            // reduces a path to a file name and falls back to a generic one.
            // Reaching for the path here would put somebody's directory tree
            // in a file they are about to share the moment `file_name` gave
            // nothing back.
            let (station, key, label, data) =
                level2::local_volume_for_export(&PathBuf::from(path))?;
            (
                station,
                key,
                data,
                ProvenanceSource {
                    kind: "local",
                    label,
                    url: None,
                },
            )
        }
        None => {
            let at = match &request.at {
                Some(at) => Some(
                    DateTime::parse_from_rfc3339(at)
                        .map_err(|_| Level2Error::InvalidTime(at.clone()))?
                        .with_timezone(&Utc),
                ),
                None => None,
            };
            let source = if at.is_some() {
                ProvenanceSource {
                    kind: "archive",
                    label: "NOAA NEXRAD Level II archive".to_string(),
                    url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
                }
            } else {
                ProvenanceSource {
                    kind: "live",
                    label: "NOAA NEXRAD Level II".to_string(),
                    url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
                }
            };
            let (key, data) = level2::volume_for_export(&station, at).await?;
            (station, key, data, source)
        }
    };

    let product = request.product.clone();
    let tilt = request.tilt;
    let dealias = request.dealias;
    let motion = request.motion;
    // Decoding a volume and walking a million gates is CPU work, and it must
    // not sit on the async runtime while it happens.
    let (values, written_at) = tauri::async_runtime::spawn_blocking(move || {
        let asked = level2::export_request(&product, tilt, dealias, motion);
        level2::sweep_values(&station, &key, data, asked).map(|values| (values, Utc::now()))
    })
    .await
    .map_err(|error| DataExportError::Write(error.to_string()))??;

    let (csv, written, omitted) = polar_csv(&values, written_at)?;
    let name = sweep_file_name(&values.station, &values.product_id, values.collected);

    let provenance = polar_provenance(&values, written_at, source);

    write_pair(&folder, name, csv.as_bytes(), provenance, written, omitted)
}

/// What the sidecar says about one sweep.
///
/// Its own function so a test can read it. A sidecar that quietly said the
/// fetch time was the observed time, or named the wrong source, would pass
/// every check that only looks at the numbers beside it.
fn polar_provenance(
    values: &level2::SweepValues,
    written_at: DateTime<Utc>,
    source: ProvenanceSource,
) -> Provenance {
    let field = &values.field;
    Provenance {
        format: "openradar-data-provenance",
        format_version: 1,
        application: APP,
        written_at: stamp(written_at),
        data_file: String::new(),
        sha256: String::new(),
        kind: "polar",
        product: Some(ProvenanceProduct {
            id: values.product_id.clone(),
            label: values.product.to_string(),
            unit: values.unit.to_string(),
        }),
        object: None,
        observed: values.collected.map(stamp),
        source,
        geometry: serde_json::json!({
            "station": values.station,
            "siteName": values.site_name,
            "radar": values.radar,
            "siteLatitude": values.site.latitude(),
            "siteLongitude": values.site.longitude(),
            // The height the beam model works from, which is the ground plus
            // the tower. The CSV header says the same number under the same
            // name: anyone recomputing a gate's height from the sidecar has to
            // land on the height column beside it.
            "antennaHeightMeters": RadarCoordinateSystem::new(&values.site)
                .antenna_height_meters(),
            "siteGroundHeightMeters": values.site.height_meters(),
            "elevationDegrees": field.elevation_degrees(),
            "azimuthCount": field.azimuth_count(),
            "gateCount": field.gate_count(),
            "firstGateRangeKm": field.first_gate_range_km(),
            "gateIntervalKm": field.gate_interval_km(),
            "beamModel": "4/3 effective earth radius",
        }),
        coordinate_reference: "EPSG:4326",
        derivation: {
            let mut done = Vec::new();
            if values.dealiased {
                done.push("velocity unfolded past the radar's Nyquist limit".to_string());
            }
            if let Some(motion) = values.storm_motion {
                done.push(format!(
                    "storm motion of {:.1} m/s from {:.0} degrees subtracted",
                    motion.speed_ms, motion.from_degrees
                ));
            }
            done
        },
        missing: "gates below the detection threshold and gates with no data are omitted; \
                  a range folded gate has an empty value and status rangeFolded"
            .to_string(),
    }
}

/// Whether a name is a bucket key and nothing else.
///
/// The page hands over the key of the picture it is looking at, and a key is
/// half a URL: a name carrying a query, a fragment or a parent reference would
/// be fetched and written to disk as a volume. Only the characters the two
/// buckets actually use, which is letters, digits, dashes and underscores in
/// segments separated by slashes.
///
/// A dot is not among them. Neither bucket puts one in a key, and refusing it
/// outright is what makes a parent reference impossible rather than a case to
/// remember: `..` is not a segment to exclude, it is a segment that cannot be
/// spelled.
fn readable_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 200
        && key.split('/').all(|segment| {
            !segment.is_empty()
                && segment.chars().all(|character| {
                    character.is_ascii_alphanumeric() || character == '_' || character == '-'
                })
        })
}

/// The bucket object's own name, which is the name every other tool that
/// reads one of these expects to be handed.
///
/// Not `file_name`, which writes `openradar-` in front of everything else this
/// module produces. Those are files this app computed and named; this one is
/// somebody else's object saved unaltered, and renaming it loses the station,
/// the collection time and the convention in one go.
fn volume_file_name(key: &str, extension: &str) -> String {
    let stem: String = key
        .rsplit('/')
        .next()
        .unwrap_or(key)
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect();
    format!("{stem}.{extension}")
}

/// When the radar collected what a key names.
///
/// The two buckets stamp their keys differently: an Archive II volume is
/// `KDMX20260830_092159_V06` and a Level III product is
/// `ATL_TZ0_2026_08_30_23_40_12`. Both are the collection time rather than
/// the publication time, which is what the sidecar has to say.
fn key_moment(key: &str) -> Option<DateTime<Utc>> {
    if let Some(at) = level2::key_time(key) {
        return Some(at);
    }
    let name = key.rsplit('/').next()?;
    let stamp = name.get(name.len().checked_sub(19)?..)?;
    chrono::NaiveDateTime::parse_from_str(stamp, "%Y_%m_%d_%H_%M_%S")
        .ok()
        .map(|parsed| parsed.and_utc())
}

/// Which bucket a key names, what to call the file, and what to say about it.
struct Object {
    host: String,
    extension: &'static str,
    source: ProvenanceSource,
}

/// The whole of what a save can get wrong before it touches the network.
///
/// Its own step, and not inline in the command, for the same reason
/// `wanted_grid` is one: a command taking an `AppHandle` cannot be called from
/// a test, so a gate written inside one is a gate nothing can drive. This one
/// decides whether a key names an object at all, and it shipped untested.
fn wanted_object(station: &str, key: &str) -> Result<Object, DataExportError> {
    // An airport's own radar publishes a Level III product at a time under its
    // own name; everything else publishes an Archive II volume.
    if crate::tdwr::is_tdwr(station) {
        return Ok(Object {
            host: format!("https://{}", crate::level3::BUCKET),
            extension: LEVEL3_EXTENSION,
            source: ProvenanceSource {
                kind: "archive",
                label: "NOAA NEXRAD Level III (TDWR)".to_string(),
                url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
            },
        });
    }
    // A partial upload is published under `_MDM` and is not a volume, and the
    // volume the radar is sweeping now arrives as chunks under a numbered
    // folder rather than as an object: a live picture's key is `114`, and
    // this is what refuses it.
    if !(key.ends_with("_V06") || key.ends_with("_V03")) {
        return Err(DataExportError::NotAVolume);
    }
    Ok(Object {
        host: level2::ARCHIVE_HOST.to_string(),
        extension: VOLUME_EXTENSION,
        source: ProvenanceSource {
            kind: "archive",
            label: "NOAA NEXRAD Level II archive".to_string(),
            url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
        },
    })
}

/// The volume behind the picture, saved as the bucket published it.
///
/// A picture, a CSV and a GeoTIFF are all this app's account of what the radar
/// measured. The object itself is the thing a case study is reopened from, in
/// this app or in any other tool that reads the format, and it was the one
/// thing a reader who had found the sweep that matters could not keep.
///
/// The bytes are never touched: what is written is exactly what was fetched,
/// so the file's checksum is the bucket object's checksum and the sidecar can
/// say so.
#[tauri::command]
pub async fn export_volume_file(
    app: AppHandle,
    request: VolumeFileRequest,
) -> Result<DataExportReport, DataExportError> {
    let station = request.station.to_uppercase();
    let key = request.volume;
    if !readable_key(&key) {
        return Err(DataExportError::NotAVolume);
    }
    let folder = exports::export_folder(&app).map_err(|_| DataExportError::NoFolder)?;
    let terminal = crate::tdwr::is_tdwr(&station);
    let Object {
        host,
        extension,
        source,
    } = wanted_object(&station, &key)?;

    // The bytes the picture was drawn from, where they are still held. For a
    // Level II volume that is the ordinary case, and it costs nothing and
    // cannot come back as a different object. A terminal radar's products are
    // not put in that cache by anything, so its save always fetches.
    let bytes = match level2::cached(&key) {
        Some(held) => held,
        None => crate::http::get_bytes(&format!("{host}/{key}"))
            .await
            .map_err(Level2Error::from)?,
    };

    let written_at = Utc::now();
    let provenance = Provenance {
        format: "openradar-data-provenance",
        format_version: 1,
        application: APP,
        written_at: stamp(written_at),
        data_file: String::new(),
        sha256: String::new(),
        kind: "volume",
        product: None,
        object: Some(ProvenanceObject {
            bucket: host.clone(),
            key: key.clone(),
        }),
        observed: key_moment(&key).map(stamp),
        source,
        geometry: serde_json::json!({
            "station": station,
            "radar": if terminal { "TDWR" } else { "WSR-88D" },
        }),
        coordinate_reference: "EPSG:4326",
        derivation: Vec::new(),
        missing: "nothing: the file is the published object, byte for byte".to_string(),
    };

    // No readings and nothing omitted, because nothing was read out of it.
    write_pair(
        &folder,
        volume_file_name(&key, extension),
        &bytes,
        provenance,
        0,
        0,
    )
}

/// Which grid a request names, and where to find it in the bucket.
///
/// Its own step because it is the whole of what an export can get wrong
/// before it touches the network, and because a command taking an `AppHandle`
/// cannot be called from a test.
fn wanted_grid(
    request: &GridDataRequest,
) -> Result<(&'static mrms::MrmsProduct, String), DataExportError> {
    let entry = mrms::product_by_id(&request.product)
        .ok_or_else(|| DataExportError::NoProduct(request.product.clone()))?;
    // A corner that is not a number makes every comparison below false, and
    // the window would come back as one cell rather than as a refusal.
    for corner in [request.west, request.south, request.east, request.north] {
        if !corner.is_finite() {
            return Err(DataExportError::NothingInView);
        }
    }
    if request.west >= request.east || request.south >= request.north {
        return Err(DataExportError::NothingInView);
    }
    // The bucket spells its regions in capitals and `is_domain` is an exact
    // match, so a lower case one here refused every grid on the map by name.
    let domain = request
        .domain
        .clone()
        .unwrap_or_else(|| "CONUS".to_string())
        .to_uppercase();
    let key = mrms::key_for(&domain, entry, request.level.as_deref(), request.time)
        .ok_or_else(|| DataExportError::NoProduct(request.product.clone()))?;
    Ok((entry, key))
}

/// The part of one MRMS grid that is on screen, as a georeferenced raster.
#[tauri::command]
pub async fn export_grid_data(
    app: AppHandle,
    request: GridDataRequest,
) -> Result<DataExportReport, DataExportError> {
    let folder = exports::export_folder(&app).map_err(|_| DataExportError::NoFolder)?;
    let (entry, key) = wanted_grid(&request)?;
    mrms::grid_for(&key, false).await?;

    let written_at = Utc::now();
    // Copying four million cells out from under a global lock, encoding them
    // and hashing sixteen megabytes is CPU work, and it must not sit on the
    // async runtime while every other grid consumer waits behind the cache.
    let label = entry.label.to_string();
    let unit = entry.unit.to_string();
    let (cut, raster) = {
        let key = key.clone();
        let request = request.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let cut = mrms::grid_window(
                &key,
                request.west,
                request.south,
                request.east,
                request.north,
                MAX_CELLS,
            )
            .map_err(|why| match why {
                mrms::WindowError::NotCached => DataExportError::NotDrawn,
                mrms::WindowError::Outside => DataExportError::NothingInView,
                mrms::WindowError::TooLarge(cells) => DataExportError::TooLarge(cells),
            })?;
            let raster = geotiff::write(
                cut.columns,
                cut.rows,
                &cut.values,
                &geotiff::Georeference {
                    west: cut.west,
                    north: cut.north,
                    d_lon: cut.d_lon,
                    d_lat: cut.d_lat,
                    description: label,
                    unit,
                },
                APP,
            );
            Ok::<_, DataExportError>((cut, raster))
        })
        .await
        .map_err(|error| DataExportError::Write(error.to_string()))??
    };

    let name = grid_file_name(&request.product, request.time);

    let provenance = Provenance {
        format: "openradar-data-provenance",
        format_version: 1,
        application: APP,
        written_at: stamp(written_at),
        data_file: String::new(),
        sha256: String::new(),
        kind: "grid",
        product: Some(ProvenanceProduct {
            id: request.product.clone(),
            label: entry.label.to_string(),
            unit: entry.unit.to_string(),
        }),
        object: None,
        observed: DateTime::from_timestamp(request.time, 0).map(stamp),
        source: ProvenanceSource {
            kind: "mrms",
            label: "NOAA Multi-Radar Multi-Sensor".to_string(),
            url: Some("https://mrms.ncep.noaa.gov/".to_string()),
        },
        geometry: serde_json::json!({
            "columns": cut.columns,
            "rows": cut.rows,
            "west": cut.west,
            "north": cut.north,
            "degreesPerColumn": cut.d_lon,
            "degreesPerRow": cut.d_lat,
            "pixelIsArea": true,
            "gridKey": key,
        }),
        coordinate_reference: "EPSG:4326",
        // The floor is a drawing rule, so it is not applied here: what is in
        // the file is what the grid holds.
        derivation: Vec::new(),
        // The raster is clipped to the grid rather than padded out to the
        // view, so a NaN cell does not arise today. The tag is there because a
        // reader has to be told what an empty cell would mean, and because the
        // writer emits one the moment anything does pad.
        missing: "the raster is clipped to the grid's own extent rather than padded to \
                  the view; inside it the values are as decoded, including the codes \
                  MRMS reserves for missing (-999) and for outside radar coverage \
                  (-99), and an empty cell would be NaN, which the GDAL_NODATA tag names"
            .to_string(),
    };

    let cells = cut.columns * cut.rows;
    write_pair(&folder, name, &raster, provenance, cells, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nexrad_model::data::SweepField;
    use nexrad_model::meta::Site;

    /// A grid failure keeps its own code rather than being flattened to the
    /// Display text of a Rust error.
    ///
    /// It used to arrive as `("grid", [inner.to_string()])`, and the
    /// catalogue line for that was a bare `{0}`, so a Spanish reader whose
    /// export failed was handed an English sentence written in this file.
    /// A grid that could not be fetched does not blame the radar archive.
    ///
    /// MRMS comes from its own bucket. Delegating straight to `HttpError`
    /// gave it the `http*` codes, and the page has no `dataExport.error.http*`
    /// family, so it fell through to `radar.error.httpStatus`, which reads
    /// "The radar archive could not be reached." A reader whose grid export
    /// hit a 503 was told the wrong service was down, in three languages.
    #[test]
    fn a_grid_that_would_not_fetch_does_not_blame_the_archive() {
        let (code, args) =
            DataExportError::Grid(mrms::MrmsError::Http(crate::http::HttpError::TooLarge)).parts();
        assert_eq!(code, "gridHttpTooLarge");
        assert!(args.is_empty());

        let (code, _) =
            DataExportError::Grid(mrms::MrmsError::Http(crate::http::HttpError::BadUrl)).parts();
        assert_eq!(code, "gridHttpRefused");

        let (code, _) = DataExportError::Grid(mrms::MrmsError::Http(
            crate::http::HttpError::HostNotAllowed("example.test".into()),
        ))
        .parts();
        assert_eq!(code, "gridHttpRefused");

        // And a sweep failure still is the archive, which is why the
        // delegation was right there and wrong here.
        let (code, _) = crate::http::HttpError::TooLarge.parts();
        assert_eq!(code, "httpTooLarge");
    }

    #[test]
    fn a_grid_failure_carries_a_code_the_catalogue_answers() {
        let cases = [
            (
                mrms::MrmsError::UnknownProduct("mrms-rala".into()),
                "gridUnknownProduct",
                vec!["mrms-rala".to_string()],
            ),
            (mrms::MrmsError::BadListing, "gridBadListing", Vec::new()),
            (
                mrms::MrmsError::NoFrames("MergedReflectivityQCComposite".into()),
                "gridNoFrames",
                vec!["MergedReflectivityQCComposite".to_string()],
            ),
            (mrms::MrmsError::NotGrib, "gridNotGrib", Vec::new()),
            // The detail rides along as an argument. The catalogue sentence
            // does not use it, so a reader never sees it, but it reaches the
            // log, which is the only place that says which GRIB2 template
            // would not unpack. Dropping it made the two indistinguishable
            // everywhere, not just on the page.
            (
                mrms::MrmsError::Unsupported("template 5.99".into()),
                "gridUnreadable",
                vec!["template 5.99".to_string()],
            ),
            (
                mrms::MrmsError::Decode("short read".into()),
                "gridUnreadable",
                vec!["short read".to_string()],
            ),
            (
                mrms::MrmsError::Encode("no encoder".into()),
                "gridNotDrawn",
                vec!["no encoder".to_string()],
            ),
        ];
        for (inner, code, args) in cases {
            let said = inner.to_string();
            let (got_code, got_args) = DataExportError::Grid(inner).parts();
            assert_eq!(got_code, code);
            assert_eq!(got_args, args);
            // What must not go out is the whole English sentence this file
            // holds. A bare detail is fine and is the point: it is an
            // argument the catalogue sentence ignores and the log keeps.
            assert!(
                !got_args.contains(&said),
                "{code} still carries the Display text"
            );
        }
    }

    /// A three-azimuth cut with one gate of each kind in it, so a CSV can be
    /// read line by line and checked against what went in.
    fn values() -> level2::SweepValues {
        let azimuths = vec![0.0f32, 90.0, 180.0];
        let mut field =
            SweepField::new_empty("Reflectivity", "dBZ", 0.5, azimuths, 1.0, 2.125, 0.25, 4);
        field.set(0, 0, 32.5, GateStatus::Valid);
        field.set(0, 1, -8.25, GateStatus::Valid);
        field.set(1, 2, 0.0, GateStatus::RangeFolded);
        field.set(2, 3, 61.0, GateStatus::Valid);
        // Everything else stays as it was built: no data, and left out.
        level2::SweepValues {
            station: "KTLX".to_string(),
            site_name: "Oklahoma City, OK".to_string(),
            site: Site::new(*b"KTLX", 35.3331, -97.2778, 370, 20),
            radar: "WSR-88D",
            product_id: "reflectivity".to_string(),
            product: "Reflectivity",
            unit: "dBZ",
            volume: "KTLX20260901_173211_V06".to_string(),
            collected: DateTime::from_timestamp(1_756_747_931, 0),
            dealiased: false,
            storm_motion: None,
            derivation: None,
            field,
        }
    }

    fn header_of(csv: &str, key: &str) -> String {
        csv.lines()
            .find_map(|line| line.strip_prefix(&format!("# {key}: ")))
            .unwrap_or_else(|| panic!("the header names {key}"))
            .to_string()
    }

    fn rows_of(csv: &str) -> Vec<Vec<String>> {
        csv.lines()
            .skip_while(|line| line.starts_with('#'))
            // The column names.
            .skip(1)
            .filter(|line| !line.is_empty())
            .map(|line| line.split(',').map(|cell| cell.to_string()).collect())
            .collect()
    }

    #[test]
    fn a_polar_csv_holds_the_readings_and_where_they_are() {
        let at = DateTime::from_timestamp(1_756_750_000, 0).expect("a time");
        let (csv, written, omitted) = polar_csv(&values(), at).expect("a csv");

        assert_eq!(written, 4);
        // Three azimuths of four gates, less the four written.
        assert_eq!(omitted, 8);
        assert_eq!(header_of(&csv, "format"), "openradar-polar-csv/1");
        assert_eq!(header_of(&csv, "station"), "KTLX (Oklahoma City, OK)");
        assert_eq!(header_of(&csv, "unit"), "dBZ");
        assert_eq!(header_of(&csv, "elevation_degrees"), "0.50");
        assert_eq!(header_of(&csv, "collected"), "2025-09-01T17:32:11Z");
        assert_eq!(header_of(&csv, "gate_count"), "4");
        assert_eq!(header_of(&csv, "first_gate_km"), "2.125");
        assert_eq!(header_of(&csv, "gate_interval_km"), "0.25");
        assert_eq!(header_of(&csv, "gates_written"), "4 of 12");
        assert!(header_of(&csv, "derivation").starts_with("none"));
        // The number is what the radar measured, not what it was drawn as.
        assert!(header_of(&csv, "display_threshold").contains("not applied"));

        let rows = rows_of(&csv);
        assert_eq!(rows.len(), 4);
        let first = &rows[0];
        assert_eq!(first[0], "0", "azimuth index");
        assert_eq!(first[1], "0", "gate index");
        assert_eq!(first[2], "0.00", "azimuth");
        assert_eq!(first[3], "2.1250", "range to the gate centre");
        assert_eq!(first[7], "32.5", "the value as measured");
        assert_eq!(first[8], "value");
        // Due north of the site, so the same longitude and further north.
        assert!(first[4].parse::<f64>().expect("a latitude") > 35.3331);
        assert!((first[5].parse::<f64>().expect("a longitude") + 97.2778).abs() < 0.001);
        // The beam is climbing, so a gate is above the antenna.
        assert!(first[6].parse::<f64>().expect("a height") > 370.0);

        // A negative reading is a reading, and is not confused for missing.
        assert_eq!(rows[1][7], "-8.25");
        // Range folded: the velocity there is ambiguous, which is a fact about
        // the gate rather than an absence, so the row is written with no value.
        let folded = &rows[2];
        assert_eq!(folded[8], "rangeFolded");
        assert_eq!(folded[7], "");
        assert_eq!(rows[3][7], "61");
    }

    #[test]
    fn what_was_done_to_the_readings_is_written_down() {
        let mut values = values();
        values.dealiased = true;
        values.storm_motion = Some(crate::level2::StormMotion {
            speed_ms: 12.0,
            from_degrees: 240.0,
            manual: false,
        });
        let at = DateTime::from_timestamp(1_756_750_000, 0).expect("a time");
        let (csv, _, _) = polar_csv(&values, at).expect("a csv");
        let derivation = header_of(&csv, "derivation");
        assert!(derivation.contains("unfolded"), "{derivation}");
        assert!(
            derivation.contains("12.0 m/s from 240 degrees"),
            "{derivation}"
        );
    }

    #[test]
    fn a_cut_bigger_than_one_file_should_hold_is_refused_not_truncated() {
        // A file that quietly stops at its cap is a file whose last row is a
        // lie about where the storm ended. The cap is an argument here
        // because four million gates is not a thing a test can build.
        let values = values();
        let at = DateTime::from_timestamp(1_756_750_000, 0).expect("a time");
        let refused = polar_csv_capped(&values, at, 2).expect_err("a refusal");
        match refused {
            DataExportError::TooLarge(count) => {
                // Twelve gates in this fixture, and the refusal names all of
                // them rather than the row it stopped on.
                assert_eq!(count, 12);
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
        // One more than it holds, and the same cut goes through.
        let (_, written, _) = polar_csv_capped(&values, at, 4).expect("a csv");
        assert_eq!(written, 4);
    }

    #[test]
    fn a_data_file_does_not_outlive_a_sidecar_that_could_not_be_written() {
        // Numbers with nothing beside them saying what they are is the one
        // outcome this module exists to prevent, and the page has already
        // been told the export failed.
        let folder = std::env::temp_dir().join(format!("openradar-sidecar-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("a folder");
        let name = "openradar-rollback-test.csv".to_string();
        // A directory where the sidecar wants to be, which no write can
        // replace.
        std::fs::create_dir_all(folder.join(format!("{name}.provenance.json"))).expect("a blocker");

        let values = values();
        let at = DateTime::from_timestamp(1_756_750_000, 0).expect("a time");
        let provenance = polar_provenance(
            &values,
            at,
            ProvenanceSource {
                kind: "live",
                label: "NOAA NEXRAD Level II".to_string(),
                url: None,
            },
        );
        let failed = write_pair(&folder, name.clone(), b"1,2,3\n", provenance, 1, 0);
        assert!(matches!(failed, Err(DataExportError::Write(_))));
        assert!(
            !folder.join(&name).exists(),
            "the data file was left behind with nothing saying what it is"
        );
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn a_cut_with_nothing_in_it_is_a_file_with_no_rows() {
        let mut values = values();
        values.field = SweepField::new_empty(
            "Reflectivity",
            "dBZ",
            0.5,
            vec![0.0, 1.0],
            1.0,
            2.125,
            0.25,
            3,
        );
        let at = DateTime::from_timestamp(1_756_750_000, 0).expect("a time");
        let (csv, written, omitted) = polar_csv(&values, at).expect("a csv");
        assert_eq!(written, 0);
        assert_eq!(omitted, 6);
        assert_eq!(header_of(&csv, "gates_written"), "0 of 6");
        // The column names are still there, so a reader gets an empty table
        // rather than a parse error.
        assert!(csv.contains("azimuth_index,gate_index,"));
        assert!(rows_of(&csv).is_empty());
    }

    fn grid_request(over: fn(&mut GridDataRequest)) -> GridDataRequest {
        let mut request = GridDataRequest {
            product: "rotation".to_string(),
            time: 1_756_747_800,
            domain: None,
            level: None,
            west: -94.5,
            south: 41.0,
            east: -93.0,
            north: 42.2,
        };
        over(&mut request);
        request
    }

    #[test]
    fn a_grid_request_finds_its_key_however_the_region_is_spelled() {
        // The bucket spells its regions in capitals, and `is_domain` is an
        // exact match. A lower case default here refused every gridded product
        // on the map by name, with an error saying the product did not exist.
        let (entry, key) = wanted_grid(&grid_request(|_| {})).expect("a key");
        assert_eq!(entry.id, "rotation");
        assert!(key.starts_with("CONUS/"), "{key}");
        assert!(key.ends_with(".grib2.gz"), "{key}");

        let named = wanted_grid(&grid_request(|request| {
            request.domain = Some("conus".to_string());
        }))
        .expect("a key")
        .1;
        assert_eq!(named, key, "the region is not case sensitive");

        let other = wanted_grid(&grid_request(|request| {
            request.domain = Some("alaska".to_string());
        }))
        .expect("a key")
        .1;
        assert!(other.starts_with("ALASKA/"), "{other}");

        // And a region the bucket does not have is refused rather than
        // reaching for a folder that is not there.
        assert!(matches!(
            wanted_grid(&grid_request(|request| {
                request.domain = Some("atlantis".to_string());
            })),
            Err(DataExportError::NoProduct(_))
        ));
    }

    #[test]
    fn a_grid_request_with_no_box_is_refused_before_anything_is_built() {
        // Every comparison against a NaN is false, so without this the window
        // came back as a single cell rather than as a refusal.
        for corner in 0..4 {
            let request = grid_request(|_| {});
            let mut request = request;
            match corner {
                0 => request.west = f64::NAN,
                1 => request.south = f64::INFINITY,
                2 => request.east = f64::NAN,
                _ => request.north = f64::NEG_INFINITY,
            }
            assert!(matches!(
                wanted_grid(&request),
                Err(DataExportError::NothingInView)
            ));
        }
        // A box with no width or no height is not a view either.
        assert!(matches!(
            wanted_grid(&grid_request(|request| { request.east = request.west })),
            Err(DataExportError::NothingInView)
        ));
        assert!(matches!(
            wanted_grid(&grid_request(|request| {
                request.north = request.south - 1.0
            })),
            Err(DataExportError::NothingInView)
        ));
    }

    /// The sidecar is the whole difference between numbers and data. What it
    /// says has to be what the file beside it says, and what the app actually
    /// did rather than what it usually does.
    #[test]
    fn the_sidecar_says_what_the_readings_are() {
        let values = values();
        let at = DateTime::from_timestamp(1_756_750_000, 0).expect("a time");
        let (csv, _, _) = polar_csv(&values, at).expect("a csv");
        let provenance = polar_provenance(
            &values,
            at,
            ProvenanceSource {
                kind: "archive",
                label: "NOAA NEXRAD Level II archive".to_string(),
                url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
            },
        );
        let json = serde_json::to_value(&provenance).expect("it serialises");

        assert_eq!(json["format"], "openradar-data-provenance");
        assert_eq!(json["kind"], "polar");
        assert_eq!(json["product"]["id"], "reflectivity");
        assert_eq!(json["product"]["unit"], "dBZ");
        assert_eq!(json["coordinateReference"], "EPSG:4326");
        // The observed time is when the radar collected the volume, not when
        // the file was written. Confusing the two is the mistake that makes an
        // export useless as evidence.
        assert_eq!(json["observed"], "2025-09-01T17:32:11Z");
        assert_eq!(json["writtenAt"], "2025-09-01T18:06:40Z");
        assert_ne!(json["observed"], json["writtenAt"]);
        assert_eq!(json["source"]["kind"], "archive");
        assert_eq!(json["source"]["label"], "NOAA NEXRAD Level II archive");
        // Nothing was done to these readings, and the file says so rather than
        // leaving a reader to assume.
        assert_eq!(json["derivation"].as_array().expect("a list").len(), 0);
        assert!(json["missing"].as_str().expect("words").contains("omitted"));

        // The geometry has to be the geometry the CSV was written from: a
        // reader recomputing a gate's height from the sidecar has to land on
        // the height column beside it.
        let geometry = &json["geometry"];
        assert_eq!(geometry["station"], "KTLX");
        assert_eq!(geometry["gateCount"], 4);
        assert_eq!(geometry["firstGateRangeKm"], 2.125);
        assert_eq!(geometry["beamModel"], "4/3 effective earth radius");
        let sidecar_height = geometry["antennaHeightMeters"]
            .as_f64()
            .expect("an antenna height");
        let csv_height: f64 = csv
            .lines()
            .find_map(|line| line.strip_prefix("# antenna_height_m: "))
            .expect("the header says one")
            .parse()
            .expect("a number");
        assert!(
            (sidecar_height - csv_height).abs() < 0.05,
            "the sidecar says {sidecar_height} and the csv says {csv_height}"
        );
        // Ground and tower, not ground alone: the beam model works from the
        // top of the tower and so does the height column.
        assert_eq!(geometry["siteGroundHeightMeters"], 370);
        assert!(sidecar_height > 370.0);
    }

    #[test]
    fn the_sidecar_records_what_was_done_to_the_readings() {
        let mut values = values();
        values.dealiased = true;
        values.storm_motion = Some(crate::level2::StormMotion {
            speed_ms: 12.0,
            from_degrees: 240.0,
            manual: false,
        });
        let at = DateTime::from_timestamp(1_756_750_000, 0).expect("a time");
        let json = serde_json::to_value(polar_provenance(
            &values,
            at,
            ProvenanceSource {
                kind: "live",
                label: "NOAA NEXRAD Level II".to_string(),
                url: None,
            },
        ))
        .expect("it serialises");
        let derivation = json["derivation"].as_array().expect("a list");
        assert_eq!(derivation.len(), 2);
        let said = format!("{derivation:?}");
        assert!(said.contains("unfolded"), "{said}");
        assert!(said.contains("12.0 m/s from 240 degrees"), "{said}");
    }

    #[test]
    fn a_file_name_is_the_same_shape_every_time() {
        assert_eq!(
            file_name(&["KDMX", "reflectivity", "20260901-173211"], "csv"),
            "openradar-kdmx-reflectivity-20260901-173211.csv"
        );
        // Anything a disk would object to becomes a hyphen, and a part that is
        // nothing but punctuation does not leave a double one behind.
        assert_eq!(
            file_name(&["a/b", "  ", "c:d"], "tif"),
            "openradar-a-b-c-d.tif"
        );
    }

    #[test]
    fn every_failure_has_a_code_the_page_can_word() {
        let cases: Vec<DataExportError> = vec![
            DataExportError::NoProduct("nope".into()),
            DataExportError::NotDrawn,
            DataExportError::NothingInView,
            DataExportError::TooLarge(9_000_000),
            DataExportError::NoFolder,
            DataExportError::Write("disk full".into()),
        ];
        for case in cases {
            let (code, _) = case.parts();
            assert!(!code.is_empty());
            let json = serde_json::to_value(&case).expect("an error serialises");
            assert_eq!(json["code"], code);
            assert!(json["text"].as_str().is_some_and(|text| !text.is_empty()));
        }
        // A radar failure keeps the wording the picture would have had rather
        // than being wrapped in a second one the page has no words for.
        let wrapped = DataExportError::Sweep(Level2Error::UnknownSite("KXXX".into()));
        assert_eq!(wrapped.parts().0, "unknownSite");
    }

    #[test]
    fn each_export_carries_its_own_kind_of_name() {
        // The two extensions used to be read out of one array by index, and
        // swapping the array's two entries left every test in the tree green
        // while every CSV export wrote a `.tif` and every raster wrote a
        // `.csv`. This drives the naming each writer actually calls, so the
        // extension is pinned to the export rather than to a position.
        let collected = DateTime::from_timestamp(1_788_283_931, 0);
        assert_eq!(
            sweep_file_name("KDMX", "reflectivity", collected),
            "openradar-kdmx-reflectivity-20260901-173211.csv"
        );
        assert_eq!(
            grid_file_name("MergedReflectivityQCComposite", 1_788_283_931),
            "openradar-mergedreflectivityqccomposite-20260901-173211.tif"
        );
        // A reading with no time still gets a name rather than a bare stem.
        assert_eq!(
            sweep_file_name("KDMX", "velocity", None),
            "openradar-kdmx-velocity-unknown.csv"
        );
    }

    #[test]
    fn every_name_this_module_writes_is_one_the_app_allows() {
        // The other half of `exports::tests::every_file_this_app_writes_can_
        // be_written`, which was named for every file and covered one of the
        // two writers. This module names its own files and writes them
        // through `write_atomically`, so nothing held its extensions against
        // the allowlist that decides what a packaged build may save. That is
        // how the journal export shipped writing nothing at all: an extension
        // missing from a list, and no test that looked.
        for extension in EXTENSIONS {
            let name = file_name(&["KDMX", "reflectivity", "20260901-173211"], extension);
            exports::sanitize_file_name(&name)
                .unwrap_or_else(|error| panic!("{name} cannot be written: {error:?}"));
            // And the sidecar that goes beside every one of them, which is a
            // second extension on the end of the first.
            let sidecar = format!("{name}.provenance.json");
            exports::sanitize_file_name(&sidecar)
                .unwrap_or_else(|error| panic!("{sidecar} cannot be written: {error:?}"));
        }
        // A saved volume keeps the bucket's own name rather than taking one
        // from `file_name`, so the loop above says nothing about it: the two
        // real names go through the same allowlist.
        for name in [
            volume_file_name("2026/08/30/KDMX/KDMX20260830_092159_V06", VOLUME_EXTENSION),
            volume_file_name("ATL_TZ0_2026_08_30_23_40_12", LEVEL3_EXTENSION),
        ] {
            exports::sanitize_file_name(&name)
                .unwrap_or_else(|error| panic!("{name} cannot be written: {error:?}"));
            let sidecar = format!("{name}.provenance.json");
            exports::sanitize_file_name(&sidecar)
                .unwrap_or_else(|error| panic!("{sidecar} cannot be written: {error:?}"));
        }
        // And the check `write_pair` really runs, which is the whole guard
        // asked as a question: a name it would have to change is not a name
        // this module may hand over. The sidecar is not asked, because
        // `write_pair` builds that one itself from a name that has already
        // passed; `sanitize_file_name` would turn its second dot into a dash.
        let refused =
            |name: &str| !matches!(exports::sanitize_file_name(name), Ok(safe) if safe == name);
        for extension in EXTENSIONS {
            let name = file_name(&["KDMX"], extension);
            assert!(!refused(&name), "{name}");
        }
        assert!(refused("openradar-kdmx.exe"));
        assert!(refused("openradar-kdmx"));
        // The sidecar beside each of them, which is the one write in this
        // module that no allowlist can hold: `sanitize_file_name` would turn
        // its inner dot into a dash and rename it. What makes it safe is
        // checkable even so, so it is checked: a name that has already passed
        // plus a suffix carrying nothing a path could use.
        for name in [
            file_name(&["KDMX", "reflectivity", "20260901-173211"], "csv"),
            file_name(&["KDMX", "reflectivity", "20260901-173211"], "tif"),
            volume_file_name("2026/08/30/KDMX/KDMX20260830_092159_V06", VOLUME_EXTENSION),
            volume_file_name("ATL_TZ0_2026_08_30_23_40_12", LEVEL3_EXTENSION),
        ] {
            assert!(!refused(&name), "{name}");
            let sidecar = format!("{name}{SIDECAR_SUFFIX}");
            assert_eq!(sidecar.strip_suffix(SIDECAR_SUFFIX), Some(name.as_str()));
            assert!(!sidecar.contains(['/', '\\']), "{sidecar}");
            assert!(!sidecar.contains(".."), "{sidecar}");
            assert!(sidecar.ends_with(".json"), "{sidecar}");
        }
        // The one the extension check could not see. Both bucket key segments
        // are non-empty and alphanumeric, so `readable_key` accepts it, and
        // `volume_file_name` takes the last segment unaltered because the
        // point of it is to keep the bucket's own name.
        assert_eq!(volume_file_name("2026/CON", VOLUME_EXTENSION), "CON.ar2v");
        assert!(refused("CON.ar2v"));
        assert!(refused("con.nids"));
        assert!(refused("LPT9.ar2v"));

        // Asked of `write_pair` itself rather than of the guard it calls,
        // because the guard has always refused these names and the question
        // is whether the writer asks it. It did not: it asked a check that
        // reads the extension and nothing else.
        let folder = std::env::temp_dir().join(format!("openradar-device-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("a folder");
        let at = DateTime::from_timestamp(1_756_750_000, 0).expect("a time");
        let provenance = polar_provenance(
            &values(),
            at,
            ProvenanceSource {
                kind: "archive",
                label: "NOAA NEXRAD Level II".to_string(),
                url: None,
            },
        );
        let name = volume_file_name("2026/CON", VOLUME_EXTENSION);
        let failed = write_pair(&folder, name.clone(), b"AR2V0006", provenance, 0, 0);
        assert!(
            matches!(failed, Err(DataExportError::Write(_))),
            "a DOS device name was accepted: {failed:?}"
        );
        assert!(
            !folder.join(&name).exists(),
            "a file was written under a device name"
        );
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn a_saved_volume_is_named_the_way_the_bucket_named_it() {
        // The point of saving the object at all is that another tool can read
        // it, and the station and the collection time are in the name. An
        // `openradar-` stem would throw both away.
        assert_eq!(
            volume_file_name("2026/08/30/KDMX/KDMX20260830_092159_V06", VOLUME_EXTENSION),
            "KDMX20260830_092159_V06.ar2v"
        );
        assert_eq!(
            volume_file_name("ATL_TZ0_2026_08_30_23_40_12", LEVEL3_EXTENSION),
            "ATL_TZ0_2026_08_30_23_40_12.nids"
        );
    }

    #[test]
    fn a_name_that_is_not_a_bucket_key_is_refused() {
        // The key comes from the page, and it is half a URL. Every one of
        // these would otherwise be pasted into a fetch and written to disk.
        assert!(readable_key("2026/08/30/KDMX/KDMX20260830_092159_V06"));
        assert!(readable_key("ATL_TZ0_2026_08_30_23_40_12"));
        for bad in [
            "",
            "../../etc/passwd",
            "2026/../../../secret",
            "2026//KDMX",
            "KDMX?list-type=2",
            "evil.example.com/KDMX20260830_092159_V06",
            "KDMX 20260830",
            "KDMX20260830_092159_V06#fragment",
        ] {
            assert!(!readable_key(bad), "{bad} was read as a key");
        }
        // And a name longer than any key either bucket publishes.
        assert!(!readable_key(&"a".repeat(201)));
    }

    #[test]
    fn a_key_says_when_the_radar_collected_it() {
        // The two buckets stamp their names differently and the sidecar has to
        // say the collection time either way, not the moment it was saved.
        assert_eq!(
            key_moment("2026/08/30/KDMX/KDMX20260830_092159_V06").map(stamp),
            Some("2026-08-30T09:21:59Z".to_string())
        );
        assert_eq!(
            key_moment("ATL_TZ0_2026_08_30_23_40_12").map(stamp),
            Some("2026-08-30T23:40:12Z".to_string())
        );
        // And a name with no stamp in it says nothing rather than guessing.
        assert_eq!(key_moment("KDMX"), None);
    }

    #[test]
    fn only_a_finished_volume_is_a_thing_to_save() {
        // The one thing this gate exists for, and it shipped with nothing
        // driving it. The volume the radar is sweeping now arrives as chunks
        // under a numbered folder, so a live picture's key is `114`: it is a
        // legal key by every other rule here and it names no object at all.
        // The refusal is what stops a reader being handed a save that can
        // only fail.
        for live in ["114", "0", "2026/08/30/KDMX/KDMX20260830_092159_V06_MDM"] {
            assert!(
                matches!(
                    wanted_object("KDMX", live),
                    Err(DataExportError::NotAVolume)
                ),
                "{live} was read as a volume"
            );
        }

        // A finished one is, and it names the bucket that serves it and the
        // extension every other tool expects.
        let volume = wanted_object("KDMX", "2026/08/30/KDMX/KDMX20260830_092159_V06")
            .expect("a finished volume is a thing to save");
        assert_eq!(volume.extension, VOLUME_EXTENSION);
        assert_eq!(volume.host, level2::ARCHIVE_HOST);
        assert!(volume.source.label.contains("Level II"));

        // A terminal radar publishes one Level III product at a time out of a
        // different bucket, and its key carries none of the suffixes above.
        let product = wanted_object("TATL", "ATL_TZ0_2026_08_30_23_40_12")
            .expect("a terminal radar's product is a thing to save");
        assert_eq!(product.extension, LEVEL3_EXTENSION);
        assert!(product.host.contains(crate::level3::BUCKET));
        assert!(product.source.label.contains("Level III"));
        // The two are different buckets, which is the whole reason the branch
        // exists: fetching one key from the other's host is a 404.
        assert_ne!(product.host, volume.host);
    }
}

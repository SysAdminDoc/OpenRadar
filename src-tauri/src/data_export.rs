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
    #[error("that grid is not on screen, so there is nothing decoded to write")]
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
}

impl DataExportError {
    fn parts(&self) -> (&'static str, Vec<String>) {
        match self {
            // A failure fetching or decoding keeps the radar wording it
            // already has, so the page says the same thing it would have said
            // about the picture.
            Self::Sweep(inner) => inner.parts(),
            Self::Grid(inner) => ("grid", vec![inner.to_string()]),
            Self::NotDrawn => ("notDrawn", Vec::new()),
            Self::NoProduct(id) => ("noProduct", vec![id.clone()]),
            Self::NothingInView => ("nothingInView", Vec::new()),
            Self::TooLarge(count) => ("tooLarge", vec![count.to_string()]),
            Self::NoFolder => ("noFolder", Vec::new()),
            Self::Write(why) => ("write", vec![why.clone()]),
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

/// Which grid to write, and the corner of the world to cut it to.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridDataRequest {
    pub product: String,
    /// Seconds since the epoch, as the timeline holds them.
    pub time: i64,
    #[serde(default)]
    pub domain: Option<String>,
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
    /// Gates left out because they measured nothing, for a polar export.
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
    /// `polar` or `grid`, which is also which of the two files this is.
    kind: &'static str,
    product: ProvenanceProduct,
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

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
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

/// One sweep as CSV: a header of everything needed to place the numbers, then
/// a row per gate that measured something.
///
/// Gates below the radar's detection threshold and gates with no data are left
/// out rather than written as blanks. They are the great majority of a cut,
/// they carry no reading, and the header says how many there were and what the
/// geometry is, so the full array can still be rebuilt from the indices. A
/// range folded gate is written, with an empty value and its status, because
/// "the velocity here is ambiguous" is a measurement and not an absence.
fn polar_csv(values: &level2::SweepValues, written_at: DateTime<Utc>) -> (String, usize, usize) {
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
    header(format!("station: {} ({})", values.station, values.site_name));
    header(format!("radar: {}", values.radar));
    header(format!("product: {} [{}]", values.product, values.product_id));
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
            if written >= MAX_ROWS {
                omitted += 1;
                continue;
            }
            let at = coordinates.gate_location(
                *azimuth,
                elevation,
                gate_index,
                first_km,
                interval_km,
            );
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
    (out, written, omitted)
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
    let checksum = sha256_hex(data);
    provenance.data_file = name.clone();
    provenance.sha256 = checksum.clone();
    let sidecar_name = format!("{name}.provenance.json");
    let sidecar = serde_json::to_vec_pretty(&provenance)
        .map_err(|error| DataExportError::Write(error.to_string()))?;

    let target = folder.join(&name);
    exports::write_atomically(&target, data)
        .map_err(|error| DataExportError::Write(error.to_string()))?;
    let beside = folder.join(&sidecar_name);
    exports::write_atomically(&beside, &sidecar)
        .map_err(|error| DataExportError::Write(error.to_string()))?;

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
            let (station, key, data) = level2::local_volume_for_export(&PathBuf::from(path))?;
            let name = Path::new(path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            (
                station,
                key,
                data,
                ProvenanceSource {
                    kind: "local",
                    label: name,
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

    let gates = values.field.azimuth_count() * values.field.gate_count();
    if gates > MAX_ROWS * 4 {
        return Err(DataExportError::TooLarge(gates));
    }

    let (csv, written, omitted) = polar_csv(&values, written_at);
    let name = file_name(
        &[
            &values.station,
            &values.product_id,
            &values
                .collected
                .map(|at| at.format("%Y%m%d-%H%M%S").to_string())
                .unwrap_or_else(|| "unknown".to_string()),
        ],
        "csv",
    );

    let field = &values.field;
    let provenance = Provenance {
        format: "openradar-data-provenance",
        format_version: 1,
        application: APP,
        written_at: stamp(written_at),
        data_file: String::new(),
        sha256: String::new(),
        kind: "polar",
        product: ProvenanceProduct {
            id: values.product_id.clone(),
            label: values.product.to_string(),
            unit: values.unit.to_string(),
        },
        observed: values.collected.map(stamp),
        source,
        geometry: serde_json::json!({
            "station": values.station,
            "siteName": values.site_name,
            "radar": values.radar,
            "siteLatitude": values.site.latitude(),
            "siteLongitude": values.site.longitude(),
            "antennaHeightMeters": values.site.height_meters(),
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
    };

    write_pair(
        &folder,
        name,
        csv.as_bytes(),
        provenance,
        written,
        omitted,
    )
}

/// The part of one MRMS grid that is on screen, as a georeferenced raster.
#[tauri::command]
pub async fn export_grid_data(
    app: AppHandle,
    request: GridDataRequest,
) -> Result<DataExportReport, DataExportError> {
    let folder = exports::export_folder(&app).map_err(|_| DataExportError::NoFolder)?;
    let entry = mrms::product_by_id(&request.product)
        .ok_or_else(|| DataExportError::NoProduct(request.product.clone()))?;
    let domain = request.domain.clone().unwrap_or_else(|| "conus".to_string());
    let key = mrms::key_for(&domain, entry, request.time)
        .ok_or_else(|| DataExportError::NoProduct(request.product.clone()))?;
    mrms::grid_for(&key).await?;

    let written_at = Utc::now();
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

    let name = file_name(
        &[
            &request.product,
            &DateTime::from_timestamp(request.time, 0)
                .map(|at| at.format("%Y%m%d-%H%M%S").to_string())
                .unwrap_or_else(|| "unknown".to_string()),
        ],
        "tif",
    );
    let raster = geotiff::write(
        cut.columns,
        cut.rows,
        &cut.values,
        &geotiff::Georeference {
            west: cut.west,
            north: cut.north,
            d_lon: cut.d_lon,
            d_lat: cut.d_lat,
            description: entry.label.to_string(),
            unit: entry.unit.to_string(),
        },
        APP,
    );

    let provenance = Provenance {
        format: "openradar-data-provenance",
        format_version: 1,
        application: APP,
        written_at: stamp(written_at),
        data_file: String::new(),
        sha256: String::new(),
        kind: "grid",
        product: ProvenanceProduct {
            id: request.product.clone(),
            label: entry.label.to_string(),
            unit: entry.unit.to_string(),
        },
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
        missing: "a cell outside the grid is NaN, which the GDAL_NODATA tag names;                   inside it the values are as decoded, including the codes MRMS reserves                   for missing and for outside radar coverage"
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

    /// A three-azimuth cut with one gate of each kind in it, so a CSV can be
    /// read line by line and checked against what went in.
    fn values() -> level2::SweepValues {
        let azimuths = vec![0.0f32, 90.0, 180.0];
        let mut field = SweepField::new_empty(
            "Reflectivity",
            "dBZ",
            0.5,
            azimuths,
            1.0,
            2.125,
            0.25,
            4,
        );
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
        let (csv, written, omitted) = polar_csv(&values(), at);

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
        let (csv, _, _) = polar_csv(&values, at);
        let derivation = header_of(&csv, "derivation");
        assert!(derivation.contains("unfolded"), "{derivation}");
        assert!(derivation.contains("12.0 m/s from 240 degrees"), "{derivation}");
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
        let (csv, written, omitted) = polar_csv(&values, at);
        assert_eq!(written, 0);
        assert_eq!(omitted, 6);
        assert_eq!(header_of(&csv, "gates_written"), "0 of 6");
        // The column names are still there, so a reader gets an empty table
        // rather than a parse error.
        assert!(csv.contains("azimuth_index,gate_index,"));
        assert!(rows_of(&csv).is_empty());
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
}

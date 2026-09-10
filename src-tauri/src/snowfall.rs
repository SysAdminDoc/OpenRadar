//! The national snowfall analysis, as the office publishes it.
//!
//! Precipitation type says what is falling and nothing says how much of it
//! landed. This is the answer the National Operational Hydrologic Remote
//! Sensing Center publishes twice a day: how much snow actually fell over the
//! last day, two days or three, assimilated from gauges, radar, satellite and
//! the models together rather than from any one of them.
//!
//! It comes as a GeoTIFF of single band `f32`, LZW compressed, on a plain
//! quarter-degree-ish geographic grid. There is no projection to undo: the
//! file says WGS 84 with a pixel scale and one tie point, so a cell's corners
//! are arithmetic. What there is instead is a no-data value that is not NaN,
//! and reading it as a depth would bury the country under a kilometre of snow.

use std::f64::consts::{FRAC_PI_4, PI};
use std::io::Cursor;

use base64::Engine;
use chrono::{DateTime, Duration, Timelike, Utc};
use serde::Serialize;
use tiff::decoder::{Decoder, DecodingResult};
use tiff::tags::Tag;

use crate::http;

/// The windows the office publishes, which are the ones a reader may ask for.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Window {
    Day,
    TwoDay,
    ThreeDay,
}

impl Window {
    /// The name the file carries, which is also what the frontend sends.
    pub fn name(self) -> &'static str {
        match self {
            Window::Day => "24h",
            Window::TwoDay => "48h",
            Window::ThreeDay => "72h",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "24h" => Some(Window::Day),
            "48h" => Some(Window::TwoDay),
            "72h" => Some(Window::ThreeDay),
            _ => None,
        }
    }

    /// How many hours the total covers, for the legend.
    pub fn hours(self) -> u32 {
        match self {
            Window::Day => 24,
            Window::TwoDay => 48,
            Window::ThreeDay => 72,
        }
    }
}

/// One analysis: the depths and where on the earth they sit.
///
/// Corners are `[west, south, east, north]`, the same shape every extent in
/// this app is carried in.
pub struct Analysis {
    pub width: usize,
    pub height: usize,
    /// Inches of snow, row 0 at the north edge, or `f32::NAN` where the
    /// analysis says nothing.
    pub inches: Vec<f32>,
    pub extent: [f64; 4],
}

/// What the office writes where it has no answer.
///
/// Not NaN, which is what a reader that assumes NaN would leave in the grid
/// and then colour: minus ninety-nine thousand inches of snow is eight
/// thousand feet of it, and on a ramp that clamps it draws as the deepest
/// colour there is over every ocean on the map.
const NO_DATA: f32 = -99_999.0;

/// Below this a cell is bare ground rather than a dusting.
///
/// The analysis carries very small positive values over most of the country
/// in winter, and drawing them paints the whole map faintly rather than
/// showing where snow actually fell.
///
/// It is the bottom of the scale rather than the smallest depth the office
/// reports, which is a hundredth of an inch. Those two were different, and
/// the difference was a lie in the key: a hundredth and a tenth painted the
/// same pixel, under a swatch labelled "0.1 in to 1 in". The picture's floor
/// and the key's first line have to be the same number or the key is not the
/// scale the picture was painted with.
pub const TRACE_INCHES: f32 = 0.1;

/// Reads one analysis out of the bytes the office published.
pub fn read(bytes: &[u8]) -> Result<Analysis, String> {
    let mut decoder =
        Decoder::new(Cursor::new(bytes)).map_err(|error| format!("not a GeoTIFF: {error}"))?;
    let (width, height) = decoder
        .dimensions()
        .map_err(|error| format!("the raster has no size: {error}"))?;
    let width = width as usize;
    let height = height as usize;

    // Where the raster sits, from the two tags GeoTIFF uses for a grid with no
    // rotation in it: how big a cell is, and which point of ground the corner
    // of the first one is.
    let scale = decoder
        .get_tag_f64_vec(Tag::ModelPixelScaleTag)
        .map_err(|error| format!("the raster says no pixel scale: {error}"))?;
    let tie = decoder
        .get_tag_f64_vec(Tag::ModelTiepointTag)
        .map_err(|error| format!("the raster says no tie point: {error}"))?;
    if scale.len() < 2 || tie.len() < 6 {
        return Err("the raster's georeferencing is incomplete".to_string());
    }
    let (cell_x, cell_y) = (scale[0], scale[1]);
    // The tie point is raster (i, j, k) then model (x, y, z). A north-up grid
    // ties its own origin, so the raster half is zero and the model half is
    // the north-west corner.
    let (west, north) = (tie[3], tie[4]);
    if !(cell_x > 0.0 && cell_y > 0.0) {
        return Err("the raster's cells have no size".to_string());
    }
    let extent = [
        west,
        north - cell_y * height as f64,
        west + cell_x * width as f64,
        north,
    ];

    let read = decoder
        .read_image()
        .map_err(|error| format!("the raster could not be read: {error}"))?;
    let DecodingResult::F32(mut inches) = read else {
        return Err("the analysis is not a band of floating point depths".to_string());
    };
    if inches.len() != width * height {
        return Err(format!(
            "the raster is {width} by {height} and carries {} samples",
            inches.len()
        ));
    }
    // The office's own no-data, turned into the one this app draws nothing
    // for. Anything at or below it is the same statement.
    for value in inches.iter_mut() {
        if !value.is_finite() || *value <= NO_DATA {
            *value = f32::NAN;
        }
    }

    Ok(Analysis {
        width,
        height,
        inches,
        extent,
    })
}

const HOST: &str = "https://www.nohrsc.noaa.gov";

/// The colours a depth is drawn in, in inches.
///
/// The office's own scale runs from a dusting to feet of it, and the stops
/// people act on are near the bottom: an inch is a scraper, six is a shovel,
/// a foot closes roads. So they sit close together low down and spread out
/// above, and the top stop is where a scale has to stop rather than where
/// snow does.
const RAMP: &[(f32, [u8; 3])] = &[
    (0.1, [0xdb, 0xea, 0xfe]),
    (1.0, [0x93, 0xc5, 0xfd]),
    (3.0, [0x60, 0xa5, 0xfa]),
    (6.0, [0x38, 0x2b, 0xd8]),
    (12.0, [0x7c, 0x3a, 0xed]),
    (18.0, [0xc0, 0x26, 0xd3]),
    (30.0, [0xf4, 0x3f, 0x5e]),
    (48.0, [0xfe, 0xd7, 0xaa]),
];

/// The same for a reader who has asked for more contrast.
///
/// Lightness climbs from one end to the other, so the reading survives where
/// hue is lost completely, and the hue that remains swings along the
/// blue-yellow axis both red-green deficiencies keep.
const HIGH_CONTRAST_RAMP: &[(f32, [u8; 3])] = &[
    (0.1, [0x00, 0x25, 0x6c]),
    (1.0, [0x00, 0x44, 0x7e]),
    (3.0, [0x00, 0x65, 0x62]),
    (6.0, [0x44, 0x85, 0x49]),
    (12.0, [0x8a, 0x9f, 0x37]),
    (18.0, [0xcf, 0xb5, 0x3c]),
    (30.0, [0xff, 0xb6, 0x92]),
    (48.0, [0xff, 0xf2, 0xe3]),
];

/// One band of the key beside the map.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Band {
    pub inches: f32,
    pub color: String,
}

/// The picture, and everything the legend beside it has to say.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snowfall {
    /// The window this total covers, in hours.
    pub hours: u32,
    /// When the analysis was valid, which is what the legend names.
    pub valid: String,
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
    pub image: String,
    pub bands: Vec<Band>,
    /// The office that made it, said where the reader can see it.
    pub attribution: String,
    pub attribution_url: String,
}

fn ramp_for(high_contrast: bool) -> &'static [(f32, [u8; 3])] {
    if high_contrast {
        HIGH_CONTRAST_RAMP
    } else {
        RAMP
    }
}

/// The colour a depth is drawn in: the band it falls in, flat.
///
/// A step rather than a blend. The key beside the map is a list of bands and
/// each swatch is labelled with the range it covers, so a colour a reader
/// matches against a swatch has to be the colour that band is actually
/// painted in. Blending between the stops meant the top of every band was
/// painted the next band's colour exactly: 11.99 inches came out `#7c3aed`,
/// the swatch reading "12 in to 18 in", and a reader matching it read a foot
/// of snow where eleven and a half had fallen.
fn colour(ramp: &[(f32, [u8; 3])], inches: f32) -> [u8; 3] {
    let mut found = ramp[0].1;
    for (at, stop) in ramp {
        if inches < *at {
            break;
        }
        found = *stop;
    }
    found
}

/// The picture, and the shape it came out.
pub struct Picture {
    pub pixels: Vec<u8>,
    pub width: usize,
    pub height: usize,
}

fn mercator(lat_degrees: f64) -> f64 {
    (FRAC_PI_4 + lat_degrees.to_radians() / 2.0).tan().ln()
}

fn from_mercator(y: f64) -> f64 {
    (2.0 * y.exp().atan() - PI / 2.0).to_degrees()
}

/// The analysis as pixels, clear wherever it said nothing and wherever it said
/// less than a trace.
///
/// Rows are spaced in Mercator rather than in degrees, which is the whole of
/// what this does beyond colouring. The grid is four hundredths of a degree
/// per row and the map draws a pinned picture by stretching it linearly
/// between four Mercator corners, so handing over the grid's own rows put
/// every total north of where it fell: two degrees of it in the middle of the
/// country, which is Denver's snow drawn over Cheyenne. Every other grid in
/// this app reprojects first, and `hrrr::to_image` says so in as many words.
pub fn paint(analysis: &Analysis, high_contrast: bool) -> Result<Picture, String> {
    let ramp = ramp_for(high_contrast);
    let [west, south, east, north] = analysis.extent;
    let width = analysis.width;
    let top = mercator(north);
    let bottom = mercator(south);
    // Enough rows that no row of the grid is skipped. The picture's row
    // pitch in Mercator is the grid's row pitch in radians, and a grid row
    // spans `dphi / cos(phi)` of Mercator, which is never less than `dphi`.
    // So every grid row covers at least one picture row, and the binding
    // case is the equatorward edge where the cosine is largest rather than
    // the poleward one.
    let height = (((top - bottom) / (north - south).to_radians()) * analysis.height as f64)
        .round()
        .max(1.0) as usize;
    // The same guard `hrrr::to_image` puts on its own picture, and for the
    // same reason: the multiplier above grows without limit as a grid's
    // north edge approaches the pole, and a sliver of a grid would size a
    // picture in gigabytes before a single pixel was painted.
    if height > analysis.height * 8 {
        return Err(format!(
            "a picture {height} rows tall for a grid of {}",
            analysis.height
        ));
    }
    let mut pixels = vec![0u8; width * height * 4];
    let span = north - south;
    for row in 0..height {
        let lat = from_mercator(top - (row as f64 + 0.5) / height as f64 * (top - bottom));
        // Which row of the grid that latitude sits in. Row 0 is the north
        // edge, and the tiepoint is the corner of the first cell rather than
        // its centre, so this is a plain floor rather than a rounding.
        let source = ((north - lat) / span * analysis.height as f64).floor();
        if source < 0.0 || source >= analysis.height as f64 {
            continue;
        }
        let source = source as usize * width;
        for column in 0..width {
            let depth = analysis.inches[source + column];
            // Bare ground is not a light dusting. The analysis carries very
            // small positive values across most of the country, and drawing
            // those paints the whole map faintly rather than showing where
            // snow fell.
            if !depth.is_finite() || depth < TRACE_INCHES {
                continue;
            }
            let [red, green, blue] = colour(ramp, depth);
            let into = (row * width + column) * 4;
            pixels[into] = red;
            pixels[into + 1] = green;
            pixels[into + 2] = blue;
            pixels[into + 3] = 0xdc;
        }
    }
    // Longitude is linear in Mercator x, so the columns need nothing done to
    // them. `east` and `west` are read only to say that out loud.
    debug_assert!(east > west);
    Ok(Picture {
        pixels,
        width,
        height,
    })
}

/// The key beside the map, which is the ramp said in the reader's own terms.
pub fn bands(high_contrast: bool) -> Vec<Band> {
    ramp_for(high_contrast)
        .iter()
        .map(|(inches, [red, green, blue])| Band {
            inches: *inches,
            color: format!("#{red:02x}{green:02x}{blue:02x}"),
        })
        .collect()
}

/// The address the office publishes an analysis at.
///
/// The window is one of three names this module owns rather than anything a
/// caller may put there, which is what keeps a path out of a request.
pub fn url(window: Window, valid: DateTime<Utc>) -> String {
    format!(
        "{HOST}/snowfall_v2/data/{}/sfav2_CONUS_{}_{}.tif",
        valid.format("%Y%m"),
        window.name(),
        valid.format("%Y%m%d%H")
    )
}

/// The analysis times to try, newest first.
///
/// The office publishes at 00Z and 12Z and takes a while over it, so the one
/// that ought to exist by the clock often does not yet. Walking back a few of
/// them is what turns that into the most recent answer rather than into an
/// error every twelve hours.
pub fn recent(now: DateTime<Utc>) -> Vec<DateTime<Utc>> {
    let anchor = now
        .with_minute(0)
        .and_then(|at| at.with_second(0))
        .and_then(|at| at.with_nanosecond(0))
        .unwrap_or(now);
    let mut at = anchor
        .with_hour(if anchor.hour() >= 12 { 12 } else { 0 })
        .unwrap_or(anchor);
    let mut times = Vec::with_capacity(6);
    for _ in 0..6 {
        times.push(at);
        at -= Duration::hours(12);
    }
    times
}

/// The most recent analysis the office has actually published.
#[tauri::command]
pub async fn snowfall_analysis(window: String, high_contrast: bool) -> Result<Snowfall, String> {
    let window =
        Window::from_name(&window).ok_or_else(|| format!("{window} is not a snowfall window"))?;
    let mut last = "the snowfall analysis could not be reached".to_string();
    for valid in recent(Utc::now()) {
        let bytes = match http::get_bytes(&url(window, valid)).await {
            Ok(bytes) => bytes,
            Err(error) => {
                last = error.to_string();
                continue;
            }
        };
        let drawn = tauri::async_runtime::spawn_blocking(move || {
            let analysis = read(&bytes)?;
            let picture = paint(&analysis, high_contrast)?;
            let png =
                crate::level2::encode_png_sized(&picture.pixels, picture.width, picture.height)
                    .map_err(|error| error.to_string())?;
            Ok::<_, String>((analysis.extent, png))
        })
        .await
        .map_err(|error| error.to_string())?;
        let ([west, south, east, north], png) = match drawn {
            Ok(found) => found,
            Err(why) => {
                last = why;
                continue;
            }
        };
        return Ok(Snowfall {
            hours: window.hours(),
            valid: valid.to_rfc3339(),
            west,
            south,
            east,
            north,
            image: format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(&png)
            ),
            bands: bands(high_contrast),
            attribution: "NOAA National Operational Hydrologic Remote Sensing Center".to_string(),
            attribution_url: "https://www.nohrsc.noaa.gov/snowfall/".to_string(),
        });
    }
    Err(last)
}

#[cfg(test)]
#[path = "snowfall_tests.rs"]
mod tests;

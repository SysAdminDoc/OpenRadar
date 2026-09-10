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
// Reflectivity under more contrast is the same ramp the single-site radar
// draws, so one storm is the same colours whichever picture it is read from.
use crate::level2::HIGH_CONTRAST_REFLECTIVITY_RAMP;
use std::borrow::Cow;

use crate::grib;
use crate::palette;

const BUCKET: &str = "https://noaa-mrms-pds.s3.amazonaws.com";
/// A decoded grid is columns × rows u16, which is fifty megabytes for the
/// published CONUS domain.
const GRID_BYTES: usize = 7000 * 3500 * 2;
const MAX_GRID_POINTS: usize = GRID_BYTES / std::mem::size_of::<u16>();
/// How much finer than the app's own grid the network may publish before the
/// decoder gives up.
///
/// MRMS moved the rotation tracks to 0.005 degrees, which is 14000 by 7000
/// points: four times the cells, and the decoder refused every one of them, so
/// a shipped layer drew nothing at all with only a log line to say why. Four
/// times the cells is also four times the resident memory, and the cache holds
/// one grid per product, so the grid is reduced to the resolution the app
/// draws at on the way in rather than the budget being raised to hold it.
const MAX_SOURCE_REDUCTION: usize = 2;
/// What one of those finer grids costs unfolded.
const FINE_GRID_BYTES: usize = GRID_BYTES * MAX_SOURCE_REDUCTION * MAX_SOURCE_REDUCTION;
/// How many points a grid may hold when the reader is close enough to see the
/// fold, which is the finest anything published arrives at.
const MAX_DETAIL_POINTS: usize = MAX_GRID_POINTS * MAX_SOURCE_REDUCTION * MAX_SOURCE_REDUCTION;
/// The products the network publishes finer than the grid this app draws at.
///
/// Named rather than counted from the table, because what makes a product fine
/// is the resolution the network publishes it at and nothing in the entry says
/// so. Pinned by `the_fine_products_are_in_the_table`, which fails if one of
/// these is renamed out from under the budget below.
const FINE_PRODUCTS: &[&str] = &["az-shear-low", "az-shear-mid"];
const MAX_DECOMPRESSED_BYTES: usize = GRID_BYTES + 16 * 1024 * 1024;
// Raised from 512 MiB at eleven products and again at fourteen, when the
// flash flood grids arrived: the point of the budget is a ceiling, and the
// point of the capacity is one slot per product, so a screen with every layer
// on does not download the country once per layer. It is a ceiling rather
// than a reservation; nothing is allocated until a grid is actually decoded,
// and nobody has fourteen layers on.
const CACHE_BUDGET_BYTES: usize = 768 * 1024 * 1024;

/// How many grids one screen can be drawing at once, generously.
///
/// The guarantee the cache owes a reader: a screen with this many layers on
/// never evicts a grid it is about to want, so panning does not re-download
/// the country once per layer. Well past what anybody runs, and far short of
/// one slot for every product in the table.
const LAYERS_AT_ONCE: usize = 8;
/// How many grids a busy screen has in hand at once.
///
/// Every layer somebody actually has on, and the composite loop's next frame
/// on top of them. Not a floor under the eviction: it was one, and that was a
/// hole rather than a guarantee. The cache is keyed by bucket object and a
/// loop replay has one object per frame, so a floor of nine entries held
/// whatever they weighed let one product's replay sit on nine unfolded grids,
/// 1.6 GB against a stated ceiling of 768 MiB. The budget is the bound now,
/// and this is what the budget has to be big enough for.
const BUSY_SCREEN: usize = LAYERS_AT_ONCE + 1;
// The promise, as arithmetic: a busy screen fits inside the budget, so
// nothing it is about to want is ever evicted. The worst one is every fine
// product unfolded with coarse grids filling the rest, 735 MB against a
// 768 MiB ceiling on 2026-09-05. A third fine product does not fit, and this
// fails the build rather than the cache quietly dropping a grid the screen
// needs.
const _: () = assert!(
    FINE_PRODUCTS.len() * FINE_GRID_BYTES + (BUSY_SCREEN - FINE_PRODUCTS.len()) * GRID_BYTES
        <= CACHE_BUDGET_BYTES
);
const _: () = assert!(BUSY_SCREEN > LAYERS_AT_ONCE);

/// The cell size of the grid this app draws at, in degrees.
const DRAWN_CELL_DEGREES: f64 = 0.01;

/// Whether a reader at this zoom is close enough to see the fold.
///
/// Web Mercator draws 360 degrees across 256 pixels at zoom zero, so one pixel
/// is `360 / (256 * 2^zoom)` degrees wide. The fold is invisible while a
/// folded cell is under a pixel across: 0.011 degrees a pixel at zoom seven,
/// 0.0055 at zoom eight. Worked out rather than written down, so a change to
/// the grid the app draws at moves the answer with it.
fn fold_shows(zoom: u32) -> bool {
    let degrees_a_pixel = 360.0 / (256.0 * f64::from(1u32 << zoom.min(30)));
    degrees_a_pixel < DRAWN_CELL_DEGREES
}
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

impl MrmsError {
    /// A code and its arguments, so the reader is told this in their own
    /// language rather than handed the Display text of a Rust error. The
    /// wording lived here, in English, and the page printed it verbatim
    /// inside a translated sentence.
    pub fn parts(&self) -> (&'static str, Vec<String>) {
        match self {
            Self::UnknownProduct(id) => ("gridUnknownProduct", vec![id.clone()]),
            Self::BadListing => ("gridBadListing", Vec::new()),
            Self::NoFrames(id) => ("gridNoFrames", vec![id.clone()]),
            Self::NotGrib => ("gridNotGrib", Vec::new()),
            // What is wrong is the same either way: the file is a shape this
            // build cannot turn into a picture. The detail rides along as an
            // argument the sentence does not use, so it still reaches the log
            // and somebody can see which GRIB2 template to add.
            Self::Unsupported(why) | Self::Decode(why) => ("gridUnreadable", vec![why.clone()]),
            Self::Encode(why) => ("gridNotDrawn", vec![why.clone()]),
            // Flavoured, because this is not the radar archive. MRMS comes
            // from its own bucket, and delegating straight to HttpError put
            // the archive codes on it, which the page answers with "The radar
            // archive could not be reached" over a grid the archive never
            // served.
            Self::Http(inner) => match inner.parts() {
                ("httpStatus", args) => ("gridHttpStatus", args),
                ("httpUnreachable", args) => ("gridHttpUnreachable", args),
                ("httpRefused", args) => ("gridHttpRefused", args),
                ("httpTooLarge", args) => ("gridHttpTooLarge", args),
                other => other,
            },
        }
    }
}

impl Serialize for MrmsError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
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

    /// What this grid is holding, in bytes.
    ///
    /// The samples are what costs: a folded CONUS grid is 49 MB and an
    /// unfolded shear grid is four times that, which is the whole reason the
    /// cache counts bytes rather than slots.
    pub fn bytes(&self) -> usize {
        self.samples.len() * std::mem::size_of::<u16>()
    }

    /// What this grid packs "nothing was measured here" as, if it packs one.
    ///
    /// MRMS writes no coverage as the smallest sample the packing can hold,
    /// which decodes to the reference value itself. On a reflectivity grid
    /// that is -999, which nobody could mistake for weather. On an
    /// accumulation grid the reference is zero and the smallest sample is a
    /// genuine zero millimetres, so there is no sentinel at all and reading
    /// towards it is right: it says the estimate there was nothing, which is
    /// a measurement.
    fn absent(&self) -> Option<f32> {
        let lowest = self.reference / 10f32.powi(self.decimal as i32);
        (lowest < -100.0).then_some(lowest)
    }

    /// The reading in a cell, or None where the grid says it had no coverage.
    ///
    /// Drawing does not need the difference, because neither gets painted.
    /// Reading between cells does: smoothing towards a low reading is an
    /// estimate of the air between two measurements, and smoothing towards an
    /// absence is an invention at the edge of what the network can see.
    pub fn reading(&self, row: usize, column: usize) -> Option<f32> {
        if self.absent().is_some() && self.samples[row * self.columns + column] == 0 {
            return None;
        }
        Some(self.value(row, column))
    }

    /// The reading at a point, read between the four cells around it.
    ///
    /// A cell of the mosaic is about a kilometre across, so a reader zoomed in
    /// on a storm is looking at squares of one colour with hard edges against
    /// the squares beside them, and the terraces between colour bands read as
    /// the resolution of the instrument when they are the resolution of the
    /// ramp. This reads the field between the cell centres instead.
    ///
    /// Bilinear rather than anything smoother on purpose. Bicubic overshoots
    /// at a sharp gradient and puts a value on the map above the strongest one
    /// in the neighbourhood, so a storm core would read hotter than the
    /// network measured it.
    ///
    /// None when any of the four says nothing was measured, and the caller
    /// falls back to the nearest cell there rather than dropping the pixel:
    /// the edge of coverage stays where it is and stays square, which is
    /// honest, instead of being feathered outwards into ground nothing saw.
    pub fn between(&self, latitude: f64, longitude: f64) -> Option<f32> {
        // Cell centres, so the whole numbers are the centres and the fraction
        // between them is what is being read. `locate` rounds instead,
        // because it answers a different question: which cell's footprint is
        // this point in.
        let x = (longitude - self.west) / self.d_lon;
        let y = (self.north - latitude) / self.d_lat;
        // Half a cell past the outermost centre is still inside the grid's own
        // footprint, and there is nothing beyond it to read towards.
        if !(-0.5..=(self.columns as f64 - 0.5)).contains(&x) {
            return None;
        }
        if !(-0.5..=(self.rows as f64 - 0.5)).contains(&y) {
            return None;
        }
        let x = x.clamp(0.0, self.columns as f64 - 1.0);
        let y = y.clamp(0.0, self.rows as f64 - 1.0);

        let (column, row) = (x.floor(), y.floor());
        let (fx, fy) = ((x - column) as f32, (y - row) as f32);
        let (row, column) = (row as usize, column as usize);
        // The far side of the block, held inside the grid: the last row and
        // column read towards themselves, which is the nearest answer rather
        // than one wrapped round from the other edge of the country.
        let next_row = (row + 1).min(self.rows - 1);
        let next_column = (column + 1).min(self.columns - 1);

        let north_west = self.reading(row, column)?;
        let north_east = self.reading(row, next_column)?;
        let south_west = self.reading(next_row, column)?;
        let south_east = self.reading(next_row, next_column)?;

        let north = north_west + (north_east - north_west) * fx;
        let south = south_west + (south_east - south_west) * fx;
        Some(north + (south - north) * fy)
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

mod cache;
mod decode;
mod listing;
mod peak;
mod products;
mod tiles;
mod window;

pub(crate) use cache::*;
pub(crate) use decode::*;
pub(crate) use listing::*;
pub(crate) use peak::*;
pub(crate) use products::*;
pub(crate) use tiles::*;
pub(crate) use window::*;

#[cfg(test)]
mod testing;

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;

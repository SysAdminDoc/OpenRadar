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
const MAX_DECOMPRESSED_BYTES: usize = GRID_BYTES + 16 * 1024 * 1024;
// Raised from 512 MiB at eleven products and again at fourteen, when the
// flash flood grids arrived: the point of the budget is a ceiling, and the
// point of the capacity is one slot per product, so a screen with every layer
// on does not download the country once per layer. It is a ceiling rather
// than a reservation; nothing is allocated until a grid is actually decoded,
// and nobody has fourteen layers on.
const CACHE_BUDGET_BYTES: usize = 768 * 1024 * 1024;
/// As many grids as the budget holds, which is sixteen.
const MAX_CACHE_SLOTS: usize = CACHE_BUDGET_BYTES / GRID_BYTES;

/// How many grids one screen can be drawing at once, generously.
///
/// The guarantee the cache owes a reader: a screen with this many layers on
/// never evicts a grid it is about to want, so panning does not re-download
/// the country once per layer. Well past what anybody runs, and far short of
/// one slot for every product in the table.
const LAYERS_AT_ONCE: usize = 8;
/// As many grids as the budget holds.
///
/// Not one per product. A product nobody has switched on holds no grid, so a
/// slot reserved for each of them reserved memory nothing could ever use, and
/// made every new grid a reason to raise the ceiling: it had been raised at
/// eleven products and again at fourteen, and at seventeen it was at the
/// limit. What the cache actually owes is that a busy screen never evicts a
/// grid it is about to want, and that is `LAYERS_AT_ONCE` rather than the
/// size of the table.
///
/// Past the budget the oldest goes: somebody who turns on every layer at once
/// pays for it in downloads rather than in an unbounded pile of grids.
const CACHE_CAPACITY: usize = MAX_CACHE_SLOTS;
const _: () = assert!(CACHE_CAPACITY * GRID_BYTES <= CACHE_BUDGET_BYTES);
// The guarantee itself rather than a description of it, with the composite
// loop's next frame on top of the layers being drawn.
const _: () = assert!(CACHE_CAPACITY > LAYERS_AT_ONCE);
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
    /// The same product's bands for a reader who has asked for more contrast.
    /// Same values, colours that survive colour blindness.
    pub high_contrast_ramp: &'static [(f32, [u8; 3])],
    /// Values at or below this are not drawn at all.
    pub floor: f32,
    pub sampling: Sampling,
    /// The categories this grid holds, for a product whose numbers are names
    /// rather than a quantity. A grid with categories is never interpolated:
    /// halfway between snow and hail is not sleet, it is nothing.
    pub categories: Option<&'static [Category]>,
}

/// One value of a categorical grid: what it is, and what it is called.
#[derive(Clone, Copy)]
pub struct Category {
    pub value: f32,
    pub color: [u8; 3],
    /// A stable name the page translates. Not the wording itself, which is
    /// the page's business and is different in every language it speaks.
    pub id: &'static str,
}

impl MrmsProduct {
    /// The ramp this grid is drawn with, given what the reader asked for.
    pub fn ramp_for(&self, high_contrast: bool) -> &'static [(f32, [u8; 3])] {
        if high_contrast {
            self.high_contrast_ramp
        } else {
            self.ramp
        }
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

/// Azimuthal shear, in the units the product is published in: thousandths of a
/// reciprocal second, per the NSSL product table. Two is worth a look and the
/// top of the ramp is tornadic.
///
/// These stops used to be written as if the grid held reciprocal seconds, which
/// is a thousand times smaller than what arrives, so every cell with any shear
/// at all landed past the end of the ramp and the whole layer drew in one
/// colour.
const ROTATION_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, [0x38, 0xbd, 0xf8]),
    (4.0, [0x4a, 0xde, 0x80]),
    (6.0, [0xfa, 0xcc, 0x15]),
    (8.0, [0xfb, 0x92, 0x3c]),
    (10.0, [0xf4, 0x3f, 0x5e]),
    (14.0, [0xc0, 0x26, 0xd3]),
];

/// Azimuthal shear as the merged grids publish it, in thousandths of a
/// reciprocal second.
///
/// The same unit as a rotation track, and a different measurement: a track is
/// the largest shear a cell has held over a window, this is what the shear is
/// now. So the stops are lower. WDTD reads mid-level shear at or above 0.01
/// per second as a deep mesocyclone, which is ten here, and that is the stop
/// the legend names rather than the top of the ramp.
const AZ_SHEAR_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, [0x38, 0xbd, 0xf8]),
    (4.0, [0x4a, 0xde, 0x80]),
    (6.0, [0xfa, 0xcc, 0x15]),
    (8.0, [0xfb, 0x92, 0x3c]),
    (10.0, [0xf4, 0x3f, 0x5e]),
    (14.0, [0xc0, 0x26, 0xd3]),
];

/// How much water is packed into each metre of the column, in grams per cubic
/// metre: liquid divided by the depth of the echo.
///
/// The number that tells a tall wet storm from a hail storm. Above about three
/// and a half the column is holding more than rain can account for, which is
/// where the ramp turns.
const VIL_DENSITY_RAMP: &[(f32, [u8; 3])] = &[
    (0.5, [0x38, 0xbd, 0xf8]),
    (1.5, [0x4a, 0xde, 0x80]),
    (2.5, [0xfa, 0xcc, 0x15]),
    (3.5, [0xfb, 0x92, 0x3c]),
    (4.5, [0xf4, 0x3f, 0x5e]),
    (6.0, [0xc0, 0x26, 0xd3]),
];

/// The severe hail index, in joules per metre per second.
///
/// Witt's kinetic energy flux weighted between the freezing level and minus
/// twenty, and the number the probability and the size are both worked out
/// from. It has no natural ceiling; a serious hail storm runs into the
/// hundreds.
const SHI_RAMP: &[(f32, [u8; 3])] = &[
    (10.0, [0x38, 0xbd, 0xf8]),
    (50.0, [0x4a, 0xde, 0x80]),
    (100.0, [0xfa, 0xcc, 0x15]),
    (200.0, [0xfb, 0x92, 0x3c]),
    (350.0, [0xf4, 0x3f, 0x5e]),
    (600.0, [0xc0, 0x26, 0xd3]),
];

/// The probability of severe hail, as a percentage.
///
/// Witt's own curve off the severe hail index. Fifty is where the algorithm
/// was tuned to be right about half the time, so that is the middle of the
/// ramp rather than an arbitrary step.
const POSH_RAMP: &[(f32, [u8; 3])] = &[
    (10.0, [0x38, 0xbd, 0xf8]),
    (30.0, [0x4a, 0xde, 0x80]),
    (50.0, [0xfa, 0xcc, 0x15]),
    (70.0, [0xfb, 0x92, 0x3c]),
    (85.0, [0xf4, 0x3f, 0x5e]),
    (100.0, [0xc0, 0x26, 0xd3]),
];

/// Vertically integrated ice, in kilograms per square metre.
///
/// The frozen half of what a column is holding, worked out between the
/// freezing level and minus forty. Deep hail-bearing updraughts run high here
/// while a warm rain column stays near nothing.
const VII_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, [0x38, 0xbd, 0xf8]),
    (8.0, [0x4a, 0xde, 0x80]),
    (16.0, [0xfa, 0xcc, 0x15]),
    (25.0, [0xfb, 0x92, 0x3c]),
    (35.0, [0xf4, 0x3f, 0x5e]),
    (50.0, [0xc0, 0x26, 0xd3]),
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

/// A chance, as a percentage. Nothing below one in ten is worth painting a
/// county for.
const LIGHTNING_PROBABILITY_RAMP: &[(f32, [u8; 3])] = &[
    (10.0, [0x38, 0xbd, 0xf8]),
    (25.0, [0x4a, 0xde, 0x80]),
    (50.0, [0xfa, 0xcc, 0x15]),
    (75.0, [0xfb, 0x92, 0x3c]),
    (90.0, [0xf4, 0x3f, 0x5e]),
];

/// How far a cell's flash rate has jumped, in standard deviations.
///
/// Two sigma is the threshold the Warning Decision Training Division teaches
/// as worth looking at, which is where the ramp changes colour rather than
/// where it starts: a reader has to be able to see the approach to it.
const LIGHTNING_JUMP_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, [0x38, 0xbd, 0xf8]),
    (2.0, [0xfa, 0xcc, 0x15]),
    (3.0, [0xfb, 0x92, 0x3c]),
    (4.0, [0xf4, 0x3f, 0x5e]),
    (6.0, [0xc0, 0x26, 0xd3]),
];

/// How high the eighteen dBZ echo reaches, in kilometres. A summer storm tops
/// out around twelve; anything past fifteen is a serious updraft.
const ECHO_TOP_RAMP: &[(f32, [u8; 3])] = &[
    (3.0, [0x38, 0xbd, 0xf8]),
    (6.0, [0x4a, 0xde, 0x80]),
    (9.0, [0xfa, 0xcc, 0x15]),
    (12.0, [0xfb, 0x92, 0x3c]),
    (15.0, [0xf4, 0x3f, 0x5e]),
    (18.0, [0xc0, 0x26, 0xd3]),
];

/// Vertically integrated liquid, in kilograms per square metre: how much water
/// the column is holding. Hail shows up here before it reaches the ground.
const VIL_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, [0x38, 0xbd, 0xf8]),
    (5.0, [0x4a, 0xde, 0x80]),
    (12.0, [0xfa, 0xcc, 0x15]),
    (25.0, [0xfb, 0x92, 0x3c]),
    (40.0, [0xf4, 0x3f, 0x5e]),
    (60.0, [0xc0, 0x26, 0xd3]),
];

/// Rain rate in millimetres an hour. Fifty is a downpour; a hundred is the
/// sort of rate that floods a street in twenty minutes.
const PRECIP_RATE_RAMP: &[(f32, [u8; 3])] = &[
    (0.2, [0x38, 0xbd, 0xf8]),
    (1.0, [0x4a, 0xde, 0x80]),
    (5.0, [0xfa, 0xcc, 0x15]),
    (15.0, [0xfb, 0x92, 0x3c]),
    (35.0, [0xf4, 0x3f, 0x5e]),
    (75.0, [0xc0, 0x26, 0xd3]),
];

/// An hour of rain, in millimetres.
const QPE_HOUR_RAMP: &[(f32, [u8; 3])] = &[
    (0.5, [0x38, 0xbd, 0xf8]),
    (2.0, [0x4a, 0xde, 0x80]),
    (6.0, [0xfa, 0xcc, 0x15]),
    (15.0, [0xfb, 0x92, 0x3c]),
    (30.0, [0xf4, 0x3f, 0x5e]),
    (60.0, [0xc0, 0x26, 0xd3]),
];

/// A day of rain, in millimetres. A hundred is a flood watch in most places.
const QPE_DAY_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, [0x38, 0xbd, 0xf8]),
    (10.0, [0x4a, 0xde, 0x80]),
    (25.0, [0xfa, 0xcc, 0x15]),
    (50.0, [0xfb, 0x92, 0x3c]),
    (100.0, [0xf4, 0x3f, 0x5e]),
    (200.0, [0xc0, 0x26, 0xd3]),
];

/// The six steps every banded grid climbs through for a reader who has asked
/// for more contrast.
///
/// Eight of the ten products are drawn on the same ladder at their own values:
/// sky, green, yellow, orange, red, magenta. Measured with `crate::contrast`,
/// those six do stay apart under every colour vision, and the composite's NWS
/// reflectivity ramp does not: its worst neighbours come within 4.9 under
/// deuteranopia, between 40 and 45 dBZ.
///
/// What the shared ladder does not do is climb. Its yellow is lighter than the
/// red and the magenta above it, so nothing about a band says which way is
/// more: the reader has to match a hue against the legend, and on a failing
/// screen or in sunlight there is no reading left at all. This ladder is built
/// the way the high-contrast reflectivity ramp is. Lightness rises from one end
/// to the other, and what hue remains swings along the blue-yellow axis both
/// red-green deficiencies keep.
/// How the rain that has fallen compares with the guidance for flash
/// flooding, as a percentage of it.
///
/// A hundred is the number that matters: the rain has met what the office
/// says the ground can take before it floods. Below it the bands are wide,
/// because the difference between a quarter and a half of guidance is not a
/// decision; above it they are tight, because that is where one is being
/// made.
///
/// Percent rather than the plain ratio the product's own table implies. The
/// grids say so: on 2026-09-02 the peak was 137.64 against a radar QPE
/// peaking at 71 mm the same hour, which is guidance of about 51 mm, and a
/// plain ratio would have meant half a millimetre.
const FFG_RATIO_RAMP: &[(f32, [u8; 3])] = &[
    (25.0, [0x38, 0xbd, 0xf8]),
    (50.0, [0x4a, 0xde, 0x80]),
    (75.0, [0xfa, 0xcc, 0x15]),
    (100.0, [0xfb, 0x92, 0x3c]),
    (150.0, [0xf4, 0x3f, 0x5e]),
    (200.0, [0xc0, 0x26, 0xd3]),
];

const HIGH_CONTRAST_FFG_RATIO_RAMP: &[(f32, [u8; 3])] = &[
    (25.0, HIGH_CONTRAST_STEPS[0]),
    (50.0, HIGH_CONTRAST_STEPS[1]),
    (75.0, HIGH_CONTRAST_STEPS[2]),
    (100.0, HIGH_CONTRAST_STEPS[3]),
    (150.0, HIGH_CONTRAST_STEPS[4]),
    (200.0, HIGH_CONTRAST_STEPS[5]),
];

/// How much water the model has running off each square kilometre, in cubic
/// metres a second.
///
/// A model of the ground rather than a measurement of the sky, which is why
/// it is labelled as one. The bands are the ones the FLASH product's own
/// documentation groups by, and the top of the ramp is where a small stream
/// is out of its banks.
const UNIT_STREAMFLOW_RAMP: &[(f32, [u8; 3])] = &[
    (0.05, [0x38, 0xbd, 0xf8]),
    (0.2, [0x4a, 0xde, 0x80]),
    (0.5, [0xfa, 0xcc, 0x15]),
    (1.0, [0xfb, 0x92, 0x3c]),
    (2.0, [0xf4, 0x3f, 0x5e]),
    (5.0, [0xc0, 0x26, 0xd3]),
];

const HIGH_CONTRAST_UNIT_STREAMFLOW_RAMP: &[(f32, [u8; 3])] = &[
    (0.05, HIGH_CONTRAST_STEPS[0]),
    (0.2, HIGH_CONTRAST_STEPS[1]),
    (0.5, HIGH_CONTRAST_STEPS[2]),
    (1.0, HIGH_CONTRAST_STEPS[3]),
    (2.0, HIGH_CONTRAST_STEPS[4]),
    (5.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_STEPS: [[u8; 3]; 6] = [
    [0x00, 0x25, 0x6c],
    [0x00, 0x44, 0x7e],
    [0x44, 0x85, 0x49],
    [0x8a, 0x9f, 0x37],
    [0xcf, 0xb5, 0x3c],
    [0xff, 0xf2, 0xe3],
];

const HIGH_CONTRAST_ROTATION_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, HIGH_CONTRAST_STEPS[0]),
    (4.0, HIGH_CONTRAST_STEPS[1]),
    (6.0, HIGH_CONTRAST_STEPS[2]),
    (8.0, HIGH_CONTRAST_STEPS[3]),
    (10.0, HIGH_CONTRAST_STEPS[4]),
    (14.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_AZ_SHEAR_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, HIGH_CONTRAST_STEPS[0]),
    (4.0, HIGH_CONTRAST_STEPS[1]),
    (6.0, HIGH_CONTRAST_STEPS[2]),
    (8.0, HIGH_CONTRAST_STEPS[3]),
    (10.0, HIGH_CONTRAST_STEPS[4]),
    (14.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_VIL_DENSITY_RAMP: &[(f32, [u8; 3])] = &[
    (0.5, HIGH_CONTRAST_STEPS[0]),
    (1.5, HIGH_CONTRAST_STEPS[1]),
    (2.5, HIGH_CONTRAST_STEPS[2]),
    (3.5, HIGH_CONTRAST_STEPS[3]),
    (4.5, HIGH_CONTRAST_STEPS[4]),
    (6.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_SHI_RAMP: &[(f32, [u8; 3])] = &[
    (10.0, HIGH_CONTRAST_STEPS[0]),
    (50.0, HIGH_CONTRAST_STEPS[1]),
    (100.0, HIGH_CONTRAST_STEPS[2]),
    (200.0, HIGH_CONTRAST_STEPS[3]),
    (350.0, HIGH_CONTRAST_STEPS[4]),
    (600.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_POSH_RAMP: &[(f32, [u8; 3])] = &[
    (10.0, HIGH_CONTRAST_STEPS[0]),
    (30.0, HIGH_CONTRAST_STEPS[1]),
    (50.0, HIGH_CONTRAST_STEPS[2]),
    (70.0, HIGH_CONTRAST_STEPS[3]),
    (85.0, HIGH_CONTRAST_STEPS[4]),
    (100.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_VII_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, HIGH_CONTRAST_STEPS[0]),
    (8.0, HIGH_CONTRAST_STEPS[1]),
    (16.0, HIGH_CONTRAST_STEPS[2]),
    (25.0, HIGH_CONTRAST_STEPS[3]),
    (35.0, HIGH_CONTRAST_STEPS[4]),
    (50.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_MESH_RAMP: &[(f32, [u8; 3])] = &[
    (6.0, HIGH_CONTRAST_STEPS[0]),
    (19.0, HIGH_CONTRAST_STEPS[1]),
    (25.0, HIGH_CONTRAST_STEPS[2]),
    (45.0, HIGH_CONTRAST_STEPS[3]),
    (70.0, HIGH_CONTRAST_STEPS[4]),
    (100.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_LIGHTNING_RAMP: &[(f32, [u8; 3])] = &[
    (0.01, HIGH_CONTRAST_STEPS[0]),
    (0.10, HIGH_CONTRAST_STEPS[1]),
    (0.50, HIGH_CONTRAST_STEPS[2]),
    (1.00, HIGH_CONTRAST_STEPS[3]),
    (2.00, HIGH_CONTRAST_STEPS[4]),
    (4.00, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_LIGHTNING_PROBABILITY_RAMP: &[(f32, [u8; 3])] = &[
    (10.0, HIGH_CONTRAST_STEPS[0]),
    (25.0, HIGH_CONTRAST_STEPS[1]),
    (50.0, HIGH_CONTRAST_STEPS[2]),
    (75.0, HIGH_CONTRAST_STEPS[3]),
    (90.0, HIGH_CONTRAST_STEPS[4]),
];

const HIGH_CONTRAST_LIGHTNING_JUMP_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, HIGH_CONTRAST_STEPS[0]),
    (2.0, HIGH_CONTRAST_STEPS[1]),
    (3.0, HIGH_CONTRAST_STEPS[2]),
    (4.0, HIGH_CONTRAST_STEPS[3]),
    (6.0, HIGH_CONTRAST_STEPS[4]),
];

const HIGH_CONTRAST_ECHO_TOP_RAMP: &[(f32, [u8; 3])] = &[
    (3.0, HIGH_CONTRAST_STEPS[0]),
    (6.0, HIGH_CONTRAST_STEPS[1]),
    (9.0, HIGH_CONTRAST_STEPS[2]),
    (12.0, HIGH_CONTRAST_STEPS[3]),
    (15.0, HIGH_CONTRAST_STEPS[4]),
    (18.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_VIL_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, HIGH_CONTRAST_STEPS[0]),
    (5.0, HIGH_CONTRAST_STEPS[1]),
    (12.0, HIGH_CONTRAST_STEPS[2]),
    (25.0, HIGH_CONTRAST_STEPS[3]),
    (40.0, HIGH_CONTRAST_STEPS[4]),
    (60.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_PRECIP_RATE_RAMP: &[(f32, [u8; 3])] = &[
    (0.2, HIGH_CONTRAST_STEPS[0]),
    (1.0, HIGH_CONTRAST_STEPS[1]),
    (5.0, HIGH_CONTRAST_STEPS[2]),
    (15.0, HIGH_CONTRAST_STEPS[3]),
    (35.0, HIGH_CONTRAST_STEPS[4]),
    (75.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_QPE_HOUR_RAMP: &[(f32, [u8; 3])] = &[
    (0.5, HIGH_CONTRAST_STEPS[0]),
    (2.0, HIGH_CONTRAST_STEPS[1]),
    (6.0, HIGH_CONTRAST_STEPS[2]),
    (15.0, HIGH_CONTRAST_STEPS[3]),
    (30.0, HIGH_CONTRAST_STEPS[4]),
    (60.0, HIGH_CONTRAST_STEPS[5]),
];

/// Three days of rain, in millimetres. The bands are the day's, moved up:
/// three hundred over three days is the sort of total that puts a river out
/// rather than a street under.
const QPE_THREE_DAY_RAMP: &[(f32, [u8; 3])] = &[
    (5.0, [0x38, 0xbd, 0xf8]),
    (25.0, [0x4a, 0xde, 0x80]),
    (50.0, [0xfa, 0xcc, 0x15]),
    (100.0, [0xfb, 0x92, 0x3c]),
    (200.0, [0xf4, 0x3f, 0x5e]),
    (400.0, [0xc0, 0x26, 0xd3]),
];

const HIGH_CONTRAST_QPE_THREE_DAY_RAMP: &[(f32, [u8; 3])] = &[
    (5.0, HIGH_CONTRAST_STEPS[0]),
    (25.0, HIGH_CONTRAST_STEPS[1]),
    (50.0, HIGH_CONTRAST_STEPS[2]),
    (100.0, HIGH_CONTRAST_STEPS[3]),
    (200.0, HIGH_CONTRAST_STEPS[4]),
    (400.0, HIGH_CONTRAST_STEPS[5]),
];

const HIGH_CONTRAST_QPE_DAY_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, HIGH_CONTRAST_STEPS[0]),
    (10.0, HIGH_CONTRAST_STEPS[1]),
    (25.0, HIGH_CONTRAST_STEPS[2]),
    (50.0, HIGH_CONTRAST_STEPS[3]),
    (100.0, HIGH_CONTRAST_STEPS[4]),
    (200.0, HIGH_CONTRAST_STEPS[5]),
];

/// What the precipitation flag means, from the NSSL product table.
///
/// Discipline 209, category 6. The grid holds a category rather than an
/// amount, so the colours are chosen to be told apart rather than to run into
/// each other: blue for snow, pink for the mix, red for hail. Anything the
/// table does not name is left undrawn rather than guessed at, and so are the
/// two the table reserves: -3 for missing and -1 for outside coverage.
///
/// The values here are the ones the table publishes and the reason the fixture
/// test pins them: a category quietly renumbered upstream would paint snow as
/// convection with nothing on screen to say so.
///
/// The colours were searched rather than picked. Each category keeps a hue
/// somebody would expect and the search chose how light or dark it is, which
/// is what survives colour blindness: the worst pair of these is 17 apart
/// under the least forgiving of the three simulations, against the 10 the
/// ramps are held to, and none of them is dark enough to read as a hole in a
/// dark basemap.
const PRECIP_TYPES: &[Category] = &[
    Category {
        value: 1.0,
        color: [0xa6, 0xdd, 0xa0],
        id: "warmStratiform",
    },
    Category {
        value: 3.0,
        color: [0x62, 0xb6, 0xf5],
        id: "snow",
    },
    Category {
        value: 6.0,
        color: [0xb5, 0x7b, 0x0a],
        id: "convection",
    },
    Category {
        value: 7.0,
        color: [0xe0, 0x55, 0x55],
        id: "hail",
    },
    Category {
        value: 10.0,
        color: [0x6f, 0x5f, 0xc0],
        id: "coolStratiform",
    },
    Category {
        value: 91.0,
        color: [0x0a, 0x7a, 0x72],
        id: "tropicalStratiform",
    },
    Category {
        value: 96.0,
        color: [0xde, 0x6a, 0xa8],
        id: "tropicalConvection",
    },
];

/// The categories as a ramp, so every product has one.
///
/// Nothing draws from this: a categorical grid is matched exactly. It exists
/// because `ramp` is not optional and a ramp that disagreed with the
/// categories beside it would be a trap for whoever reads this next.
const PRECIP_TYPE_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, [0xa6, 0xdd, 0xa0]),
    (3.0, [0x62, 0xb6, 0xf5]),
    (6.0, [0xb5, 0x7b, 0x0a]),
    (7.0, [0xe0, 0x55, 0x55]),
    (10.0, [0x6f, 0x5f, 0xc0]),
    (91.0, [0x0a, 0x7a, 0x72]),
    (96.0, [0xde, 0x6a, 0xa8]),
];

pub const PRODUCTS: &[MrmsProduct] = &[
    MrmsProduct {
        id: "composite",
        folder: "MergedReflectivityQCComposite_00.50",
        label: "MRMS composite",
        unit: "dBZ",
        ramp: REFLECTIVITY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_REFLECTIVITY_RAMP,
        floor: 5.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "rotation",
        folder: "RotationTrack60min_00.50",
        label: "Rotation tracks, past hour",
        unit: "0.001/s",
        ramp: ROTATION_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_ROTATION_RAMP,
        floor: 2.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    // The other windows the same track is published over. One switch with a
    // duration beside it rather than five switches: they are the same
    // measurement over five windows and only one can be drawn at once.
    MrmsProduct {
        id: "rotation-30",
        folder: "RotationTrack30min_00.50",
        label: "Rotation tracks, past 30 min",
        unit: "0.001/s",
        ramp: ROTATION_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_ROTATION_RAMP,
        floor: 2.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "rotation-120",
        folder: "RotationTrack120min_00.50",
        label: "Rotation tracks, past 2 hours",
        unit: "0.001/s",
        ramp: ROTATION_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_ROTATION_RAMP,
        floor: 2.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "rotation-240",
        folder: "RotationTrack240min_00.50",
        label: "Rotation tracks, past 4 hours",
        unit: "0.001/s",
        ramp: ROTATION_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_ROTATION_RAMP,
        floor: 2.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "rotation-1440",
        folder: "RotationTrack1440min_00.50",
        label: "Rotation tracks, past day",
        unit: "0.001/s",
        ramp: ROTATION_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_ROTATION_RAMP,
        floor: 2.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    // Shear as it stands rather than the largest a cell has held. Published on
    // the finer 0.005 degree grid, which the decoder folds by two on the way
    // in like every other grid that arrives finer than the app draws.
    MrmsProduct {
        id: "az-shear-low",
        folder: "MergedAzShear_0-2kmAGL_00.50",
        label: "Azimuthal shear, 0 to 2 km",
        unit: "0.001/s",
        ramp: AZ_SHEAR_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_AZ_SHEAR_RAMP,
        floor: 2.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "az-shear-mid",
        folder: "MergedAzShear_3-6kmAGL_00.50",
        label: "Azimuthal shear, 3 to 6 km",
        unit: "0.001/s",
        ramp: AZ_SHEAR_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_AZ_SHEAR_RAMP,
        floor: 2.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "mesh",
        folder: "MESH_00.50",
        label: "Maximum estimated hail size",
        unit: "mm",
        ramp: MESH_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_MESH_RAMP,
        floor: 6.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "echo-tops",
        folder: "EchoTop_18_00.50",
        label: "Echo tops",
        unit: "km",
        ramp: ECHO_TOP_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_ECHO_TOP_RAMP,
        floor: 3.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "vil",
        folder: "VIL_00.50",
        label: "Vertically integrated liquid",
        unit: "kg/m2",
        ramp: VIL_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_VIL_RAMP,
        floor: 1.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "vil-density",
        folder: "VIL_Density_00.50",
        label: "Liquid per metre of column",
        unit: "g/m3",
        ramp: VIL_DENSITY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_VIL_DENSITY_RAMP,
        floor: 0.5,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "shi",
        folder: "SHI_00.50",
        label: "Severe hail index",
        unit: "J/m/s",
        ramp: SHI_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_SHI_RAMP,
        floor: 10.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "posh",
        folder: "POSH_00.50",
        label: "Probability of severe hail",
        unit: "%",
        ramp: POSH_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_POSH_RAMP,
        floor: 10.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "vii",
        folder: "VII_00.50",
        label: "Vertically integrated ice",
        unit: "kg/m2",
        ramp: VII_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_VII_RAMP,
        floor: 2.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "precip-rate",
        folder: "PrecipRate_00.00",
        label: "Rain rate",
        unit: "mm/h",
        ramp: PRECIP_RATE_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_PRECIP_RATE_RAMP,
        floor: 0.2,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "qpe-hour",
        folder: "RadarOnly_QPE_01H_00.00",
        label: "Rain in the past hour",
        unit: "mm",
        ramp: QPE_HOUR_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_QPE_HOUR_RAMP,
        floor: 0.5,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "qpe-day",
        folder: "RadarOnly_QPE_24H_00.00",
        label: "Rain in the past day",
        unit: "mm",
        ramp: QPE_DAY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_QPE_DAY_RAMP,
        floor: 2.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "gauge-qpe-hour",
        folder: "MultiSensor_QPE_01H_Pass2_00.00",
        label: "Rain in the past hour, gauge corrected",
        unit: "mm",
        ramp: QPE_HOUR_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_QPE_HOUR_RAMP,
        floor: 0.5,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "gauge-qpe-day",
        folder: "MultiSensor_QPE_24H_Pass2_00.00",
        label: "Rain in the past day, gauge corrected",
        unit: "mm",
        ramp: QPE_DAY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_QPE_DAY_RAMP,
        floor: 2.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "gauge-qpe-three-day",
        folder: "MultiSensor_QPE_72H_Pass2_00.00",
        label: "Rain in the past three days, gauge corrected",
        unit: "mm",
        ramp: QPE_THREE_DAY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_QPE_THREE_DAY_RAMP,
        floor: 5.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "ffg-hour",
        folder: "FLASH_QPE_FFG01H_00.00",
        label: "Rain against flash flood guidance, past hour",
        unit: "%",
        ramp: FFG_RATIO_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_FFG_RATIO_RAMP,
        // A quarter of guidance is the lowest number worth painting; below it
        // the map would be covered wherever it had rained at all.
        floor: 25.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "ffg-three-hour",
        folder: "FLASH_QPE_FFG03H_00.00",
        label: "Rain against flash flood guidance, past three hours",
        unit: "%",
        ramp: FFG_RATIO_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_FFG_RATIO_RAMP,
        floor: 25.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "unit-streamflow",
        folder: "FLASH_HP_MAXUNITSTREAMFLOW_00.00",
        label: "Modelled runoff",
        unit: "m3/s/km2",
        ramp: UNIT_STREAMFLOW_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_UNIT_STREAMFLOW_RAMP,
        floor: 0.05,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "hail-swath",
        folder: "MESH_Max_1440min_00.50",
        label: "Largest hail in the past day",
        unit: "mm",
        ramp: MESH_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_MESH_RAMP,
        floor: 6.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "lightning",
        folder: "NLDN_CG_005min_AvgDensity_00.00",
        label: "Cloud-to-ground lightning, 5 min",
        unit: "flashes/km2/min",
        ramp: LIGHTNING_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_LIGHTNING_RAMP,
        floor: 0.01,
        sampling: Sampling::Cells,
        categories: None,
    },
    // The rest of the cloud-to-ground density windows. One ramp across all
    // four on purpose: the unit is the same and the windows are only worth
    // having if a reader can compare them, which they cannot if each is
    // scaled to itself.
    MrmsProduct {
        id: "lightning-1min",
        folder: "NLDN_CG_001min_AvgDensity_00.00",
        label: "Cloud-to-ground lightning, 1 min",
        unit: "flashes/km2/min",
        ramp: LIGHTNING_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_LIGHTNING_RAMP,
        floor: 0.01,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "lightning-15min",
        folder: "NLDN_CG_015min_AvgDensity_00.00",
        label: "Cloud-to-ground lightning, 15 min",
        unit: "flashes/km2/min",
        ramp: LIGHTNING_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_LIGHTNING_RAMP,
        floor: 0.01,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "lightning-30min",
        folder: "NLDN_CG_030min_AvgDensity_00.00",
        label: "Cloud-to-ground lightning, 30 min",
        unit: "flashes/km2/min",
        ramp: LIGHTNING_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_LIGHTNING_RAMP,
        floor: 0.01,
        sampling: Sampling::Cells,
        categories: None,
    },
    // The two that are forecasts rather than observations. Everything the
    // workspace says about them has to carry that, which is why they are
    // labelled by what they are rather than by their folder.
    MrmsProduct {
        id: "lightning-probability-30min",
        folder: "LightningProbabilityNext30minGrid_scale_1",
        label: "Chance of lightning in 30 min",
        unit: "%",
        ramp: LIGHTNING_PROBABILITY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_LIGHTNING_PROBABILITY_RAMP,
        floor: 10.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "lightning-probability-60min",
        folder: "LightningProbabilityNext60minGrid_scale_1",
        label: "Chance of lightning in 60 min",
        unit: "%",
        ramp: LIGHTNING_PROBABILITY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_LIGHTNING_PROBABILITY_RAMP,
        floor: 10.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "lightning-jump",
        folder: "LtgJumpGrid_scale_1",
        label: "Lightning jump",
        unit: "sigma",
        ramp: LIGHTNING_JUMP_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_LIGHTNING_JUMP_RAMP,
        floor: 1.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    MrmsProduct {
        id: "lightning-jump-max",
        folder: "LtgJumpGrid_Max_005min_scale_1",
        label: "Largest lightning jump, 5 min",
        unit: "sigma",
        ramp: LIGHTNING_JUMP_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_LIGHTNING_JUMP_RAMP,
        floor: 1.0,
        sampling: Sampling::Cells,
        categories: None,
    },
    // Reflectivity at the height the air is cold enough for ice, which is
    // what a forecaster reads for lightning initiation rather than for rain.
    MrmsProduct {
        id: "reflectivity-minus-10c",
        folder: "Reflectivity_-10C_00.50",
        label: "Reflectivity at -10 C",
        unit: "dBZ",
        ramp: REFLECTIVITY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_REFLECTIVITY_RAMP,
        floor: 5.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "reflectivity-minus-20c",
        folder: "Reflectivity_-20C_00.50",
        label: "Reflectivity at -20 C",
        unit: "dBZ",
        ramp: REFLECTIVITY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_REFLECTIVITY_RAMP,
        floor: 5.0,
        sampling: Sampling::Nearest,
        categories: None,
    },
    MrmsProduct {
        id: "precip-type",
        folder: "PrecipFlag_00.00",
        label: "Precipitation type",
        // A category, not a quantity. The legend lists names rather than a
        // scale, and the unit line beside it would be wrong whatever it said.
        unit: "",
        // Never drawn from, because a category cannot be interpolated. Held
        // so every product has one and the ramp helpers stay total.
        ramp: PRECIP_TYPE_RAMP,
        high_contrast_ramp: PRECIP_TYPE_RAMP,
        // Zero is "no precipitation", which is most of the country most of
        // the time and is not something to paint over the map.
        floor: 0.5,
        sampling: Sampling::Nearest,
        categories: Some(PRECIP_TYPES),
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

/// A drawn tile belongs to the grid it came from and to the colour table it
/// was drawn with. Leaving the table out of the key would serve tiles in the
/// old colours after a new one is loaded.
fn tile_key(
    key: &str,
    zoom: u32,
    x: u32,
    y: u32,
    threshold: Option<f32>,
    high_contrast: bool,
) -> String {
    // The threshold is part of what the tile shows, so two tiles drawn at two
    // thresholds are two tiles. Leaving it out of the key served the first one
    // back for the second and the picture never changed.
    let floor = match threshold {
        Some(value) => format!("{value}"),
        None => String::from("-"),
    };
    // The ramp is part of what the tile shows for the same reason: a tile
    // drawn on the ordinary ramp must never be served to a reader who asked
    // for the high-contrast one.
    let ramp = if high_contrast { "hc" } else { "-" };
    format!(
        "{key}|{zoom}/{x}/{y}|{floor}|{ramp}|{}",
        palette::generation()
    )
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

/// The colour for one category, or nothing when the grid holds a value the
/// table does not name.
///
/// Matched on the nearest whole number rather than on equality: the grid is
/// packed as scaled integers and comes back through a float, so 3.0000002 is
/// snow and refusing it would leave the map empty.
fn category_color(categories: &[Category], value: f32) -> Option<[u8; 3]> {
    if !value.is_finite() {
        return None;
    }
    let wanted = value.round();
    categories
        .iter()
        .find(|category| category.value == wanted)
        .map(|category| category.color)
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
        let Some(end) = at.checked_add(length) else {
            return Err(MrmsError::NotGrib);
        };
        if length < 5 || end > bytes.len() {
            return Err(MrmsError::NotGrib);
        }
        let section = &bytes[at..end];

        match section[4] {
            3 => {
                if section.len() < 72 {
                    return Err(MrmsError::Decode("the grid definition is truncated".into()));
                }
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
                let points = columns
                    .checked_mul(rows)
                    .ok_or_else(|| MrmsError::Decode("the grid dimensions overflowed".into()))?;
                // A grid finer than the one this app draws at is reduced on
                // the way in rather than refused; anything that no allowed
                // reduction can fit is still refused here, before a byte of
                // it is read.
                if reduction_for(columns, rows, points, MAX_GRID_POINTS).is_none() {
                    return Err(MrmsError::Decode(format!(
                        "the grid claims {columns} by {rows} points"
                    )));
                }
                if !(-90.0..=90.0).contains(&north)
                    || d_lat <= 0.0
                    || d_lat > 10.0
                    || d_lon <= 0.0
                    || d_lon > 10.0
                {
                    return Err(MrmsError::Decode(
                        "the grid geometry is outside geographic bounds".into(),
                    ));
                }
                // Bit 1 set means west to east, bit 2 clear means north to
                // south. Anything else would be drawn upside down or mirrored.
                if scan_mode & 0b1100_0000 != 0 {
                    return Err(MrmsError::Unsupported(format!("scan mode {scan_mode}")));
                }
                // The bucket publishes eastward longitudes; the map works in
                // signed degrees.
                let west = if west > 180.0 { west - 360.0 } else { west };
                if !(-180.0..=180.0).contains(&west) {
                    return Err(MrmsError::Decode(
                        "the grid longitude is outside geographic bounds".into(),
                    ));
                }
                geometry = Some((columns, rows, north, west, d_lat, d_lon));
            }
            5 => {
                if section.len() < 19 {
                    return Err(MrmsError::Decode(
                        "the packing parameters are truncated".into(),
                    ));
                }
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
    let points = columns
        .checked_mul(rows)
        .ok_or_else(|| MrmsError::Decode("the grid dimensions are invalid".into()))?;
    let reduce = reduction_for(columns, rows, points, MAX_GRID_POINTS)
        .ok_or_else(|| MrmsError::Decode("the grid dimensions are invalid".into()))?;
    // A grid packed wider than sixteen bits comes back shifted down to
    // sixteen, and the binary exponent is moved by the same amount so the
    // values it produces are unchanged. See `decode_png_samples`.
    let (samples, shift) = decode_png_samples(payload, points, columns, reduce)?;
    let binary = binary
        .checked_add(shift)
        .ok_or_else(|| MrmsError::Decode("the packing scale is out of range".into()))?;

    // Checked on the exponent that will actually be used to read the values,
    // not the one the file declared. A wide grid declaring an exponent just
    // inside the finite range passed this and then evaluated to infinity in
    // every cell once the shift moved it past 2^127.
    let binary_scale = 2f32.powi(binary as i32);
    let decimal_scale = 10f32.powi(decimal as i32);
    if !reference.is_finite()
        || !binary_scale.is_finite()
        || binary_scale == 0.0
        || !decimal_scale.is_finite()
        || decimal_scale == 0.0
    {
        return Err(MrmsError::Decode("the packing scale is not finite".into()));
    }

    let (north, west, d_lat, d_lon) = reduced_geometry(north, west, d_lat, d_lon, reduce);
    Ok(Grid {
        columns: columns / reduce,
        rows: rows / reduce,
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

/// How much to shrink a grid by so it fits what this app draws at, or None
/// when nothing allowed would make it fit.
///
/// One means it already fits. Anything above that has to divide both axes
/// exactly: a reduction that dropped a partial row or column would move every
/// point below it, which is worse than refusing the grid.
fn reduction_for(columns: usize, rows: usize, points: usize, ceiling: usize) -> Option<usize> {
    if columns == 0 || rows == 0 {
        return None;
    }
    for reduce in 1..=MAX_SOURCE_REDUCTION {
        if columns % reduce != 0 || rows % reduce != 0 {
            continue;
        }
        if points / (reduce * reduce) <= ceiling {
            return Some(reduce);
        }
    }
    None
}

/// Where a reduced grid's first point sits and how far apart its points are.
///
/// The reduced grid covers the same ground, so its first point stands at the
/// centre of the block it was folded from rather than at that block's corner.
/// Anchored at the corner the whole field slides half a source cell north and
/// west, which on the finer grids is a few hundred metres of storm.
fn reduced_geometry(
    north: f64,
    west: f64,
    d_lat: f64,
    d_lon: f64,
    reduce: usize,
) -> (f64, f64, f64, f64) {
    let offset = (reduce - 1) as f64 / 2.0;
    (
        north - offset * d_lat,
        west + offset * d_lon,
        d_lat * reduce as f64,
        d_lon * reduce as f64,
    )
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

/// Reads the packed image, shrinking it by `reduce` in each axis as it goes.
///
/// Row by row, so a grid four times the size of the one this app draws never
/// exists in memory whole: the cost is the reduced grid plus the decoder's own
/// row buffer. The reduction keeps the LARGEST value in each block, which is
/// the only safe choice here. These grids are maxima over a window, and the
/// alternative, taking one point of the four, drops three quarters of a
/// rotation track or a hail swath on the floor. Sampling is on the packed
/// values rather than the scaled ones, which is the same answer: the scale is
/// a positive multiplier and a positive offset, so it cannot change which of
/// two samples is larger, and the smallest sample is what "no data" packs to.
fn decode_png_samples(
    payload: &[u8],
    expected: usize,
    columns: usize,
    reduce: usize,
) -> Result<(Vec<u16>, i16), MrmsError> {
    // The ceiling is on the SOURCE image, which is up to a reduction squared
    // larger than what is kept. It is a limit rather than an allocation.
    let limits = png::Limits {
        bytes: GRID_BYTES
            .saturating_mul(MAX_SOURCE_REDUCTION)
            .saturating_mul(MAX_SOURCE_REDUCTION),
    };
    let decoder = png::Decoder::new_with_limits(Cursor::new(payload), limits);
    let mut reader = decoder
        .read_info()
        .map_err(|error| MrmsError::Decode(error.to_string()))?;
    let info = reader.info();
    let (color_type, bit_depth) = (info.color_type, info.bit_depth);
    let image_points = (info.width as usize)
        .checked_mul(info.height as usize)
        .ok_or_else(|| MrmsError::Decode("the image dimensions overflowed".into()))?;
    if image_points != expected || image_points / (reduce * reduce) > MAX_GRID_POINTS {
        return Err(MrmsError::Decode(format!(
            "the image holds {image_points} values, the grid wants {expected}"
        )));
    }
    // Grayscale carries eight or sixteen bits a point. The flash flood grids
    // want twenty-four, and the packing spreads those across an RGB pixel,
    // most significant byte first. Nothing else is a picture in any sense.
    let wide: bool = match (color_type, bit_depth) {
        (png::ColorType::Grayscale, png::BitDepth::Eight | png::BitDepth::Sixteen) => false,
        // Kept as sixteen bits, which is what every grid in the cache
        // is; a wider sample would double the memory of every product. How
        // much has to go is worked out from the grid rather than assumed:
        // most twenty-four bit grids do not use the range, and the flash
        // flood ratios published on 2026-09-02 fit in sixteen bits exactly,
        // so nothing is lost at all. See `fold_to_sixteen_bits`.
        (png::ColorType::Rgb, png::BitDepth::Eight) => true,
        _ => {
            return Err(MrmsError::Unsupported(format!(
                "a {color_type:?} {bit_depth:?} bit image"
            )))
        }
    };

    let kept_columns = columns / reduce;
    // Held wide enough for the widest sample this reads, and narrowed once at
    // the end by however much the grid actually turns out to need.
    let mut samples: Vec<u32> = Vec::with_capacity(expected / (reduce * reduce));
    // The row being built, held across the `reduce` source rows that fold into
    // it. Empty between them, which is what says a new one has to be started.
    let mut folded: Vec<u32> = Vec::new();
    let mut source_row = 0usize;
    let mut line_values: Vec<u32> = Vec::new();
    while let Some(line) = reader
        .next_row()
        .map_err(|error| MrmsError::Decode(error.to_string()))?
    {
        let bytes = line.data();
        line_values.clear();
        match (color_type, bit_depth) {
            (png::ColorType::Grayscale, png::BitDepth::Sixteen) => {
                for pair in bytes.chunks_exact(2) {
                    line_values.push(u32::from(u16::from_be_bytes([pair[0], pair[1]])));
                }
            }
            (png::ColorType::Grayscale, png::BitDepth::Eight) => {
                line_values.extend(bytes.iter().map(|value| u32::from(*value)));
            }
            (png::ColorType::Rgb, png::BitDepth::Eight) => {
                // Most significant byte first, which is how the packing
                // spreads a sample wider than one channel.
                for pixel in bytes.chunks_exact(3) {
                    line_values.push(
                        (u32::from(pixel[0]) << 16)
                            | (u32::from(pixel[1]) << 8)
                            | u32::from(pixel[2]),
                    );
                }
            }
            _ => {
                return Err(MrmsError::Unsupported(format!(
                    "a {color_type:?} {bit_depth:?} bit image"
                )))
            }
        }
        if line_values.len() != columns {
            return Err(MrmsError::Decode(format!(
                "a row holds {} values, the grid wants {columns}",
                line_values.len()
            )));
        }

        if source_row % reduce == 0 {
            folded.clear();
            folded.resize(kept_columns, u32::MIN);
        }
        for (at, value) in line_values.iter().enumerate() {
            let into = at / reduce;
            if into < kept_columns {
                folded[into] = folded[into].max(*value);
            }
        }
        source_row += 1;
        if source_row % reduce == 0 {
            samples.extend_from_slice(&folded);
        }
    }

    let wanted = expected / (reduce * reduce);
    if source_row != expected / columns || samples.len() != wanted {
        return Err(MrmsError::Decode(format!(
            "the image holds {} values, the grid wants {wanted}",
            samples.len()
        )));
    }
    Ok(fold_to_sixteen_bits(samples, wide))
}

/// Narrows samples to the sixteen bits every grid in the cache holds, by as
/// little as the grid turns out to need.
///
/// A sample wider than sixteen bits has to lose something, and how much is
/// worth working out rather than assuming: a fixed shift of eight would have
/// quantised the flash flood ratios to two and a half percentage points,
/// across the hundred percent line the whole product is read against. Their
/// grids do not use the range they are packed in, so in practice nothing is
/// lost at all.
///
/// The shift comes back with the samples and the caller moves the binary
/// exponent by the same amount, which is what keeps the values the file
/// describes.
fn fold_to_sixteen_bits(samples: Vec<u32>, wide: bool) -> (Vec<u16>, i16) {
    if !wide {
        // Nothing above sixteen bits can be in here at all.
        return (samples.into_iter().map(|value| value as u16).collect(), 0);
    }
    let peak = samples.iter().copied().max().unwrap_or(0);
    let mut shift: i16 = 0;
    while (peak >> shift) > u32::from(u16::MAX) {
        shift += 1;
    }
    (
        samples
            .into_iter()
            .map(|value| (value >> shift) as u16)
            .collect(),
        shift,
    )
}

fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, MrmsError> {
    read_bounded(flate2::read::GzDecoder::new(bytes), MAX_DECOMPRESSED_BYTES)
}

fn read_bounded(reader: impl Read, limit: usize) -> Result<Vec<u8>, MrmsError> {
    let mut out = Vec::new();
    reader
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut out)
        .map_err(|error| MrmsError::Decode(error.to_string()))?;
    if out.len() > limit {
        return Err(MrmsError::Decode(format!(
            "the decompressed grid exceeds {limit} bytes"
        )));
    }
    Ok(out)
}

/// The regions the network publishes separately.
///
/// The grids do not overlap and are not one picture: each is its own
/// projection with its own resolution, published on its own schedule. The
/// decoder reads the geometry out of the file, so all any of this needs is
/// which folder to look in.
pub const DOMAINS: &[&str] = &["CONUS", "ALASKA", "HAWAII", "GUAM", "CARIB"];

/// Whether a name is one the bucket has, so nothing built from a request can
/// reach for a folder that is not there.
pub fn is_domain(name: &str) -> bool {
    DOMAINS.contains(&name)
}

fn listing_url(domain: &str, folder: &str, day: DateTime<Utc>) -> String {
    format!(
        "{BUCKET}/?list-type=2&prefix={domain}/{folder}/{:04}{:02}{:02}/",
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
pub fn key_for(domain: &str, entry: &MrmsProduct, time: i64) -> Option<String> {
    if !is_domain(domain) {
        return None;
    }
    let at = DateTime::from_timestamp(time, 0)?;
    let day = at.format("%Y%m%d");
    let stamp = at.format("%Y%m%d-%H%M%S");
    Some(format!(
        "{domain}/{folder}/{day}/MRMS_{folder}_{stamp}.grib2.gz",
        folder = entry.folder
    ))
}

/// What one tile request asks for.
pub struct TileRequest {
    /// Which of the network's regions the tile is from.
    pub domain: String,
    pub entry: &'static MrmsProduct,
    pub time: i64,
    pub zoom: u32,
    pub x: u32,
    pub y: u32,
    /// Hide anything below this, in the product's own unit.
    pub threshold: Option<f32>,
    /// Draw with the ramp built for a reader who asked for more contrast.
    pub high_contrast: bool,
}

/// Reads `/domain/product/time/z/x/y.png`, and an optional `?min=` or `?hc=`.
///
/// The domain may be left out, and then it is the lower forty-eight: that is
/// the address every tile had before the other regions were read, and a
/// bookmarked or cached one still has to work.
pub fn parse_tile_path(path: &str) -> Option<TileRequest> {
    let path = path.trim_start_matches('/');
    let (path, query) = match path.split_once('?') {
        Some((before, after)) => (before, Some(after)),
        None => (path, None),
    };
    // A threshold that is not a finite number is no threshold at all, rather
    // than a threshold of nothing, which would hide the whole picture.
    let threshold = query
        .and_then(|query| {
            query
                .split('&')
                .find_map(|pair| pair.strip_prefix("min="))
                .map(str::to_owned)
        })
        .and_then(|value| value.parse::<f32>().ok())
        .filter(|value| value.is_finite());
    // Anything but the flag itself is ordinary contrast, because a ramp is not
    // something to guess at from a malformed address.
    let high_contrast = query
        .map(|query| query.split('&').any(|pair| pair == "hc=1"))
        .unwrap_or(false);
    let stem = path.strip_suffix(".png").unwrap_or(path);
    let mut parts = stem.split('/').peekable();
    // A leading segment that names a region, or nothing and the old shape.
    let domain = match parts.peek() {
        Some(first) if is_domain(first) => {
            let named = (*first).to_string();
            parts.next();
            named
        }
        _ => "CONUS".to_string(),
    };
    let entry = product_by_id(parts.next()?)?;
    let time = parts.next()?.parse::<i64>().ok()?;
    let zoom = parts.next()?.parse::<u32>().ok()?;
    let x = parts.next()?.parse::<u32>().ok()?;
    let y = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() || zoom > 12 {
        return None;
    }
    Some(TileRequest {
        domain,
        entry,
        time,
        zoom,
        x,
        y,
        threshold,
        high_contrast,
    })
}

/// Answers one tile request: the bytes of a PNG, always. A tile with nothing
/// in it is a transparent pixel rather than an error, because a raster source
/// that gets a 404 logs a warning for every empty corner of the map.
pub async fn serve_tile(path: &str) -> Vec<u8> {
    let Some(asked) = parse_tile_path(path) else {
        return EMPTY_TILE.to_vec();
    };
    let TileRequest {
        domain,
        entry,
        time,
        zoom,
        x,
        y,
        threshold,
        high_contrast,
    } = asked;
    let Some(key) = key_for(&domain, entry, time) else {
        return EMPTY_TILE.to_vec();
    };

    // A frame that has been drawn once never decodes again, which is what
    // makes replaying the loop cheap.
    // The key already names the region, so it separates one region's tiles
    // from another's without anything else being said.
    let drawn = tile_key(&key, zoom, x, y, threshold, high_contrast);
    if let Some(bytes) = cached_tile(&drawn) {
        return bytes;
    }
    if grid_for(&key).await.is_err() {
        return EMPTY_TILE.to_vec();
    }
    let bytes = tile_from_cache(&key, entry, zoom, x, y, threshold, high_contrast)
        .unwrap_or_else(|| EMPTY_TILE.to_vec());
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
    /// For a grid whose numbers are names: the value, its colour, and the
    /// name the page translates. Absent for every ordinary product.
    pub categories: Option<Vec<(f32, String, &'static str)>>,
}

/// The catalogue, drawn the way the reader asked for.
///
/// The legend beside the map is built from these stops, so the flag has to
/// reach here as well as the tile address: a bar drawn on the ordinary ramp
/// beside a map drawn on the high-contrast one describes a picture nobody is
/// looking at.
#[tauri::command]
pub fn mrms_products(high_contrast: Option<bool>) -> Vec<MrmsProductInfo> {
    let high_contrast = high_contrast.unwrap_or(false);
    PRODUCTS
        .iter()
        .map(|entry| MrmsProductInfo {
            id: entry.id,
            label: entry.label,
            unit: entry.unit,
            floor: entry.floor,
            stops: entry
                .ramp_for(high_contrast)
                .iter()
                .map(|(value, color)| {
                    (
                        *value,
                        format!("#{:02x}{:02x}{:02x}", color[0], color[1], color[2]),
                    )
                })
                .collect(),
            categories: entry.categories.map(|categories| {
                categories
                    .iter()
                    .map(|category| {
                        (
                            category.value,
                            format!(
                                "#{:02x}{:02x}{:02x}",
                                category.color[0], category.color[1], category.color[2]
                            ),
                            category.id,
                        )
                    })
                    .collect()
            }),
        })
        .collect()
}

/// The newest grids a product has published, oldest first.
#[tauri::command]
pub async fn mrms_frames(
    product: String,
    limit: usize,
    // Which of the network's regions to read. Absent means the lower
    // forty-eight, which is what every caller wanted before there were others.
    domain: Option<String>,
) -> Result<Vec<MrmsFrame>, MrmsError> {
    let domain = domain.unwrap_or_else(|| "CONUS".to_string());
    if !is_domain(&domain) {
        return Err(MrmsError::UnknownProduct(domain));
    }
    let entry = product_by_id(&product).ok_or(MrmsError::UnknownProduct(product.clone()))?;
    let limit = limit.clamp(1, 60);
    let now = Utc::now();

    let mut frames = Vec::new();
    // Just after midnight UTC the day's folder holds only a frame or two, so
    // yesterday has to make up the rest of the loop.
    for day in [now - Duration::days(1), now] {
        let listing = http::get_bytes(&listing_url(&domain, entry.folder, day)).await?;
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
pub fn tile_pixels(
    grid: &Grid,
    entry: &MrmsProduct,
    zoom: u32,
    x: u32,
    y: u32,
    // Hide anything below this, on top of the product's own floor. It can only
    // ever hide more, never bring back what the floor already excluded.
    threshold: Option<f32>,
    // Draw on the ramp built for a reader who asked for more contrast. A
    // loaded colour table still wins: it is drawn as supplied rather than
    // altered, and the panel says so.
    high_contrast: bool,
) -> Option<Vec<u8>> {
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

    // A loaded colour table replaces this product's own ramp when it says it is
    // for the same unit, so the same storm comes out the same colours in every
    // tool that reads the file.
    let table = palette::for_unit(entry.unit);
    let own = table
        .as_ref()
        .map(|table| table.floor())
        .unwrap_or(entry.floor);
    let floor = match threshold {
        Some(asked) => own.max(asked),
        None => own,
    };

    let ramp = entry.ramp_for(high_contrast);
    let mut pixels = vec![0u8; TILE_SIZE * TILE_SIZE * 4];
    let mut painted = false;
    let mut paint = |row: usize, column: usize, value: f32| {
        // A categorical grid is matched, not interpolated, and a value the
        // table does not name is left clear. Halfway between snow and hail is
        // not sleet; it is a number nobody has defined.
        let color = match (entry.categories, &table) {
            (Some(categories), _) => {
                let Some(found) = category_color(categories, value) else {
                    return;
                };
                found
            }
            (None, Some(table)) => table.color(value),
            (None, None) => ramp_color(ramp, value),
        };
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
                    if !value.is_finite() || value < floor {
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
                    if !value.is_finite() || value < floor {
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

    remember_grid(&owned, grid);
    Ok(())
}

/// Puts a decoded grid in the cache, evicting the oldest when it is full.
fn remember_grid(key: &str, grid: Grid) {
    let Ok(mut cache) = CACHE.lock() else {
        return;
    };
    if cache.iter().any(|entry| entry.key == key) {
        return;
    }
    cache.push_back(CachedGrid {
        key: key.to_string(),
        grid,
    });
    while cache.len() > CACHE_CAPACITY {
        cache.pop_front();
    }
}

/// The part of a decoded grid inside a bounding box, as floats.
///
/// `west` and `north` are the outer edges of the corner cell rather than its
/// centre, because that is what a raster's tie point means. The grid itself
/// records centres, so the half cell is added here once instead of in every
/// reader.
#[derive(Debug)]
pub struct GridWindow {
    pub columns: usize,
    pub rows: usize,
    pub west: f64,
    pub north: f64,
    pub d_lon: f64,
    pub d_lat: f64,
    /// Row major from the north-west corner. A cell the grid does not cover
    /// is NaN; nothing else is altered, so the values the product reserves for
    /// missing and for outside coverage arrive as the numbers they are.
    pub values: Vec<f32>,
}

/// Why a window could not be cut.
#[derive(Debug, PartialEq, Eq)]
pub enum WindowError {
    /// The grid is not decoded, which means nobody drew it.
    NotCached,
    /// The box and the grid do not overlap at all.
    Outside,
    /// More cells than the caller allowed, so it can say to zoom in rather
    /// than write a raster nobody can open.
    TooLarge(usize),
}

/// Cuts a cached grid to a bounding box.
///
/// The size is worked out before a single sample is read, so an over-large ask
/// costs nothing and never allocates the raster it refused.
pub fn grid_window(
    key: &str,
    west: f64,
    south: f64,
    east: f64,
    north: f64,
    max_cells: usize,
) -> Result<GridWindow, WindowError> {
    let cache = CACHE.lock().map_err(|_| WindowError::NotCached)?;
    let grid = &cache
        .iter()
        .find(|held| held.key == key)
        .ok_or(WindowError::NotCached)?
        .grid;

    // Column and row indices of the cells the box touches, clamped to the
    // grid. The grid's north and west are cell CENTRES, so cell c covers
    // centre ± half a cell and the first one the box touches is the first
    // whose far edge is past the box's near edge. Reading these as edges
    // instead pulls in an extra cell of data on each side, which is a raster
    // wider than the view it claims to be.
    let first_column = ((west - grid.west) / grid.d_lon + 0.5).ceil() - 1.0;
    let last_column = ((east - grid.west) / grid.d_lon - 0.5).floor() + 1.0;
    let first_row = ((grid.north - north) / grid.d_lat + 0.5).ceil() - 1.0;
    let last_row = ((grid.north - south) / grid.d_lat - 0.5).floor() + 1.0;
    if last_column < 0.0
        || last_row < 0.0
        || first_column > (grid.columns - 1) as f64
        || first_row > (grid.rows - 1) as f64
    {
        return Err(WindowError::Outside);
    }
    let first_column = first_column.max(0.0) as usize;
    let first_row = first_row.max(0.0) as usize;
    let last_column = (last_column as usize).min(grid.columns - 1);
    let last_row = (last_row as usize).min(grid.rows - 1);

    let columns = last_column - first_column + 1;
    let rows = last_row - first_row + 1;
    let cells = columns * rows;
    if cells > max_cells {
        return Err(WindowError::TooLarge(cells));
    }

    let mut values = Vec::with_capacity(cells);
    for row in first_row..=last_row {
        for column in first_column..=last_column {
            values.push(grid.value(row, column));
        }
    }

    Ok(GridWindow {
        columns,
        rows,
        west: grid.west + first_column as f64 * grid.d_lon - grid.d_lon / 2.0,
        north: grid.north - first_row as f64 * grid.d_lat + grid.d_lat / 2.0,
        d_lon: grid.d_lon,
        d_lat: grid.d_lat,
        values,
    })
}

/// Draws a tile from a grid already decoded, without holding it across an await.
pub fn tile_from_cache(
    key: &str,
    entry: &MrmsProduct,
    zoom: u32,
    x: u32,
    y: u32,
    threshold: Option<f32>,
    high_contrast: bool,
) -> Option<Vec<u8>> {
    // The lock is held for the drawing, which reads the grid, and dropped
    // before the encode, which does not. Holding it across the encode
    // serialises every tile on the screen behind the slowest one.
    let pixels = {
        let cache = CACHE.lock().ok()?;
        let held = cache.iter().find(|held| held.key == key)?;
        tile_pixels(&held.grid, entry, zoom, x, y, threshold, high_contrast)?
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

    /// A five by four grid at a whole degree a cell, values that name their
    /// own row and column so a cut can be checked cell by cell.
    fn countable_grid() -> Grid {
        let columns = 5;
        let rows = 4;
        let mut samples = Vec::with_capacity(columns * rows);
        for row in 0..rows {
            for column in 0..columns {
                // value = sample / 10, so 10 * (row * 10 + column) reads back
                // as row * 10 + column.
                samples.push(((row * 10 + column) * 10) as u16);
            }
        }
        Grid {
            columns,
            rows,
            north: 40.0,
            west: -100.0,
            d_lat: 1.0,
            d_lon: 1.0,
            reference: 0.0,
            binary: 0,
            decimal: 1,
            samples,
        }
    }

    #[test]
    fn a_window_holds_the_cells_the_view_touches() {
        remember_grid("window/whole", countable_grid());
        // A box inside the grid, running from the centre of (row 1, column 1)
        // to the centre of (row 3, column 3). A cell counts when the box
        // touches any of it, so all nine come back rather than only the ones
        // whose centres are strictly inside.
        let cut = grid_window("window/whole", -99.0, 37.0, -97.0, 39.0, 100)
            .expect("the box is on the grid");
        assert_eq!((cut.columns, cut.rows), (3, 3));
        assert_eq!(
            cut.values,
            vec![11.0, 12.0, 13.0, 21.0, 22.0, 23.0, 31.0, 32.0, 33.0]
        );
        // The corner is the outer edge of the first cell, not its centre,
        // which is what a raster's tie point means. Half a cell north-west of
        // the centre of (1, 1) at -99, 39.
        assert!((cut.west + 99.5).abs() < 1e-9, "west {}", cut.west);
        assert!((cut.north - 39.5).abs() < 1e-9, "north {}", cut.north);
        assert_eq!((cut.d_lon, cut.d_lat), (1.0, 1.0));
    }

    #[test]
    fn a_window_takes_the_cells_the_box_is_actually_over() {
        remember_grid("window/offset", countable_grid());
        // A box whose corners fall inside cells rather than on their centres,
        // which is every real view. Cell c covers centre plus or minus half a
        // cell, so -98.4 is inside column 2 (which spans -98.5 to -97.5) and
        // -96.6 is inside column 3. Reading the corners as cell edges instead
        // pulls in column 1 and column 4 as well: two columns of data west and
        // east of anything the reader asked for.
        let cut = grid_window("window/offset", -98.4, 36.6, -96.6, 38.4, 100)
            .expect("the box is on the grid");
        assert_eq!((cut.columns, cut.rows), (2, 2));
        assert_eq!(cut.values, vec![22.0, 23.0, 32.0, 33.0]);
        assert!((cut.west + 98.5).abs() < 1e-9, "west {}", cut.west);
        assert!((cut.north - 38.5).abs() < 1e-9, "north {}", cut.north);
    }

    #[test]
    fn a_window_stops_at_the_edge_of_the_grid() {
        remember_grid("window/edge", countable_grid());
        // Asking for the whole world gets the whole grid and no more, rather
        // than rows of nothing padded out to the box.
        let cut = grid_window("window/edge", -180.0, -90.0, 180.0, 90.0, 100)
            .expect("the grid is inside the world");
        assert_eq!((cut.columns, cut.rows), (5, 4));
        assert_eq!(cut.values.len(), 20);
        assert_eq!(cut.values[0], 0.0);
        assert_eq!(cut.values[19], 34.0);

        // A box beside the grid rather than on it.
        assert_eq!(
            grid_window("window/edge", -80.0, 37.0, -70.0, 39.0, 100).err(),
            Some(WindowError::Outside)
        );
        // And one nobody has decoded.
        assert_eq!(
            grid_window("window/never-fetched", -99.0, 37.0, -97.0, 39.0, 100).err(),
            Some(WindowError::NotCached)
        );
    }

    #[test]
    fn a_window_too_large_is_refused_before_it_is_built() {
        remember_grid("window/large", countable_grid());
        assert_eq!(
            grid_window("window/large", -180.0, -90.0, 180.0, 90.0, 19).err(),
            Some(WindowError::TooLarge(20))
        );
        // One cell more of headroom and the same ask goes through.
        assert!(grid_window("window/large", -180.0, -90.0, 180.0, 90.0, 20).is_ok());
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
            .block_on(mrms_frames("composite".into(), 10, None))
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
            key_for("CONUS", entry, newest.time).as_deref(),
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
        let tile = tile_from_cache(&newest.key, entry, 4, 3, 5, None, false);
        let drawn = drawing.elapsed();
        assert!(
            tile.as_ref().is_some_and(|bytes| bytes.len() > 200),
            "the tile over the plains came out empty"
        );
        assert!(tile_from_cache(&newest.key, entry, 4, 8, 5, None, false).is_none());

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

    /// The finer grids cost what the coarse ones do, because they are folded.
    ///
    /// Azimuthal shear is published at 0.005 degrees, which is 14000 by 7000
    /// points: four times the cells of everything else in the table. It has to
    /// arrive as the same 0.01 degree grid the rest of the app draws, and it
    /// has to arrive inside the budget the composite is held to, or the finest
    /// product in the table is the one that makes the map stutter.
    #[test]
    #[ignore = "fetches a live grid from the MRMS archive"]
    fn a_finer_grid_is_folded_and_costs_what_a_coarse_one_does() {
        let _turn = live_test();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        for id in ["az-shear-low", "az-shear-mid"] {
            clear_caches();
            let entry = product_by_id(id).expect("the product is in the table");
            let frames = runtime
                .block_on(mrms_frames(id.into(), 3, None))
                .unwrap_or_else(|error| panic!("{id} publishes nothing: {error}"));
            let newest = frames.last().unwrap_or_else(|| panic!("{id} has no grid"));

            // What the bucket actually published, read out of the object's own
            // grid definition section rather than inferred from what came out
            // of the decoder. The decoder's answer is post-fold, so on its own
            // it cannot tell a folded fine grid from a coarse one, and the
            // whole claim here is that this product is the fine one.
            let raw = runtime
                .block_on(http::get_bytes(&format!("{BUCKET}/{}", newest.key)))
                .unwrap_or_else(|error| panic!("{id} would not fetch: {error}"));
            let plain = gunzip(&raw).expect("the object is gzip");
            let (source_columns, source_rows, source_step) = {
                let mut at = 16usize;
                let mut found = None;
                while at + 5 <= plain.len() && &plain[at..at + 4] != b"7777" {
                    let length = u32::from_be_bytes(plain[at..at + 4].try_into().unwrap()) as usize;
                    assert!(length >= 5 && at + length <= plain.len());
                    let section = &plain[at..at + length];
                    if section[4] == 3 {
                        found = Some((
                            u32::from_be_bytes(section[30..34].try_into().unwrap()) as usize,
                            u32::from_be_bytes(section[34..38].try_into().unwrap()) as usize,
                            u32::from_be_bytes(section[67..71].try_into().unwrap()) as f64 / 1e6,
                        ));
                        break;
                    }
                    at += length;
                }
                found.expect("the object carries a grid definition")
            };
            assert_eq!(
                (source_columns, source_rows),
                (14000, 7000),
                "{id} is no longer published on the fine grid"
            );
            assert!(
                (source_step - 0.005).abs() < 1e-9,
                "{id} is published at {source_step} degrees"
            );

            let started = std::time::Instant::now();
            runtime
                .block_on(grid_for(&newest.key))
                .unwrap_or_else(|error| panic!("{id} did not decode: {error}"));
            let decoded = started.elapsed();

            {
                let cache = CACHE.lock().expect("the cache");
                let held = cache
                    .iter()
                    .find(|held| held.key == newest.key)
                    .expect("the grid is cached");
                assert_eq!(
                    (held.grid.columns, held.grid.rows),
                    (7000, 3500),
                    "{id} was not folded to the grid the app draws"
                );
                assert!(
                    (held.grid.d_lat - 0.01).abs() < 1e-9,
                    "{id} came out at {} degrees",
                    held.grid.d_lat
                );
                // Folding anchors the first point at the centre of the block
                // it came from, so the field does not slide half a source cell
                // north and west. That lands it on the coarse grid's own
                // origin, which is what lets a reader compare shear against a
                // rotation track cell for cell.
                assert!(
                    (held.grid.north - 54.995).abs() < 1e-6,
                    "{id} starts at {}",
                    held.grid.north
                );
                assert!(
                    (held.grid.west + 129.995).abs() < 1e-6,
                    "{id} starts at {}",
                    held.grid.west
                );
            }

            let drawing = std::time::Instant::now();
            let _ = tile_from_cache(&newest.key, entry, 4, 3, 5, None, false);
            let drawn = drawing.elapsed();
            println!("{id}: decode {decoded:?}, tile {drawn:?}");

            // The same budget the composite is held to, not a looser one.
            assert!(
                decoded < std::time::Duration::from_secs(3),
                "{id} took {decoded:?} to decode"
            );
            assert!(
                drawn < std::time::Duration::from_millis(200),
                "{id} took {drawn:?} for one tile"
            );
        }
        clear_caches();
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
            .block_on(mrms_frames("composite".into(), 3, None))
            .expect("MRMS publishes grids");
        let time = frames.last().expect("a frame").time;

        // Zoom 4 tile 3/5 covers the middle of the country.
        let plains = runtime.block_on(serve_tile(&format!("/composite/{time}/4/3/5.png")));
        assert_eq!(&plains[1..4], b"PNG");
        assert!(plains.len() > EMPTY_TILE.len(), "the tile came back empty");

        // The same tile with a threshold on it: the reader's value has to
        // travel from the query, through the handler, into the drawing. It
        // reaches the drawing in tile_pixels whatever happens in between, so
        // only asking through the whole path can tell whether it arrives.
        let floored = runtime.block_on(serve_tile(&format!("/composite/{time}/4/3/5.png?min=60")));
        assert_eq!(&floored[1..4], b"PNG");
        assert!(
            floored.len() < plains.len(),
            "a threshold of sixty dBZ drew as much as no threshold at all:              {} bytes against {}",
            floored.len(),
            plains.len()
        );

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

        wrap_grib(
            grid_template,
            drt_template,
            scan_mode,
            columns,
            rows,
            &png_bytes,
        )
    }

    /// The same file with a twenty-four bit RGB data section, and a binary
    /// exponent one lower so the readings match the grayscale build's.
    fn synthetic_grib_rgb(columns: u32, rows: u32, samples: &[u32]) -> Vec<u8> {
        let png_bytes = rgb_png(columns, rows, samples);
        let mut out = wrap_grib(0, 41, 0, columns, rows, &png_bytes);
        // Section 5's binary exponent sits at a fixed offset, since
        // `wrap_grib` writes the sections before it at fixed sizes. GRIB
        // writes a signed integer as a sign bit plus magnitude, so minus one
        // is 0x8001 rather than two's complement.
        let at = 16 + 72 + 15;
        out[at..at + 2].copy_from_slice(&0x8001u16.to_be_bytes());
        out
    }

    fn wrap_grib(
        grid_template: u16,
        drt_template: u16,
        scan_mode: u8,
        columns: u32,
        rows: u32,
        png_bytes: &[u8],
    ) -> Vec<u8> {
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
        section7.extend_from_slice(png_bytes);
        out.extend_from_slice(&section7);

        out.extend_from_slice(b"7777");
        out
    }

    #[test]
    fn the_cache_does_not_grow_with_the_product_table() {
        // What replaced one slot per product. That rule made every new grid
        // cost fifty megabytes of ceiling whether or not anybody drew it, and
        // the ceiling had already been raised twice to keep up; at seventeen
        // products it sat exactly at the limit and the next one would have
        // failed the build.
        //
        // In `const` blocks because every operand is a constant: the same
        // words, checked when the crate is compiled rather than when the
        // suite is run, which is the stronger of the two and the form clippy
        // asks for.
        const {
            assert!(CACHE_CAPACITY == MAX_CACHE_SLOTS);
            assert!(
                CACHE_CAPACITY > LAYERS_AT_ONCE,
                "a busy screen would evict a grid it is about to want"
            );
            assert!(
                CACHE_CAPACITY * GRID_BYTES <= CACHE_BUDGET_BYTES,
                "the capacity is past the budget"
            );
            // The property the change was made for: the table is already
            // longer than a busy screen, and the capacity does not follow it.
            assert!(
                PRODUCTS.len() > LAYERS_AT_ONCE,
                "the table is smaller than a busy screen, so this proves nothing"
            );
        }
    }

    #[test]
    fn a_grid_finer_than_the_one_this_app_draws_is_reduced_rather_than_refused() {
        // MRMS moved the rotation tracks to 0.005 degrees, four times the
        // cells, and every one of them was refused: a shipped layer drew
        // nothing at all with a log line for an explanation. Four times the
        // cells is also four times the resident memory in a cache that holds
        // one grid per product, so the grid is reduced on the way in.
        assert_eq!(reduction_for(7000, 3500, 7000 * 3500, 24_500_000), Some(1));
        assert_eq!(
            reduction_for(14000, 7000, 14000 * 7000, 24_500_000),
            Some(2)
        );
        // Odd axes cannot be folded in half, and a reduction that dropped a
        // partial row would move every point below it.
        assert_eq!(reduction_for(14001, 7000, 14001 * 7000, 24_500_000), None);
        // Still too big after the most this will do.
        assert_eq!(reduction_for(28000, 14000, 28000 * 14000, 24_500_000), None);
        assert_eq!(reduction_for(0, 10, 0, 24_500_000), None);
    }

    #[test]
    fn a_reduced_grid_covers_the_same_ground_as_the_one_it_came_from() {
        // Anchored at the block's corner instead of its centre, the whole
        // field slides half a source cell north and west.
        let (north, west, d_lat, d_lon) = reduced_geometry(55.0, -130.0, 0.005, 0.005, 2);
        assert!((north - 54.9975).abs() < 1e-9, "north is {north}");
        assert!((west + 129.9975).abs() < 1e-9, "west is {west}");
        assert!((d_lat - 0.01).abs() < 1e-9);
        assert!((d_lon - 0.01).abs() < 1e-9);
        // A grid that already fits is left exactly alone.
        assert_eq!(
            reduced_geometry(55.0, -130.0, 0.01, 0.01, 1),
            (55.0, -130.0, 0.01, 0.01)
        );
    }

    /// A 24-bit sample spread across an RGB pixel, most significant byte
    /// first, which is how the flash flood grids are packed.
    fn rgb_png(width: u32, height: u32, samples: &[u32]) -> Vec<u8> {
        let mut png_bytes = Vec::new();
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().expect("a header");
        let raw: Vec<u8> = samples
            .iter()
            .flat_map(|value| {
                [
                    ((value >> 16) & 0xff) as u8,
                    ((value >> 8) & 0xff) as u8,
                    (value & 0xff) as u8,
                ]
            })
            .collect();
        writer.write_image_data(&raw).expect("image data");
        drop(writer);
        png_bytes
    }

    #[test]
    fn a_sample_spread_across_three_channels_is_read_back_whole() {
        // The flash flood grids are packed twenty-four bits wide, across an
        // RGB pixel rather than a grey one. Nothing offline covered this path
        // at all: reversing the channel order left every test in the crate
        // passing, and a grid read blue-first is a picture of nothing.
        // The low byte, the middle byte, the packed reading behind the
        // 137.64 percent this family peaked at on 2026-09-02, and the widest
        // sample sixteen bits still holds.
        let png_bytes = rgb_png(4, 1, &[0x00_00_01, 0x00_01_00, 0x00_35_C4, 0x00_FF_FF]);
        let (samples, shift) = decode_png_samples(&png_bytes, 4, 4, 1).expect("a wide grid");
        assert_eq!(shift, 0, "nothing here needs narrowing");
        assert_eq!(samples, vec![1, 256, 13_764, 65_535]);
    }

    #[test]
    fn a_wide_grid_is_narrowed_by_as_little_as_it_needs() {
        // Sixteen bits is what every grid in the cache holds, and a fixed
        // shift of eight would have quantised the flash flood ratios to two
        // and a half percentage points, straddling the hundred percent line
        // the product is read against. Their samples fit in sixteen bits, so
        // nothing is lost; a grid that genuinely uses the range loses only
        // what it has to.
        //
        // 13764 is the packed reading behind the 137.64 percent this grid
        // family peaked at on 2026-09-02.
        let narrow = rgb_png(2, 1, &[13_764, 65_535]);
        let (samples, shift) = decode_png_samples(&narrow, 2, 2, 1).expect("a wide grid");
        assert_eq!(shift, 0);
        assert_eq!(samples, vec![13_764, 65_535]);

        // One bit past what sixteen holds costs exactly one bit.
        let wide = rgb_png(2, 1, &[13_764, 65_536]);
        let (samples, shift) = decode_png_samples(&wide, 2, 2, 1).expect("a wide grid");
        assert_eq!(shift, 1);
        assert_eq!(samples, vec![13_764 / 2, 32_768]);

        // And a genuinely twenty-four bit grid costs eight.
        let widest = rgb_png(2, 1, &[0x00_00_10, 0xFF_FF_FF]);
        let (samples, shift) = decode_png_samples(&widest, 2, 2, 1).expect("a wide grid");
        assert_eq!(shift, 8);
        assert_eq!(samples, vec![0, 0xFF_FF]);
    }

    #[test]
    fn a_wide_grid_reads_the_values_the_file_describes() {
        // End to end, because the shift is only half of it: the exponent has
        // to move by the same amount or every reading is out by a factor of
        // two hundred and fifty six. Setting the shift to zero and leaving
        // the fold in place left the whole crate passing.
        let samples = [0u16, 20_000, 40_000, 65_535];
        let grayscale = synthetic_grib(0, 41, 0, 2, 2, (2, 2), &samples);
        let from_grey = decode_grib(&grayscale).expect("a grayscale grid");

        // The same readings, packed one bit wider so the fold has to move.
        let wide_samples: Vec<u32> = samples.iter().map(|s| u32::from(*s) * 2).collect();
        let wide = synthetic_grib_rgb(2, 2, &wide_samples);
        let from_wide = decode_grib(&wide).expect("a wide grid");

        for row in 0..2 {
            for column in 0..2 {
                let grey = from_grey.value(row, column);
                let widened = from_wide.value(row, column);
                assert!(
                    (grey - widened).abs() < 0.001,
                    "grayscale {grey} against wide {widened}"
                );
            }
        }
    }

    #[test]
    fn folding_a_grid_keeps_the_largest_value_in_each_block() {
        // These are maxima over a window: a rotation track is the strongest
        // rotation that passed over each square in an hour, and a hail swath
        // the largest stone. Taking one point of the four throws three
        // quarters of that on the floor, and the one it throws away is the
        // one somebody is looking for.
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, 4, 4);
            encoder.set_color(png::ColorType::Grayscale);
            encoder.set_depth(png::BitDepth::Sixteen);
            let mut writer = encoder.write_header().expect("a header");
            // Four blocks of four. The largest of each is 60, 8, 200, 12, and
            // in every block it sits in a different corner.
            let samples: [u16; 16] = [
                60, 1, 2, 3, //
                4, 5, 6, 8, //
                7, 9, 10, 11, //
                200, 13, 12, 5,
            ];
            let raw: Vec<u8> = samples.iter().flat_map(|s| s.to_be_bytes()).collect();
            writer.write_image_data(&raw).expect("image data");
        }
        let (folded, shift) = decode_png_samples(&png_bytes, 16, 4, 2).expect("a folded grid");
        assert_eq!(folded, vec![60, 8, 200, 12]);
        assert_eq!(shift, 0);

        // And a grid that needs no folding comes back exactly as it was.
        let (whole, _) = decode_png_samples(&png_bytes, 16, 4, 1).expect("a whole grid");
        assert_eq!(whole.len(), 16);
        assert_eq!(whole[0], 60);
        assert_eq!(whole[12], 200);
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

        let oversized = synthetic_grib(0, 41, 0, 10_000, 10_000, (2, 2), &samples);
        assert!(matches!(decode_grib(&oversized), Err(MrmsError::Decode(_))));

        let mut nonfinite = synthetic_grib(0, 41, 0, 2, 2, (2, 2), &samples);
        let section5 = 16 + 72;
        nonfinite[section5 + 11..section5 + 15].copy_from_slice(&f32::NAN.to_be_bytes());
        assert!(matches!(decode_grib(&nonfinite), Err(MrmsError::Decode(_))));
    }

    #[test]
    fn refuses_truncated_sections_and_decompression_overruns() {
        let mut truncated = b"GRIB\0\0\xd1\x02".to_vec();
        truncated.extend_from_slice(&0u64.to_be_bytes());
        truncated.extend_from_slice(&5u32.to_be_bytes());
        truncated.push(3);
        truncated.extend_from_slice(b"7777");
        assert!(matches!(decode_grib(&truncated), Err(MrmsError::Decode(_))));

        assert!(read_bounded(Cursor::new([1u8, 2, 3, 4]), 4).is_ok());
        assert!(matches!(
            read_bounded(Cursor::new([1u8, 2, 3, 4, 5]), 4),
            Err(MrmsError::Decode(_))
        ));
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
            tile_pixels(&quiet, entry, 4, 3, 5, None, false).is_none(),
            "a tile of clear air should not be sent"
        );

        // The same tile with one gate of real rain in it does get sent.
        let mut wet = quiet;
        wet.samples = vec![10490, 10490, 10490, 10490];
        assert!(tile_pixels(&wet, entry, 4, 3, 5, None, false).is_some());
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
            .block_on(mrms_frames("composite".into(), 1, None))
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

    /// Every product this offers has to actually be there and actually decode.
    /// A folder name is a guess until the bucket answers, a ramp is a guess
    /// until real values land on it, and a floor set too high draws nothing at
    /// all while looking like a quiet day.
    #[test]
    #[ignore = "fetches a live grid from the MRMS archive"]
    fn every_product_decodes_and_lands_on_its_own_ramp() {
        let _turn = live_test();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        for product in PRODUCTS {
            clear_caches();
            let frames = runtime
                .block_on(mrms_frames(product.id.into(), 1, None))
                .unwrap_or_else(|error| {
                    panic!(
                        "{} publishes nothing at {}: {error}",
                        product.id, product.folder
                    )
                });
            let key = frames
                .last()
                .unwrap_or_else(|| {
                    panic!("{} has no recent grid in {}", product.id, product.folder)
                })
                .key
                .clone();
            runtime
                .block_on(grid_for(&key))
                .unwrap_or_else(|error| panic!("{} did not decode: {error}", product.id));

            let cache = CACHE.lock().expect("the cache");
            let grid = &cache
                .iter()
                .find(|held| held.key == key)
                .expect("the grid is cached")
                .grid;

            // What the grid actually holds, against what the ramp expects.
            //
            // Every cell, not a stride: the sparse products are a few hundred
            // live cells in twenty-four million, so a stride can walk a whole
            // hail grid and touch none of them, and "nothing above the floor"
            // then says nothing at all.
            let mut above_floor = 0usize;
            let mut finite = 0usize;
            let mut peak: Option<f32> = None;
            for row in 0..grid.rows {
                for column in 0..grid.columns {
                    let value = grid.value(row, column);
                    if !value.is_finite() {
                        continue;
                    }
                    finite += 1;
                    peak = Some(peak.map_or(value, |held: f32| held.max(value)));
                    if value >= product.floor {
                        above_floor += 1;
                    }
                }
            }
            let top = product.ramp[product.ramp.len() - 1].0;
            println!(
                "{}: {above_floor} of {finite} cells over the {} floor, peak {} {}, ramp ends at {top}",
                product.id,
                product.floor,
                peak.map_or("none".into(), |value| format!("{value:.2}")),
                product.unit
            );

            // Started as `f32::MIN`, which is a finite number, so the check
            // that a grid decoded to something readable could never fail: a
            // field of nothing but missing values passed it. An option says
            // what the maximum of an empty set actually is.
            let peak = peak.unwrap_or_else(|| panic!("{} decoded to nothing readable", product.id));
            // Not "has data": a cell outside radar coverage decodes to a
            // large negative number rather than to NaN, so almost every cell
            // in the domain counts here. It catches a decode that came back
            // with a grid a fraction of the size it should be.
            assert!(
                finite > 1_000_000,
                "{}: only {finite} cells in the whole grid decoded",
                product.id
            );

            // The ramp has to be in the same world as the data. An order of
            // magnitude either way and the map is one flat colour or nothing.
            assert!(
                peak < top * 10.0,
                "{}: peak {peak} is far past the {top} the ramp ends at",
                product.id
            );
            // And the other way, which nothing checked: a grid published in a
            // unit a thousand times smaller than the ramp assumes draws an
            // empty layer and passes every upper bound there is. A field that
            // covers the country always has something above its own floor;
            // the scattered ones are reported rather than asserted, because
            // "no hail anywhere in the United States" is a fact about the
            // afternoon rather than about this code.
            if product.sampling == Sampling::Nearest {
                assert!(
                    above_floor > 0,
                    "{}: nothing in the country reached the {} floor, so either \
                     the floor is too high or the unit has moved",
                    product.id,
                    product.floor
                );
                assert!(
                    peak > top / 1000.0,
                    "{}: peak {peak} is far below the {top} the ramp ends at",
                    product.id
                );
            }
            drop(cache);
        }
    }

    /// The precipitation flag holds the categories the table names and nothing
    /// else.
    ///
    /// Live, because that is the only place the claim can be checked: the
    /// table is documentation and the grid is what actually arrives. A value
    /// nobody has defined turning up here means either the table has moved or
    /// the decode is wrong, and both of them paint the map a lie.
    ///
    /// Cheap as live tests go: this grid is a couple of hundred kilobytes
    /// rather than the fifty megabytes a reflectivity field expands to,
    /// because most of the country is one category most of the time.
    #[test]
    #[ignore = "fetches a live grid from the MRMS archive"]
    fn the_precipitation_flag_holds_only_the_categories_it_names() {
        let _turn = live_test();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        clear_caches();

        let entry = product_by_id("precip-type").expect("the precipitation flag");
        let frames = runtime
            .block_on(mrms_frames("precip-type".into(), 1, None))
            .expect("MRMS publishes the precipitation flag");
        let key = frames.last().expect("a frame").key.clone();
        runtime
            .block_on(grid_for(&key))
            .unwrap_or_else(|error| panic!("the flag did not decode: {error}"));

        let cache = CACHE.lock().expect("the cache");
        let grid = &cache
            .iter()
            .find(|held| held.key == key)
            .expect("the grid is cached")
            .grid;

        let categories = entry.categories.expect("a categorical grid");
        let mut unknown: Vec<f32> = Vec::new();
        let mut drawn = 0usize;
        for row in (0..grid.rows).step_by(5) {
            for column in (0..grid.columns).step_by(5) {
                let value = grid.value(row, column);
                if !value.is_finite() {
                    continue;
                }
                let whole = value.round();
                // Nothing falling, missing, and outside coverage, all of which
                // the table reserves and none of which is drawn.
                if whole == 0.0 || whole == -3.0 || whole == -1.0 {
                    continue;
                }
                if category_color(categories, value).is_some() {
                    drawn += 1;
                } else if !unknown.contains(&whole) {
                    unknown.push(whole);
                }
            }
        }
        println!("precip-type: {drawn} sampled cells in a named category");
        assert!(
            unknown.is_empty(),
            "the grid holds categories the table does not name: {unknown:?}"
        );
        drop(cache);
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
            .block_on(mrms_frames("rotation".into(), 1, None))
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
                .filter_map(|(x, y)| tile_pixels(grid, product, 4, *x, *y, None, false))
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
            tile_pixels(&grid, product, 4, 3, 5, None, false)
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

    #[test]
    fn a_threshold_hides_the_weak_cells_and_never_brings_back_the_hidden_ones() {
        // The grid runs from well under the composite's own floor to well
        // over it, so the count says exactly what was kept.
        let entry = product_by_id("composite").expect("composite");
        let grid_reference = solid_block().reference;
        let mut grid = solid_block();
        for (at, sample) in grid.samples.iter_mut().enumerate() {
            // Ten dBZ steps from 0 to 90 across the block. The grid holds
            // tenths above a reference of minus ninety-nine point nine.
            let dbz = (at % 10) as f32 * 10.0;
            *sample = ((dbz * 10.0) - grid_reference) as u16;
        }

        let (x, y) = tile_of(41.0, -94.0, 8);
        let painted = |floor: Option<f32>| {
            tile_pixels(&grid, entry, 8, x, y, floor, false)
                .map(|pixels| pixels.chunks_exact(4).filter(|p| p[3] > 0).count())
                .unwrap_or(0)
        };

        let whole = painted(None);
        assert!(whole > 0, "the fixture has to draw something");

        // A threshold hides, and hides more the higher it goes.
        let some = painted(Some(35.0));
        let more = painted(Some(65.0));
        assert!(some < whole, "35 dBZ hid nothing: {some} of {whole}");
        assert!(more < some, "65 dBZ hid no more than 35: {more} of {some}");
        assert_eq!(painted(Some(200.0)), 0, "nothing is that strong");

        // And it can only ever hide. A threshold under the product's own
        // floor must not bring back what the floor already excluded.
        assert!(entry.floor > 0.0, "this product has a floor to undercut");
        assert_eq!(
            painted(Some(-100.0)),
            whole,
            "a threshold below the floor widened the picture"
        );
        assert_eq!(painted(Some(0.0)), whole);
    }

    #[test]
    fn two_thresholds_are_two_tiles_rather_than_one_served_twice() {
        // The threshold is part of what the tile shows, so it has to be part
        // of the address the drawn tile is remembered under. Leaving it out
        // served the first reader's picture to the second.
        let plain = tile_key("k", 4, 3, 5, None, false);
        let low = tile_key("k", 4, 3, 5, Some(20.0), false);
        let high = tile_key("k", 4, 3, 5, Some(45.0), false);
        assert_ne!(plain, low);
        assert_ne!(low, high);
        assert_ne!(plain, high);
        // The same threshold is the same tile, or nothing would ever be
        // remembered at all.
        assert_eq!(low, tile_key("k", 4, 3, 5, Some(20.0), false));
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
        tile_pixels(grid, entry, zoom, x, y, None, false)
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

    /// The whole point of loading a colour table: what is on screen is drawn
    /// with it, and only for the product it says it is for.
    #[test]
    fn a_loaded_colour_table_draws_the_tiles() {
        let _turn = live_test();
        clear_caches();

        let entry = product_by_id("composite").expect("the composite product");
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
            // Fifty dBZ everywhere, which the built-in ramp draws bright red.
            samples: vec![10_490; 100 * 100],
        };

        let color_at = |zoom, x, y| {
            tile_pixels(&grid, entry, zoom, x, y, None, false).map(|pixels| {
                let first = pixels
                    .chunks_exact(4)
                    .find(|p| p[3] > 0)
                    .expect("a painted pixel");
                [first[0], first[1], first[2]]
            })
        };

        let built_in = color_at(6, 15, 23).expect("a tile");
        assert_eq!(built_in, [0xfd, 0x00, 0x00], "the built-in ramp changed");

        // A table saying fifty dBZ is black.
        crate::palette::set_palettes(vec![crate::palette::Table {
            units: Some("dBZ".into()),
            range_folded: None,
            stops: vec![crate::palette::Stop {
                value: 5.0,
                color: "#000000".into(),
                to_color: None,
                solid: false,
            }],
        }]);
        assert_eq!(
            color_at(6, 15, 23),
            Some([0x00, 0x00, 0x00]),
            "the loaded table did not reach the tiles"
        );

        // A table for a different unit leaves reflectivity alone.
        crate::palette::set_palettes(vec![crate::palette::Table {
            units: Some("mm".into()),
            range_folded: None,
            stops: vec![crate::palette::Stop {
                value: 5.0,
                color: "#000000".into(),
                to_color: None,
                solid: false,
            }],
        }]);
        assert_eq!(color_at(6, 15, 23), Some(built_in));

        // And clearing it puts the built-in ramp back.
        crate::palette::set_palettes(Vec::new());
        assert_eq!(color_at(6, 15, 23), Some(built_in));
        clear_caches();
    }

    #[test]
    fn a_moment_names_the_object_it_was_published_in() {
        let entry = product_by_id("composite").expect("the composite product");
        assert_eq!(
            key_for("CONUS", entry, 1788083202).as_deref(),
            Some(
                "CONUS/MergedReflectivityQCComposite_00.50/20260830/MRMS_MergedReflectivityQCComposite_00.50_20260830-094642.grib2.gz"
            )
        );
    }

    #[test]
    #[ignore = "asks the live MRMS bucket for every region"]
    fn every_region_the_network_publishes_decodes_and_draws() {
        // Four of these were unreachable until now: the map fell through the
        // whole chain to a personal-use tier for anybody in Alaska, Hawaii,
        // Guam or Puerto Rico. Each grid is its own projection at its own
        // resolution, so the only way to know the decoder reads them is to
        // read them.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let entry = product_by_id("composite").expect("composite");

        for domain in DOMAINS {
            let frames = runtime
                .block_on(mrms_frames("composite".into(), 1, Some((*domain).into())))
                .unwrap_or_else(|failure| panic!("{domain}: {failure}"));
            let newest = frames
                .last()
                .unwrap_or_else(|| panic!("{domain}: no frames"));

            let key =
                key_for(domain, entry, newest.time).unwrap_or_else(|| panic!("{domain}: no key"));
            assert!(key.starts_with(domain), "{key} is not in {domain}");

            runtime
                .block_on(grid_for(&key))
                .unwrap_or_else(|failure| panic!("{domain}: {failure}"));

            // The geometry comes out of the file, so this is the file saying
            // where it is rather than anything written down here.
            let (west, north, south, east, columns, rows) = {
                let cache = CACHE.lock().expect("the cache");
                let held = cache
                    .iter()
                    .find(|held| held.key == key)
                    .unwrap_or_else(|| panic!("{domain}: nothing decoded"));
                let grid = &held.grid;
                (
                    grid.west,
                    grid.north,
                    grid.north - grid.d_lat * grid.rows as f64,
                    grid.west + grid.d_lon * grid.columns as f64,
                    grid.columns,
                    grid.rows,
                )
            };
            assert!(columns > 100 && rows > 100, "{domain} is tiny");
            assert!((-180.0..=180.0).contains(&west), "{domain} west");
            assert!((-90.0..=90.0).contains(&south), "{domain} south");
            println!(
                "{domain}: {west:.2} to {east:.2} east, {south:.2} to {north:.2} north, {columns}x{rows}"
            );
        }
    }

    #[test]
    fn a_tile_request_is_read_strictly() {
        let asked = parse_tile_path("/composite/1788075402/6/14/24.png").expect("a tile");
        assert_eq!(asked.entry.id, "composite");
        assert_eq!(
            (asked.time, asked.zoom, asked.x, asked.y),
            (1788075402, 6, 14, 24)
        );
        assert_eq!(asked.threshold, None);
        // The same path without the extension, which is how a source may ask.
        assert!(parse_tile_path("mesh/1788075402/3/1/2").is_some());

        // The threshold rides along as a query, since the reader can change it
        // without the frame or the tile changing.
        let floored = parse_tile_path("/composite/1788075402/6/14/24.png?min=35").expect("a tile");
        assert_eq!(floored.threshold, Some(35.0));
        assert_eq!(floored.entry.id, "composite");
        assert_eq!(floored.zoom, 6);

        // A threshold that is not a number is no threshold, rather than a
        // threshold of nothing that would hide the whole picture.
        for query in ["?min=", "?min=abc", "?min=NaN", "?other=3"] {
            let asked = parse_tile_path(&format!("/composite/1788075402/6/14/24.png{query}"))
                .expect("still a tile");
            assert_eq!(asked.threshold, None, "{query}");
        }

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
        let products = mrms_products(None);
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
    /// Every product on the map wants one grid live, and a slot each is what
    /// keeps a screen from downloading the country once per layer. Half a
    /// gigabyte only holds ten of them, so past that the budget wins and the
    /// cache is as large as the memory allows rather than as large as the
    /// product list. That is a real limit, not a rounding: a decoded CONUS grid
    /// is fifty megabytes.
    ///
    /// The arithmetic itself is held by the `const _: () = assert!(...)` guards
    /// beside the constants, which fail the build rather than a test run. What
    /// is left to watch here is the eviction: that the cache drops the oldest
    /// grid instead of growing past the budget it was given.
    #[test]
    fn the_cache_evicts_rather_than_growing_past_its_budget() {
        let _turn = live_test();
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
        // A busy screen: every layer somebody actually has on at once, and
        // the composite loop's next frame beside them. None of these may be
        // evicted before the screen is drawn, which is the whole of what the
        // cache promises.
        let busy: Vec<String> = (0..=LAYERS_AT_ONCE)
            .map(|at| format!("layer {at}"))
            .collect();
        for id in &busy {
            remember_grid(id, grid());
        }
        for id in &busy {
            assert!(
                is_cached(id),
                "{id}'s grid was evicted before the screen was drawn"
            );
        }

        // Past capacity the oldest goes rather than the cache growing.
        for extra in 0..=CACHE_CAPACITY {
            remember_grid(&format!("extra {extra}"), grid());
        }
        assert!(
            !is_cached(&busy[0]),
            "the cache grew past its budget instead of evicting"
        );
        assert!(is_cached(&format!("extra {CACHE_CAPACITY}")));
        clear_caches();
    }

    #[test]
    fn every_product_is_drawn_the_way_its_data_is_shaped() {
        let expected = [
            ("composite", Sampling::Nearest),
            ("rotation", Sampling::Cells),
            ("rotation-30", Sampling::Cells),
            ("rotation-120", Sampling::Cells),
            ("rotation-240", Sampling::Cells),
            ("rotation-1440", Sampling::Cells),
            // Shear as it stands is scattered even more thinly than a track
            // over the same window, and it arrives on a grid four times as
            // fine, so it is walked rather than sampled per pixel.
            ("az-shear-low", Sampling::Cells),
            ("az-shear-mid", Sampling::Cells),
            ("mesh", Sampling::Cells),
            // Density is a ratio of two fields that cover the map, so it
            // covers the map too; the two hail indices and the probability
            // are cores.
            ("vil-density", Sampling::Nearest),
            ("shi", Sampling::Cells),
            ("posh", Sampling::Cells),
            ("vii", Sampling::Nearest),
            // The fields that cover the map are sampled per pixel; the ones
            // that are scattered single cells are walked, because a per-pixel
            // pass over a few hundred live cells in twenty-four million draws
            // an empty map.
            ("echo-tops", Sampling::Nearest),
            ("vil", Sampling::Nearest),
            ("precip-rate", Sampling::Nearest),
            ("qpe-hour", Sampling::Nearest),
            ("qpe-day", Sampling::Nearest),
            ("gauge-qpe-hour", Sampling::Nearest),
            ("gauge-qpe-day", Sampling::Nearest),
            ("gauge-qpe-three-day", Sampling::Nearest),
            // The flash flood grids cover whole basins rather than single
            // cells, so they are sampled per pixel like the rain they are
            // made from.
            ("ffg-hour", Sampling::Nearest),
            ("ffg-three-hour", Sampling::Nearest),
            ("unit-streamflow", Sampling::Nearest),
            ("hail-swath", Sampling::Cells),
            ("lightning", Sampling::Cells),
            // The other density windows are the same sparse cells as the
            // five-minute one.
            ("lightning-1min", Sampling::Cells),
            ("lightning-15min", Sampling::Cells),
            ("lightning-30min", Sampling::Cells),
            // A probability is a smooth field over whole counties, so it is
            // sampled per pixel rather than drawn cell by cell.
            ("lightning-probability-30min", Sampling::Nearest),
            ("lightning-probability-60min", Sampling::Nearest),
            // A jump belongs to a storm, and is as sparse as the flashes it
            // is counted from.
            ("lightning-jump", Sampling::Cells),
            ("lightning-jump-max", Sampling::Cells),
            // Reflectivity at a temperature is reflectivity: a continuous
            // field, drawn the way the composite is.
            ("reflectivity-minus-10c", Sampling::Nearest),
            ("reflectivity-minus-20c", Sampling::Nearest),
            ("precip-type", Sampling::Nearest),
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
        assert!(tile_pixels(&grid, entry, 4, 8, 5, None, false).is_none());
        // A tile index that does not exist at its zoom.
        assert!(tile_pixels(&grid, entry, 1, 4, 0, None, false).is_none());
    }

    /// Writes what the `mrms_grib` fuzz target starts from.
    ///
    /// Three length arithmetics stacked on each other: the gzip wrapper, the
    /// GRIB2 section chain, and a PNG-packed data section. A fuzzer that has
    /// to invent a valid PNG before it reaches the third one will spend its
    /// whole session on the first, so it is handed one that decodes.
    ///
    /// Ignored, because it writes files rather than checking anything. Run it
    /// when the builder changes:
    /// `cargo test --lib mrms::tests::writes -- --ignored`
    #[test]
    #[ignore = "writes the fuzz seed corpus rather than checking anything"]
    fn writes_the_fuzz_seed_corpus() {
        let into = std::path::Path::new("fuzz/seeds/mrms_grib");
        std::fs::create_dir_all(into).expect("a corpus directory");
        let samples = [9990u16, 10240, 10490, 0];

        // One that reads, and one of each shape the reader refuses, so the
        // fuzzer starts on both sides of every branch rather than one.
        let good = synthetic_grib(0, 41, 0, 2, 2, (2, 2), &samples);
        std::fs::write(into.join("png-packed"), &good).expect("a seed");
        std::fs::write(
            into.join("simple-packed"),
            synthetic_grib(0, 40, 0, 2, 2, (2, 2), &samples),
        )
        .expect("a seed");
        std::fs::write(
            into.join("lambert"),
            synthetic_grib(30, 41, 0, 2, 2, (2, 2), &samples),
        )
        .expect("a seed");
        std::fs::write(
            into.join("image-too-small"),
            synthetic_grib(0, 41, 0, 4, 4, (2, 2), &samples),
        )
        .expect("a seed");
        std::fs::write(into.join("half-a-grib"), &good[..good.len() / 2]).expect("a seed");
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

    /// Whether the grids stay readable to somebody who cannot see one of the
    /// primaries, held to the same numbers the single-site ramps are.
    mod colour_vision {
        use super::*;
        use crate::contrast::{
            closest_neighbours, lightness_climbs, worst_pair, ColorVision, EVERY_VISION,
        };

        /// Neighbouring bands have to stay apart for every kind of vision.
        /// About 2.3 is where two colours become distinguishable at all, so
        /// this is a multiple of that rather than a number chosen to let a
        /// particular ladder through.
        const NEIGHBOURS_APART: f32 = 10.0;

        #[test]
        fn every_high_contrast_grid_keeps_its_bands_apart() {
            for product in PRODUCTS.iter().filter(|p| p.categories.is_none()) {
                for vision in EVERY_VISION {
                    let (apart, from, to) = worst_pair(product.high_contrast_ramp, vision);
                    assert!(
                        apart >= NEIGHBOURS_APART,
                        "{}: {} brings {from} and {to} {} within {apart:.1}",
                        product.id,
                        vision.name(),
                        product.unit
                    );
                }
            }
        }

        /// More of the quantity is always lighter, which is what carries the
        /// reading when hue is gone entirely.
        #[test]
        fn every_high_contrast_grid_climbs_in_lightness() {
            // A categorical grid is exempt, and not by way of an excuse: snow
            // is not more than rain, so there is no direction for lightness to
            // carry. What those grids are held to instead is below: every pair
            // of categories has to be tellable apart, which is a harder test
            // than neighbours on a ramp.
            for product in PRODUCTS.iter().filter(|p| p.categories.is_none()) {
                assert!(
                    lightness_climbs(product.high_contrast_ramp, 0.5),
                    "{} falls back down",
                    product.id
                );
            }
        }

        /// Every category has to be tellable from every other one.
        ///
        /// A ramp only has to keep its neighbours apart, because a reader
        /// compares a colour against the bar beside it and two ends being
        /// similar is survivable. A category has no bar and no order: snow
        /// against hail is the whole question, and any pair collapsing is the
        /// layer saying the wrong thing rather than saying it vaguely.
        #[test]
        fn every_pair_of_categories_stays_apart() {
            for product in PRODUCTS {
                let Some(categories) = product.categories else {
                    continue;
                };
                for vision in EVERY_VISION {
                    for (at, one) in categories.iter().enumerate() {
                        for other in &categories[at + 1..] {
                            let apart = crate::contrast::distance(one.color, other.color, vision);
                            assert!(
                                apart >= NEIGHBOURS_APART,
                                "{}: {} brings {} and {} within {apart:.1}",
                                product.id,
                                vision.name(),
                                one.id,
                                other.id
                            );
                        }
                    }
                }
            }
        }

        /// What the ordinary ramps do, kept as tests so the reason for the
        /// second set is on the record rather than in an argument.
        ///
        /// The two problems are different. The composite is drawn on the NWS
        /// reflectivity scale, which collapses outright; the other nine share a
        /// ladder that stays apart and carries no order, because its yellow is
        /// lighter than the red and the magenta above it.
        #[test]
        fn the_ordinary_composite_ramp_collapses() {
            let composite = product_by_id("composite").expect("the composite product");
            let (apart, from, to) = worst_pair(composite.ramp, ColorVision::Deuteranopia);
            assert!(
                apart < NEIGHBOURS_APART,
                "the NWS scale was expected to collapse somewhere under deuteranopia, closest was {apart:.1} between {from} and {to}"
            );
            let better =
                closest_neighbours(composite.high_contrast_ramp, ColorVision::Deuteranopia);
            assert!(
                better > apart * 2.0,
                "the replacement should be further apart: {better:.1} against {apart:.1}"
            );
        }

        /// The shared ladder is readable and says nothing about which way is
        /// more, which is the other half of what contrast is for.
        #[test]
        fn the_ordinary_ladder_carries_no_order() {
            let rotation = product_by_id("rotation").expect("the rotation product");
            assert!(
                !lightness_climbs(rotation.ramp, 0.5),
                "the shared ladder was expected to fall back down in lightness"
            );
            assert!(lightness_climbs(rotation.high_contrast_ramp, 0.5));
        }

        /// Asking for more contrast may divide the range into fewer bands, and
        /// it may not move the ends of it. A ramp that started or stopped
        /// somewhere else would quietly change which readings are drawn at all.
        #[test]
        fn the_two_ramps_cover_the_same_ground() {
            for product in PRODUCTS {
                let contrast = product.high_contrast_ramp;
                assert_eq!(
                    product.ramp[0].0, contrast[0].0,
                    "{} starts somewhere else",
                    product.id
                );
                assert_eq!(
                    product.ramp[product.ramp.len() - 1].0,
                    contrast[contrast.len() - 1].0,
                    "{} stops somewhere else",
                    product.id
                );
                assert!(
                    contrast.windows(2).all(|pair| pair[1].0 > pair[0].0),
                    "{} runs out of order",
                    product.id
                );
                assert!(
                    contrast.len() <= product.ramp.len(),
                    "{} asks a reader to tell more bands apart, not fewer",
                    product.id
                );
            }
        }
    }

    /// The contrast choice has to travel in the address, or a tile drawn one
    /// way is served to a reader who asked for the other.
    #[test]
    fn the_tile_address_carries_the_contrast_choice() {
        let ordinary = parse_tile_path("/composite/1788075402/6/14/24.png?p=0").expect("a tile");
        assert!(!ordinary.high_contrast);
        let asked = parse_tile_path("/composite/1788075402/6/14/24.png?p=0&hc=1").expect("a tile");
        assert!(asked.high_contrast);
        // Anything else is ordinary contrast rather than a guess.
        for query in ["?hc=0", "?hc=yes", "?hc", "?min=20"] {
            let odd = parse_tile_path(&format!("/composite/1788075402/6/14/24.png{query}"))
                .expect("a tile");
            assert!(!odd.high_contrast, "{query} should not turn contrast on");
        }
    }

    #[test]
    fn two_contrast_choices_are_two_tiles() {
        let plain = tile_key("k", 4, 3, 5, None, false);
        let contrast = tile_key("k", 4, 3, 5, None, true);
        assert_ne!(plain, contrast);
        assert_eq!(contrast, tile_key("k", 4, 3, 5, None, true));
    }

    /// And the pixels actually differ, so the address is separating two
    /// pictures rather than two names for one.
    #[test]
    fn a_high_contrast_tile_is_drawn_on_the_other_ramp() {
        let grid = grid();
        let entry = product_by_id("composite").expect("the composite product");
        let plain = tile_pixels(&grid, entry, 4, 3, 5, None, false).expect("a tile");
        let contrast = tile_pixels(&grid, entry, 4, 3, 5, None, true).expect("a tile");
        assert_ne!(plain, contrast);
    }

    /// The precipitation flag's own numbers, from the NSSL product table.
    ///
    /// Written down here because the grid holds a category rather than a
    /// quantity: a number renumbered upstream, or a digit mistyped here, does
    /// not look wrong on the map. It paints snow as convection over half a
    /// state and says nothing about it.
    ///
    /// Source: https://www.nssl.noaa.gov/projects/mrms/operational/tables.php
    /// discipline 209, category 6.
    #[test]
    fn the_precipitation_categories_are_the_ones_the_table_publishes() {
        let entry = product_by_id("precip-type").expect("the precipitation flag");
        let categories = entry.categories.expect("a categorical grid");
        let named: Vec<(f32, &str)> = categories
            .iter()
            .map(|category| (category.value, category.id))
            .collect();
        assert_eq!(
            named,
            vec![
                (1.0, "warmStratiform"),
                (3.0, "snow"),
                (6.0, "convection"),
                (7.0, "hail"),
                (10.0, "coolStratiform"),
                (91.0, "tropicalStratiform"),
                (96.0, "tropicalConvection"),
            ]
        );

        // Zero is "no precipitation" and is not drawn, which is most of the
        // country most of the time.
        assert!(entry.floor > 0.0 && entry.floor < 1.0);
        // And it carries no unit, because a category is not measured in
        // anything. A unit line beside it would be wrong whatever it said.
        assert_eq!(entry.unit, "");
    }

    /// A value the table does not name is left clear rather than guessed at.
    #[test]
    fn a_category_nobody_defined_is_not_painted() {
        let entry = product_by_id("precip-type").expect("the precipitation flag");
        let categories = entry.categories.expect("a categorical grid");
        for value in [-3.0, -1.0, 0.0, 2.0, 4.0, 5.0, 8.0, 9.0, 11.0, 50.0, 99.0] {
            assert!(
                category_color(categories, value).is_none(),
                "{value} is not a category and must not be drawn"
            );
        }
        // The grid arrives as scaled integers through a float, so a reading a
        // hair off a whole number is still that category.
        assert_eq!(
            category_color(categories, 3.0000002),
            category_color(categories, 3.0),
        );
        assert!(category_color(categories, f32::NAN).is_none());
    }

    /// Snow is drawn as snow, wherever the flag says so.
    #[test]
    fn the_categorical_grid_never_borrows_the_rain_ramp() {
        // A grid of nothing but snow, drawn as tiles.
        let mut grid = grid();
        grid.samples = vec![30; grid.samples.len()];
        grid.decimal = 1;
        grid.reference = 0.0;
        let entry = product_by_id("precip-type").expect("the precipitation flag");
        let pixels = tile_pixels(&grid, entry, 4, 3, 5, None, false).expect("a tile");
        let snow = entry
            .categories
            .unwrap()
            .iter()
            .find(|category| category.id == "snow")
            .expect("snow")
            .color;
        let drawn: Vec<[u8; 3]> = pixels
            .chunks(4)
            .filter(|pixel| pixel[3] > 0)
            .map(|pixel| [pixel[0], pixel[1], pixel[2]])
            .collect();
        assert!(!drawn.is_empty(), "the tile drew nothing");
        for pixel in &drawn {
            assert_eq!(*pixel, snow, "a snow gate came out another colour");
        }
        // And not the reflectivity ramp's colour for the same number, which
        // is what drawing it as rain would have looked like.
        assert_ne!(snow, ramp_color(REFLECTIVITY_RAMP, 3.0));
    }

    #[test]
    fn the_legend_follows_the_ramp_in_force() {
        let ordinary = mrms_products(Some(false));
        let contrast = mrms_products(Some(true));
        let hex = |ramp: &[(f32, [u8; 3])], at: usize| {
            format!(
                "#{:02x}{:02x}{:02x}",
                ramp[at].1[0], ramp[at].1[1], ramp[at].1[2]
            )
        };
        for (index, product) in PRODUCTS.iter().enumerate() {
            assert_eq!(ordinary[index].stops[0].1, hex(product.ramp, 0));
            assert_eq!(
                contrast[index].stops[0].1,
                hex(product.high_contrast_ramp, 0),
                "{} kept its ordinary colours",
                product.id
            );
            // Whatever the bar is drawn from, it covers the same ground.
            assert_eq!(ordinary[index].stops[0].0, contrast[index].stops[0].0);
            assert_eq!(
                ordinary[index].stops.last().unwrap().0,
                contrast[index].stops.last().unwrap().0
            );
            assert_eq!(
                contrast[index].stops.len(),
                product.high_contrast_ramp.len()
            );
        }
    }
}

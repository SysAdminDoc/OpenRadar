//! What MRMS publishes, and the colours each product is drawn in.
//!
//! The table is the app's own reading of the bucket: which folder a
//! product lives in, what its samples mean, and the ramp its values are
//! painted through. Two ramps apiece, because a reader who asks the
//! system for more contrast is asking about this.

use super::*;

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
    /// The heights this one is published at, for the three that are published
    /// at more than one.
    ///
    /// The network builds a three-dimensional grid and publishes reflectivity,
    /// correlation and differential reflectivity at every height of it, which
    /// is thirty-three folders each. Ninety-nine rows in this table would say
    /// the same thing ninety-nine times, so a family is one row and the height
    /// travels beside the product wherever it goes: into the folder name, and
    /// so into the object key and the grid cache, which is what keeps two
    /// heights of one field from being the same picture.
    pub levels: Option<&'static [(&'static str, f32)]>,
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
    /// The height to read this product at, given what was asked for.
    ///
    /// `None` for a product published at one height, whatever was asked: a
    /// height on the composite is a reader's address being wrong rather than a
    /// different picture. For a family, the asked-for height when the network
    /// publishes it and the lowest otherwise, so a stale address or a level
    /// the network drops still draws something rather than nothing.
    pub fn level_for(&self, asked: Option<&str>) -> Option<&'static str> {
        let levels = self.levels?;
        let found = asked.and_then(|want| {
            levels
                .iter()
                .find(|(name, _)| *name == want)
                .map(|(name, _)| *name)
        });
        Some(found.unwrap_or(levels[0].0))
    }

    /// The bucket folder this product's grids live in at a height.
    ///
    /// The folder is the whole address: it goes into the listing and into the
    /// object key, and the object key is the grid cache's own key, so two
    /// heights of one field cannot be confused for one another anywhere
    /// downstream of here.
    pub fn folder_at(&self, level: Option<&str>) -> Cow<'static, str> {
        match self.level_for(level) {
            Some(level) => Cow::Owned(format!("{}_{level}", self.folder)),
            None => Cow::Borrowed(self.folder),
        }
    }

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
pub(crate) const REFLECTIVITY_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const ROTATION_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const AZ_SHEAR_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const VIL_DENSITY_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const SHI_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const POSH_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const VII_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, [0x38, 0xbd, 0xf8]),
    (8.0, [0x4a, 0xde, 0x80]),
    (16.0, [0xfa, 0xcc, 0x15]),
    (25.0, [0xfb, 0x92, 0x3c]),
    (35.0, [0xf4, 0x3f, 0x5e]),
    (50.0, [0xc0, 0x26, 0xd3]),
];

/// Maximum estimated hail size in millimetres, banded the way warnings are:
/// quarter, golf ball, baseball.
pub(crate) const MESH_RAMP: &[(f32, [u8; 3])] = &[
    (6.0, [0x38, 0xbd, 0xf8]),
    (19.0, [0x4a, 0xde, 0x80]),
    (25.0, [0xfa, 0xcc, 0x15]),
    (45.0, [0xfb, 0x92, 0x3c]),
    (70.0, [0xf4, 0x3f, 0x5e]),
    (100.0, [0xc0, 0x26, 0xd3]),
];

/// Cloud-to-ground flashes per square kilometre per minute, over five
/// minutes. Even a busy storm rarely passes four.
pub(crate) const LIGHTNING_RAMP: &[(f32, [u8; 3])] = &[
    (0.01, [0x38, 0xbd, 0xf8]),
    (0.10, [0x4a, 0xde, 0x80]),
    (0.50, [0xfa, 0xcc, 0x15]),
    (1.00, [0xfb, 0x92, 0x3c]),
    (2.00, [0xf4, 0x3f, 0x5e]),
    (4.00, [0xc0, 0x26, 0xd3]),
];

/// A chance, as a percentage. Nothing below one in ten is worth painting a
/// county for.
pub(crate) const LIGHTNING_PROBABILITY_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const LIGHTNING_JUMP_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, [0x38, 0xbd, 0xf8]),
    (2.0, [0xfa, 0xcc, 0x15]),
    (3.0, [0xfb, 0x92, 0x3c]),
    (4.0, [0xf4, 0x3f, 0x5e]),
    (6.0, [0xc0, 0x26, 0xd3]),
];

/// How high the eighteen dBZ echo reaches, in kilometres. A summer storm tops
/// out around twelve; anything past fifteen is a serious updraft.
pub(crate) const ECHO_TOP_RAMP: &[(f32, [u8; 3])] = &[
    (3.0, [0x38, 0xbd, 0xf8]),
    (6.0, [0x4a, 0xde, 0x80]),
    (9.0, [0xfa, 0xcc, 0x15]),
    (12.0, [0xfb, 0x92, 0x3c]),
    (15.0, [0xf4, 0x3f, 0x5e]),
    (18.0, [0xc0, 0x26, 0xd3]),
];

/// Vertically integrated liquid, in kilograms per square metre: how much water
/// the column is holding. Hail shows up here before it reaches the ground.
pub(crate) const VIL_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, [0x38, 0xbd, 0xf8]),
    (5.0, [0x4a, 0xde, 0x80]),
    (12.0, [0xfa, 0xcc, 0x15]),
    (25.0, [0xfb, 0x92, 0x3c]),
    (40.0, [0xf4, 0x3f, 0x5e]),
    (60.0, [0xc0, 0x26, 0xd3]),
];

/// Rain rate in millimetres an hour. Fifty is a downpour; a hundred is the
/// sort of rate that floods a street in twenty minutes.
pub(crate) const PRECIP_RATE_RAMP: &[(f32, [u8; 3])] = &[
    (0.2, [0x38, 0xbd, 0xf8]),
    (1.0, [0x4a, 0xde, 0x80]),
    (5.0, [0xfa, 0xcc, 0x15]),
    (15.0, [0xfb, 0x92, 0x3c]),
    (35.0, [0xf4, 0x3f, 0x5e]),
    (75.0, [0xc0, 0x26, 0xd3]),
];

/// An hour of rain, in millimetres.
pub(crate) const QPE_HOUR_RAMP: &[(f32, [u8; 3])] = &[
    (0.5, [0x38, 0xbd, 0xf8]),
    (2.0, [0x4a, 0xde, 0x80]),
    (6.0, [0xfa, 0xcc, 0x15]),
    (15.0, [0xfb, 0x92, 0x3c]),
    (30.0, [0xf4, 0x3f, 0x5e]),
    (60.0, [0xc0, 0x26, 0xd3]),
];

/// A day of rain, in millimetres. A hundred is a flood watch in most places.
pub(crate) const QPE_DAY_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const FFG_RATIO_RAMP: &[(f32, [u8; 3])] = &[
    (25.0, [0x38, 0xbd, 0xf8]),
    (50.0, [0x4a, 0xde, 0x80]),
    (75.0, [0xfa, 0xcc, 0x15]),
    (100.0, [0xfb, 0x92, 0x3c]),
    (150.0, [0xf4, 0x3f, 0x5e]),
    (200.0, [0xc0, 0x26, 0xd3]),
];

pub(crate) const HIGH_CONTRAST_FFG_RATIO_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const UNIT_STREAMFLOW_RAMP: &[(f32, [u8; 3])] = &[
    (0.05, [0x38, 0xbd, 0xf8]),
    (0.2, [0x4a, 0xde, 0x80]),
    (0.5, [0xfa, 0xcc, 0x15]),
    (1.0, [0xfb, 0x92, 0x3c]),
    (2.0, [0xf4, 0x3f, 0x5e]),
    (5.0, [0xc0, 0x26, 0xd3]),
];

pub(crate) const HIGH_CONTRAST_UNIT_STREAMFLOW_RAMP: &[(f32, [u8; 3])] = &[
    (0.05, HIGH_CONTRAST_STEPS[0]),
    (0.2, HIGH_CONTRAST_STEPS[1]),
    (0.5, HIGH_CONTRAST_STEPS[2]),
    (1.0, HIGH_CONTRAST_STEPS[3]),
    (2.0, HIGH_CONTRAST_STEPS[4]),
    (5.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_STEPS: [[u8; 3]; 6] = [
    [0x00, 0x25, 0x6c],
    [0x00, 0x44, 0x7e],
    [0x44, 0x85, 0x49],
    [0x8a, 0x9f, 0x37],
    [0xcf, 0xb5, 0x3c],
    [0xff, 0xf2, 0xe3],
];

pub(crate) const HIGH_CONTRAST_ROTATION_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, HIGH_CONTRAST_STEPS[0]),
    (4.0, HIGH_CONTRAST_STEPS[1]),
    (6.0, HIGH_CONTRAST_STEPS[2]),
    (8.0, HIGH_CONTRAST_STEPS[3]),
    (10.0, HIGH_CONTRAST_STEPS[4]),
    (14.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_AZ_SHEAR_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, HIGH_CONTRAST_STEPS[0]),
    (4.0, HIGH_CONTRAST_STEPS[1]),
    (6.0, HIGH_CONTRAST_STEPS[2]),
    (8.0, HIGH_CONTRAST_STEPS[3]),
    (10.0, HIGH_CONTRAST_STEPS[4]),
    (14.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_VIL_DENSITY_RAMP: &[(f32, [u8; 3])] = &[
    (0.5, HIGH_CONTRAST_STEPS[0]),
    (1.5, HIGH_CONTRAST_STEPS[1]),
    (2.5, HIGH_CONTRAST_STEPS[2]),
    (3.5, HIGH_CONTRAST_STEPS[3]),
    (4.5, HIGH_CONTRAST_STEPS[4]),
    (6.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_SHI_RAMP: &[(f32, [u8; 3])] = &[
    (10.0, HIGH_CONTRAST_STEPS[0]),
    (50.0, HIGH_CONTRAST_STEPS[1]),
    (100.0, HIGH_CONTRAST_STEPS[2]),
    (200.0, HIGH_CONTRAST_STEPS[3]),
    (350.0, HIGH_CONTRAST_STEPS[4]),
    (600.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_POSH_RAMP: &[(f32, [u8; 3])] = &[
    (10.0, HIGH_CONTRAST_STEPS[0]),
    (30.0, HIGH_CONTRAST_STEPS[1]),
    (50.0, HIGH_CONTRAST_STEPS[2]),
    (70.0, HIGH_CONTRAST_STEPS[3]),
    (85.0, HIGH_CONTRAST_STEPS[4]),
    (100.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_VII_RAMP: &[(f32, [u8; 3])] = &[
    (2.0, HIGH_CONTRAST_STEPS[0]),
    (8.0, HIGH_CONTRAST_STEPS[1]),
    (16.0, HIGH_CONTRAST_STEPS[2]),
    (25.0, HIGH_CONTRAST_STEPS[3]),
    (35.0, HIGH_CONTRAST_STEPS[4]),
    (50.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_MESH_RAMP: &[(f32, [u8; 3])] = &[
    (6.0, HIGH_CONTRAST_STEPS[0]),
    (19.0, HIGH_CONTRAST_STEPS[1]),
    (25.0, HIGH_CONTRAST_STEPS[2]),
    (45.0, HIGH_CONTRAST_STEPS[3]),
    (70.0, HIGH_CONTRAST_STEPS[4]),
    (100.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_LIGHTNING_RAMP: &[(f32, [u8; 3])] = &[
    (0.01, HIGH_CONTRAST_STEPS[0]),
    (0.10, HIGH_CONTRAST_STEPS[1]),
    (0.50, HIGH_CONTRAST_STEPS[2]),
    (1.00, HIGH_CONTRAST_STEPS[3]),
    (2.00, HIGH_CONTRAST_STEPS[4]),
    (4.00, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_LIGHTNING_PROBABILITY_RAMP: &[(f32, [u8; 3])] = &[
    (10.0, HIGH_CONTRAST_STEPS[0]),
    (25.0, HIGH_CONTRAST_STEPS[1]),
    (50.0, HIGH_CONTRAST_STEPS[2]),
    (75.0, HIGH_CONTRAST_STEPS[3]),
    (90.0, HIGH_CONTRAST_STEPS[4]),
];

pub(crate) const HIGH_CONTRAST_LIGHTNING_JUMP_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, HIGH_CONTRAST_STEPS[0]),
    (2.0, HIGH_CONTRAST_STEPS[1]),
    (3.0, HIGH_CONTRAST_STEPS[2]),
    (4.0, HIGH_CONTRAST_STEPS[3]),
    (6.0, HIGH_CONTRAST_STEPS[4]),
];

pub(crate) const HIGH_CONTRAST_ECHO_TOP_RAMP: &[(f32, [u8; 3])] = &[
    (3.0, HIGH_CONTRAST_STEPS[0]),
    (6.0, HIGH_CONTRAST_STEPS[1]),
    (9.0, HIGH_CONTRAST_STEPS[2]),
    (12.0, HIGH_CONTRAST_STEPS[3]),
    (15.0, HIGH_CONTRAST_STEPS[4]),
    (18.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_VIL_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, HIGH_CONTRAST_STEPS[0]),
    (5.0, HIGH_CONTRAST_STEPS[1]),
    (12.0, HIGH_CONTRAST_STEPS[2]),
    (25.0, HIGH_CONTRAST_STEPS[3]),
    (40.0, HIGH_CONTRAST_STEPS[4]),
    (60.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_PRECIP_RATE_RAMP: &[(f32, [u8; 3])] = &[
    (0.2, HIGH_CONTRAST_STEPS[0]),
    (1.0, HIGH_CONTRAST_STEPS[1]),
    (5.0, HIGH_CONTRAST_STEPS[2]),
    (15.0, HIGH_CONTRAST_STEPS[3]),
    (35.0, HIGH_CONTRAST_STEPS[4]),
    (75.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_QPE_HOUR_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const QPE_THREE_DAY_RAMP: &[(f32, [u8; 3])] = &[
    (5.0, [0x38, 0xbd, 0xf8]),
    (25.0, [0x4a, 0xde, 0x80]),
    (50.0, [0xfa, 0xcc, 0x15]),
    (100.0, [0xfb, 0x92, 0x3c]),
    (200.0, [0xf4, 0x3f, 0x5e]),
    (400.0, [0xc0, 0x26, 0xd3]),
];

pub(crate) const HIGH_CONTRAST_QPE_THREE_DAY_RAMP: &[(f32, [u8; 3])] = &[
    (5.0, HIGH_CONTRAST_STEPS[0]),
    (25.0, HIGH_CONTRAST_STEPS[1]),
    (50.0, HIGH_CONTRAST_STEPS[2]),
    (100.0, HIGH_CONTRAST_STEPS[3]),
    (200.0, HIGH_CONTRAST_STEPS[4]),
    (400.0, HIGH_CONTRAST_STEPS[5]),
];

pub(crate) const HIGH_CONTRAST_QPE_DAY_RAMP: &[(f32, [u8; 3])] = &[
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
pub(crate) const PRECIP_TYPES: &[Category] = &[
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
pub(crate) const PRECIP_TYPE_RAMP: &[(f32, [u8; 3])] = &[
    (1.0, [0xa6, 0xdd, 0xa0]),
    (3.0, [0x62, 0xb6, 0xf5]),
    (6.0, [0xb5, 0x7b, 0x0a]),
    (7.0, [0xe0, 0x55, 0x55]),
    (10.0, [0x6f, 0x5f, 0xc0]),
    (91.0, [0x0a, 0x7a, 0x72]),
    (96.0, [0xde, 0x6a, 0xa8]),
];

/// The heights the merged three-dimensional grid is published at, as the
/// bucket spells them and as the kilometres they mean.
///
/// Thirty-three of them, unevenly spaced: a quarter of a kilometre apart
/// through the lowest three, then half a kilometre to nine, then whole ones to
/// nineteen. That is the network's own choice and not something to smooth
/// over, because the spacing is where the detail is: a reader looking for a
/// ZDR column or the height of a hail core is looking in the bottom three
/// kilometres.
pub const CUBE_LEVELS: &[(&str, f32)] = &[
    ("00.50", 0.50),
    ("00.75", 0.75),
    ("01.00", 1.00),
    ("01.25", 1.25),
    ("01.50", 1.50),
    ("01.75", 1.75),
    ("02.00", 2.00),
    ("02.25", 2.25),
    ("02.50", 2.50),
    ("02.75", 2.75),
    ("03.00", 3.00),
    ("03.50", 3.50),
    ("04.00", 4.00),
    ("04.50", 4.50),
    ("05.00", 5.00),
    ("05.50", 5.50),
    ("06.00", 6.00),
    ("06.50", 6.50),
    ("07.00", 7.00),
    ("07.50", 7.50),
    ("08.00", 8.00),
    ("08.50", 8.50),
    ("09.00", 9.00),
    ("10.00", 10.00),
    ("11.00", 11.00),
    ("12.00", 12.00),
    ("13.00", 13.00),
    ("14.00", 14.00),
    ("15.00", 15.00),
    ("16.00", 16.00),
    ("17.00", 17.00),
    ("18.00", 18.00),
    ("19.00", 19.00),
];

/// Correlation coefficient, which is a ratio and not a quantity of anything.
///
/// Rain alone sits at 0.98 and above. The stops below that are what the field
/// is read for: melting snow around 0.95, a mix of rain and hail around 0.9,
/// and non-meteorological returns, which is birds, chaff and tornado debris,
/// below 0.8. The bottom stop is deliberately not zero, because a grid of
/// clear air would otherwise paint the whole country.
pub(crate) const RHOHV_RAMP: &[(f32, [u8; 3])] = &[
    (0.20, [0x5b, 0x21, 0xb6]),
    (0.50, [0x7c, 0x3a, 0xed]),
    (0.80, [0xdb, 0x27, 0x77]),
    (0.90, [0xf9, 0x73, 0x16]),
    (0.95, [0xfa, 0xcc, 0x15]),
    (0.97, [0x4a, 0xde, 0x80]),
    (0.99, [0x22, 0xd3, 0xee]),
    (1.00, [0xe0, 0xf2, 0xfe]),
];

pub(crate) const HIGH_CONTRAST_RHOHV_RAMP: &[(f32, [u8; 3])] = &[
    (0.20, HIGH_CONTRAST_STEPS[0]),
    (0.50, HIGH_CONTRAST_STEPS[1]),
    (0.80, HIGH_CONTRAST_STEPS[2]),
    (0.90, HIGH_CONTRAST_STEPS[3]),
    (0.95, HIGH_CONTRAST_STEPS[4]),
    (1.00, HIGH_CONTRAST_STEPS[5]),
];

/// Differential reflectivity, in decibels.
///
/// Around zero is hail or a dry aggregate, which tumbles and looks the same
/// in both polarisations. Big oblate raindrops run to three and above, and the
/// column of it above a storm's updraught is what the field is opened for.
/// Negative happens and is drawn: it is usually a wet, conical graupel or an
/// artefact, and hiding it would make a reader think the grid stopped.
pub(crate) const ZDR_RAMP: &[(f32, [u8; 3])] = &[
    (-2.0, [0x31, 0x2e, 0x81]),
    (-0.5, [0x1d, 0x4e, 0xd8]),
    (0.5, [0x0e, 0xa5, 0xe9]),
    (1.0, [0x22, 0xc5, 0x5e]),
    (1.5, [0xa3, 0xe6, 0x35]),
    (2.0, [0xfa, 0xcc, 0x15]),
    (3.0, [0xf9, 0x73, 0x16]),
    (4.0, [0xdc, 0x26, 0x26]),
    (6.0, [0xfb, 0xcf, 0xe8]),
];

pub(crate) const HIGH_CONTRAST_ZDR_RAMP: &[(f32, [u8; 3])] = &[
    (-2.0, HIGH_CONTRAST_STEPS[0]),
    (0.0, HIGH_CONTRAST_STEPS[1]),
    (1.0, HIGH_CONTRAST_STEPS[2]),
    (2.0, HIGH_CONTRAST_STEPS[3]),
    (3.5, HIGH_CONTRAST_STEPS[4]),
    (6.0, HIGH_CONTRAST_STEPS[5]),
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
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
        levels: None,
    },
    MrmsProduct {
        id: "cappi-reflectivity",
        // A prefix rather than a folder: this one is published at every height
        // in `CUBE_LEVELS` and the height chosen finishes the name.
        folder: "MergedReflectivityQC",
        label: "MRMS reflectivity at a height",
        unit: "dBZ",
        ramp: REFLECTIVITY_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_REFLECTIVITY_RAMP,
        floor: 5.0,
        sampling: Sampling::Nearest,
        categories: None,
        levels: Some(CUBE_LEVELS),
    },
    MrmsProduct {
        id: "cappi-rhohv",
        folder: "MergedRhoHV",
        label: "MRMS correlation at a height",
        unit: "",
        ramp: RHOHV_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_RHOHV_RAMP,
        // Below this is noise rather than a reading, and drawing it paints
        // every clear-air cell in the country.
        floor: 0.2,
        sampling: Sampling::Nearest,
        categories: None,
        levels: Some(CUBE_LEVELS),
    },
    MrmsProduct {
        id: "cappi-zdr",
        folder: "MergedZdr",
        label: "MRMS differential reflectivity at a height",
        unit: "dB",
        ramp: ZDR_RAMP,
        high_contrast_ramp: HIGH_CONTRAST_ZDR_RAMP,
        // The bottom of the ramp. This field is signed, so the floor is not
        // near zero the way every other one here is, and a floor above the
        // lowest stop would hide the negative values the ramp draws.
        floor: -2.0,
        sampling: Sampling::Nearest,
        categories: None,
        levels: Some(CUBE_LEVELS),
    },
];

pub fn product_by_id(id: &str) -> Option<&'static MrmsProduct> {
    PRODUCTS.iter().find(|entry| entry.id == id)
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

#[cfg(test)]
#[path = "products_tests.rs"]
mod tests;

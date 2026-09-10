//! What a whole volume says about the column over each point of ground.
//!
//! Every other radar product here is one cut: the antenna at one elevation,
//! drawn where the beam went. These are the other axis. A storm is a column,
//! and how tall it is, how much water is in it and how big the hail could be
//! are questions no single cut can answer. The desktop analysts ship them and
//! readers compare them against the national mosaic, which computes the same
//! quantities from every radar at once rather than from the one being held.
//!
//! The grid is polar with kilometre bins, which is the radar's own frame: the
//! column over a point of ground is sampled by walking every cut at the slant
//! range that reaches that ground range, so each sample is the beam that
//! actually passed through that part of the column.

use nexrad_model::data::{GateStatus, Product, Scan, SweepField};

use crate::cross_section::beam_height_km;
use crate::gates::reading_at;
use crate::level2::{sweep_field_at, tilts, MAX_RANGE_KM};

/// How far apart the bins of the derived grid are, and where the first sits.
const BIN_KM: f64 = 1.0;
const FIRST_BIN_KM: f64 = 0.5;

/// The reflectivity an echo top is measured to.
///
/// The enhanced echo top the ROC algorithm description specifies, and the same
/// threshold the height under VIL density is taken at: two echo tops half a
/// decibel apart, drawn beside each other under names a reader cannot tell
/// apart, would be worse than either.
pub const ECHO_TOP_DBZ: f32 = 18.5;

/// Above this a return is ice rather than water, so the liquid estimate stops
/// counting it. Without the cap a hail core reads as an impossible depth of
/// rain, which is the failure the ROC description exists to name.
const VIL_CAP_DBZ: f32 = 56.0;

/// The reflectivity band the hail kinetic energy is weighted across.
const HAIL_WEIGHT_FLOOR_DBZ: f32 = 40.0;
const HAIL_WEIGHT_CEILING_DBZ: f32 = 50.0;

/// The two heights the hail algorithm weights between, in kilometres above sea
/// level, and where they came from.
///
/// Hail grows between the freezing level and about minus twenty, so those two
/// heights are what turn a column of reflectivity into a size. They are a
/// property of the air rather than of the radar, which is why they arrive from
/// outside and why the answer says which air they were read from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Isotherms<'a> {
    pub freezing_km: f64,
    pub minus_twenty_km: f64,
    /// The sounding these were read from, or the standard atmosphere.
    pub source: &'a str,
}

/// The standard atmosphere, which is what is used when no sounding is loaded.
///
/// Fifteen degrees at sea level falling at six and a half a kilometre, which
/// puts freezing at 2.31 km and minus twenty at 5.38. It is a stated default
/// rather than a good one: a real column in a hail storm is warmer and deeper
/// than this, so the size comes out low, and the answer says so.
const STANDARD_SEA_LEVEL_C: f64 = 15.0;
const STANDARD_LAPSE_C_PER_KM: f64 = 6.5;

impl<'a> Default for Isotherms<'a> {
    fn default() -> Self {
        let at = |celsius: f64| (STANDARD_SEA_LEVEL_C - celsius) / STANDARD_LAPSE_C_PER_KM;
        Self {
            freezing_km: at(0.0),
            minus_twenty_km: at(-20.0),
            source: "the international standard atmosphere, no sounding loaded",
        }
    }
}

/// What is being worked out from the column.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// The strongest return anywhere in the column.
    Composite,
    /// How high the echo reaches, interpolated between the cuts either side.
    EchoTop,
    /// The depth of water the column holds, if all of it were rain.
    Vil,
    /// The same, divided by how tall the column is.
    VilDensity,
    /// The largest hail the column could be making.
    HailSize,
}

/// The label and unit each kind is drawn under.
pub fn named(kind: Kind) -> (&'static str, &'static str) {
    match kind {
        Kind::Composite => ("Composite reflectivity", "dBZ"),
        Kind::EchoTop => ("Echo top", "km"),
        Kind::Vil => ("Vertically integrated liquid", "kg/m2"),
        Kind::VilDensity => ("VIL density", "g/m3"),
        Kind::HailSize => ("Hail size", "mm"),
    }
}

/// One line saying how the numbers were arrived at, for the export header.
pub fn derivation(kind: Kind, isotherms: &Isotherms<'_>) -> String {
    let column = format!(
        "the column over each point of ground, sampled from every cut of the volume on \
         {BIN_KM:.0} km bins by the 4/3 effective earth radius beam model"
    );
    match kind {
        Kind::Composite => format!("the strongest reading in {column}"),
        Kind::EchoTop => format!(
            "the highest {ECHO_TOP_DBZ} dBZ in {column}, interpolated between the cut that \
             holds it and the one above"
        ),
        Kind::Vil => format!(
            "vertically integrated liquid over {column}, by the Greene and Clark relation \
             with reflectivity capped at {VIL_CAP_DBZ:.0} dBZ so ice is not counted as rain"
        ),
        Kind::VilDensity => format!(
            "vertically integrated liquid over {column} divided by the {ECHO_TOP_DBZ} dBZ \
             echo top"
        ),
        Kind::HailSize => format!(
            "the severe hail index over {column} (Witt et al. 1998: hail kinetic energy \
             weighted from {HAIL_WEIGHT_FLOOR_DBZ:.0} to {HAIL_WEIGHT_CEILING_DBZ:.0} dBZ and \
             between the 0 and -20 degree heights), turned into a size by the Murillo and \
             Homeyer 75th percentile refit; heights from {}, freezing at {:.2} km and minus \
             twenty at {:.2} km above sea level",
            isotherms.source, isotherms.freezing_km, isotherms.minus_twenty_km
        ),
    }
}

/// A derived grid and, on hail size, the gates carrying a three-body signature.
pub struct Derived {
    pub field: SweepField,
    pub flagged: Option<SweepField>,
}

/// One reading of the column, at the height the beam that made it passed.
struct Sample {
    height_km: f64,
    dbz: f32,
}

/// Works the whole volume into one grid.
///
/// `antenna_km` is how high the radar itself stands above sea level, because
/// the beam height is measured from the antenna and the isotherms are not.
pub fn derive(
    scan: &Scan,
    kind: Kind,
    isotherms: &Isotherms<'_>,
    antenna_km: f64,
) -> Option<Derived> {
    let angles = tilts(scan);
    let cuts: Vec<(f32, SweepField)> = angles
        .iter()
        .filter_map(|angle| {
            sweep_field_at(scan, Product::Reflectivity, *angle)
                .map(|chosen| (chosen.elevation_degrees, chosen.field))
        })
        .collect();
    let (_, lowest) = cuts.first()?;
    let azimuths = lowest.azimuths().to_vec();
    let spacing = lowest.azimuth_spacing_degrees();
    if azimuths.is_empty() {
        return None;
    }

    let bins = (MAX_RANGE_KM / BIN_KM).floor() as usize;
    let (label, unit) = named(kind);
    let mut field = SweepField::new_empty(
        label,
        unit,
        // Not a cut. Zero is what makes the renderer read the grid by ground
        // range, which is the axis the column was walked along.
        0.0,
        azimuths.clone(),
        spacing,
        FIRST_BIN_KM,
        BIN_KM,
        bins,
    );

    let mut column: Vec<Sample> = Vec::with_capacity(cuts.len());
    let mut cores: Vec<(usize, usize)> = Vec::new();
    for (at, angle) in azimuths.iter().enumerate() {
        for bin in 0..bins {
            let ground_km = FIRST_BIN_KM + bin as f64 * BIN_KM;
            read_column(&cuts, *angle, ground_km, antenna_km, &mut column);
            if column.is_empty() {
                continue;
            }
            if kind == Kind::HailSize && column.iter().any(|one| one.dbz >= TBSS_CORE_DBZ) {
                cores.push((at, bin));
            }
            let Some(value) = answer(kind, &column, isotherms) else {
                continue;
            };
            field.set(at, bin, value, GateStatus::Valid);
        }
    }

    let flagged = (kind == Kind::HailSize).then(|| spike(&cuts, &azimuths, &cores, bins, &field));
    Some(Derived {
        field,
        flagged: flagged.flatten(),
    })
}

/// Every cut's reading over one point of ground, lowest beam first.
///
/// A cut is asked at the slant range whose ground distance is the one wanted,
/// so what comes back is the column rather than a fan. Reading it through
/// `gates` rather than the model's own reader, because a kilometre bin walked
/// against quarter kilometre gates is where a half gate of shift shows.
fn read_column(
    cuts: &[(f32, SweepField)],
    azimuth: f32,
    ground_km: f64,
    antenna_km: f64,
    into: &mut Vec<Sample>,
) {
    into.clear();
    for (elevation, cut) in cuts {
        let cosine = (*elevation as f64).to_radians().cos();
        if cosine <= 0.0 {
            continue;
        }
        let slant_km = ground_km / cosine;
        let Some((dbz, GateStatus::Valid)) = reading_at(cut, azimuth, slant_km) else {
            continue;
        };
        into.push(Sample {
            height_km: beam_height_km(slant_km, *elevation) + antenna_km,
            dbz,
        });
    }
    into.sort_by(|left, right| left.height_km.total_cmp(&right.height_km));
}

fn answer(kind: Kind, column: &[Sample], isotherms: &Isotherms<'_>) -> Option<f32> {
    match kind {
        Kind::Composite => column
            .iter()
            .map(|one| one.dbz)
            .max_by(f32::total_cmp)
            .filter(|dbz| *dbz > f32::NEG_INFINITY),
        Kind::EchoTop => echo_top_km(column).map(|km| km as f32),
        Kind::Vil => Some(vil(column) as f32).filter(|value| *value > 0.0),
        Kind::VilDensity => {
            let top_km = echo_top_km(column)?;
            if top_km <= 0.0 {
                return None;
            }
            // Kilograms a square metre over metres of depth is grams a cubic
            // metre, which is the unit the number is read in.
            Some((vil(column) / (top_km * 1000.0) * 1000.0) as f32).filter(|value| *value > 0.0)
        }
        Kind::HailSize => {
            let index = severe_hail_index(column, isotherms);
            (index > 0.0).then(|| mesh_mm(index) as f32)
        }
    }
}

/// How high the echo reaches, in kilometres above sea level.
///
/// The highest sample at or above the threshold, carried up toward the first
/// one above it that is not. Without the interpolation an echo top is one of a
/// dozen cut heights and nothing between, which draws a storm as a staircase
/// and puts its top wherever the pattern happened to put a beam.
fn echo_top_km(column: &[Sample]) -> Option<f64> {
    let highest = column.iter().rposition(|one| one.dbz >= ECHO_TOP_DBZ)?;
    let holding = &column[highest];
    let Some(above) = column.get(highest + 1) else {
        return Some(holding.height_km);
    };
    let span = holding.dbz - above.dbz;
    if span <= 0.0 {
        return Some(holding.height_km);
    }
    let share = ((holding.dbz - ECHO_TOP_DBZ) / span) as f64;
    Some(holding.height_km + (above.height_km - holding.height_km) * share.clamp(0.0, 1.0))
}

/// Reflectivity in the unit the physics is written in.
fn linear(dbz: f32) -> f64 {
    10f64.powf(dbz as f64 / 10.0)
}

/// The depth of water a column holds, in kilograms a square metre.
///
/// Greene and Clark's relation, integrated over the layers between one sample
/// and the next. Every reading is capped before it is linearised: the relation
/// is between reflectivity and rain, and a sixty decibel return is hail, which
/// it would read as several times more rain than any column can hold.
fn vil(column: &[Sample]) -> f64 {
    let mut total = 0.0;
    for pair in column.windows(2) {
        let depth_m = (pair[1].height_km - pair[0].height_km) * 1000.0;
        if depth_m <= 0.0 {
            continue;
        }
        let below = linear(pair[0].dbz.min(VIL_CAP_DBZ));
        let above = linear(pair[1].dbz.min(VIL_CAP_DBZ));
        total += 3.44e-6 * ((below + above) / 2.0).powf(4.0 / 7.0) * depth_m;
    }
    total
}

/// The severe hail index, in joules a metre a second.
///
/// Witt et al. 1998: hail kinetic energy flux at each level, weighted to
/// nothing below forty decibels and to everything above fifty, and again to
/// nothing below the freezing level and to everything above minus twenty,
/// integrated over the column.
fn severe_hail_index(column: &[Sample], isotherms: &Isotherms<'_>) -> f64 {
    let mut total = 0.0;
    for pair in column.windows(2) {
        let depth_m = (pair[1].height_km - pair[0].height_km) * 1000.0;
        if depth_m <= 0.0 {
            continue;
        }
        let each = |one: &Sample| {
            hail_kinetic_energy(one.dbz) * temperature_weight(one.height_km, isotherms)
        };
        total += (each(&pair[0]) + each(&pair[1])) / 2.0 * depth_m;
    }
    0.1 * total
}

/// The flux of hail kinetic energy a reading stands for.
fn hail_kinetic_energy(dbz: f32) -> f64 {
    5.0e-6 * 10f64.powf(0.084 * dbz as f64) * reflectivity_weight(dbz)
}

fn reflectivity_weight(dbz: f32) -> f64 {
    let span = HAIL_WEIGHT_CEILING_DBZ - HAIL_WEIGHT_FLOOR_DBZ;
    (((dbz - HAIL_WEIGHT_FLOOR_DBZ) / span) as f64).clamp(0.0, 1.0)
}

fn temperature_weight(height_km: f64, isotherms: &Isotherms<'_>) -> f64 {
    let span = isotherms.minus_twenty_km - isotherms.freezing_km;
    if span <= 0.0 {
        return if height_km >= isotherms.freezing_km {
            1.0
        } else {
            0.0
        };
    }
    ((height_km - isotherms.freezing_km) / span).clamp(0.0, 1.0)
}

/// The size that index stands for, in millimetres.
///
/// Murillo and Homeyer's 75th percentile refit rather than Witt's own fit of
/// the same percentile. Witt had 147 reports and this has 5,897, and the
/// shallower exponent is what stops the estimate running away at the top of
/// the range, where a squared fit puts hail larger than any that has fallen.
fn mesh_mm(index: f64) -> f64 {
    15.096 * index.powf(0.206)
}

/// A three-body scatter spike is echo this weak sitting behind a core this
/// strong, and nothing else in weather looks like it.
const TBSS_CORE_DBZ: f32 = 60.0;
const TBSS_SPIKE_CEILING_DBZ: f32 = 20.0;
const TBSS_NEAR_KM: f64 = 10.0;
const TBSS_FAR_KM: f64 = 30.0;
/// Ground clutter and light rain are also weak, so the spike only counts where
/// the beam is well above the ground and the ordinary echo has stopped.
const TBSS_ALOFT_KM: f64 = 3.0;

/// The gates carrying a three-body scatter spike.
///
/// Hail scatters the beam sideways, into the ground and back, so a strong core
/// paints a weak flare on the radar's own radial behind it. It is the one
/// signature that says large hail is falling now rather than that the column
/// could make it, which is why it is drawn beside the size rather than folded
/// into it.
fn spike(
    cuts: &[(f32, SweepField)],
    azimuths: &[f32],
    cores: &[(usize, usize)],
    bins: usize,
    like: &SweepField,
) -> Option<SweepField> {
    if cores.is_empty() {
        return None;
    }
    let mut flagged = like.new_like("Three-body scatter spike", "");
    let mut any = false;
    let near = (TBSS_NEAR_KM / BIN_KM).round() as usize;
    let far = (TBSS_FAR_KM / BIN_KM).round() as usize;
    for &(at, core) in cores {
        let Some(azimuth) = azimuths.get(at).copied() else {
            continue;
        };
        for bin in core + near..=(core + far).min(bins.saturating_sub(1)) {
            let ground_km = FIRST_BIN_KM + bin as f64 * BIN_KM;
            // Behind the core, on the same radial, weak, and high enough that
            // it is not the ground.
            let mut aloft = false;
            let mut strongest = f32::NEG_INFINITY;
            for (elevation, cut) in cuts {
                let cosine = (*elevation as f64).to_radians().cos();
                if cosine <= 0.0 {
                    continue;
                }
                let slant_km = ground_km / cosine;
                let Some((dbz, GateStatus::Valid)) = reading_at(cut, azimuth, slant_km) else {
                    continue;
                };
                strongest = strongest.max(dbz);
                if beam_height_km(slant_km, *elevation) >= TBSS_ALOFT_KM {
                    aloft = true;
                }
            }
            if !aloft || strongest == f32::NEG_INFINITY {
                continue;
            }
            if strongest > TBSS_SPIKE_CEILING_DBZ {
                continue;
            }
            flagged.set(at, bin, 1.0, GateStatus::Valid);
            any = true;
        }
    }
    any.then_some(flagged)
}

#[cfg(test)]
#[path = "derive_tests.rs"]
mod tests;

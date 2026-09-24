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

use crate::cross_section::{
    beam_half_thickness_km, beam_height_km, EFFECTIVE_EARTH_RADIUS_KM as EARTH_KM,
};
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
/// than this, so the temperature weight runs over more of the column and the
/// size comes out high, and the answer says so.
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
        "the column over each point of ground on {BIN_KM:.0} km bins, sampled from every \
         cut of the volume whose beam reaches that far, by the 4/3 effective earth \
         radius beam model"
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
             twenty at {:.2} km above sea level; the standard atmosphere runs the size \
             high on a warm day because ISA isotherms are lower than a real hail day's",
            isotherms.source, isotherms.freezing_km, isotherms.minus_twenty_km
        ),
    }
}

/// The reflectivity a core has to reach before a spike is looked for behind
/// it. Lemon (1998) found the signature behind cores of 63 dBZ and more.
const SPIKE_CORE_DBZ: f32 = 60.0;

/// How high above the antenna the core's back edge has to be. The beam climbs,
/// so every gate the spike is looked for in behind it is higher still.
///
/// The spike is the radar's energy scattered off hail aloft to the ground and
/// back, so it appears at the height of the hail. Insects and birds have the
/// same polarimetric look and live in the lowest two kilometres or so, and
/// ground return lives on the ground, so height keeps both out. None of the
/// seventeen stored volumes the detector was checked against needed it, the
/// look and the stand-off below having turned their clear air away already:
/// it is here for a core low down with insects right behind it, and a planted
/// test holds it to that.
const SPIKE_ALOFT_KM: f64 = 3.0;

/// How far behind the core's back edge the spike may start. The storm's own
/// precipitation falls off first.
const SPIKE_START_WITHIN_KM: f64 = 8.0;

/// The spike is energy that came the long way round, so it is faint.
const SPIKE_CEILING_DBZ: f32 = 30.0;

/// Its polarimetric look: differential reflectivity well above anything rain
/// or ice gives, and a correlation the precipitation around it never falls
/// to. On the stored KMAF volume of 2019-05-24 the spike behind a 70 dBZ core
/// reads 6 to 8 dB and 0.2 to 0.6 while the storm's own precipitation beside
/// it reads 0 dB and 0.98.
const SPIKE_ZDR_DB: f32 = 3.0;
const SPIKE_RHO: f32 = 0.8;

/// The shortest unbroken run that counts, and how far behind a core it is
/// looked for at all. Lemon's spikes are 10 to 30 kilometres long.
const SPIKE_MIN_KM: f64 = 3.0;
const SPIKE_REACH_KM: f64 = 40.0;

/// One cut's three moments, as the spike needs them.
struct Moments {
    elevation: f32,
    reflectivity: SweepField,
    correlation: SweepField,
    differential: SweepField,
}

/// Where a three-body scatter spike reaches behind a hail core, on the grid
/// the column products are drawn on, or nothing when there is none.
///
/// A signature, not a measurement: large hail aloft sends some of the radar's
/// energy down to the ground and back up before it returns, and the radar
/// files that late energy behind the core as a faint radial flare. It is
/// looked for on each cut separately, starting at the back edge of a core
/// that cut sees aloft, and only in gates that are weak and carry the
/// polarimetric look nothing else at that height does.
pub fn spike(scan: &Scan) -> Option<SweepField> {
    let cuts: Vec<Moments> = tilts(scan)
        .iter()
        .filter_map(|angle| {
            let reflectivity = sweep_field_at(scan, Product::Reflectivity, *angle)?;
            let correlation = sweep_field_at(scan, Product::CorrelationCoefficient, *angle)?;
            let differential = sweep_field_at(scan, Product::DifferentialReflectivity, *angle)?;
            Some(Moments {
                elevation: reflectivity.elevation_degrees,
                reflectivity: reflectivity.field,
                correlation: correlation.field,
                differential: differential.field,
            })
        })
        .collect();
    let lowest = sweep_field_at(scan, Product::Reflectivity, *tilts(scan).first()?)?.field;
    spike_on(&cuts, &lowest)
}

/// The same, over cuts already read, onto the grid `like` sets out.
fn spike_on(cuts: &[Moments], like: &SweepField) -> Option<SweepField> {
    let azimuths = like.azimuths().to_vec();
    if azimuths.is_empty() {
        return None;
    }
    let bins = (MAX_RANGE_KM / BIN_KM).floor() as usize;
    let mut flagged = SweepField::new_empty(
        "Three-body scatter spike",
        "",
        0.0,
        azimuths.clone(),
        like.azimuth_spacing_degrees(),
        FIRST_BIN_KM,
        BIN_KM,
        bins,
    );
    let start_within = (SPIKE_START_WITHIN_KM / BIN_KM).round() as usize;
    let reach = (SPIKE_REACH_KM / BIN_KM).round() as usize;
    let shortest = (SPIKE_MIN_KM / BIN_KM).round() as usize;
    let covered: Vec<Vec<bool>> = cuts
        .iter()
        .map(|cut| swept(&cut.reflectivity, &azimuths))
        .collect();
    let mut any = false;
    for (at, azimuth) in azimuths.iter().enumerate() {
        for (cut, covered) in cuts.iter().zip(&covered) {
            if !covered[at] {
                continue;
            }
            // What this cut reads over each bin of ground along the radial,
            // and how high the beam is there.
            let along: Vec<Option<(f32, f64)>> = (0..bins)
                .map(|bin| {
                    let ground_km = FIRST_BIN_KM + bin as f64 * BIN_KM;
                    let slant_km = slant_for(ground_km, cut.elevation)?;
                    let Some((dbz, GateStatus::Valid)) =
                        reading_at(&cut.reflectivity, *azimuth, slant_km)
                    else {
                        return None;
                    };
                    Some((dbz, beam_height_km(slant_km, cut.elevation)))
                })
                .collect();
            let signature = |bin: usize| -> bool {
                let Some((dbz, _)) = along[bin] else {
                    return false;
                };
                if dbz > SPIKE_CEILING_DBZ {
                    return false;
                }
                let ground_km = FIRST_BIN_KM + bin as f64 * BIN_KM;
                let Some(slant_km) = slant_for(ground_km, cut.elevation) else {
                    return false;
                };
                let rho = reading_at(&cut.correlation, *azimuth, slant_km);
                let zdr = reading_at(&cut.differential, *azimuth, slant_km);
                matches!(rho, Some((rho, GateStatus::Valid)) if rho < SPIKE_RHO)
                    && matches!(zdr, Some((zdr, GateStatus::Valid)) if zdr >= SPIKE_ZDR_DB)
            };

            let mut bin = 0;
            while bin < bins {
                let core = matches!(along[bin], Some((dbz, _)) if dbz >= SPIKE_CORE_DBZ);
                if !core {
                    bin += 1;
                    continue;
                }
                while bin + 1 < bins
                    && matches!(along[bin + 1], Some((dbz, _)) if dbz >= SPIKE_CORE_DBZ)
                {
                    bin += 1;
                }
                // `bin` is the core's back edge. Only a core the cut sees
                // aloft can be the hail that makes a spike.
                let back = bin;
                bin += 1;
                if along[back].is_none_or(|(_, height)| height < SPIKE_ALOFT_KM) {
                    continue;
                }
                let last = (back + reach).min(bins - 1);
                // Unbroken, save for a single bin the flare dips out of.
                let run_from = |first: usize| {
                    let mut end = first;
                    let mut next = first + 1;
                    while next <= last {
                        if signature(next) {
                            end = next;
                            next += 1;
                        } else if next < last && signature(next + 1) {
                            end = next + 1;
                            next += 2;
                        } else {
                            break;
                        }
                    }
                    end
                };
                // Every start the window offers rather than only the first:
                // one stray gate with the look just behind the core would
                // otherwise hide the flare that starts a kilometre further
                // back.
                let window_end = (back + start_within).min(last);
                let mut start = back + 1;
                let mut found = None;
                while start <= window_end {
                    if !signature(start) {
                        start += 1;
                        continue;
                    }
                    let end = run_from(start);
                    if end + 1 - start >= shortest {
                        found = Some((start, end));
                        break;
                    }
                    start = end + 1;
                }
                let Some((first, end)) = found else {
                    continue;
                };
                for marked in first..=end {
                    flagged.set(at, marked, 1.0, GateStatus::Valid);
                }
                any = true;
            }
        }
    }
    any.then_some(flagged)
}

/// A derived grid.
pub struct Derived {
    pub field: SweepField,
    /// True when any echo top reading sits at the highest scanned cut with no
    /// sample above it. The true top may be higher than what the volume saw.
    pub topped: bool,
}

/// One reading of the column, at the height the beam that made it passed.
struct Sample {
    height_km: f64,
    slant_km: f64,
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
    derive_on(&cuts, kind, isotherms, antenna_km)
}

/// The same, over cuts already read, lowest first.
fn derive_on(
    cuts: &[(f32, SweepField)],
    kind: Kind,
    isotherms: &Isotherms<'_>,
    antenna_km: f64,
) -> Option<Derived> {
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

    let covered: Vec<Vec<bool>> = cuts.iter().map(|(_, cut)| swept(cut, &azimuths)).collect();
    let mut any_topped = false;
    let mut column: Vec<Sample> = Vec::with_capacity(cuts.len());
    for (at, angle) in azimuths.iter().enumerate() {
        // Only the cuts that reached this bearing: a cut still being swept
        // would otherwise lend its nearest radial to all the rest of the
        // circle.
        let here: Vec<&(f32, SweepField)> = cuts
            .iter()
            .zip(&covered)
            .filter(|(_, covered)| covered[at])
            .map(|(cut, _)| cut)
            .collect();
        for bin in 0..bins {
            let ground_km = FIRST_BIN_KM + bin as f64 * BIN_KM;
            read_column(&here, *angle, ground_km, antenna_km, &mut column);
            if column.is_empty() {
                continue;
            }
            if kind == Kind::EchoTop {
                if let Some(top) = echo_top_km(&column) {
                    if top.topped {
                        any_topped = true;
                    }
                    field.set(at, bin, top.km as f32, GateStatus::Valid);
                }
            } else {
                let Some(value) = answer(kind, &column, isotherms) else {
                    continue;
                };
                field.set(at, bin, value, GateStatus::Valid);
            }
        }
    }

    Some(Derived {
        field,
        topped: any_topped,
    })
}

/// Which of `azimuths` a cut actually swept.
///
/// A cut still being swept holds only the radials the antenna has reached,
/// and the model's reader answers every bearing with the nearest radial it
/// has, however far round that is: read that way, a cut forty-five degrees
/// into its sweep lent its last radial to the other three hundred. A bearing
/// counts as swept when a radial lies within two radials' spacing of it, and
/// never less than a degree, which a finished cut with a radial or two
/// missing still satisfies everywhere.
fn swept(field: &SweepField, azimuths: &[f32]) -> Vec<bool> {
    let mut held: Vec<f32> = field.azimuths().to_vec();
    held.sort_by(f32::total_cmp);
    if held.is_empty() {
        return vec![false; azimuths.len()];
    }
    let reach = (field.azimuth_spacing_degrees() * 2.0).max(1.0) + 0.01;
    azimuths
        .iter()
        .map(|azimuth| {
            let at = held.partition_point(|radial| radial < azimuth);
            let apart = |index: usize| {
                let gap = (held[index % held.len()] - azimuth).abs();
                gap.min(360.0 - gap)
            };
            apart(at).min(apart(at + held.len() - 1)) <= reach
        })
        .collect()
}

/// Every cut's reading over one point of ground, lowest beam first.
///
/// A cut is asked at the slant range whose ground distance is the one wanted,
/// so what comes back is the column rather than a fan. Reading it through
/// `gates` rather than the model's own reader, because a kilometre bin walked
/// against quarter kilometre gates is where a half gate of shift shows.
fn read_column(
    cuts: &[&(f32, SweepField)],
    azimuth: f32,
    ground_km: f64,
    antenna_km: f64,
    into: &mut Vec<Sample>,
) {
    into.clear();
    for (elevation, cut) in cuts.iter().copied() {
        let Some(slant_km) = slant_for(ground_km, *elevation) else {
            continue;
        };
        let Some((dbz, GateStatus::Valid)) = reading_at(cut, azimuth, slant_km) else {
            continue;
        };
        into.push(Sample {
            height_km: beam_height_km(slant_km, *elevation) + antenna_km,
            slant_km,
            dbz,
        });
    }
    into.sort_by(|left, right| left.height_km.total_cmp(&right.height_km));
}

/// How far along the beam a point of ground is, under the model the rest of
/// this crate measures beam heights with.
///
/// Dividing the ground range by the cosine is the flat-earth answer, and it is
/// wrong by more than the half gate `gates` exists to remove: at the top tilt
/// of a volume pattern it comes out about 360 metres short at ninety
/// kilometres, which is a gate and a half. The beam climbs, so the ground it
/// has covered is less than its own shadow, and the correction is the earth
/// the height is measured against. Two passes, because the height that sets
/// the correction is the height at the range being solved for and one pass
/// already lands well inside a metre.
pub(crate) fn slant_for(ground_km: f64, elevation: f32) -> Option<f64> {
    let angle = (elevation as f64).to_radians();
    let cosine = angle.cos();
    if cosine <= 0.0 {
        return None;
    }
    let mut slant = ground_km / cosine;
    for _ in 0..2 {
        let height = beam_height_km(slant, elevation);
        // The ground distance this slant range actually covers, then the
        // slant range that would have covered the one asked for.
        let covered = EARTH_KM * (slant * cosine / (EARTH_KM + height)).asin();
        if covered <= 0.0 {
            return None;
        }
        slant *= ground_km / covered;
    }
    Some(slant)
}

fn answer(kind: Kind, column: &[Sample], isotherms: &Isotherms<'_>) -> Option<f32> {
    match kind {
        Kind::Composite => column
            .iter()
            .map(|one| one.dbz)
            .max_by(f32::total_cmp)
            .filter(|dbz| *dbz > f32::NEG_INFINITY),
        Kind::EchoTop => unreachable!("echo top is handled in the derive loop"),
        Kind::Vil => Some(vil(column) as f32).filter(|value| *value > 0.0),
        Kind::VilDensity => {
            let top = echo_top_km(column)?;
            if top.km <= 0.0 {
                return None;
            }
            // Kilograms a square metre over metres of depth is grams a cubic
            // metre, which is the unit the number is read in.
            Some((vil(column) / (top.km * 1000.0) * 1000.0) as f32).filter(|value| *value > 0.0)
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
/// An echo top reading: the height and whether the storm reached the highest
/// scanned cut, meaning the true top may be above what the volume can see.
#[derive(Debug, PartialEq)]
struct EchoTop {
    km: f64,
    topped: bool,
}

fn echo_top_km(column: &[Sample]) -> Option<EchoTop> {
    let highest = column.iter().rposition(|one| one.dbz >= ECHO_TOP_DBZ)?;
    let holding = &column[highest];
    let Some(above) = column.get(highest + 1) else {
        return Some(EchoTop {
            km: holding.height_km,
            topped: true,
        });
    };
    let span = holding.dbz - above.dbz;
    if span <= 0.0 {
        return Some(EchoTop {
            km: holding.height_km,
            topped: false,
        });
    }
    let share = ((holding.dbz - ECHO_TOP_DBZ) / span) as f64;
    Some(EchoTop {
        km: holding.height_km + (above.height_km - holding.height_km) * share.clamp(0.0, 1.0),
        topped: false,
    })
}

/// Reflectivity in the unit the physics is written in.
fn linear(dbz: f32) -> f64 {
    10f64.powf(dbz as f64 / 10.0)
}

/// The depth of water a column holds, in kilograms a square metre.
///
/// Greene and Clark's relation, integrated over the layers between one sample
/// and the next. The ROC algorithm extends the end layers by half a beamwidth
/// so the integration covers the full depth the radar actually saw rather
/// than stopping at the beam centres, which makes VIL grow with range as the
/// beams spread. Every reading is capped before it is linearised: the
/// relation is between reflectivity and rain, and a sixty decibel return is
/// hail, which it would read as several times more rain than any column can
/// hold.
fn vil(column: &[Sample]) -> f64 {
    if column.is_empty() {
        return 0.0;
    }

    let mut total = 0.0;

    // Extend below the lowest sample by half a beamwidth.
    let first = &column[0];
    let half_below = beam_half_thickness_km(first.slant_km);
    if half_below > 0.0 {
        let z = linear(first.dbz.min(VIL_CAP_DBZ));
        total += 3.44e-6 * z.powf(4.0 / 7.0) * half_below * 1000.0;
    }

    // The layers between beam centres.
    for pair in column.windows(2) {
        let depth_m = (pair[1].height_km - pair[0].height_km) * 1000.0;
        if depth_m <= 0.0 {
            continue;
        }
        let below = linear(pair[0].dbz.min(VIL_CAP_DBZ));
        let above = linear(pair[1].dbz.min(VIL_CAP_DBZ));
        total += 3.44e-6 * ((below + above) / 2.0).powf(4.0 / 7.0) * depth_m;
    }

    // Extend above the highest sample by half a beamwidth.
    let last = &column[column.len() - 1];
    let half_above = beam_half_thickness_km(last.slant_km);
    if half_above > 0.0 {
        let z = linear(last.dbz.min(VIL_CAP_DBZ));
        total += 3.44e-6 * z.powf(4.0 / 7.0) * half_above * 1000.0;
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

#[cfg(test)]
#[path = "derive_tests.rs"]
mod tests;

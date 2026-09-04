//! The wind profile a volume's own velocity already contains.
//!
//! `vad.rs` fits the wind to one ring of gates, and `level2.rs` has been using
//! it for one thing: taking the ambient flow out of a sweep so a couplet shows
//! through. The same fit run at a set of heights, rather than once for the
//! sweep, is a Velocity Azimuth Display wind profile, which is what a
//! forecaster reads shear off and what GR2Analyst has shipped for years.
//!
//! Nothing here fetches anything. It is arithmetic on a volume that has
//! already been decoded for the picture, so a profile costs the fits and
//! nothing else.
//!
//! Every level answers, including the ones that could not be fitted. A gap in
//! a wind profile is information: it says the radar had nothing it could read
//! the wind from up there, and a profile that silently closed up around its
//! gaps would read as continuous shear that nobody measured.

use nexrad_model::data::{GateStatus, Product, Scan, SweepField};
use serde::Serialize;

use crate::cross_section::beam_height_km;
use crate::vad;

/// The heights a profile is drawn at, in kilometres above the radar.
///
/// Half a kilometre apart to twelve, which is twenty-four levels: the office's
/// own product tops out around thirty and the air above twelve kilometres is
/// not where anybody is reading shear.
pub const LEVEL_STEP_KM: f64 = 0.5;
pub const LEVELS: usize = 24;

/// How far out a ring may sit and still speak for the height it is at.
///
/// Inside seven kilometres the beam is in the clutter and the ring is a few
/// gates around; past two hundred and thirty there is nothing. Both ends are
/// the same numbers `level2.rs` picks its storm-motion rings between.
const NEAR_KM: f64 = 7.0;
const FAR_KM: f64 = 230.0;

/// Why a level has no wind on it.
///
/// Said rather than left blank, because "the radar could not read the wind
/// here" and "nobody looked" are different answers and only one of them is
/// about the weather.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Refusal {
    /// No cut reaches this height inside the range a ring can be read at.
    OutOfReach,
    /// The ring had too little velocity in it to fit a wave to.
    NoFit,
    /// The wave fitted, and what it did not explain was too much.
    Residual,
    /// The two halves of the ring disagreed about the wind.
    Symmetry,
    /// Too few gates behind the fit to vouch for it.
    Gates,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VwpLevel {
    pub height_km: f64,
    /// Metres a second, when the ring could be vouched for.
    pub speed_ms: Option<f32>,
    /// Where the wind is coming from, in degrees, which is how one is named.
    pub from_degrees: Option<f32>,
    /// The elevation the ring was taken from, so a reader can see the geometry.
    pub elevation_degrees: Option<f32>,
    pub range_km: Option<f64>,
    /// What the fit did not explain, and how far the halves disagreed.
    pub residual_ms: Option<f32>,
    pub symmetry_ms: Option<f32>,
    pub refused: Option<Refusal>,
}

/// One volume's profile, and which volume it was.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VwpColumn {
    /// The archive object this came out of, so a column can be traced back.
    pub volume: String,
    /// When the volume was collected, as an ISO string, when it says.
    pub collected: Option<String>,
    pub levels: Vec<VwpLevel>,
}

/// The slant range at which a beam at this elevation is at this height.
///
/// The height is monotonic in range for any elevation at or above zero, so a
/// bisection settles it without inverting the refraction formula by hand. The
/// bracket is the whole range a WSR-88D reads.
pub fn range_at_height(height_km: f64, elevation_degrees: f32) -> Option<f64> {
    if height_km <= 0.0 {
        return None;
    }
    let (mut low, mut high) = (0.0f64, FAR_KM);
    if beam_height_km(high, elevation_degrees) < height_km {
        return None;
    }
    for _ in 0..60 {
        let middle = (low + high) / 2.0;
        if beam_height_km(middle, elevation_degrees) < height_km {
            low = middle;
        } else {
            high = middle;
        }
    }
    let found = (low + high) / 2.0;
    if !(NEAR_KM..=FAR_KM).contains(&found) {
        return None;
    }
    Some(found)
}

/// The gates of one ring, as the fit wants them.
fn ring_at(field: &SweepField, range_km: f64) -> Option<Vec<(f32, f32)>> {
    let interval = field.gate_interval_km();
    if interval <= 0.0 {
        return None;
    }
    let gate = ((range_km - field.first_gate_range_km()) / interval).round();
    if gate < 0.0 || gate >= field.gate_count() as f64 {
        return None;
    }
    let gate = gate as usize;
    let angles = field.azimuths();
    let mut samples = Vec::with_capacity(field.azimuth_count());
    for azimuth in 0..field.azimuth_count() {
        let (value, status) = field.get(azimuth, gate);
        if status != GateStatus::Valid {
            continue;
        }
        let Some(angle) = angles.get(azimuth) else {
            continue;
        };
        samples.push((*angle, value));
    }
    Some(samples)
}

/// Which check a fit failed, for a fit that failed one.
fn refusal(fit: &vad::RingFit) -> Option<Refusal> {
    // The same three thresholds, asked once as a verdict and then again for
    // the reason, so the two cannot answer differently.
    if fit.trusted() {
        return None;
    }
    if fit.used < vad::MIN_FIT_GATES {
        return Some(Refusal::Gates);
    }
    if fit.residual_ms > vad::MAX_RESIDUAL_MS {
        return Some(Refusal::Residual);
    }
    if fit.symmetry_ms > vad::MAX_SYMMETRY_MS {
        return Some(Refusal::Symmetry);
    }
    None
}

/// The wind profile of one decoded volume.
///
/// Every Doppler cut is offered to every level, lowest elevation first, and
/// the first cut that reaches the height inside a readable range is the one
/// the level is fitted from. Lowest first because a beam is narrower in height
/// the lower it is: the same altitude read off a steep cut is an average over
/// a much deeper slab of air.
pub fn profile(volume: &str, scan: &Scan) -> VwpColumn {
    // Lowest elevation first, and each cut's velocity read once rather than
    // once per level.
    let mut cuts: Vec<(f32, SweepField)> = Vec::new();
    for sweep in scan.sweeps() {
        let Some(field) = SweepField::from_radials(sweep.radials(), Product::Velocity) else {
            continue;
        };
        cuts.push((field.elevation_degrees(), field));
    }
    cuts.sort_by(|left, right| left.0.total_cmp(&right.0));

    let mut levels = Vec::with_capacity(LEVELS);
    for step in 1..=LEVELS {
        let height_km = step as f64 * LEVEL_STEP_KM;
        levels.push(level_at(height_km, &cuts));
    }

    VwpColumn {
        volume: volume.to_string(),
        collected: scan
            .sweeps()
            .first()
            .and_then(|sweep| {
                sweep
                    .radials()
                    .first()
                    .and_then(|radial| radial.collection_time())
            })
            .map(|at| at.to_rfc3339()),
        levels,
    }
}

/// One level, from the lowest cut that can see it.
///
/// A cut that reaches the height but whose ring will not fit does not stop the
/// search: the next cut up is asked as well, and only when none of them
/// answers is the level refused. The refusal kept is the first cut's, which is
/// the closest thing to an account of why.
fn level_at(height_km: f64, cuts: &[(f32, SweepField)]) -> VwpLevel {
    let mut refused: Option<Refusal> = None;
    let mut reached = false;

    for (elevation, field) in cuts {
        let Some(range_km) = range_at_height(height_km, *elevation) else {
            continue;
        };
        let Some(samples) = ring_at(field, range_km) else {
            continue;
        };
        reached = true;
        let Some(fit) = vad::fit_ring_checked(&samples, *elevation) else {
            refused = refused.or(Some(Refusal::NoFit));
            continue;
        };
        if let Some(why) = refusal(&fit) {
            refused = refused.or(Some(why));
            continue;
        }
        return VwpLevel {
            height_km,
            speed_ms: Some(fit.wind.speed()),
            from_degrees: Some(fit.wind.coming_from_degrees()),
            elevation_degrees: Some(*elevation),
            range_km: Some(range_km),
            residual_ms: Some(fit.residual_ms),
            symmetry_ms: Some(fit.symmetry_ms),
            refused: None,
        };
    }

    VwpLevel {
        height_km,
        speed_ms: None,
        from_degrees: None,
        elevation_degrees: None,
        range_km: None,
        residual_ms: None,
        symmetry_ms: None,
        refused: Some(if reached {
            refused.unwrap_or(Refusal::NoFit)
        } else {
            Refusal::OutOfReach
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixture;
    use chrono::{TimeZone, Utc};
    use nexrad_data::volume;

    /// A planted wind: ten metres a second out of the south west.
    const SPEED_MS: f32 = 10.0;
    const FROM_DEGREES: f32 = 225.0;

    /// One cut of radials whose velocity is what that wind would read as.
    ///
    /// Built from the textbook statement rather than from `Wind::along_beam`,
    /// so a sign error shared by the generator and the fit could not pass:
    /// the reading falls off as the cosine of the angle between the beam and
    /// the direction the air is going, and is negative into the wind.
    fn wind_cut(
        at: chrono::DateTime<Utc>,
        number: u8,
        degrees: f32,
        gates: usize,
    ) -> Vec<fixture::Radial> {
        let blowing_toward = (FROM_DEGREES + 180.0) % 360.0;
        (0..360u16)
            .map(|step| {
                let azimuth = step as f32;
                let between = (azimuth - blowing_toward).to_radians();
                let radial = SPEED_MS * between.cos() * degrees.to_radians().cos();
                fixture::Radial {
                    azimuth_degrees: azimuth,
                    azimuth_number: step + 1,
                    elevation_number: number,
                    elevation_degrees: degrees,
                    nyquist_ms: 32.0,
                    collected: at,
                    azimuth_spacing_degrees: 1.0,
                    reflectivity: vec![fixture::Gate::Reading(20.0); gates],
                    velocity: vec![fixture::Gate::Reading(radial); gates],
                }
            })
            .collect()
    }

    fn volume_with_wind() -> (String, Scan) {
        let site = fixture::Site {
            id: *b"KDMX",
            latitude: 41.731,
            longitude: -93.723,
            height_metres: 299,
        };
        let at = Utc.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap();
        // Two cuts, four hundred gates each, which is a hundred kilometres at
        // the quarter-kilometre spacing the fixture writes. Short on purpose:
        // the top of the profile is then a height nothing reaches, which is
        // the case the refusal exists for.
        let data = fixture::volume(
            &site,
            at,
            &[wind_cut(at, 1, 0.5, 400), wind_cut(at, 2, 3.5, 400)],
        );
        let file = volume::File::new(data);
        let scan = file.scan().expect("the fixture volume decodes");
        ("KDMX20260501_200000_V06".to_string(), scan)
    }

    #[test]
    fn a_volume_in_a_known_wind_reads_that_wind_back_at_every_height_it_reaches() {
        let (key, scan) = volume_with_wind();
        let column = profile(&key, &scan);
        assert_eq!(column.volume, key);
        assert_eq!(column.levels.len(), LEVELS);

        let read: Vec<&VwpLevel> = column
            .levels
            .iter()
            .filter(|level| level.speed_ms.is_some())
            .collect();
        assert!(
            read.len() >= 3,
            "only {} levels came back with a wind",
            read.len()
        );
        for level in read {
            let speed = level.speed_ms.expect("a speed");
            let from = level.from_degrees.expect("a direction");
            assert!(
                (speed - SPEED_MS).abs() < 1.0,
                "{} km read {speed} m/s",
                level.height_km
            );
            assert!(
                (from - FROM_DEGREES).abs() < 5.0,
                "{} km read {from} degrees",
                level.height_km
            );
            assert!(level.refused.is_none());
            // And it says where it read it from, which is what lets a reader
            // see the geometry behind a barb.
            assert!(level.elevation_degrees.is_some());
            assert!(level.range_km.is_some());
        }
    }

    #[test]
    fn a_height_no_cut_reaches_says_so_rather_than_going_blank() {
        let (key, scan) = volume_with_wind();
        let column = profile(&key, &scan);
        // Twelve kilometres is far above what a half and a three and a half
        // degree cut reach inside a hundred kilometres of gates.
        let top = column.levels.last().expect("a top level");
        assert_eq!(top.height_km, LEVELS as f64 * LEVEL_STEP_KM);
        assert!(top.speed_ms.is_none());
        assert_eq!(top.refused, Some(Refusal::OutOfReach));
    }

    #[test]
    fn the_range_a_beam_is_at_a_height_matches_the_height_it_gives_back() {
        // The bisection and the formula it inverts have to agree, or every
        // level is read off the wrong ring.
        for (height, elevation) in [(1.0, 0.5f32), (3.0, 0.5), (3.0, 3.5), (6.0, 3.5)] {
            let Some(range) = range_at_height(height, elevation) else {
                continue;
            };
            let back = beam_height_km(range, elevation);
            assert!(
                (back - height).abs() < 0.01,
                "{height} km at {elevation} degrees came back as {back}"
            );
        }
        // Nothing reaches ten kilometres on a half degree cut inside the range
        // a ring can be read at.
        assert!(range_at_height(10.0, 0.5).is_none());
        assert!(range_at_height(0.0, 0.5).is_none());
    }
}

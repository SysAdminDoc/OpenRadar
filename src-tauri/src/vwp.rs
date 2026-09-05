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

use std::collections::BTreeMap;

use nexrad_model::data::{GateStatus, Product, Scan, SweepField};
use serde::Serialize;

use crate::cross_section::beam_height_km;
use crate::level3;
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
    /// The gates sat too far to one side to compare the halves at all.
    Lopsided,
    /// Too few gates behind the fit to vouch for it.
    Gates,
    /// The radar's own product had nothing at this height. It is the ND a
    /// forecaster reads off the office's plot, and it is a different answer
    /// from anything this app worked out for itself.
    NotPublished,
}

/// Which of the two answers a column is.
///
/// The radar's own processor runs this fit on every volume and publishes the
/// result as product 48, so most of the time there is no reason to fetch and
/// decode a whole volume to work out something the office has already
/// written down. The fit here is what answers when it has not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VwpSource {
    /// Read out of the radar's own wind profile product.
    Product,
    /// Fitted here, from the volume's velocity.
    Fitted,
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
    /// What the fit did not explain, or, on a column from the radar's own
    /// product, the root mean square difference the RPG published for the
    /// level. Both are the trust number for the wind beside them, and the
    /// column says which one it is carrying.
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
    /// Where the wind came from: the radar's own product, or the fit here.
    pub source: VwpSource,
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

/// Whether a ring's gates are spread widely enough for its mean to mean
/// anything.
///
/// The mean of a uniform wind's radial velocity is zero around a whole
/// circle and nothing in particular around part of one. Measured in twelve
/// sectors rather than four quadrants, because four gates at the compass
/// points satisfy quadrants and say nothing: ten of twelve is an arc of at
/// least three hundred degrees with at most one gap in it.
fn goes_most_of_the_way_round(samples: &[(f32, f32)]) -> bool {
    const SECTORS: usize = 12;
    const NEEDED: usize = 10;
    let mut seen = [false; SECTORS];
    for (azimuth, _) in samples {
        if !azimuth.is_finite() {
            continue;
        }
        let sector = (azimuth.rem_euclid(360.0) / (360.0 / SECTORS as f32)) as usize;
        if let Some(slot) = seen.get_mut(sector.min(SECTORS - 1)) {
            *slot = true;
        }
    }
    seen.iter().filter(|had| **had).count() >= NEEDED
}

/// The same ring with a whole folding interval taken off it, or nothing.
///
/// The region dealiaser fixes patches relative to each other and anchors on
/// the largest, which keeps whatever it read: a sweep comes back right in
/// shape and up to a whole interval out in level, and nothing in the picture
/// says which. That is tolerable for a picture and fatal for this fit, which
/// has no constant term to absorb it. Measured on the fixture: a 35 m/s wind
/// folded at 22 unfolded to a ring running 9 to 79 rather than -35 to 35, and
/// every level came back refused.
///
/// The radial velocity of a uniform wind averages to zero around a circle, so
/// a mean sitting near a whole interval is that interval. That is only true
/// of a ring the beam went most of the way round: a 42 m/s wind read over two
/// thirds of a circle has a mean of its own that looks exactly like an
/// interval.
///
/// So this offers rather than decides, and only for a ring the beam went
/// most of the way round. The caller fits the ring as it stands, and only if
/// that will not do does it try this one; a ring that already answers is
/// never touched.
///
/// Both halves are needed and neither is enough. Adoption alone lets a
/// partial arc through: over an arc the sine and cosine the fit uses are not
/// orthogonal to a constant, so subtracting one is partly absorbed into the
/// wind itself and can turn a refusal into a pass on a ring that was never
/// folded. Measured on a 143 degree arc: a 40 m/s wind refused for symmetry
/// came back as 26 m/s and passed every check.
fn ring_without_a_fold(samples: &[(f32, f32)], nyquist: f32) -> Option<Vec<(f32, f32)>> {
    if nyquist <= 0.0 || samples.is_empty() {
        return None;
    }
    if !goes_most_of_the_way_round(samples) {
        return None;
    }
    let interval = 2.0 * nyquist;
    let mean = samples.iter().map(|(_, value)| *value).sum::<f32>() / samples.len() as f32;
    let intervals = (mean / interval).round();
    if intervals == 0.0 {
        return None;
    }
    Some(
        samples
            .iter()
            .map(|(azimuth, value)| (*azimuth, value - intervals * interval))
            .collect(),
    )
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
    match fit.symmetry_ms {
        None => return Some(Refusal::Lopsided),
        Some(apart) if apart > vad::MAX_SYMMETRY_MS => return Some(Refusal::Symmetry),
        Some(_) => {}
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
pub fn profile(volume: &str, scan: &Scan, nyquist: &BTreeMap<u8, f32>) -> VwpColumn {
    // Lowest elevation first, and each cut's velocity read once rather than
    // once per level.
    let mut cuts: Vec<(f32, SweepField, Option<f32>)> = Vec::new();
    for sweep in scan.sweeps() {
        let Some(mut field) = SweepField::from_radials(sweep.radials(), Product::Velocity) else {
            continue;
        };
        // Unfolded first, on the cut's own limit. A Doppler radar wraps
        // anything faster than its Nyquist velocity, so a ring in a wind
        // above it is not a sine wave and no fit will take it: the level
        // came back refused, and the levels this panel exists for are
        // exactly the ones where the wind is fastest. Measured on the
        // arithmetic: a 35 m/s wind read through a 26.5 m/s limit fits to
        // 18.1 m/s with a residual over the threshold, so it was refused
        // rather than drawn wrong, which is the right failure and still a
        // gap where a jet is.
        let folds_at = nyquist.get(&sweep.elevation_number()).copied();
        if let Some(limit) = folds_at {
            crate::level2::unfold_velocity(&mut field, limit);
        }
        cuts.push((field.elevation_degrees(), field, folds_at));
    }
    cuts.sort_by(|left, right| left.0.total_cmp(&right.0));

    let mut levels = Vec::with_capacity(LEVELS);
    for step in 1..=LEVELS {
        let height_km = step as f64 * LEVEL_STEP_KM;
        levels.push(level_at(height_km, &cuts));
    }

    VwpColumn {
        volume: volume.to_string(),
        source: VwpSource::Fitted,
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

/// How near a published level has to be to one of this app's to speak for it.
///
/// The RPG writes its levels at round altitudes above the sea and this app
/// draws them at half kilometre steps above the radar, so the two sets never
/// line up. Half a step is the widest a level can be moved without it
/// standing in front of the next one along, and anything further is left as
/// ND rather than dragged into place: a wind measured at nine thousand feet
/// is not a statement about three kilometres.
const NEAREST_KM: f64 = LEVEL_STEP_KM / 2.0;

/// One column from the radar's own wind profile product.
///
/// The same heights the fitted column answers at, so the panel can put a
/// product column beside a fitted one and read them off one height rail. A
/// height the product has nothing within half a step of stays empty, which is
/// the ND on the office's own plot.
pub fn from_product(volume: &str, profile: &level3::WindProfile) -> VwpColumn {
    let mut levels = Vec::with_capacity(LEVELS);
    for step in 1..=LEVELS {
        let height_km = step as f64 * LEVEL_STEP_KM;
        let nearest = profile
            .winds
            .iter()
            .min_by(|left, right| {
                (left.height_km - height_km)
                    .abs()
                    .total_cmp(&(right.height_km - height_km).abs())
            })
            .filter(|wind| (wind.height_km - height_km).abs() <= NEAREST_KM);
        levels.push(match nearest {
            Some(wind) => VwpLevel {
                height_km,
                speed_ms: Some(wind.speed_ms),
                from_degrees: Some(wind.from_degrees),
                elevation_degrees: Some(wind.elevation_degrees),
                range_km: Some(wind.range_km),
                residual_ms: Some(wind.rms_ms),
                symmetry_ms: None,
                refused: None,
            },
            None => VwpLevel {
                height_km,
                speed_ms: None,
                from_degrees: None,
                elevation_degrees: None,
                range_km: None,
                residual_ms: None,
                symmetry_ms: None,
                refused: Some(Refusal::NotPublished),
            },
        });
    }
    VwpColumn {
        volume: volume.to_string(),
        collected: Some(profile.volume_time.to_rfc3339()),
        source: VwpSource::Product,
        levels,
    }
}

/// One level, from the lowest cut that can see it.
///
/// A cut that reaches the height but whose ring will not fit does not stop the
/// search: the next cut up is asked as well, and only when none of them
/// answers is the level refused. The refusal kept is the first cut's, which is
/// the closest thing to an account of why.
fn level_at(height_km: f64, cuts: &[(f32, SweepField, Option<f32>)]) -> VwpLevel {
    let mut refused: Option<Refusal> = None;
    let mut reached = false;

    for (elevation, field, folds_at) in cuts {
        let Some(range_km) = range_at_height(height_km, *elevation) else {
            continue;
        };
        let Some(samples) = ring_at(field, range_km) else {
            continue;
        };
        reached = true;
        // As it stands first. Only a ring that will not answer is offered the
        // one with an interval taken off it, and only if that one answers is
        // it used: the shift is a guess about a level the dealiaser could not
        // settle, and a guess must not be allowed to take a barb away.
        let mut fit = vad::fit_ring_checked(&samples, *elevation);
        let mut why = fit.as_ref().and_then(refusal);
        if fit.is_none() || why.is_some() {
            if let Some(levelled) =
                folds_at.and_then(|nyquist| ring_without_a_fold(&samples, nyquist))
            {
                let second = vad::fit_ring_checked(&levelled, *elevation);
                let refused_again = second.as_ref().and_then(refusal);
                if second.is_some() && refused_again.is_none() {
                    fit = second;
                    why = None;
                }
            }
        }
        let Some(fit) = fit else {
            refused = refused.or(Some(Refusal::NoFit));
            continue;
        };
        if let Some(why) = why {
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
            symmetry_ms: fit.symmetry_ms,
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

    /// The wind profile the RPG published for a DMX volume, decoded.
    fn published() -> level3::WindProfile {
        level3::read_wind_profile(include_bytes!(
            "../tests/fixtures/DMX_NVW_2026_09_05_01_05_20"
        ))
        .expect("the fixture is a wind profile")
    }

    #[test]
    fn a_published_column_answers_on_the_same_heights_the_fit_does() {
        // The panel puts the columns of a loop side by side against one
        // height rail, so a column from the office and a column fitted here
        // have to be the same shape or the rail says one thing and the barbs
        // beside it another.
        let column = from_product("DMX_NVW_2026_09_05_01_05_20", &published());
        assert_eq!(column.source, VwpSource::Product);
        assert_eq!(column.levels.len(), LEVELS);
        for (at, level) in column.levels.iter().enumerate() {
            assert!(
                (level.height_km - (at + 1) as f64 * LEVEL_STEP_KM).abs() < f64::EPSILON,
                "level {at} is at {} km",
                level.height_km
            );
        }
        assert_eq!(
            column.collected.as_deref(),
            Some("2026-09-05T01:05:20+00:00")
        );
    }

    #[test]
    fn a_published_level_carries_the_office_wind_and_its_own_trust_number() {
        // The table's row at 3,000 feet above the sea is 284 degrees at five
        // knots with an RMS of 4.9, and the radar stands at 1,094 feet, which
        // puts it 0.58 km up: inside a quarter kilometre of the half kilometre
        // level, so that is the level it speaks for.
        let column = from_product("DMX", &published());
        let level = &column.levels[0];
        assert!((level.height_km - 0.5).abs() < f64::EPSILON);
        assert_eq!(level.from_degrees, Some(284.0));
        assert!((level.speed_ms.expect("a wind") - 2.572).abs() < 0.01);
        // The RPG's own root mean square difference, in metres a second, not
        // a residual this app worked out.
        assert!((level.residual_ms.expect("a trust number") - 2.521).abs() < 0.01);
        assert_eq!(level.symmetry_ms, None);
        assert_eq!(level.refused, None);
        assert_eq!(level.elevation_degrees, Some(0.9));
    }

    #[test]
    fn a_height_the_office_did_not_publish_stays_empty() {
        // The office's plot writes ND at a height its algorithm could not
        // read, and this fixture's table stops at 12,200 feet, which is 3.4
        // km above the radar. Every level above that is ND: filling one in
        // from the last wind below it would draw shear nobody measured.
        let column = from_product("DMX", &published());
        let top = column
            .levels
            .iter()
            .rposition(|level| level.speed_ms.is_some())
            .expect("some level was published");
        assert!(
            (column.levels[top].height_km - 3.5).abs() < f64::EPSILON,
            "the highest published level is at {} km",
            column.levels[top].height_km
        );
        for level in &column.levels[top + 1..] {
            assert_eq!(level.speed_ms, None);
            assert_eq!(level.from_degrees, None);
            assert_eq!(level.refused, Some(Refusal::NotPublished));
        }
    }

    #[test]
    fn a_wind_below_the_lowest_level_is_not_dragged_up_to_it() {
        // The office publishes down to a few hundred feet above the tower and
        // this panel's lowest level is half a kilometre up, so the bottom two
        // rows of most tables belong to no level here. Half a step is the
        // whole rule: a wind measured at three hundred feet is not a statement
        // about half a kilometre, and a nearest-wins lookup with no distance
        // on it would put it there.
        let profile = level3::WindProfile {
            volume_time: chrono::Utc::now(),
            winds: vec![level3::ProductWind {
                height_km: 0.09,
                from_degrees: 270.0,
                speed_ms: 20.0,
                rms_ms: 1.0,
                elevation_degrees: 0.5,
                range_km: 10.0,
            }],
        };
        let column = from_product("DMX", &profile);
        assert!(
            column.levels.iter().all(|level| level.speed_ms.is_none()),
            "a wind below every level was drawn on one of them"
        );
    }
    use crate::fixture;
    use chrono::{TimeZone, Utc};
    use nexrad_data::volume;

    /// A planted wind: ten metres a second out of the south west at the
    /// ground, veering with height the way a real one does.
    const SPEED_MS: f32 = 10.0;
    const FROM_DEGREES: f32 = 225.0;

    /// How far the planted wind turns per kilometre of range along the beam.
    ///
    /// It used to be the same wind at every gate, which made the profile test
    /// pass whichever ring each level was read off: a level taken from the
    /// wrong range, the wrong cut, or a range computed for another height all
    /// read back the same answer, so the one thing the test was for was the
    /// one thing it could not see. A wind that turns as the beam climbs makes
    /// the direction at each level a statement about the geometry.
    const VEER_PER_KM: f32 = 0.5;

    /// The gate spacing the fixture writes, in kilometres.
    const GATE_KM: f32 = 0.25;

    /// Where the planted wind comes from at one range along the beam.
    fn planted_from(range_km: f32) -> f32 {
        (FROM_DEGREES + VEER_PER_KM * range_km).rem_euclid(360.0)
    }

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
        (0..360u16)
            .map(|step| {
                let azimuth = step as f32;
                // One reading per gate rather than one per radial, because the
                // wind is a different one at every range.
                let velocity: Vec<fixture::Gate> = (0..gates)
                    .map(|gate| {
                        let range_km = (gate as f32 + 1.0) * GATE_KM;
                        let toward = (planted_from(range_km) + 180.0).rem_euclid(360.0);
                        let between = (azimuth - toward).to_radians();
                        fixture::Gate::Reading(
                            SPEED_MS * between.cos() * degrees.to_radians().cos(),
                        )
                    })
                    .collect();
                fixture::Radial {
                    azimuth_degrees: azimuth,
                    azimuth_number: step + 1,
                    elevation_number: number,
                    elevation_degrees: degrees,
                    nyquist_ms: 32.0,
                    collected: at,
                    azimuth_spacing_degrees: 1.0,
                    reflectivity: vec![fixture::Gate::Reading(20.0); gates],
                    velocity,
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
        let column = profile(&key, &scan, &BTreeMap::new());
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
            // The wind this level's own ring was planted in, which is what
            // makes this a check of the height-to-range geometry rather than
            // of the fit alone: read the level off another range and the
            // direction is wrong by degrees per kilometre of the miss.
            // The ring this level was actually read off has to be the ring
            // at this height. Without this the direction check below is
            // self-consistent and proves nothing: it would compare the fit
            // against whatever range the code said it used, so a level taken
            // twenty kilometres too far out would still agree with itself.
            let range_km = level.range_km.expect("a range");
            let elevation = level.elevation_degrees.expect("an elevation");
            let back = beam_height_km(range_km, elevation);
            assert!(
                (back - level.height_km).abs() < 0.05,
                "{} km was read off {range_km} km, which is {back} km up",
                level.height_km
            );
            let range = range_km as f32;
            let expected = planted_from(range);
            let apart = (from - expected).rem_euclid(360.0);
            let apart = apart.min(360.0 - apart);
            assert!(
                apart < 5.0,
                "{} km at {range} km read {from} degrees, not {expected}",
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
        let column = profile(&key, &scan, &BTreeMap::new());
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

    /// A cut in a wind too fast for its own folding limit.
    ///
    /// The velocity a radar reports wraps at its Nyquist limit, so the same
    /// arithmetic as `wind_cut` with a faster wind and a tighter limit, then
    /// folded the way the radar would fold it.
    fn folded_cut(
        at: chrono::DateTime<Utc>,
        number: u8,
        degrees: f32,
        gates: usize,
        speed_ms: f32,
        nyquist_ms: f32,
    ) -> Vec<fixture::Radial> {
        (0..360u16)
            .map(|step| {
                let azimuth = step as f32;
                let velocity: Vec<fixture::Gate> = (0..gates)
                    .map(|gate| {
                        let range_km = (gate as f32 + 1.0) * GATE_KM;
                        let toward = (planted_from(range_km) + 180.0).rem_euclid(360.0);
                        let between = (azimuth - toward).to_radians();
                        let real = speed_ms * between.cos() * degrees.to_radians().cos();
                        // What the radar would have written down: everything
                        // outside the limit comes back a whole interval in.
                        let span = 2.0 * nyquist_ms;
                        let folded = ((real + nyquist_ms).rem_euclid(span)) - nyquist_ms;
                        fixture::Gate::Reading(folded)
                    })
                    .collect();
                fixture::Radial {
                    azimuth_degrees: azimuth,
                    azimuth_number: step + 1,
                    elevation_number: number,
                    elevation_degrees: degrees,
                    nyquist_ms,
                    collected: at,
                    azimuth_spacing_degrees: 1.0,
                    reflectivity: vec![fixture::Gate::Reading(20.0); gates],
                    velocity,
                }
            })
            .collect()
    }

    #[test]
    fn a_wind_above_the_folding_limit_is_read_rather_than_refused() {
        // The levels this panel exists for are the ones where the wind is
        // fastest, and those are the ones a Doppler radar wraps. A folded
        // ring is not a sine wave, so no fit takes it and the level came back
        // "the fit was noisy": the jet a forecaster opened the profile to see
        // was the one thing it would not show them.
        let site = fixture::Site {
            id: *b"KDMX",
            latitude: 41.731,
            longitude: -93.723,
            height_metres: 299,
        };
        let at = Utc.with_ymd_and_hms(2026, 5, 1, 20, 0, 0).unwrap();
        // Thirty-five metres a second through a twenty-two limit, which is a
        // real low-level jet through a real velocity-only cut.
        let speed = 35.0f32;
        let nyquist = 22.0f32;
        let data = fixture::volume(&site, at, &[folded_cut(at, 1, 0.5, 400, speed, nyquist)]);
        let file = volume::File::new(data);
        let scan = file.scan().expect("the fixture volume decodes");
        let key = "KDMX20260501_200000_V06";

        // First the failure, so this cannot pass by the fixture not folding:
        // with no limit to unfold on, nothing is readable.
        let blind = profile(key, &scan, &BTreeMap::new());
        assert!(
            blind.levels.iter().all(|level| level.speed_ms.is_none()),
            "a folded ring fitted without being unfolded",
        );

        // And then the same volume with the cut's own limit in hand.
        let mut table = BTreeMap::new();
        table.insert(1u8, nyquist);
        let column = profile(key, &scan, &table);
        let read: Vec<&VwpLevel> = column
            .levels
            .iter()
            .filter(|level| level.speed_ms.is_some())
            .collect();
        assert!(
            !read.is_empty(),
            "no level came back with a wind after unfolding",
        );
        for level in read {
            let found = level.speed_ms.expect("a speed");
            assert!(
                (found - speed).abs() < 2.0,
                "{} km read {found} m/s of a planted {speed}",
                level.height_km,
            );
        }
    }

    #[test]
    fn a_ring_that_already_answers_is_never_shifted() {
        // The case an adversarial pass found. A ring covering two thirds of a
        // circle in a fast wind has a mean of its own that looks exactly like
        // a whole folding interval, so a pin that fired on the mean alone
        // moved an exact fit by a whole interval and the symmetry check then
        // refused it: 41.8 m/s from 200 degrees became 24.2 and then a gap,
        // in the very regime this panel exists for. It is offered rather than
        // applied now, and a ring that already answers is never offered it.
        let elevation = 0.5f32;
        let speed = 41.8f32;
        let from = 200.0f32;
        let toward = (from + 180.0).rem_euclid(360.0);
        // Two thirds of a circle, which is what one-sided echo looks like.
        let samples: Vec<(f32, f32)> = (110..=290)
            .map(|azimuth| {
                let angle = azimuth as f32;
                let between = (angle - toward).to_radians();
                (angle, speed * between.cos() * elevation.to_radians().cos())
            })
            .collect();

        // The ring as it stands is an exact fit.
        let straight = vad::fit_ring_checked(&samples, elevation).expect("a fit");
        assert!(refusal(&straight).is_none(), "the ring already answers");
        assert!((straight.wind.speed() - speed).abs() < 1.0);

        // Its mean is far enough from zero to look like a whole interval,
        // which is what made the first version of this shift on it.
        let nyquist = 8.0f32;
        let interval = 2.0 * nyquist;
        let mean = samples.iter().map(|(_, value)| *value).sum::<f32>() / samples.len() as f32;
        assert!(
            (mean / interval).round() != 0.0,
            "this arc has to look folded for the test to be about anything",
        );

        // It is not offered one, because two thirds of a circle is not a
        // circle. Over an arc the fit's own sine and cosine are not
        // orthogonal to a constant, so subtracting one is partly absorbed
        // into the wind: an adversarial pass found arcs where that turned a
        // refusal into a confident wrong answer rather than into a lost barb.
        assert!(
            ring_without_a_fold(&samples, nyquist).is_none(),
            "a partial arc was offered a shift its coverage cannot justify",
        );
    }

    #[test]
    fn a_full_ring_in_an_ordinary_wind_is_offered_nothing() {
        // The other guard, on a ring the coverage one lets through: a whole
        // circle in a wind inside the radar's limit averages to nothing, so
        // there is no interval to take off and nothing to adopt.
        let elevation = 0.5f32;
        let speed = 12.0f32;
        let toward = (200.0f32 + 180.0).rem_euclid(360.0);
        let samples: Vec<(f32, f32)> = (0..360)
            .map(|azimuth| {
                let angle = azimuth as f32;
                let between = (angle - toward).to_radians();
                (angle, speed * between.cos() * elevation.to_radians().cos())
            })
            .collect();

        let straight = vad::fit_ring_checked(&samples, elevation).expect("a fit");
        assert!(refusal(&straight).is_none(), "the ring already answers");
        assert!((straight.wind.speed() - speed).abs() < 1.0);
        assert!(ring_without_a_fold(&samples, 26.0).is_none());
    }
}

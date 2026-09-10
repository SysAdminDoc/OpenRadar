//! Where the snow is turning to rain, read off the volume's own high cut.
//!
//! Falling snow picks up a skin of meltwater before it collapses into a
//! raindrop, and for those few hundred metres it looks like a very large wet
//! particle: the reflectivity jumps, the differential reflectivity jumps with
//! it, and the correlation between the two polarisations falls away because
//! nothing in the beam looks like anything else in it. That band is the
//! freezing level, and every radar sees it.
//!
//! Reading it here rather than from a sounding matters because the sounding
//! this app can reach may be hours old and a hundred miles away, while the
//! bright band is in the volume on screen. The hail size worked out in
//! `derive` needs a freezing level and takes the far one today.
//!
//! The method is the published automated detection: normalise reflectivity,
//! differential reflectivity and one minus the correlation onto the same
//! scale, multiply them, and take the gates over a threshold. A high cut is
//! used because the beam climbs through the band quickly there, so the layer
//! is a few gates rather than a smear across the whole disc, and because the
//! ground is far below it.

use nexrad_model::data::{GateStatus, SweepField};
use serde::Serialize;

use crate::cross_section::beam_height_km;
use crate::gates;

/// The lowest cut this will read.
///
/// Below this the beam climbs so slowly that the band spreads over tens of
/// kilometres of range and the layer cannot be told from the rain under it.
/// The published method uses nine degrees and so does this.
pub const LOWEST_TILT_DEGREES: f32 = 9.0;

/// The reflectivity a melting particle is expected to sit between, in dBZ.
const Z_RANGE: (f32, f32) = (20.0, 55.0);
/// The same for differential reflectivity, in dB.
const ZDR_RANGE: (f32, f32) = (0.8, 2.5);
/// And for the correlation, which falls rather than rises through the band.
const RHO_RANGE: (f32, f32) = (0.90, 0.97);

/// How high the product of the three has to be for a gate to be in the band.
pub const MEMBERSHIP_THRESHOLD: f32 = 0.08;

/// How tall a bin of the height histogram is, in kilometres.
///
/// A hundred metres, which is finer than the quarter kilometre the acceptance
/// asks the answer to be good to and coarse enough that a single ray cannot
/// make a bin of its own.
const BIN_KM: f64 = 0.1;

/// How far down from the peak a bin still counts as part of the layer.
///
/// Half the peak, which is where a band's own shoulders fall. Lower than this
/// and the layer swallows the rain below it; higher and it reports a slab one
/// bin thick whatever the volume shows.
const SHOULDER: f64 = 0.5;

/// How many gates have to agree before a layer is worth reporting.
///
/// A handful of gates scattered over a disc is noise that happened to clear
/// the threshold, not a band. Sixty is about one gate on each of sixty rays.
const ENOUGH_GATES: usize = 60;

/// Where the melting layer is, above the radar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeltingLayer {
    /// The top of the band, in kilometres above the radar.
    pub top_km: f64,
    /// The bottom of it, which is where the snow has finished melting.
    pub bottom_km: f64,
    /// The height the most gates agreed on, which is the band's own middle.
    pub peak_km: f64,
    /// The cut it was read from, in degrees.
    pub elevation_degrees: f32,
    /// How many gates were in the band, so a caller can weigh the answer.
    pub gates: usize,
}

/// Why a volume has no melting layer to report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "reason")]
pub enum NoLayer {
    /// The volume has no cut at or above the angle this reads.
    NoHighTilt,
    /// The cut is there but one of the three moments it needs is not.
    MissingMoment,
    /// Nothing in the cut looked like melting snow.
    NothingMelting,
}

/// Scales a reading onto nought to one between two bounds.
fn between(value: f32, low: f32, high: f32) -> f32 {
    ((value - low) / (high - low)).clamp(0.0, 1.0)
}

/// How much a gate looks like melting snow, from nought to one.
///
/// The product rather than the average, because all three have to hold: heavy
/// rain is bright and has a high correlation, and a biological target has a
/// low correlation and almost no reflectivity. Only the band has all three at
/// once.
pub fn membership(reflectivity: f32, differential: f32, correlation: f32) -> f32 {
    let z = between(reflectivity, Z_RANGE.0, Z_RANGE.1);
    let zdr = between(differential, ZDR_RANGE.0, ZDR_RANGE.1);
    // Inverted: the correlation falls through the band, so the further below
    // the top of the range it sits the more it looks like melting snow.
    let rho = between(-correlation, -RHO_RANGE.1, -RHO_RANGE.0);
    z * zdr * rho
}

/// The heights of every gate in the cut that looks like melting snow.
fn heights_in_band(
    reflectivity: &SweepField,
    differential: &SweepField,
    correlation: &SweepField,
) -> Vec<f64> {
    let elevation = reflectivity.elevation_degrees();
    let mut found = Vec::new();
    for (azimuth, angle) in reflectivity.azimuths().iter().enumerate() {
        for gate in 0..reflectivity.gate_count() {
            let (z, status) = reflectivity.get(azimuth, gate);
            if !matches!(status, GateStatus::Valid) {
                continue;
            }
            let range = gates::gate_centre_km(reflectivity, gate);
            // The other two moments are their own sweeps with their own gate
            // spacing, so they are read by range rather than by index. This
            // is the same trap the debris criteria hit: four fields, four
            // gate geometries, and reading them by index puts three of the
            // four readings at the wrong range.
            let Some((zdr, zdr_status)) = gates::reading_at(differential, *angle, range) else {
                continue;
            };
            let Some((rho, rho_status)) = gates::reading_at(correlation, *angle, range) else {
                continue;
            };
            if !matches!(zdr_status, GateStatus::Valid) || !matches!(rho_status, GateStatus::Valid)
            {
                continue;
            }
            if membership(z, zdr, rho) < MEMBERSHIP_THRESHOLD {
                continue;
            }
            found.push(beam_height_km(range, elevation));
        }
    }
    found
}

/// The band a set of gate heights agrees on.
///
/// A histogram rather than a mean, because the gates that clear the threshold
/// are not all in the band: a few will be hail and a few will be ground. The
/// mode is where the band is and the shoulders are where it stops.
pub fn band_of(heights: &[f64]) -> Option<(f64, f64, f64)> {
    if heights.len() < ENOUGH_GATES {
        return None;
    }
    let mut counts: std::collections::BTreeMap<i64, usize> = std::collections::BTreeMap::new();
    for height in heights {
        if !height.is_finite() || *height < 0.0 {
            continue;
        }
        *counts.entry((height / BIN_KM).floor() as i64).or_insert(0) += 1;
    }
    let (&peak_bin, &peak) = counts.iter().max_by_key(|(_, count)| **count)?;
    let floor = (peak as f64 * SHOULDER).ceil() as usize;
    // Out from the peak while the bins still hold their half of it, and
    // stopping at the first that does not: a second band further up is a
    // different layer and not the shoulder of this one.
    let mut top = peak_bin;
    while counts.get(&(top + 1)).copied().unwrap_or(0) >= floor {
        top += 1;
    }
    let mut bottom = peak_bin;
    while counts.get(&(bottom - 1)).copied().unwrap_or(0) >= floor {
        bottom -= 1;
    }
    Some((
        // The top edge of the topmost bin and the bottom edge of the lowest.
        (top + 1) as f64 * BIN_KM,
        bottom as f64 * BIN_KM,
        (peak_bin as f64 + 0.5) * BIN_KM,
    ))
}

/// Reads the melting layer out of one cut's three moments.
pub fn from_cut(
    reflectivity: &SweepField,
    differential: &SweepField,
    correlation: &SweepField,
) -> Result<MeltingLayer, NoLayer> {
    let elevation = reflectivity.elevation_degrees();
    if elevation < LOWEST_TILT_DEGREES {
        return Err(NoLayer::NoHighTilt);
    }
    let heights = heights_in_band(reflectivity, differential, correlation);
    let (top_km, bottom_km, peak_km) = band_of(&heights).ok_or(NoLayer::NothingMelting)?;
    Ok(MeltingLayer {
        top_km,
        bottom_km,
        peak_km,
        elevation_degrees: elevation,
        gates: heights.len(),
    })
}

/// The melting layer in a decoded volume, read from its highest usable cut.
///
/// The highest rather than the first at or above the angle: the beam climbs
/// faster the steeper it is, so the band is thinner in range and the answer is
/// sharper, and a high cut is further from the ground clutter.
pub fn from_volume(scan: &nexrad_model::data::Scan) -> Result<MeltingLayer, NoLayer> {
    use nexrad_model::data::Product;

    let mut angles = crate::level2::tilts(scan);
    angles.retain(|angle| *angle >= LOWEST_TILT_DEGREES);
    if angles.is_empty() {
        return Err(NoLayer::NoHighTilt);
    }
    angles.sort_by(|left, right| right.partial_cmp(left).unwrap_or(std::cmp::Ordering::Equal));

    let mut missing = false;
    for angle in angles {
        let Some(z) = crate::level2::sweep_field_at(scan, Product::Reflectivity, angle) else {
            missing = true;
            continue;
        };
        let Some(zdr) =
            crate::level2::sweep_field_at(scan, Product::DifferentialReflectivity, angle)
        else {
            missing = true;
            continue;
        };
        let Some(rho) = crate::level2::sweep_field_at(scan, Product::CorrelationCoefficient, angle)
        else {
            missing = true;
            continue;
        };
        // A cut that has all three but no band in it is not a reason to stop:
        // the next one down may still be above the angle and may see it.
        match from_cut(&z.field, &zdr.field, &rho.field) {
            Ok(found) => return Ok(found),
            Err(NoLayer::NothingMelting) => continue,
            Err(other) => return Err(other),
        }
    }
    if missing {
        return Err(NoLayer::MissingMoment);
    }
    Err(NoLayer::NothingMelting)
}

#[cfg(test)]
#[path = "melting_tests.rs"]
mod tests;

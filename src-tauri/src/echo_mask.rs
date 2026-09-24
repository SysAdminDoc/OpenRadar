//! Echo that is not weather, taken off a picture when the reader asks.
//!
//! Bird and insect blooms, wind farms, chaff and ground clutter draw in the
//! same colours as rain. The office's own quality control takes them out with
//! a handful of thresholds on the polarimetric moments this app already
//! decodes: a correlation coefficient below what precipitation gives, a
//! correlation that jumps about from gate to gate, a lower bar inside the
//! melting layer where the mix of rain and snow reads low as well, and hail
//! let back in, because a hail core reads low too. The WDTD dual-pol quality
//! control notes give the thresholds; Py-ART's gate filter uses the same
//! shape with its own numbers.
//!
//! A picture only. The readout under the cursor, every export and the
//! vertical slice keep every gate the radar reported, because a mask is a
//! judgement about what a gate is and those are the readings themselves.

use nexrad_model::data::{GateStatus, SweepField};

use crate::cross_section::beam_height_km;
use crate::derive::{slant_for, swept};
use crate::gates::reading_at;

/// Precipitation reads at least this. Below it a gate is a candidate.
const RHO_WEATHER: f32 = 0.95;

/// Inside the melting layer, where rain and wet snow mix, weather reads down
/// to here, so only a gate below it is a candidate there.
const RHO_MELTING: f32 = 0.7;

/// How far the correlation may wander over a few gates and still be one kind
/// of target. A bloom's correlation is noisy from gate to gate; rain's edge
/// dips and stays smooth.
const RHO_TEXTURE: f32 = 0.10;

/// Gates either side of one that its texture is measured over.
const TEXTURE_REACH: usize = 2;

/// A core this strong can be hail, which reads a low correlation of its own.
const HAIL_DBZ: f32 = 45.0;

/// What has to be above a strong core for it to be let back in: echo of this
/// much at least this far above it on a higher cut. A storm's core stands in
/// a column that reaches up; clutter and a wind farm stop at the ground.
const ALOFT_DBZ: f32 = 30.0;
const ALOFT_KM: f64 = 2.0;

/// One cut of reflectivity, for the question of what stands above a gate.
pub struct Above<'a> {
    pub elevation: f32,
    pub reflectivity: &'a SweepField,
}

/// Which gates of a cut are not weather, as a field on the correlation's own
/// geometry that holds a reading exactly where a gate is to be hidden.
///
/// `melting_km` is the bottom and top of the melting layer above the antenna,
/// when the volume has one.
pub fn non_weather(
    correlation: &SweepField,
    reflectivity: Option<&SweepField>,
    elevation: f32,
    above: &[Above<'_>],
    melting_km: Option<(f64, f64)>,
) -> SweepField {
    let azimuths = correlation.azimuths().to_vec();
    let gates = correlation.gate_count();
    let first_km = correlation.first_gate_range_km();
    let interval_km = correlation.gate_interval_km();
    // Which bearings each higher cut has actually swept. A cut the radar is
    // still sweeping holds only the radials it has reached, and the reader
    // answers any other bearing with the nearest radial however far round
    // that is: a storm sixty degrees away was letting a wind farm back in.
    let reached: Vec<Vec<bool>> = above
        .iter()
        .map(|cut| swept(cut.reflectivity, &azimuths))
        .collect();
    let mut hidden = SweepField::new_empty(
        "Not weather",
        "",
        elevation,
        azimuths.clone(),
        correlation.azimuth_spacing_degrees(),
        first_km,
        interval_km,
        gates,
    );
    for (at, azimuth) in azimuths.iter().enumerate() {
        let row: Vec<Option<f32>> = (0..gates)
            .map(|gate| match correlation.get(at, gate) {
                (rho, GateStatus::Valid) if rho.is_finite() => Some(rho),
                _ => None,
            })
            .collect();
        for gate in 0..gates {
            let Some(rho) = row[gate] else { continue };
            let range_km = first_km + gate as f64 * interval_km;
            let height_km = beam_height_km(range_km, elevation);
            let melting =
                melting_km.is_some_and(|(bottom, top)| (bottom..=top).contains(&height_km));
            let bar = if melting { RHO_MELTING } else { RHO_WEATHER };
            if rho >= bar {
                continue;
            }
            if texture(&row, gate).is_none_or(|spread| spread <= RHO_TEXTURE) {
                continue;
            }
            let strong = reflectivity.is_some_and(|field| {
                matches!(
                    reading_at(field, *azimuth, range_km),
                    Some((dbz, GateStatus::Valid)) if dbz >= HAIL_DBZ
                )
            });
            if strong {
                let over = over_the_gate(
                    above, &reached, at, *azimuth, range_km, elevation, height_km,
                );
                // Kept when a higher cut sees a column over it, and kept when
                // no higher cut passes over it at all: on the top cut, or a
                // low one close in, nothing can tell a hail core from a wind
                // farm, and hiding a core somebody is looking at is the worse
                // of the two mistakes.
                if over != Over::Clear {
                    continue;
                }
            }
            hidden.set(at, gate, 1.0, GateStatus::Valid);
        }
    }
    hidden
}

/// How far the correlation wanders around one gate: the standard deviation
/// over the gates either side of it that hold a reading, or nothing when too
/// few do to say.
fn texture(row: &[Option<f32>], gate: usize) -> Option<f32> {
    let from = gate.saturating_sub(TEXTURE_REACH);
    let to = (gate + TEXTURE_REACH).min(row.len() - 1);
    let readings: Vec<f32> = row[from..=to].iter().flatten().copied().collect();
    if readings.len() < 3 {
        return None;
    }
    let mean = readings.iter().sum::<f32>() / readings.len() as f32;
    let variance =
        readings.iter().map(|rho| (rho - mean).powi(2)).sum::<f32>() / readings.len() as f32;
    Some(variance.sqrt())
}

/// What the higher cuts say about the air well above a gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Over {
    /// A higher cut sees echo there, so the gate stands in a storm's column.
    Column,
    /// A higher cut passed over it and saw nothing that strong.
    Clear,
    /// No higher cut passes that far over it where it has been swept.
    Unseen,
}

/// Whether a higher cut sees echo well above a gate, over the same ground.
fn over_the_gate(
    above: &[Above<'_>],
    reached: &[Vec<bool>],
    row: usize,
    azimuth: f32,
    range_km: f64,
    elevation: f32,
    height_km: f64,
) -> Over {
    // The ground under the gate, by the model the column products use.
    let ground_km = range_km * f64::from(elevation.to_radians().cos());
    let mut seen = false;
    for (cut, swept) in above.iter().zip(reached) {
        if cut.elevation <= elevation || !swept[row] {
            continue;
        }
        let Some(slant_km) = slant_for(ground_km, cut.elevation) else {
            continue;
        };
        if beam_height_km(slant_km, cut.elevation) < height_km + ALOFT_KM {
            continue;
        }
        match reading_at(cut.reflectivity, azimuth, slant_km) {
            Some((dbz, GateStatus::Valid)) if dbz >= ALOFT_DBZ => return Over::Column,
            // The radar looked there and found nothing strong.
            Some(_) => seen = true,
            // Past the end of that cut, which says nothing either way.
            None => {}
        }
    }
    if seen {
        Over::Clear
    } else {
        Over::Unseen
    }
}

#[cfg(test)]
#[path = "echo_mask_tests.rs"]
mod tests;

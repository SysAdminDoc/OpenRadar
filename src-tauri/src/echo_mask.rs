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
use crate::derive::slant_for;
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
            if strong && stands_in_a_column(above, *azimuth, range_km, elevation, height_km) {
                continue;
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

/// Whether a higher cut sees echo well above a gate, over the same ground.
fn stands_in_a_column(
    above: &[Above<'_>],
    azimuth: f32,
    range_km: f64,
    elevation: f32,
    height_km: f64,
) -> bool {
    // The ground under the gate, by the model the column products use.
    let ground_km = range_km * f64::from(elevation.to_radians().cos());
    above
        .iter()
        .filter(|cut| cut.elevation > elevation)
        .any(|cut| {
            let Some(slant_km) = slant_for(ground_km, cut.elevation) else {
                return false;
            };
            beam_height_km(slant_km, cut.elevation) >= height_km + ALOFT_KM
                && matches!(
                    reading_at(cut.reflectivity, azimuth, slant_km),
                    Some((dbz, GateStatus::Valid)) if dbz >= ALOFT_DBZ
                )
        })
}

#[cfg(test)]
#[path = "echo_mask_tests.rs"]
mod tests;

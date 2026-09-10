//! Specific differential phase, from the volume's own differential phase.
//!
//! The radar records how far the horizontal and vertical returns have drifted
//! apart in phase by the time they come back, which is a running total along
//! the beam. What forecasters actually read is its slope: how fast the drift
//! is accumulating right here, which is proportional to the liquid water the
//! beam is passing through. That makes it the field for finding heavy rain,
//! and unlike reflectivity it is unaffected by attenuation, by partial beam
//! blockage or by the radar's own calibration.
//!
//! It ships as a Level III product and not as a moment, so a site's own
//! version has to be worked out from the phase itself. The method is Vulpiani
//! et al. 2012: censor, despeckle, take the slope over a window, use that
//! first guess to find where the phase wrapped, and then iterate between phase
//! and slope twice so the two agree.

use nexrad_model::data::{GateStatus, SweepField};

use crate::gates::reading_at;

/// Below this the two polarisations are not looking at the same thing, so the
/// phase between them is not a measurement.
pub const CENSOR_CORRELATION: f32 = 0.9;

/// The window the slope is taken over, in kilometres.
///
/// Seven gates at the kilometre resolution the paper used. Held in kilometres
/// rather than in gates because this radar's dual-pol moments are on quarter
/// kilometre gates: seven of those is a window a quarter the size, which reads
/// four times the noise as signal.
const WINDOW_KM: f64 = 7.0;

/// A run of readings shorter than this is speckle rather than rain.
const DESPECKLE_GATES: usize = 5;

/// The band a slope has to be in to be believable, in degrees a kilometre.
///
/// The paper's th1 and th2. Below the floor is backscatter differential phase
/// or noise and above the ceiling is more rain than falls; both are set to
/// nothing rather than drawn, because either drawn as rain is a false reading
/// in the one field somebody turns to for how hard it is raining.
const MIN_SLOPE: f32 = -2.0;
const MAX_SLOPE: f32 = 20.0;

/// A slope this far below zero is not a slope, it is the phase wrapping.
///
/// The paper's th3. The total only climbs, so a large negative step is the
/// field coming back round rather than the rain reversing.
const FOLD_SLOPE: f32 = -20.0;

/// How many times phase and slope are reconciled against each other.
const ITERATIONS: usize = 2;

/// The label and unit this is drawn under.
pub fn named() -> (&'static str, &'static str) {
    ("Specific differential phase", "deg/km")
}

/// One line saying how the numbers were arrived at, for the export header.
pub fn derivation(field: &SweepField) -> String {
    format!(
        "specific differential phase by the iterative finite difference method of \
         Vulpiani et al. 2012: gates with a correlation coefficient below \
         {CENSOR_CORRELATION} censored, runs shorter than {DESPECKLE_GATES} gates \
         despeckled, the slope taken by least squares over {WINDOW_KM:.0} km \
         ({} gates here) and halved for the two-way path, the phase unfolded where \
         the slope falls below {FOLD_SLOPE} degrees a kilometre, slopes outside \
         {MIN_SLOPE} to {MAX_SLOPE} degrees a kilometre discarded, and phase and \
         slope reconciled over {ITERATIONS} iterations",
        window_gates(field.gate_interval_km())
    )
}

/// How many gates the window covers here, always odd and never below three.
fn window_gates(interval_km: f64) -> usize {
    if interval_km <= 0.0 {
        return 3;
    }
    let gates = (WINDOW_KM / interval_km).round() as usize;
    let gates = gates.max(3);
    if gates.is_multiple_of(2) {
        gates + 1
    } else {
        gates
    }
}

/// Works one cut's phase into a slope.
///
/// The correlation coefficient is a separate sweep at the same tilt with its
/// own gate spacing, so it is asked by where a gate is rather than by index.
/// A volume without it is refused rather than drawn uncensored: the phase in
/// non-weather reads as whatever the ground under the beam happens to do to
/// it, and drawn as rain that is the field saying it is pouring over a
/// motorway.
pub fn derive(phase: &SweepField, correlation: Option<&SweepField>) -> Option<SweepField> {
    let correlation = correlation?;
    let azimuths = phase.azimuth_count();
    let gates = phase.gate_count();
    let interval_km = phase.gate_interval_km();
    if azimuths == 0 || gates < 3 || interval_km <= 0.0 {
        return None;
    }
    let window = window_gates(interval_km);
    let (label, unit) = named();
    let mut out = phase.new_like(label, unit);
    let angles = phase.azimuths().to_vec();

    let mut ray: Vec<Option<f32>> = vec![None; gates];
    let mut slope: Vec<Option<f32>> = vec![None; gates];
    let mut rebuilt: Vec<Option<f32>> = vec![None; gates];
    let mut measured: Vec<bool> = vec![false; gates];
    for (at, azimuth) in angles.iter().enumerate() {
        read_ray(phase, correlation, at, *azimuth, &mut ray);
        despeckle(&mut ray);
        // Which gates the radar actually measured, kept before the ray is
        // filled in. The reconciliation below runs over the whole ray because
        // an integral cannot skip a stretch and carry on, but a gate the radar
        // saw nothing at is not a gate where it is not raining: it is one
        // there is no answer for, and drawing the zero the arithmetic left
        // there would paint clear sky as light rain right across the disc.
        for (gate, slot) in measured.iter_mut().enumerate() {
            *slot = ray[gate].is_some();
        }
        slopes(&ray, interval_km, window, &mut slope);
        unfold(&mut ray, &slope);
        slopes(&ray, interval_km, window, &mut slope);
        for value in slope.iter_mut() {
            let found = value.unwrap_or(0.0);
            *value = Some(if found <= MIN_SLOPE || found >= MAX_SLOPE {
                0.0
            } else {
                found
            });
        }
        // Phase and slope reconciled against each other: the phase a slope
        // implies, then the slope that phase implies. A field already
        // consistent with itself is unchanged by this, which is the point.
        for _ in 0..ITERATIONS {
            integrate(&slope, interval_km, &mut rebuilt);
            slopes(&rebuilt, interval_km, window, &mut slope);
        }
        for (gate, found) in slope.iter().enumerate() {
            if !measured[gate] {
                continue;
            }
            if let Some(value) = found {
                out.set(at, gate, *value, GateStatus::Valid);
            }
        }
    }
    Some(out)
}

/// One ray's phase, with everything the correlation coefficient disowns taken
/// out of it.
fn read_ray(
    phase: &SweepField,
    correlation: &SweepField,
    at: usize,
    azimuth: f32,
    into: &mut [Option<f32>],
) {
    let first_km = phase.first_gate_range_km();
    let interval_km = phase.gate_interval_km();
    for (gate, slot) in into.iter_mut().enumerate() {
        *slot = None;
        let (value, status) = phase.get(at, gate);
        if !matches!(status, GateStatus::Valid) {
            continue;
        }
        let range_km = first_km + gate as f64 * interval_km;
        let Some((rho, GateStatus::Valid)) = reading_at(correlation, azimuth, range_km) else {
            continue;
        };
        if rho < CENSOR_CORRELATION {
            continue;
        }
        *slot = Some(value);
    }
}

/// Drops runs of readings too short to take a slope through.
fn despeckle(ray: &mut [Option<f32>]) {
    let mut start = 0;
    while start < ray.len() {
        if ray[start].is_none() {
            start += 1;
            continue;
        }
        let mut end = start;
        while end < ray.len() && ray[end].is_some() {
            end += 1;
        }
        if end - start < DESPECKLE_GATES {
            for slot in &mut ray[start..end] {
                *slot = None;
            }
        }
        start = end;
    }
}

/// The slope of the phase at each gate, in degrees a kilometre.
///
/// Least squares over the window rather than a difference between its ends: a
/// difference reads the noise on two gates and nothing in between, and the
/// phase at one gate is noisy enough that its own difference is not worth
/// reading. Halved, because the phase is accumulated on the way out and again
/// on the way back and only one of those is the rain being measured.
fn slopes(ray: &[Option<f32>], interval_km: f64, window: usize, into: &mut [Option<f32>]) {
    let half = (window / 2) as i64;
    let enough = window / 2 + 1;
    for (gate, slot) in into.iter_mut().enumerate() {
        *slot = None;
        let (mut n, mut sx, mut sy, mut sxx, mut sxy) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
        for step in -half..=half {
            let other = gate as i64 + step;
            if other < 0 || other as usize >= ray.len() {
                continue;
            }
            let Some(value) = ray[other as usize] else {
                continue;
            };
            let x = step as f64 * interval_km;
            let y = value as f64;
            n += 1.0;
            sx += x;
            sy += y;
            sxx += x * x;
            sxy += x * y;
        }
        if (n as usize) < enough {
            continue;
        }
        let denominator = n * sxx - sx * sx;
        if denominator.abs() <= f64::EPSILON {
            continue;
        }
        let per_km = (n * sxy - sx * sy) / denominator;
        if per_km.is_finite() {
            *slot = Some((per_km / 2.0) as f32);
        }
    }
}

/// Puts a wrapped phase back where it belongs.
///
/// The total only ever climbs, so a slope far below zero is the field coming
/// back round rather than the rain reversing. Everything past the first such
/// gate is a turn behind, and anything the correction carries more than half a
/// turn above where the ray had got to was not folded and is put back.
fn unfold(ray: &mut [Option<f32>], slope: &[Option<f32>]) {
    let Some(folded) = slope
        .iter()
        .position(|found| found.is_some_and(|value| value < FOLD_SLOPE))
    else {
        return;
    };
    let highest = ray
        .iter()
        .flatten()
        .copied()
        .fold(f32::NEG_INFINITY, f32::max);
    if !highest.is_finite() {
        return;
    }
    for value in ray.iter_mut().skip(folded + 1).flatten() {
        *value += 360.0;
    }
    // The window either side of the fold is where the first guess is least
    // certain, so an over-correction is looked for there and nowhere else.
    let ceiling = highest + 180.0;
    for value in ray
        .iter_mut()
        .skip(folded + 1)
        .take(DESPECKLE_GATES * 2)
        .flatten()
    {
        if *value > ceiling {
            *value -= 360.0;
        }
    }
}

/// The phase a slope implies, accumulated along the ray from nothing.
///
/// Doubled on the way back in, because the slope was halved on the way out.
/// The absolute level is not recovered and does not need to be: the radar's
/// own phase offset is in every reading and the derivative is what is drawn.
fn integrate(slope: &[Option<f32>], interval_km: f64, into: &mut [Option<f32>]) {
    let mut running = 0.0f64;
    let mut previous = 0.0f64;
    for (gate, slot) in into.iter_mut().enumerate() {
        let value = slope[gate].unwrap_or(0.0) as f64;
        if gate > 0 {
            running += (previous + value) / 2.0 * interval_km;
        }
        previous = value;
        *slot = Some((2.0 * running) as f32);
    }
}

#[cfg(test)]
#[path = "kdp_tests.rs"]
mod tests;

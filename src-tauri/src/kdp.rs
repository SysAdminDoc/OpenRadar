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
//! et al. 2012 with one step replaced: censor, despeckle, unwrap each reading
//! against the one before it, take the slope over a window, and then iterate
//! between phase and slope twice so the two agree.
//!
//! The paper finds a wrap where a first-guess slope drops past a threshold,
//! adds a turn to everything after it and puts back what the correction
//! overshot within one window. That takes out one wrap, and on a ray whose
//! phase settles near the top of its turn, where noise carries it back and
//! forth across the boundary, it leaves everything past that window a turn
//! out in alternate gates. Held against eight stored heavy-rain days reported
//! again from three other starting offsets, which must not change a single
//! reading, the paper's step lost 434,311 gates and moved the rest by 0.18
//! degrees a kilometre on average. Unwrapping cannot be moved by an offset at
//! all, which is why it loses none there and why that measure says nothing
//! about its own ways of going wrong: against the office's own product on the
//! same days it agrees better overall, near gaps, and on the rays that wrap
//! twice.

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
///
/// The ceiling is the S-band figure. The same rain gives about half the
/// specific differential phase at S band that it gives at C, and the paper's
/// 20 is its C-band value; Py-ART's `kdp_vulpiani` uses 14 for S, 20 for C
/// and 40 for X. On eight stored heavy-rain days 29 gates of 3.7 million
/// changed, drawn at 14 to 20 where the office's own product tops out at 10.6,
/// and agreement with that product improved overall and near gaps.
const MIN_SLOPE: f32 = -2.0;
const MAX_SLOPE: f32 = 14.0;

/// How many times phase and slope are reconciled against each other.
const ITERATIONS: usize = 2;

/// The largest phase a reading may claim, in degrees either way.
///
/// The radar reports inside one turn, so two turns is room for any offset a
/// decoder could honestly add. A local file names its own scale and offset,
/// and one that makes a reading infinite, or so large that taking a turn off
/// it changes nothing, once had `unwrap` looping for ever on a worker thread.
const REPORTED_PHASE_LIMIT: f32 = 720.0;

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
         despeckled, the phase unwrapped by bringing each reading within half a \
         turn of the one before it, the slope taken by least squares over \
         {WINDOW_KM:.0} km ({} gates here) and halved for the two-way path, slopes \
         outside {MIN_SLOPE} to {MAX_SLOPE} degrees a kilometre discarded, and \
         phase and slope reconciled over {ITERATIONS} iterations only through the \
         gates the radar measured",
        window_gates(field.gate_interval_km())
    )
}

/// How many gates the window covers here, always odd and never below three.
pub(crate) fn window_gates(interval_km: f64) -> usize {
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
    let mut refused: Vec<bool> = vec![false; gates];
    for (at, azimuth) in angles.iter().enumerate() {
        read_ray(phase, correlation, at, *azimuth, &mut ray);
        despeckle(&mut ray);
        refused.fill(false);
        // Which gates the radar actually measured, kept before the ray is
        // filled in. The reconciliation below integrates over the whole ray
        // because an integral cannot skip a stretch and carry on, but a gate
        // the radar saw nothing at is not a gate where it is not raining: it
        // is one there is no answer for, so it is neither fitted through nor
        // drawn, and drawing the zero the arithmetic left there would paint
        // clear sky as light rain right across the disc.
        for (gate, slot) in measured.iter_mut().enumerate() {
            *slot = ray[gate].is_some();
        }
        unwrap(&mut ray);
        slopes(&ray, interval_km, window, &mut slope);
        // Two ways a gate ends up with no answer, and both of them used to
        // become a zero the reconciliation carried through to the picture.
        //
        // A slope outside the band is not a slope. A gate the fit could not
        // be made at is not a slope either: `slopes` refuses a window with
        // fewer than half of it measured, so a stretch of rain shorter than
        // half the window has a value at every gate and a slope at none. At
        // quarter kilometre gates that is anything under three and a half
        // kilometres, which is an ordinary shower.
        //
        // Both are set to zero so the integral below can carry across them,
        // and both are refused so neither is drawn. Zero on this field is a
        // claim about the rain rather than an absence, and the gates that
        // land outside the band are the heaviest rain on the ray: drawn as
        // zero, the one field a forecaster reads for rain rate paints a
        // downpour as a dry hole and a shower as clear sky.
        for (gate, value) in slope.iter_mut().enumerate() {
            let believable = value.is_some_and(|found| found > MIN_SLOPE && found < MAX_SLOPE);
            if !believable {
                refused[gate] = true;
                *value = Some(0.0);
            }
        }
        // Phase and slope reconciled against each other: the phase a slope
        // implies, then the slope that phase implies. A field already
        // consistent with itself is unchanged by this, which is the point.
        //
        // The slope is fitted back out only through gates the radar measured.
        // The integral carries on across a censored stretch at a slope of
        // nothing, which is what keeps the two sides of it level with each
        // other, but the flat run of phase it leaves there is not a reading.
        // Fitted through, it pulled every gate within half a window of the
        // stretch toward no rain: along a clutter block, across a blocked
        // sector, at the edge of every echo. A planted ramp read 1.04 degrees a
        // kilometre instead of 2 at the gate beside a block.
        for _ in 0..ITERATIONS {
            integrate(&slope, interval_km, &mut rebuilt);
            for (value, seen) in rebuilt.iter_mut().zip(&measured) {
                if !seen {
                    *value = None;
                }
            }
            slopes(&rebuilt, interval_km, window, &mut slope);
        }
        for (gate, found) in slope.iter().enumerate() {
            if !measured[gate] || refused[gate] {
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
        // The radar reports the phase inside one turn. A reading that is not
        // a number, or is turns away from one, came out of a file's own scale
        // and offset rather than out of the air, and it is not taken.
        if !value.is_finite() || value.abs() > REPORTED_PHASE_LIMIT {
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
/// The radar reports the phase inside one turn, so a reading more than half a
/// turn below the one before it is the phase coming back round, and one more
/// than half a turn above it is noise carrying it back across the same
/// boundary. Each reading is brought within half a turn of the measured one
/// before it, which takes out any number of wraps, keeps a phase that
/// settles at the top of its turn level rather than a turn out in alternate
/// gates, and moves no gate before the wrap itself.
///
/// Across a censored stretch the reading after it is brought within half a
/// turn of the one before it too, which is wrong by a turn if more than half a
/// turn of phase built up in the stretch. It costs nothing: the slope is only
/// ever fitted across a stretch short enough that no rain could do that.
fn unwrap(ray: &mut [Option<f32>]) {
    let mut previous: Option<f32> = None;
    let mut turns = 0.0f32;
    for value in ray.iter_mut().flatten() {
        let mut now = *value + turns;
        if let Some(before) = previous {
            // The whole turns that bring it within half a turn, in one step
            // rather than a turn at a time: a loop that takes a turn off until
            // the gap closes never finishes on a reading so large that a turn
            // is lost in its rounding.
            let shift = ((before - now) / 360.0).round() * 360.0;
            turns += shift;
            now += shift;
        }
        *value = now;
        previous = Some(now);
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

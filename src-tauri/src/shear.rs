//! Rotation from the site's own velocity, by linear least squares derivatives.
//!
//! MRMS publishes an azimuthal shear grid every two minutes across the whole
//! country. This is the same quantity computed from one radar's own dealiased
//! velocity, at the resolution the radar recorded it, as soon as the cut lands.
//! That is what the pay-to-use desktop analysts draw as NROT, and what a
//! tornado debris signature has to be found against: the polarimetric criteria
//! on their own mark a gravel pit as readily as a tornado, and it is the
//! collocated couplet that separates them.
//!
//! The fit is Mahalik et al. 2019, which is Smith and Elmore's LLSD with the
//! off-diagonal terms of the normal equations kept rather than assumed away.
//! Dropping them is only correct when the kernel is complete and symmetric
//! about its centre, and a kernel over real data never is: it is clipped at
//! the first and last gate, and punched through wherever the mask removed a
//! gate. The simplified form reads the resulting asymmetry as signal, which is
//! what draws the false ring of shear at five to ten kilometres that the 2019
//! paper set out to remove.

use nexrad_model::data::{GateStatus, SweepField};

use crate::gates::reading_at;

/// The kernel the published method fits over, in metres.
///
/// Azimuthal first, radial second, as the paper states them, and both are the
/// whole width rather than the half. Azimuthal shear wants a kernel wide
/// across the beam and short along it, because that is the shape of the
/// derivative it is measuring; divergent shear wants the opposite.
pub const AZIMUTHAL_KERNEL_M: (f64, f64) = (2500.0, 750.0);

/// The most radials a kernel may span, whatever the range says.
///
/// At half a degree and close in, 2,500 metres of arc is hundreds of radials,
/// and a fit that wide is no longer describing one storm. The paper caps it
/// here.
pub const MAX_RADIALS: usize = 51;

/// The smallest kernel the paper allows, as a half-width either side.
///
/// Three by three. Below that the fit has as many unknowns as samples and
/// answers with whatever noise it was given.
const MIN_HALF: usize = 1;

/// How many of a gate's eight neighbours must be readings for it to survive
/// the median prefilter.
const MEDIAN_MIN_NEIGHBOURS: usize = 5;

/// Below this the return is not weather and its velocity is not wind.
pub const MASK_DBZ: f32 = 20.0;

/// The four criteria for debris, and how far from a couplet they must sit.
///
/// A tornado lofts whatever it is crossing, and what comes up is neither
/// spherical nor uniformly oriented, so it depolarises: correlation collapses
/// and differential reflectivity falls toward zero while reflectivity stays
/// high. Those three are also true of a wind farm and of chaff. The couplet is
/// what makes the signature.
pub const DEBRIS_DBZ: f32 = 30.0;
pub const DEBRIS_CORRELATION: f32 = 0.85;
pub const DEBRIS_DIFFERENTIAL_DB: f32 = 0.5;
pub const DEBRIS_SHEAR: f32 = 0.006;
pub const DEBRIS_REACH_KM: f64 = 2.0;

/// The window the couplet is looked for over, radials by gates, and the
/// percentile taken across it.
///
/// Snyder and Ryzhkov dilate the couplet rather than testing the gate itself,
/// because debris is advected: by the time it is lofted and scanned it sits
/// beside the circulation rather than in it. The percentile rather than the
/// maximum, so one noisy gate cannot invent a couplet.
const COUPLET_WINDOW: (usize, usize) = (4, 8);
const COUPLET_PERCENTILE: f64 = 0.95;

/// The beam's half-power width, which is what sets the smallest circulation a
/// site can resolve at a given range.
const BEAM_WIDTH_DEGREES: f64 = 1.0;

/// The velocity difference across a circulation that reads as one on the
/// normalised scale.
///
/// Range normalisation exists because the same tornado measures weaker the
/// further out it is: the beam widens with range, the circulation stops
/// filling it, and the shear is averaged with the still air around it. So the
/// raw number is normalised by what a just-resolved circulation of this
/// strength would measure at the same range, and the result is comparable
/// across the disc. One is significant and two and a half is extreme, which is
/// the scale the operational decks are read against.
const ROTATION_REFERENCE_MS: f64 = 20.0;

/// What is being derived, which decides the scale the answer is on.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// The derivative itself, in reciprocal seconds.
    AzimuthalShear,
    /// The same, divided by what this range can resolve.
    Rotation,
}

/// The other moments of the same cut, where the volume carries them.
///
/// Reflectivity masks the fit, because velocity where there is no echo is
/// noise and fitting a plane through noise produces shear. The two dual-pol
/// moments are only needed for the debris flag, and a volume without them
/// still draws shear.
#[derive(Default, Clone, Copy)]
pub struct Beside<'a> {
    pub reflectivity: Option<&'a SweepField>,
    pub correlation: Option<&'a SweepField>,
    pub differential: Option<&'a SweepField>,
}

/// A derived field and, where the moments for it were there, the gates that
/// meet the debris criteria beside a couplet.
pub struct Derived {
    pub field: SweepField,
    pub debris: Option<SweepField>,
}

/// What a reading is multiplied by before it is drawn or exported.
///
/// The fit works in reciprocal seconds, which is what the derivative is. The
/// national grids publish the same quantity in thousandths of one, and a
/// reader looking at both is comparing this site's cut against the mosaic, so
/// the number they see is on the mosaic's scale rather than a thousand times
/// smaller than it.
const SHEAR_PER_UNIT: f32 = 1000.0;

/// The label and unit each kind is drawn under.
pub fn named(kind: Kind) -> (&'static str, &'static str) {
    match kind {
        Kind::AzimuthalShear => ("Azimuthal shear", "0.001/s"),
        Kind::Rotation => ("Rotation", "NROT"),
    }
}

/// One line saying how the numbers were arrived at, for the export header.
pub fn derivation(kind: Kind) -> String {
    let kernel = format!(
        "azimuthal shear by linear least squares derivative (Mahalik et al. 2019) over a \
         {:.0} m azimuthal by {:.0} m radial kernel, at most {MAX_RADIALS} radials, \
         3x3 median prefiltered, masked to reflectivity at or above {MASK_DBZ:.0} dBZ,          reported in thousandths of a reciprocal second as the national grids are",
        AZIMUTHAL_KERNEL_M.0, AZIMUTHAL_KERNEL_M.1
    );
    match kind {
        Kind::AzimuthalShear => kernel,
        Kind::Rotation => format!(
            "{kernel}; normalised by the {ROTATION_REFERENCE_MS:.0} m/s difference a \
             circulation two {BEAM_WIDTH_DEGREES:.1} degree beamwidths across would \
             measure at the same range"
        ),
    }
}

/// Derives one cut. The velocity must already be unfolded: a fold is a jump of
/// twice the Nyquist velocity between neighbouring gates, which is the largest
/// shear anywhere in the sweep and is not rotation.
pub fn derive(velocity: &SweepField, beside: Beside<'_>, kind: Kind) -> Option<Derived> {
    let azimuths = velocity.azimuth_count();
    let gates = velocity.gate_count();
    if azimuths < 3 || gates < 3 {
        return None;
    }

    let smoothed = median_prefilter(velocity, beside.reflectivity);
    let shear = least_squares_shear(velocity, &smoothed);

    let (label, unit) = named(kind);
    let mut field = velocity.new_like(label, unit);
    let ranges: Vec<f64> = (0..gates).map(|gate| range_m(velocity, gate)).collect();
    for azimuth in 0..azimuths {
        for gate in 0..gates {
            let Some(value) = shear[azimuth * gates + gate] else {
                continue;
            };
            let drawn = match kind {
                Kind::AzimuthalShear => value * SHEAR_PER_UNIT,
                Kind::Rotation => normalise(value, ranges[gate]),
            };
            field.set(azimuth, gate, drawn, GateStatus::Valid);
        }
    }

    let debris = debris_flag(velocity, &shear, beside);
    Some(Derived { field, debris })
}

/// The shear a circulation of the reference strength would measure here.
///
/// Two beamwidths is the smallest circulation a radar resolves at all, so a
/// reference circulation is that wide and the reference shear is the velocity
/// difference across it. Both grow linearly with range, so the normalised
/// answer is flat across the disc for the same storm, which is the whole point.
fn normalise(shear: f32, range_m: f64) -> f32 {
    let across = 2.0 * range_m * BEAM_WIDTH_DEGREES.to_radians();
    if across <= 0.0 {
        return 0.0;
    }
    (shear as f64 * across / ROTATION_REFERENCE_MS) as f32
}

fn range_m(field: &SweepField, gate: usize) -> f64 {
    (field.first_gate_range_km() + gate as f64 * field.gate_interval_km()) * 1000.0
}

/// The 3x3 median the paper puts in front of the fit.
///
/// Velocity at a single gate is noisy enough that its own derivative is not
/// worth reading, and a median rather than a mean because the thing being
/// removed is speckle rather than a bias. A gate whose neighbourhood is mostly
/// empty is dropped rather than filled in: it sits on the edge of the echo,
/// where a fit has nothing on one side of it and answers with the edge.
///
/// Returns the filtered value per gate, `None` where there is nothing to fit.
fn median_prefilter(velocity: &SweepField, reflectivity: Option<&SweepField>) -> Vec<Option<f32>> {
    let azimuths = velocity.azimuth_count();
    let gates = velocity.gate_count();
    let mut out = vec![None; azimuths * gates];
    let mut window: Vec<f32> = Vec::with_capacity(9);
    for azimuth in 0..azimuths {
        for gate in 0..gates {
            let (value, status) = velocity.get(azimuth, gate);
            if !matches!(status, GateStatus::Valid) {
                continue;
            }
            if !echoing(velocity, reflectivity, azimuth, gate) {
                continue;
            }
            window.clear();
            window.push(value);
            let mut neighbours = 0usize;
            for step in -1i64..=1 {
                for along in -1i64..=1 {
                    if step == 0 && along == 0 {
                        continue;
                    }
                    let Some(other) = at(velocity, azimuth, gate, step, along) else {
                        continue;
                    };
                    neighbours += 1;
                    window.push(other);
                }
            }
            if neighbours < MEDIAN_MIN_NEIGHBOURS {
                continue;
            }
            window.sort_by(|left, right| left.total_cmp(right));
            out[azimuth * gates + gate] = Some(window[window.len() / 2]);
        }
    }
    out
}

/// Whether there is weather at a gate, from the cut's own reflectivity.
///
/// The two fields are separate sweeps at the same tilt with their own gate
/// spacing, so this asks by where the gate is rather than by its index, and
/// through `gates` rather than the model's own reader: that one treats the
/// first gate's range as an edge where the ICD calls it a centre, and a mask
/// half a gate out from the velocity it is masking is a mask that keeps the
/// wrong gates at the edge of every echo. A volume with no reflectivity for
/// the cut is taken at its word rather than masked to nothing.
fn echoing(
    velocity: &SweepField,
    reflectivity: Option<&SweepField>,
    azimuth: usize,
    gate: usize,
) -> bool {
    let Some(reflectivity) = reflectivity else {
        return true;
    };
    let Some(angle) = velocity.azimuths().get(azimuth).copied() else {
        return false;
    };
    let range_km = range_m(velocity, gate) / 1000.0;
    match reading_at(reflectivity, angle, range_km) {
        Some((dbz, GateStatus::Valid)) => dbz >= MASK_DBZ,
        _ => false,
    }
}

/// A neighbour's reading, or nothing where there is not one.
fn at(field: &SweepField, azimuth: usize, gate: usize, step: i64, along: i64) -> Option<f32> {
    let azimuths = field.azimuth_count();
    let gates = field.gate_count();
    let gate = gate as i64 + along;
    if gate < 0 || gate as usize >= gates {
        return None;
    }
    // Radials wrap: the neighbour of the first is the last.
    let azimuth = (azimuth as i64 + step).rem_euclid(azimuths as i64) as usize;
    let (value, status) = field.get(azimuth, gate as usize);
    matches!(status, GateStatus::Valid).then_some(value)
}

/// The fit itself, one solve per gate.
///
/// The kernel is measured in metres and converted to counts at each range,
/// because the arc a radial covers grows with range while the gate length does
/// not: the same kernel is dozens of radials wide at two hundred kilometres
/// and three of them at ten.
fn least_squares_shear(velocity: &SweepField, smoothed: &[Option<f32>]) -> Vec<Option<f32>> {
    let azimuths = velocity.azimuth_count();
    let gates = velocity.gate_count();
    let spacing = velocity.azimuth_spacing_degrees() as f64;
    let interval_m = velocity.gate_interval_km() * 1000.0;
    let mut out = vec![None; azimuths * gates];
    if spacing <= 0.0 || interval_m <= 0.0 {
        return out;
    }

    let along_half = half_width(AZIMUTHAL_KERNEL_M.1, interval_m, gates);
    for gate in 0..gates {
        let range = range_m(velocity, gate);
        let arc = range * spacing.to_radians();
        if arc <= 0.0 {
            continue;
        }
        let across_half = half_width(AZIMUTHAL_KERNEL_M.0, arc, MAX_RADIALS.min(azimuths));
        for azimuth in 0..azimuths {
            if smoothed[azimuth * gates + gate].is_none() {
                continue;
            }
            out[azimuth * gates + gate] = solve(
                velocity,
                smoothed,
                (azimuth, gate),
                (across_half, along_half),
                interval_m,
            );
        }
    }
    out
}

/// How many samples either side of centre a kernel of a given width covers.
///
/// Never below the three-by-three floor, and never wider than what there is.
fn half_width(width_m: f64, step_m: f64, available: usize) -> usize {
    let ceiling = (available.saturating_sub(1) / 2).max(MIN_HALF);
    let half = (width_m / step_m / 2.0).round() as i64;
    (half.max(MIN_HALF as i64) as usize).min(ceiling)
}

/// One gate's normal equations, with the cross terms kept.
///
/// The plane fitted is `v = a + b x + c y`, where `x` is metres across the
/// beam and `y` is metres along it, both measured from the gate at the centre.
/// `b` is the azimuthal derivative, which is the shear. Solved by determinants
/// rather than by an elimination, because the system is three by three and its
/// determinant is the thing that has to be checked anyway: it goes to zero
/// exactly when the surviving samples are collinear, which is what a kernel
/// clipped down to one radial or one gate leaves.
fn solve(
    velocity: &SweepField,
    smoothed: &[Option<f32>],
    (azimuth, gate): (usize, usize),
    (across_half, along_half): (usize, usize),
    interval_m: f64,
) -> Option<f32> {
    let azimuths = velocity.azimuth_count();
    let gates = velocity.gate_count();
    let angles = velocity.azimuths();
    let centre_angle = *angles.get(azimuth)? as f64;

    let (mut n, mut sx, mut sy) = (0.0f64, 0.0f64, 0.0f64);
    let (mut sxx, mut sxy, mut syy) = (0.0f64, 0.0f64, 0.0f64);
    let (mut sv, mut sxv, mut syv) = (0.0f64, 0.0f64, 0.0f64);

    for step in -(across_half as i64)..=(across_half as i64) {
        let neighbour = (azimuth as i64 + step).rem_euclid(azimuths as i64) as usize;
        let Some(angle) = angles.get(neighbour).copied() else {
            continue;
        };
        // The recorded angles, not the nominal spacing: an antenna turns at
        // whatever rate the pattern asks and the radials come back where they
        // were measured. Wrapped, so a kernel straddling due north is not one
        // sample beside three hundred and fifty nine degrees of arc.
        let swept = wrapped(angle as f64 - centre_angle).to_radians();
        for along in -(along_half as i64)..=(along_half as i64) {
            let other = gate as i64 + along;
            if other < 0 || other as usize >= gates {
                continue;
            }
            let other = other as usize;
            let Some(value) = smoothed[neighbour * gates + other] else {
                continue;
            };
            // Each sample's own range, so the arc is where the sample is.
            let x = range_m(velocity, other) * swept;
            let y = along as f64 * interval_m;
            let value = value as f64;
            n += 1.0;
            sx += x;
            sy += y;
            sxx += x * x;
            sxy += x * y;
            syy += y * y;
            sv += value;
            sxv += x * value;
            syv += y * value;
        }
    }

    // Three unknowns, so three samples can be fitted exactly and say nothing.
    if n < 6.0 {
        return None;
    }

    let determinant =
        n * (sxx * syy - sxy * sxy) - sx * (sx * syy - sxy * sy) + sy * (sx * sxy - sxx * sy);
    // Scaled against the magnitudes it was built from rather than against an
    // absolute floor: the entries are metres squared over a kernel of
    // thousands of metres, so an absolute epsilon would accept a system that
    // is singular for this data and reject one that is not for finer gates.
    let scale = n * sxx * syy;
    if scale <= 0.0 || determinant.abs() <= scale * 1e-9 {
        return None;
    }

    // Cramer for the middle unknown only. The intercept and the radial
    // derivative are not drawn, and solving for them costs two more
    // determinants.
    let shear =
        n * (sxv * syy - sxy * syv) - sv * (sx * syy - sxy * sy) + sy * (sx * syv - sxv * sy);
    let shear = shear / determinant;
    shear.is_finite().then_some(shear as f32)
}

/// An angle difference brought back into the half turn either side of zero.
fn wrapped(degrees: f64) -> f64 {
    let mut degrees = degrees % 360.0;
    if degrees > 180.0 {
        degrees -= 360.0;
    }
    if degrees < -180.0 {
        degrees += 360.0;
    }
    degrees
}

/// The gates that meet all four debris criteria.
///
/// Nothing is returned unless the volume carried both dual-pol moments for the
/// cut: three criteria out of four is not a signature, and drawing it as one
/// would put the app's name on a wind farm.
fn debris_flag(
    velocity: &SweepField,
    shear: &[Option<f32>],
    beside: Beside<'_>,
) -> Option<SweepField> {
    let reflectivity = beside.reflectivity?;
    let correlation = beside.correlation?;
    let differential = beside.differential?;
    let azimuths = velocity.azimuth_count();
    let gates = velocity.gate_count();

    let couplets = couplet_seeds(velocity, shear);
    if couplets.is_empty() {
        return None;
    }
    let near = within_reach(velocity, &couplets);

    let mut flagged = velocity.new_like("Tornado debris signature", "");
    let mut any = false;
    for azimuth in 0..azimuths {
        let Some(angle) = velocity.azimuths().get(azimuth).copied() else {
            continue;
        };
        for gate in 0..gates {
            // Cheapest first: an array read, then three binary searches.
            if !near[azimuth * gates + gate] {
                continue;
            }
            let range_km = range_m(velocity, gate) / 1000.0;
            let Some((dbz, GateStatus::Valid)) = reading_at(reflectivity, angle, range_km) else {
                continue;
            };
            if dbz <= DEBRIS_DBZ {
                continue;
            }
            let Some((rho, GateStatus::Valid)) = reading_at(correlation, angle, range_km) else {
                continue;
            };
            if rho >= DEBRIS_CORRELATION {
                continue;
            }
            let Some((zdr, GateStatus::Valid)) = reading_at(differential, angle, range_km) else {
                continue;
            };
            if zdr.abs() > DEBRIS_DIFFERENTIAL_DB {
                continue;
            }
            flagged.set(azimuth, gate, 1.0, GateStatus::Valid);
            any = true;
        }
    }
    any.then_some(flagged)
}

/// Where the circulation is, as gate indices.
///
/// The 95th percentile of the shear over a window rather than the shear at the
/// gate, so a single noisy derivative is not a couplet and a real one is found
/// from anywhere in its own neighbourhood.
fn couplet_seeds(velocity: &SweepField, shear: &[Option<f32>]) -> Vec<(usize, usize)> {
    let azimuths = velocity.azimuth_count();
    let gates = velocity.gate_count();
    let (across, along) = COUPLET_WINDOW;
    let mut seeds = Vec::new();
    // Nothing anywhere is turning hard enough, so nothing can be: a
    // percentile over a window cannot exceed the largest reading in it. Worth
    // one pass over the sweep because most sweeps are this, and the pass it
    // skips sorts a window of forty-five at every gate of the cut.
    if !shear
        .iter()
        .any(|found| found.is_some_and(|value| value.abs() >= DEBRIS_SHEAR))
    {
        return seeds;
    }
    let mut window: Vec<f32> = Vec::with_capacity(across * along);
    for azimuth in 0..azimuths {
        for gate in 0..gates {
            if shear[azimuth * gates + gate].is_none() {
                continue;
            }
            window.clear();
            for step in -(across as i64 / 2)..=(across as i64 / 2) {
                let neighbour = (azimuth as i64 + step).rem_euclid(azimuths as i64) as usize;
                for reach in -(along as i64 / 2)..=(along as i64 / 2) {
                    let other = gate as i64 + reach;
                    if other < 0 || other as usize >= gates {
                        continue;
                    }
                    if let Some(value) = shear[neighbour * gates + other as usize] {
                        window.push(value.abs());
                    }
                }
            }
            if window.is_empty() {
                continue;
            }
            let at = ((window.len() - 1) as f64 * COUPLET_PERCENTILE).round() as usize;
            let (_, value, _) =
                window.select_nth_unstable_by(at, |left, right| left.total_cmp(right));
            if *value >= DEBRIS_SHEAR {
                seeds.push((azimuth, gate));
            }
        }
    }
    seeds
}

/// Every gate within reach of a circulation, marked in one pass.
///
/// Asked the other way round from how it reads. Testing each candidate against
/// every circulation is the obvious shape and it is quadratic: a mesocyclone
/// covers thousands of gates and so does the debris under it, and the product
/// of the two is hundreds of millions of distance calculations for one cut.
/// Growing each circulation out to its own reach instead is bounded by the
/// reach, and a gate already marked is not marked twice.
fn within_reach(velocity: &SweepField, couplets: &[(usize, usize)]) -> Vec<bool> {
    let azimuths = velocity.azimuth_count();
    let gates = velocity.gate_count();
    let interval_km = velocity.gate_interval_km();
    let spacing = velocity.azimuth_spacing_degrees() as f64;
    let angles = velocity.azimuths();
    let mut near = vec![false; azimuths * gates];
    if interval_km <= 0.0 || spacing <= 0.0 {
        return near;
    }
    let reach_m = DEBRIS_REACH_KM * 1000.0;
    let along_reach = (DEBRIS_REACH_KM / interval_km).ceil() as i64;

    for &(azimuth, gate) in couplets {
        let Some(centre_angle) = angles.get(azimuth).copied() else {
            continue;
        };
        let range = range_m(velocity, gate);
        // How far round the sweep the reach can carry at this range. Close in,
        // two kilometres is most of a turn, so it is capped at the half turn
        // past which the other side is nearer the other way.
        let arc = range * spacing.to_radians();
        let across_reach = if arc <= 0.0 {
            azimuths as i64 / 2
        } else {
            ((reach_m / arc).ceil() as i64).min(azimuths as i64 / 2)
        };
        for step in -across_reach..=across_reach {
            let neighbour = (azimuth as i64 + step).rem_euclid(azimuths as i64) as usize;
            let Some(angle) = angles.get(neighbour).copied() else {
                continue;
            };
            let between = wrapped(angle as f64 - centre_angle as f64).to_radians();
            let cos = between.cos();
            for along in -along_reach..=along_reach {
                let other = gate as i64 + along;
                if other < 0 || other as usize >= gates {
                    continue;
                }
                let at = neighbour * gates + other as usize;
                if near[at] {
                    continue;
                }
                let other_range = range_m(velocity, other as usize);
                // Both gates sit on the same cone, so the distance between
                // them is the law of cosines on the two slant ranges and the
                // angle swept between the radials.
                let squared =
                    range * range + other_range * other_range - 2.0 * range * other_range * cos;
                if squared <= reach_m * reach_m {
                    near[at] = true;
                }
            }
        }
    }
    near
}

#[cfg(test)]
#[path = "shear_tests.rs"]
mod tests;

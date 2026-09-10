use super::*;

const SPACING: f32 = 0.5;
const FIRST_KM: f64 = 2.125;
const INTERVAL_KM: f64 = 0.25;
const AZIMUTHS: usize = 720;
const GATES: usize = 400;

/// The gate index sitting closest to a range, so a test can say where it means
/// in kilometres rather than in array positions.
fn gate_at(range_km: f64) -> usize {
    ((range_km - FIRST_KM) / INTERVAL_KM).round() as usize
}

fn range_km_of(gate: usize) -> f64 {
    FIRST_KM + gate as f64 * INTERVAL_KM
}

fn empty(label: &str, unit: &str) -> SweepField {
    let angles: Vec<f32> = (0..AZIMUTHS).map(|at| at as f32 * SPACING).collect();
    SweepField::new_empty(
        label,
        unit,
        0.5,
        angles,
        SPACING,
        FIRST_KM,
        INTERVAL_KM,
        GATES,
    )
}

/// A field every gate of which holds the same reading, which is what the mask
/// and the dual-pol criteria want under a planted couplet.
fn flat(label: &str, unit: &str, value: f32) -> SweepField {
    let mut field = empty(label, unit);
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            field.set(azimuth, gate, value, GateStatus::Valid);
        }
    }
    field
}

/// A velocity field in solid rotation about the radar: every gate reads the
/// speed a constant azimuthal shear would put there.
///
/// The fit's own coordinate is metres across the beam, so this is an exact
/// plane in it and the derivative comes back to floating point precision. A
/// recovery that is merely close on this input is a bug in the solve.
fn constant_shear(rate: f32) -> SweepField {
    let mut field = empty("Velocity", "m/s");
    for azimuth in 0..AZIMUTHS {
        let swept = (azimuth as f64 * SPACING as f64).to_radians();
        for gate in 0..GATES {
            let across = range_km_of(gate) * 1000.0 * swept;
            field.set(
                azimuth,
                gate,
                (rate as f64 * across) as f32,
                GateStatus::Valid,
            );
        }
    }
    field
}

/// The shear at a gate, back in reciprocal seconds, which is what every
/// planted number in this file is in.
fn shear_at(field: &SweepField, beside: Beside<'_>, azimuth: usize, gate: usize) -> f32 {
    let derived = derive(field, beside, Kind::AzimuthalShear).expect("a derived cut");
    let (value, status) = derived.field.get(azimuth, gate);
    assert_eq!(status, GateStatus::Valid, "no reading at {azimuth}/{gate}");
    value / 1000.0
}

/// Solid rotation is the one input whose answer is known in closed form.
#[test]
fn a_constant_shear_comes_back_as_itself() {
    let rate = 0.01f32;
    let field = constant_shear(rate);
    let gate = gate_at(50.0);
    // Away from due north, where the planted field wraps from 359.5 back to
    // zero: the wrap is not shear and the sweep is deliberately not continuous
    // across it. Rotation that is continuous everywhere is tested below.
    for azimuth in [180usize, 360, 540] {
        let found = shear_at(&field, Beside::default(), azimuth, gate);
        assert!(
            (found - rate).abs() < 1e-4,
            "azimuth {azimuth}: {found} is not {rate}"
        );
    }
}

/// The same rotation read at four ranges. Shear is a rate, so the answer does
/// not depend on how far out it is measured.
#[test]
fn the_same_rotation_reads_the_same_at_every_range() {
    let field = constant_shear(0.008);
    let derived = derive(&field, Beside::default(), Kind::AzimuthalShear).expect("a derived cut");
    for range in [20.0, 50.0, 90.0, 95.0] {
        let (found, status) = derived.field.get(360, gate_at(range));
        assert_eq!(status, GateStatus::Valid, "nothing at {range} km");
        assert!(
            (found / 1000.0 - 0.008).abs() < 1e-4,
            "at {range} km the rate read {found}"
        );
    }
}

/// A couplet with a stated velocity difference across a stated core.
///
/// The expected magnitude is the difference over the width, which is the
/// definition of the derivative being fitted, and both numbers are the ones
/// planted rather than ones read back out of the answer.
fn couplet(delta_v: f32, half_radials: usize, centre: usize) -> SweepField {
    let mut field = empty("Velocity", "m/s");
    for azimuth in 0..AZIMUTHS {
        let from_centre = azimuth as i64 - centre as i64;
        let across = (from_centre.clamp(-(half_radials as i64), half_radials as i64)) as f32
            / half_radials as f32;
        for gate in 0..GATES {
            field.set(azimuth, gate, across * delta_v / 2.0, GateStatus::Valid);
        }
    }
    field
}

#[test]
fn a_planted_couplet_reads_its_own_difference_over_its_width() {
    let centre = 360usize;
    let half_radials = 3usize;
    let delta_v = 40.0f32;
    let gate = gate_at(50.0);
    let field = couplet(delta_v, half_radials, centre);

    // The core is six radials of half a degree wide at fifty kilometres.
    let arc_m = range_km_of(gate) * 1000.0 * (SPACING as f64).to_radians();
    let width_m = 2.0 * half_radials as f64 * arc_m;
    let expected = delta_v as f64 / width_m;

    let found = shear_at(&field, Beside::default(), centre, gate);
    let error = (found as f64 - expected).abs() / expected;
    assert!(
        error < 0.02,
        "planted {expected} per second, read {found} ({:.1}% out)",
        error * 100.0
    );
}

/// The range curve itself.
///
/// The same measured shear is a stronger circulation the further out it is,
/// because the beam it was measured with is wider there, so the normalised
/// answer climbs linearly with range. Read off solid rotation, whose shear the
/// fit recovers exactly at every range, so what is being asserted is the curve
/// rather than the fit.
#[test]
fn rotation_climbs_with_range_the_way_the_beam_widens() {
    let rate = 0.008f64;
    let field = constant_shear(rate as f32);
    let derived = derive(&field, Beside::default(), Kind::Rotation).expect("a derived cut");
    for range_km in [20.0f64, 50.0, 90.0] {
        let gate = gate_at(range_km);
        let across = 2.0 * range_km_of(gate) * 1000.0 * 1.0f64.to_radians();
        let expected = rate * across / 20.0;
        let (found, status) = derived.field.get(360, gate);
        assert_eq!(status, GateStatus::Valid, "nothing at {range_km} km");
        assert!(
            (found as f64 - expected).abs() < 0.01,
            "at {range_km} km: {found} is not {expected}"
        );
    }
    // Twice the range is twice the circulation for the same reading, which is
    // the whole point of normalising.
    let near = derived.field.get(360, gate_at(45.0)).0;
    let far = derived.field.get(360, gate_at(90.0)).0;
    assert!((far / near - 2.0).abs() < 0.02, "{near} then {far}");
}

/// And the number the operational scale is read against: a circulation of the
/// reference strength, spread wide enough for the kernel to see all of it,
/// reads one.
#[test]
fn a_reference_circulation_reads_one() {
    let range_km = 50.0f64;
    let gate = gate_at(range_km);
    let across = 2.0 * range_km_of(gate) * 1000.0 * 1.0f64.to_radians();
    let field = constant_shear((20.0 / across) as f32);
    let derived = derive(&field, Beside::default(), Kind::Rotation).expect("a derived cut");
    let (found, status) = derived.field.get(360, gate);
    assert_eq!(status, GateStatus::Valid);
    assert!(
        (found - 1.0).abs() < 0.01,
        "20 m/s across {across:.0} m read {found}"
    );
}

/// The claim the 2019 kernel exists to make.
///
/// A flow that changes only along the beam has no azimuthal shear anywhere in
/// it. Punch the kernel through on one side, as the mask and the edge of the
/// echo both do, and the simplified normal equations read the surviving
/// samples' own lopsidedness as an azimuthal derivative. Keeping the
/// off-diagonal terms is what holds the answer at zero.
#[test]
fn a_lopsided_kernel_over_a_radial_gradient_still_reads_no_azimuthal_shear() {
    let mut field = empty("Velocity", "m/s");
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            let along = (range_km_of(gate) * 1000.0) as f32;
            field.set(azimuth, gate, along * 0.004, GateStatus::Valid);
        }
    }
    // Take out the near half of one side of the kernel, so what is left is
    // both fewer samples and off centre in both directions at once.
    let (centre, gate) = (360usize, gate_at(50.0));
    for azimuth in centre + 1..=centre + 3 {
        for gate in gate - 2..gate {
            field.set(azimuth, gate, 0.0, GateStatus::NoData);
        }
    }
    let found = shear_at(&field, Beside::default(), centre, gate);
    assert!(
        found.abs() < 1e-4,
        "a radial gradient read {found} of azimuthal shear"
    );
}

#[test]
fn gates_without_enough_echo_are_not_fitted() {
    let field = constant_shear(0.01);
    let quiet = flat("Reflectivity", "dBZ", MASK_DBZ - 1.0);
    let beside = Beside {
        reflectivity: Some(&quiet),
        ..Beside::default()
    };
    let derived = derive(&field, beside, Kind::AzimuthalShear).expect("a derived cut");
    assert!(
        derived
            .field
            .statuses()
            .iter()
            .all(|status| !matches!(status, GateStatus::Valid)),
        "a sweep below the mask was fitted anyway"
    );

    let storm = flat("Reflectivity", "dBZ", MASK_DBZ + 5.0);
    let beside = Beside {
        reflectivity: Some(&storm),
        ..Beside::default()
    };
    let found = shear_at(&field, beside, 360, gate_at(50.0));
    assert!((found - 0.01).abs() < 1e-4, "{found}");
}

/// The mask reads the reflectivity gate the ICD says it is reading.
///
/// A split cut puts reflectivity on kilometre gates and velocity on quarter
/// kilometre ones, and the model's own reader treats the range it is given as
/// a gate's near edge where the ICD calls it a centre. Half a kilometre out,
/// on the edge of an echo, is the difference between masking a gate and
/// keeping it, and every reading in this crate goes through `gates` so there
/// is one answer to where a gate is.
#[test]
fn the_mask_reads_the_gate_the_range_is_in() {
    let field = constant_shear(0.01);
    // Reflectivity on kilometre gates: storm out to the centre of gate 49,
    // nothing beyond it.
    let angles: Vec<f32> = (0..AZIMUTHS).map(|at| at as f32 * SPACING).collect();
    let mut reflectivity = SweepField::new_empty(
        "Reflectivity",
        "dBZ",
        0.5,
        angles,
        SPACING,
        FIRST_KM,
        1.0,
        110,
    );
    for azimuth in 0..AZIMUTHS {
        for gate in 0..110 {
            let dbz = if gate <= 49 { 25.0 } else { 10.0 };
            reflectivity.set(azimuth, gate, dbz, GateStatus::Valid);
        }
    }
    let beside = Beside {
        reflectivity: Some(&reflectivity),
        ..Beside::default()
    };
    let derived = derive(&field, beside, Kind::AzimuthalShear).expect("a derived cut");

    // 51.125 km is a quarter of a kilometre inside the storm's last gate, and
    // both readings of the range agree it is gate 49.
    let inside = gate_at(51.125);
    assert!(
        matches!(derived.field.get(360, inside).1, GateStatus::Valid),
        "the storm itself was masked out"
    );

    // 51.875 km is three quarters of the way to the centre of gate 50, so the
    // gate it is in is 50 and there is nothing there. Read as an edge it is
    // still gate 49, and the fit runs over air.
    let past = gate_at(51.875);
    assert!(
        !matches!(derived.field.get(360, past).1, GateStatus::Valid),
        "a gate past the echo was fitted, so the mask is half a gate out"
    );
}

/// A gate with almost nothing around it is dropped rather than fitted.
#[test]
fn a_gate_with_too_few_neighbours_is_dropped() {
    let mut field = empty("Velocity", "m/s");
    let (centre, gate) = (360usize, gate_at(50.0));
    // One reading and three neighbours, which is under the five the median
    // asks for.
    field.set(centre, gate, 12.0, GateStatus::Valid);
    field.set(centre - 1, gate, 11.0, GateStatus::Valid);
    field.set(centre + 1, gate, 13.0, GateStatus::Valid);
    field.set(centre, gate + 1, 12.0, GateStatus::Valid);
    let derived = derive(&field, Beside::default(), Kind::AzimuthalShear).expect("a derived cut");
    let (_, status) = derived.field.get(centre, gate);
    assert!(
        !matches!(status, GateStatus::Valid),
        "a gate with three neighbours was fitted"
    );
}

/// The debris criteria, planted one at a time.
fn debris_over(rho: f32, zdr: f32, dbz: f32) -> Option<SweepField> {
    let field = couplet(60.0, 3, 360);
    let reflectivity = flat("Reflectivity", "dBZ", dbz);
    let correlation = flat("Correlation coefficient", "", rho);
    let differential = flat("Differential reflectivity", "dB", zdr);
    derive(
        &field,
        Beside {
            reflectivity: Some(&reflectivity),
            correlation: Some(&correlation),
            differential: Some(&differential),
        },
        Kind::AzimuthalShear,
    )
    .expect("a derived cut")
    .debris
}

#[test]
fn debris_needs_all_four_criteria() {
    let flagged = debris_over(0.7, 0.1, 45.0).expect("a signature under a couplet");
    let (value, status) = flagged.get(360, gate_at(50.0));
    assert_eq!(status, GateStatus::Valid);
    assert_eq!(value, 1.0);

    // Each criterion on its own is enough to withdraw the signature: debris is
    // the four together, and three of them is a wind farm.
    assert!(
        debris_over(0.98, 0.1, 45.0).is_none(),
        "correlation of 0.98 was called debris"
    );
    assert!(
        debris_over(0.7, 3.0, 45.0).is_none(),
        "differential reflectivity of 3 dB was called debris"
    );
    assert!(
        debris_over(0.7, 0.1, 25.0).is_none(),
        "a 25 dBZ return was called debris"
    );
}

/// No couplet, no signature, however the dual-pol moments read.
#[test]
fn depolarised_echo_with_nothing_turning_is_not_flagged() {
    let field = flat("Velocity", "m/s", 3.0);
    let reflectivity = flat("Reflectivity", "dBZ", 45.0);
    let correlation = flat("Correlation coefficient", "", 0.7);
    let differential = flat("Differential reflectivity", "dB", 0.1);
    let derived = derive(
        &field,
        Beside {
            reflectivity: Some(&reflectivity),
            correlation: Some(&correlation),
            differential: Some(&differential),
        },
        Kind::AzimuthalShear,
    )
    .expect("a derived cut");
    assert!(
        derived.debris.is_none(),
        "still air was given a debris signature"
    );
}

/// Without the dual-pol moments there is no signature to draw, and the shear
/// is still drawn.
#[test]
fn a_volume_without_dual_pol_draws_shear_and_no_signature() {
    let field = couplet(60.0, 3, 360);
    let reflectivity = flat("Reflectivity", "dBZ", 45.0);
    let derived = derive(
        &field,
        Beside {
            reflectivity: Some(&reflectivity),
            ..Beside::default()
        },
        Kind::AzimuthalShear,
    )
    .expect("a derived cut");
    assert!(derived.debris.is_none());
    let (_, status) = derived.field.get(360, gate_at(50.0));
    assert_eq!(status, GateStatus::Valid);
}

/// The kernel widens in radials as it goes out, because the arc between two
/// radials does, and it never passes the cap the paper sets.
#[test]
fn the_kernel_is_measured_in_metres_and_capped_in_radials() {
    let arc_at = |range_km: f64| range_km * 1000.0 * (SPACING as f64).to_radians();
    let near = half_width(AZIMUTHAL_KERNEL_M.0, arc_at(5.0), MAX_RADIALS);
    let far = half_width(AZIMUTHAL_KERNEL_M.0, arc_at(200.0), MAX_RADIALS);
    assert_eq!(near, MAX_RADIALS / 2, "the cap is what holds close in");
    assert_eq!(far, 1, "at 200 km the floor is the three by three");
    let middle = half_width(AZIMUTHAL_KERNEL_M.0, arc_at(50.0), MAX_RADIALS);
    assert_eq!(middle, 3);
    // 2 * 3 + 1 radials of half a degree at 50 km is 2,618 m of arc, which is
    // the kernel the paper asks for to the nearest whole radial.
    assert!(near > middle && middle > far);
}

#[test]
fn the_derivation_names_the_kernel_and_the_mask() {
    let line = derivation(Kind::AzimuthalShear);
    assert!(line.contains("Mahalik"), "{line}");
    assert!(line.contains("2500 m azimuthal by 750 m radial"), "{line}");
    assert!(line.contains("20 dBZ"), "{line}");
    assert!(
        line.contains("thousandths of a reciprocal second"),
        "{line}"
    );
    let rotation = derivation(Kind::Rotation);
    assert!(rotation.contains("normalised by the 20 m/s"), "{rotation}");
}

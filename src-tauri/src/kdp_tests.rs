use super::*;

const SPACING: f32 = 0.5;
const FIRST_KM: f64 = 2.125;
const INTERVAL_KM: f64 = 0.25;
const AZIMUTHS: usize = 8;
const GATES: usize = 400;

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

fn range_km_of(gate: usize) -> f64 {
    FIRST_KM + gate as f64 * INTERVAL_KM
}

/// A field every gate of which reads the same.
fn flat(label: &str, unit: &str, value: f32) -> SweepField {
    let mut field = empty(label, unit);
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            field.set(azimuth, gate, value, GateStatus::Valid);
        }
    }
    field
}

/// A phase that climbs at a stated rate, which is the one input whose answer
/// is known in closed form: the slope is that rate, halved for the two-way
/// path the phase was accumulated over.
fn ramp(degrees_per_km: f32, offset: f32) -> SweepField {
    let mut field = empty("Differential phase", "deg");
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            let value = offset + degrees_per_km * (range_km_of(gate) - FIRST_KM) as f32;
            field.set(azimuth, gate, value, GateStatus::Valid);
        }
    }
    field
}

fn clean() -> SweepField {
    flat("Correlation coefficient", "", 0.98)
}

fn at(field: &SweepField, gate: usize) -> f32 {
    let (value, status) = field.get(4, gate);
    assert_eq!(status, GateStatus::Valid, "no reading at gate {gate}");
    value
}

/// The acceptance's own case. A phase climbing four degrees a kilometre is two
/// degrees a kilometre of specific differential phase, because the beam
/// accumulated the drift on the way out and again on the way back.
#[test]
fn a_planted_ramp_in_phase_gives_the_slope_it_stands_for() {
    let correlation = clean();
    let field = derive(&ramp(4.0, 63.0), Some(&correlation)).expect("a derived cut");
    assert_eq!(field.unit(), "deg/km");
    for gate in [60usize, 150, 300] {
        let found = at(&field, gate);
        assert!(
            (found - 2.0).abs() < 0.02,
            "gate {gate} read {found} rather than 2"
        );
    }
}

/// The radar's own phase offset is in every reading and is not rain, so it
/// cannot reach the answer.
#[test]
fn the_radars_own_phase_offset_does_not_reach_the_slope() {
    let correlation = clean();
    let low = derive(&ramp(4.0, 0.0), Some(&correlation)).expect("a derived cut");
    let high = derive(&ramp(4.0, 120.0), Some(&correlation)).expect("a derived cut");
    assert!((at(&low, 150) - at(&high, 150)).abs() < 1e-3);
}

/// Still phase is no rain at all, rather than a small reading either way.
#[test]
fn a_phase_that_is_not_climbing_reads_as_nothing() {
    let correlation = clean();
    let field = derive(&flat("Differential phase", "deg", 63.0), Some(&correlation))
        .expect("a derived cut");
    for gate in [60usize, 150, 300] {
        assert!(at(&field, gate).abs() < 1e-3, "gate {gate}");
    }
}

/// The censor the item names, at the correlation it names.
#[test]
fn gates_the_correlation_disowns_are_not_drawn() {
    let field = ramp(4.0, 63.0);
    let mut correlation = clean();
    // A stretch of ground clutter in the middle of the ray.
    for azimuth in 0..AZIMUTHS {
        for gate in 100..140 {
            correlation.set(azimuth, gate, CENSOR_CORRELATION - 0.05, GateStatus::Valid);
        }
    }
    let derived = derive(&field, Some(&correlation)).expect("a derived cut");
    for gate in 100..140 {
        let (_, status) = derived.get(4, gate);
        assert!(
            !matches!(status, GateStatus::Valid),
            "gate {gate} was drawn through a correlation of {}",
            CENSOR_CORRELATION - 0.05
        );
    }
    // The rain either side of it is still there, and still reads its own rate.
    assert!((at(&derived, 60) - 2.0).abs() < 0.05);
    assert!((at(&derived, 300) - 2.0).abs() < 0.05);
}

/// Without the correlation coefficient there is nothing to censor with, and an
/// uncensored phase drawn as rain is the field saying it is pouring over a
/// motorway.
#[test]
fn a_volume_without_the_correlation_coefficient_is_refused() {
    assert!(derive(&ramp(4.0, 63.0), None).is_none());
}

/// A handful of gates on their own is speckle, and a slope through it is
/// noise with a number on it.
#[test]
fn a_short_run_of_readings_is_not_drawn() {
    let mut field = empty("Differential phase", "deg");
    let correlation = clean();
    for azimuth in 0..AZIMUTHS {
        for gate in 200..203 {
            field.set(azimuth, gate, 63.0 + gate as f32, GateStatus::Valid);
        }
    }
    let derived = derive(&field, Some(&correlation)).expect("a derived cut");
    for gate in 200..203 {
        let (_, status) = derived.get(4, gate);
        assert!(
            !matches!(status, GateStatus::Valid),
            "a run of three gates was drawn"
        );
    }
}

/// The phase runs out of room and comes back round, and the slope has to carry
/// straight through it.
#[test]
fn a_phase_that_wraps_is_put_back_before_the_slope_is_taken() {
    let correlation = clean();
    let mut field = empty("Differential phase", "deg");
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            let climbed = 300.0 + 4.0 * (range_km_of(gate) - FIRST_KM) as f32;
            // What the radar writes down: the total, brought back into the
            // turn it is reported in.
            let reported = if climbed >= 360.0 {
                climbed - 360.0
            } else {
                climbed
            };
            field.set(azimuth, gate, reported, GateStatus::Valid);
        }
    }
    let derived = derive(&field, Some(&correlation)).expect("a derived cut");
    // The wrap is at gate 60: 300 degrees plus four a kilometre reaches 360
    // fifteen kilometres out, which is sixty quarter-kilometre gates.
    let wrapped = ((360.0 - 300.0) / 4.0 / INTERVAL_KM as f32).round() as usize;
    assert_eq!(wrapped, 60);
    // The gates the wrap sits inside the window of are the ones this is
    // about. Far past it the slope recovers on its own, because a step of
    // minus fourteen hundred degrees a kilometre is thrown out for being
    // impossible and the phase is rebuilt from what is left: a test that only
    // looked out there would pass with no unfolding at all.
    let half = window_gates(INTERVAL_KM) / 2;
    for gate in [wrapped - half + 2, wrapped, wrapped + half - 2] {
        let found = at(&derived, gate);
        assert!(
            (found - 2.0).abs() < 0.1,
            "gate {gate} read {found} across the wrap"
        );
    }
    // And well past it, where it has to hold too.
    for gate in [200usize, 300] {
        let found = at(&derived, gate);
        assert!(
            (found - 2.0).abs() < 0.05,
            "gate {gate} read {found} after the wrap"
        );
    }
}

/// A rate past the ceiling is more rain than falls, so it is discarded rather
/// than drawn.
#[test]
fn a_slope_outside_the_believable_band_is_discarded() {
    let correlation = clean();
    // Sixty degrees a kilometre of phase is thirty of slope, well past the
    // twenty the method allows.
    let field = derive(&ramp(60.0, 0.0), Some(&correlation)).expect("a derived cut");
    for gate in [60usize, 150] {
        assert!(
            at(&field, gate).abs() < 1e-3,
            "gate {gate} kept an impossible rate"
        );
    }
}

/// The window is a distance rather than a count of gates, because these gates
/// are a quarter the length the paper's were.
#[test]
fn the_window_is_measured_in_kilometres_and_stays_odd() {
    assert_eq!(window_gates(1.0), 7);
    assert_eq!(window_gates(0.25), 29);
    assert_eq!(window_gates(0.5), 15);
    // Never below the three a slope needs, whatever the gates are.
    assert_eq!(window_gates(100.0), 3);
    assert_eq!(window_gates(0.0), 3);
}

#[test]
fn the_derivation_names_the_method_and_the_censor() {
    let line = derivation(&ramp(4.0, 0.0));
    assert!(line.contains("Vulpiani"), "{line}");
    assert!(line.contains("0.9"), "{line}");
    assert!(line.contains("29 gates here"), "{line}");
    assert!(line.contains("halved for the two-way path"), "{line}");
}

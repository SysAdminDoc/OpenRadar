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

/// A phase climbing at a stated rate from a stated start, reported the way the
/// radar reports it, brought back into the one turn it has room for, on gates
/// of a stated length.
fn wrapping(start: f32, degrees_per_km: f32, interval_km: f64, gates: usize) -> SweepField {
    let angles: Vec<f32> = (0..AZIMUTHS).map(|at| at as f32 * SPACING).collect();
    let mut field = SweepField::new_empty(
        "Differential phase",
        "deg",
        0.5,
        angles,
        SPACING,
        FIRST_KM,
        interval_km,
        gates,
    );
    for azimuth in 0..AZIMUTHS {
        for gate in 0..gates {
            let climbed = start + degrees_per_km * (gate as f64 * interval_km) as f32;
            field.set(azimuth, gate, climbed.rem_euclid(360.0), GateStatus::Valid);
        }
    }
    field
}

/// A correlation coefficient that clears the censor everywhere, on the same
/// gates as a phase built for a test.
fn clean_like(phase: &SweepField) -> SweepField {
    let mut field = phase.new_like("Correlation coefficient", "");
    for azimuth in 0..phase.azimuth_count() {
        for gate in 0..phase.gate_count() {
            field.set(azimuth, gate, 0.98, GateStatus::Valid);
        }
    }
    field
}

/// Where a phase climbing at a rate from a start reaches a whole number of
/// turns, as a gate.
fn wraps_at(turns: f32, start: f32, degrees_per_km: f32, interval_km: f64) -> usize {
    ((360.0 * turns - start) / degrees_per_km / interval_km as f32).round() as usize
}

/// A ray the phase comes back round on twice, and both are put back.
///
/// Three hundred degrees and four more a kilometre reaches 360 fifteen
/// kilometres out and 720 a hundred and five out, which is ninety kilometres
/// of the rain an eyewall or a squall line holds. The first unfold took the
/// first wrap out and nothing looked again, so the second stayed in and the
/// slope across it was a drop of three hundred and sixty degrees, which the
/// band refuses: the rain past it was drawn as nothing at all.
#[test]
fn a_phase_that_wraps_twice_is_put_back_both_times() {
    let field = wrapping(300.0, 4.0, INTERVAL_KM, 600);
    let correlation = clean_like(&field);
    let derived = derive(&field, Some(&correlation)).expect("a derived cut");
    let second = wraps_at(2.0, 300.0, 4.0, INTERVAL_KM);
    assert_eq!(second, 420);
    let half = window_gates(INTERVAL_KM) / 2;
    for gate in [second - half + 2, second, second + half - 2, 500, 580] {
        let found = at(&derived, gate);
        assert!(
            (found - 2.0).abs() < 0.1,
            "gate {gate} read {found} across the second wrap"
        );
    }
}

/// A wrap is put back on gates of any length.
///
/// The paper's step found the fold where the slope first dropped past a
/// threshold, and a least-squares slope drops that far well before the wrap
/// itself: about nine gates early at a quarter of a kilometre and eighteen at
/// an eighth. Every gate in between was moved a turn it never lost and put
/// back only inside a band of ten gates, so at an eighth of a kilometre
/// several stayed a turn too high. Unwrapping against the reading before
/// moves no gate before the wrap, whatever the gates are.
#[test]
fn a_wrap_is_put_back_at_an_eighth_of_a_kilometre() {
    let interval = 0.125;
    let field = wrapping(300.0, 4.0, interval, 800);
    let correlation = clean_like(&field);
    let derived = derive(&field, Some(&correlation)).expect("a derived cut");
    let wrapped = wraps_at(1.0, 300.0, 4.0, interval);
    assert_eq!(wrapped, 120);
    let half = window_gates(interval) / 2;
    for gate in [
        wrapped - half + 2,
        wrapped - 10,
        wrapped,
        wrapped + half - 2,
        400,
        700,
    ] {
        let found = at(&derived, gate);
        assert!(
            (found - 2.0).abs() < 0.1,
            "gate {gate} read {found} across the wrap"
        );
    }
}

/// A phase that settles at the top of its turn reads as no rain, not as a
/// downpour.
///
/// After the rain the phase stops climbing wherever it got to, and if that is
/// close to a whole turn the radar's noise carries it back and forth across
/// the boundary: 357, 2, 359, 1. The paper's step took the first crossing for
/// a wrap, added a turn to everything after it and put back what overshot
/// only within one window, so past that window alternate gates sat a turn
/// apart and read as tens of degrees a kilometre or were refused. Held against
/// stored volumes reported from other offsets, that lost 434,311 gates and
/// moved the rest by 0.18 degrees a kilometre on average.
#[test]
fn a_phase_settled_at_the_top_of_its_turn_reads_as_no_rain() {
    let mut field = empty("Differential phase", "deg");
    let correlation = clean();
    // Rain for fifteen kilometres, climbing from 300 to a whole turn, and then
    // none: the phase stays where it got to, wandering a few degrees either
    // side of the boundary in runs of several gates the way a real one does.
    let climb_gates = 60usize;
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            let total = if gate < climb_gates {
                300.0 + 4.0 * (gate as f64 * INTERVAL_KM) as f32
            } else {
                let at = gate as f32;
                360.0
                    + 3.0 * (std::f32::consts::TAU * at / 23.0).sin()
                    + 1.5 * (std::f32::consts::TAU * at / 7.0).sin()
            };
            field.set(azimuth, gate, total.rem_euclid(360.0), GateStatus::Valid);
        }
    }
    let derived = derive(&field, Some(&correlation)).expect("a derived cut");
    // Well past the climb and its window, where the only thing the phase is
    // doing is sitting at the boundary.
    for gate in [120usize, 170, 220, 270, 320, 370] {
        let found = at(&derived, gate);
        assert!(
            found.abs() < 0.5,
            "gate {gate} read {found} deg/km on a phase that stopped climbing"
        );
    }
}

/// The ceiling is the one for the band these radars work in.
///
/// Sixteen degrees a kilometre is believable from a C-band radar and not from
/// an S-band one, where the same rain reads about half as much: the heaviest
/// rain the office's own product can say is 10.6. The paper's 20 is its
/// C-band figure, and this used to draw everything under it.
#[test]
fn a_rate_only_a_shorter_wavelength_could_read_is_discarded() {
    let correlation = clean();
    // Thirty-two degrees a kilometre of phase is sixteen of slope.
    let field = derive(&ramp(32.0, 0.0), Some(&correlation)).expect("a derived cut");
    for gate in [60usize, 150, 300] {
        let (value, status) = field.get(4, gate);
        assert!(
            !matches!(status, GateStatus::Valid),
            "gate {gate} was drawn at {value} deg/km on an S-band radar"
        );
    }
    // And the method line says which ceiling was in force.
    assert!(derivation(&field).contains("-2 to 14 degrees"));
}

/// A reading no radar could make is not taken, and does not stop the rest.
///
/// A local Archive II file names its own scale and offset, and one that made a
/// phase infinite, or so large that taking a turn off it changed nothing, had
/// the unwrap looping for ever on the worker thread the panel waits on. Run on
/// a thread of its own with a deadline, so that coming back is part of the
/// assertion and a regression fails here rather than hanging the suite.
#[test]
fn a_reading_no_radar_could_make_is_not_taken() {
    let mut field = ramp(4.0, 63.0);
    for azimuth in 0..AZIMUTHS {
        field.set(azimuth, 100, f32::INFINITY, GateStatus::Valid);
        field.set(azimuth, 200, 1.0e33, GateStatus::Valid);
        field.set(azimuth, 300, f32::NAN, GateStatus::Valid);
    }
    let (sent, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sent.send(derive(&field, Some(&clean())));
    });
    let derived = received
        .recv_timeout(std::time::Duration::from_secs(20))
        .expect("the derivation came back")
        .expect("a derived cut");
    for gate in [100usize, 200, 300] {
        let (_, status) = derived.get(4, gate);
        assert!(
            !matches!(status, GateStatus::Valid),
            "gate {gate} was drawn"
        );
    }
    // The rain either side reads its own rate, one missing gate being a gap
    // the fit reads straight across.
    for gate in [60usize, 150, 250, 350] {
        let found = at(&derived, gate);
        assert!((found - 2.0).abs() < 0.05, "gate {gate} read {found}");
    }
}

/// A censored block does not pull the reading beside it down.
///
/// The reconciliation integrates the slope into a phase and fits the slope
/// back out of it, and a censored stretch has no slope, so it used to go into
/// the integral as zero and come back out as a flat stretch of phase that
/// every window reaching it fitted a line through. This holds each gate from
/// the one touching the block out to half a window away against the same gate
/// with the block not there. The tolerance is a fifth of the office's own
/// step, which is a twentieth of a degree a kilometre: a difference nobody
/// reading either product could see.
#[test]
fn a_censored_block_does_not_pull_down_the_reading_beside_it() {
    const TOLERANCE: f32 = 0.01;
    let field = ramp(4.0, 63.0);
    let open = clean();
    let mut blocked = clean();
    let block = 150..190;
    for azimuth in 0..AZIMUTHS {
        for gate in block.clone() {
            blocked.set(azimuth, gate, CENSOR_CORRELATION - 0.05, GateStatus::Valid);
        }
    }
    let without = derive(&field, Some(&open)).expect("a derived cut");
    let with = derive(&field, Some(&blocked)).expect("a derived cut");
    let half = window_gates(INTERVAL_KM) / 2;
    let mut worst = (0usize, 0.0f32);
    for gate in (block.start - half..block.start).chain(block.end..=block.end + half) {
        let apart = (at(&with, gate) - at(&without, gate)).abs();
        if apart > worst.1 {
            worst = (gate, apart);
        }
    }
    assert!(
        worst.1 < TOLERANCE,
        "gate {} reads {} deg/km off with the block beside it",
        worst.0,
        worst.1
    );
}

/// A rate past the ceiling is more rain than falls, so it is discarded rather
/// than drawn.
///
/// This test used to assert the opposite of its own name and of the module's
/// own doc: it required the gate to come back `Valid` and read zero. That is
/// not discarding it, it is drawing it as no rain at all, and the readings
/// that land outside the band are the heaviest rain on the ray. A downpour
/// rendered as a dry hole in the one field read for rain rate is worse than
/// no reading, which is what this now asks for.
#[test]
fn a_slope_outside_the_believable_band_is_discarded() {
    let correlation = clean();
    // Sixty degrees a kilometre of phase is thirty of slope, well past the
    // twenty the method allows.
    let field = derive(&ramp(60.0, 0.0), Some(&correlation)).expect("a derived cut");
    for gate in [60usize, 150] {
        let (_, status) = field.get(4, gate);
        assert!(
            !matches!(status, GateStatus::Valid),
            "gate {gate} was drawn despite an impossible rate"
        );
    }
}

/// A stretch of rain too short to fit a line through is not a stretch of no rain.
///
/// `slopes` refuses a window with fewer than half of it measured, so a run
/// shorter than half the processing window has a phase reading at every gate
/// and no slope at any of them. Nine gates at a quarter of a kilometre is two
/// and a bit kilometres of rain, which is an ordinary shower and long enough
/// to survive the despeckle. Every one of those gates used to be drawn as a
/// measured zero: the reconciliation reads the missing slope as no slope,
/// integrates a flat phase across the run, and derives no slope back out of
/// it, so the picture said the radar had looked and found clear air.
#[test]
fn a_run_too_short_to_fit_a_line_through_is_not_drawn_as_no_rain() {
    let mut correlation = flat("Correlation coefficient", "", 0.2);
    let mut phase = empty("Differential phase", "deg");
    // The window here is 29 gates and the fit wants 15 of them, so nine is
    // comfortably short of it and comfortably past the five the despeckle
    // asks for.
    let run = 150..159;
    for azimuth in 0..AZIMUTHS {
        for gate in run.clone() {
            correlation.set(azimuth, gate, 0.98, GateStatus::Valid);
            let value = 40.0 + 4.0 * (range_km_of(gate) - range_km_of(150)) as f32;
            phase.set(azimuth, gate, value, GateStatus::Valid);
        }
    }
    let field = derive(&phase, Some(&correlation)).expect("a derived cut");
    for gate in run {
        let (value, status) = field.get(4, gate);
        assert!(
            !matches!(status, GateStatus::Valid),
            "gate {gate} was drawn as {value} deg/km, which nothing measured"
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

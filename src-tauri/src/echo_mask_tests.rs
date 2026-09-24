use super::*;

const RADIALS: usize = 360;
const GATES: usize = 400;
const FIRST_KM: f64 = 2.125;
const INTERVAL_KM: f64 = 0.25;

fn empty(label: &str, elevation: f32) -> SweepField {
    SweepField::new_empty(
        label,
        "",
        elevation,
        (0..RADIALS).map(|at| at as f32).collect(),
        1.0,
        FIRST_KM,
        INTERVAL_KM,
        GATES,
    )
}

/// Correlation that wanders from gate to gate around `middle`, the way a
/// bloom's does, by `spread` either way.
fn noisy(middle: f32, spread: f32, gate: usize) -> f32 {
    middle
        + if gate.is_multiple_of(2) {
            spread
        } else {
            -spread
        }
}

/// A cut with one kind of target in each block of radials, and the cut above
/// it. Each block is named where it is laid down.
fn planted() -> (SweepField, SweepField, SweepField) {
    let mut rho = empty("Correlation coefficient", 0.5);
    let mut dbz = empty("Reflectivity", 0.5);
    let mut high = empty("Reflectivity", 4.0);
    let mut lay = |radials: std::ops::Range<usize>,
                   gates: std::ops::Range<usize>,
                   correlation: &dyn Fn(usize) -> f32,
                   reflectivity: f32| {
        for radial in radials {
            for gate in gates.clone() {
                rho.set(radial, gate, correlation(gate), GateStatus::Valid);
                dbz.set(radial, gate, reflectivity, GateStatus::Valid);
            }
        }
    };
    // Rain.
    lay(0..90, 20..200, &|_| 0.99, 35.0);
    // A bloom: faint, and its correlation all over the place.
    lay(90..180, 20..200, &|gate| noisy(0.55, 0.15, gate), 10.0);
    // A hail core, low and noisy in correlation like a bloom but strong, far
    // enough out that the cut above passes well over it.
    lay(180..190, 200..220, &|gate| noisy(0.75, 0.15, gate), 60.0);
    // Ground clutter: the same strength and the same look, with nothing
    // above it. As far out as the core, where the cut above passes well over
    // both, so what tells them apart is the column and not the geometry.
    lay(200..210, 200..220, &|gate| noisy(0.5, 0.15, gate), 55.0);
    // The edge of rain, where the correlation dips below the bar smoothly.
    lay(220..230, 20..200, &|_| 0.9, 30.0);
    // Correlation that only melting snow explains: 0.72 and 0.94 in turn,
    // under the bar and noisy enough outside the layer, over the bar inside.
    lay(270..280, 300..340, &|gate| noisy(0.83, 0.11, gate), 30.0);
    // Clutter close in, where the cut above passes less than two kilometres
    // over it and so cannot say whether a column stands there.
    lay(190..200, 40..50, &|gate| noisy(0.5, 0.15, gate), 55.0);
    // One gate with a low correlation and no neighbour to measure its texture
    // against.
    lay(240..241, 100..101, &|_| 0.5, 20.0);
    // The smooth edge of rain running into a bloom. Measured over its own
    // few gates the edge is smooth; measured over a dozen either side it
    // takes in the bloom and would be hidden with it.
    lay(250..260, 20..40, &|_| 0.9, 30.0);
    lay(250..260, 40..60, &|gate| noisy(0.7, 0.15, gate), 20.0);
    // The column above the hail core, on the higher cut, only over the core:
    // read at the wrong range it is not there.
    for radial in 180..190 {
        for gate in 196..226 {
            high.set(radial, gate, 50.0, GateStatus::Valid);
        }
    }
    // Weak returns over the far clutter, which the radar did read and which
    // are not a column.
    for radial in 200..210 {
        for gate in 196..226 {
            high.set(radial, gate, 5.0, GateStatus::Valid);
        }
    }
    (rho, dbz, high)
}

/// How many gates of a block the mask hides, out of how many it has.
fn hidden_in(
    mask: &SweepField,
    radials: std::ops::Range<usize>,
    gates: std::ops::Range<usize>,
) -> (usize, usize) {
    let mut hidden = 0;
    let mut all = 0;
    for radial in radials {
        for gate in gates.clone() {
            all += 1;
            if matches!(mask.get(radial, gate), (_, GateStatus::Valid)) {
                hidden += 1;
            }
        }
    }
    (hidden, all)
}

fn masked(melting_km: Option<(f64, f64)>) -> SweepField {
    let (rho, dbz, high) = planted();
    non_weather(
        &rho,
        Some(&dbz),
        0.5,
        &[Above {
            elevation: 4.0,
            reflectivity: &high,
        }],
        melting_km,
    )
}

#[test]
fn a_bloom_is_hidden_and_rain_is_not() {
    let mask = masked(None);
    assert_eq!(hidden_in(&mask, 0..90, 20..200).0, 0, "rain was hidden");
    // Every bloom gate but the two at each end of a radial, where there are
    // too few neighbours to measure the texture by.
    let (hidden, all) = hidden_in(&mask, 90..180, 20..200);
    assert!(
        hidden * 100 >= all * 95,
        "{hidden} of {all} bloom gates hidden"
    );
}

#[test]
fn a_hail_core_under_a_column_stays_and_clutter_does_not() {
    let mask = masked(None);
    assert_eq!(
        hidden_in(&mask, 180..190, 200..220).0,
        0,
        "the hail core was hidden"
    );
    let (hidden, all) = hidden_in(&mask, 200..210, 202..218);
    assert_eq!(hidden, all, "clutter with nothing above it was kept");
}

#[test]
fn a_smooth_dip_at_the_edge_of_rain_is_rain() {
    assert_eq!(hidden_in(&masked(None), 220..230, 20..200).0, 0);
}

#[test]
fn inside_the_melting_layer_only_a_lower_correlation_is_hidden() {
    // Outside any melting layer, 0.72 and 0.94 are both under 0.95, and noisy.
    let (hidden, all) = hidden_in(&masked(None), 270..280, 302..338);
    assert_eq!(hidden, all);
    // With the layer where these gates are, they are melting snow.
    let heights = |gate: usize| beam_height_km(FIRST_KM + gate as f64 * INTERVAL_KM, 0.5);
    let layer = (heights(290), heights(350));
    assert_eq!(hidden_in(&masked(Some(layer)), 270..280, 302..338).0, 0);
}

#[test]
fn nothing_is_hidden_where_the_radar_read_nothing() {
    let mask = masked(None);
    assert_eq!(hidden_in(&mask, 300..360, 0..GATES).0, 0);
}

#[test]
fn a_strong_core_nothing_passes_over_is_kept() {
    // On the top cut, or close in where the next cut up passes less than two
    // kilometres over it, nothing can say whether a core stands in a storm or
    // on a hill. Hiding a hail core somebody is looking at is the worse of
    // the two mistakes, so it stays.
    let (rho, dbz, _) = planted();
    let top = non_weather(&rho, Some(&dbz), 0.5, &[], None);
    assert_eq!(
        hidden_in(&top, 180..190, 202..218).0,
        0,
        "the top cut lost its core"
    );
    // And the clutter close in, under a cut that passes too low over it.
    let (hidden, _) = hidden_in(&masked(None), 190..200, 42..48);
    assert_eq!(hidden, 0, "clutter nothing could see over was hidden");
}

#[test]
fn a_higher_cut_counts_only_where_it_has_swept() {
    // A cut the radar is still sweeping, fifteen radials into a storm, and a
    // finished one that passed over the wind farm and saw nothing. The
    // reader answers any bearing with the nearest radial it has, so the
    // storm's radials were letting a wind farm sixty degrees away back in.
    let (rho, dbz, _) = planted();
    let mut farm_rho = rho.clone();
    let mut farm_dbz = dbz.clone();
    for radial in 250..256 {
        for gate in 200..220 {
            farm_rho.set(radial, gate, noisy(0.5, 0.15, gate), GateStatus::Valid);
            farm_dbz.set(radial, gate, 55.0, GateStatus::Valid);
        }
    }
    let mut partial = SweepField::new_empty(
        "Reflectivity",
        "",
        4.0,
        (175..190).map(|at| at as f32).collect(),
        1.0,
        FIRST_KM,
        INTERVAL_KM,
        GATES,
    );
    for radial in 0..15 {
        for gate in 0..GATES {
            partial.set(radial, gate, 50.0, GateStatus::Valid);
        }
    }
    let finished = empty("Reflectivity", 3.0);
    let mut finished = finished;
    for radial in 0..RADIALS {
        for gate in 0..GATES {
            finished.set(radial, gate, 0.0, GateStatus::NoData);
        }
    }
    let mask = non_weather(
        &farm_rho,
        Some(&farm_dbz),
        0.5,
        &[
            Above {
                elevation: 4.0,
                reflectivity: &partial,
            },
            Above {
                elevation: 3.0,
                reflectivity: &finished,
            },
        ],
        None,
    );
    let (hidden, all) = hidden_in(&mask, 250..256, 202..218);
    assert_eq!(hidden, all, "a distant storm let the wind farm back in");
}

#[test]
fn a_column_is_read_where_the_core_is_and_nowhere_else() {
    // The cut above holds the column only over the core. Read at half the
    // range, or with no bar on what counts as echo, or with any strength of
    // core let back in, the core or the clutter goes the wrong way.
    let mask = masked(None);
    assert_eq!(hidden_in(&mask, 180..190, 202..218).0, 0, "the core went");
    let (hidden, all) = hidden_in(&mask, 200..210, 202..218);
    assert_eq!(
        hidden, all,
        "weak returns over the clutter counted as a column"
    );
}

#[test]
fn a_gate_with_no_texture_to_measure_is_kept() {
    // One reading with nothing either side of it cannot be said to wander,
    // and a mask is a judgement it has no grounds for.
    assert_eq!(hidden_in(&masked(None), 240..241, 100..101).0, 0);
}

#[test]
fn texture_is_measured_over_a_few_gates_and_no_more() {
    // The smooth edge of rain beside a bloom. Two gates either side of an
    // edge gate is the edge; twelve takes in the bloom.
    let (hidden, _) = hidden_in(&masked(None), 250..260, 20..38);
    assert_eq!(
        hidden, 0,
        "the edge of the rain went with the bloom beside it"
    );
    let (hidden, all) = hidden_in(&masked(None), 250..260, 42..58);
    assert_eq!(hidden, all, "the bloom beside the edge was kept");
}

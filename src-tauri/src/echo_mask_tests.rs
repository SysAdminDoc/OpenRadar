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
    middle + if gate.is_multiple_of(2) { spread } else { -spread }
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
    // above it.
    lay(200..210, 20..40, &|gate| noisy(0.5, 0.15, gate), 55.0);
    // The edge of rain, where the correlation dips below the bar smoothly.
    lay(220..230, 20..200, &|_| 0.9, 30.0);
    // Correlation that only melting snow explains: 0.72 and 0.94 in turn,
    // under the bar and noisy enough outside the layer, over the bar inside.
    lay(270..280, 300..340, &|gate| noisy(0.83, 0.11, gate), 30.0);
    // The column above the hail core, on the higher cut.
    for radial in 180..190 {
        for gate in 0..GATES {
            high.set(radial, gate, 50.0, GateStatus::Valid);
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
    let (hidden, all) = hidden_in(&mask, 200..210, 22..38);
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

use super::*;

use crate::cross_section::beam_height_km;

const AZIMUTHS: usize = 90;
const GATES: usize = 400;
const FIRST_KM: f64 = 2.125;
const INTERVAL_KM: f64 = 0.25;
const TILT: f32 = 9.9;

fn empty(label: &str, unit: &str, elevation: f32) -> SweepField {
    let angles: Vec<f32> = (0..AZIMUTHS).map(|at| at as f32 * 4.0).collect();
    SweepField::new_empty(
        label,
        unit,
        elevation,
        angles,
        4.0,
        FIRST_KM,
        INTERVAL_KM,
        GATES,
    )
}

/// The range at which a beam at this tilt is at a given height.
fn gate_at_height(height_km: f64, elevation: f32) -> usize {
    for gate in 0..GATES {
        let range = FIRST_KM + gate as f64 * INTERVAL_KM;
        if beam_height_km(range, elevation) >= height_km {
            return gate;
        }
    }
    GATES - 1
}

/// A volume with a bright band planted at a stated height.
///
/// Everything outside the band is ordinary rain: bright enough to be weather,
/// a small differential reflectivity, and a correlation near one. The band is
/// the three signatures together, which is what the method is looking for and
/// what nothing else in the cut has.
fn planted(
    height_km: f64,
    thickness_gates: usize,
    elevation: f32,
) -> (SweepField, SweepField, SweepField) {
    let mut z = empty("Reflectivity", "dBZ", elevation);
    let mut zdr = empty("Differential reflectivity", "dB", elevation);
    let mut rho = empty("Correlation coefficient", "", elevation);
    let band = gate_at_height(height_km, elevation);
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            let inside = gate >= band && gate < band + thickness_gates;
            let (zv, zdrv, rhov) = if inside {
                (48.0, 2.2, 0.91)
            } else {
                // Rain: bright, round drops, and the two polarisations
                // agreeing almost perfectly.
                (32.0, 0.3, 0.995)
            };
            z.set(azimuth, gate, zv, GateStatus::Valid);
            zdr.set(azimuth, gate, zdrv, GateStatus::Valid);
            rho.set(azimuth, gate, rhov, GateStatus::Valid);
        }
    }
    (z, zdr, rho)
}

/// The acceptance's own case.
#[test]
fn a_planted_band_at_three_kilometres_reads_as_three() {
    let (z, zdr, rho) = planted(3.0, 3, TILT);
    let found = from_cut(&z, &zdr, &rho).expect("a melting layer");
    assert!(
        (found.peak_km - 3.0).abs() <= 0.25,
        "peak at {} km",
        found.peak_km
    );
    assert!(found.bottom_km <= 3.0, "bottom at {}", found.bottom_km);
    assert!(found.top_km >= 3.0, "top at {}", found.top_km);
    assert_eq!(found.elevation_degrees, TILT);
    assert!(found.gates >= AZIMUTHS, "{} gates", found.gates);
}

/// A band somewhere else reads as somewhere else, which is what says this is
/// measuring the volume rather than restating a constant.
#[test]
fn the_height_it_answers_is_the_height_that_was_planted() {
    for planted_km in [1.5, 2.0, 4.0] {
        let (z, zdr, rho) = planted(planted_km, 3, TILT);
        let found = from_cut(&z, &zdr, &rho).expect("a melting layer");
        assert!(
            (found.peak_km - planted_km).abs() <= 0.25,
            "planted {planted_km}, read {}",
            found.peak_km
        );
    }
}

/// Rain is not a melting layer, however hard it is raining.
#[test]
fn ordinary_rain_has_no_band_in_it() {
    let mut z = empty("Reflectivity", "dBZ", TILT);
    let mut zdr = empty("Differential reflectivity", "dB", TILT);
    let mut rho = empty("Correlation coefficient", "", TILT);
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            // A downpour: very bright, and still round drops that agree.
            z.set(azimuth, gate, 55.0, GateStatus::Valid);
            zdr.set(azimuth, gate, 3.0, GateStatus::Valid);
            rho.set(azimuth, gate, 0.995, GateStatus::Valid);
        }
    }
    assert_eq!(from_cut(&z, &zdr, &rho), Err(NoLayer::NothingMelting));
}

/// The three signatures have to hold together, not one at a time.
#[test]
fn one_signature_on_its_own_is_not_melting_snow() {
    // Bright and wet-looking, but the polarisations still agree: heavy rain.
    assert!(membership(48.0, 2.2, 0.995) < MEMBERSHIP_THRESHOLD);
    // A low correlation with nothing to reflect: birds, insects, chaff.
    assert!(membership(10.0, 2.2, 0.85) < MEMBERSHIP_THRESHOLD);
    // Bright with a low correlation but round: large hail.
    assert!(membership(58.0, 0.2, 0.85) < MEMBERSHIP_THRESHOLD);
    // All three at once is the band.
    assert!(membership(48.0, 2.2, 0.91) >= MEMBERSHIP_THRESHOLD);
}

/// A low cut is refused rather than answered badly.
#[test]
fn a_cut_below_the_angle_this_reads_says_so() {
    let (z, zdr, rho) = planted(3.0, 3, 0.5);
    assert_eq!(from_cut(&z, &zdr, &rho), Err(NoLayer::NoHighTilt));
    // And the angle itself is allowed, not just anything above it.
    let (z, zdr, rho) = planted(3.0, 3, LOWEST_TILT_DEGREES);
    assert!(from_cut(&z, &zdr, &rho).is_ok());
}

/// A handful of gates that happened to clear the threshold is not a band.
#[test]
fn a_few_scattered_gates_are_not_a_layer() {
    let mut z = empty("Reflectivity", "dBZ", TILT);
    let mut zdr = empty("Differential reflectivity", "dB", TILT);
    let mut rho = empty("Correlation coefficient", "", TILT);
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            z.set(azimuth, gate, 32.0, GateStatus::Valid);
            zdr.set(azimuth, gate, 0.3, GateStatus::Valid);
            rho.set(azimuth, gate, 0.995, GateStatus::Valid);
        }
    }
    // Ten gates in the whole disc, all at the same height, which would be a
    // perfectly sharp band if a count of ten meant anything.
    let band = gate_at_height(3.0, TILT);
    for azimuth in 0..10 {
        z.set(azimuth, band, 48.0, GateStatus::Valid);
        zdr.set(azimuth, band, 2.2, GateStatus::Valid);
        rho.set(azimuth, band, 0.91, GateStatus::Valid);
    }
    assert_eq!(from_cut(&z, &zdr, &rho), Err(NoLayer::NothingMelting));
}

/// The band has a top and a bottom, and they are not the same number.
#[test]
fn a_thicker_band_reads_as_a_thicker_band() {
    let thin = from_cut(
        &planted(3.0, 2, TILT).0,
        &planted(3.0, 2, TILT).1,
        &planted(3.0, 2, TILT).2,
    )
    .expect("a thin layer");
    let thick = from_cut(
        &planted(3.0, 12, TILT).0,
        &planted(3.0, 12, TILT).1,
        &planted(3.0, 12, TILT).2,
    )
    .expect("a thick layer");
    let thin_depth = thin.top_km - thin.bottom_km;
    let thick_depth = thick.top_km - thick.bottom_km;
    assert!(thin_depth > 0.0, "{thin_depth}");
    assert!(
        thick_depth > thin_depth,
        "thin {thin_depth}, thick {thick_depth}"
    );
}

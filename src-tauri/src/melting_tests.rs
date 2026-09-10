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
    let found = from_cut(&z, &zdr, &rho, 0.0).expect("a melting layer");
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
        let found = from_cut(&z, &zdr, &rho, 0.0).expect("a melting layer");
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
    assert_eq!(from_cut(&z, &zdr, &rho, 0.0), Err(NoLayer::NothingMelting));
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
    assert_eq!(from_cut(&z, &zdr, &rho, 0.0), Err(NoLayer::NoHighTilt));
    // And the angle itself is allowed, not just anything above it.
    let (z, zdr, rho) = planted(3.0, 3, LOWEST_TILT_DEGREES);
    assert!(from_cut(&z, &zdr, &rho, 0.0).is_ok());
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
    assert_eq!(from_cut(&z, &zdr, &rho, 0.0), Err(NoLayer::NothingMelting));
}

/// The band has a top and a bottom, and they are not the same number.
#[test]
fn a_thicker_band_reads_as_a_thicker_band() {
    let thin = from_cut(
        &planted(3.0, 2, TILT).0,
        &planted(3.0, 2, TILT).1,
        &planted(3.0, 2, TILT).2,
        0.0,
    )
    .expect("a thin layer");
    let thick = from_cut(
        &planted(3.0, 12, TILT).0,
        &planted(3.0, 12, TILT).1,
        &planted(3.0, 12, TILT).2,
        0.0,
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

/// The heights come back on the datum the panel beside them is written on.
#[test]
fn the_height_is_above_sea_level_and_not_above_the_antenna() {
    // A band three kilometres over the antenna, at a radar standing three
    // kilometres up. Grand Junction is about that high, and the freezing
    // level shown two lines above this in the panel is above sea level: read
    // from the antenna, the same physical height would appear as 3.0 there
    // and 6.0 here.
    let (z, zdr, rho) = planted(3.0, 3, TILT);
    let flat = from_cut(&z, &zdr, &rho, 0.0).expect("a melting layer");
    let high = from_cut(&z, &zdr, &rho, 3.06).expect("a melting layer");
    assert!(
        (high.peak_km - flat.peak_km - 3.06).abs() <= 0.06,
        "flat {} against high {}",
        flat.peak_km,
        high.peak_km
    );
    assert!(
        (high.top_km - flat.top_km - 3.06).abs() <= 0.06,
        "top {} against {}",
        flat.top_km,
        high.top_km
    );
}

/// What the count beside a layer is counting.
#[test]
fn the_gate_count_is_the_gates_in_the_band() {
    // The band across the whole disc at three kilometres, and a patch of
    // large wet hail at six on a third of the rays. Both clear the threshold
    // and only one of them is the layer, so a count of everything that
    // cleared it reports a third more gates than the band holds.
    let mut z = empty("Reflectivity", "dBZ", TILT);
    let mut zdr = empty("Differential reflectivity", "dB", TILT);
    let mut rho = empty("Correlation coefficient", "", TILT);
    let band = gate_at_height(3.0, TILT);
    let hail = gate_at_height(6.0, TILT);
    for azimuth in 0..AZIMUTHS {
        for gate in 0..GATES {
            let inside = (gate >= band && gate < band + 3)
                || (azimuth < 30 && gate >= hail && gate < hail + 3);
            let (zv, zdrv, rhov) = if inside {
                (48.0, 2.2, 0.91)
            } else {
                (32.0, 0.3, 0.995)
            };
            z.set(azimuth, gate, zv, GateStatus::Valid);
            zdr.set(azimuth, gate, zdrv, GateStatus::Valid);
            rho.set(azimuth, gate, rhov, GateStatus::Valid);
        }
    }
    let found = from_cut(&z, &zdr, &rho, 0.0).expect("a melting layer");
    assert!(
        (found.peak_km - 3.0).abs() <= 0.25,
        "peak at {}",
        found.peak_km
    );
    // Two hundred and seventy in the band, three hundred and sixty over the
    // threshold anywhere in the cut.
    assert!(
        found.gates <= AZIMUTHS * 3,
        "{} gates for a band of {}",
        found.gates,
        AZIMUTHS * 3
    );
    assert!(found.gates >= AZIMUTHS * 2, "{} gates", found.gates);
}

/// A smear across the whole cut is not a band with shoulders.
#[test]
fn a_flat_histogram_is_not_a_six_kilometre_melting_layer() {
    // One gate in every hundred-metre bin from the ground to six kilometres.
    // The shoulder is half of the peak, and half of one is one, so the walk
    // has nothing to stop it and reports the whole sky as melting.
    let flat: Vec<f64> = (0..=60).map(|bin| bin as f64 * BIN_KM).collect();
    assert!(flat.len() > ENOUGH_GATES);
    assert_eq!(band_of(&flat), None);

    // And the control: the same number of gates gathered into a real band is
    // still read as one.
    let banded: Vec<f64> = (0..=60).map(|at| 3.0 + (at % 4) as f64 * BIN_KM).collect();
    let (top, bottom, _) = band_of(&banded).expect("a band");
    assert!(top - bottom <= MAX_BAND_KM, "{} to {}", bottom, top);
}

/// A flat-topped band's middle is its middle.
#[test]
fn the_peak_of_a_plateau_is_the_middle_of_it() {
    // Fifty gates in each of the six bins from three kilometres to 3.6. Its
    // middle is 3.3. Taking whichever bin the map iterated to last put it at
    // 3.45, which is outside the quarter kilometre this is meant to be good
    // to, and always at the top rather than either side.
    let mut heights = Vec::new();
    for bin in 30..36 {
        for _ in 0..50 {
            heights.push(bin as f64 * BIN_KM + BIN_KM / 2.0);
        }
    }
    let (top, bottom, peak) = band_of(&heights).expect("a band");
    assert!((peak - 3.3).abs() <= 0.1, "peak at {peak}");
    assert!((bottom - 3.0).abs() < 1e-9, "bottom at {bottom}");
    assert!((top - 3.6).abs() < 1e-9, "top at {top}");
}

/// One moment of one radial, packed the way the ICD packs one.
///
/// `(raw - offset) / scale` is how the decoder reads a gate back, so the
/// bytes are `value * scale + offset`. Every raw here is well clear of 0 and
/// 1, which the format reserves for below-threshold and range-folded.
fn moment(values: &[f32], scale: f32, offset: f32) -> nexrad_model::data::MomentData {
    let bytes: Vec<u8> = values
        .iter()
        .map(|value| (value * scale + offset).round() as u8)
        .collect();
    nexrad_model::data::MomentData::from_fixed_point(
        values.len() as u16,
        (FIRST_KM * 1000.0) as u16,
        (INTERVAL_KM * 1000.0) as u16,
        8,
        scale,
        offset,
        bytes,
    )
}

/// A cut of a volume with a band planted at a height, over some of its rays.
///
/// `rays` is how much of the disc sees the band, which is what tells a real
/// layer from a patch of something else that happens to look like one.
fn cut(
    elevation: f32,
    elevation_number: u8,
    band_km: f64,
    rays: usize,
) -> Vec<nexrad_model::data::Radial> {
    let band = gate_at_height(band_km, elevation);
    (0..AZIMUTHS)
        .map(|azimuth| {
            let mut z = vec![32.0f32; GATES];
            let mut zdr = vec![0.3f32; GATES];
            let mut rho = vec![0.995f32; GATES];
            if azimuth < rays {
                for gate in band..(band + 3).min(GATES) {
                    z[gate] = 48.0;
                    zdr[gate] = 2.2;
                    rho[gate] = 0.91;
                }
            }
            nexrad_model::data::Radial::new(
                1_756_000_000,
                azimuth as u16,
                azimuth as f32 * 4.0,
                4.0,
                nexrad_model::data::RadialStatus::IntermediateRadialData,
                elevation_number,
                elevation,
                Some(moment(&z, 2.0, 66.0)),
                None,
                None,
                Some(moment(&zdr, 10.0, 100.0)),
                None,
                Some(moment(&rho, 200.0, 0.0)),
                None,
            )
        })
        .collect()
}

/// The cut that saw most of the band is the one that answers for the volume.
#[test]
fn the_volume_answers_from_the_cut_that_saw_most_of_the_band() {
    // Twenty rays of a wet, disagreeing signature at eight kilometres on the
    // steep cut, which is what large wet hail looks like, and the real band
    // at three kilometres across the whole disc on the shallower one. Taking
    // the steepest cut that answered at all put the freezing level five
    // kilometres too high, off sixty gates.
    let mut radials = cut(9.9, 1, 3.0, AZIMUTHS);
    radials.extend(cut(19.5, 2, 8.0, 20));
    let scan = nexrad_model::data::Scan::new(
        nexrad_model::data::VolumeCoveragePattern::new(
            212,
            1,
            0.5,
            nexrad_model::data::PulseWidth::Short,
            false,
            0,
            false,
            0,
            false,
            false,
            0,
            false,
            false,
            Vec::new(),
        ),
        nexrad_model::data::Sweep::from_radials(radials),
    );

    let found = from_volume(&scan, 0.0).expect("a melting layer");
    assert!(
        (found.peak_km - 3.0).abs() <= 0.25,
        "read {} km off the {} degree cut with {} gates",
        found.peak_km,
        found.elevation_degrees,
        found.gates
    );
    assert_eq!(found.elevation_degrees, 9.9);
    // And it chose on the count rather than on the angle: the cut it passed
    // over did answer, with far fewer gates.
    let steep = from_cut(
        &crate::level2::sweep_field_at(&scan, nexrad_model::data::Product::Reflectivity, 19.5)
            .expect("the steep cut")
            .field,
        &crate::level2::sweep_field_at(
            &scan,
            nexrad_model::data::Product::DifferentialReflectivity,
            19.5,
        )
        .expect("the steep cut")
        .field,
        &crate::level2::sweep_field_at(
            &scan,
            nexrad_model::data::Product::CorrelationCoefficient,
            19.5,
        )
        .expect("the steep cut")
        .field,
        0.0,
    )
    .expect("the steep cut sees something");
    assert!(steep.peak_km > 7.0, "steep peak at {}", steep.peak_km);
    assert!(
        steep.gates < found.gates,
        "steep {} against shallow {}",
        steep.gates,
        found.gates
    );
}

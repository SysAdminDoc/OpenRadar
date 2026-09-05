use super::*;
use crate::level2::testing::*;

#[test]
fn smoothing_reads_between_the_gates_rather_than_from_the_nearest() {
    let (field, _) = stepped_field(Product::Reflectivity);
    // Exactly halfway between the last gate of one step and the first of
    // the next, where the two readings are eight apart.
    let between = (gate_centre_km(&field, 49) + gate_centre_km(&field, 50)) / 2.0;
    let nearest = field
        .value_at_polar(10.0, between)
        .expect("a gate is there");
    let smoothed =
        smoothed_gate(&field, Product::Reflectivity, 10.0, between).expect("a gate is there");

    // Unsmoothed the picture steps: it is one gate's reading or the next.
    assert!(nearest.0 == 20.0 || nearest.0 == 28.0, "{}", nearest.0);
    // Smoothed it is between them, and strictly between.
    assert!(
        smoothed.0 > 20.0 && smoothed.0 < 28.0,
        "expected a reading between the two gates, got {}",
        smoothed.0
    );
    assert_eq!(smoothed.1, GateStatus::Valid);
}

#[test]
fn smoothing_reads_between_the_radials_too() {
    // A cut whose readings change with the angle rather than the range,
    // which is the half of the interpolation the range test cannot see.
    let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
    let mut field = SweepField::new_empty(
        "Reflectivity",
        "dBZ",
        0.5,
        azimuths.clone(),
        1.0,
        2.125,
        0.25,
        40,
    );
    for azimuth in 0..azimuths.len() {
        for gate in 0..40 {
            let value = if azimuth < 10 { 0.0 } else { 40.0 };
            field.set(azimuth, gate, value, GateStatus::Valid);
        }
    }
    let range = gate_centre_km(&field, 20);
    // Halfway between the last quiet radial and the first loud one.
    let smoothed =
        smoothed_gate(&field, Product::Reflectivity, 9.5, range).expect("a gate is there");
    assert!(
        smoothed.0 > 0.0 && smoothed.0 < 40.0,
        "expected a reading between the two radials, got {}",
        smoothed.0
    );
}

#[test]
fn smoothing_never_paints_where_the_radar_read_nothing() {
    let (mut field, coordinates) = stepped_field(Product::Reflectivity);
    // A hole the radar left, of the kind a beam blockage leaves.
    for azimuth in 0..field.azimuth_count() {
        for gate in 100..140 {
            field.set(azimuth, gate, 0.0, GateStatus::NoData);
        }
    }
    for gate in [100, 120, 139] {
        assert_eq!(
            smoothed_gate(
                &field,
                Product::Reflectivity,
                10.0,
                gate_centre_km(&field, gate)
            )
            .expect("inside the sweep")
            .1,
            GateStatus::NoData,
            "gate {gate} was read as something"
        );
    }

    // And nothing beside the hole borrowed a value from inside it: the
    // last gate before it reads exactly what its own neighbours average
    // to, with the missing side left out rather than counted as zero.
    let edge = smoothed_gate(
        &field,
        Product::Reflectivity,
        10.0,
        gate_centre_km(&field, 99),
    )
    .expect("inside the sweep");
    assert_eq!(edge.0, field.get(10, 99).0);

    // Which is what matters at the picture: the same pixels are painted
    // either way, so a hole stays a hole.
    let painted = |smooth: bool| {
        let (pixels, _) = render_sweep(
            &field,
            &coordinates,
            Product::Reflectivity,
            "dBZ",
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
            smooth,
        );
        pixels
            .chunks_exact(4)
            .map(|pixel| pixel[3] > 0)
            .collect::<Vec<_>>()
    };
    assert_eq!(painted(true), painted(false));
}

#[test]
fn a_range_folded_gate_is_not_averaged_into_the_weather_beside_it() {
    let (mut field, _) = stepped_field(Product::Velocity);
    for azimuth in 0..field.azimuth_count() {
        field.set(azimuth, 200, 0.0, GateStatus::RangeFolded);
    }
    let folded = smoothed_gate(&field, Product::Velocity, 10.0, gate_centre_km(&field, 200))
        .expect("inside the sweep");
    // It has no reading on the scale, so it keeps its own colour rather
    // than taking one from the gates either side.
    assert_eq!(folded.1, GateStatus::RangeFolded);
}

#[test]
fn velocity_keeps_the_sign_boundary_a_couplet_is_read_from() {
    // Inbound one side of a line, outbound the other, which is what a
    // rotation looks like to the radar.
    let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
    let mut field = SweepField::new_empty(
        "Velocity",
        "m/s",
        0.5,
        azimuths.clone(),
        1.0,
        2.125,
        0.25,
        40,
    );
    for azimuth in 0..azimuths.len() {
        for gate in 0..40 {
            let value = if azimuth < 90 { -25.0 } else { 25.0 };
            field.set(azimuth, gate, value, GateStatus::Valid);
        }
    }
    let range = gate_centre_km(&field, 20);
    for angle in [89.2f32, 89.5, 89.8, 90.2] {
        let smoothed =
            smoothed_gate(&field, Product::Velocity, angle, range).expect("inside the sweep");
        // Never a band of calm air down the middle of the couplet.
        assert!(
            smoothed.0.abs() == 25.0,
            "at {angle} degrees the boundary was smoothed to {}",
            smoothed.0
        );
    }
    // Reflectivity has no such boundary and is interpolated as usual.
    let mut reflectivity = field.clone();
    for azimuth in 0..azimuths.len() {
        for gate in 0..40 {
            let value = if azimuth < 90 { 0.0 } else { 40.0 };
            reflectivity.set(azimuth, gate, value, GateStatus::Valid);
        }
    }
    let across =
        smoothed_gate(&reflectivity, Product::Reflectivity, 89.5, range).expect("inside the sweep");
    assert!(across.0 > 0.0 && across.0 < 40.0);
}

#[test]
fn the_smoothed_picture_is_the_one_that_was_pinned() {
    // A golden image, held as the digest of its pixels. It fails on any
    // change to the interpolation, to the ramp it is drawn through, or to
    // the geometry underneath both.
    let (field, coordinates) = stepped_field(Product::Reflectivity);
    let (smoothed, _) = render_sweep(
        &field,
        &coordinates,
        Product::Reflectivity,
        "dBZ",
        Shading {
            unfolded: false,
            threshold: None,
            high_contrast: false,
        },
        true,
    );
    let (plain, _) = render_sweep(
        &field,
        &coordinates,
        Product::Reflectivity,
        "dBZ",
        Shading {
            unfolded: false,
            threshold: None,
            high_contrast: false,
        },
        false,
    );
    // It is a different picture from the unsmoothed one, or the switch
    // does nothing.
    assert_ne!(smoothed, plain);
    // And it has more colours in it than the stepped one, which is what
    // smoothing means.
    let colours = |pixels: &[u8]| {
        pixels
            .chunks_exact(4)
            .filter(|pixel| pixel[3] > 0)
            .map(|pixel| [pixel[0], pixel[1], pixel[2]])
            .collect::<std::collections::HashSet<_>>()
            .len()
    };
    assert!(
        colours(&smoothed) > colours(&plain),
        "smoothed {} colours against {}",
        colours(&smoothed),
        colours(&plain)
    );

    let digest = <sha2::Sha256 as sha2::Digest>::digest(&smoothed);
    assert_eq!(
        format!("{digest:x}"),
        SMOOTHED_SWEEP_DIGEST,
        "the smoothed sweep changed"
    );
}

#[test]
fn the_threshold_reaches_the_picture_that_is_drawn() {
    // gate_color is tested on its own, but nothing proved the value the
    // reader set ever arrived there: passing None from render_sweep, or
    // from the command below it, left every test green.
    let drawn = |value: f32, floor: Option<f32>| {
        let (field, coordinates) = flat_field(value, Product::Reflectivity);
        let (pixels, _) = render_sweep(
            &field,
            &coordinates,
            Product::Reflectivity,
            "dBZ",
            Shading {
                unfolded: false,
                threshold: floor,
                high_contrast: false,
            },
            false,
        );
        pixels.chunks_exact(4).filter(|p| p[3] > 0).count()
    };

    let whole = drawn(40.0, None);
    assert!(whole > 0, "the fixture has to draw something");
    assert_eq!(drawn(40.0, Some(35.0)), whole, "40 dBZ is over 35");
    assert_eq!(drawn(40.0, Some(45.0)), 0, "40 dBZ is under 45");

    // And it can only hide. Under the ramp's own floor nothing comes back.
    assert_eq!(drawn(FADE_FLOOR_DBZ - 5.0, Some(-100.0)), 0);
}

/// A gate the reader has asked to hide leaves the map showing through, and
/// one exactly at the threshold is kept.
#[test]
fn a_threshold_hides_what_is_under_it_and_keeps_what_is_on_it() {
    let draw = |value: f32, product: Product, floor: Option<f32>| {
        gate_color(
            &GateStatus::Valid,
            value,
            product,
            None,
            Some((0.0, 100.0)),
            Shading {
                unfolded: false,
                threshold: floor,
                high_contrast: false,
            },
        )
    };

    // Reflectivity reads low to high, so the comparison is on the value.
    assert!(draw(35.0, Product::Reflectivity, Some(35.0)).is_some());
    assert!(draw(34.9, Product::Reflectivity, Some(35.0)).is_none());
    // Without one, the product's own floor is the only thing hiding gates.
    assert!(draw(34.9, Product::Reflectivity, None).is_some());
    assert!(draw(FADE_FLOOR_DBZ - 1.0, Product::Reflectivity, None).is_none());

    // Velocity runs either side of zero and both sides are the storm, so a
    // threshold of 15 has to keep a 20 metre a second inbound gate. On the
    // signed value that gate reads -20 and would vanish.
    assert!(draw(-20.0, Product::Velocity, Some(15.0)).is_some());
    assert!(draw(20.0, Product::Velocity, Some(15.0)).is_some());
    assert!(draw(-9.0, Product::Velocity, Some(15.0)).is_none());
    assert!(draw(9.0, Product::Velocity, Some(15.0)).is_none());

    // A folded gate carries no reading on the scale, so a threshold has
    // nothing to compare and must not silently drop it.
    assert!(gate_color(
        &GateStatus::RangeFolded,
        0.0,
        Product::Velocity,
        None,
        None,
        Shading {
            unfolded: false,
            threshold: Some(60.0),
            high_contrast: false,
        },
    )
    .is_some());

    // And a gate the radar itself marked as nothing stays nothing.
    assert!(gate_color(
        &GateStatus::NoData,
        0.0,
        Product::Reflectivity,
        None,
        None,
        Shading {
            unfolded: false,
            threshold: None,
            high_contrast: false,
        },
    )
    .is_none());
}

/// A loaded table names a colour for folded gates. Drawing the built-in
/// purple instead puts a colour on screen that is on no legend the user
/// can see, in the one place the format was explicit about.
#[test]
fn a_folded_gate_takes_the_loaded_table_s_colour() {
    let named = table(Some("#77007d"));
    assert_eq!(
        gate_color(
            &GateStatus::RangeFolded,
            0.0,
            Product::Velocity,
            Some(&named),
            None,
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
        ),
        Some(([0x77, 0x00, 0x7d], MAX_ALPHA))
    );

    // A table that says nothing about folding keeps the built-in colour,
    // and so does having no table at all.
    let silent = table(None);
    assert_eq!(
        gate_color(
            &GateStatus::RangeFolded,
            0.0,
            Product::Velocity,
            Some(&silent),
            None,
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
        ),
        Some((RANGE_FOLDED, MAX_ALPHA))
    );
    assert_eq!(
        gate_color(
            &GateStatus::RangeFolded,
            0.0,
            Product::Velocity,
            None,
            None,
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
        ),
        Some((RANGE_FOLDED, MAX_ALPHA))
    );
}

#[test]
fn a_gate_under_the_table_s_floor_is_left_clear() {
    let named = table(None);
    assert_eq!(
        gate_color(
            &GateStatus::Valid,
            4.9,
            Product::Reflectivity,
            Some(&named),
            None,
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
        ),
        None,
        "a value below the lowest stop was painted the lowest stop's colour"
    );
    assert_eq!(
        gate_color(
            &GateStatus::Valid,
            5.0,
            Product::Reflectivity,
            Some(&named),
            None,
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
        ),
        Some(([0x04, 0xe9, 0xe7], MAX_ALPHA))
    );
    // Nothing is drawn where the radar saw nothing.
    assert_eq!(
        gate_color(
            &GateStatus::NoData,
            40.0,
            Product::Reflectivity,
            Some(&named),
            None,
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
        ),
        None
    );
    assert_eq!(
        gate_color(
            &GateStatus::BelowThreshold,
            40.0,
            Product::Reflectivity,
            None,
            None,
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
        ),
        None
    );
}

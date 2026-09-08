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
            None,
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
        None,
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
        None,
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
        crate::hex::lower(&digest),
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
            None,
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

#[test]
fn drawing_over_less_ground_spends_the_same_pixels_on_more_of_the_radar() {
    // The whole point of the box. The picture is one raster of a fixed size,
    // so a reader zoomed in on a couplet gets more than the 449 metres a pixel
    // the whole disc affords in exactly one way: the same pixels over less
    // ground. What comes back has to say which ground it was.
    let (field, coordinates) = stepped_field(Product::Reflectivity);
    let paint = |within: Option<[f64; 4]>| {
        render_sweep(
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
            within,
        )
    };

    let (whole, [west, south, east, north]) = paint(None);
    let wide = east - west;
    let tall = north - south;
    // A quarter of the disc, centred on it.
    let quarter = [
        west + wide * 0.375,
        south + tall * 0.375,
        west + wide * 0.625,
        south + tall * 0.625,
    ];
    let (closer, box_asked) = paint(Some(quarter));

    // The same number of pixels over a quarter of the width, which is four
    // times the ground per pixel in each direction.
    assert_eq!(whole.len(), closer.len());
    assert!(
        (box_asked[2] - box_asked[0] - wide * 0.25).abs() < 1e-9,
        "the box came back {} wide against the {} asked for",
        box_asked[2] - box_asked[0],
        wide * 0.25
    );
    assert!(box_asked[0] > west && box_asked[2] < east);

    // And it is a different picture, not the same one relabelled: a raster
    // over a quarter of the ground paints the middle of the sweep where the
    // whole-disc one paints its edge.
    assert_ne!(whole, closer);

    // A box that misses the disc entirely leaves the whole disc drawn, because
    // an empty picture is worse than a coarse one.
    let elsewhere = paint(Some([west - 10.0, south - 10.0, west - 9.0, south - 9.0]));
    assert_eq!(elsewhere.1, [west, south, east, north]);
    assert_eq!(elsewhere.0, whole);

    // And one larger than the disc is clipped to it rather than painting
    // pixels on ground the radar cannot see.
    let generous = paint(Some([west - 10.0, south - 10.0, east + 10.0, north + 10.0]));
    assert_eq!(generous.1, [west, south, east, north]);
}

#[test]
fn every_reading_of_where_a_gate_begins_agrees_with_the_one_that_reads_gates() {
    // Four places read `first_gate_range_km` and three of them read it as an
    // edge, which is half a gate out and invisible in a picture. The ICD is
    // not ambiguous: `data_moment_range` is the range to the *centre* of the
    // first gate. So gate `g` covers half an interval either side of
    // `first + g * interval`, and every reading below is held to that.
    let (field, _) = stepped_field(Product::Reflectivity);
    let first = field.first_gate_range_km();
    let interval = field.gate_interval_km();
    let half = interval / 2.0;
    let sliver = interval / 100.0;

    // Where a gate is. Written out rather than derived, so the helper cannot
    // define its own answer.
    for gate in [0usize, 1, 7, 150] {
        assert!(
            (gate_centre_km(&field, gate) - (first + gate as f64 * interval)).abs() < 1e-12,
            "gate {gate} is not centred where the ICD puts it"
        );
    }

    // Which gate a range falls in, held at both edges of three gates. A shift
    // of half an interval moves every boundary onto a centre, so each of these
    // pairs catches it from one side.
    for gate in [0usize, 49, 149] {
        let centre = gate_centre_km(&field, gate);
        for (range, expected, side) in [
            (centre - half + sliver, gate, "just inside its near edge"),
            (centre, gate, "at its own centre"),
            (centre + half - sliver, gate, "just inside its far edge"),
            (centre + half + sliver, gate + 1, "just past its far edge"),
        ] {
            assert_eq!(
                gate_covering(&field, range),
                Some(expected),
                "the range {side} of gate {gate} did not read gate {expected}"
            );
            assert_eq!(
                reading_at(&field, 10.0, range).map(|read| read.0),
                Some(field.get(10, expected).0),
                "the reading {side} of gate {gate} did not come from gate {expected}"
            );
        }
    }

    // The two readings are the same function, so they answer alike at every
    // range including the edges, where they used to differ: `round` goes half
    // away from zero in Rust, so a range at exactly the near edge of gate 0
    // came out as gate -1 and was refused by one of them and read by the
    // other.
    for range in [
        first - half,
        first - half + sliver,
        first,
        first + half,
        gate_centre_km(&field, 49) + half,
        last_gate_edge_km(&field) - sliver,
    ] {
        let covering = gate_covering(&field, range).map(|gate| field.get(10, gate).0);
        assert_eq!(
            covering,
            reading_at(&field, 10.0, range).map(|read| read.0),
            "the two readings of {range} km do not agree"
        );
    }

    // The sweep begins half an interval inside the first gate's centre, and
    // ends half an interval past the last one's. Both were a whole gate out
    // while the field's own numbers were taken as edges.
    assert_eq!(gate_covering(&field, first - half - sliver), None);
    assert_eq!(reading_at(&field, 10.0, first - half - sliver), None);
    let last = field.gate_count() - 1;
    assert!((last_gate_edge_km(&field) - (gate_centre_km(&field, last) + half)).abs() < 1e-12);
    assert_eq!(
        gate_covering(&field, last_gate_edge_km(&field) - sliver),
        Some(last)
    );
    assert_eq!(
        gate_covering(&field, last_gate_edge_km(&field) + sliver),
        None
    );

    // And the smoothing walks the same axis. At a centre there is nothing to
    // interpolate and the weight is all on that gate; at a boundary the two
    // neighbours share it evenly. Half an interval anywhere in that arithmetic
    // swaps the two, which is what these gates are chosen to show: the fixture
    // steps every fifty, so inside a step both readings are the same number.
    for gate in [49usize, 149] {
        let centre = gate_centre_km(&field, gate);
        let mine = field.get(10, gate).0;
        let next = field.get(10, gate + 1).0;
        assert_ne!(mine, next, "gate {gate} reads the same as the one past it");
        let at_centre = smoothed_gate(&field, Product::Reflectivity, 10.0, centre)
            .expect("inside the sweep")
            .0;
        assert!(
            (at_centre - mine).abs() < 1e-3,
            "smoothing at gate {gate}'s centre read {at_centre} rather than {mine}"
        );
        let between = smoothed_gate(&field, Product::Reflectivity, 10.0, centre + half)
            .expect("inside the sweep")
            .0;
        assert!(
            (between - (mine + next) / 2.0).abs() < 1e-3,
            "smoothing between gates {gate} and {} read {between} rather than the mean of              {mine} and {next}",
            gate + 1
        );
    }
}

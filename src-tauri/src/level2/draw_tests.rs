use chrono::TimeZone;

use super::*;
use crate::fixture;
use crate::level2::testing::*;

#[test]
#[ignore = "fetches a live volume from the NEXRAD archive"]
fn decodes_and_draws_a_live_kdmx_volume() {
    // Held, so two live tests do not wipe each other's cache. Under
    // `-- --ignored` these run together, and one clearing the cache while
    // another was reading it turned a real answer into a re-fetch or an
    // empty one, which reads as a service that failed rather than as a
    // test that raced.
    let _guard = decoded_cache_test();
    clear_cache();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    let started = std::time::Instant::now();
    let (key, data) = runtime
        .block_on(latest_volume("KDMX"))
        .expect("KDMX publishes a volume every few minutes");
    let fetched = started.elapsed();
    assert!(key.contains("KDMX"), "{key} should name the site");
    assert!(
        data.len() > 1_000_000,
        "a volume is megabytes, got {}",
        data.len()
    );

    let drawing = std::time::Instant::now();
    let sweep = sweep_from_volume(
        "KDMX",
        &key,
        data.clone(),
        SweepRequest {
            product_name: "reflectivity",
            ..SweepRequest::default()
        },
    )
    .expect("the lowest reflectivity tilt should decode");
    let drawn = drawing.elapsed();

    assert_eq!(sweep.station, "KDMX");
    assert_eq!(sweep.product_id, "reflectivity");
    assert_eq!(sweep.unit, "dBZ");
    // The lowest surveillance cut is half a degree.
    assert!(
        sweep.elevation_degrees < 1.0,
        "tilt 0 should be the lowest cut, got {}",
        sweep.elevation_degrees
    );
    assert!(sweep.tilts.len() >= 4, "a volume has several tilts");
    assert!(
        sweep.tilts.windows(2).all(|pair| pair[0] < pair[1]),
        "tilts should be ascending and unique: {:?}",
        sweep.tilts
    );
    // The same volume with a threshold on it. render_sweep is tested on
    // its own, but only asking through the command can say whether what
    // the reader set arrives there.
    let floored = sweep_from_volume(
        "KDMX",
        &key,
        data.clone(),
        SweepRequest {
            product_name: "reflectivity",
            threshold: Some(60.0),
            ..SweepRequest::default()
        },
    )
    .expect("the same tilt decodes with a threshold on it");
    assert!(
        floored.image.len() < sweep.image.len(),
        "sixty dBZ drew as much as no threshold at all: {} against {}",
        floored.image.len(),
        sweep.image.len()
    );

    assert!(sweep.image.starts_with("data:image/png;base64,"));
    // Well past an empty transparent square.
    assert!(
        sweep.image.len() > 20_000,
        "the drawing came out too small to hold radar: {} bytes",
        sweep.image.len()
    );

    // What was actually painted: a filled disc around the site, not a
    // square, not a scattering, and not the whole image.
    let site_object = registry::site_by_id("KDMX").expect("KDMX").to_site();
    let coordinates = RadarCoordinateSystem::new(&site_object);
    let field = {
        let file = volume::File::new(data.clone());
        let scan = file.scan().expect("the volume decodes");
        sweep_field(&scan, Product::Reflectivity, 0)
            .expect("a sweep")
            .field
    };
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
        false,
    );
    let painted = pixels.chunks_exact(4).filter(|p| p[3] > 0).count();
    let total = IMAGE_SIZE * IMAGE_SIZE;
    assert!(
        painted > total / 100,
        "only {painted} of {total} pixels were painted"
    );
    assert!(
        painted < total * 4 / 5,
        "{painted} of {total} pixels painted: a sweep is a disc, not a square"
    );
    // The corners sit outside the 230 km circle and must stay empty.
    for (row, column) in [(2, 2), (2, IMAGE_SIZE - 3), (IMAGE_SIZE - 3, 2)] {
        let at = (row * IMAGE_SIZE + column) * 4;
        assert_eq!(
            pixels[at + 3],
            0,
            "the corner at {row},{column} was painted"
        );
    }
    if let Ok(out) = std::env::var("OPENRADAR_SWEEP_DUMP") {
        std::fs::write(
            &out,
            base64::engine::general_purpose::STANDARD
                .decode(sweep.image.trim_start_matches("data:image/png;base64,"))
                .expect("the image decodes"),
        )
        .expect("the dump is written");
    }

    // The extent is the sweep's own circle around the site, not the world.
    let site = registry::site_by_id("KDMX").expect("KDMX is in the registry");
    assert!(sweep.west < site.longitude as f64 && sweep.east > site.longitude as f64);
    assert!(sweep.south < site.latitude as f64 && sweep.north > site.latitude as f64);
    assert!(
        (sweep.east - sweep.west) < 12.0,
        "230 km is not twelve degrees"
    );

    // Velocity comes off the same volume, so the second product is free.
    let velocity = sweep_from_volume(
        "KDMX",
        &key,
        data,
        SweepRequest {
            product_name: "velocity",
            tilt_index: 1,
            unfold: true,
            ..SweepRequest::default()
        },
    )
    .expect("a Doppler cut should decode");
    assert_eq!(velocity.product_id, "velocity");
    assert_eq!(velocity.unit, "m/s");
    assert!(velocity.elevation_degrees >= sweep.elevation_degrees);

    // The acceptance is a sweep on screen within five seconds.
    println!("fetch {fetched:?}, decode and draw {drawn:?}, {painted} pixels painted");
    assert!(
        fetched + drawn < std::time::Duration::from_secs(5),
        "fetch took {fetched:?} and drawing took {drawn:?}"
    );
}

#[test]
fn a_cut_whose_angle_has_drifted_is_still_the_same_cut() {
    // A sweep's angle is the median of what its radials measured, and the
    // pedestal does not put the antenna in the same place twice: across
    // consecutive real volumes KTLX moved a cut from 3.08 to 3.12 degrees.
    // Matched to a hundredth of a degree, about one cut in ten stopped
    // matching between the finished volume and the one in progress, and
    // the live sweep for that tilt went missing with no message.
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    let older = built_volume(&[
        fixture::flat_cut(
            at,
            fixture::Cut {
                degrees: 3.08,
                ..fixture::Cut::default()
            },
        ),
        fixture::flat_cut(
            at,
            fixture::Cut {
                number: 2,
                degrees: 4.30,
                reflectivity: fixture::Gate::Reading(35.0),
                ..fixture::Cut::default()
            },
        ),
    ]);
    // The same two cuts a volume later, each a quantisation step away.
    let live = built_volume(&[
        fixture::flat_cut(
            at,
            fixture::Cut {
                degrees: 3.12,
                reflectivity: fixture::Gate::Reading(50.0),
                ..fixture::Cut::default()
            },
        ),
        fixture::flat_cut(
            at,
            fixture::Cut {
                number: 2,
                degrees: 4.26,
                reflectivity: fixture::Gate::Reading(55.0),
                ..fixture::Cut::default()
            },
        ),
    ]);

    let asked = SweepRequest {
        product_name: "reflectivity",
        ..SweepRequest::default()
    };
    let none = |_: u8| None;
    for (tilt, degrees) in [(0usize, 3.12f32), (1, 4.26)] {
        let sweep = sweep_over(
            "KTLX",
            "live",
            &older,
            &none,
            &live,
            &none,
            (None, None),
            SweepRequest {
                tilt_index: tilt,
                ..asked
            },
        )
        .expect("both volumes hold the cut");
        assert!(
            sweep.live,
            "cut {tilt} drifted a quantisation step and lost its live sweep"
        );
        assert!((sweep.elevation_degrees - degrees).abs() < 0.01);
    }

    // And a cut a real tilt away is still a different cut.
    let far = built_volume(&[fixture::flat_cut(
        at,
        fixture::Cut {
            degrees: 4.30,
            ..fixture::Cut::default()
        },
    )]);
    let sweep = sweep_over(
        "KTLX",
        "live",
        &older,
        &none,
        &far,
        &none,
        (None, None),
        asked,
    )
    .expect("the finished volume answers");
    assert!(
        !sweep.live,
        "the live volume has nothing at 3.08 and must not offer its 4.30 cut"
    );
}

#[test]
fn persistence_off_draws_exactly_what_it_always_did() {
    // The picture is identical when the reader has not asked for the
    // phosphor one, proved against the synthetic volume rather than
    // asserted about a flag.
    let older_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 35, 0).unwrap();
    let live_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 41, 0).unwrap();
    let (older, live) = faded_pair(older_at, live_at);
    let none = |_: u8| None;
    let plain = SweepRequest {
        product_name: "reflectivity",
        ..SweepRequest::default()
    };
    let first = sweep_over(
        "KTLX",
        "live",
        &older,
        &none,
        &live,
        &none,
        (None, None),
        plain,
    )
    .expect("a composite");
    let again = sweep_over(
        "KTLX",
        "live",
        &older,
        &none,
        &live,
        &none,
        (None, None),
        plain,
    )
    .expect("a composite");
    assert_eq!(
        drawn_pixels(&first),
        drawn_pixels(&again),
        "the same request drew two different pictures"
    );
    // And the finished volume still shows through at full strength.
    let older_only =
        sweep_from_scan("KTLX", "older", &older, &none, plain).expect("the finished sweep");
    let untouched = drawn_pixels(&first)
        .chunks_exact(4)
        .zip(drawn_pixels(&older_only).chunks_exact(4))
        .filter(|(a, b)| a == b)
        .count();
    assert!(
        untouched > 0,
        "nothing of the finished volume survived the composite"
    );
}

#[test]
fn persistence_fades_the_older_sweep_and_moves_no_reading() {
    let older_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 35, 0).unwrap();
    let live_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 41, 0).unwrap();
    let (older, live) = faded_pair(older_at, live_at);
    let none = |_: u8| None;
    let plain = SweepRequest {
        product_name: "reflectivity",
        ..SweepRequest::default()
    };
    let faded = SweepRequest {
        persistence: true,
        // The bright edge is drawn over the composite and would be a
        // second difference; this test is about the fade.
        reduced_motion: true,
        ..plain
    };
    let before = drawn_pixels(
        &sweep_over(
            "KTLX",
            "live",
            &older,
            &none,
            &live,
            &none,
            (None, None),
            plain,
        )
        .expect("a composite"),
    );
    let after = drawn_pixels(
        &sweep_over(
            "KTLX",
            "live",
            &older,
            &none,
            &live,
            &none,
            (None, None),
            faded,
        )
        .expect("a composite"),
    );
    assert_eq!(before.len(), after.len());

    let mut dimmed = 0;
    let mut recoloured = 0;
    for (was, now) in before.chunks_exact(4).zip(after.chunks_exact(4)) {
        if was[3] == 0 && now[3] == 0 {
            continue;
        }
        // The one thing this is not allowed to do: move a reading towards
        // a different step on the ramp.
        if was[..3] != now[..3] {
            recoloured += 1;
        }
        if now[3] < was[3] {
            dimmed += 1;
        }
        assert!(now[3] <= was[3], "a pixel came out brighter than it was");
    }
    assert_eq!(recoloured, 0, "the fade changed a colour, not an opacity");
    assert!(dimmed > 0, "nothing was faded at all");

    // Six minutes is a whole volume behind, so the older sweep is at the
    // floor rather than gone.
    let keep = persistence_keep((live_at - older_at).num_seconds() as f32);
    assert!((keep - PERSISTENCE_FLOOR).abs() < 0.01, "keep was {keep}");
}

#[test]
fn the_beam_edge_is_drawn_only_when_something_is_moving() {
    let older_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 35, 0).unwrap();
    let live_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 41, 0).unwrap();
    let (older, live) = faded_pair(older_at, live_at);
    let none = |_: u8| None;
    let still = SweepRequest {
        product_name: "reflectivity",
        persistence: true,
        reduced_motion: true,
        ..SweepRequest::default()
    };
    let moving = SweepRequest {
        reduced_motion: false,
        ..still
    };
    let quiet = drawn_pixels(
        &sweep_over(
            "KTLX",
            "live",
            &older,
            &none,
            &live,
            &none,
            (None, None),
            still,
        )
        .expect("a composite"),
    );
    let lit = drawn_pixels(
        &sweep_over(
            "KTLX",
            "live",
            &older,
            &none,
            &live,
            &none,
            (None, None),
            moving,
        )
        .expect("a composite"),
    );
    assert_ne!(quiet, lit, "the beam edge was drawn either way");
    // Reduced motion keeps the composite: it is the edge that goes, not
    // the picture.
    let different = quiet
        .chunks_exact(4)
        .zip(lit.chunks_exact(4))
        .filter(|(a, b)| a != b)
        .count();
    let all = quiet.len() / 4;
    assert!(
        different * 20 < all,
        "the edge covered {different} of {all} pixels, which is a picture rather than an edge"
    );
}

#[test]
fn a_sweep_with_two_ages_reports_both_of_them() {
    let older_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 35, 0).unwrap();
    let live_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 41, 0).unwrap();
    let (older, live) = faded_pair(older_at, live_at);
    let none = |_: u8| None;
    let asked = SweepRequest {
        product_name: "reflectivity",
        ..SweepRequest::default()
    };
    let sweep = sweep_over(
        "KTLX",
        "live",
        &older,
        &none,
        &live,
        &none,
        (None, None),
        asked,
    )
    .expect("a composite");
    // A composite whose age is reported from its newer half is a picture
    // claiming to be fresher than it is.
    let beneath = sweep
        .beneath_collected
        .as_deref()
        .expect("two sweeps on screen means two times");
    assert!(beneath.starts_with("2026-08-30T23:35"), "{beneath}");
    assert!(sweep.collected.starts_with("2026-08-30T23:41"));

    // And one sweep on its own reports one time.
    let alone = sweep_from_scan("KTLX", "older", &older, &none, asked).expect("a finished sweep");
    assert!(alone.beneath_collected.is_none());
}

#[test]
fn the_fade_runs_from_full_to_a_floor_and_stops() {
    assert_eq!(persistence_keep(0.0), 1.0);
    assert_eq!(persistence_keep(-5.0), 1.0, "a negative age is no age");
    assert_eq!(persistence_keep(f32::NAN), 1.0);
    assert!(persistence_keep(180.0) < 1.0);
    assert!(persistence_keep(180.0) > PERSISTENCE_FLOOR);
    assert!((persistence_keep(PERSISTENCE_FULL_SECS) - PERSISTENCE_FLOOR).abs() < 1e-6);
    // A sweep that fades to nothing has taken the context away rather
    // than aged it.
    assert!((persistence_keep(86_400.0) - PERSISTENCE_FLOOR).abs() < 1e-6);
}

#[test]
fn a_gate_comes_back_with_the_sweep_that_read_it() {
    // The reader clicks a point on a composite. Inside the sector the
    // radar has reached, the answer is the live cut and the live time;
    // outside it, the finished cut and the older time. A number off a
    // composite dated by the wrong half of it is a number nobody can
    // check.
    let older_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 35, 0).unwrap();
    let live_at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 41, 0).unwrap();
    let (older, live) = faded_pair(older_at, live_at);
    let none = |_: u8| None;
    let asked = SweepRequest {
        product_name: "reflectivity",
        ..SweepRequest::default()
    };
    let site = registry::site_by_id("KTLX").expect("a known site");
    let coordinates = RadarCoordinateSystem::new(&site.to_site());
    let beneath = prepare_sweep("KTLX", &older, &none, asked, Some(0.5)).expect("the finished cut");
    let newer = prepare_sweep("KTLX", &live, &none, asked, Some(0.5)).expect("the cut in progress");

    // Thirty kilometres out, north-east and south-west of the site. The
    // live cut covers the first quadrant only.
    let site_point = site.to_site();
    let north_east = (
        site_point.latitude() as f64 + 0.19,
        site_point.longitude() as f64 + 0.25,
    );
    let south_west = (
        site_point.latitude() as f64 - 0.19,
        site_point.longitude() as f64 - 0.25,
    );

    let inside = gate_at(
        &newer,
        &coordinates,
        north_east.0,
        north_east.1,
        Some(live_at),
        true,
    )
    .expect("the live cut covers the north-east");
    assert_eq!(inside.value, 50.0);
    assert_eq!(inside.unit, "dBZ");
    assert!(inside.live);
    assert!(inside.collected.starts_with("2026-08-30T23:41"));

    // The live cut has nothing to say about the south-west, so a reader
    // clicking there is answered by the volume underneath and told so.
    assert!(
        gate_at(
            &newer,
            &coordinates,
            south_west.0,
            south_west.1,
            Some(live_at),
            true,
        )
        .is_none(),
        "the cut in progress answered for a quadrant it has not swept"
    );
    let under = gate_at(
        &beneath,
        &coordinates,
        south_west.0,
        south_west.1,
        Some(older_at),
        false,
    )
    .expect("the finished cut covers the whole disc");
    assert_eq!(under.value, 20.0);
    assert!(!under.live);
    assert!(under.collected.starts_with("2026-08-30T23:35"));

    // And nothing at all beyond the radar's reach.
    assert!(
        gate_at(&beneath, &coordinates, 0.0, 0.0, Some(older_at), false).is_none(),
        "a point off the disc came back with a reading"
    );
}

#[test]
fn the_swept_sector_is_drawn_over_the_volume_before_it() {
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    // The finished volume reads 20 dBZ everywhere. The volume in progress
    // has reached the north-east quarter only, and reads 50 there.
    let older = built_volume(&[fixture::flat_cut(at, fixture::Cut::default())]);
    let live = built_volume(&[sector(0.0, 90.0, fixture::Gate::Reading(50.0), at)]);

    let asked = SweepRequest {
        product_name: "reflectivity",
        ..SweepRequest::default()
    };
    let none = |_: u8| None;
    let sweep = sweep_over(
        "KTLX",
        "live",
        &older,
        &none,
        &live,
        &none,
        (None, None),
        asked,
    )
    .expect("a sweep drawn over the one before it");
    assert!(sweep.live, "a sweep with live radials in it has to say so");

    let both = drawn_pixels(&sweep);
    let older_only =
        sweep_from_scan("KTLX", "older", &older, &none, asked).expect("the finished sweep");
    let older_pixels = drawn_pixels(&older_only);
    let live_only =
        sweep_from_scan("KTLX", "live", &live, &none, asked).expect("the sweep in progress");
    let live_pixels = drawn_pixels(&live_only);

    // The whole of the swept quarter, not a sample of it. Sampling three
    // bearings hid a picture striped with the volume underneath: each
    // radial was being given a wedge narrower than the gap to the next
    // one, so 29 per cent of the sector kept the old sweep, and all three
    // samples happened to land on a radial.
    let mut new_sweep = 0usize;
    let mut old_sweep = 0usize;
    let mut neither = 0usize;
    for tenth in 0..900 {
        let bearing = tenth as f64 / 10.0;
        let here = pixel_at(&sweep, &both, bearing, 30.0);
        if here == pixel_at(&live_only, &live_pixels, bearing, 30.0) {
            new_sweep += 1;
        } else if here == pixel_at(&older_only, &older_pixels, bearing, 30.0) {
            old_sweep += 1;
        } else {
            neither += 1;
        }
    }
    assert_eq!(
            (old_sweep, neither),
            (0, 0),
            "{new_sweep} of 900 bearings across the swept quarter took the new              sweep, {old_sweep} kept the old one and {neither} took neither"
        );

    // Inside the swept quarter the new reading shows; outside it the old
    // one does. Both are checked at the same distance, so the only thing
    // that differs is the bearing.
    for bearing in [15.0, 45.0, 75.0] {
        assert_eq!(
            pixel_at(&sweep, &both, bearing, 30.0),
            pixel_at(&live_only, &live_pixels, bearing, 30.0),
            "at {bearing} degrees the swept sector should be the new reading"
        );
    }
    for bearing in [135.0, 200.0, 300.0] {
        assert_eq!(
            pixel_at(&sweep, &both, bearing, 30.0),
            pixel_at(&older_only, &older_pixels, bearing, 30.0),
            "at {bearing} degrees the volume before should still be showing"
        );
        assert_ne!(
            pixel_at(&sweep, &both, bearing, 30.0),
            pixel_at(&live_only, &live_pixels, bearing, 30.0),
            "at {bearing} degrees the radar has not swept yet"
        );
    }
    // And the two readings do have to look different, or none of the above
    // would be measuring anything.
    assert_ne!(
        pixel_at(&live_only, &live_pixels, 45.0, 30.0),
        pixel_at(&older_only, &older_pixels, 45.0, 30.0)
    );
}

#[test]
fn a_storm_that_has_moved_on_comes_off_the_swept_sector() {
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    // A core in the finished volume, and a volume in progress that has
    // swept the same quarter and found nothing there.
    let older = built_volume(&[fixture::flat_cut(
        at,
        fixture::Cut {
            reflectivity: fixture::Gate::Reading(55.0),
            ..fixture::Cut::default()
        },
    )]);
    let live = built_volume(&[sector(0.0, 90.0, fixture::Gate::Nothing, at)]);

    let asked = SweepRequest {
        product_name: "reflectivity",
        ..SweepRequest::default()
    };
    let none = |_: u8| None;
    let sweep = sweep_over(
        "KTLX",
        "live",
        &older,
        &none,
        &live,
        &none,
        (None, None),
        asked,
    )
    .expect("a sweep drawn over the one before it");
    let pixels = drawn_pixels(&sweep);

    // Nothing below the lowest ramp stop is drawn at all, so the swept
    // quarter has to come back clear rather than keeping the old core.
    assert_eq!(
        pixel_at(&sweep, &pixels, 45.0, 30.0)[3],
        0,
        "the swept sector kept a storm the radar has just looked at and not found"
    );
    assert_ne!(
        pixel_at(&sweep, &pixels, 200.0, 30.0)[3],
        0,
        "outside the swept sector the volume before it is still the picture"
    );
}

#[test]
fn a_cut_the_live_volume_has_not_reached_falls_back_to_the_finished_one() {
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    let older = built_volume(&[
        fixture::flat_cut(at, fixture::Cut::default()),
        fixture::flat_cut(
            at,
            fixture::Cut {
                number: 2,
                degrees: 1.5,
                reflectivity: fixture::Gate::Reading(35.0),
                ..fixture::Cut::default()
            },
        ),
    ]);
    // The radar is still on the lowest cut of the volume in progress.
    let live = built_volume(&[sector(0.0, 90.0, fixture::Gate::Reading(50.0), at)]);

    let asked = SweepRequest {
        product_name: "reflectivity",
        tilt_index: 1,
        ..SweepRequest::default()
    };
    let none = |_: u8| None;
    let sweep = sweep_over(
        "KTLX",
        "live",
        &older,
        &none,
        &live,
        &none,
        (None, None),
        asked,
    )
    .expect("the finished volume's second cut");
    assert!(
        !sweep.live,
        "nothing on screen came from the volume in progress, so it must not claim to be live"
    );
    assert_eq!(sweep.live_tilts, 0);
    assert!((sweep.elevation_degrees - 1.5).abs() < 0.05);
    // The picker offers the finished volume's cuts, not the one-cut list
    // the volume in progress happens to hold right now.
    assert_eq!(sweep.tilts.len(), 2);
}

#[test]
fn the_tilt_asked_for_is_matched_by_angle_across_the_two_volumes() {
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    let older = built_volume(&[
        fixture::flat_cut(at, fixture::Cut::default()),
        fixture::flat_cut(
            at,
            fixture::Cut {
                number: 2,
                degrees: 1.5,
                reflectivity: fixture::Gate::Reading(35.0),
                ..fixture::Cut::default()
            },
        ),
    ]);
    // The volume in progress has reached the second cut but not the first,
    // which is what SAILS does: its list starts at 1.5, so counting into
    // it would put the reader on the wrong cut without saying so.
    let live = built_volume(&[fixture::flat_cut(
        at,
        fixture::Cut {
            number: 2,
            degrees: 1.5,
            reflectivity: fixture::Gate::Reading(50.0),
            ..fixture::Cut::default()
        },
    )]);

    let asked = SweepRequest {
        product_name: "reflectivity",
        tilt_index: 1,
        ..SweepRequest::default()
    };
    let none = |_: u8| None;
    let sweep = sweep_over(
        "KTLX",
        "live",
        &older,
        &none,
        &live,
        &none,
        (None, None),
        asked,
    )
    .expect("the cut both volumes hold");
    assert!(sweep.live);
    assert!(
        (sweep.elevation_degrees - 1.5).abs() < 0.05,
        "the live volume's only cut is at 1.5 and that is the one asked for"
    );

    // Asking for the lowest cut, which the volume in progress has not got,
    // has to fall back rather than serve its 1.5 cut as if it were 0.5.
    let lowest = SweepRequest {
        tilt_index: 0,
        ..asked
    };
    let sweep = sweep_over(
        "KTLX",
        "live",
        &older,
        &none,
        &live,
        &none,
        (None, None),
        lowest,
    )
    .expect("the finished volume's lowest cut");
    assert!(!sweep.live);
    assert!((sweep.elevation_degrees - 0.5).abs() < 0.05);
}

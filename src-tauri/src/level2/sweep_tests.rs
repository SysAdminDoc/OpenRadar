use chrono::TimeZone;

use super::*;
use crate::fixture;
use crate::level2::testing::*;

#[test]
fn the_wind_is_read_from_across_the_whole_sweep() {
    // The search walks every gate. A version that stopped after the first
    // twelve rings it could fit never got past the innermost fifth, so a
    // squall line eighty kilometres out was invisible to it and the wind
    // came back as nothing at all.
    let truth = wind_from(225.0, 20.0);
    let field = sweep_in_a_wind(truth, 0.5, 80.0, 140.0);
    let read = fitted_wind(&field).expect("a wind from where the echo is");
    assert!((read.speed() - 20.0).abs() < 1.0, "{}", read.speed());
    assert!(
        (read.coming_from_degrees() - 225.0).abs() < 5.0,
        "{}",
        read.coming_from_degrees()
    );
}

#[test]
fn the_flow_the_storm_is_in_outvotes_the_layer_at_each_end() {
    // Three winds stacked the way a real sounding stacks them: a light
    // surface layer, the flow the storm is actually moving in, and
    // something else again above it. The middle one is the answer.
    //
    // A search that stops after twelve rings never leaves the surface
    // layer and returns the four metres a second, which is what it did on
    // a live volume. One with no preferred band takes the median across
    // all three and lands between them, pointing nowhere in particular.
    let surface = wind_from(180.0, 4.0);
    let flow = wind_from(225.0, 20.0);
    let aloft = wind_from(45.0, 20.0);
    let field = layered_sweep(
        &[
            (0.0, 60.0, surface),
            (60.0, WIND_FAR_KM, flow),
            (WIND_FAR_KM, 300.0, aloft),
        ],
        0.5,
    );
    let read = fitted_wind(&field).expect("a wind");
    assert!(
        (read.speed() - 20.0).abs() < 2.0,
        "read {} m/s, wanted the flow at 20",
        read.speed()
    );
    let apart = (read.coming_from_degrees() - 225.0).abs();
    assert!(
        apart.min(360.0 - apart) < 10.0,
        "read from {}, wanted 225",
        read.coming_from_degrees()
    );
}

#[test]
fn a_sweep_the_radar_read_cleanly_is_left_as_it_gave_it() {
    // Unfolding writes back only when enough of the sweep moved. Below
    // that bar it used to write anyway and report the sweep as not
    // unfolded, which drew gates outside the limit on the narrow scale.
    let (mut field, _) = flat_field(3.0, Product::Velocity);
    let before: Vec<f32> = (0..field.azimuth_count())
        .flat_map(|azimuth| (0..field.gate_count()).map(move |gate| (azimuth, gate)))
        .map(|(azimuth, gate)| field.get(azimuth, gate).0)
        .collect();

    // Every reading is well inside the folding limit, so there is nothing
    // to unfold and nothing should be written.
    let moved = unfold_velocity(&mut field, 30.0);
    assert!(!moved, "a sweep with no folds in it was called unfolded");

    let after: Vec<f32> = (0..field.azimuth_count())
        .flat_map(|azimuth| (0..field.gate_count()).map(move |gate| (azimuth, gate)))
        .map(|(azimuth, gate)| field.get(azimuth, gate).0)
        .collect();
    assert_eq!(before, after, "the field was written to anyway");
}

#[test]
fn a_ring_in_the_ground_clutter_is_not_asked_what_the_wind_is() {
    // The near edge exists because the first few kilometres of any sweep
    // are buildings and terrain sitting still. A median over enough rings
    // resists a minority, so whether they are excluded cannot be seen from
    // the fitted wind alone: it is a fact about which rings are chosen.
    let ground = wind_from(0.0, 0.2);
    let flow = wind_from(225.0, 20.0);
    // Twenty kilometres and a hundred and fifty are written out rather
    // than read from the constants, so moving a constant cannot quietly
    // move the fixture with it and leave the test passing.
    let found: Vec<(f64, vad::Wind)> = (0..40)
        .map(|at| {
            let range = 2.0 + at as f64 * 5.0;
            (range, if range < 20.0 { ground } else { flow })
        })
        .collect();
    assert!(
        found.iter().any(|(range, _)| *range < 20.0),
        "the fixture has to hold some clutter to exclude"
    );

    let chosen = rings_that_speak_for_the_sweep(&found);
    assert!(
        !chosen.contains(&ground),
        "a ring from inside twenty kilometres was asked what the wind is"
    );
    // And nothing from outside the band at either end: above the far edge
    // the beam is over the weather rather than in it.
    assert_eq!(
        chosen.len(),
        found
            .iter()
            .filter(|(range, _)| *range >= 20.0 && *range <= 150.0)
            .count()
    );
}

#[test]
fn a_band_with_almost_nothing_in_it_hands_back_the_whole_sweep() {
    // Two rings of clutter inside the band and thirty of weather outside
    // it. Trusting the band because it held anything at all handed the
    // answer to the two.
    let ground = wind_from(0.0, 0.2);
    let flow = wind_from(225.0, 20.0);
    let mut found: Vec<(f64, vad::Wind)> = vec![(22.0, ground), (27.0, ground)];
    for at in 0..30 {
        found.push((160.0 + at as f64 * 4.0, flow));
    }
    assert_eq!(rings_that_speak_for_the_sweep(&found).len(), found.len());

    // With the band properly filled it speaks for the sweep on its own.
    let full: Vec<(f64, vad::Wind)> = (0..30).map(|at| (25.0 + at as f64 * 4.0, flow)).collect();
    assert_eq!(rings_that_speak_for_the_sweep(&full).len(), full.len());
}

#[test]
fn a_handful_of_rings_in_the_band_cannot_outvote_the_rest_of_the_sweep() {
    // Ground clutter out to thirty kilometres, sitting still, and the only
    // weather in a line from a hundred and sixty out. Two rings fall in
    // the preferred band and thirty do not. Preferring the band whenever
    // it held anything at all handed the answer to the clutter and came
    // back with no wind, which the caller cannot tell from a light one.
    let still = vad::Wind {
        east: 0.0,
        north: 0.0,
    };
    let flow = wind_from(225.0, 20.0);
    let field = layered_sweep(&[(0.0, 30.0, still), (160.0, 280.0, flow)], 0.5);
    let read = fitted_wind(&field).expect("a wind");
    assert!(
        (read.speed() - 20.0).abs() < 2.0,
        "the clutter took the sweep with it: {} m/s from {}",
        read.speed(),
        read.coming_from_degrees()
    );
}

#[test]
fn the_clutter_close_in_is_outvoted_when_the_band_is_full() {
    // The other half of the band: with returns right across the sweep, the
    // rings inside twenty kilometres are ground rather than wind and must
    // not be counted. Moving the near edge to zero lets them in.
    let still = vad::Wind {
        east: 0.2,
        north: 0.0,
    };
    let flow = wind_from(225.0, 20.0);
    // Enough clutter to swing a median that included it: sixteen rings of
    // ground against twenty-four of weather.
    let field = layered_sweep(
        &[
            (0.0, WIND_NEAR_KM, still),
            (WIND_NEAR_KM, 130.0, flow),
            (130.0, 300.0, still),
        ],
        0.5,
    );
    let read = fitted_wind(&field).expect("a wind");
    assert!(
        (read.speed() - 20.0).abs() < 2.0,
        "read {} m/s, wanted the flow at 20",
        read.speed()
    );
}

#[test]
fn a_sweep_whose_echo_is_all_close_in_still_gives_a_wind() {
    // The case the search was changed for. Everything within thirty
    // kilometres means nothing at all in the preferred band, and picking
    // rings by position returned no wind rather than the one available.
    let truth = vad::Wind {
        east: 0.0,
        north: -18.0,
    };
    let field = sweep_in_a_wind(truth, 0.5, 3.0, 18.0);
    let read = fitted_wind(&field).expect("a wind from what there is");
    assert!((read.speed() - 18.0).abs() < 1.0, "{}", read.speed());
    assert!(
        (read.coming_from_degrees() - 0.0).abs() < 5.0
            || (read.coming_from_degrees() - 360.0).abs() < 5.0,
        "{}",
        read.coming_from_degrees()
    );
}

#[test]
fn a_sweep_with_nothing_in_it_has_no_wind_rather_than_a_made_up_one() {
    let field = sweep_in_a_wind(
        vad::Wind {
            east: 10.0,
            north: 0.0,
        },
        0.5,
        // A band outside the sweep, so every gate stays as no data.
        9000.0,
        9001.0,
    );
    assert!(fitted_wind(&field).is_none());
}

#[test]
#[ignore = "fetches a live volume from the NEXRAD archive"]
fn the_wind_read_off_a_live_sweep_is_a_wind() {
    // Held, so two live tests do not wipe each other's cache. Under
    // `-- --ignored` these run together, and one clearing the cache while
    // another was reading it turned a real answer into a re-fetch or an
    // empty one, which reads as a service that failed rather than as a
    // test that raced.
    let _guard = decoded_cache_test();
    // The fit has to hold up on real returns, not only on a ring drawn from
    // the formula it inverts. There is no truth to compare against out of
    // the archive, so what is checked is that the answer is a wind a
    // forecaster would recognise, and that taking it out is what storm
    // relative velocity means: the ambient flow goes to about nothing while
    // anything rotating keeps its own signature.
    clear_cache();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");
    let (_key, data) = runtime
        .block_on(latest_volume("KDMX"))
        .expect("KDMX publishes a volume every few minutes");

    let file = volume::File::new(data);
    let scan = file.scan().expect("the volume should decode");
    let mut chosen =
        sweep_field(&scan, Product::Velocity, 1).expect("a volume carries a Doppler cut");
    if let Some(nyquist) = nyquist_velocity(&file, chosen.elevation_number) {
        unfold_velocity(&mut chosen.field, nyquist);
    }

    let wind = fitted_wind(&chosen.field).expect("a sweep with returns has a wind in it");
    println!(
        "wind {:.1} m/s from {:.0} degrees",
        wind.speed(),
        wind.coming_from_degrees()
    );
    assert!(
        wind.speed() < 60.0,
        "{} m/s is not a wind, it is a fit that ran away",
        wind.speed()
    );
    assert!((0.0..360.0).contains(&wind.coming_from_degrees()));

    // Taking it out has to leave the sweep centred on nothing: that is the
    // whole point, and a sign error would leave it centred on twice the
    // wind instead.
    let mean = |field: &SweepField| {
        let mut total = 0.0f64;
        let mut count = 0usize;
        for azimuth in 0..field.azimuth_count() {
            for gate in 0..field.gate_count() {
                let (value, status) = field.get(azimuth, gate);
                if matches!(status, GateStatus::Valid) {
                    total += value as f64;
                    count += 1;
                }
            }
        }
        if count == 0 {
            0.0
        } else {
            total / count as f64
        }
    };

    let before = mean(&chosen.field);
    make_storm_relative(&mut chosen.field, wind);
    let after = mean(&chosen.field);
    println!("mean radial velocity {before:.2} -> {after:.2} m/s");
    assert!(
            after.abs() <= before.abs() + 0.5,
            "taking the wind out moved the sweep further from still air,              {before:.2} to {after:.2}"
        );
}

/// The chunk path and the archive path have to agree about one volume.
///
/// A folder in the chunks ring keeps its volume for a while after the radar
/// moves on, and the archive object for that same volume lands a minute or
/// so after it closes. In that window both are readable, so the two paths
/// can be put side by side over exactly the same sweep of the sky rather
/// than over two volumes five minutes apart.
#[test]
#[ignore = "downloads one volume twice, from the chunks bucket and the archive"]
fn the_chunk_sweep_and_the_archive_sweep_agree_about_one_volume() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    let mut compared = 0;
    let mut why: Vec<String> = Vec::new();
    for station in ["KTLX", "KDMX", "KJAX", "KTBW", "KGRR"] {
        let Ok((newest, _)) = runtime.block_on(chunks::newest_volume(station, None)) else {
            why.push(format!("{station}: nothing in the chunks ring"));
            continue;
        };
        let Ok((key, data)) = runtime.block_on(latest_volume(station)) else {
            why.push(format!("{station}: no archive volume"));
            continue;
        };
        let file = volume::File::new(data);
        let Ok(archive) = file.scan() else {
            why.push(format!("{station}: the archive volume would not decode"));
            continue;
        };
        let Some((archive_start, _)) = archive.time_range() else {
            why.push(format!("{station}: the archive volume carries no time"));
            continue;
        };

        // Walk back through the finished folders for the one holding the
        // volume the archive just published. Which folder that is depends
        // on how long the object took to land, so it is found by time.
        let mut folder = chunks::previous(newest);
        let mut same = None;
        for _ in 0..4 {
            if let Ok(found) = runtime.block_on(chunks::scan_in_folder(station, folder)) {
                if let Some((start, _)) = found.scan.time_range() {
                    if (start - archive_start).num_seconds().abs() <= 30 {
                        same = Some(found);
                        break;
                    }
                }
            }
            folder = chunks::previous(folder);
        }
        let Some(found) = same else {
            why.push(format!(
                "{station}: no folder held the archive volume from {archive_start}"
            ));
            continue;
        };

        let from_chunks = sweep_field(&found.scan, Product::Reflectivity, 0)
            .expect("the lowest cut, assembled from chunks");
        let from_archive = sweep_field(&archive, Product::Reflectivity, 0)
            .expect("the lowest cut, out of the archive");

        assert_eq!(
            from_chunks.elevation_number, from_archive.elevation_number,
            "{station} put the lowest cut at a different elevation number"
        );
        assert!(
            (from_chunks.elevation_degrees - from_archive.elevation_degrees).abs() < 0.05,
            "{station}: {} against {}",
            from_chunks.elevation_degrees,
            from_archive.elevation_degrees
        );
        assert_eq!(
            from_chunks.field.gate_count(),
            from_archive.field.gate_count(),
            "{station} disagreed about how many gates the cut has"
        );
        assert!(
            (from_chunks.field.gate_interval_km() - from_archive.field.gate_interval_km()).abs()
                < 1e-6,
            "{station} disagreed about how far apart the gates are"
        );

        // The readings are the same radar's, so they have to be the same
        // numbers. Anything else means the chunk path is misreading the
        // bytes rather than showing a slightly different moment.
        let mut checked = 0usize;
        let mut apart = 0usize;
        for azimuth in 0..from_chunks.field.azimuth_count() {
            let angle = from_chunks.field.azimuths()[azimuth];
            for gate in (0..from_chunks.field.gate_count()).step_by(7) {
                let range = from_chunks.field.first_gate_range_km()
                    + gate as f64 * from_chunks.field.gate_interval_km();
                let (mine, my_status) = from_chunks.field.get(azimuth, gate);
                let Some((theirs, their_status)) = from_archive.field.value_at_polar(angle, range)
                else {
                    continue;
                };
                if my_status != GateStatus::Valid || their_status != GateStatus::Valid {
                    continue;
                }
                checked += 1;
                if (mine - theirs).abs() > 0.6 {
                    apart += 1;
                }
            }
        }
        assert!(
            checked > 1000,
            "{station}: only {checked} gates were valid in both, which is too few to judge"
        );
        let share = apart as f64 / checked as f64;
        println!(
            "{station}: volume {} against {key}, {checked} gates compared, {apart} apart",
            found.volume.volume
        );
        assert!(
            share < 0.02,
            "{station}: {apart} of {checked} gates disagreed, which is the chunk path \
                 reading the bytes differently rather than the weather moving"
        );
        compared += 1;
        break;
    }

    assert!(
        compared > 0,
        "no site could be compared, which after five tries is the paths moving \
             rather than the weather being quiet: {}",
        why.join("; ")
    );
}

#[test]
fn what_the_fixture_declares_is_what_it_writes() {
    // The drawing reads the header to decide how wide a wedge each radial
    // stands for, and reads the reserved counts to know the radar looked
    // and found nothing. A fixture that got either wrong would have tests
    // passing against a picture nobody would accept: declaring half a
    // degree while writing whole ones left 29 per cent of a swept sector
    // showing the volume underneath, with the tests green.
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    for (radials, spacing) in [(360u16, 1.0f32), (720, 0.5)] {
        let scan = built_volume(&[fixture::flat_cut(
            at,
            fixture::Cut {
                radials,
                gates: 8,
                ..fixture::Cut::default()
            },
        )]);
        let field = sweep_field(&scan, Product::Reflectivity, 0)
            .expect("the cut decodes")
            .field;
        assert_eq!(
            field.azimuth_spacing_degrees(),
            spacing,
            "{radials} radials are {spacing} degrees apart"
        );
        assert_eq!(field.azimuth_count(), radials as usize);
    }

    // And the two reserved counts, which no test could reach before.
    let mut cut = fixture::flat_cut(
        at,
        fixture::Cut {
            radials: 360,
            gates: 4,
            ..fixture::Cut::default()
        },
    );
    cut[0].reflectivity[1] = fixture::Gate::Nothing;
    cut[0].reflectivity[2] = fixture::Gate::RangeFolded;
    let scan = built_volume(&[cut]);
    let field = sweep_field(&scan, Product::Reflectivity, 0)
        .expect("the cut decodes")
        .field;
    assert_eq!(field.get(0, 0).1, GateStatus::Valid);
    assert_eq!(
        field.get(0, 1).1,
        GateStatus::BelowThreshold,
        "the radar looked there and found nothing"
    );
    assert_eq!(field.get(0, 2).1, GateStatus::RangeFolded);
}

#[test]
fn a_sweep_that_was_changed_never_reports_itself_unchanged() {
    // What the answer is for is the legend and the scale: the reader is
    // being told whether what they are looking at is the radar's own
    // reading. Answering that by hunting for a value past the limit, with
    // slack for the arithmetic, left a hole exactly one interval wide: a
    // gate the radar reported at 24.8 with a limit of 25 comes back at
    // 25.2 once its fold is out, which the slack swallowed, so eighteen
    // hundred rewritten gates were reported as no change and drawn on the
    // narrow scale.
    let nyquist = 25.0f32;
    let azimuths: Vec<f32> = (0..180).map(|step| step as f32 * 2.0).collect();
    let gates = 20usize;
    let mut field =
        SweepField::new_empty("Velocity", "m/s", 0.5, azimuths, 2.0, 2.125, 0.25, gates);
    // Half the sweep just under the limit one way, half just under it the
    // other. The step between them is a whole interval, so it is a fold.
    for azimuth in 0..180 {
        for gate in 0..gates {
            let value = if azimuth < 90 { 24.8 } else { -24.8 };
            field.set(azimuth, gate, value, GateStatus::Valid);
        }
    }
    let before: Vec<f32> = field.values().to_vec();

    let answered = unfold_velocity(&mut field, nyquist);
    let changed = field
        .values()
        .iter()
        .zip(&before)
        .filter(|(now, was)| (**now - **was).abs() > 0.01)
        .count();
    assert!(
        changed > 0,
        "the sweep has to be changed for this to measure"
    );
    assert!(
        answered,
        "{changed} gates were rewritten and the sweep reported itself untouched"
    );
}

#[test]
fn a_sweep_with_nothing_to_unfold_is_left_alone_and_says_so() {
    // The other side of the same answer. A calm sweep must not be reported
    // as unfolded, or the legend claims a change that was not made and the
    // picture is drawn on a scale twice as wide as it needs.
    let nyquist = 25.0f32;
    let azimuths: Vec<f32> = (0..180).map(|step| step as f32 * 2.0).collect();
    let gates = 20usize;
    let mut field =
        SweepField::new_empty("Velocity", "m/s", 0.5, azimuths, 2.0, 2.125, 0.25, gates);
    for azimuth in 0..180 {
        for gate in 0..gates {
            field.set(azimuth, gate, 3.0, GateStatus::Valid);
        }
    }
    let before: Vec<f32> = field.values().to_vec();
    assert!(!unfold_velocity(&mut field, nyquist));
    assert_eq!(field.values(), before.as_slice());
}

#[test]
fn a_fold_over_one_corner_of_a_sweep_is_still_taken_out() {
    // A sweep folded in one place is folded, and the one place is where the
    // storm is. An earlier version threw the whole correction away unless
    // half a per cent of the gates had moved, so on a real KDMX cut folded
    // at 21 m/s all 410 wrapped gates stayed wrapped and the legend
    // reported the picture as the radar's own reading.
    let nyquist = 25.0f32;
    let interval = 2.0 * nyquist;
    let azimuths: Vec<f32> = (0..360).map(|step| step as f32).collect();
    let gates = 200usize;
    let mut field =
        SweepField::new_empty("Velocity", "m/s", 0.5, azimuths, 1.0, 2.125, 0.25, gates);

    // Still air, with one smooth hill of outbound wind in it that just
    // tops the radar's limit. Smooth is the point: a fold is a step of a
    // whole interval between two gates that are otherwise the same air,
    // and a hill planted as a cliff would be a real wind shift rather than
    // a fold, which is not something any dealiaser can or should undo.
    let peak = 28.0f32;
    let (from_azimuth, to_azimuth) = (40usize, 90usize);
    let (from_gate, to_gate) = (40usize, 140usize);
    let mut truth = vec![0.0f32; 360 * gates];
    for azimuth in from_azimuth..to_azimuth {
        let across = (azimuth - from_azimuth) as f32 / (to_azimuth - from_azimuth) as f32;
        for gate in from_gate..to_gate {
            let along = (gate - from_gate) as f32 / (to_gate - from_gate) as f32;
            let hill = (across * std::f32::consts::PI).sin() * (along * std::f32::consts::PI).sin();
            truth[azimuth * gates + gate] = peak * hill;
        }
    }

    let mut wrapped = 0usize;
    for azimuth in 0..360 {
        for gate in 0..gates {
            let value = truth[azimuth * gates + gate];
            let folded = value - interval * ((value + nyquist) / interval).floor();
            if (folded - value).abs() > 0.001 {
                wrapped += 1;
            }
            field.set(azimuth, gate, folded, GateStatus::Valid);
        }
    }
    assert!(
        wrapped > 50,
        "only {wrapped} gates folded, which is nothing to measure"
    );
    let share = wrapped as f32 / (360 * gates) as f32;
    assert!(
        share < 0.005,
        "the fold has to be small enough that a share test would drop it, not {share}"
    );

    assert!(
        unfold_velocity(&mut field, nyquist),
        "a sweep with {wrapped} folded gates in it is a folded sweep"
    );

    let mut back = 0usize;
    let mut adrift = 0usize;
    for azimuth in 0..360 {
        for gate in 0..gates {
            let now = field.get(azimuth, gate).0;
            let was = truth[azimuth * gates + gate];
            if (now - was).abs() < 0.01 {
                back += 1;
            } else {
                adrift += 1;
            }
        }
    }
    assert_eq!(
        adrift, 0,
        "{adrift} gates did not come back to the wind that was planted, {back} did"
    );
}

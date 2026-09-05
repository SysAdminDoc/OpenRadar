use super::*;
use crate::level2::testing::*;

/// The two cuts hold different readings, so the picture has to hold two
/// colours: one ramp value everywhere would mean the sampling collapsed.
#[test]
fn the_two_cuts_are_drawn_in_their_own_colours() {
    let _guard = decoded_cache_test();
    clear_cache();
    let (_, key, data) = two_cut_volume();
    let east = |km: f64| (-93.723 + km / KM_PER_DEGREE_EAST, 41.731);
    let section = cross_section_from_volume(
        "KDMX",
        &key,
        data,
        SectionRequest {
            product_name: "reflectivity",
            from: east(20.0),
            to: east(90.0),
            unfold: false,
            threshold: None,
            high_contrast: false,
        },
    )
    .expect("a slice");
    let (width, height, pixels) = decode_png(&section.image);
    let colour_at = |column: usize, row: usize| {
        let at = (row * width as usize + column) * 4;
        [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]]
    };
    let row_for = |km: f64| {
        (((1.0 - km / cross_section::TOP_KM) * height as f64) as usize).min(height as usize - 1)
    };
    let column = width as usize - 1;
    let low = colour_at(column, row_for(1.3));
    let high = colour_at(column, row_for(6.0));
    assert_ne!(low, high, "35 and 55 dBZ came out the same colour");
    // And they are the ramp's own colours for those readings.
    assert_eq!(&low[..3], ramp_color(REFLECTIVITY_RAMP, 35.0));
    assert_eq!(&high[..3], ramp_color(REFLECTIVITY_RAMP, 55.0));
}

#[test]
fn the_reflectivity_ramp_matches_the_legend_it_is_drawn_beside() {
    // The stops the legend gradient is built from, exactly.
    assert_eq!(ramp_color(REFLECTIVITY_RAMP, 5.0), [0x04, 0xe9, 0xe7]);
    assert_eq!(ramp_color(REFLECTIVITY_RAMP, 50.0), [0xfd, 0x00, 0x00]);
    assert_eq!(ramp_color(REFLECTIVITY_RAMP, 75.0), [0xfd, 0xfd, 0xfd]);
    // Between stops it interpolates rather than stepping.
    let midway = ramp_color(REFLECTIVITY_RAMP, 52.5);
    assert!(midway[0] > 0xd4 && midway[0] < 0xfd);
    // Past either end it holds the end colour instead of wrapping.
    assert_eq!(ramp_color(REFLECTIVITY_RAMP, -20.0), [0x04, 0xe9, 0xe7]);
    assert_eq!(ramp_color(REFLECTIVITY_RAMP, 200.0), [0xfd, 0xfd, 0xfd]);
}

#[test]
fn velocity_reads_green_toward_the_radar_and_red_away_from_it() {
    let inbound = ramp_color(VELOCITY_RAMP, -30.0);
    let outbound = ramp_color(VELOCITY_RAMP, 30.0);
    assert!(inbound[1] > inbound[0], "inbound should be green");
    assert!(outbound[0] > outbound[1], "outbound should be red");
}

#[test]
fn weak_returns_fade_in_and_strong_ones_arrive_solid() {
    assert_eq!(reflectivity_alpha(5.0), MIN_ALPHA);
    assert_eq!(reflectivity_alpha(20.0), MAX_ALPHA);
    assert_eq!(reflectivity_alpha(60.0), MAX_ALPHA);
    // Nothing in between is more solid than what is stronger than it.
    let mut previous = 0u8;
    for step in 0..=30 {
        let alpha = reflectivity_alpha(5.0 + step as f32);
        assert!(
            alpha >= previous,
            "alpha fell at {step} dBZ above the floor"
        );
        previous = alpha;
    }
}

#[test]
fn mercator_round_trips_the_latitudes_a_sweep_covers() {
    for latitude in [-60.0, -1.0, 0.0, 27.5, 41.7, 64.0] {
        let back = inverse_mercator_y(mercator_y(latitude));
        assert!(
            (back - latitude).abs() < 1e-9,
            "{latitude} came back as {back}"
        );
    }
}

#[test]
fn only_the_products_the_panel_offers_are_accepted() {
    assert!(product_from_name("reflectivity").is_some());
    assert!(product_from_name("velocity").is_some());
    assert!(product_from_name("../../etc/passwd").is_none());
    assert!(product_from_name("").is_none());
}

use super::*;
use crate::level2::testing::*;

#[test]
fn a_cross_section_puts_each_cut_at_its_own_height() {
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
    .expect("a slice through the volume");

    assert_eq!(section.station, "KDMX");
    assert_eq!(section.product, "Reflectivity");
    assert_eq!(section.unit, "dBZ");
    assert_eq!(section.tilts, vec![0.5, 3.5]);
    assert_eq!(section.lowest_cut, Some(0.5));
    assert_eq!(section.highest_cut, Some(3.5));
    assert!(
        (section.distance_km - 70.0).abs() < 1.0,
        "{} km apart",
        section.distance_km
    );
    assert_eq!(section.top_km, cross_section::TOP_KM);
    assert!(!section.collected.is_empty());

    let (width, height, pixels) = decode_png(&section.image);
    assert_eq!(
        (width as usize, height as usize),
        (section.width, section.height)
    );
    let alpha_at = |column: usize, row: usize| pixels[(row * width as usize + column) * 4 + 3];
    let row_for = |km: f64| {
        (((1.0 - km / cross_section::TOP_KM) * height as f64) as usize).min(height as usize - 1)
    };

    // The far end of the line is ninety kilometres out, where half a degree
    // is about 1.3 km up and three and a half is nearer 6.
    let column = width as usize - 1;
    assert!(
        alpha_at(column, row_for(1.3)) > 0,
        "the low cut drew nothing"
    );
    assert!(
        alpha_at(column, row_for(6.0)) > 0,
        "the high cut drew nothing"
    );
    // Between the two beams the radar looked at nothing, and above them
    // there is no cut at all. Both stay clear.
    assert_eq!(alpha_at(column, row_for(3.5)), 0, "a gap was filled in");
    for column in 0..width as usize {
        assert_eq!(alpha_at(column, 0), 0, "something was drawn at 18 km");
    }
}

#[test]
fn a_threshold_empties_the_weaker_cut() {
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
            threshold: Some(45.0),
            high_contrast: false,
        },
    )
    .expect("a slice");
    let (width, height, pixels) = decode_png(&section.image);
    let alpha_at = |column: usize, row: usize| pixels[(row * width as usize + column) * 4 + 3];
    let row_for = |km: f64| {
        (((1.0 - km / cross_section::TOP_KM) * height as f64) as usize).min(height as usize - 1)
    };
    let column = width as usize - 1;
    // Thirty-five is under the floor and gone; fifty-five is over it and
    // still there.
    assert_eq!(alpha_at(column, row_for(1.3)), 0);
    assert!(alpha_at(column, row_for(6.0)) > 0);
}

/// A line with an end the radar cannot see is refused rather than drawn
/// half empty, which would read as a storm stopping where it does not.
#[test]
fn a_line_out_of_range_is_refused() {
    let _guard = decoded_cache_test();
    clear_cache();
    let (_, key, data) = two_cut_volume();
    let east = |km: f64| (-93.723 + km / KM_PER_DEGREE_EAST, 41.731);
    let refused = cross_section_from_volume(
        "KDMX",
        &key,
        data,
        SectionRequest {
            product_name: "reflectivity",
            from: east(20.0),
            to: east(400.0),
            unfold: false,
            threshold: None,
            high_contrast: false,
        },
    );
    assert!(matches!(refused, Err(Level2Error::OutOfRange(site)) if site == "KDMX"));
}

#[test]
fn a_velocity_slice_reports_whether_it_was_unfolded() {
    let _guard = decoded_cache_test();
    clear_cache();
    let (_, key, data) = two_cut_volume();
    let east = |km: f64| (-93.723 + km / KM_PER_DEGREE_EAST, 41.731);
    // The fixture folds at eight metres a second and every gate reads six,
    // which is inside the limit, so there is nothing to unfold and the
    // slice must not claim there was.
    let section = cross_section_from_volume(
        "KDMX",
        &key,
        data,
        SectionRequest {
            product_name: "velocity",
            from: east(20.0),
            to: east(90.0),
            unfold: true,
            threshold: None,
            high_contrast: false,
        },
    )
    .expect("a velocity slice");
    assert_eq!(section.unit, "m/s");
    assert!(!section.dealiased);
    assert_eq!(section.lowest_cut, Some(0.5));
}

use super::*;
use crate::mrms::testing::*;

#[test]
fn unpacks_samples_into_the_values_they_stand_for() {
    let grid = grid();
    assert_eq!(grid.value(0, 0), 0.0);
    assert_eq!(grid.value(0, 1), 25.0);
    assert_eq!(grid.value(1, 0), 50.0);
    // Zero is the missing marker, far below anything drawn.
    assert_eq!(grid.value(1, 1), -999.0);
}

#[test]
fn finds_the_cell_a_point_falls_in_and_says_when_there_is_none() {
    let grid = grid();
    assert_eq!(grid.locate(41.0, -94.0), Some((0, 0)));
    assert_eq!(grid.locate(40.5, -93.5), Some((1, 1)));
    // Outside the grid in every direction.
    assert_eq!(grid.locate(45.0, -94.0), None);
    assert_eq!(grid.locate(41.0, -100.0), None);
    assert_eq!(grid.locate(30.0, -94.0), None);
    assert_eq!(grid.locate(41.0, -60.0), None);
}

/// Reading between the cells, and where it refuses to.
#[test]
fn a_reading_between_cells_is_between_the_readings_around_it() {
    let grid = ramp_grid(4, 4, 0.01);
    // Dead on a centre it is that cell, whatever the interpolation does.
    assert_eq!(grid.between(40.1, -94.0), Some(grid.value(0, 0)));
    assert_eq!(grid.between(40.09, -93.99), Some(grid.value(1, 1)));

    // Halfway between two centres it is halfway between two readings,
    // and it lies between them rather than outside: bicubic would
    // overshoot here and put a value on the map stronger than anything
    // the network measured.
    let west = grid.value(0, 0);
    let east = grid.value(0, 1);
    let middle = grid.between(40.1, -93.995).expect("a reading between");
    assert!((middle - (west + east) / 2.0).abs() < 1e-3);
    assert!(middle > west.min(east) && middle < west.max(east));

    // Off the grid entirely is nothing, not the nearest edge cell
    // stretched out over the ocean.
    assert_eq!(grid.between(40.1, -90.0), None);
    assert_eq!(grid.between(30.0, -94.0), None);
}

/// The one thing it must never do.
#[test]
fn nothing_is_read_across_a_cell_the_network_could_not_see() {
    let mut grid = ramp_grid(4, 4, 0.01);
    // What MRMS packs no coverage as: the smallest sample there is,
    // which decodes to the reference value.
    grid.reference = -9990.0;
    grid.decimal = 1;
    // The ramp counts from zero, and a packed zero IS the sentinel, so the
    // cell that is meant to hold a reading is given one.
    grid.samples[0] = 500;
    grid.samples[1] = 0;

    assert_eq!(grid.reading(0, 1), None, "no coverage read as a reading");
    assert!(grid.reading(0, 0).is_some());
    // A point between the two is refused rather than feathered out into
    // ground nothing looked at. The caller falls back to the nearest
    // cell, so the edge of coverage stays where it is.
    assert_eq!(grid.between(40.1, -93.995), None);

    // And where the smallest sample is a genuine zero rather than a
    // sentinel, as an accumulation grid's is, it is a measurement and
    // reading towards it is right.
    let mut rain = ramp_grid(4, 4, 0.01);
    rain.reference = 0.0;
    rain.samples[0] = 500;
    rain.samples[1] = 0;
    assert_eq!(rain.reading(0, 1), Some(0.0));
    assert!(rain.between(40.1, -93.995).is_some());
}

/// Which products it is honest on.
#[test]
fn only_the_fields_that_cover_the_country_are_read_between() {
    // A categorical grid names what is falling: halfway between snow and
    // hail is a number nobody has defined, and `category_color` would
    // refuse it and leave a hole along every boundary.
    let categorical = product_by_id("precip-type").expect("a categorical product");
    assert!(!smooths(categorical));

    // The scattered ones are single cells rather than a field, and
    // reading between them spreads a hail core over ground the network
    // never put one on.
    for id in ["rotation", "az-shear-low", "posh"] {
        let entry = product_by_id(id).expect(id);
        assert!(
            !smooths(entry),
            "{id} is scattered and must not be smoothed"
        );
    }

    // The fields that cover the country are the point of the exercise.
    for id in ["composite", "precip-rate"] {
        let entry = product_by_id(id).expect(id);
        assert!(smooths(entry), "{id} covers the country and should smooth");
    }
}

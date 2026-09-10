use super::*;

use crate::mrms::testing::countable_grid;

/// A grid whose cells hold a stated value, at a stated cell size, so a
/// distance in miles can be turned into a cell count by hand.
///
/// One tenth of a degree a cell, which is about seven miles of latitude, and
/// a reference low enough that the packing carries a no-coverage sentinel the
/// way a real reflectivity grid does.
fn planted(values: &[(usize, usize, f32)], rows: usize, columns: usize) -> Grid {
    // value = (reference + sample) / 10, so a sample of 9990 reads as zero
    // and the sample zero is the sentinel `absent` looks for. Everything is
    // the sentinel until something is planted in it: a grid of real zeroes
    // would be a network reporting no hail everywhere, which is a different
    // fixture and a much weaker one.
    let mut samples = vec![0u16; rows * columns];
    for (row, column, value) in values {
        samples[row * columns + column] = (9990.0 + value * 10.0) as u16;
    }
    Grid {
        columns,
        rows,
        north: 42.0,
        west: -94.0,
        d_lat: 0.1,
        d_lon: 0.1,
        reference: -9990.0,
        binary: 0,
        decimal: 1,
        samples,
    }
}

/// The place the tests watch: the middle of the planted grid.
const LAT: f64 = 41.5;
const LON: f64 = -93.5;

/// The rule is about the neighbourhood, not the one cell overhead.
#[test]
fn the_strongest_cell_in_the_circle_is_the_answer() {
    // Row 5 column 5 is the place itself. Row 3 column 5 is two cells north,
    // which is about fourteen miles.
    let grid = planted(&[(5, 5, 20.0), (3, 5, 55.0)], 11, 11);
    let (value, miles) = peak_within(&grid, LAT, LON, 20.0).expect("a reading");
    assert!((value - 55.0).abs() < 0.01, "{value}");
    assert!((13.0..15.5).contains(&miles), "{miles} miles");

    // Inside a tighter circle the far cell is out of reach and the one
    // overhead is the answer, which is what says the radius is doing work.
    let (near, _) = peak_within(&grid, LAT, LON, 5.0).expect("a reading");
    assert!((near - 20.0).abs() < 0.01, "{near}");
}

/// A cell just outside the radius is outside it, not rounded in.
#[test]
fn the_circle_has_an_edge_and_it_is_a_circle() {
    // Four cells east, about twenty miles at this latitude.
    let grid = planted(&[(5, 9, 70.0)], 11, 11);
    let east = 4.0 * 0.1 * 69.0546 * LAT.to_radians().cos();
    assert!((20.0..22.0).contains(&east), "{east} miles east");

    assert!(peak_within(&grid, LAT, LON, east - 1.0).is_none());
    let (value, _) = peak_within(&grid, LAT, LON, east + 1.0).expect("a reading");
    assert!((value - 70.0).abs() < 0.01, "{value}");

    // And a cell on the diagonal at the same cell count is further away, so
    // a square box would have caught it and a circle does not. This is the
    // difference between "within ten miles" and "in a twenty mile box".
    let corner = planted(&[(1, 9, 70.0)], 11, 11);
    assert!(peak_within(&corner, LAT, LON, east + 1.0).is_none());
}

/// Ground the network could not see is not ground with no hail on it.
#[test]
fn a_cell_with_no_coverage_is_not_a_reading_of_nothing() {
    // Every cell is the sentinel except one, which is negative: if no
    // coverage were read as its own value the answer would be that, and it
    // would be the largest thing in the circle.
    let grid = planted(&[(5, 5, -5.0)], 11, 11);
    let (value, _) = peak_within(&grid, LAT, LON, 20.0).expect("a reading");
    assert!((value - -5.0).abs() < 0.01, "{value}");

    // With nothing planted at all there is no answer, rather than a reading
    // of the reference value.
    let empty = planted(&[], 11, 11);
    assert!(peak_within(&empty, LAT, LON, 20.0).is_none());
}

/// A place the grid does not reach has no answer at all.
#[test]
fn a_place_off_the_grid_is_not_a_quiet_one() {
    let grid = countable_grid();
    // The grid runs from 40 north and 100 west, a degree a cell, five by
    // four. A place in the Atlantic is nowhere near it.
    assert!(peak_within(&grid, 41.0, -60.0, 25.0).is_none());
    assert!(peak_within(&grid, -30.0, -98.0, 25.0).is_none());
    // And a place inside it does have one.
    assert!(peak_within(&grid, 39.0, -98.0, 60.0).is_some());
}

/// Nothing a caller can put in the radius makes this walk the country.
#[test]
fn the_radius_is_bounded_however_it_is_asked_for() {
    let grid = countable_grid();
    // A radius of a thousand miles is clamped, and a negative one reads as
    // nothing rather than as the whole grid.
    assert!(peak_within(&grid, 39.0, -98.0, 1e9).is_some());
    assert!(peak_within(&grid, 39.0, -98.0, -10.0).is_none());
    assert!(peak_within(&grid, f64::NAN, -98.0, 25.0).is_none());
    assert!(peak_within(&grid, 39.0, f64::INFINITY, 25.0).is_none());
}

/// The circle is measured on the sphere, not across a flat patch.
///
/// Both numbers below are worked out by hand from the haversine and from the
/// flat form this used to carry, so the assertion fails if the flat form
/// comes back rather than merely restating whatever the function returns.
#[test]
fn the_distance_is_measured_on_the_sphere() {
    // Two degrees of longitude at forty-nine north, which is the top of the
    // CONUS grid: 90.66 miles on the sphere and 90.61 flat.
    let near = miles_between(49.0, -100.0, 49.0, -98.0);
    assert!((near - 90.656).abs() < 0.02, "{near} miles");

    // And a span the command will take but the panel never offers, where the
    // flat form is twenty-six miles out: 1170.28 against 1196.06.
    let far = miles_between(30.0, -100.0, 45.0, -90.0);
    assert!((far - 1170.276).abs() < 0.5, "{far} miles");
}

use super::*;

use chrono::TimeZone;

/// The file the office published for the 24 hours to 12Z on 2026-09-09, kept
/// whole rather than trimmed: it is 214 KB, it is the shape this module reads,
/// and a fixture written by hand would only prove this module agrees with
/// itself about a format neither of them owns.
const ANALYSIS: &[u8] = include_bytes!("../tests/fixtures/sfav2_CONUS_24h_2026090912.tif");

#[test]
fn reads_the_grid_the_office_published() {
    let read = read(ANALYSIS).expect("a published analysis");
    // 1500 by 850 cells of four hundredths of a degree, which is the country
    // from 126 west to 66 west and 21 north to 55 north.
    assert_eq!((read.width, read.height), (1500, 850));
    assert_eq!(read.inches.len(), 1500 * 850);
    let [west, south, east, north] = read.extent;
    assert!((west - -126.0).abs() < 1e-9, "{west}");
    assert!((north - 55.0).abs() < 1e-9, "{north}");
    assert!((east - -66.0).abs() < 1e-6, "{east}");
    assert!((south - 21.0).abs() < 1e-6, "{south}");
}

/// The one thing about this file that would ruin the picture.
#[test]
fn the_offices_own_no_data_never_reaches_the_grid_as_a_depth() {
    let read = read(ANALYSIS).expect("a published analysis");
    // Minus ninety-nine thousand inches is eight thousand feet of snow, and on
    // a ramp that clamps it draws as the deepest colour there is over every
    // ocean on the map. Nothing in the grid may be negative at all: the
    // analysis has no answer or it has a depth.
    for (at, value) in read.inches.iter().enumerate() {
        assert!(
            value.is_nan() || *value >= 0.0,
            "cell {at} came back as {value}"
        );
    }
    // And it is genuinely mostly no-data in September, which is what says the
    // conversion happened rather than that the file had none in it.
    let silent = read.inches.iter().filter(|value| value.is_nan()).count();
    assert!(
        silent > read.inches.len() / 4,
        "only {silent} of {} cells were silent, so the no-data was not found",
        read.inches.len()
    );
}

#[test]
fn a_window_is_named_the_way_the_file_names_it() {
    for (window, name, hours) in [
        (Window::Day, "24h", 24),
        (Window::TwoDay, "48h", 48),
        (Window::ThreeDay, "72h", 72),
    ] {
        assert_eq!(window.name(), name);
        assert_eq!(window.hours(), hours);
        assert_eq!(Window::from_name(name), Some(window));
    }
    // Anything else is not a window, which is what keeps a name off the path
    // a request is built from.
    assert_eq!(Window::from_name("1h"), None);
    assert_eq!(Window::from_name("../../etc/passwd"), None);
    assert_eq!(Window::from_name(""), None);
}

#[test]
fn something_that_is_not_a_raster_is_refused_rather_than_fatal() {
    assert!(read(b"this is not a GeoTIFF").is_err());
    assert!(read(&[]).is_err());
    // A truncated one, which is what a half-finished download looks like.
    assert!(read(&ANALYSIS[..ANALYSIS.len() / 3]).is_err());
}

/// The address is built out of the window this module owns, not out of a name
/// a caller handed it.
#[test]
fn the_address_names_the_window_and_the_hour() {
    let valid = Utc
        .with_ymd_and_hms(2026, 9, 9, 12, 0, 0)
        .single()
        .expect("a time");
    assert_eq!(
        url(Window::Day, valid),
        "https://www.nohrsc.noaa.gov/snowfall_v2/data/202609/sfav2_CONUS_24h_2026090912.tif"
    );
    assert_eq!(
        url(Window::ThreeDay, valid),
        "https://www.nohrsc.noaa.gov/snowfall_v2/data/202609/sfav2_CONUS_72h_2026090912.tif"
    );
}

/// The office publishes at 00Z and 12Z and takes a while, so the newest one is
/// tried first and the walk back is what finds the one that exists.
#[test]
fn the_analyses_tried_are_the_two_a_day_walking_back() {
    let now = Utc
        .with_ymd_and_hms(2026, 9, 10, 7, 43, 12)
        .single()
        .expect("a time");
    let times = recent(now);
    assert_eq!(times.len(), 6);
    // Quarter to eight in the morning UTC: the midnight analysis is the newest
    // that could exist, and the noon one before it is twelve hours back.
    assert_eq!(
        times[0],
        Utc.with_ymd_and_hms(2026, 9, 10, 0, 0, 0).unwrap()
    );
    assert_eq!(
        times[1],
        Utc.with_ymd_and_hms(2026, 9, 9, 12, 0, 0).unwrap()
    );
    assert_eq!(
        times[5],
        Utc.with_ymd_and_hms(2026, 9, 7, 12, 0, 0).unwrap()
    );
    // And in the afternoon the noon one is the newest.
    let afternoon = Utc
        .with_ymd_and_hms(2026, 9, 10, 18, 5, 0)
        .single()
        .expect("a time");
    assert_eq!(
        recent(afternoon)[0],
        Utc.with_ymd_and_hms(2026, 9, 10, 12, 0, 0).unwrap()
    );
}

/// Bare ground is not a dusting, and the sea is not bare ground.
#[test]
fn nothing_is_drawn_where_nothing_fell() {
    let read = read(ANALYSIS).expect("a published analysis");
    let picture = paint(&read, false).expect("a picture");
    assert_eq!(picture.pixels.len(), picture.width * picture.height * 4);
    assert_eq!(picture.width, read.width);
    // Row by row of the picture, against the row of the grid that row was
    // sampled from. The two are not the same row, which is the point of the
    // test below this one.
    for row in 0..picture.height {
        let lat = source_latitude(&read, &picture, row);
        let source = grid_row(&read, lat) * read.width;
        for column in 0..read.width {
            let depth = read.inches[source + column];
            let alpha = picture.pixels[(row * picture.width + column) * 4 + 3];
            if !depth.is_finite() || depth < TRACE_INCHES {
                assert_eq!(alpha, 0, "row {row} column {column} at {depth} was drawn");
            } else {
                assert!(
                    alpha > 0,
                    "row {row} column {column} at {depth} was not drawn"
                );
            }
        }
    }
}

/// The latitude the middle of one picture row sits at.
fn source_latitude(analysis: &Analysis, picture: &Picture, row: usize) -> f64 {
    let [_, south, _, north] = analysis.extent;
    let top = mercator(north);
    let bottom = mercator(south);
    from_mercator(top - (row as f64 + 0.5) / picture.height as f64 * (top - bottom))
}

/// Which row of the grid a latitude falls in, counting from the north edge.
fn grid_row(analysis: &Analysis, lat: f64) -> usize {
    let [_, south, _, north] = analysis.extent;
    (((north - lat) / (north - south) * analysis.height as f64).floor() as usize)
        .min(analysis.height - 1)
}

/// A grid whose rows are a fixed number of degrees apart, with snow in one.
fn one_row(at: usize) -> Analysis {
    let (width, height) = (4, 850);
    let mut inches = vec![f32::NAN; width * height];
    for column in 0..width {
        inches[at * width + column] = 6.0;
    }
    Analysis {
        width,
        height,
        inches,
        extent: [-126.0, 21.0, -66.0, 55.0],
    }
}

/// The one thing about this picture that would put the snow in another state.
///
/// The grid is four hundredths of a degree per row. The map draws a pinned
/// picture by stretching it linearly between four Mercator corners, so a
/// picture handed over in the grid's own rows lands north of where it fell,
/// by two degrees in the middle of the country. That is Denver's snow drawn
/// over Cheyenne, and nothing about the picture looks wrong while it happens.
#[test]
fn a_row_is_drawn_at_the_latitude_it_was_measured_at() {
    // The grid row holding 40 degrees north, which is (55 - 40) / 0.04.
    let planted = 375;
    let analysis = one_row(planted);
    let picture = paint(&analysis, false).expect("a picture");

    // The number of rows, written down rather than read off the picture.
    //
    // Between 21 and 55 north the Mercator span is ln(tan(72.5 deg)) minus
    // ln(tan(55.5 deg)), which is 0.779236, and 34 degrees is 0.593412
    // radians. 0.779236 / 0.593412 * 850 rows is 1116. Without this the
    // height formula is held by nothing: the helpers below read `height` off
    // the answer, so any monotone pair of functions would move both sides
    // together and stay green.
    assert_eq!(picture.height, 1116);
    assert!(picture.height > analysis.height);

    // And a handful of latitudes worked out by hand, against the row each
    // one lands in. Latitude 45 has a Mercator y of 0.881374, so it sits
    // (1.154332 - 0.881374) / 0.779236 = 0.350171 of the way down, which is
    // row 390 of 1116. Spaced in degrees it would be row 328. The three
    // together are spread over the picture, because the error a wrong
    // projection makes is smallest in the middle and largest at the edges.
    for (lat, row, flat) in [(45.0, 390usize, 328), (30.0, 866, 820), (52.0, 126, 98)] {
        let found = (0..picture.height)
            .find(|row| source_latitude(&analysis, &picture, *row) <= lat)
            .expect("a row at that latitude");
        assert!(
            found.abs_diff(row) <= 1,
            "{lat} north is row {found}, not {row}"
        );
        assert_ne!(found, flat, "{lat} north landed where degrees would put it");
    }

    let mut drawn: Vec<usize> = Vec::new();
    for row in 0..picture.height {
        if picture.pixels[row * picture.width * 4 + 3] > 0 {
            drawn.push(row);
        }
    }
    assert!(!drawn.is_empty(), "the planted row was not drawn at all");

    // Every row drawn sits at the latitude the planted row covers, which is
    // 39.96 to 40.00 north. Handed over unprojected the snow lands at 42.0,
    // which is Nebraska rather than Colorado.
    for row in &drawn {
        let lat = source_latitude(&analysis, &picture, *row);
        assert!(
            (39.96..=40.00).contains(&lat),
            "row {row} was drawn at {lat} north"
        );
        assert_eq!(grid_row(&analysis, lat), planted);
    }

    // And the row the grid put it in is not the row the picture puts it in,
    // which is what says the projection happened rather than that the two
    // numbers agree by luck.
    assert!(
        !drawn.contains(&planted),
        "the picture drew it in the grid's own row"
    );
}

/// The scale climbs, and the key beside the map is the scale itself.
#[test]
fn the_key_is_the_scale_the_picture_was_painted_with() {
    for high_contrast in [false, true] {
        let key = bands(high_contrast);
        assert_eq!(key.len(), 8);
        // Ascending, or the colour a depth gets is not the colour the key
        // shows beside it.
        for pair in key.windows(2) {
            assert!(pair[1].inches > pair[0].inches, "{key:?}");
        }
        // Every depth a band covers, not only the depth it starts at.
        //
        // Checking the stops alone was the one place a blend and a step
        // agree, so it passed while the top of every band was painted the
        // next band's colour exactly: 11.99 inches came out the swatch
        // labelled "12 in to 18 in". A reader matching a colour against the
        // key read a foot of snow where eleven and a half had fallen.
        for (at, band) in key.iter().enumerate() {
            let next = key.get(at + 1).map(|one| one.inches);
            let mut depths = vec![band.inches];
            if let Some(next) = next {
                let span = next - band.inches;
                depths.push(band.inches + span * 0.5);
                depths.push(next - span * 0.001);
            } else {
                depths.push(band.inches * 4.0);
            }
            for depth in depths {
                let painted = colour(ramp_for(high_contrast), depth);
                let said = format!("#{:02x}{:02x}{:02x}", painted[0], painted[1], painted[2]);
                assert_eq!(said, band.color, "{depth} in, under {band:?}");
            }
        }
        // And the bottom of the key is the bottom of the picture. They were
        // different: a hundredth of an inch was drawn in the colour of the
        // band starting at a tenth, under a swatch reading "0.1 in to 1 in".
        assert_eq!(key[0].inches, TRACE_INCHES);
    }
}

/// A deeper fall is never drawn in a lighter colour than a shallower one on
/// the scale a reader asked for more contrast on.
#[test]
fn the_high_contrast_scale_climbs_in_lightness() {
    use crate::contrast::lightness_climbs;
    assert!(lightness_climbs(HIGH_CONTRAST_RAMP, 0.5));
}

/// The office still publishes what this reads, at the address this builds.
///
/// Ignored with the other live tests: it talks to the network. In September
/// the analysis is almost all no-data, which is a real answer, so what this
/// holds is the shape rather than a depth.
#[test]
#[ignore = "fetches the published analysis from NOHRSC"]
fn the_office_still_publishes_what_this_reads() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");
    let mut reached = 0;
    for window in [Window::Day, Window::TwoDay, Window::ThreeDay] {
        // The newest few, because the one the clock says ought to exist often
        // does not yet.
        for valid in recent(Utc::now()) {
            let Ok(bytes) = runtime.block_on(crate::http::get_bytes(&url(window, valid))) else {
                continue;
            };
            let analysis = read(&bytes).expect("a published analysis decodes");
            assert_eq!(analysis.width, 1500);
            assert_eq!(analysis.height, 850);
            assert!(analysis
                .inches
                .iter()
                .all(|one| one.is_nan() || *one >= 0.0));
            reached += 1;
            break;
        }
    }
    assert_eq!(reached, 3, "only {reached} of the three windows answered");
}

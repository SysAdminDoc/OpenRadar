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
    let pixels = paint(&read, false);
    assert_eq!(pixels.len(), read.width * read.height * 4);
    for (at, depth) in read.inches.iter().enumerate() {
        let alpha = pixels[at * 4 + 3];
        if !depth.is_finite() || *depth < TRACE_INCHES {
            assert_eq!(alpha, 0, "cell {at} at {depth} was drawn");
        } else {
            assert!(alpha > 0, "cell {at} at {depth} was not drawn");
        }
    }
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
        // And each band's colour is the one the painter would use there.
        for band in &key {
            let painted = colour(ramp_for(high_contrast), band.inches);
            let said = format!("#{:02x}{:02x}{:02x}", painted[0], painted[1], painted[2]);
            assert_eq!(said, band.color, "{band:?}");
        }
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

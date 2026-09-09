use super::*;
use crate::mrms::testing::*;

/// The other test that talks to NOAA, ignored for the same reason. Run it
/// with `cargo test --lib --release -- --ignored mrms`.
#[test]
#[ignore = "fetches a live grid from the MRMS archive"]
fn decodes_and_draws_a_live_mrms_composite() {
    let _turn = live_test();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("a runtime");
    let entry = product_by_id("composite").expect("the composite product");

    let frames = runtime
        .block_on(mrms_frames("composite".into(), 10, None, None))
        .expect("MRMS publishes a grid every two minutes");
    assert!(frames.len() >= 5, "got {} frames", frames.len());
    assert!(
        frames.windows(2).all(|pair| pair[0].time < pair[1].time),
        "frames should be oldest first"
    );
    // Two minutes apart, which is the cadence the product claims.
    let step = frames[1].time - frames[0].time;
    assert!((110..=130).contains(&step), "frames are {step}s apart");
    // And the newest is recent, not a leftover from yesterday.
    let age = Utc::now().timestamp() - frames.last().unwrap().time;
    assert!(age < 900, "the newest grid is {age}s old");

    let newest = frames.last().unwrap();
    assert_eq!(
        key_for("CONUS", entry, None, newest.time).as_deref(),
        Some(newest.key.as_str()),
        "the derived key has to match the one the bucket published"
    );

    let started = std::time::Instant::now();
    runtime
        .block_on(grid_for(&newest.key, false))
        .expect("the grid decodes");
    let decoded = started.elapsed();

    // The grid is the published one kilometre CONUS domain.
    {
        let cache = CACHE.lock().expect("the cache");
        let held = cache
            .iter()
            .find(|held| held.key == newest.key)
            .expect("the grid is cached");
        assert_eq!((held.grid.columns, held.grid.rows), (7000, 3500));
        assert!((held.grid.d_lat - 0.01).abs() < 1e-9);
        assert!(
            (held.grid.west + 129.995).abs() < 0.01,
            "west is {}",
            held.grid.west
        );
        assert!(
            (held.grid.north - 54.995).abs() < 0.01,
            "north is {}",
            held.grid.north
        );

        // Real weather somewhere in the country, and clear air elsewhere.
        let values: Vec<f32> = (0..held.grid.rows)
            .step_by(37)
            .flat_map(|row| {
                (0..held.grid.columns)
                    .step_by(37)
                    .map(move |column| (row, column))
            })
            .map(|(row, column)| held.grid.value(row, column))
            .collect();
        let strongest = values.iter().cloned().fold(f32::MIN, f32::max);
        assert!(
            strongest > 20.0,
            "nowhere in the country had more than {strongest} dBZ"
        );
        assert!(
            values.iter().any(|value| *value < -90.0),
            "the grid should have gaps outside radar coverage"
        );
    }

    // A tile over the middle of the country draws; one over Europe does not.
    let drawing = std::time::Instant::now();
    let tile = tile_from_cache(
        &newest.key,
        entry,
        4,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false,
        },
    );
    let drawn = drawing.elapsed();
    assert!(
        tile.as_ref().is_some_and(|bytes| bytes.len() > 200),
        "the tile over the plains came out empty"
    );
    assert!(tile_from_cache(
        &newest.key,
        entry,
        4,
        8,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false
        }
    )
    .is_none());

    println!("decode {decoded:?}, tile {drawn:?}");
    assert!(
        decoded < std::time::Duration::from_secs(3),
        "decoding took {decoded:?}"
    );
    assert!(
        drawn < std::time::Duration::from_millis(200),
        "one tile took {drawn:?}"
    );
}

/// The whole native path exactly as the webview drives it: a URL in, PNG
/// bytes out. Ignored with the other live tests.
#[test]
#[ignore = "fetches a live grid from the MRMS archive"]
fn serves_a_tile_the_way_the_map_asks_for_one() {
    let _turn = live_test();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    let frames = runtime
        .block_on(mrms_frames("composite".into(), 3, None, None))
        .expect("MRMS publishes grids");
    let time = frames.last().expect("a frame").time;

    // Zoom 4 tile 3/5 covers the middle of the country.
    let plains = runtime.block_on(serve_tile(&format!("/composite/{time}/4/3/5.png")));
    assert_eq!(&plains[1..4], b"PNG");
    assert!(plains.len() > EMPTY_TILE.len(), "the tile came back empty");

    // The same tile with a threshold on it: the reader's value has to
    // travel from the query, through the handler, into the drawing. It
    // reaches the drawing in tile_pixels whatever happens in between, so
    // only asking through the whole path can tell whether it arrives.
    let floored = runtime.block_on(serve_tile(&format!("/composite/{time}/4/3/5.png?min=60")));
    assert_eq!(&floored[1..4], b"PNG");
    assert!(
        floored.len() < plains.len(),
        "a threshold of sixty dBZ drew as much as no threshold at all:              {} bytes against {}",
        floored.len(),
        plains.len()
    );

    // Over the Atlantic there is nothing to draw, and an empty tile is the
    // answer rather than an error the map would log for every corner.
    let ocean = runtime.block_on(serve_tile(&format!("/composite/{time}/4/8/5.png")));
    assert_eq!(ocean, EMPTY_TILE);

    // A moment nothing was published for is a real tile request for an
    // object that does not exist, and the answer is an empty tile rather
    // than an error the map would log for every corner of the country.
    let missing = runtime.block_on(serve_tile("/composite/0/4/3/5.png"));
    assert_eq!(missing, EMPTY_TILE);

    // A request that is not a tile request at all is answered the same way,
    // never with a panic or a file from somewhere else.
    for path in ["/../../../etc/passwd", "/nonsense", ""] {
        let answer = runtime.block_on(serve_tile(path));
        assert_eq!(&answer[1..4], b"PNG", "{path} did not answer with a PNG");
    }
}

/// Where the fold stops being invisible, worked out rather than asserted.
///
/// Web Mercator draws 360 degrees across 256 pixels at zoom zero. The fold
/// shows once the grid's own cell is wider than a screen pixel, because
/// that is when a reader is looking at cell edges rather than through
/// them.
#[test]
fn the_fold_shows_from_the_zoom_the_finer_grid_is_asked_for() {
    // Zoom eight is where a folded cell first covers more than a screen
    // pixel. Below it the reader cannot see the difference and the grid
    // costs four times as much, which is the whole of why it is asked for
    // rather than always on.
    assert!(!fold_shows(0));
    assert!(!fold_shows(7), "a whole grid was fetched nobody could see");
    assert!(
        fold_shows(8),
        "the fold shows and the grid was not asked for"
    );
    assert!(fold_shows(12), "the deepest tile this serves");
    // A zoom no address can carry, which must not shift the answer by
    // overflowing the shift it is worked out with.
    assert!(fold_shows(u32::MAX));
}

/// A tile address carries the decision, so the whole path can be read.
///
/// The decision used to be made where the grid was asked for, one line
/// inside a function nothing runnable reaches: replacing it with a flat
/// `false`, which is the shear grids never coming unfolded and exactly
/// the bug this was written to fix, left the whole suite green.
#[test]
fn a_tile_address_says_whether_the_reader_can_see_the_fold() {
    let asked = |zoom: u32| {
        parse_tile_path(&format!("az-shear-low/1756800000/{zoom}/10/20.png"))
            .expect("a tile address")
    };
    assert!(!asked(6).detail);
    assert!(
        !asked(7).detail,
        "a whole grid was fetched nobody could see"
    );
    assert!(asked(8).detail, "the fold shows and it was not asked for");
    assert!(asked(12).detail);
    // The same address under a region prefix, which is a different arm of
    // the parser and had its own way of forgetting.
    assert!(
        parse_tile_path("CONUS/az-shear-low/1756800000/9/10/20.png")
            .expect("a regional tile address")
            .detail
    );
}

/// And the fetch is asked for what the address said.
///
/// Read off the source, because everything between the two is a bucket.
/// A pure function tested on its own and then not called is the shape
/// this whole feature failed in once already.
#[test]
fn the_grid_is_asked_for_what_the_address_said() {
    let source = include_str!("tiles.rs");
    let body = source
        .split("pub async fn serve_tile(")
        .nth(1)
        .expect("the tile handler is in this file");
    let body = &body[..body.find("\npub fn ").unwrap_or(body.len())];
    assert!(
        body.contains("grid_for(&key, detail)"),
        "the tile handler no longer asks for the grid the address called for"
    );
    // And nothing rebinds it on the way. Reading the source for a call is
    // a weak gate and this is the hole it had: shadowing `detail` one line
    // above the call satisfied the search above while restoring the bug it
    // was written for, with no compiler warning and the whole suite green.
    // Everything between the address and the fetch is a bucket, so this is
    // what there is; what it can promise is that the name the handler
    // passes is the one the parser put on the request.
    let taken = body
        .find("} = asked;")
        .expect("the handler takes the request apart");
    let called = body
        .find("grid_for(&key, detail)")
        .expect("checked just above");
    assert!(
        !body[taken..called].contains("let detail"),
        "something reassigns `detail` between the address and the fetch"
    );
}

/// The drawing actually changes, which nothing else here would notice.
///
/// Every other test around this reads a flag, a key or a function in
/// isolation. Setting the sampler's own `between` to false left all of
/// them green while the picture went back to hard squares, which is the
/// whole of what this was built to fix, so the pixels are compared.
#[test]
fn reading_between_the_cells_changes_the_picture() {
    let entry = product_by_id("composite").expect("composite");
    let reference = solid_block().reference;
    let mut grid = solid_block();
    // A ramp across the block, so neighbouring cells differ and there is
    // something between them to read.
    for (at, sample) in grid.samples.iter_mut().enumerate() {
        let dbz = ((at % 100) / 10) as f32 * 8.0;
        *sample = ((dbz * 10.0) - reference) as u16;
    }

    // Zoomed in far enough that one cell is many pixels, which is where
    // the squares are visible and where this is worth doing.
    let (x, y) = tile_of(41.0, -94.0, 9);
    let nearest = tile_pixels(
        &grid,
        entry,
        9,
        x,
        y,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false,
        },
    )
    .expect("a tile off the ramp");
    let smoothed = tile_pixels(
        &grid,
        entry,
        9,
        x,
        y,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: true,
        },
    )
    .expect("a smoothed tile off the same ramp");

    assert_ne!(nearest, smoothed, "smoothing drew the same picture");

    // And it is smoother rather than merely different: reading between
    // the cells puts colours on the map that the terraced version steps
    // straight over.
    let shades = |pixels: &[u8]| {
        pixels
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|pixel| pixel[3] > 0)
            .map(|pixel| (pixel[0], pixel[1], pixel[2]))
            .collect::<std::collections::BTreeSet<_>>()
            .len()
    };
    assert!(
        shades(&smoothed) > shades(&nearest),
        "the smoothed tile held no more colours than the terraced one: {} against {}",
        shades(&smoothed),
        shades(&nearest)
    );

    // The same tile drawn twice the same way is the same tile, so the
    // difference above is the smoothing rather than anything drifting.
    let again = tile_pixels(
        &grid,
        entry,
        9,
        x,
        y,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: true,
        },
    )
    .expect("a tile");
    assert_eq!(smoothed, again);
}

/// A smoothed tile is a different picture at the same address.
#[test]
fn a_smoothed_tile_is_not_served_for_a_nearest_one() {
    let plain = tile_key(
        "k",
        8,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false,
        },
        1,
    );
    let smooth = tile_key(
        "k",
        8,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: true,
        },
        1,
    );
    assert_ne!(plain, smooth);
    assert_eq!(
        smooth,
        tile_key(
            "k",
            8,
            3,
            5,
            TileLook {
                threshold: None,
                high_contrast: false,
                smooth: true
            },
            1
        )
    );
}

/// And the address carries the reader's answer through to the drawing.
#[test]
fn a_tile_address_says_whether_to_read_between_the_cells() {
    let asked = |query: &str| {
        parse_tile_path(&format!("composite/1756800000/8/10/20.png{query}"))
            .expect("a tile address")
    };
    assert!(!asked("").smooth);
    assert!(asked("?smooth=1").smooth);
    // Beside the other flags rather than instead of them.
    let both = asked("?hc=1&smooth=1");
    assert!(both.smooth && both.high_contrast);
    // Anything but the flag itself is off, the way the contrast flag is:
    // a picture is not something to guess at from a malformed address.
    assert!(!asked("?smooth=0").smooth);
    assert!(!asked("?smooth").smooth);
}

/// Two grids of the same ground are two pictures at the same address.
#[test]
fn a_tile_says_which_grid_drew_it() {
    // A shear tile drawn from the folded grid and the same tile drawn
    // from the unfolded one differ along their cell edges. Served under
    // one address they leave a seam at a tile boundary that stays for the
    // session, because nothing invalidates a drawn tile when a finer grid
    // replaces the one it came from.
    let folded = tile_key(
        "k",
        7,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false,
        },
        2,
    );
    let whole = tile_key(
        "k",
        7,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false,
        },
        1,
    );
    assert_ne!(folded, whole);
    assert_eq!(
        whole,
        tile_key(
            "k",
            7,
            3,
            5,
            TileLook {
                threshold: None,
                high_contrast: false,
                smooth: false
            },
            1
        )
    );
}

#[test]
fn a_tile_with_nothing_above_the_floor_is_not_sent_at_all() {
    let entry = product_by_id("composite").expect("the composite product");
    // A grid in the right place, holding only values below the ramp floor.
    let quiet = Grid {
        columns: 2,
        rows: 2,
        north: 41.0,
        west: -94.0,
        d_lat: 0.5,
        d_lon: 0.5,
        reference: -9990.0,
        binary: 0,
        decimal: 1,
        samples: vec![9990, 9991, 0, 0],
    };
    // Zoom 4 tile 3/5 covers the middle of the country, so this tile does
    // overlap the grid; it simply has nothing worth drawing.
    assert!(
        tile_pixels(
            &quiet,
            entry,
            4,
            3,
            5,
            TileLook {
                threshold: None,
                high_contrast: false,
                smooth: false
            }
        )
        .is_none(),
        "a tile of clear air should not be sent"
    );

    // The same tile with one gate of real rain in it does get sent.
    let mut wet = quiet;
    wet.samples = vec![10490, 10490, 10490, 10490];
    assert!(tile_pixels(
        &wet,
        entry,
        4,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false
        }
    )
    .is_some());
}

/// The reason the sparse products walk their cells: one live cell in a
/// wide grid falls between pixel centres, and asking each pixel what is
/// under it draws nothing at all.
#[test]
fn a_lone_cell_is_drawn_rather_than_fallen_between_pixels() {
    // A degree of grid at MRMS resolution, with a single live cell in it.
    let mut samples = vec![0u16; 100 * 100];
    samples[50 * 100 + 50] = 10_500;
    let grid = Grid {
        columns: 100,
        rows: 100,
        north: 42.0,
        west: -95.0,
        d_lat: 0.01,
        d_lon: 0.01,
        reference: -9990.0,
        binary: 0,
        decimal: 1,
        samples,
    };

    let walking = product_by_id("mesh").expect("a sparse product");
    let walking = MrmsProduct {
        ramp: REFLECTIVITY_RAMP,
        floor: 5.0,
        sampling: Sampling::Cells,
        ..*walking
    };
    let sampling = MrmsProduct {
        sampling: Sampling::Nearest,
        ..walking.clone()
    };

    // Zoom four over the plains: one pixel covers about forty grid cells,
    // so a single live cell is a needle.
    let painted = |product: &MrmsProduct| {
        tile_pixels(
            &grid,
            product,
            4,
            3,
            5,
            TileLook {
                threshold: None,
                high_contrast: false,
                smooth: false,
            },
        )
        .map(|pixels| {
            pixels
                .as_chunks::<4>()
                .0
                .iter()
                .filter(|p| p[3] > 0)
                .count()
        })
        .unwrap_or(0)
    };

    assert_eq!(
        painted(&sampling),
        0,
        "the lone cell happened to sit under a pixel centre; move it"
    );
    assert_eq!(
        painted(&walking),
        1,
        "walking the cells has to draw the one live cell, and only it"
    );
}

#[test]
fn a_threshold_hides_the_weak_cells_and_never_brings_back_the_hidden_ones() {
    // The grid runs from well under the composite's own floor to well
    // over it, so the count says exactly what was kept.
    let entry = product_by_id("composite").expect("composite");
    let grid_reference = solid_block().reference;
    let mut grid = solid_block();
    for (at, sample) in grid.samples.iter_mut().enumerate() {
        // Ten dBZ steps from 0 to 90 across the block. The grid holds
        // tenths above a reference of minus ninety-nine point nine.
        let dbz = (at % 10) as f32 * 10.0;
        *sample = ((dbz * 10.0) - grid_reference) as u16;
    }

    let (x, y) = tile_of(41.0, -94.0, 8);
    let painted = |floor: Option<f32>| {
        tile_pixels(
            &grid,
            entry,
            8,
            x,
            y,
            TileLook {
                threshold: floor,
                high_contrast: false,
                smooth: false,
            },
        )
        .map(|pixels| {
            pixels
                .as_chunks::<4>()
                .0
                .iter()
                .filter(|p| p[3] > 0)
                .count()
        })
        .unwrap_or(0)
    };

    let whole = painted(None);
    assert!(whole > 0, "the fixture has to draw something");

    // A threshold hides, and hides more the higher it goes.
    let some = painted(Some(35.0));
    let more = painted(Some(65.0));
    assert!(some < whole, "35 dBZ hid nothing: {some} of {whole}");
    assert!(more < some, "65 dBZ hid no more than 35: {more} of {some}");
    assert_eq!(painted(Some(200.0)), 0, "nothing is that strong");

    // And it can only ever hide. A threshold under the product's own
    // floor must not bring back what the floor already excluded.
    assert!(entry.floor > 0.0, "this product has a floor to undercut");
    assert_eq!(
        painted(Some(-100.0)),
        whole,
        "a threshold below the floor widened the picture"
    );
    assert_eq!(painted(Some(0.0)), whole);
}

#[test]
fn two_thresholds_are_two_tiles_rather_than_one_served_twice() {
    // The threshold is part of what the tile shows, so it has to be part
    // of the address the drawn tile is remembered under. Leaving it out
    // served the first reader's picture to the second.
    let plain = tile_key(
        "k",
        4,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false,
        },
        1,
    );
    let low = tile_key(
        "k",
        4,
        3,
        5,
        TileLook {
            threshold: Some(20.0),
            high_contrast: false,
            smooth: false,
        },
        1,
    );
    let high = tile_key(
        "k",
        4,
        3,
        5,
        TileLook {
            threshold: Some(45.0),
            high_contrast: false,
            smooth: false,
        },
        1,
    );
    assert_ne!(plain, low);
    assert_ne!(low, high);
    assert_ne!(plain, high);
    // The same threshold is the same tile, or nothing would ever be
    // remembered at all.
    assert_eq!(
        low,
        tile_key(
            "k",
            4,
            3,
            5,
            TileLook {
                threshold: Some(20.0),
                high_contrast: false,
                smooth: false
            },
            1
        )
    );
}

/// Painting one pixel per cell only works while a cell is smaller than a
/// pixel. Zoomed in, a cell is several pixels across, and a solid swath
/// drawn a pixel at a time comes out as a lattice of dots with almost
/// nothing between them.
#[test]
fn a_solid_field_stays_solid_all_the_way_in() {
    let grid = solid_block();
    let entry = product_by_id("mesh").expect("a sparse product");
    let entry = MrmsProduct {
        ramp: REFLECTIVITY_RAMP,
        floor: 5.0,
        sampling: Sampling::Cells,
        ..*entry
    };

    for zoom in [6u32, 8, 9, 10] {
        let (x, y) = tile_of(41.0, -94.0, zoom);
        let walked = painted_count(&grid, &entry, zoom, x, y);
        let sampled = painted_count(
            &grid,
            &MrmsProduct {
                sampling: Sampling::Nearest,
                ..entry.clone()
            },
            zoom,
            x,
            y,
        );
        assert!(
            walked >= sampled,
            "at zoom {zoom} walking the cells drew {walked} pixels and sampling drew {sampled}"
        );
    }

    // Zoom ten is the source's own maximum and a cell is seven pixels
    // across there, so the field covers the whole tile.
    let (x, y) = tile_of(41.0, -94.0, 10);
    let deep = painted_count(&grid, &entry, 10, x, y);
    assert!(
        deep > TILE_SIZE * TILE_SIZE / 2,
        "a solid field covered only {deep} of {} pixels at zoom ten",
        TILE_SIZE * TILE_SIZE
    );
}

/// A cell whose centre sits west of a tile belongs to the tile before it.
/// Casting a negative offset to an index saturates to zero, which draws a
/// stripe of somebody else's weather down the left edge.
#[test]
fn a_cell_west_of_a_tile_is_not_drawn_down_its_left_edge() {
    let entry = product_by_id("mesh").expect("a sparse product");
    let entry = MrmsProduct {
        ramp: REFLECTIVITY_RAMP,
        floor: 5.0,
        sampling: Sampling::Cells,
        ..*entry
    };

    let zoom = 10u32;
    let (x, y) = tile_of(41.0, -94.0, zoom);
    let scale = 2f64.powi(zoom as i32);
    let left = (x as f64 / scale) * 360.0 - 180.0;

    // One cell, two whole cells west of this tile's left edge.
    let grid = Grid {
        columns: 1,
        rows: 1,
        north: 41.0,
        west: left - 0.02,
        d_lat: 0.01,
        d_lon: 0.01,
        reference: -9990.0,
        binary: 0,
        decimal: 1,
        samples: vec![10_500],
    };

    assert_eq!(
        painted_count(&grid, &entry, zoom, x, y),
        0,
        "a cell west of the tile was drawn inside it"
    );
    // And it is drawn on the tile it does belong to.
    assert!(painted_count(&grid, &entry, zoom, x - 1, y) > 0);
}

/// The whole point of loading a colour table: what is on screen is drawn
/// with it, and only for the product it says it is for.
#[test]
fn a_loaded_colour_table_draws_the_tiles() {
    let _turn = live_test();
    clear_caches();

    let entry = product_by_id("composite").expect("the composite product");
    let grid = Grid {
        columns: 100,
        rows: 100,
        north: 42.0,
        west: -95.0,
        d_lat: 0.01,
        d_lon: 0.01,
        reference: -9990.0,
        binary: 0,
        decimal: 1,
        // Fifty dBZ everywhere, which the built-in ramp draws bright red.
        samples: vec![10_490; 100 * 100],
    };

    let color_at = |zoom, x, y| {
        tile_pixels(
            &grid,
            entry,
            zoom,
            x,
            y,
            TileLook {
                threshold: None,
                high_contrast: false,
                smooth: false,
            },
        )
        .map(|pixels| {
            let first = pixels
                .as_chunks::<4>()
                .0
                .iter()
                .find(|p| p[3] > 0)
                .expect("a painted pixel");
            [first[0], first[1], first[2]]
        })
    };

    let built_in = color_at(6, 15, 23).expect("a tile");
    assert_eq!(built_in, [0xfd, 0x00, 0x00], "the built-in ramp changed");

    // A table saying fifty dBZ is black.
    crate::palette::set_palettes(vec![crate::palette::Table {
        units: Some("dBZ".into()),
        range_folded: None,
        stops: vec![crate::palette::Stop {
            value: 5.0,
            color: "#000000".into(),
            to_color: None,
            solid: false,
        }],
    }]);
    assert_eq!(
        color_at(6, 15, 23),
        Some([0x00, 0x00, 0x00]),
        "the loaded table did not reach the tiles"
    );

    // A table for a different unit leaves reflectivity alone.
    crate::palette::set_palettes(vec![crate::palette::Table {
        units: Some("mm".into()),
        range_folded: None,
        stops: vec![crate::palette::Stop {
            value: 5.0,
            color: "#000000".into(),
            to_color: None,
            solid: false,
        }],
    }]);
    assert_eq!(color_at(6, 15, 23), Some(built_in));

    // And clearing it puts the built-in ramp back.
    crate::palette::set_palettes(Vec::new());
    assert_eq!(color_at(6, 15, 23), Some(built_in));
    clear_caches();
}

#[test]
fn a_tile_request_is_read_strictly() {
    let asked = parse_tile_path("/composite/1788075402/6/14/24.png").expect("a tile");
    assert_eq!(asked.entry.id, "composite");
    assert_eq!(
        (asked.time, asked.zoom, asked.x, asked.y),
        (1788075402, 6, 14, 24)
    );
    assert_eq!(asked.threshold, None);
    // The same path without the extension, which is how a source may ask.
    assert!(parse_tile_path("mesh/1788075402/3/1/2").is_some());

    // The threshold rides along as a query, since the reader can change it
    // without the frame or the tile changing.
    let floored = parse_tile_path("/composite/1788075402/6/14/24.png?min=35").expect("a tile");
    assert_eq!(floored.threshold, Some(35.0));
    assert_eq!(floored.entry.id, "composite");
    assert_eq!(floored.zoom, 6);

    // A threshold that is not a number is no threshold, rather than a
    // threshold of nothing that would hide the whole picture.
    for query in ["?min=", "?min=abc", "?min=NaN", "?other=3"] {
        let asked = parse_tile_path(&format!("/composite/1788075402/6/14/24.png{query}"))
            .expect("still a tile");
        assert_eq!(asked.threshold, None, "{query}");
    }

    // Nothing that is not exactly that shape is served.
    for path in [
        "/composite/1788075402/6/14",
        "/composite/1788075402/6/14/24/extra.png",
        "/../../etc/passwd/6/14/24.png",
        "/composite/notatime/6/14/24.png",
        "/composite/1788075402/40/14/24.png",
        "",
    ] {
        assert!(parse_tile_path(path).is_none(), "{path} should be refused");
    }
}

#[test]
fn two_heights_of_one_field_are_two_different_grids() {
    // The height reaches the object key, and the object key is the grid
    // cache's own key. Anything less and the second height asked for is
    // served the first height's grid, which looks like a field that does
    // not change with altitude.
    let family = product_by_id("cappi-reflectivity").expect("the family");
    let low = key_for("CONUS", family, Some("00.50"), 1_788_083_202).expect("a key");
    let high = key_for("CONUS", family, Some("10.00"), 1_788_083_202).expect("a key");
    assert_eq!(
        low,
        "CONUS/MergedReflectivityQC_00.50/20260830/\
         MRMS_MergedReflectivityQC_00.50_20260830-094642.grib2.gz"
    );
    assert_eq!(
        high,
        "CONUS/MergedReflectivityQC_10.00/20260830/\
         MRMS_MergedReflectivityQC_10.00_20260830-094642.grib2.gz"
    );
    assert_ne!(low, high);
    // And the file name the listing reader parses is still one this
    // decoder can read a time out of.
    assert_eq!(key_time(&high), Some(1_788_083_202));
}

#[test]
fn a_tile_address_carries_the_height_it_was_drawn_at() {
    let asked = parse_tile_path("/CONUS/cappi-zdr/1788083202/6/15/24.png?level=03.00")
        .expect("a readable address");
    assert_eq!(asked.entry.id, "cappi-zdr");
    assert_eq!(asked.level, Some("03.00"));

    // Without one, the lowest, which is what an address written before
    // the height was askable means.
    let bare = parse_tile_path("/CONUS/cappi-zdr/1788083202/6/15/24.png").expect("readable");
    assert_eq!(bare.level, Some("00.50"));

    // On a product with one height it stays absent whatever is asked, so
    // the folder cannot be built with a suffix that does not exist.
    let flat =
        parse_tile_path("/CONUS/composite/1788083202/6/15/24.png?level=03.00").expect("readable");
    assert_eq!(flat.level, None);

    // Beside the other two query pieces, in either order.
    let both = parse_tile_path("/CONUS/cappi-rhohv/1788083202/6/15/24.png?hc=1&level=06.00")
        .expect("readable");
    assert_eq!(both.level, Some("06.00"));
    assert!(both.high_contrast);
}

#[test]
fn only_the_products_the_panel_offers_are_accepted() {
    assert_eq!(
        product_by_id("composite").map(|entry| entry.folder),
        Some("MergedReflectivityQCComposite_00.50")
    );
    assert!(product_by_id("rotation").is_some());
    assert!(product_by_id("mesh").is_some());
    assert!(product_by_id("../../secrets").is_none());
}

#[test]
fn a_tile_outside_the_grid_is_not_drawn_at_all() {
    let grid = grid();
    let entry = product_by_id("composite").expect("the composite product");
    // Zoom 4 tile over western Europe, nowhere near the grid.
    assert!(tile_pixels(
        &grid,
        entry,
        4,
        8,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false
        }
    )
    .is_none());
    // A tile index that does not exist at its zoom.
    assert!(tile_pixels(
        &grid,
        entry,
        1,
        4,
        0,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false
        }
    )
    .is_none());
}

#[test]
fn mercator_round_trips_the_latitudes_the_grid_covers() {
    for latitude in [20.005, 35.0, 41.7, 54.995] {
        let back = inverse_mercator_y(mercator_y(latitude));
        assert!(
            (back - latitude).abs() < 1e-9,
            "{latitude} came back {back}"
        );
    }
}

/// The contrast choice has to travel in the address, or a tile drawn one
/// way is served to a reader who asked for the other.
#[test]
fn the_tile_address_carries_the_contrast_choice() {
    let ordinary = parse_tile_path("/composite/1788075402/6/14/24.png?p=0").expect("a tile");
    assert!(!ordinary.high_contrast);
    let asked = parse_tile_path("/composite/1788075402/6/14/24.png?p=0&hc=1").expect("a tile");
    assert!(asked.high_contrast);
    // Anything else is ordinary contrast rather than a guess.
    for query in ["?hc=0", "?hc=yes", "?hc", "?min=20"] {
        let odd =
            parse_tile_path(&format!("/composite/1788075402/6/14/24.png{query}")).expect("a tile");
        assert!(!odd.high_contrast, "{query} should not turn contrast on");
    }
}

#[test]
fn two_contrast_choices_are_two_tiles() {
    let plain = tile_key(
        "k",
        4,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false,
        },
        1,
    );
    let contrast = tile_key(
        "k",
        4,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: true,
            smooth: false,
        },
        1,
    );
    assert_ne!(plain, contrast);
    assert_eq!(
        contrast,
        tile_key(
            "k",
            4,
            3,
            5,
            TileLook {
                threshold: None,
                high_contrast: true,
                smooth: false
            },
            1
        )
    );
}

/// And the pixels actually differ, so the address is separating two
/// pictures rather than two names for one.
#[test]
fn a_high_contrast_tile_is_drawn_on_the_other_ramp() {
    let grid = grid();
    let entry = product_by_id("composite").expect("the composite product");
    let plain = tile_pixels(
        &grid,
        entry,
        4,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false,
        },
    )
    .expect("a tile");
    let contrast = tile_pixels(
        &grid,
        entry,
        4,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: true,
            smooth: false,
        },
    )
    .expect("a tile");
    assert_ne!(plain, contrast);
}

/// A five-minute lightning grid has a couple of hundred live cells in
/// twenty-four million. Asking each pixel what is under its centre draws an
/// empty map, so the sparse products walk the cells instead. Live, because
/// the sparseness is the point.
#[test]
#[ignore = "fetches a live grid from the MRMS archive"]
fn a_sparse_product_is_drawn_rather_than_missed() {
    let _turn = live_test();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    // Rotation tracks hold an hour of shear, so there is nearly always
    // something somewhere in the country to draw.
    let entry = product_by_id("rotation").expect("the rotation product");
    let frames = runtime
        .block_on(mrms_frames("rotation".into(), 1, None, None))
        .expect("MRMS publishes rotation tracks");
    let key = frames.last().expect("a frame").key.clone();
    runtime
        .block_on(grid_for(&key, false))
        .expect("the grid decodes");

    let cache = CACHE.lock().expect("the cache");
    let grid = &cache
        .iter()
        .find(|held| held.key == key)
        .expect("the grid is cached")
        .grid;

    let live = (0..grid.rows)
        .flat_map(|row| (0..grid.columns).map(move |column| (row, column)))
        .filter(|(row, column)| grid.value(*row, *column) >= entry.floor)
        .count();
    assert!(live > 0, "no rotation anywhere in the country to draw");

    // The same product drawn the other way, so the comparison does not
    // depend on how busy the weather happens to be.
    let by_pixel = MrmsProduct {
        sampling: Sampling::Nearest,
        ..*entry
    };

    // The country at zoom four, which is where a sparse product is easiest
    // to lose.
    let tiles: Vec<(u32, u32)> = (2..=5).flat_map(|x| (5..=6).map(move |y| (x, y))).collect();
    let count = |product: &MrmsProduct| {
        tiles
            .iter()
            .filter_map(|(x, y)| {
                tile_pixels(
                    grid,
                    product,
                    4,
                    *x,
                    *y,
                    TileLook {
                        threshold: None,
                        high_contrast: false,
                        smooth: false,
                    },
                )
            })
            .map(|pixels| {
                pixels
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .filter(|p| p[3] > 0)
                    .count()
            })
            .sum::<usize>()
    };
    let walked = count(entry);
    let sampled = count(&by_pixel);

    println!("{live} live cells: {walked} pixels walking cells, {sampled} sampling pixels");
    assert!(walked > 0, "{live} live cells and not one pixel drew any");
    assert!(
        walked > sampled,
        "walking the cells drew {walked} pixels, sampling drew {sampled}"
    );
}

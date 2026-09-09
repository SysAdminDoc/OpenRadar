use super::*;
use crate::mrms::testing::*;

#[test]
fn reads_a_negative_grib_exponent_as_negative() {
    // GRIB writes -1 as a sign bit plus one, not as two's complement.
    assert_eq!(grib::signed(0x8001u16 as i16), -1);
    assert_eq!(grib::signed(1), 1);
    assert_eq!(grib::signed(0), 0);
}

/// The finer grids cost what the coarse ones do, because they are folded.
///
/// Azimuthal shear is published at 0.005 degrees, which is 14000 by 7000
/// points: four times the cells of everything else in the table. It has to
/// arrive as the same 0.01 degree grid the rest of the app draws, and it
/// has to arrive inside the budget the composite is held to, or the finest
/// product in the table is the one that makes the map stutter.
#[test]
#[ignore = "fetches a live grid from the MRMS archive"]
fn a_finer_grid_is_folded_and_costs_what_a_coarse_one_does() {
    let _turn = live_test();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    // What a coarse grid costs on this machine, right now. The claim here
    // is that folding makes a fine grid cost what a coarse one does, and
    // that is a ratio; holding it to a number of seconds instead measures
    // whatever else the machine is doing. On 2026-09-07 this failed at
    // 3.38 s with six other jobs running and passed at 316 ms an hour
    // later on the same bytes, which is a red gate that means nothing.
    //
    // The bytes are fetched and unzipped before anything is timed, and the
    // clock covers `decode_grib_to_fit` alone. Timing `grid_for` timed the
    // download with it: it fetches on every call, since the disk cache is
    // an error fallback rather than a hit, and the objects are nothing
    // like the same size. Measured on 2026-09-07 the composite object is
    // 1.69 MB against a shear object's 563 kB, so three quarters of the
    // difference this gate claimed to be measuring was the wire.
    clear_caches();
    let coarse_frames = runtime
        .block_on(mrms_frames("composite".into(), 1, None, None))
        .expect("the composite publishes");
    let coarse_key = coarse_frames
        .last()
        .expect("the composite has a grid")
        .key
        .clone();
    let coarse_plain = gunzip(
        &runtime
            .block_on(http::get_bytes(&format!("{BUCKET}/{coarse_key}")))
            .expect("the composite would not fetch"),
    )
    .expect("the composite object is gzip");
    // Once untimed first. This is the baseline every ratio below is taken
    // against, and it was the first decode in the whole run: it paid the
    // first-touch faults on a fresh 49-million-cell allocation, while the
    // fine grids that get compared to it run afterwards against an
    // allocation the process has already had and given back. That put the
    // bias in the direction the test wanted, which is the one direction a
    // measurement must never be wrong in.
    decode_grib_to_fit(&coarse_plain, MAX_GRID_POINTS).expect("the composite decodes");
    let started = std::time::Instant::now();
    decode_grib_to_fit(&coarse_plain, MAX_GRID_POINTS).expect("the composite decodes");
    let coarse_decode = started.elapsed();
    println!("composite: decode {coarse_decode:?}");

    for id in ["az-shear-low", "az-shear-mid"] {
        clear_caches();
        let entry = product_by_id(id).expect("the product is in the table");
        let frames = runtime
            .block_on(mrms_frames(id.into(), 3, None, None))
            .unwrap_or_else(|error| panic!("{id} publishes nothing: {error}"));
        let newest = frames.last().unwrap_or_else(|| panic!("{id} has no grid"));

        // What the bucket actually published, read out of the object's own
        // grid definition section rather than inferred from what came out
        // of the decoder. The decoder's answer is post-fold, so on its own
        // it cannot tell a folded fine grid from a coarse one, and the
        // whole claim here is that this product is the fine one.
        let raw = runtime
            .block_on(http::get_bytes(&format!("{BUCKET}/{}", newest.key)))
            .unwrap_or_else(|error| panic!("{id} would not fetch: {error}"));
        let plain = gunzip(&raw).expect("the object is gzip");
        let (source_columns, source_rows, source_step) = {
            let mut at = 16usize;
            let mut found = None;
            while at + 5 <= plain.len() && &plain[at..at + 4] != b"7777" {
                let length = u32::from_be_bytes(plain[at..at + 4].try_into().unwrap()) as usize;
                assert!(length >= 5 && at + length <= plain.len());
                let section = &plain[at..at + length];
                if section[4] == 3 {
                    found = Some((
                        u32::from_be_bytes(section[30..34].try_into().unwrap()) as usize,
                        u32::from_be_bytes(section[34..38].try_into().unwrap()) as usize,
                        u32::from_be_bytes(section[67..71].try_into().unwrap()) as f64 / 1e6,
                    ));
                    break;
                }
                at += length;
            }
            found.expect("the object carries a grid definition")
        };
        assert_eq!(
            (source_columns, source_rows),
            (14000, 7000),
            "{id} is no longer published on the fine grid"
        );
        assert!(
            (source_step - 0.005).abs() < 1e-9,
            "{id} is published at {source_step} degrees"
        );

        // The same clock the composite got: the bytes are already in hand
        // from the grid-definition read above, so this is the decode and
        // nothing else.
        let started = std::time::Instant::now();
        decode_grib_to_fit(&plain, MAX_GRID_POINTS)
            .unwrap_or_else(|error| panic!("{id} did not decode: {error}"));
        let decoded = started.elapsed();

        // And again through the real path, to fill the cache the geometry
        // assertions below read. Not timed, because it fetches.
        runtime
            .block_on(grid_for(&newest.key, false))
            .unwrap_or_else(|error| panic!("{id} did not decode: {error}"));

        {
            let cache = CACHE.lock().expect("the cache");
            let held = cache
                .iter()
                .find(|held| held.key == newest.key)
                .expect("the grid is cached");
            assert_eq!(
                (held.grid.columns, held.grid.rows),
                (7000, 3500),
                "{id} was not folded to the grid the app draws"
            );
            assert!(
                (held.grid.d_lat - 0.01).abs() < 1e-9,
                "{id} came out at {} degrees",
                held.grid.d_lat
            );
            // Folding anchors the first point at the centre of the block
            // it came from, so the field does not slide half a source cell
            // north and west. That lands it on the coarse grid's own
            // origin, which is what lets a reader compare shear against a
            // rotation track cell for cell.
            assert!(
                (held.grid.north - 54.995).abs() < 1e-6,
                "{id} starts at {}",
                held.grid.north
            );
            assert!(
                (held.grid.west + 129.995).abs() < 1e-6,
                "{id} starts at {}",
                held.grid.west
            );
        }

        let drawing = std::time::Instant::now();
        let _ = tile_from_cache(
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
        println!("{id}: decode {decoded:?}, tile {drawn:?}");

        // Against the composite decoded a moment ago on this machine,
        // rather than against a number of seconds.
        //
        // Four, because that is what the fold itself costs: every output
        // cell is the strongest of the four source cells under it, so the
        // sampling work is four times the composite's for the same number
        // of points out. A fine grid that costs more than four coarse ones
        // is doing something beyond reading the cells it folds, and the
        // regression this is really watching for is a decode that builds
        // the full grid and reduces afterwards, which costs the four plus
        // the allocation.
        //
        // Measured on 2026-09-07 with the download out of the clock:
        // composite 129 ms, az-shear-low 266, az-shear-mid 262. A ratio of
        // about 2.07, which is half the ceiling and the number to compare
        // against when this starts drifting. It read 1.42 before the fetch
        // was taken out of the timing, and that was the composite's object
        // being three times the wire size rather than anything about the
        // decoders.
        //
        // What this does not do is catch the fold being removed, and an
        // earlier comment here said it did. Take the fold away and
        // `reduction_for` cannot fit fourteen thousand by seven thousand
        // points under the ceiling at all, so the decode returns an error
        // and the test stops on the line above rather than reaching any
        // ratio. The assertion that catches a lost fold is the grid
        // geometry a few lines down. This one catches the fold costing
        // more than it should, which is a different regression and the
        // reason the product is drawn from the folded grid at all.
        // Four is headroom over a measured two, not a derivation, and
        // saying otherwise was overclaiming: reading four source cells per
        // output cell is only one of the terms in this timing. The inflate
        // scales with the compressed object, which runs the other way here
        // (the composite's 1.69 MB against the shear's 563 kB), and the
        // section walk and the output allocation are the same on both
        // sides. That is why the number measured is 2.07 and not 4.
        assert!(
            decoded < coarse_decode * 4,
            "{id} took {decoded:?} to decode against the composite's {coarse_decode:?}, which is past the headroom over the two to one this measures"
        );
        // And a ceiling, so a machine slow enough to make the ratio
        // meaningless still says something. Deliberately far above what
        // either grid costs, because the ratio is the real assertion.
        assert!(
            decoded < std::time::Duration::from_secs(10),
            "{id} took {decoded:?} to decode"
        );
        assert!(
            drawn < std::time::Duration::from_millis(200),
            "{id} took {drawn:?} for one tile"
        );
    }
    clear_caches();
}

/// The whole point of the change: the fold is a decision, not a property
/// of the file.
///
/// The same bytes come back folded or as published depending only on how
/// many points the caller says it can hold, and the caller says that from
/// how close the reader is standing. A shear couplet is a few hundred
/// metres across, so a reader zoomed in on one is looking at the fold.
#[test]
fn the_same_file_folds_or_stays_whole_depending_on_what_was_asked_for() {
    let file = synthetic_grib(0, 41, 0, 4, 2, (4, 2), &[10, 20, 30, 40, 50, 60, 70, 80]);

    // Four points is all this caller can hold, so the grid is folded.
    let (folded, reduce) = decode_grib_to_fit(&file, 4).expect("a folded grid");
    assert_eq!(reduce, 2);
    assert_eq!((folded.columns, folded.rows), (2, 1));
    assert_eq!(folded.samples.len(), 2, "two columns by one row");

    // Eight, and the same bytes come back as the network published them.
    let (whole, reduce) = decode_grib_to_fit(&file, 8).expect("a whole grid");
    assert_eq!(reduce, 1);
    assert_eq!((whole.columns, whole.rows), (4, 2));
    assert_eq!(whole.samples, vec![10, 20, 30, 40, 50, 60, 70, 80]);

    // And it is the same ground: the folded grid's cells are twice as
    // wide and start half a source cell in, so the two cover the same
    // country rather than the finer one covering a quarter of it.
    assert!((f64::from(folded.d_lon as f32) - f64::from(whole.d_lon as f32) * 2.0).abs() < 1e-9);
    let folded_span = folded.d_lon * folded.columns as f64;
    let whole_span = whole.d_lon * whole.columns as f64;
    assert!((folded_span - whole_span).abs() < 1e-9);

    // The fold keeps the largest of each block, which is what makes it
    // safe on a maximum-over-a-window product: nothing a folded grid
    // reports is missing from the whole one.
    for value in &folded.samples {
        assert!(
            whole.samples.contains(value),
            "the fold invented a reading the file does not hold"
        );
    }
}

#[test]
fn a_grid_finer_than_the_one_this_app_draws_is_reduced_rather_than_refused() {
    // MRMS moved the rotation tracks to 0.005 degrees, four times the
    // cells, and every one of them was refused: a shipped layer drew
    // nothing at all with a log line for an explanation. Four times the
    // cells is also four times the resident memory in a cache that holds
    // one grid per product, so the grid is reduced on the way in.
    assert_eq!(reduction_for(7000, 3500, 7000 * 3500, 24_500_000), Some(1));
    assert_eq!(
        reduction_for(14000, 7000, 14000 * 7000, 24_500_000),
        Some(2)
    );
    // Odd axes cannot be folded in half, and a reduction that dropped a
    // partial row would move every point below it.
    assert_eq!(reduction_for(14001, 7000, 14001 * 7000, 24_500_000), None);
    // Still too big after the most this will do.
    assert_eq!(reduction_for(28000, 14000, 28000 * 14000, 24_500_000), None);
    assert_eq!(reduction_for(0, 10, 0, 24_500_000), None);
}

#[test]
fn a_reduced_grid_covers_the_same_ground_as_the_one_it_came_from() {
    // Anchored at the block's corner instead of its centre, the whole
    // field slides half a source cell north and west.
    let (north, west, d_lat, d_lon) = reduced_geometry(55.0, -130.0, 0.005, 0.005, 2);
    assert!((north - 54.9975).abs() < 1e-9, "north is {north}");
    assert!((west + 129.9975).abs() < 1e-9, "west is {west}");
    assert!((d_lat - 0.01).abs() < 1e-9);
    assert!((d_lon - 0.01).abs() < 1e-9);
    // A grid that already fits is left exactly alone.
    assert_eq!(
        reduced_geometry(55.0, -130.0, 0.01, 0.01, 1),
        (55.0, -130.0, 0.01, 0.01)
    );
}

#[test]
fn a_sample_spread_across_three_channels_is_read_back_whole() {
    // The flash flood grids are packed twenty-four bits wide, across an
    // RGB pixel rather than a grey one. Nothing offline covered this path
    // at all: reversing the channel order left every test in the crate
    // passing, and a grid read blue-first is a picture of nothing.
    // The low byte, the middle byte, the packed reading behind the
    // 137.64 percent this family peaked at on 2026-09-02, and the widest
    // sample sixteen bits still holds.
    let png_bytes = rgb_png(4, 1, &[0x00_00_01, 0x00_01_00, 0x00_35_C4, 0x00_FF_FF]);
    let (samples, shift) =
        decode_png_samples(&png_bytes, 4, 4, 1, MAX_GRID_POINTS).expect("a wide grid");
    assert_eq!(shift, 0, "nothing here needs narrowing");
    assert_eq!(samples, vec![1, 256, 13_764, 65_535]);
}

#[test]
fn a_wide_grid_is_narrowed_by_as_little_as_it_needs() {
    // Sixteen bits is what every grid in the cache holds, and a fixed
    // shift of eight would have quantised the flash flood ratios to two
    // and a half percentage points, straddling the hundred percent line
    // the product is read against. Their samples fit in sixteen bits, so
    // nothing is lost; a grid that genuinely uses the range loses only
    // what it has to.
    //
    // 13764 is the packed reading behind the 137.64 percent this grid
    // family peaked at on 2026-09-02.
    let narrow = rgb_png(2, 1, &[13_764, 65_535]);
    let (samples, shift) =
        decode_png_samples(&narrow, 2, 2, 1, MAX_GRID_POINTS).expect("a wide grid");
    assert_eq!(shift, 0);
    assert_eq!(samples, vec![13_764, 65_535]);

    // One bit past what sixteen holds costs exactly one bit.
    let wide = rgb_png(2, 1, &[13_764, 65_536]);
    let (samples, shift) =
        decode_png_samples(&wide, 2, 2, 1, MAX_GRID_POINTS).expect("a wide grid");
    assert_eq!(shift, 1);
    assert_eq!(samples, vec![13_764 / 2, 32_768]);

    // And a genuinely twenty-four bit grid costs eight.
    let widest = rgb_png(2, 1, &[0x00_00_10, 0xFF_FF_FF]);
    let (samples, shift) =
        decode_png_samples(&widest, 2, 2, 1, MAX_GRID_POINTS).expect("a wide grid");
    assert_eq!(shift, 8);
    assert_eq!(samples, vec![0, 0xFF_FF]);
}

#[test]
fn a_wide_grid_reads_the_values_the_file_describes() {
    // End to end, because the shift is only half of it: the exponent has
    // to move by the same amount or every reading is out by a factor of
    // two hundred and fifty six. Setting the shift to zero and leaving
    // the fold in place left the whole crate passing.
    let samples = [0u16, 20_000, 40_000, 65_535];
    let grayscale = synthetic_grib(0, 41, 0, 2, 2, (2, 2), &samples);
    let from_grey = decode_grib(&grayscale).expect("a grayscale grid");

    // The same readings, packed one bit wider so the fold has to move.
    let wide_samples: Vec<u32> = samples.iter().map(|s| u32::from(*s) * 2).collect();
    let wide = synthetic_grib_rgb(2, 2, &wide_samples);
    let from_wide = decode_grib(&wide).expect("a wide grid");

    for row in 0..2 {
        for column in 0..2 {
            let grey = from_grey.value(row, column);
            let widened = from_wide.value(row, column);
            assert!(
                (grey - widened).abs() < 0.001,
                "grayscale {grey} against wide {widened}"
            );
        }
    }
}

#[test]
fn folding_a_grid_keeps_the_largest_value_in_each_block() {
    // These are maxima over a window: a rotation track is the strongest
    // rotation that passed over each square in an hour, and a hail swath
    // the largest stone. Taking one point of the four throws three
    // quarters of that on the floor, and the one it throws away is the
    // one somebody is looking for.
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 4, 4);
        encoder.set_color(png::ColorType::Grayscale);
        encoder.set_depth(png::BitDepth::Sixteen);
        let mut writer = encoder.write_header().expect("a header");
        // Four blocks of four. The largest of each is 60, 8, 200, 12, and
        // in every block it sits in a different corner.
        let samples: [u16; 16] = [
            60, 1, 2, 3, //
            4, 5, 6, 8, //
            7, 9, 10, 11, //
            200, 13, 12, 5,
        ];
        let raw: Vec<u8> = samples.iter().flat_map(|s| s.to_be_bytes()).collect();
        writer.write_image_data(&raw).expect("image data");
    }
    let (folded, shift) =
        decode_png_samples(&png_bytes, 16, 4, 2, MAX_GRID_POINTS).expect("a folded grid");
    assert_eq!(folded, vec![60, 8, 200, 12]);
    assert_eq!(shift, 0);

    // And a grid that needs no folding comes back exactly as it was.
    let (whole, _) =
        decode_png_samples(&png_bytes, 16, 4, 1, MAX_GRID_POINTS).expect("a whole grid");
    assert_eq!(whole.len(), 16);
    assert_eq!(whole[0], 60);
    assert_eq!(whole[12], 200);
}

#[test]
fn reads_a_well_formed_file_the_way_the_bucket_writes_them() {
    let bytes = synthetic_grib(0, 41, 0, 2, 2, (2, 2), &[9990, 10240, 10490, 0]);
    let grid = decode_grib(&bytes).expect("a file in the shape MRMS publishes");
    assert_eq!((grid.columns, grid.rows), (2, 2));
    assert_eq!(grid.value(0, 1), 25.0);
    // Eastward longitudes are turned into the signed degrees the map uses.
    assert!((grid.west + 129.995).abs() < 1e-6, "west is {}", grid.west);
    assert!((grid.north - 54.995).abs() < 1e-6);
}

#[test]
fn refuses_a_file_packed_a_way_it_cannot_read() {
    let samples = [9990u16, 10240, 10490, 0];
    // Simple packing rather than the PNG the reader is built around.
    let simple = synthetic_grib(0, 40, 0, 2, 2, (2, 2), &samples);
    assert!(
        matches!(decode_grib(&simple), Err(MrmsError::Unsupported(_))),
        "template 40 should be refused, not read as if it were 41"
    );
    // A projection other than plain latitude and longitude.
    let lambert = synthetic_grib(30, 41, 0, 2, 2, (2, 2), &samples);
    assert!(matches!(
        decode_grib(&lambert),
        Err(MrmsError::Unsupported(_))
    ));
    // A scan that runs the other way would draw the country upside down.
    let flipped = synthetic_grib(0, 41, 0b0100_0000, 2, 2, (2, 2), &samples);
    assert!(matches!(
        decode_grib(&flipped),
        Err(MrmsError::Unsupported(_))
    ));
    // And a grid whose image holds the wrong number of values.
    // A grid that says four by four but ships a two by two image.
    let short = synthetic_grib(0, 41, 0, 4, 4, (2, 2), &samples);
    assert!(matches!(decode_grib(&short), Err(MrmsError::Decode(_))));

    let oversized = synthetic_grib(0, 41, 0, 10_000, 10_000, (2, 2), &samples);
    assert!(matches!(decode_grib(&oversized), Err(MrmsError::Decode(_))));

    let mut nonfinite = synthetic_grib(0, 41, 0, 2, 2, (2, 2), &samples);
    let section5 = 16 + 72;
    nonfinite[section5 + 11..section5 + 15].copy_from_slice(&f32::NAN.to_be_bytes());
    assert!(matches!(decode_grib(&nonfinite), Err(MrmsError::Decode(_))));
}

#[test]
fn refuses_truncated_sections_and_decompression_overruns() {
    let mut truncated = b"GRIB\0\0\xd1\x02".to_vec();
    truncated.extend_from_slice(&0u64.to_be_bytes());
    truncated.extend_from_slice(&5u32.to_be_bytes());
    truncated.push(3);
    truncated.extend_from_slice(b"7777");
    assert!(matches!(decode_grib(&truncated), Err(MrmsError::Decode(_))));

    assert!(read_bounded(Cursor::new([1u8, 2, 3, 4]), 4).is_ok());
    assert!(matches!(
        read_bounded(Cursor::new([1u8, 2, 3, 4, 5]), 4),
        Err(MrmsError::Decode(_))
    ));
}

/// Writes what the `mrms_grib` fuzz target starts from.
///
/// Three length arithmetics stacked on each other: the gzip wrapper, the
/// GRIB2 section chain, and a PNG-packed data section. A fuzzer that has
/// to invent a valid PNG before it reaches the third one will spend its
/// whole session on the first, so it is handed one that decodes.
///
/// Ignored, because it writes files rather than checking anything. Run it
/// when the builder changes:
/// `cargo test --lib mrms::tests::writes -- --ignored`
#[test]
#[ignore = "writes the fuzz seed corpus rather than checking anything"]
fn writes_the_fuzz_seed_corpus() {
    let into = std::path::Path::new("fuzz/seeds/mrms_grib");
    std::fs::create_dir_all(into).expect("a corpus directory");
    let samples = [9990u16, 10240, 10490, 0];

    // One that reads, and one of each shape the reader refuses, so the
    // fuzzer starts on both sides of every branch rather than one.
    let good = synthetic_grib(0, 41, 0, 2, 2, (2, 2), &samples);
    std::fs::write(into.join("png-packed"), &good).expect("a seed");
    std::fs::write(
        into.join("simple-packed"),
        synthetic_grib(0, 40, 0, 2, 2, (2, 2), &samples),
    )
    .expect("a seed");
    std::fs::write(
        into.join("lambert"),
        synthetic_grib(30, 41, 0, 2, 2, (2, 2), &samples),
    )
    .expect("a seed");
    std::fs::write(
        into.join("image-too-small"),
        synthetic_grib(0, 41, 0, 4, 4, (2, 2), &samples),
    )
    .expect("a seed");
    std::fs::write(into.join("half-a-grib"), &good[..good.len() / 2]).expect("a seed");
}

#[test]
fn a_grib_that_is_not_one_is_refused_rather_than_guessed_at() {
    assert!(matches!(
        decode_grib(b"not a grib"),
        Err(MrmsError::NotGrib)
    ));
    let mut header = b"GRIB\0\0\xd1\x01".to_vec();
    header.resize(32, 0);
    assert!(matches!(decode_grib(&header), Err(MrmsError::NotGrib)));
}

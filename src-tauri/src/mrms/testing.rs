//! The grids, the files and the counting the tests are written on.
//!
//! Shared because more than one of them is written on the same
//! fixture, and a fixture copied into two files drifts.

use super::*;

/// The grid cache, the tile cache, and the fetch counters are all shared,
/// so the live tests that touch them have to take turns. A panicking test
/// poisons this; the next one carries on rather than failing for a reason
/// that has nothing to do with it.
pub(crate) static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

pub(crate) fn live_test() -> std::sync::MutexGuard<'static, ()> {
    ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(|held| held.into_inner())
}

pub(crate) fn grid() -> Grid {
    // Four cells covering a degree, packed the way MRMS packs dBZ.
    Grid {
        columns: 2,
        rows: 2,
        north: 41.0,
        west: -94.0,
        d_lat: 0.5,
        d_lon: 0.5,
        reference: -9990.0,
        binary: 0,
        decimal: 1,
        samples: vec![9990, 10240, 10490, 0],
    }
}

/// A five by four grid at a whole degree a cell, values that name their
/// own row and column so a cut can be checked cell by cell.
pub(crate) fn countable_grid() -> Grid {
    let columns = 5;
    let rows = 4;
    let mut samples = Vec::with_capacity(columns * rows);
    for row in 0..rows {
        for column in 0..columns {
            // value = sample / 10, so 10 * (row * 10 + column) reads back
            // as row * 10 + column.
            samples.push(((row * 10 + column) * 10) as u16);
        }
    }
    Grid {
        columns,
        rows,
        north: 40.0,
        west: -100.0,
        d_lat: 1.0,
        d_lon: 1.0,
        reference: 0.0,
        binary: 0,
        decimal: 1,
        samples,
    }
}

/// Builds the smallest file the walker will accept, so each guard can be
/// tried against a file that is otherwise perfectly good.
pub(crate) fn synthetic_grib(
    grid_template: u16,
    drt_template: u16,
    scan_mode: u8,
    columns: u32,
    rows: u32,
    image: (u32, u32),
    samples: &[u16],
) -> Vec<u8> {
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, image.0, image.1);
        encoder.set_color(png::ColorType::Grayscale);
        encoder.set_depth(png::BitDepth::Sixteen);
        let mut writer = encoder.write_header().expect("a header");
        let raw: Vec<u8> = samples.iter().flat_map(|s| s.to_be_bytes()).collect();
        writer.write_image_data(&raw).expect("image data");
    }

    wrap_grib(
        grid_template,
        drt_template,
        scan_mode,
        columns,
        rows,
        &png_bytes,
    )
}

/// The same file with a twenty-four bit RGB data section, and a binary
/// exponent one lower so the readings match the grayscale build's.
pub(crate) fn synthetic_grib_rgb(columns: u32, rows: u32, samples: &[u32]) -> Vec<u8> {
    let png_bytes = rgb_png(columns, rows, samples);
    let mut out = wrap_grib(0, 41, 0, columns, rows, &png_bytes);
    // Section 5's binary exponent sits at a fixed offset, since
    // `wrap_grib` writes the sections before it at fixed sizes. GRIB
    // writes a signed integer as a sign bit plus magnitude, so minus one
    // is 0x8001 rather than two's complement.
    let at = 16 + 72 + 15;
    out[at..at + 2].copy_from_slice(&0x8001u16.to_be_bytes());
    out
}

pub(crate) fn wrap_grib(
    grid_template: u16,
    drt_template: u16,
    scan_mode: u8,
    columns: u32,
    rows: u32,
    png_bytes: &[u8],
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"GRIB");
    out.extend_from_slice(&[0, 0, 209, 2]);
    out.extend_from_slice(&0u64.to_be_bytes());

    let mut section3 = vec![0u8; 72];
    section3[0..4].copy_from_slice(&72u32.to_be_bytes());
    section3[4] = 3;
    section3[12..14].copy_from_slice(&grid_template.to_be_bytes());
    section3[30..34].copy_from_slice(&columns.to_be_bytes());
    section3[34..38].copy_from_slice(&rows.to_be_bytes());
    // 54.995 N, 230.005 E, hundredths of a degree apart.
    section3[46..50].copy_from_slice(&54_995_000i32.to_be_bytes());
    section3[50..54].copy_from_slice(&230_005_000u32.to_be_bytes());
    section3[63..67].copy_from_slice(&10_000u32.to_be_bytes());
    section3[67..71].copy_from_slice(&10_000u32.to_be_bytes());
    section3[71] = scan_mode;
    out.extend_from_slice(&section3);

    let mut section5 = vec![0u8; 21];
    section5[0..4].copy_from_slice(&21u32.to_be_bytes());
    section5[4] = 5;
    section5[5..9].copy_from_slice(&(columns * rows).to_be_bytes());
    section5[9..11].copy_from_slice(&drt_template.to_be_bytes());
    section5[11..15].copy_from_slice(&(-9990f32).to_be_bytes());
    section5[15..17].copy_from_slice(&0i16.to_be_bytes());
    section5[17..19].copy_from_slice(&1i16.to_be_bytes());
    section5[19] = 16;
    out.extend_from_slice(&section5);

    let mut section7 = Vec::new();
    section7.extend_from_slice(&((png_bytes.len() + 5) as u32).to_be_bytes());
    section7.push(7);
    section7.extend_from_slice(png_bytes);
    out.extend_from_slice(&section7);

    out.extend_from_slice(b"7777");
    out
}

/// The grid the decoder itself would produce from this one.
///
/// Built its way rather than by hand, because the two halves of "the same
/// ground" are easy to get wrong: the largest of each block, and the
/// geometry `reduced_geometry` gives, which puts the first centre half a
/// source cell in from the corner. A hand-written coarse grid sharing the
/// fine one's corner is a different piece of the world, and a test built
/// on one proves nothing about the export it is checking.
pub(crate) fn folded_like_the_decoder(fine: &Grid, fold: usize) -> Grid {
    let (north, west, d_lat, d_lon) =
        reduced_geometry(fine.north, fine.west, fine.d_lat, fine.d_lon, fold);
    let (columns, rows) = (fine.columns / fold, fine.rows / fold);
    let mut samples = Vec::with_capacity(columns * rows);
    for row in 0..rows {
        for column in 0..columns {
            let mut most = 0u16;
            for down in 0..fold {
                for across in 0..fold {
                    let at = (row * fold + down) * fine.columns + column * fold + across;
                    most = most.max(fine.samples[at]);
                }
            }
            samples.push(most);
        }
    }
    Grid {
        columns,
        rows,
        north,
        west,
        d_lat,
        d_lon,
        reference: fine.reference,
        binary: fine.binary,
        decimal: fine.decimal,
        samples,
    }
}

/// A grid whose cells count up, so a fold is visible in the numbers.
pub(crate) fn ramp_grid(columns: usize, rows: usize, step: f64) -> Grid {
    Grid {
        columns,
        rows,
        north: 40.1,
        west: -94.0,
        d_lat: step,
        d_lon: step,
        reference: 0.0,
        binary: 0,
        decimal: 0,
        // Every cell its own number, so the largest of a block is a
        // particular cell rather than any of them. Written block-constant
        // once, and a fold that read half a block was then invisible: the
        // half it read held the same value as the half it skipped.
        samples: (0..columns * rows)
            .map(|at| ((at / columns) * 100 + at % columns) as u16)
            .collect(),
    }
}

/// A 24-bit sample spread across an RGB pixel, most significant byte
/// first, which is how the flash flood grids are packed.
pub(crate) fn rgb_png(width: u32, height: u32, samples: &[u32]) -> Vec<u8> {
    let mut png_bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().expect("a header");
    let raw: Vec<u8> = samples
        .iter()
        .flat_map(|value| {
            [
                ((value >> 16) & 0xff) as u8,
                ((value >> 8) & 0xff) as u8,
                (value & 0xff) as u8,
            ]
        })
        .collect();
    writer.write_image_data(&raw).expect("image data");
    drop(writer);
    png_bytes
}

/// A block of live cells over the plains, for the zoom tests below.
pub(crate) fn solid_block() -> Grid {
    Grid {
        columns: 100,
        rows: 100,
        north: 41.5,
        west: -94.5,
        d_lat: 0.01,
        d_lon: 0.01,
        reference: -9990.0,
        binary: 0,
        decimal: 1,
        samples: vec![10_500; 100 * 100],
    }
}

pub(crate) fn painted_count(grid: &Grid, entry: &MrmsProduct, zoom: u32, x: u32, y: u32) -> usize {
    tile_pixels(
        grid,
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
        pixels
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| p[3] > 0)
            .count()
    })
    .unwrap_or(0)
}

/// The tile covering a point at a zoom, which is how a viewer gets there.
pub(crate) fn tile_of(latitude: f64, longitude: f64, zoom: u32) -> (u32, u32) {
    let scale = 2f64.powi(zoom as i32);
    let x = ((longitude + 180.0) / 360.0 * scale) as u32;
    let mercator = mercator_of(latitude);
    let y = ((1.0 - mercator / std::f64::consts::PI) / 2.0 * scale) as u32;
    (x, y)
}

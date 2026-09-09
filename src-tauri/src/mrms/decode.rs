//! GRIB2 template 41 to a grid of samples.
//!
//! The payload is a plain 16-bit PNG and a linear scale, so the decode
//! needs no GRIB maths beyond the headers. What is here besides that is
//! the bounds: a file may not decompress past a ceiling, and a grid
//! finer than the one this app draws is reduced rather than refused.

use super::*;

/// Walks the GRIB2 sections for the grid definition, the packing parameters,
/// and the PNG the data lives in. Only what OpenRadar reads is understood; a
/// file packed any other way is refused rather than guessed at.
#[cfg(any(test, feature = "fuzzing"))]
pub fn decode_grib(bytes: &[u8]) -> Result<Grid, MrmsError> {
    decode_grib_to_fit(bytes, MAX_GRID_POINTS).map(|(grid, _)| grid)
}

/// The same decode, told how many points it is allowed to keep.
///
/// The ceiling is what decides whether a finer grid is folded on the way in or
/// kept as published: a reader zoomed past the point the fold shows asks for
/// the whole thing, and everybody else gets the grid this app draws at. The
/// reduction is handed back with the grid because the cache has to know
/// whether what it is holding can answer the next request for detail.
pub fn decode_grib_to_fit(bytes: &[u8], ceiling: usize) -> Result<(Grid, usize), MrmsError> {
    if bytes.len() < 16 || &bytes[0..4] != b"GRIB" || bytes[7] != 2 {
        return Err(MrmsError::NotGrib);
    }

    let mut at = 16usize;
    let mut geometry: Option<(usize, usize, f64, f64, f64, f64)> = None;
    let mut packing: Option<(f32, i16, i16)> = None;
    let mut payload: Option<&[u8]> = None;

    while at + 5 <= bytes.len() {
        if &bytes[at..at + 4] == b"7777" {
            break;
        }
        let length = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let Some(end) = at.checked_add(length) else {
            return Err(MrmsError::NotGrib);
        };
        if length < 5 || end > bytes.len() {
            return Err(MrmsError::NotGrib);
        }
        let section = &bytes[at..end];

        match section[4] {
            3 => {
                if section.len() < 72 {
                    return Err(MrmsError::Decode("the grid definition is truncated".into()));
                }
                let template = u16::from_be_bytes([section[12], section[13]]);
                if template != 0 {
                    return Err(MrmsError::Unsupported(format!(
                        "grid definition template {template}"
                    )));
                }
                let columns = u32::from_be_bytes(section[30..34].try_into().unwrap()) as usize;
                let rows = u32::from_be_bytes(section[34..38].try_into().unwrap()) as usize;
                let north = i32::from_be_bytes(section[46..50].try_into().unwrap()) as f64 / 1e6;
                let west = u32::from_be_bytes(section[50..54].try_into().unwrap()) as f64 / 1e6;
                let d_lon = u32::from_be_bytes(section[63..67].try_into().unwrap()) as f64 / 1e6;
                let d_lat = u32::from_be_bytes(section[67..71].try_into().unwrap()) as f64 / 1e6;
                let scan_mode = section[71];
                let points = columns
                    .checked_mul(rows)
                    .ok_or_else(|| MrmsError::Decode("the grid dimensions overflowed".into()))?;
                // A grid finer than the one this app draws at is reduced on
                // the way in rather than refused; anything that no allowed
                // reduction can fit is still refused here, before a byte of
                // it is read.
                if reduction_for(columns, rows, points, ceiling).is_none() {
                    return Err(MrmsError::Decode(format!(
                        "the grid claims {columns} by {rows} points"
                    )));
                }
                if !(-90.0..=90.0).contains(&north)
                    || d_lat <= 0.0
                    || d_lat > 10.0
                    || d_lon <= 0.0
                    || d_lon > 10.0
                {
                    return Err(MrmsError::Decode(
                        "the grid geometry is outside geographic bounds".into(),
                    ));
                }
                // Bit 1 set means west to east, bit 2 clear means north to
                // south. Anything else would be drawn upside down or mirrored.
                if scan_mode & 0b1100_0000 != 0 {
                    return Err(MrmsError::Unsupported(format!("scan mode {scan_mode}")));
                }
                // The bucket publishes eastward longitudes; the map works in
                // signed degrees.
                let west = if west > 180.0 { west - 360.0 } else { west };
                if !(-180.0..=180.0).contains(&west) {
                    return Err(MrmsError::Decode(
                        "the grid longitude is outside geographic bounds".into(),
                    ));
                }
                geometry = Some((columns, rows, north, west, d_lat, d_lon));
            }
            5 => {
                if section.len() < 19 {
                    return Err(MrmsError::Decode(
                        "the packing parameters are truncated".into(),
                    ));
                }
                let template = u16::from_be_bytes([section[9], section[10]]);
                if template != 41 {
                    return Err(MrmsError::Unsupported(format!(
                        "data representation template {template}"
                    )));
                }
                let reference = f32::from_be_bytes(section[11..15].try_into().unwrap());
                let binary = i16::from_be_bytes(section[15..17].try_into().unwrap());
                let decimal = i16::from_be_bytes(section[17..19].try_into().unwrap());
                packing = Some((reference, grib::signed(binary), grib::signed(decimal)));
            }
            7 => payload = Some(&section[5..]),
            _ => {}
        }
        at += length;
    }

    let (columns, rows, north, west, d_lat, d_lon) =
        geometry.ok_or_else(|| MrmsError::Unsupported("no grid definition".into()))?;
    let (reference, binary, decimal) =
        packing.ok_or_else(|| MrmsError::Unsupported("no packing parameters".into()))?;
    let payload = payload.ok_or_else(|| MrmsError::Unsupported("no data section".into()))?;
    let points = columns
        .checked_mul(rows)
        .ok_or_else(|| MrmsError::Decode("the grid dimensions are invalid".into()))?;
    let reduce = reduction_for(columns, rows, points, ceiling)
        .ok_or_else(|| MrmsError::Decode("the grid dimensions are invalid".into()))?;
    // A grid packed wider than sixteen bits comes back shifted down to
    // sixteen, and the binary exponent is moved by the same amount so the
    // values it produces are unchanged. See `decode_png_samples`.
    let (samples, shift) = decode_png_samples(payload, points, columns, reduce, ceiling)?;
    let binary = binary
        .checked_add(shift)
        .ok_or_else(|| MrmsError::Decode("the packing scale is out of range".into()))?;

    // Checked on the exponent that will actually be used to read the values,
    // not the one the file declared. A wide grid declaring an exponent just
    // inside the finite range passed this and then evaluated to infinity in
    // every cell once the shift moved it past 2^127.
    let binary_scale = 2f32.powi(binary as i32);
    let decimal_scale = 10f32.powi(decimal as i32);
    if !reference.is_finite()
        || !binary_scale.is_finite()
        || binary_scale == 0.0
        || !decimal_scale.is_finite()
        || decimal_scale == 0.0
    {
        return Err(MrmsError::Decode("the packing scale is not finite".into()));
    }

    let (north, west, d_lat, d_lon) = reduced_geometry(north, west, d_lat, d_lon, reduce);
    Ok((
        Grid {
            columns: columns / reduce,
            rows: rows / reduce,
            north,
            west,
            d_lat,
            d_lon,
            reference,
            binary,
            decimal,
            samples,
        },
        reduce,
    ))
}

/// How much to shrink a grid by so it fits what this app draws at, or None
/// when nothing allowed would make it fit.
///
/// One means it already fits. Anything above that has to divide both axes
/// exactly: a reduction that dropped a partial row or column would move every
/// point below it, which is worse than refusing the grid.
pub(crate) fn reduction_for(
    columns: usize,
    rows: usize,
    points: usize,
    ceiling: usize,
) -> Option<usize> {
    if columns == 0 || rows == 0 {
        return None;
    }
    for reduce in 1..=MAX_SOURCE_REDUCTION {
        if !columns.is_multiple_of(reduce) || !rows.is_multiple_of(reduce) {
            continue;
        }
        if points / (reduce * reduce) <= ceiling {
            return Some(reduce);
        }
    }
    None
}

/// Where a reduced grid's first point sits and how far apart its points are.
///
/// The reduced grid covers the same ground, so its first point stands at the
/// centre of the block it was folded from rather than at that block's corner.
/// Anchored at the corner the whole field slides half a source cell north and
/// west, which on the finer grids is a few hundred metres of storm.
pub(crate) fn reduced_geometry(
    north: f64,
    west: f64,
    d_lat: f64,
    d_lon: f64,
    reduce: usize,
) -> (f64, f64, f64, f64) {
    let offset = (reduce - 1) as f64 / 2.0;
    (
        north - offset * d_lat,
        west + offset * d_lon,
        d_lat * reduce as f64,
        d_lon * reduce as f64,
    )
}

/// GRIB writes a signed integer as a sign bit plus magnitude, not two's
/// complement, so a negative exponent read the usual way comes out enormous.
/// Reads the packed image, shrinking it by `reduce` in each axis as it goes.
///
/// Row by row, so a grid four times the size of the one this app draws never
/// exists in memory whole: the cost is the reduced grid plus the decoder's own
/// row buffer. The reduction keeps the LARGEST value in each block, which is
/// the only safe choice here. These grids are maxima over a window, and the
/// alternative, taking one point of the four, drops three quarters of a
/// rotation track or a hail swath on the floor. Sampling is on the packed
/// values rather than the scaled ones, which is the same answer: the scale is
/// a positive multiplier and a positive offset, so it cannot change which of
/// two samples is larger, and the smallest sample is what "no data" packs to.
pub(crate) fn decode_png_samples(
    payload: &[u8],
    expected: usize,
    columns: usize,
    reduce: usize,
    ceiling: usize,
) -> Result<(Vec<u16>, i16), MrmsError> {
    // The ceiling is on the SOURCE image, which is up to a reduction squared
    // larger than what is kept. It is a limit rather than an allocation.
    let limits = png::Limits {
        bytes: GRID_BYTES
            .saturating_mul(MAX_SOURCE_REDUCTION)
            .saturating_mul(MAX_SOURCE_REDUCTION),
    };
    let decoder = png::Decoder::new_with_limits(Cursor::new(payload), limits);
    let mut reader = decoder
        .read_info()
        .map_err(|error| MrmsError::Decode(error.to_string()))?;
    let info = reader.info();
    let (color_type, bit_depth) = (info.color_type, info.bit_depth);
    let image_points = (info.width as usize)
        .checked_mul(info.height as usize)
        .ok_or_else(|| MrmsError::Decode("the image dimensions overflowed".into()))?;
    if image_points != expected || image_points / (reduce * reduce) > ceiling {
        return Err(MrmsError::Decode(format!(
            "the image holds {image_points} values, the grid wants {expected}"
        )));
    }
    // Grayscale carries eight or sixteen bits a point. The flash flood grids
    // want twenty-four, and the packing spreads those across an RGB pixel,
    // most significant byte first. Nothing else is a picture in any sense.
    let wide: bool = match (color_type, bit_depth) {
        (png::ColorType::Grayscale, png::BitDepth::Eight | png::BitDepth::Sixteen) => false,
        // Kept as sixteen bits, which is what every grid in the cache
        // is; a wider sample would double the memory of every product. How
        // much has to go is worked out from the grid rather than assumed:
        // most twenty-four bit grids do not use the range, and the flash
        // flood ratios published on 2026-09-02 fit in sixteen bits exactly,
        // so nothing is lost at all. See `fold_to_sixteen_bits`.
        (png::ColorType::Rgb, png::BitDepth::Eight) => true,
        _ => {
            return Err(MrmsError::Unsupported(format!(
                "a {color_type:?} {bit_depth:?} bit image"
            )))
        }
    };

    let kept_columns = columns / reduce;
    // Held wide enough for the widest sample this reads, and narrowed once at
    // the end by however much the grid actually turns out to need.
    let mut samples: Vec<u32> = Vec::with_capacity(expected / (reduce * reduce));
    // The row being built, held across the `reduce` source rows that fold into
    // it. Empty between them, which is what says a new one has to be started.
    let mut folded: Vec<u32> = Vec::new();
    let mut source_row = 0usize;
    let mut line_values: Vec<u32> = Vec::new();
    while let Some(line) = reader
        .next_row()
        .map_err(|error| MrmsError::Decode(error.to_string()))?
    {
        let bytes = line.data();
        line_values.clear();
        match (color_type, bit_depth) {
            (png::ColorType::Grayscale, png::BitDepth::Sixteen) => {
                for pair in bytes.as_chunks::<2>().0 {
                    line_values.push(u32::from(u16::from_be_bytes([pair[0], pair[1]])));
                }
            }
            (png::ColorType::Grayscale, png::BitDepth::Eight) => {
                line_values.extend(bytes.iter().map(|value| u32::from(*value)));
            }
            (png::ColorType::Rgb, png::BitDepth::Eight) => {
                // Most significant byte first, which is how the packing
                // spreads a sample wider than one channel.
                for pixel in bytes.as_chunks::<3>().0 {
                    line_values.push(
                        (u32::from(pixel[0]) << 16)
                            | (u32::from(pixel[1]) << 8)
                            | u32::from(pixel[2]),
                    );
                }
            }
            _ => {
                return Err(MrmsError::Unsupported(format!(
                    "a {color_type:?} {bit_depth:?} bit image"
                )))
            }
        }
        if line_values.len() != columns {
            return Err(MrmsError::Decode(format!(
                "a row holds {} values, the grid wants {columns}",
                line_values.len()
            )));
        }

        if source_row.is_multiple_of(reduce) {
            folded.clear();
            folded.resize(kept_columns, u32::MIN);
        }
        for (at, value) in line_values.iter().enumerate() {
            let into = at / reduce;
            if into < kept_columns {
                folded[into] = folded[into].max(*value);
            }
        }
        source_row += 1;
        if source_row.is_multiple_of(reduce) {
            samples.extend_from_slice(&folded);
        }
    }

    let wanted = expected / (reduce * reduce);
    if source_row != expected / columns || samples.len() != wanted {
        return Err(MrmsError::Decode(format!(
            "the image holds {} values, the grid wants {wanted}",
            samples.len()
        )));
    }
    Ok(fold_to_sixteen_bits(samples, wide))
}

/// Narrows samples to the sixteen bits every grid in the cache holds, by as
/// little as the grid turns out to need.
///
/// A sample wider than sixteen bits has to lose something, and how much is
/// worth working out rather than assuming: a fixed shift of eight would have
/// quantised the flash flood ratios to two and a half percentage points,
/// across the hundred percent line the whole product is read against. Their
/// grids do not use the range they are packed in, so in practice nothing is
/// lost at all.
///
/// The shift comes back with the samples and the caller moves the binary
/// exponent by the same amount, which is what keeps the values the file
/// describes.
pub(crate) fn fold_to_sixteen_bits(samples: Vec<u32>, wide: bool) -> (Vec<u16>, i16) {
    if !wide {
        // Nothing above sixteen bits can be in here at all.
        return (samples.into_iter().map(|value| value as u16).collect(), 0);
    }
    let peak = samples.iter().copied().max().unwrap_or(0);
    let mut shift: i16 = 0;
    while (peak >> shift) > u32::from(u16::MAX) {
        shift += 1;
    }
    (
        samples
            .into_iter()
            .map(|value| (value >> shift) as u16)
            .collect(),
        shift,
    )
}

pub(crate) fn gunzip(bytes: &[u8]) -> Result<Vec<u8>, MrmsError> {
    read_bounded(flate2::read::GzDecoder::new(bytes), MAX_DECOMPRESSED_BYTES)
}

pub(crate) fn read_bounded(reader: impl Read, limit: usize) -> Result<Vec<u8>, MrmsError> {
    let mut out = Vec::new();
    reader
        .take(limit.saturating_add(1) as u64)
        .read_to_end(&mut out)
        .map_err(|error| MrmsError::Decode(error.to_string()))?;
    if out.len() > limit {
        return Err(MrmsError::Decode(format!(
            "the decompressed grid exceeds {limit} bytes"
        )));
    }
    Ok(out)
}

#[cfg(test)]
#[path = "decode_tests.rs"]
mod tests;

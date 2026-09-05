//! One sweep as pixels: the sampling, the shading and the PNG.

use super::*;

/// Paints one sweep into a Web Mercator RGBA image over the site's own extent.
/// How a sweep is to be drawn, as opposed to what is in it.
///
/// Three separate answers to the same question, which had been travelling as
/// loose positional arguments: whether the velocity has been unfolded, what to
/// hide, and which ramps to use. Two of them are bare booleans, so a call site
/// reading `false, false` said nothing about which was which.
#[derive(Clone, Copy)]
pub struct Shading {
    /// True when the velocity in this sweep has been unfolded past the
    /// radar's own limit, which decides how wide a scale it is drawn on.
    pub unfolded: bool,
    /// Hide anything weaker than this, in the product's own unit.
    pub threshold: Option<f32>,
    /// Draw with the ramps built for a reader who asked for more contrast.
    pub high_contrast: bool,
}

pub fn render_sweep(
    field: &SweepField,
    coordinates: &RadarCoordinateSystem,
    product: Product,
    unit: &str,
    shading: Shading,
    // Read between neighbouring gates rather than taking the nearest one. A
    // separate argument rather than a field on `Shading` because it is not
    // shading: it changes which reading a pixel is drawn from, and the
    // inspector, the export and the cross section all deliberately keep
    // taking the nearest gate whatever this says.
    smooth: bool,
) -> (Vec<u8>, [f64; 4]) {
    // A loaded colour table replaces the built-in ramp for the product it says
    // it is for, and nothing else. That is the whole point of loading one: two
    // people comparing the same storm see the same colours.
    let table = palette::for_unit(unit);
    let extent = coordinates.sweep_extent(MAX_RANGE_KM);
    let west = extent.min.longitude;
    let east = extent.max.longitude;
    let south = extent.min.latitude;
    let north = extent.max.latitude;

    let top = mercator_y(north);
    let bottom = mercator_y(south);
    let elevation = field.elevation_degrees();

    // A generic moment has no standard ramp, so it is scaled to what it holds.
    let range = match product {
        Product::Reflectivity | Product::Velocity => None,
        _ => field.value_range(),
    };

    let mut pixels = vec![0u8; IMAGE_SIZE * IMAGE_SIZE * 4];
    for row in 0..IMAGE_SIZE {
        let y = top + (bottom - top) * ((row as f64 + 0.5) / IMAGE_SIZE as f64);
        let latitude = inverse_mercator_y(y);
        for column in 0..IMAGE_SIZE {
            let longitude = west + (east - west) * ((column as f64 + 0.5) / IMAGE_SIZE as f64);
            let polar = coordinates.geo_to_polar(
                GeoPoint {
                    latitude,
                    longitude,
                },
                elevation,
            );
            let sample = if smooth {
                smoothed_gate(field, product, polar.azimuth_degrees, polar.range_km)
            } else {
                field.value_at_polar(polar.azimuth_degrees, polar.range_km)
            };
            let Some((value, status)) = sample else {
                continue;
            };

            let Some((color, alpha)) =
                gate_color(&status, value, product, table.as_ref(), range, shading)
            else {
                continue;
            };

            let at = (row * IMAGE_SIZE + column) * 4;
            pixels[at] = color[0];
            pixels[at + 1] = color[1];
            pixels[at + 2] = color[2];
            pixels[at + 3] = alpha;
        }
    }

    (pixels, [west, south, east, north])
}

/// The two radials either side of an angle, and how far between them it is.
///
/// The radials of a sweep are not evenly spaced: the antenna turns at whatever
/// speed the pattern asks for and the angles come back as they were measured,
/// so the gap is taken from the two angles themselves rather than assumed.
/// Ascending and wrapping, so the pair either side of due north is the last
/// radial and the first.
pub(crate) fn bracketing_radials(azimuths: &[f32], angle: f32) -> Option<(usize, usize, f32)> {
    let count = azimuths.len();
    if count == 0 {
        return None;
    }
    if count == 1 {
        return Some((0, 0, 0.0));
    }
    let after = azimuths.partition_point(|&each| each <= angle);
    let upper = after % count;
    let lower = (after + count - 1) % count;
    let wrapped = |from: f32, to: f32| {
        let gap = to - from;
        if gap < 0.0 {
            gap + 360.0
        } else {
            gap
        }
    };
    let span = wrapped(azimuths[lower], azimuths[upper]);
    if span <= 0.0 {
        return Some((lower, upper, 0.0));
    }
    let into = wrapped(azimuths[lower], angle) / span;
    Some((lower, upper, into.clamp(0.0, 1.0)))
}

/// A reading taken between the gates around it rather than from the nearest.
///
/// Bilinear in the radar's own space, which is the only place it is honest: a
/// gate is a wedge that grows with range, and averaging in the picture's
/// square pixels would blur a distant gate's whole wedge and barely touch a
/// near one. Two rules keep it from saying anything the radar did not.
///
/// Nothing is drawn where the nearest gate is not a reading. A gate below the
/// threshold, a gate with no data and a range-folded gate all answer exactly
/// what they answer unsmoothed, so no colour appears where the radar was
/// silent and a folded gate keeps its own colour rather than being averaged
/// into the weather beside it.
///
/// And on velocity, a neighbourhood that crosses zero is left alone. The sign
/// boundary in a couplet is the signal; interpolating across it paints a band
/// of calm air down the middle of a rotation.
pub(crate) fn smoothed_gate(
    field: &SweepField,
    product: Product,
    azimuth_degrees: f32,
    range_km: f64,
) -> Option<(f32, GateStatus)> {
    let nearest = field.value_at_polar(azimuth_degrees, range_km)?;
    if nearest.1 != GateStatus::Valid {
        return Some(nearest);
    }

    let interval = field.gate_interval_km();
    if interval <= 0.0 {
        return Some(nearest);
    }
    // Gate centres sit half an interval past the edge the index counts from.
    let along = (range_km - field.first_gate_range_km()) / interval - 0.5;
    let first = along.floor();
    let into_gate = (along - first) as f32;
    let gates = field.gate_count();
    let (lower_radial, upper_radial, into_radial) =
        bracketing_radials(field.azimuths(), azimuth_degrees)?;

    let mut total = 0.0f32;
    let mut weight = 0.0f32;
    let mut crosses_zero = false;
    for (radial, radial_weight) in [
        (lower_radial, 1.0 - into_radial),
        (upper_radial, into_radial),
    ] {
        for (step, gate_weight) in [(0.0, 1.0 - into_gate), (1.0, into_gate)] {
            let share = radial_weight * gate_weight;
            if share <= 0.0 {
                continue;
            }
            let index = first + step;
            if index < 0.0 || index >= gates as f64 {
                continue;
            }
            let (value, status) = field.get(radial, index as usize);
            // A gate the radar did not read is not a zero to average in; it
            // simply is not there, and the readings that are share it out.
            if status != GateStatus::Valid {
                continue;
            }
            if matches!(product, Product::Velocity) && value * nearest.0 < 0.0 {
                crosses_zero = true;
            }
            total += value * share;
            weight += share;
        }
    }

    if crosses_zero || weight <= 0.0 {
        return Some(nearest);
    }
    Some((total / weight, GateStatus::Valid))
}

/// The colour and opacity one gate is drawn in, or None to leave it clear so
/// the map shows through.
pub(crate) fn gate_color(
    status: &GateStatus,
    value: f32,
    product: Product,
    table: Option<&Palette>,
    range: Option<(f32, f32)>,
    shading: Shading,
) -> Option<([u8; 3], u8)> {
    let Shading {
        unfolded,
        threshold,
        high_contrast,
    } = shading;
    match status {
        GateStatus::Valid => {
            // Velocity runs either side of zero and both sides are the storm,
            // so its threshold is on how fast rather than on which way.
            // Everything else reads low to high and compares as it is.
            let measured = if matches!(product, Product::Velocity) {
                value.abs()
            } else {
                value
            };
            if threshold.is_some_and(|floor| measured < floor) {
                return None;
            }
            match table {
                Some(table) => {
                    if value < table.floor() {
                        return None;
                    }
                    Some((table.color(value), MAX_ALPHA))
                }
                None => match product {
                    Product::Reflectivity => {
                        // Below the lowest ramp stop there is nothing the
                        // legend could name, so the ground shows through.
                        if value < FADE_FLOOR_DBZ {
                            return None;
                        }
                        Some((
                            ramp_color(
                                if high_contrast {
                                    HIGH_CONTRAST_REFLECTIVITY_RAMP
                                } else {
                                    REFLECTIVITY_RAMP
                                },
                                value,
                            ),
                            reflectivity_alpha(value),
                        ))
                    }
                    Product::Velocity => {
                        let ramp = match (high_contrast, unfolded) {
                            (true, true) => HIGH_CONTRAST_WIDE_VELOCITY_RAMP,
                            (true, false) => HIGH_CONTRAST_VELOCITY_RAMP,
                            (false, true) => WIDE_VELOCITY_RAMP,
                            (false, false) => VELOCITY_RAMP,
                        };
                        Some((ramp_color(ramp, value), MAX_ALPHA))
                    }
                    _ => {
                        let (low, high) = range.unwrap_or((0.0, 1.0));
                        let span = high - low;
                        let scaled = if span > 0.0 {
                            (value - low) / span
                        } else {
                            0.0
                        };
                        Some((ramp_color(GENERIC_RAMP, scaled), MAX_ALPHA))
                    }
                },
            }
        }
        // A folded gate has no value on the scale, so it takes the colour the
        // loaded table names for it and falls back to the built-in purple. A
        // threshold cannot speak to it either way: there is no reading to
        // compare, so hiding it would be inventing an answer.
        GateStatus::RangeFolded => Some((
            table
                .and_then(|table| table.range_folded)
                .unwrap_or(RANGE_FOLDED),
            MAX_ALPHA,
        )),
        GateStatus::BelowThreshold | GateStatus::NoData => None,
    }
}

pub(crate) fn encode_png(pixels: &[u8]) -> Result<Vec<u8>, Level2Error> {
    encode_png_sized(pixels, IMAGE_SIZE, IMAGE_SIZE)
}

pub(crate) fn encode_png_sized(
    pixels: &[u8],
    width: usize,
    height: usize,
) -> Result<Vec<u8>, Level2Error> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| Level2Error::Encode(error.to_string()))?;
        writer
            .write_image_data(pixels)
            .map_err(|error| Level2Error::Encode(error.to_string()))?;
    }
    Ok(out)
}

pub(crate) fn data_url(png_bytes: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png_bytes)
    )
}

#[cfg(test)]
#[path = "render_tests.rs"]
mod tests;

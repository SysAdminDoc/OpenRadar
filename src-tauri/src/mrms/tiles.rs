//! A grid to the 256-pixel tiles the map asks for.
//!
//! The address the map sends, the sampling that answers it, the tile
//! cache in front of both, and the PNG at the end.

use super::*;

/// A drawn tile belongs to the grid it came from and to the colour table it
/// was drawn with. Leaving the table out of the key would serve tiles in the
/// old colours after a new one is loaded.
/// What a tile is drawn to look like, as against which tile it is.
///
/// One value rather than three arguments repeated across the drawing, the
/// caching and the address, because that is what they are: every one of these
/// changes the picture, so every one of them belongs in the key, and passing
/// them separately is how one of them gets left out of it.
#[derive(Clone, Copy, PartialEq)]
pub struct TileLook {
    /// Hide anything below this, on top of the product's own floor. It can
    /// only ever hide more, never bring back what the floor already excluded.
    pub threshold: Option<f32>,
    /// Draw on the ramp built for a reader who asked for more contrast.
    pub high_contrast: bool,
    /// Read between the cells rather than take the nearest one. Ignored for a
    /// categorical grid and for the scattered products, which say so
    /// themselves: see `smooths`.
    pub smooth: bool,
}

pub(crate) fn tile_key(
    key: &str,
    zoom: u32,
    x: u32,
    y: u32,
    look: TileLook,
    reduce: usize,
) -> String {
    let TileLook {
        threshold,
        high_contrast,
        smooth,
    } = look;
    // The threshold is part of what the tile shows, so two tiles drawn at two
    // thresholds are two tiles. Leaving it out of the key served the first one
    // back for the second and the picture never changed.
    let floor = match threshold {
        Some(value) => format!("{value}"),
        None => String::from("-"),
    };
    // The reduction is part of what the tile shows too: the same grid folded
    // and unfolded draws the same weather at two cell sizes.
    // The ramp is part of what the tile shows for the same reason: a tile
    // drawn on the ordinary ramp must never be served to a reader who asked
    // for the high-contrast one.
    let ramp = if high_contrast { "hc" } else { "-" };
    let between = if smooth { "s" } else { "-" };
    format!(
        "{key}|{zoom}/{x}/{y}|{floor}|{ramp}|{between}|r{reduce}|{}",
        palette::generation()
    )
}

pub(crate) fn cached_tile(key: &str) -> Option<Vec<u8>> {
    let cache = TILES.lock().ok()?;
    cache
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| entry.bytes.clone())
}

pub(crate) fn remember_tile(key: String, bytes: &[u8]) {
    let Ok(mut cache) = TILES.lock() else {
        return;
    };
    if cache.iter().any(|entry| entry.key == key) {
        return;
    }
    cache.push_back(CachedTile {
        key,
        bytes: bytes.to_vec(),
    });
    while cache.len() > TILE_CACHE_CAPACITY {
        cache.pop_front();
    }
}

/// The colour for one category, or nothing when the grid holds a value the
/// table does not name.
///
/// Matched on the nearest whole number rather than on equality: the grid is
/// packed as scaled integers and comes back through a float, so 3.0000002 is
/// snow and refusing it would leave the map empty.
pub(crate) fn category_color(categories: &[Category], value: f32) -> Option<[u8; 3]> {
    if !value.is_finite() {
        return None;
    }
    let wanted = value.round();
    categories
        .iter()
        .find(|category| category.value == wanted)
        .map(|category| category.color)
}

pub(crate) fn ramp_color(ramp: &[(f32, [u8; 3])], value: f32) -> [u8; 3] {
    if value <= ramp[0].0 {
        return ramp[0].1;
    }
    for pair in ramp.windows(2) {
        let (low, low_color) = pair[0];
        let (high, high_color) = pair[1];
        if value <= high {
            let span = high - low;
            let position = if span > 0.0 {
                (value - low) / span
            } else {
                0.0
            };
            return [
                blend(low_color[0], high_color[0], position),
                blend(low_color[1], high_color[1], position),
                blend(low_color[2], high_color[2], position),
            ];
        }
    }
    ramp[ramp.len() - 1].1
}

pub(crate) fn blend(low: u8, high: u8, position: f32) -> u8 {
    (low as f32 + (high as f32 - low as f32) * position).round() as u8
}

/// What one tile request asks for.
pub struct TileRequest {
    /// Which of the network's regions the tile is from.
    pub domain: String,
    pub entry: &'static MrmsProduct,
    /// Which height of the merged grid, for the three products published at
    /// more than one. Already checked against what the product publishes, so
    /// a level here is one the network has.
    pub level: Option<&'static str>,
    pub time: i64,
    pub zoom: u32,
    pub x: u32,
    pub y: u32,
    /// Read between the cells rather than take the nearest one.
    pub smooth: bool,
    /// Whether the reader is close enough to see the fold.
    ///
    /// On the request rather than worked out where the grid is asked for, so
    /// the whole decision from a tile address to what is fetched can be read
    /// in one place and tested without a bucket.
    pub detail: bool,
    /// Hide anything below this, in the product's own unit.
    pub threshold: Option<f32>,
    /// Draw with the ramp built for a reader who asked for more contrast.
    pub high_contrast: bool,
}

/// Reads `/domain/product/time/z/x/y.png`, and an optional `?min=`, `?hc=`
/// or `?level=`.
///
/// The domain may be left out, and then it is the lower forty-eight: that is
/// the address every tile had before the other regions were read, and a
/// bookmarked or cached one still has to work.
pub fn parse_tile_path(path: &str) -> Option<TileRequest> {
    let path = path.trim_start_matches('/');
    let (path, query) = match path.split_once('?') {
        Some((before, after)) => (before, Some(after)),
        None => (path, None),
    };
    // A threshold that is not a finite number is no threshold at all, rather
    // than a threshold of nothing, which would hide the whole picture.
    let threshold = query
        .and_then(|query| {
            query
                .split('&')
                .find_map(|pair| pair.strip_prefix("min="))
                .map(str::to_owned)
        })
        .and_then(|value| value.parse::<f32>().ok())
        .filter(|value| value.is_finite());
    // Anything but the flag itself is ordinary contrast, because a ramp is not
    // something to guess at from a malformed address.
    let high_contrast = query
        .map(|query| query.split('&').any(|pair| pair == "hc=1"))
        .unwrap_or(false);
    let smooth = query
        .map(|query| query.split('&').any(|pair| pair == "smooth=1"))
        .unwrap_or(false);
    let stem = path.strip_suffix(".png").unwrap_or(path);
    let mut parts = stem.split('/').peekable();
    // A leading segment that names a region, or nothing and the old shape.
    let domain = match parts.peek() {
        Some(first) if is_domain(first) => {
            let named = (*first).to_string();
            parts.next();
            named
        }
        _ => "CONUS".to_string(),
    };
    // The height, for the three products published at more than one. Read
    // through the product's own list rather than trusted, so an address
    // naming a height the network does not publish draws the lowest instead
    // of asking the bucket for a folder that is not there.
    let asked = query.and_then(|query| {
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix("level="))
    });
    let entry = product_by_id(parts.next()?)?;
    let level = entry.level_for(asked);
    let time = parts.next()?.parse::<i64>().ok()?;
    let zoom = parts.next()?.parse::<u32>().ok()?;
    let x = parts.next()?.parse::<u32>().ok()?;
    let y = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() || zoom > 12 {
        return None;
    }
    Some(TileRequest {
        domain,
        entry,
        level,
        time,
        zoom,
        x,
        y,
        smooth,
        detail: fold_shows(zoom),
        threshold,
        high_contrast,
    })
}

/// Answers one tile request: the bytes of a PNG, always. A tile with nothing
/// in it is a transparent pixel rather than an error, because a raster source
/// that gets a 404 logs a warning for every empty corner of the map.
pub async fn serve_tile(path: &str) -> Vec<u8> {
    let Some(asked) = parse_tile_path(path) else {
        return EMPTY_TILE.to_vec();
    };
    let TileRequest {
        domain,
        entry,
        level,
        time,
        zoom,
        x,
        y,
        detail,
        smooth,
        threshold,
        high_contrast,
    } = asked;
    let Some(key) = key_for(&domain, entry, level, time) else {
        return EMPTY_TILE.to_vec();
    };

    // A frame that has been drawn once never decodes again, which is what
    // makes replaying the loop cheap.
    // The key already names the region, so it separates one region's tiles
    // from another's without anything else being said. It also names how
    // folded the grid that drew it was: a shear tile drawn from the folded
    // grid and the same tile drawn from the unfolded one are two pictures,
    // and served under one address they leave a seam along a tile boundary
    // that stays there for the session.
    //
    // Looked up under what is in hand and stored under what actually drew
    // it. A guess that turns out wrong costs one redraw; storing under the
    // guess would serve one grid's tile as the other's, which is the whole
    // of what this is for.
    let look = TileLook {
        threshold,
        high_contrast,
        smooth,
    };
    let asking = tile_key(&key, zoom, x, y, look, cached_reduction(&key).unwrap_or(1));
    if let Some(bytes) = cached_tile(&asking) {
        return bytes;
    }
    // Unfolded only from the zoom the fold starts to show at. Below it the
    // reader cannot see the difference and the grid costs four times as much,
    // which is the whole of why this is asked for rather than always on.
    if grid_for(&key, detail).await.is_err() {
        return EMPTY_TILE.to_vec();
    }
    let reduce = cached_reduction(&key).unwrap_or(1);
    let drawn = tile_key(&key, zoom, x, y, look, reduce);
    if let Some(bytes) = cached_tile(&drawn) {
        return bytes;
    }
    let bytes =
        tile_from_cache(&key, entry, zoom, x, y, look).unwrap_or_else(|| EMPTY_TILE.to_vec());
    remember_tile(drawn, &bytes);
    bytes
}

/// Only the inverse is needed to draw a tile; this is here so the inverse can
/// be checked against something.
#[cfg(test)]
pub(crate) fn mercator_y(latitude: f64) -> f64 {
    let clamped = latitude.clamp(-MERCATOR_LIMIT, MERCATOR_LIMIT);
    (std::f64::consts::FRAC_PI_4 + clamped.to_radians() / 2.0)
        .tan()
        .ln()
}

/// The mercator y of a latitude, which the cell walk needs to place a row.
pub(crate) fn mercator_of(latitude: f64) -> f64 {
    let clamped = latitude.clamp(-85.051_129, 85.051_129);
    (std::f64::consts::FRAC_PI_4 + clamped.to_radians() / 2.0)
        .tan()
        .ln()
}

/// The grid row a latitude falls in, which may be off either end.
pub(crate) fn grid_row_of(grid: &Grid, latitude: f64) -> i64 {
    ((grid.north - latitude) / grid.d_lat).floor() as i64
}

pub(crate) fn grid_column_of(grid: &Grid, longitude: f64) -> i64 {
    ((longitude - grid.west) / grid.d_lon).floor() as i64
}

pub(crate) fn inverse_mercator_y(y: f64) -> f64 {
    (2.0 * y.exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees()
}

/// Whether reading between this product's cells says anything true.
///
/// Two kinds of grid it does not. A categorical one names what is falling, and
/// halfway between snow and hail is not sleet: it is a number nobody has
/// defined, which `category_color` would refuse, leaving a hole along every
/// boundary. A `Sampling::Cells` one is scattered single cells rather than a
/// field, and reading between them would spread a hail core over ground the
/// network never put one on.
pub(crate) fn smooths(entry: &MrmsProduct) -> bool {
    entry.categories.is_none() && matches!(entry.sampling, Sampling::Nearest)
}

/// Draws one slippy-map tile out of a decoded grid, as the RGBA it becomes
/// before it is encoded. None when the tile holds nothing worth sending,
/// which is most of the world.
pub fn tile_pixels(
    grid: &Grid,
    entry: &MrmsProduct,
    zoom: u32,
    x: u32,
    y: u32,
    // A loaded colour table still wins over the contrast ramp: it is drawn as
    // supplied rather than altered, and the panel says so.
    look: TileLook,
) -> Option<Vec<u8>> {
    let TileLook {
        threshold,
        high_contrast,
        smooth,
    } = look;
    let scale = 2f64.powi(zoom as i32);
    if x as f64 >= scale || y as f64 >= scale {
        return None;
    }

    let top = std::f64::consts::PI * (1.0 - 2.0 * y as f64 / scale);
    let bottom = std::f64::consts::PI * (1.0 - 2.0 * (y + 1) as f64 / scale);
    let left = (x as f64 / scale) * 360.0 - 180.0;
    let right = ((x + 1) as f64 / scale) * 360.0 - 180.0;

    // The grid covers the lower forty-eight and no more, so most tiles can be
    // answered without looking at a single sample.
    let south = grid.north - grid.d_lat * grid.rows as f64;
    let east = grid.west + grid.d_lon * grid.columns as f64;
    if right < grid.west || left > east {
        return None;
    }
    if inverse_mercator_y(top) < south || inverse_mercator_y(bottom) > grid.north {
        return None;
    }

    // A loaded colour table replaces this product's own ramp when it says it is
    // for the same unit, so the same storm comes out the same colours in every
    // tool that reads the file.
    let table = palette::for_unit(entry.unit);
    let own = table
        .as_ref()
        .map(|table| table.floor())
        .unwrap_or(entry.floor);
    let floor = match threshold {
        Some(asked) => own.max(asked),
        None => own,
    };

    let ramp = entry.ramp_for(high_contrast);
    let mut pixels = vec![0u8; TILE_SIZE * TILE_SIZE * 4];
    let mut painted = false;
    let mut paint = |row: usize, column: usize, value: f32| {
        // A categorical grid is matched, not interpolated, and a value the
        // table does not name is left clear. Halfway between snow and hail is
        // not sleet; it is a number nobody has defined.
        let color = match (entry.categories, &table) {
            (Some(categories), _) => {
                let Some(found) = category_color(categories, value) else {
                    return;
                };
                found
            }
            (None, Some(table)) => table.color(value),
            (None, None) => ramp_color(ramp, value),
        };
        let at = (row * TILE_SIZE + column) * 4;
        pixels[at] = color[0];
        pixels[at + 1] = color[1];
        pixels[at + 2] = color[2];
        pixels[at + 3] = 235;
        painted = true;
    };

    match entry.sampling {
        Sampling::Nearest => {
            let between = smooth && smooths(entry);
            for row in 0..TILE_SIZE {
                let mercator = top + (bottom - top) * ((row as f64 + 0.5) / TILE_SIZE as f64);
                let latitude = inverse_mercator_y(mercator);
                for column in 0..TILE_SIZE {
                    let longitude =
                        left + (right - left) * ((column as f64 + 0.5) / TILE_SIZE as f64);
                    // The nearest cell either way where the field is not
                    // smoothed, and where it is but one of the four around
                    // this point had no coverage.
                    let value = between
                        .then(|| grid.between(latitude, longitude))
                        .flatten()
                        .or_else(|| {
                            grid.locate(latitude, longitude)
                                .map(|(grid_row, grid_column)| grid.value(grid_row, grid_column))
                        });
                    let Some(value) = value else {
                        continue;
                    };
                    if !value.is_finite() || value < floor {
                        continue;
                    }
                    paint(row, column, value);
                }
            }
        }
        Sampling::Cells => {
            // The grid rows and columns this tile can see, so a tile over one
            // state never walks the whole country.
            // One cell either side, so a cell whose centre is just outside the
            // tile but whose body reaches into it is still drawn.
            let first_row = (grid_row_of(grid, inverse_mercator_y(top)) - 1).max(0) as usize;
            let last_row = (grid_row_of(grid, inverse_mercator_y(bottom)) + 1)
                .min(grid.rows as i64 - 1)
                .max(0) as usize;
            let first_column = (grid_column_of(grid, left) - 1).max(0) as usize;
            let last_column = (grid_column_of(grid, right) + 1)
                .min(grid.columns as i64 - 1)
                .max(0) as usize;
            if first_row > last_row || first_column > last_column {
                return None;
            }

            // Several cells can land on one pixel at a wide zoom, and the
            // strongest of them is the one worth seeing. Zoomed in the
            // opposite is true: one cell covers many pixels, and painting a
            // single one of them turns a solid hail swath into a dot lattice.
            // Each cell is drawn over the pixels it actually covers, so both
            // ends behave.
            let mut strongest = vec![f32::NEG_INFINITY; TILE_SIZE * TILE_SIZE];
            let to_row =
                |latitude: f64| ((top - mercator_of(latitude)) / (top - bottom)) * TILE_SIZE as f64;
            let to_column =
                |longitude: f64| ((longitude - left) / (right - left)) * TILE_SIZE as f64;

            for grid_row in first_row..=last_row {
                // The cell spans half a step either side of its centre.
                let north_edge = grid.north - grid.d_lat * (grid_row as f64 - 0.5);
                let south_edge = north_edge - grid.d_lat;
                let row_from = to_row(north_edge).floor().max(0.0) as usize;
                let row_to = (to_row(south_edge).ceil() as i64 - 1)
                    .min(TILE_SIZE as i64 - 1)
                    .max(-1);
                if row_to < row_from as i64 {
                    continue;
                }

                for grid_column in first_column..=last_column {
                    let value = grid.value(grid_row, grid_column);
                    if !value.is_finite() || value < floor {
                        continue;
                    }
                    let west_edge = grid.west + grid.d_lon * (grid_column as f64 - 0.5);
                    let east_edge = west_edge + grid.d_lon;
                    // A cell whose centre sits west of this tile belongs to the
                    // tile before it, and without this the cast saturates and
                    // draws it down column zero.
                    let column_from = to_column(west_edge).floor();
                    let column_to = to_column(east_edge).ceil() - 1.0;
                    if column_to < 0.0 || column_from > TILE_SIZE as f64 - 1.0 {
                        continue;
                    }
                    let column_from = column_from.max(0.0) as usize;
                    let column_to = (column_to as i64).min(TILE_SIZE as i64 - 1) as usize;

                    for row in row_from..=(row_to as usize) {
                        for column in column_from..=column_to {
                            let at = row * TILE_SIZE + column;
                            if value > strongest[at] {
                                strongest[at] = value;
                            }
                        }
                    }
                }
            }
            for (at, value) in strongest.iter().enumerate() {
                if *value > f32::NEG_INFINITY {
                    paint(at / TILE_SIZE, at % TILE_SIZE, *value);
                }
            }
        }
    }

    if !painted {
        return None;
    }
    Some(pixels)
}

pub(crate) fn encode_png(pixels: &[u8]) -> Result<Vec<u8>, MrmsError> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, TILE_SIZE as u32, TILE_SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| MrmsError::Encode(error.to_string()))?;
        writer
            .write_image_data(pixels)
            .map_err(|error| MrmsError::Encode(error.to_string()))?;
    }
    Ok(out)
}

/// A one pixel transparent PNG, which is what an empty tile answers with.
pub const EMPTY_TILE: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
];

/// Draws a tile from a grid already decoded, without holding it across an await.
pub fn tile_from_cache(
    key: &str,
    entry: &MrmsProduct,
    zoom: u32,
    x: u32,
    y: u32,
    look: TileLook,
) -> Option<Vec<u8>> {
    // The lock is held for the drawing, which reads the grid, and dropped
    // before the encode, which does not. Holding it across the encode
    // serialises every tile on the screen behind the slowest one.
    let pixels = {
        let cache = CACHE.lock().ok()?;
        let held = cache.iter().find(|held| held.key == key)?;
        tile_pixels(&held.grid, entry, zoom, x, y, look)?
    };
    encode_png(&pixels).ok()
}

#[cfg(test)]
#[path = "tiles_tests.rs"]
mod tests;

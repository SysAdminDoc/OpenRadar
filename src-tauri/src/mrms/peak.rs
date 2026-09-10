//! The strongest reading near a place, for a rule the reader set on a grid.
//!
//! The watch answers warnings, which are somebody's judgement. This answers a
//! number: the largest hail size the network estimated within ten miles of a
//! ballfield, or the strongest rotation it merged there. Neither is a warning
//! and the copy beside them says so.
//!
//! It reads a grid that is already decoded wherever it can. The tiles the map
//! draws come out of the same cache, so a reader with the hail layer on pays
//! nothing for the rule; a reader with it off pays one fetch an interval,
//! which is the fetch the tile server would have made anyway. That last part
//! only holds with the layer on: with it off this is new traffic, and the
//! asset ledger says so.

use super::*;

/// How far a degree of latitude is, in miles.
///
/// Used for the box the walk starts from and nothing else. A degree of
/// longitude is this times the cosine of the latitude, which is close enough
/// to draw a first cut with and not close enough to decide anything: the
/// circle below is what actually decides, and it is measured on the sphere.
const MILES_PER_DEGREE: f64 = 69.0546;

/// A mile in kilometres, because the grids are metric and a rule is not.
const KM_PER_MILE: f64 = 1.609_344;

/// The most a rule may ask about, in miles.
///
/// Ten times the radius the panel offers. A rule is about a place, and a
/// circle wider than this is a region: at some size the honest answer is to
/// look at the map rather than to be told a number.
const MAX_RADIUS_MILES: f64 = 250.0;

/// The strongest reading a grid holds near a place.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peak {
    /// The reading, in the product's own unit.
    pub value: f32,
    /// When the grid it came from was published, in seconds.
    pub time: i64,
    /// How far that reading was from the place, in miles.
    pub miles: f64,
}

/// How far apart two points are, in miles.
///
/// On the sphere rather than on a flat patch. The flat form this had was good
/// to seventy metres over the twenty-five miles the panel offers and about six
/// kilometres at the two hundred and fifty this command allows, which is six
/// cells: near enough for the panel and not near enough for the command, so
/// the whole difference goes away instead.
fn miles_between(lat: f64, lon: f64, other_lat: f64, other_lon: f64) -> f64 {
    crate::cross_section::ground_distance_km(
        nexrad_model::geo::GeoPoint {
            latitude: lat,
            longitude: lon,
        },
        nexrad_model::geo::GeoPoint {
            latitude: other_lat,
            longitude: other_lon,
        },
    ) / KM_PER_MILE
}

/// The strongest reading within a radius of a place, and how far off it was.
///
/// Every cell whose centre is inside the circle, not the one cell the place
/// sits in: "hail over an inch within ten miles" is a question about the
/// neighbourhood, and the core that matters is rarely overhead. A cell the
/// grid had no coverage of is not a reading of nothing, so it is skipped
/// rather than counted as zero.
pub fn peak_within(
    grid: &Grid,
    latitude: f64,
    longitude: f64,
    radius_miles: f64,
) -> Option<(f32, f64)> {
    if !(latitude.is_finite() && longitude.is_finite()) {
        return None;
    }
    // A circle with no width is not a neighbourhood. Said here rather than
    // clamped to zero, because a clamp would answer with the one cell the
    // place happens to sit in and that is not what a radius of nothing means.
    if !(radius_miles.is_finite() && radius_miles > 0.0) {
        return None;
    }
    let radius = radius_miles.min(MAX_RADIUS_MILES);
    let north = latitude + radius / MILES_PER_DEGREE;
    let south = latitude - radius / MILES_PER_DEGREE;
    // Widened by the latitude, because a degree of longitude is shorter the
    // further north the place is. Taken at whichever edge of the box is
    // nearer a pole rather than at the place, so the box is too wide rather
    // than too narrow: too wide costs a few cells the circle then rejects,
    // and too narrow drops a cell that was inside the circle all along. At
    // the pole this would be infinite, so the cosine is floored.
    let spread = north
        .abs()
        .max(south.abs())
        .to_radians()
        .cos()
        .abs()
        .max(0.01);
    let west = longitude - radius / (MILES_PER_DEGREE * spread);
    let east = longitude + radius / (MILES_PER_DEGREE * spread);

    // The rows and columns the box covers, held inside the grid.
    let top = ((grid.north - north) / grid.d_lat).floor().max(0.0) as usize;
    let bottom = ((grid.north - south) / grid.d_lat).ceil().max(0.0) as usize;
    let left = ((west - grid.west) / grid.d_lon).floor().max(0.0) as usize;
    let right = ((east - grid.west) / grid.d_lon).ceil().max(0.0) as usize;
    if top >= grid.rows || left >= grid.columns {
        return None;
    }
    let bottom = bottom.min(grid.rows - 1);
    let right = right.min(grid.columns - 1);

    let mut found: Option<(f32, f64)> = None;
    for row in top..=bottom {
        let cell_lat = grid.north - row as f64 * grid.d_lat;
        for column in left..=right {
            let cell_lon = grid.west + column as f64 * grid.d_lon;
            let miles = miles_between(latitude, longitude, cell_lat, cell_lon);
            if miles > radius {
                continue;
            }
            let Some(value) = grid.reading(row, column) else {
                continue;
            };
            if !value.is_finite() {
                continue;
            }
            if found.is_none_or(|(held, _)| value > held) {
                found = Some((value, miles));
            }
        }
    }
    found
}

/// The strongest reading the newest grid of a product holds near a place.
///
/// `None` where the place is off the grid or the network covered none of the
/// circle, which is a different thing from a reading of zero and is what the
/// caller has to be able to tell apart: a rule that fired on "no coverage"
/// read as zero would never fire, and one that treated it as a reading would
/// announce clear air.
#[tauri::command]
pub async fn mrms_peak_near(
    product: String,
    // Which of the network's regions holds the place. The five grids do not
    // overlap and are not one picture, so a rule over San Juan has to read
    // the Caribbean grid; reading CONUS for it answered nothing at all, on a
    // grid the map beside it was already drawing.
    domain: Option<String>,
    level: Option<String>,
    latitude: f64,
    longitude: f64,
    radius_miles: f64,
) -> Result<Option<Peak>, MrmsError> {
    let entry = product_by_id(&product).ok_or(MrmsError::UnknownProduct(product.clone()))?;
    let domain = domain.unwrap_or_else(|| "CONUS".to_string());
    let frames = mrms_frames(product.clone(), 1, Some(domain.clone()), level.clone()).await?;
    let frame = frames
        .last()
        .ok_or(MrmsError::NoFrames(entry.label.to_string()))?;
    let time = frame.time;
    let key = key_for(&domain, entry, level.as_deref(), time)
        .ok_or(MrmsError::UnknownProduct(product))?;
    grid_for(&key, false).await?;

    // The cache is behind a blocking lock and the walk copies nothing, so it
    // goes off the async runtime like every other reader of it.
    let peak = tauri::async_runtime::spawn_blocking(move || {
        let cache = CACHE.lock().ok()?;
        let grid = &cache.iter().find(|held| held.key == key)?.grid;
        peak_within(grid, latitude, longitude, radius_miles)
    })
    .await
    .map_err(|error| MrmsError::Decode(error.to_string()))?;

    Ok(peak.map(|(value, miles)| Peak { value, time, miles }))
}

#[cfg(test)]
#[path = "peak_tests.rs"]
mod tests;

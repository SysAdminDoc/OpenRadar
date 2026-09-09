//! Which regions the bucket publishes, and what it holds right now.

use super::*;

/// The regions the network publishes separately.
///
/// The grids do not overlap and are not one picture: each is its own
/// projection with its own resolution, published on its own schedule. The
/// decoder reads the geometry out of the file, so all any of this needs is
/// which folder to look in.
pub const DOMAINS: &[&str] = &["CONUS", "ALASKA", "HAWAII", "GUAM", "CARIB"];

/// Whether a name is one the bucket has, so nothing built from a request can
/// reach for a folder that is not there.
pub fn is_domain(name: &str) -> bool {
    DOMAINS.contains(&name)
}

pub(crate) fn listing_url(domain: &str, folder: &str, day: DateTime<Utc>) -> String {
    format!(
        "{BUCKET}/?list-type=2&prefix={domain}/{folder}/{:04}{:02}{:02}/",
        day.year(),
        day.month(),
        day.day()
    )
}

/// `MRMS_MergedReflectivityQCComposite_00.50_20260830-094642.grib2.gz`
pub fn key_time(key: &str) -> Option<i64> {
    let name = key.rsplit('/').next()?;
    let stamp = name.strip_suffix(".grib2.gz")?;
    let stamp = stamp.get(stamp.len().checked_sub(15)?..)?;
    NaiveDateTime::parse_from_str(stamp, "%Y%m%d-%H%M%S")
        .ok()
        .map(|at| at.and_utc().timestamp())
}

/// The object a product's grid for one moment lives in. The folder name is
/// repeated inside the file name, which is what makes this derivable rather
/// than something the frontend has to carry around.
pub fn key_for(
    domain: &str,
    entry: &MrmsProduct,
    level: Option<&str>,
    time: i64,
) -> Option<String> {
    if !is_domain(domain) {
        return None;
    }
    let at = DateTime::from_timestamp(time, 0)?;
    let day = at.format("%Y%m%d");
    let stamp = at.format("%Y%m%d-%H%M%S");
    Some(format!(
        "{domain}/{folder}/{day}/MRMS_{folder}_{stamp}.grib2.gz",
        folder = entry.folder_at(level)
    ))
}

pub fn frames_from_listing(listing: &str, limit: usize) -> Vec<MrmsFrame> {
    let mut frames = Vec::new();
    let mut rest = listing;
    while let Some(start) = rest.find("<Key>") {
        let after = &rest[start + 5..];
        let Some(end) = after.find("</Key>") else {
            break;
        };
        let key = &after[..end];
        if let Some(time) = key_time(key) {
            frames.push(MrmsFrame {
                time,
                key: key.to_string(),
            });
        }
        rest = &after[end + 6..];
    }
    frames.sort_by_key(|frame| frame.time);
    if frames.len() > limit {
        frames.drain(..frames.len() - limit);
    }
    frames
}

/// The newest grids a product has published, oldest first.
#[tauri::command]
pub async fn mrms_frames(
    product: String,
    limit: usize,
    // Which of the network's regions to read. Absent means the lower
    // forty-eight, which is what every caller wanted before there were others.
    domain: Option<String>,
    // Which height of the merged grid, for the three products published at
    // more than one. Absent, and for those it is the lowest.
    level: Option<String>,
) -> Result<Vec<MrmsFrame>, MrmsError> {
    let domain = domain.unwrap_or_else(|| "CONUS".to_string());
    if !is_domain(&domain) {
        return Err(MrmsError::UnknownProduct(domain));
    }
    let entry = product_by_id(&product).ok_or(MrmsError::UnknownProduct(product.clone()))?;
    let limit = limit.clamp(1, 60);
    let now = Utc::now();

    let mut frames = Vec::new();
    // Just after midnight UTC the day's folder holds only a frame or two, so
    // yesterday has to make up the rest of the loop.
    for day in [now - Duration::days(1), now] {
        let listing = http::get_bytes(&listing_url(
            &domain,
            &entry.folder_at(level.as_deref()),
            day,
        ))
        .await?;
        let listing = String::from_utf8_lossy(&listing);
        if !listing.contains("<ListBucketResult") {
            return Err(MrmsError::BadListing);
        }
        frames.extend(frames_from_listing(&listing, limit));
    }
    frames.sort_by_key(|frame| frame.time);
    frames.dedup_by_key(|frame| frame.time);
    if frames.len() > limit {
        frames.drain(..frames.len() - limit);
    }
    if frames.is_empty() {
        return Err(MrmsError::NoFrames(entry.label.to_string()));
    }
    Ok(frames)
}

#[cfg(test)]
#[path = "listing_tests.rs"]
mod tests;

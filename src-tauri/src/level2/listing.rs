//! What the archive holds for a site, and which object to ask for.

use super::*;

/// The archive publishes one object per volume under a day prefix.
pub(crate) fn listing_url(station: &str, day: DateTime<Utc>) -> String {
    format!(
        "{ARCHIVE_HOST}/?list-type=2&prefix={:04}/{:02}/{:02}/{station}/",
        day.year(),
        day.month(),
        day.day()
    )
}

/// The newest key in an S3 listing. The bucket returns keys in order, and a
/// volume's name ends with its collection time, so the last one is the newest.
pub fn newest_key(listing: &str) -> Option<String> {
    let mut newest: Option<String> = None;
    let mut rest = listing;
    while let Some(start) = rest.find("<Key>") {
        let after = &rest[start + 5..];
        let end = after.find("</Key>")?;
        let key = &after[..end];
        // A partial upload is published as `_V06_MDM`; only whole volumes draw.
        if (key.ends_with("_V06") || key.ends_with("_V03"))
            && newest.as_deref().is_none_or(|current| current < key)
        {
            newest = Some(key.to_string());
        }
        rest = &after[end + 6..];
    }
    newest
}

/// The volume nearest a requested UTC moment in one day's listing.
///
/// The archive can have gaps while a radar is down, so the actual collection
/// time travels with the result and the timeline names it. Choosing the nearest
/// whole volume is more useful than pretending the requested minute exists.
#[cfg(test)]
pub(crate) fn closest_key(listing: &str, wanted: DateTime<Utc>) -> Option<String> {
    closest_key_across([listing], wanted)
}

pub(crate) fn closest_key_across<'a>(
    listings: impl IntoIterator<Item = &'a str>,
    wanted: DateTime<Utc>,
) -> Option<String> {
    let mut closest: Option<(i64, String)> = None;
    for listing in listings {
        let mut rest = listing;
        while let Some(start) = rest.find("<Key>") {
            let after = &rest[start + 5..];
            let end = after.find("</Key>")?;
            let key = &after[..end];
            if key.ends_with("_V06") || key.ends_with("_V03") {
                if let Some(at) = key_time(key) {
                    let distance = at.signed_duration_since(wanted).num_seconds().abs();
                    if closest.as_ref().is_none_or(|(best, current)| {
                        distance < *best || (distance == *best && key < current.as_str())
                    }) {
                        closest = Some((distance, key.to_string()));
                    }
                }
            }
            rest = &after[end + 6..];
        }
    }
    closest.map(|(_, key)| key)
}

/// The collection time a volume key carries, as `KDMX20260830_092159_V06`.
pub fn key_time(key: &str) -> Option<DateTime<Utc>> {
    let name = key.rsplit('/').next()?;
    let stamp = name.get(4..19)?;
    let parsed = chrono::NaiveDateTime::parse_from_str(stamp, "%Y%m%d_%H%M%S").ok()?;
    Some(parsed.and_utc())
}

/// The most recent whole volumes in a listing, newest last.
///
/// The app held exactly one volume, so a reader watching a supercell at site
/// resolution could see where it was and not where it was going. A loop needs
/// the times, and the times are in the keys: the bucket returns them in order
/// and a volume's name ends with its collection time.
///
/// Times rather than keys, because what the page asks for afterwards is a
/// moment, and a moment is what the legend has to say. The keys are the
/// bucket's business.
pub fn recent_times(listing: &str, want: usize) -> Vec<DateTime<Utc>> {
    let mut found: Vec<DateTime<Utc>> = Vec::new();
    let mut rest = listing;
    while let Some(start) = rest.find("<Key>") {
        let after = &rest[start + 5..];
        let Some(end) = after.find("</Key>") else {
            break;
        };
        let key = &after[..end];
        // A partial upload is published as `_V06_MDM`, and a loop of them
        // would be the same picture drawn twice with a gap in it.
        if key.ends_with("_V06") || key.ends_with("_V03") {
            if let Some(at) = key_time(key) {
                found.push(at);
            }
        }
        rest = &after[end + 6..];
    }
    found.sort_unstable();
    found.dedup();
    if found.len() > want {
        found.drain(..found.len() - want);
    }
    found
}

/// How many volumes a loop may hold.
///
/// Ten by default and thirty at the top, which is about ninety minutes of a
/// storm at a five-minute pattern and half that when the radar is in its fast
/// severe-weather pattern. Bounded because every one is a volume decoded and a
/// picture drawn, and a reader who asks for a hundred is asking the machine to
/// stop answering.
pub const MAX_LOOP_VOLUMES: usize = 30;

/// The last few volume times a site has published.
///
/// Two days are read rather than one, because just after midnight UTC the
/// day's own prefix holds a handful of volumes or none, and a loop that got
/// shorter every night at seven in the evening Central would be a puzzle
/// nobody would enjoy solving.
#[tauri::command]
pub async fn level2_recent_times(
    station: String,
    count: usize,
) -> Result<Vec<String>, Level2Error> {
    let station = station.to_uppercase();
    wsr88d_only(&station)?;
    let want = count.clamp(1, MAX_LOOP_VOLUMES);
    let now = Utc::now();

    let mut found: Vec<DateTime<Utc>> = Vec::new();
    for day in [now - Duration::days(1), now] {
        let listing = match http::get_bytes(&listing_url(&station, day)).await {
            Ok(listing) => listing,
            // A day with no prefix at all is not an error: it is a radar that
            // was not publishing then, and yesterday may still answer.
            Err(_) => continue,
        };
        found.extend(recent_times(&String::from_utf8_lossy(&listing), want));
    }
    found.sort_unstable();
    found.dedup();
    if found.len() > want {
        found.drain(..found.len() - want);
    }
    if found.is_empty() {
        return Err(Level2Error::NoVolume(station));
    }
    Ok(found.iter().map(|at| at.to_rfc3339()).collect())
}

pub(crate) async fn latest_volume(station: &str) -> Result<(String, Vec<u8>), Level2Error> {
    let now = Utc::now();
    let mut key = None;
    // Just after midnight UTC the day's prefix can still be empty.
    for day in [now, now - Duration::days(1)] {
        let listing = http::get_bytes(&listing_url(station, day)).await?;
        let listing = String::from_utf8_lossy(&listing);
        if !listing.contains("<ListBucketResult") {
            return Err(Level2Error::BadListing);
        }
        if let Some(found) = newest_key(&listing) {
            key = Some(found);
            break;
        }
    }
    let key = key.ok_or_else(|| Level2Error::NoVolume(station.to_string()))?;

    if let Some(hit) = cached(&key) {
        return Ok((key, hit));
    }
    let data = http::get_bytes(&format!("{ARCHIVE_HOST}/{key}")).await?;
    remember(&key, &data);
    Ok((key, data))
}

pub(crate) async fn archive_volume_at(
    station: &str,
    wanted: DateTime<Utc>,
) -> Result<(String, Vec<u8>), Level2Error> {
    let previous_url = listing_url(station, wanted - Duration::days(1));
    let current_url = listing_url(station, wanted);
    let next_url = listing_url(station, wanted + Duration::days(1));
    let (previous, current, next) = tokio::try_join!(
        http::get_bytes(&previous_url),
        http::get_bytes(&current_url),
        http::get_bytes(&next_url),
    )?;
    let listings =
        [previous, current, next].map(|listing| String::from_utf8_lossy(&listing).into_owned());
    if listings
        .iter()
        .any(|listing| !listing.contains("<ListBucketResult"))
    {
        return Err(Level2Error::BadListing);
    }
    let key = closest_key_across(listings.iter().map(String::as_str), wanted)
        .ok_or_else(|| Level2Error::NoVolume(station.to_string()))?;
    if let Some(hit) = cached(&key) {
        return Ok((key, hit));
    }
    let data = http::get_bytes(&format!("{ARCHIVE_HOST}/{key}")).await?;
    remember(&key, &data);
    Ok((key, data))
}

#[cfg(test)]
#[path = "listing_tests.rs"]
mod tests;

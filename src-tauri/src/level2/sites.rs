//! Which radar can see a place, and which of them is worth asking.

use super::*;

pub(crate) fn great_circle_km(
    latitude: f64,
    longitude: f64,
    other_latitude: f64,
    other_longitude: f64,
) -> f64 {
    let lat1 = latitude.to_radians();
    let lat2 = other_latitude.to_radians();
    let d_lat = lat2 - lat1;
    let d_lon = (other_longitude - longitude).to_radians();
    let a = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);
    6371.0 * 2.0 * a.sqrt().asin()
}

/// Every site whose coverage reaches a point, nearest first.
/// What the sweep says drew it, for a WSR-88D.
pub(crate) const WSR88D: &str = "WSR-88D";

/// Refuses a station that is not a WSR-88D, naming a terminal radar for what
/// it is rather than calling it no site at all.
pub(crate) fn wsr88d_only(station: &str) -> Result<(), Level2Error> {
    if registry::site_by_id(station).is_some() {
        return Ok(());
    }
    if tdwr::is_tdwr(station) {
        return Err(Level2Error::NotWsr88d(station.to_string()));
    }
    Err(Level2Error::UnknownSite(station.to_string()))
}

pub(crate) fn sites_in_reach(latitude: f32, longitude: f32) -> Vec<&'static registry::SiteEntry> {
    let mut found: Vec<(f64, &'static registry::SiteEntry)> = registry::sites()
        .iter()
        .filter_map(|site| {
            let distance = great_circle_km(
                latitude as f64,
                longitude as f64,
                site.latitude as f64,
                site.longitude as f64,
            );
            (distance <= SITE_REACH_KM).then_some((distance, site))
        })
        .collect();
    found.sort_by(|left, right| left.0.total_cmp(&right.0));
    found.into_iter().map(|(_, site)| site).collect()
}

/// Whether a site's newest volume is recent enough to be worth drawing.
///
/// A radar down for maintenance, or one whose upload to the archive has
/// stalled, stops publishing volumes while its entry in the registry stays
/// exactly where it was. The archive is the direct evidence: if no volume has
/// landed in the last twenty minutes there is nothing to draw, whatever the
/// site's published status says.
pub(crate) fn volume_is_current(newest: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    let Some(at) = newest else {
        return false;
    };
    let age = now.signed_duration_since(at);
    // A clock skewed the other way would otherwise read as infinitely stale.
    age <= Duration::minutes(STALE_AFTER_MINUTES) && age >= Duration::minutes(-5)
}

/// The first site that has something to draw, or the nearest one if none of
/// them has.
///
/// Falling back to the nearest matters: when the whole region is quiet, or the
/// archive itself is unreachable, the panel should report that site's own
/// failure rather than behave as though the viewport were out of coverage.
pub(crate) fn first_site_with_a_volume<'a>(
    sites: &[&'a registry::SiteEntry],
    newest: impl Fn(&str) -> Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Option<&'a registry::SiteEntry> {
    sites
        .iter()
        .find(|site| volume_is_current(newest(site.id), now))
        .or_else(|| sites.first())
        .copied()
}

/// The newest volume time the archive holds for a site, remembered briefly so
/// that panning across a region does not re-list the bucket for every site it
/// passes over.
pub(crate) async fn newest_volume_time(station: &str) -> Option<DateTime<Utc>> {
    let now = Utc::now();
    if let Ok(seen) = LIVENESS.lock() {
        if let Some((checked, newest, failed)) = seen.get(station) {
            let ttl = if *failed {
                LIVENESS_FAILURE_TTL_SECONDS
            } else {
                LIVENESS_TTL_SECONDS
            };
            if now.signed_duration_since(*checked) < Duration::seconds(ttl) {
                return *newest;
            }
        }
    }

    let mut newest = None;
    for day in [now, now - Duration::days(1)] {
        let Ok(listing) = http::get_bytes(&listing_url(station, day)).await else {
            // Unreachable is not the same as down. It is remembered briefly all
            // the same, or panning with no network fires the whole burst again
            // every tenth of a degree.
            if let Ok(mut seen) = LIVENESS.lock() {
                seen.insert(station.to_string(), (now, None, true));
            }
            return None;
        };
        let listing = String::from_utf8_lossy(&listing);
        if let Some(key) = newest_key(&listing) {
            newest = key_time(&key);
            break;
        }
    }

    if let Ok(mut seen) = LIVENESS.lock() {
        seen.insert(station.to_string(), (now, newest, false));
    }
    newest
}

/// The sites to spend a listing on, nearest first, with the ones the office
/// says are running ahead of the ones it says are not.
///
/// A preference and not a filter. A radar that is restarting, or that has sent
/// nothing for a day, still has a registry entry and a bucket prefix, so the
/// archive walk would list it and then find it quiet; putting it last saves
/// that round trip and is minutes earlier than the bucket could be, because a
/// listing can only report an upload that failed to arrive.
///
/// Dropping them outright was worse than the problem. The status feed is a
/// second opinion about somebody else's equipment, and a site wrongly marked
/// down would have been unreachable while the archive was serving its volumes
/// perfectly well. Ordering can only ever cost a listing; excluding can cost
/// the picture.
pub(crate) fn sites_worth_asking<'a>(
    sites: &[&'a registry::SiteEntry],
    faulty: &BTreeSet<String>,
) -> Vec<&'a registry::SiteEntry> {
    let (running, quiet): (Vec<_>, Vec<_>) = sites
        .iter()
        .copied()
        .partition(|site| !faulty.contains(site.id));
    running.into_iter().chain(quiet).collect()
}

/// One radar the view can see, for the picker.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SiteInReach {
    pub station: String,
    /// The town it is named after, and the state, as the registry has them.
    pub city: String,
    pub state: String,
    /// How far the view's centre is from it, in kilometres.
    pub distance_km: f64,
}

/// Every radar whose coverage reaches a point, nearest first.
///
/// The picker used to offer three things: follow the map, hold whatever is on
/// screen, and the forty-five airport radars. There was no way to choose the
/// second-nearest site when the nearest one is down, short of knowing its call
/// sign and typing it, and no place to show what the office says about any of
/// them. This is the list that was missing.
///
/// Distance rather than a bare list, because the order is the point: the
/// nearest radar sees lowest into the storm, and the reader picking a further
/// one is trading that away deliberately.
#[tauri::command]
pub fn level2_sites_in_reach(latitude: f32, longitude: f32) -> Vec<SiteInReach> {
    sites_in_reach(latitude, longitude)
        .into_iter()
        .map(|site| SiteInReach {
            station: site.id.to_string(),
            city: site.city.to_string(),
            state: site.state.to_string(),
            distance_km: great_circle_km(
                latitude as f64,
                longitude as f64,
                site.latitude as f64,
                site.longitude as f64,
            ),
        })
        .collect()
}

/// The nearest site to a point that is actually publishing volumes, so the
/// frontend never has to ship its own table. A point no site can see gets no
/// answer rather than the least distant one, which would otherwise draw
/// Alaska's radar over the mid-Atlantic.
#[tauri::command]
pub async fn level2_nearest_site(latitude: f32, longitude: f32) -> Option<String> {
    let sites = sites_in_reach(latitude, longitude);
    if sites.is_empty() {
        return None;
    }

    // Whatever the office last said, without waiting for it to say anything
    // new: this runs on every tenth of a degree the map moves, and a fetch in
    // front of it made a machine that could reach the archive but not the
    // status service wait out a thirty second timeout before every lookup.
    let sites = sites_worth_asking(&sites, &radar_status::faulty_stations_known());

    // Only the closest few are worth asking about. Past that the beam is high
    // enough over the viewport that a nearer site being down is the smaller
    // problem, and each question costs a listing.
    let asked: Vec<&'static registry::SiteEntry> =
        sites.iter().take(MAX_SITE_CANDIDATES).copied().collect();
    let mut times: Vec<(&str, Option<DateTime<Utc>>)> = Vec::with_capacity(asked.len());
    for site in &asked {
        times.push((site.id, newest_volume_time(site.id).await));
        // The first one that answers is the answer; the rest go unasked.
        if volume_is_current(times.last().expect("just pushed").1, Utc::now()) {
            break;
        }
    }

    first_site_with_a_volume(
        &asked,
        |id| {
            times
                .iter()
                .find(|(site, _)| *site == id)
                .and_then(|(_, at)| *at)
        },
        Utc::now(),
    )
    .map(|site| site.id.to_string())
}

/// What the radar read at one point, and which sweep read it.
///
/// The picture path decides which cut is on screen; this asks the same
/// question of the same cuts. Where a live volume covers the point it answers,
/// because that is the half of the composite the reader is looking at there,
/// and where it does not the finished volume does. Either way the answer
/// carries the time of the sweep it came from, so a number taken off a
/// composite is never dated by the wrong half of it.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn level2_gate(
    station: String,
    latitude: f64,
    longitude: f64,
    product: String,
    tilt: usize,
    dealias: bool,
    motion: Option<(f32, f32)>,
    live: bool,
) -> Result<Option<GateReading>, Level2Error> {
    let station = station.to_uppercase();
    // A terminal radar is drawn from its own Level III products, which this
    // path knows nothing about.
    if tdwr::is_tdwr(&station) {
        return Ok(None);
    }
    wsr88d_only(&station)?;
    let (key, data) = latest_volume(&station).await?;
    let live = if live {
        chunks::live_scan(&station).await.ok()
    } else {
        None
    };

    tauri::async_runtime::spawn_blocking(move || {
        let asked = requested_sweep(&product, tilt, dealias, motion, None, Look::default());
        let site = registry::site_by_id(&station)
            .ok_or_else(|| Level2Error::UnknownSite(station.to_string()))?;
        let coordinates = RadarCoordinateSystem::new(&site.to_site());
        let (older, folding) = decoded_volume(&key, data)?;
        let older_folding = |elevation: u8| folding.get(&elevation).copied();

        // The angle is taken from the finished volume for the same reason the
        // picture takes it from there: a volume in progress holds only the
        // cuts it has reached.
        let offered = tilts(&older);
        let angle = offered.get(tilt).or_else(|| offered.first()).copied();
        let beneath = prepare_sweep(&station, &older, &older_folding, asked, angle);

        if let Some(found) = live {
            let live_folding = |elevation: u8| found.nyquist.get(&elevation).copied();
            if let Ok(newer) = prepare_sweep(&station, &found.scan, &live_folding, asked, angle) {
                if let Some(reading) = gate_at(
                    &newer,
                    &coordinates,
                    latitude,
                    longitude,
                    found.scan.time_range().map(|(start, _)| start),
                    true,
                ) {
                    return Ok(Some(reading));
                }
            }
        }

        Ok(beneath.ok().and_then(|under| {
            gate_at(
                &under,
                &coordinates,
                latitude,
                longitude,
                older.time_range().map(|(start, _)| start),
                false,
            )
        }))
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

#[cfg(test)]
#[path = "sites_tests.rs"]
mod tests;

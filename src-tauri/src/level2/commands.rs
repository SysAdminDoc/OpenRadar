//! What the frontend calls, and what it gets back.

use super::*;

use serde::Deserialize;

/// The answers to "how should this be drawn" that are not about what is in
/// the volume.
///
/// Grouped for the same reason `Shading` is: four bare booleans at a call site
/// say nothing about which is which, and `false, false, false, false` reads as
/// nothing at all.
#[derive(Debug, Clone, Copy, Default)]
pub struct Look {
    pub high_contrast: bool,
    pub persistence: bool,
    pub reduced_motion: bool,
    /// Read between the gates rather than taking the nearest one.
    pub smooth: bool,
}

/// The two heights the hail algorithm weights between, as the page sends them.
///
/// The workspace has a sounding when the reader has looked at one, and the
/// native side has none at all: it decodes radar. So the freezing level and the
/// minus twenty height come across with the request, along with what the page
/// calls that sounding, and the picture says which it was drawn with.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HailAir {
    pub freezing_km: f64,
    pub minus_twenty_km: f64,
    pub source: String,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn requested_sweep<'a>(
    product: &'a str,
    tilt: usize,
    dealias: bool,
    motion: Option<(f32, f32)>,
    air: Option<&'a HailAir>,
    threshold: Option<f32>,
    look: Look,
    // The ground to draw over, when the page has asked for less than the disc.
    within: Option<[f64; 4]>,
) -> SweepRequest<'a> {
    let manual_motion = motion.map(|(speed, from_degrees)| {
        // A wind named by where it comes from, turned back into the components
        // the subtraction needs.
        let towards = (from_degrees + 180.0).to_radians();
        vad::Wind {
            east: speed * towards.sin(),
            north: speed * towards.cos(),
        }
    });
    SweepRequest {
        product_name: product,
        tilt_index: tilt,
        unfold: dealias,
        manual_motion,
        threshold,
        high_contrast: look.high_contrast,
        persistence: look.persistence,
        reduced_motion: look.reduced_motion,
        smooth: look.smooth,
        isotherms: air.map(|air| derive::Isotherms {
            freezing_km: air.freezing_km,
            minus_twenty_km: air.minus_twenty_km,
            source: &air.source,
        }),
        within,
    }
}

#[tauri::command]
// A Tauri command takes its arguments by name from the page, so the list is the
// contract with the frontend rather than a signature free to be reshaped. The
// three that belong together are grouped into `Shading` the moment they are
// past this boundary.
#[allow(clippy::too_many_arguments)]
pub async fn level2_sweep(
    station: String,
    product: String,
    tilt: usize,
    dealias: bool,
    // Speed in metres a second and the direction it comes from, when the viewer
    // would rather say than have the sweep read for it.
    motion: Option<(f32, f32)>,
    // Hide gates weaker than this, in the product's own unit. A value that is
    // not a number is no threshold rather than a threshold of nothing.
    threshold: Option<f32>,
    // Read the volume the radar is sweeping now rather than the last one it
    // finished. The archive object lands only when a volume is complete, so
    // that picture is four to six minutes behind by definition.
    live: bool,
    // Draw with the ramps built for a reader who has asked for more contrast.
    // Sent by the page rather than read here, because the preference belongs to
    // the window and the native side has no view of the media query.
    high_contrast: bool,
    // Fade the finished sweep behind the one being made. Only ever true on the
    // live path, because it is the only one with two sweeps to composite.
    persistence: bool,
    // Sent by the page, like the contrast preference: the native side has no
    // view of the media query. It keeps the faded composite and drops the
    // bright edge that moves with the beam.
    reduced_motion: bool,
    // Read between the gates rather than taking the nearest one. The picture
    // only: the number the inspector answers with and the numbers an export
    // writes are the gates themselves either way.
    smooth: bool,
    // The freezing level and the minus twenty height, from whatever sounding
    // the workspace has loaded. Absent where it has none, and the standard
    // atmosphere is used instead. Only hail size reads it.
    air: Option<HailAir>,
    // The ground to draw over, west, south, east and north, or nothing for
    // the whole disc.
    //
    // The page works this out from the zoom it is at and the disc the last
    // sweep came back with, because one raster over the site's whole reach is
    // 449 metres a pixel against gates a quarter of a kilometre long: past
    // about zoom ten a reader is looking at this app's sampling rather than
    // at the radar. What comes back carries its own corners either way.
    within: Option<[f64; 4]>,
) -> Result<SweepImage, Level2Error> {
    let station = station.to_uppercase();
    // An airport's own radar is read from its Level III products; nothing
    // below applies to it, and nothing about a WSR-88D changes for it.
    if tdwr::is_tdwr(&station) {
        return tdwr::sweep(station, product, tilt, threshold, high_contrast, within).await;
    }
    wsr88d_only(&station)?;
    let (key, data) = latest_volume(&station).await?;

    // The volume in progress is drawn over the last finished one, so the live
    // path needs both. A site that is not publishing chunks, or one between
    // volumes, simply gets the finished picture: that is what the archive path
    // has always shown and it is never wrong, only behind.
    // Why the scan failed, when one was asked for and did. The picture is the
    // finished volume either way; what this carries is the difference between
    // a site between volumes and one whose chunks cannot be reached, which the
    // age beside the sweep cannot tell apart. The workspace counts these and
    // shows them in Diagnostics, so a feed that has been down for hours says
    // so instead of just looking behind.
    //
    // Except for a product that is the whole volume. Forty seconds into a scan
    // the radar has published the lowest two or three cuts, and a column built
    // from those is not a column: an echo top reads the height of the third
    // beam, VIL collapses to a thin slab, and a hail size goes to nothing
    // because almost none of three low cuts sits above the freezing level.
    // Worse, the sector mask is built from the drawn field's own azimuths, and
    // the lowest cut finishes within about fifteen seconds, so from then on
    // that mask reads the full turn and the three-cut answer replaces the
    // complete volume everywhere rather than over the wedge the radar has
    // reached. The finished volume is behind, which the legend says; a column
    // drawn from a third of one is wrong, which nothing would say.
    let mut live_failed = None;
    let live = if live && live_may_be_drawn(&product) {
        match chunks::live_scan(&station).await {
            Ok(found) => Some(found),
            Err(reason) => {
                log::debug!("no live volume for {station}: {reason}");
                live_failed = Some(reason.to_string());
                None
            }
        }
    } else {
        None
    };

    // Decoding and drawing a volume is CPU work; it must not sit on the async
    // runtime the whole time.
    tauri::async_runtime::spawn_blocking(move || {
        let asked = requested_sweep(
            &product,
            tilt,
            dealias,
            motion,
            air.as_ref(),
            threshold,
            Look {
                high_contrast,
                persistence,
                reduced_motion,
                smooth,
            },
            within,
        );
        match live {
            Some(found) => {
                // The finished volume underneath a live sweep is the same
                // archive volume as ever, so it comes from the same cache. It
                // was being decoded again on every refresh, which is once every
                // few seconds while a live sweep is on.
                let (older, folding) = decoded_volume(&key, data)?;
                sweep_over(
                    &station,
                    &found.volume.volume.to_string(),
                    &key,
                    &older,
                    &|elevation| folding.get(&elevation).copied(),
                    &found.scan,
                    &|elevation| found.nyquist.get(&elevation).copied(),
                    (
                        found.volume.next_chunk_at.clone(),
                        found.volume.ends_at.clone(),
                    ),
                    asked,
                )
            }
            None => sweep_from_volume(&station, &key, data, asked),
        }
        .map(|mut sweep| {
            sweep.live_failed = live_failed;
            sweep
        })
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

/// How many volumes a profile is drawn for at once.
///
/// Each is a whole Archive II object fetched and decoded, so this is the
/// ceiling on what one press of a panel is allowed to ask the bucket for.
///
/// Held below what the volume cache carries, and it used to be above it: six
/// columns against four slots evicted every volume the cache held including
/// the one the loop was drawing, so opening the panel made the picture
/// re-download and re-decode itself. One slot is left for that volume.
pub(crate) const MAX_VWP_COLUMNS: usize = CACHE_CAPACITY - 1;

/// The wind profile of the volumes a held site is showing.
///
/// One column per volume, in the order they were asked for, each carrying
/// which volume it came from. An empty list means the volume the radar
/// published last, which is the single-column case for a reader who is not
/// looping.
#[tauri::command]
pub async fn level2_vwp(
    station: String,
    times: Vec<String>,
) -> Result<Vec<vwp::VwpColumn>, Level2Error> {
    let station = station.to_uppercase();
    wsr88d_only(&station)?;

    let wanted: Vec<Option<DateTime<Utc>>> = if times.is_empty() {
        vec![None]
    } else {
        let mut asked = Vec::new();
        // The newest volumes, not the oldest. The list arrives oldest first
        // and the default loop is longer than this ceiling, so taking from
        // the front drew the wind from an hour ago and never the volume on
        // screen: a profile that answers about a storm the reader is not
        // looking at, with nothing saying so.
        let first = times.len().saturating_sub(MAX_VWP_COLUMNS);
        for at in times.iter().skip(first) {
            let parsed = DateTime::parse_from_rfc3339(at)
                .map_err(|_| Level2Error::InvalidTime(at.clone()))?
                .with_timezone(&Utc);
            asked.push(Some(parsed));
        }
        asked
    };

    // The radar's own processor runs this fit on every volume and publishes
    // the answer as a nine kilobyte file, so the whole volume is only fetched
    // and decoded for a column the office has not written up. One listing
    // covers every column, because they are minutes apart.
    let keys = level3::wind_profile_keys(&station, &wanted).await;

    let mut columns = Vec::with_capacity(wanted.len());
    for at in wanted {
        if let Some((key, profile)) = level3::wind_profile(&keys, at).await {
            columns.push(vwp::from_product(&key, &profile));
            continue;
        }
        let (key, data) = volume_for_export(&station, at).await?;
        // Decoding a volume is CPU work and must not sit on the async runtime.
        let column = tauri::async_runtime::spawn_blocking(move || {
            // Read once and not kept. This panel asks for as many volumes as
            // the decoded cache holds, so keeping them evicted the volume the
            // map was drawing and the next tilt or threshold change on that
            // frame decoded the whole thing again. Nothing here is read
            // twice: a column is built and the scan is dropped.
            let (scan, nyquist) = decoded_volume_once(&key, data)?;
            Ok::<vwp::VwpColumn, Level2Error>(vwp::profile(&key, &scan, &nyquist))
        })
        .await
        .map_err(|error| Level2Error::Decode(error.to_string()))??;
        columns.push(column);
    }
    Ok(columns)
}

/// Where the melting layer is in a station's newest volume.
///
/// Answered as a result rather than an option, because "no cut goes high
/// enough" and "nothing in the cut is melting" are different things and the
/// panel says which. A volume in progress often has neither: the high cuts
/// come last, so the layer arrives late in the scan and that is not a fault.
#[tauri::command]
pub async fn level2_melting(
    station: String,
) -> Result<Result<crate::melting::MeltingLayer, crate::melting::NoLayer>, Level2Error> {
    let station = station.to_uppercase();
    wsr88d_only(&station)?;
    let (key, data) = volume_for_export(&station, None).await?;
    // Decoding a volume is CPU work and must not sit on the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        // Read once and dropped, like the wind profile beside it: this is a
        // panel line rather than the picture, and keeping the scan would
        // evict the volume the map is drawing.
        let (scan, _) = decoded_volume_once(&key, data)?;
        Ok(crate::melting::from_volume(&scan))
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn level2_archive_sweep(
    station: String,
    at: String,
    product: String,
    tilt: usize,
    dealias: bool,
    motion: Option<(f32, f32)>,
    threshold: Option<f32>,
    high_contrast: bool,
    // The freezing level and the minus twenty height, from whatever sounding
    // the workspace has loaded. Absent where it has none, and the standard
    // atmosphere is used instead. Only hail size reads it.
    air: Option<HailAir>,
    // The ground to draw over, so a frame the loop holds covers the same
    // place as the live sweep beside it.
    within: Option<[f64; 4]>,
) -> Result<SweepImage, Level2Error> {
    let station = station.to_uppercase();
    wsr88d_only(&station)?;
    let wanted = DateTime::parse_from_rfc3339(&at)
        .map_err(|_| Level2Error::InvalidTime(at.clone()))?
        .with_timezone(&Utc);
    let (key, data) = archive_volume_at(&station, wanted).await?;

    tauri::async_runtime::spawn_blocking(move || {
        // An archive or a local volume is one finished scan, so there is
        // nothing behind it to fade.
        let asked = requested_sweep(
            &product,
            tilt,
            dealias,
            motion,
            air.as_ref(),
            threshold,
            Look {
                high_contrast,
                ..Look::default()
            },
            within,
        );
        let mut sweep = sweep_from_volume(&station, &key, data, asked)?;
        sweep.source = SweepSource {
            kind: "archive".to_string(),
            label: "NOAA NEXRAD Level II archive".to_string(),
            url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
        };
        Ok(sweep)
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn level2_local_sweep(
    path: String,
    product: String,
    tilt: usize,
    dealias: bool,
    motion: Option<(f32, f32)>,
    threshold: Option<f32>,
    high_contrast: bool,
    // The freezing level and the minus twenty height, from whatever sounding
    // the workspace has loaded. Absent where it has none, and the standard
    // atmosphere is used instead. Only hail size reads it.
    air: Option<HailAir>,
    // The ground to draw over. None on a file the reader has just opened, and
    // a box on every ask after that: the first answer is what says where the
    // file's own site reaches, and the box is measured on that rather than on
    // the site the map happens to be over. See `historicalWithin` in
    // `useSingleSiteRadar.ts`.
    within: Option<[f64; 4]>,
) -> Result<SweepImage, Level2Error> {
    tauri::async_runtime::spawn_blocking(move || {
        let local = read_local_volume(&PathBuf::from(path))?;
        // An archive or a local volume is one finished scan, so there is
        // nothing behind it to fade.
        let asked = requested_sweep(
            &product,
            tilt,
            dealias,
            motion,
            air.as_ref(),
            threshold,
            Look {
                high_contrast,
                ..Look::default()
            },
            within,
        );
        let mut sweep = sweep_from_volume(&local.station, &local.key, local.data, asked)?;
        sweep.source = SweepSource {
            kind: "local".to_string(),
            label: local.label,
            url: None,
        };
        Ok(sweep)
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

//! A sweep request answered as a picture, with the volume before it under it.

use super::*;

/// Decodes a volume and draws one of its sweeps. Split out from the command so
/// a test can run it against a file without touching the network.
/// What the reader asked to see, past which volume it came from.
#[derive(Debug, Clone, Copy, Default)]
pub struct SweepRequest<'a> {
    pub product_name: &'a str,
    pub tilt_index: usize,
    pub unfold: bool,
    /// A motion the viewer gave, rather than one read off the sweep.
    pub manual_motion: Option<vad::Wind>,
    /// Gates weaker than this are left clear, in the product's own unit.
    pub threshold: Option<f32>,
    /// Draw with the ramps built for a reader who has asked for more contrast.
    pub high_contrast: bool,
    /// Fade the finished sweep behind the one being made, the way a phosphor
    /// screen does. Nothing about the readings changes; only the opacity the
    /// older cut is drawn at, and only outside the sector the radar has
    /// reached in the volume it is sweeping now.
    pub persistence: bool,
    /// True when the reader has asked the system for less movement, which
    /// keeps the faded composite and drops the bright edge that moves with
    /// the beam.
    pub reduced_motion: bool,
    /// Draw the sweep by reading between its gates rather than by taking the
    /// nearest one. The picture only; the numbers a reader inspects and the
    /// numbers an export writes are the gates themselves either way.
    pub smooth: bool,
}

pub fn sweep_from_volume(
    station: &str,
    volume_key: &str,
    data: Vec<u8>,
    asked: SweepRequest<'_>,
) -> Result<SweepImage, Level2Error> {
    let (scan, nyquist) = decoded_volume(volume_key, data)?;
    let folding = |elevation: u8| nyquist.get(&elevation).copied();
    sweep_from_scan(station, volume_key, &scan, &folding, asked)
}

/// One sweep's readings, as they are rather than as they look.
///
/// The picture path and this one share everything up to the drawing: the same
/// cut is chosen, the same velocity is unfolded, the same storm motion is
/// taken out. What comes back here is the field itself, so an export can
/// write the numbers the picture was painted from rather than sampling their
/// colours back out of it.
pub(crate) struct SweepValues {
    pub station: String,
    pub site_name: String,
    pub site: nexrad_model::meta::Site,
    pub radar: &'static str,
    pub product_id: String,
    pub product: &'static str,
    pub unit: &'static str,
    pub volume: String,
    pub collected: Option<DateTime<Utc>>,
    /// True when the velocity here has been unfolded past the radar's limit.
    pub dealiased: bool,
    /// The motion subtracted, on a storm relative product.
    pub storm_motion: Option<StormMotion>,
    pub field: SweepField,
}

/// The readings of one cut of one volume, chosen exactly as the picture is.
pub(crate) fn sweep_values(
    station: &str,
    volume_key: &str,
    data: Vec<u8>,
    asked: SweepRequest<'_>,
) -> Result<SweepValues, Level2Error> {
    let (scan, nyquist) = decoded_volume(volume_key, data)?;
    let folding = |elevation: u8| nyquist.get(&elevation).copied();
    let prepared = prepare_sweep(station, &scan, &folding, asked, None)?;
    let site = registry::site_by_id(station)
        .ok_or_else(|| Level2Error::UnknownSite(station.to_string()))?;
    let collected = prepared
        .chosen
        .collected
        .or_else(|| scan.time_range().map(|(start, _)| start));
    Ok(SweepValues {
        station: station.to_string(),
        site_name: format!("{}, {}", site.city, site.state),
        site: site.to_site(),
        radar: WSR88D,
        product_id: asked.product_name.to_string(),
        product: prepared.label,
        unit: prepared.unit,
        volume: volume_key.to_string(),
        collected,
        dealiased: prepared.dealiased,
        storm_motion: prepared.storm_motion,
        field: prepared.chosen.field,
    })
}

/// The volume behind a sweep export, fetched the way the picture's was.
pub(crate) async fn volume_for_export(
    station: &str,
    at: Option<DateTime<Utc>>,
) -> Result<(String, Vec<u8>), Level2Error> {
    wsr88d_only(station)?;
    match at {
        Some(wanted) => archive_volume_at(station, wanted).await,
        None => latest_volume(station).await,
    }
}

/// The same for a volume the reader opened off their own disk.
///
/// The label comes back with it because the path must not: it is the file's
/// own name with a generic fallback, worked out where the file is read and
/// nowhere else.
pub(crate) fn local_volume_for_export(
    path: &Path,
) -> Result<(String, String, String, Vec<u8>), Level2Error> {
    let local = read_local_volume(path)?;
    Ok((local.station, local.key, local.label, local.data))
}

/// A sweep request built the way the picture's is, for an export that has to
/// match what is on screen.
pub(crate) fn export_request<'a>(
    product: &'a str,
    tilt: usize,
    dealias: bool,
    motion: Option<(f32, f32)>,
) -> SweepRequest<'a> {
    // No threshold and no contrast choice: both are about drawing, and an
    // export of the readings is not drawn.
    // Values rather than a picture, so neither the threshold nor any of the
    // drawing options apply.
    requested_sweep(product, tilt, dealias, motion, None, Look::default())
}

/// The same, from a scan that has already been put together.
///
/// The volume being swept right now arrives as chunks rather than as a file,
/// and everything past this point is the same either way: the same sweep
/// chooser, the same unfolding, the same drawing. Only how the readings got
/// here differs, and that is settled before this is called.
pub fn sweep_from_scan(
    station: &str,
    volume_key: &str,
    scan: &Scan,
    nyquist_for: &dyn Fn(u8) -> Option<f32>,
    asked: SweepRequest<'_>,
) -> Result<SweepImage, Level2Error> {
    let prepared = prepare_sweep(station, scan, nyquist_for, asked, None)?;
    draw_sweep(
        station,
        volume_key,
        tilts(scan),
        asked.tilt_index,
        prepared,
        None,
        asked,
        scan.time_range().map(|(start, _)| start),
        None,
    )
}

/// One sweep found and worked on, before anything has been drawn.
///
/// Splitting this from the drawing is what lets a volume in progress be laid
/// over the last finished one: both go through the same choosing, the same
/// unfolding and the same subtraction, and only then are they put together.
pub(crate) struct Prepared {
    chosen: ChosenSweep,
    dealiased: bool,
    storm_motion: Option<StormMotion>,
    product: Product,
    label: &'static str,
    unit: &'static str,
}

pub(crate) fn prepare_sweep(
    station: &str,
    scan: &Scan,
    nyquist_for: &dyn Fn(u8) -> Option<f32>,
    asked: SweepRequest<'_>,
    // The cut to look for by angle rather than by position. A volume in
    // progress holds only the tilts it has reached, so counting into its list
    // would land on a different cut than the same number does in a full one.
    angle: Option<f32>,
) -> Result<Prepared, Level2Error> {
    let SweepRequest {
        product_name,
        tilt_index,
        unfold,
        manual_motion,
        threshold: _,
        high_contrast: _,
        persistence: _,
        reduced_motion: _,
        smooth: _,
    } = asked;
    let (product, label, unit) = product_from_name(product_name)
        .ok_or_else(|| Level2Error::NoSweep(station.to_string(), product_name.to_string()))?;

    let mut chosen = match angle {
        Some(wanted) => sweep_field_at(scan, product, wanted),
        None => sweep_field(scan, product, tilt_index),
    }
    .ok_or_else(|| Level2Error::NoSweep(station.to_string(), label.to_string()))?;

    // Velocity past the folding limit wraps around, so a strong outbound wind
    // is drawn as if it were inbound. Only velocity folds, and only if the
    // volume says what it folds at.
    // Reported only when gates actually moved. A sweep that never folded is
    // the radar's own reading, and saying otherwise would have the legend claim
    // a change that was not made.
    let storm_relative = product_name == "storm-relative-velocity";
    // Storm relative is the same moment with the ambient wind taken out, and
    // the wind is read off the sweep, so a folded sweep has to be unfolded
    // first whatever the switch says. A fit against a folded field collapses:
    // measured on a 20 m/s wind folded at 8, it comes back with 1.4.
    let mut dealiased = false;
    if (unfold || storm_relative) && product == Product::Velocity {
        if let Some(nyquist) = nyquist_for(chosen.elevation_number) {
            dealiased = unfold_velocity(&mut chosen.field, nyquist);
        } else if storm_relative && manual_motion.is_none() {
            // No Nyquist velocity means no unfolding, and a wind read off a
            // sweep that may still be folded is not a wind. A motion the
            // viewer gave is theirs to stand behind, so that still goes ahead.
            return Err(Level2Error::NoStormMotion(station.to_string()));
        }
    }

    let mut storm_motion = None;
    if storm_relative {
        let wind = match manual_motion {
            Some(given) => Some(given),
            None => fitted_wind(&chosen.field),
        };
        // Nothing to subtract is not the same as nothing to take out. Drawing
        // raw velocity under the storm relative label would be the worst of
        // both: the picture unchanged and the reader told otherwise.
        let wind = wind.ok_or_else(|| Level2Error::NoStormMotion(station.to_string()))?;
        make_storm_relative(&mut chosen.field, wind);
        storm_motion = Some(StormMotion {
            speed_ms: wind.speed(),
            from_degrees: wind.coming_from_degrees(),
            manual: manual_motion.is_some(),
        });
    }

    Ok(Prepared {
        chosen,
        dealiased,
        storm_motion,
        product,
        label,
        unit,
    })
}

/// How far the volume being swept right now has got, for the legend.
///
/// The three travel together and mean nothing apart: a count of cuts with no
/// projection beside it is what the legend had before, and a projection with
/// no live sweep under it is an answer about a volume nobody is watching.
pub struct LiveProgress {
    /// How many cuts the volume in progress has published.
    pub tilts: usize,
    /// When the next piece is due, and when the volume is projected to end.
    pub next_chunk_at: Option<String>,
    pub ends_at: Option<String>,
}

/// Paints a prepared sweep, optionally over the one before it.
#[allow(clippy::too_many_arguments)]
pub(crate) fn draw_sweep(
    station: &str,
    volume_key: &str,
    // The cuts the picker should offer, which for a live sweep is the list from
    // the last finished volume rather than the part-built one on screen.
    tilts_offered: Vec<f32>,
    tilt_index: usize,
    prepared: Prepared,
    // The last finished volume's sweep, drawn under the sector this one covers.
    beneath: Option<Prepared>,
    asked: SweepRequest<'_>,
    // The volume's own start time, used when the cut does not carry one.
    volume_time: Option<DateTime<Utc>>,
    // What the volume in progress has published so far, when this is live.
    live: Option<LiveProgress>,
) -> Result<SweepImage, Level2Error> {
    let Prepared {
        chosen,
        dealiased,
        storm_motion,
        product,
        label,
        unit,
    } = prepared;
    let threshold = asked.threshold;

    let site = registry::site_by_id(station).map(|entry| entry.to_site());
    let site = site.ok_or_else(|| Level2Error::UnknownSite(station.to_string()))?;
    let coordinates = RadarCoordinateSystem::new(&site);

    let (mut pixels, [west, south, east, north]) = render_sweep(
        &chosen.field,
        &coordinates,
        product,
        unit,
        Shading {
            unfolded: dealiased,
            threshold,
            high_contrast: asked.high_contrast,
        },
        asked.smooth,
    );

    let mut beneath_collected = None;
    if let Some(under) = beneath {
        // Every render covers the same extent at the same size, so the two
        // line up pixel for pixel and the sector decides which one shows.
        let (older, _) = render_sweep(
            &under.chosen.field,
            &coordinates,
            under.product,
            under.unit,
            Shading {
                unfolded: under.dealiased,
                threshold,
                high_contrast: asked.high_contrast,
            },
            asked.smooth,
        );
        // The older cut's own time, which is what the legend says the oldest
        // thing on screen is. Without it a composite reports only the age of
        // its newest half.
        beneath_collected = under.chosen.collected.or(volume_time);
        let keep = if asked.persistence {
            let age = match (chosen.collected, beneath_collected) {
                (Some(newest), Some(oldest)) => (newest - oldest).num_seconds().max(0) as f32,
                // No time on one of them is no age to fade by, so the picture
                // is the one it has always been rather than an invented decay.
                _ => 0.0,
            };
            persistence_keep(age)
        } else {
            1.0
        };
        pixels = lay_over(
            older,
            pixels,
            &swept_pixels(&chosen.field, &coordinates),
            keep,
        );
        // Only over a composite, and only when the reader asked for the
        // phosphor picture: a finished volume has no beam position to mark.
        if asked.persistence && !asked.reduced_motion {
            if let Some(azimuth) = chosen.leading_azimuth {
                draw_leading_edge(
                    &mut pixels,
                    &coordinates,
                    chosen.field.elevation_degrees(),
                    azimuth,
                );
            }
        }
    }

    let png_bytes = encode_png(&pixels)?;

    // The sweep's own time, not the volume's: under MESO-SAILS the lowest tilt
    // is cut four times across five minutes, and saying which one is on screen
    // is the difference between a current picture and a stale one.
    let collected = chosen
        .collected
        .or(volume_time)
        .or_else(|| key_time(volume_key))
        .unwrap_or_else(Utc::now);

    let entry = registry::site_by_id(station);
    Ok(SweepImage {
        station: station.to_string(),
        product_id: asked.product_name.to_string(),
        palette_applied: palette::for_unit(unit).is_some(),
        high_contrast: asked.high_contrast,
        smoothed: asked.smooth,
        site_name: entry
            .map(|site| format!("{}, {}", site.city, site.state))
            .unwrap_or_else(|| station.to_string()),
        product: label.to_string(),
        unit: unit.to_string(),
        dealiased,
        storm_motion,
        elevation_degrees: (chosen.elevation_degrees * 100.0).round() / 100.0,
        tilts: tilts_offered,
        tilt_index,
        live: live.is_some(),
        live_tilts: live.as_ref().map_or(0, |one| one.tilts),
        next_chunk_at: live.as_ref().and_then(|one| one.next_chunk_at.clone()),
        volume_ends_at: live.as_ref().and_then(|one| one.ends_at.clone()),
        collected: collected.to_rfc3339(),
        beneath_collected: beneath_collected.map(|at| at.to_rfc3339()),
        west,
        south,
        east,
        north,
        image: data_url(&png_bytes),
        volume: volume_key.to_string(),
        source: SweepSource {
            kind: "recent".to_string(),
            label: "NOAA NEXRAD Level II".to_string(),
            url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
        },
        radar: WSR88D,
        range_km: MAX_RANGE_KM,
    })
}

/// How finely the swept sector is measured, in slots around the circle.
pub(crate) const SECTOR_SLOTS: usize = 3600;

/// Which pixels the sweep in hand actually swept.
///
/// Outside the sector a volume in progress has reached, the last finished
/// volume is all there is to show. Inside it the new sweep is the whole answer,
/// empty gates included: a storm that has moved on has to come off the picture
/// rather than be left painted where it used to be.
pub(crate) fn swept_pixels(field: &SweepField, coordinates: &RadarCoordinateSystem) -> Vec<bool> {
    let mut ring = vec![false; SECTOR_SLOTS];
    let per_slot = 360.0 / SECTOR_SLOTS as f32;
    // A radial stands for the wedge it was measured across, not for a line.
    let half = field.azimuth_spacing_degrees().abs().max(per_slot) / 2.0;
    for azimuth in field.azimuths() {
        let first = ((azimuth - half) / per_slot).floor() as i64;
        let last = ((azimuth + half) / per_slot).ceil() as i64;
        for slot in first..=last {
            let slot = slot.rem_euclid(SECTOR_SLOTS as i64) as usize;
            ring[slot] = true;
        }
    }

    let near = field.first_gate_range_km();
    let far = field.max_range_km();
    let extent = coordinates.sweep_extent(MAX_RANGE_KM);
    let west = extent.min.longitude;
    let east = extent.max.longitude;
    let top = mercator_y(extent.max.latitude);
    let bottom = mercator_y(extent.min.latitude);
    let elevation = field.elevation_degrees();

    let mut swept = vec![false; IMAGE_SIZE * IMAGE_SIZE];
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
            if polar.range_km < near || polar.range_km >= far {
                continue;
            }
            let slot = (polar.azimuth_degrees.rem_euclid(360.0) / per_slot) as usize;
            if ring[slot.min(SECTOR_SLOTS - 1)] {
                swept[row * IMAGE_SIZE + column] = true;
            }
        }
    }
    swept
}

/// Puts the newer picture over the older one, but only where it was swept.
/// The two sweeps composited, with the older one faded by `keep`.
///
/// `keep` of 1.0 is the picture as it has always been: the finished volume at
/// full strength wherever the live cut has not reached. Below that, the older
/// sweep is drawn dimmer, which is what a phosphor screen does and what
/// everybody has in their head when they think of radar. It is opacity and
/// nothing else: no gate value moves, and inside the swept sector the live
/// pixels win outright as before, empty ones included, so a storm that has
/// moved on still comes off the picture.
pub(crate) fn lay_over(older: Vec<u8>, newer: Vec<u8>, swept: &[bool], keep: f32) -> Vec<u8> {
    let mut out = older;
    let keep = keep.clamp(0.0, 1.0);
    for (index, covered) in swept.iter().enumerate() {
        let at = index * 4;
        if *covered {
            out[at..at + 4].copy_from_slice(&newer[at..at + 4]);
        } else if keep < 1.0 {
            // Only the alpha. Scaling the colour would move a reading towards
            // a different step on the ramp, which is the one thing this is
            // not allowed to do.
            out[at + 3] = (f32::from(out[at + 3]) * keep).round() as u8;
        }
    }
    out
}

/// The reading at one point of a prepared cut, if the cut covers it.
///
/// The same `value_at_polar` the renderer asks, so the number a reader is
/// shown is the number the pixel under the cursor was painted from rather
/// than a colour sampled back out of the picture.
pub(crate) fn gate_at(
    prepared: &Prepared,
    coordinates: &RadarCoordinateSystem,
    latitude: f64,
    longitude: f64,
    volume_time: Option<DateTime<Utc>>,
    live: bool,
) -> Option<GateReading> {
    let field = &prepared.chosen.field;
    let polar = coordinates.geo_to_polar(
        GeoPoint {
            latitude,
            longitude,
        },
        field.elevation_degrees(),
    );
    if polar.range_km > MAX_RANGE_KM {
        return None;
    }
    // `value_at_polar` takes the nearest radial it holds, whatever the gap. On
    // a cut in progress that means a bearing the radar has not swept comes
    // back with the reading from wherever it stopped, which is not a reading
    // at that point at all. A radial stands for the wedge it was measured
    // across and no further.
    let half = field.azimuth_spacing_degrees().abs().max(0.5);
    let covered = field.azimuths().iter().any(|azimuth| {
        let away = (azimuth - polar.azimuth_degrees).rem_euclid(360.0);
        away.min(360.0 - away) <= half
    });
    if !covered {
        return None;
    }
    let (value, status) = field.value_at_polar(polar.azimuth_degrees, polar.range_km)?;
    // A gate the radar could not read is not a reading. Range folding is the
    // radar saying it cannot tell where the echo is, which is worse than
    // nothing to put in front of somebody as a number.
    if !matches!(status, GateStatus::Valid) {
        return None;
    }
    let collected = prepared.chosen.collected.or(volume_time)?;
    Some(GateReading {
        value,
        unit: prepared.unit.to_string(),
        product: prepared.label.to_string(),
        collected: collected.to_rfc3339(),
        live,
        azimuth_degrees: (polar.azimuth_degrees * 10.0).round() / 10.0,
        range_km: (polar.range_km * 10.0).round() / 10.0,
    })
}

/// How wide the bright edge at the beam is, in degrees either side.
pub(crate) const LEADING_EDGE_DEGREES: f32 = 1.6;

/// Brightens the wedge the beam has just left.
///
/// This is the part everybody pictures when they picture radar. It is drawn
/// over the composite rather than into it, and it touches no gate: the pixels
/// it lightens keep whatever value put them there, and a pixel with nothing in
/// it stays empty, so the edge marks where the beam is without inventing an
/// echo along it.
pub(crate) fn draw_leading_edge(
    pixels: &mut [u8],
    coordinates: &RadarCoordinateSystem,
    elevation: f32,
    azimuth: f32,
) {
    let extent = coordinates.sweep_extent(MAX_RANGE_KM);
    let west = extent.min.longitude;
    let east = extent.max.longitude;
    let top = mercator_y(extent.max.latitude);
    let bottom = mercator_y(extent.min.latitude);
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
            if polar.range_km > MAX_RANGE_KM {
                continue;
            }
            let away = (polar.azimuth_degrees - azimuth).rem_euclid(360.0);
            let away = away.min(360.0 - away);
            if away > LEADING_EDGE_DEGREES {
                continue;
            }
            let at = (row * IMAGE_SIZE + column) * 4;
            // Nothing is painted where nothing was measured, and what was
            // measured is lightened rather than replaced.
            let strength = 1.0 - away / LEADING_EDGE_DEGREES;
            let lift = 0.55 * strength;
            for channel in 0..3 {
                let held = f32::from(pixels[at + channel]);
                pixels[at + channel] = (held + (255.0 - held) * lift).round() as u8;
            }
            let alpha = f32::from(pixels[at + 3]);
            pixels[at + 3] = alpha.max(150.0 * strength).round() as u8;
        }
    }
}

/// How much of the finished sweep is left, given how far behind it is.
///
/// A volume takes four to six minutes in precipitation mode, so by the time
/// the next one is being swept the last one is a volume old. This runs from
/// full at no age down to `PERSISTENCE_FLOOR` at `PERSISTENCE_FULL_SECS` and
/// stops there: a sweep that fades to nothing is a sweep that has taken the
/// context away rather than aged it.
pub(crate) const PERSISTENCE_FULL_SECS: f32 = 360.0;
pub(crate) const PERSISTENCE_FLOOR: f32 = 0.35;

pub(crate) fn persistence_keep(age_seconds: f32) -> f32 {
    if !age_seconds.is_finite() || age_seconds <= 0.0 {
        return 1.0;
    }
    let along = (age_seconds / PERSISTENCE_FULL_SECS).clamp(0.0, 1.0);
    1.0 - along * (1.0 - PERSISTENCE_FLOOR)
}

#[cfg(test)]
#[path = "draw_tests.rs"]
mod tests;

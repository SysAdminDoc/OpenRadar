//! A vertical slice through the volume along a line on the map.

use super::*;

/// How wide and how tall a cross-section picture is, in pixels.
///
/// Wider than it is tall on purpose: a slice runs tens of kilometres across
/// and eighteen up, and drawing it square would stretch the vertical out of
/// all proportion to what it means.
pub(crate) const SECTION_WIDTH: usize = 720;
pub(crate) const SECTION_HEIGHT: usize = 260;

/// A vertical slice through the volume, ready to show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossSection {
    pub station: String,
    pub site_name: String,
    pub product_id: String,
    pub product: String,
    pub unit: String,
    /// True when a loaded colour table drew this rather than the built-in ramp.
    pub palette_applied: bool,
    /// True when the high-contrast ramps drew this.
    pub high_contrast: bool,
    /// True when the velocity in this slice has been unfolded.
    pub dealiased: bool,
    /// The two points the reader put down, as longitude and latitude.
    pub from: (f64, f64),
    pub to: (f64, f64),
    /// How far apart they are along the ground, in kilometres.
    pub distance_km: f64,
    /// How far up the picture reaches, in kilometres above the radar.
    pub top_km: f64,
    /// The lowest and highest cut that put a reading in the picture. Absent
    /// when nothing did, which is a line the volume has nothing to say about
    /// rather than a failure.
    pub lowest_cut: Option<f32>,
    pub highest_cut: Option<f32>,
    /// Every cut the volume holds, so the picture can say what it was built
    /// from rather than only what ended up visible.
    pub tilts: Vec<f32>,
    /// When the volume was collected, not when it was asked for.
    pub collected: String,
    pub volume: String,
    pub width: usize,
    pub height: usize,
    /// The slice as a data URL, ready for an `img`.
    pub image: String,
    pub source: SweepSource,
}

/// What the reader asked for, past which volume it came from.
#[derive(Debug, Clone, Copy)]
pub struct SectionRequest<'a> {
    pub product_name: &'a str,
    /// Longitude and latitude, in the order a map hands them over.
    pub from: (f64, f64),
    pub to: (f64, f64),
    pub unfold: bool,
    pub threshold: Option<f32>,
    pub high_contrast: bool,
}

/// Cuts one volume between two points.
///
/// Split from the command so a test can run it against a volume built by hand
/// rather than against whatever the weather is doing.
pub fn cross_section_from_volume(
    station: &str,
    volume_key: &str,
    data: Vec<u8>,
    asked: SectionRequest<'_>,
) -> Result<CrossSection, Level2Error> {
    let (scan, nyquist) = decoded_volume(volume_key, data)?;
    cross_section_from_scan(
        station,
        volume_key,
        &scan,
        &|elevation| nyquist.get(&elevation).copied(),
        asked,
    )
}

pub fn cross_section_from_scan(
    station: &str,
    volume_key: &str,
    scan: &Scan,
    nyquist_for: &dyn Fn(u8) -> Option<f32>,
    asked: SectionRequest<'_>,
) -> Result<CrossSection, Level2Error> {
    let (product, label, unit) = product_from_name(asked.product_name)
        .ok_or_else(|| Level2Error::NoSweep(station.to_string(), asked.product_name.to_string()))?;

    let site = registry::site_by_id(station)
        .map(|entry| entry.to_site())
        .ok_or_else(|| Level2Error::UnknownSite(station.to_string()))?;
    let coordinates = RadarCoordinateSystem::new(&site);

    let from = GeoPoint {
        longitude: asked.from.0,
        latitude: asked.from.1,
    };
    let to = GeoPoint {
        longitude: asked.to.0,
        latitude: asked.to.1,
    };
    // A line with an end outside the radar's reach is a question about
    // somewhere it cannot see. Refusing is the honest answer: half a picture
    // silently trailing off would read as a storm ending where it does not.
    let site_at = GeoPoint {
        latitude: coordinates.latitude(),
        longitude: coordinates.longitude(),
    };
    for end in [from, to] {
        if cross_section::ground_distance_km(site_at, end) > MAX_RANGE_KM {
            return Err(Level2Error::OutOfRange(station.to_string()));
        }
    }

    // Every cut the volume holds, each unfolded on its own terms, because the
    // folding velocity is a property of the cut rather than of the volume.
    let angles = tilts(scan);
    let mut chosen: Vec<ChosenSweep> = Vec::with_capacity(angles.len());
    let mut dealiased = false;
    for angle in &angles {
        let Some(mut cut) = sweep_field_at(scan, product, *angle) else {
            continue;
        };
        if asked.unfold && product == Product::Velocity {
            if let Some(folds_at) = nyquist_for(cut.elevation_number) {
                dealiased |= unfold_velocity(&mut cut.field, folds_at);
            }
        }
        chosen.push(cut);
    }
    if chosen.is_empty() {
        return Err(Level2Error::NoSweep(station.to_string(), label.to_string()));
    }

    let cuts: Vec<cross_section::Cut<'_>> = chosen
        .iter()
        .map(|cut| cross_section::Cut {
            elevation_degrees: cut.elevation_degrees,
            field: &cut.field,
        })
        .collect();
    let taken = cross_section::slice(
        &coordinates,
        &cuts,
        from,
        to,
        SECTION_WIDTH,
        SECTION_HEIGHT,
        cross_section::TOP_KM,
    );

    // A moment with no standard ramp is scaled to what this slice holds, the
    // same way a sweep is scaled to what that sweep holds.
    let table = palette::for_unit(unit);
    let range = match product {
        Product::Reflectivity | Product::Velocity => None,
        _ => slice_range(&taken),
    };
    let shading = Shading {
        unfolded: dealiased,
        threshold: asked.threshold,
        high_contrast: asked.high_contrast,
    };

    let mut pixels = vec![0u8; taken.width * taken.height * 4];
    for row in 0..taken.height {
        for column in 0..taken.width {
            let Some(cell) = taken.cell(column, row) else {
                continue;
            };
            let Some((color, alpha)) = gate_color(
                &cell.status,
                cell.value,
                product,
                table.as_ref(),
                range,
                shading,
            ) else {
                continue;
            };
            let at = (row * taken.width + column) * 4;
            pixels[at] = color[0];
            pixels[at + 1] = color[1];
            pixels[at + 2] = color[2];
            pixels[at + 3] = alpha;
        }
    }

    let png_bytes = encode_png_sized(&pixels, taken.width, taken.height)?;
    let collected = chosen
        .iter()
        .filter_map(|cut| cut.collected)
        .min()
        .or_else(|| scan.time_range().map(|(start, _)| start))
        .or_else(|| key_time(volume_key))
        .unwrap_or_else(Utc::now);
    let entry = registry::site_by_id(station);

    Ok(CrossSection {
        station: station.to_string(),
        site_name: entry
            .map(|site| format!("{}, {}", site.city, site.state))
            .unwrap_or_else(|| station.to_string()),
        product_id: asked.product_name.to_string(),
        product: label.to_string(),
        unit: unit.to_string(),
        palette_applied: table.is_some(),
        high_contrast: asked.high_contrast,
        dealiased,
        from: asked.from,
        to: asked.to,
        distance_km: taken.distance_km,
        top_km: taken.top_km,
        lowest_cut: taken.covered.map(|(low, _)| low),
        highest_cut: taken.covered.map(|(_, high)| high),
        tilts: angles,
        collected: collected.to_rfc3339(),
        volume: volume_key.to_string(),
        width: taken.width,
        height: taken.height,
        image: data_url(&png_bytes),
        source: SweepSource {
            kind: "recent".to_string(),
            label: "NOAA NEXRAD Level II".to_string(),
            url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
        },
    })
}

/// The lowest and highest reading in a slice, for a moment with no fixed ramp.
pub(crate) fn slice_range(taken: &cross_section::Slice) -> Option<(f32, f32)> {
    let mut low = f32::MAX;
    let mut high = f32::MIN;
    let mut found = false;
    for cell in taken.cells.iter().flatten() {
        if !matches!(cell.status, GateStatus::Valid) {
            continue;
        }
        low = low.min(cell.value);
        high = high.max(cell.value);
        found = true;
    }
    found.then_some((low, high))
}

/// Cuts the volume on screen between two points on the map.
///
/// Which volume that is follows the same three ways in as a sweep: a chosen
/// file, a moment in the public archive, or whatever the site published last.
/// The picture is the one the reader is already looking at, so the slice has
/// to come from the same place it did.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn level2_cross_section(
    station: Option<String>,
    // A moment in the public archive, when the reader is reading one.
    at: Option<String>,
    // A file the reader chose. Never leaves this boundary.
    path: Option<String>,
    product: String,
    from: (f64, f64),
    to: (f64, f64),
    dealias: bool,
    threshold: Option<f32>,
    high_contrast: bool,
) -> Result<CrossSection, Level2Error> {
    // A threshold that is not a finite number is no threshold at all, rather
    // than a threshold of nothing, which would empty the picture.
    let threshold = threshold.filter(|value| value.is_finite());

    if let Some(path) = path {
        return tauri::async_runtime::spawn_blocking(move || {
            let local = read_local_volume(&PathBuf::from(path))?;
            let mut section = cross_section_from_volume(
                &local.station,
                &local.key,
                local.data,
                SectionRequest {
                    product_name: &product,
                    from,
                    to,
                    unfold: dealias,
                    threshold,
                    high_contrast,
                },
            )?;
            section.source = SweepSource {
                kind: "local".to_string(),
                label: local.label,
                url: None,
            };
            Ok(section)
        })
        .await
        .map_err(|error| Level2Error::Decode(error.to_string()))?;
    }

    let station = station.unwrap_or_default().to_uppercase();
    wsr88d_only(&station)?;

    let (key, data, archived) = match at {
        Some(at) => {
            let wanted = DateTime::parse_from_rfc3339(&at)
                .map_err(|_| Level2Error::InvalidTime(at.clone()))?
                .with_timezone(&Utc);
            let (key, data) = archive_volume_at(&station, wanted).await?;
            (key, data, true)
        }
        None => {
            let (key, data) = latest_volume(&station).await?;
            (key, data, false)
        }
    };

    tauri::async_runtime::spawn_blocking(move || {
        let mut section = cross_section_from_volume(
            &station,
            &key,
            data,
            SectionRequest {
                product_name: &product,
                from,
                to,
                unfold: dealias,
                threshold,
                high_contrast,
            },
        )?;
        if archived {
            section.source = SweepSource {
                kind: "archive".to_string(),
                label: "NOAA NEXRAD Level II archive".to_string(),
                url: Some("https://registry.opendata.aws/noaa-nexrad/".to_string()),
            };
        }
        Ok(section)
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

/// Draws the volume in progress over the last one the radar finished.
///
/// The sector the radar has swept since the last volume closed is the new
/// picture; everywhere else the finished volume is still the best there is.
/// If the cut being asked for has not been reached yet, there is nothing live
/// to show for it and the finished volume is the whole answer.
#[allow(clippy::too_many_arguments)]
pub(crate) fn sweep_over(
    station: &str,
    volume_key: &str,
    older: &Scan,
    older_nyquist: &dyn Fn(u8) -> Option<f32>,
    live: &Scan,
    live_nyquist: &dyn Fn(u8) -> Option<f32>,
    // When the next piece is due and when the volume ends, from the chunk
    // reader's projection. Absent until a start chunk has been read.
    projected: (Option<String>, Option<String>),
    asked: SweepRequest<'_>,
) -> Result<SweepImage, Level2Error> {
    let offered = tilts(older);
    // The picker counts into the finished volume's cuts, because the one in
    // progress has only the cuts it has reached so far and its third entry is
    // not the pattern's third cut.
    let angle = offered
        .get(asked.tilt_index)
        .or_else(|| offered.first())
        .copied();
    let Some(angle) = angle else {
        return Err(Level2Error::NoSweep(
            station.to_string(),
            asked.product_name.to_string(),
        ));
    };

    let beneath = prepare_sweep(station, older, older_nyquist, asked, Some(angle));
    let Ok(newer) = prepare_sweep(station, live, live_nyquist, asked, Some(angle)) else {
        // The radar has not reached this cut in the volume it is sweeping now,
        // so the finished volume is the whole picture and says nothing about
        // being live, because none of what is on screen is.
        return draw_sweep(
            station,
            volume_key,
            offered,
            asked.tilt_index,
            beneath?,
            None,
            asked,
            older.time_range().map(|(start, _)| start),
            None,
        );
    };

    draw_sweep(
        station,
        volume_key,
        offered,
        asked.tilt_index,
        newer,
        beneath.ok(),
        asked,
        live.time_range().map(|(start, _)| start),
        Some(LiveProgress {
            tilts: tilts(live).len(),
            next_chunk_at: projected.0,
            ends_at: projected.1,
        }),
    )
}

#[cfg(test)]
#[path = "section_tests.rs"]
mod tests;

//! Choosing one cut out of a volume, and what has to be done to it first.

use super::*;

/// Every distinct tilt in a scan, ascending, rounded the way a panel shows them.
pub fn tilts(scan: &Scan) -> Vec<f32> {
    let mut angles: Vec<f32> = scan
        .sweeps()
        .iter()
        .filter_map(|sweep| sweep.elevation_angle_degrees())
        .map(|angle| (angle * 100.0).round() / 100.0)
        .collect();
    angles.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    angles.dedup();
    angles
}

/// A sweep chosen to draw: the field, the elevation it was cut at, and when
/// it was actually collected.
pub struct ChosenSweep {
    pub field: SweepField,
    /// Where the beam was when this cut stopped, in degrees from north.
    ///
    /// The last radial the radar wrote, in the order it wrote them.
    /// `SweepField` sorts its radials by azimuth, so the order is gone by the
    /// time the picture is drawn and has to be kept here. Absent for a
    /// finished cut, which stopped where it started.
    pub leading_azimuth: Option<f32>,
    pub elevation_degrees: f32,
    /// The cut's number within the volume, which is how the raw messages name
    /// it and therefore how its Nyquist velocity is found again.
    pub elevation_number: u8,
    pub collected: Option<DateTime<Utc>>,
}

/// The velocity a cut folds at.
///
/// Only the tests reach for this now. Everything the app draws goes through
/// the decoded-volume cache, which builds the whole table once per volume
/// rather than walking the records again for each cut asked about.
///
/// The sweep the model hands back does not carry it, so it is read from the
/// radial header in the raw messages. Only the first radial of the cut is
/// needed, and records are read in order, so this stops as soon as it finds one
/// rather than parsing the whole volume a second time.
#[cfg(test)]
pub(crate) fn nyquist_velocity(file: &volume::File, elevation_number: u8) -> Option<f32> {
    let records = file.records().ok()?;
    nyquist_from_records(&records, elevation_number)
}

/// The same, from records rather than a whole file.
///
/// The volume being swept right now arrives as loose records rather than as a
/// file, and it needs this as much as the finished one does: without it there
/// is no unfolding, and storm relative velocity refuses outright.
#[cfg(test)]
pub fn nyquist_from_records(records: &[volume::Record<'_>], elevation_number: u8) -> Option<f32> {
    nyquist_table(records).get(&elevation_number).copied()
}

/// Every cut's folding velocity, from whatever records are in hand.
///
/// The chunk path never holds a whole file, so it collects these as the pieces
/// arrive rather than reading a volume back a second time.
pub fn nyquist_table(records: &[volume::Record<'_>]) -> BTreeMap<u8, f32> {
    let mut found = BTreeMap::new();
    for record in records {
        let decompressed;
        let record = if record.compressed() {
            match record.decompress() {
                Ok(plain) => {
                    decompressed = plain;
                    &decompressed
                }
                Err(_) => continue,
            }
        } else {
            record
        };
        let Ok(messages) = record.messages() else {
            continue;
        };
        for message in messages {
            let MessageContents::DigitalRadarData(data) = message.contents() else {
                continue;
            };
            let Some(block) = data.radial_data_block() else {
                continue;
            };
            // Published as hundredths of a metre per second.
            let nyquist = block.nyquist_velocity_raw() as f32 * 0.01;
            if nyquist > 0.0 {
                found
                    .entry(data.header().elevation_number())
                    .or_insert(nyquist);
            }
        }
    }
    found
}

/// How close in a ring may be and still be the wind rather than the ground.
///
/// The first few kilometres of any sweep are ground clutter: buildings, trees
/// and terrain sitting still, which drags a fit toward nothing at all.
pub(crate) const WIND_NEAR_KM: f64 = 20.0;

/// How far out a ring may be and still be the wind anyone means.
///
/// The beam climbs with range, so past this the fit is describing air a couple
/// of kilometres up rather than the flow the storm is moving in.
pub(crate) const WIND_FAR_KM: f64 = 150.0;

/// How many rings are fitted across the sweep. More is slower and no more
/// certain, since the median of a dozen honest rings is already stable.
pub(crate) const WIND_RINGS: usize = 60;

/// How many rings the preferred band needs before it speaks for the sweep.
///
/// Preferring the band whenever it holds anything at all put the answer in the
/// hands of whatever was in it. A sweep with ground clutter out to thirty
/// kilometres and its only weather beyond a hundred and sixty had two rings in
/// the band, both of them sitting still, and they outvoted the thirty rings
/// that had the wind in them: the fit came back as no wind at all, which the
/// caller cannot tell from a light one.
pub(crate) const WIND_BAND_MIN_RINGS: usize = 4;

/// And what share of everything found it needs, for the same reason.
pub(crate) const WIND_BAND_MIN_SHARE: f64 = 0.25;

/// The wind the sweep is moving in, fitted from the readings themselves.
///
/// Rings are searched for across the whole sweep and then the ones between
/// twenty and a hundred and fifty kilometres are preferred: close in the beam
/// is too low and full of clutter, far out it is above the wind anyone means.
/// A sweep whose echo is all within thirty kilometres has nothing in that band
/// at all, and rather than return no wind for it the search falls back to
/// whatever rings it did find. Each ring is fitted on its own and the middle
/// answer kept, so one ring sitting inside a storm cannot carry the result
/// away with it.
pub(crate) fn fitted_wind(field: &SweepField) -> Option<vad::Wind> {
    let azimuths = field.azimuth_count();
    let gates = field.gate_count();
    if azimuths == 0 || gates == 0 {
        return None;
    }
    let elevation = field.elevation_degrees();
    let angles = field.azimuths();
    let first_km = field.first_gate_range_km();
    let interval_km = field.gate_interval_km();

    // Every ring that fits, right across the sweep, with how far out it was.
    // Walking the whole range is what separates this from picking rings by
    // position: the first twelve that happen to fit are all in the clutter.
    let stride = (gates / WIND_RINGS).max(1);
    let mut found: Vec<(f64, vad::Wind)> = Vec::new();
    let mut gate = 0;
    while gate < gates {
        let mut samples = Vec::with_capacity(azimuths);
        for azimuth in 0..azimuths {
            let (value, status) = field.get(azimuth, gate);
            if !matches!(status, GateStatus::Valid) {
                continue;
            }
            let Some(angle) = angles.get(azimuth) else {
                continue;
            };
            samples.push((*angle, value));
        }
        if let Some(wind) = vad::fit_ring(&samples, elevation) {
            found.push((first_km + gate as f64 * interval_km, wind));
        }
        gate += stride;
    }

    vad::median_wind(&rings_that_speak_for_the_sweep(&found))
}

/// Which of the fitted rings the answer is taken from.
///
/// Pulled out so the choice can be tested on its own: whether a ring inside
/// the clutter is excluded is a fact about this function, and a median over
/// enough rings is robust enough to hide it from an end-to-end assertion.
pub(crate) fn rings_that_speak_for_the_sweep(found: &[(f64, vad::Wind)]) -> Vec<vad::Wind> {
    let middle: Vec<vad::Wind> = found
        .iter()
        .filter(|(range, _)| *range >= WIND_NEAR_KM && *range <= WIND_FAR_KM)
        .map(|(_, wind)| *wind)
        .collect();
    // The band speaks for the sweep only when enough of the sweep is in it. A
    // handful of rings inside it cannot outvote everything outside.
    let enough = middle.len() >= WIND_BAND_MIN_RINGS
        && middle.len() as f64 >= found.len() as f64 * WIND_BAND_MIN_SHARE;
    if enough {
        return middle;
    }
    found.iter().map(|(_, wind)| *wind).collect()
}

/// Takes a wind out of a velocity field, in place.
///
/// What is left is what the picture would look like if the whole storm were
/// standing still, which is the only way a couplet shows through sixty knots of
/// ambient flow.
pub(crate) fn make_storm_relative(field: &mut SweepField, wind: vad::Wind) {
    let azimuths = field.azimuth_count();
    let gates = field.gate_count();
    let elevation = field.elevation_degrees();
    let angles = field.azimuths().to_vec();
    for azimuth in 0..azimuths {
        let Some(angle) = angles.get(azimuth).copied() else {
            continue;
        };
        let along = wind.along_beam(angle, elevation);
        for gate in 0..gates {
            let (value, status) = field.get(azimuth, gate);
            if !matches!(status, GateStatus::Valid) {
                continue;
            }
            field.set(azimuth, gate, value - along, GateStatus::Valid);
        }
    }
}

/// Shifts a velocity field back onto the flow it belongs to, in place.
///
/// Answers whether anything moved, which is the same question as whether the
/// picture on screen is still the radar's own reading. Nothing is written when
/// nothing moved.
///
/// It used to answer by looking for a reading outside the radar's limit, with
/// a little slack for the arithmetic, and that slack was a hole: a gate the
/// radar reported at 24.8 with a limit of 25 comes back at 25.2 when its fold
/// is taken out, which is inside the slack, so eighteen hundred rewritten
/// gates could be reported as no change at all and drawn on the narrow scale.
/// Every gate a fold is taken out of lands at or beyond the limit by
/// definition, since it started inside it and moved a whole interval, so
/// counting them answers the same question with no hole in it.
pub(crate) fn unfold_velocity(field: &mut SweepField, nyquist: f32) -> bool {
    let azimuths = field.azimuth_count();
    let gates = field.gate_count();
    let mut values = field.values().to_vec();
    let valid: Vec<bool> = field
        .statuses()
        .iter()
        .map(|status| matches!(status, GateStatus::Valid))
        .collect();

    let moved = dealias::dealias(&mut values, &valid, azimuths, gates, nyquist);
    if moved == 0 {
        return false;
    }

    // Whatever moved is written back. An earlier version threw the whole
    // correction away unless a set share of the sweep had moved, which meant a
    // sweep folded in only one place kept its fold: on a real KDMX cut folded
    // at 21 m/s, 410 gates wrapped, 0.5 per cent of the sweep, and every one of
    // them stayed wrapped. A fold in a hundred gates is still a fold, and it is
    // over the storm somebody is looking at.
    for azimuth in 0..azimuths {
        for gate in 0..gates {
            let at = azimuth * gates + gate;
            if valid[at] {
                field.set(azimuth, gate, values[at], GateStatus::Valid);
            }
        }
    }
    true
}

/// The sweep for a tilt, as a field of one product. A tilt past the end of the
/// list falls back to the lowest, which is the one a viewer wants by default.
///
/// A volume holds more than one cut at the same elevation: split cuts for
/// reflectivity and velocity, and under MESO-SAILS four separate looks at the
/// lowest tilt spread over five minutes. The one to draw is the one that
/// carries the product at the finest resolution, and of those the latest,
/// because the point of the extra looks is to see what just happened.
pub fn sweep_field(scan: &Scan, product: Product, tilt_index: usize) -> Option<ChosenSweep> {
    let angles = tilts(scan);
    let wanted = *angles.get(tilt_index).or_else(|| angles.first())?;
    sweep_field_at(scan, product, wanted)
}

/// The same, asked for by elevation angle rather than by position in the list.
///
/// A volume in progress holds only the cuts the radar has finished, so the
/// third entry in its list is not the third cut of the pattern. Asking by angle
/// is the only way to put the same cut of two volumes side by side.
pub fn sweep_field_at(scan: &Scan, product: Product, wanted: f32) -> Option<ChosenSweep> {
    let mut best: Option<ChosenSweep> = None;
    for sweep in scan.sweeps() {
        let Some(angle) = sweep.elevation_angle_degrees() else {
            continue;
        };
        if ((angle * 100.0).round() / 100.0 - wanted).abs() > SAME_CUT_DEGREES {
            continue;
        }
        let Some(field) = SweepField::from_radials(sweep.radials(), product) else {
            continue;
        };
        let collected = sweep.time_range().map(|(start, _)| start);
        let better = match &best {
            None => true,
            Some(held) => {
                (field.gate_count(), collected) > (held.field.gate_count(), held.collected)
            }
        };
        if better {
            best = Some(ChosenSweep {
                leading_azimuth: sweep
                    .radials()
                    .last()
                    .map(|radial| radial.azimuth_angle_degrees()),
                field,
                elevation_degrees: angle,
                elevation_number: sweep.elevation_number(),
                collected,
            });
        }
    }
    best
}

#[cfg(test)]
#[path = "sweep_tests.rs"]
mod tests;

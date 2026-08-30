//! Velocity dealiasing.
//!
//! A Doppler radar cannot tell the difference between air moving away at a
//! little more than its Nyquist velocity and air moving toward it at a little
//! less. Everything past that limit wraps around, so a straight sixty knot wind
//! is drawn as a green streak that turns abruptly red for no physical reason.
//! Reading rotation off a sweep like that is guesswork.
//!
//! The fix is the region method: split the sweep into patches of gates that are
//! plainly part of the same flow, work out how many Nyquist intervals each
//! patch sits away from its neighbours, and shift whole patches at once. Working
//! patch by patch rather than gate by gate is what keeps one noisy gate from
//! dragging a whole radial with it.
//!
//! The method is the one Py-ART calls `dealias_region_based`, after Haase and
//! Landelius; the same approach BowEcho's `bowecho-dealias` crate uses.

use std::collections::{BTreeMap, VecDeque};

/// How many bands the velocity range is cut into when patches are grown.
///
/// Coarser and a patch spans a real wind shift; finer and a smooth flow breaks
/// into pieces too small to vote reliably. Six across the full range, which is
/// three per Nyquist interval, is what Py-ART settles on.
const BANDS: usize = 6;

/// A patch has to be worth listening to before it is allowed to move its
/// neighbours. Anything smaller is shifted by whatever it is attached to.
const MIN_REGION_GATES: usize = 10;

/// One gate's place in the sweep: which radial, and how far along it.
fn index(azimuth: usize, gate: usize, gates: usize) -> usize {
    azimuth * gates + gate
}

/// The four gates touching this one. Azimuth wraps, because a sweep is a
/// circle and the fold between the last radial and the first is a real
/// boundary, not the edge of the data.
fn neighbours(azimuth: usize, gate: usize, azimuths: usize, gates: usize) -> [Option<usize>; 4] {
    let previous_azimuth = (azimuth + azimuths - 1) % azimuths;
    let next_azimuth = (azimuth + 1) % azimuths;
    [
        Some(index(previous_azimuth, gate, gates)),
        Some(index(next_azimuth, gate, gates)),
        (gate > 0).then(|| index(azimuth, gate - 1, gates)),
        (gate + 1 < gates).then(|| index(azimuth, gate + 1, gates)),
    ]
}

/// Which band of the velocity range a reading falls in.
fn band_of(value: f32, nyquist: f32) -> usize {
    let position = (value + nyquist) / (2.0 * nyquist);
    ((position * BANDS as f32).floor() as isize).clamp(0, BANDS as isize - 1) as usize
}

/// Grows patches of gates that read as one piece of air.
fn grow_regions(
    values: &[f32],
    valid: &[bool],
    azimuths: usize,
    gates: usize,
    nyquist: f32,
) -> (Vec<usize>, usize) {
    let mut region = vec![usize::MAX; values.len()];
    let mut count = 0;
    let mut queue = VecDeque::new();

    for azimuth in 0..azimuths {
        for gate in 0..gates {
            let start = index(azimuth, gate, gates);
            if !valid[start] || region[start] != usize::MAX {
                continue;
            }
            let band = band_of(values[start], nyquist);
            region[start] = count;
            queue.push_back((azimuth, gate));

            while let Some((at_azimuth, at_gate)) = queue.pop_front() {
                for neighbour in neighbours(at_azimuth, at_gate, azimuths, gates)
                    .into_iter()
                    .flatten()
                {
                    if !valid[neighbour]
                        || region[neighbour] != usize::MAX
                        || band_of(values[neighbour], nyquist) != band
                    {
                        continue;
                    }
                    region[neighbour] = count;
                    queue.push_back((neighbour / gates, neighbour % gates));
                }
            }
            count += 1;
        }
    }

    (region, count)
}

/// What one patch's neighbour thinks of it: how many gates they share, and the
/// votes those gates cast for how far apart the two patches really are.
#[derive(Default)]
struct Edge {
    shared: usize,
    votes: BTreeMap<i32, usize>,
}

impl Edge {
    /// The offset the boundary gates agree on most often. A boundary that
    /// cannot make up its mind is not evidence, so ties go to no shift.
    fn agreed(&self) -> i32 {
        self.votes
            .iter()
            .max_by_key(|(offset, count)| (*count, std::cmp::Reverse(offset.abs())))
            .map(|(offset, _)| *offset)
            .unwrap_or(0)
    }
}

/// Shifts whole patches of a velocity sweep back onto the flow they belong to.
///
/// `values` is the sweep laid out radial by radial, `valid` marks the gates
/// that hold a reading at all, and `nyquist` is the velocity the radar folds
/// at. Returns how many gates were moved, which is zero for a sweep that never
/// folded in the first place.
pub fn dealias(
    values: &mut [f32],
    valid: &[bool],
    azimuths: usize,
    gates: usize,
    nyquist: f32,
) -> usize {
    if azimuths == 0 || gates == 0 || values.len() != azimuths * gates || !nyquist.is_finite() {
        return 0;
    }
    if nyquist <= 0.0 {
        return 0;
    }

    let (region, region_count) = grow_regions(values, valid, azimuths, gates, nyquist);
    if region_count < 2 {
        return 0;
    }

    let mut sizes = vec![0usize; region_count];
    for (at, &label) in region.iter().enumerate() {
        if valid[at] && label != usize::MAX {
            sizes[label] += 1;
        }
    }

    // Every place two patches touch, with the boundary gates voting on how many
    // Nyquist intervals separate them.
    let mut edges: BTreeMap<(usize, usize), Edge> = BTreeMap::new();
    let interval = 2.0 * nyquist;
    for azimuth in 0..azimuths {
        for gate in 0..gates {
            let here = index(azimuth, gate, gates);
            if !valid[here] {
                continue;
            }
            let mine = region[here];
            for neighbour in neighbours(azimuth, gate, azimuths, gates)
                .into_iter()
                .flatten()
            {
                if !valid[neighbour] {
                    continue;
                }
                let theirs = region[neighbour];
                if theirs <= mine {
                    // Counted once, from the lower-numbered patch.
                    continue;
                }
                let offset = ((values[neighbour] - values[here]) / interval).round() as i32;
                let edge = edges.entry((mine, theirs)).or_default();
                edge.shared += 1;
                *edge.votes.entry(offset).or_default() += 1;
            }
        }
    }

    // Start from the largest patch, which is the one most likely to be reading
    // the wind correctly, and work outward along the strongest boundaries
    // first. A strong boundary is a long one: hundreds of gates agreeing is
    // worth more than three.
    let Some(root) = (0..region_count).max_by_key(|label| sizes[*label]) else {
        return 0;
    };

    let mut shift = vec![Option::<i32>::None; region_count];
    shift[root] = Some(0);
    let mut settled = 1;

    while settled < region_count {
        let mut best: Option<(usize, usize, usize, i32)> = None;
        for (&(left, right), edge) in &edges {
            let (known, unknown, offset) = match (shift[left], shift[right]) {
                (Some(_), None) => (left, right, -edge.agreed()),
                (None, Some(_)) => (right, left, edge.agreed()),
                _ => continue,
            };
            // A patch too small to trust still gets attached, but only after
            // every substantial one has had its say.
            let weight = if sizes[unknown] >= MIN_REGION_GATES {
                edge.shared + 1_000_000
            } else {
                edge.shared
            };
            if best.is_none_or(|(current, _, _, _)| weight > current) {
                best = Some((weight, known, unknown, offset));
            }
        }

        let Some((_, known, unknown, offset)) = best else {
            // What is left touches nothing that has been settled: patches of
            // their own, with no boundary to judge them by. Leaving them where
            // they are is the honest answer.
            break;
        };
        shift[unknown] = Some(shift[known].expect("settled") + offset);
        settled += 1;
    }

    // Boundaries can only say how far patches sit from each other, so the sweep
    // as a whole could still be a whole interval out with every patch agreeing.
    // The gate reading closest to still air pins it: for that one to be an alias
    // the air would have to be moving at twice the Nyquist velocity, and every
    // real sweep has a line across it where the flow crosses the beam.
    let anchor = (0..values.len())
        .filter(|at| valid[*at] && region[*at] != usize::MAX && shift[region[*at]].is_some())
        .min_by(|left, right| values[*left].abs().total_cmp(&values[*right].abs()));
    if let Some(anchor) = anchor {
        if let Some(offset) = shift[region[anchor]] {
            if offset != 0 {
                for value in shift.iter_mut().flatten() {
                    *value -= offset;
                }
            }
        }
    }

    let mut moved = 0;
    for at in 0..values.len() {
        if !valid[at] {
            continue;
        }
        let label = region[at];
        if label == usize::MAX {
            continue;
        }
        let Some(offset) = shift[label] else { continue };
        if offset != 0 {
            values[at] += interval * offset as f32;
            moved += 1;
        }
    }
    moved
}

#[cfg(test)]
mod tests {
    use super::*;

    const NYQUIST: f32 = 25.0;

    /// Wraps a true velocity the way the radar would report it.
    fn fold(value: f32, nyquist: f32) -> f32 {
        let interval = 2.0 * nyquist;
        let mut folded = value;
        while folded > nyquist {
            folded -= interval;
        }
        while folded < -nyquist {
            folded += interval;
        }
        folded
    }

    /// A sweep of pure outbound flow that runs past the folding limit, laid out
    /// so the fold falls partway along every radial.
    fn folded_sweep(azimuths: usize, gates: usize) -> (Vec<f32>, Vec<bool>, Vec<f32>) {
        let mut truth = Vec::with_capacity(azimuths * gates);
        for _ in 0..azimuths {
            for gate in 0..gates {
                // Ramps from 5 m/s at the radar to 45 m/s at the far gate, so
                // it crosses the 25 m/s Nyquist a little past halfway.
                truth.push(5.0 + 40.0 * (gate as f32 / (gates - 1) as f32));
            }
        }
        let observed: Vec<f32> = truth.iter().map(|value| fold(*value, NYQUIST)).collect();
        let valid = vec![true; truth.len()];
        (observed, valid, truth)
    }

    #[test]
    fn a_fold_across_the_nyquist_velocity_is_put_back() {
        let (mut values, valid, truth) = folded_sweep(360, 200);
        // The sweep really does fold, or the test proves nothing.
        assert!(
            values.iter().any(|value| *value < 0.0),
            "the outbound flow should have wrapped to negative"
        );

        let moved = dealias(&mut values, &valid, 360, 200, NYQUIST);
        assert!(moved > 0, "nothing was shifted");

        for (at, (got, want)) in values.iter().zip(truth.iter()).enumerate() {
            assert!(
                (got - want).abs() < 0.01,
                "gate {at}: {got} should be {want}"
            );
        }
    }

    #[test]
    fn a_sweep_that_never_folded_is_left_alone() {
        let azimuths = 90;
        let gates = 50;
        let mut values: Vec<f32> = (0..azimuths * gates)
            .map(|at| ((at % 17) as f32) - 8.0)
            .collect();
        let before = values.clone();
        let valid = vec![true; values.len()];

        dealias(&mut values, &valid, azimuths, gates, NYQUIST);
        assert_eq!(values, before, "a sweep inside the limit must not move");
    }

    #[test]
    fn the_flow_stays_continuous_around_the_last_radial() {
        // The seam between the final radial and the first is a real boundary in
        // the air but an edge in the array, and a sweep dealiased without
        // wrapping shows a hard line there.
        let azimuths = 120;
        let gates = 40;
        let mut truth = vec![0.0f32; azimuths * gates];
        for azimuth in 0..azimuths {
            let angle = (azimuth as f32) * std::f32::consts::TAU / azimuths as f32;
            for gate in 0..gates {
                // A uniform wind: outbound one side, inbound the other, and
                // fast enough to fold on the outbound half.
                truth[azimuth * gates + gate] = 34.0 * angle.cos();
            }
        }
        let mut values: Vec<f32> = truth.iter().map(|value| fold(*value, NYQUIST)).collect();
        let valid = vec![true; values.len()];

        dealias(&mut values, &valid, azimuths, gates, NYQUIST);

        for azimuth in 0..azimuths {
            let next = (azimuth + 1) % azimuths;
            for gate in 0..gates {
                let here = values[azimuth * gates + gate];
                let there = values[next * gates + gate];
                assert!(
                    (here - there).abs() < NYQUIST,
                    "radial {azimuth} to {next} jumps from {here} to {there}"
                );
            }
        }
    }

    #[test]
    fn gates_with_no_reading_are_not_invented() {
        let azimuths = 60;
        let gates = 30;
        let (mut values, mut valid, _) = folded_sweep(azimuths, gates);
        // A ring of empty gates, as a sweep past the last return really is.
        for azimuth in 0..azimuths {
            for gate in 20..gates {
                valid[azimuth * gates + gate] = false;
                values[azimuth * gates + gate] = 0.0;
            }
        }
        let before = values.clone();

        dealias(&mut values, &valid, azimuths, gates, NYQUIST);

        for azimuth in 0..azimuths {
            for gate in 20..gates {
                let at = azimuth * gates + gate;
                assert_eq!(values[at], before[at], "an empty gate was written to");
            }
        }
    }

    #[test]
    fn a_sweep_with_no_nyquist_velocity_is_left_alone() {
        let (mut values, valid, _) = folded_sweep(30, 20);
        let before = values.clone();
        for nyquist in [0.0, -5.0, f32::NAN] {
            dealias(&mut values, &valid, 30, 20, nyquist);
            assert_eq!(values, before, "nyquist {nyquist} should be refused");
        }
    }
}

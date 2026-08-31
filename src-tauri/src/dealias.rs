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

use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap, VecDeque};

/// How far two touching gates may read apart and still be one piece of air,
/// as a fraction of the Nyquist velocity.
///
/// A fold is a step of a whole interval, which is two Nyquist velocities, so
/// nothing this side of half of one is a fold. Gate to gate the wind changes
/// by far less than that even in shear.
///
/// The first version of this grew patches on a fixed set of bands across the
/// velocity range and joined two gates only if they fell in the same one. That
/// shatters a real sweep. Noise of a metre or two straddles a band edge
/// constantly, and a KDMX velocity cut came apart into 13931 patches holding
/// 78252 readings, only 845 of them with ten gates or more. Patches that small
/// have no boundary worth voting on, so most of the sweep could not be placed
/// at all and the folds stayed in. Growing on continuity instead asks the
/// question the method is about: is the step between these two gates a fold or
/// is it the weather.
const CONTINUITY: f32 = 0.5;

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
            region[start] = count;
            queue.push_back((azimuth, gate));

            while let Some((at_azimuth, at_gate)) = queue.pop_front() {
                let here = index(at_azimuth, at_gate, gates);
                for neighbour in neighbours(at_azimuth, at_gate, azimuths, gates)
                    .into_iter()
                    .flatten()
                {
                    if !valid[neighbour]
                        || region[neighbour] != usize::MAX
                        // Measured against the gate it is reached from, not
                        // against the seed: a patch is allowed to follow a
                        // flow that changes across it, and is stopped only by
                        // a step no weather makes.
                        || (values[neighbour] - values[here]).abs() > nyquist * CONTINUITY
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

    // Which patches touch which, so settling one can offer up its neighbours
    // without rereading every boundary in the sweep. A noisy velocity field is
    // speckle, and speckle is patches: rescanning the whole edge list once per
    // patch is quadratic in the number of them, which on a low-return sweep is
    // tens of seconds of a frozen window rather than milliseconds.
    let mut adjacency: Vec<Vec<(usize, i32, usize)>> = vec![Vec::new(); region_count];
    for (&(left, right), edge) in &edges {
        let offset = edge.agreed();
        // shift[right] = shift[left] - offset, and the other way round.
        adjacency[left].push((right, -offset, edge.shared));
        adjacency[right].push((left, offset, edge.shared));
    }

    // Start from the largest patch and work outward along the strongest
    // boundaries first. A strong boundary is a long one: hundreds of gates
    // agreeing is worth more than three.
    //
    // The largest patch keeps its own reading, which is all a boundary can
    // ever establish. Every patch is placed relative to its neighbours, so the
    // sweep as a whole is recovered up to a whole Nyquist interval and no
    // further: with no still air anywhere in it, nothing in the data says which
    // interval the whole picture belongs to. This is what Py-ART does when it
    // is given no reference field, for the same reason.
    let Some(root) = (0..region_count).max_by_key(|label| sizes[*label]) else {
        return 0;
    };

    let mut shift = vec![Option::<i32>::None; region_count];
    shift[root] = Some(0);

    // Ordered by boundary strength, with any patch too small to trust left
    // until every substantial one has had its say.
    let weigh = |target: usize, shared: usize| {
        if sizes[target] >= MIN_REGION_GATES {
            shared + 1_000_000
        } else {
            shared
        }
    };
    // The tie-break matters more than it looks. Nearly every boundary in a
    // speckled field is one or two gates long, so most of the queue is tied on
    // strength, and a tuple compares straight through to whatever comes next.
    // With the accumulated shift sitting there, a max-heap quietly prefers the
    // path that has drifted furthest from the reading the radar gave, which on
    // 499 generated sweeps left half again as much discontinuity as picking the
    // smallest drift, and made five of them worse than not running at all.
    let mut queue: BinaryHeap<(usize, Reverse<i32>, usize, i32)> = BinaryHeap::new();
    let offer = |queue: &mut BinaryHeap<(usize, Reverse<i32>, usize, i32)>,
                     other: usize,
                     shift: i32,
                     shared: usize| {
        queue.push((weigh(other, shared), Reverse(shift.abs()), other, shift));
    };
    for &(other, offset, shared) in &adjacency[root] {
        offer(&mut queue, other, offset, shared);
    }

    while let Some((_, _, target, offset)) = queue.pop() {
        if shift[target].is_some() {
            continue;
        }
        shift[target] = Some(offset);
        for &(other, step, shared) in &adjacency[target] {
            if shift[other].is_some() {
                continue;
            }
            offer(&mut queue, other, offset + step, shared);
        }
    }
    // Anything still unplaced touches nothing that was settled: patches of
    // their own, with no boundary to judge them by. Leaving them where they
    // are is the honest answer.

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

    /// The largest jump between any two neighbouring gates, along the radial
    /// and around the sweep. A fold leaves one about two Nyquist velocities
    /// wide; a continuous field leaves none bigger than the flow itself.
    fn worst_jump(values: &[f32], valid: &[bool], azimuths: usize, gates: usize) -> f32 {
        let mut worst = 0.0f32;
        for azimuth in 0..azimuths {
            for gate in 0..gates {
                let here = index(azimuth, gate, gates);
                if !valid[here] {
                    continue;
                }
                for neighbour in neighbours(azimuth, gate, azimuths, gates)
                    .into_iter()
                    .flatten()
                {
                    if !valid[neighbour] {
                        continue;
                    }
                    worst = worst.max((values[here] - values[neighbour]).abs());
                }
            }
        }
        worst
    }

    #[test]
    fn a_fold_across_the_nyquist_velocity_is_put_back() {
        let (mut values, valid, truth) = folded_sweep(360, 200);
        // The sweep really does fold, or the test proves nothing.
        assert!(
            values.iter().any(|value| *value < 0.0),
            "the outbound flow should have wrapped to negative"
        );
        let before = worst_jump(&values, &valid, 360, 200);
        assert!(
            before > NYQUIST,
            "the folded sweep should have a jump in it, worst was {before}"
        );

        let moved = dealias(&mut values, &valid, 360, 200, NYQUIST);
        assert!(moved > 0, "nothing was shifted");

        // The flow is continuous again.
        let after = worst_jump(&values, &valid, 360, 200);
        assert!(after < 1.0, "a jump of {after} m/s is left in the sweep");

        // And it matches the truth to a whole number of Nyquist intervals.
        //
        // That is everything the method can establish. Boundaries only say how
        // far patches sit from each other, so a sweep with no still air
        // anywhere in it, as this artificial one has, could be a whole interval
        // out with every gate agreeing with its neighbours. Nothing in the data
        // says which interval it belongs to, and guessing turns a correctly
        // measured outbound wind into an inbound one, which is worse than the
        // fold. Real sweeps have a line across them where the flow crosses the
        // beam, which is what the test below relies on.
        let interval = 2.0 * NYQUIST;
        let offset = ((values[0] - truth[0]) / interval).round();
        for (at, (got, want)) in values.iter().zip(truth.iter()).enumerate() {
            assert!(
                (got - want - offset * interval).abs() < 0.01,
                "gate {at}: {got} should be {want} plus {offset} intervals"
            );
        }
    }

    #[test]
    fn a_sweep_with_no_still_air_in_it_is_still_made_continuous() {
        // Rain in one quadrant only, in a uniform outbound wind that folds.
        // There is no zero isodop inside the echo, so which whole interval the
        // patch belongs to is not knowable. What is knowable, and what this
        // asserts, is that the fold inside it is taken out.
        let azimuths = 180;
        let gates = 120;
        let mut values = vec![0.0f32; azimuths * gates];
        let mut valid = vec![false; azimuths * gates];
        for azimuth in 40..130 {
            for gate in 40..gates {
                let truth = 22.0 + 22.0 * ((gate - 40) as f32 / (gates - 41) as f32);
                let at = azimuth * gates + gate;
                values[at] = fold(truth, NYQUIST);
                valid[at] = true;
            }
        }
        assert!(
            worst_jump(&values, &valid, azimuths, gates) > NYQUIST,
            "the quadrant should fold"
        );

        dealias(&mut values, &valid, azimuths, gates, NYQUIST);

        let after = worst_jump(&values, &valid, azimuths, gates);
        assert!(after < 1.0, "a jump of {after} m/s is left in the echo");
    }

    /// A cheap deterministic generator, so a failure names a seed that can be
    /// run again rather than a sweep nobody can reproduce.
    fn generated_sweep(seed: u32, azimuths: usize, gates: usize) -> (Vec<f32>, Vec<bool>) {
        let mut state = seed.wrapping_mul(2_654_435_761).wrapping_add(1);
        let mut next = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 16) as f32 / 32_768.0 - 1.0
        };
        let strength = 20.0 + 30.0 * (seed % 7) as f32 / 6.0;
        let noise = 2.0 + 12.0 * (seed % 5) as f32 / 4.0;

        let mut values = Vec::with_capacity(azimuths * gates);
        let mut valid = Vec::with_capacity(azimuths * gates);
        for azimuth in 0..azimuths {
            let angle = (azimuth as f32) * std::f32::consts::TAU / azimuths as f32;
            for gate in 0..gates {
                let reach = gate as f32 / gates as f32;
                let truth = strength * angle.cos() * (0.4 + reach) + next() * noise;
                values.push(fold(truth, NYQUIST));
                // Some sweeps have holes in them, as a real one does.
                valid.push(seed % 3 != 0 || next() > -0.6);
            }
        }
        (values, valid)
    }

    #[test]
    fn no_sweep_comes_out_more_discontinuous_than_it_went_in() {
        // The one property that matters, and the one an eye on a single
        // synthetic case will not check: unfolding may leave a sweep no worse
        // than it found it. A tie-break that quietly preferred the most-shifted
        // path passed every other test in this file while making five sweeps in
        // five hundred worse than not running at all.
        let azimuths = 90;
        let gates = 120;
        let mut worse = Vec::new();
        let mut before_total = 0;
        let mut after_total = 0;

        for seed in 0..300u32 {
            let (mut values, valid) = generated_sweep(seed, azimuths, gates);
            let before = big_jumps(&values, &valid, azimuths, gates);
            dealias(&mut values, &valid, azimuths, gates, NYQUIST);
            let after = big_jumps(&values, &valid, azimuths, gates);
            before_total += before;
            after_total += after;
            if after > before {
                worse.push(format!("seed {seed}: {before} -> {after}"));
            }
        }

        assert!(
            worse.is_empty(),
            "{} sweeps came out worse: {worse:?}",
            worse.len()
        );
        // And it has to be doing the job well, not merely doing something.
        // Leaving every sweep alone satisfies the line above, and so does a
        // version that takes out half the folds and invents new ones; the
        // measured figure here is about a tenth of what it started with. The
        // tie-break that preferred the most-shifted path scored fifteen
        // hundredths, which is the regression this number exists to catch.
        assert!(
            after_total * 8 < before_total,
            "{after_total} jumps left of {before_total} across every sweep"
        );
    }

    /// Neighbouring gates further apart than the radar could have measured.
    fn big_jumps(values: &[f32], valid: &[bool], azimuths: usize, gates: usize) -> usize {
        let mut count = 0;
        for azimuth in 0..azimuths {
            for gate in 0..gates {
                let here = index(azimuth, gate, gates);
                if !valid[here] {
                    continue;
                }
                for neighbour in neighbours(azimuth, gate, azimuths, gates)
                    .into_iter()
                    .flatten()
                {
                    if !valid[neighbour] {
                        continue;
                    }
                    if (values[here] - values[neighbour]).abs() > NYQUIST {
                        count += 1;
                    }
                }
            }
        }
        count
    }

    #[test]
    fn a_speckled_sweep_is_dealiased_in_reasonable_time() {
        // A low-return velocity field is speckle, and speckle is patches. An
        // approach that reread every boundary once per patch took the better
        // part of a minute on a sweep this size, with the window frozen behind
        // it, because the work grows with the square of the patch count.
        let azimuths = 720;
        let gates = 1192;
        let mut values = vec![0.0f32; azimuths * gates];
        let valid = vec![true; azimuths * gates];
        let mut noise: u32 = 0x1234_5678;
        for azimuth in 0..azimuths {
            let angle = (azimuth as f32) * std::f32::consts::TAU / azimuths as f32;
            for gate in 0..gates {
                // A pseudorandom walk, so the field is patchy rather than smooth.
                noise = noise.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let jitter = ((noise >> 16) as f32 / 32_768.0 - 1.0) * 12.0;
                values[azimuth * gates + gate] = fold(30.0 * angle.cos() + jitter, NYQUIST);
            }
        }

        let started = std::time::Instant::now();
        dealias(&mut values, &valid, azimuths, gates, NYQUIST);
        let took = started.elapsed();
        assert!(
            took < std::time::Duration::from_secs(5),
            "a full sweep took {took:?}"
        );
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

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

use crate::vad;

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

/// How many range rings the ambient wind is fitted from.
///
/// Rings rather than the sweep at once, because a tilted beam climbs as it
/// goes out and the wind turns with height, which is the whole reason a wind
/// profile is a profile. Spread evenly across the sweep and cheap: two dozen
/// rings of a few hundred gates against the hundred thousand the sweep holds.
const REFERENCE_RINGS: usize = 24;

/// How much of a component has to agree on which interval it belongs in
/// before the wind is taken as evidence about it.
///
/// A component whose gates cannot agree is not one piece of air, and placing
/// it anywhere would be a guess dressed as a reading.
const REFERENCE_AGREEMENT: f64 = 0.6;

/// How far a component may sit from the fitted wind, once placed, and still
/// be placed by it.
///
/// A vote alone cannot say no. Rounding to the nearest interval always names
/// one, so every isolated patch in the sweep gets an answer whether or not
/// the wind knows anything about it, and a storm cell is precisely the thing
/// that does not move with the air around it. An inbound cell reading -10 m/s
/// under a 25 m/s limit is nearer the +30 m/s environment as +40 than it is
/// as itself, so the vote says +40 unanimously, and that is a reading nothing
/// measured: fifty metres a second of fabricated outbound flow.
///
/// So the wind has to actually account for the component, not merely prefer
/// it. The bar is the profile's own: `vad::MAX_RESIDUAL_MS` is what a ring of
/// gates may scatter from a fitted wave before that wave is refused as a
/// description of them, and a patch further than that from the wind is one
/// the fit does not vouch for either.
///
/// Which way to be wrong is the whole question here, and the two ways are not
/// equal. A component left where it was carries the fold this module exists
/// to remove, which is what it did before the wind was consulted at all and
/// is recoverable by the eye. A component moved a whole interval on a guess
/// is a velocity nobody read, drawn in the colours of a measurement.
const REFERENCE_MARGIN_MS: f32 = vad::MAX_RESIDUAL_MS;

/// What the unfolder was able to do with a sweep.
///
/// The counts are gates rather than patches, because a patch is an artefact of
/// how the sweep happened to break up and a gate is a reading somebody is
/// looking at.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Dealiased {
    /// Gates whose reading was shifted onto another branch.
    pub moved: usize,
    /// Gates placed by the fitted wind rather than by a boundary, which is the
    /// weaker of the two kinds of evidence this module has.
    pub by_wind: usize,
    /// Gates in a group nothing could place. Their neighbours agree with each
    /// other and which interval the group belongs in is unknown, so they are
    /// left exactly as the radar reported them, folds and all.
    pub unplaced: usize,
}

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

/// Places every patch reachable from `start` relative to it, along the
/// strongest boundaries first.
///
/// `start` must already carry an offset, and only patches with none are
/// written to, so this can be run once from the largest patch of the sweep and
/// again from the largest patch of each group the first run never reached.
///
/// Ordered by boundary strength, with any patch too small to trust left until
/// every substantial one has had its say. A strong boundary is a long one:
/// hundreds of gates agreeing is worth more than three.
fn settle_from(
    start: usize,
    adjacency: &[Vec<(usize, i32, usize)>],
    sizes: &[usize],
    shift: &mut [Option<i32>],
) {
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
    let base = shift[start].unwrap_or(0);
    for &(other, offset, shared) in &adjacency[start] {
        offer(&mut queue, other, base + offset, shared);
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
}

/// Where a sweep's radials point, how long they are, and how far up the cut
/// is tilted.
///
/// Grouped because the three always travel together and the reference pass
/// needs all of them: without an azimuth in degrees and a tilt there is no
/// way to say what a gate ought to read.
struct Geometry<'a> {
    azimuth_degrees: &'a [f32],
    gates: usize,
    elevation_degrees: f32,
}

/// The ambient wind, fitted from the gates the boundaries already settled.
///
/// The patches reached from the root are consistent with each other whatever
/// interval the picture as a whole landed in, so a wave fitted through them
/// says what any other gate in the same air ought to read. That is the
/// reference field Py-ART reaches for when the regions do not connect, built
/// here out of the profile fit this app already carries rather than a
/// sounding it would have to fetch.
///
/// `None` when no ring can be trusted, which is the honest answer for a sweep
/// with too little settled echo to say anything about the sky.
fn reference_wind(
    values: &[f32],
    valid: &[bool],
    region: &[usize],
    shift: &[Option<i32>],
    sweep: &Geometry<'_>,
    interval: f32,
) -> Option<vad::Wind> {
    let gates = sweep.gates;
    let mut winds = Vec::with_capacity(REFERENCE_RINGS);
    for ring in 0..REFERENCE_RINGS {
        // Spread across the sweep and never at either end: the first gates
        // are inside the radar's own clutter and the last are where the beam
        // has climbed out of the weather.
        let gate = gates * (ring * 2 + 1) / (REFERENCE_RINGS * 2);
        let mut samples = Vec::with_capacity(sweep.azimuth_degrees.len());
        for (index, azimuth) in sweep.azimuth_degrees.iter().enumerate() {
            let at = index * gates + gate;
            if !valid[at] {
                continue;
            }
            let label = region[at];
            if label == usize::MAX {
                continue;
            }
            // Read as the traversal placed it, not as the radar reported it.
            let Some(by) = shift[label] else { continue };
            samples.push((*azimuth, values[at] + interval * by as f32));
        }
        let Some(fit) = vad::fit_ring_checked(&samples, sweep.elevation_degrees) else {
            continue;
        };
        // The profile's own bar, deliberately, and it is not too high for
        // this. Relaxing it to "enough gates and a small residual" was tried
        // on 2026-09-07 and it is what a poorly conditioned fit looks like:
        // on KTLX of the 3rd the settled gates covered 34 to 118 radials of
        // 720, all down one side, and each ring fitted them beautifully at a
        // residual under 1.9 m/s while saying nothing true about the rest of
        // the circle. That run took the sweep from 3,913 broken pairs to
        // 4,227, worse than it found it, which is the one thing this must
        // never do. A wave through a sixth of a circle is not a wind.
        if fit.trusted() {
            winds.push(fit.wind);
        }
    }
    vad::median_wind(&winds)
}

/// Shifts whole patches of a velocity sweep back onto the flow they belong to.
///
/// `values` is the sweep laid out radial by radial, `valid` marks the gates
/// that hold a reading at all, `azimuth_degrees` says where each radial
/// points, and `nyquist` is the velocity the radar folds at. Reports what it
/// managed, which is all zeroes for a sweep that never folded in the first
/// place.
pub fn dealias(
    values: &mut [f32],
    valid: &[bool],
    azimuth_degrees: &[f32],
    gates: usize,
    nyquist: f32,
    elevation_degrees: f32,
) -> Dealiased {
    let azimuths = azimuth_degrees.len();
    if azimuths == 0 || gates == 0 || values.len() != azimuths * gates || !nyquist.is_finite() {
        return Dealiased::default();
    }
    if nyquist <= 0.0 {
        return Dealiased::default();
    }

    let (region, region_count) = grow_regions(values, valid, azimuths, gates, nyquist);
    // One patch is the whole sweep agreeing with itself, which is the answer
    // rather than a failure to place anything.
    if region_count < 2 {
        return Dealiased::default();
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
        return Dealiased::default();
    };

    let mut shift = vec![Option::<i32>::None; region_count];
    shift[root] = Some(0);
    settle_from(root, &adjacency, &sizes, &mut shift);
    // Anything still unplaced sits in a group the root never reached. A patch
    // left unplaced cannot touch a placed one, because the traversal offers
    // every neighbour of everything it settles, so what is left is groups
    // joined only to each other.
    //
    // Leaving them where they are used to be the whole answer, and on a
    // fragmented sweep that is most of the picture. Measured across 39
    // station-days on 2026-09-01 to 09-07: KTLX on the 3rd grew 8,536 patches
    // and the traversal reached 26 of them, so 73,254 of its 91,388 gates
    // were left exactly as the radar folded them and the sweep came back as
    // broken as it went in. Five of those 39 went the same way.
    //
    // Two kinds of evidence bear on them, and the order matters. A group may
    // hold several patches that touch each other, and the boundaries between
    // those are the same strong evidence the traversal runs on, already
    // sitting in the edge list: settling each group from its own largest patch
    // takes the folds out of its inside without asking the sky anything. What
    // no boundary can say is which interval the group as a whole belongs in,
    // and there the wind is the only witness, so it moves a group as one piece
    // and only when it can account for where it puts it.
    let sweep = Geometry {
        azimuth_degrees,
        gates,
        elevation_degrees,
    };
    let wind = reference_wind(values, valid, &region, &shift, &sweep, interval);
    let mut placed: Vec<bool> = shift.iter().map(|offset| offset.is_some()).collect();
    let mut by_wind = vec![false; region_count];

    let groups = loose_groups(&adjacency, &shift, region_count);
    for group in &groups {
        // Its own largest patch keeps whatever it read, exactly as the root
        // does for the sweep as a whole, and the rest of the group is placed
        // relative to it by the boundaries between them.
        let Some(anchor) = group
            .iter()
            .copied()
            .max_by_key(|label| (sizes[*label], Reverse(*label)))
        else {
            continue;
        };
        shift[anchor] = Some(0);
        settle_from(anchor, &adjacency, &sizes, &mut shift);
    }

    if let Some(wind) = wind {
        let mut group_of = vec![usize::MAX; region_count];
        for (which, group) in groups.iter().enumerate() {
            for &label in group {
                group_of[label] = which;
            }
        }
        // For every gate of every group: which interval it reads as once its
        // own group has been settled around it, and how far it would then sit
        // from the wind.
        let mut asked: Vec<Vec<(i32, f32)>> = vec![Vec::new(); groups.len()];
        for at in 0..values.len() {
            if !valid[at] {
                continue;
            }
            let label = region[at];
            if label == usize::MAX || group_of[label] == usize::MAX {
                continue;
            }
            let inside = shift[label].unwrap_or(0);
            let settled = values[at] + interval * inside as f32;
            let expected = wind.along_beam(azimuth_degrees[at / gates], elevation_degrees);
            let gap = settled - expected;
            asked[group_of[label]].push(((-gap / interval).round() as i32, gap));
        }

        for (which, group) in groups.iter().enumerate() {
            let readings = &asked[which];
            if readings.is_empty() {
                continue;
            }
            let mut votes: BTreeMap<i32, usize> = BTreeMap::new();
            for (by, _) in readings {
                *votes.entry(*by).or_default() += 1;
            }
            // The interval most of the group reads as, if most of it agrees.
            // Ties go to the smaller move, the same way a boundary vote does.
            let Some((&by, &agreed)) = votes
                .iter()
                .max_by_key(|(offset, count)| (**count, Reverse(offset.abs())))
            else {
                continue;
            };
            if (agreed as f64) < readings.len() as f64 * REFERENCE_AGREEMENT {
                continue;
            }
            // And the wind has to account for the group where it wants to put
            // it, not merely prefer that place to the alternatives.
            let mut apart: Vec<f32> = readings
                .iter()
                .map(|(_, gap)| (gap + interval * by as f32).abs())
                .collect();
            apart.sort_by(f32::total_cmp);
            if apart[apart.len() / 2] > REFERENCE_MARGIN_MS {
                continue;
            }
            for &label in group {
                if let Some(offset) = shift[label].as_mut() {
                    *offset += by;
                }
                placed[label] = true;
                by_wind[label] = true;
            }
        }
    }

    let mut found = Dealiased::default();
    for at in 0..values.len() {
        if !valid[at] {
            continue;
        }
        let label = region[at];
        if label == usize::MAX {
            continue;
        }
        if !placed[label] {
            found.unplaced += 1;
        } else if by_wind[label] {
            found.by_wind += 1;
        }
        let Some(offset) = shift[label] else { continue };
        if offset != 0 {
            values[at] += interval * offset as f32;
            found.moved += 1;
        }
    }
    found
}

/// The groups of patches the traversal never reached, each one everything in
/// it touching something else in it.
fn loose_groups(
    adjacency: &[Vec<(usize, i32, usize)>],
    shift: &[Option<i32>],
    region_count: usize,
) -> Vec<Vec<usize>> {
    let mut groups = Vec::new();
    let mut seen = vec![false; region_count];
    let mut walk = Vec::new();
    for label in 0..region_count {
        if shift[label].is_some() || seen[label] {
            continue;
        }
        seen[label] = true;
        walk.push(label);
        let mut group = Vec::new();
        while let Some(here) = walk.pop() {
            group.push(here);
            for &(other, _, _) in &adjacency[here] {
                // A settled neighbour cannot happen: anything with a path to
                // the root was reached from it. Skipped rather than asserted,
                // because a group that quietly grew a settled patch would move
                // gates the traversal had already answered for.
                if seen[other] || shift[other].is_some() {
                    continue;
                }
                seen[other] = true;
                walk.push(other);
            }
        }
        groups.push(group);
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    const NYQUIST: f32 = 25.0;

    /// The lowest cut of a real pattern, which is what every fixture here
    /// stands for.
    const ELEVATION: f32 = 0.5;

    /// Where each radial of a fixture points, at even spacing round the
    /// circle. The reference-field pass reads these; the boundary vote does
    /// not care and never did.
    fn pointing(azimuths: usize) -> Vec<f32> {
        (0..azimuths)
            .map(|at| at as f32 * 360.0 / azimuths as f32)
            .collect()
    }

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

        let found = dealias(&mut values, &valid, &pointing(360), 200, NYQUIST, ELEVATION);
        assert!(found.moved > 0, "nothing was shifted");

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

        dealias(
            &mut values,
            &valid,
            &pointing(azimuths),
            gates,
            NYQUIST,
            ELEVATION,
        );

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
            dealias(
                &mut values,
                &valid,
                &pointing(azimuths),
                gates,
                NYQUIST,
                ELEVATION,
            );
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
        dealias(
            &mut values,
            &valid,
            &pointing(azimuths),
            gates,
            NYQUIST,
            ELEVATION,
        );
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

        dealias(
            &mut values,
            &valid,
            &pointing(azimuths),
            gates,
            NYQUIST,
            ELEVATION,
        );
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

        dealias(
            &mut values,
            &valid,
            &pointing(azimuths),
            gates,
            NYQUIST,
            ELEVATION,
        );

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

        dealias(
            &mut values,
            &valid,
            &pointing(azimuths),
            gates,
            NYQUIST,
            ELEVATION,
        );

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
            dealias(&mut values, &valid, &pointing(30), 20, nyquist, ELEVATION);
            assert_eq!(values, before, "nyquist {nyquist} should be refused");
        }
    }
    /// A sweep in a steady wind with an island of echo cut off from the rest.
    ///
    /// The body folds where the wind points straight down the beam, and the
    /// two halves of it touch, so the boundary vote settles the whole thing.
    /// The island sits past a band of empty gates at the azimuth where the
    /// fold is deepest, touching nothing at all, which is the shape a boundary
    /// vote has no answer for: there is no boundary.
    ///
    /// `body_azimuths` is how much of the circle the body covers. All of it
    /// gives a ring a wave can be fitted through; a sliver does not, and the
    /// difference is the whole question of whether the wind is evidence.
    fn sweep_with_an_island(
        speed: f32,
        body_azimuths: usize,
    ) -> (Vec<f32>, Vec<bool>, Vec<f32>, Vec<f32>) {
        let azimuths = 360;
        let gates = 200;
        let pointing = pointing(azimuths);
        let mut truth = vec![0.0f32; azimuths * gates];
        let mut valid = vec![false; azimuths * gates];
        for (index, azimuth) in pointing.iter().enumerate() {
            let along = speed * azimuth.to_radians().sin();
            for gate in 0..gates {
                let body = gate < 80 && index < body_azimuths;
                let island = (150..170).contains(&gate) && (85..95).contains(&index);
                if !body && !island {
                    continue;
                }
                let at = index * gates + gate;
                truth[at] = along;
                valid[at] = true;
            }
        }
        let observed: Vec<f32> = truth.iter().map(|value| fold(*value, NYQUIST)).collect();
        (observed, valid, truth, pointing)
    }

    /// Which gates the island holds.
    fn island_gates() -> Vec<usize> {
        (85..95)
            .flat_map(|index| (150..170).map(move |gate| index * 200 + gate))
            .collect()
    }

    #[test]
    fn places_an_island_of_echo_against_the_wind_when_nothing_touches_it() {
        // Thirty metres a second against a twenty-five limit, so the flow
        // folds either side of the beam it points along and the unfolded arcs
        // stay the largest patches, which is what keeps the root on the branch
        // the radar actually read.
        let (mut values, valid, truth, pointing) = sweep_with_an_island(30.0, 360);
        let island = island_gates();

        // The premise, asserted rather than assumed: the island is really
        // there, and it really is a whole interval away from the truth.
        assert!(island.iter().all(|at| valid[*at]));
        assert!(
            island
                .iter()
                .all(|at| (values[*at] - truth[*at]).abs() > NYQUIST),
            "the island was not folded, so this test proves nothing"
        );

        dealias(&mut values, &valid, &pointing, 200, NYQUIST, ELEVATION);

        for at in island {
            assert!(
                (values[at] - truth[at]).abs() < 0.001,
                "gate {at} came back at {} rather than {}",
                values[at],
                truth[at]
            );
        }
    }

    /// A sweep whose body covers the whole circle, with a patch of echo out
    /// past a band of empty gates that touches nothing else.
    ///
    /// `body_speed` is the wind the body is drawn in, folded the way the radar
    /// would report it. `island` says what each gate from 150 outward reads,
    /// exactly, so a test can put a shape there the body's own flow would
    /// never produce.
    fn sweep_with_a_body(body_speed: f32, island: &[f32]) -> (Vec<f32>, Vec<bool>, Vec<f32>) {
        let azimuths = 360;
        let gates = 200;
        let pointing = pointing(azimuths);
        let mut values = vec![0.0f32; azimuths * gates];
        let mut valid = vec![false; azimuths * gates];
        for (index, azimuth) in pointing.iter().enumerate() {
            let along = body_speed * azimuth.to_radians().sin();
            for gate in 0..80 {
                let at = index * gates + gate;
                values[at] = fold(along, NYQUIST);
                valid[at] = true;
            }
            if !(85..95).contains(&index) {
                continue;
            }
            for (offset, reading) in island.iter().enumerate() {
                let at = index * gates + 150 + offset;
                values[at] = *reading;
                valid[at] = true;
            }
        }
        (values, valid, pointing)
    }

    #[test]
    fn a_seam_inside_a_component_the_root_never_reached_survives_the_wind() {
        // Two patches that touch each other and nothing else. "Unreached by
        // the root" is not "touching nothing": the boundary between these two
        // is the same strong evidence the traversal runs on, and it is already
        // sitting in the edge list. Voting each of them against the wind on
        // its own throws that away and can shift them by different intervals,
        // which turns a seam that was continuous into a fold. That is not a
        // worse answer than before, it is a defect the pass introduces.
        let mut island = vec![-20.1f32; 10];
        island.extend_from_slice(&[-7.0, 0.0, 7.0, 10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0]);
        let (mut values, valid, pointing) = sweep_with_a_body(20.0, &island);

        // The premise, asserted rather than assumed: two patches, touching,
        // and neither of them the body's.
        let (region, _) = grow_regions(&values, &valid, 360, 200, NYQUIST);
        let left = region[85 * 200 + 155];
        let right = region[85 * 200 + 165];
        assert_ne!(left, right, "the island should be two patches");
        assert!(
            left != region[0] && right != region[0],
            "neither should be part of the body"
        );
        let before = big_jumps(&values, &valid, 360, 200);
        assert_eq!(before, 0, "the sweep goes in with nothing to unfold");

        dealias(&mut values, &valid, &pointing, 200, NYQUIST, ELEVATION);

        let after = big_jumps(&values, &valid, 360, 200);
        assert_eq!(
            after, 0,
            "a seam was broken that nothing asked to be broken"
        );
    }

    #[test]
    fn a_fold_inside_an_unreached_group_comes_out_even_when_the_wind_will_not_place_it() {
        // The other half of the same point, and the half a margin alone does
        // not cover. This island straddles the folding limit, so there is a
        // real fold inside it and a real boundary vote about that fold, but
        // the air it is in sits further from the fitted wind than the wind can
        // account for. The two questions are separate: what the boundary says
        // about the two patches relative to each other is good evidence
        // whatever the sky is doing, and it is the only thing that takes this
        // fold out.
        let mut island = vec![fold(24.5, NYQUIST); 10];
        island.extend(std::iter::repeat_n(fold(25.5, NYQUIST), 10));
        let (mut values, valid, pointing) = sweep_with_a_body(20.0, &island);

        let (region, _) = grow_regions(&values, &valid, 360, 200, NYQUIST);
        assert_ne!(
            region[85 * 200 + 155],
            region[85 * 200 + 165],
            "the island should be two patches with a fold between them"
        );
        assert!(
            big_jumps(&values, &valid, 360, 200) > 0,
            "the island should go in folded"
        );

        dealias(&mut values, &valid, &pointing, 200, NYQUIST, ELEVATION);

        assert_eq!(
            big_jumps(&values, &valid, 360, 200),
            0,
            "the fold inside the island is still there"
        );
        // And the group as a whole stayed on the branch the radar read, which
        // is the honest answer: no boundary joins it to anything settled, and
        // the wind is too far away to vouch for it.
        for index in 85..95 {
            let near = values[index * 200 + 155];
            assert!(
                (near - 24.5).abs() < 0.01,
                "the near half moved to {near} on nobody's evidence"
            );
        }
    }

    #[test]
    fn a_cell_the_radar_reported_correctly_is_left_where_it_was() {
        // An isolated inbound cell in a strongly outbound environment. Both
        // readings are legal: minus ten as it stands, or plus forty if it
        // folded, and nothing in the sweep says which. The wind says plus
        // forty is nearer, but a storm cell is exactly the thing that does not
        // move with the wind around it, so nearness to the ambient flow is not
        // evidence enough to move a reading a whole interval.
        //
        // Which way to be wrong is the whole question, and the two are not
        // equal. Leaving a fold in is what this module did before the wind was
        // consulted at all. Drawing an inbound cell as a fifty metre a second
        // outbound one is a reading nothing measured.
        let (mut values, valid, pointing) = sweep_with_a_body(30.0, &[-10.0; 20]);
        let island = island_gates();
        assert!(
            island.iter().all(|at| valid[*at] && values[*at] == -10.0),
            "the cell should be there to begin with"
        );

        dealias(&mut values, &valid, &pointing, 200, NYQUIST, ELEVATION);

        for at in island {
            assert!(
                (values[at] + 10.0).abs() < 0.001,
                "gate {at} came back at {} rather than the -10 the radar reported",
                values[at]
            );
        }
    }

    #[test]
    fn leaves_an_island_alone_when_the_sweep_cannot_say_what_the_wind_is() {
        // The same island, with a body covering a sixth of the circle instead
        // of all of it. A wave fitted through a sixth of a ring matches those
        // gates beautifully and says nothing true about the rest, which is
        // exactly what KTLX looked like on 2026-09-03: settled gates over 34
        // to 118 radials of 720, residuals under 1.9 m/s, and a wind taken
        // from them moved that sweep from 3,913 broken pairs to 4,227. Worse
        // than it was found, which is the one thing this must never be.
        let (mut values, valid, truth, pointing) = sweep_with_an_island(30.0, 60);
        let island = island_gates();
        let before: Vec<f32> = island.iter().map(|at| values[*at]).collect();

        dealias(&mut values, &valid, &pointing, 200, NYQUIST, ELEVATION);

        for (at, was) in island.iter().zip(before) {
            assert!(
                (values[*at] - was).abs() < 0.001,
                "gate {at} was moved to {} on a sweep with no wind to move it by",
                values[*at]
            );
            // And it is still wrong, which is the honest answer rather than a
            // lucky one: nothing here knew where it belonged.
            assert!((values[*at] - truth[*at]).abs() > NYQUIST);
        }
    }
}

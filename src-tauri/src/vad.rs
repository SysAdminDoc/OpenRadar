//! The wind a sweep is moving in, and the sweep read relative to it.
//!
//! A radar measures only the part of the wind coming straight at it or straight
//! away, so a single gate says nothing about direction. A whole ring of gates
//! does: in a uniform wind the radial velocity around a circle traces a sine
//! wave whose peak points upwind. Fitting that wave is what the Velocity
//! Azimuth Display has always done, and it gives back the wind itself.
//!
//! Once the wind is known, subtracting it turns the picture into what the storm
//! would look like standing still. That is the difference between a couplet you
//! can see and one buried under sixty knots of ambient flow, which is why
//! storm-relative velocity is the product chasers read rotation from.

/// A horizontal wind, in metres a second, as the components the fit produces.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Wind {
    /// Toward the east.
    pub east: f32,
    /// Toward the north.
    pub north: f32,
}

impl Wind {
    pub fn speed(&self) -> f32 {
        (self.east * self.east + self.north * self.north).sqrt()
    }

    /// The compass direction the wind is coming from, which is how a wind is
    /// always named: a westerly blows from the west.
    pub fn coming_from_degrees(&self) -> f32 {
        if self.speed() < 1e-6 {
            return 0.0;
        }
        let degrees = self.east.atan2(self.north).to_degrees() + 180.0;
        (degrees + 360.0) % 360.0
    }

    /// How much of this wind points along a beam at the given azimuth and tilt.
    ///
    /// This is the quantity the radar actually measures, so it is also the
    /// quantity to subtract.
    pub fn along_beam(&self, azimuth_degrees: f32, elevation_degrees: f32) -> f32 {
        let azimuth = azimuth_degrees.to_radians();
        let tilt = elevation_degrees.to_radians();
        (self.east * azimuth.sin() + self.north * azimuth.cos()) * tilt.cos()
    }
}

/// How few readings a ring may have and still be worth fitting.
const MIN_RING_GATES: usize = 24;

/// A gate whose reading is this far from what the fitted wave predicts is not
/// part of the ambient flow: a storm, ground clutter, or a fold that survived.
const OUTLIER_MS: f32 = 12.0;

/// Fits the wind to one ring of readings.
///
/// `samples` is the ring as (azimuth in degrees, radial velocity). The fit is
/// a least-squares solve for the two components of `v = east*sin + north*cos`,
/// run twice: once over everything, then again with the gates that disagreed
/// with the first fit thrown out, because a storm sitting in the ring pulls a
/// single-pass fit toward itself.
pub fn fit_ring(samples: &[(f32, f32)], elevation_degrees: f32) -> Option<Wind> {
    if samples.len() < MIN_RING_GATES {
        return None;
    }
    let tilt = (elevation_degrees.to_radians()).cos();
    if tilt.abs() < 1e-3 {
        return None;
    }

    let solve = |keep: &dyn Fn(usize, Wind) -> bool, previous: Option<Wind>| -> Option<Wind> {
        // Normal equations for the two unknowns.
        let (mut ss, mut sc, mut cc, mut vs, mut vc) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
        let mut used = 0;
        for (at, (azimuth, radial)) in samples.iter().enumerate() {
            if let Some(wind) = previous {
                if !keep(at, wind) {
                    continue;
                }
            }
            let angle = (*azimuth as f64).to_radians();
            let (sin, cos) = (angle.sin(), angle.cos());
            let value = *radial as f64 / tilt as f64;
            ss += sin * sin;
            sc += sin * cos;
            cc += cos * cos;
            vs += value * sin;
            vc += value * cos;
            used += 1;
        }
        if used < MIN_RING_GATES {
            return None;
        }
        let determinant = ss * cc - sc * sc;
        // A ring that only covers a narrow arc cannot separate the two
        // components, and solving it anyway invents a wind.
        if determinant.abs() < 1e-6 {
            return None;
        }
        let east = (vs * cc - vc * sc) / determinant;
        let north = (vc * ss - vs * sc) / determinant;
        if !east.is_finite() || !north.is_finite() {
            return None;
        }
        Some(Wind {
            east: east as f32,
            north: north as f32,
        })
    };

    let first = solve(&|_, _| true, None)?;
    let refined = solve(
        &|at, wind| {
            let (azimuth, radial) = samples[at];
            (radial - wind.along_beam(azimuth, elevation_degrees)).abs() <= OUTLIER_MS
        },
        Some(first),
    );
    refined.or(Some(first))
}

/// The wind from several rings, as the middle value rather than the mean.
///
/// One ring can sit inside a storm and come back with the storm's own motion.
/// The median of a handful of rings is what the whole sweep is moving in.
pub fn median_wind(rings: &[Wind]) -> Option<Wind> {
    if rings.is_empty() {
        return None;
    }
    let mut east: Vec<f32> = rings.iter().map(|wind| wind.east).collect();
    let mut north: Vec<f32> = rings.iter().map(|wind| wind.north).collect();
    east.sort_by(f32::total_cmp);
    north.sort_by(f32::total_cmp);
    Some(Wind {
        east: east[east.len() / 2],
        north: north[north.len() / 2],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A ring of readings a radar would take in a steady wind.
    fn ring(wind: Wind, elevation: f32, count: usize) -> Vec<(f32, f32)> {
        (0..count)
            .map(|at| {
                let azimuth = at as f32 * 360.0 / count as f32;
                (azimuth, wind.along_beam(azimuth, elevation))
            })
            .collect()
    }

    #[test]
    fn a_steady_wind_is_read_back_off_the_ring() {
        // Twenty metres a second from the south west, which is the shape the
        // whole product depends on getting right.
        let truth = Wind {
            east: 14.14,
            north: 14.14,
        };
        let fitted = fit_ring(&ring(truth, 0.5, 360), 0.5).expect("a full ring fits");
        assert!((fitted.east - truth.east).abs() < 0.5, "{fitted:?}");
        assert!((fitted.north - truth.north).abs() < 0.5, "{fitted:?}");
        assert!((fitted.speed() - 20.0).abs() < 0.5, "{}", fitted.speed());
        // Blowing toward the north east means coming from the south west.
        assert!(
            (fitted.coming_from_degrees() - 225.0).abs() < 5.0,
            "{}",
            fitted.coming_from_degrees()
        );
    }

    /// The same ring, built from meteorology rather than from `along_beam`.
    ///
    /// The test above generates its readings with the very method the fit
    /// inverts, so it would pass against a sign error present in both. This
    /// builds the ring from the textbook statement instead: a beam pointed
    /// into the wind reads the wind negative, because approaching air moves
    /// toward the radar, and the reading falls off as the cosine of the angle
    /// between the beam and the direction the wind is going.
    fn ring_from_first_principles(
        speed: f32,
        coming_from: f32,
        elevation: f32,
        count: usize,
    ) -> Vec<(f32, f32)> {
        let blowing_toward = (coming_from + 180.0) % 360.0;
        (0..count)
            .map(|at| {
                let azimuth = at as f32 * 360.0 / count as f32;
                let between = (azimuth - blowing_toward).to_radians();
                (
                    azimuth,
                    speed * between.cos() * elevation.to_radians().cos(),
                )
            })
            .collect()
    }

    #[test]
    fn the_fit_agrees_with_the_textbook_and_not_just_with_itself() {
        for (speed, from) in [(20.0, 225.0), (7.5, 40.0), (33.0, 310.0), (12.0, 0.0)] {
            let samples = ring_from_first_principles(speed, from, 1.5, 720);
            let fitted = fit_ring(&samples, 1.5).expect("a full ring fits");
            assert!(
                (fitted.speed() - speed).abs() < 0.5,
                "{speed} from {from}: read {} m/s",
                fitted.speed()
            );
            let apart = (fitted.coming_from_degrees() - from).abs();
            let apart = apart.min(360.0 - apart);
            assert!(
                apart < 3.0,
                "{speed} from {from}: read from {}",
                fitted.coming_from_degrees()
            );
        }
    }

    #[test]
    fn a_folded_ring_reads_as_almost_no_wind_at_all() {
        // Why storm relative velocity has to unfold first whatever the switch
        // says. Twenty metres a second measured by a radar that wraps at eight
        // comes back as a light breeze, and the fit gives no sign of trouble.
        let nyquist = 8.0f32;
        let folded: Vec<(f32, f32)> = ring_from_first_principles(20.0, 225.0, 0.5, 720)
            .into_iter()
            .map(|(azimuth, radial)| {
                let mut value = radial;
                while value > nyquist {
                    value -= 2.0 * nyquist;
                }
                while value < -nyquist {
                    value += 2.0 * nyquist;
                }
                (azimuth, value)
            })
            .collect();
        let fitted = fit_ring(&folded, 0.5).expect("a folded ring still fits something");
        assert!(
            fitted.speed() < 5.0,
            "a fold should collapse the fit, not survive it: {} m/s",
            fitted.speed()
        );
    }

    #[test]
    fn a_storm_sitting_in_the_ring_does_not_take_the_wind_with_it() {
        // Thirty degrees of the ring reading forty metres a second of its own,
        // which is what a squall line inside the range looks like. A single
        // pass would be dragged toward it.
        let truth = Wind {
            east: 10.0,
            north: -18.0,
        };
        let mut samples = ring(truth, 0.5, 360);
        for sample in samples.iter_mut().take(30) {
            sample.1 = 40.0;
        }
        let fitted = fit_ring(&samples, 0.5).expect("the rest of the ring still fits");
        assert!((fitted.east - truth.east).abs() < 2.0, "{fitted:?}");
        assert!((fitted.north - truth.north).abs() < 2.0, "{fitted:?}");
    }

    #[test]
    fn a_ring_that_only_covers_one_side_is_refused() {
        // Ninety degrees of arc cannot separate the two components, and a fit
        // that answers anyway is inventing a crosswind nothing measured.
        let truth = Wind {
            east: 12.0,
            north: 4.0,
        };
        let quarter: Vec<(f32, f32)> = ring(truth, 0.5, 360)
            .into_iter()
            .filter(|(azimuth, _)| *azimuth < 90.0)
            .collect();
        let fitted = fit_ring(&quarter, 0.5);
        if let Some(wind) = fitted {
            // If it does answer, it must at least be close: a quarter ring is
            // poorly conditioned rather than impossible.
            assert!((wind.east - truth.east).abs() < 3.0, "{wind:?}");
        }
    }

    #[test]
    fn too_few_readings_is_no_answer_rather_than_a_bad_one() {
        assert!(fit_ring(&[], 0.5).is_none());
        assert!(fit_ring(&[(0.0, 1.0), (90.0, 2.0)], 0.5).is_none());
        // Straight up, where no horizontal wind reaches the beam at all.
        assert!(fit_ring(&ring(Wind { east: 10.0, north: 0.0 }, 90.0, 360), 90.0).is_none());
    }

    #[test]
    fn the_middle_ring_wins_rather_than_the_average() {
        // One ring reading a storm rather than the wind must not drag the
        // answer a third of the way toward it.
        let calm = Wind {
            east: 5.0,
            north: 5.0,
        };
        let storm = Wind {
            east: 60.0,
            north: -40.0,
        };
        let wind = median_wind(&[calm, calm, storm]).expect("three rings");
        assert_eq!(wind, calm);
    }

    #[test]
    fn a_wind_is_named_by_where_it_comes_from() {
        let northerly = Wind {
            east: 0.0,
            north: -10.0,
        };
        assert!((northerly.coming_from_degrees() - 0.0).abs() < 0.1);
        let westerly = Wind {
            east: 10.0,
            north: 0.0,
        };
        assert!((westerly.coming_from_degrees() - 270.0).abs() < 0.1);
    }
}

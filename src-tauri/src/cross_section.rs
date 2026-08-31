//! A vertical slice through a radar volume, taken between two points on the
//! map.
//!
//! A sweep is one cone through a storm. Which is the practical question about
//! a storm most of the time, and which is no help at all with the other
//! question: how high does it reach, and is the strongest part of it aloft or
//! at the ground. Answering that from sweeps means flicking between tilts and
//! holding the difference in your head.
//!
//! This takes the same volume and cuts it the other way. Draw a line on the
//! map, and every cut the radar made is asked what it holds along that line.
//! The result is distance across and height up, which is the picture a
//! forecaster actually reads a storm's structure off.
//!
//! Nothing here knows about colour. It samples, and the caller paints, so the
//! geometry can be checked against a volume whose every reading is known in
//! advance.

use nexrad_model::data::{GateStatus, SweepField};
use nexrad_model::geo::{GeoPoint, RadarCoordinateSystem};

/// The 4/3 effective earth radius, in kilometres.
///
/// The same constant `nexrad_model` uses, and the same one the beam height in
/// the map's inspect tool is worked out with. A beam does not travel in a
/// straight line through an atmosphere whose refractive index falls with
/// height; pretending the earth is a third larger than it is and the beam
/// straight comes to the same answer, and is what every radar textbook and
/// the NWS itself does.
const EFFECTIVE_EARTH_RADIUS_KM: f64 = 6371.0 * 4.0 / 3.0;

/// How wide the WSR-88D beam is between its half-power points, in degrees.
///
/// This is what decides whether a cut has anything to say about a given height
/// at a given distance. At 20 km out the beam is about 320 m thick and the
/// tilts overlap; at 200 km it is over three kilometres thick and there are
/// gaps between them that no cut covers. Those gaps are the reason a
/// cross-section far from the radar looks like stacked ribbons rather than a
/// picture, and drawing them as though something had been measured there would
/// be an invention.
const BEAM_WIDTH_DEGREES: f64 = 0.925;

/// How far up the picture reaches, in kilometres.
///
/// Above this there is nothing a WSR-88D can be showing: the highest cut of
/// any coverage pattern is 19.5 degrees, which passes 18 km only inside about
/// 55 km of the radar, and a storm top over 18 km is not a thing that happens
/// in the continental United States.
pub const TOP_KM: f64 = 18.0;

/// One cut, as this module needs it.
pub struct Cut<'a> {
    pub elevation_degrees: f32,
    pub field: &'a SweepField,
}

/// One sampled cell of the slice.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cell {
    pub value: f32,
    pub status: GateStatus,
    /// Which cut the reading came off, so the picture can say what it covers.
    pub elevation_degrees: f32,
}

/// A slice, as values rather than as a picture.
pub struct Slice {
    pub width: usize,
    pub height: usize,
    /// Row-major from the top of the picture down, so index `row * width +
    /// column` is the cell at that pixel. `None` is a cell no cut reached.
    pub cells: Vec<Option<Cell>>,
    /// How far apart the two points are along the ground, in kilometres.
    pub distance_km: f64,
    /// The top of the picture, in kilometres above the radar.
    pub top_km: f64,
    /// The lowest and highest cut that put a reading in the picture, or None
    /// when nothing did.
    pub covered: Option<(f32, f32)>,
}

impl Slice {
    pub fn cell(&self, column: usize, row: usize) -> Option<Cell> {
        self.cells.get(row * self.width + column).copied().flatten()
    }
}

/// How high the centre of the beam is at a given slant range, in kilometres
/// above the radar.
pub fn beam_height_km(range_km: f64, elevation_degrees: f32) -> f64 {
    if !range_km.is_finite() || range_km < 0.0 {
        return 0.0;
    }
    let angle = (elevation_degrees as f64).to_radians();
    (range_km * range_km
        + EFFECTIVE_EARTH_RADIUS_KM * EFFECTIVE_EARTH_RADIUS_KM
        + 2.0 * range_km * EFFECTIVE_EARTH_RADIUS_KM * angle.sin())
    .sqrt()
        - EFFECTIVE_EARTH_RADIUS_KM
}

/// Half the thickness of the beam at a given range, in kilometres.
///
/// A cut says something about the heights its own beam passes through and
/// nothing about the heights between it and the next one.
pub fn beam_half_thickness_km(range_km: f64) -> f64 {
    range_km * (BEAM_WIDTH_DEGREES / 2.0).to_radians().tan()
}

/// The great-circle distance between two points, in kilometres.
pub fn ground_distance_km(from: GeoPoint, to: GeoPoint) -> f64 {
    let lat1 = from.latitude.to_radians();
    let lat2 = to.latitude.to_radians();
    let d_lat = lat2 - lat1;
    let d_lon = (to.longitude - from.longitude).to_radians();
    let a = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * a.sqrt().asin() * 6371.0
}

/// A point a fraction of the way along the great circle from one to another.
///
/// Interpolating the latitude and longitude directly would do for the tens of
/// kilometres most of these lines run to, and would drift where one does not:
/// a line across most of a radar's range at a high latitude is a noticeably
/// different path from the straight one drawn between its ends.
pub fn along(from: GeoPoint, to: GeoPoint, fraction: f64) -> GeoPoint {
    let lat1 = from.latitude.to_radians();
    let lon1 = from.longitude.to_radians();
    let lat2 = to.latitude.to_radians();
    let lon2 = to.longitude.to_radians();

    let d_lat = lat2 - lat1;
    let d_lon = lon2 - lon1;
    let a = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);
    let angular = 2.0 * a.sqrt().asin();
    // Two points in the same place have no direction between them, and the
    // interpolation below would divide by the sine of nothing.
    if angular.abs() < 1e-12 {
        return from;
    }

    let start = ((1.0 - fraction) * angular).sin() / angular.sin();
    let end = (fraction * angular).sin() / angular.sin();
    let x = start * lat1.cos() * lon1.cos() + end * lat2.cos() * lon2.cos();
    let y = start * lat1.cos() * lon1.sin() + end * lat2.cos() * lon2.sin();
    let z = start * lat1.sin() + end * lat2.sin();
    GeoPoint {
        latitude: z.atan2((x * x + y * y).sqrt()).to_degrees(),
        longitude: y.atan2(x).to_degrees(),
    }
}

/// Takes the slice.
///
/// One column per pixel across, one row per pixel up. Each column is a place
/// on the ground, and every cut is asked what it holds there; each row is a
/// height, and the cut whose beam passes closest to it wins the cell. A height
/// no beam passes through is left empty rather than filled from the nearest
/// cut, because the radar did not look there.
pub fn slice(
    coordinates: &RadarCoordinateSystem,
    cuts: &[Cut<'_>],
    from: GeoPoint,
    to: GeoPoint,
    width: usize,
    height: usize,
    top_km: f64,
) -> Slice {
    let distance_km = ground_distance_km(from, to);
    let mut cells = vec![None; width * height];
    let mut covered: Option<(f32, f32)> = None;

    // What the cuts hold at one place on the ground, reused down the column.
    let mut here: Vec<(f64, f64, Cell)> = Vec::with_capacity(cuts.len());

    for column in 0..width {
        let fraction = if width > 1 {
            (column as f64 + 0.5) / width as f64
        } else {
            0.5
        };
        let point = along(from, to, fraction);

        here.clear();
        for cut in cuts {
            let polar = coordinates.geo_to_polar(point, cut.elevation_degrees);
            let Some((value, status)) = cut
                .field
                .value_at_polar(polar.azimuth_degrees, polar.range_km)
            else {
                continue;
            };
            here.push((
                beam_height_km(polar.range_km, cut.elevation_degrees),
                beam_half_thickness_km(polar.range_km),
                Cell {
                    value,
                    status,
                    elevation_degrees: cut.elevation_degrees,
                },
            ));
        }
        if here.is_empty() {
            continue;
        }

        for row in 0..height {
            let at_km = top_km * (1.0 - (row as f64 + 0.5) / height as f64);
            let mut best: Option<(f64, Cell)> = None;
            for (beam_km, half_km, cell) in &here {
                let apart = (beam_km - at_km).abs();
                if apart > *half_km {
                    continue;
                }
                if best.is_none_or(|(held, _)| apart < held) {
                    best = Some((apart, *cell));
                }
            }
            let Some((_, cell)) = best else { continue };
            covered = Some(match covered {
                None => (cell.elevation_degrees, cell.elevation_degrees),
                Some((low, high)) => (
                    low.min(cell.elevation_degrees),
                    high.max(cell.elevation_degrees),
                ),
            });
            cells[row * width + column] = Some(cell);
        }
    }

    Slice {
        width,
        height,
        cells,
        distance_km,
        top_km,
        covered,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nexrad_model::meta::Site;

    fn site() -> Site {
        // A site on the equator at the prime meridian, so a distance east is a
        // distance in longitude and the arithmetic below is checkable by hand.
        Site::new(*b"TEST", 0.0, 0.0, 0, 20)
    }

    fn field(elevation: f32, value: f32) -> SweepField {
        let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
        let gates = 800;
        let mut field = SweepField::new_empty(
            "Reflectivity",
            "dBZ",
            elevation,
            azimuths.clone(),
            1.0,
            2.125,
            0.25,
            gates,
        );
        for azimuth in 0..azimuths.len() {
            for gate in 0..gates {
                field.set(azimuth, gate, value, GateStatus::Valid);
            }
        }
        field
    }

    #[test]
    fn the_beam_climbs_the_way_the_textbook_says() {
        // Half a degree at a hundred kilometres is a shade under 1.5 km up,
        // which is the number every beam-height table prints.
        assert!((beam_height_km(100.0, 0.5) - 1.461).abs() < 0.01);
        // And straight up is straight up.
        assert!((beam_height_km(10.0, 90.0) - 10.0).abs() < 0.01);
        assert_eq!(beam_height_km(0.0, 0.5), 0.0);
        // A negative range is not a range.
        assert_eq!(beam_height_km(-5.0, 0.5), 0.0);
    }

    #[test]
    fn the_beam_widens_with_distance() {
        // Under a kilometre of thickness inside a hundred, and over three at
        // two hundred, which is why the gaps open up out there.
        assert!(beam_half_thickness_km(20.0) < 0.2);
        assert!(beam_half_thickness_km(200.0) > 1.5);
        assert_eq!(beam_half_thickness_km(0.0), 0.0);
    }

    #[test]
    fn a_point_partway_along_is_partway_along() {
        let from = GeoPoint {
            latitude: 0.0,
            longitude: 0.0,
        };
        let to = GeoPoint {
            latitude: 0.0,
            longitude: 1.0,
        };
        let middle = along(from, to, 0.5);
        assert!((middle.longitude - 0.5).abs() < 1e-6);
        assert!(middle.latitude.abs() < 1e-6);
        // The ends are the ends.
        assert!((along(from, to, 0.0).longitude).abs() < 1e-9);
        assert!((along(from, to, 1.0).longitude - 1.0).abs() < 1e-9);
        // A line of no length has no direction, and asking for a point along
        // it must not divide by nothing.
        let same = along(from, from, 0.5);
        assert!(same.latitude.abs() < 1e-9 && same.longitude.abs() < 1e-9);
    }

    #[test]
    fn a_degree_at_the_equator_is_a_degree() {
        let apart = ground_distance_km(
            GeoPoint {
                latitude: 0.0,
                longitude: 0.0,
            },
            GeoPoint {
                latitude: 0.0,
                longitude: 1.0,
            },
        );
        assert!((apart - 111.19).abs() < 0.1, "{apart}");
    }

    /// The whole point of the slice, on a volume whose every reading is known:
    /// a cut at one angle puts its value where its beam is and nowhere else.
    #[test]
    fn a_single_cut_lands_on_its_own_beam_and_leaves_the_rest_empty() {
        let site = site();
        let coordinates = RadarCoordinateSystem::new(&site);
        let cut = field(0.5, 40.0);
        let cuts = [Cut {
            elevation_degrees: 0.5,
            field: &cut,
        }];
        // Twenty to a hundred kilometres east of the radar.
        let from = GeoPoint {
            latitude: 0.0,
            longitude: 0.18,
        };
        let to = GeoPoint {
            latitude: 0.0,
            longitude: 0.9,
        };
        let taken = slice(&coordinates, &cuts, from, to, 64, 64, TOP_KM);

        assert!(
            (taken.distance_km - 80.0).abs() < 1.0,
            "{}",
            taken.distance_km
        );
        assert_eq!(taken.covered, Some((0.5, 0.5)));

        // The last column is a hundred kilometres out, where half a degree is
        // about 1.46 km up. The row that holds is the one covering that height.
        let column = taken.width - 1;
        let filled: Vec<usize> = (0..taken.height)
            .filter(|row| taken.cell(column, *row).is_some())
            .collect();
        assert!(!filled.is_empty(), "the beam drew nothing");
        // Half a degree at a hundred kilometres is 1.46 km up, and the beam is
        // 0.81 km thick either side of that, which is the whole band the cut
        // can have anything to say about.
        for row in &filled {
            let at_km = TOP_KM * (1.0 - (*row as f64 + 0.5) / taken.height as f64);
            assert!(
                (at_km - 1.461).abs() <= 0.81,
                "row {row} is {at_km} km up, outside the beam at that range"
            );
            assert_eq!(taken.cell(column, *row).unwrap().value, 40.0);
        }
        // Nothing at ten kilometres up, where this cut never looked.
        let high = (taken.height as f64 * (1.0 - 10.0 / TOP_KM)) as usize;
        assert!(taken.cell(column, high).is_none());
    }

    /// Two cuts, and each height goes to whichever beam is actually there.
    #[test]
    fn a_higher_cut_fills_the_higher_rows() {
        let site = site();
        let coordinates = RadarCoordinateSystem::new(&site);
        let low = field(0.5, 10.0);
        let high = field(4.0, 50.0);
        let cuts = [
            Cut {
                elevation_degrees: 0.5,
                field: &low,
            },
            Cut {
                elevation_degrees: 4.0,
                field: &high,
            },
        ];
        let from = GeoPoint {
            latitude: 0.0,
            longitude: 0.18,
        };
        let to = GeoPoint {
            latitude: 0.0,
            longitude: 0.9,
        };
        let taken = slice(&coordinates, &cuts, from, to, 64, 96, TOP_KM);
        assert_eq!(taken.covered, Some((0.5, 4.0)));

        let column = taken.width - 1;
        let value_at = |km: f64| {
            let row = ((1.0 - km / TOP_KM) * taken.height as f64) as usize;
            taken
                .cell(column, row.min(taken.height - 1))
                .map(|c| c.value)
        };
        // A hundred kilometres out: half a degree sits near 1.5 km and four
        // degrees near 7.5. Each height reads off its own cut.
        assert_eq!(value_at(1.5), Some(10.0));
        assert_eq!(value_at(7.4), Some(50.0));
        // And the gap between them belongs to neither.
        assert_eq!(value_at(4.5), None);
    }

    #[test]
    fn a_line_beyond_the_gates_draws_nothing() {
        let site = site();
        let coordinates = RadarCoordinateSystem::new(&site);
        let cut = field(0.5, 40.0);
        let cuts = [Cut {
            elevation_degrees: 0.5,
            field: &cut,
        }];
        // Four degrees of longitude out is well past the 200 km of gates.
        let from = GeoPoint {
            latitude: 0.0,
            longitude: 4.0,
        };
        let to = GeoPoint {
            latitude: 0.0,
            longitude: 5.0,
        };
        let taken = slice(&coordinates, &cuts, from, to, 32, 32, TOP_KM);
        assert!(taken.cells.iter().all(Option::is_none));
        assert_eq!(taken.covered, None);
    }
}

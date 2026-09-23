use chrono::{TimeZone, Utc};

use super::*;
use crate::fixture;
use crate::level2::scan_volume;

fn sample(height_km: f64, dbz: f32) -> Sample {
    Sample {
        height_km,
        slant_km: height_km * 10.0,
        dbz,
    }
}

/// Freezing at three kilometres and minus twenty at six, so the weighting runs
/// over a span a test can do arithmetic on.
fn plain_air() -> Isotherms<'static> {
    Isotherms {
        freezing_km: 3.0,
        minus_twenty_km: 6.0,
        source: "a planted column",
    }
}

#[test]
fn the_reflectivity_weight_ramps_between_the_two_stated_decibels() {
    assert_eq!(reflectivity_weight(30.0), 0.0);
    assert_eq!(reflectivity_weight(40.0), 0.0);
    assert!((reflectivity_weight(45.0) - 0.5).abs() < 1e-9);
    assert_eq!(reflectivity_weight(50.0), 1.0);
    assert_eq!(reflectivity_weight(70.0), 1.0);
}

#[test]
fn the_temperature_weight_ramps_between_the_two_heights() {
    let air = plain_air();
    assert_eq!(temperature_weight(1.0, &air), 0.0);
    assert_eq!(temperature_weight(3.0, &air), 0.0);
    assert!((temperature_weight(4.5, &air) - 0.5).abs() < 1e-9);
    assert_eq!(temperature_weight(6.0, &air), 1.0);
    assert_eq!(temperature_weight(12.0, &air), 1.0);
}

/// Greene and Clark over a column of one reading, worked out by hand.
///
/// Forty decibels is ten thousand in the unit the relation is written in, and
/// ten thousand to the four sevenths is 193.07, so five kilometres of it is
/// 3.44e-6 times 193.07 times 5,000 plus half a beamwidth at each end. The
/// end extensions carry the same reflectivity as the nearest sample and grow
/// with range, which is the ROC algorithm's half-beamwidth rule.
#[test]
fn a_column_of_one_reading_holds_the_water_the_relation_says() {
    let column = [sample(1.0, 40.0), sample(6.0, 40.0)];
    let z_4_7 = 193.07;
    let centre_depth_m = 5000.0;
    let half_below_m = beam_half_thickness_km(column[0].slant_km) * 1000.0;
    let half_above_m = beam_half_thickness_km(column[1].slant_km) * 1000.0;
    let expected = 3.44e-6 * z_4_7 * (centre_depth_m + half_below_m + half_above_m);
    let found = vil(&column);
    assert!(
        (found - expected).abs() / expected < 0.02,
        "{found} is not within 2% of {expected} kg per square metre"
    );
}

/// The cap is what keeps a hail core from reading as an impossible depth of
/// rain, so a column above it holds exactly what a column at it holds.
#[test]
fn reflectivity_past_the_ice_cap_adds_no_more_water() {
    let capped = [sample(1.0, VIL_CAP_DBZ), sample(6.0, VIL_CAP_DBZ)];
    let past = [sample(1.0, 70.0), sample(6.0, 70.0)];
    assert!((vil(&capped) - vil(&past)).abs() < 1e-9);
    // And the cap is a cap rather than a floor: weaker echo holds less.
    let weaker = [sample(1.0, 45.0), sample(6.0, 45.0)];
    assert!(vil(&weaker) < vil(&capped));
}

/// The top is carried between the cut that holds the echo and the one above.
#[test]
fn the_echo_top_is_interpolated_rather_than_a_cut_height() {
    // Thirty decibels at five kilometres, ten at seven. The threshold sits
    // (30 - 18.5) / (30 - 10) of the way up, which is 5 + 2 * 0.575.
    let column = [sample(2.0, 45.0), sample(5.0, 30.0), sample(7.0, 10.0)];
    let found = echo_top_km(&column).expect("an echo top");
    assert!((found.km - 6.15).abs() < 1e-6, "{}", found.km);
    assert!(!found.topped, "interpolated top should not be topped");

    // With nothing above it, the top is the highest beam that saw it: the
    // volume cannot say how much further it goes. This IS topped.
    let capped = [sample(2.0, 45.0), sample(5.0, 30.0)];
    let topped = echo_top_km(&capped).expect("a topped echo top");
    assert!((topped.km - 5.0).abs() < 1e-6);
    assert!(topped.topped, "a top at the highest cut should be topped");

    // And a column that never reaches the threshold has no top.
    assert_eq!(echo_top_km(&[sample(2.0, 10.0)]), None);
}

/// The hail index and the size it stands for, both worked out by hand.
///
/// Fifty-five decibels weighs one, so the energy flux is 5e-6 times ten to the
/// 4.62, which is 0.208435. The temperature weight is zero at the freezing
/// level and one at minus twenty, so over the three kilometres between them
/// the trapezoid is half of that times 3,000 metres, and a tenth of the result
/// is 31.265. Fifteen point zero nine six times 31.265 to the 0.206 is 30.7
/// millimetres, which is an inch and a fifth.
#[test]
fn a_planted_column_gives_the_hail_index_and_size_it_should() {
    let air = plain_air();
    let column = [sample(3.0, 55.0), sample(6.0, 55.0)];
    let index = severe_hail_index(&column, &air);
    assert!((index - 31.265).abs() < 0.01, "the index came out {index}");
    let size = mesh_mm(index);
    assert!((size - 30.7).abs() < 0.1, "the size came out {size} mm");
}

/// Hail grows above the freezing level, so a column entirely below it is not
/// making any however strong it reads.
#[test]
fn a_warm_column_makes_no_hail() {
    let air = plain_air();
    let column = [sample(0.5, 65.0), sample(2.9, 65.0)];
    assert_eq!(severe_hail_index(&column, &air), 0.0);
    assert_eq!(answer(Kind::HailSize, &column, &air), None);
}

/// And so is a column that never reaches the reflectivity the weighting
/// starts at, whatever height it is at.
#[test]
fn a_weak_column_makes_no_hail() {
    let air = plain_air();
    let column = [sample(3.0, 35.0), sample(9.0, 35.0)];
    assert_eq!(severe_hail_index(&column, &air), 0.0);
}

/// The standard atmosphere is what is used when nothing better is loaded, and
/// it says so rather than presenting itself as a sounding.
#[test]
fn the_default_air_is_the_standard_atmosphere_and_names_itself() {
    let air = Isotherms::default();
    assert!((air.freezing_km - 2.3077).abs() < 1e-3, "{air:?}");
    assert!((air.minus_twenty_km - 5.3846).abs() < 1e-3, "{air:?}");
    assert!(air.source.contains("no sounding loaded"), "{air:?}");
    let line = derivation(Kind::HailSize, &air);
    assert!(line.contains("no sounding loaded"), "{line}");
    assert!(line.contains("Murillo and Homeyer"), "{line}");
}

/// A loaded sounding is named in the export header, which is the whole point
/// of carrying where the heights came from.
#[test]
fn the_derivation_names_the_sounding_the_heights_came_from() {
    let air = Isotherms {
        freezing_km: 4.1,
        minus_twenty_km: 7.6,
        source: "the 00Z balloon from Omaha",
    };
    let line = derivation(Kind::HailSize, &air);
    assert!(line.contains("the 00Z balloon from Omaha"), "{line}");
    assert!(line.contains("4.10 km"), "{line}");
    assert!(line.contains("7.60 km"), "{line}");
}

/// A volume of two cuts with known readings, which is a known column over
/// every point of ground both of them reach.
fn two_cut_volume(lower_dbz: f32, upper_dbz: f32) -> Vec<u8> {
    let at = Utc
        .with_ymd_and_hms(2026, 9, 9, 22, 30, 0)
        .single()
        .expect("a UTC time");
    let site = fixture::Site {
        id: *b"KDMX",
        latitude: 41.731,
        longitude: -93.723,
        height_metres: 299,
    };
    let cuts = vec![
        fixture::flat_cut(
            at,
            fixture::Cut {
                number: 1,
                degrees: 0.5,
                radials: 360,
                gates: 400,
                reflectivity: fixture::Gate::Reading(lower_dbz),
                ..fixture::Cut::default()
            },
        ),
        fixture::flat_cut(
            at,
            fixture::Cut {
                number: 2,
                degrees: 3.5,
                radials: 360,
                gates: 400,
                reflectivity: fixture::Gate::Reading(upper_dbz),
                ..fixture::Cut::default()
            },
        ),
    ];
    fixture::volume(&site, at, &cuts)
}

/// The same volume forty seconds in: one cut published and the rest to come.
fn one_cut_volume(dbz: f32) -> Vec<u8> {
    let at = Utc
        .with_ymd_and_hms(2026, 9, 9, 22, 30, 0)
        .single()
        .expect("a UTC time");
    let site = fixture::Site {
        id: *b"KDMX",
        latitude: 41.731,
        longitude: -93.723,
        height_metres: 299,
    };
    let cuts = vec![fixture::flat_cut(
        at,
        fixture::Cut {
            number: 1,
            degrees: 0.5,
            radials: 360,
            gates: 400,
            reflectivity: fixture::Gate::Reading(dbz),
            ..fixture::Cut::default()
        },
    )];
    fixture::volume(&site, at, &cuts)
}

/// The grid is the radar's own frame on kilometre bins, and the whole volume
/// is what each bin was worked out from.
#[test]
fn a_volume_of_two_cuts_composites_to_the_stronger_of_them() {
    let scan = scan_volume(two_cut_volume(35.0, 55.0)).expect("a decoded volume");
    let derived = derive(&scan, Kind::Composite, &plain_air(), 0.299).expect("a derived grid");
    let field = &derived.field;
    assert_eq!(field.gate_interval_km(), BIN_KM);
    assert_eq!(field.unit(), "dBZ");

    // Fifty kilometres out, both cuts reach and the stronger is the answer.
    let bin = ((50.0 - FIRST_BIN_KM) / BIN_KM).round() as usize;
    let (found, status) = field.get(90, bin);
    assert_eq!(status, GateStatus::Valid, "nothing at 50 km");
    assert!((found - 55.0).abs() < 0.6, "the composite read {found}");

    // And with the upper cut the weaker of the two, the answer follows the
    // reading rather than the cut.
    let scan = scan_volume(two_cut_volume(52.0, 20.0)).expect("a decoded volume");
    let derived = derive(&scan, Kind::Composite, &plain_air(), 0.299).expect("a derived grid");
    let (found, _) = derived.field.get(90, bin);
    assert!((found - 52.0).abs() < 0.6, "the composite read {found}");
}

/// The column each bin was worked out from is the one the beams passed
/// through, so the echo top follows the height of the cut that holds it.
#[test]
fn the_echo_top_climbs_with_range_because_the_beam_does() {
    let scan = scan_volume(two_cut_volume(35.0, 35.0)).expect("a decoded volume");
    let derived = derive(&scan, Kind::EchoTop, &plain_air(), 0.299).expect("a derived grid");
    let field = &derived.field;
    assert_eq!(field.unit(), "km");

    let at = |ground_km: f64| {
        let bin = ((ground_km - FIRST_BIN_KM) / BIN_KM).round() as usize;
        let (value, status) = field.get(90, bin);
        assert_eq!(status, GateStatus::Valid, "nothing at {ground_km} km");
        value as f64
    };
    let near = at(20.0);
    let far = at(80.0);
    assert!(far > near, "{near} then {far}");
    // The upper cut at 3.5 degrees is what holds the top, and its beam is
    // about 5.2 km above the radar at eighty kilometres of ground range.
    // Above sea level that is the radar's own 299 metres more.
    let slant = 80.0 / 3.5f64.to_radians().cos();
    let expected = beam_height_km(slant, 3.5) + 0.299;
    assert!((far - expected).abs() < 0.2, "{far} is not {expected}");
}

/// Why a column may not be drawn from the volume the radar is sweeping now.
///
/// A scan publishes its cuts from the bottom up over four to six minutes, so
/// forty seconds in there is a volume holding only its lowest tilts. This is
/// that volume against the finished one, over the same ground: the echo top
/// reads the height of the highest beam there has been so far, which is a
/// storm that has not grown yet rather than one that is not there.
#[test]
fn a_volume_that_is_only_its_lowest_cuts_answers_differently() {
    let air = plain_air();
    let bin = ((40.0 - FIRST_BIN_KM) / BIN_KM).round() as usize;
    let top_of = |data: Vec<u8>| {
        let scan = scan_volume(data).expect("a decoded volume");
        let derived = derive(&scan, Kind::EchoTop, &air, 0.299).expect("a derived grid");
        let (value, status) = derived.field.get(90, bin);
        assert_eq!(status, GateStatus::Valid);
        value
    };
    let whole = top_of(two_cut_volume(45.0, 45.0));
    let partway = top_of(one_cut_volume(45.0));
    assert!(
        whole > partway + 1.0,
        "the finished volume topped out at {whole} km and its lowest cut at          {partway}, which is not far enough apart for this to be worth guarding"
    );
}

/// The ground a slant range covers, which is what `slant_for` inverts.
///
/// Written out here rather than called, so the inverse is checked against the
/// model rather than against itself.
fn ground_covered(slant_km: f64, elevation: f32) -> f64 {
    let height = beam_height_km(slant_km, elevation);
    let cosine = (elevation as f64).to_radians().cos();
    EARTH_KM * (slant_km * cosine / (EARTH_KM + height)).asin()
}

/// A point of ground is put at the range along the beam that actually reaches
/// it, under the same earth the beam height is measured against.
#[test]
fn the_slant_range_lands_on_the_ground_it_was_asked_for() {
    for elevation in [0.5f32, 3.5, 9.9, 19.5] {
        for ground_km in [10.0f64, 50.0, 90.0, 150.0] {
            let Some(slant) = slant_for(ground_km, elevation) else {
                continue;
            };
            let landed = ground_covered(slant, elevation);
            assert!(
                (landed - ground_km).abs() < 0.001,
                "at {elevation} degrees, {ground_km} km came back as {landed}"
            );
        }
    }
}

/// And the flat-earth answer it replaces is wrong by more than a gate at the
/// top of a volume pattern, which is what makes the correction worth making.
#[test]
fn the_flat_answer_is_out_by_more_than_a_gate_at_the_top_tilt() {
    let ground_km = 90.0;
    let elevation = 19.5f32;
    let flat = ground_km / (elevation as f64).to_radians().cos();
    let real = slant_for(ground_km, elevation).expect("a slant range");
    assert!(
        real - flat > 0.25,
        "the flat answer was {flat} against {real}, which is inside a gate"
    );
}

/// Nothing to see is nothing drawn, rather than a grid of zeroes.
#[test]
fn a_volume_with_no_echo_draws_nothing() {
    let scan = scan_volume(two_cut_volume(-20.0, -20.0)).expect("a decoded volume");
    let derived = derive(&scan, Kind::EchoTop, &plain_air(), 0.299).expect("a derived grid");
    assert!(
        derived
            .field
            .statuses()
            .iter()
            .all(|status| !matches!(status, GateStatus::Valid)),
        "an empty volume was given an echo top"
    );
}

#[test]
fn every_kind_names_itself_and_its_unit() {
    for kind in [
        Kind::Composite,
        Kind::EchoTop,
        Kind::Vil,
        Kind::VilDensity,
        Kind::HailSize,
    ] {
        let (label, unit) = named(kind);
        assert!(!label.is_empty(), "{kind:?}");
        assert!(!derivation(kind, &plain_air()).is_empty(), "{kind:?}");
        // Reflectivity is the one that shares a unit with a moment the radar
        // recorded, because a composite is reflectivity.
        if kind == Kind::Composite {
            assert_eq!(unit, "dBZ");
        } else {
            assert_ne!(unit, "dBZ", "{kind:?}");
        }
    }
}

/// Where the planted hail core sits on its radial, in kilometres of ground.
const CORE_FROM_KM: f64 = 55.0;
const CORE_TO_KM: f64 = 60.0;
const SPIKE_RADIAL: usize = 90;
const PLANTED_GATES: usize = 400;

/// How far over the ground a gate of a cut sits, under the beam model
/// `slant_for` inverts.
fn ground_km_of(slant_km: f64, elevation: f32) -> f64 {
    let height = beam_height_km(slant_km, elevation);
    let cosine = (elevation as f64).to_radians().cos();
    EARTH_KM * (slant_km * cosine / (EARTH_KM + height)).asin()
}

/// One radial of one cut: a hail core, the storm's own rain behind it, then a
/// flare, with every property a rule looks at held apart so a test can break
/// one at a time.
#[derive(Clone, Copy)]
struct Flare {
    elevation: f32,
    core_dbz: f32,
    starts_behind_km: f64,
    length_km: f64,
    dbz: f32,
    zdr: f32,
    rho: f32,
    /// Kilometres into the flare where it drops back to rain, and for how far.
    dip: Option<(f64, f64)>,
    /// Ground, in kilometres from the radar and how far it runs, where the
    /// rain behind the core has a patch with the spike's own look.
    stray: Option<(f64, f64)>,
}

impl Flare {
    /// The spike on the stored KMAF volume of 2019-05-24, behind its 70 dBZ
    /// core: faint, 6 dB and 0.4, on a cut that passes the core at 4.4 km.
    fn like_kmaf() -> Self {
        Self {
            elevation: 4.0,
            core_dbz: 65.0,
            starts_behind_km: 2.0,
            length_km: 10.0,
            dbz: 12.0,
            zdr: 6.0,
            rho: 0.4,
            dip: None,
            stray: None,
        }
    }

    fn cut(self) -> Moments {
        self.cut_through(720)
    }

    /// The same cut with only its first `radials` swept, half a degree apart,
    /// the way a cut still being swept arrives.
    fn cut_through(self, radials: usize) -> Moments {
        let angles: Vec<f32> = (0..radials).map(|at| at as f32 * 0.5).collect();
        let empty = |label: &str| {
            SweepField::new_empty(
                label,
                "",
                self.elevation,
                angles.clone(),
                0.5,
                2.125,
                0.25,
                PLANTED_GATES,
            )
        };
        let mut cut = Moments {
            elevation: self.elevation,
            reflectivity: empty("Reflectivity"),
            correlation: empty("Correlation coefficient"),
            differential: empty("Differential reflectivity"),
        };
        let flare_from = CORE_TO_KM + self.starts_behind_km;
        let flare_to = flare_from + self.length_km;
        let rain = (40.0, 1.0, 0.98);
        for gate in 0..PLANTED_GATES {
            let ground = ground_km_of(2.125 + gate as f64 * 0.25, self.elevation);
            let dipped = self.dip.is_some_and(|(into, far)| {
                (flare_from + into..flare_from + into + far).contains(&ground)
            });
            let stray = self
                .stray
                .is_some_and(|(at, far)| (at..at + far).contains(&ground));
            let (dbz, zdr, rho) = if (CORE_FROM_KM..CORE_TO_KM).contains(&ground) {
                (self.core_dbz, 1.5, 0.97)
            } else if stray {
                (self.dbz, self.zdr, self.rho)
            } else if (CORE_TO_KM..flare_from).contains(&ground) || dipped {
                rain
            } else if (flare_from..flare_to).contains(&ground) {
                (self.dbz, self.zdr, self.rho)
            } else {
                continue;
            };
            cut.reflectivity
                .set(SPIKE_RADIAL, gate, dbz, GateStatus::Valid);
            cut.differential
                .set(SPIKE_RADIAL, gate, zdr, GateStatus::Valid);
            cut.correlation
                .set(SPIKE_RADIAL, gate, rho, GateStatus::Valid);
        }
        cut
    }
}

/// The bins of the planted radial the detector marks, or nothing when it
/// finds no spike at all. Nothing off that radial is ever marked.
fn marked(flare: Flare) -> Option<Vec<usize>> {
    let cut = flare.cut();
    let flagged = spike_on(std::slice::from_ref(&cut), &cut.reflectivity)?;
    let mut on_radial = Vec::new();
    for at in 0..flagged.azimuths().len() {
        for bin in 0..flagged.gate_count() {
            if matches!(flagged.get(at, bin), (_, GateStatus::Valid)) {
                assert_eq!(at, SPIKE_RADIAL, "bin {bin} was marked off the radial");
                on_radial.push(bin);
            }
        }
    }
    Some(on_radial)
}

/// The flare covers 62 to 72 km of ground, which is the ten bins centred at
/// 62.5 through 71.5, and the rain between it and the core is not marked.
#[test]
fn a_flare_behind_a_core_aloft_is_marked_where_it_runs() {
    assert_eq!(
        marked(Flare::like_kmaf()),
        Some((62..=71).collect::<Vec<_>>())
    );
}

/// Rain's own polarimetry, and each half of the spike's look on its own.
#[test]
fn a_flare_without_the_look_of_a_spike_is_not_one() {
    let rain = Flare {
        zdr: 1.0,
        rho: 0.98,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(rain), None);
    let only_differential = Flare {
        rho: 0.98,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(only_differential), None);
    let only_correlation = Flare {
        zdr: 1.0,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(only_correlation), None);
}

/// The lowest cut passes the same core under a kilometre up, which is where
/// insects and birds give the same look behind every isolated storm.
#[test]
fn a_flare_behind_a_core_the_beam_passes_low_is_left_alone() {
    let low = Flare {
        elevation: 0.5,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(low), None);
}

/// Energy that came the long way round is faint. A strong flare is echo.
#[test]
fn a_flare_too_strong_to_have_come_the_long_way_is_not_a_spike() {
    let strong = Flare {
        dbz: 35.0,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(strong), None);
}

#[test]
fn a_flare_behind_a_core_short_of_hail_is_not_a_spike() {
    let weak_core = Flare {
        core_dbz: 55.0,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(weak_core), None);
}

/// Seven kilometres of rain behind the core is inside the window and nine is
/// past it.
#[test]
fn a_flare_is_only_looked_for_close_behind_the_core() {
    let inside = Flare {
        starts_behind_km: 7.0,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(inside), Some((67..=76).collect::<Vec<_>>()));
    let past = Flare {
        starts_behind_km: 9.0,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(past), None);
}

#[test]
fn a_flare_shorter_than_three_kilometres_is_not_a_spike() {
    let three = Flare {
        length_km: 3.0,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(three), Some((62..=64).collect::<Vec<_>>()));
    let two = Flare {
        length_km: 2.0,
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(two), None);
}

/// One bin of rain inside the flare is bridged. Two end it there.
#[test]
fn a_flare_that_dips_out_for_one_bin_is_marked_across_the_dip() {
    let one = Flare {
        dip: Some((4.0, 1.0)),
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(one), Some((62..=71).collect::<Vec<_>>()));
    let two = Flare {
        dip: Some((4.0, 2.0)),
        ..Flare::like_kmaf()
    };
    assert_eq!(marked(two), Some((62..=65).collect::<Vec<_>>()));
}

/// Each rule is held at its own value, not only held.
///
/// The first set of these broke each rule by a wide margin, and six
/// thresholds loosened together (the core to 56, the height to 1 km, the
/// window to 9, the ceiling to 34, the differential to 1.5, the correlation
/// to 0.95) still passed every one. These sit either side of each line.
#[test]
fn every_rule_is_held_at_its_own_value() {
    let found = |flare: Flare| marked(flare).is_some();
    let kmaf = Flare::like_kmaf;
    assert!(found(Flare {
        core_dbz: 60.0,
        ..kmaf()
    }));
    assert!(!found(Flare {
        core_dbz: 59.9,
        ..kmaf()
    }));
    assert!(found(Flare {
        dbz: 30.0,
        ..kmaf()
    }));
    assert!(!found(Flare {
        dbz: 30.1,
        ..kmaf()
    }));
    assert!(found(Flare { zdr: 3.0, ..kmaf() }));
    assert!(!found(Flare { zdr: 2.9, ..kmaf() }));
    assert!(found(Flare {
        rho: 0.79,
        ..kmaf()
    }));
    assert!(!found(Flare { rho: 0.8, ..kmaf() }));
    // The core's back edge is the bin centred at 59.5 km, so a flare from
    // 67 km starts in the eighth bin behind it and one from 68 in the ninth.
    assert!(found(Flare {
        starts_behind_km: 7.0,
        ..kmaf()
    }));
    assert!(!found(Flare {
        starts_behind_km: 8.0,
        ..kmaf()
    }));
    // Two tilts either side of three kilometres at the back edge, checked
    // against the beam model so the pair tests the rule, not the arithmetic.
    let back_edge = |elevation: f32| {
        beam_height_km(
            slant_for(59.5, elevation).expect("a slant range"),
            elevation,
        )
    };
    assert!(back_edge(2.8) > SPIKE_ALOFT_KM && back_edge(2.55) < SPIKE_ALOFT_KM);
    assert!(found(Flare {
        elevation: 2.8,
        ..kmaf()
    }));
    assert!(!found(Flare {
        elevation: 2.55,
        ..kmaf()
    }));
}

/// A patch with the spike's look right behind the core, too short to count,
/// does not hide the flare that starts further back inside the window. Only
/// the first start was tried, so one gate at 60.5 km took the whole core out.
#[test]
fn a_short_patch_behind_the_core_does_not_hide_the_flare_behind_it() {
    let flare = Flare {
        starts_behind_km: 5.0,
        stray: Some((60.0, 1.0)),
        ..Flare::like_kmaf()
    };
    // The flare covers 65 to 75 km, the ten bins centred at 65.5 to 74.5.
    assert_eq!(marked(flare), Some((65..=74).collect::<Vec<_>>()));
}

/// A reflectivity grid on half-degree radials reading the same everywhere.
fn uniform(elevation: f32, dbz: f32, radials: usize) -> SweepField {
    let angles: Vec<f32> = (0..radials).map(|at| at as f32 * 0.5).collect();
    let mut field = SweepField::new_empty(
        "Reflectivity",
        "dBZ",
        elevation,
        angles,
        0.5,
        2.125,
        0.25,
        PLANTED_GATES,
    );
    for azimuth in 0..radials {
        for gate in 0..PLANTED_GATES {
            field.set(azimuth, gate, dbz, GateStatus::Valid);
        }
    }
    field
}

/// A cut still being swept is read only where it has been swept.
///
/// Forty-five degrees of a cut with the flare on its last radial. The
/// model's reader answers any bearing with the nearest radial it holds, so
/// before this asked which bearings the cut had reached, the flare was
/// marked on every bearing from 45 round to 202.5 degrees.
#[test]
fn a_cut_still_being_swept_is_searched_only_where_it_has_been() {
    let cut = Flare::like_kmaf().cut_through(91);
    let like = uniform(0.5, 0.0, 720);
    let flagged = spike_on(std::slice::from_ref(&cut), &like).expect("the swept flare");
    let bearings: Vec<f32> = (0..flagged.azimuths().len())
        .filter(|at| {
            (0..flagged.gate_count())
                .any(|bin| matches!(flagged.get(*at, bin), (_, GateStatus::Valid)))
        })
        .map(|at| flagged.azimuths()[at])
        .collect();
    assert!(!bearings.is_empty());
    assert!(
        bearings
            .iter()
            .all(|bearing| (44.0..=46.0).contains(bearing)),
        "{bearings:?}"
    );
}

/// The column products read a cut still being swept only where it has been.
///
/// The same smear, on every column product: the upper cut's last radial was
/// lent to the whole circle, so a composite read 50 dBZ round the far side
/// where only the lowest cut, at 20, had reached.
#[test]
fn a_column_is_not_filled_from_a_radial_that_is_not_over_it() {
    let cuts = vec![
        (0.5, uniform(0.5, 20.0, 720)),
        (4.0, uniform(4.0, 50.0, 91)),
    ];
    let composite = derive_on(&cuts, Kind::Composite, &plain_air(), 0.0)
        .expect("a composite")
        .field;
    // Bin 30 is 30.5 km of ground, inside both cuts' reach.
    assert_eq!(
        composite.get(40, 30).0,
        50.0,
        "twenty degrees, both cuts swept it"
    );
    assert_eq!(
        composite.get(360, 30).0,
        20.0,
        "a hundred and eighty, only the lowest"
    );
}

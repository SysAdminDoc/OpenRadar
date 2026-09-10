use chrono::{TimeZone, Utc};

use super::*;
use crate::fixture;
use crate::level2::scan_volume;

fn sample(height_km: f64, dbz: f32) -> Sample {
    Sample { height_km, dbz }
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
/// 3.44e-6 times 193.07 times 5,000.
#[test]
fn a_column_of_one_reading_holds_the_water_the_relation_says() {
    let column = [sample(1.0, 40.0), sample(6.0, 40.0)];
    let expected = 3.44e-6 * 193.07 * 5000.0;
    let found = vil(&column);
    assert!(
        (found - expected).abs() < 0.01,
        "{found} is not {expected} kg per square metre"
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
    assert!((found - 6.15).abs() < 1e-6, "{found}");

    // With nothing above it, the top is the highest beam that saw it: the
    // volume cannot say how much further it goes.
    let capped = [sample(2.0, 45.0), sample(5.0, 30.0)];
    assert_eq!(echo_top_km(&capped), Some(5.0));

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

//! Fixtures the tests of more than one of these modules are written on.

use chrono::TimeZone;

use super::*;
use crate::fixture;

/// A sweep in a steady wind, with echo only over the range band given.
///
/// Everything outside the band reads as no data, which is what a sweep
/// looks like when the weather is all in one place.
pub(crate) fn sweep_in_a_wind(
    wind: vad::Wind,
    elevation: f32,
    echo_from_km: f64,
    echo_to_km: f64,
) -> SweepField {
    let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
    let gates = 1200;
    let first_km = 2.125;
    let interval_km = 0.25;
    let mut field = SweepField::new_empty(
        "Velocity",
        "m/s",
        elevation,
        azimuths.clone(),
        1.0,
        first_km,
        interval_km,
        gates,
    );
    for (index, azimuth) in azimuths.iter().enumerate() {
        for gate in 0..gates {
            let range = first_km + gate as f64 * interval_km;
            if range < echo_from_km || range > echo_to_km {
                continue;
            }
            field.set(
                index,
                gate,
                wind.along_beam(*azimuth, elevation),
                GateStatus::Valid,
            );
        }
    }
    field
}

/// A sweep with echo everywhere and a different wind in each range band.
///
/// The beam climbs with range, so range is height, and a real wind changes
/// with height. That is the whole reason it matters which part of the
/// sweep the rings come from.
pub(crate) fn layered_sweep(bands: &[(f64, f64, vad::Wind)], elevation: f32) -> SweepField {
    let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
    let gates = 1200;
    let first_km = 2.125;
    let interval_km = 0.25;
    let mut field = SweepField::new_empty(
        "Velocity",
        "m/s",
        elevation,
        azimuths.clone(),
        1.0,
        first_km,
        interval_km,
        gates,
    );
    for (index, azimuth) in azimuths.iter().enumerate() {
        for gate in 0..gates {
            let range = first_km + gate as f64 * interval_km;
            let Some((_, _, wind)) = bands
                .iter()
                .find(|(from, to, _)| range >= *from && range < *to)
            else {
                continue;
            };
            field.set(
                index,
                gate,
                wind.along_beam(*azimuth, elevation),
                GateStatus::Valid,
            );
        }
    }
    field
}

/// Twenty metres a second from the given direction.
pub(crate) fn wind_from(degrees: f32, speed: f32) -> vad::Wind {
    let toward = (degrees + 180.0).to_radians();
    vad::Wind {
        east: speed * toward.sin(),
        north: speed * toward.cos(),
    }
}

/// A field of one steady value, for the render tests below.
pub(crate) fn flat_field(value: f32, product: Product) -> (SweepField, RadarCoordinateSystem) {
    let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
    let gates = 400;
    let mut field = SweepField::new_empty(
        if matches!(product, Product::Velocity) {
            "Velocity"
        } else {
            "Reflectivity"
        },
        if matches!(product, Product::Velocity) {
            "m/s"
        } else {
            "dBZ"
        },
        0.5,
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
    let site = registry::site_by_id("KDMX").expect("KDMX").to_site();
    let coordinates = RadarCoordinateSystem::new(&site);
    (field, coordinates)
}

/// The smoothed picture of the stepped fixture, pinned.
pub(crate) const SMOOTHED_SWEEP_DIGEST: &str =
    "d7d772a92d793e564dd8a68add8f711da7b55fdc408cf6db09251d73e613d3fe";

/// A sweep whose gates rise in steps, so smoothing has something to do.
///
/// Four hundred gates, a value that changes every fifty of them, and one
/// degree between radials, which is the geometry of a real cut.
pub(crate) fn stepped_field(product: Product) -> (SweepField, RadarCoordinateSystem) {
    let azimuths: Vec<f32> = (0..360).map(|at| at as f32).collect();
    let gates = 400;
    let mut field = SweepField::new_empty(
        if matches!(product, Product::Velocity) {
            "Velocity"
        } else {
            "Reflectivity"
        },
        if matches!(product, Product::Velocity) {
            "m/s"
        } else {
            "dBZ"
        },
        0.5,
        azimuths.clone(),
        1.0,
        2.125,
        0.25,
        gates,
    );
    for azimuth in 0..azimuths.len() {
        for gate in 0..gates {
            let step = (gate / 50) as f32;
            // Every step is above the ramp's own floor, so which
            // pixels are painted is decided by the radar having read
            // something and by nothing else.
            let value = if matches!(product, Product::Velocity) {
                step * 5.0 - 20.0
            } else {
                step * 8.0 + 20.0
            };
            field.set(azimuth, gate, value, GateStatus::Valid);
        }
    }
    let site = registry::site_by_id("KDMX").expect("KDMX").to_site();
    let coordinates = RadarCoordinateSystem::new(&site);
    (field, coordinates)
}

/// The range of the centre of a gate, which is what a reading belongs to.
pub(crate) fn gate_centre_km(field: &SweepField, gate: usize) -> f64 {
    field.first_gate_range_km() + (gate as f64 + 0.5) * field.gate_interval_km()
}

pub(crate) fn table(range_folded: Option<&str>) -> Palette {
    Palette::with_range_folded(
        Some("dBZ".into()),
        range_folded,
        &[
            palette::Stop {
                value: 5.0,
                color: "#04e9e7".into(),
                to_color: None,
                solid: false,
            },
            palette::Stop {
                value: 50.0,
                color: "#fd0000".into(),
                to_color: None,
                solid: false,
            },
        ],
    )
    .expect("a palette")
}

pub(crate) fn local_archive_fixture(uncompressed: bool) -> (DateTime<Utc>, Vec<u8>) {
    let at = Utc
        .with_ymd_and_hms(2026, 8, 30, 9, 21, 59)
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
            radials: 36,
            gates: 40,
            reflectivity: fixture::Gate::Reading(35.0),
            ..fixture::Cut::default()
        },
    )];
    let data = if uncompressed {
        fixture::uncompressed_volume(&site, at, &cuts)
    } else {
        fixture::volume(&site, at, &cuts)
    };
    (at, data)
}

/// A volume with two cuts of known readings, for slicing.
pub(crate) fn two_cut_volume() -> (DateTime<Utc>, String, Vec<u8>) {
    let at = Utc
        .with_ymd_and_hms(2026, 8, 30, 9, 21, 59)
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
                radials: 180,
                gates: 400,
                reflectivity: fixture::Gate::Reading(35.0),
                velocity: Some(fixture::Gate::Reading(6.0)),
                ..fixture::Cut::default()
            },
        ),
        fixture::flat_cut(
            at,
            fixture::Cut {
                number: 2,
                degrees: 3.5,
                radials: 180,
                gates: 400,
                reflectivity: fixture::Gate::Reading(55.0),
                velocity: Some(fixture::Gate::Reading(-6.0)),
                ..fixture::Cut::default()
            },
        ),
    ];
    let key = format!("KDMX/KDMX{}_V06", at.format("%Y%m%d_%H%M%S"));
    (at, key, fixture::volume(&site, at, &cuts))
}

/// A degree of longitude at KDMX, in kilometres, so a test can put a point
/// a stated distance due east of the radar.
pub(crate) const KM_PER_DEGREE_EAST: f64 = 83.06;

pub(crate) fn decode_png(data_url: &str) -> (u32, u32, Vec<u8>) {
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .expect("a png data url");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("base64");
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().expect("png header");
    let mut pixels = vec![0u8; reader.output_buffer_size().expect("a bounded png")];
    let info = reader.next_frame(&mut pixels).expect("png pixels");
    pixels.truncate(info.buffer_size());
    (info.width, info.height, pixels)
}

/// What the NEXRAD crates decode a known volume into, written down.
///
/// The three `nexrad-*` crates are release candidates, pinned to exact
/// versions in `Cargo.toml`. A pre-release can change what it decodes
/// without changing what it is called, and every number below is one a
/// change like that would move: the geometry the sweep is drawn on, the
/// units it is labelled in, and the cuts the picker offers.
///
/// So this is a golden test rather than a behavioural one. If a dependency
/// update moves any of it, that is the update telling you it changed the
/// picture, and the numbers here are updated deliberately with a note
/// saying why rather than adjusted until the run goes green.
mod golden {
    use super::*;

    #[test]
    fn a_known_volume_decodes_to_a_known_geometry() {
        let _guard = decoded_cache_test();
        clear_cache();
        let (at, key, data) = two_cut_volume();
        let (scan, _) = decoded_volume(&key, data).expect("the fixture decodes");

        // The cuts the picker offers, in the order it offers them.
        assert_eq!(tilts(&scan), vec![0.5, 3.5]);

        let cut = sweep_field(&scan, Product::Reflectivity, 0).expect("the lowest cut");
        assert_eq!(cut.elevation_degrees, 0.5);
        assert_eq!(cut.elevation_number, 1);
        assert_eq!(cut.collected, Some(at));

        // The gate geometry, which is what every reading's position is
        // worked out from. These are the values the fixture writes into
        // the radial header, so a decoder that read them differently, or
        // scaled them differently, would show up here rather than as a
        // picture that is subtly in the wrong place.
        assert_eq!(cut.field.gate_count(), 400);
        assert_eq!(cut.field.azimuth_count(), 180);
        assert!((cut.field.first_gate_range_km() - 2.125).abs() < 1e-6);
        assert!((cut.field.gate_interval_km() - 0.25).abs() < 1e-6);
        // One degree, not the two the radials are actually apart. The
        // ICD encodes azimuth resolution as a code meaning either half a
        // degree or a whole one, because those are the only two a
        // WSR-88D uses, so a fixture written at two degrees declares one.
        // What matters is that the decoder reads the code the same way it
        // did yesterday.
        assert!((cut.field.azimuth_spacing_degrees() - 1.0).abs() < 1e-6);
        assert!((cut.field.max_range_km() - 102.125).abs() < 1e-6);

        // And the units, which the legend is labelled from. A moment
        // relabelled upstream would put the wrong unit beside the bar.
        for (product, label, unit) in [
            ("reflectivity", "Reflectivity", "dBZ"),
            ("velocity", "Velocity", "m/s"),
            ("spectrum-width", "Spectrum width", "m/s"),
            (
                "differential-reflectivity",
                "Differential reflectivity",
                "dB",
            ),
            ("correlation-coefficient", "Correlation coefficient", ""),
        ] {
            let named = product_from_name(product).expect(product);
            assert_eq!((named.1, named.2), (label, unit), "{product}");
        }
    }

    /// The extent a sweep is laid over, to the metre.
    ///
    /// This one is not ours: `RadarCoordinateSystem` works it out, and the
    /// map lays the picture over exactly this box. A change of a hundredth
    /// of a degree is two kilometres of storm in the wrong place.
    #[test]
    fn a_known_site_draws_over_a_known_box() {
        let _guard = decoded_cache_test();
        clear_cache();
        let (_, key, data) = two_cut_volume();
        let sweep = sweep_from_volume(
            "KDMX",
            &key,
            data,
            SweepRequest {
                product_name: "reflectivity",
                ..SweepRequest::default()
            },
        )
        .expect("the fixture draws");

        // KDMX at 41.731, -93.723, out to the 230 km the sweep is drawn
        // to, through the 4/3 earth model. Two hundred and thirty
        // kilometres is 2.07 degrees of latitude and 2.77 of longitude at
        // this latitude, which is what these come to.
        let round = |value: f64| (value * 1e6).round() / 1e6;
        assert_eq!(round(sweep.west), -96.492749);
        assert_eq!(round(sweep.east), -90.952854);
        assert_eq!(round(sweep.south), 39.663236);
        assert_eq!(round(sweep.north), 43.798960);
        assert_eq!(sweep.elevation_degrees, 0.5);
        assert_eq!(sweep.unit, "dBZ");
        assert_eq!(sweep.tilts, vec![0.5, 3.5]);
    }
}

/// A volume that is not the volume it claims to be.
///
/// Every one of these runs inside a Tauri command. A panic there does not
/// become an error the caller can see: the promise never settles, so the
/// panel sits waiting forever and asks again two minutes later. The Level
/// III reader is held to the same standard a few files over.
mod malformed {
    use super::*;

    /// A small volume, so the sweeps below can cover every byte of it.
    fn small_volume() -> Vec<u8> {
        let at = Utc
            .with_ymd_and_hms(2026, 8, 30, 9, 21, 59)
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
                radials: 4,
                gates: 8,
                reflectivity: fixture::Gate::Reading(35.0),
                velocity: Some(fixture::Gate::Reading(6.0)),
                ..fixture::Cut::default()
            },
        )];
        fixture::uncompressed_volume(&site, at, &cuts)
    }

    /// Decode and choose a cut, which is every line that reads the file.
    ///
    /// Deliberately not `sweep_from_volume`: drawing is a million pixels
    /// per call and is our own arithmetic over values the decoder has
    /// already validated. What is being swept here is the parser, and
    /// putting the renderer behind it turns a two-second corpus into a
    /// twenty-minute one.
    fn parse(key: &str, data: Vec<u8>) {
        let Ok((scan, _)) = decoded_volume(key, data) else {
            return;
        };
        let _ = tilts(&scan);
        let _ = sweep_field(&scan, Product::Reflectivity, 0);
        let _ = sweep_field(&scan, Product::Velocity, 0);
    }

    /// The whole-volume entry the fuzz target calls.
    ///
    /// It exists for the fuzz workspace, which means the ordinary gate is
    /// the only thing standing between it and drifting away from the path
    /// it is supposed to represent.
    #[test]
    fn scanning_a_volume_reads_it_and_refuses_a_stub() {
        let scan = scan_volume(small_volume()).expect("a volume scans");
        assert!(!tilts(&scan).is_empty());
        // Shorter than an Archive II header, which used to panic inside
        // the library rather than coming back as an error.
        assert!(scan_volume(vec![0u8; 8]).is_err());
        assert!(scan_volume(Vec::new()).is_err());
    }

    /// Writes what the `level2_volume` fuzz target starts from.
    ///
    /// A fuzzer given nothing has to discover the Archive II header, the
    /// LDM record framing and the bzip inside each record before it can
    /// reach a single line of message parsing, which it will not do in an
    /// hour. Seeded with a volume that decodes, it spends the hour on the
    /// arithmetic instead.
    ///
    /// Ignored, because it writes files rather than checking anything.
    /// Run it when the fixtures change:
    /// `cargo test --lib level2::tests::malformed::writes -- --ignored`
    #[test]
    #[ignore = "writes the fuzz seed corpus rather than checking anything"]
    fn writes_the_fuzz_seed_corpus() {
        let into = Path::new("fuzz/seeds/level2_volume");
        std::fs::create_dir_all(into).expect("a corpus directory");
        let volume = small_volume();
        std::fs::write(into.join("small-volume"), &volume).expect("a seed");
        // And the two shapes a real download arrives in beside it: cut
        // short, which is what an interrupted fetch leaves, and empty.
        std::fs::write(into.join("half-volume"), &volume[..volume.len() / 2]).expect("a seed");
        std::fs::write(into.join("empty"), []).expect("a seed");
    }

    #[test]
    fn no_single_corrupt_byte_can_take_the_process_down() {
        let _guard = decoded_cache_test();
        clear_cache();
        let volume = small_volume();
        for at in 0..volume.len() {
            for byte in [0x00u8, 0x01, 0x7f, 0xff] {
                let mut broken = volume.clone();
                broken[at] = byte;
                // A fresh key each time, or the cache would answer with
                // the volume decoded before it was broken.
                parse(&format!("broken:{at}:{byte}"), broken);
            }
        }
        clear_cache();
    }

    #[test]
    fn a_volume_that_stops_in_the_middle_is_refused_rather_than_fatal() {
        let _guard = decoded_cache_test();
        clear_cache();
        let volume = small_volume();
        // Every length a truncated download could leave behind.
        for length in 0..volume.len() {
            parse(&format!("short:{length}"), volume[..length].to_vec());
        }
        // And nothing at all, which is what an empty file is.
        parse("empty file", Vec::new());
        clear_cache();
    }

    #[test]
    fn a_file_that_is_not_a_volume_is_refused() {
        let _guard = decoded_cache_test();
        clear_cache();
        for (name, bytes) in [
            ("text", b"this is not a radar volume".to_vec()),
            ("zeros", vec![0u8; 4096]),
            ("header only", b"AR2V0006.001".to_vec()),
            // The right header and nothing behind it.
            ("empty body", {
                let mut out = b"AR2V0006.001".to_vec();
                out.resize(24, 0);
                out
            }),
        ] {
            let asked = decoded_volume(&format!("not-a-volume:{name}"), bytes);
            assert!(asked.is_err(), "{name} should be refused");
        }
        clear_cache();
    }
}

/// A volume is nine megabytes or so. Four of them held as they arrived is
/// a fraction of the budget; four of them decoded would not be, which is
/// why the cache keeps the bytes and decodes on demand.
/// The roadmap's budget is 512 MB with four volumes cached. A volume as
/// it arrives is about nine megabytes, so the cache is a rounding error
/// against that; what would breach it is caching decoded scans instead,
/// which is why this holds the bytes and decodes on demand.
pub(crate) const BUDGET_BYTES: usize = 512 * 1024 * 1024;
/// Comfortably larger than any volume the archive publishes.
pub(crate) const LARGEST_VOLUME_BYTES: usize = 32 * 1024 * 1024;

/// The worst case the cache can ever be in, checked when the crate is
/// compiled rather than when the tests are run: a capacity or a limit that
/// breaks the budget should not build at all.
const _: () = assert!(CACHE_CAPACITY * LARGEST_VOLUME_BYTES < BUDGET_BYTES);

/// One press of the wind profile panel must not empty the cache under the
/// volume the loop is drawing. Checked at compile time for the same
/// reason: asking for more columns than the cache can hold beside the
/// picture makes the picture re-download itself, and nothing about that
/// looks wrong from the outside.
const _: () = assert!(MAX_VWP_COLUMNS < CACHE_CAPACITY);

#[test]
pub(crate) fn holds_four_volumes_and_no_more() {
    // `clear_cache` empties the decoded volumes as well as the bytes, so
    // this has to take its turn with the tests that count decodes. Without
    // the guard it wipes their cache between two of their own calls and
    // they see a second decode that never happened.
    let _guard = decoded_cache_test();
    clear_cache();

    let volume = vec![0u8; 10 * 1024 * 1024];
    for index in 0..7 {
        remember(&format!("KDMX/{index}"), &volume);
    }
    assert_eq!(cached_bytes(), CACHE_CAPACITY * volume.len());

    // The oldest went first, and the newest is still there.
    assert!(cached("KDMX/0").is_none());
    assert!(cached("KDMX/6").is_some());

    // Asking twice for the same volume does not store it twice.
    remember("KDMX/6", &volume);
    assert_eq!(cached_bytes(), 4 * volume.len());
    clear_cache();
}

/// One Level II message, framed as the archive frames it.
///
/// Twelve bytes the RPG puts in front, then the header the document
/// describes: size in halfwords, channel, type, sequence, date, time,
/// segment count and number. Every message sits in a frame of its own,
/// two thousand four hundred and thirty-two bytes whatever it holds, and
/// the reader steps frame by frame: a message written any shorter than
/// that is read as the start of the next one.
pub(crate) const FRAME_BYTES: usize = 2432;

pub(crate) fn framed_message(message_type: u8, payload: &[u8]) -> Vec<u8> {
    const HEADER_BYTES: usize = 16;
    let mut out = vec![0u8; 12];
    let halfwords = ((HEADER_BYTES + payload.len()) / 2) as u16;
    out.extend_from_slice(&halfwords.to_be_bytes());
    out.push(8); // single channel
    out.push(message_type);
    out.extend_from_slice(&1u16.to_be_bytes()); // sequence
    out.extend_from_slice(&20_696u16.to_be_bytes()); // days since 1970
    out.extend_from_slice(&43_200_000u32.to_be_bytes()); // milliseconds
    out.extend_from_slice(&1u16.to_be_bytes()); // one segment
    out.extend_from_slice(&1u16.to_be_bytes()); // segment one
    out.extend_from_slice(payload);
    out.resize(FRAME_BYTES, 0);
    out
}

/// Reports a sweep again at a lower folding limit.
///
/// A fold cannot be planted by moving readings about. Every reading the
/// radar published is already inside its own limit, so shifting one by a
/// whole interval and wrapping it back gives the same number again, and
/// shifting it without wrapping puts it where no radar could have reported
/// it, which is not a fold but a value the algorithm has never been asked
/// to handle. The earlier version of this test did the second of those and
/// then measured whether the wedge came back; it never did, on any volume.
///
/// What does work is to take the sweep as the truth and report it again at
/// a limit low enough that some of it wraps. That is exactly what a fold
/// is, it happens to the real readings of a real day, and the answer is
/// known in advance because it is the sweep that was started with.
pub(crate) fn refold(field: &mut SweepField, nyquist: f32) -> usize {
    let interval = 2.0 * nyquist;
    let mut wrapped = 0;
    for azimuth in 0..field.azimuth_count() {
        for gate in 0..field.gate_count() {
            let (value, status) = field.get(azimuth, gate);
            if !matches!(status, GateStatus::Valid) {
                continue;
            }
            // Into the half-open band the radar reports in.
            let folded = value - interval * ((value + nyquist) / interval).floor();
            if (folded - value).abs() > 0.001 {
                wrapped += 1;
            }
            field.set(azimuth, gate, folded, GateStatus::Valid);
        }
    }
    wrapped
}

/// Neighbouring pairs that are not as far apart as they were in the truth.
///
/// The measure has to be one a constant cannot move. Region dealiasing
/// places each patch relative to its neighbours and the largest patch keeps
/// whatever it read, so the sweep as a whole is recovered up to a whole
/// interval and no further: with no still air anywhere in it, nothing in
/// the data says which interval the picture belongs to. Asking every pair
/// of touching gates to be the distance apart it was asks exactly what
/// unfolding promises, and nothing it does not.
pub(crate) fn broken_pairs(now: &SweepField, truth: &SweepField, interval: f32) -> (usize, usize) {
    let azimuths = now.azimuth_count();
    let gates = now.gate_count();
    let mut broken = 0;
    let mut pairs = 0;
    for azimuth in 0..azimuths {
        for gate in 0..gates {
            let (a_now, a_now_status) = now.get(azimuth, gate);
            let (a_was, a_was_status) = truth.get(azimuth, gate);
            if !matches!(a_now_status, GateStatus::Valid)
                || !matches!(a_was_status, GateStatus::Valid)
            {
                continue;
            }
            for (next_azimuth, next_gate) in [((azimuth + 1) % azimuths, gate), (azimuth, gate + 1)]
            {
                if next_gate >= gates {
                    continue;
                }
                let (b_now, b_now_status) = now.get(next_azimuth, next_gate);
                let (b_was, b_was_status) = truth.get(next_azimuth, next_gate);
                if !matches!(b_now_status, GateStatus::Valid)
                    || !matches!(b_was_status, GateStatus::Valid)
                {
                    continue;
                }
                pairs += 1;
                if ((a_now - b_now) - (a_was - b_was)).abs() > interval / 2.0 {
                    broken += 1;
                }
            }
        }
    }
    (broken, pairs)
}

/// What unfolding did to one station's velocity cut.
pub(crate) struct Measured {
    /// How the picture reads: touching gates that are not the distance
    /// apart the truth had them. A constant cannot move this.
    pub(crate) broken_before: usize,
    pub(crate) broken_after: usize,
    /// How the gates read: how many of the ones that wrapped came back to
    /// the branch they started on. The measure above cannot see this at
    /// all, because a whole region put back a full interval out is still
    /// perfectly continuous with itself.
    pub(crate) wrapped: usize,
    pub(crate) rejoined: usize,
    /// Gates that moved by something other than a whole interval, which is
    /// not unfolding but invention.
    pub(crate) invented: usize,
}

pub(crate) fn measure_unfolding(
    runtime: &tokio::runtime::Runtime,
    station: &str,
) -> Option<Measured> {
    let (_key, data) = runtime.block_on(latest_volume(station)).ok()?;
    let file = volume::File::new(data);
    let scan = file.scan().ok()?;
    let chosen = sweep_field(&scan, Product::Velocity, 1)?;
    let nyquist = nyquist_velocity(&file, chosen.elevation_number)?;
    if !(5.0..80.0).contains(&nyquist) {
        return None;
    }

    let truth = chosen.field;
    // A third of the radar's own limit, which is roughly what the lowest
    // cut of a real pattern runs at: KTBW folds its lowest cut at 8.4 m/s
    // and its tight ones at 28.
    let tight = nyquist / 3.0;
    let interval = 2.0 * tight;
    let mut folded = truth.clone();
    let wrapped_gates = refold(&mut folded, tight);
    if wrapped_gates < 500 {
        return None;
    }

    let (broken_before, comparable) = broken_pairs(&folded, &truth, interval);
    if comparable < 10_000 || broken_before < 500 {
        return None;
    }
    if !unfold_velocity(&mut folded, tight) {
        return None;
    }
    let (broken_after, _) = broken_pairs(&folded, &truth, interval);

    let mut wrapped = 0usize;
    let mut rejoined = 0usize;
    let mut invented = 0usize;
    for azimuth in 0..truth.azimuth_count() {
        for gate in 0..truth.gate_count() {
            let (now, now_status) = folded.get(azimuth, gate);
            let (was, was_status) = truth.get(azimuth, gate);
            if !matches!(now_status, GateStatus::Valid) || !matches!(was_status, GateStatus::Valid)
            {
                continue;
            }
            let apart = (now - was) / interval;
            if (apart - apart.round()).abs() > 0.01 {
                invented += 1;
                continue;
            }
            // Whether this gate wrapped when the limit was brought in.
            let refolded = was - interval * ((was + tight) / interval).floor();
            if (refolded - was).abs() <= 0.001 {
                continue;
            }
            wrapped += 1;
            if apart.round() == 0.0 {
                rejoined += 1;
            }
        }
    }

    Some(Measured {
        broken_before,
        broken_after,
        wrapped,
        rejoined,
        invented,
    })
}

/// A volume built to order, from the site's own registered position.
pub(crate) fn built_volume(cuts: &[Vec<fixture::Radial>]) -> Scan {
    let entry = registry::site_by_id("KTLX").expect("Oklahoma City is in the registry");
    let site = fixture::Site {
        id: *b"KTLX",
        latitude: entry.latitude,
        longitude: entry.longitude,
        height_metres: 370,
    };
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    let bytes = fixture::volume(&site, at, cuts);
    volume::File::new(bytes)
        .scan()
        .expect("a volume built to the ICD decodes")
}

/// The pixels of a drawn sweep, back out of the PNG it was handed over as.
pub(crate) fn drawn_pixels(sweep: &SweepImage) -> Vec<u8> {
    let encoded = sweep
        .image
        .strip_prefix("data:image/png;base64,")
        .expect("a PNG data url");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("valid base64");
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().expect("a readable PNG");
    let mut out = vec![0u8; reader.output_buffer_size().expect("a known size")];
    let info = reader.next_frame(&mut out).expect("one frame");
    out.truncate(info.buffer_size());
    out
}

/// The colour at a bearing and a distance from the site, off a drawn sweep.
pub(crate) fn pixel_at(
    sweep: &SweepImage,
    pixels: &[u8],
    bearing_degrees: f64,
    km: f64,
) -> [u8; 4] {
    let entry = registry::site_by_id(&sweep.station).expect("a known site");
    // Far enough north or east that a degree of latitude is close to
    // constant, which is all this needs to land inside the right wedge.
    let north = km * bearing_degrees.to_radians().cos() / 111.32;
    let east = km * bearing_degrees.to_radians().sin()
        / (111.32 * (entry.latitude as f64).to_radians().cos());
    let latitude = entry.latitude as f64 + north;
    let longitude = entry.longitude as f64 + east;

    let top = mercator_y(sweep.north);
    let bottom = mercator_y(sweep.south);
    let row = ((mercator_y(latitude) - top) / (bottom - top) * IMAGE_SIZE as f64) as usize;
    let column =
        ((longitude - sweep.west) / (sweep.east - sweep.west) * IMAGE_SIZE as f64) as usize;
    let at = (row.min(IMAGE_SIZE - 1) * IMAGE_SIZE + column.min(IMAGE_SIZE - 1)) * 4;
    [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]]
}

/// Radials over one sector only, which is what a volume in progress holds.
pub(crate) fn sector(
    from_degrees: f32,
    to_degrees: f32,
    reading: fixture::Gate,
    at: DateTime<Utc>,
) -> Vec<fixture::Radial> {
    // Half a degree apart, which is what a real super-resolution cut is
    // and what the header will say. Declaring one spacing and writing
    // another leaves the drawing sizing each wedge wrong, which showed up
    // as 29 per cent of a swept sector keeping the volume underneath.
    let spacing = 0.5f32;
    let mut out = Vec::new();
    let mut angle = from_degrees;
    let mut number = 1u16;
    while angle < to_degrees {
        out.push(fixture::Radial {
            azimuth_degrees: angle,
            azimuth_number: number,
            elevation_number: 1,
            elevation_degrees: 0.5,
            nyquist_ms: 8.0,
            collected: at,
            azimuth_spacing_degrees: spacing,
            reflectivity: vec![reading; 200],
            velocity: Vec::new(),
        });
        angle += spacing;
        number += 1;
    }
    out
}

/// Two volumes an age apart, for the phosphor picture.
pub(crate) fn faded_pair(older_at: DateTime<Utc>, live_at: DateTime<Utc>) -> (Scan, Scan) {
    (
        built_volume(&[fixture::flat_cut(older_at, fixture::Cut::default())]),
        built_volume(&[sector(0.0, 90.0, fixture::Gate::Reading(50.0), live_at)]),
    )
}

/// The decoded-volume cache and its counter are global, so the tests that
/// look at them take turns. A panicking test poisons this; the next one
/// carries on rather than failing for a reason that is not its own.
static DECODED_CACHE_TESTS: Mutex<()> = Mutex::new(());

pub(crate) fn decoded_cache_test() -> std::sync::MutexGuard<'static, ()> {
    DECODED_CACHE_TESTS
        .lock()
        .unwrap_or_else(|held| held.into_inner())
}

/// A volume as bytes, so a test can hand the same ones over twice.
pub(crate) fn volume_bytes(id: &[u8; 4], at: DateTime<Utc>) -> Vec<u8> {
    let entry = registry::site_by_id("KTLX").expect("Oklahoma City is in the registry");
    let site = fixture::Site {
        id: *id,
        latitude: entry.latitude,
        longitude: entry.longitude,
        height_metres: 370,
    };
    let cut = fixture::flat_cut(
        at,
        fixture::Cut {
            velocity: Some(fixture::Gate::Reading(4.0)),
            ..fixture::Cut::default()
        },
    );
    fixture::volume(&site, at, &[cut])
}

pub(crate) fn ask(tilt_index: usize, product_name: &str) -> SweepRequest<'_> {
    SweepRequest {
        product_name,
        tilt_index,
        unfold: false,
        manual_motion: None,
        threshold: None,
        high_contrast: false,
        persistence: false,
        reduced_motion: false,
        smooth: false,
    }
}

/// The colour-vision gate on the ramps this app draws with.
///
/// The numbers are multiples of the point at which two colours become
/// distinguishable at all, which is about 2.3 in this measure, rather than
/// thresholds chosen to let a particular ramp through.
mod colour_vision {
    use super::*;
    use crate::contrast::{
        closest_neighbours, lightness_climbs, opposite_directions, worst_pair, ColorVision,
        EVERY_VISION,
    };

    /// Neighbouring steps have to stay apart for every kind of vision.
    const NEIGHBOURS_APART: f32 = 10.0;
    /// A diverging scale has to keep its two directions apart.
    const DIRECTIONS_APART: f32 = 25.0;

    #[test]
    fn the_high_contrast_reflectivity_ramp_keeps_its_steps_apart() {
        for vision in EVERY_VISION {
            let (apart, from, to) = worst_pair(HIGH_CONTRAST_REFLECTIVITY_RAMP, vision);
            assert!(
                apart >= NEIGHBOURS_APART,
                "{} brings {from} and {to} dBZ within {apart:.1}",
                vision.name()
            );
        }
    }

    /// The property that makes the ramp readable when hue is gone entirely,
    /// on a failing screen or in sunlight: more rain is always lighter.
    #[test]
    fn the_high_contrast_reflectivity_ramp_climbs_in_lightness() {
        assert!(lightness_climbs(HIGH_CONTRAST_REFLECTIVITY_RAMP, 0.5));
    }

    /// What the ordinary scale actually does, kept as a test so the reason
    /// the other ramp exists is on the record and not in an argument.
    #[test]
    fn the_ordinary_reflectivity_ramp_is_the_one_with_the_problem() {
        let (apart, from, to) = worst_pair(REFLECTIVITY_RAMP, ColorVision::Deuteranopia);
        assert!(
            apart < 6.0,
            "the NWS scale was expected to collapse somewhere under deuteranopia, \
                 closest was {apart:.1} between {from} and {to}"
        );
        // And the high-contrast ramp is better at its own worst point than
        // the ordinary one is at that one.
        let better = closest_neighbours(HIGH_CONTRAST_REFLECTIVITY_RAMP, ColorVision::Deuteranopia);
        assert!(better > apart * 2.0);
    }

    #[test]
    fn the_high_contrast_velocity_ramps_keep_toward_apart_from_away() {
        for ramp in [
            HIGH_CONTRAST_VELOCITY_RAMP,
            HIGH_CONTRAST_WIDE_VELOCITY_RAMP,
        ] {
            for vision in EVERY_VISION {
                let apart = opposite_directions(ramp, vision);
                assert!(
                    apart >= DIRECTIONS_APART,
                    "{} brings the two directions within {apart:.1}",
                    vision.name()
                );
            }
        }
    }

    /// Green toward and red away is the pair the commonest colour blindness
    /// takes apart, which is the whole reason for a second velocity scale.
    #[test]
    fn the_ordinary_velocity_ramp_loses_its_direction() {
        let ordinary = opposite_directions(VELOCITY_RAMP, ColorVision::Deuteranopia);
        let replacement =
            opposite_directions(HIGH_CONTRAST_VELOCITY_RAMP, ColorVision::Deuteranopia);
        assert!(
            ordinary < DIRECTIONS_APART,
            "green against red was expected to lose the direction, got {ordinary:.1}"
        );
        assert!(
            replacement > ordinary * 2.0,
            "the replacement should hold the direction: {replacement:.1} against {ordinary:.1}"
        );
    }

    /// Neither ramp may be quietly reordered: the values have to ascend, or
    /// the colour a reading gets is not the colour the legend shows.
    #[test]
    fn every_ramp_runs_in_order() {
        for ramp in [
            REFLECTIVITY_RAMP,
            HIGH_CONTRAST_REFLECTIVITY_RAMP,
            VELOCITY_RAMP,
            WIDE_VELOCITY_RAMP,
            HIGH_CONTRAST_VELOCITY_RAMP,
            HIGH_CONTRAST_WIDE_VELOCITY_RAMP,
        ] {
            assert!(ramp.windows(2).all(|pair| pair[1].0 > pair[0].0));
        }
    }

    /// The two reflectivity ramps have to cover the same range, or asking
    /// for more contrast would quietly change which readings are drawn.
    #[test]
    fn the_two_reflectivity_ramps_cover_the_same_ground() {
        assert_eq!(REFLECTIVITY_RAMP[0].0, HIGH_CONTRAST_REFLECTIVITY_RAMP[0].0);
        assert_eq!(
            REFLECTIVITY_RAMP[REFLECTIVITY_RAMP.len() - 1].0,
            HIGH_CONTRAST_REFLECTIVITY_RAMP[HIGH_CONTRAST_REFLECTIVITY_RAMP.len() - 1].0
        );
    }
}

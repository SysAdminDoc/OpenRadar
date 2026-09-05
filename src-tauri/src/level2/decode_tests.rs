use chrono::TimeZone;

use super::*;
use crate::level2::testing::*;

#[test]
fn the_readings_an_export_writes_do_not_change_when_the_picture_is_smoothed() {
    // Smoothing is a way of drawing, not a reading. The CSV and the
    // GeoTIFF are written from the field itself, and this holds that the
    // field is untouched by the switch.
    let _guard = decoded_cache_test();
    clear_cache();
    let at = Utc
        .with_ymd_and_hms(2026, 5, 1, 20, 0, 0)
        .single()
        .expect("a UTC time");
    let volume = volume_bytes(b"KTLX", at);
    let read = |smooth: bool| {
        sweep_values(
            "KTLX",
            &format!("smooth:{smooth}"),
            volume.clone(),
            SweepRequest {
                smooth,
                ..ask(0, "reflectivity")
            },
        )
        .expect("a sweep")
        .field
    };
    let plain = read(false);
    let smoothed = read(true);
    assert_eq!(plain.azimuth_count(), smoothed.azimuth_count());
    assert_eq!(plain.gate_count(), smoothed.gate_count());
    for azimuth in 0..plain.azimuth_count() {
        assert_eq!(
            plain.radial_values(azimuth),
            smoothed.radial_values(azimuth),
            "radial {azimuth} was changed by the smoothing switch"
        );
    }
    clear_cache();
}

#[test]
fn local_import_draws_compressed_and_uncompressed_archive_ii_files() {
    let _guard = decoded_cache_test();
    clear_cache();
    for (name, uncompressed) in [("compressed", false), ("uncompressed", true)] {
        let (at, data) = local_archive_fixture(uncompressed);
        let path =
            std::env::temp_dir().join(format!("openradar-{name}-{}-KDMX.ar2v", std::process::id()));
        std::fs::write(&path, data).expect("write the local fixture");
        let local = read_local_volume(&path).expect("read the selected Archive II file");
        std::fs::remove_file(&path).expect("remove the local fixture");

        assert_eq!(local.station, "KDMX");
        assert!(local.key.starts_with("local:"));
        let sweep = sweep_from_volume(
            &local.station,
            &local.key,
            local.data,
            SweepRequest {
                product_name: "reflectivity",
                ..SweepRequest::default()
            },
        )
        .expect("draw the selected Archive II file");
        assert_eq!(sweep.station, "KDMX");
        assert_eq!(sweep.collected, at.to_rfc3339());
        assert!(sweep.image.starts_with("data:image/png;base64,"));
    }
    clear_cache();
}

#[test]
fn a_wind_profile_leaves_the_volume_on_screen_decoded() {
    // The panel asks for `MAX_VWP_COLUMNS` volumes at once, which is as
    // many as the decoded cache holds. Storing them evicted the scan the
    // map was drawing, so the next tilt, product or threshold change on
    // that frame decoded the whole volume again: the bytes were still
    // cached, so it was seconds of processor rather than a download, with
    // nothing on screen to say why.
    let _guard = decoded_cache_test();
    clear_cache();

    // The volume the map is drawing, decoded and kept the ordinary way.
    let (_, drawn, bytes) = two_cut_volume();
    decoded_volume(&drawn, bytes).expect("the fixture decodes");
    assert!(decoded_hit(&drawn).is_some(), "the drawn volume is cached");

    // Then a profile's worth of other volumes, read the way the panel
    // reads them.
    let (_, _, other) = two_cut_volume();
    for index in 0..MAX_VWP_COLUMNS {
        decoded_volume_once(&format!("profile/{index}"), other.clone())
            .expect("the fixture decodes");
    }

    assert!(
        decoded_hit(&drawn).is_some(),
        "opening the wind profile evicted the volume on screen",
    );
    // And the columns themselves were not kept, which is what makes room.
    assert!(decoded_hit("profile/0").is_none());
    clear_cache();

    // The command has to be the thing that reads them that way. Driving
    // it here would need the bucket, and everything above holds only the
    // helper: putting `level2_vwp` back on the caching path is the exact
    // regression this test is for, and the assertions above stay green
    // through it.
    let source = include_str!("commands.rs");
    let command = source
        .split("pub async fn level2_vwp(")
        .nth(1)
        .expect("the wind profile command is in this file");
    let body = &command[..command.find("\n#[tauri::command]").unwrap_or(command.len())];
    assert!(
        body.contains("decoded_volume_once("),
        "the wind profile no longer reads its volumes without keeping them",
    );
    assert!(
        !body.contains("decoded_volume("),
        "the wind profile is keeping a volume again",
    );
}

#[test]
#[ignore = "fetches a live volume from the NEXRAD archive"]
fn unfolding_a_live_velocity_sweep_takes_the_folds_out() {
    // Held, so two live tests do not wipe each other's cache. Under
    // `-- --ignored` these run together, and one clearing the cache while
    // another was reading it turned a real answer into a re-fetch or an
    // empty one, which reads as a service that failed rather than as a
    // test that raced.
    let _guard = decoded_cache_test();
    clear_cache();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    // More than one station, because the answer depends on the weather and
    // an assertion held against a single site is an assertion about that
    // site's afternoon. An earlier version asked KDMX alone and demanded a
    // quarter of the folds come back, which KDMX manages and KFWS, on the
    // same day, does not: 3766 broken pairs became 3270.
    let mut measured = Vec::new();
    for station in ["KDMX", "KTLX", "KAMX", "KTBW", "KGRR", "KFWS"] {
        let Some(found) = measure_unfolding(&runtime, station) else {
            continue;
        };
        println!(
            "{station}: broken pairs {} -> {}, {} of {} folded gates back on \
                 their own branch, {} invented",
            found.broken_before, found.broken_after, found.rejoined, found.wrapped, found.invented
        );
        measured.push(found);
    }
    assert!(
        measured.len() >= 3,
        "only {} stations answered with a Doppler cut worth measuring, which \
             after six tries is the archive rather than the weather",
        measured.len()
    );

    // What has to hold everywhere, whatever the day.
    for found in &measured {
        // Unfolding may move a reading by a whole number of intervals and
        // by nothing else, because that is what a fold is. Everything
        // below counts discontinuities, and a field of one constant value
        // is perfectly continuous, so a dealiaser that threw the readings
        // away and wrote zeros would score perfectly on all of them.
        assert_eq!(
            found.invented, 0,
            "{} gates came back at a value the radar never measured",
            found.invented
        );
        // And it must never leave the picture more broken than it found it.
        assert!(
            found.broken_after <= found.broken_before,
            "unfolding took {} broken pairs to {}",
            found.broken_before,
            found.broken_after
        );
        // Some of the folded gates have to come back to the branch they
        // started on. Not most: a patch with no boundary to anything
        // outside itself has nothing to be placed by, and how much of a
        // sweep is isolated like that is a property of the weather.
        assert!(
            found.rejoined * 20 > found.wrapped,
            "only {} of {} folded gates came back to their own branch",
            found.rejoined,
            found.wrapped
        );
    }

    // And across the stations together, which is far steadier than any one
    // of them, most of the picture has to come back. This is the claim the
    // grower it replaced fails: on the same six stations it left the
    // broken pairs where it found them at two of them.
    let before: usize = measured.iter().map(|found| found.broken_before).sum();
    let after: usize = measured.iter().map(|found| found.broken_after).sum();
    let wrapped: usize = measured.iter().map(|found| found.wrapped).sum();
    let rejoined: usize = measured.iter().map(|found| found.rejoined).sum();
    println!(
        "over {} stations: broken pairs {before} -> {after}, {rejoined} of \
             {wrapped} folded gates back on their own branch",
        measured.len()
    );
    assert!(
        after * 4 < before * 3,
        "folding broke {before} pairs across {} stations and unfolding left \
             {after} of them",
        measured.len()
    );
    assert!(
        rejoined * 5 > wrapped,
        "only {rejoined} of {wrapped} folded gates came back to their own branch"
    );
}

/// The decoded-volume cache, which is invisible except in what it does not
/// do: the picture is identical either way, only slower without it.
#[test]
fn a_volume_is_decoded_once_however_many_ways_it_is_looked_at() {
    let _guard = decoded_cache_test();
    clear_cache();
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    let bytes = volume_bytes(b"KTLX", at);
    let before = decode_count();

    let first = sweep_from_volume("KTLX", "one", bytes.clone(), ask(0, "reflectivity"))
        .expect("the fixture volume draws");
    assert_eq!(decode_count(), before + 1, "the first look has to decode");

    // The same volume, asked about differently. Neither is a new volume.
    let same_tilt_other_product =
        sweep_from_volume("KTLX", "one", bytes.clone(), ask(0, "velocity"))
            .expect("the same volume draws a second product");
    let again = sweep_from_volume("KTLX", "one", bytes.clone(), ask(0, "reflectivity"))
        .expect("the same volume draws again");
    assert_eq!(
        decode_count(),
        before + 1,
        "changing product or asking again must not decode the volume a second time"
    );

    // Reuse is only worth anything if it is the same picture.
    assert_eq!(
        first.image, again.image,
        "the reused scan drew a different picture"
    );
    assert_ne!(
        first.image, same_tilt_other_product.image,
        "two products of one volume should not be the same picture"
    );
}

#[test]
fn a_different_volume_is_a_different_entry() {
    let _guard = decoded_cache_test();
    clear_cache();
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    let bytes = volume_bytes(b"KTLX", at);
    let before = decode_count();

    sweep_from_volume("KTLX", "one", bytes.clone(), ask(0, "reflectivity"))
        .expect("the first volume draws");
    sweep_from_volume("KTLX", "two", bytes.clone(), ask(0, "reflectivity"))
        .expect("the second volume draws");
    assert_eq!(
        decode_count(),
        before + 2,
        "a volume under a new key is a new volume and has to be decoded"
    );
    assert_eq!(decoded_len(), 2);
}

#[test]
fn the_oldest_decoded_volume_goes_first() {
    let _guard = decoded_cache_test();
    clear_cache();
    let at = Utc.with_ymd_and_hms(2026, 8, 30, 23, 40, 0).unwrap();
    let bytes = volume_bytes(b"KTLX", at);

    // One more than the cache holds, so the first one has to leave.
    for index in 0..=DECODED_CAPACITY {
        sweep_from_volume(
            "KTLX",
            &format!("volume-{index}"),
            bytes.clone(),
            ask(0, "reflectivity"),
        )
        .expect("each volume draws");
    }
    assert_eq!(
        decoded_len(),
        DECODED_CAPACITY,
        "the cache must not grow past what it says it holds"
    );

    // The oldest is gone, so asking for it again decodes it again. The
    // newest is still there, so asking for it does not.
    let before = decode_count();
    sweep_from_volume("KTLX", "volume-0", bytes.clone(), ask(0, "reflectivity"))
        .expect("the evicted volume draws again");
    assert_eq!(
        decode_count(),
        before + 1,
        "the oldest should have been evicted"
    );

    let held = decode_count();
    sweep_from_volume(
        "KTLX",
        &format!("volume-{DECODED_CAPACITY}"),
        bytes.clone(),
        ask(0, "reflectivity"),
    )
    .expect("the newest volume draws");
    assert_eq!(decode_count(), held, "the newest should still be held");
}

#[test]
fn a_message_type_this_build_has_never_heard_of_is_skipped() {
    // The National Weather Service is adding an hourly LTR message to the
    // Level II stream from about February 2027 (SCN26-54). A decoder that
    // treats an unfamiliar type as a broken file would stop showing radar
    // on the day it arrives, at every site, with no warning.
    //
    // The archive's own messages come first so this is a real stream
    // rather than one message on its own, and the unknown one is put in
    // the middle where it would actually appear.
    let payload = vec![0x5au8; 80];
    let mut stream = Vec::new();
    // A status message, which this decoder does understand.
    stream.extend_from_slice(&framed_message(2, &[0u8; 80]));
    // Then the one it does not.
    stream.extend_from_slice(&framed_message(34, &payload));
    stream.extend_from_slice(&framed_message(2, &[0u8; 80]));

    let messages = nexrad_decode::messages::decode_messages(&stream)
        .expect("an unfamiliar message must not fail the stream");
    assert_eq!(
        messages.len(),
        3,
        "the unknown message should be skipped, not swallow what follows it"
    );

    // And it is recognised as unknown rather than mistaken for something.
    let types: Vec<String> = messages
        .iter()
        .map(|message| format!("{:?}", message.header().message_type()))
        .collect();
    assert!(
        types[1].contains("Unknown"),
        "type 34 came back as {}",
        types[1]
    );
}

#[test]
fn every_type_number_the_stream_could_carry_is_survivable() {
    // Not only the one number the notice names. Whatever the message ends
    // up being called, and whatever else is added after it, an unfamiliar
    // number in that byte must not cost anybody their radar.
    for message_type in 0u8..=255 {
        let mut stream = framed_message(message_type, &[0u8; 60]);
        stream.extend_from_slice(&framed_message(2, &[0u8; 80]));
        // Some types are variable-length and will read the rest as their
        // own payload; what matters is that nothing panics and nothing
        // reports the stream as broken.
        let read = nexrad_decode::messages::decode_messages(&stream);
        assert!(
            read.is_ok(),
            "message type {message_type} made the whole stream unreadable"
        );
    }
}

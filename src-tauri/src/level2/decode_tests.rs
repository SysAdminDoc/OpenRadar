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
                 their own branch, {} invented, {} misplaced",
            found.broken_before,
            found.broken_after,
            found.rejoined,
            found.wrapped,
            found.invented,
            found.misplaced
        );
        match &found.rpg {
            Some(held) => println!(
                "{station}: {} of {} gates disagree with the office, {} after unfolding",
                held.before, held.comparable, held.after
            ),
            None => println!("{station}: the office published no velocity for that cut"),
        }
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
        // `misplaced` carries a bound rather than an equality, and the reason
        // is worth writing down because the obvious assertion is wrong.
        //
        // It counts gates that never wrapped and came back on a branch other
        // than the picture's own. That is the measure the reference-wind
        // defects of 2026-09-07 needed, since every other number here is blind
        // to a whole patch moving as one piece, and it is the only one that
        // can see a correctly reported cell snapped onto the fitted wind.
        //
        // It cannot be held to zero, and the reason is the root traversal
        // rather than the reference pass: a boundary vote that gets a patch
        // wrong puts every gate of it on a foreign branch, and that happens
        // often enough that 159,771 of these exist with no reference pass at
        // all. Measured over the same 42 station-days from the archive on
        // 2026-09-07: 159,771 with no reference pass, 178,265 with the pass as
        // it first shipped, 167,180 with the plausibility bar it has now. The
        // bar is what took the middle figure back down.
        //
        // What holds the defect down is `dealias`'s own unit tests, where a
        // correctly reported cell and a seam inside an unreached group are
        // built to order and the truth is known.
        //
        // What can be held is its share of the folds the sweep actually had,
        // which is the one form of it that scales with how much weather there
        // was. Recorded per station-day over 2026-09-01 to 2026-09-07 at
        // 21:00 UTC, the six stations' own worst days read 0.166, 0.633,
        // 0.835, 0.953, 1.263 and 1.285. Twice the folds is more than half
        // again the worst of those.
        //
        // What it catches, stated as narrowly as the evidence allows: a pass
        // that puts more than twice the sweep's own folds onto foreign
        // branches. A first draft of this comment said it "still fails a
        // boundary vote that scrambles the branches" and put a figure to it,
        // and the figure did not follow from its own arithmetic: on a sweep
        // with seventeen thousand folds the line sits at thirty-four
        // thousand, which the lower half of "tens of thousands" is under. No
        // mutation has been run against it either, because this test reads
        // live volumes off the archive and is `#[ignore]`d; what fails it is
        // a real run, not a planted one.
        //
        // The line is one-sided by construction, since a pass that did
        // nothing would score zero here, and that direction is caught by the
        // rejoined share across the stations instead.
        //
        // AUD-388 also asked that it fail when the wind's plausibility bar is
        // removed, and the measurement says no line does both. The same week
        // recorded with the bar taken out reads 1.329 at worst, so the window
        // where a line clears the week and fails without the bar is 1.285 to
        // 1.329: three and a half per cent wide, against single station-days
        // that move by as much as 0.122 when the bar comes out and a spread
        // between stations of 0.002 to 1.285. A line drawn in that window
        // fails on the weather rather than on the code. The bar is worth
        // keeping on its own evidence: over the 38 station-days both runs
        // measured it is better on 33 and worse on none, 152,398 misplaced
        // gates against 160,430. Bounding what the wind alone contributes
        // needs `misplaced` split into gates a boundary placed and gates the
        // wind placed, which is AUD-445.
        assert!(
            found.misplaced < found.wrapped * 2,
            "{} gates that never folded came back on a foreign branch, against {} that folded",
            found.misplaced,
            found.wrapped
        );
        // And it must never leave the picture more broken than it found it.
        assert!(
            found.broken_after <= found.broken_before,
            "unfolding took {} broken pairs to {}",
            found.broken_before,
            found.broken_after
        );
    }
    // And against the office's own dealiased velocity for the same volume,
    // which is the only reference in this test that did not come out of the
    // bytes being scored.
    //
    // What it can see and what it cannot, since both matter. It sees a whole
    // sweep or a large patch placed an interval away, which every other
    // measure here is blind to by construction. It cannot see a single cell
    // moved: a mesocyclone-scale couplet is on the order of a thousand gates
    // against two hundred thousand, which is under the per-station bar below.
    // That case is pinned exactly by
    // `the_office_s_reading_catches_a_correctly_reported_cell_that_was_moved`,
    // where the truth is built rather than fetched.
    let held: Vec<&HeldAgainstRpg> = measured.iter().filter_map(|f| f.rpg.as_ref()).collect();
    assert!(
        held.len() >= 3,
        "only {} of {} stations had an office reading to be held against,              which is the bucket rather than the weather",
        held.len(),
        measured.len()
    );
    for one in &held {
        // A sweep with almost nothing in common with the reference would pass
        // every share below on a handful of gates. Recorded over the 39
        // station-days of 42 that had a reference at all, the smallest
        // overlap was 78,422 gates.
        assert!(
            one.comparable > 20_000,
            "only {} gates could be compared with the office's own reading",
            one.comparable
        );
        // No station may disagree with the office wholesale. Recorded per
        // station-day over 2026-09-01 to 2026-09-07 at 21:00 UTC, the highest
        // was 0.0335 at KDMX on the 2nd and the rest sat between 0.0044 and
        // 0.0304. Three tenths is nearly ten times the worst of those and
        // still fails a station drawing something the office does not
        // recognise, which is the case an aggregate bar cannot see: one
        // station at thirty per cent still leaves the six together under a
        // bar written for all of them.
        assert!(
            one.after * 10 < one.comparable * 3,
            "{} of {} gates at one station are half a Nyquist velocity or more from the office's reading",
            one.after,
            one.comparable
        );
        // And unfolding must not walk the picture away from what the office
        // decided. Not a floor on the disagreement itself, which is two
        // products' own difference and belongs to the weather, but on how
        // much of it this app added. Worst over the same week was 0.002276 at
        // KTLX on the 4th and under 0.0008 everywhere else. Eight thousandths
        // is three and a half times that, and on a two hundred thousand gate
        // sweep it is sixteen hundred gates: a patch, not a rounding.
        let added = one.after.saturating_sub(one.before);
        assert!(
            added * 1000 <= one.comparable * 8,
            "unfolding moved {added} more gates away from the office's reading than it found there, of {} compared",
            one.comparable
        );
    }
    // And across the stations together, which is steadier than any one of
    // them, most of the picture has to agree with the office outright.
    //
    // Six stations on one day is what this test reads, and that aggregate
    // came to 0.0065, 0.0104, 0.0056, 0.0125, 0.0080, 0.0067 and 0.0044 on
    // the seven days the recorder walked. A twenty-fifth sits at more than
    // three times the worst of those and still fails an unfolding pass that
    // scrambles the sweep, which would disagree with the office over most of
    // it rather than over a hundredth. The control the recorder prints beside
    // it says why that hundredth is not zero: the same gates before this app
    // touches them read 0.0075 over the whole week, which is the two
    // products' own resolutions and the readings they genuinely differ on.
    let comparable: usize = held.iter().map(|one| one.comparable).sum();
    let disagreed: usize = held.iter().map(|one| one.after).sum();
    println!(
        "over {} stations with an office reading: {disagreed} of {comparable} gates disagree",
        held.len()
    );
    assert!(
        disagreed * 25 < comparable,
        "{disagreed} of {comparable} gates are half a Nyquist velocity or more from the office's reading"
    );

    // There is deliberately no per-station floor on how many of the folded
    // gates come back to the branch they started on. There was one, at a
    // twentieth, and `recording_the_days_unfolding_is_held_against` is what
    // took it out: over the 39 station-days it measured from 2026-09-01 to
    // 2026-09-07, five of them fell under that line, at four different
    // stations. KTLX read 3,648 of 13,254 on the 1st, 15 of 2,220 on the
    // 3rd and 41 of 16,528 on the 4th. KFWS read 130 of 5,661 on the 3rd,
    // KAMX 61 of 3,366 on the 4th, KTBW 429 of 13,984 on the 7th.
    //
    // The comment the assertion sat under had it right and the assertion
    // did not believe it: a patch with no boundary to anything outside
    // itself has nothing to place it, and how much of a sweep is isolated
    // like that is a property of the weather. A quantity that moves by two
    // orders of magnitude at one station between two days cannot carry a
    // fixed floor. The share is claimed across the stations together
    // below, where the record says it is steady.

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
    // Both lines below come from the days on record rather than from one
    // afternoon, which is the mistake the per-station floor made.
    //
    // Broken pairs left, as a share of the pairs folding broke, over the six
    // stations together, re-recorded on 2026-09-07 once the reference pass
    // gained its plausibility bar: 0.536, 0.555, 0.476, 0.646, 0.700, 0.554
    // and 0.681 on the seven days
    // `recording_the_days_unfolding_is_held_against` reads at 21:00 UTC. The
    // same seven days with no reference pass at all read 0.552, 0.586, 0.522,
    // 0.669, 0.702, 0.615 and 0.697, and with the pass but no bar 0.519,
    // 0.530, 0.410, 0.624, 0.675, 0.518 and 0.528. The middle column is what
    // ships: the bar gives up about two fifths of what the wind was buying
    // and buys back that none of the rest is invented. Seventeen twentieths
    // sits clear of all three and still fails a dealiaser that leaves the
    // picture roughly as it found it. It is deliberately not tightened to the
    // record: the gate reads whatever volumes the six stations happen to be
    // publishing, and a line drawn against the best week it has seen is a
    // line that fails on the weather rather than on the code.
    assert!(
        after * 20 < before * 17,
        "folding broke {before} pairs across {} stations and unfolding left \
             {after} of them",
        measured.len()
    );
    // Folded gates back on their own branch, over the stations together.
    //
    // Re-recorded on 2026-09-10 because a fifth was failing on current
    // weather: three runs that day read 0.213, 0.211 and 0.168. Nine distinct
    // days are on record now, the seven to 2026-09-07 at 0.433, 0.318, 0.316,
    // 0.432, 0.291, 0.462 and 0.332, and the two the fresh week added at
    // 0.171 on 2026-09-08 and 0.414 on 2026-09-09. The five days the two
    // recordings share read identically, which is what says the recorder is
    // measuring the archive rather than the machine.
    //
    // What makes 0.171 possible, and what the old floor had not seen, is that
    // this is a weighted mean: whichever station folds most that day sets it.
    // On 2026-09-08 KDMX folded 105,576 of the set's 175,782 gates and
    // rejoined 0.143 of them, and KGRR folded another 30,818 and rejoined
    // 0.016. Two stations having a bad day is enough to halve the number
    // however well the other four did, so a line drawn near the middle of the
    // record is a line that fails on the weather rather than on the code.
    //
    // A tenth sits under the worst recorded day by a factor of one and seven
    // tenths, and nothing that failed to unfold can reach it: a dealiaser
    // that did nothing would score zero here, because no gate it left folded
    // is back on its own branch.
    assert!(
        rejoined * 10 > wrapped,
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

/// The instrument the live contract above leans on, proved on a sweep whose
/// truth is known.
///
/// A live number is only worth as much as the measure that produced it, and
/// this measure is the only one in `level2/testing.rs` that reads a second
/// product. Everything it could get wrong is geometry: the wrong radial, the
/// wrong bin, the byte scale read backwards. All three fail the same way, by
/// reporting a disagreement that is really a misregistration, so the fixture
/// asserts a clean zero before it asserts the catch.
///
/// The sweep is probe C of `AUD-362`, built to order: an isolated inbound
/// cell at minus ten in a thirty metres a second outbound flow, against a
/// twenty-five limit. Both readings are legal, minus ten as it stands or plus
/// forty if it folded, and nothing inside the sweep says which. `dealias` has
/// its own test that the cell is left where the radar put it. This one is
/// about what happens when it is not: the three measures beside it are blind
/// to a patch moved as one piece, and the office's own answer is not.
#[test]
fn the_office_s_reading_catches_a_correctly_reported_cell_that_was_moved() {
    const NYQUIST: f32 = 25.0;
    // The scale a digital product carries in its description block. The live
    // path reads these off the file; the fixture picks a pair that covers the
    // readings in it, which the real product's own does too.
    const MINIMUM: f32 = -100.0;
    const INCREMENT: f32 = 1.0;
    const AZIMUTHS: usize = 360;
    const GATES: usize = 200;
    const CELL_RADIALS: std::ops::Range<usize> = 85..95;
    const CELL_GATES: std::ops::Range<usize> = 150..170;

    // The geometry the live path actually meets, and the whole reason this
    // fixture exists. A real cut puts the centre of its first gate at 2.125
    // km against a product whose bins start at zero and run a quarter of a
    // kilometre each, so gate `g` sits at eight and a half bins plus `g` and
    // the bin holding it is the eighth plus `g`. The first version of this
    // test lined the two grids up exactly, which made the floor and a
    // rounding return the same integer for every gate and hid a measure that
    // was comparing every reading against the bin 250 metres further out.
    let bin_km = 0.25;
    let first_bin = 0u16;
    let first_km = 2.125;
    // Which bin each gate falls in, and how many bins the reference needs to
    // cover the field.
    let bin_of = |gate: usize| ((first_km + gate as f64 * bin_km) / bin_km) as usize;
    let bins = bin_of(GATES - 1) + 1;

    let azimuths: Vec<f32> = (0..AZIMUTHS).map(|at| at as f32).collect();
    let mut field = SweepField::new_empty(
        "Velocity", "m/s", 0.5, azimuths, 1.0, first_km, bin_km, GATES,
    );
    for index in 0..AZIMUTHS {
        for gate in 0..GATES {
            field.set(index, gate, 30.0, GateStatus::Valid);
        }
    }
    for index in CELL_RADIALS {
        for gate in CELL_GATES {
            field.set(index, gate, -10.0, GateStatus::Valid);
        }
    }

    // The office's answer for the same cut, on its own grid: half-degree
    // radials over the whole circle, and bins from zero, reading what the
    // radar reported wherever a bin holds one of its gates and nothing where
    // none does.
    let mut reading = vec![None; bins];
    for gate in 0..GATES {
        reading[bin_of(gate)] = Some(gate);
    }
    let radials = (0..720)
        .map(|at| {
            let start_degrees = at as f32 * 0.5;
            let index = (start_degrees.round() as usize) % AZIMUTHS;
            level3::Radial {
                start_degrees,
                width_degrees: 0.5,
                gates: reading
                    .iter()
                    .map(|held| match held {
                        // Level zero is nothing above the threshold, which is
                        // what a bin with no gate of this cut in it holds.
                        None => 0u8,
                        Some(gate) => {
                            let (value, _) = field.get(index, *gate);
                            (((value - MINIMUM) / INCREMENT).round() as i32 + 2).clamp(2, 255) as u8
                        }
                    })
                    .collect(),
            }
        })
        .collect();
    let reference = level3::RadialImage {
        first_bin,
        bins: bins as u16,
        bin_km,
        radials,
    };

    // The control. A zero here is what says the radials, the bins and the
    // byte scale all line up, so a count below is the dealiasing and not the
    // plumbing.
    let agreed = disagreed_with_rpg(&field, &reference, MINIMUM, INCREMENT, NYQUIST);
    assert_eq!(
        agreed.comparable,
        AZIMUTHS * GATES,
        "the two grids did not cover each other"
    );
    assert_eq!(
        agreed.disagreed, 0,
        "{} gates disagreed on a sweep the office read exactly the same way",
        agreed.disagreed
    );

    // And the defect: the cell snapped a whole interval onto the flow around
    // it, which is a reading nothing measured. `broken_pairs` cancels over
    // it, it never wrapped so `wrapped` and `rejoined` never look at it, and
    // a whole interval is a whole interval so `invented` stays at zero.
    let mut moved = field.clone();
    let mut cell = 0usize;
    for index in CELL_RADIALS {
        for gate in CELL_GATES {
            let (value, status) = moved.get(index, gate);
            moved.set(index, gate, value + 2.0 * NYQUIST, status);
            cell += 1;
        }
    }
    let caught = disagreed_with_rpg(&moved, &reference, MINIMUM, INCREMENT, NYQUIST);
    assert_eq!(
        caught.comparable, agreed.comparable,
        "moving a reading changed how many gates could be compared"
    );
    assert_eq!(
        caught.disagreed, cell,
        "the measure caught {} of the {cell} gates that were moved",
        caught.disagreed
    );
}

/// Where the numbers in the contract above came from, and how to get them
/// again.
///
/// The contract asks each station for its latest volume, which is the sweep
/// a reader would be looking at and makes every run a sample of one
/// afternoon. Thresholds picked from one afternoon are how it ended up with
/// a per-station floor that five station-days of an ordinary week walk
/// straight through.
///
/// This reads the same measurement off the archive instead, so a week can
/// be recorded in an hour rather than waited out, and prints it as CSV.
/// Run it before touching any line in that test, and put what it prints in
/// the comments beside the line it justifies:
///
/// ```text
/// cargo test --lib recording_the_days -- --ignored --nocapture
/// ```
///
/// It is not a contract. It asserts nothing, it fetches 42 volumes, and
/// `scripts/live-contracts-lib.mjs` skips it by name for both reasons.
#[test]
#[ignore = "records a week off the archive; asserts nothing"]
fn recording_the_days_unfolding_is_held_against() {
    let _guard = decoded_cache_test();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");
    println!(
        "station,day,broken_before,broken_after,rejoined,wrapped,invented,misplaced,misplaced_share,rejoined_share,rpg_comparable,rpg_before,rpg_after,rpg_share"
    );
    // The seven days ending yesterday, rather than a week written into the
    // file. A recorder pinned to fixed dates records the same week however
    // many times it is run, which is the opposite of what re-recording a
    // floor against fresh weather is for; yesterday is the newest day the
    // archive certainly holds a whole day of.
    let last = Utc::now()
        .date_naive()
        .pred_opt()
        .expect("a day before today");
    for back in (0..7).rev() {
        let day = last - chrono::Duration::days(back);
        for station in ["KDMX", "KTLX", "KAMX", "KTBW", "KGRR", "KFWS"] {
            // Held one volume at a time: 42 decoded volumes at once is a
            // machine swapping rather than a measurement.
            clear_cache();
            let at = day.and_hms_opt(21, 0, 0).expect("a UTC time").and_utc();
            match measure_unfolding_at(&runtime, station, at) {
                Some(found) => println!(
                    "{station},{day},{},{},{},{},{},{},{:.4},{:.4},{}",
                    found.broken_before,
                    found.broken_after,
                    found.rejoined,
                    found.wrapped,
                    found.invented,
                    found.misplaced,
                    found.misplaced as f64 / found.wrapped.max(1) as f64,
                    found.rejoined as f64 / found.wrapped.max(1) as f64,
                    match &found.rpg {
                        Some(held) => format!(
                            "{},{},{},{:.4}",
                            held.comparable,
                            held.before,
                            held.after,
                            held.after as f64 / held.comparable.max(1) as f64
                        ),
                        None => "none,,,".to_string(),
                    },
                ),
                // A station with no Doppler cut worth measuring that day,
                // which the contract also passes over.
                None => println!("{station},{day},none,,,,,,,,,,,"),
            }
        }
    }
}

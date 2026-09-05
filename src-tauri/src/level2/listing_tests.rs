use chrono::TimeZone;

use super::*;
use crate::level2::testing::*;

#[test]
fn picks_the_newest_whole_volume_from_a_listing() {
    let listing = "<ListBucketResult>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_090749_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092159_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092900_V06_MDM</Key></Contents>\
            </ListBucketResult>";
    assert_eq!(
        newest_key(listing).as_deref(),
        Some("2026/08/30/KDMX/KDMX20260830_092159_V06")
    );
    assert_eq!(newest_key("<ListBucketResult></ListBucketResult>"), None);
}

#[test]
fn takes_the_last_few_whole_volumes_for_a_loop() {
    // Out of order on purpose: the bucket returns keys in order, and
    // depending on that rather than sorting is how a loop ends up playing
    // backwards the first time a listing is paginated.
    let listing = "<ListBucketResult>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092159_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_090749_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_091500_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092900_V06_MDM</Key></Contents>\
            </ListBucketResult>";

    let all = recent_times(listing, 10);
    assert_eq!(all.len(), 3, "the partial upload is not a volume");
    // Oldest first, which is the order a loop plays in.
    assert!(all[0] < all[1] && all[1] < all[2]);
    assert_eq!(all[2].format("%H%M%S").to_string(), "092159");

    // Asked for fewer, it keeps the NEWEST few rather than the first few:
    // a loop that dropped the last five minutes of a storm to keep the
    // first five would be the wrong half.
    let two = recent_times(listing, 2);
    assert_eq!(two.len(), 2);
    assert_eq!(two[1].format("%H%M%S").to_string(), "092159");
    assert_eq!(two[0].format("%H%M%S").to_string(), "091500");

    assert!(recent_times("<ListBucketResult></ListBucketResult>", 10).is_empty());
}

#[test]
fn a_loop_never_holds_the_same_volume_twice() {
    // Two days are read, and a day boundary can put the same object in
    // both listings. A duplicate would be a frame that shows the same
    // picture and a legend that repeats a time.
    let listing = "<ListBucketResult>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092159_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092159_V06</Key></Contents>\
            </ListBucketResult>";
    assert_eq!(recent_times(listing, 10).len(), 1);
}

#[test]
fn picks_the_whole_volume_nearest_the_requested_utc_time() {
    let listing = "<ListBucketResult>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_090749_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_092159_V06</Key></Contents>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_091800_V06_MDM</Key></Contents>\
            </ListBucketResult>";
    let wanted = Utc
        .with_ymd_and_hms(2026, 8, 30, 9, 18, 0)
        .single()
        .expect("a UTC time");
    assert_eq!(
        closest_key(listing, wanted).as_deref(),
        Some("2026/08/30/KDMX/KDMX20260830_092159_V06")
    );
    assert_eq!(
        closest_key("<ListBucketResult></ListBucketResult>", wanted),
        None
    );
}

#[test]
fn picks_the_closest_volume_across_a_utc_day_boundary() {
    let previous = "<ListBucketResult>\
            <Contents><Key>2026/08/30/KDMX/KDMX20260830_235900_V06</Key></Contents>\
            </ListBucketResult>";
    let current = "<ListBucketResult>\
            <Contents><Key>2026/08/31/KDMX/KDMX20260831_001000_V06</Key></Contents>\
            </ListBucketResult>";
    let next = "<ListBucketResult></ListBucketResult>";
    let wanted = Utc
        .with_ymd_and_hms(2026, 8, 31, 0, 1, 0)
        .single()
        .expect("a UTC time");

    assert_eq!(
        closest_key_across([previous, current, next], wanted).as_deref(),
        Some("2026/08/30/KDMX/KDMX20260830_235900_V06")
    );
}

#[test]
fn reads_the_collection_time_out_of_a_key() {
    let at = key_time("2026/08/30/KDMX/KDMX20260830_092159_V06").expect("a time");
    assert_eq!(at.to_rfc3339(), "2026-08-30T09:21:59+00:00");
    assert!(key_time("2026/08/30/KDMX/rubbish").is_none());
}

#[test]
#[ignore = "fetches a live volume from the NEXRAD archive"]
fn a_wind_profile_comes_from_the_office_when_the_office_published_one() {
    // The whole reason for reading NVW is that it is nearly always
    // there, and the only sign that it has stopped being there is that
    // every column quietly costs a whole volume again. So this asks for
    // a real volume by its real time and reads which of the two answered.
    let _guard = decoded_cache_test();
    clear_cache();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    // The newest volume's own time, which is what the panel hands in.
    let (key, _data) = runtime
        .block_on(latest_volume("KDMX"))
        .expect("KDMX publishes a volume every few minutes");
    let at = key_time(&key)
        .expect("an archive key carries the volume time")
        .to_rfc3339();

    let columns = runtime
        .block_on(level2_vwp("KDMX".into(), vec![at.clone()]))
        .expect("the profile answers for a volume that is on the archive");
    let column = columns.first().expect("one column was asked for");
    println!("{at}: {:?} from {}", column.source, column.volume);
    assert_eq!(
        column.source,
        vwp::VwpSource::Product,
        "the office published nothing for {at}, so the volume was fitted here"
    );
    assert!(
        column.levels.iter().any(|level| level.speed_ms.is_some()),
        "the published column had no wind on it at all"
    );
}

#[test]
fn a_listing_address_names_the_day_and_the_site() {
    let day = chrono::NaiveDate::from_ymd_opt(2026, 8, 30)
        .unwrap()
        .and_hms_opt(9, 0, 0)
        .unwrap()
        .and_utc();
    assert_eq!(
        listing_url("KDMX", day),
        "https://unidata-nexrad-level2.s3.amazonaws.com/?list-type=2&prefix=2026/08/30/KDMX/"
    );
}

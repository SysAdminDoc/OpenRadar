use super::*;
use crate::mrms::testing::*;

#[test]
fn reads_the_valid_time_out_of_a_key() {
    assert_eq!(
        key_time("CONUS/MESH_00.50/20260830/MRMS_MESH_00.50_20260830-094642.grib2.gz"),
        Some(1788083202)
    );
    assert_eq!(key_time("CONUS/MESH_00.50/20260830/index.html"), None);
}

#[test]
fn keeps_the_newest_frames_a_listing_offers_in_order() {
    let listing = "<ListBucketResult>\
        <Contents><Key>CONUS/MESH_00.50/20260830/MRMS_MESH_00.50_20260830-094642.grib2.gz</Key></Contents>\
        <Contents><Key>CONUS/MESH_00.50/20260830/MRMS_MESH_00.50_20260830-094442.grib2.gz</Key></Contents>\
        <Contents><Key>CONUS/MESH_00.50/20260830/MRMS_MESH_00.50_20260830-094242.grib2.gz</Key></Contents>\
        <Contents><Key>CONUS/MESH_00.50/20260830/nonsense</Key></Contents>\
        </ListBucketResult>";
    let frames = frames_from_listing(listing, 2);
    assert_eq!(frames.len(), 2);
    assert!(frames[0].time < frames[1].time);
    assert!(frames[1].key.ends_with("094642.grib2.gz"));
}

#[test]
fn a_moment_names_the_object_it_was_published_in() {
    let entry = product_by_id("composite").expect("the composite product");
    assert_eq!(
        key_for("CONUS", entry, None, 1788083202).as_deref(),
        Some(
            "CONUS/MergedReflectivityQCComposite_00.50/20260830/MRMS_MergedReflectivityQCComposite_00.50_20260830-094642.grib2.gz"
        )
    );
}

#[test]
#[ignore = "asks the live MRMS bucket for every region"]
fn every_region_the_network_publishes_decodes_and_draws() {
    // Held, so two live tests do not wipe each other's cache. Under
    // `-- --ignored` these run together, and one clearing the cache while
    // another was reading it turned a real answer into a re-fetch or an
    // empty one, which reads as a service that failed rather than as a
    // test that raced.
    let _guard = live_test();
    // Four of these were unreachable until now: the map fell through the
    // whole chain to a personal-use tier for anybody in Alaska, Hawaii,
    // Guam or Puerto Rico. Each grid is its own projection at its own
    // resolution, so the only way to know the decoder reads them is to
    // read them.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");
    let entry = product_by_id("composite").expect("composite");

    for domain in DOMAINS {
        let frames = runtime
            .block_on(mrms_frames(
                "composite".into(),
                1,
                Some((*domain).into()),
                None,
            ))
            .unwrap_or_else(|failure| panic!("{domain}: {failure}"));
        let newest = frames
            .last()
            .unwrap_or_else(|| panic!("{domain}: no frames"));

        let key =
            key_for(domain, entry, None, newest.time).unwrap_or_else(|| panic!("{domain}: no key"));
        assert!(key.starts_with(domain), "{key} is not in {domain}");

        runtime
            .block_on(grid_for(&key, false))
            .unwrap_or_else(|failure| panic!("{domain}: {failure}"));

        // The geometry comes out of the file, so this is the file saying
        // where it is rather than anything written down here.
        let (west, north, south, east, columns, rows) = {
            let cache = CACHE.lock().expect("the cache");
            let held = cache
                .iter()
                .find(|held| held.key == key)
                .unwrap_or_else(|| panic!("{domain}: nothing decoded"));
            let grid = &held.grid;
            (
                grid.west,
                grid.north,
                grid.north - grid.d_lat * grid.rows as f64,
                grid.west + grid.d_lon * grid.columns as f64,
                grid.columns,
                grid.rows,
            )
        };
        assert!(columns > 100 && rows > 100, "{domain} is tiny");
        assert!((-180.0..=180.0).contains(&west), "{domain} west");
        assert!((-90.0..=90.0).contains(&south), "{domain} south");
        println!(
            "{domain}: {west:.2} to {east:.2} east, {south:.2} to {north:.2} north, {columns}x{rows}"
        );
    }
}

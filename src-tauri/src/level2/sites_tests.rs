use super::*;

#[test]
fn the_nearest_site_is_the_one_a_viewer_is_standing_over() {
    assert_eq!(
        sites_in_reach(35.4676, -97.5164)
            .first()
            .map(|site| site.id),
        Some("KTLX")
    );
    assert_eq!(
        sites_in_reach(41.73, -93.72).first().map(|site| site.id),
        Some("KDMX")
    );
    // Puerto Rico and Hawaii have their own sites and are not the mainland.
    assert_eq!(
        sites_in_reach(18.4, -66.1).first().map(|site| site.id),
        Some("TJUA")
    );
}

#[test]
fn a_place_no_site_can_see_gets_no_site() {
    // Mid-Atlantic, the middle of the Pacific, and central Europe.
    for (latitude, longitude) in [(30.0, -45.0), (10.0, -150.0), (48.9, 2.4)] {
        assert!(
            sites_in_reach(latitude, longitude).is_empty(),
            "{latitude},{longitude} is not in anyone's coverage"
        );
    }
}

#[test]
fn the_command_offers_nothing_outside_every_site_s_coverage() {
    // The command itself, not the helper underneath it: a point no site can
    // see must get no answer rather than the least distant one, or the map
    // draws Alaska's radar over the mid-Atlantic. It answers without
    // touching the network, because there is nothing to ask about.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");
    for (latitude, longitude) in [(30.0, -45.0), (10.0, -150.0), (48.9, 2.4)] {
        assert_eq!(
            runtime.block_on(level2_nearest_site(latitude, longitude)),
            None,
            "{latitude},{longitude} is not in anyone's coverage"
        );
    }
}

#[test]
fn sites_in_reach_come_back_nearest_first() {
    let near_oklahoma_city = sites_in_reach(35.4676, -97.5164);
    assert!(
        near_oklahoma_city.len() > 1,
        "central Oklahoma is covered by more than one site"
    );
    let distances: Vec<f64> = near_oklahoma_city
        .iter()
        .map(|site| {
            great_circle_km(
                35.4676,
                -97.5164,
                site.latitude as f64,
                site.longitude as f64,
            )
        })
        .collect();
    for pair in distances.windows(2) {
        assert!(pair[0] <= pair[1], "{distances:?} is not sorted");
    }
}

#[test]
fn the_sites_in_reach_come_back_nearest_first_with_their_distances() {
    // The picker had no list of these at all, so during an outage there
    // was no way to choose the second-nearest radar without knowing its
    // call sign. The order is the point: the nearest one sees lowest into
    // the storm, and picking a further one is a trade somebody makes on
    // purpose.
    let over_oklahoma_city = level2_sites_in_reach(35.4676, -97.5164);
    assert!(over_oklahoma_city.len() > 1);
    for pair in over_oklahoma_city.windows(2) {
        assert!(
            pair[0].distance_km <= pair[1].distance_km,
            "{} then {} is not nearest first",
            pair[0].distance_km,
            pair[1].distance_km
        );
    }
    let nearest = &over_oklahoma_city[0];
    assert_eq!(nearest.station, "KTLX");
    assert!(!nearest.city.is_empty());
    assert_eq!(nearest.state.len(), 2);
    // The figures themselves, because the ordering comes from
    // `sites_in_reach` and would hold with every distance reported as
    // zero, or with the latitude and longitude handed over the wrong way
    // round: that swap reports Vance at 71 km when it is 152, and the
    // picker would tell somebody a radar is half as far away as it is.
    let miles_from_the_city = |station: &str| {
        over_oklahoma_city
            .iter()
            .find(|site| site.station == station)
            .map(|site| site.distance_km)
            .unwrap_or_else(|| panic!("{station} is not in reach"))
    };
    assert!(
        (miles_from_the_city("KTLX") - 25.9).abs() < 2.0,
        "KTLX is {} km away",
        miles_from_the_city("KTLX")
    );
    assert!(
        (miles_from_the_city("KVNX") - 152.0).abs() < 5.0,
        "KVNX is {} km away",
        miles_from_the_city("KVNX")
    );

    // And nothing at all where no radar reaches, rather than the least
    // distant one, which would put Alaska's radar over the mid-Atlantic.
    assert!(level2_sites_in_reach(30.0, -40.0).is_empty());
}

#[test]
fn a_site_the_office_says_is_down_is_asked_last_and_never_dropped() {
    // The archive can only report an upload that failed to arrive, which
    // is minutes after the radar stopped and says nothing about why. The
    // office says so directly, and one request for the whole country is
    // cheaper than a listing per site.
    let sites = sites_in_reach(35.4676, -97.5164);
    let nearest = sites[0].id.to_string();
    let faulty = BTreeSet::from([nearest.clone()]);
    let asking = sites_worth_asking(&sites, &faulty);
    assert_eq!(asking.last().map(|site| site.id), Some(nearest.as_str()));

    // Every site is still reachable. The feed is a second opinion about
    // somebody else's equipment: a site wrongly marked down must not
    // become one this app refuses to draw while its volumes are landing
    // in the bucket every five minutes.
    assert_eq!(asking.len(), sites.len());

    // Nobody down changes nothing, including the order.
    let untouched = sites_worth_asking(&sites, &BTreeSet::new());
    assert_eq!(
        untouched.iter().map(|site| site.id).collect::<Vec<_>>(),
        sites.iter().map(|site| site.id).collect::<Vec<_>>()
    );

    // Every one of them down is still an answer about this viewport, in
    // the order distance gave.
    let all: BTreeSet<String> = sites.iter().map(|site| site.id.to_string()).collect();
    assert_eq!(
        sites_worth_asking(&sites, &all)
            .iter()
            .map(|site| site.id)
            .collect::<Vec<_>>(),
        sites.iter().map(|site| site.id).collect::<Vec<_>>()
    );
}

#[test]
fn a_site_that_stopped_publishing_is_passed_over() {
    let now = "2026-08-30T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
    let sites = sites_in_reach(35.4676, -97.5164);
    let nearest = sites[0].id;
    let next = sites[1].id;

    // The nearest site went down an hour ago; the next one is current.
    let chosen = first_site_with_a_volume(
        &sites,
        |id| {
            if id == nearest {
                Some(now - Duration::hours(1))
            } else {
                Some(now - Duration::minutes(3))
            }
        },
        now,
    );
    assert_eq!(chosen.map(|site| site.id), Some(next));

    // With the nearest one publishing again it takes the view straight back.
    let chosen = first_site_with_a_volume(&sites, |_| Some(now - Duration::minutes(3)), now);
    assert_eq!(chosen.map(|site| site.id), Some(nearest));

    // A site the archive holds nothing for is skipped the same way.
    let chosen = first_site_with_a_volume(
        &sites,
        |id| (id != nearest).then(|| now - Duration::minutes(3)),
        now,
    );
    assert_eq!(chosen.map(|site| site.id), Some(next));
}

#[test]
fn a_region_that_is_entirely_quiet_still_names_the_nearest_site() {
    // Otherwise the viewport looks like it is outside coverage, and the
    // panel says nothing at all rather than reporting the site's failure.
    let now = "2026-08-30T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
    let sites = sites_in_reach(35.4676, -97.5164);
    let chosen = first_site_with_a_volume(&sites, |_| None, now);
    assert_eq!(chosen.map(|site| site.id), Some(sites[0].id));
}

#[test]
fn only_a_recent_volume_counts_as_current() {
    let now = "2026-08-30T12:00:00Z".parse::<DateTime<Utc>>().unwrap();
    assert!(volume_is_current(Some(now - Duration::minutes(4)), now));
    assert!(volume_is_current(Some(now - Duration::minutes(19)), now));
    assert!(!volume_is_current(Some(now - Duration::minutes(21)), now));
    assert!(!volume_is_current(None, now));
    // A volume stamped slightly ahead of this machine's clock is a skewed
    // clock, not a stale site.
    assert!(volume_is_current(Some(now + Duration::minutes(2)), now));
    assert!(!volume_is_current(Some(now + Duration::hours(3)), now));
}

#[test]
fn distance_is_measured_around_the_earth_not_across_the_grid() {
    // Des Moines to Oklahoma City, about 700 km.
    let far = great_circle_km(41.73, -93.72, 35.47, -97.52);
    assert!((far - 745.0).abs() < 40.0, "got {far} km");
    assert_eq!(great_circle_km(41.73, -93.72, 41.73, -93.72), 0.0);
}

/// The one test that talks to NOAA. It is ignored by default so the normal
/// gate stays offline, and run with
/// `cargo test --lib -- --ignored level2` when the pipeline changes.
#[test]
#[ignore = "asks the live NEXRAD archive which sites are publishing"]
fn the_site_chosen_for_a_live_view_has_something_to_draw() {
    // The whole point of choosing by the archive rather than by distance
    // alone: whatever comes back has to have a volume recent enough to
    // render, or the handover shows an error where radar should be.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    // Des Moines, which several sites can see.
    let chosen = runtime
        .block_on(level2_nearest_site(41.73, -93.72))
        .expect("central Iowa is inside NEXRAD coverage");
    let sites = sites_in_reach(41.73, -93.72);
    assert!(
        sites.iter().any(|site| site.id == chosen),
        "{chosen} is not one of the sites that can see the point"
    );

    let newest = runtime.block_on(newest_volume_time(&chosen));
    assert!(
        volume_is_current(newest, Utc::now()),
        "{chosen} was chosen but its newest volume is {newest:?}"
    );
}

#[test]
fn every_site_in_reach_can_actually_see_the_point() {
    // The sweep is drawn to the site's own surveillance range. A site
    // further off than that would be handed a view its picture does not
    // reach, and the viewer would zoom in on a hole in the middle of it.
    for (latitude, longitude) in [
        (35.4676, -97.5164),
        (41.73, -93.72),
        (43.5, -123.5),
        (18.4, -66.1),
    ] {
        for site in sites_in_reach(latitude, longitude) {
            let distance = great_circle_km(
                latitude as f64,
                longitude as f64,
                site.latitude as f64,
                site.longitude as f64,
            );
            assert!(
                    distance <= MAX_RANGE_KM,
                    "{} is {distance:.0} km from {latitude},{longitude}, past the {MAX_RANGE_KM} km its sweep is drawn to",
                    site.id
                );
        }
    }
}

//! Which radars exist, where they stand, and what to call them.
//!
//! This is the app's own table rather than the one compiled into
//! `nexrad-model`, and the reason is that radars move. That crate's registry
//! is fixed at whatever the office's list said when the crate was released,
//! and on 2026-09-07 the pinned release was five months old: it still carried
//! KLIX at New Orleans, decommissioned, answering 404 from the office with
//! nothing on the archive bucket, and it did not carry KHDC at Hammond, which
//! replaced it and was publishing volumes that day. A reader near New Orleans
//! was offered a radar that no longer exists and never offered the one that
//! does. Eureka, Dover, Langley Hill and Fairbanks had no single-site view at
//! all. State College appeared twice, so the picker listed it twice. And
//! Pittsburgh's entry sat seventeen kilometres east of the radar, which moves
//! every distance the picker sorts by.
//!
//! A table that says which radars exist is a feed with a very long refresh
//! interval, not a fact. `registry_table.rs` is generated from the office's
//! own list by `scripts/build-radar-sites.mjs`, and
//! `the_radar_table_matches_the_office_list` holds it there: the moment a
//! radar is commissioned, decommissioned or moved, that contract fails and
//! the fix is to run the script.

use super::registry_table::SITES;

/// One radar: where it is, and what a reader should see it called.
#[derive(Debug, Clone, PartialEq)]
pub struct SiteEntry {
    /// Four-letter identifier, which is also its prefix on the archive bucket.
    pub id: &'static str,
    /// The place it is named for, as the office names it.
    pub city: &'static str,
    /// Two-letter state or territory, empty for the sites outside the states.
    pub state: &'static str,
    pub latitude: f32,
    pub longitude: f32,
    pub elevation_meters: i16,
}

impl SiteEntry {
    /// What the site is called on screen.
    ///
    /// The three sites the office lists outside the states, Kunsan, Camp
    /// Humphreys and Kadena, have no state to name, and "Kadena AB, " with a
    /// comma and nothing after it is worse than the name on its own.
    pub fn label(&self) -> String {
        if self.state.is_empty() {
            return self.city.to_string();
        }
        format!("{}, {}", self.city, self.state)
    }

    /// The site as the decoders want it, which is a fixed-width identifier and
    /// a position.
    pub fn to_site(&self) -> nexrad_model::meta::Site {
        let mut id = [0u8; 4];
        let bytes = self.id.as_bytes();
        let len = bytes.len().min(4);
        id[..len].copy_from_slice(&bytes[..len]);
        nexrad_model::meta::Site::new(id, self.latitude, self.longitude, self.elevation_meters, 0)
    }
}

/// Every radar the office lists.
pub fn sites() -> &'static [SiteEntry] {
    &SITES
}

/// One radar by its identifier, however it was typed.
pub fn site_by_id(id: &str) -> Option<&'static SiteEntry> {
    let wanted = id.to_uppercase();
    SITES.iter().find(|site| site.id == wanted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn every_radar_appears_once() {
        // State College was in the crate's table twice, so the picker offered
        // it twice and the nearest-first sort had two rows to break a tie
        // between.
        let mut seen = BTreeSet::new();
        for site in sites() {
            assert!(seen.insert(site.id), "{} is listed twice", site.id);
        }
        assert_eq!(seen.len(), sites().len());
    }

    #[test]
    fn the_radars_the_crate_had_wrong_are_right_here() {
        // Each of these is a defect the pinned `nexrad-model` registry had on
        // 2026-09-07, checked against `api.weather.gov/radar/stations` the
        // same day. They are pinned by hand as well as by the live contract,
        // because the contract needs the network and this does not.
        assert!(
            site_by_id("KLIX").is_none(),
            "New Orleans was decommissioned and the office no longer lists it"
        );
        let hammond = site_by_id("KHDC").expect("Hammond replaced it");
        assert_eq!(hammond.label(), "Hammond, LA");
        for id in ["KBHX", "KDOX", "KLGX", "PAPD"] {
            assert!(site_by_id(id).is_some(), "{id} is missing");
        }
        for alias in ["KABC", "KACG", "KAIH", "KAKC"] {
            assert!(
                site_by_id(alias).is_none(),
                "{alias} is an obsolete Alaska alias"
            );
        }
        let pittsburgh = site_by_id("KPBZ").expect("Pittsburgh");
        assert!(
            (pittsburgh.longitude - -80.2179).abs() < 0.001,
            "Pittsburgh is at {}, which is where the crate had it rather than \
             where the radar is",
            pittsburgh.longitude
        );
    }

    #[test]
    fn a_site_outside_the_states_is_named_without_a_dangling_comma() {
        let kadena = site_by_id("RODN").expect("Kadena is on the office's list");
        assert_eq!(kadena.state, "");
        assert_eq!(kadena.label(), "Kadena AB");
    }

    #[test]
    fn an_identifier_is_read_however_it_is_typed() {
        assert_eq!(site_by_id("ktlx").map(|site| site.id), Some("KTLX"));
        assert_eq!(site_by_id("KTLX").map(|site| site.id), Some("KTLX"));
        assert!(site_by_id("KXXX").is_none());
    }

    /// How far a site may sit from where the office puts it before the table
    /// is wrong rather than rounded.
    ///
    /// The table is written to four decimal places, so a hundredth of a degree
    /// is a hundred times the rounding and about a kilometre on the ground.
    /// Pittsburgh, the error this whole module was written for, was out by
    /// two tenths.
    const DRIFT_DEGREES: f32 = 0.01;

    #[test]
    #[ignore = "asks the National Weather Service which radars exist"]
    fn the_radar_table_matches_the_office_list() {
        // The point of the whole module. A committed table of radars is a feed
        // with a very long refresh interval, and the only thing that keeps it
        // honest is asking the office. When this fails, the fix is to run
        // `node scripts/build-radar-sites.mjs` and commit what it writes.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let body = runtime
            .block_on(crate::http::get_bytes_uncached(
                "https://api.weather.gov/radar/stations?stationType=WSR-88D",
            ))
            .expect("the office answers with its radar list");
        let listing: serde_json::Value =
            serde_json::from_slice(&body).expect("the answer is GeoJSON");
        let features = listing["features"]
            .as_array()
            .expect("a GeoJSON feature collection");
        assert!(
            features.len() > 100,
            "only {} radars came back, which is the service rather than the \
             network being decommissioned",
            features.len()
        );

        let mut theirs: BTreeSet<String> = BTreeSet::new();
        let mut adrift = Vec::new();
        for feature in features {
            let id = feature["properties"]["id"]
                .as_str()
                .expect("a station identifier")
                .to_string();
            let position = feature["geometry"]["coordinates"]
                .as_array()
                .expect("a position");
            let longitude = position[0].as_f64().expect("a longitude") as f32;
            let latitude = position[1].as_f64().expect("a latitude") as f32;
            if let Some(mine) = site_by_id(&id) {
                if (mine.latitude - latitude).abs() > DRIFT_DEGREES
                    || (mine.longitude - longitude).abs() > DRIFT_DEGREES
                {
                    adrift.push(format!(
                        "{id} is at {},{} here and {latitude},{longitude} there",
                        mine.latitude, mine.longitude
                    ));
                }
            }
            theirs.insert(id);
        }

        let mine: BTreeSet<String> = sites().iter().map(|site| site.id.to_string()).collect();
        let gone: Vec<&String> = mine.difference(&theirs).collect();
        let added: Vec<&String> = theirs.difference(&mine).collect();
        assert!(
            gone.is_empty() && added.is_empty() && adrift.is_empty(),
            "the radar table and the office disagree. Run \
             `node scripts/build-radar-sites.mjs`.\n  \
             listed here and not by the office: {gone:?}\n  \
             listed by the office and not here: {added:?}\n  \
             moved: {adrift:?}"
        );
    }

    #[test]
    fn every_radar_has_a_position_worth_sorting_by() {
        for site in sites() {
            assert!(
                site.latitude.abs() <= 90.0 && site.longitude.abs() <= 180.0,
                "{} is at {}, {}",
                site.id,
                site.latitude,
                site.longitude
            );
            assert!(
                site.latitude != 0.0 || site.longitude != 0.0,
                "{} is at the origin, which is the sea off Africa",
                site.id
            );
            assert_eq!(site.id.len(), 4, "{} is not an identifier", site.id);
        }
    }
}

//! Whether a radar is actually running, from the office that runs it.
//!
//! The site picker used to decide this by watching the archive: if no new
//! volume object had appeared for twenty minutes the site was passed over.
//! That works, and it is late and mute. Late because a listing only says
//! something once an upload has failed to arrive, which is minutes after the
//! radar stopped; mute because a bucket cannot say whether the radar is in
//! maintenance, restarting after a power cut, or simply not sending.
//!
//! The NWS publishes the RDA's own status for every site, along with the
//! moment Level II was last received from it. On the day this was written that
//! feed had KGLD in Start-Up with no Level II since 24 August, KTLH restarting
//! with three hours of silence, and TSDF quiet for twenty days, none of which
//! the archive walk could have explained.
//!
//! It is one request for the whole country, cached for two minutes, and it is
//! only ever asked for while somebody is looking at a single site.

use std::collections::BTreeSet;
use std::sync::Mutex;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use crate::http;

const STATIONS_URL: &str = "https://api.weather.gov/radar/stations";

/// How long a status answer stands before it is asked for again.
///
/// The service publishes with `max-age=120`, so asking more often than this
/// returns the same bytes. It is also the promise the panel makes: a reader
/// watching a site sees the status refreshed at most every two minutes.
const STATUS_TTL_SECONDS: i64 = 120;

/// How long Level II may be missing before a site is not worth drawing.
///
/// A radar finishes a volume every four to six minutes, so fifteen is three
/// missed volumes: long enough that an ordinary gap between scans, a slow
/// upload or a minute of clock skew cannot trip it, short enough that a site
/// which stopped an hour ago is never offered as the nearest one.
const STALE_AFTER_MINUTES: i64 = 15;

#[derive(Debug, thiserror::Error)]
pub enum RadarStatusError {
    #[error("the radar station list could not be read")]
    BadFeed,
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Serialize for RadarStatusError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// Why a site is not worth drawing.
///
/// A code rather than a sentence: the reason is shown in the reader's own
/// language, and the words for it belong with the rest of the copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SiteFault {
    /// The RDA says it is doing something other than operating.
    NotOperating,
    /// Nothing has been received from it for longer than a few volumes.
    NoRecentData,
}

/// What the office says about one radar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteStatus {
    pub station: String,
    /// The RDA's own word for what it is doing, when the feed carries one.
    ///
    /// Absent for the wind profilers and for the odd site whose RDA block the
    /// feed omits. Absent is not a fault: it means the office did not say.
    pub status: Option<String>,
    /// When Level II was last received, as RFC 3339.
    pub level_two_at: Option<String>,
    /// Why this site is not worth drawing, or nothing when it is fine.
    pub fault: Option<SiteFault>,
}

/// One station as the feed publishes it, before any judgement about it.
#[derive(Debug, Clone, PartialEq)]
struct StationRecord {
    station: String,
    status: Option<String>,
    /// What kind of radar it is, as the feed says.
    ///
    /// Only a WSR-88D publishes Level II. The airports' terminal radars sit in
    /// the same list with a Level II time beside them, and this app draws them
    /// from Level III products instead, so judging one by a feed it does not
    /// read is judging it by the wrong thing entirely.
    kind: Option<String>,
    level_two_at: Option<DateTime<Utc>>,
}

impl StationRecord {
    fn publishes_level_two(&self) -> bool {
        // Missing means the feed did not say. The only other kinds it carries
        // are the terminal radars and the wind profilers, and this app reads
        // Level II from neither.
        self.kind.as_deref() == Some("WSR-88D")
    }
}

/// The last answer and when it was given. An empty list is a failed ask,
/// remembered so a run of them cannot become a run of thirty-second waits.
static STATIONS: Mutex<Option<(DateTime<Utc>, Vec<StationRecord>)>> = Mutex::new(None);

/// How long a failed ask stands before it is worth trying again.
///
/// Short, because the usual cause is a minute of no network. Long enough that
/// panning across a region cannot queue one blocked request per site.
const FAILURE_TTL_SECONDS: i64 = 30;

/// Whether an answer this old is still worth standing on.
fn still_fresh(asked: DateTime<Utc>, records: &[StationRecord], now: DateTime<Utc>) -> bool {
    let ttl = if records.is_empty() {
        FAILURE_TTL_SECONDS
    } else {
        STATUS_TTL_SECONDS
    };
    now.signed_duration_since(asked) < Duration::seconds(ttl)
}

/// Whether a site is worth drawing, and why not when it is not.
///
/// Both halves are needed. A radar can be reporting itself operational while
/// nothing has arrived from it for a day, and one restarting after a power cut
/// can have a Level II time from a minute ago; either on its own would let a
/// site through that has nothing to show.
fn fault_of(record: &StationRecord, now: DateTime<Utc>) -> Option<SiteFault> {
    if let Some(word) = record.status.as_deref() {
        if !word.eq_ignore_ascii_case("operate") {
            return Some(SiteFault::NotOperating);
        }
    }
    // Only for a radar this app reads Level II from. TSDF had been quiet for
    // twenty days on the afternoon this was written while its Level III
    // products kept arriving every minute; calling it down would have taken a
    // working picture off the map for a feed the app never asks that site for.
    if !record.publishes_level_two() {
        return None;
    }
    if let Some(at) = record.level_two_at {
        // A time from the future is a clock disagreement rather than a dead
        // radar, and it falls out of this on its own: a negative age is not
        // greater than fifteen minutes. The machine at risk is the one whose
        // clock runs AHEAD of the office's, and nothing on this side can tell
        // that apart from a radar that has genuinely stopped.
        if now.signed_duration_since(at) > Duration::minutes(STALE_AFTER_MINUTES) {
            return Some(SiteFault::NoRecentData);
        }
    }
    None
}

/// Reads the station list, keeping only the four things this app asks of it.
///
/// Anything the feed leaves out stays missing rather than becoming a default:
/// a site with no RDA block has not been reported broken, it has not been
/// reported at all, and the two must not read the same.
fn read_stations(body: &[u8]) -> Result<Vec<StationRecord>, RadarStatusError> {
    let parsed: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| RadarStatusError::BadFeed)?;
    let features = parsed
        .get("features")
        .and_then(|value| value.as_array())
        .ok_or(RadarStatusError::BadFeed)?;

    let mut found = Vec::with_capacity(features.len());
    for feature in features {
        let properties = match feature.get("properties") {
            Some(value) => value,
            None => continue,
        };
        let Some(station) = properties.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        let rda = properties
            .get("rda")
            .and_then(|value| value.get("properties"));
        let text = |parent: Option<&serde_json::Value>, key: &str| {
            parent
                .and_then(|value| value.get(key))
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .filter(|value| !value.trim().is_empty())
        };
        found.push(StationRecord {
            station: station.to_string(),
            status: text(rda, "status"),
            kind: text(Some(properties), "stationType"),
            // The feed stamps these with an offset rather than a Z, which is
            // why this parses rather than trusting the shape of the string.
            level_two_at: text(properties.get("latency"), "levelTwoLastReceivedTime")
                .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
                .map(|value| value.with_timezone(&Utc)),
        });
    }

    if found.is_empty() {
        return Err(RadarStatusError::BadFeed);
    }
    Ok(found)
}

/// The station list, from the last answer when it is still fresh.
async fn stations() -> Result<Vec<StationRecord>, RadarStatusError> {
    let now = Utc::now();
    if let Ok(held) = STATIONS.lock() {
        if let Some((asked, records)) = held.as_ref() {
            if still_fresh(*asked, records, now) {
                if records.is_empty() {
                    return Err(RadarStatusError::BadFeed);
                }
                return Ok(records.clone());
            }
        }
    }

    // Uncached deliberately. Every other native fetch may be served from disk
    // during an outage, which is right for a picture and wrong for a statement
    // about whether a radar is running now.
    let asked = async {
        let body = http::get_bytes_uncached(STATIONS_URL).await?;
        read_stations(&body)
    }
    .await;
    if let Ok(mut held) = STATIONS.lock() {
        // A failure is remembered too, as an empty list. Without that, a
        // machine that cannot reach the service asked again on every call and
        // waited out the thirty second timeout every time.
        *held = Some((now, asked.as_ref().cloned().unwrap_or_default()));
    }
    asked
}

/// The faulty sites from the last answer, without asking for a new one.
///
/// For callers on a path somebody is waiting on. Site resolution runs on every
/// tenth of a degree the map moves, and putting a network fetch in front of it
/// meant a machine that could reach the radar archive but not this service
/// waited out a thirty second timeout before every lookup. The panel's own
/// poll is what keeps this warm; a cold one simply knows nothing yet, which is
/// exactly how the picker behaved before the feed existed.
pub fn faulty_stations_known() -> BTreeSet<String> {
    let now = Utc::now();
    let Ok(held) = STATIONS.lock() else {
        return BTreeSet::new();
    };
    let Some((asked, records)) = held.as_ref() else {
        return BTreeSet::new();
    };
    if !still_fresh(*asked, records, now) {
        return BTreeSet::new();
    }
    records
        .iter()
        .filter(|record| fault_of(record, now).is_some())
        .map(|record| record.station.clone())
        .collect()
}

/// What the office says about every radar, for the picker and the legend.
#[tauri::command]
pub async fn radar_status() -> Result<Vec<SiteStatus>, RadarStatusError> {
    let records = stations().await?;
    let now = Utc::now();
    Ok(records
        .iter()
        .map(|record| SiteStatus {
            station: record.station.clone(),
            status: record.status.clone(),
            level_two_at: record.level_two_at.map(|at| at.to_rfc3339()),
            fault: fault_of(record, now),
        })
        .collect())
}

/// The terminal radars from the last answer, without asking for a new one.
///
/// The same shape as `faulty_stations_known` and for the same reason, which
/// this module learned once already: a fetch in front of something a reader
/// is waiting on means a machine that can reach the radar archive but not
/// this service waits out a thirty second timeout first. The picker's own
/// poll is what keeps this warm, and a cold one knows nothing, which is the
/// answer that changes nothing.
pub fn terminal_stations_known() -> Vec<String> {
    let now = Utc::now();
    let Ok(held) = STATIONS.lock() else {
        return Vec::new();
    };
    let Some((asked, records)) = held.as_ref() else {
        return Vec::new();
    };
    if !still_fresh(*asked, records, now) {
        return Vec::new();
    }
    records
        .iter()
        .filter(|record| record.kind.as_deref() == Some("TDWR"))
        .map(|record| record.station.clone())
        .collect()
}

/// Which terminal radars the office lists, asking if it has to.
///
/// For the live gate, which is checking the bundled table against the feed
/// and has nowhere to get a warm cache from. Anything on a path a reader is
/// waiting on takes `terminal_stations_known` instead.
#[cfg(test)]
///
/// The station list is the only thing that knows a terminal radar has been
/// renamed or taken out of the network, which the product buckets cannot say:
/// a radar that has been quiet for three weeks and a name that is not a radar
/// at all look identical there.
pub async fn terminal_stations() -> Result<Vec<String>, RadarStatusError> {
    Ok(stations()
        .await?
        .iter()
        .filter(|record| record.kind.as_deref() == Some("TDWR"))
        .map(|record| record.station.clone())
        .collect())
}

/// Puts a station list in place of the live one, for a test.
///
/// The alternative is a test that talks to the weather service to prove what
/// this app does when the weather service says something particular, which is
/// a test of the weather service.
#[cfg(test)]
pub fn hold_stations_for_test(stations: &[(&str, &str)]) {
    if let Ok(mut held) = STATIONS.lock() {
        *held = Some((
            Utc::now(),
            stations
                .iter()
                .map(|(id, kind)| StationRecord {
                    station: (*id).to_string(),
                    status: Some("Operate".to_string()),
                    kind: Some((*kind).to_string()),
                    level_two_at: None,
                })
                .collect(),
        ));
    }
}

/// Forgets whatever a test put there, so the next one starts clean.
#[cfg(test)]
pub fn forget_stations_for_test() {
    if let Ok(mut held) = STATIONS.lock() {
        *held = None;
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    /// Five stations, shaped the way the live feed shapes them: one running,
    /// one restarting, one WSR-88D that says it is operating and has sent
    /// nothing for days, one terminal radar equally quiet on a feed this app
    /// never reads it from, and one with no RDA block at all.
    const FEED: &str = r#"{
      "type": "FeatureCollection",
      "features": [
        {
          "properties": {
            "id": "KDMX",
            "stationType": "WSR-88D",
            "latency": { "levelTwoLastReceivedTime": "2026-09-02T22:05:01-04:00" },
            "rda": { "properties": {
              "status": "Operate",
              "operabilityStatus": "RDA - Maintenance Action Mandatory"
            } }
          }
        },
        {
          "properties": {
            "id": "KGLD",
            "stationType": "WSR-88D",
            "latency": { "levelTwoLastReceivedTime": "2026-08-24T12:01:12-04:00" },
            "rda": { "properties": {
              "status": "Start-Up",
              "operabilityStatus": "RDA - On-line"
            } }
          }
        },
        {
          "properties": {
            "id": "KCYS",
            "stationType": "WSR-88D",
            "latency": { "levelTwoLastReceivedTime": "2026-08-31T13:26:37-04:00" },
            "rda": { "properties": { "status": "Operate", "operabilityStatus": "RDA - On-line" } }
          }
        },
        {
          "properties": {
            "id": "TSDF",
            "stationType": "TDWR",
            "latency": { "levelTwoLastReceivedTime": "2026-08-13T09:00:00-04:00" },
            "rda": { "properties": { "status": "Operate", "operabilityStatus": "RDA - On-line" } }
          }
        },
        {
          "properties": {
            "id": "RODN",
            "stationType": "WSR-88D",
            "latency": { "levelTwoLastReceivedTime": "2026-09-02T22:04:59-04:00" }
          }
        }
      ]
    }"#;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-09-03T02:06:00Z")
            .expect("a time")
            .with_timezone(&Utc)
    }

    fn record(station: &str) -> StationRecord {
        read_stations(FEED.as_bytes())
            .expect("the feed reads")
            .into_iter()
            .find(|found| found.station == station)
            .expect("the station is in the fixture")
    }

    #[test]
    fn reads_the_four_things_this_app_asks_of_the_feed() {
        let stations = read_stations(FEED.as_bytes()).expect("the feed reads");
        assert_eq!(stations.len(), 5);
        let dmx = record("KDMX");
        assert_eq!(dmx.status.as_deref(), Some("Operate"));
        assert_eq!(dmx.kind.as_deref(), Some("WSR-88D"));
        // The feed stamps an offset rather than a Z, and reading it as UTC
        // without converting would put every site four hours in the future.
        assert_eq!(
            dmx.level_two_at.expect("a time").to_rfc3339(),
            "2026-09-03T02:05:01+00:00"
        );
    }

    #[test]
    fn a_site_the_office_has_not_reported_on_is_not_a_site_it_called_broken() {
        // RODN has no RDA block, and neither do the wind profilers. Reading a
        // missing status as "not Operate" would pass over a radar that is
        // sending Level II every five minutes.
        let rodn = record("RODN");
        assert_eq!(rodn.status, None);
        assert_eq!(fault_of(&rodn, now()), None);
    }

    #[test]
    fn a_restarting_radar_and_a_silent_one_are_both_passed_over() {
        // Either half alone would let a site through with nothing to show: a
        // radar can report itself operating while nothing has arrived for
        // days, which is KCYS, and one restarting can have a fresh Level II
        // time, which is what KTLH looked like the day this was written.
        assert_eq!(
            fault_of(&record("KGLD"), now()),
            Some(SiteFault::NotOperating)
        );
        assert_eq!(
            fault_of(&record("KCYS"), now()),
            Some(SiteFault::NoRecentData)
        );
        assert_eq!(fault_of(&record("KDMX"), now()), None);
    }

    #[test]
    fn a_terminal_radar_is_not_judged_by_a_feed_it_does_not_publish_to() {
        // TSDF's Level II time in this fixture is twenty days old, which is
        // what the live feed said the afternoon this was written, while its
        // Level III products were arriving every minute. This app draws the
        // airports' radars from those products and never from Level II, so
        // reading that gap as an outage greys out a working picture.
        let tsdf = record("TSDF");
        assert!(!tsdf.publishes_level_two());
        assert_eq!(fault_of(&tsdf, now()), None);

        // The RDA's own word still counts for one, because a terminal radar
        // that is not operating has nothing to publish either.
        let mut restarting = tsdf.clone();
        restarting.status = Some("Start-Up".to_string());
        assert_eq!(fault_of(&restarting, now()), Some(SiteFault::NotOperating));
    }

    #[test]
    fn a_failed_ask_is_remembered_so_it_is_not_asked_again_at_once() {
        // Site resolution runs on every tenth of a degree the map moves. With
        // no memory of a failure, a machine that cannot reach this service
        // waited out the thirty second request timeout before every single
        // lookup, which is slower than not having the feature at all.
        let now = now();
        assert!(still_fresh(now - Duration::seconds(10), &[], now));
        assert!(!still_fresh(now - Duration::seconds(40), &[], now));
        // A real answer stands for longer than a failed one.
        let good = vec![record("KDMX")];
        assert!(still_fresh(now - Duration::seconds(40), &good, now));
        assert!(!still_fresh(now - Duration::seconds(130), &good, now));
    }

    #[test]
    fn a_clock_disagreement_is_not_a_dead_radar() {
        // A machine whose clock is behind the office's would otherwise read
        // every site in the country as hours stale and pass over all of them.
        let mut ahead = record("KDMX");
        ahead.level_two_at = Some(now() + Duration::minutes(3));
        assert_eq!(fault_of(&ahead, now()), None);
    }

    #[test]
    fn a_feed_that_is_not_the_feed_is_refused() {
        assert!(read_stations(b"not json").is_err());
        assert!(read_stations(br#"{"features": []}"#).is_err());
        assert!(read_stations(br#"{"type": "FeatureCollection"}"#).is_err());
    }

    #[test]
    #[ignore = "asks the live NWS station list for every radar's status"]
    fn reads_what_the_office_says_right_now() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let said = runtime
            .block_on(radar_status())
            .expect("the office answers");
        // The network is a hundred and fifty-nine WSR-88D plus forty-five
        // terminal radars plus a handful of profilers; a feed that has lost
        // most of it is a feed that changed shape.
        assert!(said.len() > 150, "{} stations", said.len());
        // And the terminal radars are never judged by Level II, which they do
        // not publish. This is the assertion that would have caught greying
        // out a working airport radar.
        assert!(
            said.iter()
                .filter(|one| one.station.starts_with('T') && one.station.len() == 4)
                .all(|one| one.fault != Some(SiteFault::NoRecentData)),
            "a terminal radar was judged by Level II"
        );
        let faulty: Vec<&SiteStatus> = said.iter().filter(|one| one.fault.is_some()).collect();
        println!(
            "{} stations, {} not worth drawing",
            said.len(),
            faulty.len()
        );
        for one in &faulty {
            println!(
                "  {} {:?} status={:?} level II {:?}",
                one.station, one.fault, one.status, one.level_two_at
            );
        }
        // Whatever is broken today, the whole country is not.
        assert!(faulty.len() < said.len() / 2, "{} down", faulty.len());
        let running = said
            .iter()
            .find(|one| one.fault.is_none())
            .expect("somebody is running");
        assert!(!running.station.trim().is_empty());
    }
}

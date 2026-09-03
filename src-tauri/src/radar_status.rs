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

/// How far ahead of this machine's clock a published time may be stamped.
///
/// A reading from the future is a clock disagreement rather than a fault, and
/// treating it as staleness would condemn a working radar.
const AHEAD_MINUTES: i64 = 5;

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
    /// The maintenance line beside it, which is what turns "not operating"
    /// into something a reader can act on.
    pub operability: Option<String>,
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
    operability: Option<String>,
    level_two_at: Option<DateTime<Utc>>,
}

/// The last answer and when it was given.
static STATIONS: Mutex<Option<(DateTime<Utc>, Vec<StationRecord>)>> = Mutex::new(None);

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
    if let Some(at) = record.level_two_at {
        let age = now.signed_duration_since(at);
        if age > Duration::minutes(STALE_AFTER_MINUTES) && age >= Duration::minutes(-AHEAD_MINUTES)
        {
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
            operability: text(rda, "operabilityStatus"),
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
            if now.signed_duration_since(*asked) < Duration::seconds(STATUS_TTL_SECONDS) {
                return Ok(records.clone());
            }
        }
    }

    // Uncached deliberately. Every other native fetch may be served from disk
    // during an outage, which is right for a picture and wrong for a statement
    // about whether a radar is running now.
    let body = http::get_bytes_uncached(STATIONS_URL).await?;
    let records = read_stations(&body)?;
    if let Ok(mut held) = STATIONS.lock() {
        *held = Some((now, records.clone()));
    }
    Ok(records)
}

/// Every site the office is currently reporting as not worth drawing.
///
/// `None` when the feed could not be read, which is not the same as nobody
/// being down: the caller carries on with whatever it did before this existed
/// rather than passing over the whole country.
pub async fn faulty_stations() -> Option<BTreeSet<String>> {
    let records = stations().await.ok()?;
    let now = Utc::now();
    Some(
        records
            .iter()
            .filter(|record| fault_of(record, now).is_some())
            .map(|record| record.station.clone())
            .collect(),
    )
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
            operability: record.operability.clone(),
            level_two_at: record.level_two_at.map(|at| at.to_rfc3339()),
            fault: fault_of(record, now),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Four stations, shaped the way the live feed shapes them: one running,
    /// one restarting, one that says it is operating and has sent nothing for
    /// a day, and one with no RDA block at all.
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
        assert_eq!(stations.len(), 4);
        let dmx = record("KDMX");
        assert_eq!(dmx.status.as_deref(), Some("Operate"));
        assert_eq!(
            dmx.operability.as_deref(),
            Some("RDA - Maintenance Action Mandatory")
        );
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
        // radar can report itself operating while nothing has arrived for a
        // day, which is TSDF, and one restarting can have a fresh Level II
        // time, which is what KTLH looked like the day this was written.
        assert_eq!(
            fault_of(&record("KGLD"), now()),
            Some(SiteFault::NotOperating)
        );
        assert_eq!(
            fault_of(&record("TSDF"), now()),
            Some(SiteFault::NoRecentData)
        );
        assert_eq!(fault_of(&record("KDMX"), now()), None);
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

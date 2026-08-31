//! What a machine thinks each storm is about to do.
//!
//! ProbSevere is the National Severe Storms Laboratory's model for how likely
//! a storm is to turn severe in the next hour: it takes the radar, the
//! satellite, the lightning and the model environment around each cell and
//! gives back four numbers, for severe weather of any kind, for hail, for
//! wind, and for a tornado. It is the reading behind the probability badges
//! the paid apps show, and it is published free on the same bucket this app
//! already reads the national grids from.
//!
//! It is a model, not an observation, and the layer says so. A high number is
//! not a warning and a low one is not a promise.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;

use crate::http;

const BUCKET: &str = "https://noaa-mrms-pds.s3.amazonaws.com";

/// A reading is published about every two minutes, so anything older than this
/// is describing storms that have moved on.
const STALE_MINUTES: i64 = 15;

/// How far ahead of this machine's clock a reading may be stamped.
///
/// Clock skew of a minute or two is ordinary and a reading is published every
/// couple of minutes, so a little slack costs nothing. A key stamped days
/// ahead is a mistake somewhere, and drawing it as current would be drawing
/// storms that have not happened.
const AHEAD_MINUTES: i64 = 5;

#[derive(Debug, thiserror::Error)]
pub enum ProbSevereError {
    #[error("the ProbSevere listing could not be read")]
    BadListing,
    #[error("no ProbSevere reading has been published today or yesterday")]
    NoReading,
    #[error("the reading could not be decoded: {0}")]
    Decode(String),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Serialize for ProbSevereError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// What the model says about one storm.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StormObject {
    /// The model's own id for the storm, which it keeps between readings.
    pub id: String,
    /// The outline, as rings of longitude and latitude.
    pub rings: Vec<Vec<[f64; 2]>>,
    /// Percentages, nought to a hundred. Severe is the headline; the other
    /// three say what kind.
    pub severe: u8,
    pub hail: u8,
    pub wind: u8,
    pub tornado: u8,
    /// The measurements behind it, as the file names them, so the popup can
    /// list what the model was looking at without this having to know what
    /// each one means.
    pub attributes: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbSevereReading {
    /// When the reading was taken.
    pub observed: String,
    pub storms: Vec<StormObject>,
}

/// The attributes worth putting in front of somebody, in the order they read.
///
/// The file carries about fifty, most of which are model internals. These are
/// the ones a person looking at a storm would recognise, named as the file
/// names them so the popup can pair each with its value without this having to
/// carry a translation for every one.
const SHOWN: &[&str] = &[
    "COMPREF",
    "MESH",
    "VIL",
    "EchoTop_50",
    "MUCAPE",
    "EBSHEAR",
    "SRH01KM",
    "MAXLLAZ",
    "FLASH_RATE",
    "MOTION_EAST",
    "MOTION_SOUTH",
];

fn percent(value: Option<&serde_json::Value>) -> u8 {
    let Some(value) = value else { return 0 };
    let number = match value {
        serde_json::Value::String(text) => text.trim().parse::<f64>().unwrap_or(0.0),
        serde_json::Value::Number(number) => number.as_f64().unwrap_or(0.0),
        _ => 0.0,
    };
    // The file writes these as whole percents, but a value outside the range
    // would draw a badge saying something impossible.
    number.clamp(0.0, 100.0).round() as u8
}

fn text(value: Option<&serde_json::Value>) -> String {
    match value {
        Some(serde_json::Value::String(found)) => found.trim().to_string(),
        Some(serde_json::Value::Number(found)) => found.to_string(),
        _ => String::new(),
    }
}

/// Reads one published reading.
pub fn read_reading(bytes: &[u8]) -> Result<ProbSevereReading, ProbSevereError> {
    let parsed: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|failure| ProbSevereError::Decode(failure.to_string()))?;

    let observed = parsed
        .get("validTime")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .unwrap_or_default();

    let features = parsed
        .get("features")
        .and_then(|value| value.as_array())
        .ok_or_else(|| ProbSevereError::Decode("no features".into()))?;

    let mut storms = Vec::with_capacity(features.len());
    for feature in features {
        let Some(properties) = feature.get("properties").and_then(|v| v.as_object()) else {
            continue;
        };
        let geometry = feature.get("geometry");
        let Some(rings) = geometry
            .and_then(|value| value.get("coordinates"))
            .and_then(|value| value.as_array())
        else {
            continue;
        };

        let mut outline = Vec::new();
        for ring in rings {
            let Some(points) = ring.as_array() else {
                continue;
            };
            let mut walk = Vec::with_capacity(points.len());
            for point in points {
                let Some(pair) = point.as_array() else {
                    continue;
                };
                let (Some(lon), Some(lat)) = (
                    pair.first().and_then(|v| v.as_f64()),
                    pair.get(1).and_then(|v| v.as_f64()),
                ) else {
                    continue;
                };
                walk.push([lon, lat]);
            }
            // Three points is the least that encloses anything.
            if walk.len() >= 3 {
                outline.push(walk);
            }
        }
        if outline.is_empty() {
            continue;
        }

        let attributes = SHOWN
            .iter()
            .filter_map(|name| {
                let value = text(properties.get(*name));
                if value.is_empty() {
                    None
                } else {
                    Some(((*name).to_string(), value))
                }
            })
            .collect();

        storms.push(StormObject {
            id: text(properties.get("ID")),
            rings: outline,
            severe: percent(properties.get("ProbSevere")),
            hail: percent(properties.get("ProbHail")),
            wind: percent(properties.get("ProbWind")),
            tornado: percent(properties.get("ProbTor")),
            attributes,
        });
    }

    Ok(ProbSevereReading { observed, storms })
}

/// `ProbSevere/20260830/MRMS_PROBSEVERE_20260830_230841.json`
fn key_time(key: &str) -> Option<DateTime<Utc>> {
    let stem = key.rsplit('/').next()?.strip_suffix(".json")?;
    let stamp = stem.strip_prefix("MRMS_PROBSEVERE_")?;
    DateTime::parse_from_str(&format!("{stamp} +0000"), "%Y%m%d_%H%M%S %z")
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

/// The newest key in a listing, with its time.
///
/// A listing that stops in the middle of a tag is read as far as it goes.
/// Returning nothing from the whole function on the first unterminated key,
/// as this did, threw away every good key that came before the truncation and
/// left the layer blank over a listing that was mostly fine.
fn newest_in(listing: &str) -> Option<(String, DateTime<Utc>)> {
    let mut newest: Option<(String, DateTime<Utc>)> = None;
    let mut rest = listing;
    while let Some(start) = rest.find("<Key>") {
        let after = &rest[start + 5..];
        let Some(end) = after.find("</Key>") else {
            break;
        };
        let key = &after[..end];
        if let Some(at) = key_time(key) {
            if newest.as_ref().is_none_or(|(_, held)| at > *held) {
                newest = Some((key.to_string(), at));
            }
        }
        rest = &after[end..];
    }
    newest
}

/// Whether a reading is close enough to now to be worth drawing.
///
/// A reading from an hour ago is about storms that have moved on, and this is
/// a layer somebody might act on. A stamp ahead of the clock is refused for the
/// same reason from the other side: this machine's clock running a minute
/// behind the publisher's is ordinary, a key stamped days ahead is a mistake
/// somewhere, and drawing it as current would be drawing storms that have not
/// happened.
fn is_current(at: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    let age = (now - at).num_minutes();
    (-AHEAD_MINUTES..=STALE_MINUTES).contains(&age)
}

/// What the model says about the storms on the map right now.
#[tauri::command]
pub async fn probsevere_reading() -> Result<ProbSevereReading, ProbSevereError> {
    let now = Utc::now();
    let mut newest: Option<(String, DateTime<Utc>)> = None;

    // Yesterday as well, because just after midnight UTC today's folder holds
    // a file or two and the newest reading may still be in yesterday's.
    for day in [now, now - Duration::days(1)] {
        let url = format!(
            "{BUCKET}/?list-type=2&prefix=ProbSevere/{}/&max-keys=1000",
            day.format("%Y%m%d")
        );
        let listing = http::get_bytes(&url).await?;
        let listing = String::from_utf8_lossy(&listing);
        if !listing.contains("<ListBucketResult") {
            return Err(ProbSevereError::BadListing);
        }
        if let Some(found) = newest_in(&listing) {
            if newest.as_ref().is_none_or(|(_, held)| found.1 > *held) {
                newest = Some(found);
            }
        }
        // Today's folder having anything at all is enough; yesterday is only
        // worth reading when it does not.
        if newest.is_some() {
            break;
        }
    }

    let Some((key, at)) = newest else {
        return Err(ProbSevereError::NoReading);
    };
    if !is_current(at, now) {
        return Err(ProbSevereError::NoReading);
    }

    let bytes = http::get_bytes(&format!("{BUCKET}/{key}")).await?;
    read_reading(&bytes)
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    const READING: &[u8] = include_bytes!("../tests/fixtures/MRMS_PROBSEVERE_20260830_230841.json");

    #[test]
    fn a_key_says_when_it_was_taken() {
        let at =
            key_time("ProbSevere/20260830/MRMS_PROBSEVERE_20260830_230841.json").expect("a time");
        assert_eq!(at.to_rfc3339(), "2026-08-30T23:08:41+00:00");
        // Anything that is not one of these is not one.
        assert!(key_time("ProbSevere/20260830/").is_none());
        assert!(key_time("ProbSevere/20260830/index.html").is_none());
        assert!(key_time("MRMS_PROBSEVERE_nonsense.json").is_none());
    }

    #[test]
    fn the_newest_key_wins_whatever_order_the_listing_is_in() {
        // S3 answers in order, but nothing about the format promises it, and
        // a reading from ten minutes ago drawn as current is the one mistake
        // this layer must not make.
        let listing = "<ListBucketResult>\
             <Contents><Key>ProbSevere/20260830/MRMS_PROBSEVERE_20260830_230841.json</Key></Contents>\
             <Contents><Key>ProbSevere/20260830/MRMS_PROBSEVERE_20260830_225638.json</Key></Contents>\
             <Contents><Key>ProbSevere/20260830/index.html</Key></Contents>\
             </ListBucketResult>";
        let (key, at) = newest_in(listing).expect("a key");
        assert!(key.ends_with("230841.json"), "{key}");
        assert_eq!(at.to_rfc3339(), "2026-08-30T23:08:41+00:00");
        assert!(newest_in("<ListBucketResult/>").is_none());
    }

    #[test]
    fn a_listing_that_stops_in_the_middle_keeps_what_came_before_it() {
        // A body cut short is a body cut short, not a reason to throw away the
        // keys already read. This returned None from the whole function on the
        // first unterminated tag, so a truncated listing left the layer blank
        // even when every key before the cut was fine.
        let good = "<ListBucketResult>\
             <Contents><Key>ProbSevere/20260830/MRMS_PROBSEVERE_20260830_225638.json</Key></Contents>\
             <Contents><Key>ProbSevere/20260830/MRMS_PROBSEVERE_20260830_230841.json</Key></Contents>";
        let truncated = format!("{good}<Contents><Key>ProbSevere/20260830/MRMS_PROB");
        let (key, at) = newest_in(&truncated).expect("the keys before the cut are still keys");
        assert!(key.ends_with("230841.json"), "{key}");
        assert_eq!(at.to_rfc3339(), "2026-08-30T23:08:41+00:00");

        // Cut in the middle of the tag itself, and cut before any key at all.
        assert!(newest_in(&format!("{good}<Contents><Ke")).is_some());
        assert!(newest_in("<ListBucketResult><Contents><Key>ProbSev").is_none());
    }

    #[test]
    fn a_key_stamped_ahead_of_the_clock_is_not_current() {
        // The window is one-sided nowhere. A stamp a few minutes ahead is this
        // machine's clock running behind the publisher's, which is ordinary. A
        // stamp days ahead is a mistake, and drawing it as current would be
        // drawing storms that have not happened yet.
        let now = Utc.with_ymd_and_hms(2026, 8, 30, 23, 10, 0).unwrap();
        let current = |at: DateTime<Utc>| is_current(at, now);

        assert!(current(now), "a reading published this second is current");
        assert!(current(now - Duration::minutes(STALE_MINUTES)));
        assert!(!current(now - Duration::minutes(STALE_MINUTES + 1)));
        assert!(
            current(now + Duration::minutes(AHEAD_MINUTES)),
            "clock skew"
        );
        assert!(!current(now + Duration::minutes(AHEAD_MINUTES + 1)));
        assert!(!current(now + Duration::days(3)), "a stamp days ahead");
        assert!(!current(now + Duration::days(400)));
    }

    #[test]
    fn a_real_reading_comes_apart_into_storms() {
        let reading = read_reading(READING).expect("the reading decodes");
        assert!(
            reading.observed.starts_with("20260830_230841"),
            "{}",
            reading.observed
        );
        assert!(
            reading.storms.len() > 100,
            "a busy evening should have plenty, got {}",
            reading.storms.len()
        );

        for storm in &reading.storms {
            assert!(!storm.id.is_empty(), "a storm with no id");
            assert!(!storm.rings.is_empty(), "{} has no outline", storm.id);
            for ring in &storm.rings {
                assert!(ring.len() >= 3, "{} has a ring of {}", storm.id, ring.len());
                for [lon, lat] in ring {
                    assert!((-180.0..=180.0).contains(lon), "{lon}");
                    assert!((-90.0..=90.0).contains(lat), "{lat}");
                }
            }
            // Percentages, and nothing else.
            for probability in [storm.severe, storm.hail, storm.wind, storm.tornado] {
                assert!(probability <= 100, "{probability} is not a percentage");
            }
        }

        // The ids are distinct: the model keeps one per storm between
        // readings, and two storms sharing one would be two tracks confused.
        let mut ids: Vec<&str> = reading.storms.iter().map(|s| s.id.as_str()).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "the same id came out twice");
    }

    #[test]
    fn a_storm_carries_what_the_model_was_looking_at() {
        let reading = read_reading(READING).expect("the reading decodes");
        let told = reading
            .storms
            .iter()
            .find(|storm| !storm.attributes.is_empty())
            .expect("some storm should carry attributes");
        // Named as the file names them, so nothing here has to know what each
        // one means to show it.
        let names: Vec<&str> = told
            .attributes
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        assert!(names.contains(&"COMPREF"), "{names:?}");
        assert!(names.len() <= SHOWN.len());
        // And in the order they were listed, not the order the file happened
        // to write them.
        let wanted: Vec<&str> = SHOWN
            .iter()
            .copied()
            .filter(|name| names.contains(name))
            .collect();
        assert_eq!(names, wanted);
    }

    #[test]
    fn a_probability_written_oddly_is_still_a_percentage() {
        // The file writes them as strings. A number, a missing field, or
        // something outside the range would each draw a badge saying
        // something impossible.
        let odd = br#"{"validTime":"x","features":[{
            "geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},
            "properties":{"ID":"1","ProbSevere":92,"ProbHail":"-5","ProbWind":"400"}
        }]}"#;
        let reading = read_reading(odd).expect("decodes");
        let storm = &reading.storms[0];
        assert_eq!(storm.severe, 92);
        assert_eq!(storm.hail, 0);
        assert_eq!(storm.wind, 100);
        // A field the file did not carry reads as nothing rather than as
        // whatever was in memory.
        assert_eq!(storm.tornado, 0);
    }

    #[test]
    fn nothing_in_a_broken_file_gets_through_as_a_storm() {
        assert!(read_reading(b"").is_err());
        assert!(read_reading(b"not json").is_err());
        assert!(read_reading(br#"{"validTime":"x"}"#).is_err());
        // A feature with no outline is not a storm anybody can be shown.
        let hollow = br#"{"features":[
            {"properties":{"ID":"1"}},
            {"geometry":{"coordinates":[]},"properties":{"ID":"2"}},
            {"geometry":{"coordinates":[[[0,0],[1,1]]]},"properties":{"ID":"3"}}
        ]}"#;
        assert_eq!(read_reading(hollow).expect("decodes").storms.len(), 0);
    }

    #[test]
    #[ignore = "asks the live MRMS bucket for the newest reading"]
    fn reads_what_the_model_says_right_now() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let reading = runtime
            .block_on(probsevere_reading())
            .expect("the model publishes every couple of minutes");
        println!(
            "{} storms at {}, strongest {}%",
            reading.storms.len(),
            reading.observed,
            reading
                .storms
                .iter()
                .map(|storm| storm.severe)
                .max()
                .unwrap_or(0)
        );
        for storm in &reading.storms {
            assert!(!storm.rings.is_empty());
            assert!(storm.severe <= 100);
        }
    }
}

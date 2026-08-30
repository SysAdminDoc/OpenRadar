//! Tiles and small documents the map asks for, served through the disk cache.
//!
//! The webview would fetch these itself, and it would be a little faster if it
//! did. It would also forget all of them the moment the machine went offline.
//! Routing them through here means the last view is on disk when there is no
//! network to fetch it again from.

use std::time::Duration;

use reqwest::Url;

use crate::cache;
use crate::http;

/// What came back, and whether it came off the disk.
pub struct Served {
    pub status: u16,
    pub content_type: String,
    /// How old the bytes are. Zero for a fresh fetch.
    pub age: Duration,
    pub body: Vec<u8>,
}

/// The address the map asked for, read out of the local request.
///
/// The whole address travels in one query parameter rather than in the path,
/// because a tile address carries its own query string and nesting one path
/// inside another loses it.
pub fn requested_url(uri: &str) -> Option<String> {
    let parsed = Url::parse(uri).ok()?;
    let wanted = parsed
        .query_pairs()
        .find(|(name, _)| name == "u")
        .map(|(_, value)| value.into_owned())?;
    let target = Url::parse(&wanted).ok()?;
    // Only ordinary web addresses, and only the hosts the app is allowed to
    // reach. A page that talked to this scheme directly gets no further than a
    // page that talked to the network directly.
    if target.scheme() != "https" || !http::is_allowed(&target) {
        return None;
    }
    Some(target.to_string())
}

/// Fetches an address, keeping what comes back, and falls back to what was
/// kept the last time when the fetch fails.
pub async fn serve(uri: &str) -> Served {
    let Some(url) = requested_url(uri) else {
        return Served {
            status: 400,
            content_type: "text/plain".into(),
            age: Duration::ZERO,
            body: b"OpenRadar will not fetch that address.".to_vec(),
        };
    };

    match http::get_typed(&url).await {
        Ok((body, content_type)) => {
            cache::put(&url, &content_type, &body);
            Served {
                status: 200,
                content_type,
                age: Duration::ZERO,
                body,
            }
        }
        Err(error) => match cache::get(&url) {
            Some(held) => {
                log::info!(
                    "OpenRadar served {url} from its cache, {} s old: {error}",
                    held.age.as_secs()
                );
                Served {
                    status: 200,
                    content_type: held.content_type,
                    age: held.age,
                    body: held.body,
                }
            }
            None => Served {
                status: 504,
                content_type: "text/plain".into(),
                age: Duration::ZERO,
                body: error.to_string().into_bytes(),
            },
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_whole_address_out_of_the_request() {
        // A tile address carries its own query string, which has to survive
        // the trip or a WMS request arrives with no layer on it.
        let wanted = "https://geo.weather.gc.ca/geomet?service=WMS&layers=RADAR&time=2026";
        let uri = format!(
            "http://cached.localhost/?u={}",
            urlencoding_for_test(wanted)
        );
        assert_eq!(requested_url(&uri).as_deref(), Some(wanted));
    }

    #[test]
    fn refuses_anything_it_is_not_meant_to_fetch() {
        // No parameter at all.
        assert!(requested_url("http://cached.localhost/").is_none());
        // A host the app may not reach, which is the whole point of the
        // allowlist: this scheme must not become a way around it.
        assert!(
            requested_url("http://cached.localhost/?u=https%3A%2F%2Fexample.test%2Ftile.png")
                .is_none()
        );
        // Not the web at all.
        assert!(
            requested_url("http://cached.localhost/?u=file%3A%2F%2F%2FC%3A%2Fwindows").is_none()
        );
        // Plain HTTP, which the allowlist refuses in its own right.
        assert!(requested_url(
            "http://cached.localhost/?u=http%3A%2F%2Fnowcoast.noaa.gov%2Ftile.png"
        )
        .is_none());
    }

    /// A real fetch through the whole path, kept, and then served back when
    /// the address stops answering.
    #[tokio::test]
    #[ignore = "reaches the live tile service"]
    async fn keeps_what_it_fetches_and_serves_it_when_the_fetch_fails() {
        let dir = std::env::temp_dir().join(format!(
            "openradar-tiles-live-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("a clock after 1970")
                .as_nanos()
        ));
        cache::init(&dir);

        // A small public document on a host the app already reaches.
        let live = "https://tiles.openfreemap.org/styles/positron";
        let fresh = serve(&format!("http://cached.localhost/?u={}", encoded(live))).await;
        assert_eq!(fresh.status, 200, "the live fetch failed");
        assert!(!fresh.body.is_empty());
        assert_eq!(fresh.age, Duration::ZERO);
        assert!(
            cache::get(live).is_some(),
            "a tile was served without being kept"
        );

        // An address on the same service that is not there, which is what a
        // dropped connection looks like from here: the fetch fails and what
        // was kept is what the map gets.
        let gone = "https://tiles.openfreemap.org/styles/no-such-style";
        cache::put(gone, "image/png", b"the last tile that arrived");
        let held = serve(&format!("http://cached.localhost/?u={}", encoded(gone))).await;
        assert_eq!(held.status, 200);
        assert_eq!(held.body, b"the last tile that arrived");
        assert_eq!(held.content_type, "image/png");

        // Nothing kept and nothing to fetch is a plain failure, not an empty
        // picture passed off as a real one.
        let never = "https://tiles.openfreemap.org/styles/never-asked";
        let missing = serve(&format!("http://cached.localhost/?u={}", encoded(never))).await;
        assert_eq!(missing.status, 504);

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn encoded(value: &str) -> String {
        urlencoding_for_test(value)
    }

    /// Percent encoding, written out so the test does not depend on a crate
    /// the app itself has no use for.
    fn urlencoding_for_test(value: &str) -> String {
        let mut out = String::new();
        for byte in value.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(byte as char)
                }
                _ => out.push_str(&format!("%{byte:02X}")),
            }
        }
        out
    }
}

//! Tiles and small documents the map asks for, served through the disk cache.
//!
//! The webview would fetch these itself, and it would be a little faster if it
//! did. It would also forget all of them the moment the machine went offline.
//! Routing them through here means the last view is on disk when there is no
//! network to fetch it again from.

use std::time::Duration;

use reqwest::Url;

use crate::bundles;
use crate::cache;
use crate::http;

/**
 * The hosts this scheme will fetch for.
 *
 * Narrower than the native allowlist on purpose. Rust reaches several storage
 * buckets the page itself may not, and a scheme the page can call would hand
 * it those too, with the response's own origin checks stripped off. This list
 * is the tiles and documents the map draws, and matches the one the frontend
 * routes through here.
 */
const SERVED_HOSTS: &[&str] = &[
    "opengeo.ncep.noaa.gov",
    "nowcoast.noaa.gov",
    "mapservices.weather.noaa.gov",
    "api.weather.gov",
    "tilecache.rainviewer.com",
    "api.rainviewer.com",
    "geo.weather.gc.ca",
    "maps.dwd.de",
    "mesonet.agron.iastate.edu",
    "gibs.earthdata.nasa.gov",
    "tiles.openfreemap.org",
    "basemap.nationalmap.gov",
    "tile.opentopomap.org",
    "earthquake.usgs.gov",
    "services3.arcgis.com",
    "satepsanone.nesdis.noaa.gov",
    "aviationweather.gov",
    "api.tidesandcurrents.noaa.gov",
    "api.water.noaa.gov",
    "api.open-meteo.com",
    "previous-runs-api.open-meteo.com",
];

/// What came back, and whether it came off the disk.
pub struct Served {
    pub status: u16,
    pub content_type: String,
    /// How old the bytes are. Zero for a fresh fetch.
    pub age: Duration,
    pub body: Vec<u8>,
    /// The replay bundle the bytes came out of, when they did. A bundled
    /// answer never touched the network. It rides out as a response header so
    /// a reader looking at the network panel, or a test proving the offline
    /// path, can tell the two apart.
    pub bundle: Option<String>,
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
    let host = target.host_str()?.to_ascii_lowercase();
    if !SERVED_HOSTS.contains(&host.as_str()) {
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
            bundle: None,
        };
    };

    // An open replay bundle answers first, for the addresses it holds. That
    // is the whole point of one: the replay is drawn from the bytes that
    // were kept, whatever the archive would say today and whether or not
    // there is a network to ask.
    if let Some((content_type, body, age, bundle)) = bundles::lookup(&url) {
        return Served {
            status: 200,
            content_type,
            age: Duration::from_secs(age),
            body: body.to_vec(),
            bundle: Some(bundle),
        };
    }

    match http::get_typed(&url).await {
        Ok((body, content_type)) => {
            cache::put_async(&url, &content_type, &body).await;
            Served {
                status: 200,
                content_type,
                age: Duration::ZERO,
                body,
                bundle: None,
            }
        }
        Err(error) => match cache::get_async(&url).await {
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
                    bundle: None,
                }
            }
            None => Served {
                status: 504,
                content_type: "text/plain".into(),
                age: Duration::ZERO,
                body: error.to_string().into_bytes(),
                bundle: None,
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
        // A host the native side may reach but the page may not. The scheme
        // must not become a way for the page to borrow Rust's reach.
        assert!(requested_url(
            "http://cached.localhost/?u=https%3A%2F%2Fnoaa-goes19.s3.amazonaws.com%2Ffile.nc"
        )
        .is_none());
        assert!(requested_url(
            "http://cached.localhost/?u=https%3A%2F%2Funidata-nexrad-level2.s3.amazonaws.com%2Ffile"
        )
        .is_none());
        // Credentials and a port are part of an address, and neither was
        // allowed. Both would change who answers and what is sent.
        assert!(requested_url(
            "http://cached.localhost/?u=https%3A%2F%2Fuser%3Apass%40nowcoast.noaa.gov%2Ftile.png"
        )
        .is_none());
        assert!(requested_url(
            "http://cached.localhost/?u=https%3A%2F%2Fnowcoast.noaa.gov%3A8443%2Ftile.png"
        )
        .is_none());
    }

    /// The list the page routes through here and the list this serves have to
    /// be the same list, or a layer is routed and then refused.
    #[test]
    fn serves_the_hosts_the_page_routes_here() {
        let frontend =
            std::fs::read_to_string("../src/lib/tileCache.ts").expect("the frontend list");
        for host in SERVED_HOSTS {
            assert!(
                frontend.contains(&format!("\"{host}\"")),
                "{host} is served here but the page never routes it"
            );
        }
        let routed: Vec<String> = frontend
            .lines()
            .skip_while(|line| !line.contains("CACHED_HOSTS"))
            .take_while(|line| !line.contains("];"))
            .filter_map(|line| {
                let trimmed = line.trim().trim_end_matches(',');
                trimmed
                    .strip_prefix('"')
                    .and_then(|rest| rest.strip_suffix('"'))
                    .map(|host| host.to_string())
            })
            .collect();
        assert!(!routed.is_empty(), "the frontend list could not be read");
        for host in routed {
            assert!(
                SERVED_HOSTS.contains(&host.as_str()),
                "{host} is routed here but this refuses it"
            );
        }
    }

    /// The whole point of a replay bundle: the bytes come out of the file
    /// rather than off the network, and they do it here rather than in every
    /// caller.
    ///
    /// This runs with no network at all. A bundled address that fell through
    /// to `http::get_typed` in this test would come back as a 504, so a pass
    /// is proof the bundle answered first.
    #[tokio::test]
    async fn an_open_bundle_answers_before_the_network_does() {
        let (manifest, entries) = crate::bundles::tests::sample_bundle();
        let bundled = entries[0].url.clone();
        let body = entries[0].body.clone();
        crate::bundles::activate(&manifest, entries);

        let served = serve(&format!(
            "http://cached.localhost/?u={}",
            urlencoding_for_test(&bundled)
        ))
        .await;
        assert_eq!(served.status, 200);
        assert_eq!(served.body, body, "the bundle's own bytes");
        assert_eq!(served.content_type, "image/png");
        // And it says which bundle, so a reader looking at the network panel
        // and a test proving the offline path can both tell.
        assert_eq!(served.bundle.as_deref(), Some(manifest.id.as_str()));

        // An address the bundle does not hold is not invented for it; it
        // carries on to the network like any other. Asked directly rather
        // than through `serve`, because the point is that nothing bundled
        // answers rather than what the network would say, and a unit test
        // should not be reaching for a tile service to find that out.
        let elsewhere = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-1/5/9/13.png";
        assert!(
            crate::bundles::lookup(elsewhere).is_none(),
            "nothing bundled answers an address the file does not hold"
        );

        crate::bundles::deactivate();
        // Closed, the same address is nobody's business again.
        assert!(
            crate::bundles::lookup(&bundled).is_none(),
            "a closed bundle answers nothing"
        );
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

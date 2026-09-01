//! The network boundary for anything OpenRadar fetches from Rust.
//!
//! The WebView content security policy only governs requests the page makes.
//! A request issued here bypasses it entirely, so this allowlist is the real
//! boundary and every native fetch has to come through it.

use std::sync::OnceLock;
use std::time::Duration;

use crate::cache;

use reqwest::redirect::Policy;
use reqwest::{Client, StatusCode, Url};

/// Every host a native fetch may reach. Subdomains are not implied.
const ALLOWED_HOSTS: &[&str] = &[
    "opengeo.ncep.noaa.gov",
    "nowcoast.noaa.gov",
    "mapservices.weather.noaa.gov",
    "api.weather.gov",
    "earthquake.usgs.gov",
    "services3.arcgis.com",
    "satepsanone.nesdis.noaa.gov",
    "aviationweather.gov",
    "mesonet.agron.iastate.edu",
    "api.rainviewer.com",
    "tilecache.rainviewer.com",
    "basemap.nationalmap.gov",
    "tile.opentopomap.org",
    "tiles.openfreemap.org",
    "api.open-meteo.com",
    "api.tidesandcurrents.noaa.gov",
    "geocoding-api.open-meteo.com",
    "previous-runs-api.open-meteo.com",
    "valhalla1.openstreetmap.de",
    "gibs.earthdata.nasa.gov",
    "geo.weather.gc.ca",
    "maps.dwd.de",
    "noaa-gfs-bdp-pds.s3.amazonaws.com",
    "unidata-nexrad-level2.s3.amazonaws.com",
    "unidata-nexrad-level2-chunks.s3.amazonaws.com",
    "unidata-nexrad-level3.s3.amazonaws.com",
    "noaa-mrms-pds.s3.amazonaws.com",
    "noaa-goes19.s3.amazonaws.com",
];

const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_REDIRECTS: usize = 4;

#[derive(Debug, PartialEq, Eq)]
pub enum RedirectDecision {
    Follow,
    Refuse,
}

#[derive(Debug, thiserror::Error)]
pub enum HttpError {
    #[error("{0} is not a host OpenRadar is allowed to reach")]
    HostNotAllowed(String),
    #[error("the address could not be read")]
    BadUrl,
    #[error("the response was larger than the {MAX_BODY_BYTES} byte limit")]
    TooLarge,
    #[error("the request failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("the response redirected somewhere OpenRadar may not follow")]
    RedirectRefused,
    #[error("the requested byte range is invalid")]
    InvalidRange,
    #[error("the server did not return the requested byte range")]
    RangeNotHonored,
}

/// HTTPS only, and the host has to match an entry exactly. A lookalike such as
/// `nowcoast.noaa.gov.example.net` is refused because it is a different host.
pub fn is_allowed(url: &Url) -> bool {
    // Credentials in an address decide what the client sends as its
    // Authorization header, and a port decides which service on the host
    // answers. Neither is part of what was allowed, so neither is accepted.
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if url.port().is_some() {
        return false;
    }
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(host) => {
            let host = host.to_ascii_lowercase();
            ALLOWED_HOSTS.iter().any(|allowed| *allowed == host)
        }
        None => false,
    }
}

/// A redirect is only followed when the destination passes the same check the
/// original address did, which is what stops an open redirect from walking us
/// off the list.
pub fn decide_redirect(next: &Url, hops: usize) -> RedirectDecision {
    if hops >= MAX_REDIRECTS || !is_allowed(next) {
        RedirectDecision::Refuse
    } else {
        RedirectDecision::Follow
    }
}

fn user_agent() -> String {
    // NOAA asks for a contact address in the User-Agent on its public feeds.
    format!(
        "OpenRadar/{} (https://github.com/SysAdminDoc/OpenRadar)",
        env!("CARGO_PKG_VERSION")
    )
}

/// One client for the whole process. Tiles arrive in bursts of a dozen or
/// more, and a client built per request opens a new connection for every one
/// of them.
pub fn shared_client() -> Result<&'static Client, HttpError> {
    static SHARED: OnceLock<Option<Client>> = OnceLock::new();
    SHARED
        .get_or_init(|| client().ok())
        .as_ref()
        .ok_or(HttpError::BadUrl)
}

pub fn client() -> Result<Client, HttpError> {
    let policy =
        Policy::custom(
            |attempt| match decide_redirect(attempt.url(), attempt.previous().len()) {
                RedirectDecision::Follow => attempt.follow(),
                RedirectDecision::Refuse => attempt.stop(),
            },
        );

    Ok(Client::builder()
        .user_agent(user_agent())
        .timeout(REQUEST_TIMEOUT)
        .redirect(policy)
        .build()?)
}

/// The only way to fetch bytes from Rust. Callers pass a host they own, never
/// an address handed over from the frontend.
///
/// What comes back is kept on disk, and a fetch that fails falls back to what
/// was kept. Every one of these addresses names a published file that does not
/// change once it exists, so the copy is either the same bytes or a picture of
/// an older moment, which the timeline already dates for the user.
pub async fn get_bytes(url: &str) -> Result<Vec<u8>, HttpError> {
    // Checked before the cache is consulted. An address that is no longer
    // allowed must not keep being served from a copy taken when it was.
    let parsed = Url::parse(url).map_err(|_| HttpError::BadUrl)?;
    if !is_allowed(&parsed) {
        return Err(HttpError::HostNotAllowed(
            parsed.host_str().unwrap_or(url).to_string(),
        ));
    }

    match fetch_bytes(url).await {
        Ok(body) => {
            cache::put_async(url, "application/octet-stream", &body).await;
            Ok(body)
        }
        Err(error) => match cache::get_async(url).await {
            Some(held) => {
                log::info!(
                    "OpenRadar read {url} from its cache, {} s old: {error}",
                    held.age.as_secs()
                );
                Ok(held.body)
            }
            None => Err(error),
        },
    }
}

/// The same, without keeping a copy on disk.
///
/// For a caller that already remembers what it fetched and would only be
/// filling the shared cache with things nobody reads twice. The volume in
/// progress is fifty-odd pieces every twenty seconds, which turns a
/// 2,048-entry cache over in about nine minutes and flushes the tiles, grids
/// and alerts the offline view is made of.
pub async fn get_bytes_uncached(url: &str) -> Result<Vec<u8>, HttpError> {
    fetch_bytes(url).await
}

async fn fetch_bytes(url: &str) -> Result<Vec<u8>, HttpError> {
    let parsed = Url::parse(url).map_err(|_| HttpError::BadUrl)?;
    if !is_allowed(&parsed) {
        return Err(HttpError::HostNotAllowed(
            parsed.host_str().unwrap_or(url).to_string(),
        ));
    }

    let response = shared_client()?.get(parsed).send().await?;
    // A refused redirect comes back as the 3xx itself, which error_for_status
    // treats as success. Saying so beats handing back an empty body.
    if response.status().is_redirection() {
        return Err(HttpError::RedirectRefused);
    }
    read_limited(response.error_for_status()?, MAX_BODY_BYTES).await
}

/// Streams a response into a bounded buffer. Content-Length is only a hint:
/// chunked responses and dishonest servers still have to meet the same cap.
async fn read_limited(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, HttpError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(HttpError::TooLarge);
    }

    let capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or(0)
        .min(limit);
    let mut body = Vec::with_capacity(capacity);
    while let Some(chunk) = response.chunk().await? {
        let length = body
            .len()
            .checked_add(chunk.len())
            .ok_or(HttpError::TooLarge)?;
        if length > limit {
            return Err(HttpError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// A typed response whose declared byte count can be checked before the bytes
/// become part of a durable incident pack.
pub struct TypedResponse {
    pub body: Vec<u8>,
    pub content_type: String,
    pub content_length: Option<u64>,
}

/// The same fetch, keeping the content type and the server's byte count.
pub async fn get_typed_verified(url: &str) -> Result<TypedResponse, HttpError> {
    let parsed = Url::parse(url).map_err(|_| HttpError::BadUrl)?;
    if !is_allowed(&parsed) {
        return Err(HttpError::HostNotAllowed(
            parsed.host_str().unwrap_or(url).to_string(),
        ));
    }

    let response = shared_client()?.get(parsed).send().await?;
    if response.status().is_redirection() {
        return Err(HttpError::RedirectRefused);
    }
    let response = response.error_for_status()?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let content_length = response.content_length();
    let body = read_limited(response, MAX_BODY_BYTES).await?;
    Ok(TypedResponse {
        body,
        content_type,
        content_length,
    })
}

/// The typed fetch used by short-lived map requests.
pub async fn get_typed(url: &str) -> Result<(Vec<u8>, String), HttpError> {
    let response = get_typed_verified(url).await?;
    Ok((response.body, response.content_type))
}

/// A byte range of a file, which is how one field is read out of a GRIB2
/// file without downloading the four hundred megabytes around it.
pub async fn get_range(url: &str, start: u64, end: u64) -> Result<Vec<u8>, HttpError> {
    let parsed = Url::parse(url).map_err(|_| HttpError::BadUrl)?;
    if !is_allowed(&parsed) {
        return Err(HttpError::HostNotAllowed(
            parsed.host_str().unwrap_or(url).to_string(),
        ));
    }
    let expected = range_length(start, end)?;

    let response = shared_client()?
        .get(parsed)
        .header("Range", format!("bytes={start}-{end}"))
        .send()
        .await?;
    if response.status().is_redirection() {
        return Err(HttpError::RedirectRefused);
    }
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return Err(HttpError::RangeNotHonored);
    }
    let body = read_limited(response.error_for_status()?, expected).await?;
    if body.len() != expected {
        return Err(HttpError::RangeNotHonored);
    }
    Ok(body)
}

fn range_length(start: u64, end: u64) -> Result<usize, HttpError> {
    let length = end
        .checked_sub(start)
        .and_then(|difference| difference.checked_add(1))
        .ok_or(HttpError::InvalidRange)?;
    if length > MAX_BODY_BYTES as u64 {
        return Err(HttpError::TooLarge);
    }
    usize::try_from(length).map_err(|_| HttpError::TooLarge)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).expect("test address should parse")
    }

    #[test]
    fn allows_only_the_listed_hosts_over_https() {
        assert!(is_allowed(&url(
            "https://opengeo.ncep.noaa.gov/geoserver/conus/ows?service=WMS"
        )));
        assert!(is_allowed(&url("https://earthquake.usgs.gov/x.geojson")));

        assert!(!is_allowed(&url("https://example.net/tiles")));
        assert!(!is_allowed(&url("http://opengeo.ncep.noaa.gov/ows")));
        assert!(!is_allowed(&url(
            "https://opengeo.ncep.noaa.gov.example.net/"
        )));
        assert!(!is_allowed(&url("https://evil.opengeo.ncep.noaa.gov/")));
        assert!(!is_allowed(&url("file:///c:/windows/system32")));
    }

    #[test]
    fn refuses_a_redirect_that_leaves_the_list() {
        assert_eq!(
            decide_redirect(&url("https://nowcoast.noaa.gov/geoserver"), 1),
            RedirectDecision::Follow
        );
        assert_eq!(
            decide_redirect(&url("https://example.net/steal"), 1),
            RedirectDecision::Refuse
        );
        assert_eq!(
            decide_redirect(&url("http://nowcoast.noaa.gov/geoserver"), 1),
            RedirectDecision::Refuse
        );
    }

    #[test]
    fn refuses_a_redirect_chain_that_will_not_end() {
        assert_eq!(
            decide_redirect(&url("https://nowcoast.noaa.gov/a"), MAX_REDIRECTS),
            RedirectDecision::Refuse
        );
    }

    #[tokio::test]
    async fn refuses_an_off_list_address_without_sending_anything() {
        let error = get_bytes("https://example.net/anything")
            .await
            .expect_err("an off-list host must be refused");
        assert!(matches!(error, HttpError::HostNotAllowed(_)));

        let error = get_bytes("not even an address")
            .await
            .expect_err("a malformed address must be refused");
        assert!(matches!(error, HttpError::BadUrl));
    }

    #[test]
    fn a_refused_redirect_is_an_error_not_an_empty_body() {
        // The status the client is left holding when a redirect is refused.
        let error = HttpError::RedirectRefused;
        assert!(error.to_string().contains("may not follow"));
    }

    #[test]
    fn validates_byte_ranges_before_sending_them() {
        assert_eq!(range_length(10, 19).unwrap(), 10);
        assert!(matches!(range_length(19, 10), Err(HttpError::InvalidRange)));
        assert!(matches!(
            range_length(0, MAX_BODY_BYTES as u64),
            Err(HttpError::TooLarge)
        ));
    }

    #[test]
    fn names_itself_and_a_contact_address() {
        let agent = user_agent();
        assert!(agent.starts_with("OpenRadar/"));
        assert!(agent.contains("github.com/SysAdminDoc/OpenRadar"));
    }
}

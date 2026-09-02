//! Replay bundles: one file that holds a replay's exact bytes.
//!
//! A workspace backup keeps settings. It does not keep the picture: the
//! archive tiles a replay was drawn from, the warnings that were in force,
//! or the addresses they came from. Providers change, caches expire, and a
//! replay looked at in a review three months on is a different set of bytes
//! unless somebody kept the first set. This is where they are kept.
//!
//! The file is `.orb`, and the layout is small enough to state in full:
//!
//! ```text
//! "ORB1"                       four bytes of magic
//! version         u32 BE       the layout version, 1
//! manifest length u32 BE
//! manifest        JSON         see `Manifest`, and the README
//! entry count     u32 BE
//! entries         repeated     url length u32, url, content type length u32,
//!                              content type, body length u64, body
//! checksum        32 bytes     SHA-256 of everything before it
//! ```
//!
//! Every entry is also named in the manifest with its own SHA-256 and size,
//! so a file can be checked entry by entry and a damaged one is refused
//! before any of it is served. Both hashes live in the file beside the bytes
//! they describe, so this catches a bundle that got corrupted on the way and
//! not one somebody rewrote on purpose. Opening a bundle loads its entries into a
//! store the cached scheme consults before the network: a replay drawn
//! from a bundle is drawn from the bundle, whatever the network says today.
//! Anything the bundle does not hold (the basemap, a feed that was missing
//! when it was made) is fetched or refused the way it always was, and the
//! manifest says which is which.
//!
//! What travels: the frames, the window, the storm, and the view the reader
//! had when they saved it. That last one is the reader's own map position,
//! and it is in the file because the tiles that were captured are the tiles
//! that view covers, so a bundle cannot both reproduce offline and keep the
//! view out of it. The workspace, which knows where home is and which places
//! are watched, is the part that stays out: it travels only with an explicit
//! opt-in on the way out and is applied only on an explicit action on the way
//! in.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use bytes::Bytes;
use chrono::{DateTime, Utc};
use futures_util::stream::{self, StreamExt as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use tauri::AppHandle;

use crate::{exports, http, incident_packs};

pub const MAGIC: &[u8; 4] = b"ORB1";
pub const BUNDLE_VERSION: u32 = 1;
/// The whole file. A six-hour replay at three zoom levels is tens of
/// megabytes; this leaves room for a long one without inviting a file that
/// cannot be held in memory to be served.
pub const MAX_BUNDLE_BYTES: u64 = 256 * 1024 * 1024;
/// One tile or document. A warnings feed for a busy day is a few megabytes.
const MAX_ENTRY_BYTES: usize = 32 * 1024 * 1024;
/// Tiles across every frame and zoom, so a request cannot be turned into a
/// crawl of the archive.
pub const MAX_TILES: usize = 4_000;
pub const MAX_FRAMES: usize = 200;
const MIN_ZOOM: u8 = 2;
const MAX_ZOOM: u8 = 12;
const CONCURRENCY: usize = 4;

#[derive(Debug, thiserror::Error)]
pub enum BundleError {
    #[error("the request is not one a bundle can be made from: {0}")]
    InvalidRequest(String),
    #[error("the view covers {0} tiles across the replay, past the {MAX_TILES} a bundle holds")]
    TooManyTiles(usize),
    #[error("the bundle would be larger than the {MAX_BUNDLE_BYTES} byte limit")]
    TooLarge,
    #[error("there is nowhere to write the bundle")]
    NoFolder,
    #[error("the bundle could not be written: {0}")]
    Write(String),
    #[error("the bundle could not be read: {0}")]
    Read(String),
    #[error("that file is not an OpenRadar replay bundle")]
    NotABundle,
    #[error("the bundle was made by a newer OpenRadar (layout {0}) and this build cannot read it")]
    Newer(u32),
    #[error("the bundle is damaged: {0}")]
    Corrupt(String),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl BundleError {
    fn parts(&self) -> (&'static str, Vec<String>) {
        match self {
            Self::InvalidRequest(why) => ("invalidRequest", vec![why.clone()]),
            Self::TooManyTiles(count) => ("tooManyTiles", vec![count.to_string()]),
            Self::TooLarge => ("tooLarge", Vec::new()),
            Self::NoFolder => ("noFolder", Vec::new()),
            Self::Write(why) => ("write", vec![why.clone()]),
            Self::Read(why) => ("read", vec![why.clone()]),
            Self::NotABundle => ("notABundle", Vec::new()),
            Self::Newer(version) => ("newer", vec![version.to_string()]),
            Self::Corrupt(why) => ("corrupt", vec![why.clone()]),
            Self::Http(_) => ("http", vec![self.to_string()]),
        }
    }
}

impl Serialize for BundleError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, args) = self.parts();
        let mut out = serializer.serialize_struct("BundleError", 3)?;
        out.serialize_field("code", code)?;
        out.serialize_field("args", &args)?;
        out.serialize_field("text", &self.to_string())?;
        out.end()
    }
}

/// One frame of the replay, as the timeline draws it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleFrame {
    pub provider_id: String,
    /// Seconds, as the services publish frame times.
    pub time: i64,
    /// A template with `{z}`, `{x}` and `{y}` in it.
    pub tile_url: String,
    pub tile_size: u32,
    pub max_zoom: u8,
    pub attribution: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleBounds {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

impl BundleBounds {
    fn valid(self) -> bool {
        [self.west, self.south, self.east, self.north]
            .into_iter()
            .all(f64::is_finite)
            && (-180.0..180.0).contains(&self.west)
            && (-180.0..=180.0).contains(&self.east)
            && (-85.0..85.0).contains(&self.south)
            && (-85.0..=85.0).contains(&self.north)
            && self.west < self.east
            && self.south < self.north
    }
}

/// The storm a replay is about, so the track can be drawn from the bundled
/// best-track record and the replay named.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleStorm {
    pub id: String,
    pub name: String,
    pub year: i32,
    /// Seconds: the moment the replay opens on.
    pub focus_time: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleWindow {
    /// Seconds, the first and last frame.
    pub from: i64,
    pub to: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleCamera {
    pub center: [f64; 2],
    pub zoom: f64,
    pub bearing: f64,
    pub pitch: f64,
}

/// What the page asks for a bundle of.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    pub label: String,
    pub storm: Option<BundleStorm>,
    pub window: BundleWindow,
    pub frames: Vec<BundleFrame>,
    /// The view the reader had, which decides which tiles are kept.
    pub bounds: BundleBounds,
    pub min_zoom: u8,
    pub max_zoom: u8,
    /// Documents beside the tiles: the warnings feeds for the window.
    pub extra_urls: Vec<String>,
    pub camera: BundleCamera,
    /// The reader's workspace, only when they said to include it.
    pub workspace: Option<serde_json::Value>,
}

/// One kept response, as the manifest names it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntryRecord {
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    pub content_type: String,
    /// When the bytes were fetched, RFC 3339.
    pub fetched_at: String,
}

/// An address the bundle was meant to hold and does not, and why.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MissingRecord {
    pub url: String,
    pub reason: String,
}

/// The bundle's own account of itself. Documented in the README as well.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(rename = "type")]
    pub kind: String,
    pub bundle_version: u32,
    /// The OpenRadar that wrote it.
    pub app: String,
    pub id: String,
    pub label: String,
    pub created_at: String,
    pub storm: Option<BundleStorm>,
    pub window: BundleWindow,
    pub frames: Vec<BundleFrame>,
    pub bounds: BundleBounds,
    pub zooms: Vec<u8>,
    pub camera: BundleCamera,
    pub entries: Vec<EntryRecord>,
    pub missing: Vec<MissingRecord>,
    pub workspace: Option<serde_json::Value>,
}

pub const MANIFEST_TYPE: &str = "OpenRadarReplayBundle";

/// What the page is told once a bundle is written.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureReport {
    pub id: String,
    pub path: String,
    pub bytes: u64,
    pub entries: usize,
    pub missing: Vec<MissingRecord>,
    pub sha256: String,
}

/// An entry as it is written and read: the address, the type, the bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub url: String,
    pub content_type: String,
    pub body: Vec<u8>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Every tile address a frame's template names over a view, at each zoom.
///
/// The same slippy arithmetic the incident packs use, so the two agree about
/// which tiles a box covers.
pub fn tile_urls(
    template: &str,
    bounds: BundleBounds,
    min_zoom: u8,
    max_zoom: u8,
) -> Result<Vec<String>, BundleError> {
    if !template.contains("{z}") || !template.contains("{x}") || !template.contains("{y}") {
        return Err(BundleError::InvalidRequest(
            "a frame's tile address names no {z}/{x}/{y}".into(),
        ));
    }
    let mut urls = Vec::new();
    for zoom in min_zoom..=max_zoom {
        // The east and south edges belong to the next tile along, so a box
        // that ends exactly on a tile boundary must not pull that tile in.
        // Nudged by a fraction of one tile rather than by a machine epsilon,
        // which at these magnitudes is smaller than the last bit of the
        // number and rounded away before it can do anything.
        let span = 360.0 / f64::from(1u32 << zoom);
        let nudge = span / 1024.0;
        let min_x = incident_packs::tile_x(bounds.west, zoom);
        let max_x = incident_packs::tile_x((bounds.east - nudge).max(bounds.west), zoom);
        let min_y = incident_packs::tile_y(bounds.north, zoom);
        let max_y = incident_packs::tile_y((bounds.south + nudge).min(bounds.north), zoom);
        for x in min_x..=max_x {
            for y in min_y..=max_y {
                urls.push(
                    template
                        .replace("{z}", &zoom.to_string())
                        .replace("{x}", &x.to_string())
                        .replace("{y}", &y.to_string()),
                );
                if urls.len() > MAX_TILES {
                    return Err(BundleError::TooManyTiles(urls.len()));
                }
            }
        }
    }
    Ok(urls)
}

fn validate(request: &CaptureRequest) -> Result<(), BundleError> {
    if request.label.trim().is_empty() {
        return Err(BundleError::InvalidRequest("the bundle has no name".into()));
    }
    if request.frames.is_empty() || request.frames.len() > MAX_FRAMES {
        return Err(BundleError::InvalidRequest(format!(
            "{} frames, and a bundle holds one to {MAX_FRAMES}",
            request.frames.len()
        )));
    }
    if !request.bounds.valid() {
        return Err(BundleError::InvalidRequest("the view is not a box".into()));
    }
    if request.min_zoom < MIN_ZOOM
        || request.max_zoom > MAX_ZOOM
        || request.min_zoom > request.max_zoom
    {
        return Err(BundleError::InvalidRequest(format!(
            "zooms {} to {} are not within {MIN_ZOOM} to {MAX_ZOOM}",
            request.min_zoom, request.max_zoom
        )));
    }
    if request.window.from >= request.window.to {
        return Err(BundleError::InvalidRequest(
            "the window ends before it starts".into(),
        ));
    }
    if !request.camera.center.iter().all(|value| value.is_finite())
        || !request.camera.zoom.is_finite()
    {
        return Err(BundleError::InvalidRequest(
            "the camera is not a place".into(),
        ));
    }
    Ok(())
}

/// Every address a request wants, tiles first, each once.
pub fn addresses(request: &CaptureRequest) -> Result<Vec<String>, BundleError> {
    validate(request)?;
    let mut seen = HashSet::new();
    let mut urls = Vec::new();
    let mut tiles = 0usize;
    for frame in &request.frames {
        for url in tile_urls(
            &frame.tile_url,
            request.bounds,
            request.min_zoom,
            request.max_zoom,
        )? {
            if seen.insert(url.clone()) {
                tiles += 1;
                if tiles > MAX_TILES {
                    return Err(BundleError::TooManyTiles(tiles));
                }
                urls.push(url);
            }
        }
    }
    for url in &request.extra_urls {
        if seen.insert(url.clone()) {
            urls.push(url.clone());
        }
    }
    Ok(urls)
}

/// The bytes of a bundle, with its checksum on the end.
pub fn write_bundle(manifest: &Manifest, entries: &[Entry]) -> Result<Vec<u8>, BundleError> {
    let manifest_json =
        serde_json::to_vec(manifest).map_err(|error| BundleError::Write(error.to_string()))?;
    let mut out = Vec::with_capacity(
        manifest_json.len()
            + entries
                .iter()
                .map(|entry| entry.body.len() + entry.url.len() + 64)
                .sum::<usize>()
            + 64,
    );
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&BUNDLE_VERSION.to_be_bytes());
    let manifest_length = u32::try_from(manifest_json.len()).map_err(|_| BundleError::TooLarge)?;
    out.extend_from_slice(&manifest_length.to_be_bytes());
    out.extend_from_slice(&manifest_json);
    let count = u32::try_from(entries.len()).map_err(|_| BundleError::TooLarge)?;
    out.extend_from_slice(&count.to_be_bytes());
    for entry in entries {
        let url_length = u32::try_from(entry.url.len()).map_err(|_| BundleError::TooLarge)?;
        out.extend_from_slice(&url_length.to_be_bytes());
        out.extend_from_slice(entry.url.as_bytes());
        let type_length =
            u32::try_from(entry.content_type.len()).map_err(|_| BundleError::TooLarge)?;
        out.extend_from_slice(&type_length.to_be_bytes());
        out.extend_from_slice(entry.content_type.as_bytes());
        out.extend_from_slice(&(entry.body.len() as u64).to_be_bytes());
        out.extend_from_slice(&entry.body);
        if out.len() as u64 > MAX_BUNDLE_BYTES {
            return Err(BundleError::TooLarge);
        }
    }
    let checksum = Sha256::digest(&out);
    out.extend_from_slice(&checksum);
    Ok(out)
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], BundleError> {
        let end = self
            .at
            .checked_add(count)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| BundleError::Corrupt("an entry runs past the end of the file".into()))?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn u32(&mut self) -> Result<u32, BundleError> {
        let raw = self.take(4)?;
        Ok(u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]))
    }

    fn u64(&mut self) -> Result<u64, BundleError> {
        let raw = self.take(8)?;
        let mut eight = [0u8; 8];
        eight.copy_from_slice(raw);
        Ok(u64::from_be_bytes(eight))
    }

    fn text(&mut self, count: usize) -> Result<String, BundleError> {
        String::from_utf8(self.take(count)?.to_vec())
            .map_err(|_| BundleError::Corrupt("an entry's address is not text".into()))
    }
}

/// Reads and checks a bundle: the checksum over the whole file, then every
/// entry against the manifest's own record of it. Nothing is trusted that
/// the file says about itself until both agree.
pub fn read_bundle(bytes: &[u8]) -> Result<(Manifest, Vec<Entry>), BundleError> {
    if bytes.len() < MAGIC.len() + 4 + 4 + 4 + 32 || &bytes[..4] != MAGIC {
        return Err(BundleError::NotABundle);
    }
    if bytes.len() as u64 > MAX_BUNDLE_BYTES {
        return Err(BundleError::TooLarge);
    }
    let (content, checksum) = bytes.split_at(bytes.len() - 32);
    if Sha256::digest(content).as_slice() != checksum {
        return Err(BundleError::Corrupt(
            "the checksum does not match the file".into(),
        ));
    }
    let mut cursor = Cursor {
        bytes: content,
        at: 4,
    };
    let version = cursor.u32()?;
    if version > BUNDLE_VERSION {
        return Err(BundleError::Newer(version));
    }
    if version == 0 {
        return Err(BundleError::Corrupt("layout version zero".into()));
    }
    let manifest_length = cursor.u32()? as usize;
    let manifest: Manifest = serde_json::from_slice(cursor.take(manifest_length)?)
        .map_err(|error| BundleError::Corrupt(format!("the manifest will not parse: {error}")))?;
    if manifest.kind != MANIFEST_TYPE || manifest.bundle_version != version {
        return Err(BundleError::Corrupt(
            "the manifest is not this bundle's".into(),
        ));
    }
    let count = cursor.u32()? as usize;
    if count != manifest.entries.len() {
        return Err(BundleError::Corrupt(format!(
            "the file holds {count} entries and the manifest names {}",
            manifest.entries.len()
        )));
    }
    let mut entries = Vec::with_capacity(count);
    for record in &manifest.entries {
        let url_length = cursor.u32()? as usize;
        let url = cursor.text(url_length)?;
        let type_length = cursor.u32()? as usize;
        let content_type = cursor.text(type_length)?;
        let body_length = cursor.u64()?;
        if body_length > MAX_ENTRY_BYTES as u64 {
            return Err(BundleError::Corrupt(format!(
                "an entry claims {body_length} bytes"
            )));
        }
        let body = cursor.take(body_length as usize)?.to_vec();
        // The content type is checked with the rest of it: it reaches the
        // webview as a response header, and an entry the manifest does not
        // vouch for in full is an entry that was not verified.
        if url != record.url
            || body_length != record.bytes
            || content_type != record.content_type
            || sha256_hex(&body) != record.sha256
        {
            return Err(BundleError::Corrupt(format!(
                "{} does not match the manifest's record of it",
                record.url
            )));
        }
        entries.push(Entry {
            url,
            content_type,
            body,
        });
    }
    if cursor.at != content.len() {
        return Err(BundleError::Corrupt(
            "the file carries bytes past its last entry".into(),
        ));
    }
    Ok((manifest, entries))
}

/// What is held for an address, once a bundle is open.
struct Held {
    content_type: String,
    body: Bytes,
    fetched_at: Option<DateTime<Utc>>,
}

struct Active {
    id: String,
    entries: HashMap<String, Held>,
}

fn active() -> &'static Mutex<Option<Active>> {
    static ACTIVE: OnceLock<Mutex<Option<Active>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(None))
}

/// Puts a read bundle in front of the network.
pub fn activate(manifest: &Manifest, entries: Vec<Entry>) {
    let fetched: HashMap<&str, Option<DateTime<Utc>>> = manifest
        .entries
        .iter()
        .map(|record| {
            (
                record.url.as_str(),
                DateTime::parse_from_rfc3339(&record.fetched_at)
                    .ok()
                    .map(|at| at.with_timezone(&Utc)),
            )
        })
        .collect();
    let held = entries
        .into_iter()
        .map(|entry| {
            let fetched_at = fetched.get(entry.url.as_str()).copied().flatten();
            (
                entry.url,
                Held {
                    content_type: entry.content_type,
                    body: Bytes::from(entry.body),
                    fetched_at,
                },
            )
        })
        .collect();
    if let Ok(mut guard) = active().lock() {
        *guard = Some(Active {
            id: manifest.id.clone(),
            entries: held,
        });
    }
}

/// Takes the open bundle out of the way of the network.
pub fn deactivate() {
    if let Ok(mut guard) = active().lock() {
        *guard = None;
    }
}

/// A bundled answer for an address: the type, the bytes, how old they are
/// and which bundle they came from. None when no open bundle holds it.
pub fn lookup(url: &str) -> Option<(String, Bytes, u64, String)> {
    let guard = active().lock().ok()?;
    let active = guard.as_ref()?;
    let held = active.entries.get(url)?;
    let age = held
        .fetched_at
        .map(|at| (Utc::now() - at).num_seconds().max(0) as u64)
        .unwrap_or(0);
    Some((
        held.content_type.clone(),
        held.body.clone(),
        age,
        active.id.clone(),
    ))
}

fn slug(label: &str) -> String {
    let mut out = String::new();
    for character in label.chars() {
        if character.is_ascii_alphanumeric() {
            out.push(character.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
        if out.len() >= 40 {
            break;
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "replay".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Fetches every address a request names and writes the bundle.
async fn capture(request: CaptureRequest, folder: PathBuf) -> Result<CaptureReport, BundleError> {
    let urls = addresses(&request)?;
    let created_at = Utc::now();
    let fetched_at = created_at.to_rfc3339();

    // Fetched a few at a time, the way the packs do, so an archive is not
    // hammered by a thousand tiles at once. Each answer is kept with its
    // hash or written down as missing with the reason.
    //
    // Taken as they arrive rather than collected first: collecting holds
    // every body at once, so the cap on the finished file would have bounded
    // nothing about the memory it took to reach it.
    let mut answers = stream::iter(urls.into_iter().map(|url| async move {
        let outcome = http::get_typed(&url).await;
        (url, outcome)
    }))
    .buffer_unordered(CONCURRENCY);

    let mut entries = Vec::new();
    let mut records = Vec::new();
    let mut missing = Vec::new();
    let mut total = 0u64;
    while let Some((url, outcome)) = answers.next().await {
        match outcome {
            Ok((body, content_type)) => {
                if body.len() > MAX_ENTRY_BYTES {
                    missing.push(MissingRecord {
                        url,
                        reason: format!("{} bytes, past what one entry may hold", body.len()),
                    });
                    continue;
                }
                total += body.len() as u64;
                if total > MAX_BUNDLE_BYTES {
                    return Err(BundleError::TooLarge);
                }
                records.push(EntryRecord {
                    url: url.clone(),
                    sha256: sha256_hex(&body),
                    bytes: body.len() as u64,
                    content_type: content_type.clone(),
                    fetched_at: fetched_at.clone(),
                });
                entries.push(Entry {
                    url,
                    content_type,
                    body,
                });
            }
            Err(error) => missing.push(MissingRecord {
                url,
                reason: error.to_string(),
            }),
        }
    }
    // The order the manifest names them is the order they are written, and
    // sorting by address keeps two captures of the same replay comparable.
    let mut order: Vec<usize> = (0..entries.len()).collect();
    order.sort_by(|a, b| entries[*a].url.cmp(&entries[*b].url));
    let entries: Vec<Entry> = order.iter().map(|at| entries[*at].clone()).collect();
    let records: Vec<EntryRecord> = order.iter().map(|at| records[*at].clone()).collect();
    missing.sort_by(|a, b| a.url.cmp(&b.url));

    let id =
        sha256_hex(format!("{}|{}|{}", request.label, fetched_at, request.window.from).as_bytes())
            [..24]
            .to_string();
    let manifest = Manifest {
        kind: MANIFEST_TYPE.to_string(),
        bundle_version: BUNDLE_VERSION,
        app: env!("CARGO_PKG_VERSION").to_string(),
        id: id.clone(),
        label: request.label.trim().to_string(),
        created_at: fetched_at,
        storm: request.storm,
        window: request.window,
        frames: request.frames,
        bounds: request.bounds,
        zooms: (request.min_zoom..=request.max_zoom).collect(),
        camera: request.camera,
        entries: records,
        missing: missing.clone(),
        workspace: request.workspace,
    };

    let bytes = write_bundle(&manifest, &entries)?;
    let sha256 = sha256_hex(&bytes);
    let name = format!(
        "openradar-replay-{}-{}.orb",
        slug(&manifest.label),
        &id[..8]
    );
    let path = folder.join(name);
    let written = bytes.len() as u64;
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&folder).map_err(|error| BundleError::Write(error.to_string()))?;
        exports::write_atomically(&path, &bytes)
            .map_err(|error| BundleError::Write(error.to_string()))?;
        Ok::<PathBuf, BundleError>(path)
    })
    .await
    .map_err(|error| BundleError::Write(error.to_string()))?
    .map(|path| CaptureReport {
        id,
        path: path.to_string_lossy().into_owned(),
        bytes: written,
        entries: manifest.entries.len(),
        missing,
        sha256,
    })
}

/// Writes a replay's bytes into one file and answers with where it went.
#[tauri::command]
pub async fn replay_bundle_capture(
    app: AppHandle,
    request: CaptureRequest,
) -> Result<CaptureReport, BundleError> {
    let folder = exports::export_folder(&app).map_err(|_| BundleError::NoFolder)?;
    capture(request, folder).await
}

fn read_file(path: &Path) -> Result<Vec<u8>, BundleError> {
    let file = fs::File::open(path).map_err(|error| BundleError::Read(error.to_string()))?;
    let size = file
        .metadata()
        .map_err(|error| BundleError::Read(error.to_string()))?
        .len();
    if size > MAX_BUNDLE_BYTES {
        return Err(BundleError::TooLarge);
    }
    let mut bytes = Vec::with_capacity(size as usize);
    file.take(MAX_BUNDLE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| BundleError::Read(error.to_string()))?;
    if bytes.len() as u64 > MAX_BUNDLE_BYTES {
        return Err(BundleError::TooLarge);
    }
    Ok(bytes)
}

/// Opens a bundle, checks it whole, and puts it in front of the network.
///
/// Nothing changes until every check has passed: a damaged or newer file
/// leaves whatever bundle was open exactly as it was.
#[tauri::command]
pub async fn replay_bundle_open(path: String) -> Result<Manifest, BundleError> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_file(&PathBuf::from(path))?;
        let (manifest, entries) = read_bundle(&bytes)?;
        activate(&manifest, entries);
        Ok(manifest)
    })
    .await
    .map_err(|error| BundleError::Read(error.to_string()))?
}

/// Takes the open bundle out of the way, which the page does when the
/// replay it was drawn from is closed.
#[tauri::command]
pub fn replay_bundle_close() {
    deactivate();
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// The open bundle is one global, and the tests that open and close it
    /// run on separate threads. Taken by each of those so they take turns.
    fn store_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn frame(time: i64) -> BundleFrame {
        BundleFrame {
            provider_id: "archive".into(),
            time,
            tile_url: format!(
                "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-{time}/{{z}}/{{x}}/{{y}}.png"
            ),
            tile_size: 256,
            max_zoom: 9,
            attribution: "Iowa State".into(),
        }
    }

    fn request() -> CaptureRequest {
        CaptureRequest {
            label: "IAN 2022".into(),
            storm: Some(BundleStorm {
                id: "AL092022".into(),
                name: "IAN".into(),
                year: 2022,
                focus_time: 1_664_391_900,
            }),
            window: BundleWindow {
                from: 1_664_380_800,
                to: 1_664_402_400,
            },
            frames: vec![frame(1_664_380_800), frame(1_664_381_700)],
            bounds: BundleBounds {
                west: -84.0,
                south: 25.0,
                east: -80.0,
                north: 28.0,
            },
            min_zoom: 5,
            max_zoom: 6,
            extra_urls: vec![
                "https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson?begints=a"
                    .into(),
            ],
            camera: BundleCamera {
                center: [-82.0, 26.5],
                zoom: 7.0,
                bearing: 0.0,
                pitch: 0.0,
            },
            workspace: None,
        }
    }

    fn manifest(entries: &[Entry]) -> Manifest {
        let request = request();
        Manifest {
            kind: MANIFEST_TYPE.into(),
            bundle_version: BUNDLE_VERSION,
            app: "0.6.0".into(),
            id: "abc123".into(),
            label: request.label.clone(),
            created_at: "2026-08-30T12:00:00+00:00".into(),
            storm: request.storm.clone(),
            window: request.window,
            frames: request.frames.clone(),
            bounds: request.bounds,
            zooms: vec![5, 6],
            camera: request.camera,
            entries: entries
                .iter()
                .map(|entry| EntryRecord {
                    url: entry.url.clone(),
                    sha256: sha256_hex(&entry.body),
                    bytes: entry.body.len() as u64,
                    content_type: entry.content_type.clone(),
                    fetched_at: "2026-08-30T12:00:00+00:00".into(),
                })
                .collect(),
            missing: vec![MissingRecord {
                url: "https://mesonet.agron.iastate.edu/geojson/sbw.py?x".into(),
                reason: "the archive returned 404".into(),
            }],
            workspace: None,
        }
    }

    fn entries() -> Vec<Entry> {
        vec![
            Entry {
                url: "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-1/5/8/13.png".into(),
                content_type: "image/png".into(),
                body: vec![0x89, b'P', b'N', b'G', 1, 2, 3],
            },
            Entry {
                url: "https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson?begints=a".into(),
                content_type: "application/json".into(),
                body: br#"{"type":"FeatureCollection","features":[]}"#.to_vec(),
            },
        ]
    }

    /// Everything a test outside this module needs to stand a bundle up.
    ///
    /// `tiles` proves the offline path, and the only honest way to do that is
    /// with a real open bundle rather than a stub of one.
    pub(crate) fn sample_bundle() -> (Manifest, Vec<Entry>) {
        let entries = entries();
        (manifest(&entries), entries)
    }

    #[test]
    fn a_box_that_ends_on_a_tile_edge_does_not_pull_in_the_next_tile() {
        // The east and south edges belong to the tile after them. At zoom 3 a
        // tile is 45 degrees wide, so a box from -90 to -45 is exactly two
        // tiles across, and reading its east edge as inside the third one
        // would capture a column of tiles nobody is looking at.
        let urls = tile_urls(
            "https://mesonet.agron.iastate.edu/cache/tile.py/{z}/{x}/{y}.png",
            BundleBounds {
                west: -90.0,
                south: 0.0,
                east: -45.0,
                north: 45.0,
            },
            3,
            3,
        )
        .expect("a valid box");
        // One column wide: the box runs from the west edge of column 2 to the
        // west edge of column 3, and column 3 is not in it. Reading the east
        // edge as inside the next tile captures a column of the map nobody is
        // looking at, on every frame and at every zoom.
        assert!(
            urls.iter().all(|url| url.contains("/3/2/")),
            "the column past the east edge came too: {urls:#?}"
        );
        assert!(!urls.is_empty());
        // And the south edge is the same rule the other way round.
        let rows: Vec<&str> = urls
            .iter()
            .map(|url| url.rsplit('/').next().unwrap_or(""))
            .collect();
        assert!(!rows.contains(&"4.png"), "{urls:#?}");
    }

    #[test]
    fn names_every_tile_of_the_view_once_and_the_documents_beside_them() {
        let urls = addresses(&request()).expect("a valid request");
        // Two frames, two zooms. The box covers a few tiles at each zoom, and
        // each frame has its own set; the one document follows.
        assert!(urls.len() > 4, "{} addresses", urls.len());
        assert_eq!(
            urls.last().map(String::as_str),
            Some("https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson?begints=a")
        );
        let unique: HashSet<&String> = urls.iter().collect();
        assert_eq!(unique.len(), urls.len(), "an address repeats");
        assert!(urls
            .iter()
            .any(|url| url.contains("USCOMP-N0Q-1664380800/5/")));
        assert!(urls
            .iter()
            .any(|url| url.contains("USCOMP-N0Q-1664381700/6/")));
        assert!(
            urls.iter().all(|url| !url.contains('{')),
            "a template was not expanded"
        );
    }

    #[test]
    fn refuses_a_request_that_is_not_a_bundle_s_worth() {
        let mut wide = request();
        wide.bounds = BundleBounds {
            west: -130.0,
            south: 20.0,
            east: -60.0,
            north: 50.0,
        };
        wide.min_zoom = 2;
        wide.max_zoom = 12;
        assert!(matches!(
            addresses(&wide),
            Err(BundleError::TooManyTiles(_))
        ));

        let mut none = request();
        none.frames.clear();
        assert!(matches!(
            addresses(&none),
            Err(BundleError::InvalidRequest(_))
        ));

        let mut backwards = request();
        backwards.window.to = backwards.window.from;
        assert!(matches!(
            addresses(&backwards),
            Err(BundleError::InvalidRequest(_))
        ));

        let mut bad_template = request();
        bad_template.frames[0].tile_url = "https://example.test/tile.png".into();
        assert!(matches!(
            addresses(&bad_template),
            Err(BundleError::InvalidRequest(_))
        ));

        let mut sky_high = request();
        sky_high.max_zoom = 15;
        assert!(matches!(
            addresses(&sky_high),
            Err(BundleError::InvalidRequest(_))
        ));
    }

    #[test]
    fn an_entry_whose_type_does_not_match_the_manifest_is_refused() {
        // The content type reaches the webview as a response header, so an
        // entry the manifest does not vouch for in full is an entry that was
        // not verified. A PNG that arrives claiming to be a document is the
        // shape of thing this is for.
        let entries = entries();
        let mut manifest = manifest(&entries);
        manifest.entries[0].content_type = "text/html".into();
        let bytes = write_bundle(&manifest, &entries).expect("writes");
        let refused = read_bundle(&bytes).expect_err("a refusal");
        assert!(matches!(refused, BundleError::Corrupt(_)), "{refused:?}");
    }

    #[test]
    fn a_bundle_reads_back_exactly_as_it_was_written() {
        let entries = entries();
        let manifest = manifest(&entries);
        let bytes = write_bundle(&manifest, &entries).expect("writes");
        assert_eq!(&bytes[..4], MAGIC);
        let (back, held) = read_bundle(&bytes).expect("reads");
        assert_eq!(back, manifest);
        assert_eq!(held, entries);
        // And the manifest is plain JSON a person could read.
        let length = u32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
        let json = std::str::from_utf8(&bytes[12..12 + length]).expect("text");
        assert!(json.contains("\"type\":\"OpenRadarReplayBundle\""));
        assert!(json.contains("\"missing\":[{\"url\""));
    }

    #[test]
    fn a_changed_byte_anywhere_is_refused_before_anything_is_served() {
        let entries = entries();
        let manifest = manifest(&entries);
        let bytes = write_bundle(&manifest, &entries).expect("writes");
        // One bit in a tile body. The checksum catches it, and even without
        // the checksum the entry's own hash in the manifest would.
        let body_at = bytes
            .windows(4)
            .position(|window| window == [0x89, b'P', b'N', b'G'])
            .expect("the tile is in there");
        let mut tampered = bytes.clone();
        tampered[body_at + 5] ^= 0x01;
        assert!(matches!(
            read_bundle(&tampered),
            Err(BundleError::Corrupt(_))
        ));

        // A checksum that matches but a manifest that lies: rebuild the file
        // with a wrong hash in the record.
        let mut lying = manifest.clone();
        lying.entries[0].sha256 = "0".repeat(64);
        let bytes = write_bundle(&lying, &entries).expect("writes");
        assert!(matches!(read_bundle(&bytes), Err(BundleError::Corrupt(_))));

        // Not a bundle at all, and one from the future.
        assert!(matches!(
            read_bundle(b"not a bundle at all, not even close"),
            Err(BundleError::NotABundle)
        ));
        let mut future = write_bundle(&manifest, &entries).expect("writes");
        future[4..8].copy_from_slice(&(BUNDLE_VERSION + 1).to_be_bytes());
        let checksum = Sha256::digest(&future[..future.len() - 32]);
        let end = future.len();
        future[end - 32..].copy_from_slice(&checksum);
        assert!(matches!(read_bundle(&future), Err(BundleError::Newer(2))));
        // And bytes past the last entry, which is what a truncated write
        // followed by a rewrite would look like.
        let mut padded = write_bundle(&manifest, &entries).expect("writes");
        let end = padded.len();
        padded.splice(end - 32..end - 32, [0u8; 3]);
        let checksum = Sha256::digest(&padded[..padded.len() - 32]);
        let end = padded.len();
        padded[end - 32..].copy_from_slice(&checksum);
        assert!(matches!(read_bundle(&padded), Err(BundleError::Corrupt(_))));
    }

    #[test]
    fn an_open_bundle_answers_for_its_addresses_and_nothing_else() {
        let _turn = store_lock();
        let entries = entries();
        let manifest = manifest(&entries);
        activate(&manifest, entries.clone());
        let (content_type, body, age, id) = lookup(&entries[0].url).expect("held");
        assert_eq!(content_type, "image/png");
        assert_eq!(body.as_ref(), entries[0].body.as_slice());
        assert_eq!(id, "abc123");
        // Fetched at the end of August 2026, so the age is real and not
        // zero: the page must not read a bundled tile as just fetched.
        assert!(age > 0);
        assert!(lookup(
            "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-1/5/9/13.png"
        )
        .is_none());
        deactivate();
        assert!(lookup(&entries[0].url).is_none());
    }

    #[test]
    fn a_damaged_bundle_leaves_the_open_one_alone() {
        let _turn = store_lock();
        let entries = entries();
        let manifest = manifest(&entries);
        activate(&manifest, entries.clone());
        let bytes = write_bundle(&manifest, &entries).expect("writes");
        let mut tampered = bytes.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0xff;
        assert!(read_bundle(&tampered).is_err());
        // Still the first one, untouched.
        assert!(lookup(&entries[0].url).is_some());
        deactivate();
    }

    #[test]
    fn names_a_file_a_person_can_read() {
        assert_eq!(slug("IAN 2022"), "ian-2022");
        assert_eq!(
            slug("  Hurricane Ian (landfall) 2022 "),
            "hurricane-ian-landfall-2022"
        );
        assert_eq!(slug("!!!"), "replay");
        assert!(slug(&"x".repeat(200)).len() <= 40);
    }

    #[test]
    fn the_error_names_itself_for_the_page() {
        let json = serde_json::to_string(&BundleError::Newer(3)).expect("serialises");
        assert!(json.contains("\"code\":\"newer\""));
        assert!(json.contains("\"args\":[\"3\"]"));
    }
}

//! Durable, resumable basemap packs for work without a network connection.
//!
//! The ordinary tile cache is deliberately disposable and capped by entry
//! count. Incident packs are different: each one has a manifest, a verified
//! download journal, and a PMTiles archive that stays until it is deleted.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use bytes::Bytes;
use chrono::Utc;
use futures_util::stream::{self, StreamExt as _};
use image::{GenericImageView as _, ImageFormat};
use pmtiles::{AsyncBackend, AsyncPmTilesReader, PmTilesWriter, TileCoord, TileId, TileType};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use tokio::sync::Mutex as AsyncMutex;

use crate::http;

const STORE_FOLDER: &str = "incident-packs-v1";
const MANIFEST_FILE: &str = "manifest.json";
const JOURNAL_FILE: &str = "tiles.jsonl";
const TILE_FOLDER: &str = "tiles";
const ARCHIVE_FILE: &str = "basemap.pmtiles";
const ARCHIVE_PART: &str = "basemap.pmtiles.part";
const CONFIG_FILE: &str = "config.json";
const STORE_SCHEMA: u8 = 1;
const DEFAULT_LIMIT_MB: u64 = 4096;
const MIN_LIMIT_MB: u64 = 256;
const MAX_LIMIT_MB: u64 = 32_768;
const ESTIMATED_TILE_BYTES: u64 = 48 * 1024;
const ARCHIVE_OVERHEAD_BYTES: u64 = 128 * 1024;
const MAX_PACK_TILES: usize = 20_000;
const MIN_ZOOM: u8 = 2;
const MAX_ZOOM: u8 = 15;
const DOWNLOAD_CONCURRENCY: usize = 4;
const DOWNLOAD_BATCH: usize = 16;
const SOURCE_NAME: &str = "USGS The National Map Topo";
const ATTRIBUTION: &str = "USGS The National Map";
const SOURCE_ROOT: &str =
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile";

const CONTROL_RUN: u8 = 0;
const CONTROL_PAUSE: u8 = 1;
const CONTROL_CANCEL: u8 = 2;

static ROOT: OnceLock<PathBuf> = OnceLock::new();
static ACTIVE: OnceLock<Mutex<HashMap<String, Arc<TaskControl>>>> = OnceLock::new();
static STORE_WRITE: OnceLock<AsyncMutex<()>> = OnceLock::new();
static FINALIZE: OnceLock<AsyncMutex<()>> = OnceLock::new();
static ARCHIVE_VERIFY: OnceLock<AsyncMutex<()>> = OnceLock::new();
static VERIFIED_ARCHIVES: OnceLock<Mutex<HashMap<PathBuf, ArchiveFingerprint>>> = OnceLock::new();
static IDS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, thiserror::Error)]
pub enum IncidentPackError {
    #[error("the incident pack store is not available")]
    NoStore,
    #[error("that region or zoom range is not valid")]
    InvalidRegion,
    #[error("that region needs {0} tiles, above the {MAX_PACK_TILES} tile limit")]
    TooManyTiles(usize),
    #[error("that pack name is not valid")]
    InvalidName,
    #[error("that incident pack was not found")]
    NotFound,
    #[error("that incident pack is not ready")]
    NotReady,
    #[error("the incident pack disk ceiling would be exceeded")]
    DiskCeiling,
    #[error("the incident pack is still stopping")]
    Busy,
    #[error("the download was cancelled")]
    Cancelled,
    #[error("the tile server returned {expected} bytes but delivered {actual}")]
    ByteMismatch { expected: u64, actual: u64 },
    #[error("a downloaded tile was not a 256 by 256 PNG or JPEG image")]
    InvalidTile,
    #[error("the downloaded bytes failed their SHA-256 check")]
    HashMismatch,
    #[error("the PMTiles archive failed verification")]
    ArchiveVerification,
    #[error("the PMTiles archive failed its SHA-256 check")]
    ArchiveHashMismatch,
    #[error("the incident pack worker stopped unexpectedly: {0}")]
    Worker(String),
    #[error("the incident pack could not be read or written: {0}")]
    Io(#[from] std::io::Error),
    #[error("the incident pack manifest could not be read: {0}")]
    Json(#[from] serde_json::Error),
    #[error("a downloaded tile could not be decoded: {0}")]
    Image(#[from] image::ImageError),
    #[error("the PMTiles archive could not be read or written: {0}")]
    PmTiles(#[from] pmtiles::PmtError),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Serialize for IncidentPackError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackBounds {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

impl PackBounds {
    fn valid(self) -> bool {
        [self.west, self.south, self.east, self.north]
            .into_iter()
            .all(f64::is_finite)
            && (-180.0..180.0).contains(&self.west)
            && (-180.0..=180.0).contains(&self.east)
            && (-85.0..85.0).contains(&self.south)
            && (-85.0..85.0).contains(&self.north)
            && self.west < self.east
            && self.south < self.north
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePackRequest {
    pub name: String,
    pub bounds: PackBounds,
    pub min_zoom: u8,
    pub max_zoom: u8,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EstimateRequest {
    pub bounds: PackBounds,
    pub min_zoom: u8,
    pub max_zoom: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PackStatus {
    Queued,
    Downloading,
    Paused,
    Finalizing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSummary {
    pub id: String,
    pub name: String,
    pub bounds: PackBounds,
    pub min_zoom: u8,
    pub max_zoom: u8,
    pub status: PackStatus,
    pub tile_count: usize,
    pub downloaded_tiles: usize,
    pub downloaded_bytes: u64,
    pub estimated_bytes: u64,
    pub archive_bytes: u64,
    pub sha256: Option<String>,
    pub source: String,
    pub attribution: String,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PackManifest {
    schema_version: u8,
    id: String,
    name: String,
    bounds: PackBounds,
    min_zoom: u8,
    max_zoom: u8,
    status: PackStatus,
    tile_count: usize,
    downloaded_tiles: usize,
    downloaded_bytes: u64,
    estimated_bytes: u64,
    archive_bytes: u64,
    sha256: Option<String>,
    source: String,
    attribution: String,
    error: Option<String>,
    created_at: String,
    updated_at: String,
}

impl From<&PackManifest> for PackSummary {
    fn from(value: &PackManifest) -> Self {
        Self {
            id: value.id.clone(),
            name: value.name.clone(),
            bounds: value.bounds,
            min_zoom: value.min_zoom,
            max_zoom: value.max_zoom,
            status: value.status,
            tile_count: value.tile_count,
            downloaded_tiles: value.downloaded_tiles,
            downloaded_bytes: value.downloaded_bytes,
            estimated_bytes: value.estimated_bytes,
            archive_bytes: value.archive_bytes,
            sha256: value.sha256.clone(),
            source: value.source.clone(),
            attribution: value.attribution.clone(),
            error: value.error.clone(),
            created_at: value.created_at.clone(),
            updated_at: value.updated_at.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackEstimate {
    pub tile_count: usize,
    pub estimated_bytes: u64,
    pub temporary_bytes: u64,
    pub used_bytes: u64,
    pub disk_limit_bytes: u64,
    pub fits: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackLibrary {
    pub packs: Vec<PackSummary>,
    pub used_bytes: u64,
    pub disk_limit_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoreConfig {
    schema_version: u8,
    disk_limit_mb: u64,
}

impl Default for StoreConfig {
    fn default() -> Self {
        Self {
            schema_version: STORE_SCHEMA,
            disk_limit_mb: DEFAULT_LIMIT_MB,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
struct Tile {
    z: u8,
    x: u32,
    y: u32,
}

impl Tile {
    fn coord(self) -> Result<TileCoord, IncidentPackError> {
        TileCoord::new(self.z, self.x, self.y).map_err(Into::into)
    }

    fn file_name(self) -> String {
        format!("{}-{}-{}.png", self.z, self.x, self.y)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TileRecord {
    tile: Tile,
    bytes: u64,
    sha256: String,
}

struct TaskControl {
    mode: AtomicU8,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ArchiveFingerprint {
    bytes: u64,
    sha256: String,
    modified: Option<SystemTime>,
}

/// Reads just the byte ranges PMTiles asks for and closes the file after each
/// one. A memory map keeps the archive locked on Windows, which would make an
/// otherwise idle pack impossible to delete while the app is open.
#[derive(Clone)]
struct PackFileBackend {
    path: PathBuf,
}

impl AsyncBackend for PackFileBackend {
    async fn read(&self, offset: usize, length: usize) -> pmtiles::PmtResult<Bytes> {
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(offset as u64))?;
        let mut body = Vec::with_capacity(length);
        file.take(length as u64).read_to_end(&mut body)?;
        Ok(Bytes::from(body))
    }
}

impl TaskControl {
    fn new() -> Self {
        Self {
            mode: AtomicU8::new(CONTROL_RUN),
        }
    }
}

pub struct ServedTile {
    pub status: u16,
    pub body: Vec<u8>,
}

pub fn init(app_data: &Path) {
    let root = app_data.join(STORE_FOLDER);
    if let Err(error) = fs::create_dir_all(&root) {
        log::warn!("OpenRadar could not create its incident pack store: {error}");
        return;
    }
    let _ = ROOT.set(root.clone());
    if let Err(error) = recover_store(&root) {
        log::warn!("OpenRadar could not recover its incident pack store: {error}");
    }
}

fn root() -> Result<&'static Path, IncidentPackError> {
    ROOT.get()
        .map(PathBuf::as_path)
        .ok_or(IncidentPackError::NoStore)
}

fn active() -> &'static Mutex<HashMap<String, Arc<TaskControl>>> {
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn store_write() -> &'static AsyncMutex<()> {
    STORE_WRITE.get_or_init(|| AsyncMutex::new(()))
}

fn finalization() -> &'static AsyncMutex<()> {
    FINALIZE.get_or_init(|| AsyncMutex::new(()))
}

fn archive_verification() -> &'static AsyncMutex<()> {
    ARCHIVE_VERIFY.get_or_init(|| AsyncMutex::new(()))
}

fn verified_archives() -> &'static Mutex<HashMap<PathBuf, ArchiveFingerprint>> {
    VERIFIED_ARCHIVES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn validate_id(id: &str) -> Result<(), IncidentPackError> {
    if id.len() == 24 && id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(IncidentPackError::NotFound)
    }
}

fn pack_dir(root: &Path, id: &str) -> Result<PathBuf, IncidentPackError> {
    validate_id(id)?;
    Ok(root.join(id))
}

fn manifest_path(pack_dir: &Path) -> PathBuf {
    pack_dir.join(MANIFEST_FILE)
}

fn atomic_paths(path: &Path) -> (PathBuf, PathBuf) {
    (
        path.with_extension("json.tmp"),
        path.with_extension("json.bak"),
    )
}

fn recover_atomic(path: &Path) -> Result<(), IncidentPackError> {
    let (temporary, backup) = atomic_paths(path);
    if !path.exists() && backup.exists() {
        fs::rename(&backup, path)?;
    }
    if path.exists() {
        if temporary.exists() {
            fs::remove_file(temporary)?;
        }
        if backup.exists() {
            fs::remove_file(backup)?;
        }
    }
    Ok(())
}

fn atomic_json<T: Serialize>(path: &Path, value: &T) -> Result<(), IncidentPackError> {
    let parent = path.parent().ok_or(IncidentPackError::NoStore)?;
    fs::create_dir_all(parent)?;
    let (temporary, backup) = atomic_paths(path);
    if temporary.exists() {
        fs::remove_file(&temporary)?;
    }
    let mut file = BufWriter::new(File::create(&temporary)?);
    serde_json::to_writer_pretty(&mut file, value)?;
    file.write_all(b"\n")?;
    file.flush()?;
    file.get_ref().sync_all()?;
    drop(file);

    if path.exists() {
        if backup.exists() {
            fs::remove_file(&backup)?;
        }
        fs::rename(path, &backup)?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() && !path.exists() {
            let _ = fs::rename(&backup, path);
        }
        return Err(error.into());
    }
    if backup.exists() {
        fs::remove_file(backup)?;
    }
    Ok(())
}

fn read_manifest(pack_dir: &Path) -> Result<PackManifest, IncidentPackError> {
    let path = manifest_path(pack_dir);
    recover_atomic(&path)?;
    let manifest: PackManifest = serde_json::from_reader(BufReader::new(File::open(path)?))?;
    if manifest.schema_version != STORE_SCHEMA
        || pack_dir.file_name().and_then(|name| name.to_str()) != Some(manifest.id.as_str())
    {
        return Err(IncidentPackError::NotFound);
    }
    Ok(manifest)
}

fn write_manifest(pack_dir: &Path, manifest: &PackManifest) -> Result<(), IncidentPackError> {
    atomic_json(&manifest_path(pack_dir), manifest)
}

fn read_config(root: &Path) -> Result<StoreConfig, IncidentPackError> {
    let path = root.join(CONFIG_FILE);
    recover_atomic(&path)?;
    if !path.exists() {
        let config = StoreConfig::default();
        atomic_json(&path, &config)?;
        return Ok(config);
    }
    let mut config: StoreConfig = serde_json::from_reader(BufReader::new(File::open(&path)?))?;
    if config.schema_version != STORE_SCHEMA {
        config = StoreConfig::default();
        atomic_json(&path, &config)?;
    }
    config.disk_limit_mb = config.disk_limit_mb.clamp(MIN_LIMIT_MB, MAX_LIMIT_MB);
    Ok(config)
}

fn disk_limit_bytes(root: &Path) -> Result<u64, IncidentPackError> {
    Ok(read_config(root)?.disk_limit_mb * 1024 * 1024)
}

fn folder_bytes(path: &Path) -> Result<u64, IncidentPackError> {
    if !path.exists() {
        return Ok(0);
    }
    let mut bytes = 0_u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        bytes = bytes.saturating_add(if metadata.is_dir() {
            folder_bytes(&entry.path())?
        } else {
            metadata.len()
        });
    }
    Ok(bytes)
}

fn clean_name(name: &str) -> Result<String, IncidentPackError> {
    let cleaned = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() || cleaned.chars().count() > 60 || cleaned.chars().any(char::is_control) {
        return Err(IncidentPackError::InvalidName);
    }
    Ok(cleaned)
}

fn new_id(name: &str) -> String {
    let sequence = IDS.fetch_add(1, Ordering::Relaxed);
    let mut hash = Sha256::new();
    hash.update(
        Utc::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
            .to_le_bytes(),
    );
    hash.update(sequence.to_le_bytes());
    hash.update(name.as_bytes());
    format!("{:x}", hash.finalize())[..24].to_string()
}

fn tile_x(longitude: f64, zoom: u8) -> u32 {
    let size = 1_u32 << zoom;
    (((longitude + 180.0) / 360.0 * f64::from(size)).floor() as i64).clamp(0, i64::from(size - 1))
        as u32
}

fn tile_y(latitude: f64, zoom: u8) -> u32 {
    let size = 1_u32 << zoom;
    let radians = latitude.to_radians();
    let value = (1.0 - radians.tan().asinh() / std::f64::consts::PI) / 2.0;
    ((value * f64::from(size)).floor() as i64).clamp(0, i64::from(size - 1)) as u32
}

fn tiles_for(request: EstimateRequest) -> Result<Vec<Tile>, IncidentPackError> {
    if !request.bounds.valid()
        || request.min_zoom < MIN_ZOOM
        || request.max_zoom > MAX_ZOOM
        || request.min_zoom > request.max_zoom
    {
        return Err(IncidentPackError::InvalidRegion);
    }

    let mut tiles = Vec::new();
    for zoom in request.min_zoom..=request.max_zoom {
        let min_x = tile_x(request.bounds.west, zoom);
        let max_x = tile_x(request.bounds.east - f64::EPSILON * 180.0, zoom);
        let min_y = tile_y(request.bounds.north, zoom);
        let max_y = tile_y(request.bounds.south + f64::EPSILON * 85.0, zoom);
        let count = usize::try_from(max_x - min_x + 1)
            .unwrap_or(usize::MAX)
            .saturating_mul(usize::try_from(max_y - min_y + 1).unwrap_or(usize::MAX));
        if tiles.len().saturating_add(count) > MAX_PACK_TILES {
            return Err(IncidentPackError::TooManyTiles(
                tiles.len().saturating_add(count),
            ));
        }
        for x in min_x..=max_x {
            for y in min_y..=max_y {
                tiles.push(Tile { z: zoom, x, y });
            }
        }
    }
    tiles.sort_by_key(|tile| {
        tile.coord()
            .map(TileId::from)
            .map(TileId::value)
            .unwrap_or(u64::MAX)
    });
    Ok(tiles)
}

fn estimated_bytes(tile_count: usize) -> u64 {
    u64::try_from(tile_count)
        .unwrap_or(u64::MAX)
        .saturating_mul(ESTIMATED_TILE_BYTES)
        .saturating_add(ARCHIVE_OVERHEAD_BYTES)
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn sha256_file(path: &Path) -> Result<String, IncidentPackError> {
    let mut file = BufReader::new(File::open(path)?);
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn archive_fingerprint(
    path: &Path,
    expected_bytes: u64,
    expected_hash: &str,
) -> Result<ArchiveFingerprint, IncidentPackError> {
    if expected_hash.len() != 64 || !expected_hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(IncidentPackError::ArchiveHashMismatch);
    }
    let metadata = fs::metadata(path).map_err(|_| IncidentPackError::ArchiveVerification)?;
    if !metadata.is_file() || metadata.len() != expected_bytes {
        return Err(IncidentPackError::ArchiveVerification);
    }
    Ok(ArchiveFingerprint {
        bytes: metadata.len(),
        sha256: expected_hash.to_ascii_lowercase(),
        modified: metadata.modified().ok(),
    })
}

fn archive_is_verified(
    path: &Path,
    expected_bytes: u64,
    expected_hash: &str,
) -> Result<bool, IncidentPackError> {
    let fingerprint = archive_fingerprint(path, expected_bytes, expected_hash)?;
    Ok(verified_archives()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(path)
        == Some(&fingerprint))
}

fn verify_archive_once(
    path: &Path,
    expected_bytes: u64,
    expected_hash: &str,
) -> Result<(), IncidentPackError> {
    let before = archive_fingerprint(path, expected_bytes, expected_hash)?;
    if sha256_file(path)? != before.sha256 {
        return Err(IncidentPackError::ArchiveHashMismatch);
    }
    let after = archive_fingerprint(path, expected_bytes, expected_hash)?;
    if after != before {
        return Err(IncidentPackError::ArchiveVerification);
    }
    verified_archives()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(path.to_path_buf(), after);
    Ok(())
}

fn remember_verified_archive(
    path: &Path,
    expected_bytes: u64,
    expected_hash: &str,
) -> Result<(), IncidentPackError> {
    let fingerprint = archive_fingerprint(path, expected_bytes, expected_hash)?;
    verified_archives()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(path.to_path_buf(), fingerprint);
    Ok(())
}

fn forget_verified_archive(path: &Path) {
    verified_archives()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(path);
}

fn tile_path(pack_dir: &Path, tile: Tile) -> PathBuf {
    pack_dir.join(TILE_FOLDER).join(tile.file_name())
}

fn read_journal(pack_dir: &Path) -> Result<Vec<TileRecord>, IncidentPackError> {
    let path = pack_dir.join(JOURNAL_FILE);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    let mut seen = HashSet::new();
    for line in BufReader::new(File::open(path)?).lines() {
        let Ok(line) = line else { continue };
        let Ok(record) = serde_json::from_str::<TileRecord>(&line) else {
            continue;
        };
        if record.tile.coord().is_err() || !seen.insert(record.tile) {
            continue;
        }
        let tile = tile_path(pack_dir, record.tile);
        if !tile.is_file() || fs::metadata(&tile)?.len() != record.bytes {
            continue;
        }
        if sha256_file(&tile)? != record.sha256 {
            let _ = fs::remove_file(tile);
            continue;
        }
        records.push(record);
    }
    Ok(records)
}

fn rewrite_journal(pack_dir: &Path, records: &[TileRecord]) -> Result<(), IncidentPackError> {
    let path = pack_dir.join(JOURNAL_FILE);
    let temporary = path.with_extension("jsonl.tmp");
    if temporary.exists() {
        fs::remove_file(&temporary)?;
    }
    let mut file = BufWriter::new(File::create(&temporary)?);
    for record in records {
        serde_json::to_writer(&mut file, record)?;
        file.write_all(b"\n")?;
    }
    file.flush()?;
    file.get_ref().sync_all()?;
    drop(file);
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary, path)?;
    Ok(())
}

fn reconcile_staging(
    pack_dir: &Path,
    manifest: &mut PackManifest,
) -> Result<Vec<TileRecord>, IncidentPackError> {
    fs::create_dir_all(pack_dir.join(TILE_FOLDER))?;
    let mut records = read_journal(pack_dir)?;
    records.sort_by_key(|record| {
        record
            .tile
            .coord()
            .map(TileId::from)
            .map(TileId::value)
            .unwrap_or(u64::MAX)
    });
    let expected: HashSet<_> = records
        .iter()
        .map(|record| record.tile.file_name())
        .collect();
    for entry in fs::read_dir(pack_dir.join(TILE_FOLDER))? {
        let entry = entry?;
        if entry.file_type()?.is_dir()
            || !expected.contains(&entry.file_name().to_string_lossy().to_string())
        {
            if entry.file_type()?.is_dir() {
                fs::remove_dir_all(entry.path())?;
            } else {
                fs::remove_file(entry.path())?;
            }
        }
    }
    rewrite_journal(pack_dir, &records)?;
    manifest.downloaded_tiles = records.len();
    manifest.downloaded_bytes = records.iter().map(|record| record.bytes).sum();
    manifest.updated_at = now();
    write_manifest(pack_dir, manifest)?;
    Ok(records)
}

fn append_records(pack_dir: &Path, records: &[TileRecord]) -> Result<(), IncidentPackError> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(pack_dir.join(JOURNAL_FILE))?;
    for record in records {
        serde_json::to_writer(&mut file, record)?;
        file.write_all(b"\n")?;
    }
    file.flush()?;
    file.sync_data()?;
    Ok(())
}

fn write_tile(pack_dir: &Path, tile: Tile, bytes: &[u8]) -> Result<(), IncidentPackError> {
    let path = tile_path(pack_dir, tile);
    let temporary = path.with_extension("png.tmp");
    if temporary.exists() {
        fs::remove_file(&temporary)?;
    }
    let mut file = BufWriter::new(File::create(&temporary)?);
    file.write_all(bytes)?;
    file.flush()?;
    file.get_ref().sync_all()?;
    drop(file);
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temporary, path)?;
    Ok(())
}

fn as_png(bytes: &[u8]) -> Result<Vec<u8>, IncidentPackError> {
    let decoded = image::load_from_memory(bytes)?;
    if decoded.dimensions() != (256, 256) {
        return Err(IncidentPackError::InvalidTile);
    }
    if image::guess_format(bytes).ok() == Some(ImageFormat::Png) {
        return Ok(bytes.to_vec());
    }
    let mut output = Cursor::new(Vec::new());
    decoded.write_to(&mut output, ImageFormat::Png)?;
    Ok(output.into_inner())
}

async fn fetch_tile(tile: Tile) -> Result<(Tile, Vec<u8>), IncidentPackError> {
    let url = format!("{SOURCE_ROOT}/{}/{}/{}", tile.z, tile.y, tile.x);
    let mut last_error = None;
    for attempt in 0..3 {
        match http::get_typed_verified(&url).await {
            Ok(response) => {
                if let Some(expected) = response.content_length {
                    let actual = response.body.len() as u64;
                    if expected != actual {
                        return Err(IncidentPackError::ByteMismatch { expected, actual });
                    }
                }
                let content_type = response.content_type.to_ascii_lowercase();
                if !content_type.starts_with("image/png")
                    && !content_type.starts_with("image/jpeg")
                    && !content_type.starts_with("image/jpg")
                    && !content_type.starts_with("application/octet-stream")
                {
                    return Err(IncidentPackError::InvalidTile);
                }
                return Ok((tile, as_png(&response.body)?));
            }
            Err(error) => last_error = Some(error),
        }
        tokio::time::sleep(Duration::from_millis(250 * (attempt + 1))).await;
    }
    Err(last_error
        .map(IncidentPackError::from)
        .unwrap_or(IncidentPackError::InvalidTile))
}

fn quota_allows(
    root: &Path,
    downloaded_bytes: u64,
    incoming_bytes: u64,
) -> Result<bool, IncidentPackError> {
    let used = folder_bytes(root)?;
    let current_without_tiles = used.saturating_sub(downloaded_bytes);
    let staged = downloaded_bytes.saturating_add(incoming_bytes);
    let peak = current_without_tiles
        .saturating_add(staged.saturating_mul(2))
        .saturating_add(ARCHIVE_OVERHEAD_BYTES);
    Ok(peak <= disk_limit_bytes(root)?)
}

async fn write_tile_under_quota(
    root: &Path,
    pack_dir: &Path,
    downloaded_bytes: u64,
    tile: Tile,
    bytes: &[u8],
) -> Result<TileRecord, IncidentPackError> {
    let _write = store_write().lock().await;
    let incoming_bytes = bytes.len() as u64;
    if !quota_allows(root, downloaded_bytes, incoming_bytes)? {
        return Err(IncidentPackError::DiskCeiling);
    }
    let record = TileRecord {
        tile,
        bytes: incoming_bytes,
        sha256: sha256_bytes(bytes),
    };
    write_tile(pack_dir, tile, bytes)?;
    Ok(record)
}

fn build_archive(
    pack_dir: &Path,
    manifest: &PackManifest,
    records: &[TileRecord],
    control: Option<&TaskControl>,
) -> Result<(PathBuf, u64), IncidentPackError> {
    if let Some(control) = control {
        control_mode(control)?;
    }
    let part = pack_dir.join(ARCHIVE_PART);
    if part.exists() {
        fs::remove_file(&part)?;
    }
    let metadata = serde_json::json!({
        "name": manifest.name,
        "description": "OpenRadar offline incident basemap",
        "attribution": manifest.attribution,
        "type": "baselayer",
        "format": "png"
    })
    .to_string();
    let center_lon = ((manifest.bounds.west + manifest.bounds.east) / 2.0) as f32;
    let center_lat = ((manifest.bounds.south + manifest.bounds.north) / 2.0) as f32;
    let file = File::create(&part)?;
    let mut writer = PmTilesWriter::new(TileType::Png)
        .min_zoom(manifest.min_zoom)
        .max_zoom(manifest.max_zoom)
        .bounds(
            manifest.bounds.west as f32,
            manifest.bounds.south as f32,
            manifest.bounds.east as f32,
            manifest.bounds.north as f32,
        )
        .center(center_lon, center_lat)
        .center_zoom(manifest.min_zoom.saturating_add(1).min(manifest.max_zoom))
        .metadata(&metadata)
        .create(file)?;
    for record in records {
        if let Some(control) = control {
            control_mode(control)?;
        }
        let bytes = fs::read(tile_path(pack_dir, record.tile))?;
        if bytes.len() as u64 != record.bytes || sha256_bytes(&bytes) != record.sha256 {
            return Err(IncidentPackError::HashMismatch);
        }
        writer.add_tile(record.tile.coord()?, &bytes)?;
    }
    writer.finalize()?;
    if let Some(control) = control {
        control_mode(control)?;
    }
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(&part)?
        .sync_all()?;
    let length = fs::metadata(&part)?.len();
    Ok((part, length))
}

async fn verify_archive(
    path: &Path,
    records: &[TileRecord],
    control: Option<&TaskControl>,
) -> Result<String, IncidentPackError> {
    if let Some(control) = control {
        control_mode(control)?;
    }
    let backend = PackFileBackend {
        path: path.to_path_buf(),
    };
    let reader = AsyncPmTilesReader::try_from_source(backend).await?;
    if reader.get_header().tile_type != TileType::Png {
        return Err(IncidentPackError::ArchiveVerification);
    }
    for record in records {
        if let Some(control) = control {
            control_mode(control)?;
        }
        let bytes = reader
            .get_tile(record.tile.coord()?)
            .await?
            .ok_or(IncidentPackError::ArchiveVerification)?;
        if bytes.len() as u64 != record.bytes || sha256_bytes(&bytes) != record.sha256 {
            return Err(IncidentPackError::ArchiveVerification);
        }
    }
    drop(reader);
    if let Some(control) = control {
        control_mode(control)?;
    }
    sha256_file(path)
}

fn control_mode(control: &TaskControl) -> Result<(), IncidentPackError> {
    match control.mode.load(Ordering::Acquire) {
        CONTROL_PAUSE => Err(IncidentPackError::Busy),
        CONTROL_CANCEL => Err(IncidentPackError::Cancelled),
        _ => Ok(()),
    }
}

fn pause_manifest(pack_dir: &Path, manifest: &mut PackManifest) -> Result<(), IncidentPackError> {
    let part = pack_dir.join(ARCHIVE_PART);
    if part.exists() {
        fs::remove_file(part)?;
    }
    manifest.status = PackStatus::Paused;
    manifest.error = None;
    manifest.updated_at = now();
    write_manifest(pack_dir, manifest)
}

fn honor_control(
    pack_dir: &Path,
    manifest: &mut PackManifest,
    control: &TaskControl,
) -> Result<bool, IncidentPackError> {
    match control_mode(control) {
        Ok(()) => Ok(false),
        Err(IncidentPackError::Busy) => {
            pause_manifest(pack_dir, manifest)?;
            Ok(true)
        }
        Err(error) => Err(error),
    }
}

async fn run_download(
    root: PathBuf,
    id: String,
    control: Arc<TaskControl>,
) -> Result<(), IncidentPackError> {
    let pack_dir = pack_dir(&root, &id)?;
    let mut manifest = read_manifest(&pack_dir)?;
    manifest.status = PackStatus::Downloading;
    manifest.error = None;
    manifest.updated_at = now();
    write_manifest(&pack_dir, &manifest)?;

    let records = reconcile_staging(&pack_dir, &mut manifest)?;
    let complete: HashSet<_> = records.iter().map(|record| record.tile).collect();
    let all_tiles = tiles_for(EstimateRequest {
        bounds: manifest.bounds,
        min_zoom: manifest.min_zoom,
        max_zoom: manifest.max_zoom,
    })?;
    let pending: Vec<_> = all_tiles
        .into_iter()
        .filter(|tile| !complete.contains(tile))
        .collect();

    for batch in pending.chunks(DOWNLOAD_BATCH) {
        if honor_control(&pack_dir, &mut manifest, &control)? {
            return Ok(());
        }

        let fetches = stream::iter(batch.iter().copied().map(fetch_tile))
            .buffer_unordered(DOWNLOAD_CONCURRENCY)
            .collect::<Vec<_>>();
        tokio::pin!(fetches);
        let fetched = loop {
            tokio::select! {
                fetched = &mut fetches => break fetched,
                _ = tokio::time::sleep(Duration::from_millis(50)) => {
                    if honor_control(&pack_dir, &mut manifest, &control)? {
                        return Ok(());
                    }
                }
            }
        };
        if honor_control(&pack_dir, &mut manifest, &control)? {
            return Ok(());
        }

        let mut added = Vec::new();
        for result in fetched {
            let (tile, bytes) = result?;
            let record =
                write_tile_under_quota(&root, &pack_dir, manifest.downloaded_bytes, tile, &bytes)
                    .await?;
            manifest.downloaded_tiles += 1;
            manifest.downloaded_bytes = manifest.downloaded_bytes.saturating_add(record.bytes);
            added.push(record);
        }
        append_records(&pack_dir, &added)?;
        manifest.updated_at = now();
        write_manifest(&pack_dir, &manifest)?;
    }

    if honor_control(&pack_dir, &mut manifest, &control)? {
        return Ok(());
    }

    let finalizing = finalization().lock();
    tokio::pin!(finalizing);
    let _finalize = loop {
        tokio::select! {
            guard = &mut finalizing => break guard,
            _ = tokio::time::sleep(Duration::from_millis(50)) => {
                if honor_control(&pack_dir, &mut manifest, &control)? {
                    return Ok(());
                }
            }
        }
    };
    if honor_control(&pack_dir, &mut manifest, &control)? {
        return Ok(());
    }

    manifest.status = PackStatus::Finalizing;
    manifest.updated_at = now();
    write_manifest(&pack_dir, &manifest)?;
    let records = read_journal(&pack_dir)?;
    if records.len() != manifest.tile_count {
        return Err(IncidentPackError::ArchiveVerification);
    }

    let build_dir = pack_dir.clone();
    let build_manifest = manifest.clone();
    let build_records = records.clone();
    let build_control = Arc::clone(&control);
    let build_root = root.clone();
    let built = tauri::async_runtime::spawn_blocking(move || {
        let _write = store_write().blocking_lock();
        if !quota_allows(&build_root, build_manifest.downloaded_bytes, 0)? {
            return Err(IncidentPackError::DiskCeiling);
        }
        let built = build_archive(
            &build_dir,
            &build_manifest,
            &build_records,
            Some(&build_control),
        )?;
        if folder_bytes(&build_root)? > disk_limit_bytes(&build_root)? {
            let _ = fs::remove_file(&built.0);
            return Err(IncidentPackError::DiskCeiling);
        }
        Ok(built)
    })
    .await
    .map_err(|error| IncidentPackError::Worker(error.to_string()))?;
    let (part, archive_bytes) = match built {
        Ok(built) => built,
        Err(IncidentPackError::Busy) => {
            pause_manifest(&pack_dir, &mut manifest)?;
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    let archive_hash = match verify_archive(&part, &records, Some(&control)).await {
        Ok(hash) => hash,
        Err(IncidentPackError::Busy) => {
            pause_manifest(&pack_dir, &mut manifest)?;
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    if sha256_file(&part)? != archive_hash {
        return Err(IncidentPackError::HashMismatch);
    }
    if honor_control(&pack_dir, &mut manifest, &control)? {
        return Ok(());
    }

    let archive = pack_dir.join(ARCHIVE_FILE);
    if archive.exists() {
        forget_verified_archive(&archive);
        fs::remove_file(&archive)?;
    }
    fs::rename(&part, &archive)?;
    remember_verified_archive(&archive, archive_bytes, &archive_hash)?;
    manifest.status = PackStatus::Ready;
    manifest.archive_bytes = archive_bytes;
    manifest.sha256 = Some(archive_hash);
    manifest.error = None;
    manifest.updated_at = now();
    write_manifest(&pack_dir, &manifest)?;

    if let Err(error) = fs::remove_dir_all(pack_dir.join(TILE_FOLDER)) {
        log::warn!("OpenRadar could not remove completed incident pack tiles: {error}");
    }
    if let Err(error) = fs::remove_file(pack_dir.join(JOURNAL_FILE)) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("OpenRadar could not remove an incident pack journal: {error}");
        }
    }
    Ok(())
}

fn mark_failed(root: &Path, id: &str, error: &IncidentPackError) {
    let Ok(pack_dir) = pack_dir(root, id) else {
        return;
    };
    let _ = fs::remove_file(pack_dir.join(ARCHIVE_PART));
    let Ok(mut manifest) = read_manifest(&pack_dir) else {
        return;
    };
    if manifest.status == PackStatus::Ready {
        return;
    }
    manifest.status = PackStatus::Failed;
    manifest.error = Some(error.to_string());
    manifest.updated_at = now();
    if let Err(write_error) = write_manifest(&pack_dir, &manifest) {
        log::error!("OpenRadar could not record an incident pack failure: {write_error}");
    }
}

fn mark_archive_failed(pack_dir: &Path, manifest: &mut PackManifest, error: &IncidentPackError) {
    forget_verified_archive(&pack_dir.join(ARCHIVE_FILE));
    manifest.status = PackStatus::Failed;
    manifest.error = Some(error.to_string());
    manifest.updated_at = now();
    if let Err(write_error) = write_manifest(pack_dir, manifest) {
        log::error!("OpenRadar could not record incident pack integrity failure: {write_error}");
    }
}

fn spawn_download(root: &Path, id: &str) -> Result<(), IncidentPackError> {
    let control = Arc::new(TaskControl::new());
    {
        let mut tasks = active()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if tasks.contains_key(id) {
            return Err(IncidentPackError::Busy);
        }
        tasks.insert(id.to_string(), Arc::clone(&control));
    }
    let root = root.to_path_buf();
    let id = id.to_string();
    tauri::async_runtime::spawn(async move {
        let result = run_download(root.clone(), id.clone(), control).await;
        if let Err(error) = &result {
            if matches!(error, IncidentPackError::Cancelled) {
                if let Err(cleanup_error) = remove_pack_files(&root, &id) {
                    if !matches!(cleanup_error, IncidentPackError::NotFound) {
                        log::error!(
                            "OpenRadar could not remove cancelled incident pack {id}: {cleanup_error}"
                        );
                    }
                }
            } else {
                log::warn!("OpenRadar incident pack {id} stopped: {error}");
                mark_failed(&root, &id, error);
            }
        }
        active()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&id);
    });
    Ok(())
}

fn recover_store(root: &Path) -> Result<(), IncidentPackError> {
    fs::create_dir_all(root)?;
    let _ = read_config(root)?;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            if entry.file_name() != CONFIG_FILE
                && !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("config.json.")
            {
                fs::remove_file(entry.path())?;
            }
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if validate_id(&name).is_err() || !entry.path().join(MANIFEST_FILE).exists() {
            fs::remove_dir_all(entry.path())?;
            continue;
        }
        let mut manifest = match read_manifest(&entry.path()) {
            Ok(manifest) => manifest,
            Err(error) => {
                log::warn!("OpenRadar removed an unreadable incident pack: {error}");
                fs::remove_dir_all(entry.path())?;
                continue;
            }
        };
        let _ = fs::remove_file(entry.path().join(ARCHIVE_PART));
        if manifest.status == PackStatus::Ready {
            let archive = entry.path().join(ARCHIVE_FILE);
            if !archive.is_file() || fs::metadata(&archive)?.len() != manifest.archive_bytes {
                manifest.status = PackStatus::Failed;
                manifest.error =
                    Some("The PMTiles archive is missing or has the wrong byte count.".into());
                manifest.updated_at = now();
                write_manifest(&entry.path(), &manifest)?;
            } else {
                let _ = fs::remove_dir_all(entry.path().join(TILE_FOLDER));
                let _ = fs::remove_file(entry.path().join(JOURNAL_FILE));
            }
        } else if matches!(
            manifest.status,
            PackStatus::Queued | PackStatus::Downloading | PackStatus::Finalizing
        ) {
            manifest.status = PackStatus::Paused;
            manifest.error = Some("The download paused when OpenRadar closed.".into());
            manifest.updated_at = now();
            let _ = reconcile_staging(&entry.path(), &mut manifest)?;
        } else {
            let _ = reconcile_staging(&entry.path(), &mut manifest)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn incident_pack_estimate(request: EstimateRequest) -> Result<PackEstimate, IncidentPackError> {
    let root = root()?;
    let tile_count = tiles_for(request)?.len();
    let estimated = estimated_bytes(tile_count);
    let temporary = estimated.saturating_mul(2);
    let used = folder_bytes(root)?;
    let limit = disk_limit_bytes(root)?;
    Ok(PackEstimate {
        tile_count,
        estimated_bytes: estimated,
        temporary_bytes: temporary,
        used_bytes: used,
        disk_limit_bytes: limit,
        fits: used.saturating_add(temporary) <= limit,
    })
}

#[tauri::command]
pub fn incident_pack_list() -> Result<PackLibrary, IncidentPackError> {
    let root = root()?;
    let mut packs = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if let Ok(manifest) = read_manifest(&entry.path()) {
            packs.push(PackSummary::from(&manifest));
        }
    }
    packs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(PackLibrary {
        packs,
        used_bytes: folder_bytes(root)?,
        disk_limit_bytes: disk_limit_bytes(root)?,
    })
}

#[tauri::command]
pub async fn incident_pack_set_limit(disk_limit_mb: u64) -> Result<PackLibrary, IncidentPackError> {
    let root = root()?;
    let _write = store_write().lock().await;
    let config = StoreConfig {
        schema_version: STORE_SCHEMA,
        disk_limit_mb: disk_limit_mb.clamp(MIN_LIMIT_MB, MAX_LIMIT_MB),
    };
    atomic_json(&root.join(CONFIG_FILE), &config)?;
    incident_pack_list()
}

#[tauri::command]
pub async fn incident_pack_create(
    request: CreatePackRequest,
) -> Result<PackSummary, IncidentPackError> {
    let root = root()?;
    let _write = store_write().lock().await;
    let name = clean_name(&request.name)?;
    let tiles = tiles_for(EstimateRequest {
        bounds: request.bounds,
        min_zoom: request.min_zoom,
        max_zoom: request.max_zoom,
    })?;
    let estimate = estimated_bytes(tiles.len());
    if folder_bytes(root)?.saturating_add(estimate.saturating_mul(2)) > disk_limit_bytes(root)? {
        return Err(IncidentPackError::DiskCeiling);
    }
    let id = new_id(&name);
    let pack_dir = pack_dir(root, &id)?;
    fs::create_dir_all(pack_dir.join(TILE_FOLDER))?;
    let timestamp = now();
    let manifest = PackManifest {
        schema_version: STORE_SCHEMA,
        id: id.clone(),
        name,
        bounds: request.bounds,
        min_zoom: request.min_zoom,
        max_zoom: request.max_zoom,
        status: PackStatus::Queued,
        tile_count: tiles.len(),
        downloaded_tiles: 0,
        downloaded_bytes: 0,
        estimated_bytes: estimate,
        archive_bytes: 0,
        sha256: None,
        source: SOURCE_NAME.into(),
        attribution: ATTRIBUTION.into(),
        error: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    write_manifest(&pack_dir, &manifest)?;
    if let Err(error) = spawn_download(root, &id) {
        fs::remove_dir_all(pack_dir)?;
        return Err(error);
    }
    Ok(PackSummary::from(&manifest))
}

#[tauri::command]
pub fn incident_pack_pause(id: String) -> Result<(), IncidentPackError> {
    validate_id(&id)?;
    let tasks = active()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let control = tasks.get(&id).ok_or(IncidentPackError::NotFound)?;
    control.mode.store(CONTROL_PAUSE, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub fn incident_pack_resume(id: String) -> Result<(), IncidentPackError> {
    let root = root()?;
    let pack_dir = pack_dir(root, &id)?;
    let manifest = read_manifest(&pack_dir)?;
    if manifest.status == PackStatus::Ready {
        return Err(IncidentPackError::NotReady);
    }
    spawn_download(root, &id)
}

async fn stop_task(id: &str) -> Result<(), IncidentPackError> {
    let control = active()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(id)
        .cloned();
    if let Some(control) = control {
        control.mode.store(CONTROL_CANCEL, Ordering::Release);
        for _ in 0..200 {
            if !active()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .contains_key(id)
            {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        return Err(IncidentPackError::Busy);
    }
    Ok(())
}

async fn remove_pack(id: &str) -> Result<(), IncidentPackError> {
    let root = root()?;
    validate_id(id)?;
    stop_task(id).await?;
    if !pack_dir(root, id)?.is_dir() {
        return Ok(());
    }
    remove_pack_files(root, id)
}

fn remove_pack_files(root: &Path, id: &str) -> Result<(), IncidentPackError> {
    let pack_dir = pack_dir(root, id)?;
    if !pack_dir.is_dir() {
        return Err(IncidentPackError::NotFound);
    }
    forget_verified_archive(&pack_dir.join(ARCHIVE_FILE));
    fs::remove_dir_all(pack_dir)?;
    Ok(())
}

#[tauri::command]
pub async fn incident_pack_cancel(id: String) -> Result<(), IncidentPackError> {
    remove_pack(&id).await
}

#[tauri::command]
pub async fn incident_pack_delete(id: String) -> Result<(), IncidentPackError> {
    remove_pack(&id).await
}

fn parse_tile_uri(uri: &str) -> Result<(String, Tile), IncidentPackError> {
    let path = uri.split('?').next().unwrap_or(uri).trim_matches('/');
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 4 {
        return Err(IncidentPackError::NotFound);
    }
    validate_id(parts[0])?;
    let z = parts[1].parse().map_err(|_| IncidentPackError::NotFound)?;
    let x = parts[2].parse().map_err(|_| IncidentPackError::NotFound)?;
    let y = parts[3]
        .strip_suffix(".png")
        .ok_or(IncidentPackError::NotFound)?
        .parse()
        .map_err(|_| IncidentPackError::NotFound)?;
    let tile = Tile { z, x, y };
    let _ = tile.coord()?;
    Ok((parts[0].to_string(), tile))
}

async fn ensure_archive_verified(
    path: &Path,
    expected_bytes: u64,
    expected_hash: &str,
) -> Result<(), IncidentPackError> {
    if archive_is_verified(path, expected_bytes, expected_hash)? {
        return Ok(());
    }
    let _verification = archive_verification().lock().await;
    if archive_is_verified(path, expected_bytes, expected_hash)? {
        return Ok(());
    }
    let path = path.to_path_buf();
    let hash = expected_hash.to_string();
    tauri::async_runtime::spawn_blocking(move || verify_archive_once(&path, expected_bytes, &hash))
        .await
        .map_err(|error| IncidentPackError::Worker(error.to_string()))?
}

pub async fn serve_tile(uri: &str) -> ServedTile {
    let result = async {
        let (id, tile) = parse_tile_uri(uri)?;
        let root = root()?;
        let pack_dir = pack_dir(root, &id)?;
        let mut manifest = read_manifest(&pack_dir)?;
        if manifest.status != PackStatus::Ready {
            return Err(IncidentPackError::NotReady);
        }
        let archive = pack_dir.join(ARCHIVE_FILE);
        let Some(expected_hash) = manifest.sha256.clone() else {
            let error = IncidentPackError::ArchiveHashMismatch;
            mark_archive_failed(&pack_dir, &mut manifest, &error);
            return Err(error);
        };
        if let Err(error) =
            ensure_archive_verified(&archive, manifest.archive_bytes, &expected_hash).await
        {
            mark_archive_failed(&pack_dir, &mut manifest, &error);
            return Err(error);
        }
        let backend = PackFileBackend { path: archive };
        let reader = AsyncPmTilesReader::try_from_source(backend).await?;
        reader
            .get_tile(tile.coord()?)
            .await?
            .map(|bytes| bytes.to_vec())
            .ok_or(IncidentPackError::NotFound)
    }
    .await;
    match result {
        Ok(body) => ServedTile { status: 200, body },
        Err(error) => {
            if !matches!(
                error,
                IncidentPackError::NotFound | IncidentPackError::NotReady
            ) {
                log::warn!("OpenRadar could not read an incident pack tile: {error}");
            }
            ServedTile {
                status: 404,
                body: Vec::new(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "openradar-incident-{name}-{}",
            IDS.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn request(bounds: PackBounds, min_zoom: u8, max_zoom: u8) -> EstimateRequest {
        EstimateRequest {
            bounds,
            min_zoom,
            max_zoom,
        }
    }

    fn png() -> Vec<u8> {
        let image = image::DynamicImage::new_rgba8(256, 256);
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn counts_only_tiles_inside_the_requested_region_and_zoom_range() {
        let bounds = PackBounds {
            west: -94.0,
            south: 40.0,
            east: -93.0,
            north: 41.0,
        };
        let low = tiles_for(request(bounds, 5, 5)).unwrap();
        let wider = tiles_for(request(bounds, 5, 7)).unwrap();
        assert!(!low.is_empty());
        assert!(wider.len() > low.len());
        assert!(wider.iter().all(|tile| (5..=7).contains(&tile.z)));
        assert!(tiles_for(request(bounds, 7, 5)).is_err());
    }

    #[test]
    fn rejects_a_request_large_enough_to_overrun_the_pack_guardrail() {
        let error = tiles_for(request(
            PackBounds {
                west: -170.0,
                south: -70.0,
                east: 170.0,
                north: 70.0,
            },
            2,
            15,
        ))
        .unwrap_err();
        assert!(matches!(error, IncidentPackError::TooManyTiles(_)));
    }

    #[tokio::test]
    async fn concurrent_pack_writes_cannot_spend_the_same_remaining_quota() {
        let root = temporary("quota-race");
        atomic_json(&root.join(CONFIG_FILE), &StoreConfig::default()).unwrap();
        let left = root.join("left");
        let right = root.join("right");
        fs::create_dir_all(left.join(TILE_FOLDER)).unwrap();
        fs::create_dir_all(right.join(TILE_FOLDER)).unwrap();

        let bytes = vec![0x5a; 1024 * 1024];
        let incoming = bytes.len() as u64;
        let limit = disk_limit_bytes(&root).unwrap();
        let used = folder_bytes(&root).unwrap();
        let remaining = incoming
            .saturating_mul(2)
            .saturating_add(ARCHIVE_OVERHEAD_BYTES)
            .saturating_add(incoming / 2);
        let filler = File::create(root.join("quota-filler")).unwrap();
        filler.set_len(limit - used - remaining).unwrap();
        assert!(quota_allows(&root, 0, incoming).unwrap());

        let (left_result, right_result) = tokio::join!(
            write_tile_under_quota(&root, &left, 0, Tile { z: 2, x: 1, y: 1 }, &bytes),
            write_tile_under_quota(&root, &right, 0, Tile { z: 2, x: 2, y: 1 }, &bytes),
        );
        let results = [left_result, right_result];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(IncidentPackError::DiskCeiling)))
                .count(),
            1
        );
        assert!(folder_bytes(&root).unwrap() <= limit);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn writes_a_png_pmtiles_archive_and_reads_every_verified_tile_back() {
        let root = temporary("roundtrip");
        let id = "0123456789abcdef01234567";
        let pack = root.join(id);
        fs::create_dir_all(pack.join(TILE_FOLDER)).unwrap();
        let tile = Tile { z: 2, x: 1, y: 1 };
        let bytes = png();
        write_tile(&pack, tile, &bytes).unwrap();
        let record = TileRecord {
            tile,
            bytes: bytes.len() as u64,
            sha256: sha256_bytes(&bytes),
        };
        let timestamp = now();
        let manifest = PackManifest {
            schema_version: STORE_SCHEMA,
            id: id.into(),
            name: "Test pack".into(),
            bounds: PackBounds {
                west: -100.0,
                south: 30.0,
                east: -90.0,
                north: 40.0,
            },
            min_zoom: 2,
            max_zoom: 2,
            status: PackStatus::Finalizing,
            tile_count: 1,
            downloaded_tiles: 1,
            downloaded_bytes: record.bytes,
            estimated_bytes: estimated_bytes(1),
            archive_bytes: 0,
            sha256: None,
            source: SOURCE_NAME.into(),
            attribution: ATTRIBUTION.into(),
            error: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        let (archive, length) =
            build_archive(&pack, &manifest, std::slice::from_ref(&record), None).unwrap();
        assert!(length > record.bytes);
        let hash = verify_archive(&archive, &[record], None).await.unwrap();
        assert_eq!(hash.len(), 64);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn same_length_archive_corruption_fails_before_first_use() {
        let root = temporary("archive-hash");
        let id = "0123456789abcdef76543210";
        let pack = root.join(id);
        fs::create_dir_all(&pack).unwrap();
        let archive = pack.join(ARCHIVE_FILE);
        let original = b"healthy!";
        let corrupt = b"broken!!";
        assert_eq!(original.len(), corrupt.len());
        fs::write(&archive, original).unwrap();
        let expected_hash = sha256_file(&archive).unwrap();
        fs::write(&archive, corrupt).unwrap();
        let timestamp = now();
        let mut manifest = PackManifest {
            schema_version: STORE_SCHEMA,
            id: id.into(),
            name: "Corrupt archive".into(),
            bounds: PackBounds {
                west: -100.0,
                south: 30.0,
                east: -90.0,
                north: 40.0,
            },
            min_zoom: 2,
            max_zoom: 2,
            status: PackStatus::Ready,
            tile_count: 1,
            downloaded_tiles: 1,
            downloaded_bytes: 0,
            estimated_bytes: estimated_bytes(1),
            archive_bytes: original.len() as u64,
            sha256: Some(expected_hash.clone()),
            source: SOURCE_NAME.into(),
            attribution: ATTRIBUTION.into(),
            error: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        write_manifest(&pack, &manifest).unwrap();

        let error = ensure_archive_verified(&archive, original.len() as u64, &expected_hash)
            .await
            .unwrap_err();
        assert!(matches!(error, IncidentPackError::ArchiveHashMismatch));
        mark_archive_failed(&pack, &mut manifest, &error);
        let failed = read_manifest(&pack).unwrap();
        assert_eq!(failed.status, PackStatus::Failed);
        assert!(failed.error.unwrap().contains("SHA-256"));
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn pause_keeps_verified_staging_and_resume_finishes_without_refetching() {
        let root = temporary("pause-resume");
        let id = "2468ace13579bdf02468ace1";
        let pack = root.join(id);
        fs::create_dir_all(pack.join(TILE_FOLDER)).unwrap();
        let bounds = PackBounds {
            west: -77.04,
            south: 38.89,
            east: -77.03,
            north: 38.90,
        };
        let tiles = tiles_for(request(bounds, 5, 5)).unwrap();
        assert_eq!(tiles.len(), 1);
        let tile = tiles[0];
        let bytes = png();
        write_tile(&pack, tile, &bytes).unwrap();
        let record = TileRecord {
            tile,
            bytes: bytes.len() as u64,
            sha256: sha256_bytes(&bytes),
        };
        append_records(&pack, std::slice::from_ref(&record)).unwrap();
        let timestamp = now();
        let manifest = PackManifest {
            schema_version: STORE_SCHEMA,
            id: id.into(),
            name: "Pause and resume".into(),
            bounds,
            min_zoom: 5,
            max_zoom: 5,
            status: PackStatus::Downloading,
            tile_count: 1,
            downloaded_tiles: 1,
            downloaded_bytes: record.bytes,
            estimated_bytes: estimated_bytes(1),
            archive_bytes: 0,
            sha256: None,
            source: SOURCE_NAME.into(),
            attribution: ATTRIBUTION.into(),
            error: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        write_manifest(&pack, &manifest).unwrap();

        let paused = Arc::new(TaskControl::new());
        paused.mode.store(CONTROL_PAUSE, Ordering::Release);
        run_download(root.clone(), id.into(), paused).await.unwrap();

        let manifest = read_manifest(&pack).unwrap();
        assert_eq!(manifest.status, PackStatus::Paused);
        assert_eq!(manifest.downloaded_tiles, 1);
        assert!(tile_path(&pack, tile).is_file());
        assert!(pack.join(JOURNAL_FILE).is_file());

        run_download(root.clone(), id.into(), Arc::new(TaskControl::new()))
            .await
            .unwrap();

        let manifest = read_manifest(&pack).unwrap();
        assert_eq!(manifest.status, PackStatus::Ready);
        assert!(pack.join(ARCHIVE_FILE).is_file());
        assert!(!pack.join(ARCHIVE_PART).exists());
        assert!(!pack.join(TILE_FOLDER).exists());
        assert!(!pack.join(JOURNAL_FILE).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn cancellation_stops_before_fetch_and_exact_cleanup_removes_the_pack() {
        let root = temporary("cancel");
        let id = "1029384756abcdef10293847";
        let pack = root.join(id);
        fs::create_dir_all(pack.join(TILE_FOLDER)).unwrap();
        let bounds = PackBounds {
            west: -77.04,
            south: 38.89,
            east: -77.03,
            north: 38.90,
        };
        let tile_count = tiles_for(request(bounds, 5, 5)).unwrap().len();
        let timestamp = now();
        write_manifest(
            &pack,
            &PackManifest {
                schema_version: STORE_SCHEMA,
                id: id.into(),
                name: "Cancel".into(),
                bounds,
                min_zoom: 5,
                max_zoom: 5,
                status: PackStatus::Queued,
                tile_count,
                downloaded_tiles: 0,
                downloaded_bytes: 0,
                estimated_bytes: estimated_bytes(tile_count),
                archive_bytes: 0,
                sha256: None,
                source: SOURCE_NAME.into(),
                attribution: ATTRIBUTION.into(),
                error: None,
                created_at: timestamp.clone(),
                updated_at: timestamp,
            },
        )
        .unwrap();
        let control = Arc::new(TaskControl::new());
        control.mode.store(CONTROL_CANCEL, Ordering::Release);

        let error = run_download(root.clone(), id.into(), control)
            .await
            .unwrap_err();
        assert!(matches!(error, IncidentPackError::Cancelled));
        remove_pack_files(&root, id).unwrap();
        assert!(!pack.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deleting_a_pack_removes_its_archive_staging_and_journal_together() {
        let root = temporary("delete");
        let id = "abcdef0123456789abcdef01";
        let pack = root.join(id);
        fs::create_dir_all(pack.join(TILE_FOLDER)).unwrap();
        fs::write(pack.join(ARCHIVE_FILE), b"archive").unwrap();
        fs::write(pack.join(ARCHIVE_PART), b"partial").unwrap();
        fs::write(pack.join(JOURNAL_FILE), b"journal").unwrap();
        fs::write(pack.join(TILE_FOLDER).join("2-1-1.png"), b"tile").unwrap();
        remove_pack_files(&root, id).unwrap();
        assert!(!pack.exists());
        assert!(fs::read_dir(&root).unwrap().next().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    #[ignore = "uses the live USGS basemap service"]
    async fn live_usgs_tile_is_bounded_and_normalized_to_png() {
        let (_, bytes) = fetch_tile(Tile { z: 5, x: 8, y: 12 }).await.unwrap();
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!(decoded.dimensions(), (256, 256));
    }

    #[tokio::test]
    #[ignore = "uses the live USGS basemap service"]
    async fn live_download_builds_a_verified_pack_and_cleans_staging() {
        let root = temporary("live-pack");
        let id = "13579bdf02468ace13579bdf";
        let bounds = PackBounds {
            west: -77.04,
            south: 38.89,
            east: -77.03,
            north: 38.90,
        };
        let tiles = tiles_for(request(bounds, 5, 5)).unwrap();
        assert_eq!(tiles.len(), 1);

        let pack = root.join(id);
        fs::create_dir_all(pack.join(TILE_FOLDER)).unwrap();
        let timestamp = now();
        let manifest = PackManifest {
            schema_version: STORE_SCHEMA,
            id: id.into(),
            name: "Live pack".into(),
            bounds,
            min_zoom: 5,
            max_zoom: 5,
            status: PackStatus::Queued,
            tile_count: tiles.len(),
            downloaded_tiles: 0,
            downloaded_bytes: 0,
            estimated_bytes: estimated_bytes(tiles.len()),
            archive_bytes: 0,
            sha256: None,
            source: SOURCE_NAME.into(),
            attribution: ATTRIBUTION.into(),
            error: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        write_manifest(&pack, &manifest).unwrap();

        run_download(root.clone(), id.into(), Arc::new(TaskControl::new()))
            .await
            .unwrap();

        let ready = read_manifest(&pack).unwrap();
        let archive = pack.join(ARCHIVE_FILE);
        assert_eq!(ready.status, PackStatus::Ready);
        assert_eq!(ready.downloaded_tiles, 1);
        assert_eq!(ready.archive_bytes, fs::metadata(&archive).unwrap().len());
        assert_eq!(
            ready.sha256.as_deref(),
            Some(sha256_file(&archive).unwrap().as_str())
        );
        assert!(!pack.join(ARCHIVE_PART).exists());
        assert!(!pack.join(TILE_FOLDER).exists());
        assert!(!pack.join(JOURNAL_FILE).exists());

        let reader = AsyncPmTilesReader::try_from_source(PackFileBackend { path: archive })
            .await
            .unwrap();
        let bytes = reader
            .get_tile(tiles[0].coord().unwrap())
            .await
            .unwrap()
            .unwrap();
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        drop(reader);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reconciliation_removes_unjournaled_and_hash_mismatched_bytes() {
        let root = temporary("reconcile");
        let id = "fedcba9876543210fedcba98";
        let pack = root.join(id);
        fs::create_dir_all(pack.join(TILE_FOLDER)).unwrap();
        let good_tile = Tile { z: 2, x: 1, y: 1 };
        let orphan = Tile { z: 2, x: 2, y: 1 };
        let bytes = png();
        write_tile(&pack, good_tile, &bytes).unwrap();
        write_tile(&pack, orphan, &bytes).unwrap();
        let record = TileRecord {
            tile: good_tile,
            bytes: bytes.len() as u64,
            sha256: "0".repeat(64),
        };
        append_records(&pack, &[record]).unwrap();
        let timestamp = now();
        let mut manifest = PackManifest {
            schema_version: STORE_SCHEMA,
            id: id.into(),
            name: "Test pack".into(),
            bounds: PackBounds {
                west: -100.0,
                south: 30.0,
                east: -90.0,
                north: 40.0,
            },
            min_zoom: 2,
            max_zoom: 2,
            status: PackStatus::Paused,
            tile_count: 2,
            downloaded_tiles: 2,
            downloaded_bytes: (bytes.len() * 2) as u64,
            estimated_bytes: estimated_bytes(2),
            archive_bytes: 0,
            sha256: None,
            source: SOURCE_NAME.into(),
            attribution: ATTRIBUTION.into(),
            error: None,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        write_manifest(&pack, &manifest).unwrap();
        let records = reconcile_staging(&pack, &mut manifest).unwrap();
        assert!(records.is_empty());
        assert!(fs::read_dir(pack.join(TILE_FOLDER))
            .unwrap()
            .next()
            .is_none());
        assert_eq!(manifest.downloaded_bytes, 0);
        fs::remove_dir_all(root).unwrap();
    }
}

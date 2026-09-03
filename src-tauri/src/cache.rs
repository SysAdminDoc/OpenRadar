//! A cache on disk, so the last view is still there when the network is not.
//!
//! Everything the map draws over a network is a tile or a small JSON document,
//! and all of it is public and immutable once published. Keeping the bytes
//! means a launch with no connection opens on the last loop the user saw
//! instead of an empty map.
//!
//! Two properties matter more than speed here. A half-written entry must never
//! be readable, so every file is written beside its name and renamed into
//! place. And a cache written by an older build must never be read by a newer
//! one, so the format carries a version in its directory name and anything
//! else is deleted on startup.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Bumped whenever the entry format changes. Old directories are removed.
const VERSION: &str = "v1";
/// Enough for several screens of tiles at a few zoom levels, plus the small
/// documents the overlays are drawn from.
const MAX_ENTRIES: usize = 2_048;
const MAX_BYTES: u64 = 256 * 1024 * 1024;
/// A single entry larger than this is not worth the room it would take.
const MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;
const MAGIC: &[u8; 4] = b"ORC1";

#[derive(Debug, Clone)]
pub struct Entry {
    pub body: Vec<u8>,
    pub content_type: String,
    /// How long ago the bytes were fetched, which the caller shows the user.
    pub age: Duration,
}

#[derive(Debug, Clone, Copy)]
struct Held {
    stored_at: u64,
    /// Where this entry sits among the ones written since startup. Whole
    /// seconds are far too coarse to order tiles by, and evicting in an
    /// arbitrary order inside a second would drop the tile just fetched.
    written: u64,
    bytes: u64,
}

static WRITES: AtomicU64 = AtomicU64::new(0);

fn next_write() -> u64 {
    WRITES.fetch_add(1, Ordering::Relaxed)
}

/// The budget, which the tests turn down so they can fill it.
fn limits() -> (usize, u64) {
    #[cfg(test)]
    {
        let entries = TEST_MAX_ENTRIES.load(Ordering::Relaxed);
        if entries != 0 {
            return (entries as usize, TEST_MAX_BYTES.load(Ordering::Relaxed));
        }
    }
    (MAX_ENTRIES, MAX_BYTES)
}

#[cfg(test)]
static TEST_MAX_ENTRIES: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_MAX_BYTES: AtomicU64 = AtomicU64::new(0);

struct State {
    root: PathBuf,
    held: HashMap<String, Held>,
}

static STATE: OnceLock<Mutex<Option<State>>> = OnceLock::new();

fn state() -> &'static Mutex<Option<State>> {
    STATE.get_or_init(|| Mutex::new(None))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0)
}

/// A short stable name for an address. Collisions are not a correctness
/// problem: the full address is written into the entry and checked on the way
/// out, so a collision costs a refetch rather than the wrong picture.
fn key(url: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in url.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Points the cache at a directory and reads what is already there.
///
/// Called once at startup. Anything under a different version is a format this
/// build cannot read, so it goes.
pub fn init(base: &Path) {
    let root = base.join("cache").join(VERSION);
    if let Err(error) = fs::create_dir_all(&root) {
        log::warn!("OpenRadar could not open its cache directory: {error}");
        return;
    }
    remove_other_versions(&base.join("cache"));

    let mut held = HashMap::new();
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("bin") {
                // A temporary file from an interrupted write, which is not an
                // entry and never will be.
                let _ = fs::remove_file(&path);
                continue;
            }
            let Some(name) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            let Ok(meta) = entry.metadata() else { continue };
            let stored_at = meta
                .modified()
                .ok()
                .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
                .map(|since| since.as_secs())
                .unwrap_or(0);
            held.insert(
                name.to_string(),
                Held {
                    stored_at,
                    written: next_write(),
                    bytes: meta.len(),
                },
            );
        }
    }

    let mut guard = state().lock().unwrap_or_else(|held| held.into_inner());
    *guard = Some(State { root, held });
    drop(guard);
    evict();
}

fn remove_other_versions(base: &Path) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().and_then(|name| name.to_str()) == Some(VERSION) {
            continue;
        }
        if let Err(error) = fs::remove_dir_all(&path) {
            log::warn!("OpenRadar could not clear an old cache directory: {error}");
        }
    }
}

/// The bytes held for an address, if any, with how old they are.
pub fn get(url: &str) -> Option<Entry> {
    let name = key(url);
    let path = {
        let guard = state().lock().ok()?;
        let held = guard.as_ref()?;
        if !held.held.contains_key(&name) {
            return None;
        }
        held.root.join(format!("{name}.bin"))
    };

    let raw = fs::read(&path).ok()?;
    let (stored_url, content_type, stored_at, body) = decode(&raw)?;
    // The address is checked rather than trusted, so a name collision is a
    // miss rather than the wrong tile.
    if stored_url != url {
        return None;
    }
    Some(Entry {
        body,
        content_type,
        age: Duration::from_secs(now_secs().saturating_sub(stored_at)),
    })
}

/// Reads without tying up an async runtime worker on filesystem I/O.
pub async fn get_async(url: &str) -> Option<Entry> {
    let url = url.to_string();
    match tauri::async_runtime::spawn_blocking(move || get(&url)).await {
        Ok(entry) => entry,
        Err(error) => {
            log::warn!("OpenRadar's cache read worker failed: {error}");
            None
        }
    }
}

/// Keeps the bytes for an address, replacing anything already held for it.
pub fn put(url: &str, content_type: &str, body: &[u8]) {
    if body.len() > MAX_ENTRY_BYTES {
        return;
    }
    let name = key(url);
    let root = {
        let Ok(guard) = state().lock() else { return };
        let Some(held) = guard.as_ref() else { return };
        held.root.clone()
    };

    let stored_at = now_secs();
    let encoded = encode(url, content_type, stored_at, body);
    // The temporary name has to be this writer's alone. Two panes asking for
    // the same tile at once land here in the same second, and a shared name
    // means one truncates the other's buffer and the rename publishes the
    // pieces.
    let temporary = root.join(format!(
        "{name}.{}.{}.tmp",
        std::process::id(),
        next_write()
    ));
    // Written beside the entry and renamed, so a reader never sees half a file
    // and a crash mid-write leaves the old entry intact.
    let written = fs::File::create(&temporary).and_then(|mut file| {
        file.write_all(&encoded)?;
        file.sync_all()
    });
    if let Err(error) = written {
        log::warn!("OpenRadar could not write a cache entry: {error}");
        let _ = fs::remove_file(&temporary);
        return;
    }
    if let Err(error) = fs::rename(&temporary, root.join(format!("{name}.bin"))) {
        log::warn!("OpenRadar could not store a cache entry: {error}");
        let _ = fs::remove_file(&temporary);
        return;
    }

    if let Ok(mut guard) = state().lock() {
        if let Some(held) = guard.as_mut() {
            held.held.insert(
                name,
                Held {
                    stored_at,
                    written: next_write(),
                    bytes: encoded.len() as u64,
                },
            );
        }
    }
    evict();
}

/// Writes, flushes, renames, and evicts on a blocking worker rather than on
/// the async runtime that is also carrying network responses and commands.
pub async fn put_async(url: &str, content_type: &str, body: &[u8]) {
    if body.len() > MAX_ENTRY_BYTES {
        return;
    }
    let url = url.to_string();
    let content_type = content_type.to_string();
    let body = body.to_vec();
    if let Err(error) =
        tauri::async_runtime::spawn_blocking(move || put(&url, &content_type, &body)).await
    {
        log::warn!("OpenRadar's cache write worker failed: {error}");
    }
}

/// Drops the oldest entries until the cache is back inside its budget.
fn evict() {
    let mut guard = match state().lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let Some(held) = guard.as_mut() else { return };

    let (max_entries, max_bytes) = limits();
    let mut total: u64 = held.held.values().map(|entry| entry.bytes).sum();
    if held.held.len() <= max_entries && total <= max_bytes {
        return;
    }

    let mut ordered: Vec<(String, Held)> = held
        .held
        .iter()
        .map(|(name, entry)| (name.clone(), *entry))
        .collect();
    ordered.sort_by_key(|(_, entry)| (entry.stored_at, entry.written));

    for (name, entry) in ordered {
        if held.held.len() <= max_entries && total <= max_bytes {
            break;
        }
        let _ = fs::remove_file(held.root.join(format!("{name}.bin")));
        held.held.remove(&name);
        total = total.saturating_sub(entry.bytes);
    }
}

/// How much the cache is holding, in entries and bytes.
///
/// Read from the index rather than by walking the directory: the index is
/// what eviction works from, and a number taken from somewhere else could
/// disagree with the one the budget is enforced against.
pub fn size() -> (usize, u64) {
    let guard = match state().lock() {
        Ok(guard) => guard,
        Err(held) => held.into_inner(),
    };
    match guard.as_ref() {
        Some(held) => (
            held.held.len(),
            held.held.values().map(|entry| entry.bytes).sum(),
        ),
        None => (0, 0),
    }
}

/// Empties the cache and says how much came back.
///
/// Only the cache's own version directory. Incident packs and replay bundles
/// live beside it under the same data directory and are a reader's own
/// downloads: a button called Clear cache that took those away would be a
/// button nobody could risk pressing.
///
/// Entries are removed from the index as their files go, so a failure part of
/// the way through leaves the index describing what is actually still there
/// rather than claiming an empty cache over a full directory.
pub fn clear() -> (usize, u64) {
    let mut guard = match state().lock() {
        Ok(guard) => guard,
        Err(held) => held.into_inner(),
    };
    let Some(held) = guard.as_mut() else {
        return (0, 0);
    };
    let mut removed = 0usize;
    let mut freed = 0u64;
    for (name, entry) in std::mem::take(&mut held.held) {
        match fs::remove_file(held.root.join(format!("{name}.bin"))) {
            Ok(()) => {
                removed += 1;
                freed += entry.bytes;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // Gone already, which is the same outcome from here.
                removed += 1;
                freed += entry.bytes;
            }
            Err(error) => {
                log::warn!("OpenRadar could not remove a cached entry: {error}");
                held.held.insert(name, entry);
            }
        }
    }
    (removed, freed)
}

/// What the cache is holding, for the panel that offers to empty it.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSize {
    pub entries: usize,
    pub bytes: u64,
}

#[tauri::command]
pub async fn cache_size() -> CacheSize {
    // Off the interface thread, like every other command that touches the
    // disk. Reading the index is fast, but the lock it takes is held by
    // whichever tile is being written, and a settings panel that stutters
    // while the map loads is a settings panel nobody trusts.
    tauri::async_runtime::spawn_blocking(|| {
        let (entries, bytes) = size();
        CacheSize { entries, bytes }
    })
    .await
    .unwrap_or(CacheSize {
        entries: 0,
        bytes: 0,
    })
}

#[tauri::command]
pub async fn cache_clear() -> CacheSize {
    // What was removed, not what is left: the panel says how much came back.
    tauri::async_runtime::spawn_blocking(|| {
        let (entries, bytes) = clear();
        CacheSize { entries, bytes }
    })
    .await
    .unwrap_or(CacheSize {
        entries: 0,
        bytes: 0,
    })
}

fn encode(url: &str, content_type: &str, stored_at: u64, body: &[u8]) -> Vec<u8> {
    let header = serde_json::json!({
        "url": url,
        "contentType": content_type,
        "storedAt": stored_at,
    })
    .to_string();
    let header = header.as_bytes();
    let mut out = Vec::with_capacity(MAGIC.len() + 4 + header.len() + body.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(header);
    out.extend_from_slice(body);
    out
}

fn decode(raw: &[u8]) -> Option<(String, String, u64, Vec<u8>)> {
    if raw.len() < MAGIC.len() + 4 || &raw[..MAGIC.len()] != MAGIC {
        return None;
    }
    let mut length = [0u8; 4];
    length.copy_from_slice(&raw[MAGIC.len()..MAGIC.len() + 4]);
    let length = u32::from_le_bytes(length) as usize;
    let start = MAGIC.len() + 4;
    let end = start.checked_add(length)?;
    if end > raw.len() {
        return None;
    }
    let header: serde_json::Value = serde_json::from_slice(&raw[start..end]).ok()?;
    Some((
        header.get("url")?.as_str()?.to_string(),
        header
            .get("contentType")
            .and_then(|value| value.as_str())
            .unwrap_or("application/octet-stream")
            .to_string(),
        header.get("storedAt").and_then(|value| value.as_u64())?,
        raw[end..].to_vec(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tests share one process-wide cache, so they take turns.
    fn turn() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "openradar-cache-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("a clock after 1970")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("a scratch directory");
        dir
    }

    #[test]
    fn keeps_bytes_across_a_restart() {
        let _turn = turn();
        let dir = scratch("restart");
        init(&dir);
        put("https://example.test/tile.png", "image/png", b"the tile");

        // A restart reads what is on disk rather than what is in memory.
        init(&dir);
        let held = get("https://example.test/tile.png").expect("the entry survived");
        assert_eq!(held.body, b"the tile");
        assert_eq!(held.content_type, "image/png");
        assert!(held.age < Duration::from_secs(60));

        assert!(get("https://example.test/other.png").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn clearing_empties_the_cache_and_leaves_the_reader_s_own_downloads() {
        let _turn = turn();
        let dir = scratch("clear");
        init(&dir);

        // A reader's own downloads, beside the cache under the same data
        // directory. A Clear cache button that took these away would be one
        // nobody could risk pressing: a pack is a deliberate download for a
        // place with no network, and a bundle is a replay somebody saved.
        let packs = dir.join("incident-packs-v1");
        let bundles = dir.join("bundles");
        fs::create_dir_all(&packs).expect("a pack directory");
        fs::create_dir_all(&bundles).expect("a bundle directory");
        fs::write(packs.join("a-pack.pmtiles"), vec![b'P'; 4096]).expect("a pack");
        fs::write(bundles.join("a-replay.zip"), vec![b'B'; 2048]).expect("a bundle");

        put(
            "https://example.test/one.png",
            "image/png",
            b"the first tile",
        );
        put(
            "https://example.test/two.png",
            "image/png",
            &vec![b'T'; 1000],
        );
        let (entries, bytes) = size();
        assert_eq!(entries, 2);
        assert!(bytes > 1000, "{bytes}");

        let (removed, freed) = clear();
        assert_eq!(removed, 2);
        assert_eq!(freed, bytes, "the bytes reported back are the bytes held");
        assert_eq!(size(), (0, 0));
        assert!(get("https://example.test/one.png").is_none());
        assert!(get("https://example.test/two.png").is_none());
        // The directory itself stays, so the next tile has somewhere to go.
        let root = dir.join("cache").join(VERSION);
        assert_eq!(fs::read_dir(&root).expect("the cache directory").count(), 0);

        // Untouched, both of them.
        assert_eq!(
            fs::read(packs.join("a-pack.pmtiles"))
                .expect("the pack")
                .len(),
            4096
        );
        assert_eq!(
            fs::read(bundles.join("a-replay.zip"))
                .expect("the bundle")
                .len(),
            2048
        );

        // And the cache works afterwards rather than needing a restart.
        put(
            "https://example.test/three.png",
            "image/png",
            b"a tile after",
        );
        assert_eq!(
            get("https://example.test/three.png")
                .expect("the entry after clearing")
                .body,
            b"a tile after"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn async_wrappers_round_trip_an_entry() {
        let _turn = turn();
        let dir = scratch("async");
        init(&dir);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("an async cache test runtime");

        let held = runtime.block_on(async {
            put_async(
                "https://example.test/async.png",
                "image/png",
                b"the asynchronous tile",
            )
            .await;
            get_async("https://example.test/async.png").await
        });

        let held = held.expect("the async cache entry");
        assert_eq!(held.body, b"the asynchronous tile");
        assert_eq!(held.content_type, "image/png");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cache_from_another_format_is_thrown_away() {
        let _turn = turn();
        let dir = scratch("version");
        let old = dir.join("cache").join("v0");
        fs::create_dir_all(&old).expect("an old cache directory");
        fs::write(old.join("whatever.bin"), b"unreadable").expect("an old entry");

        init(&dir);
        assert!(
            !old.exists(),
            "a cache this build cannot read was left on disk"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn half_written_entries_are_not_readable() {
        let _turn = turn();
        let dir = scratch("torn");
        init(&dir);
        put("https://example.test/tile.png", "image/png", b"the tile");

        // What a crash mid-write leaves behind: a temporary file, and the
        // entry it was going to replace still whole.
        let root = dir.join("cache").join(VERSION);
        fs::write(root.join("deadbeefdeadbeef.tmp"), b"half a file").expect("a torn write");
        init(&dir);
        assert_eq!(
            get("https://example.test/tile.png")
                .expect("the old entry is still there")
                .body,
            b"the tile"
        );
        assert!(
            !root.join("deadbeefdeadbeef.tmp").exists(),
            "a temporary file was left to be read as an entry"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_collision_is_a_miss_rather_than_the_wrong_tile() {
        let _turn = turn();
        let dir = scratch("collision");
        init(&dir);
        let root = dir.join("cache").join(VERSION);

        // Written by hand under another address's name, which is what a hash
        // collision would look like from the reader's side.
        let mine = "https://example.test/mine.png";
        let theirs = "https://example.test/theirs.png";
        fs::write(
            root.join(format!("{}.bin", key(mine))),
            encode(theirs, "image/png", now_secs(), b"not mine"),
        )
        .expect("a planted entry");
        init(&dir);

        assert!(
            get(mine).is_none(),
            "another address's bytes were served under this one"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_body_too_big_to_be_worth_keeping_is_not_kept() {
        let _turn = turn();
        let dir = scratch("big");
        init(&dir);
        put(
            "https://example.test/huge.bin",
            "application/octet-stream",
            &vec![0u8; MAX_ENTRY_BYTES + 1],
        );
        assert!(get("https://example.test/huge.bin").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_oldest_entries_go_when_the_cache_is_full() {
        let _turn = turn();
        let dir = scratch("evict");
        // A budget small enough to fill, exercising the same code the real one
        // runs through.
        TEST_MAX_ENTRIES.store(4, Ordering::Relaxed);
        TEST_MAX_BYTES.store(MAX_BYTES, Ordering::Relaxed);
        init(&dir);

        for index in 0..7 {
            put(
                &format!("https://example.test/{index}.png"),
                "image/png",
                b"tile",
            );
        }

        let count = {
            let guard = state().lock().expect("the index");
            guard.as_ref().expect("an open cache").held.len()
        };
        assert_eq!(count, 4, "the cache grew past its limit");
        // The three oldest went, in the order they were written, and the ones
        // fetched most recently are the ones still there.
        for index in 0..3 {
            assert!(
                get(&format!("https://example.test/{index}.png")).is_none(),
                "an old entry was kept over a newer one"
            );
        }
        for index in 3..7 {
            assert!(
                get(&format!("https://example.test/{index}.png")).is_some(),
                "a recently fetched entry was evicted"
            );
        }

        TEST_MAX_ENTRIES.store(0, Ordering::Relaxed);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_full_cache_by_weight_drops_the_oldest_too() {
        let _turn = turn();
        let dir = scratch("weight");
        TEST_MAX_ENTRIES.store(1_000, Ordering::Relaxed);
        TEST_MAX_BYTES.store(4_096, Ordering::Relaxed);
        init(&dir);

        for index in 0..6 {
            put(
                &format!("https://example.test/{index}.png"),
                "image/png",
                &vec![0u8; 1_024],
            );
        }

        let total: u64 = {
            let guard = state().lock().expect("the index");
            guard
                .as_ref()
                .expect("an open cache")
                .held
                .values()
                .map(|entry| entry.bytes)
                .sum()
        };
        assert!(
            total <= 4_096,
            "the cache held {total} bytes, past its 4096 byte budget"
        );
        assert!(get("https://example.test/0.png").is_none());
        assert!(get("https://example.test/5.png").is_some());

        TEST_MAX_ENTRIES.store(0, Ordering::Relaxed);
        TEST_MAX_BYTES.store(0, Ordering::Relaxed);
        let _ = fs::remove_dir_all(&dir);
    }
}

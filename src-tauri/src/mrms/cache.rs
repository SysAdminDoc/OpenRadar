//! The decoded grids, and the byte budget that decides how many are kept.
//!
//! One grid is a hundred megabytes and a busy screen wants several, so
//! this is a bound rather than a convenience: what it evicts is what
//! keeps the app inside the memory a desktop can spare.

use super::*;

pub(crate) struct CachedGrid {
    pub(crate) key: String,
    pub(crate) grid: Grid,
    /// How much the grid was folded by on the way in. One is unfolded, which
    /// is the only thing that answers a request for detail.
    pub(crate) reduce: usize,
}

pub(crate) static CACHE: Mutex<VecDeque<CachedGrid>> = Mutex::new(VecDeque::new());

pub(crate) struct CachedTile {
    pub(crate) key: String,
    pub(crate) bytes: Vec<u8>,
}

pub(crate) static TILES: Mutex<VecDeque<CachedTile>> = Mutex::new(VecDeque::new());

/// Only one grid is fetched and decoded at a time. A screen of tiles all miss
/// the cache at once, and without this every one of them would download and
/// decode the same fifty megabytes.
pub(crate) static DECODING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(test)]
pub static FETCHES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[cfg(test)]
pub static DECODES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
pub(crate) fn is_cached(key: &str) -> bool {
    cached_reduction(key).is_some()
}

/// How folded the grid in hand for this key is, if there is one.
pub(crate) fn cached_reduction(key: &str) -> Option<usize> {
    CACHE.lock().ok().and_then(|cache| {
        cache
            .iter()
            .find(|entry| entry.key == key)
            .map(|entry| entry.reduce)
    })
}

/// Whether what is in hand already answers this request.
///
/// A request for detail is answered only by an unfolded grid. Everything else
/// is answered by whatever is there: a finer grid draws a coarse request
/// perfectly well, it just cost more to get.
pub(crate) fn cached_enough(key: &str, detail: bool) -> bool {
    match cached_reduction(key) {
        Some(reduce) => !detail || reduce == 1,
        None => false,
    }
}

/// How many of the oldest grids have to go, given what each of them holds.
///
/// Split out from the cache so the arithmetic can be read against real grid
/// sizes without a test allocating a gigabyte to see it happen. The budget is
/// the only rule: what the cache promises a busy screen is kept by the budget
/// being large enough for one, which is the const assertion beside
/// `BUSY_SCREEN`, and not by refusing to evict.
pub(crate) fn evict_count(sizes: &[usize], budget: usize) -> usize {
    let mut held: usize = sizes.iter().sum();
    let mut gone = 0;
    // One is always kept: a grid larger than the whole budget is still the
    // grid somebody is looking at, and evicting it would mean decoding it
    // again for the next tile of the same screen.
    while held > budget && sizes.len() - gone > 1 {
        held -= sizes[gone];
        gone += 1;
    }
    gone
}

/// Fetches and decodes a grid, or hands back the one already in hand.
///
/// A screen of tiles arrives as a dozen concurrent misses on the same grid, so
/// the fetch and the decode are behind a gate and the cache is checked again on
/// the other side of it. Without that, one screen downloads and decodes the
/// same fifty megabytes a dozen times over.
pub async fn grid_for(key: &str, detail: bool) -> Result<(), MrmsError> {
    if cached_enough(key, detail) {
        return Ok(());
    }
    let _gate = DECODING.lock().await;
    // Whoever was ahead in the queue may have been fetching this very grid.
    if cached_enough(key, detail) {
        return Ok(());
    }

    #[cfg(test)]
    FETCHES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let bytes = http::get_bytes(&format!("{BUCKET}/{key}")).await?;
    let owned = key.to_string();
    let ceiling = if detail {
        MAX_DETAIL_POINTS
    } else {
        MAX_GRID_POINTS
    };
    let (grid, reduce) = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(test)]
        DECODES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let plain = gunzip(&bytes)?;
        decode_grib_to_fit(&plain, ceiling)
    })
    .await
    .map_err(|error| MrmsError::Decode(error.to_string()))??;

    remember_grid(&owned, grid, reduce);
    Ok(())
}

/// Puts a decoded grid in the cache, dropping the oldest to stay in budget.
///
/// A finer grid replaces the folded one it supersedes rather than sitting
/// beside it: they are the same ground, and holding both would pay for the
/// same country twice. A folded one never replaces a finer one, because the
/// reader who asked for the detail is still looking at it.
pub(crate) fn remember_grid(key: &str, grid: Grid, reduce: usize) {
    remember_grid_within(key, grid, reduce, CACHE_BUDGET_BYTES);
}

/// The same, against a budget said out loud.
///
/// Only so the eviction can be watched happening without a test allocating the
/// better part of a gigabyte of real grids to cross the real ceiling.
pub(crate) fn remember_grid_within(key: &str, grid: Grid, reduce: usize, budget: usize) {
    let Ok(mut cache) = CACHE.lock() else {
        return;
    };
    if let Some(at) = cache.iter().position(|entry| entry.key == key) {
        if cache[at].reduce <= reduce {
            return;
        }
        cache.remove(at);
    }
    cache.push_back(CachedGrid {
        key: key.to_string(),
        grid,
        reduce,
    });
    let sizes: Vec<usize> = cache.iter().map(|entry| entry.grid.bytes()).collect();
    for _ in 0..evict_count(&sizes, budget) {
        cache.pop_front();
    }
}

/// How many points the grid in hand for this key holds, for the tests that
/// need to tell one grid from another without reading it.
#[cfg(test)]
pub(crate) fn grid_points(key: &str) -> Option<usize> {
    CACHE.lock().ok().and_then(|cache| {
        cache
            .iter()
            .find(|entry| entry.key == key)
            .map(|entry| entry.grid.samples.len())
    })
}

/// Drops the decoded grids but keeps the drawn tiles, so a test can prove a
/// tile came from the tile cache rather than from a fresh decode.
#[cfg(test)]
pub fn clear_grid_cache() {
    if let Ok(mut cache) = CACHE.lock() {
        cache.clear();
    }
}

#[cfg(test)]
pub fn clear_caches() {
    if let Ok(mut cache) = CACHE.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = TILES.lock() {
        cache.clear();
    }
}

#[cfg(test)]
#[path = "cache_tests.rs"]
mod tests;

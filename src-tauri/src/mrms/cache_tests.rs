use super::*;
use crate::mrms::testing::*;

/// What the cache drops, read against grids the size they really are.
///
/// The arithmetic on its own, because watching it happen through
/// `remember_grid` at these sizes would mean a test allocating the better
/// part of a gigabyte to see one eviction.
#[test]
fn the_budget_is_the_bound_and_a_busy_screen_fits_inside_it() {
    // A busy screen at its worst: both shear grids unfolded and coarse
    // ones filling the rest. Nothing goes, because it fits.
    let mut busy = vec![FINE_GRID_BYTES; FINE_PRODUCTS.len()];
    busy.resize(BUSY_SCREEN, GRID_BYTES);
    assert!(
        busy.iter().sum::<usize>() <= CACHE_BUDGET_BYTES,
        "the budget is too small for the screen it promises to hold"
    );
    assert_eq!(
        evict_count(&busy, CACHE_BUDGET_BYTES),
        0,
        "a busy screen lost a grid it was about to want"
    );

    // A replay of one fine product, which is what a floor of entries
    // could not see: the cache is keyed by bucket object and a loop has
    // one object per frame, so nine of them were nine unfolded grids and
    // 1.6 GB against a ceiling of 768 MiB. The budget is a bound now.
    let replay = vec![FINE_GRID_BYTES; BUSY_SCREEN];
    let gone = evict_count(&replay, CACHE_BUDGET_BYTES);
    let held: usize = replay[gone..].iter().sum();
    assert!(
        held <= CACHE_BUDGET_BYTES,
        "a loop of the biggest grids held {held} against a budget of {CACHE_BUDGET_BYTES}"
    );

    // The oldest go, enough of them to fit and not one more.
    let mut crowded = vec![GRID_BYTES; BUSY_SCREEN + 8];
    crowded[0] = FINE_GRID_BYTES;
    let gone = evict_count(&crowded, CACHE_BUDGET_BYTES);
    assert!(
        gone > 0,
        "the cache grew past its budget instead of evicting"
    );
    let kept: usize = crowded[gone..].iter().sum();
    assert!(
        kept <= CACHE_BUDGET_BYTES,
        "eviction stopped short of the budget"
    );
    let one_fewer: usize = crowded[gone - 1..].iter().sum();
    assert!(
        one_fewer > CACHE_BUDGET_BYTES,
        "one more grid went than had to"
    );

    // One is always kept, however big. A grid past the whole budget is
    // still the grid somebody is looking at, and dropping it would mean
    // decoding it again for the next tile of the same screen.
    assert_eq!(
        evict_count(&[CACHE_BUDGET_BYTES * 2], CACHE_BUDGET_BYTES),
        0
    );

    // A cache that already fits drops nothing.
    assert_eq!(evict_count(&[GRID_BYTES], CACHE_BUDGET_BYTES), 0);
    assert_eq!(evict_count(&[], CACHE_BUDGET_BYTES), 0);
}

/// A finer grid takes the folded one's place rather than sitting beside it.
#[test]
fn the_unfolded_grid_replaces_the_folded_one_and_not_the_other_way_round() {
    let _turn = live_test();
    clear_caches();
    let grid = |points: usize| Grid {
        columns: points,
        rows: 1,
        north: 41.0,
        west: -94.0,
        d_lat: 0.01,
        d_lon: 0.01,
        reference: -9990.0,
        binary: 0,
        decimal: 1,
        samples: vec![10_500; points],
    };

    remember_grid("shear", grid(1), 2);
    // Folded, so a reader who has zoomed in is not answered from it.
    assert!(is_cached("shear"));
    assert!(!cached_enough("shear", true));

    remember_grid("shear", grid(4), 1);
    assert!(cached_enough("shear", true));
    assert_eq!(grid_points("shear"), Some(4), "both grids were kept");

    // And the folded one does not come back over it: the reader who asked
    // for the detail is still looking at it.
    remember_grid("shear", grid(1), 2);
    assert_eq!(grid_points("shear"), Some(4));
    assert!(cached_enough("shear", true));
    clear_caches();
}

/// One screen is a dozen tiles arriving at once, all wanting the same
/// fifty megabyte grid. Live, because the cost being measured is a real
/// download and a real decode.
#[test]
#[ignore = "fetches a live grid from the MRMS archive"]
fn a_screen_of_tiles_pays_for_the_grid_once() {
    let _turn = live_test();
    use std::sync::atomic::Ordering;

    clear_caches();
    FETCHES.store(0, Ordering::Relaxed);
    DECODES.store(0, Ordering::Relaxed);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .expect("a runtime");
    let frames = runtime
        .block_on(mrms_frames("composite".into(), 1, None, None))
        .expect("MRMS publishes grids");
    let time = frames.last().expect("a frame").time;

    // The tiles MapLibre asks for to cover the country at zoom four.
    let wanted: Vec<String> = (2..=5)
        .flat_map(|x| (5..=6).map(move |y| format!("/composite/{time}/4/{x}/{y}.png")))
        .collect();
    assert_eq!(wanted.len(), 8);

    let started = std::time::Instant::now();
    let tiles = runtime.block_on(async {
        let mut work = Vec::new();
        for path in wanted.clone() {
            work.push(tauri::async_runtime::spawn(async move {
                serve_tile(&path).await
            }));
        }
        let mut out = Vec::new();
        for handle in work {
            out.push(handle.await.expect("a tile"));
        }
        out
    });
    let took = started.elapsed();

    let fetches = FETCHES.load(Ordering::Relaxed);
    let decodes = DECODES.load(Ordering::Relaxed);
    println!(
        "{} tiles, {fetches} fetches, {decodes} decodes, {took:?}",
        tiles.len()
    );
    assert_eq!(fetches, 1, "the grid was downloaded {fetches} times");
    assert_eq!(decodes, 1, "the grid was decoded {decodes} times");
    assert!(tiles.iter().all(|bytes| &bytes[1..4] == b"PNG"));

    // Asking again is answered from the drawn tiles, with no grid at all.
    clear_grid_cache();
    let again = runtime.block_on(serve_tile(&wanted[0]));
    assert_eq!(
        FETCHES.load(Ordering::Relaxed),
        1,
        "a drawn tile was redrawn"
    );
    assert_eq!(again, tiles[0]);
}

/// Which products walk their cells and which sample per pixel is not a
/// detail: a five-minute lightning grid sampled per pixel draws an empty
/// map, and a full reflectivity field walked cell by cell is slower for no
/// gain.
/// Every product on the map wants one grid live, and a slot each is what
/// keeps a screen from downloading the country once per layer. Half a
/// gigabyte only holds ten of them, so past that the budget wins and the
/// cache is as large as the memory allows rather than as large as the
/// product list. That is a real limit, not a rounding: a decoded CONUS grid
/// is fifty megabytes.
///
/// The arithmetic itself is held by the `const _: () = assert!(...)` guards
/// beside the constants, which fail the build rather than a test run. What
/// is left to watch here is the eviction: that the cache drops the oldest
/// grid instead of growing past the budget it was given.
#[test]
fn the_cache_evicts_rather_than_growing_past_its_budget() {
    let _turn = live_test();
    clear_caches();
    let grid = || Grid {
        columns: 1,
        rows: 1,
        north: 41.0,
        west: -94.0,
        d_lat: 0.01,
        d_lon: 0.01,
        reference: -9990.0,
        binary: 0,
        decimal: 1,
        samples: vec![10_500],
    };
    // A busy screen: every layer somebody actually has on at once, and
    // the composite loop's next frame beside them. None of these may be
    // evicted before the screen is drawn, which is the whole of what the
    // cache promises.
    let busy: Vec<String> = (0..BUSY_SCREEN).map(|at| format!("layer {at}")).collect();
    for id in &busy {
        remember_grid(id, grid(), 1);
    }
    for id in &busy {
        assert!(
            is_cached(id),
            "{id}'s grid was evicted before the screen was drawn"
        );
    }

    // Past the budget the oldest goes rather than the cache growing. The
    // budget is handed in rather than taken from the constant, because
    // these grids are two bytes each and a test that allocated enough of
    // the real thing to cross 768 MB would be allocating most of a
    // gigabyte to watch one eviction. What is being read here is the
    // wiring: that the cache asks, and drops what it is told to drop.
    let tight = grid().bytes() * BUSY_SCREEN;
    for extra in 0..4 {
        remember_grid_within(&format!("extra {extra}"), grid(), 1, tight);
    }
    assert!(
        !is_cached(&busy[0]),
        "the cache grew past its budget instead of evicting"
    );
    assert!(is_cached("extra 3"));
    clear_caches();
}

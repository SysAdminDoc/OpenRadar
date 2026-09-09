use super::*;
use crate::mrms::testing::*;

#[test]
fn a_window_holds_the_cells_the_view_touches() {
    remember_grid("window/whole", countable_grid(), 1);
    // A box inside the grid, running from the centre of (row 1, column 1)
    // to the centre of (row 3, column 3). A cell counts when the box
    // touches any of it, so all nine come back rather than only the ones
    // whose centres are strictly inside.
    let cut =
        grid_window("window/whole", -99.0, 37.0, -97.0, 39.0, 100).expect("the box is on the grid");
    assert_eq!((cut.columns, cut.rows), (3, 3));
    assert_eq!(
        cut.values,
        vec![11.0, 12.0, 13.0, 21.0, 22.0, 23.0, 31.0, 32.0, 33.0]
    );
    // The corner is the outer edge of the first cell, not its centre,
    // which is what a raster's tie point means. Half a cell north-west of
    // the centre of (1, 1) at -99, 39.
    assert!((cut.west + 99.5).abs() < 1e-9, "west {}", cut.west);
    assert!((cut.north - 39.5).abs() < 1e-9, "north {}", cut.north);
    assert_eq!((cut.d_lon, cut.d_lat), (1.0, 1.0));
}

#[test]
fn a_window_takes_the_cells_the_box_is_actually_over() {
    remember_grid("window/offset", countable_grid(), 1);
    // A box whose corners fall inside cells rather than on their centres,
    // which is every real view. Cell c covers centre plus or minus half a
    // cell, so -98.4 is inside column 2 (which spans -98.5 to -97.5) and
    // -96.6 is inside column 3. Reading the corners as cell edges instead
    // pulls in column 1 and column 4 as well: two columns of data west and
    // east of anything the reader asked for.
    let cut = grid_window("window/offset", -98.4, 36.6, -96.6, 38.4, 100)
        .expect("the box is on the grid");
    assert_eq!((cut.columns, cut.rows), (2, 2));
    assert_eq!(cut.values, vec![22.0, 23.0, 32.0, 33.0]);
    assert!((cut.west + 98.5).abs() < 1e-9, "west {}", cut.west);
    assert!((cut.north - 38.5).abs() < 1e-9, "north {}", cut.north);
}

#[test]
fn a_window_stops_at_the_edge_of_the_grid() {
    remember_grid("window/edge", countable_grid(), 1);
    // Asking for the whole world gets the whole grid and no more, rather
    // than rows of nothing padded out to the box.
    let cut = grid_window("window/edge", -180.0, -90.0, 180.0, 90.0, 100)
        .expect("the grid is inside the world");
    assert_eq!((cut.columns, cut.rows), (5, 4));
    assert_eq!(cut.values.len(), 20);
    assert_eq!(cut.values[0], 0.0);
    assert_eq!(cut.values[19], 34.0);

    // A box beside the grid rather than on it.
    assert_eq!(
        grid_window("window/edge", -80.0, 37.0, -70.0, 39.0, 100).err(),
        Some(WindowError::Outside)
    );
    // And one nobody has decoded.
    assert_eq!(
        grid_window("window/never-fetched", -99.0, 37.0, -97.0, 39.0, 100).err(),
        Some(WindowError::NotCached)
    );
}

#[test]
fn a_window_too_large_is_refused_before_it_is_built() {
    remember_grid("window/large", countable_grid(), 1);
    assert_eq!(
        grid_window("window/large", -180.0, -90.0, 180.0, 90.0, 19).err(),
        Some(WindowError::TooLarge(20))
    );
    // One cell more of headroom and the same ask goes through.
    assert!(grid_window("window/large", -180.0, -90.0, 180.0, 90.0, 20).is_ok());
}

/// The same export whatever the reader had been looking at.
///
/// A window read off an unfolded grid is four times the cells of the same
/// window read off the folded one: the same product for the same moment
/// over the same box came out at one cell size or another, or was refused
/// as too large, depending only on whether the reader had zoomed in
/// first. A file nobody can reproduce.
#[test]
fn an_export_is_the_same_file_whichever_grid_is_in_hand() {
    let _turn = live_test();
    clear_caches();

    // The same ground twice: the grid as the network publishes it, and
    // the grid the decoder makes of it when nobody is zoomed in.
    let fine = ramp_grid(16, 16, 0.005);
    let coarse = folded_like_the_decoder(&fine, 2);

    remember_grid("shear/whole", coarse, 2);
    let folded = grid_window("shear/whole", -94.0, 40.0, -93.9, 40.1, 4_000_000)
        .expect("a window off the folded grid");

    clear_caches();
    remember_grid("shear/whole", fine, 1);
    let whole = grid_window("shear/whole", -94.0, 40.0, -93.9, 40.1, 4_000_000)
        .expect("a window off the unfolded grid");

    assert_eq!(
        (whole.columns, whole.rows),
        (folded.columns, folded.rows),
        "the same box came out a different size"
    );
    assert!(
        (whole.d_lat - folded.d_lat).abs() < 1e-9,
        "the exported cell size followed the cache rather than the product"
    );
    assert_eq!(
        whole.values, folded.values,
        "the readings changed with what happened to be cached"
    );
    // And on the same ground. A raster's corner is its tie point, and two
    // files of the same readings at the same cell size, georeferenced a
    // few hundred metres apart, disagree about where the weather was.
    assert!(
        (whole.west - folded.west).abs() < 1e-9,
        "the exported corner moved with the cache: {} against {}",
        whole.west,
        folded.west
    );
    assert!(
        (whole.north - folded.north).abs() < 1e-9,
        "the exported corner moved with the cache: {} against {}",
        whole.north,
        folded.north
    );
    clear_caches();
}

/// A window that does not start or end on a block boundary.
///
/// The fold has to be made of the grid's own blocks, not of blocks
/// counted from wherever the box happened to begin. Otherwise a window
/// starting on an odd row summarises a different set of source cells than
/// one starting on an even row, and the last block of each row summarises
/// fewer cells than the decoder's fold did, which understates a rotation
/// track exactly at the edge of the raster somebody asked for.
#[test]
fn a_folded_window_is_made_of_the_grid_s_own_blocks() {
    let _turn = live_test();
    clear_caches();

    let fine = ramp_grid(16, 16, 0.005);
    let coarse = folded_like_the_decoder(&fine, 2);
    // A box whose edges fall inside cells rather than on them, and whose
    // span is not a whole number of folded cells.
    // Edges inside cells rather than on them, and an odd number of
    // source cells across and down, so the last block of each row and
    // column reaches past the box and has to be read out of the grid
    // rather than clamped to the window.
    let box_of = |key: &str| grid_window(key, -93.987, 40.05, -93.95, 40.098, 4_000_000);

    remember_grid("shear/odd", coarse, 2);
    let folded = box_of("shear/odd").expect("a window off the folded grid");
    clear_caches();
    remember_grid("shear/odd", fine, 1);
    let whole = box_of("shear/odd").expect("a window off the unfolded grid");

    assert_eq!(
        (whole.columns, whole.rows),
        (folded.columns, folded.rows),
        "an unaligned box came out a different size"
    );
    assert_eq!(
        whole.values, folded.values,
        "an unaligned box read different cells depending on the cache"
    );
    assert!((whole.west - folded.west).abs() < 1e-9);
    assert!((whole.north - folded.north).abs() < 1e-9);

    // Every block is the full one, the last of each row included: read
    // back out of the source grid rather than compared with another
    // folded copy, so a fold that clamped its blocks to the window would
    // show up as a short block here even if both copies clamped alike.
    let fine = ramp_grid(16, 16, 0.005);
    let block_column = ((whole.west + fine.d_lon / 2.0 - fine.west) / fine.d_lon).round();
    let block_row = ((fine.north - whole.north + fine.d_lat / 2.0) / fine.d_lat).round();
    for row in 0..whole.rows {
        for column in 0..whole.columns {
            let mut most = f32::NEG_INFINITY;
            for down in 0..2 {
                for across in 0..2 {
                    let source_row = (block_row as usize + row * 2 + down).min(fine.rows - 1);
                    let source_column =
                        (block_column as usize + column * 2 + across).min(fine.columns - 1);
                    most = most.max(fine.value(source_row, source_column));
                }
            }
            assert_eq!(
                whole.values[row * whole.columns + column],
                most,
                "block {row},{column} summarised fewer source cells than the whole block"
            );
        }
    }
    clear_caches();
}

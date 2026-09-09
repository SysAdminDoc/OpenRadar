//! The cells under a box, for an export that reads values rather than
//! pixels.

use super::*;

/// The part of a decoded grid inside a bounding box, as floats.
///
/// `west` and `north` are the outer edges of the corner cell rather than its
/// centre, because that is what a raster's tie point means. The grid itself
/// records centres, so the half cell is added here once instead of in every
/// reader.
#[derive(Debug)]
pub struct GridWindow {
    pub columns: usize,
    pub rows: usize,
    pub west: f64,
    pub north: f64,
    pub d_lon: f64,
    pub d_lat: f64,
    /// Row major from the north-west corner. A cell the grid does not cover
    /// is NaN; nothing else is altered, so the values the product reserves for
    /// missing and for outside coverage arrive as the numbers they are.
    pub values: Vec<f32>,
}

/// Why a window could not be cut.
#[derive(Debug, PartialEq, Eq)]
pub enum WindowError {
    /// The grid is not decoded, which means nobody drew it.
    NotCached,
    /// The box and the grid do not overlap at all.
    Outside,
    /// More cells than the caller allowed, so it can say to zoom in rather
    /// than write a raster nobody can open.
    TooLarge(usize),
}

/// Cuts a cached grid to a bounding box.
///
/// The size is worked out before a single sample is read, so an over-large ask
/// costs nothing and never allocates the raster it refused.
pub fn grid_window(
    key: &str,
    west: f64,
    south: f64,
    east: f64,
    north: f64,
    max_cells: usize,
) -> Result<GridWindow, WindowError> {
    let cache = CACHE.lock().map_err(|_| WindowError::NotCached)?;
    let grid = &cache
        .iter()
        .find(|held| held.key == key)
        .ok_or(WindowError::NotCached)?
        .grid;
    // Folded to the grid this app draws at, if what is in hand is finer.
    //
    // What is in hand depends on where the reader had been looking, and a
    // file whose cell size and whose cell count turn on that is a file
    // nobody can reproduce: the same product for the same moment over the
    // same box came out at 1201 by 1201 or refused as too large. Folded by
    // the same rule the decoder uses on the way in, the largest of each
    // block, so the two answers are the same numbers either way.
    let fold = fold_to_drawn(grid);

    // Column and row indices of the cells the box touches, clamped to the
    // grid. The grid's north and west are cell CENTRES, so cell c covers
    // centre ± half a cell and the first one the box touches is the first
    // whose far edge is past the box's near edge. Reading these as edges
    // instead pulls in an extra cell of data on each side, which is a raster
    // wider than the view it claims to be.
    let first_column = ((west - grid.west) / grid.d_lon + 0.5).ceil() - 1.0;
    let last_column = ((east - grid.west) / grid.d_lon - 0.5).floor() + 1.0;
    let first_row = ((grid.north - north) / grid.d_lat + 0.5).ceil() - 1.0;
    let last_row = ((grid.north - south) / grid.d_lat - 0.5).floor() + 1.0;
    if last_column < 0.0
        || last_row < 0.0
        || first_column > (grid.columns - 1) as f64
        || first_row > (grid.rows - 1) as f64
    {
        return Err(WindowError::Outside);
    }
    let first_column = first_column.max(0.0) as usize;
    let first_row = first_row.max(0.0) as usize;
    let last_column = (last_column as usize).min(grid.columns - 1);
    let last_row = (last_row as usize).min(grid.rows - 1);

    // Snapped back to the grid's own block boundaries, so a folded window is
    // made of the same blocks the decoder would have made. Folded from
    // wherever the box happened to start, a window beginning on an odd row
    // summarised a different set of source cells than one beginning on an
    // even row, and the same ground came out as two different rasters.
    let first_column = first_column - first_column % fold;
    let first_row = first_row - first_row % fold;

    // Counted after the fold, because that is the file: the same product for
    // the same moment over the same box has to come out the same size
    // whether or not the reader had zoomed in far enough to be shown the
    // finer grid.
    let columns = (last_column - first_column).div_euclid(fold) + 1;
    let rows = (last_row - first_row).div_euclid(fold) + 1;
    let cells = columns * rows;
    if cells > max_cells {
        return Err(WindowError::TooLarge(cells));
    }

    let mut values = Vec::with_capacity(cells);
    for row in (first_row..=last_row).step_by(fold) {
        for column in (first_column..=last_column).step_by(fold) {
            // The largest of the block, which is the decoder's own rule and
            // the only safe one here: these grids are maxima over a window,
            // so taking one cell of four drops three quarters of a rotation
            // track or a hail swath on the floor.
            //
            // The block is held inside the GRID rather than inside the
            // window. Clamping it to the window instead made the last block
            // of a row summarise fewer source cells than the decoder's own
            // fold did, which understates a rotation track exactly at the
            // edge of the raster somebody asked for.
            let mut most = f32::NEG_INFINITY;
            for down in 0..fold {
                for across in 0..fold {
                    let row = (row + down).min(grid.rows - 1);
                    let column = (column + across).min(grid.columns - 1);
                    most = most.max(grid.value(row, column));
                }
            }
            values.push(most);
        }
    }

    Ok(GridWindow {
        columns,
        rows,
        // The outer edge of the corner cell, which is what a raster's tie
        // point means, and the corner cell is the whole block. Folding moves
        // the cell CENTRE half a source cell, which is what the decoder's own
        // `reduced_geometry` accounts for; it does not move the edge at all.
        // Adding that centre offset here put the same readings on the ground
        // 278 metres from where the decoder would have put them, depending
        // only on which grid happened to be cached.
        west: grid.west + first_column as f64 * grid.d_lon - grid.d_lon / 2.0,
        north: grid.north - first_row as f64 * grid.d_lat + grid.d_lat / 2.0,
        d_lon: grid.d_lon * fold as f64,
        d_lat: grid.d_lat * fold as f64,
        values,
    })
}

/// How many cells of this grid go into one cell of the grid the app draws at.
///
/// One whenever the grid is already at the drawn resolution or coarser, which
/// is every product but the two shear grids and those only when a reader was
/// close enough to be shown them unfolded.
pub(crate) fn fold_to_drawn(grid: &Grid) -> usize {
    let ratio = (DRAWN_CELL_DEGREES / grid.d_lat).round();
    if ratio.is_finite() && ratio >= 2.0 {
        (ratio as usize).min(MAX_SOURCE_REDUCTION)
    } else {
        1
    }
}

#[cfg(test)]
#[path = "window_tests.rs"]
mod tests;

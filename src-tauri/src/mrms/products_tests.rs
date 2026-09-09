use super::*;
use crate::mrms::testing::*;

#[test]
fn the_cache_does_not_grow_with_the_product_table() {
    // What replaced one slot per product, and then a count of slots.
    // One slot per product made every new grid cost fifty megabytes of
    // ceiling whether or not anybody drew it. A count of same-sized slots
    // stopped meaning anything once a shear grid could arrive unfolded at
    // four times the size of the one beside it.
    //
    // In `const` blocks because every operand is a constant: the same
    // words, checked when the crate is compiled rather than when the
    // suite is run, which is the stronger of the two and the form clippy
    // asks for.
    const {
        assert!(
            BUSY_SCREEN > LAYERS_AT_ONCE,
            "the loop's next frame is not counted in a busy screen"
        );
        // The worst screen the budget has to hold: every fine product
        // unfolded, with coarse grids filling the rest of it.
        assert!(
            FINE_PRODUCTS.len() * FINE_GRID_BYTES
                + (BUSY_SCREEN - FINE_PRODUCTS.len()) * GRID_BYTES
                <= CACHE_BUDGET_BYTES,
            "a busy screen does not fit inside the budget"
        );
        // The property the change was made for: the table is already
        // longer than a busy screen, and the budget does not follow it.
        assert!(
            PRODUCTS.len() > LAYERS_AT_ONCE,
            "the table is smaller than a busy screen, so this proves nothing"
        );
    }
}

/// The two products the budget above reserves the unfolded room for.
///
/// Nothing in an entry says what resolution the network publishes it at,
/// so the list is written down. What can be checked is that both are still
/// in the table under those names: renamed out from under the budget, the
/// arithmetic would be reserving room for products that no longer exist
/// while the ones that replaced them evicted a busy screen's grids.
#[test]
fn the_fine_products_are_in_the_table() {
    for id in FINE_PRODUCTS {
        assert!(
            product_by_id(id).is_some(),
            "{id} is named in the cache budget and is not in the table"
        );
    }
}

#[test]
fn the_legend_is_built_from_the_ramp_the_tiles_are_drawn_with() {
    let products = mrms_products(None);
    assert_eq!(products.len(), PRODUCTS.len());

    let composite = products
        .iter()
        .find(|entry| entry.id == "composite")
        .expect("the composite product");
    assert_eq!(composite.unit, "dBZ");
    assert_eq!(composite.floor, 5.0);
    // The same stops the raster uses, in the same order.
    assert_eq!(composite.stops.len(), REFLECTIVITY_RAMP.len());
    assert_eq!(composite.stops[0], (5.0, "#04e9e7".to_string()));
    assert_eq!(composite.stops.last().unwrap().1, "#fdfdfd");
    assert!(
        composite.stops.windows(2).all(|pair| pair[0].0 < pair[1].0),
        "a ramp has to climb"
    );

    for entry in &products {
        assert!(!entry.label.is_empty());
        assert!(!entry.stops.is_empty());
    }
}

#[test]
fn every_product_is_drawn_the_way_its_data_is_shaped() {
    let expected = [
        ("composite", Sampling::Nearest),
        ("rotation", Sampling::Cells),
        ("rotation-30", Sampling::Cells),
        ("rotation-120", Sampling::Cells),
        ("rotation-240", Sampling::Cells),
        ("rotation-1440", Sampling::Cells),
        // Shear as it stands is scattered even more thinly than a track
        // over the same window, and it arrives on a grid four times as
        // fine, so it is walked rather than sampled per pixel.
        ("az-shear-low", Sampling::Cells),
        ("az-shear-mid", Sampling::Cells),
        ("mesh", Sampling::Cells),
        // Density is a ratio of two fields that cover the map, so it
        // covers the map too; the two hail indices and the probability
        // are cores.
        ("vil-density", Sampling::Nearest),
        ("shi", Sampling::Cells),
        ("posh", Sampling::Cells),
        ("vii", Sampling::Nearest),
        // The fields that cover the map are sampled per pixel; the ones
        // that are scattered single cells are walked, because a per-pixel
        // pass over a few hundred live cells in twenty-four million draws
        // an empty map.
        ("echo-tops", Sampling::Nearest),
        ("vil", Sampling::Nearest),
        ("precip-rate", Sampling::Nearest),
        ("qpe-hour", Sampling::Nearest),
        ("qpe-day", Sampling::Nearest),
        ("gauge-qpe-hour", Sampling::Nearest),
        ("gauge-qpe-day", Sampling::Nearest),
        ("gauge-qpe-three-day", Sampling::Nearest),
        // The flash flood grids cover whole basins rather than single
        // cells, so they are sampled per pixel like the rain they are
        // made from.
        ("ffg-hour", Sampling::Nearest),
        ("ffg-three-hour", Sampling::Nearest),
        ("unit-streamflow", Sampling::Nearest),
        ("hail-swath", Sampling::Cells),
        ("lightning", Sampling::Cells),
        // The other density windows are the same sparse cells as the
        // five-minute one.
        ("lightning-1min", Sampling::Cells),
        ("lightning-15min", Sampling::Cells),
        ("lightning-30min", Sampling::Cells),
        // A probability is a smooth field over whole counties, so it is
        // sampled per pixel rather than drawn cell by cell.
        ("lightning-probability-30min", Sampling::Nearest),
        ("lightning-probability-60min", Sampling::Nearest),
        // A jump belongs to a storm, and is as sparse as the flashes it
        // is counted from.
        ("lightning-jump", Sampling::Cells),
        ("lightning-jump-max", Sampling::Cells),
        // Reflectivity at a temperature is reflectivity: a continuous
        // field, drawn the way the composite is.
        ("reflectivity-minus-10c", Sampling::Nearest),
        ("reflectivity-minus-20c", Sampling::Nearest),
        ("precip-type", Sampling::Nearest),
        // A slice of the merged grid at one height is as continuous as
        // the composite taken from the same cube.
        ("cappi-reflectivity", Sampling::Nearest),
        ("cappi-rhohv", Sampling::Nearest),
        ("cappi-zdr", Sampling::Nearest),
    ];
    assert_eq!(expected.len(), PRODUCTS.len(), "a product has no verdict");
    for (id, sampling) in expected {
        let entry = product_by_id(id).unwrap_or_else(|| panic!("{id} is missing"));
        assert_eq!(entry.sampling, sampling, "{id} is drawn the wrong way");
    }
}

#[test]
fn a_height_only_belongs_to_the_products_published_at_more_than_one() {
    // Asking the composite for three kilometres is an address being wrong
    // rather than a different picture, and answering it with a folder
    // that does not exist would turn a working layer into an empty one.
    let composite = product_by_id("composite").expect("the composite");
    assert_eq!(composite.level_for(Some("03.00")), None);
    assert_eq!(
        composite.folder_at(Some("03.00")),
        "MergedReflectivityQCComposite_00.50"
    );
    assert_eq!(
        composite.folder_at(None),
        "MergedReflectivityQCComposite_00.50"
    );

    for id in ["cappi-reflectivity", "cappi-rhohv", "cappi-zdr"] {
        let family = product_by_id(id).unwrap_or_else(|| panic!("{id} is missing"));
        let levels = family
            .levels
            .unwrap_or_else(|| panic!("{id} has no heights"));
        assert_eq!(levels.len(), 33, "{id}");
        // A height the network publishes.
        assert_eq!(family.level_for(Some("03.00")), Some("03.00"));
        // One it does not. The lowest rather than nothing: a stale
        // address, or a height the network drops, still draws a picture.
        assert_eq!(family.level_for(Some("03.25")), Some("00.50"));
        assert_eq!(family.level_for(Some("../CONUS")), Some("00.50"));
        assert_eq!(family.level_for(None), Some("00.50"));
    }
}

#[test]
fn the_heights_are_the_ones_the_bucket_publishes() {
    // Read off the CONUS prefix listing on 2026-09-05: thirty-three
    // folders per family, a quarter of a kilometre apart to three, half a
    // kilometre to nine, then whole ones to nineteen. The names are the
    // folder suffixes verbatim, because a mis-spelled one is a listing
    // that answers with nothing and a layer that draws nothing.
    assert_eq!(CUBE_LEVELS.len(), 33);
    assert_eq!(CUBE_LEVELS.first(), Some(&("00.50", 0.50)));
    assert_eq!(CUBE_LEVELS.last(), Some(&("19.00", 19.00)));
    for (name, km) in CUBE_LEVELS {
        assert_eq!(
            *name,
            format!("{km:05.2}"),
            "the folder suffix and the height disagree"
        );
    }
    for pair in CUBE_LEVELS.windows(2) {
        assert!(
            pair[1].1 > pair[0].1,
            "{:?} is not above {:?}",
            pair[1],
            pair[0]
        );
    }
}

/// Whether the grids stay readable to somebody who cannot see one of the
/// primaries, held to the same numbers the single-site ramps are.
mod colour_vision {
    use super::*;
    use crate::contrast::{
        closest_neighbours, lightness_climbs, worst_pair, ColorVision, EVERY_VISION,
    };

    /// Neighbouring bands have to stay apart for every kind of vision.
    /// About 2.3 is where two colours become distinguishable at all, so
    /// this is a multiple of that rather than a number chosen to let a
    /// particular ladder through.
    const NEIGHBOURS_APART: f32 = 10.0;

    #[test]
    fn every_high_contrast_grid_keeps_its_bands_apart() {
        for product in PRODUCTS.iter().filter(|p| p.categories.is_none()) {
            for vision in EVERY_VISION {
                let (apart, from, to) = worst_pair(product.high_contrast_ramp, vision);
                assert!(
                    apart >= NEIGHBOURS_APART,
                    "{}: {} brings {from} and {to} {} within {apart:.1}",
                    product.id,
                    vision.name(),
                    product.unit
                );
            }
        }
    }

    /// More of the quantity is always lighter, which is what carries the
    /// reading when hue is gone entirely.
    #[test]
    fn every_high_contrast_grid_climbs_in_lightness() {
        // A categorical grid is exempt, and not by way of an excuse: snow
        // is not more than rain, so there is no direction for lightness to
        // carry. What those grids are held to instead is below: every pair
        // of categories has to be tellable apart, which is a harder test
        // than neighbours on a ramp.
        for product in PRODUCTS.iter().filter(|p| p.categories.is_none()) {
            assert!(
                lightness_climbs(product.high_contrast_ramp, 0.5),
                "{} falls back down",
                product.id
            );
        }
    }

    /// Every category has to be tellable from every other one.
    ///
    /// A ramp only has to keep its neighbours apart, because a reader
    /// compares a colour against the bar beside it and two ends being
    /// similar is survivable. A category has no bar and no order: snow
    /// against hail is the whole question, and any pair collapsing is the
    /// layer saying the wrong thing rather than saying it vaguely.
    #[test]
    fn every_pair_of_categories_stays_apart() {
        for product in PRODUCTS {
            let Some(categories) = product.categories else {
                continue;
            };
            for vision in EVERY_VISION {
                for (at, one) in categories.iter().enumerate() {
                    for other in &categories[at + 1..] {
                        let apart = crate::contrast::distance(one.color, other.color, vision);
                        assert!(
                            apart >= NEIGHBOURS_APART,
                            "{}: {} brings {} and {} within {apart:.1}",
                            product.id,
                            vision.name(),
                            one.id,
                            other.id
                        );
                    }
                }
            }
        }
    }

    /// What the ordinary ramps do, kept as tests so the reason for the
    /// second set is on the record rather than in an argument.
    ///
    /// The two problems are different. The composite is drawn on the NWS
    /// reflectivity scale, which collapses outright; the other nine share a
    /// ladder that stays apart and carries no order, because its yellow is
    /// lighter than the red and the magenta above it.
    #[test]
    fn the_ordinary_composite_ramp_collapses() {
        let composite = product_by_id("composite").expect("the composite product");
        let (apart, from, to) = worst_pair(composite.ramp, ColorVision::Deuteranopia);
        assert!(
            apart < NEIGHBOURS_APART,
            "the NWS scale was expected to collapse somewhere under deuteranopia, closest was {apart:.1} between {from} and {to}"
        );
        let better = closest_neighbours(composite.high_contrast_ramp, ColorVision::Deuteranopia);
        assert!(
            better > apart * 2.0,
            "the replacement should be further apart: {better:.1} against {apart:.1}"
        );
    }

    /// The shared ladder is readable and says nothing about which way is
    /// more, which is the other half of what contrast is for.
    #[test]
    fn the_ordinary_ladder_carries_no_order() {
        let rotation = product_by_id("rotation").expect("the rotation product");
        assert!(
            !lightness_climbs(rotation.ramp, 0.5),
            "the shared ladder was expected to fall back down in lightness"
        );
        assert!(lightness_climbs(rotation.high_contrast_ramp, 0.5));
    }

    /// Asking for more contrast may divide the range into fewer bands, and
    /// it may not move the ends of it. A ramp that started or stopped
    /// somewhere else would quietly change which readings are drawn at all.
    #[test]
    fn the_two_ramps_cover_the_same_ground() {
        for product in PRODUCTS {
            let contrast = product.high_contrast_ramp;
            assert_eq!(
                product.ramp[0].0, contrast[0].0,
                "{} starts somewhere else",
                product.id
            );
            assert_eq!(
                product.ramp[product.ramp.len() - 1].0,
                contrast[contrast.len() - 1].0,
                "{} stops somewhere else",
                product.id
            );
            assert!(
                contrast.windows(2).all(|pair| pair[1].0 > pair[0].0),
                "{} runs out of order",
                product.id
            );
            assert!(
                contrast.len() <= product.ramp.len(),
                "{} asks a reader to tell more bands apart, not fewer",
                product.id
            );
        }
    }
}

/// The precipitation flag's own numbers, from the NSSL product table.
///
/// Written down here because the grid holds a category rather than a
/// quantity: a number renumbered upstream, or a digit mistyped here, does
/// not look wrong on the map. It paints snow as convection over half a
/// state and says nothing about it.
///
/// Source: https://www.nssl.noaa.gov/projects/mrms/operational/tables.php
/// discipline 209, category 6.
#[test]
fn the_precipitation_categories_are_the_ones_the_table_publishes() {
    let entry = product_by_id("precip-type").expect("the precipitation flag");
    let categories = entry.categories.expect("a categorical grid");
    let named: Vec<(f32, &str)> = categories
        .iter()
        .map(|category| (category.value, category.id))
        .collect();
    assert_eq!(
        named,
        vec![
            (1.0, "warmStratiform"),
            (3.0, "snow"),
            (6.0, "convection"),
            (7.0, "hail"),
            (10.0, "coolStratiform"),
            (91.0, "tropicalStratiform"),
            (96.0, "tropicalConvection"),
        ]
    );

    // Zero is "no precipitation" and is not drawn, which is most of the
    // country most of the time.
    assert!(entry.floor > 0.0 && entry.floor < 1.0);
    // And it carries no unit, because a category is not measured in
    // anything. A unit line beside it would be wrong whatever it said.
    assert_eq!(entry.unit, "");
}

/// A value the table does not name is left clear rather than guessed at.
#[test]
fn a_category_nobody_defined_is_not_painted() {
    let entry = product_by_id("precip-type").expect("the precipitation flag");
    let categories = entry.categories.expect("a categorical grid");
    for value in [-3.0, -1.0, 0.0, 2.0, 4.0, 5.0, 8.0, 9.0, 11.0, 50.0, 99.0] {
        assert!(
            category_color(categories, value).is_none(),
            "{value} is not a category and must not be drawn"
        );
    }
    // The grid arrives as scaled integers through a float, so a reading a
    // hair off a whole number is still that category.
    assert_eq!(
        category_color(categories, 3.0000002),
        category_color(categories, 3.0),
    );
    assert!(category_color(categories, f32::NAN).is_none());
}

/// Every product this offers has to actually be there and actually decode.
/// A folder name is a guess until the bucket answers, a ramp is a guess
/// until real values land on it, and a floor set too high draws nothing at
/// all while looking like a quiet day.
#[test]
#[ignore = "fetches a live grid from the MRMS archive"]
fn every_product_decodes_and_lands_on_its_own_ramp() {
    let _turn = live_test();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");

    // Every product, and for the three published through the whole depth
    // of the merged grid, three heights of each: the bottom of the cube,
    // the middle where a reader looks for a ZDR column, and ten
    // kilometres, where the folders exist but the air is often empty.
    // One height would say nothing about whether the folder name is
    // built correctly for the others.
    const SAMPLED: [&str; 3] = ["00.50", "03.00", "10.00"];
    let asked = PRODUCTS.iter().flat_map(|product| {
        match product.levels {
            Some(_) => SAMPLED.iter().map(Some).collect::<Vec<_>>(),
            None => vec![None],
        }
        .into_iter()
        .map(move |level| (product, level.copied()))
    });

    for (product, level) in asked {
        clear_caches();
        let named = match level {
            Some(level) => format!("{} at {level}", product.id),
            None => product.id.to_string(),
        };
        let folder = product.folder_at(level);
        let frames = runtime
            .block_on(mrms_frames(
                product.id.into(),
                1,
                None,
                level.map(str::to_owned),
            ))
            .unwrap_or_else(|error| panic!("{named} publishes nothing at {folder}: {error}"));
        let key = frames
            .last()
            .unwrap_or_else(|| panic!("{named} has no recent grid in {folder}"))
            .key
            .clone();
        runtime
            .block_on(grid_for(&key, false))
            .unwrap_or_else(|error| panic!("{named} did not decode: {error}"));

        let cache = CACHE.lock().expect("the cache");
        let grid = &cache
            .iter()
            .find(|held| held.key == key)
            .expect("the grid is cached")
            .grid;

        // What the grid actually holds, against what the ramp expects.
        //
        // Every cell, not a stride: the sparse products are a few hundred
        // live cells in twenty-four million, so a stride can walk a whole
        // hail grid and touch none of them, and "nothing above the floor"
        // then says nothing at all.
        let mut above_floor = 0usize;
        let mut finite = 0usize;
        let mut peak: Option<f32> = None;
        for row in 0..grid.rows {
            for column in 0..grid.columns {
                let value = grid.value(row, column);
                if !value.is_finite() {
                    continue;
                }
                finite += 1;
                peak = Some(peak.map_or(value, |held: f32| held.max(value)));
                if value >= product.floor {
                    above_floor += 1;
                }
            }
        }
        let top = product.ramp[product.ramp.len() - 1].0;
        println!(
            "{named}: {above_floor} of {finite} cells over the {} floor, peak {} {}, ramp ends at {top}",
            product.floor,
            peak.map_or("none".into(), |value| format!("{value:.2}")),
            product.unit
        );

        // Started as `f32::MIN`, which is a finite number, so the check
        // that a grid decoded to something readable could never fail: a
        // field of nothing but missing values passed it. An option says
        // what the maximum of an empty set actually is.
        let peak = peak.unwrap_or_else(|| panic!("{named} decoded to nothing readable"));
        // Not "has data": a cell outside radar coverage decodes to a
        // large negative number rather than to NaN, so almost every cell
        // in the domain counts here. It catches a decode that came back
        // with a grid a fraction of the size it should be.
        assert!(
            finite > 1_000_000,
            "{named}: only {finite} cells in the whole grid decoded"
        );

        // The ramp has to be in the same world as the data. An order of
        // magnitude either way and the map is one flat colour or nothing.
        assert!(
            peak < top * 10.0,
            "{named}: peak {peak} is far past the {top} the ramp ends at"
        );
        // And the other way, which nothing checked: a grid published in a
        // unit a thousand times smaller than the ramp assumes draws an
        // empty layer and passes every upper bound there is. A field that
        // covers the country always has something above its own floor;
        // the scattered ones are reported rather than asserted, because
        // "no hail anywhere in the United States" is a fact about the
        // afternoon rather than about this code.
        if product.sampling == Sampling::Nearest {
            assert!(
                above_floor > 0,
                "{}: nothing in the country reached the {} floor, so either \
                 the floor is too high or the unit has moved",
                product.id,
                product.floor
            );
            assert!(
                peak > top / 1000.0,
                "{}: peak {peak} is far below the {top} the ramp ends at",
                product.id
            );
        }
        drop(cache);
    }
}

/// The precipitation flag holds the categories the table names and nothing
/// else.
///
/// Live, because that is the only place the claim can be checked: the
/// table is documentation and the grid is what actually arrives. A value
/// nobody has defined turning up here means either the table has moved or
/// the decode is wrong, and both of them paint the map a lie.
///
/// Cheap as live tests go: this grid is a couple of hundred kilobytes
/// rather than the fifty megabytes a reflectivity field expands to,
/// because most of the country is one category most of the time.
#[test]
#[ignore = "fetches a live grid from the MRMS archive"]
fn the_precipitation_flag_holds_only_the_categories_it_names() {
    let _turn = live_test();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a runtime");
    clear_caches();

    let entry = product_by_id("precip-type").expect("the precipitation flag");
    let frames = runtime
        .block_on(mrms_frames("precip-type".into(), 1, None, None))
        .expect("MRMS publishes the precipitation flag");
    let key = frames.last().expect("a frame").key.clone();
    runtime
        .block_on(grid_for(&key, false))
        .unwrap_or_else(|error| panic!("the flag did not decode: {error}"));

    let cache = CACHE.lock().expect("the cache");
    let grid = &cache
        .iter()
        .find(|held| held.key == key)
        .expect("the grid is cached")
        .grid;

    let categories = entry.categories.expect("a categorical grid");
    let mut unknown: Vec<f32> = Vec::new();
    let mut drawn = 0usize;
    for row in (0..grid.rows).step_by(5) {
        for column in (0..grid.columns).step_by(5) {
            let value = grid.value(row, column);
            if !value.is_finite() {
                continue;
            }
            let whole = value.round();
            // Nothing falling, missing, and outside coverage, all of which
            // the table reserves and none of which is drawn.
            if whole == 0.0 || whole == -3.0 || whole == -1.0 {
                continue;
            }
            if category_color(categories, value).is_some() {
                drawn += 1;
            } else if !unknown.contains(&whole) {
                unknown.push(whole);
            }
        }
    }
    println!("precip-type: {drawn} sampled cells in a named category");
    assert!(
        unknown.is_empty(),
        "the grid holds categories the table does not name: {unknown:?}"
    );
    drop(cache);
}

/// Snow is drawn as snow, wherever the flag says so.
#[test]
fn the_categorical_grid_never_borrows_the_rain_ramp() {
    // A grid of nothing but snow, drawn as tiles.
    let mut grid = grid();
    grid.samples = vec![30; grid.samples.len()];
    grid.decimal = 1;
    grid.reference = 0.0;
    let entry = product_by_id("precip-type").expect("the precipitation flag");
    let pixels = tile_pixels(
        &grid,
        entry,
        4,
        3,
        5,
        TileLook {
            threshold: None,
            high_contrast: false,
            smooth: false,
        },
    )
    .expect("a tile");
    let snow = entry
        .categories
        .unwrap()
        .iter()
        .find(|category| category.id == "snow")
        .expect("snow")
        .color;
    let drawn: Vec<[u8; 3]> = pixels
        .chunks(4)
        .filter(|pixel| pixel[3] > 0)
        .map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect();
    assert!(!drawn.is_empty(), "the tile drew nothing");
    for pixel in &drawn {
        assert_eq!(*pixel, snow, "a snow gate came out another colour");
    }
    // And not the reflectivity ramp's colour for the same number, which
    // is what drawing it as rain would have looked like.
    assert_ne!(snow, ramp_color(REFLECTIVITY_RAMP, 3.0));
}

#[test]
fn the_legend_follows_the_ramp_in_force() {
    let ordinary = mrms_products(Some(false));
    let contrast = mrms_products(Some(true));
    let hex = |ramp: &[(f32, [u8; 3])], at: usize| {
        format!(
            "#{:02x}{:02x}{:02x}",
            ramp[at].1[0], ramp[at].1[1], ramp[at].1[2]
        )
    };
    for (index, product) in PRODUCTS.iter().enumerate() {
        assert_eq!(ordinary[index].stops[0].1, hex(product.ramp, 0));
        assert_eq!(
            contrast[index].stops[0].1,
            hex(product.high_contrast_ramp, 0),
            "{} kept its ordinary colours",
            product.id
        );
        // Whatever the bar is drawn from, it covers the same ground.
        assert_eq!(ordinary[index].stops[0].0, contrast[index].stops[0].0);
        assert_eq!(
            ordinary[index].stops.last().unwrap().0,
            contrast[index].stops.last().unwrap().0
        );
        assert_eq!(
            contrast[index].stops.len(),
            product.high_contrast_ramp.len()
        );
    }
}

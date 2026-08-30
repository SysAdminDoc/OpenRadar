//! A colour table loaded from a GRLevelX `.pal` file, applied to whatever the
//! renderers draw from raw values.
//!
//! The table itself is read on the frontend, where the file is opened. What
//! arrives here is the stops it produced, so a hand-edited settings file
//! cannot put anything on the map that the parser would not have made.
//!
//! It is held here rather than passed with every tile request because a tile
//! is fetched by URL and a whole colour table will not fit in one. Changing it
//! bumps a generation, which the frontend puts in the tile address so both
//! caches let go of what they drew with the old one.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

use serde::Deserialize;

/// One stop: the value it starts at, its colour, and the colour it blends
/// towards before the next stop. A solid stop has nothing to blend towards.
#[derive(Debug, Clone, Deserialize)]
pub struct Stop {
    pub value: f32,
    pub color: String,
    pub to_color: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Palette {
    /// What the table says it is for, so it is not applied to a product
    /// measured in something else.
    pub units: Option<String>,
    stops: Vec<(f32, [u8; 3], Option<[u8; 3]>)>,
}

static LOADED: RwLock<Option<Palette>> = RwLock::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn parse_hex(value: &str) -> Option<[u8; 3]> {
    let value = value.strip_prefix('#')?;
    if value.len() != 6 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some([
        u8::from_str_radix(&value[0..2], 16).ok()?,
        u8::from_str_radix(&value[2..4], 16).ok()?,
        u8::from_str_radix(&value[4..6], 16).ok()?,
    ])
}

impl Palette {
    pub fn new(units: Option<String>, stops: &[Stop]) -> Option<Self> {
        let mut read: Vec<(f32, [u8; 3], Option<[u8; 3]>)> = stops
            .iter()
            .filter_map(|stop| {
                if !stop.value.is_finite() {
                    return None;
                }
                let color = parse_hex(&stop.color)?;
                let to = stop.to_color.as_deref().and_then(parse_hex);
                Some((stop.value, color, to))
            })
            .collect();
        if read.is_empty() {
            return None;
        }
        read.sort_by(|left, right| {
            left.0
                .partial_cmp(&right.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Some(Palette { units, stops: read })
    }

    /// True when this table is meant for a product measured in this unit. A
    /// table that does not say is taken at the user's word.
    pub fn applies_to(&self, unit: &str) -> bool {
        match &self.units {
            None => true,
            Some(units) => units.trim().eq_ignore_ascii_case(unit.trim()),
        }
    }

    /// The colour a value gets, blending between stops the way the format does.
    pub fn color(&self, value: f32) -> [u8; 3] {
        let first = self.stops[0];
        if value <= first.0 {
            return first.1;
        }
        for pair in self.stops.windows(2) {
            let (low_value, low_color, low_to) = pair[0];
            let (high_value, high_color, _) = pair[1];
            // Half open: a value sitting exactly on the next stop belongs to
            // that stop, not to the end of the blend running into it.
            if value >= high_value {
                continue;
            }
            let span = high_value - low_value;
            let position = if span > 0.0 {
                (value - low_value) / span
            } else {
                0.0
            };
            let to = low_to.unwrap_or(high_color);
            return blend(low_color, to, position);
        }
        let last = self.stops[self.stops.len() - 1];
        last.2.unwrap_or(last.1)
    }

    /// The value the table starts at, below which nothing is drawn.
    pub fn floor(&self) -> f32 {
        self.stops[0].0
    }
}

fn blend(from: [u8; 3], to: [u8; 3], position: f32) -> [u8; 3] {
    let held = position.clamp(0.0, 1.0);
    [
        (from[0] as f32 + (to[0] as f32 - from[0] as f32) * held).round() as u8,
        (from[1] as f32 + (to[1] as f32 - from[1] as f32) * held).round() as u8,
        (from[2] as f32 + (to[2] as f32 - from[2] as f32) * held).round() as u8,
    ]
}

/// The table in force for a product measured in this unit, if there is one.
pub fn for_unit(unit: &str) -> Option<Palette> {
    let held = LOADED.read().ok()?;
    held.as_ref()
        .filter(|palette| palette.applies_to(unit))
        .cloned()
}

pub fn generation() -> u64 {
    GENERATION.load(Ordering::Relaxed)
}

/// Loads a table, or clears the one in force. Answers with the generation the
/// frontend puts in tile addresses so nothing drawn with the old one is reused.
#[tauri::command]
pub fn set_palette(units: Option<String>, stops: Vec<Stop>) -> u64 {
    let next = if stops.is_empty() {
        None
    } else {
        Palette::new(units, &stops)
    };
    if let Ok(mut held) = LOADED.write() {
        *held = next;
    }
    GENERATION.fetch_add(1, Ordering::Relaxed) + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stop(value: f32, color: &str, to: Option<&str>) -> Stop {
        Stop {
            value,
            color: color.to_string(),
            to_color: to.map(str::to_string),
        }
    }

    fn reflectivity() -> Palette {
        Palette::new(
            Some("dBZ".into()),
            &[
                stop(5.0, "#04e9e7", Some("#019ff4")),
                stop(20.0, "#02fd02", Some("#01c501")),
                stop(50.0, "#fd0000", Some("#d40000")),
                stop(75.0, "#fdfdfd", None),
            ],
        )
        .expect("a palette")
    }

    #[test]
    fn gives_a_stop_its_own_colour_and_blends_between_them() {
        let palette = reflectivity();
        assert_eq!(palette.color(5.0), [0x04, 0xe9, 0xe7]);
        assert_eq!(palette.color(50.0), [0xfd, 0x00, 0x00]);
        // Halfway from 5 to 20, so halfway from 04e9e7 to 019ff4.
        assert_eq!(palette.color(12.5), [0x03, 0xc4, 0xee]);
    }

    #[test]
    fn holds_the_ends_rather_than_running_off_either_edge() {
        let palette = reflectivity();
        assert_eq!(palette.color(-40.0), [0x04, 0xe9, 0xe7]);
        assert_eq!(palette.color(200.0), [0xfd, 0xfd, 0xfd]);
        assert_eq!(palette.floor(), 5.0);
    }

    #[test]
    fn reads_the_stops_low_to_high_whatever_order_they_arrive_in() {
        let palette = Palette::new(
            None,
            &[
                stop(50.0, "#fd0000", None),
                stop(5.0, "#04e9e7", None),
                stop(20.0, "#02fd02", None),
            ],
        )
        .expect("a palette");
        assert_eq!(palette.floor(), 5.0);
        assert_eq!(palette.color(5.0), [0x04, 0xe9, 0xe7]);
    }

    #[test]
    fn refuses_anything_that_is_not_a_table() {
        assert!(Palette::new(None, &[]).is_none());
        // A colour that is not a colour is not a stop, and a table of none of
        // them is not a table.
        assert!(Palette::new(None, &[stop(5.0, "javascript:alert(1)", None)]).is_none());
        assert!(Palette::new(None, &[stop(5.0, "#04e9e", None)]).is_none());
        assert!(Palette::new(None, &[stop(f32::NAN, "#04e9e7", None)]).is_none());
        // One good stop among bad ones survives.
        let mixed = Palette::new(None, &[stop(5.0, "bad", None), stop(50.0, "#fd0000", None)])
            .expect("a palette");
        assert_eq!(mixed.floor(), 50.0);
    }

    #[test]
    fn applies_only_to_a_product_measured_in_its_own_unit() {
        let palette = reflectivity();
        assert!(palette.applies_to("dBZ"));
        assert!(palette.applies_to("dbz"));
        assert!(!palette.applies_to("m/s"));

        // A table that does not say is taken at the user's word.
        let anything = Palette::new(None, &[stop(5.0, "#04e9e7", None)]).expect("a palette");
        assert!(anything.applies_to("m/s"));
    }

    #[test]
    fn loading_one_bumps_the_generation_so_nothing_drawn_before_is_reused() {
        let before = generation();
        let after = set_palette(
            Some("dBZ".into()),
            vec![stop(5.0, "#04e9e7", None), stop(50.0, "#fd0000", None)],
        );
        assert!(after > before);
        assert!(for_unit("dBZ").is_some());
        assert!(for_unit("m/s").is_none());

        // Clearing it bumps again, and takes the table with it.
        let cleared = set_palette(None, Vec::new());
        assert!(cleared > after);
        assert!(for_unit("dBZ").is_none());
    }
}

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
#[serde(rename_all = "camelCase")]
pub struct Stop {
    pub value: f32,
    pub color: String,
    pub to_color: Option<String>,
    /// True for a SolidColor line, which holds its colour to the next stop.
    /// A Color line with one colour ramps into the next stop instead, and
    /// without this the two are indistinguishable here.
    #[serde(default)]
    pub solid: bool,
}

#[derive(Debug, Clone)]
pub struct Palette {
    /// What the table says it is for, so it is not applied to a product
    /// measured in something else.
    pub units: Option<String>,
    /// The colour the table gives range-folded gates, which are not a value on
    /// the scale and so have a line of their own in the format.
    pub range_folded: Option<[u8; 3]>,
    stops: Vec<Held>,
}

/// One stop, as it is drawn: a value, a colour, what it blends towards, and
/// whether it holds instead of blending at all.
#[derive(Debug, Clone, Copy)]
struct Held {
    value: f32,
    color: [u8; 3],
    to: Option<[u8; 3]>,
    solid: bool,
}

/// The tables in force, at most one per unit. A `Vec` rather than a map
/// because there are only ever a handful and `applies_to` is the lookup.
static LOADED: RwLock<Vec<Palette>> = RwLock::new(Vec::new());
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
    /// Only the tests build a table without a range-folded colour.
    #[cfg(test)]
    pub fn new(units: Option<String>, stops: &[Stop]) -> Option<Self> {
        Self::with_range_folded(units, None, stops)
    }

    pub fn with_range_folded(
        units: Option<String>,
        range_folded: Option<&str>,
        stops: &[Stop],
    ) -> Option<Self> {
        let mut read: Vec<Held> = stops
            .iter()
            .filter_map(|stop| {
                if !stop.value.is_finite() {
                    return None;
                }
                let color = parse_hex(&stop.color)?;
                let to = stop.to_color.as_deref().and_then(parse_hex);
                Some(Held {
                    value: stop.value,
                    color,
                    to,
                    solid: stop.solid,
                })
            })
            .collect();
        if read.is_empty() {
            return None;
        }
        read.sort_by(|left, right| {
            left.value
                .partial_cmp(&right.value)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Some(Palette {
            units,
            range_folded: range_folded.and_then(parse_hex),
            stops: read,
        })
    }

    /// True when this table is meant for a product measured in this unit. A
    /// table that does not say is taken at the user's word.
    pub fn applies_to(&self, unit: &str) -> bool {
        match &self.units {
            // A table that does not say what it is for is a reflectivity
            // table, which is what the format is for. Taking it as meant for
            // everything would put a dBZ scale over rotation, hail, and
            // lightning, whose values all sit below its lowest stop, and blank
            // those layers with no explanation.
            None => unit.trim().eq_ignore_ascii_case("dBZ"),
            Some(units) => units.trim().eq_ignore_ascii_case(unit.trim()),
        }
    }

    /// The colour a value gets, blending between stops the way the format does.
    pub fn color(&self, value: f32) -> [u8; 3] {
        let first = self.stops[0];
        if value <= first.value {
            return first.color;
        }
        for pair in self.stops.windows(2) {
            let (low, high) = (pair[0], pair[1]);
            // Half open: a value sitting exactly on the next stop belongs to
            // that stop, not to the end of the blend running into it.
            if value >= high.value {
                continue;
            }
            // A SolidColor line holds its colour to the next stop. A Color
            // line with one colour ramps into the next stop instead, which is
            // what the format says and what every other reader does.
            if low.solid {
                return low.color;
            }
            let span = high.value - low.value;
            let position = if span > 0.0 {
                (value - low.value) / span
            } else {
                0.0
            };
            return blend(low.color, low.to.unwrap_or(high.color), position);
        }
        let last = self.stops[self.stops.len() - 1];
        last.to.unwrap_or(last.color)
    }

    /// The value the table starts at, below which nothing is drawn.
    pub fn floor(&self) -> f32 {
        self.stops[0].value
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
    held.iter()
        .find(|palette| palette.applies_to(unit))
        .cloned()
}

pub fn generation() -> u64 {
    GENERATION.load(Ordering::Relaxed)
}

/// One table as the frontend sends it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub units: Option<String>,
    pub range_folded: Option<String>,
    pub stops: Vec<Stop>,
}

/// Loads the tables in force, replacing whatever was there. An empty list
/// clears them. Answers with the generation the frontend puts in tile
/// addresses so nothing drawn with the old set is reused.
///
/// The whole set arrives at once rather than one call per table, so the
/// renderer is never holding half of a change.
#[tauri::command]
pub fn set_palettes(tables: Vec<Table>) -> u64 {
    let mut next = Vec::new();
    for table in tables {
        if table.stops.is_empty() {
            continue;
        }
        let Some(palette) =
            Palette::with_range_folded(table.units, table.range_folded.as_deref(), &table.stops)
        else {
            continue;
        };
        // First one wins for a unit, which is the same rule `for_unit` uses.
        // Two tables for one unit is a frontend that sent a set it should
        // have narrowed, not a reason to draw whichever arrived last.
        if next
            .iter()
            .any(|held: &Palette| held.units == palette.units)
        {
            continue;
        }
        next.push(palette);
    }
    if let Ok(mut held) = LOADED.write() {
        *held = next;
    }
    GENERATION.fetch_add(1, Ordering::Relaxed) + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The loaded table is global, and the tile tests read it. Anything that
    /// changes it has to take the same turn they do.
    pub fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
        static TURN: std::sync::Mutex<()> = std::sync::Mutex::new(());
        TURN.lock().unwrap_or_else(|held| held.into_inner())
    }

    fn stop(value: f32, color: &str, to: Option<&str>) -> Stop {
        Stop {
            value,
            color: color.to_string(),
            to_color: to.map(str::to_string),
            solid: false,
        }
    }

    fn solid(value: f32, color: &str) -> Stop {
        Stop {
            value,
            color: color.to_string(),
            to_color: None,
            solid: true,
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

    /// The stops arrive as JSON from the frontend, and nothing else in the
    /// crate looks at them on the way in. A field name that does not match is
    /// not an error for an Option: serde fills it with None and the second
    /// colour on every line is silently lost, which draws the top half of the
    /// reflectivity scale in the wrong colours.
    #[test]
    fn reads_the_stops_exactly_as_the_frontend_sends_them() {
        // Written the way usePalette builds it, not the way Rust names things.
        let json = r##"[
            {"value": 5.0, "color": "#04e9e7", "toColor": "#019ff4"},
            {"value": 50.0, "color": "#fd0000", "toColor": "#d40000"},
            {"value": 75.0, "color": "#fdfdfd", "toColor": null}
        ]"##;
        let stops: Vec<Stop> = serde_json::from_str(json).expect("the stops parse");
        assert_eq!(stops.len(), 3);
        assert_eq!(
            stops[0].to_color.as_deref(),
            Some("#019ff4"),
            "the second colour did not survive the crossing"
        );
        assert_eq!(stops[1].to_color.as_deref(), Some("#d40000"));
        assert_eq!(stops[2].to_color, None);

        // And the table built from them blends to its own second colour rather
        // than to the next stop's first one.
        let palette = Palette::new(Some("dBZ".into()), &stops).expect("a palette");
        assert_eq!(palette.color(50.0), [0xfd, 0x00, 0x00]);
        // Three quarters of the way from 50 to 75, blending fd0000 to d40000.
        let high = palette.color(68.75);
        assert!(
            high[0] < 0xfd && high[0] > 0xd4 && high[1] == 0 && high[2] == 0,
            "68.75 dBZ came out {high:?}, which is not on this table's ramp"
        );
    }

    #[test]
    fn a_solid_stop_holds_its_colour_to_the_next_one() {
        let palette = Palette::new(
            None,
            &[
                stop(5.0, "#04e9e7", None),
                solid(20.0, "#fd0000"),
                stop(50.0, "#000000", None),
            ],
        )
        .expect("a palette");
        // A file that says SolidColor at twenty is drawn flat red to fifty.
        assert_eq!(palette.color(20.0), [0xfd, 0x00, 0x00]);
        assert_eq!(palette.color(35.0), [0xfd, 0x00, 0x00]);
        assert_eq!(palette.color(49.9), [0xfd, 0x00, 0x00]);
        assert_eq!(palette.color(50.0), [0x00, 0x00, 0x00]);
    }

    /// The other half of the same rule, and the one that is easy to get wrong:
    /// a Color line with a single colour is not solid. It ramps into the next
    /// stop, and holding it instead would flatten most of the tables people
    /// actually pass round.
    #[test]
    fn a_plain_line_with_one_colour_ramps_into_the_next_stop() {
        let palette = Palette::new(
            None,
            &[stop(5.0, "#ff0000", None), stop(25.0, "#0000ff", None)],
        )
        .expect("a palette");
        assert_eq!(palette.color(5.0), [0xff, 0x00, 0x00]);
        // Halfway between the two stops is halfway between the two colours.
        assert_eq!(palette.color(15.0), [0x80, 0x00, 0x80]);
        assert_eq!(palette.color(25.0), [0x00, 0x00, 0xff]);
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

        // A table that does not say what it is for is a reflectivity table.
        // Applying it to everything would blank the layers whose values are
        // nowhere near a dBZ scale.
        let unsaid = Palette::new(None, &[stop(5.0, "#04e9e7", None)]).expect("a palette");
        assert!(unsaid.applies_to("dBZ"));
        assert!(!unsaid.applies_to("m/s"));
        assert!(!unsaid.applies_to("mm"));
        assert!(!unsaid.applies_to("1/s"));
    }

    #[test]
    fn loading_one_bumps_the_generation_so_nothing_drawn_before_is_reused() {
        let _turn = one_at_a_time();
        let before = generation();
        let after = set_palettes(vec![Table {
            units: Some("dBZ".into()),
            range_folded: Some("#77007d".into()),
            stops: vec![stop(5.0, "#04e9e7", None), stop(50.0, "#fd0000", None)],
        }]);
        assert_eq!(
            for_unit("dBZ").and_then(|held| held.range_folded),
            Some([0x77, 0x00, 0x7d]),
            "the table's own range-folded colour was dropped"
        );
        assert!(after > before);
        assert!(for_unit("dBZ").is_some());
        assert!(for_unit("m/s").is_none());

        // Clearing it bumps again, and takes the table with it.
        let cleared = set_palettes(Vec::new());
        assert!(cleared > after);
        assert!(for_unit("dBZ").is_none());
    }

    #[test]
    fn holds_one_table_per_unit_at_the_same_time() {
        let _turn = one_at_a_time();
        set_palettes(vec![
            Table {
                units: Some("dBZ".into()),
                range_folded: None,
                stops: vec![stop(5.0, "#04e9e7", None)],
            },
            Table {
                units: Some("kt".into()),
                range_folded: None,
                stops: vec![stop(-60.0, "#000000", None)],
            },
        ]);
        // Both, which is the whole point: one slot could not do this.
        assert!(for_unit("dBZ").is_some());
        assert!(for_unit("kt").is_some());
        assert!(for_unit("mm").is_none());

        // A second table for a unit already spoken for is dropped rather than
        // deciding the answer by arrival order.
        set_palettes(vec![
            Table {
                units: Some("dBZ".into()),
                range_folded: None,
                stops: vec![stop(5.0, "#010203", None)],
            },
            Table {
                units: Some("dBZ".into()),
                range_folded: None,
                stops: vec![stop(5.0, "#040506", None)],
            },
        ]);
        assert_eq!(for_unit("dBZ").map(|held| held.color(5.0)), Some([1, 2, 3]));
        set_palettes(Vec::new());
    }

    #[test]
    fn a_solid_stop_holds_its_colour_where_a_plain_one_blends() {
        let _turn = one_at_a_time();
        // The same two stops, once solid and once not. A solid line holds its
        // colour to the next stop; a plain one ramps into it. The frontend was
        // dropping the flag on the way over, so every solid stop in somebody's
        // table was drawn as a blend.
        let solid = Palette::new(
            Some("dBZ".into()),
            &[
                Stop {
                    value: 0.0,
                    color: "#000000".into(),
                    to_color: None,
                    solid: true,
                },
                stop(10.0, "#ffffff", None),
            ],
        )
        .expect("a palette");
        let ramped = Palette::new(
            Some("dBZ".into()),
            &[stop(0.0, "#000000", None), stop(10.0, "#ffffff", None)],
        )
        .expect("a palette");
        assert_eq!(solid.color(5.0), [0, 0, 0]);
        assert_eq!(ramped.color(5.0), [128, 128, 128]);
    }
}

//! Storm cells, as the radar's own algorithms found them.
//!
//! Level II is what the radar measured. Level III is what the Radar Product
//! Generator made of it: the storm cell identification and tracking algorithm
//! walks the reflectivity volume, decides which blobs are one storm, and
//! publishes where each is now, where it has been, and where it will be in an
//! hour. That is the difference between a picture of rain and a sentence about
//! it reaching somebody in twenty minutes.
//!
//! The format is the NWS Interface Control Document for the RPG to Class 1
//! User, 2620001AD Build 24.0, and it is big-endian throughout. What arrives
//! is a 30-byte teletype header, a message header, a product description
//! block, and then up to three blocks of content: the symbology block with the
//! positions, a graphic block with a drawn table, and a tabular block with the
//! algorithm's own text output.
//!
//! Only two of the four cell products are still published. NST (storm
//! tracking) and NMD (mesocyclone detection) run today for every site. NHI
//! (hail index) and NTV (tornado vortex signature) stopped in May 2022: every
//! site's listing for both ends that month, so hail probability and TVS have
//! to come from somewhere else. That is a fact about the feed, not about this
//! decoder.

use std::collections::BTreeMap;

use chrono::{DateTime, Duration, TimeZone, Utc};
use serde::Serialize;

use crate::http;

const BUCKET: &str = "unidata-nexrad-level3.s3.amazonaws.com";

/// The teletype header every product carries, and which is not part of the
/// message the length field describes.
const WMO_TERMINATOR: &[u8] = b"\r\r\n";

/// Message header block, product description block: 9 and 51 halfwords.
const MESSAGE_HEADER: usize = 18;
const DESCRIPTION_BLOCK: usize = 102;

/// The tabular block repeats a whole message and description block before its
/// text begins. Skipping them is the single most-missed step in the format.
const TABULAR_REPEATED_HEADER: usize = MESSAGE_HEADER + DESCRIPTION_BLOCK;

/// Symbology positions are in quarter kilometres from the radar, east and
/// north positive.
const QUARTER_KM: f64 = 0.25;

/// A nautical mile, which is what the algorithm's own text is written in.
const NAUTICAL_MILE_KM: f64 = 1.852;

#[derive(Debug, thiserror::Error)]
pub enum Level3Error {
    #[error("{0} does not publish storm cells")]
    UnknownSite(String),
    #[error("no {1} product has been published for {0} today or yesterday")]
    NoProduct(String, String),
    #[error("the product could not be decoded: {0}")]
    Decode(String),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Serialize for Level3Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// One storm the algorithm is tracking.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StormCell {
    /// Two characters, a letter and a digit, as the algorithm names them.
    pub id: String,
    pub latitude: f64,
    pub longitude: f64,
    /// From the radar, in kilometres, and the compass bearing to it.
    pub range_km: f64,
    pub azimuth_degrees: f64,
    /// Where it is going and how fast, when the algorithm could say. It cannot
    /// for a cell it has only just found.
    pub direction_degrees: Option<f64>,
    pub speed_ms: Option<f64>,
    /// Where it will be, at fifteen minute steps out to an hour. Shorter than
    /// four when the algorithm stopped forecasting.
    pub forecast: Vec<CellPoint>,
    /// Where it has been, oldest first.
    pub past: Vec<CellPoint>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct CellPoint {
    pub latitude: f64,
    pub longitude: f64,
}

/// A rotation the mesocyclone algorithm found, which is a different product
/// and a different kind of thing from a storm cell.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mesocyclone {
    pub latitude: f64,
    pub longitude: f64,
    /// How wide the circulation is, in kilometres.
    pub radius_km: f64,
    /// What the algorithm called it: a mesocyclone, an elevated one, or a
    /// tornado vortex signature.
    pub kind: &'static str,
}

/// Everything read out of one site's cell products.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellReport {
    /// The four-letter site, as the rest of the workspace spells it.
    pub station: String,
    pub site_latitude: f64,
    pub site_longitude: f64,
    /// When the volume the cells came from was taken.
    pub observed: String,
    pub cells: Vec<StormCell>,
    pub mesocyclones: Vec<Mesocyclone>,
}

/// The three letters the bucket files a site under.
///
/// Keys are `TLX_NST_...`, not `KTLX_NST_...`. Every WSR-88D id is a leading
/// letter and three more; the bucket drops the leading one. Puerto Rico, Guam
/// and Hawaii work the same way.
fn bucket_site(station: &str) -> Option<String> {
    let station = station.trim().to_uppercase();
    if station.len() != 4 || !station.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some(station[1..].to_string())
}

/// A big-endian signed 16-bit value.
fn i16_at(bytes: &[u8], at: usize) -> Option<i16> {
    let pair = bytes.get(at..at + 2)?;
    Some(i16::from_be_bytes([pair[0], pair[1]]))
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    let pair = bytes.get(at..at + 2)?;
    Some(u16::from_be_bytes([pair[0], pair[1]]))
}

fn i32_at(bytes: &[u8], at: usize) -> Option<i32> {
    let four = bytes.get(at..at + 4)?;
    Some(i32::from_be_bytes([four[0], four[1], four[2], four[3]]))
}

/// Where the message begins, past the teletype header.
///
/// The header is thirty bytes on every cell product, but its first line varies
/// in length across the wider product family, so the end is found rather than
/// counted: two terminators, then the message.
fn message_start(bytes: &[u8]) -> Option<usize> {
    let first = find(bytes, WMO_TERMINATOR, 0)?;
    let second = find(bytes, WMO_TERMINATOR, first + WMO_TERMINATOR.len())?;
    Some(second + WMO_TERMINATOR.len())
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if from >= haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|at| at + from)
}

/// The parts of the product description block this decoder reads.
#[derive(Debug, Clone, Copy)]
struct Description {
    latitude: f64,
    longitude: f64,
    /// When the volume was taken, which is what the cells describe. The
    /// product generation time is several minutes later and is not it.
    volume_time: DateTime<Utc>,
    /// Byte offsets into the message, already converted from halfwords. Zero
    /// means the block is not there, which is how a product with nothing
    /// detected says so.
    symbology: Option<usize>,
    tabular: Option<usize>,
}

/// Days in the product header are counted from 1 January 1970 as day one.
fn julian_day(days: u16, seconds: i32) -> Option<DateTime<Utc>> {
    let midnight = Utc.with_ymd_and_hms(1969, 12, 31, 0, 0, 0).single()?;
    Some(midnight + Duration::days(days as i64) + Duration::seconds(seconds as i64))
}

fn read_description(msg: &[u8]) -> Result<Description, Level3Error> {
    let divider = i16_at(msg, MESSAGE_HEADER)
        .ok_or_else(|| Level3Error::Decode("the product ended before its description".into()))?;
    if divider != -1 {
        return Err(Level3Error::Decode(format!(
            "the description block starts with {divider} rather than a divider"
        )));
    }

    let latitude = i32_at(msg, MESSAGE_HEADER + 2)
        .ok_or_else(|| Level3Error::Decode("no radar latitude".into()))? as f64
        / 1000.0;
    let longitude = i32_at(msg, MESSAGE_HEADER + 6)
        .ok_or_else(|| Level3Error::Decode("no radar longitude".into()))? as f64
        / 1000.0;

    let day = u16_at(msg, MESSAGE_HEADER + 22)
        .ok_or_else(|| Level3Error::Decode("no volume date".into()))?;
    let seconds = i32_at(msg, MESSAGE_HEADER + 24)
        .ok_or_else(|| Level3Error::Decode("no volume time".into()))?;
    let volume_time = julian_day(day, seconds)
        .ok_or_else(|| Level3Error::Decode("the volume time is not a date".into()))?;

    // Halfwords from the start of the message header, not from here.
    let block = |at: usize| -> Option<usize> {
        let halfwords = i32_at(msg, at)?;
        if halfwords <= 0 {
            return None;
        }
        Some(halfwords as usize * 2)
    };

    Ok(Description {
        latitude,
        longitude,
        volume_time,
        symbology: block(MESSAGE_HEADER + 90),
        tabular: block(MESSAGE_HEADER + 98),
    })
}

/// A position in the symbology block, as latitude and longitude.
///
/// The block's own frame is kilometres east and north of the radar in quarter
/// steps. Converting through range and bearing rather than through a flat
/// offset keeps it honest at the far edge of the product, where a degree of
/// longitude is a good deal shorter than it is at the radar.
fn place(site: (f64, f64), i: i16, j: i16) -> (f64, f64, f64, f64) {
    let east_km = i as f64 * QUARTER_KM;
    let north_km = j as f64 * QUARTER_KM;
    let range_km = (east_km * east_km + north_km * north_km).sqrt();
    let azimuth = east_km.atan2(north_km).to_degrees().rem_euclid(360.0);
    let (latitude, longitude) = offset(site, azimuth, range_km);
    (latitude, longitude, range_km, azimuth)
}

/// A point a bearing and a distance from another, on a sphere.
///
/// The earth is not one, but at the two hundred and thirty kilometres these
/// products reach the difference is tens of metres, well inside the quarter
/// kilometre the positions arrive in.
fn offset(from: (f64, f64), bearing_degrees: f64, distance_km: f64) -> (f64, f64) {
    const EARTH_KM: f64 = 6371.0088;
    let angular = distance_km / EARTH_KM;
    let bearing = bearing_degrees.to_radians();
    let lat1 = from.0.to_radians();
    let lon1 = from.1.to_radians();
    let lat2 = (lat1.sin() * angular.cos() + lat1.cos() * angular.sin() * bearing.cos()).asin();
    let lon2 = lon1
        + (bearing.sin() * angular.sin() * lat1.cos())
            .atan2(angular.cos() - lat1.sin() * lat2.sin());
    // Back into the half-open range the rest of the workspace uses. Wrapping
    // to 0..360 and subtracting is not the same thing and puts a radar in
    // Oklahoma at 262 degrees east.
    let degrees = (lon2.to_degrees() + 540.0).rem_euclid(360.0) - 180.0;
    (lat2.to_degrees(), degrees)
}

/// One packet in a symbology layer.
struct Packet<'a> {
    code: u16,
    payload: &'a [u8],
}

/// Walks the packets in a run of bytes.
fn packets(bytes: &[u8]) -> Vec<Packet<'_>> {
    let mut out = Vec::new();
    let mut at = 0;
    while at + 4 <= bytes.len() {
        let Some(code) = u16_at(bytes, at) else { break };
        let Some(length) = u16_at(bytes, at + 2) else {
            break;
        };
        let start = at + 4;
        let end = start + length as usize;
        if end > bytes.len() {
            break;
        }
        out.push(Packet {
            code,
            payload: &bytes[start..end],
        });
        at = end;
    }
    out
}

/// The packets of the symbology block, flattened across its layers.
fn symbology_packets(msg: &[u8], at: usize) -> Result<Vec<Packet<'_>>, Level3Error> {
    let divider = i16_at(msg, at)
        .ok_or_else(|| Level3Error::Decode("the symbology block is not there".into()))?;
    let id = i16_at(msg, at + 2).unwrap_or(0);
    if divider != -1 || id != 1 {
        return Err(Level3Error::Decode(format!(
            "the symbology block reads {divider}/{id}"
        )));
    }
    let layers = i16_at(msg, at + 8).unwrap_or(0).max(0) as usize;

    let mut out = Vec::new();
    let mut cursor = at + 10;
    for _ in 0..layers {
        let Some(length) = i32_at(msg, cursor + 2) else {
            break;
        };
        let start = cursor + 6;
        let end = start + length.max(0) as usize;
        let Some(body) = msg.get(start..end.min(msg.len())) else {
            break;
        };
        out.extend(packets(body));
        cursor = end;
    }
    Ok(out)
}

/// The character a special symbol packet carries, which is what it is for.
///
/// A storm track is drawn as a run of these: `!` where the storm has been,
/// `"` where it is, `#` where it is going.
const PAST: u8 = b'!';
const CURRENT: u8 = b'"';
const FORECAST: u8 = b'#';

fn symbol_positions(payload: &[u8], want: u8) -> Vec<(i16, i16)> {
    let mut out = Vec::new();
    let mut at = 0;
    while at + 6 <= payload.len() {
        let (Some(i), Some(j)) = (i16_at(payload, at), i16_at(payload, at + 2)) else {
            break;
        };
        if payload[at + 4] == want {
            out.push((i, j));
        }
        at += 6;
    }
    out
}

/// The tabular block as its lines, which is where the numbers live.
///
/// Position comes out of the symbology block, but the algorithm's motion and
/// its forecast distances are only ever written as text. Nothing in the bytes
/// carries a direction or a speed.
fn tabular_lines(msg: &[u8], at: usize) -> Vec<String> {
    let Some(divider) = i16_at(msg, at) else {
        return Vec::new();
    };
    if divider != -1 {
        return Vec::new();
    }
    // Past the eight byte header and the repeated message and description.
    let mut cursor = at + 8 + TABULAR_REPEATED_HEADER;
    if i16_at(msg, cursor) != Some(-1) {
        return Vec::new();
    }
    cursor += 2;
    let pages = i16_at(msg, cursor).unwrap_or(0).max(0) as usize;
    cursor += 2;

    let mut lines = Vec::new();
    for _ in 0..pages {
        loop {
            let Some(count) = i16_at(msg, cursor) else {
                return lines;
            };
            cursor += 2;
            if count < 0 {
                break;
            }
            let end = cursor + count as usize;
            let Some(text) = msg.get(cursor..end.min(msg.len())) else {
                return lines;
            };
            lines.push(String::from_utf8_lossy(text).to_string());
            cursor = end;
        }
    }
    lines
}

/// What one storm's row of the tabular block says.
#[derive(Debug, Clone, Copy, Default)]
struct Motion {
    direction_degrees: Option<f64>,
    speed_ms: Option<f64>,
}

/// Reads the storm rows out of the storm tracking product's text.
///
/// A row is the cell id and then seven pairs: where it is, where it is going,
/// and four forecast positions. Anything the algorithm could not work out is
/// the literal words NO DATA, which is why the columns are read by splitting
/// on whitespace rather than by position: a row with NO DATA in it has a
/// different number of words in the same width.
fn read_motion(lines: &[String]) -> BTreeMap<String, Motion> {
    let mut out = BTreeMap::new();
    for line in lines {
        let joined = tidy_row(line);
        let words: Vec<&str> = joined.split_whitespace().collect();
        let Some(id) = words.first() else { continue };
        if !is_cell_id(id) {
            continue;
        }
        // Storm id, current position, movement, then the forecasts.
        let motion = words.get(2).copied().unwrap_or("NODATA");
        out.insert((*id).to_string(), parse_pair(motion));
    }
    out
}

/// One row of the algorithm's text, with its columns made countable.
///
/// The numbers are right-aligned inside each column, so a pair is written
/// `245/  5` with the space after the slash rather than `245/5`, and a value
/// the algorithm could not work out is the two words `NO DATA` where a pair
/// would be one. Splitting the line on whitespace as it arrives puts the
/// movement in a different column for every row.
fn tidy_row(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line
        .replace("NO DATA", "NODATA")
        .chars()
        .collect::<Vec<char>>();
    chars.reverse();
    while let Some(character) = chars.pop() {
        if character == '/' {
            // Drop the spaces on either side of the slash, so the pair is one
            // word however the column was padded.
            while out.ends_with(' ') {
                out.pop();
            }
            out.push('/');
            while chars.last() == Some(&' ') {
                chars.pop();
            }
            continue;
        }
        out.push(character);
    }
    out
}

/// A cell id is a letter and a digit, which is how the algorithm names them.
fn is_cell_id(word: &str) -> bool {
    let bytes = word.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_uppercase() && bytes[1].is_ascii_digit()
}

/// A `direction/speed` pair as the text writes it, in degrees and knots.
fn parse_pair(word: &str) -> Motion {
    let Some((left, right)) = word.split_once('/') else {
        return Motion::default();
    };
    let direction = left.trim().parse::<f64>().ok();
    let knots = right.trim().parse::<f64>().ok();
    Motion {
        direction_degrees: direction,
        // Knots to metres a second, which is what the rest of the workspace
        // carries a speed in.
        speed_ms: knots.map(|knots| knots * NAUTICAL_MILE_KM * 1000.0 / 3600.0),
    }
}

/// Reads the storm tracking product.
pub fn read_storm_cells(bytes: &[u8], station: &str) -> Result<CellReport, Level3Error> {
    let start = message_start(bytes)
        .ok_or_else(|| Level3Error::Decode("no teletype header".into()))?;
    let msg = &bytes[start..];
    let description = read_description(msg)?;
    let site = (description.latitude, description.longitude);

    let motions = description
        .tabular
        .map(|at| read_motion(&tabular_lines(msg, at)))
        .unwrap_or_default();

    let mut cells: Vec<StormCell> = Vec::new();
    if let Some(at) = description.symbology {
        // One storm is a run of packets in a fixed order: where it is, what it
        // is called, where it has been, where it is going. So a storm is not
        // finished until the next one starts, or the block ends.
        #[derive(Default)]
        struct Building {
            position: Option<(i16, i16)>,
            id: Option<String>,
            past: Vec<CellPoint>,
            forecast: Vec<CellPoint>,
        }

        let mut building = Building::default();
        let finish = |building: &mut Building, cells: &mut Vec<StormCell>| {
            let (Some((i, j)), Some(id)) = (building.position, building.id.take()) else {
                *building = Building::default();
                return;
            };
            let (latitude, longitude, range_km, azimuth_degrees) = place(site, i, j);
            let motion = motions.get(&id).copied().unwrap_or_default();
            cells.push(StormCell {
                id,
                latitude,
                longitude,
                range_km,
                azimuth_degrees,
                direction_degrees: motion.direction_degrees,
                speed_ms: motion.speed_ms,
                forecast: std::mem::take(&mut building.forecast),
                past: std::mem::take(&mut building.past),
            });
            *building = Building::default();
        };

        for packet in symbology_packets(msg, at)? {
            match packet.code {
                2 => {
                    if let Some(position) = symbol_positions(packet.payload, CURRENT).first() {
                        finish(&mut building, &mut cells);
                        building.position = Some(*position);
                    }
                }
                15 => {
                    // A length field is four bytes of position and then the
                    // name. A product claiming a shorter one is not a product
                    // this can read, and slicing it anyway takes the process
                    // down: this runs inside a command, and a panic there
                    // leaves the caller waiting on a promise that never
                    // settles either way.
                    let Some(name) = packet.payload.get(4..) else {
                        continue;
                    };
                    let id = String::from_utf8_lossy(name).trim().to_string();
                    if is_cell_id(&id) {
                        building.id = Some(id);
                    }
                }
                23 | 24 => {
                    // A container of its own packets: the track drawn as a run
                    // of symbols with a line through them.
                    let want = if packet.code == 23 { PAST } else { FORECAST };
                    let mut points = Vec::new();
                    // The nested packets start where the payload does: the
                    // container's own length was consumed reading its header,
                    // and there is no second copy of it inside.
                    for inner in packets(packet.payload) {
                        if inner.code != 2 {
                            continue;
                        }
                        for (i, j) in symbol_positions(inner.payload, want) {
                            let (latitude, longitude, _, _) = place(site, i, j);
                            points.push(CellPoint {
                                latitude,
                                longitude,
                            });
                        }
                    }
                    if packet.code == 23 {
                        building.past = points;
                    } else {
                        building.forecast = points;
                    }
                }
                _ => {}
            }
        }
        finish(&mut building, &mut cells);
    }

    Ok(CellReport {
        station: station.to_uppercase(),
        site_latitude: description.latitude,
        site_longitude: description.longitude,
        observed: description.volume_time.to_rfc3339(),
        cells,
        mesocyclones: Vec::new(),
    })
}

/// What the mesocyclone algorithm calls each kind of thing it finds.
fn point_feature(kind: u16) -> Option<&'static str> {
    match kind {
        // One to four are circulations and carry a radius; five to eight are
        // vortex signatures and do not. Two and four were being dropped, which
        // is a rotation the radar found and the map never showed.
        1..=4 => Some("mesocyclone"),
        5 | 7 => Some("tornado vortex signature"),
        6 | 8 => Some("elevated tornado vortex signature"),
        9 | 10 => Some("mesocyclone"),
        11 => Some("weak mesocyclone"),
        _ => None,
    }
}

/// How wide a circulation the attribute describes, in kilometres.
///
/// It is a radius in quarter kilometres for a circulation and carries no
/// radius at all for a vortex signature, which is a point.
fn feature_radius_km(kind: u16, attribute: u16) -> f64 {
    match kind {
        1..=4 | 9..=11 => attribute as f64 * QUARTER_KM,
        _ => 0.0,
    }
}

/// Reads the mesocyclone product, which is a list of circulations rather than
/// storms.
pub fn read_mesocyclones(bytes: &[u8]) -> Result<Vec<Mesocyclone>, Level3Error> {
    let start = message_start(bytes)
        .ok_or_else(|| Level3Error::Decode("no teletype header".into()))?;
    let msg = &bytes[start..];
    let description = read_description(msg)?;
    let site = (description.latitude, description.longitude);

    // A product with nothing detected carries no symbology block at all, which
    // is how the format says "none" rather than sending an empty one.
    let Some(at) = description.symbology else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for packet in symbology_packets(msg, at)? {
        if packet.code != 20 {
            continue;
        }
        // A point feature packet holds as many features as its length allows,
        // eight bytes each. Reading only the first meant a site with three
        // circulations in one packet showed one, which the products in hand
        // happen not to do and a busier day certainly would.
        let mut cursor = 0;
        while cursor + 8 <= packet.payload.len() {
            let feature = &packet.payload[cursor..cursor + 8];
            cursor += 8;
            let (Some(i), Some(j)) = (i16_at(feature, 0), i16_at(feature, 2)) else {
                continue;
            };
            let Some(raw) = u16_at(feature, 4) else {
                continue;
            };
            let Some(kind) = point_feature(raw) else {
                continue;
            };
            let radius_km =
                feature_radius_km(raw, u16_at(feature, 6).unwrap_or(0));
            let (latitude, longitude, _, _) = place(site, i, j);
            out.push(Mesocyclone {
                latitude,
                longitude,
                radius_km,
                kind,
            });
        }
    }
    Ok(out)
}

/// How far apart two products' volume times may be and still be one volume.
///
/// A scan is four to six minutes, so anything inside two is the same one.
const SAME_VOLUME_SECONDS: i64 = 120;

/// When the volume a product describes was taken.
fn volume_time_of(bytes: &[u8]) -> Result<DateTime<Utc>, Level3Error> {
    let start = message_start(bytes)
        .ok_or_else(|| Level3Error::Decode("no teletype header".into()))?;
    Ok(read_description(&bytes[start..])?.volume_time)
}

/// The newest key for one site and product, from the bucket's own listing.
async fn newest_key(site: &str, product: &str) -> Result<Option<String>, Level3Error> {
    // Yesterday as well as today, because a site is quiet for hours at a time
    // and just after midnight UTC today's listing is empty.
    let now = Utc::now();
    for day in [now, now - Duration::days(1)] {
        let prefix = format!("{site}_{product}_{}", day.format("%Y_%m_%d"));
        let url = format!(
            "https://{BUCKET}/?list-type=2&prefix={prefix}&max-keys=1000"
        );
        let body = http::get_bytes(&url).await?;
        let body = String::from_utf8_lossy(&body);
        if let Some(key) = last_key(&body) {
            return Ok(Some(key));
        }
    }
    Ok(None)
}

/// The last key in a listing, which is the newest: S3 answers in order.
fn last_key(listing: &str) -> Option<String> {
    let mut newest = None;
    let mut rest = listing;
    while let Some(start) = rest.find("<Key>") {
        let after = &rest[start + 5..];
        let Some(end) = after.find("</Key>") else {
            break;
        };
        newest = Some(after[..end].to_string());
        rest = &after[end..];
    }
    newest
}

/// Everything one site is tracking right now.
#[tauri::command]
pub async fn level3_cells(station: String) -> Result<CellReport, Level3Error> {
    let station = station.to_uppercase();
    let site = bucket_site(&station).ok_or_else(|| Level3Error::UnknownSite(station.clone()))?;

    let Some(key) = newest_key(&site, "NST").await? else {
        return Err(Level3Error::NoProduct(station, "storm tracking".into()));
    };
    let bytes = http::get_bytes(&format!("https://{BUCKET}/{key}")).await?;
    let description_time = volume_time_of(&bytes)?;
    let mut report = read_storm_cells(&bytes, &station)?;

    // The rotations are a second product from the same volume, and the two are
    // published separately, so the newest of each can be a scan apart. A storm
    // moves six kilometres in five minutes, against the fifteen the page uses
    // to decide which storm a rotation belongs to, so a pair from different
    // volumes puts circulations on the wrong storms. They are only used when
    // the two agree about which volume they describe.
    //
    // A failure here is not a reason to lose the cells: the cells are what the
    // map is mostly about, and a site with no rotation publishes a hundred and
    // fifty bytes of header.
    if let Ok(Some(key)) = newest_key(&site, "NMD").await {
        if let Ok(bytes) = http::get_bytes(&format!("https://{BUCKET}/{key}")).await {
            if let Some(found) = rotations_for(description_time, &bytes) {
                report.mesocyclones = found;
            }
        }
    }

    Ok(report)
}

/// The rotations that belong with a set of cells, or none at all.
///
/// The two products are published separately and the newest of each can be a
/// scan apart, so this is where they are held to describing the same volume.
/// It is a function rather than a condition inside the fetch so that a test can
/// put a real product through it: written inline, the gate could be widened to
/// forever or closed to never and every test stayed green.
fn rotations_for(description_time: DateTime<Utc>, bytes: &[u8]) -> Option<Vec<Mesocyclone>> {
    let found = read_mesocyclones(bytes).ok()?;
    let when = volume_time_of(bytes).ok()?;
    ((when - description_time).num_seconds().abs() <= SAME_VOLUME_SECONDS).then_some(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NST: &[u8] = include_bytes!("../tests/fixtures/TLX_NST_2022_05_04_23_55_15");
    const NMD: &[u8] = include_bytes!("../tests/fixtures/TBW_NMD_2026_08_30_18_50_19");
    /// The same product from a site with nothing turning: a header and no more.
    const QUIET: &[u8] = include_bytes!("../tests/fixtures/JAX_NMD_2026_08_30_19_53_11");

    #[test]
    fn the_bucket_files_a_site_under_three_letters() {
        assert_eq!(bucket_site("KTLX").as_deref(), Some("TLX"));
        assert_eq!(bucket_site("ktlx").as_deref(), Some("TLX"));
        assert_eq!(bucket_site("PHKI").as_deref(), Some("HKI"));
        assert_eq!(bucket_site("TLX"), None);
        assert_eq!(bucket_site("KTL1"), None);
        assert_eq!(bucket_site(""), None);
    }

    #[test]
    fn the_header_of_a_real_product_reads_as_the_document_says() {
        // A storm tracking product from Oklahoma City, 4 May 2022. Every field
        // here is checked against something outside the file: the site's
        // published position, and the timestamp in the name it was stored
        // under.
        let start = message_start(NST).expect("a teletype header");
        assert_eq!(start, 30, "the header is thirty bytes on this product");

        let msg = &NST[start..];
        assert_eq!(i16_at(msg, 0), Some(58), "storm tracking is message 58");
        // The length field describes the message and not the header.
        assert_eq!(
            i32_at(msg, 8).map(|length| length as usize + start),
            Some(NST.len()),
            "the message length should account for the whole file"
        );

        let description = read_description(msg).expect("a description block");
        // KTLX is at 35.3331 N, 97.2778 W.
        assert!((description.latitude - 35.333).abs() < 0.01);
        assert!((description.longitude + 97.278).abs() < 0.01);
        // And the volume time is the one in the key it was stored under.
        assert_eq!(
            description.volume_time.to_rfc3339(),
            "2022-05-04T23:55:15+00:00"
        );
        assert!(description.symbology.is_some());
        assert!(description.tabular.is_some());
    }

    #[test]
    fn the_cells_come_out_where_the_product_says_they_are() {
        let report = read_storm_cells(NST, "KTLX").expect("the product decodes");
        assert_eq!(report.station, "KTLX");
        assert!(
            report.cells.len() > 5,
            "a busy afternoon should have several cells, got {}",
            report.cells.len()
        );

        // Every cell is named the way the algorithm names them, and sits
        // inside the range the product reaches.
        for cell in &report.cells {
            assert!(is_cell_id(&cell.id), "{} is not a cell id", cell.id);
            assert!(
                cell.range_km < 500.0,
                "{} is {} km out, which is past the product",
                cell.id,
                cell.range_km
            );
            assert!((0.0..360.0).contains(&cell.azimuth_degrees));
            // Within a few degrees of the radar, which is the only place a
            // cell this radar found can be.
            assert!((cell.latitude - report.site_latitude).abs() < 5.0);
            assert!((cell.longitude - report.site_longitude).abs() < 6.0);
        }

        // The ids are distinct: a run of packets read as one cell twice would
        // be the easiest thing to get wrong here.
        let mut ids: Vec<&str> = report.cells.iter().map(|cell| cell.id.as_str()).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "the same cell came out twice");
    }

    #[test]
    fn a_cells_position_agrees_with_the_algorithms_own_text() {
        // The bytes give a position in quarter kilometres and the tabular
        // block gives the same cell as a bearing and a distance in nautical
        // miles. They are independent statements about the same storm, and
        // this is the only check available that the geometry is right.
        let start = message_start(NST).expect("a header");
        let msg = &NST[start..];
        let description = read_description(msg).expect("a description");
        let lines = tabular_lines(msg, description.tabular.expect("a tabular block"));
        let report = read_storm_cells(NST, "KTLX").expect("the product decodes");

        let mut checked = 0;
        for line in &lines {
            // Through the same tidying the motion parse uses. Splitting the
            // raw line turned "93/ 34" into two words and skipped the row,
            // which quietly dropped every cell inside a hundred miles: twelve
            // of thirty-four, all of them the near ones.
            let tidied = tidy_row(line);
            let words: Vec<&str> = tidied.split_whitespace().collect();
            let Some(id) = words.first() else { continue };
            if !is_cell_id(id) {
                continue;
            }
            let Some((azimuth, range_nm)) = words.get(1).and_then(|pair| {
                let (left, right) = pair.split_once('/')?;
                Some((left.trim().parse::<f64>().ok()?, right.trim().parse::<f64>().ok()?))
            }) else {
                continue;
            };
            let Some(cell) = report.cells.iter().find(|cell| cell.id == *id) else {
                continue;
            };
            let apart = (cell.azimuth_degrees - azimuth).abs();
            assert!(
                apart.min(360.0 - apart) < 1.5,
                "{id}: the bytes say {} degrees and the text says {azimuth}",
                cell.azimuth_degrees
            );
            assert!(
                (cell.range_km - range_nm * NAUTICAL_MILE_KM).abs() < 1.5,
                "{id}: the bytes say {} km and the text says {range_nm} nm",
                cell.range_km
            );
            checked += 1;
        }
        assert!(
            checked >= 30,
            "only {checked} of the product's own rows could be cross-checked"
        );
    }

    #[test]
    fn a_cell_carries_the_motion_the_text_gives_it() {
        let report = read_storm_cells(NST, "KTLX").expect("the product decodes");
        let moving: Vec<&StormCell> = report
            .cells
            .iter()
            .filter(|cell| cell.speed_ms.is_some())
            .collect();
        assert!(
            !moving.is_empty(),
            "no cell was given a motion, and the text has them"
        );
        for cell in moving {
            let speed = cell.speed_ms.expect("a speed");
            // Nothing on the plains moves at more than a hundred knots.
            assert!(
                (0.0..60.0).contains(&speed),
                "{} is moving at {speed} metres a second",
                cell.id
            );
            let direction = cell.direction_degrees.expect("a direction with a speed");
            assert!((0.0..=360.0).contains(&direction));
        }
    }

    #[test]
    fn a_cell_carries_where_it_has_been_and_where_it_is_going() {
        let report = read_storm_cells(NST, "KTLX").expect("the product decodes");
        let tracked = report
            .cells
            .iter()
            .find(|cell| !cell.forecast.is_empty())
            .expect("some cell should have a forecast");
        assert!(tracked.forecast.len() <= 4, "an hour in quarter hours");
        for point in tracked.forecast.iter().chain(tracked.past.iter()) {
            assert!((point.latitude - report.site_latitude).abs() < 6.0);
            assert!((point.longitude - report.site_longitude).abs() < 7.0);
        }
    }

    #[test]
    fn the_rotations_come_out_of_their_own_product() {
        let found = read_mesocyclones(NMD).expect("the product decodes");
        assert!(
            !found.is_empty(),
            "this product was chosen because it has detections in it"
        );
        for one in &found {
            assert!(!one.kind.is_empty());
            assert!(
                (0.0..40.0).contains(&one.radius_km),
                "a circulation {} km wide is not one",
                one.radius_km
            );
            // Tampa Bay, where this was recorded.
            assert!((one.latitude - 27.7).abs() < 4.0, "{}", one.latitude);
            assert!((one.longitude + 82.4).abs() < 4.0, "{}", one.longitude);
        }
    }

    /// A product carrying one symbology packet, built by hand.
    ///
    /// The real products in hand happen to write one feature per packet, so a
    /// packet holding several can only be checked by making one.
    fn product_with_packet(code: u16, payload: &[u8]) -> Vec<u8> {
        let start = message_start(NMD).expect("a header");
        let mut out = NMD[..start].to_vec();
        let mut msg = NMD[start..start + MESSAGE_HEADER + DESCRIPTION_BLOCK].to_vec();
        // The symbology block begins right after the description, which is
        // sixty halfwords in.
        let symbology_at = MESSAGE_HEADER + DESCRIPTION_BLOCK;
        msg[MESSAGE_HEADER + 90..MESSAGE_HEADER + 94]
            .copy_from_slice(&((symbology_at as i32) / 2).to_be_bytes());
        // No graphic or tabular block.
        msg[MESSAGE_HEADER + 94..MESSAGE_HEADER + 98].copy_from_slice(&0i32.to_be_bytes());
        msg[MESSAGE_HEADER + 98..MESSAGE_HEADER + 102].copy_from_slice(&0i32.to_be_bytes());

        let packet_len = payload.len() as u16;
        let layer_len = 4 + payload.len() as i32;
        msg.extend_from_slice(&(-1i16).to_be_bytes());
        msg.extend_from_slice(&1i16.to_be_bytes());
        msg.extend_from_slice(&(10 + 6 + layer_len).to_be_bytes());
        msg.extend_from_slice(&1i16.to_be_bytes());
        msg.extend_from_slice(&(-1i16).to_be_bytes());
        msg.extend_from_slice(&layer_len.to_be_bytes());
        msg.extend_from_slice(&code.to_be_bytes());
        msg.extend_from_slice(&packet_len.to_be_bytes());
        msg.extend_from_slice(payload);

        let length = msg.len() as i32;
        msg[8..12].copy_from_slice(&length.to_be_bytes());
        out.extend_from_slice(&msg);
        out
    }

    #[test]
    fn every_rotation_in_a_packet_is_read_and_not_only_the_first() {
        // A point feature packet holds as many features as its length allows.
        // Reading only the first showed one circulation where the radar had
        // found three, which is the difference between one storm to watch and
        // a line of them.
        let mut payload = Vec::new();
        for (i, j, kind, attribute) in [
            (100i16, 200i16, 3u16, 8u16),
            (-300, 400, 3, 12),
            // A non-zero attribute, so the guard that gives a vortex
            // signature no radius is doing something the test can see: with a
            // zero here, multiplying by the scale gives zero whether the guard
            // is there or not.
            (500, -600, 7, 24),
        ] {
            payload.extend_from_slice(&i.to_be_bytes());
            payload.extend_from_slice(&j.to_be_bytes());
            payload.extend_from_slice(&kind.to_be_bytes());
            payload.extend_from_slice(&attribute.to_be_bytes());
        }
        let found =
            read_mesocyclones(&product_with_packet(20, &payload)).expect("decodes");
        assert_eq!(found.len(), 3, "three features in one packet");
        assert_eq!(found[0].kind, "mesocyclone");
        assert!((found[0].radius_km - 2.0).abs() < 0.01, "eight quarters");
        assert!((found[1].radius_km - 3.0).abs() < 0.01);
        // A vortex signature is a point and carries no radius.
        assert_eq!(found[2].kind, "tornado vortex signature");
        assert_eq!(found[2].radius_km, 0.0);
    }

    #[test]
    fn every_kind_of_circulation_the_document_names_is_read() {
        // Two and four were being dropped, which is a rotation the radar found
        // and the map never showed.
        for kind in 1u16..=11 {
            let mut payload = Vec::new();
            payload.extend_from_slice(&0i16.to_be_bytes());
            payload.extend_from_slice(&0i16.to_be_bytes());
            payload.extend_from_slice(&kind.to_be_bytes());
            payload.extend_from_slice(&8u16.to_be_bytes());
            let found =
                read_mesocyclones(&product_with_packet(20, &payload)).expect("decodes");
            assert_eq!(found.len(), 1, "feature type {kind} was dropped");
        }
        // And something the document does not name is left alone rather than
        // drawn as a circulation nobody reported.
        let mut payload = Vec::new();
        payload.extend_from_slice(&0i16.to_be_bytes());
        payload.extend_from_slice(&0i16.to_be_bytes());
        payload.extend_from_slice(&99u16.to_be_bytes());
        payload.extend_from_slice(&8u16.to_be_bytes());
        assert!(read_mesocyclones(&product_with_packet(20, &payload))
            .expect("decodes")
            .is_empty());
    }

    #[test]
    fn a_product_with_nothing_in_it_is_not_an_error() {
        // A site with no rotation publishes a header and stops: a hundred and
        // fifty bytes, with every block offset zero. Treating that as a
        // failure would put an error on screen for the ordinary case of
        // nothing happening.
        assert!(QUIET.len() < 200, "the quiet product is a header and no more");
        assert_eq!(read_mesocyclones(QUIET).expect("still decodes"), Vec::new());

        let start = message_start(QUIET).expect("a header");
        let description = read_description(&QUIET[start..]).expect("a description");
        assert_eq!(description.symbology, None);
    }

    #[test]
    fn no_corruption_of_a_real_product_can_take_the_process_down() {
        // This runs inside a command. A panic there does not become an error
        // the caller can see: the promise never settles either way, so the
        // panel sits reading forever and asks again four minutes later.
        //
        // One byte was enough. Setting the low half of any storm id packet's
        // length field to zero made the decoder slice past the end of a
        // payload it had just been told was empty, and there are eighty-eight
        // such bytes in this one file.
        for product in [NST, NMD, QUIET] {
            for at in 0..product.len() {
                for byte in [0x00u8, 0x01, 0x7f, 0xff] {
                    let mut broken = product.to_vec();
                    broken[at] = byte;
                    // Both readers, since they walk different packets.
                    let _ = read_storm_cells(&broken, "KTLX");
                    let _ = read_mesocyclones(&broken);
                }
            }
        }
    }

    #[test]
    fn a_product_that_stops_in_the_middle_is_refused_rather_than_fatal() {
        // Every length a truncated download could leave behind.
        for product in [NST, NMD] {
            for length in 0..product.len() {
                let _ = read_storm_cells(&product[..length], "KTLX");
                let _ = read_mesocyclones(&product[..length]);
            }
        }
    }

    #[test]
    fn a_product_whose_offsets_point_anywhere_is_refused_rather_than_fatal() {
        // The block offsets are the decoder's only instructions about where
        // to look, and they arrive from the network.
        let start = message_start(NST).expect("a header");
        for offset in [
            0i32,
            1,
            -1,
            60,
            100,
            1000,
            100_000,
            0x4000_0000,
            i32::MAX,
            i32::MIN,
        ] {
            for field in [90usize, 94, 98] {
                let mut broken = NST.to_vec();
                let at = start + MESSAGE_HEADER + field;
                broken[at..at + 4].copy_from_slice(&offset.to_be_bytes());
                let _ = read_storm_cells(&broken, "KTLX");
                let _ = read_mesocyclones(&broken);
            }
        }
    }

    #[test]
    #[ignore = "asks the live NEXRAD Level III archive for today's products"]
    fn reads_what_a_site_is_tracking_right_now() {
        // The committed fixtures prove the layout. This proves the bucket
        // still answers the way it did, which is the half that can change
        // without anybody touching this code: two of the four products this
        // was written around stopped publishing in 2022 and nothing announced
        // it.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");

        // A busy site somewhere. Storms are not guaranteed, but a published
        // product is: the tracking product runs every volume whether or not
        // it found anything.
        // A site can be down for maintenance, so no single one of them is
        // allowed to fail this on its own. What has to hold is that the
        // bucket answers and at least one site is publishing now.
        let mut answered = 0;
        let mut current = 0;
        for station in ["KTLX", "KJAX", "KTBW", "KDMX", "KGRR"] {
            let Ok(report) = runtime.block_on(level3_cells(station.to_string()))
            else {
                continue;
            };
            answered += 1;
            assert_eq!(report.station, station);
            // The site's own position, from the product's own header.
            assert!((-180.0..=180.0).contains(&report.site_longitude));
            assert!((-90.0..=90.0).contains(&report.site_latitude));
            let observed = DateTime::parse_from_rfc3339(&report.observed)
                .expect("the volume time is a time");
            let age = Utc::now() - observed.with_timezone(&Utc);
            if age.num_minutes() < 90 {
                current += 1;
            }

            for cell in &report.cells {
                assert!(is_cell_id(&cell.id), "{} is not a cell id", cell.id);
                assert!(cell.range_km < 500.0, "{} km out", cell.range_km);
            }
            println!(
                "{station}: {} cells, {} rotations, volume {} ({} minutes old)",
                report.cells.len(),
                report.mesocyclones.len(),
                report.observed,
                age.num_minutes()
            );
        }
        assert!(
            answered > 0,
            "no site answered at all, which means the bucket or the key format moved"
        );
        assert!(
            current > 0,
            "{answered} sites answered but none within the last ninety minutes,              which means the listing is finding old keys rather than new ones"
        );
    }

    #[test]
    fn rotations_are_only_used_when_they_describe_the_same_volume() {
        // The two products are published separately, so the newest of each can
        // be a scan apart. A storm moves six kilometres in five minutes,
        // against the fifteen the page uses to decide which storm a rotation
        // belongs to, so a mismatched pair puts circulations on the wrong
        // storms.
        //
        // The gate had nothing checking it in either direction: widening it to
        // forever and closing it to never both left every test green, because
        // the test written for it reimplemented the comparison as a local
        // closure and asserted on the constant. This one puts a real product
        // through the real function.
        let when = volume_time_of(NMD).expect("the fixture carries a volume time");
        let scan = Duration::seconds(SAME_VOLUME_SECONDS);
        let inside = Duration::seconds(SAME_VOLUME_SECONDS - 1);
        let outside = Duration::seconds(SAME_VOLUME_SECONDS + 1);

        // A description from the same volume takes the rotations.
        let together = rotations_for(when, NMD).expect("the same volume is the same volume");
        assert!(
            !together.is_empty(),
            "the fixture has to hold rotations, or nothing below measures anything"
        );
        assert_eq!(
            rotations_for(when + inside, NMD).map(|found| found.len()),
            Some(together.len()),
            "one second inside the window is the same volume"
        );
        assert_eq!(
            rotations_for(when - inside, NMD).map(|found| found.len()),
            Some(together.len()),
            "and in the other direction"
        );
        assert_eq!(
            rotations_for(when + scan, NMD).map(|found| found.len()),
            Some(together.len()),
            "the edge counts as the same volume"
        );

        // A description from the volume either side does not.
        assert!(
            rotations_for(when + outside, NMD).is_none(),
            "a second past the edge is another volume"
        );
        assert!(
            rotations_for(when - outside, NMD).is_none(),
            "and in the other direction"
        );

        // A real scan apart, which is what this exists to reject.
        assert!(rotations_for(when + Duration::minutes(5), NMD).is_none());
        assert!(rotations_for(when - Duration::minutes(5), NMD).is_none());
    }

    #[test]
    fn a_listing_gives_back_its_newest_key() {
        let listing = "<ListBucketResult>\
             <Contents><Key>TLX_NST_2026_08_30_23_50_11</Key></Contents>\
             <Contents><Key>TLX_NST_2026_08_30_23_55_15</Key></Contents>\
             </ListBucketResult>";
        assert_eq!(
            last_key(listing).as_deref(),
            Some("TLX_NST_2026_08_30_23_55_15")
        );
        assert_eq!(last_key("<ListBucketResult/>"), None);
        assert_eq!(
            last_key("<Key>TLX_NST_2026_08_30_23_55_15</Key><Key>truncated").as_deref(),
            Some("TLX_NST_2026_08_30_23_55_15")
        );
    }

    #[test]
    fn no_data_in_a_row_does_not_shift_the_columns() {
        // The algorithm writes NO DATA where it could not forecast, which is
        // two words in a column that otherwise holds one. Splitting on
        // whitespace without putting it back together read the movement out
        // of the wrong column.
        let lines = vec![
            "      Y6     186/ 82   245/  5     186/ 82   NO DATA   NO DATA   NO DATA    1.1/ 1.3"
                .to_string(),
            "      S5     203/111   127/ 13     204/110   205/109   206/108   207/107    2.3/ 1.2"
                .to_string(),
        ];
        let motions = read_motion(&lines);
        let y6 = motions.get("Y6").expect("Y6 has a row");
        assert_eq!(y6.direction_degrees, Some(245.0));
        assert!((y6.speed_ms.expect("a speed") - 2.57).abs() < 0.05, "five knots");
        let s5 = motions.get("S5").expect("S5 has a row");
        assert_eq!(s5.direction_degrees, Some(127.0));
        assert!((s5.speed_ms.expect("a speed") - 6.69).abs() < 0.05, "thirteen knots");
    }

    #[test]
    fn a_position_a_known_distance_away_lands_where_it_should() {
        // A hundred kilometres due north of the radar is a degree of latitude
        // for every hundred and eleven, and no change of longitude at all.
        let site = (35.333, -97.278);
        let (latitude, longitude) = offset(site, 0.0, 111.195);
        assert!((latitude - 36.333).abs() < 0.01, "{latitude}");
        assert!((longitude - site.1).abs() < 0.01, "{longitude}");

        // And due east, where a degree of longitude is shorter than one of
        // latitude by the cosine of where you are standing.
        let (latitude, longitude) = offset(site, 90.0, 111.195);
        assert!((latitude - site.0).abs() < 0.02, "{latitude}");
        let expected = site.1 + 1.0 / site.0.to_radians().cos();
        assert!((longitude - expected).abs() < 0.02, "{longitude}");
    }
}

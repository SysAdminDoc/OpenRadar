//! Terminal Doppler Weather Radar: the airports' own radars, held like a site.
//!
//! The FAA runs forty-five of these at the big airports, and the Weather
//! Service relays their products over the same Level III feed the WSR-88D
//! products travel on, under the airport's own three-letter code. They see
//! the low levels over a city better than the WSR-88D thirty miles out does,
//! which is exactly where a microburst or a gust front lives, and no open
//! radar app draws them.
//!
//! They are not another WSR-88D and this module is where the differences are
//! kept, so nothing else has to know them. There is no Level II archive at
//! all: the sweep is read from the Level III radial products, one per moment
//! per tilt. The gate is 150 m to 48 nautical miles rather than 250 m to
//! 230 km, with a long-range reflectivity product at 300 m to 225. There are
//! three tilts rather than fourteen, and the lowest one is chosen per site.
//! There is reflectivity and there is velocity, and nothing else: no spectrum
//! width and no dual-polarisation moments, because the radar does not have
//! them. The products carry their own scale in the description block, which
//! is read rather than assumed.
//!
//! The site list is the network the weather service says is running now:
//! https://api.weather.gov/radar/stations?stationType=TDWR (read 2026-09-04,
//! forty-five stations). NCEI's own station file carries two more, TJBQ and
//! TJRV, and they are not radars any more: the station endpoint answers 404
//! for both and neither has published a Level III product in a year. That
//! file is a historical inventory and this table is what a reader can hold,
//! so the two are not the same list. The product set and the
//! tilts are the Radar Product Central Collection Dissemination Service's
//! own table: https://www.weather.gov/media/tg/rpccds_radar_products.pdf
//! (180/DR base reflectivity and 182/DV base radial velocity at 48 nmi as
//! TZ0 and TV0 on the lowest tilt, TZ1 and TV1 at 1.0 degrees, TZ2 and TV2
//! above that; 186/DR long range reflectivity at 225 nmi as TZL).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use nexrad_model::data::{GateStatus, Product};
use nexrad_model::geo::{GeoPoint, RadarCoordinateSystem};
use nexrad_model::meta::Site;
use serde::Deserialize;

use crate::level2::{self, Level2Error, Shading, SweepImage, SweepSource};
use crate::level3::{self, Description, RadialImage};
use crate::{http, palette};

/// What the legend and the panel call this kind of radar.
pub const RADAR: &str = "TDWR";
/// 48 nautical miles: 592 gates of 150 m, which is what the base products hold.
pub const BASE_RANGE_KM: f64 = 88.8;
/// 225 nautical miles: 1390 gates of 300 m, the long-range product.
pub const LONG_RANGE_KM: f64 = 417.0;
const BASE_BIN_KM: f64 = 0.15;
const LONG_BIN_KM: f64 = 0.30;
/// The three tilts of each moment, lowest first.
const REFLECTIVITY_TILTS: [&str; 3] = ["TZ0", "TZ1", "TZ2"];
const VELOCITY_TILTS: [&str; 3] = ["TV0", "TV1", "TV2"];
const LONG_RANGE: &str = "TZL";
const SOURCE_LABEL: &str = "NOAA NEXRAD Level III (TDWR)";
const SOURCE_URL: &str = "https://registry.opendata.aws/noaa-nexrad/";
/// How long a tilt's angle is remembered for a site. The angles do not change.
const ANGLES_FOR: Duration = Duration::from_secs(30 * 60);
/// Enough of a product to hold its teletype line, header and description.
const HEADER_BYTES: u64 = 255;
/// Feet, which is how the station file gives a height, to metres.
const METRES_PER_FOOT: f32 = 0.3048;

/// One of the forty-five, as the station file has it.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TdwrSite {
    /// Four letters starting with T, which is how the feed spells them.
    pub id: String,
    pub name: String,
    pub state: String,
    pub latitude: f32,
    pub longitude: f32,
    pub elevation_feet: i16,
}

impl TdwrSite {
    /// The three-letter code the bucket files the products under.
    fn bucket_code(&self) -> &str {
        &self.id[1..]
    }

    fn to_site(&self) -> Site {
        let mut id = [0u8; 4];
        let bytes = self.id.as_bytes();
        id[..bytes.len().min(4)].copy_from_slice(&bytes[..bytes.len().min(4)]);
        Site::new(
            id,
            self.latitude,
            self.longitude,
            (f32::from(self.elevation_feet) * METRES_PER_FOOT).round() as i16,
            0,
        )
    }
}

/// The station list, shared with the page so there is one copy of it.
pub fn sites() -> &'static [TdwrSite] {
    static SITES: OnceLock<Vec<TdwrSite>> = OnceLock::new();
    SITES.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/lib/tdwrSites.json"))
            .expect("the bundled TDWR station list is well formed")
    })
}

pub fn site(station: &str) -> Option<&'static TdwrSite> {
    let wanted = station.trim().to_ascii_uppercase();
    sites().iter().find(|site| site.id == wanted)
}

/// Whether a station id names one of these rather than a WSR-88D.
pub fn is_tdwr(station: &str) -> bool {
    site(station).is_some()
}

/// A product this radar has, and how it is read.
struct Asked {
    code: &'static str,
    /// The ICD product code the bytes must carry: 180 for base reflectivity,
    /// 182 for base velocity, 186 for the long range reflectivity.
    expected: u16,
    moment: Product,
    unit: &'static str,
    label: &'static str,
    bin_km: f64,
    range_km: f64,
    /// The tilts the picker offers for this product, lowest first.
    tilts: &'static [&'static str],
    tilt_index: usize,
}

/// What a product id and a tilt mean here, or nothing for a product this
/// radar does not have. The tilt is clamped to what there is, the way the
/// Level II path clamps a tilt past the top of a volume.
fn asked_for(product: &str, tilt: usize) -> Option<Asked> {
    match product {
        "reflectivity" => {
            let tilt_index = tilt.min(REFLECTIVITY_TILTS.len() - 1);
            Some(Asked {
                code: REFLECTIVITY_TILTS[tilt_index],
                expected: 180,
                moment: Product::Reflectivity,
                unit: "dBZ",
                label: "Reflectivity",
                bin_km: BASE_BIN_KM,
                range_km: BASE_RANGE_KM,
                tilts: &REFLECTIVITY_TILTS,
                tilt_index,
            })
        }
        "velocity" => {
            let tilt_index = tilt.min(VELOCITY_TILTS.len() - 1);
            Some(Asked {
                code: VELOCITY_TILTS[tilt_index],
                expected: 182,
                moment: Product::Velocity,
                unit: "m/s",
                label: "Velocity",
                bin_km: BASE_BIN_KM,
                range_km: BASE_RANGE_KM,
                tilts: &VELOCITY_TILTS,
                tilt_index,
            })
        }
        "long-range-reflectivity" => Some(Asked {
            code: LONG_RANGE,
            expected: 186,
            moment: Product::Reflectivity,
            unit: "dBZ",
            label: "Long range reflectivity",
            bin_km: LONG_BIN_KM,
            range_km: LONG_RANGE_KM,
            tilts: std::slice::from_ref(&LONG_RANGE),
            tilt_index: 0,
        }),
        _ => None,
    }
}

/// The bytes say what they are.
///
/// A listing that answered with some other product, or a file the feed
/// mislabelled, must not be drawn on this product's scale: velocity painted
/// on the reflectivity ramp is a picture of weather that is not there. Its own
/// function so a test can hold it to that without reaching for the network.
fn product_matches(code: &str, found: u16, expected: u16) -> Result<(), Level2Error> {
    if found == expected {
        return Ok(());
    }
    Err(Level2Error::Decode(format!(
        "{code} holds product {found} where {expected} was expected"
    )))
}

/// What a gate's byte means on the product's own scale.
///
/// The description block gives the scale as a minimum, an increment and a
/// count of levels, and the first two levels are not values: nothing above
/// the threshold, and a return the radar cannot place in range.
pub fn gate_value(level: u8, minimum: f32, increment: f32) -> (GateStatus, f32) {
    match level {
        0 => (GateStatus::NoData, 0.0),
        1 => (GateStatus::RangeFolded, 0.0),
        _ => (
            GateStatus::Valid,
            minimum + f32::from(level - 2) * increment,
        ),
    }
}

/// Which radial covers each tenth of a degree, or none.
///
/// The antenna does not turn at a constant rate, so the radials carry their
/// own start and width and the gaps between them are real; a lookup over the
/// circle answers a pixel's bearing in one step rather than a search.
fn radial_slots(image: &RadialImage) -> Vec<u16> {
    let mut slots = vec![u16::MAX; 3600];
    for (index, radial) in image.radials.iter().enumerate() {
        let start = (radial.start_degrees * 10.0).round() as i64;
        let width = (radial.width_degrees * 10.0).round().max(1.0) as i64;
        for step in 0..width {
            let slot = (start + step).rem_euclid(3600) as usize;
            slots[slot] = index as u16;
        }
    }
    slots
}

/// The sweep as pixels, pinned to a box, the same way a Level II sweep is.
pub struct Rendered {
    pub pixels: Vec<u8>,
    pub bounds: [f64; 4],
}

/// Paints a radial product into the square the Level II renderer uses, so
/// the same image lane draws either without knowing which it has.
pub fn render(
    image: &RadialImage,
    description: &Description,
    site: &TdwrSite,
    moment: Product,
    unit: &str,
    shading: Shading,
    range_km: f64,
) -> Rendered {
    let coordinates = RadarCoordinateSystem::new(&site.to_site());
    let extent = coordinates.sweep_extent(range_km);
    let west = extent.min.longitude;
    let east = extent.max.longitude;
    let south = extent.min.latitude;
    let north = extent.max.latitude;
    let top = level2::mercator_y(north);
    let bottom = level2::mercator_y(south);
    let table = palette::for_unit(unit);
    let slots = radial_slots(image);
    let size = level2::IMAGE_SIZE;
    let first_km = f64::from(image.first_bin) * image.bin_km;

    let mut pixels = vec![0u8; size * size * 4];
    for row in 0..size {
        let y = top + (bottom - top) * ((row as f64 + 0.5) / size as f64);
        let latitude = level2::inverse_mercator_y(y);
        for column in 0..size {
            let longitude = west + (east - west) * ((column as f64 + 0.5) / size as f64);
            let polar = coordinates.geo_to_polar(
                GeoPoint {
                    latitude,
                    longitude,
                },
                description.elevation_degrees,
            );
            if polar.range_km > range_km || polar.range_km < first_km {
                continue;
            }
            let slot = ((polar.azimuth_degrees * 10.0).round() as i64).rem_euclid(3600) as usize;
            let index = slots[slot];
            if index == u16::MAX {
                continue;
            }
            let radial = &image.radials[index as usize];
            let bin = ((polar.range_km - first_km) / image.bin_km).floor() as usize;
            let Some(level) = radial.gates.get(bin) else {
                continue;
            };
            let (status, value) = gate_value(*level, description.minimum, description.increment);
            let Some((color, alpha)) =
                level2::gate_color(&status, value, moment, table.as_ref(), None, shading)
            else {
                continue;
            };
            let at = (row * size + column) * 4;
            pixels[at] = color[0];
            pixels[at + 1] = color[1];
            pixels[at + 2] = color[2];
            pixels[at + 3] = alpha;
        }
    }
    Rendered {
        pixels,
        bounds: [west, south, east, north],
    }
}

fn decode_error(error: level3::Level3Error) -> Level2Error {
    Level2Error::Decode(error.to_string())
}

/// The newest product of one code for a site, and its key.
async fn newest_product(site: &TdwrSite, code: &str) -> Result<(String, Vec<u8>), Level2Error> {
    let key = level3::newest_key(site.bucket_code(), code)
        .await
        .map_err(decode_error)?
        .ok_or_else(|| Level2Error::NoVolume(site.id.clone()))?;
    let bytes = http::get_bytes(&format!("https://{}/{key}", level3::BUCKET)).await?;
    Ok((key, bytes))
}

/// The angle of each tilt product at each site, and when it was read.
type AngleCache = HashMap<(String, &'static str), (f32, Instant)>;

fn angles_held() -> &'static Mutex<AngleCache> {
    static HELD: OnceLock<Mutex<AngleCache>> = OnceLock::new();
    HELD.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The angle a tilt's product is scanned at, read off its header.
///
/// Only the first few hundred bytes are asked for: the description block
/// carries the angle, and the picker wants three angles without three whole
/// products. Remembered for a while afterwards, because they do not change.
async fn tilt_angle(site: &TdwrSite, code: &'static str) -> Option<f32> {
    let held = angles_held();
    if let Some((angle, at)) = held
        .lock()
        .ok()
        .and_then(|map| map.get(&(site.id.clone(), code)).copied())
    {
        if at.elapsed() < ANGLES_FOR {
            return Some(angle);
        }
    }
    let key = level3::newest_key(site.bucket_code(), code).await.ok()??;
    let head = http::get_range(
        &format!("https://{}/{key}", level3::BUCKET),
        0,
        HEADER_BYTES,
    )
    .await
    .ok()?;
    let angle = level3::read_header(&head).ok()?.elevation_degrees;
    if let Ok(mut map) = held.lock() {
        map.insert((site.id.clone(), code), (angle, Instant::now()));
    }
    Some(angle)
}

/// One tilt of one moment from a TDWR, drawn the way a Level II sweep is.
///
/// Unfolding, storm motion and the volume in progress do not apply: the
/// products arrive already processed by the radar's own generator, there is
/// no Level II to read a motion from, and nothing is published in pieces.
pub async fn sweep(
    station: String,
    product: String,
    tilt: usize,
    threshold: Option<f32>,
    high_contrast: bool,
) -> Result<SweepImage, Level2Error> {
    let site = site(&station).ok_or_else(|| Level2Error::UnknownSite(station.clone()))?;
    let asked = asked_for(&product, tilt)
        .ok_or_else(|| Level2Error::NoSweep(station.clone(), product.clone()))?;

    let (key, bytes) = newest_product(site, asked.code).await?;
    // The other tilts' angles, for the picker. The one being drawn comes from
    // the product itself; a tilt whose angle cannot be read is offered by
    // its code's position with the angle it will turn out to have once seen.
    let mut tilts = Vec::with_capacity(asked.tilts.len());
    for (index, code) in asked.tilts.iter().enumerate() {
        if index == asked.tilt_index {
            tilts.push(None);
        } else {
            tilts.push(tilt_angle(site, code).await);
        }
    }

    let site = site.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (description, image) =
            level3::read_radial_product(&bytes, asked.bin_km).map_err(decode_error)?;
        product_matches(asked.code, description.product_code, asked.expected)?;
        let shading = Shading {
            unfolded: false,
            threshold,
            high_contrast,
        };
        let rendered = render(
            &image,
            &description,
            &site,
            asked.moment,
            asked.unit,
            shading,
            asked.range_km,
        );
        let png = level2::encode_png(&rendered.pixels)?;
        let [west, south, east, north] = rendered.bounds;
        let elevation = description.elevation_degrees;
        // A tilt the header could not be read for takes the angle of the one
        // drawn, which is at least a number from this radar; the picker shows
        // it beside its position rather than inventing one.
        let tilts: Vec<f32> = tilts
            .into_iter()
            .map(|angle| angle.unwrap_or(elevation))
            .collect();
        Ok(SweepImage {
            station: site.id.clone(),
            site_name: format!("{}, {}", site.name, site.state),
            product_id: product,
            product: asked.label.to_string(),
            palette_applied: palette::for_unit(asked.unit).is_some(),
            high_contrast,
            // An airport radar's products arrive as a picture already, so
            // there are no gates here to read between.
            smoothed: false,
            dealiased: false,
            storm_motion: None,
            unit: asked.unit.to_string(),
            elevation_degrees: elevation,
            tilts,
            tilt_index: asked.tilt_index,
            live: false,
            live_tilts: 0,
            collected: description.volume_time.to_rfc3339(),
            // A terminal radar publishes one finished product at a time, so
            // there is never a second sweep under this one.
            beneath_collected: None,
            west,
            south,
            east,
            north,
            image: level2::data_url(&png),
            volume: key,
            source: SweepSource {
                kind: "recent".to_string(),
                label: SOURCE_LABEL.to_string(),
                url: Some(SOURCE_URL.to_string()),
            },
            radar: RADAR,
            range_km: asked.range_km,
        })
    })
    .await
    .map_err(|error| Level2Error::Decode(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const TZ0: &[u8] = include_bytes!("../tests/fixtures/DAL_TZ0_2026_09_01_19_56_53");
    const TV0: &[u8] = include_bytes!("../tests/fixtures/DAL_TV0_2026_09_01_19_56_53");
    const TZL: &[u8] = include_bytes!("../tests/fixtures/DAL_TZL_2026_09_01_19_56_53");

    fn dallas() -> &'static TdwrSite {
        site("TDAL").expect("Dallas Love Field is in the list")
    }

    #[test]
    #[ignore = "asks the live NWS station list which terminal radars exist"]
    fn every_site_in_the_table_is_one_the_office_still_lists() {
        // The identifier of a terminal radar can change under the app: the
        // Radar Operations Center renamed West Palm Beach from TPBI to TDJT
        // on 2026-08-03 (SCN26-61), and the only symptom was that holding the
        // site drew nothing. A name the bucket does not know looks exactly
        // like a radar that is quiet, so nothing said why and the site sat
        // dead in the list for a month.
        //
        // Asked of the station list rather than of the bucket, because the
        // bucket cannot tell the two apart: Louisville had published nothing
        // for three weeks on 2026-09-04 and is a real radar the office lists
        // as running. What this catches is a name that is not a radar.
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let listed = runtime
            .block_on(crate::radar_status::terminal_stations())
            .expect("the office answers");
        assert!(
            listed.len() >= 40,
            "only {} terminal radars listed, which is the feed being wrong rather than the table",
            listed.len()
        );
        let missing: Vec<&str> = sites()
            .iter()
            .map(|site| site.id.as_str())
            .filter(|id| !listed.iter().any(|listed| listed == id))
            .collect();
        assert!(
            missing.is_empty(),
            "the table names {missing:?}, which the office does not list as terminal radars"
        );
    }

    #[test]
    fn knows_the_forty_five_from_the_official_list() {
        let all = sites();
        assert_eq!(all.len(), 45);
        let mut ids: Vec<&str> = all.iter().map(|site| site.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 45, "an id repeats");
        for site in all {
            assert_eq!(site.id.len(), 4, "{}", site.id);
            assert!(site.id.starts_with('T'), "{} is not a TDWR id", site.id);
            assert!(site.id.chars().all(|c| c.is_ascii_uppercase()));
            assert!((17.0..50.0).contains(&site.latitude), "{}", site.id);
            assert!((-160.0..-60.0).contains(&site.longitude), "{}", site.id);
            assert!(!site.name.is_empty() && site.state.len() == 2);
        }
        assert!(is_tdwr("tdal") && is_tdwr("TDAL") && !is_tdwr("KTLX") && !is_tdwr("TXXX"));
        assert_eq!(dallas().bucket_code(), "DAL");
    }

    #[test]
    fn the_products_say_which_radar_and_where_it_is() {
        // The header carries the site's own position, and the station file
        // agrees with it to the metre it is printed at: the list is the right
        // list, and the products are the right products.
        for (bytes, code, bins, elevation, minimum) in [
            (TZ0, 180u16, 592u16, 0.5f32, -32.0f32),
            (TV0, 182, 592, 0.5, -63.5),
            (TZL, 186, 1390, 0.5, -32.0),
        ] {
            let bin_km = if code == 186 {
                LONG_BIN_KM
            } else {
                BASE_BIN_KM
            };
            let (description, image) = level3::read_radial_product(bytes, bin_km).expect("decodes");
            assert_eq!(description.product_code, code);
            assert_eq!(image.bins, bins);
            assert_eq!(image.radials.len(), 360);
            assert!((description.elevation_degrees - elevation).abs() < 1e-6);
            assert!((description.minimum - minimum).abs() < 1e-6);
            assert!((description.increment - 0.5).abs() < 1e-6);
            assert!((description.latitude - f64::from(dallas().latitude)).abs() < 0.001);
            assert!((description.longitude - f64::from(dallas().longitude)).abs() < 0.001);
        }
    }

    #[test]
    fn values_follow_the_scale_the_product_carries() {
        assert!(matches!(gate_value(0, -32.0, 0.5).0, GateStatus::NoData));
        assert!(matches!(
            gate_value(1, -32.0, 0.5).0,
            GateStatus::RangeFolded
        ));
        let (status, value) = gate_value(2, -32.0, 0.5);
        assert!(matches!(status, GateStatus::Valid));
        assert!((value + 32.0).abs() < 1e-6);
        // The heaviest gate in the Dallas product is level 144, and the
        // header's own maximum reflectivity halfword says 39 dBZ.
        assert!((gate_value(144, -32.0, 0.5).1 - 39.0).abs() < 1e-6);
        // Velocity: level 129 is zero, and the scale runs either side.
        assert!(gate_value(129, -63.5, 0.5).1.abs() < 1e-6);
        assert!((gate_value(161, -63.5, 0.5).1 - 16.0).abs() < 1e-6);
    }

    #[test]
    fn a_product_that_is_not_what_was_asked_for_is_refused() {
        // The guard itself, rather than a fact about the fixture. Velocity
        // painted on the reflectivity ramp is a picture of weather that is not
        // there, so a file the feed mislabelled must not be drawn at all.
        assert!(product_matches("TZ0", 180, 180).is_ok());
        let refused = product_matches("TZ0", 182, 180).expect_err("a refusal");
        let said = refused.to_string();
        assert!(said.contains("182"), "{said}");
        assert!(said.contains("180"), "{said}");
        assert!(said.contains("TZ0"), "{said}");
    }

    #[test]
    fn the_bytes_have_to_be_the_product_that_was_asked_for() {
        // The velocity fixture, read as though it were reflectivity: the
        // code in the header does not match and the sweep is refused rather
        // than drawn in dBZ.
        let asked = asked_for("reflectivity", 0).expect("a product");
        let (description, _) = level3::read_radial_product(TV0, asked.bin_km).expect("decodes");
        assert_ne!(description.product_code, asked.expected);
        let velocity = asked_for("velocity", 0).expect("a product");
        assert_eq!(description.product_code, velocity.expected);
    }

    #[test]
    fn every_bearing_falls_in_a_radial() {
        let (_, image) = level3::read_radial_product(TZ0, BASE_BIN_KM).expect("decodes");
        let slots = radial_slots(&image);
        let missing = slots.iter().filter(|slot| **slot == u16::MAX).count();
        assert_eq!(missing, 0, "{missing} tenths of a degree have no radial");
    }

    #[test]
    fn paints_the_sweep_inside_its_reach_and_nowhere_else() {
        let (description, image) = level3::read_radial_product(TZ0, BASE_BIN_KM).expect("decodes");
        let shading = Shading {
            unfolded: false,
            threshold: None,
            high_contrast: false,
        };
        let rendered = render(
            &image,
            &description,
            dallas(),
            Product::Reflectivity,
            "dBZ",
            shading,
            BASE_RANGE_KM,
        );
        let size = level2::IMAGE_SIZE;
        assert_eq!(rendered.pixels.len(), size * size * 4);
        let [west, south, east, north] = rendered.bounds;
        // Ninety kilometres either way of Dallas, and the box says so.
        assert!(
            (east - west) > 1.8 && (east - west) < 2.0,
            "{} wide",
            east - west
        );
        assert!(
            (north - south) > 1.5 && (north - south) < 1.7,
            "{} tall",
            north - south
        );
        let alpha = |column: usize, row: usize| rendered.pixels[(row * size + column) * 4 + 3];
        // The corners of the box are outside the circle, so nothing is there.
        assert_eq!(alpha(0, 0), 0);
        assert_eq!(alpha(size - 1, size - 1), 0);
        // And a September afternoon has echoes: something is painted.
        let painted = (0..size * size)
            .filter(|at| rendered.pixels[at * 4 + 3] > 0)
            .count();
        assert!(painted > 1000, "{painted} pixels painted");
        // A threshold takes the weak echoes off and leaves the stronger. A
        // quiet afternoon: the only gates past 30 dBZ are two of ground
        // clutter within three hundred metres of the antenna, so ten is the
        // number that splits this product.
        let thresholded = |floor: f32| {
            let drawn = render(
                &image,
                &description,
                dallas(),
                Product::Reflectivity,
                "dBZ",
                Shading {
                    unfolded: false,
                    threshold: Some(floor),
                    high_contrast: false,
                },
                BASE_RANGE_KM,
            );
            (0..size * size)
                .filter(|at| drawn.pixels[at * 4 + 3] > 0)
                .count()
        };
        let kept = thresholded(10.0);
        assert!(kept > 0 && kept < painted, "{kept} of {painted} kept");
        // And a floor nothing reaches clears the picture, which is what
        // tells the threshold apart from being ignored.
        assert_eq!(thresholded(60.0), 0);
    }

    #[test]
    fn the_long_range_product_reaches_four_hundred_kilometres() {
        let (description, image) = level3::read_radial_product(TZL, LONG_BIN_KM).expect("decodes");
        assert!((f64::from(image.bins) * image.bin_km - LONG_RANGE_KM).abs() < 1.0);
        let rendered = render(
            &image,
            &description,
            dallas(),
            Product::Reflectivity,
            "dBZ",
            Shading {
                unfolded: false,
                threshold: None,
                high_contrast: false,
            },
            LONG_RANGE_KM,
        );
        let [west, _, east, _] = rendered.bounds;
        assert!(east - west > 8.5, "{} wide", east - west);
    }

    #[test]
    fn offers_only_what_the_radar_has() {
        assert!(asked_for("reflectivity", 0).is_some());
        assert!(asked_for("velocity", 2).is_some());
        assert!(asked_for("long-range-reflectivity", 0).is_some());
        for product in [
            "spectrum-width",
            "differential-reflectivity",
            "correlation-coefficient",
            "storm-relative-velocity",
            "anything",
        ] {
            assert!(
                asked_for(product, 0).is_none(),
                "{product} is not a TDWR product"
            );
        }
        // A tilt past the top is the top, not an error.
        let asked = asked_for("reflectivity", 9).expect("clamped");
        assert_eq!((asked.code, asked.tilt_index), ("TZ2", 2));
        let long = asked_for("long-range-reflectivity", 2).expect("one tilt");
        assert_eq!((long.code, long.tilt_index), ("TZL", 0));
    }

    /// Talks to the bucket, so it is ignored with the other live tests.
    #[test]
    #[ignore = "fetches a live TDWR product from the Level III bucket"]
    fn draws_a_live_dallas_sweep() {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let sweep = runtime
            .block_on(sweep("TDAL".into(), "reflectivity".into(), 0, None, false))
            .expect("Dallas publishes every six minutes");
        assert_eq!(sweep.station, "TDAL");
        assert_eq!(sweep.radar, RADAR);
        assert!((sweep.range_km - BASE_RANGE_KM).abs() < 1e-9);
        assert_eq!(sweep.tilts.len(), 3);
        assert!(sweep.image.starts_with("data:image/png;base64,"));
        println!(
            "{} {} at {} deg, tilts {:?}, collected {}",
            sweep.station, sweep.product, sweep.elevation_degrees, sweep.tilts, sweep.collected
        );
    }
}

//! Single-site NEXRAD Level II radar: fetch a volume, decode one sweep, and
//! draw it as a Web Mercator image the map can lay over its own bounds.
//!
//! The mosaics OpenRadar leads with are national and smoothed. This is the
//! radar itself, one site at a time, which is what a close-in view wants.
//!
//! What is in this file is what all of it shares: the errors, the shapes that
//! cross the bridge, and the two caches. The work is next door, one file per
//! step of the same journey. It was one file of seven thousand lines with
//! four more products due to land in it, and the split is by what a change
//! touches rather than by size: colours, listings, decoding, choosing a cut,
//! drawing it, siting, the commands, and the vertical slice.
//!
//! Everything is `pub(crate)` across that boundary and re-exported here, so
//! `crate::level2::whatever` still names the same thing it always did. Each
//! module's tests sit beside it in a file of their own, and the fixtures more
//! than one of them is written on are in `testing`.

use std::collections::{hash_map::DefaultHasher, BTreeMap, BTreeSet, VecDeque};
use std::fs::File as FsFile;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine;
use chrono::{DateTime, Datelike, Duration, Utc};
use nexrad_data::volume;
use nexrad_decode::messages::MessageContents;
use nexrad_model::data::{GateStatus, Product, Scan, SweepField};
use nexrad_model::geo::{GeoPoint, RadarCoordinateSystem};
use nexrad_model::meta::registry;
use serde::Serialize;

use crate::chunks;
use crate::cross_section;
use crate::dealias;
use crate::http;
use crate::level3;
use crate::palette;
use crate::palette::Palette;
use crate::radar_status;
use crate::tdwr;
use crate::vad;
use crate::vwp;

const ARCHIVE_HOST: &str = "https://unidata-nexrad-level2.s3.amazonaws.com";
/// The image is square because a sweep is a circle; this is its side in pixels.
pub(crate) const IMAGE_SIZE: usize = 1024;
/// A WSR-88D surveillance cut reaches this far, and the extent follows it.
pub(crate) const MAX_RANGE_KM: f64 = 230.0;
/// How far a viewport may sit from a site and still be worth handing over to
/// it. Past this the view is outside the site's coverage and the national
/// mosaic is the only honest picture, so nothing is offered.
///
/// The same distance the sweep is drawn to, deliberately. A site further away
/// than its own surveillance cut reaches would be handed a view its rendered
/// disc does not contain, and the viewer would zoom in on a hole. That did not
/// matter while only the nearest site was ever chosen; it does now that a
/// downed one is passed over for the next.
const SITE_REACH_KM: f64 = MAX_RANGE_KM;
/// Four volumes, as the roadmap asks. They are held compressed, not decoded.
const CACHE_CAPACITY: usize = 4;

/// How many decoded volumes to keep beside the compressed ones.
///
/// Fewer than the compressed cache holds, because a decoded volume is the
/// expensive one to keep: the compressed bytes are what came off the network
/// and the scan is what they turn into, several times larger.
const DECODED_CAPACITY: usize = 3;

/// The ceiling on what the decoded cache may hold, counted in the source bytes
/// each volume arrived as.
///
/// Counted that way deliberately. The decoded scan's own footprint cannot be
/// measured cheaply through this model's API: a radial's moments expose their
/// readings only by iterating or by allocating a vector of them, so asking a
/// volume how large it is would cost most of what decoding it did. The source
/// length is exact, known before anything is decoded, and moves with the
/// decoded size rather than independently of it, which is what a budget needs.
const DECODED_BUDGET_BYTES: usize = 64 * 1024 * 1024;

/// How old a site's newest volume may be before it counts as down.
const STALE_AFTER_MINUTES: i64 = 20;

/// How long a site's answer about its own archive is reused for.
const LIVENESS_TTL_SECONDS: i64 = 120;

/// How long a failure to reach the archive is remembered.
///
/// Shorter than an answer, because unreachable is a passing condition and a
/// site coming back should be seen quickly. Long enough that panning across a
/// region with no network does not fire the whole burst again for every tenth
/// of a degree.
const LIVENESS_FAILURE_TTL_SECONDS: i64 = 20;

/// How many sites are asked before the nearest one is used regardless.
const MAX_SITE_CANDIDATES: usize = 4;

/// How far two elevation angles may be and still be the same cut.
///
/// A sweep's angle is the median of what its radials actually measured, and
/// the pedestal does not put the antenna in the same place twice. Across
/// consecutive volumes KTLX moved a cut from 3.08 degrees to 3.12 and KOKX
/// from 4.04 to 4.00. Held to a hundredth of a degree, about one cut in ten
/// stopped matching between the finished volume and the one in progress, and
/// the live sweep for that tilt went missing with no message.
///
/// A tenth of a degree is well inside the gap between cuts, which is half a
/// degree at its narrowest in any pattern the network runs, so this cannot
/// reach the cut above or below.
const SAME_CUT_DEGREES: f32 = 0.1;

/// Local imports are bounded before they are read. Published Archive II files
/// are normally under 20 MB; this leaves room for unusually long volumes
/// without letting an accidental multi-gigabyte selection become an allocation.
const LOCAL_VOLUME_MAX_BYTES: u64 = 128 * 1024 * 1024;
/// A gzip wrapper may be much smaller than what it expands to. Keep that
/// second boundary independent of the selected file's size.
const EXPANDED_VOLUME_MAX_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum Level2Error {
    #[error("{0} is not a NEXRAD site")]
    UnknownSite(String),
    #[error("{0} is a terminal radar, which has no Level II volume to read")]
    NotWsr88d(String),
    #[error("no radar volume has been published for {0} yet today or yesterday")]
    NoVolume(String),
    #[error("{0} is no longer listed by the weather service as a radar")]
    NoLongerListed(String),
    #[error("the volume listing could not be read")]
    BadListing,
    #[error("the volume could not be decoded: {0}")]
    Decode(String),
    #[error("{0} has no {1} sweep at that tilt")]
    NoSweep(String, String),
    #[error("the wind at {0} could not be read, so nothing can be taken out of it")]
    NoStormMotion(String),
    #[error("the image could not be encoded: {0}")]
    Encode(String),
    #[error("{0} is not a UTC date and time")]
    InvalidTime(String),
    #[error("the selected file could not be read: {0}")]
    LocalRead(String),
    #[error("the selected file is larger than 128 MB")]
    LocalTooLarge,
    #[error("both ends of a cross-section have to be within range of {0}")]
    OutOfRange(String),
    #[error(transparent)]
    Http(#[from] http::HttpError),
}

impl Level2Error {
    /// A name for this kind of failure, and whatever it names.
    ///
    /// The workspace is translated and these are not, so a Spanish reader used
    /// to get an English sentence in a panel where everything else was in
    /// Spanish. Sending a code and its parts lets the page write the sentence
    /// itself, and the English text still rides along for anything the page
    /// has no wording for.
    pub(crate) fn parts(&self) -> (&'static str, Vec<String>) {
        match self {
            Self::UnknownSite(site) => ("unknownSite", vec![site.clone()]),
            Self::NotWsr88d(site) => ("notWsr88d", vec![site.clone()]),
            Self::NoVolume(site) => ("noVolume", vec![site.clone()]),
            Self::NoLongerListed(site) => ("noLongerListed", vec![site.clone()]),
            Self::BadListing => ("badListing", Vec::new()),
            Self::Decode(why) => ("decode", vec![why.clone()]),
            Self::NoSweep(site, product) => ("noSweep", vec![site.clone(), product.clone()]),
            Self::NoStormMotion(site) => ("noStormMotion", vec![site.clone()]),
            Self::Encode(why) => ("encode", vec![why.clone()]),
            Self::InvalidTime(at) => ("invalidTime", vec![at.clone()]),
            Self::LocalRead(why) => ("localRead", vec![why.clone()]),
            Self::LocalTooLarge => ("localTooLarge", Vec::new()),
            Self::OutOfRange(site) => ("outOfRange", vec![site.clone()]),
            Self::Http(error) => error.parts(),
        }
    }
}

impl Serialize for Level2Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (code, args) = self.parts();
        let mut out = serializer.serialize_struct("Level2Error", 3)?;
        out.serialize_field("code", code)?;
        out.serialize_field("args", &args)?;
        // What the native side would have said, for anything the page has no
        // wording of its own for.
        out.serialize_field("text", &self.to_string())?;
        out.end()
    }
}

/// What a sweep looks like once it is ready to draw.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepImage {
    pub station: String,
    pub site_name: String,
    /// The product that was asked for, so a caller can tell whether the sweep
    /// in hand is an answer to the question it is asking now.
    pub product_id: String,
    pub product: String,
    /// True when a loaded colour table drew this rather than the built-in ramp.
    pub palette_applied: bool,
    /// True when the high-contrast ramps drew this, so the legend beside it
    /// can be the bar the picture was actually painted with.
    pub high_contrast: bool,
    /// True when this picture was drawn by reading between the gates, so the
    /// legend can say so. It follows the picture rather than the setting: a
    /// reader who has just switched smoothing on is still looking at the
    /// sweep they had.
    pub smoothed: bool,
    /// True when the velocity in this sweep has been unfolded, so the legend
    /// can say the picture is no longer the radar's raw reading.
    pub dealiased: bool,
    /// The motion taken out of a storm relative sweep, in metres a second and
    /// the compass direction it comes from. Absent on every other product.
    pub storm_motion: Option<StormMotion>,
    pub unit: String,
    pub elevation_degrees: f32,
    /// Every tilt this volume holds, ascending, so the panel can offer them.
    pub tilts: Vec<f32>,
    pub tilt_index: usize,
    /// True when this came from the volume the radar is sweeping now rather
    /// than the last one it finished, so the legend can say the picture is
    /// live and how much of it there is.
    pub live: bool,
    /// How many tilts the radar has published of this volume so far. Only
    /// meaningful on a live sweep, where the answer grows as it is watched.
    pub live_tilts: usize,
    /// When the next piece of the volume in progress is due, and when the
    /// volume is projected to finish, from the radar's own coverage pattern.
    ///
    /// Absent on anything but a live sweep, and on a live one until a start
    /// chunk has been read: the pattern is what says how long each remaining
    /// cut takes, and there is nothing honest to say without it.
    pub next_chunk_at: Option<String>,
    pub volume_ends_at: Option<String>,
    /// When the volume was collected, not when it was fetched.
    pub collected: String,
    /// When the older cut under a live composite was collected.
    ///
    /// Present only when two sweeps are on screen at once. The legend says
    /// the age of the oldest visible sweep as well as the newest, because a
    /// composite whose age is reported from its newer half is a picture
    /// claiming to be fresher than it is.
    pub beneath_collected: Option<String>,
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
    /// The rendered sweep as a data URL, ready for a MapLibre image source.
    pub image: String,
    /// The volume key, so a caller can tell one scan from the next.
    pub volume: String,
    /// Where the bytes on screen came from. Historical and local sources are
    /// explicit so the timeline never calls them live.
    pub source: SweepSource,
    /// Which kind of radar drew this: `WSR-88D`, or `TDWR` for an airport's
    /// own radar, whose products, range and tilts all differ.
    pub radar: &'static str,
    /// How far this picture reaches from the site, in kilometres.
    pub range_km: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SweepSource {
    /// `recent`, `archive`, or `local`.
    pub kind: String,
    /// A filename for local data, otherwise the provider's name.
    pub label: String,
    /// Public attribution for provider data. Local files have no link.
    pub url: Option<String>,
}

/// One gate's reading, and which sweep it came from.
///
/// A live picture is two sweeps composited, and with persistence on the older
/// half is faded rather than absent. A reader inspecting a point has to be
/// told which of the two answered, and when that one was collected, or the
/// number is a reading with no time on it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateReading {
    pub value: f32,
    pub unit: String,
    pub product: String,
    /// When the sweep this came from was collected.
    pub collected: String,
    /// True when it came from the volume the radar is sweeping now.
    pub live: bool,
    pub azimuth_degrees: f32,
    pub range_km: f64,
}

/// What was subtracted to make a sweep storm relative.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StormMotion {
    pub speed_ms: f32,
    pub from_degrees: f32,
    /// True when the viewer gave the motion rather than the sweep being read
    /// for it, so the panel can say which it is looking at.
    pub manual: bool,
}

struct CachedVolume {
    key: String,
    data: Vec<u8>,
}

static CACHE: Mutex<VecDeque<CachedVolume>> = Mutex::new(VecDeque::new());

/// One volume that has already been turned into a scan.
///
/// Both halves are here because both cost a pass over the volume. The scan is
/// the obvious one. The folding velocities are the other: they live only in the
/// raw radial headers, which the model's scan does not carry, so reading them
/// back meant walking the whole file again for every cut asked about.
struct DecodedVolume {
    key: String,
    scan: Arc<Scan>,
    /// Every cut's folding velocity, by elevation number.
    nyquist: Arc<BTreeMap<u8, f32>>,
    /// What the volume arrived as, which is what the budget counts.
    source_bytes: usize,
}

static DECODED: Mutex<VecDeque<DecodedVolume>> = Mutex::new(VecDeque::new());

/// How many volumes have actually been decoded since this build started.
///
/// The whole point of the cache is that changing tilt or product does not
/// decode anything again, and that is invisible from the outside: the picture
/// is identical either way, only slower. A counter is what lets a test say the
/// work did not happen rather than that the answer looked right.
static DECODES: AtomicUsize = AtomicUsize::new(0);

/// A decoded volume as it is handed out: the scan, and every cut's folding
/// velocity beside it. Both are shared rather than copied, because the whole
/// point is that neither is built again.
type Decoded = (Arc<Scan>, Arc<BTreeMap<u8, f32>>);

/// A site's newest volume time, when the archive was asked, and whether the
/// asking failed rather than came back empty.
type Liveness = BTreeMap<String, (DateTime<Utc>, Option<DateTime<Utc>>, bool)>;

/// What the archive last held for each site.
static LIVENESS: Mutex<Liveness> = Mutex::new(BTreeMap::new());
mod commands;
mod decode;
mod draw;
mod listing;
mod ramp;
mod render;
mod section;
mod sites;
mod sweep;
#[cfg(test)]
mod testing;

pub(crate) use commands::*;
pub(crate) use decode::*;
pub(crate) use draw::*;
pub(crate) use listing::*;
pub(crate) use ramp::*;
pub(crate) use render::*;
pub(crate) use section::*;
pub(crate) use sites::*;
pub(crate) use sweep::*;

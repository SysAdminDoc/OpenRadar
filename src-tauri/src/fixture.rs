//! A Level II volume written out byte by byte, for tests that need one.
//!
//! A real volume is ten megabytes and cannot be committed, and downloading one
//! makes the weather part of the test. What is wanted instead is a volume whose
//! every reading is known in advance, so a test can say what should come back
//! rather than only that something did.
//!
//! The layout is the one the RDA publishes and the ICD describes: an Archive II
//! header, then LDM records holding type 31 messages, one message per radial,
//! each carrying a volume block with the site, an elevation block, a radial
//! block with the folding velocity, and one generic block per moment.

use std::io::Write;

use chrono::{DateTime, Utc};

/// What one gate reads.
///
/// The first two counts of every moment are reserved: nothing measured, and a
/// return whose range the radar cannot place. A fixture that could not write
/// them left both decode paths uncovered, and a test that wanted to say the
/// radar had looked and found nothing had to plant a very weak reading and
/// rely on the ramp drawing it clear, which is not the same thing.
#[derive(Clone, Copy, PartialEq)]
pub enum Gate {
    /// A reading, in the moment's own unit.
    Reading(f32),
    /// The radar looked and there was nothing above its threshold.
    Nothing,
    /// A return the radar cannot say the range of.
    RangeFolded,
}

/// One radial's worth of readings.
pub struct Radial {
    pub azimuth_degrees: f32,
    pub azimuth_number: u16,
    pub elevation_number: u8,
    pub elevation_degrees: f32,
    /// The velocity this cut folds at, in metres a second.
    pub nyquist_ms: f32,
    pub collected: DateTime<Utc>,
    /// How far apart this cut's radials are, in degrees. Written into the
    /// header as the code the ICD gives it, and it has to be the spacing the
    /// radials are actually at: the drawing reads the header to decide how
    /// wide a wedge each radial stands for.
    pub azimuth_spacing_degrees: f32,
    /// Reflectivity in dBZ, one per gate.
    pub reflectivity: Vec<Gate>,
    /// Velocity in metres a second, one per gate, or empty for no velocity.
    pub velocity: Vec<Gate>,
}

/// Where the radar stands.
pub struct Site {
    pub id: [u8; 4],
    pub latitude: f32,
    pub longitude: f32,
    pub height_metres: i16,
}

/// Range to the middle of the first gate, in metres.
const FIRST_GATE_M: u16 = 2125;

/// How far apart the gates are, in metres.
const GATE_INTERVAL_M: u16 = 250;

/// Reflectivity is published as one byte a gate, scaled and offset.
const REFLECTIVITY_SCALE: f32 = 2.0;
const REFLECTIVITY_OFFSET: f32 = 66.0;

/// Velocity at 0.5 m/s a count, the resolution a wide cut uses.
const VELOCITY_SCALE: f32 = 2.0;
const VELOCITY_OFFSET: f32 = 129.0;

/// The first two counts are reserved: nothing measured, and range folded.
const FIRST_REAL_COUNT: f32 = 2.0;

fn scaled(gate: Gate, scale: f32, offset: f32) -> u8 {
    match gate {
        Gate::Nothing => 0,
        Gate::RangeFolded => 1,
        Gate::Reading(value) => {
            let count = (value * scale + offset).round();
            count.clamp(FIRST_REAL_COUNT, 255.0) as u8
        }
    }
}

/// The 24-byte Archive II header a volume opens with.
pub fn volume_header(site: &Site, at: DateTime<Utc>) -> Vec<u8> {
    let mut out = Vec::with_capacity(24);
    out.extend_from_slice(b"AR2V0006.");
    out.extend_from_slice(b"001");
    let (date, time) = stamp(at);
    out.extend_from_slice(&(date as u32).to_be_bytes());
    out.extend_from_slice(&time.to_be_bytes());
    out.extend_from_slice(&site.id);
    out
}

/// Days since 1 January 1970 counting from one, and milliseconds past midnight.
fn stamp(at: DateTime<Utc>) -> (u16, u32) {
    let days = at.timestamp() / 86_400;
    let past_midnight = at.timestamp_millis() - days * 86_400_000;
    ((days + 1) as u16, past_midnight as u32)
}

/// One type 31 message, header and blocks, for a single radial.
pub fn radial_message(site: &Site, radial: &Radial) -> Vec<u8> {
    let gates = radial.reflectivity.len();
    let with_velocity = !radial.velocity.is_empty();
    assert!(
        !with_velocity || radial.velocity.len() == gates,
        "a radial's moments have to cover the same gates"
    );

    let blocks = if with_velocity { 5u16 } else { 4u16 };
    // The pointers are counted from the start of the type 31 header, which is
    // 32 bytes, and are themselves four bytes each.
    let first_block = 32 + 4 * blocks as u32;

    let mut volume = Vec::new();
    volume.extend_from_slice(b"RVOL");
    // A length of 44 or less is what tells a reader this is the block as it
    // was before Build 20 lengthened it.
    volume.extend_from_slice(&44u16.to_be_bytes());
    volume.push(1); // major version
    volume.push(0); // minor version
    volume.extend_from_slice(&site.latitude.to_be_bytes());
    volume.extend_from_slice(&site.longitude.to_be_bytes());
    volume.extend_from_slice(&site.height_metres.to_be_bytes());
    volume.extend_from_slice(&20u16.to_be_bytes()); // tower height
    volume.extend_from_slice(&(-58.0f32).to_be_bytes()); // calibration constant
    volume.extend_from_slice(&700_000.0f32.to_be_bytes()); // horizontal power
    volume.extend_from_slice(&700_000.0f32.to_be_bytes()); // vertical power
    volume.extend_from_slice(&0.0f32.to_be_bytes()); // differential reflectivity
    volume.extend_from_slice(&0.0f32.to_be_bytes()); // initial differential phase
    volume.extend_from_slice(&12u16.to_be_bytes()); // coverage pattern
    volume.extend_from_slice(&0u16.to_be_bytes()); // processing status
    assert_eq!(volume.len(), 44);

    let mut elevation = Vec::new();
    elevation.extend_from_slice(b"RELV");
    elevation.extend_from_slice(&8u16.to_be_bytes());
    elevation.extend_from_slice(&0i16.to_be_bytes()); // atmospheric attenuation
    elevation.extend_from_slice(&(-58.0f32).to_be_bytes());
    assert_eq!(elevation.len(), 12);

    let mut radial_block = Vec::new();
    radial_block.extend_from_slice(b"RRAD");
    // Twenty or less is the pre-Build-12 block, which is the one written here.
    radial_block.extend_from_slice(&20u16.to_be_bytes());
    radial_block.extend_from_slice(&466u16.to_be_bytes()); // unambiguous range
    radial_block.extend_from_slice(&(-48.0f32).to_be_bytes()); // horizontal noise
    radial_block.extend_from_slice(&(-48.0f32).to_be_bytes()); // vertical noise
                                                               // Published in hundredths of a metre a second.
    radial_block.extend_from_slice(&((radial.nyquist_ms * 100.0).round() as u16).to_be_bytes());
    radial_block.extend_from_slice(&0u16.to_be_bytes()); // radial flags
    assert_eq!(radial_block.len(), 20);

    let reflectivity = moment_block(
        b"DREF",
        &radial.reflectivity,
        REFLECTIVITY_SCALE,
        REFLECTIVITY_OFFSET,
    );
    let velocity = with_velocity
        .then(|| moment_block(b"DVEL", &radial.velocity, VELOCITY_SCALE, VELOCITY_OFFSET));

    let mut pointers = vec![first_block];
    for block in [Some(&volume), Some(&elevation), Some(&radial_block)]
        .into_iter()
        .flatten()
    {
        let last = *pointers.last().expect("seeded above");
        pointers.push(last + block.len() as u32);
    }
    if velocity.is_some() {
        let last = *pointers.last().expect("seeded above");
        pointers.push(last + reflectivity.len() as u32);
    }
    assert_eq!(pointers.len(), blocks as usize);

    let (date, time) = stamp(radial.collected);

    let mut message = Vec::new();
    message.extend_from_slice(&site.id);
    message.extend_from_slice(&time.to_be_bytes());
    message.extend_from_slice(&date.to_be_bytes());
    message.extend_from_slice(&radial.azimuth_number.to_be_bytes());
    message.extend_from_slice(&radial.azimuth_degrees.to_be_bytes());
    message.push(0); // uncompressed
    message.push(0); // spare, for halfword alignment
    let body: usize = 32
        + 4 * blocks as usize
        + volume.len()
        + elevation.len()
        + radial_block.len()
        + reflectivity.len()
        + velocity.as_ref().map_or(0, Vec::len);
    message.extend_from_slice(&(body as u16).to_be_bytes());
    // The code the ICD gives the spacing: one for half a degree, two for a
    // whole one. What is written here has to be the spacing the radials are
    // actually at, because the drawing reads it to decide how wide a wedge
    // each radial stands for. Declaring half a degree while writing whole ones
    // left 29 per cent of a swept sector showing the volume underneath, and
    // the tests passed against the stripes.
    message.push(if radial.azimuth_spacing_degrees <= 0.5 {
        1
    } else {
        2
    });
    message.push(1); // intermediate radial
    message.push(radial.elevation_number);
    message.push(0); // cut sector
    message.extend_from_slice(&radial.elevation_degrees.to_be_bytes());
    message.push(0); // no spot blanking
    message.push(0); // no azimuth indexing
    message.extend_from_slice(&blocks.to_be_bytes());
    assert_eq!(message.len(), 32);

    for pointer in &pointers {
        message.extend_from_slice(&pointer.to_be_bytes());
    }
    message.extend_from_slice(&volume);
    message.extend_from_slice(&elevation);
    message.extend_from_slice(&radial_block);
    message.extend_from_slice(&reflectivity);
    if let Some(velocity) = &velocity {
        message.extend_from_slice(velocity);
    }
    assert_eq!(message.len(), body);

    // The outer header carries twelve bytes of RPG framing the RDA never sees,
    // then the message's own size counted in halfwords from after them.
    let mut out = vec![0u8; 12];
    out.extend_from_slice(&(((16 + body) / 2) as u16).to_be_bytes());
    out.push(8); // ORDA single channel
    out.push(31); // digital radar data
    out.extend_from_slice(&radial.azimuth_number.to_be_bytes()); // sequence
    out.extend_from_slice(&date.to_be_bytes());
    out.extend_from_slice(&time.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    assert_eq!(out.len(), 28);
    out.extend_from_slice(&message);
    out
}

/// A type 5 message naming the pattern the radar is running.
///
/// Nothing downstream reads the cut list out of it, but a volume without one
/// is refused outright, because a reader with no pattern cannot tell a cut that
/// is missing from a cut that has not been swept yet.
pub fn coverage_pattern_message(at: DateTime<Utc>, angles: &[f32]) -> Vec<u8> {
    let mut body = Vec::new();
    let size_halfwords = (22 + 28 * angles.len()) / 2;
    body.extend_from_slice(&(size_halfwords as u16).to_be_bytes());
    body.extend_from_slice(&2u16.to_be_bytes()); // a constant elevation pattern
    body.extend_from_slice(&12u16.to_be_bytes()); // pattern number
    body.extend_from_slice(&(angles.len() as u16).to_be_bytes());
    body.push(1); // version
    body.push(1); // clutter map group
    body.push(2); // 0.5 m/s velocity resolution
    body.push(2); // short pulse
    body.extend_from_slice(&0u32.to_be_bytes()); // reserved
    body.extend_from_slice(&0u16.to_be_bytes()); // sequencing
    body.extend_from_slice(&0u16.to_be_bytes()); // supplemental data
    body.extend_from_slice(&0u16.to_be_bytes()); // reserved
    assert_eq!(body.len(), 22);

    for angle in angles {
        // Angles travel as a fraction of a full turn in thirteen bits.
        let coded = (angle / 360.0 * 8192.0).round() as u16;
        body.extend_from_slice(&coded.to_be_bytes());
        body.push(0); // constant phase
        body.push(1); // contiguous surveillance
        body.push(0); // no super resolution
        body.push(1); // surveillance PRF number
        body.extend_from_slice(&28u16.to_be_bytes()); // pulses a radial
        body.extend_from_slice(&(4500u16).to_be_bytes()); // azimuth rate
        for _ in 0..6 {
            body.extend_from_slice(&0i16.to_be_bytes()); // the six thresholds
        }
        body.extend_from_slice(&0u16.to_be_bytes()); // supplemental data
        body.extend_from_slice(&0u16.to_be_bytes()); // elevation boundary angle
        body.extend_from_slice(&0u16.to_be_bytes()); // reserved
    }
    assert_eq!(body.len(), 22 + 28 * angles.len());

    let (date, time) = stamp(at);
    let mut out = vec![0u8; 12];
    out.extend_from_slice(&(((16 + body.len()) / 2) as u16).to_be_bytes());
    out.push(8); // ORDA single channel
    out.push(5); // volume coverage pattern
    out.extend_from_slice(&0u16.to_be_bytes()); // sequence
    out.extend_from_slice(&date.to_be_bytes());
    out.extend_from_slice(&time.to_be_bytes());
    out.extend_from_slice(&1u16.to_be_bytes()); // one segment
    out.extend_from_slice(&1u16.to_be_bytes()); // which is this one
    out.extend_from_slice(&body);
    // Anything but a type 31 message sits in a frame of its own, and the
    // reader steps over the whole frame whatever the message inside it holds.
    assert!(
        out.len() <= FRAME_BYTES,
        "a pattern of {} cuts does not fit in the one frame a type 5 message gets",
        angles.len()
    );
    out.resize(FRAME_BYTES, 0);
    out
}

/// A message that is not type 31 occupies a frame of exactly this size.
const FRAME_BYTES: usize = 2432;

fn moment_block(name: &[u8; 4], values: &[Gate], scale: f32, offset: f32) -> Vec<u8> {
    let mut out = Vec::with_capacity(28 + values.len());
    out.extend_from_slice(name);
    out.extend_from_slice(&0u32.to_be_bytes()); // reserved
    out.extend_from_slice(&(values.len() as u16).to_be_bytes());
    out.extend_from_slice(&FIRST_GATE_M.to_be_bytes());
    out.extend_from_slice(&GATE_INTERVAL_M.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes()); // tover
    out.extend_from_slice(&0i16.to_be_bytes()); // signal to noise threshold
    out.push(0); // no control flags
    out.push(8); // one byte a gate
    out.extend_from_slice(&scale.to_be_bytes());
    out.extend_from_slice(&offset.to_be_bytes());
    for gate in values {
        out.push(scaled(*gate, scale, offset));
    }
    out
}

/// One LDM record: a four-byte length, then the messages under bzip2.
pub fn ldm_record(messages: &[Vec<u8>]) -> Vec<u8> {
    let mut plain = Vec::new();
    for message in messages {
        plain.extend_from_slice(message);
    }

    let mut encoder = bzip2::write::BzEncoder::new(Vec::new(), bzip2::Compression::fast());
    encoder.write_all(&plain).expect("compressing into memory");
    let squeezed = encoder.finish().expect("compressing into memory");

    let mut out = Vec::with_capacity(4 + squeezed.len());
    out.extend_from_slice(&(squeezed.len() as i32).to_be_bytes());
    out.extend_from_slice(&squeezed);
    out
}

/// A whole volume: the header, then one record per group of radials.
pub fn volume(site: &Site, at: DateTime<Utc>, records: &[Vec<Radial>]) -> Vec<u8> {
    // One entry per cut, not per radial: the pattern names the cuts the radar
    // will make, and it has to fit in the single frame a type 5 message gets.
    let angles: Vec<f32> = records
        .iter()
        .filter_map(|group| group.first())
        .map(|radial| radial.elevation_degrees)
        .collect();
    let mut out = volume_header(site, at);
    out.extend_from_slice(&ldm_record(&[coverage_pattern_message(at, &angles)]));
    for group in records {
        let messages: Vec<Vec<u8>> = group
            .iter()
            .map(|radial| radial_message(site, radial))
            .collect();
        out.extend_from_slice(&ldm_record(&messages));
    }
    out
}

/// One cut of a volume, described rather than measured.
pub struct Cut {
    /// Which cut of the pattern this is, counting from one.
    pub number: u8,
    pub degrees: f32,
    /// How many radials go all the way round.
    pub radials: u16,
    pub gates: usize,
    pub reflectivity: Gate,
    /// Velocity for every gate, or None for a cut with no velocity in it.
    pub velocity: Option<Gate>,
    /// What velocity folds at, in metres a second.
    pub nyquist_ms: f32,
}

impl Default for Cut {
    fn default() -> Self {
        Self {
            number: 1,
            degrees: 0.5,
            radials: 360,
            gates: 200,
            reflectivity: Gate::Reading(20.0),
            velocity: None,
            nyquist_ms: 8.0,
        }
    }
}

/// A cut of radials all round the circle, at one elevation.
///
/// Every gate of every radial reads the same, so a test can say exactly what
/// the picture should hold and notice anything that changes it.
pub fn flat_cut(at: DateTime<Utc>, cut: Cut) -> Vec<Radial> {
    let spacing = 360.0 / cut.radials as f32;
    (0..cut.radials)
        .map(|number| Radial {
            azimuth_degrees: number as f32 * spacing,
            azimuth_number: number + 1,
            elevation_number: cut.number,
            elevation_degrees: cut.degrees,
            nyquist_ms: cut.nyquist_ms,
            collected: at,
            azimuth_spacing_degrees: spacing,
            reflectivity: vec![cut.reflectivity; cut.gates],
            velocity: cut
                .velocity
                .map_or_else(Vec::new, |speed| vec![speed; cut.gates]),
        })
        .collect()
}

//! The colours a reading is drawn in, and the projection it is drawn on.

use super::*;

/// Which derivation a product name asks for, when it asks for one.
///
/// Neither of these is a moment the radar recorded, so neither is a `Product`:
/// both are worked out from the velocity of the same cut, and the name is what
/// says which. Kept beside the table below because the two answers have to
/// agree about what a name means.
pub fn derived_from_name(name: &str) -> Option<shear::Kind> {
    match name {
        "azimuthal-shear" => Some(shear::Kind::AzimuthalShear),
        "rotation" => Some(shear::Kind::Rotation),
        _ => None,
    }
}

/// The products a caller may ask for, kept as plain names the frontend can send.
pub fn product_from_name(name: &str) -> Option<(Product, &'static str, &'static str)> {
    if let Some(kind) = derived_from_name(name) {
        let (label, unit) = shear::named(kind);
        // Both are read off the Doppler cut, so that is the moment fetched and
        // unfolded before either is worked out.
        return Some((Product::Velocity, label, unit));
    }
    match name {
        "reflectivity" => Some((Product::Reflectivity, "Reflectivity", "dBZ")),
        "velocity" => Some((Product::Velocity, "Velocity", "m/s")),
        // Drawn from the same moment, with the storm's own motion taken out.
        "storm-relative-velocity" => Some((Product::Velocity, "Storm relative velocity", "m/s")),
        "spectrum-width" => Some((Product::SpectrumWidth, "Spectrum width", "m/s")),
        "differential-reflectivity" => Some((
            Product::DifferentialReflectivity,
            "Differential reflectivity",
            "dB",
        )),
        "correlation-coefficient" => Some((
            Product::CorrelationCoefficient,
            "Correlation coefficient",
            "",
        )),
        _ => None,
    }
}

/// The NWS reflectivity ramp, the same stops the legend gradient is drawn from.
pub(crate) const REFLECTIVITY_RAMP: &[(f32, [u8; 3])] = &[
    (5.0, [0x04, 0xe9, 0xe7]),
    (10.0, [0x01, 0x9f, 0xf4]),
    (15.0, [0x03, 0x00, 0xf4]),
    (20.0, [0x02, 0xfd, 0x02]),
    (25.0, [0x01, 0xc5, 0x01]),
    (30.0, [0x00, 0x8e, 0x00]),
    (35.0, [0xfd, 0xf8, 0x02]),
    (40.0, [0xe5, 0xbc, 0x00]),
    (45.0, [0xfd, 0x95, 0x00]),
    (50.0, [0xfd, 0x00, 0x00]),
    (55.0, [0xd4, 0x00, 0x00]),
    (60.0, [0xbc, 0x00, 0x00]),
    (65.0, [0xf8, 0x00, 0xfd]),
    (70.0, [0x98, 0x54, 0xc6]),
    (75.0, [0xfd, 0xfd, 0xfd]),
];

/// Green toward the radar, red away from it, grey where the air is still.
pub(crate) const VELOCITY_RAMP: &[(f32, [u8; 3])] = &[
    (-35.0, [0x00, 0xff, 0x00]),
    (-20.0, [0x00, 0xb4, 0x00]),
    (-5.0, [0x00, 0x5a, 0x00]),
    (0.0, [0x6b, 0x6b, 0x6b]),
    (5.0, [0x5a, 0x00, 0x00]),
    (20.0, [0xb4, 0x00, 0x00]),
    (35.0, [0xff, 0x00, 0x00]),
];

/// The same ramp carried out to where unfolding puts things.
///
/// A radar folds somewhere between about 8 and 35 metres a second depending on
/// the cut, so an unfolded gate can legitimately read twice that. Drawn on the
/// ramp above, everything past 35 saturates to the same red, which hides the
/// difference between a strong wind and the one the unfolding recovered.
pub(crate) const WIDE_VELOCITY_RAMP: &[(f32, [u8; 3])] = &[
    (-70.0, [0x99, 0xff, 0x99]),
    (-35.0, [0x00, 0xff, 0x00]),
    (-20.0, [0x00, 0xb4, 0x00]),
    (-5.0, [0x00, 0x5a, 0x00]),
    (0.0, [0x6b, 0x6b, 0x6b]),
    (5.0, [0x5a, 0x00, 0x00]),
    (20.0, [0xb4, 0x00, 0x00]),
    (35.0, [0xff, 0x00, 0x00]),
    (70.0, [0xff, 0x99, 0x99]),
];

/// The reflectivity ramp for a reader who has asked for more contrast.
///
/// The ordinary NWS scale is the one everybody knows, and it is built out of
/// the two hues red-green colour blindness collapses. Measured with
/// `crate::contrast`, its closest pair of neighbouring stops is 4.9 under
/// deuteranopia, between 40 and 45 dBZ: about twice the point at which two
/// colours become distinguishable at all, for the difference between a strong
/// storm and a severe one.
///
/// This one is built the other way round. Lightness climbs from one end to the
/// other, so the reading survives even where hue is lost completely, and the
/// hue that remains swings along the blue-yellow axis that both red-green
/// deficiencies keep. Eight bands rather than fifteen, because separation is
/// what contrast is for: fifteen steps cannot be told apart by anybody once
/// the range is divided among them.
pub(crate) const HIGH_CONTRAST_REFLECTIVITY_RAMP: &[(f32, [u8; 3])] = &[
    (5.0, [0x00, 0x25, 0x6c]),
    (15.0, [0x00, 0x44, 0x7e]),
    (25.0, [0x00, 0x65, 0x62]),
    (35.0, [0x44, 0x85, 0x49]),
    (45.0, [0x8a, 0x9f, 0x37]),
    (55.0, [0xcf, 0xb5, 0x3c]),
    (65.0, [0xff, 0xb6, 0x92]),
    (75.0, [0xff, 0xf2, 0xe3]),
];

/// Velocity for the same reader: toward the radar is blue, away is orange.
///
/// Green and red are the worst possible pair for this. They are far apart to
/// ordinary vision, which is why they were chosen, and under deuteranopia the
/// two ends of the scale come within 14 of each other, so the one thing the
/// layer exists to say stops being said. Blue against orange holds them 39
/// apart for the same eyes, and it is still an obvious pair of opposites for
/// everybody else.
pub(crate) const HIGH_CONTRAST_VELOCITY_RAMP: &[(f32, [u8; 3])] = &[
    (-35.0, [0x00, 0x78, 0xba]),
    (-20.0, [0x00, 0xa3, 0xd1]),
    (-5.0, [0x9c, 0xd4, 0xed]),
    (0.0, [0xe8, 0xe8, 0xe8]),
    (5.0, [0xf5, 0xc0, 0xab]),
    (20.0, [0xd7, 0x7f, 0x57]),
    (35.0, [0xb3, 0x4f, 0x1f]),
];

/// The same, carried out to where unfolding puts things.
pub(crate) const HIGH_CONTRAST_WIDE_VELOCITY_RAMP: &[(f32, [u8; 3])] = &[
    (-70.0, [0x00, 0x4f, 0x9f]),
    (-35.0, [0x00, 0x78, 0xba]),
    (-20.0, [0x00, 0xa3, 0xd1]),
    (-5.0, [0x9c, 0xd4, 0xed]),
    (0.0, [0xe8, 0xe8, 0xe8]),
    (5.0, [0xf5, 0xc0, 0xab]),
    (20.0, [0xd7, 0x7f, 0x57]),
    (35.0, [0xb3, 0x4f, 0x1f]),
    (70.0, [0x8c, 0x19, 0x00]),
];

/// Azimuthal shear from the site's own velocity, in thousandths of a
/// reciprocal second.
///
/// The unit the national grids publish, deliberately, so a reader comparing
/// this against the MRMS layer is comparing two numbers rather than two
/// scales. The colours are not the national ones: that ramp runs low to high
/// over cyclonic shear alone, and this is signed, so it needs a middle. Blue
/// is turning the other way, and the two strongest cyclonic stops are the
/// national ramp's own, which is where the reading matters.
pub(crate) const SITE_SHEAR_RAMP: &[(f32, [u8; 3])] = &[
    (-14.0, [0x1e, 0x3a, 0x8a]),
    (-10.0, [0x25, 0x63, 0xeb]),
    (-6.0, [0x60, 0xa5, 0xfa]),
    (-2.0, [0xbf, 0xdb, 0xfe]),
    (0.0, [0x6b, 0x6b, 0x6b]),
    (2.0, [0xfe, 0xd7, 0xaa]),
    (6.0, [0xfb, 0x92, 0x3c]),
    (10.0, [0xf4, 0x3f, 0x5e]),
    (14.0, [0xc0, 0x26, 0xd3]),
];

/// The same, for a reader who has asked for more contrast.
///
/// Blue against orange, the pair the velocity scale already uses for the same
/// job: which way something is turning is the one thing this layer exists to
/// say, and red against green is the pair that stops saying it.
pub(crate) const HIGH_CONTRAST_SITE_SHEAR_RAMP: &[(f32, [u8; 3])] = &[
    (-14.0, [0x00, 0x4f, 0x9f]),
    (-6.0, [0x00, 0xa3, 0xd1]),
    (-2.0, [0x9c, 0xd4, 0xed]),
    (0.0, [0xe8, 0xe8, 0xe8]),
    (2.0, [0xf5, 0xc0, 0xab]),
    (6.0, [0xd7, 0x7f, 0x57]),
    (14.0, [0xb3, 0x4f, 0x1f]),
];

/// The same shear normalised by what its range can resolve.
///
/// One and two and a half are stops rather than points between them, because
/// they are the two numbers the operational decks are read against and a
/// threshold that falls between stops is a threshold nobody can see on the bar.
pub(crate) const SITE_ROTATION_RAMP: &[(f32, [u8; 3])] = &[
    (-5.0, [0x1e, 0x3a, 0x8a]),
    (-2.5, [0x25, 0x63, 0xeb]),
    (-1.0, [0x60, 0xa5, 0xfa]),
    (0.0, [0x6b, 0x6b, 0x6b]),
    (1.0, [0xfe, 0xd7, 0xaa]),
    (2.5, [0xf4, 0x3f, 0x5e]),
    (5.0, [0xc0, 0x26, 0xd3]),
];

pub(crate) const HIGH_CONTRAST_SITE_ROTATION_RAMP: &[(f32, [u8; 3])] = &[
    (-5.0, [0x00, 0x4f, 0x9f]),
    (-2.5, [0x00, 0xa3, 0xd1]),
    (-1.0, [0x9c, 0xd4, 0xed]),
    (0.0, [0xe8, 0xe8, 0xe8]),
    (1.0, [0xf5, 0xc0, 0xab]),
    (2.5, [0xd7, 0x7f, 0x57]),
    (5.0, [0xb3, 0x4f, 0x1f]),
];

/// The colour a gate meeting the debris criteria is marked in.
///
/// Neither ramp above holds white anywhere, which is the point: the mark has
/// to be a mark rather than another reading on the scale, and it sits over
/// whatever the shear there was.
pub(crate) const DEBRIS_MARK: [u8; 3] = [0xff, 0xff, 0xff];

/// Low to high across whatever the moment's own range is.
pub(crate) const GENERIC_RAMP: &[(f32, [u8; 3])] = &[
    (0.0, [0x1e, 0x29, 0x3b]),
    (0.25, [0x38, 0xbd, 0xf8]),
    (0.5, [0x4a, 0xde, 0x80]),
    (0.75, [0xfa, 0xcc, 0x15]),
    (1.0, [0xf4, 0x3f, 0x5e]),
];

/// Range-folded velocity is its own thing, not a speed, so it gets its own colour.
pub(crate) const RANGE_FOLDED: [u8; 3] = [0x7d, 0x26, 0xcd];

/// How solidly a gate is drawn once it is worth drawing at all.
pub(crate) const MAX_ALPHA: u8 = 235;
/// Level II at half a degree picks up dust, insects, and birds, and a bare
/// threshold paints that as a field of speckles across the whole sweep. Weak
/// returns fade in instead of arriving at full strength, so a storm reads as a
/// storm without any of the data being thrown away.
pub(crate) const FADE_FLOOR_DBZ: f32 = 5.0;
pub(crate) const FADE_CEILING_DBZ: f32 = 20.0;
pub(crate) const MIN_ALPHA: u8 = 70;

pub(crate) fn reflectivity_alpha(dbz: f32) -> u8 {
    if dbz >= FADE_CEILING_DBZ {
        return MAX_ALPHA;
    }
    let position = ((dbz - FADE_FLOOR_DBZ) / (FADE_CEILING_DBZ - FADE_FLOOR_DBZ)).clamp(0.0, 1.0);
    MIN_ALPHA + ((MAX_ALPHA - MIN_ALPHA) as f32 * position).round() as u8
}

pub(crate) fn ramp_color(ramp: &[(f32, [u8; 3])], value: f32) -> [u8; 3] {
    if value <= ramp[0].0 {
        return ramp[0].1;
    }
    for pair in ramp.windows(2) {
        let (low, low_color) = pair[0];
        let (high, high_color) = pair[1];
        if value <= high {
            let span = high - low;
            let position = if span > 0.0 {
                (value - low) / span
            } else {
                0.0
            };
            return [
                blend(low_color[0], high_color[0], position),
                blend(low_color[1], high_color[1], position),
                blend(low_color[2], high_color[2], position),
            ];
        }
    }
    ramp[ramp.len() - 1].1
}

pub(crate) fn blend(low: u8, high: u8, position: f32) -> u8 {
    (low as f32 + (high as f32 - low as f32) * position).round() as u8
}

/// The ground a sweep is drawn over: the box a reader asked for, clipped to
/// what the radar can see, and the whole disc when the two do not meet.
///
/// A sweep is one raster of a fixed size, so spending its pixels on less
/// ground is the only way a zoomed-in reader gets finer than the disc's own
/// metres per pixel. Named once because two renderers answer it and the mask
/// that composites their pixels is indexed against the answer: a box that
/// misses the disc, or has no area once clipped, leaves the whole disc drawn,
/// because an empty picture is worse than a coarse one.
///
/// Corners are `[west, south, east, north]` at both ends.
pub(crate) fn drawn_extent(disc: [f64; 4], within: Option<[f64; 4]>) -> [f64; 4] {
    let Some([asked_west, asked_south, asked_east, asked_north]) = within else {
        return disc;
    };
    let [west, south, east, north] = disc;
    let clipped = [
        west.max(asked_west),
        south.max(asked_south),
        east.min(asked_east),
        north.min(asked_north),
    ];
    if clipped[2] > clipped[0] && clipped[3] > clipped[1] {
        clipped
    } else {
        disc
    }
}

pub(crate) fn mercator_y(latitude: f64) -> f64 {
    let clamped = latitude.clamp(-85.051_129, 85.051_129);
    (std::f64::consts::FRAC_PI_4 + clamped.to_radians() / 2.0)
        .tan()
        .ln()
}

pub(crate) fn inverse_mercator_y(y: f64) -> f64 {
    (2.0 * y.exp().atan() - std::f64::consts::FRAC_PI_2).to_degrees()
}

#[cfg(test)]
#[path = "ramp_tests.rs"]
mod tests;

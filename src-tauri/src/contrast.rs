//! Whether a colour ramp still says anything to somebody who cannot see one of
//! the primaries, and how far apart two colours actually look.
//!
//! Radar has a colour problem it inherited rather than chose. The NWS
//! reflectivity scale runs green through yellow to red, and the velocity scale
//! is green one way and red the other, which are the two hues red-green colour
//! blindness collapses together. Somewhere between one in twelve and one in
//! twenty men see one of these, so this is not an edge case; it is a fair
//! fraction of anybody who opens the app.
//!
//! Getting this right needs a number rather than an opinion, so this module
//! provides one: simulate the ramp as those eyes would receive it, then measure
//! how far apart neighbouring stops remain. A ramp whose neighbours collapse
//! into each other has stopped carrying the reading it is drawn for.

/// One kind of colour vision, as a matrix applied in linear RGB.
///
/// The matrices are Machado, Oliveira and Fernandes (2009) at full severity,
/// which is the set most tools use and which is defined for exactly this: a
/// physiologically plausible rendering rather than a channel simply deleted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColorVision {
    /// Ordinary trichromatic vision, which changes nothing.
    Typical,
    /// No working long-wavelength cone. Red darkens toward black.
    Protanopia,
    /// No working medium-wavelength cone. The commonest of the three.
    Deuteranopia,
    /// No working short-wavelength cone. Rare, and worth checking anyway.
    Tritanopia,
}

/// Every vision worth holding a ramp to, including ordinary vision.
pub const EVERY_VISION: [ColorVision; 4] = [
    ColorVision::Typical,
    ColorVision::Protanopia,
    ColorVision::Deuteranopia,
    ColorVision::Tritanopia,
];

impl ColorVision {
    fn matrix(self) -> [[f32; 3]; 3] {
        match self {
            Self::Typical => [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            Self::Protanopia => [
                [0.152_286, 1.052_583, -0.204_868],
                [0.114_503, 0.786_281, 0.099_216],
                [-0.003_882, -0.048_116, 1.051_998],
            ],
            Self::Deuteranopia => [
                [0.367_322, 0.860_646, -0.227_968],
                [0.280_085, 0.672_501, 0.047_413],
                [-0.011_820, 0.042_940, 0.968_881],
            ],
            Self::Tritanopia => [
                [1.255_528, -0.076_749, -0.178_779],
                [-0.078_411, 0.930_809, 0.147_602],
                [0.004_733, 0.691_367, 0.303_900],
            ],
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Typical => "typical vision",
            Self::Protanopia => "protanopia",
            Self::Deuteranopia => "deuteranopia",
            Self::Tritanopia => "tritanopia",
        }
    }
}

/// One channel out of sRGB's gamma curve and into light.
fn to_linear(channel: u8) -> f32 {
    let value = channel as f32 / 255.0;
    if value <= 0.040_45 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

/// The colour as those eyes receive it, still in linear light.
fn simulate_linear(rgb: [u8; 3], vision: ColorVision) -> [f32; 3] {
    let linear = [to_linear(rgb[0]), to_linear(rgb[1]), to_linear(rgb[2])];
    let matrix = vision.matrix();
    let mut out = [0.0f32; 3];
    for (row, weights) in matrix.iter().enumerate() {
        out[row] = (weights[0] * linear[0] + weights[1] * linear[1] + weights[2] * linear[2])
            .clamp(0.0, 1.0);
    }
    out
}

/// Linear RGB to CIELAB, through XYZ under the D65 white the sRGB space uses.
fn to_lab(linear: [f32; 3]) -> [f32; 3] {
    let x = 0.412_456 * linear[0] + 0.357_576 * linear[1] + 0.180_437 * linear[2];
    let y = 0.212_673 * linear[0] + 0.715_152 * linear[1] + 0.072_175 * linear[2];
    let z = 0.019_334 * linear[0] + 0.119_192 * linear[1] + 0.950_304 * linear[2];

    // The D65 white point, which is what the numbers above are relative to.
    let f = |value: f32| {
        if value > 0.008_856 {
            value.cbrt()
        } else {
            7.787 * value + 16.0 / 116.0
        }
    };
    let fx = f(x / 0.950_47);
    let fy = f(y);
    let fz = f(z / 1.088_83);
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// How far apart two colours look to one kind of eye, as a CIE76 difference.
///
/// About 2.3 is the point at which a difference becomes noticeable at all, so
/// the thresholds elsewhere in this module are multiples of that rather than
/// numbers chosen to make a particular ramp pass.
pub fn distance(left: [u8; 3], right: [u8; 3], vision: ColorVision) -> f32 {
    let a = to_lab(simulate_linear(left, vision));
    let b = to_lab(simulate_linear(right, vision));
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// The closest two neighbouring stops come to each other, for one kind of eye.
///
/// Neighbours rather than every pair, deliberately. A ramp is read by comparing
/// a colour against the scale beside it, and two stops at opposite ends being
/// similar is survivable; two stops next to each other being the same is the
/// ramp having lost a step.
pub fn closest_neighbours(ramp: &[(f32, [u8; 3])], vision: ColorVision) -> f32 {
    ramp.windows(2)
        .map(|pair| distance(pair[0].1, pair[1].1, vision))
        .fold(f32::INFINITY, f32::min)
}

/// Which pair of neighbours is the closest, for saying so in a failure.
pub fn worst_pair(ramp: &[(f32, [u8; 3])], vision: ColorVision) -> (f32, f32, f32) {
    let mut worst = (f32::INFINITY, 0.0, 0.0);
    for pair in ramp.windows(2) {
        let apart = distance(pair[0].1, pair[1].1, vision);
        if apart < worst.0 {
            worst = (apart, pair[0].0, pair[1].0);
        }
    }
    worst
}

/// How far apart a diverging ramp keeps its two directions.
///
/// Neighbour distance is the wrong question for a ramp that means two opposite
/// things. Velocity is toward the radar or away from it, and a reader needs
/// those to stay apart no matter how finely the steps between them are graded:
/// a scale whose ends converge has stopped saying which way the air is moving,
/// however well its neighbours separate.
///
/// The pairs are taken from the outside in, so the first pair is the two
/// extremes and the last is the two readings either side of still air.
pub fn opposite_directions(ramp: &[(f32, [u8; 3])], vision: ColorVision) -> f32 {
    let mut worst = f32::INFINITY;
    let mut low = 0usize;
    let mut high = ramp.len().saturating_sub(1);
    while low < high {
        // A stop at zero is the neutral middle and has no opposite.
        if ramp[low].0 != 0.0 && ramp[high].0 != 0.0 {
            worst = worst.min(distance(ramp[low].1, ramp[high].1, vision));
        }
        low += 1;
        high = high.saturating_sub(1);
    }
    worst
}

/// Whether a ramp climbs steadily in lightness from one end to the other.
///
/// This is the property that makes a ramp survive any colour vision at all,
/// including a monochrome print or a screen in sunlight: if lightness carries
/// the reading then hue is decoration rather than information. It is what the
/// ordinary NWS scale does not do, and the reason its greens and reds collapse.
pub fn lightness_climbs(ramp: &[(f32, [u8; 3])], tolerance: f32) -> bool {
    ramp.windows(2).all(|pair| {
        let from = to_lab(simulate_linear(pair[0].1, ColorVision::Typical))[0];
        let to = to_lab(simulate_linear(pair[1].1, ColorVision::Typical))[0];
        to >= from - tolerance
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_colour_is_no_distance_from_itself() {
        for vision in EVERY_VISION {
            assert!(distance([0x20, 0x80, 0xc0], [0x20, 0x80, 0xc0], vision) < 0.001);
        }
    }

    #[test]
    fn black_and_white_are_as_far_apart_as_it_gets() {
        // A hundred in CIELAB is the whole lightness axis, and no colour
        // vision affects lightness enough to lose it.
        for vision in EVERY_VISION {
            let apart = distance([0, 0, 0], [255, 255, 255], vision);
            assert!(apart > 95.0, "{} lost black against white", vision.name());
        }
    }

    /// The failure this module exists to measure, stated as a test so the
    /// number is on the record rather than in an argument.
    #[test]
    fn pure_green_and_pure_red_collapse_for_the_commonest_colour_blindness() {
        let green = [0x00, 0xff, 0x00];
        let red = [0xff, 0x00, 0x00];
        // Wildly different to ordinary vision: opposite hues at similar
        // lightness, which is what makes them read as opposite readings.
        let typical = distance(green, red, ColorVision::Typical);
        assert!(typical > 100.0, "green against red should be obvious");

        // Much closer to both red-green deficiencies, which is exactly the
        // pair the velocity ramp uses for toward and away. What survives is
        // mostly lightness rather than hue: a protanope sees red as very dark,
        // so the two do not merge outright, they stop being a direction and
        // become a brightness the reader has to guess at.
        for vision in [ColorVision::Deuteranopia, ColorVision::Protanopia] {
            let apart = distance(green, red, vision);
            assert!(
                apart < typical * 0.6,
                "{} should pull green and red together, got {apart} against {typical}",
                vision.name()
            );
        }
    }

    #[test]
    fn a_ramp_that_only_climbs_in_lightness_survives_every_vision() {
        let grey: &[(f32, [u8; 3])] = &[
            (0.0, [0x11, 0x11, 0x11]),
            (1.0, [0x55, 0x55, 0x55]),
            (2.0, [0x99, 0x99, 0x99]),
            (3.0, [0xdd, 0xdd, 0xdd]),
        ];
        assert!(lightness_climbs(grey, 0.5));
        for vision in EVERY_VISION {
            assert!(
                closest_neighbours(grey, vision) > 15.0,
                "{} lost a step of a grey ramp",
                vision.name()
            );
        }
    }

    #[test]
    fn a_ramp_that_falls_back_down_is_not_climbing() {
        let hill: &[(f32, [u8; 3])] = &[
            (0.0, [0x11, 0x11, 0x11]),
            (1.0, [0xdd, 0xdd, 0xdd]),
            (2.0, [0x55, 0x55, 0x55]),
        ];
        assert!(!lightness_climbs(hill, 0.5));
    }
}

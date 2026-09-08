//! The parts of GRIB2 that every decoder in here reads the same way.
//!
//! Three modules decode GRIB2: `mrms` for the national grids, `gfs` for the
//! model winds and `hrrr` for the near-surface smoke. They read different
//! templates and share the conventions of the container, and a convention
//! written down twice is a convention that can be right in one file and wrong
//! in the other.

/// A signed integer as GRIB writes one: a sign bit and a magnitude, not two's
/// complement.
///
/// The scale factors in the data representation section are stored this way,
/// so `0x8001` is minus one rather than the minus thirty-two thousand and
/// something that reading the bytes as an `i16` gives. Getting it wrong scales
/// a whole grid by a power of ten nobody would mistake for weather, which is
/// the one comfort here.
pub fn signed(raw: i16) -> i16 {
    if raw < 0 {
        -(raw & 0x7fff)
    } else {
        raw
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_sign_bit_rather_than_twos_complement() {
        assert_eq!(signed(0x8001u16 as i16), -1);
        assert_eq!(signed(0x8000u16 as i16), 0);
        assert_eq!(signed(0xffffu16 as i16), -32767);
        assert_eq!(signed(3), 3);
        assert_eq!(signed(0), 0);
        assert_eq!(signed(0x7fff), 32767);
    }
}

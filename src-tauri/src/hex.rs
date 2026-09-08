//! Bytes as lower-case hexadecimal, which is the shape every checksum in this
//! app is written down in.
//!
//! `sha2` used to hand back a `GenericArray` that implemented `LowerHex`, so
//! five places wrote `format!("{:x}", ...)` and got the same string. Version
//! 0.11 returns a `hybrid_array::Array`, which does not, and a checksum that
//! changed shape would fail every incident pack and replay bundle already on
//! a reader's disk. So the spelling moved here rather than being written out
//! five times, and the test below holds it against the one those five were
//! producing.

/// Bytes as lower-case hex, two characters each, nothing between them.
pub(crate) fn lower(bytes: &[u8]) -> String {
    let mut written = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        // Written rather than pushed through `format!` per byte: a sixty-four
        // character checksum is not worth thirty-two allocations.
        written.push(char::from_digit(u32::from(byte >> 4), 16).unwrap_or('0'));
        written.push(char::from_digit(u32::from(byte & 0x0f), 16).unwrap_or('0'));
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_writes_what_the_old_formatting_wrote() {
        // The whole point of the module. Every incident pack and replay
        // bundle a reader already has on disk carries checksums written by
        // `format!("{:x}", ..)` over the same bytes, and they are verified on
        // open: a string of a different shape rejects all of them.
        for bytes in [
            vec![],
            vec![0x00],
            vec![0x0f],
            vec![0xff],
            vec![0x00, 0x01, 0x0a, 0x10, 0x7f, 0x80, 0xfe, 0xff],
            (0u8..=255).collect::<Vec<u8>>(),
        ] {
            let old: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
            assert_eq!(lower(&bytes), old, "for {bytes:?}");
        }
    }

    #[test]
    fn it_pads_every_byte_to_two_characters() {
        // The failure this shape invites: dropping the leading zero turns
        // 0x0a into "a" and makes a checksum shorter than it should be, which
        // still looks like a checksum.
        assert_eq!(lower(&[0x0a, 0x0b]), "0a0b");
        assert_eq!(lower(&[0u8; 32]).len(), 64);
    }

    #[test]
    fn it_writes_a_known_digest() {
        // Held against a value from outside this file, so the two tests above
        // cannot both be wrong in the same direction: the SHA-256 of the empty
        // input is a published constant.
        use sha2::{Digest as _, Sha256};
        assert_eq!(
            lower(&Sha256::digest([])),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}

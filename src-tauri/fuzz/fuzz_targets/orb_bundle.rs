#![no_main]
//! A replay bundle, which is a file somebody else made.
//!
//! `.orb` is the one container this app reads that a reader can be handed by
//! another person, and everything inside it is a length or an offset written
//! by whoever built the file: the manifest's own length, each entry's address
//! length and body length, and the counts that walk them. A bundle also rides
//! back out through an HTTP response, so a string in it reaches a header.
//!
//! The reader checks a SHA-256 over the whole file before it parses anything,
//! which is right for the product and wrong for a fuzzer: random bytes stop at
//! the checksum, and the mutations never reach the layout underneath. So the
//! interesting pass frames the fuzzer's bytes as a body and appends the
//! checksum they need, which puts libFuzzer inside the parser. The raw pass
//! stays as well, because the guards before the checksum are code too.
use libfuzzer_sys::fuzz_target;
use openradar_lib::fuzzing::{read_bundle, BUNDLE_MAGIC};
use sha2::{Digest, Sha256};

fuzz_target!(|data: &[u8]| {
    if data.len() > 1024 * 1024 {
        return;
    }

    // Whatever arrives, exactly as it arrives: the magic check, the minimum
    // length, the size ceiling and the checksum comparison itself.
    let _ = read_bundle(data);

    // And again as a body the checksum agrees with, so the manifest, the
    // entry table and the addresses are what the mutations are working on.
    let mut framed = Vec::with_capacity(BUNDLE_MAGIC.len() + data.len() + 32);
    framed.extend_from_slice(BUNDLE_MAGIC);
    framed.extend_from_slice(data);
    let checksum = Sha256::digest(&framed);
    framed.extend_from_slice(&checksum);
    let _ = read_bundle(&framed);
});

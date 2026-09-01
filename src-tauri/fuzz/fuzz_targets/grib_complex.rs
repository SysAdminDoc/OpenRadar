#![no_main]
//! Complex packing with spatial differencing, which is decoded here by hand.
//!
//! Two sections, so the input is split rather than generated as a pair: the
//! first two bytes say how long section 5 is and the rest is section 7. A
//! split from the input keeps the corpus a plain file that a crash reproducer
//! can be replayed from.
use libfuzzer_sys::fuzz_target;
use openradar_lib::fuzzing::decode_complex;

fuzz_target!(|data: &[u8]| {
    if data.len() < 2 || data.len() > 1024 * 1024 {
        return;
    }
    let split = usize::from(u16::from_be_bytes([data[0], data[1]]));
    let rest = &data[2..];
    let split = split.min(rest.len());
    let _ = decode_complex(&rest[..split], &rest[split..]);
});

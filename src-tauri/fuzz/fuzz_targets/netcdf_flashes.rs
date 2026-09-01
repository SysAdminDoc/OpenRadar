#![no_main]
//! A GOES lightning file, which is NetCDF-4 and therefore HDF5 underneath.
//!
//! The parsing is upstream rather than ours, and the HDF5 C library alone had
//! five fuzz-found CVEs in 2025. This target is here to find out whether a
//! malformed file reaches a panic through the Rust reader.
use libfuzzer_sys::fuzz_target;
use openradar_lib::fuzzing::decode_flashes;

fuzz_target!(|data: &[u8]| {
    if data.len() > 2 * 1024 * 1024 {
        return;
    }
    let _ = decode_flashes(data, 1_756_600_000);
});

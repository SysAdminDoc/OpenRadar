#![no_main]
//! An Archive II volume, from the container down to every message in it.
//!
//! This is the path a downloaded radar volume takes, and until now it rested
//! on three release candidates nobody had fuzzed. The interesting failure is
//! not a wrong picture: it is a panic or an unbounded allocation in length
//! arithmetic reached from bytes a server sent, which is a remote denial of
//! service in a desktop app that fetches on a timer.
use libfuzzer_sys::fuzz_target;
use openradar_lib::fuzzing::scan_volume;

fuzz_target!(|data: &[u8]| {
    // A very large input is the fuzzer testing the allocator rather than the
    // parser, and a real volume that reaches this is bounded long before it.
    if data.len() > 4 * 1024 * 1024 {
        return;
    }
    let _ = scan_volume(data.to_vec());
});

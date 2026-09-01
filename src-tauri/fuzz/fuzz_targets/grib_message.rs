#![no_main]
//! A whole GRIB2 message, as the wind fields arrive byte-ranged out of a run.
use libfuzzer_sys::fuzz_target;
use openradar_lib::fuzzing::decode_message;

fuzz_target!(|data: &[u8]| {
    if data.len() > 2 * 1024 * 1024 {
        return;
    }
    let _ = decode_message(data);
});

#![no_main]
//! An MRMS grid: gzip, then GRIB2, then a PNG-packed data section.
//!
//! Three length arithmetics stacked on each other, all of them ours, and the
//! grids are 24.5 million points so a mistaken count is a large allocation.
use libfuzzer_sys::fuzz_target;
use openradar_lib::fuzzing::decode_grib;

fuzz_target!(|data: &[u8]| {
    if data.len() > 2 * 1024 * 1024 {
        return;
    }
    let _ = decode_grib(data);
});

#![no_main]
//! A Level III product, read for storm cells and for mesocyclones.
//!
//! Both readers walk a packet chain and both are expected to skip a packet
//! type they do not know without losing the message after it, which is
//! exactly the kind of rule a length field can be made to break.
use libfuzzer_sys::fuzz_target;
use openradar_lib::fuzzing::{read_mesocyclones, read_storm_cells};

fuzz_target!(|data: &[u8]| {
    if data.len() > 1024 * 1024 {
        return;
    }
    let _ = read_storm_cells(data, "KTLX");
    let _ = read_mesocyclones(data);
});

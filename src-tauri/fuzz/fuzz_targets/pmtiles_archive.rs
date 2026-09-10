#![no_main]
//! A PMTiles basemap, which is now a file somebody else made.
//!
//! Until the import shipped, every archive the reader opened was one this app
//! had downloaded itself, tile by tile, hashed and renamed into place under
//! its own app-data folder. A reader can hand it one from anywhere now, and
//! `AsyncPmTilesReader` begins by parsing a header and then walking a
//! directory tree of offsets and lengths that whoever built the file wrote.
//!
//! `inspect_archive` refuses what it can see is wrong: the tile type, the
//! coverage, an archive with no tile in it. None of that runs until the parser
//! has already read the header and the root directory, which is what this is
//! pointed at.
//!
//! The reader is async and its shipped backend reads a file. The backend on
//! the other side of `read_pmtiles` is a slice, and the runtime it blocks on
//! is built once for the whole run and lives in the library, so this crate
//! needs no dependency of its own to reach one.
use libfuzzer_sys::fuzz_target;
use openradar_lib::fuzzing::read_pmtiles;

fuzz_target!(|data: &[u8]| {
    // A basemap is megabytes, but a parser bug is in the first few hundred
    // bytes of a header and a directory. Anything larger is the fuzzer
    // spending its budget on memcpy.
    if data.len() > 256 * 1024 {
        return;
    }
    read_pmtiles(data.to_vec());
});

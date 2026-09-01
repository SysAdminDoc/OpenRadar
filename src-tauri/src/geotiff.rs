//! A single-band floating point GeoTIFF, written by hand.
//!
//! The app draws grids as coloured pictures, and a colour is a lossy account
//! of a number: read a PNG back and the best anyone gets is the ramp's nearest
//! band. A GeoTIFF carries the values themselves with the georeferencing
//! beside them, which is what QGIS, GDAL, ArcGIS, rasterio and the Weather and
//! Climate Toolkit all read.
//!
//! Writing one needs no library. It is a classic little-endian TIFF holding
//! one uncompressed strip of `f32`, plus the three tags GeoTIFF 1.1 adds:
//! `ModelPixelScale` and `ModelTiepoint` for where the raster sits, and the
//! `GeoKeyDirectory` saying which coordinate reference that is in. NaN is the
//! no-data value and `GDAL_NODATA` says so, so a reader that knows nothing
//! about NaN still leaves the empty cells out of its statistics.
//!
//! The one rule that is easy to get wrong: a TIFF's directory entries must be
//! sorted by tag number, and anything longer than four bytes lives outside the
//! entry with the entry holding its offset. Both are handled in `write`, which
//! is why tags go in as a list rather than being emitted by hand.

/// A TIFF tag's payload, in the encodings this writer needs.
enum Value {
    Short(Vec<u16>),
    Long(Vec<u32>),
    Double(Vec<f64>),
    /// NUL terminated, as TIFF ASCII is.
    Ascii(String),
}

impl Value {
    fn kind(&self) -> u16 {
        match self {
            Value::Short(_) => 3,
            Value::Ascii(_) => 2,
            Value::Long(_) => 4,
            Value::Double(_) => 12,
        }
    }

    fn count(&self) -> u32 {
        match self {
            Value::Short(values) => values.len() as u32,
            Value::Long(values) => values.len() as u32,
            Value::Double(values) => values.len() as u32,
            // The terminator is part of the count.
            Value::Ascii(text) => text.len() as u32 + 1,
        }
    }

    fn bytes(&self) -> Vec<u8> {
        match self {
            Value::Short(values) => values.iter().flat_map(|v| v.to_le_bytes()).collect(),
            Value::Long(values) => values.iter().flat_map(|v| v.to_le_bytes()).collect(),
            Value::Double(values) => values.iter().flat_map(|v| v.to_le_bytes()).collect(),
            Value::Ascii(text) => {
                let mut out = text.as_bytes().to_vec();
                out.push(0);
                out
            }
        }
    }
}

/// Where the raster sits and what its numbers mean.
pub struct Georeference {
    /// Longitude of the western edge of the leftmost column.
    pub west: f64,
    /// Latitude of the northern edge of the top row.
    pub north: f64,
    /// Degrees of longitude per column, and of latitude per row, both positive.
    pub d_lon: f64,
    pub d_lat: f64,
    /// What the band holds, for a reader looking at the file on its own.
    pub description: String,
    pub unit: String,
}

/// The tag numbers used here, named so the table below reads as itself.
const IMAGE_WIDTH: u16 = 256;
const IMAGE_LENGTH: u16 = 257;
const BITS_PER_SAMPLE: u16 = 258;
const COMPRESSION: u16 = 259;
const PHOTOMETRIC: u16 = 262;
const IMAGE_DESCRIPTION: u16 = 270;
const SOFTWARE: u16 = 305;
const STRIP_OFFSETS: u16 = 273;
const SAMPLES_PER_PIXEL: u16 = 277;
const ROWS_PER_STRIP: u16 = 278;
const STRIP_BYTE_COUNTS: u16 = 279;
const PLANAR_CONFIGURATION: u16 = 284;
const SAMPLE_FORMAT: u16 = 339;
const MODEL_PIXEL_SCALE: u16 = 33550;
const MODEL_TIEPOINT: u16 = 33922;
const GEO_KEY_DIRECTORY: u16 = 34735;
const GEO_ASCII_PARAMS: u16 = 34737;
const GDAL_NODATA: u16 = 42113;

/// One band of `f32`, row major from the north-west corner.
///
/// `values` must hold `columns * rows` samples. A cell with nothing in it is
/// NaN, which is what the no-data tag names.
pub fn write(
    columns: usize,
    rows: usize,
    values: &[f32],
    geo: &Georeference,
    software: &str,
) -> Vec<u8> {
    assert_eq!(values.len(), columns * rows, "a band is columns by rows");

    let mut out = Vec::with_capacity(8 + values.len() * 4 + 512);
    // Little-endian classic TIFF. The IFD offset is filled in once the samples
    // are down, because the directory follows them.
    out.extend_from_slice(b"II");
    out.extend_from_slice(&42u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());

    let strip_offset = out.len() as u32;
    for value in values {
        out.extend_from_slice(&value.to_le_bytes());
    }
    let strip_bytes = (values.len() * 4) as u32;

    // GeoTIFF 1.1, geographic coordinates on WGS 84. The header is
    // (version, revision, minor, key count) and each key is
    // (id, location, count, value); a location of 0 means the value is the
    // fourth field itself rather than an offset into another tag.
    let geo_keys = Value::Short(vec![
        1, 1, 1, 4, // header: 4 keys follow
        1024, 0, 1, 2, // GTModelType: geographic
        1025, 0, 1, 1, // GTRasterType: pixel is area
        2048, 0, 1, 4326, // GeographicType: WGS 84
        2049, GEO_ASCII_PARAMS, 7, 0, // GeogCitation: the ascii tag's first 7 bytes
    ]);

    let tags: Vec<(u16, Value)> = vec![
        (IMAGE_WIDTH, Value::Long(vec![columns as u32])),
        (IMAGE_LENGTH, Value::Long(vec![rows as u32])),
        (BITS_PER_SAMPLE, Value::Short(vec![32])),
        (COMPRESSION, Value::Short(vec![1])),
        (PHOTOMETRIC, Value::Short(vec![1])),
        (
            IMAGE_DESCRIPTION,
            Value::Ascii(format!("{} ({})", geo.description, geo.unit)),
        ),
        (STRIP_OFFSETS, Value::Long(vec![strip_offset])),
        (SAMPLES_PER_PIXEL, Value::Short(vec![1])),
        (ROWS_PER_STRIP, Value::Long(vec![rows as u32])),
        (STRIP_BYTE_COUNTS, Value::Long(vec![strip_bytes])),
        (PLANAR_CONFIGURATION, Value::Short(vec![1])),
        (SOFTWARE, Value::Ascii(software.to_string())),
        // 3 is IEEE floating point, which is what stops a reader treating the
        // bits as unsigned integers.
        (SAMPLE_FORMAT, Value::Short(vec![3])),
        (
            MODEL_PIXEL_SCALE,
            Value::Double(vec![geo.d_lon, geo.d_lat, 0.0]),
        ),
        (
            MODEL_TIEPOINT,
            // Raster (0,0) is at the north-west corner of the first cell.
            Value::Double(vec![0.0, 0.0, 0.0, geo.west, geo.north, 0.0]),
        ),
        (GEO_KEY_DIRECTORY, geo_keys),
        (GEO_ASCII_PARAMS, Value::Ascii("WGS 84|".to_string())),
        (GDAL_NODATA, Value::Ascii("nan".to_string())),
    ];

    let mut tags = tags;
    // A TIFF reader is entitled to assume the directory is in tag order, and
    // some stop at the first entry that is not.
    tags.sort_by_key(|(tag, _)| *tag);

    // Anything longer than four bytes sits after the directory, so the layout
    // has to be known before the entries can name where their values are.
    let directory_offset = out.len() as u32;
    let directory_bytes = 2 + tags.len() * 12 + 4;
    let mut overflow_at = directory_offset + directory_bytes as u32;
    let mut overflow = Vec::new();

    let mut directory = Vec::with_capacity(directory_bytes);
    directory.extend_from_slice(&(tags.len() as u16).to_le_bytes());
    for (tag, value) in &tags {
        directory.extend_from_slice(&tag.to_le_bytes());
        directory.extend_from_slice(&value.kind().to_le_bytes());
        directory.extend_from_slice(&value.count().to_le_bytes());
        let bytes = value.bytes();
        if bytes.len() <= 4 {
            let mut inline = [0u8; 4];
            inline[..bytes.len()].copy_from_slice(&bytes);
            directory.extend_from_slice(&inline);
        } else {
            directory.extend_from_slice(&overflow_at.to_le_bytes());
            overflow_at += bytes.len() as u32;
            overflow.extend_from_slice(&bytes);
            // Every value starts on an even offset, which TIFF requires.
            if overflow.len() % 2 == 1 {
                overflow.push(0);
                overflow_at += 1;
            }
        }
    }
    // One directory, so no next.
    directory.extend_from_slice(&0u32.to_le_bytes());

    out.extend_from_slice(&directory);
    out.extend_from_slice(&overflow);
    out[4..8].copy_from_slice(&directory_offset.to_le_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geo() -> Georeference {
        Georeference {
            west: -100.0,
            north: 40.0,
            d_lon: 0.01,
            d_lat: 0.01,
            description: "Reflectivity".to_string(),
            unit: "dBZ".to_string(),
        }
    }

    /// The reader used in these tests, which knows nothing about how the file
    /// was written: it walks the header and the directory the way the format
    /// says to. Anything it cannot follow is a file another reader would
    /// refuse too.
    struct Tiff<'a> {
        bytes: &'a [u8],
        entries: Vec<(u16, u16, u32, [u8; 4])>,
    }

    impl<'a> Tiff<'a> {
        fn read(bytes: &'a [u8]) -> Self {
            assert_eq!(&bytes[0..2], b"II", "little endian");
            assert_eq!(u16::from_le_bytes([bytes[2], bytes[3]]), 42, "classic tiff");
            let at = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
            let count = u16::from_le_bytes(bytes[at..at + 2].try_into().unwrap()) as usize;
            let mut entries = Vec::with_capacity(count);
            for index in 0..count {
                let start = at + 2 + index * 12;
                let tag = u16::from_le_bytes(bytes[start..start + 2].try_into().unwrap());
                let kind = u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap());
                let items = u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap());
                let inline: [u8; 4] = bytes[start + 8..start + 12].try_into().unwrap();
                entries.push((tag, kind, items, inline));
            }
            Tiff { bytes, entries }
        }

        fn entry(&self, tag: u16) -> (u16, u32, [u8; 4]) {
            let found = self
                .entries
                .iter()
                .find(|(held, _, _, _)| *held == tag)
                .unwrap_or_else(|| panic!("tag {tag} is in the file"));
            (found.1, found.2, found.3)
        }

        fn payload(&self, tag: u16, width: usize) -> &'a [u8] {
            let (_, count, inline) = self.entry(tag);
            let length = count as usize * width;
            if length <= 4 {
                // Borrowed from the directory itself, which is inside `bytes`.
                let at = self
                    .bytes
                    .windows(4)
                    .position(|window| window == inline)
                    .expect("an inline value is in the file");
                return &self.bytes[at..at + length];
            }
            let at = u32::from_le_bytes(inline) as usize;
            &self.bytes[at..at + length]
        }

        fn shorts(&self, tag: u16) -> Vec<u16> {
            self.payload(tag, 2)
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes(pair.try_into().unwrap()))
                .collect()
        }

        fn doubles(&self, tag: u16) -> Vec<f64> {
            self.payload(tag, 8)
                .chunks_exact(8)
                .map(|eight| f64::from_le_bytes(eight.try_into().unwrap()))
                .collect()
        }

        fn ascii(&self, tag: u16) -> String {
            let bytes = self.payload(tag, 1);
            String::from_utf8_lossy(&bytes[..bytes.len().saturating_sub(1)]).into_owned()
        }

        fn samples(&self) -> Vec<f32> {
            let (_, _, offset) = self.entry(STRIP_OFFSETS);
            let at = u32::from_le_bytes(offset) as usize;
            let (_, _, length) = self.entry(STRIP_BYTE_COUNTS);
            let length = u32::from_le_bytes(length) as usize;
            self.bytes[at..at + length]
                .chunks_exact(4)
                .map(|four| f32::from_le_bytes(four.try_into().unwrap()))
                .collect()
        }
    }

    #[test]
    fn the_values_come_back_exactly_as_they_went_in() {
        let values = vec![1.5f32, -32.5, f32::NAN, 75.25, 0.0, 12.125];
        let file = write(3, 2, &values, &geo(), "OpenRadar 0.0.0-test");
        let tiff = Tiff::read(&file);

        assert_eq!(u32::from_le_bytes(tiff.entry(IMAGE_WIDTH).2), 3);
        assert_eq!(u32::from_le_bytes(tiff.entry(IMAGE_LENGTH).2), 2);
        assert_eq!(tiff.shorts(BITS_PER_SAMPLE), vec![32]);
        // IEEE float, not an integer: the difference between -32.5 dBZ and a
        // reader showing 3231515443.
        assert_eq!(tiff.shorts(SAMPLE_FORMAT), vec![3]);
        assert_eq!(tiff.shorts(COMPRESSION), vec![1]);
        assert_eq!(tiff.shorts(SAMPLES_PER_PIXEL), vec![1]);

        let read = tiff.samples();
        assert_eq!(read.len(), values.len());
        for (from, to) in values.iter().zip(read.iter()) {
            if from.is_nan() {
                assert!(to.is_nan(), "an empty cell stays empty");
            } else {
                assert_eq!(from, to, "a value is not rounded on the way out");
            }
        }
    }

    #[test]
    fn it_says_where_on_the_earth_it_is() {
        let file = write(3, 2, &[0.0; 6], &geo(), "OpenRadar 0.0.0-test");
        let tiff = Tiff::read(&file);

        assert_eq!(tiff.doubles(MODEL_PIXEL_SCALE), vec![0.01, 0.01, 0.0]);
        // Raster origin to the north-west corner of the first cell.
        assert_eq!(
            tiff.doubles(MODEL_TIEPOINT),
            vec![0.0, 0.0, 0.0, -100.0, 40.0, 0.0]
        );

        let keys = tiff.shorts(GEO_KEY_DIRECTORY);
        assert_eq!(&keys[..4], &[1, 1, 1, 4], "four keys follow the header");
        assert_eq!(&keys[4..8], &[1024, 0, 1, 2], "geographic, not projected");
        assert_eq!(&keys[8..12], &[1025, 0, 1, 1], "pixel is area");
        assert_eq!(&keys[12..16], &[2048, 0, 1, 4326], "WGS 84");
        assert_eq!(tiff.ascii(GEO_ASCII_PARAMS), "WGS 84|");
        // NaN is only no-data to a reader that is told so.
        assert_eq!(tiff.ascii(GDAL_NODATA), "nan");
        assert_eq!(tiff.ascii(IMAGE_DESCRIPTION), "Reflectivity (dBZ)");
        assert_eq!(tiff.ascii(SOFTWARE), "OpenRadar 0.0.0-test");
    }

    #[test]
    fn the_directory_is_in_the_order_a_reader_expects() {
        let file = write(2, 2, &[0.0; 4], &geo(), "OpenRadar 0.0.0-test");
        let tiff = Tiff::read(&file);
        let tags: Vec<u16> = tiff.entries.iter().map(|(tag, _, _, _)| *tag).collect();
        let mut sorted = tags.clone();
        sorted.sort_unstable();
        assert_eq!(tags, sorted, "entries ascend by tag number");
        assert!(tags.windows(2).all(|pair| pair[0] != pair[1]), "no repeats");

        // Every value that does not fit in the entry has to land on an even
        // offset inside the file, and inside it.
        for (tag, kind, count, inline) in &tiff.entries {
            let width = match kind {
                2 => 1,
                3 => 2,
                4 => 4,
                12 => 8,
                other => panic!("tag {tag} has an unexpected type {other}"),
            };
            let length = *count as usize * width;
            if length > 4 {
                let at = u32::from_le_bytes(*inline) as usize;
                assert_eq!(at % 2, 0, "tag {tag} starts on an even offset");
                assert!(at + length <= file.len(), "tag {tag} points inside the file");
            }
        }
    }

    /// Writes a file for a reader that is not this one.
    ///
    /// The tests above check the bytes against the format; this one exists so
    /// the file can be opened in QGIS, GDAL or Pillow and seen to be a raster
    /// with the right numbers in it. Set `OPENRADAR_GEOTIFF_OUT` to a path and
    /// run with `--ignored`.
    #[test]
    #[ignore = "writes a file for an outside reader"]
    fn writes_a_file_for_an_outside_reader() {
        let Ok(path) = std::env::var("OPENRADAR_GEOTIFF_OUT") else {
            panic!("set OPENRADAR_GEOTIFF_OUT to the file to write");
        };
        let mut values = Vec::new();
        for row in 0..40 {
            for column in 0..60 {
                values.push(if (row + column) % 7 == 0 {
                    f32::NAN
                } else {
                    (row as f32) - (column as f32) / 2.0
                });
            }
        }
        let file = write(60, 40, &values, &geo(), "OpenRadar 0.0.0-test");
        std::fs::write(&path, file).expect("the file is written");
    }

    #[test]
    fn a_row_of_nothing_is_still_a_row() {
        // A view that catches only the edge of a grid is mostly empty, and an
        // empty raster still has to be a file a reader can open.
        let file = write(2, 2, &[f32::NAN; 4], &geo(), "OpenRadar 0.0.0-test");
        let tiff = Tiff::read(&file);
        assert!(tiff.samples().iter().all(|value| value.is_nan()));
    }
}

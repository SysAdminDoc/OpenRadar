//! Where a gate sits, and which one a range falls in.
//!
//! A `SweepField` carries `first_gate_range_km`, and the ICD is explicit about
//! what that number is. `data_moment_range` is the "Range to center of first
//! range gate", which `nexrad-decode` repeats word for word on its accessor
//! and `nexrad-model` repeats again on the field it fills from it. So gate `g`
//! is centred at `first + g * interval`, it reaches half an interval either
//! side of that, and the gate a range falls in is the one whose centre is
//! nearest.
//!
//! The model's own `SweepField::value_at_polar` does not read it that way. It
//! truncates, `((range - first) / interval) as usize`, which is the arithmetic
//! for a `first` that names an edge rather than a centre, and `max_range_km`
//! adds a whole interval per gate for the same reason. Both are half a gate
//! out against the ICD they decode, and everything that read a gate through
//! them inherited the shift: half a gate, which is 125 metres at the quarter
//! kilometre gates every velocity and super-resolution reflectivity product
//! uses and 500 at the kilometre gates of legacy reflectivity. Every picture
//! was drawn that much further out than the radar measured it.
//!
//! Every reading in this crate comes through here so there is one answer.

use nexrad_model::data::{GateStatus, SweepField};

/// The range to the centre of `gate`, in kilometres.
pub(crate) fn gate_centre_km(field: &SweepField, gate: usize) -> f64 {
    field.first_gate_range_km() + gate as f64 * field.gate_interval_km()
}

/// How far past the last gate's centre the sweep still holds a reading.
///
/// Half an interval, because that is where the last gate stops. The model's
/// `max_range_km` says a whole one further, which is the edge-referenced
/// reading of the same field.
pub(crate) fn last_gate_edge_km(field: &SweepField) -> f64 {
    let last = field.gate_count().saturating_sub(1);
    gate_centre_km(field, last) + field.gate_interval_km() / 2.0
}

/// Which gate a range falls in, if the sweep reaches it.
pub(crate) fn gate_covering(field: &SweepField, range_km: f64) -> Option<usize> {
    let interval = field.gate_interval_km();
    if interval <= 0.0 {
        return None;
    }
    // Half up rather than `round`, which in Rust goes half away from zero and
    // so gives -1 at exactly the near edge of gate 0, refusing a range
    // `reading_at` reads happily.
    //
    // This is the arithmetic `reading_at` gets out of `value_at_polar`,
    // spelled out: `floor(t + 0.5)`. The same in exact arithmetic, and not
    // quite the same in floating point, because this rounds once where the
    // other adds half an interval and then divides. On the fixture geometry
    // they part company at five ranges out of four hundred gates, each one
    // unit in the last place below a whole kilometre, and this is the
    // correct one at all five.
    let gate = ((range_km - field.first_gate_range_km()) / interval + 0.5).floor();
    if gate < 0.0 || gate >= field.gate_count() as f64 {
        return None;
    }
    Some(gate as usize)
}

/// What the sweep reads at a bearing and a range.
///
/// The model's azimuth search, its bounds and its gate statuses, with its
/// half-gate shift taken out. Asking `value_at_polar` half an interval further
/// out turns its truncation into the rounding the centre convention calls for,
/// and lands its two bounds checks on the near and far edges of the real
/// gates rather than half a gate inside each.
pub(crate) fn reading_at(
    field: &SweepField,
    azimuth_degrees: f32,
    range_km: f64,
) -> Option<(f32, GateStatus)> {
    let interval = field.gate_interval_km();
    if interval <= 0.0 {
        return field.value_at_polar(azimuth_degrees, range_km);
    }
    field.value_at_polar(azimuth_degrees, range_km + interval / 2.0)
}

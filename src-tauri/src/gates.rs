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
//! them inherited the shift: a quarter of a kilometre at legacy resolution,
//! and every picture drawn that much further out than the radar measured it.
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
    let gate = ((range_km - field.first_gate_range_km()) / interval).round();
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

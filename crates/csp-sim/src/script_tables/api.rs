//! The game API of a resident's script (ADR 0002), one file per domain.

mod control;
mod fighting;
mod movement;
mod queries;
mod ruling;
mod trade;
mod values;
mod work;

use super::{joined, total};
use crate::script_api::ScriptBinding;

/// The table's parts, in its order.
const PARTS: &[&[ScriptBinding]] = &[
    values::VALUES,
    queries::QUERIES,
    movement::MOVEMENT,
    control::CONTROL,
    work::WORK,
    fighting::FIGHTING,
    trade::TRADE,
    ruling::RULING,
];

/// The game API of a resident's script (`SCRIPT_API`).
pub static SCRIPT_API: &[ScriptBinding] = &joined::<_, { total(PARTS) }>(PARTS);

//! The script views (`CONTEXT.md`: Script view; ADR 0011), one file per domain.

mod buildings;
mod cities;
mod land;
mod orders;
mod realm;
mod residents;
mod trade;
mod transport;

use super::{joined, total};
use crate::script_views::{ScriptView, ViewChange};

/// The table's parts, in its order.
const PARTS: &[&[ScriptView]] = &[
    residents::RESIDENTS,
    orders::ORDERS,
    buildings::BUILDINGS,
    trade::TRADE,
    cities::CITIES,
    transport::TRANSPORT,
    land::LAND,
    realm::REALM,
];

/// Every script view by name (`SCRIPT_VIEWS`).
pub static SCRIPT_VIEWS: &[ScriptView] = &joined::<_, { total(PARTS) }>(PARTS);

/// The breaking changes to the script views so far, oldest first (`SCRIPT_VIEW_CHANGES`).
pub static SCRIPT_VIEW_CHANGES: &[ViewChange] = &[ViewChange::Undeclared];

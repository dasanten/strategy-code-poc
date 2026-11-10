//! The world-state types of `packages/shared/src/offers.ts`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{DirectOfferTerms, Good};

/// An offer as anyone in sight sees it (`SeenOffer = Offer & { rate }`): the fields of `Offer`
/// with what it wants for one unit it gives.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeenOffer {
    pub id: String,
    pub realm_id: String,
    pub storage_id: String,
    pub x: f64,
    pub y: f64,
    pub gives: Good,
    pub gives_units: f64,
    pub wants: Good,
    pub wants_units: f64,
    pub times: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub direct: Option<DirectOfferTerms>,
    pub rate: f64,
}

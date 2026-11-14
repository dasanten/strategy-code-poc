//! A Player's alliance matters as their realm sees them (`diplomacyFor` of
//! `packages/shared/src/alliance.ts`), sent with the welcome and each tick they changed, and what
//! it is made of that no rule needs: the demands, Direct offers, deliveries and join requests as a
//! side sees them (`demandsFor`, `directOffersFor`, `deliveriesFor`, `joinRequestsFor`) and the
//! ways a carried Direct offer can go (`carriedWaysFor`). Only the sockets send them, so they live
//! here, beside the welcome.

use std::collections::HashSet;

use csp_shared::protocol::SeenEntity;
use csp_shared::world::offers::SeenOffer;
use csp_shared::world::{
    AllianceArmyPart, AllianceArmyPartIs, BuildingKind, DeliveryKind, DemandTerms,
    DirectOfferTerms, Good, WorldState,
};
use csp_sim::directive::{directives_for, DirectiveView};
use csp_sim::queries::alliance::{alliance_of, realm_name, sharing_sight};
use csp_sim::queries::alliance_rules::is_alliance_city;
use csp_sim::queries::city::town_hall_of;
use csp_sim::queries::contract::{contracts_for, ContractView, RealmLabel};
use csp_sim::queries::demand::{
    answered_by_game, demand_wavering, npc_orgs_known_to, realms_known_to, AnsweredBy,
};
use csp_sim::queries::direct_offer::cities_to_carry_at;
use csp_sim::queries::offers::seen_offer;
use csp_sim::queries::standing::{
    organization_label, standings_for, OrganizationIs, StandingView, TRADE_ORG,
};
use csp_sim::queries::trade_org::trade_org_hq;
use csp_sim::queries::transfer::{nearest_warehouse, transfer_tiles};
use csp_sim::queries::warehouse_trade::{debt_of, delivery_storage};
use serde::Serialize;

/// A member of the Player's alliance (`members` of `Diplomacy.alliance`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberView {
    #[serde(flatten)]
    pub label: RealmLabel,
    pub joined_at: f64,
    pub leaves_at: Option<f64>,
    /// The name of the member's heir (`CONTEXT.md`: Heir): only allies see it; absent with none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heir: Option<String>,
}

/// A part of the alliance's army, with whose it is (`army` of `Diplomacy.alliance`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmyPartView {
    #[serde(flatten)]
    pub label: RealmLabel,
    #[serde(flatten)]
    pub part: AllianceArmyPart,
}

/// The Player's alliance, as they see it (`Diplomacy.alliance`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AllianceView {
    pub id: String,
    pub name: String,
    pub leader_id: String,
    pub members: Vec<MemberView>,
    pub invites: Vec<RealmLabel>,
    pub army: Vec<ArmyPartView>,
}

/// An alliance inviting the realm (`Diplomacy.invitations`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitationView {
    pub alliance_id: String,
    pub name: String,
    pub leader: String,
}

/// A demand as one of its sides sees it (`DemandView`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemandView {
    pub id: String,
    pub from: RealmLabel,
    pub to: RealmLabel,
    pub terms: DemandTerms,
    /// The sender's words: plain text, never markup.
    pub note: String,
    pub sent_at: f64,
    pub deadline: f64,
    /// For a demand to an NPC city: while the sender's force near it far outweighs it, the ticks left
    /// before it gives in; `null` while it doesn't, and the time starts from nothing once it does
    /// (`CONTEXT.md`: Demand; ADR 0033). `null` for any other demand.
    pub wavering: Option<f64>,
}

/// A Direct offer as its two sides see it, wherever they are (`DirectOfferView`): with who sent
/// it, to whom, and the city of the storage to fetch it at.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectOfferView {
    #[serde(flatten)]
    pub offer: SeenOffer,
    pub from: RealmLabel,
    pub to: RealmLabel,
    /// The name of the storage's city; none for an outpost's.
    pub city: Option<String>,
    /// For a carried one, the name of the city it goes to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_city: Option<String>,
}

/// A delivery as its realm sees it (`DeliveryView`), for the open ones in the realm log.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryView {
    pub id: String,
    pub kind: DeliveryKind,
    pub good: Good,
    pub units: f64,
    pub city_id: String,
    pub city: String,
    /// The warehouse it was ordered at.
    pub x: f64,
    pub y: f64,
    /// Whether a caravan is on its way with it; else it waits for one at the warehouse.
    pub underway: bool,
}

/// An NPC city asking the realm to join, with its town hall (`JoinRequestView`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequestView {
    pub city_id: String,
    pub city: String,
    pub at: f64,
    pub x: f64,
    pub y: f64,
}

/// Standing with one Organization, as the Player sees it (`StandingView`, as sent).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StandingShown {
    pub org: String,
    pub name: String,
    /// `realm`, `city` or `tradeOrg`.
    pub is: &'static str,
    pub theirs: f64,
    pub yours: f64,
}

impl From<StandingView> for StandingShown {
    fn from(s: StandingView) -> Self {
        let is = match s.is {
            OrganizationIs::Realm => "realm",
            OrganizationIs::City => "city",
            OrganizationIs::TradeOrg => "tradeOrg",
        };
        StandingShown { org: s.org, name: s.name, is, theirs: s.theirs, yours: s.yours }
    }
}

/// A way the realm can name for a carried Direct offer, with its tiles each way (`CarriedWay`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarriedWay {
    pub from_city_id: String,
    pub to_city_id: String,
    pub sender_tiles: f64,
    pub other_tiles: f64,
}

/// The Player's alliance matters, as their realm sees them, and their open deliveries
/// (`Diplomacy`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diplomacy {
    pub alliance: Option<AllianceView>,
    pub invitations: Vec<InvitationView>,
    pub realms_in_sight: Vec<RealmLabel>,
    pub contracts: Vec<ContractView>,
    pub demands: Vec<DemandView>,
    pub known_realms: Vec<RealmLabel>,
    pub known_npc_orgs: Vec<RealmLabel>,
    pub direct_offers: Vec<DirectOfferView>,
    pub direct_offer_realms: Vec<RealmLabel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub carried_ways: Option<Vec<CarriedWay>>,
    pub deliveries: Vec<DeliveryView>,
    pub standings: Vec<StandingShown>,
    pub join_requests: Vec<JoinRequestView>,
    pub directives: Vec<DirectiveView>,
    /// Always `true` when present: the HQ has fallen, so no caravans run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_caravans: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debt: Option<f64>,
}

/// An Organization as a Player sees it, `city` set when `city` says it is one.
fn label_of(world: &WorldState, id: &str, city: bool) -> RealmLabel {
    RealmLabel {
        realm_id: id.to_string(),
        realm: organization_label(world, id),
        city: city.then_some(true),
    }
}

/// The demands waiting for an answer that the realm sent or was sent, oldest first
/// (`demandsFor`).
pub fn demands_for(world: &WorldState, realm_id: &str) -> Vec<DemandView> {
    let label =
        |id: &str| label_of(world, id, answered_by_game(world, id) == Some(AnsweredBy::City));
    world
        .demands
        .iter()
        .filter(|d| d.from_id == realm_id || d.to_id == realm_id)
        .map(|d| DemandView {
            id: d.id.clone(),
            from: label(&d.from_id),
            to: label(&d.to_id),
            terms: d.terms.clone(),
            note: d.note.clone(),
            sent_at: d.sent_at,
            deadline: d.deadline,
            wavering: demand_wavering(world, d),
        })
        .collect()
}

/// The Direct offers the realm sent or was sent, oldest first (`directOffersFor`).
pub fn direct_offers_for(world: &WorldState, realm_id: &str) -> Vec<DirectOfferView> {
    let label = |id: &str| label_of(world, id, world.cities.iter().any(|c| c.id == id));
    let city_name = |id: Option<&str>| {
        id.and_then(|id| world.cities.iter().find(|c| c.id == id)).map(|c| c.name.clone())
    };
    world
        .offers
        .iter()
        .filter_map(|o| {
            let direct: &DirectOfferTerms = o.direct.as_ref()?;
            (o.realm_id == realm_id || direct.to_id == realm_id).then_some((o, direct))
        })
        .map(|(o, direct)| {
            let city_id = world
                .buildings
                .iter()
                .find(|b| b.id == o.storage_id)
                .and_then(|b| b.city_id.as_deref());
            DirectOfferView {
                offer: seen_offer(o),
                from: label(&o.realm_id),
                to: label(&direct.to_id),
                city: city_name(city_id),
                to_city: direct.carried.as_ref().map(|c| {
                    city_name(Some(&c.to_city_id)).unwrap_or_else(|| "a lost city".into())
                }),
            }
        })
        .collect()
}

/// A realm's deliveries and pick-ups not yet done, oldest first (`deliveriesFor`).
pub fn deliveries_for(world: &WorldState, realm_id: &str) -> Vec<DeliveryView> {
    world
        .deliveries
        .iter()
        .filter(|d| d.realm_id == realm_id)
        .map(|d| {
            let w = world.buildings.iter().find(|b| b.id == d.warehouse_id);
            DeliveryView {
                id: d.id.clone(),
                kind: d.kind,
                good: d.good,
                units: d.units,
                city_id: d.city_id.clone(),
                city: world
                    .cities
                    .iter()
                    .find(|c| c.id == d.city_id)
                    .map_or_else(String::new, |c| c.name.clone()),
                x: w.map_or(0.0, |w| w.x),
                y: w.map_or(0.0, |w| w.y),
                underway: d.caravan_id.is_some(),
            }
        })
        .collect()
}

/// The NPC cities asking the realm to join it now, the oldest ask first (`joinRequestsFor`).
pub fn join_requests_for(world: &WorldState, realm_id: &str) -> Vec<JoinRequestView> {
    let mut out: Vec<JoinRequestView> = world
        .join_requests
        .iter()
        .filter(|q| !q.declined && q.realm_id == realm_id)
        .filter_map(|q| {
            let city = world.cities.iter().find(|c| c.id == q.city_id)?;
            let hall = town_hall_of(world, city)?;
            Some(JoinRequestView {
                city_id: city.id.clone(),
                city: city.name.clone(),
                at: q.at,
                x: hall.x,
                y: hall.y,
            })
        })
        .collect();
    // A stable sort, as `Array.prototype.sort`.
    out.sort_by(|a, b| a.at.total_cmp(&b.at));
    out
}

/// The way between two cities, none when a storage or warehouse is missing (`carriedWay`).
fn carried_way(world: &WorldState, size: i32, from_id: &str, to_id: &str) -> Option<CarriedWay> {
    let from = delivery_storage(world, from_id)?;
    let to = delivery_storage(world, to_id)?;
    let (from, to) = ((from.x, from.y), (to.x, to.y));
    let sender = nearest_warehouse(world, from, size)?;
    let other = nearest_warehouse(world, to, size)?;
    Some(CarriedWay {
        from_city_id: from_id.to_string(),
        to_city_id: to_id.to_string(),
        sender_tiles: transfer_tiles(size, (sender.x, sender.y), Some(from), to),
        other_tiles: transfer_tiles(size, (other.x, other.y), Some(to), from),
    })
}

/// The ways the realm can name for a carried Direct offer, so the UI can show its exact fee
/// (`carriedWaysFor`): from each of its cities with a storage to each city of another realm whose
/// storage is among `seen_storages` (their city ids). None once the HQ has fallen.
pub fn carried_ways_for<'a>(
    world: &WorldState,
    size: i32,
    realm_id: &str,
    seen_storages: impl IntoIterator<Item = Option<&'a str>>,
) -> Vec<CarriedWay> {
    if trade_org_hq(world).is_none() {
        return Vec::new();
    }
    let mut others: Vec<&str> = Vec::new();
    for city_id in seen_storages.into_iter().flatten() {
        let Some(city) = world.cities.iter().find(|c| c.id == city_id) else { continue };
        let theirs = city.realm_id.as_deref().is_some_and(|r| r != realm_id);
        if theirs && !others.contains(&city.id.as_str()) {
            others.push(&city.id);
        }
    }
    if others.is_empty() {
        return Vec::new();
    }
    cities_to_carry_at(world, realm_id)
        .into_iter()
        .flat_map(|own| others.iter().filter_map(|o| carried_way(world, size, &own.id, o)))
        .collect()
}

/// The realms whose residents are among the entities, and the cities among them (`realmsSeen`).
pub fn realms_seen(entities: &[SeenEntity]) -> Vec<&str> {
    entities
        .iter()
        .filter_map(|e| match e {
            SeenEntity::Resident(r) => r.owner.as_deref(),
            SeenEntity::City(c) => Some(c.city.id.as_str()),
            _ => None,
        })
        .collect()
}

/// The city ids of the finished storages among the entities: where a realm can name a carried
/// offer to go (`storagesSeen`).
pub fn storages_seen(entities: &[SeenEntity]) -> Vec<Option<&str>> {
    entities
        .iter()
        .filter_map(|e| match e {
            SeenEntity::Building(b)
                if b.building.kind == BuildingKind::Storage && b.building.site.is_none() =>
            {
                Some(b.building.city_id.as_deref())
            }
            _ => None,
        })
        .collect()
}

/// The name of a realm's heir, if it has one (`CONTEXT.md`: Heir).
fn heir_name(world: &WorldState, realm_id: &str) -> Option<String> {
    let realm = world.realms.iter().find(|r| r.id == realm_id)?;
    let heir_id = realm.heir_id.as_deref()?;
    world.residents.iter().find(|r| r.id == heir_id).map(|r| r.name.clone())
}

/// The Player's alliance matters, as their realm sees them, and their open deliveries
/// (`diplomacyFor`). `seen_realms` are the realms whose residents are in the Player's sight, and
/// the cities in it.
pub fn diplomacy_for<'a>(
    world: &WorldState,
    realm_id: &str,
    seen_realms: impl IntoIterator<Item = &'a str>,
    carried_ways: Vec<CarriedWay>,
) -> Diplomacy {
    let label = |id: &str| label_of(world, id, is_alliance_city(world, id));
    let owner_of = |p: &AllianceArmyPart| -> String {
        match p.is {
            AllianceArmyPartIs::Resident => {
                world.residents.iter().find(|r| r.id == p.id).and_then(|r| r.owner.clone())
            }
            AllianceArmyPartIs::Carriage => {
                world.carriages.iter().find(|k| k.id == p.id).and_then(|k| k.realm_id.clone())
            }
        }
        .unwrap_or_default()
    };
    let alliance = alliance_of(world, realm_id).map(|own| AllianceView {
        id: own.id.clone(),
        name: own.name.clone(),
        leader_id: own.leader_id.clone(),
        members: own
            .members
            .iter()
            .map(|m| MemberView {
                label: label(&m.realm_id),
                joined_at: m.joined_at,
                leaves_at: m.leaving.as_ref().map(|l| l.at),
                heir: heir_name(world, &m.realm_id),
            })
            .collect(),
        invites: own.invites.iter().map(|i| label(i)).collect(),
        army: own
            .army
            .iter()
            .map(|p| ArmyPartView { label: label(&owner_of(p)), part: p.clone() })
            .collect(),
    });
    let invitations = world
        .alliances
        .iter()
        .filter(|a| a.invites.iter().any(|i| i == realm_id))
        .map(|a| InvitationView {
            alliance_id: a.id.clone(),
            name: a.name.clone(),
            leader: realm_name(world, &a.leader_id),
        })
        .collect();
    let realms: HashSet<&str> = world.realms.iter().map(|r| r.id.as_str()).collect();
    let allies: HashSet<String> = sharing_sight(world, realm_id).into_iter().collect();
    // `[...new Set(seenRealms)]`: each once, in the order first seen.
    let mut seen: Vec<&str> = Vec::new();
    for id in seen_realms {
        if !seen.contains(&id) {
            seen.push(id);
        }
    }
    let known_realms: Vec<RealmLabel> =
        realms_known_to(world, realm_id, seen.iter().copied()).iter().map(|id| label(id)).collect();
    let mut in_sight: Vec<&str> = seen
        .iter()
        .copied()
        .filter(|&id| {
            id != realm_id
                && !allies.contains(id)
                && (realms.contains(id) || is_alliance_city(world, id))
        })
        .collect();
    in_sight.sort_unstable();
    let debt = debt_of(world, realm_id);
    Diplomacy {
        alliance,
        invitations,
        realms_in_sight: in_sight.into_iter().map(label).collect(),
        contracts: contracts_for(world, realm_id),
        demands: demands_for(world, realm_id),
        known_npc_orgs: npc_orgs_known_to(world, realm_id, seen.iter().copied())
            .iter()
            .map(|id| label_of(world, id, id != TRADE_ORG))
            .collect(),
        direct_offers: direct_offers_for(world, realm_id),
        direct_offer_realms: known_realms.clone(),
        known_realms,
        carried_ways: (!carried_ways.is_empty()).then_some(carried_ways),
        deliveries: deliveries_for(world, realm_id),
        standings: standings_for(world, realm_id).into_iter().map(StandingShown::from).collect(),
        join_requests: join_requests_for(world, realm_id),
        directives: directives_for(world, |org| organization_label(world, org)),
        no_caravans: trade_org_hq(world).is_none().then_some(true),
        debt: (debt > 0.0).then_some(debt),
    }
}

#[cfg(test)]
mod tests;

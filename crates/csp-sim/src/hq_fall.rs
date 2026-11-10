//! The Fall of the HQ (`hq-fall.ts`, `CONTEXT.md`: Fall of the HQ): captured, the Trade Org HQ is a
//! city like any other, and everything the Trade Organization had under way ends with it.

use csp_shared::world::{
    BuildingKind, DebtWhat, DeliveryKind, EndedWithHq, RealmEventWhat, WorldState,
};

use crate::contracts::end_trade_org_contracts;
use crate::events::record_event;
use crate::queries::standing::TRADE_ORG;
use crate::queries::trade_org::trade_org_hq;
use crate::sight::InvariantViolation;

/// The HQ `hq_id` falls (`hqFalls`): it is no longer the Trade Organization's, its warehouses are
/// storages, and its caravans, traders, deliveries, transfers, punishments, supply wagons, debts,
/// its demands and its contracts end. Each realm with a delivery or transfer under way reads that
/// it ended; each that owed reads that its debt ended.
pub fn hq_falls(world: &mut WorldState, hq_id: &str) {
    if let Some(hq) = world.cities.iter_mut().find(|c| c.id == hq_id) {
        hq.trade_org = None;
    }
    for b in &mut world.buildings {
        if b.city_id.as_deref() == Some(hq_id) && b.kind == BuildingKind::Warehouse {
            b.kind = BuildingKind::Storage;
        }
    }
    world.caravans.clear();
    world.traders.clear();
    world.route_robberies.clear();
    let city_name = |world: &WorldState, id: &str| {
        world
            .cities
            .iter()
            .find(|c| c.id == id)
            .map_or_else(|| "a lost city".into(), |c| c.name.clone())
    };
    let deliveries = std::mem::take(&mut world.deliveries);
    for d in &deliveries {
        let order = match d.kind {
            DeliveryKind::Delivery => EndedWithHq::Delivery,
            DeliveryKind::PickUp => EndedWithHq::PickUp,
        };
        let what = RealmEventWhat::OrderEndedWithHq {
            order,
            good: d.good,
            units: d.units,
            city_id: d.city_id.clone(),
            city: city_name(world, &d.city_id),
        };
        record_event(world, Some(&d.realm_id), what);
    }
    let transfers = std::mem::take(&mut world.transfers);
    for t in &transfers {
        let what = RealmEventWhat::OrderEndedWithHq {
            order: EndedWithHq::Transfer,
            good: t.good,
            units: t.units,
            city_id: t.to_city_id.clone(),
            city: city_name(world, &t.to_city_id),
        };
        record_event(world, Some(&t.realm_id), what);
    }
    world.punishments.clear();
    world.supply_wagons.clear();
    let debts = std::mem::take(&mut world.debts);
    for d in &debts {
        let what = RealmEventWhat::Debt { what: DebtWhat::Ended, coins: d.coins, owed: 0.0 };
        record_event(world, Some(&d.org), what);
    }
    world.demands.retain(|d| d.from_id != TRADE_ORG);
    end_trade_org_contracts(world);
}

/// Nothing of the Trade Organization's outlasts the Fall of the HQ (`nothingLeftOfTheHq`, ADR
/// 0004): with no HQ the world has no caravans, traders, robberies counted on routes, deliveries,
/// transfers, punishments, supply wagons, debts, demands for debts or contracts with it.
pub fn nothing_left_of_the_hq(world: &WorldState) -> Vec<InvariantViolation> {
    if trade_org_hq(world).is_some() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut left = |what: &str, ids: Vec<String>| {
        if ids.is_empty() {
            return;
        }
        out.push(InvariantViolation {
            invariant: "nothing-left-of-the-hq".into(),
            message: format!("the world has no Trade Org HQ but still has {what}"),
            entity_ids: ids,
        })
    };
    left("caravans", world.caravans.iter().map(|c| c.id.clone()).collect());
    left("wandering traders", world.traders.iter().map(|t| t.id.clone()).collect());
    left("robberies counted on routes", world.route_robberies.keys().cloned().collect());
    left("deliveries", world.deliveries.iter().map(|d| d.id.clone()).collect());
    left("transfers", world.transfers.iter().map(|t| t.id.clone()).collect());
    left("punishments", world.punishments.iter().map(|p| p.id.clone()).collect());
    left("supply wagons", world.supply_wagons.iter().map(|w| w.id.clone()).collect());
    left("debts", world.debts.iter().map(|d| d.org.clone()).collect());
    left(
        "demands for debts",
        world.demands.iter().filter(|d| d.from_id == TRADE_ORG).map(|d| d.id.clone()).collect(),
    );
    left(
        "contracts with the Trade Organization",
        world
            .contracts
            .iter()
            .filter(|c| c.lender_id == TRADE_ORG || c.hirer_id == TRADE_ORG)
            .map(|c| c.id.clone())
            .collect(),
    );
    out
}

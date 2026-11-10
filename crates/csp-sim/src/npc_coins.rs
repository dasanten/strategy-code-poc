//! Whether an NPC city has a way to earn Coins (`apps/server/src/npc-coins.ts`, `CONTEXT.md`: NPC
//! reserve). A city with none doesn't count Coins as short (`shortages`), so its war chest can't
//! keep it from being full (`CONTEXT.md`: Full city). Its war chest stays in its reserve for
//! everything else.

use csp_shared::balance::NPC_TRADER_REACH;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{BuildingKind, City, Good, WorldState};

use crate::npc_behaviour::npc_home;
use crate::npc_chain::{makes, short_goods};
use crate::npc_scouts::knows_node;
use crate::queries::building::node_good;
use crate::queries::names::held;
use crate::queries::npc_trade::{npc_city_stock, npc_reserve};
use crate::queries::warehouse::trade_coin_warehouse;
use crate::sight::InvariantViolation;

/// Whether an NPC city can earn Coins (`earnsCoins`, `CONTEXT.md`: NPC reserve): it has gold or a
/// mint of its own, or trade in reach. Of its own: a mint or a gold mine, finished or begun
/// (`makes`), Gold ore in its storages, or a gold node it knows of (`knows_node`). In reach: a
/// finished Trade Org warehouse that trades (`trade_coin_warehouse`) within `NPC_TRADER_REACH` of
/// its home; or a wandering trader whose loop passes within `TRADER_STOP_REACH` of its town hall
/// (`on_a_traders_loop`). `size` is the map's.
pub fn earns_coins(world: &WorldState, city: &City, size: i32) -> bool {
    if makes(world, city, Good::Coins) || makes(world, city, Good::GoldOre) {
        return true;
    }
    if held(&npc_city_stock(world, city), Good::GoldOre) > 0.0 {
        return true;
    }
    let Some(home) = npc_home(world, &city.id) else { return false };
    let home_at = (home.x as i32, home.y as i32);
    for node in &world.nodes {
        if node_good(node.kind) == Good::GoldOre
            && knows_node(city, home_at, (node.x as i32, node.y as i32), size)
        {
            return true;
        }
    }
    let warehouse = world.buildings.iter().any(|b| {
        b.kind == BuildingKind::Warehouse
            && b.site.is_none()
            && trade_coin_warehouse(world, b).is_some()
            && wrap_distance(size, home_at, (b.x as i32, b.y as i32)) <= NPC_TRADER_REACH
    });
    warehouse || on_a_traders_loop(world, city, size)
}

use crate::trader_stops::on_a_traders_loop;

/// Invariant `coins-short-only-with-income` (`CONTEXT.md`: NPC reserve; ADR 0004): of the cities
/// whose Coins are under their war chest, those that can earn more have them among what they are
/// short of, and those that can't don't.
pub fn coins_short_only_with_income(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for city in &world.cities {
        if city.realm_id.is_some() || city.trade_org.is_some() {
            continue;
        }
        let chest = held(&npc_reserve(world, city), Good::Coins);
        if held(&npc_city_stock(world, city), Good::Coins) >= chest {
            continue;
        }
        let earns = earns_coins(world, city, size);
        if short_goods(world, city, size, None).contains(&Good::Coins) == earns {
            continue;
        }
        let what = if earns {
            "can earn Coins but doesn\u{2019}t count them as short"
        } else {
            "can\u{2019}t earn Coins but counts them as short"
        };
        out.push(InvariantViolation {
            invariant: "coins-short-only-with-income".into(),
            message: format!("{} is under its war chest of {chest} and {what}", city.id),
            entity_ids: vec![city.id.clone()],
        });
    }
    out
}

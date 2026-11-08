//! The HQ's layout (`hqLayout`) against the HQ the TypeScript founded in the `hq-0` fixture.

mod common;

use std::collections::BTreeSet;

use csp_shared::world::BuildingKind;
use csp_sim::trade_org::hq_layout;

#[test]
fn lays_out_the_hq_as_the_typescript_did() {
    let (world, _, _) = common::load_world("worlds/hq-0.json");
    let hq = world.cities.iter().find(|c| c.trade_org.is_some()).unwrap();
    let hall = world.buildings.iter().find(|b| b.id == hq.town_hall_id).unwrap();
    let l = hq_layout(hall.x as i32 + 1, hall.y as i32 + 1);
    assert_eq!(l.hall, (hall.x as i32, hall.y as i32));
    let at = |kind: BuildingKind, city: bool| -> BTreeSet<(i32, i32)> {
        world
            .buildings
            .iter()
            .filter(|b| b.kind == kind && (b.city_id.as_deref() == Some(hq.id.as_str())) == city)
            .map(|b| (b.x as i32, b.y as i32))
            .collect()
    };
    let gates: BTreeSet<_> = l.inner_gates.iter().chain(&l.outer_gates).copied().collect();
    let walls: BTreeSet<_> =
        l.inner_ring.iter().chain(&l.outer_ring).copied().filter(|t| !gates.contains(t)).collect();
    assert_eq!(at(BuildingKind::Gate, true), gates);
    assert_eq!(at(BuildingKind::Wall, true), walls);
    assert_eq!(at(BuildingKind::House, true), l.houses.iter().copied().collect());
    assert_eq!(at(BuildingKind::Storage, true), BTreeSet::from([l.storage]));
    assert_eq!(
        at(BuildingKind::Warehouse, true),
        BTreeSet::from([l.coin_warehouse, l.goods_warehouse])
    );
    assert_eq!(at(BuildingKind::Smelter, false), BTreeSet::from([l.smelter]));
    assert_eq!(at(BuildingKind::Mint, false), BTreeSet::from([l.mint]));
}

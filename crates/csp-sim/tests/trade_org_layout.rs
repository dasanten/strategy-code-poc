//! The HQ (`hqLayout`, `foundTradeOrgHq`) against the one the TypeScript founded in the `hq-0`
//! fixture (`hq()` of `trade-org.test.ts`, rebuilt in `scripts/dump-fixtures.mts`).

mod common;

use std::collections::BTreeSet;

use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{BuildingKind, ResourceKind, ResourceNode};
use csp_sim::random::Mulberry32;
use csp_sim::trade_org::{found_trade_org_hq, hq_layout};
use csp_sim::world::create_world;

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

#[test]
fn founds_the_hq_the_typescript_founded() {
    let (want, _, _) = common::load_world("worlds/hq-0.json");
    const MID: i32 = 320;
    let nodes = [
        (ResourceKind::Forest, MID + 80, MID),
        (ResourceKind::Stone, MID + 80, MID + 12),
        (ResourceKind::IronOre, MID + 88, MID - 12),
        (ResourceKind::GoldOre, MID + 96, MID),
    ];
    let mut terrain = TerrainMap { size: 640, tiles: vec![Terrain::Plains as u8; 640 * 640] };
    for (kind, x, y) in nodes {
        let t = if kind == ResourceKind::Forest { Terrain::Forest } else { Terrain::Hills };
        terrain.tiles[tile_index(640, x, y)] = t as u8;
    }
    let mut world = create_world(&terrain, want.seed);
    world.nodes = nodes
        .iter()
        .enumerate()
        .map(|(i, (kind, x, y))| ResourceNode {
            id: format!("n{i}"),
            kind: *kind,
            x: f64::from(*x),
            y: f64::from(*y),
        })
        .collect();
    let mut rand = Mulberry32::new(7.0);
    let mut next = || rand.next();
    found_trade_org_hq(&mut world, &terrain, MID, MID, &mut next);
    common::assert_same_json(
        "world",
        &serde_json::to_value(&want).unwrap(),
        &serde_json::to_value(&world).unwrap(),
    );
}

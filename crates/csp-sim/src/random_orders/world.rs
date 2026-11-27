//! The world of the random-order run (T125.2): Players 1 and 2's starting cities, and what the
//! order kinds need standing there, so that each kind's requests can be accepted: water with a
//! haven, a ship and a boat for each realm, a training ground, woods and hills to gather on, a
//! worn building to repair, a ram and a catapult at the other's walls, an NPC village with a
//! stable of horses, a trading post and a Trade Org HQ, a debt, a directive and a join request.
//!
//! Residents placed where a kind is given (on a warehouse, at a stable, aboard a ship, crewing a
//! machine) have ids starting with [`PLACED`]; the run gives them no order of its own drawing, only
//! the kinds that look for someone standing there do, so they stay put for a while.

use std::collections::HashSet;

use csp_shared::balance::MAX_HUNGER;
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, Directive, Good, JoinRequest, Resident, SiegeMachine,
    SiegeMachineKind, Standing, Vessel, VesselKind, WorldState,
};
use serde_json::json;

use crate::movement_test_world::{horse, resident};
use crate::random::Mulberry32;

/// The start of the id of a resident placed where a kind is given.
pub const PLACED: &str = "at-";

/// The map's side: large enough for the two starting cities, the NPC village, the trading post
/// and the HQ, and that no city's control box is wider than the map (bug #1724).
pub const SIZE: i32 = 160;

/// The side of a building kind's footprint.
fn side(kind: BuildingKind) -> i32 {
    let name = serde_json::to_value(kind).expect("a kind");
    FOOTPRINT.get(name.as_str().expect("a name")).expect("a footprint")
}

/// The tiles taken: under a building, a node, a vessel or machine, or not Plains.
struct Land<'t> {
    terrain: &'t mut TerrainMap,
    taken: HashSet<(i32, i32)>,
}

impl Land<'_> {
    fn of<'t>(world: &WorldState, terrain: &'t mut TerrainMap) -> Land<'t> {
        let mut land = Land { terrain, taken: HashSet::new() };
        for b in &world.buildings {
            land.take(b.x as i32, b.y as i32, side(b.kind), 1);
        }
        for n in &world.nodes {
            land.take(n.x as i32, n.y as i32, 2, 1);
        }
        land
    }

    /// Takes a w×w square at (x, y) and `margin` round it.
    fn take(&mut self, x: i32, y: i32, w: i32, margin: i32) {
        for dy in -margin..w + margin {
            for dx in -margin..w + margin {
                self.taken.insert((x + dx, y + dy));
            }
        }
    }

    fn free(&self, x: i32, y: i32, w: i32, h: i32) -> bool {
        let size = self.terrain.size;
        (x >= 2 && y >= 2 && x + w < size - 2 && y + h < size - 2)
            && (0..h).all(|dy| {
                (0..w).all(|dx| {
                    let (tx, ty) = (x + dx, y + dy);
                    !self.taken.contains(&(tx, ty))
                        && self.terrain.tiles[(ty * size + tx) as usize] == Terrain::Plains as u8
                })
            })
    }

    /// The free w×h rectangle nearest (x, y), ring by ring; taken, with a margin of 1.
    fn place(&mut self, near: (i32, i32), w: i32, h: i32) -> (i32, i32) {
        for r in 0..self.terrain.size {
            for dy in -r..=r {
                for dx in -r..=r {
                    if dx.abs().max(dy.abs()) != r {
                        continue;
                    }
                    let (x, y) = (near.0 + dx, near.1 + dy);
                    if self.free(x, y, w, h) {
                        for ty in y - 1..y + h + 1 {
                            for tx in x - 1..x + w + 1 {
                                self.taken.insert((tx, ty));
                            }
                        }
                        return (x, y);
                    }
                }
            }
        }
        panic!("no free {w}×{h} near {near:?}: make the random-order world larger");
    }

    fn paint(&mut self, x: i32, y: i32, w: i32, h: i32, t: Terrain) {
        let size = self.terrain.size;
        for ty in y..y + h {
            for tx in x..x + w {
                self.terrain.tiles[(ty * size + tx) as usize] = t as u8;
            }
        }
    }
}

fn finished(id: String, kind: BuildingKind, city: Option<&str>, x: i32, y: i32) -> Building {
    let mut b = crate::movement_test_world::building(&id, kind, f64::from(x), f64::from(y));
    b.city_id = city.map(str::to_string);
    b
}

/// A resident of `realm`, living in `city`, placed at (x, y) carrying `carried`.
fn placed(
    world: &mut WorldState,
    name: &str,
    realm: &str,
    city: &str,
    at: (i32, i32),
    carried: &[(Good, f64)],
) -> String {
    let id = format!("{PLACED}{name}-{realm}");
    let mut r: Resident = resident(&id, Some(realm), f64::from(at.0), f64::from(at.1));
    r.city_id = Some(city.into());
    r.carried = carried.iter().copied().collect();
    world.residents.push(r);
    id
}

/// The tile of a building.
fn tile(b: &Building) -> (i32, i32) {
    (b.x as i32, b.y as i32)
}

/// The random-order run's world on a map of [`SIZE`] (see the module's text).
pub fn random_world() -> (WorldState, TerrainMap) {
    let (mut world, mut terrain) = crate::test_world::two_realms_world(SIZE);
    let mut rand = Mulberry32::new(125.0);
    let realms: Vec<(String, String)> = world
        .cities
        .iter()
        .filter_map(|c| Some((c.realm_id.clone()?, c.id.clone())))
        .collect();
    let hall = |world: &WorldState, city: &str| {
        let c = world.cities.iter().find(|c| c.id == city).expect("a city");
        tile(world.buildings.iter().find(|b| b.id == c.town_hall_id).expect("a hall"))
    };
    let mut land = Land::of(&world, &mut terrain);

    // The NPC village between them, with a stable of horses; a trading post; a small HQ.
    let (a, b) = (hall(&world, &realms[0].1), hall(&world, &realms[1].1));
    let between = ((a.0 + b.0) / 2, (a.1 + b.1) / 2);
    let village_side = csp_shared::balance::NPC_VILLAGE.size as i32;
    let (vx, vy) = land.place(between, village_side + 8, village_side + 8);
    let village = crate::npc_cities::found_npc_city(
        &mut world,
        land.terrain,
        &csp_shared::balance::NPC_VILLAGE,
        vx + 4,
        vy + 4,
        &mut || rand.next(),
        None,
    );
    let stable_side = side(BuildingKind::Stable);
    let stable_at = land.place((vx, vy), stable_side, stable_side);
    let id = crate::goods_deps::new_id(&mut world, "b");
    world.buildings.push(finished(id, BuildingKind::Stable, Some(&village), stable_at.0, stable_at.1));
    crate::npc_cities::give_npc_horses(&mut world, land.terrain, &village);
    for n in 0..3 {
        let mut h = horse(&format!("npc-horse-{n}"), None, 0.0, 0.0);
        h.city_id = Some(village.clone());
        (h.x, h.y) = (f64::from(stable_at.0 + n), f64::from(stable_at.1));
        world.horses.push(h);
    }
    let post_side = csp_shared::balance::TRADING_POST.size as i32;
    let (px, py) = land.place((b.0, a.1), post_side + 8, post_side + 8);
    let post = crate::trading_posts::found_trading_post(
        &mut world,
        land.terrain,
        px + 4,
        py + 4,
        None,
        &mut || rand.next(),
    );
    let hq = trade_org_hq(&mut world, &mut land, (a.0, b.1));

    // Each realm's water, haven, ship and boat; training ground; woods and hills; a worn house.
    for (n, (realm, city)) in realms.iter().enumerate() {
        let h = hall(&world, city);
        let haven_side = side(BuildingKind::Haven);
        let (x, y) = land.place(h, haven_side + 3, haven_side + 4);
        land.paint(x, y + haven_side, haven_side + 3, 4, Terrain::Sea);
        let id = crate::goods_deps::new_id(&mut world, "b");
        let mut haven = finished(id, BuildingKind::Haven, Some(city), x + 1, y);
        haven.stock = Some([(Good::Wood, 20.0), (Good::Food, 20.0)].into_iter().collect());
        world.buildings.push(haven);
        let ship = format!("ship-{realm}");
        let at_sea = (x + 1, y + haven_side);
        world.vessels.push(vessel(&ship, VesselKind::Ship, realm, at_sea));
        let boat_at = (x + haven_side + 1, y + haven_side);
        world.vessels.push(vessel(&format!("boat-{realm}"), VesselKind::Boat, realm, boat_at));
        let mut crew = Vec::new();
        for c in 0..4 {
            let id = placed(&mut world, &format!("sailor{c}"), realm, city, at_sea, &[]);
            world.residents.last_mut().expect("placed").aboard = Some(ship.clone());
            crew.push(id);
        }
        world.vessels.iter_mut().find(|v| v.id == ship).expect("the ship").crew_ids = crew;
        placed(&mut world, "haven", realm, city, (x + 1, y), &[(Good::Food, 2.0)]);
        placed(&mut world, "rower", realm, city, (boat_at.0, boat_at.1 - 1), &[]);

        let ground = side(BuildingKind::TrainingGround);
        let (gx, gy) = land.place(h, ground, ground);
        let id = crate::goods_deps::new_id(&mut world, "b");
        world.buildings.push(finished(id, BuildingKind::TrainingGround, Some(city), gx, gy));
        placed(&mut world, "trainer", realm, city, (gx, gy), &[]);

        let (fx, fy) = land.place(h, 4, 8);
        land.paint(fx, fy, 4, 4, Terrain::Forest);
        land.paint(fx, fy + 4, 4, 4, Terrain::Hills);
        placed(&mut world, "woods", realm, city, (fx + 1, fy + 1), &[]);
        placed(&mut world, "hills", realm, city, (fx + 1, fy + 5), &[]);

        if let Some(house) = world
            .buildings
            .iter_mut()
            .find(|b| b.kind == BuildingKind::House && b.city_id.as_deref() == Some(city))
        {
            house.decay = Some(0.5);
            let at = tile(house);
            placed(&mut world, "mender", realm, city, at, &[(Good::Wood, 5.0)]);
        }

        // Standing on their own storage with coins, on their own stable with two horses there,
        // on each carriage of theirs, on the post's warehouse and the village's stable and hall.
        let of_city = |world: &WorldState, kind: BuildingKind, city: &str| {
            world
                .buildings
                .iter()
                .find(|b| b.kind == kind && b.city_id.as_deref() == Some(city))
                .map(tile)
        };
        if let Some(at) = of_city(&world, BuildingKind::Storage, city) {
            placed(&mut world, "storage", realm, city, at, &[(Good::Coins, 60.0), (Good::Wood, 5.0)]);
        }
        if let Some(at) = of_city(&world, BuildingKind::Stable, city) {
            placed(&mut world, "stable", realm, city, at, &[(Good::Food, 4.0)]);
            for k in 0..2 {
                let mut h = horse(&format!("horse{k}-{realm}"), Some(realm), 0.0, 0.0);
                h.city_id = Some(city.clone());
                (h.x, h.y) = (f64::from(at.0 + k), f64::from(at.1));
                h.hunger = MAX_HUNGER / 2.0;
                world.horses.push(h);
            }
        }
        let carts: Vec<(i32, i32)> = world
            .carriages
            .iter()
            .filter(|c| c.realm_id.as_deref() == Some(realm))
            .map(|c| (c.x as i32, c.y as i32))
            .collect();
        for (k, at) in carts.into_iter().enumerate() {
            placed(&mut world, &format!("driver{k}"), realm, city, at, &[(Good::Wood, 4.0)]);
        }
        for (name, warehouse_of) in [("trader", &post), ("hq", &hq)] {
            if let Some(at) = of_city(&world, BuildingKind::Warehouse, warehouse_of) {
                let goods = [(Good::Coins, 200.0), (Good::Wood, 10.0), (Good::Iron, 2.0)];
                placed(&mut world, name, realm, city, at, &goods);
            }
        }
        let npc_stable = stable_at;
        placed(&mut world, "horsebuyer", realm, city, npc_stable, &[(Good::Coins, 400.0)]);
        let mut h = horse(&format!("horse-to-sell-{realm}"), Some(realm), 0.0, 0.0);
        h.city_id = Some(city.clone());
        (h.x, h.y) = (f64::from(npc_stable.0 + 1), f64::from(npc_stable.1 + 1));
        world.horses.push(h);
        placed(&mut world, "horseseller", realm, city, (npc_stable.0 + 1, npc_stable.1 + 1), &[]);
        if n == 0 {
            let v_hall = hall(&world, &village);
            placed(&mut world, "buyer", realm, city, v_hall, &[(Good::Coins, 6000.0)]);
        }
        // Everyone else carries a sword and armour as well as their spear, to equip.
        for r in world.residents.iter_mut().filter(|r| r.owner.as_deref() == Some(realm)) {
            for g in [Good::Sword, Good::Armour] {
                *r.carried.entry(g).or_insert(0.0) += 1.0;
            }
        }
    }

    // At the other realm's walls: a crewed ram of the first, a crewed catapult of the second, and
    // a climber of each.
    for (n, (realm, city)) in realms.iter().enumerate() {
        let (_, other) = &realms[1 - n];
        let target = tile(
            world
                .buildings
                .iter()
                .filter(|b| b.kind == BuildingKind::Wall && b.city_id.as_deref() == Some(other))
                .min_by_key(|b| {
                    let h = hall(&world, city);
                    (b.x as i32 - h.0).abs() + (b.y as i32 - h.1).abs()
                })
                .expect("a wall of the other city"),
        );
        let outside = [(1, 0), (-1, 0), (0, 1), (0, -1)]
            .into_iter()
            .map(|(dx, dy)| (target.0 + dx, target.1 + dy))
            .find(|&(x, y)| land.free(x, y, 1, 1) && !land.taken.contains(&(x, y)))
            .unwrap_or_else(|| land.place(target, 1, 1));
        placed(&mut world, "climber", realm, city, outside, &[]);
        let (kind, crew, stone) = if n == 0 {
            (SiegeMachineKind::Ram, 4, 0.0)
        } else {
            (SiegeMachineKind::Catapult, 3, 5.0)
        };
        let machine = format!("machine-{realm}");
        let at = if n == 0 { outside } else { land.place(target, 1, 1) };
        let mut crew_ids = Vec::new();
        for c in 0..crew {
            crew_ids.push(placed(&mut world, &format!("crew{c}"), realm, city, at, &[(Good::Stone, stone)]));
        }
        world.siege_machines.push(SiegeMachine {
            id: machine,
            kind,
            realm_id: Some(realm.clone()),
            x: f64::from(at.0),
            y: f64::from(at.1),
            damage: None,
            teardown: None,
            crew_ids,
        });
    }

    // What only the world's history gives: they know of each other, the village asks the first
    // to take it in, the first owes the Trade Org, the second has a directive against it.
    let (first, second) = (&realms[0].0, &realms[1].0);
    for (of, toward, value) in
        [(first, second, 10.0), (second, first, 10.0), (&village, first, 60.0)]
    {
        world.standings.push(Standing { of: of.clone(), toward: toward.clone(), value });
    }
    world.join_requests.push(JoinRequest {
        city_id: village.clone(),
        realm_id: first.clone(),
        at: 0.0,
        declined: false,
    });
    world.debts.push(
        serde_json::from_value(json!({ "org": first, "coins": 30 })).expect("a debt"),
    );
    world.directives.push(Directive {
        id: "directive-1".into(),
        target: second.clone(),
        with_alliance: false,
        reason: "random".into(),
        given_by: hq.clone(),
        given_at: 0.0,
        goals: Vec::new(),
        soldiers_killed: 0.0,
        price: Some(40.0),
    });
    drop(land);
    (world, terrain)
}

fn vessel(id: &str, kind: VesselKind, realm: &str, at: (i32, i32)) -> Vessel {
    Vessel {
        id: id.into(),
        kind,
        realm_id: Some(realm.into()),
        x: f64::from(at.0),
        y: f64::from(at.1),
        load: Default::default(),
        rower_id: None,
        crew_ids: Vec::new(),
    }
}

/// A small Trade Org HQ: its town hall, its coin warehouse where an HQ keeps it and a goods
/// warehouse, both stocked. Returns its id.
fn trade_org_hq(world: &mut WorldState, land: &mut Land, near: (i32, i32)) -> String {
    let (hall_side, wh) = (side(BuildingKind::TownHall), side(BuildingKind::Warehouse));
    let (cx, cy) = crate::queries::warehouse::HQ_COIN_WAREHOUSE;
    let (cx, cy) = (cx as i32, cy as i32);
    let w = (hall_side.max(cx + wh) + wh + 2).max(14);
    let (x, y) = land.place(near, w, -cy + hall_side + 2);
    let hall_at = (x, y - cy);
    let id = crate::random::new_id("city", &mut world.next_id);
    let hall_id = crate::goods_deps::new_id(world, "b");
    world.buildings.push(finished(hall_id.clone(), BuildingKind::TownHall, Some(&id), hall_at.0, hall_at.1));
    let city: City = serde_json::from_value(json!({
        "id": id, "name": "Market", "realmId": null, "townHallId": hall_id, "occupation": null,
        "tradeOrg": "hq",
    }))
    .expect("an HQ");
    world.cities.push(city);
    let coins_id = crate::goods_deps::new_id(world, "b");
    let mut coins = finished(coins_id, BuildingKind::Warehouse, Some(&id), hall_at.0 + cx, hall_at.1 + cy);
    coins.stock = Some([(Good::Coins, 5000.0)].into_iter().collect());
    world.buildings.push(coins);
    let goods_id = crate::goods_deps::new_id(world, "b");
    let mut goods = finished(goods_id, BuildingKind::Warehouse, Some(&id), x + w - wh, hall_at.1);
    goods.stock = Some(
        csp_shared::goods::PRICED_GOODS.iter().map(|g| (*g, 200.0)).collect(),
    );
    world.buildings.push(goods);
    id
}

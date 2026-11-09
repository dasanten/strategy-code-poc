//! `apps/server/src/hq-growth.test.ts`, ported one to one. The world steps with the ported
//! `Walking`.

use std::sync::Arc;

use csp_shared::balance::{TRADE_ORG_ARMY, TRADE_ORG_HQ};
use csp_shared::terrain::{wrap_delta, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Good, TradeOrgCity};
use serde_json::{json, Value};

use super::*;
use crate::cities::update_city_membership;
use crate::invariants::check_all;
use crate::queries::residents::is_armed;
use crate::queries::trade_org::strongest_armed;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::test_world::add_city;
use crate::tick::Scratch;
use crate::trade_org::{found_trade_org_hq, hq_layout};
use crate::trade_org_army::{armed_outsiders_near, hq_soldiers};
use crate::walking::Walking;
use crate::world::{create_world, step_world};

/// Where the HQ's town hall stands.
const MID: i32 = 320;

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    hq: String,
    walking: Walking,
    scratch: Scratch,
}

/// The Trade Org HQ at (MID, MID); realm r1 with city c1 at (80, 560).
fn setup() -> Setup {
    let terrain = plains(640);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq = found_trade_org_hq(&mut world, &terrain, MID, MID, &mut || m.next());
    world.realms.push(
        serde_json::from_value(json!({ "id": "r1", "userId": 7, "leaderId": "a1" })).unwrap(),
    );
    add_city(&mut world, "c1", Some("r1"), 80.0, 560.0, None);
    resident(&mut world, "a1", 80.0, 563.0, Some("r1"));
    let walking = Walking::new(Arc::new(terrain.clone()));
    Setup { world, terrain, hq, walking, scratch: Scratch::default() }
}

fn building(v: Value) -> Building {
    serde_json::from_value(v).unwrap()
}

/// A grown resident of `owner` (a realm, or `None` for one of the HQ's own).
fn resident(world: &mut WorldState, id: &str, x: f64, y: f64, owner: Option<&str>) -> usize {
    let hq = world.cities.iter().find(|c| c.trade_org == Some(TradeOrgCity::Hq)).unwrap();
    let city = if owner.is_none() { hq.id.clone() } else { "c1".to_string() };
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner, city_id: Some(&city), x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    world.residents.len() - 1
}

/// `n` armed residents of realm `owner` in a row from (x, y), by index.
fn armed(world: &mut WorldState, owner: &str, n: usize, x: f64, y: f64, tag: &str) -> Vec<usize> {
    (0..n)
        .map(|i| {
            let r = resident(world, &format!("{tag}-{i}"), x + i as f64, y, Some(owner));
            world.residents[r].carried.insert(Good::Spear, 1.0);
            r
        })
        .collect()
}

/// The HQ's own residents, by index.
fn hq_people(world: &WorldState, hq: &str) -> Vec<usize> {
    (0..world.residents.len())
        .filter(|&i| {
            world.residents[i].owner.is_none() && world.residents[i].city_id.as_deref() == Some(hq)
        })
        .collect()
}

fn hq_city(s: &Setup) -> City {
    s.world.cities.iter().find(|c| c.id == s.hq).unwrap().clone()
}

/// Steps the world, keeping everyone fed, and checks every invariant now and then.
fn run(s: &mut Setup, ticks: usize, until: &dyn Fn(&WorldState) -> bool) {
    for i in 0..ticks {
        for r in &mut s.world.residents {
            r.hunger = 100.0;
        }
        step_world(&mut s.world, &s.terrain, &mut s.scratch, Some(&mut s.walking), None);
        if i % 200 == 0 {
            assert_eq!(check_all(&s.world, &s.terrain), vec![]);
        }
        if until(&s.world) {
            break;
        }
    }
    assert_eq!(check_all(&s.world, &s.terrain), vec![]);
}

/// The HQ's gates on its outer ring, by index.
fn outer_gates(world: &WorldState, hq: &str, size: i32) -> Vec<usize> {
    // From the middle of its town hall, which its rings are round.
    let city = world.cities.iter().find(|c| c.id == hq).unwrap();
    let hall = town_hall_of(world, city).unwrap();
    let (hx, hy) = (hall.x as i32 + 1, hall.y as i32 + 1);
    let d = |b: &Building| {
        f64::from(wrap_delta(hx, b.x as i32, size))
            .hypot(f64::from(wrap_delta(hy, b.y as i32, size)))
    };
    (0..world.buildings.len())
        .filter(|&i| {
            let b = &world.buildings[i];
            b.city_id.as_deref() == Some(hq)
                && b.kind == BuildingKind::Gate
                && d(b) > TRADE_ORG_HQ.inner_radius + 1.0
        })
        .collect()
}

fn all_closed(world: &WorldState, gates: &[usize]) -> bool {
    gates.iter().all(|&g| world.buildings[g].closed == Some(true))
}

fn all_open(world: &WorldState, gates: &[usize]) -> bool {
    gates.iter().all(|&g| world.buildings[g].closed != Some(true))
}

/// Distance of a tile from the HQ's town hall.
fn from_hall(x: f64, y: f64) -> f64 {
    (x - f64::from(MID)).hypot(y - f64::from(MID))
}

// the HQ closing its gates

#[test]
fn closes_its_outer_gates_when_armed_outsiders_pass_a_share_of_its_soldiers_and_opens_them() {
    let mut s = setup();
    let size = s.terrain.size;
    let soldiers: Vec<usize> = hq_people(&s.world, &s.hq).into_iter().take(8).collect();
    for &r in &soldiers {
        s.world.residents[r].carried.insert(Good::Spear, 1.0);
    }
    assert_eq!(hq_soldiers(&s.world).len(), 8);
    let (gx, gy) = hq_layout(MID, MID).outer_gates[0];
    let (gx, gy) = (f64::from(gx), f64::from(gy));
    // As many as half its soldiers: the gates stay open.
    let mut outsiders = armed(&mut s.world, "r1", 4, gx, gy - 16.0, "r1");
    run(&mut s, 1, &|_| false);
    assert_eq!(armed_outsiders_near(&s.world, &hq_city(&s), size).len(), 4);
    assert!(all_open(&s.world, &outer_gates(&s.world, &s.hq, size)));
    // One more: it closes them all.
    outsiders.extend(armed(&mut s.world, "r1", 1, gx, gy - 24.0, "late"));
    run(&mut s, 1, &|_| false);
    let gates = outer_gates(&s.world, &s.hq, size);
    assert_eq!(gates.len(), TRADE_ORG_HQ.gates as usize);
    assert!(all_closed(&s.world, &gates));
    // Unarmed ones and those far away don't count; once they put down their arms it opens again.
    for &r in outsiders.iter().take(3) {
        s.world.residents[r].carried.shift_remove(&Good::Spear);
    }
    run(&mut s, 1, &|_| false);
    assert!(all_open(&s.world, &outer_gates(&s.world, &s.hq, size)));
}

#[test]
fn counts_only_its_soldiers_at_home() {
    let mut s = setup();
    let (gx, gy) = hq_layout(MID, MID).outer_gates[0];
    // No soldiers at all: a single armed outsider closes the gates.
    armed(&mut s.world, "r1", 1, f64::from(gx), f64::from(gy) - 16.0, "r1");
    run(&mut s, 1, &|_| false);
    assert!(all_closed(&s.world, &outer_gates(&s.world, &s.hq, s.terrain.size)));
}

// the HQ against the strongest Organization

#[test]
fn wants_a_multiple_of_the_strongest_sides_armed_residents_an_alliance_counted_together() {
    let mut s = setup();
    let w = &mut s.world;
    assert_eq!(trade_org_army_wanted(w), TRADE_ORG_ARMY.size);
    for (id, user, leader) in [("r2", 8, "x"), ("r3", 9, "y")] {
        w.realms.push(
            serde_json::from_value(json!({ "id": id, "userId": user, "leaderId": leader }))
                .unwrap(),
        );
    }
    armed(w, "r1", 8, 40.0, 40.0, "r1");
    armed(w, "r2", 7, 40.0, 80.0, "r2");
    armed(w, "r3", 12, 40.0, 120.0, "r3");
    assert_eq!(strongest_armed(w), 12.0);
    w.alliances.push(
        serde_json::from_value(json!({
            "id": "al",
            "name": "Pact",
            "leaderId": "r1",
            "members": [
                { "realmId": "r1", "joinedAt": 0, "leaving": null },
                { "realmId": "r2", "joinedAt": 0, "leaving": null },
            ],
            "invites": [],
            "army": [],
        }))
        .unwrap(),
    );
    assert_eq!(strongest_armed(w), 15.0);
    assert_eq!(trade_org_army_wanted(w), (15.0 * TRADE_ORG_ARMY.strongest_multiple).ceil());
}

#[test]
#[ignore = "slow in the TypeScript too (`tags: ['slow']`), 22 s here: T86.14's long simulations"]
fn trains_more_soldiers_than_its_armys_size_when_a_player_grows_strong() {
    let mut s = setup();
    let goods = s
        .world
        .buildings
        .iter_mut()
        .find(|b| {
            b.city_id.as_deref() == Some(s.hq.as_str())
                && b.stock.as_ref().is_some_and(|st| st.contains_key(&Good::Wood))
        })
        .unwrap();
    goods.stock.as_mut().unwrap().insert(Good::Spear, 40.0);
    armed(&mut s.world, "r1", 12, 80.0, 563.0, "r1");
    let wanted = (12.0 * TRADE_ORG_ARMY.strongest_multiple).ceil();
    assert!(wanted > TRADE_ORG_ARMY.size);
    run(&mut s, (10.0 * TICKS_PER_GAME_DAY) as usize, &|w| hq_soldiers(w).len() as f64 >= wanted);
    assert_eq!(hq_soldiers(&s.world).len() as f64, wanted);
    let unarmed = hq_people(&s.world, &s.hq)
        .into_iter()
        .filter(|&i| !is_armed(&s.world.residents[i].carried))
        .count();
    assert!(unarmed as f64 >= TRADE_ORG_ARMY.workers);
}

/// The HQ too weak against r1 (more armed residents than it can match from its adults), with a
/// food surplus, Wood for building and no free housing.
fn weak() -> Setup {
    let mut s = setup();
    armed(&mut s.world, "r1", 20, 40.0, 563.0, "r1");
    let storage = s
        .world
        .buildings
        .iter_mut()
        .find(|b| b.city_id.as_deref() == Some(s.hq.as_str()) && b.kind == BuildingKind::Storage)
        .unwrap();
    storage.stock = Some([(Good::Food, 20_000.0), (Good::Wood, 2_000.0)].into_iter().collect());
    let mut i = 0;
    while free_housing(&s.world, &s.hq) > 0.0 {
        resident(&mut s.world, &format!("h{i}"), f64::from(MID), f64::from(MID + 28), None);
        i += 1;
    }
    s
}

/// Fills every spot between its rings the HQ could put a house on, so its housing stays full:
/// warehouses wherever one fits, row by row, then smelters in the gaps: nothing an NPC city works
/// or carries its output to, so the HQ goes on as it would.
fn fill_room(s: &mut Setup, outermost: usize) {
    let r = hq_ring_radius(outermost).ceil() as i32;
    let between = |x: i32, y: i32| {
        let d = f64::from(x - MID).hypot(f64::from(y - MID));
        d > TRADE_ORG_HQ.inner_radius && d <= f64::from(r) + 0.5
    };
    let mut add = Vec::new();
    {
        let mut ground = Ground::new(&s.world, &s.terrain, []);
        let mut n = 0;
        // The biggest footprints first, so there are few buildings and the ticks stay quick.
        for kind in [BuildingKind::Warehouse, BuildingKind::Smelter] {
            for y in MID - r..=MID + r {
                for x in MID - r..=MID + r {
                    if !ground.fits(kind, x, y, Some(&between)) {
                        continue;
                    }
                    ground.take(kind, x, y);
                    // A workplace belongs to no city (`CONTEXT.md`: Workplace).
                    let city = if kind == BuildingKind::Smelter { None } else { Some(&s.hq) };
                    let name = if kind == BuildingKind::Smelter { "smelter" } else { "warehouse" };
                    add.push(building(
                        json!({ "id": format!("fill{n}"), "kind": name, "cityId": city, "x": x, "y": y }),
                    ));
                    n += 1;
                }
            }
        }
    }
    s.world.buildings.extend(add);
    update_city_membership(&mut s.world, s.terrain.size);
    let hq = hq_city(s);
    let hall = town_hall_of(&s.world, &hq).unwrap();
    assert_eq!(hq_house_tile(&s.world, hall, &s.terrain, outermost, BuildingKind::House), None);
}

// the HQ growing

#[test]
fn stays_as_it_is_while_it_is_strong_enough() {
    let s = setup();
    let hq = hq_city(&s);
    let hall = town_hall_of(&s.world, &hq).unwrap();
    assert_eq!(
        hq_rings(&s.world, hall, &s.terrain, None),
        HqRings { outermost: 0, building: None }
    );
    // Its rings stand where the layout put them.
    let gates: Vec<Tile> = hq_ring_tiles(hall, 0, s.terrain.size)
        .into_iter()
        .filter(|t| t.kind == BuildingKind::Gate)
        .map(|t| (t.x, t.y))
        .collect();
    for g in &hq_layout(MID, MID).outer_gates {
        assert!(gates.contains(g), "{g:?} among {gates:?}");
    }
    assert_eq!(hq_rings_sound(&s.world, &s.terrain), vec![]);
}

fn houses(w: &WorldState) -> Vec<&Building> {
    w.buildings.iter().filter(|b| b.kind == BuildingKind::House).collect()
}

#[test]
fn builds_houses_between_its_rings_while_too_weak() {
    let mut s = weak();
    let before = houses(&s.world).len();
    run(&mut s, TICKS_PER_GAME_DAY as usize, &|w| houses(w).len() > before);
    assert!(houses(&s.world).len() > before);
    for h in houses(&s.world) {
        assert!(from_hall(h.x, h.y) > TRADE_ORG_HQ.inner_radius + 0.5);
        assert!(from_hall(h.x, h.y) <= TRADE_ORG_HQ.outer_radius + 0.5);
    }
}

#[test]
#[ignore = "slow in the TypeScript too (`tags: ['slow']`): T86.14's long simulations"]
fn grows_a_new_outer_ring_once_it_has_no_room_for_houses_and_houses_beyond_the_old_one() {
    let mut s = weak();
    let size = s.terrain.size;
    fill_room(&mut s, 0);
    let hq = hq_city(&s);
    // Out of room: it starts on a gate of the next ring, in line with the others.
    let Some(CityProject::Build { building: kind, x, y }) = hq_project(&s.world, &hq, &s.terrain)
    else {
        panic!("a building project")
    };
    assert_eq!(kind, BuildingKind::Gate);
    assert!(from_hall(x, y) > hq_ring_radius(1) - 1.5);
    assert!(from_hall(x, y) <= hq_ring_radius(1) + 0.5);
    run(&mut s, 2 * TICKS_PER_GAME_DAY as usize, &|w| {
        w.buildings.iter().any(|b| {
            b.site.is_none()
                && b.kind == BuildingKind::Gate
                && from_hall(b.x, b.y) > hq_ring_radius(1) - 1.5
        })
    });
    let hall = town_hall_of(&s.world, &hq).unwrap().clone();
    assert_eq!(
        hq_rings(&s.world, &hall, &s.terrain, None),
        HqRings { outermost: 0, building: Some(1) }
    );
    let ring = s.world.buildings.iter().filter(|b| {
        matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate)
            && from_hall(b.x, b.y) > TRADE_ORG_HQ.outer_radius + 1.0
    });
    assert!(ring.count() > 0);
    // The old ring stays.
    let old = outer_gates(&s.world, &s.hq, size)
        .into_iter()
        .filter(|&g| {
            let g = &s.world.buildings[g];
            from_hall(g.x, g.y) <= TRADE_ORG_HQ.outer_radius + 0.5
        })
        .count();
    assert_eq!(old, TRADE_ORG_HQ.gates as usize);

    // Once the new ring is finished, its next houses go between the old ring and the new.
    for t in hq_ring_tiles(&hall, 1, size) {
        let found = s.world.buildings.iter_mut().find(|b| b.x as i32 == t.x && b.y as i32 == t.y);
        match found {
            Some(b) => b.site = None,
            None => {
                let kind = if t.kind == BuildingKind::Gate { "gate" } else { "wall" };
                s.world.buildings.push(building(json!({
                    "id": format!("ring-{}-{}", t.x, t.y),
                    "kind": kind,
                    "cityId": s.hq,
                    "x": t.x,
                    "y": t.y,
                })));
            }
        }
    }
    assert_eq!(
        hq_rings(&s.world, &hall, &s.terrain, None),
        HqRings { outermost: 1, building: None }
    );
    let (hx, hy) = hq_house_tile(&s.world, &hall, &s.terrain, 1, BuildingKind::House).unwrap();
    assert!(from_hall(f64::from(hx), f64::from(hy)) > TRADE_ORG_HQ.outer_radius + 0.5);
    assert!(from_hall(f64::from(hx), f64::from(hy)) < hq_ring_radius(1));
    assert_eq!(hq_rings_sound(&s.world, &s.terrain), vec![]);
}

#[test]
fn does_not_grow_while_it_can_match_the_strongest_organization() {
    let mut s = weak();
    s.world.residents.retain(|r| !r.id.starts_with("r1-"));
    fill_room(&mut s, 0);
    run(&mut s, 200, &|_| false);
    assert_eq!(s.world.buildings.iter().filter(|b| b.site.is_some()).count(), 0);
}

// hq-rings-sound

#[test]
fn reports_a_wall_off_its_rings_and_a_house_outside_them() {
    let mut s = setup();
    s.world.buildings.push(building(
        json!({ "id": "stray", "kind": "wall", "cityId": s.hq, "x": MID + 28, "y": MID }),
    ));
    s.world.buildings.push(building(
        json!({ "id": "far", "kind": "house", "cityId": s.hq, "x": MID, "y": MID + 48 }),
    ));
    let messages: Vec<String> =
        hq_rings_sound(&s.world, &s.terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        vec![
            "wall stray of the Trade Org HQ stands on none of its rings",
            "house far of the Trade Org HQ stands outside its rings",
        ]
    );
}

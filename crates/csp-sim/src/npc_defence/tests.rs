//! `npc-defence.test.ts`.

use csp_shared::balance::{
    CITY_AREA_MARGIN, MAX_HEALTH, NPC_GATE_WATCH_RANGE, NPC_TOWN, NPC_VILLAGE, TRADING_POST,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, Good, Realm, Resident, ResidentOrder, Stock, WorldState,
};
use serde_json::{json, Value};

use super::{attackers_of, npc_gate_shut_to_its_punishers, step_npc_defence};
use crate::alarms::GameAlarms;
use crate::capture::step_captures;
use crate::combat::attack_order;
use crate::crimes::{commit_crime, CrimeAgainst};
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::city_area::occupier_of;
use crate::queries::names::held;
use crate::queries::npc_trade::npc_soldier_target;
use crate::queries::residents::{can_work, is_armed};
use crate::queries::standing::TRADE_ORG;
use crate::queries::walls::on_own_wall;
use crate::random::Mulberry32;
use crate::realm_pending::change_standing;
use crate::residents::{new_resident, NewResident};
use crate::trade_org::found_trade_org_hq;
use crate::trade_org_army::step_trade_org_army;
use crate::trading_posts::found_trading_post;
use crate::world::create_world;

const DAY: usize = TICKS_PER_GAME_DAY as usize;

struct Place {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
}

impl Place {
    fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the city")
    }

    /// Where in `world.buildings` the city's first building of `kind` is (`buildingOf`).
    fn building(&self, kind: BuildingKind) -> usize {
        self.world
            .buildings
            .iter()
            .position(|b| b.city_id.as_deref() == Some(self.city.as_str()) && b.kind == kind)
            .expect("a building of the city")
    }

    fn at(&self, kind: BuildingKind) -> Building {
        self.world.buildings[self.building(kind)].clone()
    }

    /// Where in `world.residents` the city's own people are (`citizens`).
    fn citizens(&self) -> Vec<usize> {
        (0..self.world.residents.len())
            .filter(|&i| {
                let r = &self.world.residents[i];
                r.owner.is_none() && r.city_id.as_deref() == Some(self.city.as_str())
            })
            .collect()
    }

    fn defend(&mut self) {
        step_npc_defence(&mut self.world, self.terrain.size);
    }

    fn gate_closed(&self) -> Option<bool> {
        self.world.buildings[self.building(BuildingKind::Gate)].closed
    }

    fn occupier(&self) -> Option<String> {
        occupier_of(&self.world, self.city(), self.terrain.size)
    }

    fn attackers(&self) -> Vec<String> {
        attackers_of(&self.world, self.city(), self.terrain.size)
            .into_iter()
            .map(|i| self.world.residents[i].id.clone())
            .collect()
    }

    fn r(&self, id: &str) -> &Resident {
        self.world.residents.iter().find(|r| r.id == id).expect("the resident")
    }

    fn r_mut(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).expect("the resident")
    }

    /// Runs the world for `ticks`, checking the invariants every game day (`run`).
    fn run(&mut self, runner: &mut Runner, ticks: usize) {
        for _ in 0..ticks {
            runner.step(&mut self.world, &self.terrain);
            if self.world.tick.is_multiple_of(DAY as u64) {
                assert_eq!(check_all(&self.world, &self.terrain), []);
            }
        }
    }
}

/// A village alone on a small Plains map, its top-left wall tile at (20, 20) (`village`).
fn village() -> Place {
    let terrain = plains(160);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 20, 20, &mut || m.next(), None);
    Place { world, terrain, city }
}

/// A trading post alone on a small Plains map, its top-left wall tile at (20, 20) (`post`).
fn post() -> Place {
    let terrain = plains(160);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_trading_post(&mut world, &terrain, 20, 20, None, &mut || m.next());
    Place { world, terrain, city }
}

/// A grown Player's resident of realm r1 at (x, y) (`outsider`); returns their id.
fn outsider(world: &mut WorldState, id: &str, x: f64, y: f64) -> String {
    let mut m = Mulberry32::new((world.residents.len() + 1) as f64);
    let fields =
        NewResident { id, owner: Some("r1"), city_id: None, x, y, tick: world.tick as f64 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = world.tick as f64 - 20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    if !world.realms.iter().any(|x| x.id == "r1") {
        world.realms.push(Realm {
            id: "r1".into(),
            user_id: 7,
            leader_id: id.into(),
            name: None,
            demands_sent_at: None,
        });
    }
    id.into()
}

fn arm(world: &mut WorldState, id: &str, good: Good) {
    let r = world.residents.iter_mut().find(|r| r.id == id).unwrap();
    r.carried.insert(good, 1.0);
}

/// An armed soldier of the Trade Org army at (x, y), on a punishment of `culprit_org`
/// (`armySoldier`); returns their id.
fn army_soldier(world: &mut WorldState, id: &str, culprit_org: &str, x: f64, y: f64) -> String {
    let mut m = Mulberry32::new((world.residents.len() + 1) as f64);
    let fields =
        NewResident { id, owner: None, city_id: Some("hq"), x, y, tick: world.tick as f64 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.carried.insert(Good::Spear, 1.0);
    world.residents.push(r);
    world.punishments.push(
        serde_json::from_value(json!({
            "id": format!("punish-{id}"), "culpritOrg": culprit_org, "cityId": culprit_org,
            "worth": 100, "members": [{ "residentId": id, "own": { "spear": 1 } }],
            "heading": "out", "took": 0, "startedAt": world.tick,
        }))
        .unwrap(),
    );
    id.into()
}

fn order(v: Value) -> Option<ResidentOrder> {
    Some(serde_json::from_value(v).unwrap())
}

fn kind_of(r: &Resident) -> Option<String> {
    r.order.as_ref().map(|o| serde_json::to_value(o).unwrap()["kind"].as_str().unwrap().into())
}

fn attacking(r: &Resident) -> bool {
    kind_of(r).as_deref() == Some("attack")
}

/// Whether the resident's order has these fields, as `toMatchObject`.
fn order_has(r: &Resident, fields: Value) -> bool {
    let o = serde_json::to_value(&r.order).unwrap();
    fields.as_object().unwrap().iter().all(|(k, v)| &o[k] == v)
}

/// A resident's health, 0 once they have died and are gone: the TypeScript reads it off the
/// resident it kept hold of.
fn health(p: &Place, id: &str) -> f64 {
    p.world.residents.iter().find(|r| r.id == id).map_or(0.0, |r| r.health)
}

fn crimes_by(world: &WorldState, id: &str) -> usize {
    world
        .crimes
        .iter()
        .filter(|c| serde_json::to_value(&c.culprit).unwrap()["residentId"] == id)
        .count()
}

// an NPC city and the Trade Org army at its gate

/// A village with its gate, stepped once with the given people staged near it (`gateAfter`).
fn gate_after(stage: impl FnOnce(&mut WorldState, &Building, &str)) -> Option<bool> {
    let mut p = village();
    let gate = p.at(BuildingKind::Gate);
    let city = p.city.clone();
    stage(&mut p.world, &gate, &city);
    p.defend();
    p.gate_closed()
}

#[test]
fn keeps_its_gate_open_while_only_the_army_is_near() {
    let closed = gate_after(|w, g, _| {
        army_soldier(w, "a1", "r9", g.x, g.y + 2.0);
    });
    assert_eq!(closed, None);
}

#[test]
fn opens_its_gate_again_once_the_only_armed_outsiders_left_are_the_army() {
    let mut p = village();
    let gate = p.at(BuildingKind::Gate);
    army_soldier(&mut p.world, "a1", "r9", gate.x, gate.y + 2.0);
    outsider(&mut p.world, "p1", gate.x, gate.y + 2.0);
    arm(&mut p.world, "p1", Good::Sword);
    p.defend();
    assert_eq!(p.gate_closed(), Some(true));
    p.r_mut("p1").y = gate.y + NPC_GATE_WATCH_RANGE + 1.0;
    p.defend();
    assert_eq!(p.gate_closed(), None);
}

#[test]
fn shuts_its_gate_on_the_army_if_it_refuses_the_trade_organization() {
    let closed = gate_after(|w, g, city| {
        army_soldier(w, "a1", "r9", g.x, g.y + 2.0);
        change_standing(w, city, TRADE_ORG, -60.0);
    });
    assert_eq!(closed, Some(true));
}

#[test]
fn shuts_its_gate_on_a_punishment_aimed_at_itself() {
    let closed = gate_after(|w, g, city| {
        army_soldier(w, "a1", city, g.x, g.y + 2.0);
    });
    assert_eq!(closed, Some(true));
}

#[test]
fn shuts_its_gate_on_a_punishment_aimed_at_itself_with_another_army_near_too() {
    let closed = gate_after(|w, g, city| {
        army_soldier(w, "a1", "r9", g.x, g.y + 2.0);
        army_soldier(w, "a2", city, g.x, g.y + 2.0);
    });
    assert_eq!(closed, Some(true));
}

#[test]
fn counts_a_supply_wagon_driver_as_the_army_they_drive_for() {
    let wagon = |w: &mut WorldState, punishment: Option<&str>, g: &Building| {
        let id = army_soldier(w, "d1", "r9", 0.0, 0.0);
        w.punishments.pop();
        w.supply_wagons.push(
            serde_json::from_value(json!({
                "id": "w1", "punishmentId": punishment, "carriageId": "k1", "driverId": id,
                "food": 0, "ownFood": 0, "holding": null,
            }))
            .unwrap(),
        );
        let r = w.residents.iter_mut().find(|r| r.id == id).unwrap();
        (r.x, r.y) = (g.x, g.y + 2.0);
    };
    let elsewhere = gate_after(|w, g, _| {
        army_soldier(w, "a1", "r9", g.x, g.y + 40.0);
        wagon(w, Some("punish-a1"), g);
    });
    assert_eq!(elsewhere, None);
    let going_home = gate_after(|w, g, _| wagon(w, None, g));
    assert_eq!(going_home, None);
    let here = gate_after(|w, g, city| {
        army_soldier(w, "a1", city, g.x, g.y + 40.0);
        wagon(w, Some("punish-a1"), g);
    });
    assert_eq!(here, Some(true));
}

#[test]
fn still_shuts_its_gate_on_trade_org_soldiers_who_are_not_its_army() {
    let closed = gate_after(|w, g, _| {
        army_soldier(w, "a1", "r9", g.x, g.y + 2.0);
        w.punishments.clear();
    });
    assert_eq!(closed, Some(true));
}

#[test]
fn does_not_take_the_army_for_attackers() {
    let mut p = village();
    let gate = p.at(BuildingKind::Gate);
    army_soldier(&mut p.world, "a1", "r9", gate.x, gate.y + 2.0);
    for i in p.citizens() {
        p.world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    p.defend();
    assert!(p.attackers().is_empty());
    for i in p.citizens() {
        assert!(!attacking(&p.world.residents[i]));
    }
}

#[test]
fn has_an_invariant_catching_its_gate_open_to_a_punishment_aimed_at_itself() {
    let mut p = village();
    let gate = p.at(BuildingKind::Gate);
    let city = p.city.clone();
    let r = army_soldier(&mut p.world, "a1", &city, gate.x, gate.y + 2.0);
    let size = p.terrain.size;
    assert_eq!(npc_gate_shut_to_its_punishers(&p.world, size).len(), 1);
    p.defend();
    assert_eq!(npc_gate_shut_to_its_punishers(&p.world, size), []);
    let g = p.building(BuildingKind::Gate);
    p.world.buildings[g].closed = None;
    p.r_mut(&r).carried = Stock::new();
    assert_eq!(npc_gate_shut_to_its_punishers(&p.world, size), []);
    p.r_mut(&r).carried.insert(Good::Spear, 1.0);
    p.world.punishments[0].culprit_org = "r9".into();
    assert_eq!(npc_gate_shut_to_its_punishers(&p.world, size), []);
}

// NPC cities defend themselves

#[test]
fn keep_a_quarter_of_their_adults_as_soldiers_rounded_up() {
    assert_eq!(npc_soldier_target(NPC_VILLAGE.residents), 2.0);
    assert_eq!(npc_soldier_target(NPC_TOWN.residents), 4.0);
    assert_eq!(npc_soldier_target(1.0), 1.0);
}

#[test]
fn arm_soldiers_from_the_storage_by_their_size_and_soldiers_do_not_work() {
    let mut p = village();
    let s = p.building(BuildingKind::Storage);
    p.world.buildings[s].stock.get_or_insert_with(Stock::new).insert(Good::Spear, 5.0);
    let mut runner = Runner::new(&p.terrain);
    p.run(&mut runner, 2 * DAY);
    let tick = p.world.tick as f64;
    let adults: Vec<usize> = p
        .citizens()
        .into_iter()
        .filter(|&i| can_work(p.world.residents[i].born_at, tick))
        .collect();
    let soldiers: Vec<usize> =
        adults.iter().copied().filter(|&i| is_armed(&p.world.residents[i].carried)).collect();
    assert_eq!(soldiers.len() as f64, npc_soldier_target(adults.len() as f64));
    let spears = p.world.buildings[s].stock.as_ref().map_or(0.0, |st| held(st, Good::Spear));
    assert_eq!(spears, 5.0 - soldiers.len() as f64);
    for i in soldiers {
        assert_ne!(kind_of(&p.world.residents[i]).as_deref(), Some("workAt"));
    }
}

#[test]
fn make_spears_in_their_smithy_when_the_storage_has_no_weapons() {
    let mut p = village();
    let hall = p.at(BuildingKind::TownHall);
    // A smithy is no city building; the city works it as one of its own workplaces.
    let smithy =
        crate::test_support::building("smithy", BuildingKind::Smithy, None, hall.x + 3.0, hall.y);
    p.world.buildings.push(smithy);
    let city = p.city.clone();
    p.world.cities.iter_mut().find(|c| c.id == city).unwrap().workplace_ids =
        Some(vec!["smithy".into()]);
    let s = p.building(BuildingKind::Storage);
    let stock = p.world.buildings[s].stock.get_or_insert_with(Stock::new);
    stock.insert(Good::Iron, 10.0);
    stock.insert(Good::Wood, 20.0);
    let mut runner = Runner::new(&p.terrain);
    p.run(&mut runner, 3 * DAY);
    let armed = p
        .citizens()
        .into_iter()
        .filter(|&i| held(&p.world.residents[i].carried, Good::Spear) != 0.0)
        .count();
    assert_eq!(armed as f64, npc_soldier_target(NPC_VILLAGE.residents));
}

#[test]
fn keep_no_soldiers_they_have_no_weapons_for() {
    let mut p = village();
    let mut runner = Runner::new(&p.terrain);
    p.run(&mut runner, DAY);
    assert!(p.citizens().iter().all(|&i| !is_armed(&p.world.residents[i].carried)));
}

#[test]
fn close_their_gate_while_an_armed_outsider_is_near_and_open_it_again() {
    let mut p = village();
    let gate = p.at(BuildingKind::Gate);
    outsider(&mut p.world, "p1", gate.x, gate.y + NPC_GATE_WATCH_RANGE + 2.0);
    p.defend();
    assert_eq!(p.gate_closed(), None);
    p.r_mut("p1").y = gate.y + NPC_GATE_WATCH_RANGE;
    p.defend();
    // Unarmed, they are let in.
    assert_eq!(p.gate_closed(), None);
    arm(&mut p.world, "p1", Good::Sword);
    p.defend();
    assert_eq!(p.gate_closed(), Some(true));
    p.r_mut("p1").y = gate.y + NPC_GATE_WATCH_RANGE + 1.0;
    p.defend();
    assert_eq!(p.gate_closed(), None);
}

#[test]
fn let_their_own_residents_through_their_closed_gate_but_not_the_armed_outsider() {
    let mut p = village();
    let gate = p.at(BuildingKind::Gate);
    let hall = p.at(BuildingKind::TownHall);
    let mut runner = Runner::new(&p.terrain);
    let own = p.world.residents[p.citizens()[0]].id.clone();
    // Just outside its area, as far from its gate as an armed outsider gets without taking it.
    let out = (gate.x, gate.y + CITY_AREA_MARGIN + 2.0);
    outsider(&mut p.world, "p1", out.0, out.1);
    arm(&mut p.world, "p1", Good::Sword);
    let r = p.r_mut(&own);
    (r.x, r.y) = (gate.x, gate.y + 2.0);
    let home = json!({ "kind": "walkTo", "target": { "x": hall.x, "y": hall.y }, "path": null, "progress": 0 });
    for id in [own.as_str(), "p1"] {
        p.r_mut(id).order = order(home.clone());
    }
    for _ in 0..DAY {
        if kind_of(p.r(&own)).as_deref() != Some("walkTo") {
            break;
        }
        runner.step(&mut p.world, &p.terrain);
        // The outsider stays put, so the gate stays shut.
        let o = p.r_mut("p1");
        (o.x, o.y) = out;
        assert_eq!(p.gate_closed(), Some(true));
    }
    assert_eq!((p.r(&own).x, p.r(&own).y), (hall.x, hall.y));
    // They may stand on their own walls, and defend better there; the outsider may not.
    let wall = p.at(BuildingKind::Wall);
    let on_wall = |r: &Resident| {
        let mut r = r.clone();
        (r.x, r.y) = (wall.x, wall.y);
        on_own_wall(&p.world, &r)
    };
    assert!(on_wall(p.r(&own)));
    assert!(!on_wall(p.r("p1")));
    // The outsider, sent the same way, finds no way in.
    p.r_mut("p1").order = order(home);
    for _ in 0..20 {
        runner.step(&mut p.world, &p.terrain);
    }
    assert_eq!(p.r("p1").order, None);
    assert!(p.r("p1").y > gate.y);
}

// An NPC city's run the Alarm default for this (`npc-alarms.test.ts`); a post's go on their own.
#[test]
fn fight_attackers_in_their_area_a_trading_posts() {
    let mut p = post();
    let hall = p.at(BuildingKind::TownHall);
    let c = p.citizens();
    let ids: Vec<String> = c[..3].iter().map(|&i| p.world.residents[i].id.clone()).collect();
    for id in &ids {
        let r = p.r_mut(id);
        (r.x, r.y) = (hall.x, hall.y);
    }
    let (victim, soldier, bystander) = (&ids[0], &ids[1], &ids[2]);
    arm(&mut p.world, soldier, Good::Spear);
    outsider(&mut p.world, "p1", hall.x + 2.0, hall.y);
    arm(&mut p.world, "p1", Good::Sword);
    p.r_mut("p1").order = Some(ResidentOrder::Attack(attack_order(victim, false, false)));
    p.defend();
    assert!(order_has(p.r(soldier), json!({ "kind": "attack", "targetId": "p1" })));
    // Only the armed fight; the city commits no crime by it.
    assert!(!attacking(p.r(bystander)));
    let mut runner = Runner::new(&p.terrain);
    p.run(&mut runner, DAY);
    assert_eq!(crimes_by(&p.world, soldier), 0);
}

#[test]
fn leave_attackers_outside_their_area_alone_a_trading_posts() {
    let mut p = post();
    let hall = p.at(BuildingKind::TownHall);
    let c = p.citizens();
    let (victim, soldier) =
        (p.world.residents[c[0]].id.clone(), p.world.residents[c[1]].id.clone());
    let s = p.r_mut(&soldier);
    (s.x, s.y, s.order) = (hall.x, hall.y, None);
    arm(&mut p.world, &soldier, Good::Spear);
    let v = p.r_mut(&victim);
    (v.x, v.y) = (120.0, 120.0);
    outsider(&mut p.world, "p1", 121.0, 120.0);
    p.r_mut("p1").order = Some(ResidentOrder::Attack(attack_order(&victim, false, false)));
    p.defend();
    assert_eq!(p.r(&soldier).order, None);
}

#[test]
fn fight_those_breaking_or_climbing_their_walls_and_commit_no_crime_by_it_a_trading_posts() {
    let mut p = post();
    let gate = p.at(BuildingKind::Gate);
    let wall = p.at(BuildingKind::Wall);
    let soldier = p.world.residents[p.citizens()[0]].id.clone();
    let s = p.r_mut(&soldier);
    (s.x, s.y, s.order) = (gate.x, gate.y - 1.0, None);
    arm(&mut p.world, &soldier, Good::Spear);
    outsider(&mut p.world, "p1", gate.x, gate.y + 1.0);
    arm(&mut p.world, "p1", Good::Sword);
    p.r_mut("p1").order = Some(ResidentOrder::Attack(attack_order(&gate.id, false, false)));
    p.defend();
    assert!(order_has(p.r(&soldier), json!({ "kind": "attack", "targetId": "p1" })));

    p.r_mut(&soldier).order = None;
    outsider(&mut p.world, "p2", wall.x, wall.y - 1.0);
    p.r_mut("p1").order = None;
    p.r_mut("p2").order = order(json!({
        "kind": "climb", "wallId": wall.id, "at": { "x": wall.x, "y": wall.y - 1.0 }, "progress": 0,
    }));
    p.defend();
    assert!(order_has(p.r(&soldier), json!({ "kind": "attack", "targetId": "p2" })));

    // Fought from the inside, the breaker at the gate gets hit and nobody counts it a crime.
    p.r_mut(&soldier).order = Some(ResidentOrder::Attack(attack_order("p1", false, false)));
    p.r_mut("p1").order = Some(ResidentOrder::Attack(attack_order(&gate.id, false, false)));
    p.r_mut("p2").order = None;
    let mut runner = Runner::new(&p.terrain);
    p.run(&mut runner, DAY / 4);
    assert!(health(&p, "p1") < MAX_HEALTH);
    assert_eq!(crimes_by(&p.world, &soldier), 0);
}

#[test]
fn still_close_a_damaged_gate_and_close_nothing_once_it_is_broken() {
    let mut p = village();
    let g = p.building(BuildingKind::Gate);
    p.world.buildings[g].damage = Some(1.0);
    let gate = p.at(BuildingKind::Gate);
    outsider(&mut p.world, "p1", gate.x, gate.y + 2.0);
    arm(&mut p.world, "p1", Good::Sword);
    p.defend();
    assert_eq!(p.gate_closed(), Some(true));
    p.world.buildings.retain(|b| b.id != gate.id);
    p.defend();
    let city = p.city.clone();
    assert!(!p
        .world
        .buildings
        .iter()
        .any(|b| b.city_id.as_deref() == Some(city.as_str()) && b.closed == Some(true)));
}

// Soldiers and whoever occupies their town hall

/// A citizen of the city armed with a spear, standing on the given building of it, not the hall
/// (`soldierOn`); returns their id.
fn soldier_on(p: &mut Place, kind: BuildingKind) -> String {
    let at = p.at(kind);
    let i = p
        .citizens()
        .into_iter()
        .find(|&i| !is_armed(&p.world.residents[i].carried))
        .expect("an unarmed citizen");
    let s = &mut p.world.residents[i];
    (s.x, s.y, s.order) = (at.x, at.y, None);
    s.carried.insert(Good::Spear, 1.0);
    s.id.clone()
}

/// An armed Player's resident standing on the city's town hall, attacking nobody
/// (`occupierOn`); returns their id.
fn occupier_on(p: &mut Place, id: &str) -> String {
    let hall = p.at(BuildingKind::TownHall);
    outsider(&mut p.world, id, hall.x, hall.y);
    arm(&mut p.world, id, Good::Sword);
    id.into()
}

/// The Trade Org HQ alone on a Plains map, its people unarmed (`headquarters`).
fn headquarters() -> Place {
    let terrain = plains(640);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let city = found_trade_org_hq(&mut world, &terrain, 320, 320, &mut || m.next());
    let mut p = Place { world, terrain, city };
    for i in p.citizens() {
        p.world.residents[i].carried.shift_remove(&Good::Spear);
    }
    p
}

/// A contract the Trade Organization has running for resident `id` of realm r1
/// (`hiredByTradeOrg`).
fn hired_by_trade_org(world: &mut WorldState, id: &str) {
    world.contracts.push(
        serde_json::from_value(json!({
            "id": "k1", "lenderId": "r1", "hirerId": TRADE_ORG, "offeredBy": "hirer",
            "residentIds": [id], "days": 7, "pricePerWeek": 5, "storageId": "s1",
            "startedAt": world.tick, "paidWeeks": 1,
        }))
        .unwrap(),
    );
}

#[test]
fn an_npc_city_leaves_them_to_their_alarm_default_which_goes_after_an_armed_outsider() {
    let mut p = village();
    let soldier = soldier_on(&mut p, BuildingKind::Storage);
    let o = occupier_on(&mut p, "p1");
    assert_eq!(p.occupier().as_deref(), Some("r1"));
    assert_eq!(p.attackers(), std::slice::from_ref(&o));
    p.defend();
    assert!(!attacking(p.r(&soldier)));
    step_captures(&mut p.world, p.terrain.size, &mut GameAlarms);
    let script = serde_json::to_value(&p.r(&soldier).script).unwrap();
    assert_eq!(script["task"], "alarm");
    assert_eq!(script["alarm"]["kind"], "occupied");
    assert_eq!(script["alarm"]["about"], json!(o));
}

#[test]
fn a_trading_post_sends_them_after_an_armed_outsider_who_attacks_nobody_as_no_crime() {
    let mut p = post();
    let soldier = soldier_on(&mut p, BuildingKind::Warehouse);
    let bystander = p
        .citizens()
        .into_iter()
        .find(|&i| !is_armed(&p.world.residents[i].carried))
        .map(|i| p.world.residents[i].id.clone())
        .unwrap();
    occupier_on(&mut p, "p1");
    p.defend();
    assert!(order_has(
        p.r(&soldier),
        json!({ "kind": "attack", "targetId": "p1", "started": false, "defending": true })
    ));
    assert!(!attacking(p.r(&bystander)));
}

#[test]
fn the_hq_sends_them_too() {
    let mut p = headquarters();
    let soldier = soldier_on(&mut p, BuildingKind::Warehouse);
    occupier_on(&mut p, "p1");
    p.defend();
    assert!(order_has(
        p.r(&soldier),
        json!({ "kind": "attack", "targetId": "p1", "defending": true })
    ));
}

#[test]
fn the_hqs_mercenaries_go_after_them_as_well_but_none_stands_on_the_hall_for_them() {
    let mut p = headquarters();
    let hall = p.at(BuildingKind::TownHall);
    let at = p.at(BuildingKind::Warehouse);
    outsider(&mut p.world, "m1", at.x, at.y);
    arm(&mut p.world, "m1", Good::Spear);
    hired_by_trade_org(&mut p.world, "m1");
    occupier_on(&mut p, "p1");
    step_trade_org_army(&mut p.world, p.terrain.size);
    assert!(order_has(p.r("m1"), json!({ "kind": "attack", "targetId": "p1", "defending": true })));

    // A mercenary on the HQ's hall defends it, so nobody occupies it.
    let m = p.r_mut("m1");
    (m.order, m.x, m.y) = (None, hall.x, hall.y);
    let soldier = soldier_on(&mut p, BuildingKind::Warehouse);
    assert_eq!(p.occupier(), None);
    assert!(p.attackers().is_empty());
    p.defend();
    assert!(!attacking(p.r(&soldier)));
}

#[test]
fn leave_alone_an_unarmed_outsider_on_the_hall_and_an_armed_one_elsewhere_in_the_area() {
    let mut p = post();
    let soldier = soldier_on(&mut p, BuildingKind::Warehouse);
    let hall = p.at(BuildingKind::TownHall);
    outsider(&mut p.world, "p1", hall.x, hall.y);
    let (sx, sy) = (p.r(&soldier).x, p.r(&soldier).y);
    outsider(&mut p.world, "p2", sx + 1.0, sy);
    arm(&mut p.world, "p2", Good::Sword);
    p.defend();
    assert_eq!(p.occupier(), None);
    assert!(!attacking(p.r(&soldier)));
}

#[test]
fn fight_nobody_while_two_realms_share_the_hall_as_nobody_occupies_it() {
    let mut p = post();
    let soldier = soldier_on(&mut p, BuildingKind::Warehouse);
    occupier_on(&mut p, "p1");
    occupier_on(&mut p, "p2");
    p.r_mut("p2").owner = Some("r2".into());
    p.world.realms.push(Realm {
        id: "r2".into(),
        user_id: 8,
        leader_id: "p2".into(),
        name: None,
        demands_sent_at: None,
    });
    p.defend();
    assert_eq!(p.occupier(), None);
    assert!(!attacking(p.r(&soldier)));
}

#[test]
fn fight_nobody_while_one_of_them_stands_on_the_hall_as_nobody_occupies_it() {
    let mut p = post();
    let hall = p.at(BuildingKind::TownHall);
    let on_hall = soldier_on(&mut p, BuildingKind::Warehouse);
    let r = p.r_mut(&on_hall);
    (r.x, r.y) = (hall.x, hall.y);
    let soldier = soldier_on(&mut p, BuildingKind::Warehouse);
    occupier_on(&mut p, "p1");
    p.defend();
    assert!(!attacking(p.r(&soldier)));
    assert!(!attacking(p.r(&on_hall)));
}

#[test]
fn go_after_an_occupier_who_is_down_who_holds_the_hall_all_the_same() {
    let mut p = post();
    let soldier = soldier_on(&mut p, BuildingKind::Warehouse);
    occupier_on(&mut p, "p1");
    let tick = p.world.tick as f64;
    let o = p.r_mut("p1");
    o.health = 0.0;
    o.down_until = Some(tick + TICKS_PER_GAME_DAY);
    assert_eq!(p.occupier().as_deref(), Some("r1"));
    p.defend();
    assert!(order_has(
        p.r(&soldier),
        json!({ "kind": "attack", "targetId": "p1", "defending": true })
    ));
}

#[test]
fn leave_alone_a_mercenary_the_trade_organization_hired_who_occupies_nothing() {
    let mut p = post();
    let soldier = soldier_on(&mut p, BuildingKind::Warehouse);
    occupier_on(&mut p, "p1");
    hired_by_trade_org(&mut p.world, "p1");
    p.defend();
    assert_eq!(p.occupier(), None);
    assert!(!attacking(p.r(&soldier)));
}

#[test]
fn fight_the_trade_org_army_on_the_hall_only_as_an_army_come_to_take_the_city() {
    let mut p = post();
    let soldier = soldier_on(&mut p, BuildingKind::Warehouse);
    let hall = p.at(BuildingKind::TownHall);
    let city = p.city.clone();
    let taker = army_soldier(&mut p.world, "a1", &city, hall.x, hall.y);
    p.world.punishments[0].city_id = city.clone();
    let fought = |p: &mut Place| {
        p.r_mut(&soldier).order = None;
        p.defend();
        attacking(p.r(&soldier))
    };
    assert!(!fought(&mut p));
    p.world.punishments[0].takes = Some(true);
    assert!(!fought(&mut p));
    p.world.debts.push(serde_json::from_value(json!({ "org": city, "coins": 100 })).unwrap());
    assert_eq!(p.occupier().as_deref(), Some(TRADE_ORG));
    assert!(fought(&mut p));
    assert!(order_has(p.r(&soldier), json!({ "targetId": taker, "defending": true })));
    // Paid in full, they occupy nothing any more.
    p.world.debts.clear();
    assert!(!fought(&mut p));
}

#[test]
fn beat_a_lone_occupier_before_the_city_falls_with_no_crime_and_every_invariant_holding() {
    let mut p = village();
    // The Leader stays home, so the fight is over the occupier and the realm goes on after.
    outsider(&mut p.world, "leader", 140.0, 140.0);
    for _ in 0..3 {
        soldier_on(&mut p, BuildingKind::Storage);
    }
    let o = occupier_on(&mut p, "p1");
    let mut runner = Runner::new(&p.terrain);
    let city = p.city.clone();
    for _ in 0..DAY {
        p.run(&mut runner, 1);
        // Each tick: a crime with the occupier as its only witness goes when they die.
        let by_city = p
            .world
            .crimes
            .iter()
            .filter(|c| serde_json::to_value(&c.culprit).unwrap()["org"] == json!(city))
            .count();
        assert_eq!(by_city, 0);
    }
    assert!(!p.world.residents.iter().any(|r| r.id == o));
    assert_eq!(p.city().realm_id, None);
    assert_eq!(p.city().occupation, None);
}

// Trading posts defend themselves

#[test]
#[ignore = "2 game days walked tick by tick: the NPC scripts cost ~70 µs a run to bind and interpret; T86.14 makes it fast"]
fn arm_soldiers_from_the_warehouse_so_one_armed_outsider_does_not_capture_the_post() {
    let mut p = post();
    let hall = p.at(BuildingKind::TownHall);
    outsider(&mut p.world, "p1", hall.x, hall.y);
    arm(&mut p.world, "p1", Good::Sword);
    assert_eq!(p.occupier().as_deref(), Some("r1"));
    p.r_mut("p1").x = 140.0;
    let mut runner = Runner::new(&p.terrain);
    p.run(&mut runner, 2 * DAY);
    let tick = p.world.tick as f64;
    let adults: Vec<usize> = p
        .citizens()
        .into_iter()
        .filter(|&i| can_work(p.world.residents[i].born_at, tick))
        .collect();
    let armed: Vec<usize> =
        adults.iter().copied().filter(|&i| is_armed(&p.world.residents[i].carried)).collect();
    assert_eq!(armed.len() as f64, npc_soldier_target(TRADING_POST.residents));
    let s = &mut p.world.residents[armed[0]];
    (s.x, s.y) = (hall.x, hall.y);
    let o = p.r_mut("p1");
    (o.x, o.y) = (hall.x, hall.y);
    assert_eq!(p.occupier(), None);
    assert_eq!(step_captures(&mut p.world, p.terrain.size, &mut GameAlarms), []);
    assert_eq!(p.citizens().len() as f64, TRADING_POST.residents);
}

fn theft(p: &mut Place, thief: &str) {
    let against = CrimeAgainst {
        victim_org: Some(p.city.clone()),
        goods: Some(Stock::from([(Good::Coins, 5.0)])),
        ..CrimeAgainst::default()
    };
    let kind = serde_json::from_value(json!("theft")).unwrap();
    commit_crime(&mut p.world, p.terrain.size, kind, thief, against);
}

#[test]
fn go_after_a_thief_they_saw_and_commit_no_crime_by_it() {
    let mut p = post();
    let warehouse = p.at(BuildingKind::Warehouse);
    let c = p.citizens();
    let (soldier, bystander) =
        (p.world.residents[c[0]].id.clone(), p.world.residents[c[1]].id.clone());
    for id in [&soldier, &bystander] {
        let r = p.r_mut(id);
        (r.x, r.y) = (warehouse.x, warehouse.y);
    }
    arm(&mut p.world, &soldier, Good::Spear);
    outsider(&mut p.world, "p0", warehouse.x - 1.0, warehouse.y);
    outsider(&mut p.world, "p1", warehouse.x + 1.0, warehouse.y);
    p.defend();
    assert!(!attacking(p.r(&soldier)));
    theft(&mut p, "p1");
    p.defend();
    assert!(order_has(p.r(&soldier), json!({ "kind": "attack", "targetId": "p1" })));
    assert!(!attacking(p.r(&bystander)));
    let mut runner = Runner::new(&p.terrain);
    p.run(&mut runner, DAY / 4);
    assert!(health(&p, "p1") < MAX_HEALTH);
    assert_eq!(p.r("p0").health, MAX_HEALTH);
    assert_eq!(crimes_by(&p.world, &soldier), 0);
}

#[test]
fn leave_a_thief_alone_that_nobody_of_theirs_saw() {
    let mut p = post();
    let warehouse = p.at(BuildingKind::Warehouse);
    let soldier = p.world.residents[p.citizens()[0]].id.clone();
    let s = p.r_mut(&soldier);
    (s.x, s.y, s.order) = (warehouse.x, warehouse.y, None);
    arm(&mut p.world, &soldier, Good::Spear);
    outsider(&mut p.world, "p1", warehouse.x + 1.0, warehouse.y);
    theft(&mut p, "p1");
    p.world.crimes[0].witnesses.clear();
    p.defend();
    assert_eq!(p.r(&soldier).order, None);
}

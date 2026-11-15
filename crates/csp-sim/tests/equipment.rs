//! Equipment (`CONTEXT.md`: Equipment, Soldier; ADR 0038, T107.1): a resident equips the best
//! fitting item at once when they pick it up into an empty slot, a second one stays carried,
//! putting the equipped one down equips the next, and a save from before Equipment equips each
//! resident's best carried gear on its first tick.

mod common;
#[macro_use]
mod goods_support;

use csp_shared::balance::{BLOW_BASE, BLOW_PER_STRENGTH, WEAPON_ATTACK};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Equipment, Good, StatName, WorldState};
use csp_sim::goods_deps::OrderSender;
use csp_sim::invariants::{check_invariants, world_invariants};
use csp_sim::queries::combat::{attack_power, protection};
use csp_sim::queries::names::held;
use csp_sim::queries::residents::{is_armed, stat_value};
use csp_sim::tick::Scratch;
use goods_support::{building, new_resident, open, player, realm, step_walking, stock, Queue};
use serde_json::{json, Value};

const SIZE: i32 = 16;

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    scratch: Scratch,
    me: OrderSender,
}

/// Realm r1 (Player 7) with city c1: resident w1 at (5, 5) with some Food, storage s1 at (1, 1)
/// holding Swords, Spears, a steel Sword, Shields and Armour.
fn setup() -> Setup {
    let terrain = open(SIZE);
    let mut world = goods_support::world_on(&terrain);
    world.realms.push(realm("r1", 7, "w1"));
    world.cities.push(
        serde_json::from_value(json!({
            "id": "c1", "name": "Ashford", "realmId": "r1", "townHallId": "h1", "occupation": null,
        }))
        .unwrap(),
    );
    let mut r = new_resident(1.0, "w1", Some("r1"), 5.0, 5.0);
    r.carried = stock(json!({ "food": 1 }));
    world.residents.push(r);
    let s =
        json!({ "food": 50, "sword": 3, "spear": 3, "steelSword": 1, "shield": 2, "armour": 1 });
    world.buildings.push(building(
        json!({ "id": "s1", "kind": "storage", "cityId": "c1", "x": 1, "y": 1, "stock": s }),
    ));
    Setup { world, terrain, scratch: Scratch::default(), me: player(7) }
}

impl Setup {
    fn r(&self) -> &csp_shared::world::Resident {
        &self.world.residents[0]
    }
    /// Sends an order as w1, then runs ticks until it is over, checking every invariant.
    fn run(&mut self, o: Value) {
        let mut o = o;
        o["residentId"] = json!("w1");
        let mut q = Queue::new(&self.terrain);
        q.receive(&self.world, &self.me, o).expect("the order is taken");
        q.apply_all(&mut self.world);
        for _ in 0..400 {
            if self.r().order.is_none() {
                break;
            }
            step_walking(&mut self.world, &self.terrain, &mut self.scratch);
            assert_eq!(
                check_invariants(&self.world, &self.terrain, &equipment_invariants()),
                vec![]
            );
        }
        assert!(self.r().order.is_none(), "the order ended");
    }
    fn fetch(&mut self, goods: Value) {
        self.run(json!({ "kind": "fetch", "goods": goods, "from": "s1" }));
    }
}

fn fist(s: &Setup) -> f64 {
    BLOW_BASE + BLOW_PER_STRENGTH * stat_value(s.r(), StatName::Strength, s.world.tick as f64)
}

#[test]
fn picking_up_a_sword_with_an_empty_weapon_slot_equips_it_and_a_second_stays_carried() {
    let mut s = setup();
    assert!(!is_armed(s.r()));
    s.fetch(json!({ "sword": 1 }));
    assert_eq!(s.r().equipped.weapon, Some(Good::Sword));
    assert!(is_armed(s.r()));
    s.fetch(json!({ "sword": 1, "steelSword": 1 }));
    // The slot was full: the better steel Sword and the second Sword are carried, not equipped.
    assert_eq!(s.r().equipped.weapon, Some(Good::Sword));
    assert_eq!(held(&s.r().carried, Good::Sword), 2.0);
    assert_eq!(held(&s.r().carried, Good::SteelSword), 1.0);
    let sword = WEAPON_ATTACK.get("sword").unwrap();
    assert!((attack_power(s.r(), s.world.tick as f64) - (fist(&s) + sword)).abs() < 1e-9);
}

#[test]
fn storing_the_equipped_weapon_equips_the_next_best_carried() {
    let mut s = setup();
    s.fetch(json!({ "spear": 1 }));
    s.fetch(json!({ "sword": 1, "steelSword": 1 }));
    assert_eq!(s.r().equipped.weapon, Some(Good::Spear));
    s.run(json!({ "kind": "store", "goods": ["spear"], "to": "s1" }));
    assert_eq!(s.r().equipped.weapon, Some(Good::SteelSword), "the best of what is left");
    s.run(json!({ "kind": "store", "goods": ["steelSword", "sword"], "to": "s1" }));
    assert_eq!(s.r().equipped.weapon, None);
    assert!(!is_armed(s.r()));
}

#[test]
fn a_shield_and_armour_picked_up_fill_their_slots_and_only_those_protect() {
    let mut s = setup();
    s.fetch(json!({ "shield": 2, "armour": 1 }));
    assert_eq!(
        s.r().equipped,
        Equipment {
            weapon: None,
            shield: Some(Good::Shield),
            armour: Some(Good::Armour),
            ..Equipment::default()
        }
    );
    assert!(!is_armed(s.r()), "a shield is no weapon");
    let one_of_each = protection(s.r());
    s.run(json!({ "kind": "store", "goods": { "armour": 1 }, "to": "s1" }));
    assert_eq!(s.r().equipped.armour, None);
    assert_eq!(s.r().equipped.shield, Some(Good::Shield), "the spare shield changes nothing");
    assert!(protection(s.r()) < one_of_each);
}

#[test]
fn a_save_from_before_equipment_equips_each_residents_best_carried_gear_on_its_first_tick() {
    let mut s = setup();
    // A resident as a save from before Equipment holds them: gear carried, no `equipped`.
    let mut saved = serde_json::to_value(&s.world.residents[0]).unwrap();
    saved["carried"] = json!({ "food": 1, "spear": 1, "steelSword": 1, "shield": 1,
        "steelShield": 1, "armour": 2 });
    assert!(saved.get("equipped").is_none());
    s.world.residents[0] = serde_json::from_value(saved).expect("an old save still reads");
    assert!(is_armed(s.r()), "an empty slot counts the best fitting item at once");
    step_walking(&mut s.world, &s.terrain, &mut s.scratch);
    assert_eq!(
        s.r().equipped,
        Equipment {
            weapon: Some(Good::SteelSword),
            shield: Some(Good::SteelShield),
            armour: Some(Good::Armour),
            ..Equipment::default()
        }
    );
    assert_eq!(check_invariants(&s.world, &s.terrain, &equipment_invariants()), vec![]);
}

#[test]
fn the_invariant_catches_gear_equipped_but_not_carried_or_in_the_wrong_slot() {
    let mut s = setup();
    let names = |s: &Setup| -> Vec<String> {
        check_invariants(&s.world, &s.terrain, &equipment_invariants())
            .into_iter()
            .map(|v| v.invariant)
            .collect()
    };
    s.world.residents[0].equipped.weapon = Some(Good::Sword);
    assert_eq!(names(&s), ["equipment-sound"], "a Sword equipped but not carried");
    s.world.residents[0].carried.insert(Good::Shield, 1.0);
    s.world.residents[0].equipped.weapon = Some(Good::Shield);
    assert_eq!(names(&s), ["equipment-sound"], "a Shield in the weapon slot");
}

/// The invariants of goods carried and equipped: the setup is no whole city.
fn equipment_invariants() -> Vec<csp_sim::invariants::Invariant> {
    let names = ["equipment-sound", "carried-within-capacity", "goods-in-place"];
    world_invariants().into_iter().filter(|i| names.contains(&i.name)).collect()
}

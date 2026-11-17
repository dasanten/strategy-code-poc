//! NPC cities hunting thieves (`CONTEXT.md`: Acting first).

use csp_shared::balance::{NPC_HUNTERS_PER_THIEF, NPC_HUNT_REACH, NPC_TOWN};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BuildingKind, CrimeKind, Good, Realm, Resident, ResidentOrder, Stock, WorldState,
};

use super::{hunters, step_npc_hunts};
use crate::crimes::{commit_crime, CrimeAgainst};
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::npc_plan::plan_city;
use crate::npc_posts::{free_soldiers, posts_to_hold};
use crate::npc_test_world::Runner;
use crate::queries::names::held;
use crate::queries::residents::can_work;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::world::create_world;

const DAY: usize = TICKS_PER_GAME_DAY as usize;

struct Place {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
}

impl Place {
    /// A town alone on a Plains map big enough to leave its reach, planned once, with `soldiers`
    /// of its adults armed with a Spear.
    fn town(soldiers: usize) -> Place {
        let terrain = plains(400);
        let mut world = create_world(&terrain, 1);
        let mut m = Mulberry32::new(7.0);
        let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 20, 20, &mut || m.next(), None);
        plan_city(&mut world, &city, Some(&terrain), None, None);
        let mut p = Place { world, terrain, city };
        for i in p.adults().into_iter().take(soldiers) {
            let r = &mut p.world.residents[i];
            r.carried.insert(Good::Spear, 1.0);
            (r.order, r.script) = (None, None);
        }
        crate::equipment::settle_all(&mut p.world);
        p
    }

    fn adults(&self) -> Vec<usize> {
        let tick = self.world.tick as f64;
        (0..self.world.residents.len())
            .filter(|&i| {
                let r = &self.world.residents[i];
                r.owner.is_none()
                    && r.city_id.as_deref() == Some(self.city.as_str())
                    && can_work(r.born_at, tick)
            })
            .collect()
    }

    fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the city")
    }

    fn storage(&self) -> csp_shared::world::Building {
        self.world
            .buildings
            .iter()
            .find(|b| {
                b.city_id.as_deref() == Some(self.city.as_str()) && b.kind == BuildingKind::Storage
            })
            .cloned()
            .expect("a storage")
    }

    fn r(&self, id: &str) -> Option<&Resident> {
        self.world.residents.iter().find(|r| r.id == id)
    }

    fn r_mut(&mut self, id: &str) -> &mut Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).expect("the resident")
    }

    /// Its free soldiers by id, as its posts rank them.
    fn soldiers(&self) -> Vec<String> {
        let mut ids: Vec<String> = free_soldiers(&self.world, self.city(), &self.adults())
            .into_iter()
            .map(|i| self.world.residents[i].id.clone())
            .collect();
        ids.sort();
        ids
    }

    fn hunt(&mut self) {
        step_npc_hunts(&mut self.world, self.terrain.size);
    }

    fn hunters(&self) -> Vec<String> {
        let mut h: Vec<String> = hunters(&self.world, &self.city).into_iter().collect();
        h.sort();
        h
    }

    /// A grown resident of realm r1 at (x, y), carrying `goods`, who stole them from the city in
    /// sight of `witness` (one of its own) or of nobody.
    fn thief(&mut self, id: &str, at: (f64, f64), goods: Stock, witness: Option<&str>) {
        let mut m = Mulberry32::new(3.0);
        let fields = NewResident {
            id,
            owner: Some("r1"),
            city_id: None,
            x: at.0,
            y: at.1,
            tick: self.world.tick as f64,
        };
        let mut r = new_resident(&mut || m.next(), &fields, None);
        r.born_at = self.world.tick as f64 - 20.0 * 24.0 * 3600.0;
        r.lifespan = 60.0;
        r.carried = goods.clone();
        self.world.residents.push(r);
        if !self.world.realms.iter().any(|x| x.id == "r1") {
            self.world.realms.push(Realm {
                id: "r1".into(),
                user_id: 7,
                leader_id: id.into(),
                name: None,
                demands_sent_at: None,
                heir_id: None,
                founded_at: None,
            });
        }
        let against = CrimeAgainst {
            victim_org: Some(self.city.clone()),
            goods: Some(goods),
            ..CrimeAgainst::default()
        };
        commit_crime(&mut self.world, self.terrain.size, CrimeKind::Theft, id, against);
        let crime = self.world.crimes.last_mut().expect("the theft");
        crime.witnesses = witness.into_iter().map(str::to_string).collect();
    }
}

fn attacking(r: &Resident, target: &str) -> bool {
    matches!(&r.order, Some(ResidentOrder::Attack(o)) if o.target_id == target)
}

#[test]
fn sends_soldiers_beyond_its_hall_and_gate_posts_after_a_thief_it_saw() {
    let mut p = Place::town(8);
    let held_posts = posts_to_hold(&p.world, p.city()) as usize;
    let soldiers = p.soldiers();
    assert!(soldiers.len() >= held_posts + NPC_HUNTERS_PER_THIEF as usize, "{soldiers:?}");
    let s = p.storage();
    p.thief("t1", (s.x + 6.0, s.y), Stock::from([(Good::Coins, 5.0)]), Some(&soldiers[0]));
    p.hunt();
    let hunting = p.hunters();
    assert_eq!(hunting.len(), NPC_HUNTERS_PER_THIEF as usize);
    // The last by id go, who stand on its wall; the hall and gate posts stay manned.
    let last: Vec<String> = soldiers.iter().rev().take(hunting.len()).rev().cloned().collect();
    assert_eq!(hunting, last);
    for id in &soldiers[..held_posts] {
        assert!(!hunting.contains(id));
    }
    for id in &hunting {
        assert!(attacking(p.r(id).unwrap(), "t1"));
    }
    // Hunting soldiers stand no post meanwhile.
    assert!(p.soldiers().iter().all(|id| !hunting.contains(id)));
    // Stepped again, no more go after the same thief.
    p.hunt();
    assert_eq!(p.hunters(), hunting);
    assert_eq!(checked(&p), []);
}

#[test]
fn sends_nobody_when_only_its_posts_are_manned() {
    let mut p = Place::town(1);
    let soldiers = p.soldiers();
    assert!(soldiers.len() as f64 <= posts_to_hold(&p.world, p.city()));
    let s = p.storage();
    p.thief("t1", (s.x + 6.0, s.y), Stock::from([(Good::Coins, 5.0)]), Some(&soldiers[0]));
    p.hunt();
    assert!(p.hunters().is_empty());
}

#[test]
fn leaves_a_thief_nobody_of_its_own_saw() {
    let mut p = Place::town(8);
    let s = p.storage();
    p.thief("t1", (s.x + 6.0, s.y), Stock::from([(Good::Coins, 5.0)]), None);
    p.hunt();
    assert!(p.hunters().is_empty());
}

#[test]
fn lets_a_thief_out_of_reach_go() {
    let mut p = Place::town(8);
    let soldiers = p.soldiers();
    let s = p.storage();
    let far = (s.x + NPC_HUNT_REACH + 5.0, s.y);
    p.thief("t1", far, Stock::from([(Good::Coins, 5.0)]), Some(&soldiers[0]));
    p.hunt();
    assert!(p.hunters().is_empty());
    // One who runs out of reach with soldiers after them is let go too.
    p.r_mut("t1").x = s.x + 6.0;
    p.hunt();
    let hunting = p.hunters();
    assert_eq!(hunting.len(), NPC_HUNTERS_PER_THIEF as usize);
    p.r_mut("t1").x = far.0;
    p.hunt();
    assert!(p.hunters().is_empty());
    for id in &hunting {
        assert!(!attacking(p.r(id).unwrap(), "t1"));
    }
    assert_eq!(checked(&p), []);
}

#[test]
fn strikes_the_thief_down_and_brings_the_goods_home_with_no_crime() {
    let mut p = Place::town(8);
    let soldiers = p.soldiers();
    let s = p.storage();
    let before = held(s.stock.as_ref().unwrap_or(&Stock::new()), Good::Coins);
    p.thief("t1", (s.x + 40.0, s.y + 3.0), Stock::from([(Good::Coins, 5.0)]), Some(&soldiers[0]));
    assert!(!crate::queries::city::in_city_area(
        &p.world,
        &p.city,
        s.x as i32 + 40,
        s.y as i32 + 3,
        p.terrain.size
    ));
    let mut runner = Runner::new(&p.terrain);
    let mut sent = Vec::new();
    for _ in 0..DAY * 2 {
        runner.step(&mut p.world, &p.terrain);
        if sent.is_empty() {
            sent = p.hunters();
        }
        if !sent.is_empty() && p.hunters().is_empty() {
            break;
        }
    }
    assert!(!sent.is_empty(), "nobody went after the thief");
    assert!(p.r("t1").is_none(), "the thief lives");
    assert!(p.hunters().is_empty(), "still out: {:?}", p.world.city_plans[&p.city].hunts);
    let after = held(p.storage().stock.as_ref().unwrap_or(&Stock::new()), Good::Coins);
    assert!(after >= before + 5.0, "{before} -> {after}");
    assert!(p.world.piles.iter().all(|x| held(&x.goods, Good::Coins) == 0.0), "coins left lying");
    let crimes: Vec<_> =
        p.world.crimes.iter().filter(|c| sent.contains(&c.culprit.resident_id)).collect();
    assert!(crimes.is_empty(), "{crimes:?}");
    assert_eq!(checked(&p), []);
}

/// The invariants on a place, but `npc-soldiers-stand-down`: `Place::town` arms more of its adults
/// than the town keeps, which its next planning pass would stand down (`CONTEXT.md`: Soldiers in
/// peace), and the hunts here step without one.
fn checked(p: &Place) -> Vec<crate::sight::InvariantViolation> {
    check_all(&p.world, &p.terrain)
        .into_iter()
        .filter(|v| v.invariant != "npc-soldiers-stand-down")
        .collect()
}

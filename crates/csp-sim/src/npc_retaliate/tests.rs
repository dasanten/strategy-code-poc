//! Retaliating (T98.8, `CONTEXT.md`: Retaliating).

use csp_shared::balance::{NPC_RETALIATE, NPC_TOWN};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Good, Stance, WorldState};
use serde_json::json;

use super::*;
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::npc_plan::plan_city;
use crate::queries::city_area::occupier_of;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::standing::change_standing;
use crate::test_world::{add_city, realm, resident};
use crate::world::create_world;

struct Place {
    world: WorldState,
    terrain: TerrainMap,
    n1: String,
}

/// The NPC town n1 at (40, 40), planned once, with 14 of its adults armed with a Spear; realm r1
/// (Leader a1 far off, unarmed) with its city c1 at (120, 40), nobody defending it.
fn place() -> Place {
    let terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let n1 = found_npc_city(&mut world, &terrain, &NPC_TOWN, 40, 40, &mut || m.next(), None);
    plan_city(&mut world, &n1, Some(&terrain), None, None);
    let tick = world.tick as f64;
    let adults: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            r.city_id.as_deref() == Some(n1.as_str())
                && crate::queries::residents::can_work(r.born_at, tick)
        })
        .take(14)
        .collect();
    for i in adults {
        let r = &mut world.residents[i];
        r.carried.insert(Good::Spear, 1.0);
        (r.order, r.script) = (None, None);
    }
    crate::equipment::settle_all(&mut world);
    realm(&mut world, "r1", 7, "a1");
    resident(&mut world, "a1", Some("r1"), 300.0, 300.0);
    add_city(&mut world, "c1", Some("r1"), 120.0, 40.0, None);
    Place { world, terrain, n1 }
}

impl Place {
    fn city(&self) -> &City {
        self.world.cities.iter().find(|c| c.id == self.n1).expect("n1")
    }

    fn city_mut(&mut self) -> &mut City {
        let id = self.n1.clone();
        self.world.cities.iter_mut().find(|c| c.id == id).expect("n1")
    }

    fn threatened(&mut self, threat: f64) {
        self.city_mut().threats = Some([("r1".to_string(), threat)].into_iter().collect());
    }

    /// r1's Leader killed one of n1's people, and n1 knows.
    fn killed(&mut self) {
        let crime = json!({
            "id": "k1", "kind": "killing", "tick": self.world.tick as f64, "x": 80.0, "y": 40.0,
            "culprit": { "residentId": "a1", "name": "A", "org": "r1", "orgName": "R" },
            "victimOrg": self.n1, "witnesses": [], "knownBy": [self.n1],
        });
        self.world.crimes.push(serde_json::from_value(crime).unwrap());
    }

    /// Steps the clock to n1's first planning pass of the next game day, where it picks its stance
    /// and retaliates.
    fn next_day(&mut self) {
        let day = (self.world.tick as f64 / TICKS_PER_GAME_DAY).floor();
        loop {
            self.world.tick += 1;
            if (self.world.tick as f64 / TICKS_PER_GAME_DAY).floor() > day
                && crate::npc_stance::first_pass_of_day(&self.world, &self.n1)
            {
                break;
            }
        }
        self.step();
    }

    /// Steps the clock to n1's next planning pass.
    fn next_pass(&mut self) {
        loop {
            self.world.tick += 1;
            if plan_due(&self.world, &self.n1) {
                break;
            }
        }
        self.step();
    }

    fn step(&mut self) {
        crate::npc_stance::step_stances(&mut self.world, self.terrain.size);
        step_npc_retaliate(&mut self.world, self.terrain.size);
    }

    /// n1 in Retaliate against r1, as fierce as a march wants.
    fn furious(&mut self) {
        self.threatened(NPC_RETALIATE.march_threat);
        self.killed();
        let n1 = self.n1.clone();
        change_standing(&mut self.world, &n1, "r1", NPC_RETALIATE.march_standing);
        self.next_day();
        assert_eq!(self.city().stance, Some(Stance::Retaliate));
    }

    fn c1(&self) -> &City {
        self.world.cities.iter().find(|c| c.id == "c1").unwrap()
    }

    /// The invariants that fail, but `trained-within-cap`: `test_world::resident` gives Agility 0.
    fn checked(&self) -> Vec<String> {
        check_all(&self.world, &self.terrain)
            .into_iter()
            .map(|v| v.invariant)
            .filter(|v| v != "trained-within-cap")
            .collect()
    }
}

#[test]
fn a_city_whose_people_keep_being_killed_turns_to_retaliate() {
    let mut p = place();
    p.threatened(NPC_RETALIATE.threat);
    // Threat alone: it fortifies.
    p.next_day();
    assert_eq!(p.city().stance, Some(Stance::Fortify));
    // Knowing r1 killed its people, it turns on them.
    p.killed();
    p.next_day();
    assert_eq!(p.city().stance, Some(Stance::Retaliate));
    assert_eq!(p.city().retaliating.as_deref(), Some("r1"));
    assert!(crate::npc_stance::arming(p.city()));
    assert_eq!(crate::npc_stance::mood(Stance::Retaliate), "retaliating");
    assert!(!p.checked().contains(&"stances-sound".to_string()));
}

#[test]
fn a_far_stronger_one_marches_on_the_attackers_weak_city_and_occupies_its_town_hall() {
    let mut p = place();
    p.furious();
    let n1 = p.n1.clone();
    let m = p.world.city_plans[&n1].march.clone().expect("a march");
    assert_eq!(m.city_id, "c1");
    assert!(!m.resident_ids.is_empty());
    // Its hall and gate posts stay manned.
    let held = crate::npc_posts::posts_to_hold(&p.world, p.city()) as usize;
    let tick = p.world.tick as f64;
    let adults: Vec<usize> = (0..p.world.residents.len())
        .filter(|&i| {
            p.world.residents[i].city_id.as_deref() == Some(n1.as_str())
                && crate::queries::residents::can_work(p.world.residents[i].born_at, tick)
        })
        .collect();
    assert!(free_soldiers(&p.world, p.city(), &adults).len() >= held);
    // They walk to c1's town hall; there they hold it for n1.
    let hall = town_hall_of(&p.world, p.c1()).unwrap().clone();
    for id in &m.resident_ids {
        let r = p.world.residents.iter().find(|r| &r.id == id).unwrap();
        assert!(matches!(&r.order, Some(ResidentOrder::WalkTo(w))
            if w.target.x == hall.x && w.target.y == hall.y));
    }
    for id in &m.resident_ids {
        let r = p.world.residents.iter_mut().find(|r| &r.id == id).unwrap();
        (r.x, r.y, r.order) = (hall.x, hall.y, None);
    }
    assert_eq!(occupier_of(&p.world, p.c1(), p.terrain.size).as_deref(), Some(n1.as_str()));
    crate::capture::step_captures(
        &mut p.world,
        p.terrain.size,
        Some(&p.terrain),
        &mut crate::defence::NoAlarms,
    );
    assert_eq!(p.c1().occupation.as_ref().map(|o| o.realm_id.as_str()), Some(n1.as_str()));
    assert!(p.checked().iter().all(|v| v != "marches-sound" && v != "stances-sound"));
}

#[test]
fn losses_turn_it_back_to_fortify_and_call_the_march_off() {
    let mut p = place();
    p.furious();
    let n1 = p.n1.clone();
    let m = p.world.city_plans[&n1].march.clone().expect("a march");
    // r1 grows far stronger than what n1 has left.
    for k in 0..40 {
        let i = resident(&mut p.world, &format!("s{k}"), Some("r1"), 300.0, 300.0);
        p.world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    crate::equipment::settle_all(&mut p.world);
    p.next_pass();
    assert_eq!(p.city().stance, Some(Stance::Fortify));
    assert_eq!(p.city().retaliating, None);
    assert!(p.world.city_plans[&n1].march.is_none());
    // Its soldiers walk home.
    let home = town_hall_of(&p.world, p.city()).unwrap().clone();
    let r = p.world.residents.iter().find(|r| r.id == m.resident_ids[0]).unwrap();
    assert!(matches!(&r.order, Some(ResidentOrder::WalkTo(w))
        if w.target.x == home.x && w.target.y == home.y));
}

#[test]
fn a_paid_demand_ends_it() {
    let mut p = place();
    p.furious();
    let n1 = p.n1.clone();
    crate::demands::send_npc_demand(&mut p.world, &n1, "r1");
    let d = p.world.demands.iter().find(|d| d.from_id == n1).cloned().expect("a demand");
    crate::npc_demands::npc_demand_ended(&mut p.world, &d, true);
    p.next_pass();
    assert_eq!(p.city().stance, Some(Stance::Fortify));
    assert!(p.world.city_plans[&n1].march.is_none());
}

#[test]
fn marches_on_nobody_in_their_shelter_nor_on_a_city_it_cant_outweigh() {
    let mut p = place();
    p.world.realms[0].founded_at = Some(p.world.tick as f64);
    p.furious();
    assert!(p.world.city_plans[&p.n1].march.is_none());
    let mut p = place();
    for k in 0..30 {
        let i = resident(&mut p.world, &format!("d{k}"), Some("r1"), 121.0, 41.0);
        p.world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    crate::equipment::settle_all(&mut p.world);
    let city = p.city().clone();
    p.threatened(NPC_RETALIATE.march_threat);
    let n1 = p.n1.clone();
    change_standing(&mut p.world, &n1, "r1", NPC_RETALIATE.march_standing);
    assert!(would_march(&p.world, &city, "r1", p.terrain.size).is_none());
}

#[test]
fn held_to_the_end_the_city_leaves_the_realm_and_the_march_goes_home() {
    let mut p = place();
    p.furious();
    let n1 = p.n1.clone();
    let m = p.world.city_plans[&n1].march.clone().expect("a march");
    let hall = town_hall_of(&p.world, p.c1()).unwrap().clone();
    for id in &m.resident_ids {
        let r = p.world.residents.iter_mut().find(|r| &r.id == id).unwrap();
        (r.x, r.y, r.order) = (hall.x, hall.y, None);
    }
    let mut alarms = crate::defence::NoAlarms;
    let size = p.terrain.size;
    crate::capture::step_captures(&mut p.world, size, Some(&p.terrain), &mut alarms);
    let since = p.world.tick as f64 - crate::queries::city_area::OCCUPATION_TICKS;
    p.world.cities.iter_mut().find(|c| c.id == "c1").unwrap().occupation.as_mut().unwrap().since =
        since;
    crate::capture::step_captures(&mut p.world, size, Some(&p.terrain), &mut alarms);
    assert_eq!(p.c1().realm_id, None);
    // c1 is an NPC city of its own now; n1's march is over.
    p.next_pass();
    assert!(p.world.city_plans[&n1].march.is_none());
    assert_eq!(p.checked(), Vec::<String>::new());
}

//! NPC demands and the new realm's shelter (`CONTEXT.md`: NPC demand, New realm's shelter).

use csp_shared::balance::{
    NEW_REALM_SHELTER_DAYS, NPC_DEMAND_AGAIN_DAYS, NPC_DEMAND_COINS, NPC_DEMAND_DAYS, NPC_TOWN,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{DemandTerms, Good, Realm, Temperament, WorldState};

use super::{npc_demands_sound, org_strength, sheltered, step_npc_demands};
use crate::demands::demands_sound;
use crate::npc_cities::found_npc_city;
use crate::npc_plan::plan_city;
use crate::queries::persuasion::city_strength;
use crate::queries::residents::can_work;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::world::create_world;

const DAY: u64 = TICKS_PER_GAME_DAY as u64;

struct Place {
    world: WorldState,
    city: String,
}

impl Place {
    /// A town of `temperament` with eight of its adults armed with a Spear, which holds a threat
    /// from realm r1, whose Leader stands far off, unarmed.
    fn town(temperament: Temperament) -> Place {
        let terrain = plains(200);
        let mut world = create_world(&terrain, 1);
        let mut m = Mulberry32::new(7.0);
        let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 20, 20, &mut || m.next(), None);
        plan_city(&mut world, &city, Some(&terrain), None, None);
        let tick = world.tick as f64;
        let adults: Vec<usize> = (0..world.residents.len())
            .filter(|&i| {
                let r = &world.residents[i];
                r.city_id.as_deref() == Some(city.as_str()) && can_work(r.born_at, tick)
            })
            .collect();
        for &i in adults.iter().take(8) {
            world.residents[i].carried.insert(Good::Spear, 1.0);
        }
        crate::equipment::settle_all(&mut world);
        let c = world.cities.iter_mut().find(|c| c.id == city).expect("the town");
        c.temperament = Some(temperament);
        c.threats = Some([("r1".to_string(), 5.0)].into_iter().collect());
        let mut p = Place { world, city };
        p.realm("r1", None);
        p
    }

    /// Realm `id` with a Leader at (150, 150), founded at `founded_at`.
    fn realm(&mut self, id: &str, founded_at: Option<f64>) {
        let leader = format!("{id}-leader");
        self.armed(id, &leader, None);
        self.world.realms.push(Realm {
            id: id.into(),
            user_id: 7,
            leader_id: leader,
            name: None,
            demands_sent_at: None,
            heir_id: None,
            founded_at,
        });
    }

    /// A grown resident `id` of `owner` at (150, 150), carrying `weapon`.
    fn armed(&mut self, owner: &str, id: &str, weapon: Option<Good>) {
        let mut m = Mulberry32::new(self.world.residents.len() as f64 + 3.0);
        let tick = self.world.tick as f64;
        let fields =
            NewResident { id, owner: Some(owner), city_id: None, x: 150.0, y: 150.0, tick };
        let mut r = new_resident(&mut || m.next(), &fields, None);
        r.born_at = tick - 20.0 * 24.0 * 3600.0;
        r.lifespan = 60.0;
        r.carried = weapon.into_iter().map(|g| (g, 1.0)).collect();
        self.world.residents.push(r);
        crate::equipment::settle_all(&mut self.world);
    }

    /// Runs a game day of demands alone, a tick at a time.
    fn day(&mut self) {
        for _ in 0..DAY {
            self.world.tick += 1;
            step_npc_demands(&mut self.world);
        }
    }

    fn sent_to(&self, org: &str) -> usize {
        self.world.demands.iter().filter(|d| d.from_id == self.city && d.to_id == org).count()
    }

    fn sound(&self) {
        assert_eq!(npc_demands_sound(&self.world), vec![]);
        assert_eq!(demands_sound(&self.world), vec![]);
    }
}

#[test]
fn a_militarist_city_far_stronger_than_a_realm_it_knows_demands_coins_of_it() {
    let mut p = Place::town(Temperament::Militarist);
    let own = city_strength(&p.world, p.world.cities.iter().find(|c| c.id == p.city).unwrap());
    assert!(own >= 25.0, "the town's side is {own}");
    p.day();
    assert_eq!(p.sent_to("r1"), 1);
    let d = p.world.demands.iter().find(|d| d.from_id == p.city).unwrap();
    let coins = [(Good::Coins, NPC_DEMAND_COINS)].into_iter().collect();
    assert_eq!(d.terms, DemandTerms::Goods { goods: coins });
    assert_eq!(d.deadline, d.sent_at + NPC_DEMAND_DAYS * TICKS_PER_GAME_DAY);
    let at = p.world.city_plans[&p.city].demanded.as_ref().unwrap()["r1"];
    assert_eq!(at, d.sent_at);
    p.sound();
}

#[test]
fn it_sends_the_next_only_after_a_while() {
    let mut p = Place::town(Temperament::Militarist);
    p.day();
    p.world.demands.clear();
    p.day();
    assert_eq!(p.sent_to("r1"), 0);
    p.world.tick += (NPC_DEMAND_AGAIN_DAYS as u64) * DAY;
    p.day();
    assert_eq!(p.sent_to("r1"), 1);
}

#[test]
fn a_city_of_another_temperament_demands_nothing() {
    for t in [Temperament::Merchant, Temperament::Settler] {
        let mut p = Place::town(t);
        p.day();
        assert!(p.world.demands.is_empty(), "{t:?}");
    }
}

#[test]
fn a_realm_it_does_not_far_outweigh_gets_none() {
    let mut p = Place::town(Temperament::Militarist);
    for i in 0..12 {
        p.armed("r1", &format!("r1-sword{i}"), Some(Good::Sword));
    }
    let own = city_strength(&p.world, p.world.cities.iter().find(|c| c.id == p.city).unwrap());
    assert!(own < 4.0 * org_strength(&p.world, "r1"));
    p.day();
    assert_eq!(p.sent_to("r1"), 0);
}

#[test]
fn a_realm_it_knows_nothing_of_gets_none() {
    let mut p = Place::town(Temperament::Militarist);
    p.realm("r2", None);
    p.day();
    assert_eq!(p.sent_to("r1"), 1);
    assert_eq!(p.sent_to("r2"), 0);
}

#[test]
fn a_realm_in_its_first_game_weeks_gets_none_until_its_shelter_ends() {
    let mut p = Place::town(Temperament::Militarist);
    p.world.realms.retain(|r| r.id != "r1");
    let now = p.world.tick as f64;
    p.realm("r1", Some(now));
    assert!(sheltered(&p.world, "r1"));
    p.day();
    assert_eq!(p.sent_to("r1"), 0);
    p.world.tick = (now + NEW_REALM_SHELTER_DAYS * TICKS_PER_GAME_DAY) as u64;
    assert!(!sheltered(&p.world, "r1"));
    p.day();
    assert_eq!(p.sent_to("r1"), 1);
    p.sound();
}

#[test]
fn npc_demands_sound_catches_one_sent_in_a_shelter_or_to_no_realm() {
    let mut p = Place::town(Temperament::Militarist);
    p.day();
    p.world.realms.iter_mut().find(|r| r.id == "r1").unwrap().founded_at =
        Some(p.world.demands[0].sent_at);
    let found = npc_demands_sound(&p.world);
    assert!(found.iter().any(|v| v.message.contains("in its shelter")), "{found:?}");
    p.world.demands[0].to_id = "nobody".into();
    let found = npc_demands_sound(&p.world);
    assert!(found.iter().any(|v| v.message.contains("no realm")), "{found:?}");
}

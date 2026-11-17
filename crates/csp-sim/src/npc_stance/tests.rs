//! Stances (T98.4, `CONTEXT.md`: Stance).

use csp_shared::balance::{NPC_PLAN_TICKS, NPC_STANCE, NPC_TOWN};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Good, Stance, Temperament, TradeOrgCity, WorldState};

use super::*;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::plains;
use crate::queries::npc_trade::{npc_city_soldier_target, npc_reserve, npc_soldier_target};
use crate::random::Mulberry32;
use crate::trading_posts::found_trading_post;
use crate::world::create_world;

struct Place {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
}

impl Place {
    /// A town of `temperament` at (40, 40) whose storage holds twice its reserve of everything and
    /// Food to spare, so nothing is short and it has a Food surplus; with a trading post 50 tiles
    /// east when `post`.
    fn town(temperament: Temperament, post: bool) -> Place {
        let terrain = plains(400);
        let mut world = create_world(&terrain, 1);
        let mut m = Mulberry32::new(7.0);
        let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 40, 40, &mut || m.next(), None);
        if post {
            let home = npc_home(&world, &city).expect("a storage").clone();
            found_trading_post(&mut world, &terrain, home.x as i32 + 50, 40, None, &mut || {
                m.next()
            });
        }
        let mut p = Place { world, terrain, city };
        p.city_mut().temperament = Some(temperament);
        let s = p.storage();
        let mut stock = npc_reserve(&p.world, p.city());
        for n in stock.values_mut() {
            *n *= 2.0;
        }
        *stock.entry(Good::Food).or_insert(0.0) += 2000.0;
        p.world.buildings[s].stock = Some(stock);
        p
    }

    fn storage(&self) -> usize {
        let home = npc_home(&self.world, &self.city).expect("a storage").id.clone();
        self.world.buildings.iter().position(|b| b.id == home).unwrap()
    }

    fn city(&self) -> &City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the city")
    }

    fn city_mut(&mut self) -> &mut City {
        let id = self.city.clone();
        self.world.cities.iter_mut().find(|c| c.id == id).expect("the city")
    }

    fn pick(&self) -> Stance {
        pick_stance(&self.world, self.city(), self.terrain.size)
    }

    /// Steps the world's clock to the city's first planning pass of the next game day and steps
    /// stances there.
    fn next_day(&mut self) {
        let day = (self.world.tick as f64 / TICKS_PER_GAME_DAY).floor();
        loop {
            self.world.tick += 1;
            if (self.world.tick as f64 / TICKS_PER_GAME_DAY).floor() > day
                && first_pass_of_day(&self.world, &self.city)
            {
                break;
            }
        }
        step_stances(&mut self.world, self.terrain.size);
    }

    fn threatened(&mut self, threat: f64) {
        self.city_mut().threats = Some([("r1".to_string(), threat)].into_iter().collect());
    }
}

#[test]
fn a_threatened_city_turns_to_fortify_and_keeps_more_soldiers() {
    let mut p = Place::town(Temperament::Merchant, false);
    p.city_mut().threats = None;
    let adults = 20.0;
    assert_eq!(npc_city_soldier_target(p.city(), adults), npc_soldier_target(adults));
    p.threatened(NPC_STANCE.fortify_threat);
    p.next_day();
    assert_eq!(p.city().stance, Some(Stance::Fortify));
    assert!(npc_city_soldier_target(p.city(), adults) > npc_soldier_target(adults));
    assert_eq!(super::extra_escorts(p.city()), NPC_STANCE.fortify_escorts as usize);
    let weights = crate::npc_scores::job_weights(p.city());
    assert!(weights.danger > csp_shared::balance::NPC_JOB_WEIGHTS.danger);
    // A militarist turns to it on less.
    let mut m = Place::town(Temperament::Militarist, false);
    m.threatened(NPC_STANCE.fortify_threat / NPC_STANCE.temperament_tilt);
    assert_eq!(m.pick(), Stance::Fortify);
    p.threatened(NPC_STANCE.fortify_threat / NPC_STANCE.temperament_tilt);
    assert_ne!(p.pick(), Stance::Fortify);
}

#[test]
fn a_merchant_with_surplus_and_a_warehouse_in_reach_turns_to_trade() {
    let mut p = Place::town(Temperament::Merchant, true);
    let traders = crate::npc_trader::traders_wanted(&p.world, p.city());
    let steps = crate::npc_chain::surplus_steps(&p.world, p.city());
    p.next_day();
    assert_eq!(p.city().stance, Some(Stance::Trade));
    assert_eq!(crate::npc_trader::traders_wanted(&p.world, p.city()), traders + 1);
    let under_trade = crate::npc_chain::surplus_steps(&p.world, p.city());
    assert!((under_trade - steps * NPC_STANCE.trade_surplus_cap).abs() < 1e-9);
    // Without a warehouse in reach, or as a militarist, it doesn't.
    assert_eq!(Place::town(Temperament::Merchant, false).pick(), Stance::Grow);
    assert_eq!(Place::town(Temperament::Militarist, true).pick(), Stance::Grow);
}

#[test]
fn a_settler_with_room_turns_to_expand() {
    let mut p = Place::town(Temperament::Settler, false);
    let scouts = crate::npc_scouts::scouts_wanted(&p.world, p.city());
    p.next_day();
    assert_eq!(p.city().stance, Some(Stance::Expand));
    assert!(crate::npc_scouts::scouts_wanted(&p.world, p.city()) > scouts);
    assert!(super::full_days_factor(p.city()) < 1.0);
    // Short of Food it has no room to.
    let s = p.storage();
    p.world.buildings[s].stock.as_mut().unwrap().insert(Good::Food, 0.0);
    assert_eq!(p.pick(), Stance::Grow);
}

#[test]
fn stances_settle_back_to_grow() {
    let mut p = Place::town(Temperament::Militarist, false);
    p.threatened(NPC_STANCE.fortify_threat);
    p.next_day();
    assert_eq!(stance_of(p.city()), Stance::Fortify);
    p.city_mut().threats = None;
    // Only at its first pass of a day: a later pass the same day keeps it.
    let before = p.world.tick;
    p.world.tick += NPC_PLAN_TICKS as u64;
    step_stances(&mut p.world, p.terrain.size);
    assert_eq!(stance_of(p.city()), Stance::Fortify);
    p.world.tick = before;
    p.next_day();
    assert_eq!(p.city().stance, None);
    assert_eq!(stance_of(p.city()), Stance::Grow);
    assert_eq!(npc_city_soldier_target(p.city(), 20.0), npc_soldier_target(20.0));
    assert_eq!(crate::invariants::check_all(&p.world, &p.terrain), []);
}

#[test]
fn only_an_npc_city_holds_a_stance_and_never_grow() {
    let mut p = Place::town(Temperament::Settler, true);
    assert_eq!(stances_sound(&p.world), []);
    p.city_mut().stance = Some(Stance::Grow);
    assert_eq!(stances_sound(&p.world).len(), 1);
    p.city_mut().stance = None;
    let post = p.world.cities.iter().position(|c| c.trade_org == Some(TradeOrgCity::Post)).unwrap();
    p.world.cities[post].stance = Some(Stance::Trade);
    assert_eq!(stances_sound(&p.world).len(), 1);
    // A city that is no NPC city drops its stance.
    p.next_day();
    assert_eq!(p.world.cities[post].stance, None);
    assert_eq!(stances_sound(&p.world), []);
}

#[test]
fn mood_lines() {
    assert_eq!(mood(Stance::Fortify), "arming");
    assert_eq!(mood(Stance::Trade), "busy trading");
}

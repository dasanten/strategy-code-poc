//! Epic 98's proof (T98.9, `CONTEXT.md`: Temperament, Stance, Threat, NPC demand): NPC cities with
//! intent on a staged world. Two neighbouring towns of different temperament go different ways;
//! the militarist one, one of its people killed by a Player's soldier, fortifies, escorts its
//! traders more, sends the Player a demand being far stronger, and grows again once it is paid.

use csp_shared::balance::{NPC_TOWN, NPC_TRADER_ESCORTS};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Good, ResidentOrder, Stance, Temperament, WorldState};

use super::{home_mut, past_reserve, unhurried_walking};
use crate::combat::attack_order;
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::residents::can_work;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::test_world::realm;
use crate::tick::Scratch;
use crate::trading_posts::found_trading_post;
use crate::world::create_world;

const DAY: usize = TICKS_PER_GAME_DAY as usize;

struct World {
    world: WorldState,
    terrain: TerrainMap,
    runner: Runner,
    merchant: String,
    militarist: String,
    post: (i32, i32),
}

/// A merchant town at (60, 60) and a militarist one at (160, 60), a trading post between them to
/// the south, each town's storages holding twice its reserve, Food to spare and Spears for its
/// soldiers; realm r1, its Leader far off.
fn staged() -> World {
    let terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(11.0);
    let merchant = found_npc_city(&mut world, &terrain, &NPC_TOWN, 60, 60, &mut || m.next(), None);
    let militarist =
        found_npc_city(&mut world, &terrain, &NPC_TOWN, 160, 60, &mut || m.next(), None);
    let post = (110, 130);
    found_trading_post(&mut world, &terrain, post.0, post.1, None, &mut || m.next());
    for (id, t) in [(&merchant, Temperament::Merchant), (&militarist, Temperament::Militarist)] {
        world.cities.iter_mut().find(|c| &c.id == id).unwrap().temperament = Some(t);
        let mut stock = past_reserve(&world, id, &[(Good::Food, 2000.0), (Good::Spear, 20.0)]);
        for (g, n) in stock.iter_mut() {
            if *g != Good::Food && *g != Good::Spear {
                *n *= 2.0;
            }
        }
        home_mut(&mut world, id).stock = Some(stock);
    }
    realm(&mut world, "r1", 7, "a1");
    add_r1(&mut world, "a1", (380.0, 380.0), false);
    let runner = Runner { walking: unhurried_walking(&terrain), scratch: Scratch::default() };
    World { world, terrain, runner, merchant, militarist, post }
}

/// A grown resident of r1 at `at`, in steel when `armed`.
fn add_r1(world: &mut WorldState, id: &str, at: (f64, f64), armed: bool) {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 3.0);
    let fields = NewResident { id, owner: Some("r1"), city_id: None, x: at.0, y: at.1, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = world.tick as f64 - 20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    if armed {
        for g in [Good::SteelSword, Good::SteelArmour, Good::SteelShield] {
            r.carried.insert(g, 1.0);
        }
    }
    world.residents.push(r);
    crate::equipment::settle_all(world);
}

impl World {
    fn stance(&self, id: &str) -> Option<Stance> {
        self.world.cities.iter().find(|c| c.id == id).unwrap().stance
    }

    /// Steps `days` game days, checking the invariants each day, or until `done`.
    fn run(&mut self, days: usize, done: impl Fn(&World) -> bool) {
        for t in 0..days * DAY {
            self.runner.step(&mut self.world, &self.terrain);
            if t % DAY == 0 {
                assert_eq!(check_all(&self.world, &self.terrain), [], "day {}", t / DAY);
            }
            if done(self) {
                return;
            }
        }
    }
}

#[test]
#[ignore = "slow: game days of two towns (T98.9)"]
fn npc_slow_cities_with_intent_fortify_demand_and_grow_again() {
    let mut s = staged();
    let (merchant, militarist) = (s.merchant.clone(), s.militarist.clone());

    // Two neighbours, two ways: the merchant, with surplus and a warehouse in reach, trades; the
    // militarist, under no threat, grows.
    s.run(2, |s| s.stance(&s.merchant) == Some(Stance::Trade));
    assert_eq!(s.stance(&merchant), Some(Stance::Trade));
    assert_eq!(s.stance(&militarist), None);
    let city = |s: &World, id: &str| s.world.cities.iter().find(|c| c.id == id).unwrap().clone();
    assert!(
        crate::npc_chain::surplus_steps(&s.world, &city(&s, &merchant))
            < crate::npc_chain::surplus_steps(&s.world, &city(&s, &militarist))
    );

    // r1's soldier kills one of the militarist town's people at home, in sight of its own.
    let home = npc_home(&s.world, &militarist).unwrap().clone();
    let tick = s.world.tick as f64;
    let victim = s
        .world
        .residents
        .iter()
        .find(|r| {
            r.city_id.as_deref() == Some(militarist.as_str())
                && r.owner.is_none()
                && can_work(r.born_at, tick)
                && !crate::queries::residents::is_armed(r)
        })
        .expect("an unarmed adult")
        .id
        .clone();
    let at = {
        let v = s.world.residents.iter_mut().find(|r| r.id == victim).unwrap();
        (v.x, v.y, v.order, v.script) = (home.x, home.y + 1.0, None, None);
        (v.x, v.y)
    };
    for k in 0..3 {
        let id = format!("s{k}");
        add_r1(&mut s.world, &id, (at.0 + 1.0, at.1 + k as f64), true);
        let r = s.world.residents.iter_mut().find(|r| r.id == id).unwrap();
        r.order = Some(ResidentOrder::Attack(attack_order(&victim, false, false)));
    }
    s.run(1, |s| !s.world.residents.iter().any(|r| r.id == victim && r.health > 0.0));
    let dbg: Vec<String> = s
        .world
        .residents
        .iter()
        .filter(|r| r.id == victim || r.owner.is_some())
        .map(|r| {
            format!(
                "{} h{} down{:?} at {},{} {:?}",
                r.id, r.health, r.down_until, r.x, r.y, r.order
            )
        })
        .collect();
    assert!(!s.world.residents.iter().any(|r| r.id == victim && r.health > 0.0), "killed {dbg:?}");
    // Its soldiers that are left go far away and lay down their arms, so what the city feels
    // comes from the killing, and r1 is far the weaker.
    for r in s.world.residents.iter_mut().filter(|r| r.id.starts_with('s') && r.owner.is_some()) {
        (r.x, r.y, r.order) = (380.0, 380.0, None);
        r.carried.clear();
    }
    crate::equipment::settle_all(&mut s.world);

    // It fortifies, escorts its traders more, and sends r1 a demand.
    s.run(3, |s| {
        s.stance(&s.militarist) == Some(Stance::Fortify)
            && s.world.demands.iter().any(|d| d.from_id == s.militarist)
    });
    assert_eq!(s.stance(&militarist), Some(Stance::Fortify));
    let c = city(&s, &militarist);
    assert!(c.threats.as_ref().is_some_and(|t| t.get("r1").is_some_and(|&v| v > 0.0)));
    let escorts = crate::npc_escort::trader_escorts_wanted(&s.world, &c, s.post);
    assert!(escorts > NPC_TRADER_ESCORTS as usize, "{escorts} escorts");
    let d = s.world.demands.iter().find(|d| d.from_id == militarist).cloned().expect("a demand");
    assert_eq!(d.to_id, "r1");

    // Paid, it grows again.
    s.world.demands.retain(|x| x.id != d.id);
    crate::npc_demands::npc_demand_ended(&mut s.world, &d, true);
    s.run(2, |s| s.stance(&s.militarist).is_none());
    let c = city(&s, &militarist);
    assert_eq!(c.stance, None, "{:?}", c.threats);
}

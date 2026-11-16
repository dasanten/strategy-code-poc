//! Escorts (`CONTEXT.md`: Escort): a town's trader walks out with a soldier who keeps with them
//! and comes home with them; a village's goes alone; the hall and gate posts stay manned.

use csp_shared::balance::{NpcCitySize, NPC_TOWN, NPC_VILLAGE};
use csp_shared::footprint::is_at;
use csp_shared::terrain::{wrap_distance, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, CityTrader, Good, Stock, WorldState};

use super::{escort_lags, npc_escorts_sound};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_plan::plan_city;
use crate::npc_posts::{free_soldiers, posts_to_hold, soldier_posts};
use crate::npc_test_world::{plains, Runner};
use crate::queries::city::{city_residents, town_hall_of};
use crate::queries::names::{held, placed};
use crate::queries::npc_trade::npc_reserve;
use crate::queries::residents::{can_work, is_armed};
use crate::random::Mulberry32;
use crate::trading_posts::found_trading_post;
use crate::world::create_world;

const DAY: usize = TICKS_PER_GAME_DAY as usize;

/// A city and the trading post it trades with.
struct Fixture {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
    storage: String,
    warehouse: String,
}

impl Fixture {
    fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the city")
    }

    fn plan(&mut self) {
        let city = self.city.clone();
        plan_city(&mut self.world, &city, Some(&self.terrain), None, None);
    }

    fn runs(&self) -> Vec<CityTrader> {
        self.world.city_plans.get(&self.city).and_then(|p| p.traders.clone()).unwrap_or_default()
    }

    fn index(&self, id: &str) -> usize {
        self.world.residents.iter().position(|r| r.id == id).expect("the resident")
    }

    fn at(&self, id: &str) -> (i32, i32) {
        let r = &self.world.residents[self.index(id)];
        (r.x as i32, r.y as i32)
    }

    fn adults(&self) -> Vec<usize> {
        let tick = self.world.tick as f64;
        (0..self.world.residents.len())
            .filter(|&i| {
                let r = &self.world.residents[i];
                r.city_id.as_deref() == Some(self.city.as_str()) && can_work(r.born_at, tick)
            })
            .collect()
    }
}

/// A city of `residents` with `soldiers` of them armed (the first by id), all at home with nothing
/// to do, and a trading post 50 tiles east. Its storage holds its reserve of everything and 60 Wood
/// past it, a load for a trader.
fn city_with_soldiers(residents: f64, soldiers: usize) -> Fixture {
    let terrain = plains(400);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let kind = NpcCitySize {
        residents,
        ..if residents < NPC_TOWN.residents { NPC_VILLAGE } else { NPC_TOWN }
    };
    let city = found_npc_city(&mut world, &terrain, &kind, 40, 40, &mut || m.next(), None);
    let home = npc_home(&world, &city).expect("a storage").clone();
    let post =
        found_trading_post(&mut world, &terrain, home.x as i32 + 50, 40, None, &mut || m.next());
    let warehouse = world
        .buildings
        .iter()
        .find(|b| b.city_id.as_deref() == Some(post.as_str()) && b.kind == BuildingKind::Warehouse)
        .expect("a warehouse")
        .id
        .clone();
    let mut f = Fixture { world, terrain, city: city.clone(), storage: home.id.clone(), warehouse };
    let mut adults = f.adults();
    adults.sort_by(|&a, &b| f.world.residents[a].id.cmp(&f.world.residents[b].id));
    for (k, &i) in adults.iter().enumerate() {
        let r = &mut f.world.residents[i];
        (r.x, r.y, r.order, r.script) = (home.x, home.y, None, None);
        r.carried = Stock::from([(Good::Food, 5.0)]);
        if k < soldiers {
            r.carried.insert(Good::Spear, 1.0);
        }
    }
    let s = f.world.buildings.iter().position(|b| b.id == f.storage).unwrap();
    f.world.buildings[s].stock = Some(Stock::new());
    // Twice: with its spears in the storage, its reserve no longer asks for what makes them.
    let reserve = npc_reserve(&f.world, f.city());
    f.world.buildings[s].stock = Some(reserve);
    let mut stock = npc_reserve(&f.world, f.city());
    *stock.entry(Good::Wood).or_insert(0.0) += 60.0;
    f.world.buildings[s].stock = Some(stock);
    f
}

#[test]
fn a_towns_trader_walks_out_with_a_soldier_who_keeps_with_them_and_comes_home_with_them() {
    let mut f = city_with_soldiers(20.0, 0);
    let hold = posts_to_hold(&f.world, f.city()) as usize;
    f = city_with_soldiers(20.0, hold + 1);
    f.plan();
    let run = f.runs().into_iter().next().expect("a trader out");
    assert_eq!(run.warehouse_id.as_deref(), Some(f.warehouse.as_str()));
    assert_eq!(run.escort_ids.len(), 1);
    let (trader, escort) = (run.resident_id.clone(), run.escort_ids[0].clone());
    assert!(is_armed(&f.world.residents[f.index(&escort)].carried));
    assert!(!is_armed(&f.world.residents[f.index(&trader)].carried));

    let mut runner = Runner::new(&f.terrain);
    let size = f.terrain.size;
    let warehouse = f.world.buildings.iter().find(|b| b.id == f.warehouse).unwrap().clone();
    let (mut set_out, mut at_warehouse, mut ended) = (false, false, false);
    for t in 0..8 * DAY {
        runner.step(&mut f.world, &f.terrain);
        if t % DAY == 0 {
            assert_eq!(check_all(&f.world, &f.terrain), []);
        }
        if f.runs().iter().all(|r| r.resident_id != trader) {
            ended = true;
            break;
        }
        let (a, b) = (f.at(&trader), f.at(&escort));
        let storage = f.world.buildings.iter().find(|b| b.id == f.storage).unwrap();
        if !set_out && !is_at(a, placed(storage), size) && is_at(b, placed(storage), size) {
            // They set out from the storage together.
            assert!(wrap_distance(size, a, b) <= 2.0, "{a:?} {b:?}");
        }
        set_out |= wrap_distance(size, a, (storage.x as i32, storage.y as i32)) > 10.0;
        if set_out {
            // On the road they keep pace: never more than a few tiles apart.
            assert!(wrap_distance(size, a, b) <= 3.0, "tick {t}: {a:?} {b:?}");
        }
        if is_at(a, placed(&warehouse), size) {
            at_warehouse = true;
        }
    }
    assert!(set_out && at_warehouse && ended);
    // Home again, side by side at the storage.
    let storage = f.world.buildings.iter().find(|b| b.id == f.storage).unwrap();
    assert!(is_at(f.at(&trader), placed(storage), size));
    assert!(wrap_distance(size, f.at(&trader), f.at(&escort)) <= 1.5);
    let e = &f.world.residents[f.index(&escort)];
    assert!(e.health > 0.0 && is_armed(&e.carried));
    assert!(
        held(
            &f.world.buildings[f.world.buildings.iter().position(|b| b.id == f.warehouse).unwrap()]
                .stock
                .clone()
                .unwrap_or_default(),
            Good::Wood
        ) > 0.0
    );
}

#[test]
fn the_hall_and_gate_posts_stay_manned_while_an_escort_is_out() {
    let f0 = city_with_soldiers(20.0, 0);
    let hold = posts_to_hold(&f0.world, f0.city()) as usize;
    let mut f = city_with_soldiers(20.0, hold + 1);
    f.plan();
    let escort = f.runs()[0].escort_ids.clone();
    assert_eq!(escort.len(), 1);
    let adults = f.adults();
    let free = free_soldiers(&f.world, f.city(), &adults);
    assert_eq!(free.len(), hold);
    assert!(free.iter().all(|&i| !escort.contains(&f.world.residents[i].id)));
    // Each of them has a post on the hall or at a gate.
    let posts = soldier_posts(&f.world, f.city(), &free, f.terrain.size, Some(&f.terrain));
    assert_eq!(posts.len(), hold);
    let hall = town_hall_of(&f.world, f.city()).unwrap();
    let on_hall = posts.values().filter(|p| is_at(p.at, placed(hall), f.terrain.size)).count();
    assert_eq!(on_hall as f64, csp_shared::balance::NPC_SOLDIERS_ON_HALL);
}

#[test]
fn a_town_with_no_soldier_beyond_its_posts_sends_its_trader_alone() {
    let f0 = city_with_soldiers(20.0, 0);
    let hold = posts_to_hold(&f0.world, f0.city()) as usize;
    let mut f = city_with_soldiers(20.0, hold);
    f.plan();
    let run = f.runs().into_iter().next().expect("a trader out");
    assert!(run.escort_ids.is_empty());
    let t = f.index(&run.resident_id);
    assert!(!escort_lags(&f.world, &f.city, t, f.terrain.size));
}

#[test]
fn a_villages_trader_goes_alone() {
    let mut f = city_with_soldiers(10.0, 3);
    assert!(city_residents(&f.world, &f.city).len() < 12);
    f.plan();
    let run = f.runs().into_iter().next().expect("a trader out");
    assert!(run.escort_ids.is_empty());
    assert_eq!(npc_escorts_sound(&f.world), []);
}

#[test]
fn finds_an_escort_on_two_runs_or_a_village_trader_with_one() {
    let mut f = city_with_soldiers(10.0, 3);
    f.plan();
    let soldier = f.world.residents[f.adults()[0]].id.clone();
    let plan = f.world.city_plans.get_mut(&f.city).unwrap();
    let run = &mut plan.traders.as_mut().unwrap()[0];
    run.escort_ids = vec![soldier.clone(), soldier];
    assert_eq!(npc_escorts_sound(&f.world).len(), 2);
}

#[test]
fn the_escort_fights_whoever_goes_for_the_trader() {
    let f0 = city_with_soldiers(20.0, 0);
    let hold = posts_to_hold(&f0.world, f0.city()) as usize;
    let mut f = city_with_soldiers(20.0, hold + 1);
    f.plan();
    let run = f.runs()[0].clone();
    let (trader, escort) = (run.resident_id.clone(), run.escort_ids[0].clone());
    let mut robber = f.world.residents[f.index(&trader)].clone();
    robber.id = "robber".into();
    robber.owner = Some("realm-x".into());
    robber.city_id = None;
    robber.carried = Stock::from([(Good::Spear, 1.0)]);
    robber.order = Some(csp_shared::world::ResidentOrder::Attack(crate::combat::attack_order(
        &trader, false, false,
    )));
    f.world.residents.push(robber);
    let e = f.index(&escort);
    let city = f.city.clone();
    assert!(super::run_escort(&mut f.world, &city, e, None, f.terrain.size));
    match &f.world.residents[e].order {
        Some(csp_shared::world::ResidentOrder::Attack(o)) => assert_eq!(o.target_id, "robber"),
        other => panic!("{other:?}"),
    }
}

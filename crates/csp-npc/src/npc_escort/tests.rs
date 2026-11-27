//! Escorts (`CONTEXT.md`: Escort): a town's trader walks out with a soldier who keeps with them
//! and comes home with them; a village's goes alone; the hall and gate posts stay manned.

use csp_shared::balance::{NpcCitySize, NPC_TOWN, NPC_VILLAGE};
use csp_shared::footprint::is_at;
use csp_shared::terrain::{wrap_delta, wrap_distance, TerrainMap};
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
    assert!(is_armed(&f.world.residents[f.index(&escort)]));
    assert!(!is_armed(&f.world.residents[f.index(&trader)]));

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
            // On the road they keep pace: never more than three tiles apart either way.
            let apart = wrap_delta(a.0, b.0, size).abs().max(wrap_delta(a.1, b.1, size).abs());
            assert!(apart <= 3, "tick {t}: {a:?} {b:?}");
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
    assert!(e.health > 0.0 && is_armed(e));
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

#[test]
fn more_soldiers_go_along_a_way_past_a_danger_place() {
    use csp_shared::world::DangerPlace;
    let mut world = crate::test_world::empty_world();
    crate::test_world::add_city(&mut world, "n1", None, 100.0, 100.0, None);
    let city = |w: &WorldState| w.cities[0].clone();
    let before = super::founding_escorts_wanted(&world, &city(&world), 10, (200, 100));
    world.cities[0].danger_places = Some(vec![DangerPlace { x: 150.0, y: 105.0, weight: 1.0 }]);
    assert_eq!(super::founding_escorts_wanted(&world, &city(&world), 10, (200, 100)), before + 1);
    // Not on the way north.
    assert_eq!(super::founding_escorts_wanted(&world, &city(&world), 10, (100, 20)), before);
}

#[test]
fn an_escort_not_at_the_storage_goes_for_the_food_for_the_way_first() {
    // #1414: an escort away from the storage as the trader set out walked out on what they had.
    let mut f = city_with_soldiers(20.0, 0);
    let hold = posts_to_hold(&f.world, f.city()) as usize;
    f = city_with_soldiers(20.0, hold + 1);
    f.plan();
    let run = f.runs().into_iter().next().expect("a trader out");
    let escort = run.escort_ids[0].clone();
    let i = f.index(&escort);
    let storage = f.world.buildings.iter().find(|b| b.id == f.storage).unwrap().clone();
    let r = &mut f.world.residents[i];
    (r.x, r.y, r.order, r.script) = (storage.x + 6.0, storage.y, None, None);
    r.carried.shift_remove(&Good::Food);
    let mut runner = Runner::new(&f.terrain);
    let mut fed = false;
    for _ in 0..DAY {
        runner.step(&mut f.world, &f.terrain);
        let i = f.index(&escort);
        fed |= held(&f.world.residents[i].carried, Good::Food) >= 2.0;
        if fed {
            break;
        }
    }
    assert!(fed, "the escort never took Food for the way");
    assert_eq!(check_all(&f.world, &f.terrain), []);
}

#[test]
fn an_escort_gone_ahead_holds_for_the_trader_who_walks_on() {
    let mut f = city_with_soldiers(20.0, 0);
    let hold = posts_to_hold(&f.world, f.city()) as usize;
    f = city_with_soldiers(20.0, hold + 1);
    f.plan();
    let run = f.runs().into_iter().next().expect("a trader out");
    let (trader, escort) = (run.resident_id.clone(), run.escort_ids[0].clone());
    let mut runner = Runner::new(&f.terrain);
    let size = f.terrain.size;
    let warehouse = f.world.buildings.iter().find(|b| b.id == f.warehouse).unwrap().clone();
    let storage = f.world.buildings.iter().find(|b| b.id == f.storage).unwrap().clone();
    // On the road together, 10 tiles out.
    let mut t = 0;
    while wrap_distance(size, f.at(&trader), (storage.x as i32, storage.y as i32)) < 10.0 {
        runner.step(&mut f.world, &f.terrain);
        t += 1;
        assert!(t < 2 * DAY, "the trader sets out");
    }
    // The escort is put 15 tiles ahead on the way, still walking there.
    let e = f.index(&escort);
    let (ax, ay) = f.at(&trader);
    let r = &mut f.world.residents[e];
    (r.x, r.y, r.order) = (f64::from(ax + 15), f64::from(ay), None);
    let mut reached = false;
    for t in 0..2 * DAY {
        runner.step(&mut f.world, &f.terrain);
        let (a, b) = (f.at(&trader), f.at(&escort));
        if t > 20 {
            // The escort held: it came no further ahead.
            assert!(wrap_delta(a.0, b.0, size).abs() <= 16, "tick {t}: {a:?} {b:?}");
        }
        if is_at(a, placed(&warehouse), size) {
            reached = true;
            break;
        }
    }
    // The trader walked on to the warehouse rather than standing for the escort ahead (#1434).
    assert!(reached, "trader at {:?}, escort at {:?}", f.at(&trader), f.at(&escort));
}

#[test]
fn an_escort_out_with_the_trader_is_not_sent_home_for_gear() {
    // #1379: Thornbury's escort, just at the warehouse 495 tiles out, walked home for a new shield,
    // and its trader stood waiting for it until they starved.
    use csp_shared::world::ResidentOrder;
    let mut f = city_with_soldiers(20.0, 0);
    let hold = posts_to_hold(&f.world, f.city()) as usize;
    f = city_with_soldiers(20.0, hold + 1);
    f.plan();
    let run = f.runs().into_iter().next().expect("a trader out");
    let escort = run.escort_ids[0].clone();
    let storage = f.world.buildings.iter().find(|b| b.id == f.storage).unwrap().clone();
    // It knows of a coal node, so it wants the steel kit for its soldiers (`upgrade_soldiers`).
    f.world.nodes.push(
        serde_json::from_value(serde_json::json!({
            "id": "coal-near", "kind": "coal", "x": storage.x - 20.0, "y": storage.y,
        }))
        .unwrap(),
    );
    // The escort stands 30 tiles out with nothing to do and a spare load (Steel) its city would
    // have a soldier at home put away.
    let e = f.index(&escort);
    let r = &mut f.world.residents[e];
    (r.x, r.y, r.order, r.script) = (storage.x + 30.0, storage.y, None, None);
    r.carried.insert(Good::Steel, 10.0);
    crate::npc_defence::step_npc_defence(&mut f.world, f.terrain.size);
    assert!(f.runs().iter().any(|r| r.escort_ids.contains(&escort)), "still on the run");
    let r = &f.world.residents[f.index(&escort)];
    let home = |o: &Option<ResidentOrder>| matches!(o, Some(ResidentOrder::WalkTo(w)) if (w.target.x, w.target.y) == (storage.x, storage.y));
    assert!(!home(&r.order), "{:?}", r.order);
}

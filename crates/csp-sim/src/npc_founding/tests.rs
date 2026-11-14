//! `npc-founding.test.ts`: full cities found daughters (`CONTEXT.md`: Full city, Founding): a
//! city idle and short of nothing for a game week sends a founding party to a free site, which
//! builds a town hall there and grows into a village of its own.

use csp_shared::balance::ticks_for_age;
use csp_shared::balance::{
    BUILD_MATERIALS, FOOD_PER_DAY, FOOD_SURPLUS_DAYS, NPC_CITY_MIN_DISTANCE,
    NPC_FOUND_GIVE_UP_DAYS, NPC_FOUND_PARTY_MOST, NPC_FOUND_REACH, NPC_FOUND_STANDING,
    NPC_FOUND_VILLAGE_RESIDENTS, NPC_FULL_DAYS, NPC_FULL_DAYS_LEAST, NPC_FULL_DIP_DAYS, NPC_TOWN,
    NPC_TRADE, NPC_VILLAGE, WALK_TICKS_PER_TILE,
};
use csp_shared::terrain::{tile_index, wrap_distance, Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, CityJob, CityJobKind, CityPlan, Good, ResidentOrder, ResourceKind,
    ResourceNode, RunningScript, Stock, Tile, WorldState,
};
use serde_json::json;

use super::{
    find_founding_site, found_daughter, founding_food, founding_materials, founding_parties_sound,
    founding_party, full_wait_sound,
};
use crate::cities::{found_city, update_city_membership, CITY_NAMES};
use crate::invariants::check_all;
use crate::npc_behaviour::npc_home;
use crate::npc_cities::found_npc_city;
use crate::npc_growth::far_stable_spot;
use crate::npc_plan::plan_city;
use crate::npc_test_world::{plains, Runner};
use crate::queries::balance::carry_capacity;
use crate::queries::city::town_hall_of;
use crate::queries::names::held;
use crate::queries::npc_trade::{
    npc_founding_party_size, npc_full_days, npc_reserve, npc_soldier_target,
};
use crate::queries::residents::good_weight;
use crate::queries::territory::compute_territory;
use crate::random::{new_id, Mulberry32};
use crate::residents::{new_resident, NewResident};
use crate::starting_city::found_starting_city;
use crate::world::create_world;

const DAY: f64 = TICKS_PER_GAME_DAY;

/// Puts a node of `kind` on its tile, with the terrain it lies on (`node`).
fn node(world: &mut WorldState, terrain: &mut TerrainMap, kind: ResourceKind, x: f64, y: f64) {
    let name = serde_json::to_value(kind).unwrap().as_str().unwrap().to_string();
    world.nodes.push(ResourceNode { id: format!("{name}{x},{y}"), kind, x, y });
    let ground = if kind == ResourceKind::Forest { Terrain::Forest } else { Terrain::Hills };
    terrain.tiles[tile_index(terrain.size, x as i32, y as i32)] = ground as u8;
}

/// A town and its map.
struct Town {
    world: WorldState,
    terrain: TerrainMap,
    city: String,
}

impl Town {
    fn city(&self) -> &csp_shared::world::City {
        self.world.cities.iter().find(|c| c.id == self.city).expect("the town")
    }

    fn home(&self) -> Building {
        npc_home(&self.world, &self.city).expect("a storage").clone()
    }

    fn home_stock(&mut self) -> &mut Stock {
        let id = self.home().id;
        let b = self.world.buildings.iter_mut().find(|b| b.id == id).unwrap();
        b.stock.get_or_insert_with(Stock::new)
    }

    fn plan_city(&mut self) {
        let city = self.city.clone();
        plan_city(&mut self.world, &city, Some(&self.terrain), None, None);
    }

    fn plan(&self) -> &CityPlan {
        &self.world.city_plans[&self.city]
    }

    fn plan_mut(&mut self) -> &mut CityPlan {
        self.world.city_plans.get_mut(&self.city).expect("a plan")
    }

    fn party(&self) -> Vec<String> {
        founding_party(self.world.city_plans.get(&self.city))
    }

    fn site(&self) -> Option<Tile> {
        let site = find_founding_site(&self.world, &self.terrain, self.city(), &self.home());
        site.map(|(x, y)| Tile { x: f64::from(x), y: f64::from(y) })
    }
}

/// A town alone on a Plains map of `size` with its storage full of everything its reserve wants,
/// so it is short of nothing, and more hands than its farms take (`fullTown`). It has its stable
/// already, as one this far along does (`CONTEXT.md`: NPC horses), with nothing left to build but
/// a daughter.
fn full_town(size: i32) -> Town {
    let terrain = plains(size);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let city = found_npc_city(&mut world, &terrain, &NPC_TOWN, 60, 60, &mut || m.next(), None);
    let mut t = Town { world, terrain, city };
    *t.home_stock() = Stock::from([
        (Good::Food, 3000.0),
        (Good::Wood, 800.0),
        (Good::Stone, 800.0),
        (Good::Iron, 200.0),
        (Good::Spear, 20.0),
        (Good::Coins, 1000.0),
    ]);
    let (x, y) = far_stable_spot(&t.world, t.city(), &t.home(), &t.terrain).expect("a spot");
    let stable = crate::test_support::building(
        "stable0",
        BuildingKind::Stable,
        Some(&t.city),
        f64::from(x),
        f64::from(y),
    );
    t.world.buildings.push(stable);
    t
}

/// Runs the world for up to `ticks`, or until `done`, checking the invariants every game day
/// (`run`).
fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    ticks: usize,
    done: &dyn Fn(&WorldState) -> bool,
) {
    let mut runner = Runner::new(terrain);
    for _ in 0..ticks {
        if done(world) {
            break;
        }
        runner.step(world, terrain);
        if world.tick.is_multiple_of(DAY as u64) {
            assert_eq!(check_all(world, terrain), []);
        }
    }
}

fn found_job() -> CityJob {
    serde_json::from_value(json!({ "kind": "found" })).unwrap()
}

// a full city

#[test]
fn is_not_full_while_it_is_short_of_something() {
    let mut t = full_town(300);
    *t.home_stock() = Stock::from([(Good::Food, 3000.0)]);
    t.plan_city();
    assert_eq!(t.plan().full_since, None);
}

#[test]
fn counts_as_full_from_the_pass_that_finds_spare_hands_with_nowhere_to_go_and_nothing_short() {
    let mut t = full_town(300);
    t.plan_city();
    assert_eq!(t.plan().full_since, Some(t.world.tick as f64));
}

// by its size

/// A full town staged at `residents`, with a site ready and full since `days` ago (`fullFor`).
fn full_for(residents: usize, days: f64) -> Town {
    let mut t = full_town(1300);
    let mut m = Mulberry32::new(13.0);
    let home = t.home();
    let city = t.city.clone();
    while t.world.residents.iter().filter(|r| r.city_id.as_deref() == Some(&city)).count()
        < residents
    {
        let id = new_id("r", &mut t.world.next_id);
        let fields = NewResident {
            id: &id,
            owner: None,
            city_id: Some(&city),
            x: home.x,
            y: home.y,
            tick: t.world.tick as f64,
        };
        let r = new_resident(&mut || m.next(), &fields, None);
        t.world.residents.push(r);
    }
    // Time for those just added to be grown, whatever the map's clock says.
    t.world.tick = (4000.0 * DAY) as u64;
    let born = t.world.tick as f64 - ticks_for_age(30.0);
    for r in &mut t.world.residents {
        r.born_at = born;
    }
    // Its soldiers armed, and well past what so many want, so nothing is short.
    let people: Vec<usize> = (0..t.world.residents.len())
        .filter(|&i| t.world.residents[i].city_id.as_deref() == Some(&city))
        .collect();
    let soldiers = npc_soldier_target(people.len() as f64) as usize;
    for &i in &people[..soldiers] {
        t.world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    let coins = held(&npc_reserve(&t.world, t.city()), Good::Coins) + 1000.0;
    t.home_stock().insert(Good::Coins, coins);
    t.plan_city();
    let since = t.world.tick as f64 - days * DAY;
    let site = t.site();
    let plan = t.plan_mut();
    plan.full_since = Some(since);
    plan.founding_site = site;
    assert!(site.is_some());
    t
}

#[test]
fn waits_less_and_sends_more_the_bigger_it_is_down_to_a_floor_and_up_to_a_most() {
    assert_eq!(npc_full_days(NPC_TOWN.residents), NPC_FULL_DAYS);
    assert_eq!(npc_full_days(NPC_FOUND_VILLAGE_RESIDENTS), NPC_FULL_DAYS);
    assert!(npc_full_days(110.0) < NPC_FULL_DAYS);
    assert_eq!(npc_full_days(100_000.0), NPC_FULL_DAYS_LEAST);
    assert_eq!(npc_founding_party_size(NPC_TOWN.residents), NPC_VILLAGE.residents);
    assert_eq!(npc_founding_party_size(NPC_FOUND_VILLAGE_RESIDENTS), NPC_VILLAGE.residents);
    assert!(npc_founding_party_size(110.0) > NPC_VILLAGE.residents);
    assert_eq!(npc_founding_party_size(100_000.0), NPC_FOUND_PARTY_MOST);
}

#[test]
fn a_big_city_founds_sooner_than_a_week_and_sends_more_with_more_materials() {
    let days = npc_full_days(110.0);
    let mut t = full_for(110, days - 0.5);
    t.plan_city();
    assert!(t.party().is_empty());

    t.plan_mut().full_since = Some(t.world.tick as f64 - days * DAY);
    t.plan_city();
    assert!(days < NPC_FULL_DAYS);
    let party = t.party();
    assert_eq!(party.len() as f64, npc_founding_party_size(110.0));
    assert!(party.len() as f64 > NPC_VILLAGE.residents);
    let armed = party
        .iter()
        .filter(|id| {
            t.world.residents.iter().any(|r| {
                &r.id == *id
                    && (held(&r.carried, Good::Spear) != 0.0
                        || held(&r.carried, Good::Sword) != 0.0)
            })
        })
        .count();
    assert_eq!(armed, 1);
    let more = founding_materials(Some(npc_founding_party_size(110.0)));
    assert!(held(&more, Good::Wood) > held(&founding_materials(None), Good::Wood));
}

#[test]
fn a_city_of_a_villages_size_still_waits_a_week_and_sends_a_villages_worth() {
    let mut t = full_for(NPC_TOWN.residents as usize, NPC_FULL_DAYS - 0.5);
    t.plan_city();
    assert!(t.party().is_empty());

    t.plan_mut().full_since = Some(t.world.tick as f64 - NPC_FULL_DAYS * DAY);
    t.plan_city();
    assert_eq!(t.party().len() as f64, NPC_VILLAGE.residents);
    assert_eq!(
        founding_materials(Some(NPC_VILLAGE.residents)),
        Stock::from([(Good::Wood, 90.0), (Good::Stone, 50.0)])
    );
}

#[test]
fn a_big_city_that_isnt_full_of_what_its_bigger_party_takes_stays_home() {
    let days = npc_full_days(110.0);
    let mut t = full_for(110, days);
    let reserve = npc_reserve(&t.world, t.city());
    // A village's materials above its reserve, but not the houses of its bigger party.
    let village = founding_materials(None);
    let stock = t.home_stock();
    stock.insert(Good::Wood, held(&reserve, Good::Wood) + held(&village, Good::Wood));
    stock.insert(Good::Stone, held(&reserve, Good::Stone) + held(&village, Good::Stone));
    t.plan_city();
    assert!(t.party().is_empty());
}

#[test]
fn the_mother_keeps_enough_to_feed_itself_at_any_size_past_a_villages() {
    // It founds only with nothing short, so at worst it holds just its reserve of Food. The party
    // takes the most it can, for the furthest walk, and those who stay still have a surplus.
    let (walk, stay) = founding_food(NPC_FOUND_REACH * WALK_TICKS_PER_TILE);
    for n in NPC_FOUND_VILLAGE_RESIDENTS as i32..=1000 {
        let n = f64::from(n);
        let members = npc_founding_party_size(n);
        let left = n * FOOD_PER_DAY * NPC_TRADE.reserve_food_days - members * (walk + stay);
        assert!(left > (n - members) * FOOD_PER_DAY * FOOD_SURPLUS_DAYS, "{n}");
    }
}

#[test]
fn looks_for_its_daughter_on_no_realm_territory_near_a_node_of_what_it_lacks() {
    let mut terrain = plains(1600);
    let mut world = create_world(&terrain, 1);
    found_starting_city(&mut world, &terrain, 7, None);
    let realm = world.realms.iter().find(|r| r.user_id == 7).unwrap().id.clone();
    let hall = world
        .buildings
        .iter()
        .find(|b| {
            b.kind == BuildingKind::TownHall
                && world.cities.iter().any(|c| {
                    c.realm_id.as_deref() == Some(realm.as_str())
                        && b.city_id.as_deref() == Some(c.id.as_str())
                })
        })
        .unwrap()
        .clone();
    // The mother lies 700 tiles west of the realm, and lacks stone: the only stone lies in the
    // realm's territory, so its sites would go there if nothing stopped them.
    let mx = (hall.x as i32 - 700 + terrain.size) % terrain.size;
    let mut m = Mulberry32::new(9.0);
    let city = found_npc_city(
        &mut world,
        &terrain,
        &NPC_VILLAGE,
        mx,
        hall.y as i32 - 14,
        &mut || m.next(),
        None,
    );
    let home = npc_home(&world, &city).unwrap().clone();
    node(&mut world, &mut terrain, ResourceKind::Forest, home.x + 30.0, home.y);
    node(&mut world, &mut terrain, ResourceKind::Stone, hall.x - 40.0, hall.y);
    let owners = compute_territory(&world, terrain.size).owners;
    let mut found = 0;
    for _ in 0..5 {
        world.tick += 977;
        let c = world.cities.iter().find(|c| c.id == city).unwrap();
        let Some(site) = find_founding_site(&world, &terrain, c, &home) else { continue };
        found += 1;
        let d = wrap_distance(terrain.size, (home.x as i32, home.y as i32), site);
        assert!(d >= NPC_CITY_MIN_DISTANCE - NPC_VILLAGE.size);
        assert!(d <= NPC_FOUND_REACH + NPC_VILLAGE.size);
        for dy in -20..=20 {
            for dx in -20..=20 {
                let i = tile_index(terrain.size, site.0 + dx, site.1 + dy);
                assert_ne!(owners.get(&i), Some(&realm));
            }
        }
    }
    assert!(found > 0);
}

#[test]
fn gives_a_wiped_out_party_up_after_the_give_up_days_and_may_found_again() {
    let mut t = full_town(300);
    t.plan_city();
    let tick = t.world.tick as f64;
    let plan = t.plan_mut();
    plan.jobs.insert("gone1".into(), found_job());
    plan.jobs.insert("gone2".into(), found_job());
    plan.founding_site = Some(Tile { x: 250.0, y: 250.0 });
    plan.full_since = Some(tick);
    t.world.tick += ((NPC_FOUND_GIVE_UP_DAYS - 1.0) * DAY) as u64;
    t.plan_city();
    assert_eq!(t.party(), ["gone1", "gone2"]);
    t.world.tick += (2.0 * DAY) as u64;
    t.plan_city();
    assert!(t.party().is_empty());
    assert_eq!(t.plan().founding_site, None);
    // Not a party any more: idle and short of nothing, it is full again from now.
    t.plan_city();
    assert_eq!(t.plan().full_since, Some(t.world.tick as f64));
}

#[test]
#[ignore = "13.9 s alone; see #1132"]
fn founds_a_village_480_tiles_away_within_a_few_game_weeks_which_then_feeds_itself() {
    let mut t = full_town(1300);
    let home = t.home();
    node(&mut t.world, &mut t.terrain, ResourceKind::Forest, home.x + 40.0, home.y);
    node(&mut t.world, &mut t.terrain, ResourceKind::Stone, home.x, home.y + 60.0);
    let mother = t.city.clone();
    let daughter = |w: &WorldState| {
        w.cities
            .iter()
            .find(|c| c.id != mother && c.realm_id.is_none() && c.trade_org.is_none())
            .map(|c| c.id.clone())
    };
    // Until the town hall stands and the party has moved to the daughter, the tick after.
    let moved = |w: &WorldState| {
        daughter(w).is_some_and(|d| w.residents.iter().any(|r| r.city_id.as_deref() == Some(&d)))
    };
    run(&mut t.world, &t.terrain, (40.0 * DAY) as usize, &moved);
    let village = daughter(&t.world).expect("a daughter");
    let v = t.world.cities.iter().find(|c| c.id == village).unwrap();
    assert!(CITY_NAMES.contains(&v.name.as_str()));
    let hall = town_hall_of(&t.world, v).unwrap();
    let mother_hall = town_hall_of(&t.world, t.city()).unwrap();
    // The usual distance runs from a city's town hall to the new village's middle
    // (`npcSiteFits`).
    let far = NPC_CITY_MIN_DISTANCE - NPC_VILLAGE.size / 2.0;
    let at = |b: &Building| (b.x as i32, b.y as i32);
    assert!(wrap_distance(t.terrain.size, at(mother_hall), at(hall)) > far);
    let people: Vec<_> =
        t.world.residents.iter().filter(|r| r.city_id.as_deref() == Some(&village)).collect();
    assert_eq!(people.len() as f64, NPC_VILLAGE.residents);
    assert!(people
        .iter()
        .any(|r| { held(&r.carried, Good::Spear) != 0.0 || held(&r.carried, Good::Sword) != 0.0 }));
    // A founding party takes no horses (`CONTEXT.md`: NPC horses).
    assert!(t.world.horses.iter().all(|h| h.city_id.as_deref() != Some(&village)));
    let standing = |of: &str, toward: &str| {
        t.world.standings.iter().find(|s| s.of == of && s.toward == toward).map_or(0.0, |s| s.value)
    };
    assert!(standing(&mother, &village) > NPC_FOUND_STANDING - 1.0);
    assert!(standing(&village, &mother) > NPC_FOUND_STANDING - 1.0);
    assert!(t.party().is_empty());

    // It builds its storage and a farm, and feeds itself from the farm.
    run(&mut t.world, &t.terrain, (20.0 * DAY) as usize, &|_| false);
    let has = |k: BuildingKind| {
        t.world
            .buildings
            .iter()
            .any(|b| b.kind == k && b.city_id.as_deref() == Some(&village) && b.site.is_none())
    };
    assert!(has(BuildingKind::Storage));
    assert!(has(BuildingKind::Farm));
    let alive: Vec<_> = t
        .world
        .residents
        .iter()
        .filter(|r| r.city_id.as_deref() == Some(&village) && r.health > 0.0)
        .collect();
    assert!(alive.len() as f64 >= NPC_VILLAGE.residents);
    let farm = t
        .world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Farm && b.city_id.as_deref() == Some(&village))
        .unwrap();
    assert!(alive.iter().any(|r| {
        r.script.as_ref().and_then(|s| s.memory.get("workplaceId")) == Some(&json!(farm.id))
    }));
    let storage = npc_home(&t.world, &village).unwrap();
    assert!(storage.stock.as_ref().map_or(0.0, |s| held(s, Good::Food)) > 0.0);
}

// a dip below the reserve

/// A town full for `days` game days, with its site found, its Food under the reserve now
/// (`dipping`). Returns it with the Food it had.
fn dipping(days: f64) -> (Town, f64) {
    let mut t = full_town(1300);
    let full = held(t.home_stock(), Good::Food);
    t.plan_city();
    t.world.tick = (100.0 * DAY) as u64;
    let since = t.world.tick as f64 - days * DAY;
    let site = t.site();
    let plan = t.plan_mut();
    plan.full_since = Some(since);
    plan.founding_site = site;
    t.home_stock().insert(Good::Food, 1.0);
    (t, full)
}

#[test]
fn keeps_the_wait_while_it_lasts_up_to_a_game_day_and_sends_nobody_meanwhile() {
    let (mut t, _) = dipping(NPC_FULL_DAYS + 1.0);
    let since = t.plan().full_since;
    t.plan_city();
    assert_eq!(t.plan().short_since, Some(t.world.tick as f64));
    assert_eq!(t.plan().full_since, since);
    assert!(t.plan().founding_site.is_some());
    assert!(t.party().is_empty());

    t.world.tick += (NPC_FULL_DIP_DAYS * DAY) as u64;
    t.plan_city();
    assert_eq!(t.plan().full_since, since);
    assert!(t.party().is_empty());
}

#[test]
fn restarts_the_wait_once_it_lasts_longer_than_a_game_day() {
    let (mut t, _) = dipping(NPC_FULL_DAYS + 1.0);
    t.plan_city();
    t.world.tick += (NPC_FULL_DIP_DAYS * DAY) as u64 + 1;
    t.plan_city();
    assert_eq!(t.plan().full_since, None);
    assert_eq!(t.plan().short_since, None);
    assert_eq!(t.plan().founding_site, None);
}

#[test]
fn is_over_when_nothing_is_short_so_the_next_dip_gets_its_own_game_day() {
    let (mut t, full) = dipping(1.0);
    let since = t.plan().full_since;
    t.plan_city();
    t.world.tick += (NPC_FULL_DIP_DAYS * DAY) as u64;
    t.home_stock().insert(Good::Food, full);
    t.plan_city();
    assert_eq!(t.plan().short_since, None);
    assert_eq!(t.plan().full_since, since);

    t.world.tick += 60;
    t.home_stock().insert(Good::Food, 1.0);
    t.plan_city();
    assert_eq!(t.plan().short_since, Some(t.world.tick as f64));
    assert_eq!(t.plan().full_since, since);
}

#[test]
fn starts_nothing_in_a_city_with_no_wait_under_way() {
    let (mut t, _) = dipping(1.0);
    t.plan_mut().full_since = None;
    t.plan_city();
    assert_eq!(t.plan().short_since, None);
}

#[test]
fn still_sets_a_party_out_once_nothing_is_short_its_wait_kept() {
    let (mut t, full) = dipping(NPC_FULL_DAYS + 1.0);
    t.plan_city();
    t.home_stock().insert(Good::Food, full);
    t.world.tick += 60;
    t.plan_city();
    assert_eq!(t.party().len() as f64, NPC_VILLAGE.residents);
    assert_eq!(t.plan().short_since, None);
}

// the full-wait-sound invariant

fn plan_with(over: serde_json::Value) -> Town {
    let mut t = full_town(300);
    t.world.tick = 100;
    let mut plan = json!({ "plannedAt": 0, "jobs": {} });
    for (k, v) in over.as_object().unwrap() {
        plan[k] = v.clone();
    }
    let city = t.city.clone();
    t.world.city_plans.insert(city, serde_json::from_value(plan).unwrap());
    t
}

#[test]
fn holds_for_a_dip_in_a_wait_under_way() {
    let t = plan_with(json!({ "fullSince": 10, "shortSince": 50 }));
    assert_eq!(full_wait_sound(&t.world), []);
}

#[test]
fn finds_a_dip_with_no_wait_under_way_or_with_a_party_out_or_to_come() {
    for over in [
        json!({ "shortSince": 50 }),
        json!({ "fullSince": 10, "shortSince": 50, "jobs": { "gone": { "kind": "found" } } }),
        json!({ "fullSince": 10, "shortSince": 101 }),
    ] {
        let t = plan_with(over);
        assert_eq!(full_wait_sound(&t.world).len(), 1);
    }
}

// the founding-parties-sound invariant

/// A town with a plan of `members` in its founding party (`withParty`).
fn with_party(members: usize) -> Town {
    let jobs: serde_json::Map<String, serde_json::Value> =
        (0..members).map(|i| (format!("gone{i}"), json!({ "kind": "found" }))).collect();
    plan_with(json!({ "jobs": jobs, "foundingSite": { "x": 250, "y": 250 } }))
}

#[test]
fn holds_for_the_largest_party() {
    let t = with_party(NPC_FOUND_PARTY_MOST as usize);
    assert_eq!(founding_parties_sound(&t.world), []);
}

#[test]
fn finds_a_party_past_the_largest() {
    let t = with_party(NPC_FOUND_PARTY_MOST as usize + 1);
    assert_eq!(founding_parties_sound(&t.world).len(), 1);
}

// a daughter

/// A town hall of no city at (x, y), and the city founded on it (`foundCity`).
fn hall_and_city(world: &mut WorldState, x: f64, y: f64) -> (String, String) {
    let id = new_id("b", &mut world.next_id);
    world.buildings.push(crate::test_support::building(&id, BuildingKind::TownHall, None, x, y));
    let hall = world.buildings.len() - 1;
    let c = found_city(world, hall, None);
    (id, world.cities[c].id.clone())
}

/// A village's worth of grown residents of `city`, in a row from (118, 124) (`people`).
fn settlers(world: &mut WorldState, city: &str, carried: &Stock, grown: bool) -> Vec<usize> {
    let mut m = Mulberry32::new(11.0);
    (0..NPC_VILLAGE.residents as usize)
        .map(|i| {
            let id = new_id("r", &mut world.next_id);
            let fields = NewResident {
                id: &id,
                owner: None,
                city_id: Some(city),
                x: 118.0 + i as f64,
                y: 124.0,
                tick: world.tick as f64,
            };
            let mut r = new_resident(&mut || m.next(), &fields, None);
            if grown {
                r.born_at = world.tick as f64 - ticks_for_age(30.0);
            }
            r.carried = carried.clone();
            world.residents.push(r);
            world.residents.len() - 1
        })
        .collect()
}

#[test]
fn has_its_armed_founder_bring_what_they_carry_to_its_first_storage_then_stand_as_a_soldier() {
    let terrain = plains(240);
    let mut world = create_world(&terrain, 1);
    let (_, city) = hall_and_city(&mut world, 120.0, 120.0);
    update_city_membership(&mut world, terrain.size);
    let people = settlers(&mut world, &city, &Stock::from([(Good::Food, 15.0)]), true);
    // Wood the storage needs is on the one who is armed, as much as they can carry: nobody else
    // can finish it. The rest is on the others.
    let need = BUILD_MATERIALS.get("storage").unwrap();
    let (need_wood, need_stone) = (need.get("wood").unwrap(), need.get("stone").unwrap());
    let tick = world.tick as f64;
    let room = |w: &WorldState, i: usize| carry_capacity(&w.residents[i], tick) - 1.0;
    let mut by_room = people.clone();
    by_room.sort_by(|a, b| room(&world, *b).total_cmp(&room(&world, *a)));
    let (armed, rest) = (by_room[0], &by_room[1..]);
    let on_armed = need_wood.min((room(&world, armed) - good_weight(Good::Spear)).floor());
    assert!(on_armed > 0.0);
    world.residents[armed].carried =
        Stock::from([(Good::Food, 1.0), (Good::Spear, 1.0), (Good::Wood, on_armed)]);
    let (mut wood, mut stone) = (need_wood - on_armed, need_stone);
    for &i in rest {
        let fits = room(&world, i).floor();
        let w = wood.min(fits);
        let s = stone.min(fits - w);
        world.residents[i].carried =
            Stock::from([(Good::Food, 1.0), (Good::Wood, w), (Good::Stone, s)]);
        wood -= w;
        stone -= s;
    }
    let storage = |w: &WorldState| {
        w.buildings.iter().any(|b| {
            b.kind == BuildingKind::Storage
                && b.city_id.as_deref() == Some(city.as_str())
                && b.site.is_none()
        })
    };
    run(&mut world, &terrain, (8.0 * DAY) as usize, &storage);
    assert!(storage(&world));
    let a = &world.residents[armed];
    assert_eq!(held(&a.carried, Good::Wood), 0.0);
    assert_eq!(held(&a.carried, Good::Stone), 0.0);
    assert_eq!(held(&a.carried, Good::Spear), 1.0);
    let id = a.id.clone();
    run(&mut world, &terrain, DAY as usize, &|_| false);
    let a = world.residents.iter().find(|r| r.id == id).unwrap();
    assert_ne!(a.script.as_ref().and_then(|s| s.task), Some(csp_shared::world::Task::Build));
    let job = world.city_plans.get(&city).and_then(|p| p.jobs.get(&id)).map(|j| j.kind);
    assert_eq!(job, Some(CityJobKind::Soldier));
}

#[test]
fn has_a_founder_gone_back_for_materials_come_to_it_instead_once_the_town_hall_stands() {
    let mut t = full_town(1300);
    let storage = t.home();
    let (_, daughter) = hall_and_city(&mut t.world, 700.0, 60.0);
    let city = t.city.clone();
    let both: Vec<usize> = (0..t.world.residents.len())
        .filter(|&i| {
            let r = &t.world.residents[i];
            r.city_id.as_deref() == Some(city.as_str()) && r.carrying.is_none()
        })
        .take(2)
        .collect();
    let (back, there) = (both[0], both[1]);
    let script = |memory: serde_json::Value| -> RunningScript {
        serde_json::from_value(json!({ "scriptId": 0, "task": "build", "memory": memory })).unwrap()
    };
    let fetch = json!({ "storageId": storage.id, "goods": { "wood": 28 } });
    t.world.residents[back].script = Some(script(
        json!({ "building": "townHall", "at": { "x": 700, "y": 60 }, "fetch": fetch }),
    ));
    t.world.residents[back].order = Some(
        serde_json::from_value::<ResidentOrder>(json!({
            "kind": "walkTo", "target": { "x": storage.x, "y": storage.y }, "path": null,
            "progress": 0,
        }))
        .unwrap(),
    );
    t.world.residents[there].script =
        Some(script(json!({ "building": "townHall", "at": { "x": 700, "y": 60 } })));
    t.plan_city();
    let (back_id, there_id) =
        (t.world.residents[back].id.clone(), t.world.residents[there].id.clone());
    let plan = t.plan_mut();
    plan.founding_site = Some(Tile { x: 700.0, y: 60.0 });
    plan.jobs.insert(back_id, found_job());
    plan.jobs.insert(there_id, found_job());

    assert_eq!(found_daughter(&mut t.world, &city), Some(daughter.clone()));

    let b = &t.world.residents[back];
    assert_eq!(b.city_id.as_deref(), Some(daughter.as_str()));
    assert!(b.script.is_none());
    assert_eq!(b.order, None);
    let th = &t.world.residents[there];
    assert_eq!(th.city_id.as_deref(), Some(daughter.as_str()));
    assert_eq!(th.script.as_ref().and_then(|s| s.task), Some(csp_shared::world::Task::Build));
}

#[test]
fn builds_its_storage_a_farm_and_a_house_in_that_order_then_walls_itself() {
    let mut terrain = plains(240);
    let mut world = create_world(&terrain, 1);
    let (hall, city) = hall_and_city(&mut world, 120.0, 120.0);
    update_city_membership(&mut world, terrain.size);
    node(&mut world, &mut terrain, ResourceKind::Forest, 160.0, 120.0);
    let carried = Stock::from([(Good::Food, 15.0), (Good::Wood, 5.0), (Good::Stone, 2.0)]);
    settlers(&mut world, &city, &carried, false);
    let mut order: Vec<BuildingKind> = Vec::new();
    let of_city = |w: &WorldState, k: BuildingKind| {
        w.buildings.iter().any(|b| {
            b.kind == k
                && (b.city_id.as_deref() == Some(city.as_str()) || b.site.is_some())
                && b.id != hall
        })
    };
    let walls = |w: &WorldState| -> Vec<Building> {
        w.buildings
            .iter()
            .filter(|b| {
                matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate) && b.site.is_none()
            })
            .cloned()
            .collect()
    };
    let mut runner = Runner::new(&terrain);
    let mut topped_up = false;
    for _ in 0..(40.0 * DAY) as usize {
        runner.step(&mut world, &terrain);
        for k in [BuildingKind::Storage, BuildingKind::Farm, BuildingKind::House] {
            if !order.contains(&k) && of_city(&world, k) {
                order.push(k);
            }
        }
        // Its lumber camp and farm would fill the storage in time; here it gets the Wood and
        // Food at once.
        let storage = world.buildings.iter_mut().find(|b| {
            b.kind == BuildingKind::Storage
                && b.city_id.as_deref() == Some(city.as_str())
                && b.site.is_none()
        });
        if let Some(s) = storage {
            if order.contains(&BuildingKind::House) && !topped_up {
                let stock = s.stock.get_or_insert_with(Stock::new);
                stock.insert(Good::Wood, 600.0);
                stock.insert(Good::Food, 300.0);
                topped_up = true;
            }
        }
        if world.tick.is_multiple_of(DAY as u64) {
            assert_eq!(check_all(&world, &terrain), []);
        }
        if walls(&world).iter().any(|b| b.kind == BuildingKind::Gate) {
            break;
        }
    }
    assert_eq!(order, [BuildingKind::Storage, BuildingKind::Farm, BuildingKind::House]);
    let home = npc_home(&world, &city).unwrap();
    let ring = walls(&world);
    assert!(ring.iter().any(|b| b.kind == BuildingKind::Gate));
    let d = (NPC_VILLAGE.size / 2.0).floor();
    for b in &ring {
        assert_eq!((b.x - home.x).abs().max((b.y - home.y).abs()), d);
    }
    assert!(ring.len() as f64 > 8.0 * d - 8.0);
    assert!(ring.iter().all(|b| b.city_id.as_deref() == Some(city.as_str())));
}

// the daughter stays on the mainland (T100.5)

#[test]
fn looks_for_its_daughter_only_on_land_its_people_walk_to_never_across_the_sea() {
    let mut t = full_town(1600);
    let home = t.home();
    let (hx, size) = (home.x as i32, t.terrain.size);
    // Two straits of Sea run north to south 300 tiles either side of the town: the land between
    // them is its own, and the land beyond them, in reach of a founding party, an island.
    for y in 0..size {
        for d in 300..340 {
            for x in [hx + d, hx - d] {
                t.terrain.tiles[tile_index(size, x, y)] = Terrain::Sea as u8;
            }
        }
    }
    let mut found = 0;
    for _ in 0..8 {
        t.world.tick += 977;
        let Some(site) = t.site() else { continue };
        found += 1;
        let dx = csp_shared::terrain::wrap_delta(hx, site.x as i32, size).abs();
        assert!(dx < 300, "a site across the sea at {site:?}");
    }
    assert!(found > 0);
}

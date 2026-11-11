//! `apps/server/src/npc-horses.test.ts`, ported (T86.17): NPC cities have horses and breed them
//! (`CONTEXT.md`: NPC horses, Breeding, Horse stats): two to start with and Food by them, a stable
//! over them, and foals up to the number wanted for their size.

use csp_shared::balance::{
    NpcCitySize, HORSE_FOOD_PER_DAY, MAX_HUNGER, NPC_HORSES_BASE, NPC_RESIDENTS_PER_HORSE,
    NPC_START_HORSES, NPC_START_HORSE_FOOD_DAYS, NPC_TOWN, NPC_VILLAGE, OWN_FOOD, STABLE_CAPACITY,
    TRADING_POST,
};
use csp_shared::footprint::is_at;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, City, CityProject, Good, Horse, Realm, Resident, Stock, Task,
    TradeOrgCity, WorldState,
};
use csp_shared::{footprint::Placed, terrain::TerrainMap};
use serde_json::json;

use super::{found_npc_city, give_horses_to_npc_cities, give_npc_horses};
use crate::horses::{new_horse, NewHorse};
use crate::invariants::check_all;
use crate::npc_growth::next_project;
use crate::npc_stable::trade_org_breeds_no_horses;
use crate::npc_test_world::{plains, storage_of, village, Runner, Village};
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::horses::{horses_in, owns_horse, HorseOwner};
use crate::queries::names::placed;
use crate::queries::npc_trade::{
    npc_horses_wanted, npc_reserve, npc_stable_keep, npc_stables_lack,
};
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::terrain_gen::generate_terrain;
use crate::world::{create_world, generate_world};

fn horses_of<'w>(world: &'w WorldState, city: &City) -> Vec<&'w Horse> {
    world.horses.iter().filter(|h| owns_horse(HorseOwner::City(&city.id), h)).collect()
}

fn stable_of<'w>(world: &'w WorldState, city: &City) -> Option<&'w Building> {
    world
        .buildings
        .iter()
        .find(|b| b.kind == BuildingKind::Stable && b.city_id.as_deref() == Some(city.id.as_str()))
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

/// Runs the world with the invariants checked every game day; `each` after every tick.
fn run(
    world: &mut WorldState,
    terrain: &TerrainMap,
    ticks: usize,
    mut each: impl FnMut(&mut WorldState),
) {
    let mut runner = Runner::new(terrain);
    for _ in 0..ticks {
        runner.step(world, terrain);
        each(world);
        if world.tick.is_multiple_of(TICKS_PER_GAME_DAY as u64) {
            assert_eq!(check_all(world, terrain), []);
        }
    }
    assert_eq!(check_all(world, terrain), []);
}

fn days(n: f64) -> usize {
    (n * TICKS_PER_GAME_DAY) as usize
}

fn set_storage(v: &mut Village, goods: Stock) {
    let i = storage_of(&v.world, &v.city);
    v.world.buildings[i].stock = Some(goods);
}

fn everyone_carries_food(world: &mut WorldState) {
    for r in &mut world.residents {
        r.carried.insert(Good::Food, OWN_FOOD);
    }
}

/// A village with its two horses in a finished stable with plenty of Food, and a full storage.
fn stabled() -> (Village, String) {
    let mut v = village(None);
    let city = v.city.clone();
    give_npc_horses(&mut v.world, &v.terrain, &city);
    let h = horses_of(&v.world, v.city())[0].clone();
    let mut stable = Building {
        id: "stable1".into(),
        kind: BuildingKind::Stable,
        city_id: Some(city.clone()),
        realm_id: None,
        x: h.x - 1.0,
        y: h.y - 1.0,
        stock: Some(stock(&[(Good::Food, 500.0)])),
        site: None,
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
    };
    stable.stock = Some(stock(&[(Good::Food, 500.0)]));
    v.world.buildings.push(stable);
    v.world.piles.clear(); // the stable has its Food; none of it lies on its footprint
    set_storage(&mut v, stock(&[(Good::Food, 2000.0)]));
    everyone_carries_food(&mut v.world);
    (v, "stable1".into())
}

fn building_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Building {
    world.buildings.iter_mut().find(|b| b.id == id).unwrap()
}

fn building<'w>(world: &'w WorldState, id: &str) -> &'w Building {
    world.buildings.iter().find(|b| b.id == id).unwrap()
}

mod with_horses {
    use super::*;

    #[test]
    fn a_new_village_or_town_has_two_fed_horses_with_food_by_them_trading_posts_and_the_hq_none() {
        let terrain = generate_terrain(1, 1440);
        let world = generate_world(&terrain, 1);
        let npc: Vec<&City> = world.cities.iter().filter(|c| c.trade_org.is_none()).collect();
        assert!(!npc.is_empty());
        for city in npc {
            let own = horses_of(&world, city);
            assert_eq!(own.len() as f64, NPC_START_HORSES);
            for h in own {
                assert_eq!(h.realm_id, None);
                assert_eq!(h.hunger, MAX_HUNGER);
                let pile = world.piles.iter().find(|p| p.x == h.x && p.y == h.y);
                assert_eq!(
                    pile.and_then(|p| p.goods.get(&Good::Food)).copied(),
                    Some(
                        (NPC_START_HORSES * NPC_START_HORSE_FOOD_DAYS * HORSE_FOOD_PER_DAY).ceil()
                    )
                );
            }
        }
        for city in world.cities.iter().filter(|c| c.trade_org == Some(TradeOrgCity::Post)) {
            assert!(horses_of(&world, city).is_empty());
        }
        assert_eq!(check_all(&world, &terrain), []);
    }

    #[test]
    fn the_same_world_always_gets_the_same_horses() {
        let horses = || {
            let mut v = village(None);
            let city = v.city.clone();
            give_npc_horses(&mut v.world, &v.terrain, &city);
            v.world.horses
        };
        assert_eq!(horses(), horses());
    }

    #[test]
    fn stands_them_inside_the_wall_on_ground_a_stable_fits_far_from_the_home() {
        let mut v = village(None);
        let city = v.city.clone();
        give_npc_horses(&mut v.world, &v.terrain, &city);
        let h = horses_of(&v.world, v.city())[0].clone();
        let far = (h.x - v.home.x).abs().max((h.y - v.home.y).abs());
        assert!(far > 8.0, "{far}");
        let (x, y) = next_project_stable(&mut v);
        assert!(is_at((h.x as i32, h.y as i32), Placed { kind: "stable", x, y }, 200));
    }

    #[test]
    fn puts_them_in_the_stable_a_city_already_has() {
        let (mut v, stable) = stabled();
        let city = v.city.clone();
        v.world.horses.retain(|h| !owns_horse(HorseOwner::City(&city), h));
        v.world.piles.clear();
        give_npc_horses(&mut v.world, &v.terrain, &city);
        let own = horses_of(&v.world, v.city());
        let in_stable = horses_in(&v.world.horses, building(&v.world, &stable));
        assert_eq!(in_stable.len() as f64, NPC_START_HORSES);
        assert_eq!(own.len() as f64, NPC_START_HORSES);
    }
}

/// The stable the city would lay out next, with wood enough that nothing comes before it.
fn next_project_stable(v: &mut Village) -> (i32, i32) {
    let i = storage_of(&v.world, &v.city);
    v.world.buildings[i].stock.get_or_insert_with(Stock::new).insert(Good::Wood, 500.0);
    match next_project(&v.world, v.city(), &v.home, &v.terrain) {
        Some(CityProject::Build { building: BuildingKind::Stable, x, y }) => (x as i32, y as i32),
        other => panic!("wanted a stable, got {other:?}"),
    }
}

mod the_migration_of_npc_horses {
    use super::*;

    #[test]
    fn gives_an_npc_city_with_none_two_and_leaves_one_with_horses_posts_the_hq_and_players_alone() {
        let terrain = plains(600);
        let mut world = create_world(&terrain, 1);
        let found = |world: &mut WorldState, kind, x, y, seed: f64| {
            let mut m = Mulberry32::new(seed);
            found_npc_city(world, &terrain, kind, x, y, &mut || m.next(), None)
        };
        let none = found(&mut world, &NPC_VILLAGE, 20, 20, 1.0);
        let some = found(&mut world, &NPC_VILLAGE, 300, 20, 2.0);
        let post_size = NpcCitySize {
            size: TRADING_POST.size,
            residents: TRADING_POST.residents,
            houses: TRADING_POST.houses,
            farms: TRADING_POST.farms,
            food: TRADING_POST.food,
        };
        let post = found(&mut world, &post_size, 20, 300, 3.0);
        world.cities.iter_mut().find(|c| c.id == post).unwrap().trade_org =
            Some(TradeOrgCity::Post);
        let player = found(&mut world, &NPC_VILLAGE, 300, 300, 4.0);
        world.cities.iter_mut().find(|c| c.id == player).unwrap().realm_id = Some("r1".into());
        let mut rand = Mulberry32::new(5.0);
        let tick = world.tick as f64;
        let old = new_horse(
            &mut || rand.next(),
            NewHorse {
                id: "old".into(),
                realm_id: None,
                city_id: Some(some.clone()),
                x: 310.0,
                y: 30.0,
                tick,
            },
        );
        world.horses.push(old);
        give_horses_to_npc_cities(&mut world, &terrain);
        let of = |city: &str| -> Vec<String> {
            world
                .horses
                .iter()
                .filter(|h| owns_horse(HorseOwner::City(city), h))
                .map(|h| h.id.clone())
                .collect()
        };
        assert_eq!(of(&none).len() as f64, NPC_START_HORSES);
        assert_eq!(of(&some), vec!["old".to_string()]);
        assert!(of(&post).is_empty());
        assert!(world.horses.iter().all(|h| h.city_id.as_deref() != Some(player.as_str())));
    }
}

mod the_stable_of_an_npc_city_with_horses {
    use super::*;

    #[test]
    fn goes_up_around_them_they_stand_in_it_fed_and_it_is_fed_from_then_on() {
        let mut v = village(None);
        let city = v.city.clone();
        give_npc_horses(&mut v.world, &v.terrain, &city);
        set_storage(&mut v, stock(&[(Good::Food, 1000.0), (Good::Wood, 200.0)]));
        everyone_carries_food(&mut v.world);
        run(&mut v.world, &v.terrain, days(25.0), |_| {});
        let stable = stable_of(&v.world, v.city()).expect("a stable").clone();
        assert!(stable.site.is_none());
        let own = horses_of(&v.world, v.city());
        assert!(own.len() as f64 >= NPC_START_HORSES);
        for h in own {
            assert!(is_at((h.x as i32, h.y as i32), placed(&stable), 200));
            assert!(h.hunger > 0.0);
        }
        assert!(
            stable.stock.as_ref().and_then(|s| s.get(&Good::Food)).copied().unwrap_or(0.0) > 0.0
        );
    }

    #[test]
    #[ignore = "7.0 s alone; see #1132"]
    fn takes_its_time_from_a_village_with_no_wood_at_all_and_the_food_by_them_lasts() {
        let mut v = village(None);
        let city = v.city.clone();
        give_npc_horses(&mut v.world, &v.terrain, &city);
        set_storage(&mut v, stock(&[(Good::Food, 1000.0)]));
        everyone_carries_food(&mut v.world);
        let mut up_at: Option<u64> = None;
        let city_id = v.city.clone();
        run(&mut v.world, &v.terrain, days(NPC_START_HORSE_FOOD_DAYS), |world| {
            let s = world.buildings.iter().find(|b| {
                b.kind == BuildingKind::Stable && b.city_id.as_deref() == Some(city_id.as_str())
            });
            if up_at.is_none() && s.is_some_and(|s| s.site.is_none()) {
                up_at = Some(world.tick);
            }
        });
        assert!(up_at.is_some());
        assert!(horses_of(&v.world, v.city()).len() as f64 >= NPC_START_HORSES);
    }
}

mod how_many_horses_an_npc_city_wants {
    use super::*;

    #[test]
    fn grows_with_its_size_up_to_what_a_stable_holds() {
        let mut v = village(None);
        let residents =
            v.world.residents.iter().filter(|r| r.city_id.as_deref() == Some(&v.city)).count();
        assert_eq!(residents as f64, NPC_VILLAGE.residents);
        assert_eq!(
            npc_horses_wanted(&v.world, v.city()),
            NPC_HORSES_BASE + (residents as f64 / NPC_RESIDENTS_PER_HORSE).floor()
        );
        let city = v.city.clone();
        let mut m = Mulberry32::new(1.0);
        let mut big = create_world(&v.terrain, 1);
        for i in 0..(NPC_TOWN.residents * 4.0) as usize {
            let id = format!("big{i}");
            let fields = NewResident {
                id: &id,
                owner: None,
                city_id: Some(&city),
                x: 0.0,
                y: 0.0,
                tick: 0.0,
            };
            big.residents.push(new_resident(&mut || m.next(), &fields, None));
        }
        assert_eq!(npc_horses_wanted(&big, v.city()), STABLE_CAPACITY);
        let mut post = v.city().clone();
        post.trade_org = Some(TradeOrgCity::Post);
        assert_eq!(npc_horses_wanted(&v.world, &post), 0.0);
        v.world.cities.clear();
    }
}

mod an_npc_city_breeding_its_horses {
    use super::*;

    fn breeders(world: &WorldState) -> Vec<&Resident> {
        world
            .residents
            .iter()
            .filter(|r| {
                r.script.as_ref().is_some_and(|s| s.script_id == 0 && s.task == Some(Task::Breed))
            })
            .collect()
    }

    fn count(world: &WorldState, city: &str) -> usize {
        world.horses.iter().filter(|h| owns_horse(HorseOwner::City(city), h)).count()
    }

    #[test]
    #[ignore = "6.8 s alone; see #1132"]
    fn stops_at_the_number_it_wants() {
        let (mut v, stable) = stabled();
        let city = v.city.clone();
        let wanted = npc_horses_wanted(&v.world, v.city());
        assert!(wanted > NPC_START_HORSES);
        let (mut most, mut bred) = (0, false);
        run(&mut v.world, &v.terrain, days(45.0), |world| {
            most = most.max(count(world, &city));
            bred |= !breeders(world).is_empty();
            building_mut(world, &stable).stock.as_mut().unwrap().insert(Good::Food, 500.0);
        });
        assert!(bred);
        assert_eq!(most as f64, npc_horses_wanted(&v.world, v.city()));
        assert!(breeders(&v.world).is_empty());
    }

    #[test]
    fn starts_no_breeding_at_the_number() {
        let (mut v, stable) = stabled();
        let city = v.city.clone();
        let mut rand = Mulberry32::new(9.0);
        let (sx, sy) = {
            let s = building(&v.world, &stable);
            (s.x, s.y)
        };
        while (count(&v.world, &city) as f64) < npc_horses_wanted(&v.world, v.city()) {
            let id = format!("extra{}", v.world.horses.len());
            let tick = v.world.tick as f64;
            v.world.horses.push(new_horse(
                &mut || rand.next(),
                NewHorse { id, realm_id: None, city_id: Some(city.clone()), x: sx, y: sy, tick },
            ));
        }
        run(&mut v.world, &v.terrain, days(1.0), |world| assert!(breeders(world).is_empty()));
    }

    #[test]
    fn starts_none_while_food_is_short() {
        let (mut v, _) = stabled();
        set_storage(&mut v, Stock::new());
        run(&mut v.world, &v.terrain, days(0.25), |world| assert!(breeders(world).is_empty()));
    }

    #[test]
    fn starts_one_below_the_number_with_two_fed_horses_in_the_stable() {
        let (mut v, _) = stabled();
        let mut bred = false;
        run(&mut v.world, &v.terrain, days(0.25), |world| bred |= !breeders(world).is_empty());
        assert!(bred);
        assert_eq!(breeders(&v.world).len(), 1);
    }

    #[test]
    fn feeds_and_breeds_a_horse_a_player_sold_it() {
        let (mut v, stable) = stabled();
        let city_id = v.city.clone();
        let theirs_id = horses_of(&v.world, v.city())[0].id.clone();
        let (tx, ty) = {
            let h = v.world.horses.iter_mut().find(|h| h.id == theirs_id).unwrap();
            h.realm_id = Some("r1".into());
            h.city_id = None;
            (h.x, h.y)
        };
        v.world.realms.push(
            serde_json::from_value::<Realm>(
                json!({ "id": "r1", "userId": 7, "leaderId": "seller" }),
            )
            .unwrap(),
        );
        let mut m = Mulberry32::new(3.0);
        let fields =
            NewResident { id: "seller", owner: Some("r1"), city_id: None, x: tx, y: ty, tick: 0.0 };
        let mut seller = new_resident(&mut || m.next(), &fields, None);
        seller.born_at = -20.0 * 24.0 * 3600.0;
        seller.lifespan = 60.0;
        v.world.residents.push(seller);
        set_storage(&mut v, stock(&[(Good::Food, 2000.0), (Good::Coins, 1000.0)]));
        let kept_alone = npc_stable_keep(&v.world, v.city(), building(&v.world, &stable));

        // With one horse of its own it breeds nothing.
        run(&mut v.world, &v.terrain, 30, |world| assert!(breeders(world).is_empty()));

        let mut queue =
            OrderQueue::new(order_kinds(), Some(std::sync::Arc::new(v.terrain.clone())));
        let sender = OrderSender::player(7, "Mara");
        let answer = queue.receive(
            &v.world,
            &sender,
            &json!("q"),
            &json!({ "kind": "sellHorse", "residentId": "seller", "horseId": theirs_id }),
        );
        assert!(matches!(answer, OrderReply::Ack { .. }), "{answer:?}");
        queue.apply_all(&mut v.world);
        run(&mut v.world, &v.terrain, 1, |_| {});
        let theirs = v.world.horses.iter().find(|h| h.id == theirs_id).unwrap();
        assert!(owns_horse(HorseOwner::City(&city_id), theirs));
        assert!(npc_stable_keep(&v.world, v.city(), building(&v.world, &stable)) > kept_alone);

        // It keeps Food in the stable for it, however low the stable has run.
        building_mut(&mut v.world, &stable).stock.as_mut().unwrap().insert(Good::Food, 0.0);
        assert_eq!(
            npc_stables_lack(&v.world, v.city()),
            npc_stable_keep(&v.world, v.city(), building(&v.world, &stable))
        );
        let (mut refilled, mut bred) = (false, false);
        let stable_id = stable.clone();
        run(&mut v.world, &v.terrain, days(0.25), |world| {
            refilled |= building(world, &stable_id)
                .stock
                .as_ref()
                .and_then(|s| s.get(&Good::Food))
                .copied()
                .unwrap_or(0.0)
                > 0.0;
            bred |= !breeders(world).is_empty();
        });
        assert!(refilled);
        assert!(bred);
    }

    #[test]
    fn the_trade_organizations_cities_dont_breed_and_the_invariant_says_so() {
        let (mut v, _) = stabled();
        {
            let c = v.city_mut();
            c.trade_org = Some(TradeOrgCity::Post);
            c.layout = None;
        }
        run(&mut v.world, &v.terrain, days(0.25), |world| assert!(breeders(world).is_empty()));
        let city = v.city.clone();
        assert_eq!(trade_org_breeds_no_horses(&v.world), vec![]);
        let r = v.world.residents.iter_mut().find(|x| x.city_id.as_deref() == Some(&city)).unwrap();
        r.script = Some(
            serde_json::from_value(json!({
                "scriptId": 0, "task": "breed",
                "memory": { "stableId": "stable1", "horseIds": [] }
            }))
            .unwrap(),
        );
        assert_eq!(trade_org_breeds_no_horses(&v.world).len(), 1);
    }
}

mod a_daughter_with_no_horse {
    use super::*;

    /// A village with no horse and everything its reserve asks for in store, so nothing is short.
    fn stocked() -> Village {
        let mut v = village(None);
        let mut goods = npc_reserve(&v.world, v.city());
        for n in goods.values_mut() {
            *n += 1000.0;
        }
        set_storage(&mut v, goods);
        v
    }

    fn builds_a_stable(v: &Village) -> bool {
        matches!(
            next_project(&v.world, v.city(), &v.home, &v.terrain),
            Some(CityProject::Build { building: BuildingKind::Stable, .. })
        )
    }

    #[test]
    fn wants_no_stable_while_something_is_short() {
        let mut v = stocked();
        set_storage(&mut v, Stock::new());
        assert!(!builds_a_stable(&v));
    }

    #[test]
    fn builds_a_stable_once_nothing_is_short_so_a_player_can_sell_it_one() {
        let v = stocked();
        assert!(builds_a_stable(&v));
    }

    #[test]
    fn wants_no_second_one() {
        let mut v = stocked();
        let mut b = Building {
            id: "stable1".into(),
            kind: BuildingKind::Stable,
            city_id: Some(v.city.clone()),
            realm_id: None,
            x: 25.0,
            y: 25.0,
            stock: None,
            site: None,
            teardown: None,
            closed: None,
            damage: None,
            breedings: None,
        };
        b.stock = None;
        v.world.buildings.push(b);
        assert!(!builds_a_stable(&v));
    }
}

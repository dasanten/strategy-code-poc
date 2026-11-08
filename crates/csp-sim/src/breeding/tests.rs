//! `apps/server/src/breeding.test.ts`, the fast parts, ported one to one. `stepWorld` is the
//! breeding phase alone (`request_breeding`, `resolve_breeding`, the tick turning): nothing else
//! in the tick touches a stable here. The invariants are T86.13's, the Breed task is the default
//! scripts' (T86.12), NPC cities' breeding is T86.10's; the walkTo order is T86.2's, so another
//! order is set directly.

use csp_shared::balance::{FOAL_STAT_SPREAD, MAX_HEALTH, MAX_HUNGER, STABLE_CAPACITY};
use csp_shared::world::{
    BreedOrder, BuildingKind, ConstructionSite, Good, Horse, HorseStats, KeptBreeding,
    RealmEventWhat, Tile, WorldState,
};

use super::*;
use crate::pending::people::HORSE_NAMES;
use crate::test_world::{building, empty_world, live, live_mut, realm, resident};

const SIZE: i32 = 16;
const ME: Sender = Sender { user_id: 7, npc_city_id: None };
const TICKS: usize = STABLE_BREED_TICKS as usize;

/// Realm r1 (Player 7) with Leader w1 at a finished stable at (8, 8), with plenty of Food, and
/// two horses of r1 in it: a fast weak one and a slow strong one.
fn setup() -> WorldState {
    let mut world = empty_world();
    realm(&mut world, "r1", 7, "w1");
    resident(&mut world, "w1", Some("r1"), 9.0, 9.0);
    live_mut(&mut world, "w1").carried = [(Good::Food, 50.0)].into_iter().collect();
    let s = building(&mut world, "s1", BuildingKind::Stable, None, 8.0, 8.0);
    world.buildings[s].stock = Some([(Good::Food, 10_000.0)].into_iter().collect());
    horse(
        &mut world,
        "h1",
        8.0,
        8.0,
        HorseStats { speed: 14.0, strength: 6.0, endurance: 10.0 },
        Some("r1"),
    );
    horse(
        &mut world,
        "h2",
        10.0,
        10.0,
        HorseStats { speed: 6.0, strength: 14.0, endurance: 12.0 },
        Some("r1"),
    );
    world
}

fn average() -> HorseStats {
    HorseStats { speed: 10.0, strength: 10.0, endurance: 10.0 }
}

fn horse(
    world: &mut WorldState,
    id: &str,
    x: f64,
    y: f64,
    stats: HorseStats,
    realm_id: Option<&str>,
) {
    world.horses.push(Horse {
        id: id.into(),
        name: "Rowan".into(),
        realm_id: realm_id.map(str::to_string),
        city_id: None,
        x,
        y,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats,
        born_at: 0.0,
        down_until: None,
    });
}

fn breed_order(resident: &str, ids: Option<Vec<&str>>) -> BreedRequest {
    BreedRequest {
        resident_id: Some(resident.into()),
        stable_id: Some("s1".into()),
        horse_ids: ids.map(|ids| ids.into_iter().map(str::to_string).collect()),
    }
}

/// Sends a breed order as Player 7; the reason it was turned down, if it was.
fn order(world: &mut WorldState, o: &BreedRequest) -> Option<&'static str> {
    let reason = validate_breed(world, &ME, o);
    if reason.is_none() {
        apply_breed(world, o);
    }
    reason
}

fn h1h2() -> BreedRequest {
    breed_order("w1", Some(vec!["h1", "h2"]))
}

fn steps(world: &mut WorldState, n: usize) {
    for _ in 0..n {
        let actions = request_breeding(world);
        resolve_breeding(world, &actions, SIZE);
        world.tick += 1;
    }
}

fn progress(world: &WorldState, id: &str) -> Option<f64> {
    match &live(world, id).unwrap().order {
        Some(csp_shared::world::ResidentOrder::Breed(o)) => Some(o.progress),
        _ => None,
    }
}

fn kept(world: &WorldState) -> Option<Vec<KeptBreeding>> {
    world.buildings.iter().find(|b| b.id == "s1").unwrap().breedings.clone()
}

fn pair(progress: f64) -> Option<Vec<KeptBreeding>> {
    Some(vec![KeptBreeding { horse_ids: ["h1".into(), "h2".into()], progress }])
}

#[test]
fn brings_a_foal_with_its_parents_average_stats_after_a_resident_tends_them_for_stable_breed_days()
{
    let mut world = setup();
    assert_eq!(order(&mut world, &h1h2()), None);
    steps(&mut world, TICKS - 1);
    assert_eq!(world.horses.len(), 2);
    assert_eq!(progress(&world, "w1"), Some(STABLE_BREED_TICKS - 1.0));
    steps(&mut world, 1);
    assert_eq!(world.horses.len(), 3);
    let foal = world.horses[2].clone();
    assert_eq!(
        (foal.realm_id.as_deref(), foal.x, foal.y, foal.hunger),
        (Some("r1"), 8.0, 8.0, MAX_HUNGER)
    );
    assert_eq!(foal.born_at, world.tick as f64 - 1.0);
    // A foal gets a name from the pool like any new horse.
    assert!(HORSE_NAMES.contains(&foal.name.as_str()));
    // Parents average 10 Speed, 10 Strength, 11 Endurance.
    assert!((foal.stats.speed - 10.0).abs() <= FOAL_STAT_SPREAD);
    assert!((foal.stats.strength - 10.0).abs() <= FOAL_STAT_SPREAD);
    assert!((foal.stats.endurance - 11.0).abs() <= FOAL_STAT_SPREAD);
    assert_eq!(live(&world, "w1").unwrap().order, None);
    assert!(world.events.iter().any(|e| e.user_id == 7
        && e.what
            == RealmEventWhat::Foaled {
                horse_id: foal.id.clone(),
                stable_id: "s1".into(),
                name: Some(foal.name.clone())
            }));
}

#[test]
fn pauses_when_the_resident_leaves_and_carries_on_where_it_stopped_when_they_come_back() {
    let mut world = setup();
    let half = TICKS / 2;
    order(&mut world, &h1h2());
    steps(&mut world, half);
    live_mut(&mut world, "w1").x = 2.0;
    steps(&mut world, 1);
    assert_eq!(live(&world, "w1").unwrap().order, None);
    // The stable keeps the pair's progress while nobody tends them.
    assert_eq!(kept(&world), pair(half as f64));
    steps(&mut world, 20);
    assert_eq!(kept(&world), pair(half as f64));
    live_mut(&mut world, "w1").x = 9.0;
    // Picked the other way round, it is the same pair.
    assert_eq!(order(&mut world, &breed_order("w1", Some(vec!["h2", "h1"]))), None);
    assert_eq!(progress(&world, "w1"), Some(half as f64));
    steps(&mut world, half - 1);
    assert_eq!(world.horses.len(), 2);
    steps(&mut world, 1);
    assert_eq!(world.horses.len(), 3);
    // Born, the foal takes the progress with it.
    assert_eq!(kept(&world), None);
}

#[test]
fn pauses_when_the_resident_is_given_another_order_another_resident_carries_on_with_the_pair() {
    let mut world = setup();
    order(&mut world, &h1h2());
    steps(&mut world, 10);
    live_mut(&mut world, "w1").order =
        Some(csp_shared::world::ResidentOrder::WalkTo(csp_shared::world::WalkOrder {
            target: Tile { x: 2.0, y: 2.0 },
            path: None,
            progress: 0.0,
            army: None,
        }));
    steps(&mut world, TICKS);
    assert_eq!(world.horses.len(), 2);
    assert_eq!(kept(&world), pair(10.0));
    resident(&mut world, "w2", Some("r1"), 8.0, 9.0);
    live_mut(&mut world, "w2").carried = [(Good::Food, 50.0)].into_iter().collect();
    assert_eq!(order(&mut world, &breed_order("w2", Some(vec!["h1", "h2"]))), None);
    assert_eq!(progress(&world, "w2"), Some(10.0));
    steps(&mut world, TICKS - 11);
    assert_eq!(world.horses.len(), 2);
    steps(&mut world, 1);
    assert_eq!(world.horses.len(), 3);
}

#[test]
fn loses_its_progress_when_a_horse_leaves_the_stable_or_dies_tended_or_not() {
    let mut left = setup();
    order(&mut left, &h1h2());
    steps(&mut left, 10);
    left.horses[1].x = 2.0;
    steps(&mut left, 1);
    assert_eq!(live(&left, "w1").unwrap().order, None);
    assert_eq!(kept(&left), None);
    // Back in the stable, the pair starts over.
    left.horses[1].x = 10.0;
    order(&mut left, &h1h2());
    assert_eq!(progress(&left, "w1"), Some(0.0));

    let mut died = setup();
    order(&mut died, &h1h2());
    steps(&mut died, 10);
    died.horses.pop();
    steps(&mut died, 1);
    assert_eq!(live(&died, "w1").unwrap().order, None);
    assert_eq!(kept(&died), None);

    // Paused, the progress goes all the same when a horse leaves.
    let mut paused = setup();
    order(&mut paused, &h1h2());
    steps(&mut paused, 10);
    live_mut(&mut paused, "w1").x = 2.0;
    steps(&mut paused, 1);
    assert_eq!(kept(&paused).map(|k| k.len()), Some(1));
    paused.horses[0].x = 3.0;
    steps(&mut paused, 1);
    assert_eq!(kept(&paused), None);
}

#[test]
fn pauses_while_the_stable_has_no_room_left_and_goes_on_once_there_is() {
    let mut world = setup();
    order(&mut world, &h1h2());
    steps(&mut world, 10);
    for i in 2..STABLE_CAPACITY as usize {
        horse(&mut world, &format!("x{i}"), 9.0, 9.0, average(), Some("r1"));
    }
    steps(&mut world, 5);
    assert_eq!(progress(&world, "w1"), Some(10.0));
    assert_eq!(kept(&world), pair(10.0));
    world.horses.iter_mut().find(|h| h.id == "x2").unwrap().x = 2.0;
    steps(&mut world, 1);
    assert_eq!(progress(&world, "w1"), Some(11.0));
}

#[test]
fn needs_an_adult_at_a_finished_stable_and_two_fed_horses_of_the_realm_in_it_with_room_for_a_foal()
{
    let reason = |change: &dyn Fn(&mut WorldState), o: BreedRequest| {
        let mut world = setup();
        change(&mut world);
        order(&mut world, &o).unwrap_or("")
    };
    assert!(reason(&|w| live_mut(w, "w1").x = 2.0, h1h2()).contains("not standing at that stable"));
    assert!(reason(
        &|w| {
            let t = w.tick as f64;
            live_mut(w, "w1").born_at = t
        },
        h1h2()
    )
    .contains("children"));
    let site: ConstructionSite =
        serde_json::from_value(serde_json::json!({ "delivered": {}, "work": 0 })).unwrap();
    assert!(reason(&|w| w.buildings[0].site = Some(site.clone()), h1h2()).contains("finished"));
    assert!(reason(&|w| w.horses[0].hunger = 0.0, h1h2()).contains("hungry"));
    assert!(reason(&|w| w.horses[1].realm_id = Some("r2".into()), h1h2())
        .contains("not horses of your"));
    assert!(reason(&|w| w.horses[1].x = 12.0, h1h2()).contains("in the stable"));
    assert!(reason(&|_| {}, breed_order("w1", Some(vec!["h1", "h1"]))).contains("two horses"));
    assert!(reason(&|_| {}, breed_order("w1", None)).contains("two horses"));
    let crowd = |w: &mut WorldState| {
        for i in 2..STABLE_CAPACITY as usize {
            horse(w, &format!("x{i}"), 9.0, 9.0, average(), Some("r1"));
        }
    };
    assert!(reason(&crowd, h1h2()).contains("no room"));
    // Two residents can't breed the same horses at once.
    let rival = |w: &mut WorldState| {
        resident(w, "w2", Some("r1"), 8.0, 9.0);
        live_mut(w, "w2").order = Some(csp_shared::world::ResidentOrder::Breed(BreedOrder {
            stable_id: "s1".into(),
            horse_ids: ["h2".into(), "h1".into()],
            at: Tile { x: 8.0, y: 9.0 },
            progress: 0.0,
        }));
    };
    assert!(reason(&rival, h1h2()).contains("already being bred"));
}

#[test]
fn gives_a_foal_stats_near_its_parents_average_whole_and_at_least_1() {
    let mut rand = Mulberry32::new(5.0);
    for _ in 0..200 {
        let s = foal_stats(
            &mut rand,
            &HorseStats { speed: 1.0, strength: 30.0, endurance: 7.0 },
            &HorseStats { speed: 1.0, strength: 2.0, endurance: 8.0 },
        );
        assert!(s.speed >= 1.0);
        assert!((s.strength - 16.0).abs() <= FOAL_STAT_SPREAD);
        assert!((s.endurance - 8.0).abs() <= FOAL_STAT_SPREAD);
        for v in [s.speed, s.strength, s.endurance] {
            assert_eq!(v.fract(), 0.0);
        }
    }
}

// `keptBreedingsSound` and `breedOrdersSound` are `invariants.ts`'s: T86.13. The Breed horses
// task runs the default scripts: T86.12. NPC cities breeding: T86.10.

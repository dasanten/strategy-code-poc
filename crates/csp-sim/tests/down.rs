//! `apps/server/src/down.test.ts`, ported one to one.

use std::sync::Arc;

use csp_shared::balance::{DOWN_DAYS, MAX_HEALTH};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    CrimeKind, DeathCause, Good, RealmEventWhat, Resident, ResidentOrder, Stat, Stock, Tile,
    WalkOrder, WorldState,
};
use serde_json::{json, Value};

use csp_sim::combat::{attack_order, resolve_strikes, StrikeAction};
use csp_sim::defence::NoAlarms;
use csp_sim::events::events_for;
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::random::Mulberry32;
use csp_sim::residents::{new_resident, NewResident};
use csp_sim::sight::entities_in_sight;
use csp_sim::survival::{down_do_nothing, go_down, step_survival, DOWN_TICKS};
use csp_sim::tick::Scratch;
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use csp_sim::world_index::WorldIndex;

const SIZE: i32 = 256;

fn terrain() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

fn me() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn tobin() -> OrderSender {
    OrderSender::player(8, "Tobin")
}

/// The invariants about Down and the dead (`DOWN_INVARIANTS`: `CONTEXT.md`: Down, Loot, Leader).
const DOWN_INVARIANTS: [&str; 3] = ["down-do-nothing", "dead-leave-loot", "leaders-serve-no-one"];

fn down_invariants(world: &WorldState, terrain: &TerrainMap) -> Vec<String> {
    check_all(world, terrain)
        .into_iter()
        .filter(|v| DOWN_INVARIANTS.contains(&v.invariant.as_str()))
        .map(|v| v.message)
        .collect()
}

struct Setup {
    world: WorldState,
    terrain: TerrainMap,
    queue: OrderQueue,
}

/// A world with realm r1 (Player 7, Leader a1, and Ana, a2) and realm r2 (Player 8, Leader b1)
/// standing next to each other (`setup`).
fn setup() -> Setup {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    for (id, user, leader) in [("r1", 7, "a1"), ("r2", 8, "b1")] {
        world.realms.push(
            serde_json::from_value(json!({ "id": id, "userId": user, "leaderId": leader }))
                .unwrap(),
        );
    }
    resident(&mut world, "a1", Some("r1"), 10.0, 10.0);
    resident(&mut world, "a2", Some("r1"), 10.0, 11.0).name = "Ana".into();
    resident(&mut world, "b1", Some("r2"), 11.0, 10.0);
    let queue = OrderQueue::new(order_kinds(), Some(Arc::new(terrain.clone())));
    Setup { world, terrain, queue }
}

/// A grown resident at (x, y) with every stat 10 and no Agility, so they never dodge
/// (`resident`).
fn resident<'w>(
    world: &'w mut WorldState,
    id: &str,
    owner: Option<&str>,
    x: f64,
    y: f64,
) -> &'w mut Resident {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner, city_id: None, x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    let ten = Stat { base: 10.0, trained: 0.0 };
    r.stats.strength = ten.clone();
    r.stats.endurance = ten.clone();
    r.stats.intellect = ten;
    r.stats.agility = Stat { base: 0.0, trained: 0.0 };
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    world.residents.last_mut().unwrap()
}

fn at<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).expect("there")
}

fn there(world: &WorldState, id: &str) -> bool {
    world.residents.iter().any(|r| r.id == id)
}

fn index_of(world: &WorldState, id: &str) -> usize {
    world.residents.iter().position(|r| r.id == id).expect("there")
}

fn is_down(r: &Resident) -> bool {
    r.down_until.is_some()
}

/// Starves a resident to their last bit of health, with nothing to eat (`starving`).
fn starving(r: &mut Resident) {
    r.hunger = 0.0;
    r.health = 0.0001;
    r.carried = Stock::new();
}

fn stock(goods: &[(Good, f64)]) -> Stock {
    goods.iter().copied().collect()
}

/// Steps the world, keeping everyone but those named fed, and checks the Down invariants
/// (`run`).
fn run(s: &mut Setup, ticks: usize, hungry: &[&str], walking: Option<&mut Walking>) {
    let mut scratch = Scratch::default();
    let mut walking = walking;
    for _ in 0..ticks {
        for r in &mut s.world.residents {
            if !hungry.contains(&r.id.as_str()) {
                r.hunger = 100.0;
            }
        }
        let w: Option<&mut dyn csp_sim::tick::Walk> = match walking.as_deref_mut() {
            Some(w) => Some(w),
            None => None,
        };
        step_world(&mut s.world, &s.terrain, &mut scratch, w, None);
        assert_eq!(down_invariants(&s.world, &s.terrain), Vec::<String>::new());
    }
}

fn walk_order(x: f64, y: f64) -> ResidentOrder {
    ResidentOrder::WalkTo(WalkOrder {
        target: Tile { x, y },
        path: None,
        progress: 0.0,
        army: None,
    })
}

fn receive(s: &mut Setup, sender: &OrderSender, id: &str, order: Value) -> OrderReply {
    s.queue.receive(&s.world, sender, &json!(id), &order)
}

fn rejected(reply: &OrderReply) -> Option<&str> {
    match reply {
        OrderReply::Rejected { reason, .. } => Some(reason),
        OrderReply::Ack { .. } => None,
    }
}

fn died_events(world: &WorldState, user: u64) -> Vec<(String, DeathCause, bool, Option<String>)> {
    events_for(world, user, 0)
        .into_iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::Died { resident_id, cause, leader, by, .. } => {
                Some((resident_id.clone(), *cause, *leader, by.clone()))
            }
            _ => None,
        })
        .collect()
}

// Down (`CONTEXT.md`: Down)

#[test]
fn lasts_about_one_real_day() {
    assert_eq!(DOWN_TICKS, DOWN_DAYS * TICKS_PER_GAME_DAY);
    // One tick is one real second.
    assert!(DOWN_TICKS / 3600.0 > 20.0);
    assert!(DOWN_TICKS / 3600.0 < 28.0);
}

#[test]
fn puts_a_resident_whose_health_hunger_used_up_down_instead_of_killing_them() {
    let mut s = setup();
    starving(at(&mut s.world, "a2"));
    at(&mut s.world, "a2").carried = stock(&[(Good::Stone, 3.0)]);
    let tick = s.world.tick as f64;
    run(&mut s, 1, &["a2"], None);
    assert!(there(&s.world, "a2"));
    let ana = at(&mut s.world, "a2").clone();
    assert!(is_down(&ana));
    assert_eq!(ana.down_until, Some(tick + DOWN_TICKS));
    assert_eq!(ana.health, 0.0);
    assert_eq!(ana.carried, stock(&[(Good::Stone, 3.0)]));
    assert!(events_for(&s.world, 7, 0).iter().any(|e| matches!(
        &e.what,
        RealmEventWhat::Down { resident_id, name, until }
            if resident_id == "a2" && name == "Ana" && Some(*until) == ana.down_until
    )));
    assert!(died_events(&s.world, 7).is_empty());
}

#[test]
fn ends_their_order_script_and_queue_gets_them_off_their_horse_and_out_of_their_army() {
    let mut s = setup();
    let ana = at(&mut s.world, "a2");
    starving(ana);
    ana.order = Some(walk_order(40.0, 11.0));
    ana.script = Some(serde_json::from_value(json!({ "scriptId": 3, "memory": {} })).unwrap());
    ana.queue = Some(
        serde_json::from_value(json!({
            "realmId": "r1", "steps": [], "current": 0, "startedAt": null, "loop": false,
            "nextStepId": 1,
        }))
        .unwrap(),
    );
    ana.riding = Some("h1".into());
    s.world.armies.push(
        serde_json::from_value(json!({
            "id": "army1", "name": "Guard", "realmId": "r1", "memberIds": ["a1", "a2"],
            "order": null,
        }))
        .unwrap(),
    );
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    let ana = &s.world.residents[i];
    assert_eq!(ana.order, None);
    assert!(ana.script.is_none());
    assert!(ana.queue.is_none());
    assert!(ana.riding.is_none());
    assert_eq!(s.world.armies[0].member_ids, vec!["a1".to_string()]);
    assert_eq!(down_do_nothing(&s.world), vec![]);
}

#[test]
fn neither_eats_nor_loses_health_while_down_and_dies_of_hunger_when_the_time_is_up() {
    let mut s = setup();
    starving(at(&mut s.world, "a2"));
    run(&mut s, 1, &["a2"], None);
    // Food put in their hands isn't eaten while Down (Reviving is another rule).
    at(&mut s.world, "a2").carried = stock(&[(Good::Food, 2.0)]);
    run(&mut s, 50, &["a2"], None);
    let ana = at(&mut s.world, "a2").clone();
    assert_eq!(ana.carried, stock(&[(Good::Food, 2.0)]));
    assert_eq!(ana.hunger, 0.0);
    assert_eq!(ana.health, 0.0);
    s.world.tick = (ana.down_until.unwrap() - 1.0) as u64;
    run(&mut s, 1, &["a2"], None);
    assert!(there(&s.world, "a2"));
    run(&mut s, 1, &["a2"], None);
    assert!(!there(&s.world, "a2"));
    assert!(died_events(&s.world, 7).contains(&("a2".into(), DeathCause::Starved, false, None)));
    // What they held drops where they lay.
    assert_eq!(s.world.piles.len(), 1);
    let p = &s.world.piles[0];
    assert_eq!((p.x, p.y, p.goods.clone()), (10.0, 11.0, stock(&[(Good::Food, 2.0)])));
}

#[test]
fn refuses_orders_to_a_down_resident_in_an_army_too() {
    let mut s = setup();
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    let walk = receive(
        &mut s,
        &me(),
        "w",
        json!({ "kind": "walkTo", "residentId": "a2", "x": 20, "y": 11 }),
    );
    assert_eq!(
        walk,
        OrderReply::Rejected {
            request_id: "w".into(),
            reason: "Ana is Down and takes no orders".into()
        }
    );
    let army = receive(
        &mut s,
        &me(),
        "f",
        json!({ "kind": "formArmy", "name": "Guard", "residentIds": ["a1", "a2"] }),
    );
    assert!(rejected(&army).is_some());
    s.queue.apply_all(&mut s.world);
    assert_eq!(s.world.residents[i].order, None);
    assert!(s.world.armies.is_empty());
}

#[test]
fn drops_an_order_that_came_before_they_went_down() {
    let mut s = setup();
    let walk = receive(
        &mut s,
        &me(),
        "w",
        json!({ "kind": "walkTo", "residentId": "a2", "x": 20, "y": 11 }),
    );
    assert_eq!(rejected(&walk), None);
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    s.queue.apply_all(&mut s.world);
    assert_eq!(s.world.residents[i].order, None);
}

#[test]
fn keeps_them_lying_still_when_the_game_gives_them_an_order_anyway() {
    let mut s = setup();
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    // As a fight or an army would: an order set after they went Down.
    s.world.residents[i].order = Some(walk_order(20.0, 11.0));
    let mut walking = Walking::new(Arc::new(s.terrain.clone()));
    run(&mut s, 5, &["a2"], Some(&mut walking));
    let ana = at(&mut s.world, "a2");
    assert_eq!((ana.x, ana.y), (10.0, 11.0));
    assert_eq!(ana.order, None);
}

#[test]
fn keeps_a_down_leader_leading_the_realm_goes_on_until_they_die() {
    let mut s = setup();
    starving(at(&mut s.world, "a1"));
    run(&mut s, 1, &["a1"], None);
    assert!(is_down(at(&mut s.world, "a1")));
    let realms: Vec<String> = s.world.realms.iter().map(|r| r.id.clone()).collect();
    assert_eq!(realms, ["r1", "r2"]);
    s.world.tick = at(&mut s.world, "a1").down_until.unwrap() as u64;
    let ended = step_survival(&mut s.world, &s.terrain, &mut Scratch::default()).ended;
    assert_eq!(ended.iter().map(|r| r.id.clone()).collect::<Vec<_>>(), ["r1"]);
}

#[test]
fn still_kills_in_a_fight_wounds_put_nobody_down() {
    let mut s = setup();
    at(&mut s.world, "a2").health = 1.0;
    let reply = receive(
        &mut s,
        &tobin(),
        "a",
        json!({ "kind": "attack", "residentId": "b1", "targetId": "a2" }),
    );
    assert_eq!(rejected(&reply), None);
    s.queue.apply_all(&mut s.world);
    for _ in 0..100 {
        if !there(&s.world, "a2") {
            break;
        }
        run(&mut s, 1, &[], None);
    }
    assert!(!there(&s.world, "a2"));
    assert!(!s.world.residents.iter().any(is_down));
    assert!(died_events(&s.world, 7).iter().any(|d| d.0 == "a2" && d.1 == DeathCause::Killed));
}

#[test]
fn shows_anyone_in_sight_that_they_are_down_and_when_it_ends_only_to_those_who_see_how_they_fare() {
    let mut s = setup();
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    let seen = |realm: &str| -> Value {
        let index = WorldIndex::new(&s.world, SIZE);
        let all = entities_in_sight(&s.world, &index, Some(realm), None);
        let e = all.iter().map(|e| serde_json::to_value(e).unwrap()).find(|e| e["id"] == "a2");
        e.expect("Ana in sight")
    };
    let theirs = seen("r2");
    assert_eq!((theirs["is"].clone(), theirs["down"].clone()), (json!("resident"), json!(true)));
    assert!(theirs.get("downUntil").is_none());
    let own = seen("r1");
    assert_eq!(own["down"], json!(true));
    assert_eq!(own["downUntil"], json!(s.world.residents[i].down_until.unwrap()));
}

#[test]
fn is_caught_by_the_invariant_when_someone_down_does_something_or_heals() {
    let mut s = setup();
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    s.world.residents[i].order = Some(walk_order(20.0, 11.0));
    s.world.residents[i].health = MAX_HEALTH;
    let found: Vec<String> = down_do_nothing(&s.world).into_iter().map(|v| v.message).collect();
    assert_eq!(
        found,
        [
            "resident a2 is Down but has a walkTo order".to_string(),
            format!("resident a2 is Down but has health {MAX_HEALTH}"),
        ]
    );
}

// Down is not safe (`CONTEXT.md`: Down, Crime)

fn from_ana() -> Value {
    json!({ "kind": "resident", "residentId": "a2" })
}

#[test]
fn lets_one_of_the_same_realm_on_the_tile_take_what_they_carry_as_from_a_pile() {
    let mut s = setup();
    at(&mut s.world, "a2").carried = stock(&[(Good::Stone, 3.0), (Good::Food, 2.0)]);
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    let (x, y) = (s.world.residents[i].x, s.world.residents[i].y);
    let leader = at(&mut s.world, "a1");
    (leader.x, leader.y) = (x, y);
    let order = json!({ "kind": "pickUp", "residentId": "a1", "spot": from_ana(), "goods": { "stone": 2 } });
    assert_eq!(rejected(&receive(&mut s, &me(), "p", order)), None);
    s.queue.apply_all(&mut s.world);
    run(&mut s, 1, &["a2"], None);
    assert_eq!(at(&mut s.world, "a1").carried.get(&Good::Stone), Some(&2.0));
    assert_eq!(at(&mut s.world, "a2").carried, stock(&[(Good::Stone, 1.0), (Good::Food, 2.0)]));
    assert!(s.world.crimes.is_empty());
}

#[test]
fn makes_taking_from_another_realms_down_resident_theft() {
    let mut s = setup();
    at(&mut s.world, "a2").carried = stock(&[(Good::Stone, 3.0)]);
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    let (x, y) = (s.world.residents[i].x, s.world.residents[i].y);
    let b = at(&mut s.world, "b1");
    (b.x, b.y) = (x, y);
    let order = json!({ "kind": "pickUp", "residentId": "b1", "spot": from_ana(), "goods": { "stone": 5 } });
    assert_eq!(rejected(&receive(&mut s, &tobin(), "p", order)), None);
    s.queue.apply_all(&mut s.world);
    run(&mut s, 1, &["a2"], None);
    assert_eq!(at(&mut s.world, "b1").carried.get(&Good::Stone), Some(&3.0));
    assert_eq!(at(&mut s.world, "a2").carried, Stock::new());
    assert_eq!(s.world.crimes.len(), 1);
    let c = &s.world.crimes[0];
    assert_eq!((c.kind, c.victim_org.as_str()), (CrimeKind::Theft, "r1"));
    let victim = c.victim.as_ref().map(|v| (v.resident_id.as_str(), v.name.as_str()));
    assert_eq!(victim, Some(("a2", "Ana")));
    assert_eq!(c.goods, Some(stock(&[(Good::Stone, 3.0)])));
    assert_eq!((c.culprit.resident_id.as_str(), c.culprit.org.as_str()), ("b1", "r2"));
    // Lying unconscious, Ana saw nothing; the Leader next to her did.
    assert_eq!(c.witnesses, ["a1"]);
}

#[test]
fn refuses_taking_from_someone_not_down_or_not_on_the_tile_and_putting_goods_on_them() {
    let mut s = setup();
    at(&mut s.world, "a2").carried = stock(&[(Good::Stone, 3.0)]);
    at(&mut s.world, "a1").carried = stock(&[(Good::Wood, 1.0)]);
    let take = |s: &mut Setup, resident_id: &str, sender: &OrderSender| {
        let order = json!({
            "kind": "pickUp", "residentId": resident_id, "spot": from_ana(), "goods": { "stone": 1 },
        });
        receive(s, sender, "t", order)
    };
    let (x, y) = (at(&mut s.world, "a2").x, at(&mut s.world, "a2").y);
    let leader = at(&mut s.world, "a1");
    (leader.x, leader.y) = (x, y);
    assert_eq!(
        rejected(&take(&mut s, "a1", &me())),
        Some("nobody of that id lies Down on the resident’s tile")
    );
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    // b1 stands next to Ana, not on her tile.
    assert!(rejected(&take(&mut s, "b1", &tobin())).is_some());
    let put = receive(
        &mut s,
        &me(),
        "d",
        json!({ "kind": "drop", "residentId": "a1", "spot": from_ana(), "goods": { "wood": 1 } }),
    );
    assert_eq!(rejected(&put), Some("goods can’t be put down on a resident"));
    assert_eq!(at(&mut s.world, "b1").carried, Stock::new());
}

#[test]
fn kills_them_with_the_first_blow_lying_down_they_cant_dodge() {
    let mut s = setup();
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    // However nimble, someone Down doesn't dodge.
    s.world.residents[i].stats.agility = Stat { base: 100.0, trained: 0.0 };
    let (x, y) = (s.world.residents[i].x, s.world.residents[i].y);
    let b = at(&mut s.world, "b1");
    (b.x, b.y) = (x, y);
    b.order = Some(ResidentOrder::Attack(attack_order("a2", false, false)));
    let strikes = [StrikeAction { attacker_id: "b1".into(), target_id: "a2".into() }];
    let result =
        resolve_strikes(&mut s.world, &strikes, SIZE, &mut NoAlarms, &mut Default::default());
    assert_eq!(result.died, ["a2"]);
    assert!(!there(&s.world, "a2"));
}

#[test]
fn dies_like_anyone_when_attacked_killed_a_crime_leaving_what_they_carried() {
    let mut s = setup();
    at(&mut s.world, "a2").carried = stock(&[(Good::Stone, 3.0)]);
    let i = index_of(&s.world, "a2");
    go_down(&mut s.world, i);
    let reply = receive(
        &mut s,
        &tobin(),
        "a",
        json!({ "kind": "attack", "residentId": "b1", "targetId": "a2" }),
    );
    assert_eq!(rejected(&reply), None);
    s.queue.apply_all(&mut s.world);
    for _ in 0..100 {
        if !there(&s.world, "a2") {
            break;
        }
        run(&mut s, 1, &["a2"], None);
    }
    assert!(!there(&s.world, "a2"));
    let b_name = at(&mut s.world, "b1").name.clone();
    assert!(died_events(&s.world, 7).contains(&(
        "a2".into(),
        DeathCause::Killed,
        false,
        Some(b_name)
    )));
    let kinds: Vec<CrimeKind> = s.world.crimes.iter().map(|c| c.kind).collect();
    assert_eq!(kinds, [CrimeKind::Attack, CrimeKind::Killing]);
    assert_eq!(s.world.piles.len(), 1);
    let p = &s.world.piles[0];
    assert_eq!((p.x, p.y, p.goods.clone()), (10.0, 11.0, stock(&[(Good::Stone, 3.0)])));
    assert_eq!(at(&mut s.world, "b1").order, None);
}

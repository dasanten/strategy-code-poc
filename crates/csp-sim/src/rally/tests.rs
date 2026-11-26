//! Rallying the crew (T116.2, `CONTEXT.md`: Rallying the crew, Zeal; ADR 0042): a rallied farm,
//! lumber camp and construction site make three times as much; the Leader makes nothing; Zeal
//! drains only while a crew works; each way it ends, the rest of the Zeal staying; walking with a
//! load isn't faster; another realm's workers aren't rallied; no script call or queue step can
//! start it; and the invariant.

use std::sync::Arc;

use csp_shared::balance::{
    DEFEND_CALM_TICKS, RALLY_PACE, ZEAL_CAP_HOURS, ZEAL_PER_RALLIED_TICK, ZEAL_PER_TICK,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    AttackOrder, BuildOrder, BuildingKind, ConstructionSite, GivenUnderAttack, Good, Resident,
    ResidentOrder, ResourceKind, ResourceNode, Stock, Tile, WorldState,
};
use serde_json::json;

use super::*;
use crate::invariants::check_all;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queue::{can_be_queue_step, queue_steps_problem};
use crate::realm_test_world::{building, plains, realm_id, resident, world_with_realms};
use crate::script_api::SCRIPT_API;
use crate::script_bindings::{army_script_order_kinds, script_order_kinds};
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::step_world;

const MARA: u64 = 1;
const TOBIN: u64 = 2;
const LEADER: &str = "leader1";

/// The farm's north-west tile; its 4 × 4 footprint runs to (7, 9).
const FARM: (f64, f64) = (4.0, 6.0);
/// The lumber camp, on the Forest node at (3, 1).
const CAMP: (f64, f64) = (3.0, 1.0);
/// A house being built.
const SITE: (f64, f64) = (30.0, 30.0);

fn terrain() -> TerrainMap {
    let mut t = plains(48);
    t.tiles[48 + 3] = Terrain::Forest as u8;
    t
}

/// Mara's and Tobin's realms on plains with a farm, a lumber camp on its node and a house site.
fn setup() -> (WorldState, TerrainMap) {
    let t = terrain();
    let mut world = world_with_realms(&t, &[MARA, TOBIN]);
    world.nodes.push(ResourceNode {
        id: "forest".into(),
        kind: ResourceKind::Forest,
        x: CAMP.0,
        y: CAMP.1,
        richness: Default::default(),
        stock: None,
    });
    world.buildings.push(building("farm", BuildingKind::Farm, None, FARM.0, FARM.1));
    world.buildings.push(building("camp", BuildingKind::LumberCamp, None, CAMP.0, CAMP.1));
    let mut site = building("site", BuildingKind::House, None, SITE.0, SITE.1);
    site.site = Some(ConstructionSite { delivered: Stock::new(), work: 0.0 });
    world.buildings.push(site);
    (world, t)
}

/// Where a place is, by its building id.
fn spot(place: &str) -> (f64, f64) {
    match place {
        "farm" => FARM,
        "camp" => CAMP,
        _ => SITE,
    }
}

/// A resident `id` of Player `user`'s realm set to work `place` (building at the site).
fn worker(world: &mut WorldState, id: &str, user: u64, place: &str) {
    let (x, y) = spot(place);
    let mut r = resident(id, Some(&realm_id(user)), x, y);
    r.order = Some(if place == "site" {
        ResidentOrder::Build(BuildOrder {
            building: BuildingKind::House,
            at: Tile { x, y },
            site_id: Some("site".into()),
            material: None,
        })
    } else {
        let b = world.buildings.iter().find(|b| b.id == place).unwrap().clone();
        crate::work::start_work(&mut r, &b, None);
        r.order.unwrap()
    });
    world.residents.push(r);
}

/// Moves a resident to (x, y).
fn put(world: &mut WorldState, id: &str, (x, y): (f64, f64)) {
    let r = world.residents.iter_mut().find(|r| r.id == id).unwrap();
    (r.x, r.y) = (x, y);
}

fn live<'w>(world: &'w WorldState, id: &str) -> &'w Resident {
    world.residents.iter().find(|r| r.id == id).unwrap()
}

/// Sends an order of Player `user` as the UI does and applies it, as the next tick would.
fn send(world: &mut WorldState, user: u64, order: serde_json::Value) -> Result<(), String> {
    let mut q = OrderQueue::new(order_kinds(), Some(Arc::new(terrain())));
    match q.receive(world, &OrderSender::player(user, "Player"), &json!("r"), &order) {
        OrderReply::Ack { .. } => {
            q.apply_all(world);
            Ok(())
        }
        OrderReply::Rejected { reason, .. } => Err(reason),
    }
}

/// The Player's Leader rallies the crew where they stand.
fn rally(world: &mut WorldState, user: u64) -> Result<(), String> {
    send(world, user, json!({ "kind": RALLY, "residentId": format!("leader{user}") }))
}

fn rallying(world: &WorldState) -> bool {
    matches!(live(world, LEADER).order, Some(ResidentOrder::Rally(_)))
}

/// Steps the world `ticks` times, everyone fed, every invariant holding after each tick.
fn run(world: &mut WorldState, t: &TerrainMap, ticks: usize) {
    let mut scratch = Scratch::default();
    for _ in 0..ticks {
        for r in &mut world.residents {
            r.hunger = 100.0;
        }
        step_world(world, t, &mut scratch, None, None);
        let broken: Vec<String> = check_all(world, t)
            .into_iter()
            .filter(|v| ["rallies-sound", "zeal-within-cap"].contains(&v.invariant.as_str()))
            .map(|v| v.message)
            .collect();
        assert!(broken.is_empty(), "{broken:?}");
    }
}

/// What the workers of `place` made so far: the work on the site, or the units on the piles and
/// the progress toward the next ones of each worker there.
fn made(world: &WorldState, place: &str) -> f64 {
    if place == "site" {
        let site = world.buildings.iter().find(|b| b.id == "site").unwrap();
        return site.site.as_ref().map_or(0.0, |s| s.work);
    }
    let good = if place == "farm" { Good::Food } else { Good::Wood };
    let piled: f64 = world.piles.iter().filter_map(|p| p.goods.get(&good)).sum();
    let progress: f64 = world
        .residents
        .iter()
        .filter_map(|r| match &r.order {
            Some(ResidentOrder::WorkAt(o)) if o.building_id == place => Some(o.progress),
            _ => None,
        })
        .sum();
    piled + progress
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0)
}

#[test]
fn a_rallied_farm_lumber_camp_and_site_make_three_times_as_much() {
    for place in ["farm", "camp", "site"] {
        let (mut plain, t) = setup();
        worker(&mut plain, "w1", MARA, place);
        worker(&mut plain, "w2", MARA, place);
        let mut rallied = plain.clone();
        put(&mut rallied, LEADER, spot(place));
        rally(&mut rallied, MARA).unwrap();
        run(&mut plain, &t, 30);
        run(&mut rallied, &t, 30);
        let (slow, fast) = (made(&plain, place), made(&rallied, place));
        assert!(slow > 0.0, "{place}: nothing made");
        assert!(close(fast, slow * RALLY_PACE), "{place}: {fast} vs {slow}");
        assert!(rallying(&rallied), "{place}");
        // What they learn is as it was: only the pace is multiplied.
        assert_eq!(live(&plain, "w1").skills, live(&rallied, "w1").skills, "{place}");
    }
}

#[test]
fn the_leader_makes_nothing_and_learns_nothing_while_rallying() {
    let (mut world, t) = setup();
    worker(&mut world, "w1", MARA, "farm");
    put(&mut world, LEADER, FARM);
    rally(&mut world, MARA).unwrap();
    let skills = live(&world, LEADER).skills.clone();
    run(&mut world, &t, 30);
    assert!(rallying(&world));
    assert_eq!(live(&world, LEADER).skills, skills);
    // Alone at the farm, they make nothing.
    let (mut alone, t) = setup();
    put(&mut alone, LEADER, FARM);
    rally(&mut alone, MARA).unwrap();
    run(&mut alone, &t, 30);
    assert_eq!(made(&alone, "farm"), 0.0);
}

#[test]
fn zeal_drains_only_while_a_crew_works() {
    // Nobody to rally: the Leader stands there and the pool stays full.
    let (mut world, t) = setup();
    put(&mut world, LEADER, FARM);
    rally(&mut world, MARA).unwrap();
    run(&mut world, &t, 20);
    assert!(rallying(&world));
    assert_eq!(zeal_of(&world, MARA), ZEAL_CAP_HOURS);
    // A worker comes: it drains a game hour an hour, and doesn't fill while the rally runs.
    worker(&mut world, "w1", MARA, "farm");
    run(&mut world, &t, 60);
    let want = ZEAL_CAP_HOURS - 60.0 * ZEAL_PER_RALLIED_TICK;
    assert!(close(zeal_of(&world, MARA), want), "{}", zeal_of(&world, MARA));
    assert_eq!(zeal_of(&world, TOBIN), ZEAL_CAP_HOURS);
}

#[test]
fn zeal_doesnt_fill_while_the_rally_runs_even_with_nobody_at_work() {
    // Daniel, 2026-11-20: the pool pauses while the order runs, also when nothing drains.
    let (mut world, t) = setup();
    put(&mut world, LEADER, FARM);
    set_zeal(&mut world, MARA, 10.0);
    set_zeal(&mut world, TOBIN, 10.0);
    rally(&mut world, MARA).unwrap();
    run(&mut world, &t, 20);
    assert!(rallying(&world));
    assert_eq!(zeal_of(&world, MARA), 10.0);
    // Another Player's pool fills on as ever.
    assert!(close(zeal_of(&world, TOBIN), 10.0 + 20.0 * ZEAL_PER_TICK));
    // Stopped, it fills again from the next tick.
    send(&mut world, MARA, json!({ "kind": "stop", "residentId": LEADER })).unwrap();
    the_rest_stays(&mut world, &t, 10.0);
}

/// A rallied farm with one worker, rallied for 10 ticks: (world, terrain, the Zeal then).
fn rallied_farm() -> (WorldState, TerrainMap, f64) {
    let (mut world, t) = setup();
    worker(&mut world, "w1", MARA, "farm");
    put(&mut world, LEADER, FARM);
    rally(&mut world, MARA).unwrap();
    run(&mut world, &t, 10);
    assert!(rallying(&world));
    let zeal = zeal_of(&world, MARA);
    assert!(zeal < ZEAL_CAP_HOURS);
    (world, t, zeal)
}

/// After a rally ended with `zeal` left, it is all still there and fills from there.
fn the_rest_stays(world: &mut WorldState, t: &TerrainMap, zeal: f64) {
    assert!(!rallying(world));
    run(world, t, 1);
    assert!(close(zeal_of(world, MARA), zeal + ZEAL_PER_TICK), "{}", zeal_of(world, MARA));
}

#[test]
fn it_ends_when_the_player_stops_it_or_gives_another_order() {
    let (mut world, t, zeal) = rallied_farm();
    send(&mut world, MARA, json!({ "kind": "stop", "residentId": LEADER })).unwrap();
    run(&mut world, &t, 1);
    the_rest_stays(&mut world, &t, zeal + ZEAL_PER_TICK);

    let (mut world, t, zeal) = rallied_farm();
    send(&mut world, MARA, json!({ "kind": "workAt", "residentId": LEADER })).unwrap();
    assert!(matches!(live(&world, LEADER).order, Some(ResidentOrder::WorkAt(_))));
    the_rest_stays(&mut world, &t, zeal);
}

#[test]
fn it_ends_when_the_leader_leaves_the_building() {
    let (mut world, t, zeal) = rallied_farm();
    put(&mut world, LEADER, (20.0, 6.0));
    run(&mut world, &t, 1);
    // That tick, nobody was rallied any more: nothing drained, and the pool filled no more than it
    // does while the order runs, which ended only after the filling.
    the_rest_stays(&mut world, &t, zeal);
}

#[test]
fn it_ends_when_the_leader_goes_down() {
    let (mut world, t, zeal) = rallied_farm();
    let i = world.residents.iter().position(|r| r.id == LEADER).unwrap();
    crate::survival::go_down(&mut world, i);
    run(&mut world, &t, 1);
    the_rest_stays(&mut world, &t, zeal + ZEAL_PER_TICK);
}

#[test]
fn it_ends_when_the_zeal_is_used_up() {
    let (mut world, t) = setup();
    worker(&mut world, "w1", MARA, "farm");
    put(&mut world, LEADER, FARM);
    set_zeal(&mut world, MARA, 3.5 * ZEAL_PER_RALLIED_TICK);
    rally(&mut world, MARA).unwrap();
    run(&mut world, &t, 3);
    assert!(rallying(&world));
    // Each tick spends a game hour's worth and fills nothing: it runs out within a few more.
    let per_tick = ZEAL_PER_RALLIED_TICK;
    let left = (3.5 * ZEAL_PER_RALLIED_TICK - 3.0 * per_tick) / per_tick;
    run(&mut world, &t, left.ceil() as usize);
    assert!(!rallying(&world));
    assert_eq!(zeal_of(&world, MARA), 0.0);
    // Empty, it can't be given until some fills back.
    assert_eq!(rally(&mut world, MARA), Err("no Zeal left".into()));
    run(&mut world, &t, 1);
    assert_eq!(rally(&mut world, MARA), Ok(()));
}

/// Tobin's resident attacking the Leader.
fn attacker() -> Resident {
    let mut foe = resident("foe", Some(&realm_id(TOBIN)), FARM.0, FARM.1);
    foe.order = Some(ResidentOrder::Attack(AttackOrder {
        target_id: LEADER.into(),
        path: None,
        progress: 0.0,
        strike: 0.0,
        started: false,
        defending: None,
        army: None,
    }));
    foe
}

/// Runs until the Leader is struck (their health restored each tick, so they never go Down):
/// false if no blow landed within 200 ticks.
fn until_struck(world: &mut WorldState, t: &TerrainMap) -> bool {
    for _ in 0..200 {
        let i = world.residents.iter().position(|r| r.id == LEADER).unwrap();
        world.residents[i].health = 100.0;
        run(world, t, 1);
        if live(world, LEADER).health < 100.0 {
            return true;
        }
    }
    false
}

#[test]
fn a_blow_sets_it_aside_and_it_comes_back_after_the_defence_script() {
    let (mut world, t, _) = rallied_farm();
    world.residents.push(attacker());
    assert!(until_struck(&mut world, &t), "never struck");
    assert!(!rallying(&world));
    // The defence script runs; the rally is what it keeps aside to go back to.
    let kept = live(&world, LEADER).interrupted.as_ref().and_then(|k| k.order.clone());
    assert!(matches!(kept, Some(ResidentOrder::Rally(_))), "{kept:?}");
    let i = world.residents.iter().position(|r| r.id == LEADER).unwrap();
    world.residents.retain(|r| r.id != "foe");
    crate::defence::resume_interrupted(&mut world, i);
    assert!(rallying(&world));
    run(&mut world, &t, 1);
    assert!(rallying(&world));
}

#[test]
fn given_under_attack_it_holds_until_calm() {
    let (mut world, t) = setup();
    worker(&mut world, "w1", MARA, "farm");
    put(&mut world, LEADER, FARM);
    world.residents.push(attacker());
    assert!(until_struck(&mut world, &t), "never struck");
    // Under attack, the Player rallies the crew: it holds until calm, not until done.
    rally(&mut world, MARA).unwrap();
    assert_eq!(live(&world, LEADER).given_under_attack, Some(GivenUnderAttack::UntilCalm));
    // Further blows don't interrupt it.
    for _ in 0..3 {
        assert!(until_struck(&mut world, &t), "never struck again");
        assert!(rallying(&world));
    }
    // No blow for the calm time: the next one runs the defence script, which keeps it aside.
    let foe = world.residents.iter().position(|r| r.id == "foe").unwrap();
    let foe = world.residents.remove(foe);
    run(&mut world, &t, DEFEND_CALM_TICKS as usize + 1);
    assert!(rallying(&world));
    world.residents.push(foe);
    assert!(until_struck(&mut world, &t), "never struck after the calm");
    assert!(!rallying(&world));
    assert_eq!(live(&world, LEADER).given_under_attack, None);
    let kept = live(&world, LEADER).interrupted.as_ref().and_then(|k| k.order.clone());
    assert!(matches!(kept, Some(ResidentOrder::Rally(_))), "{kept:?}");
}

#[test]
fn another_realms_workers_at_the_building_are_not_rallied() {
    let (mut plain, t) = setup();
    worker(&mut plain, "theirs", TOBIN, "farm");
    let mut rallied = plain.clone();
    put(&mut rallied, LEADER, FARM);
    rally(&mut rallied, MARA).unwrap();
    run(&mut plain, &t, 30);
    run(&mut rallied, &t, 30);
    assert!(made(&plain, "farm") > 0.0);
    assert!(close(made(&rallied, "farm"), made(&plain, "farm")));
    // And nobody of Mara's was rallied: her pool stays full.
    assert_eq!(zeal_of(&rallied, MARA), ZEAL_CAP_HOURS);
}

#[test]
fn walking_with_a_load_past_a_rallied_crew_is_no_faster() {
    let (mut plain, t) = setup();
    worker(&mut plain, "w1", MARA, "farm");
    let mut walker = resident("walker", Some(&realm_id(MARA)), FARM.0, FARM.1);
    walker.carried.insert(Good::Food, 5.0);
    plain.residents.push(walker);
    let mut rallied = plain.clone();
    put(&mut rallied, LEADER, FARM);
    rally(&mut rallied, MARA).unwrap();
    let mut positions = Vec::new();
    for world in [&mut plain, &mut rallied] {
        send(world, MARA, json!({ "kind": "walkTo", "residentId": "walker", "x": 40, "y": 6 }))
            .unwrap();
        let mut walking = Walking::new(Arc::new(t.clone()));
        let mut scratch = Scratch::default();
        for _ in 0..40 {
            step_world(world, &t, &mut scratch, Some(&mut walking), None);
        }
        positions.push((live(world, "walker").x, live(world, "walker").y));
    }
    assert!(positions[0].0 > FARM.0, "the walker never walked");
    assert_eq!(positions[0], positions[1]);
    assert!(rallying(&rallied));
}

#[test]
fn only_the_leader_at_a_workplace_or_site_with_zeal_left_rallies() {
    let (mut world, _) = setup();
    worker(&mut world, "w1", MARA, "farm");
    let not_leader = json!({ "kind": RALLY, "residentId": "w1" });
    assert_eq!(send(&mut world, MARA, not_leader), Err("only your Leader rallies the crew".into()));
    assert_eq!(rally(&mut world, MARA), Err("not at a workplace or construction site".into()));
    let theirs = json!({ "kind": RALLY, "residentId": LEADER });
    assert_eq!(send(&mut world, TOBIN, theirs), Err("not one of your residents".into()));
    put(&mut world, LEADER, FARM);
    set_zeal(&mut world, MARA, 0.0);
    assert_eq!(rally(&mut world, MARA), Err("no Zeal left".into()));
    set_zeal(&mut world, MARA, ZEAL_CAP_HOURS);
    assert_eq!(rally(&mut world, MARA), Ok(()));
    assert_eq!(rally(&mut world, MARA), Err("already rallying the crew here".into()));
    // A site counts as much as a workplace.
    put(&mut world, LEADER, SITE);
    assert_eq!(rally(&mut world, MARA), Ok(()));
}

/// The one exception to ADR 0002: no call of the game API, no script order kind and no queue
/// step reaches the rally order kind.
#[test]
fn no_script_call_or_queue_step_can_start_it() {
    assert!(order_kinds().contains(RALLY), "the UI order kind exists");
    let lower = |s: &str| s.to_lowercase();
    assert!(
        !SCRIPT_API.iter().any(|b| lower(b.name).contains("rally")),
        "a game API call names it"
    );
    assert!(!script_order_kinds().contains(&RALLY));
    assert!(!army_script_order_kinds().contains(&RALLY));
    assert!(!can_be_queue_step(RALLY));
    assert_eq!(
        queue_steps_problem(Some(&json!([{ "order": { "kind": RALLY } }]))).as_deref(),
        Some("step 1: rally can't be a queue step")
    );
    // A script the Leader runs, standing at the farm with a crew, requests nothing that rallies.
    let (mut world, t) = setup();
    worker(&mut world, "w1", MARA, "farm");
    put(&mut world, LEADER, FARM);
    let sender = OrderSender::player(MARA, "Player");
    let source = "memory.answer = 1\nworkAt()";
    let (_, requests) = crate::game_test_world::run_script(&world, &t, &sender, LEADER, source);
    assert!(requests.iter().all(|o| o.kind != RALLY), "{requests:?}");
    assert!(!rallying(&world));
}

#[test]
fn invariant_only_a_living_leader_at_the_building_rallies() {
    let (mut world, t, _) = rallied_farm();
    let sound = |w: &WorldState| rallies_sound(w).is_empty();
    assert!(sound(&world));
    // Away from it.
    put(&mut world, LEADER, (20.0, 6.0));
    assert!(!sound(&world));
    put(&mut world, LEADER, FARM);
    // Not a Leader.
    let o = live(&world, LEADER).order.clone();
    world.residents.iter_mut().find(|r| r.id == "w1").unwrap().order = o;
    assert_eq!(rallies_sound(&world).len(), 1);
    world.residents.iter_mut().find(|r| r.id == "w1").unwrap().order = None;
    // Noted at a tick still to come.
    if let Some(ResidentOrder::Rally(o)) =
        world.residents.iter_mut().find(|r| r.id == LEADER).unwrap().order.as_mut()
    {
        o.worked_at = Some(1e9);
    }
    assert!(!sound(&world));
    let _ = t;
}

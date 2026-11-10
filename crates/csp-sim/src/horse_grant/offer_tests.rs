//! `horse-offer.test.ts`: the Horse offer (`CONTEXT.md`: Horse offer). Its "offering horses
//! again" cases need `reopenHorseOffers`, which is the server's: they are in
//! `crates/csp-server/tests/horse_offer.rs`.

use std::sync::Arc;

use crate::script_api::{Is, SCRIPT_API};
use csp_lang::interpreter::{run, RunOptions, RunResult, ValueLimits};
use csp_lang::{parse, Object};
use csp_shared::balance::{
    HORSE_GRANT_FOOD, HORSE_GRANT_HORSES, SCRIPT_MAX_CALL_DEPTH, SCRIPT_VALUE_LIMITS,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    Building, BuildingKind, DeathCause, Good, HorsesWhere, RealmEventWhat, RunningScript,
    WorldState,
};
use serde_json::{json, Value};

use crate::invariants::check_all;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::goods::pile_at;
use crate::queries::names::placed;
use crate::script_bindings::{bind_script, ScriptContext};
use crate::sight::{entities_in_sight, sight_of};
use crate::starting_city::{found_starting_city, realm_of};
use crate::survival::die_all;
use crate::test_support::world_with_post;
use crate::world_index::WorldIndex;

fn player() -> OrderSender {
    OrderSender::player(1, "Mara")
}

/// Player 1's starting city, and a queue that applies each order as the next tick would.
struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
}

fn setup() -> Setup {
    let (world, terrain) = world_with_post();
    Setup { world, terrain: Arc::new(terrain) }
}

impl Setup {
    fn queue(&self) -> OrderQueue {
        OrderQueue::new(order_kinds(), Some(self.terrain.clone()))
    }

    /// Claims the horses as `sender`: `ok`, or why it was turned down.
    fn claim_as(&mut self, sender: &OrderSender) -> String {
        let mut queue = self.queue();
        let answer =
            queue.receive(&self.world, sender, &json!("q"), &json!({ "kind": "claimHorses" }));
        queue.apply_all(&mut self.world);
        match answer {
            OrderReply::Rejected { reason, .. } => reason,
            OrderReply::Ack { .. } => "ok".into(),
        }
    }

    fn claim(&mut self) -> String {
        self.claim_as(&player())
    }

    fn realm_id(&self) -> String {
        let i = realm_of(&self.world, 1).expect("Player 1's realm");
        self.world.realms[i].id.clone()
    }

    fn leader_id(&self) -> String {
        let i = realm_of(&self.world, 1).expect("Player 1's realm");
        self.world.realms[i].leader_id.clone()
    }

    fn realm_horses(&self, realm_id: &str) -> Vec<String> {
        let mine = self.world.horses.iter().filter(|h| h.realm_id.as_deref() == Some(realm_id));
        mine.map(|h| h.id.clone()).collect()
    }

    /// The stable of a city (the starting city's).
    fn stable(&self) -> Building {
        let mut b = self.world.buildings.iter();
        b.find(|b| b.kind == BuildingKind::Stable && b.city_id.is_some()).unwrap().clone()
    }

    fn kill_leader(&mut self) {
        let leader = self.leader_id();
        die_all(&mut self.world, &[leader], DeathCause::Starved, self.terrain.size, None);
    }
}

fn at(x: f64, y: f64, b: &Building, size: i32) -> bool {
    is_at((x as i32, y as i32), placed(b), size)
}

// the Horse offer

#[test]
fn puts_two_new_horses_in_the_realms_stable_as_the_grant_would_and_logs_where() {
    let mut s = setup();
    let realm = s.realm_id();
    let before = s.realm_horses(&realm);
    assert!(!before.is_empty());
    let stable = s.stable();

    assert_eq!(s.claim(), "ok");

    let added: Vec<String> =
        s.realm_horses(&realm).into_iter().filter(|h| !before.contains(h)).collect();
    assert_eq!(added.len(), HORSE_GRANT_HORSES as usize);
    for id in &added {
        let h = s.world.horses.iter().find(|h| &h.id == id).unwrap();
        assert!(at(h.x, h.y, &stable, s.terrain.size));
    }
    let last = s.world.events.last().expect("an event");
    assert_eq!(last.user_id, 1);
    let city = s.world.cities.iter().find(|c| Some(&c.id) == stable.city_id.as_ref()).unwrap();
    assert_eq!(
        last.what,
        RealmEventWhat::HorsesClaimed {
            horse_ids: added,
            r#where: HorsesWhere::Stable,
            city: Some(city.name.clone()),
            x: stable.x,
            y: stable.y,
        }
    );
    assert_eq!(s.world.horse_offers_claimed, [1]);
    assert_eq!(check_all(&s.world, &s.terrain), []);
}

#[test]
fn puts_them_next_to_the_storage_with_food_by_each_when_the_realm_has_no_stable() {
    let mut s = setup();
    let stable = s.stable();
    let size = s.terrain.size;
    s.world.buildings.retain(|b| b.id != stable.id);
    s.world.piles.retain(|p| !at(p.x, p.y, &stable, size));
    s.world.horses.retain(|h| !at(h.x, h.y, &stable, size));
    let realm = s.realm_id();
    let before = s.realm_horses(&realm);

    assert_eq!(s.claim(), "ok");

    let added: Vec<String> =
        s.realm_horses(&realm).into_iter().filter(|h| !before.contains(h)).collect();
    assert_eq!(added.len(), HORSE_GRANT_HORSES as usize);
    for id in &added {
        let h = s.world.horses.iter().find(|h| &h.id == id).unwrap();
        let pile = pile_at(&s.world, h.x, h.y).expect("a pile by the horse");
        assert_eq!(pile.goods, csp_shared::world::Stock::from([(Good::Food, HORSE_GRANT_FOOD)]));
    }
    let last = &s.world.events.last().expect("an event").what;
    assert!(matches!(last, RealmEventWhat::HorsesClaimed { r#where: HorsesWhere::Storage, .. }));
}

#[test]
fn refuses_a_second_claim() {
    let mut s = setup();
    assert_eq!(s.claim(), "ok");
    let after = s.world.clone();
    assert_eq!(s.claim(), "you have claimed your horses already");
    assert_eq!(s.world, after);
}

#[test]
fn takes_only_one_of_two_claims_sent_in_the_same_tick() {
    let mut s = setup();
    let mut queue = s.queue();
    let claim = json!({ "kind": "claimHorses" });
    let a = queue.receive(&s.world, &player(), &json!("a"), &claim);
    let b = queue.receive(&s.world, &player(), &json!("b"), &claim);
    assert!(matches!(a, OrderReply::Ack { .. }));
    assert!(matches!(b, OrderReply::Ack { .. }));
    let horses = s.world.horses.len();
    queue.apply_all(&mut s.world);
    assert_eq!(s.world.horses.len(), horses + HORSE_GRANT_HORSES as usize);
    assert_eq!(s.world.horse_offers_claimed, [1]);
}

#[test]
fn refuses_a_player_without_a_living_leader() {
    let mut s = setup();
    let leader = s.leader_id();
    s.world.residents.retain(|r| r.id != leader);
    assert_eq!(s.claim(), "you have no living Leader");
    assert_eq!(s.claim_as(&OrderSender::player(2, "Tobin")), "you have no living Leader");
    assert!(s.world.horse_offers_claimed.is_empty());
}

#[test]
fn stays_claimed_after_the_leader_dies_and_the_player_founds_a_new_realm() {
    let mut s = setup();
    assert_eq!(s.claim(), "ok");
    s.kill_leader();
    assert!(realm_of(&s.world, 1).is_none());

    found_starting_city(&mut s.world, &s.terrain, 1, None);
    assert_eq!(s.claim(), "you have claimed your horses already");
    assert_eq!(s.world.horse_offers_claimed, [1]);
}

#[test]
fn stays_open_for_a_player_who_never_claimed_it_across_a_leader_death() {
    let mut s = setup();
    s.kill_leader();
    assert_eq!(s.claim(), "you have no living Leader");
    found_starting_city(&mut s.world, &s.terrain, 1, None);
    assert_eq!(s.claim(), "ok");
}

#[test]
fn finds_a_world_where_a_player_claimed_twice_broken_invariant() {
    let mut s = setup();
    s.world.horse_offers_claimed = vec![1, 1];
    let broken: Vec<String> =
        check_all(&s.world, &s.terrain).into_iter().map(|v| v.invariant).collect();
    assert_eq!(broken, ["horse-offers-once"]);
}

// the Horse offer from a script

/// Runs `memory.answer = claimHorses()` as `resident`: the requests it made, and its answer.
fn claim_from_a_script(world: &WorldState, terrain: &TerrainMap, resident: &str) -> (usize, Value) {
    let index = WorldIndex::new(world, terrain.size);
    let sender = player();
    let realm = &world.realms[realm_of(world, 1).unwrap()].id;
    let seen = || entities_in_sight(world, &index, Some(realm), None);
    let eyes = || sight_of(world, &index, realm, None);
    let explored = |_: i32, _: i32| true;
    let kinds = order_kinds();
    let memory = Object::new();
    let ctx = ScriptContext {
        world,
        terrain,
        index: &index,
        sender: &sender,
        resident_id: Some(resident),
        army_id: None,
        memory: memory.clone(),
        seen: &seen,
        eyes: &eyes,
        explored: &explored,
        kinds: &kinds,
        edge: None,
        params: None,
    };
    let mut bound = bind_script(ctx).unwrap();
    let program = parse("memory.answer = claimHorses()").unwrap();
    let limits = ValueLimits {
        max_string_length: SCRIPT_VALUE_LIMITS.max_string_length as usize,
        max_list_length: SCRIPT_VALUE_LIMITS.max_list_length as usize,
        max_object_keys: SCRIPT_VALUE_LIMITS.max_object_keys as usize,
    };
    let options =
        RunOptions { steps: 10_000, max_call_depth: SCRIPT_MAX_CALL_DEPTH as u32, limits };
    let result = run(&program, &mut bound, &options).unwrap();
    assert!(matches!(result, RunResult::Done { .. }), "{result:?}");
    let answer = memory.borrow().get("answer").cloned().unwrap();
    let answer = csp_lang::plain_value(&answer, usize::MAX).unwrap().value;
    for r in &bound.requests {
        assert_eq!(r.kind, "claimHorses");
        assert_eq!(r.fields.get("residentId"), Some(&json!(resident)));
    }
    (bound.requests.len(), answer)
}

#[test]
fn is_in_the_script_api_claims_as_the_order_does_and_leaves_the_script_running() {
    assert!(SCRIPT_API.iter().any(|b| b.name == "claimHorses" && matches!(b.is, Is::Action)));
    let mut s = setup();
    let realm = s.realm_id();
    let leader = s.leader_id();
    let mut r = s.world.residents.iter_mut();
    let r = r.find(|x| x.owner.as_deref() == Some(&realm) && x.id != leader).unwrap();
    r.script = Some(
        serde_json::from_value::<RunningScript>(json!({ "scriptId": 1, "memory": {} })).unwrap(),
    );
    let id = r.id.clone();

    let (requests, answer) = claim_from_a_script(&s.world, &s.terrain, &id);
    assert_eq!(answer, Value::Null);
    assert_eq!(requests, 1);
    let mut queue = s.queue();
    let order = json!({ "kind": "claimHorses", "residentId": id });
    let reply = queue.receive(&s.world, &player(), &json!("q"), &order);
    assert!(matches!(reply, OrderReply::Ack { .. }));
    queue.apply_all(&mut s.world);
    assert_eq!(s.world.horse_offers_claimed, [1]);
    assert!(s.world.residents.iter().find(|x| x.id == id).unwrap().script.is_some());

    let (requests, answer) = claim_from_a_script(&s.world, &s.terrain, &id);
    assert_eq!(requests, 0);
    assert_eq!(answer, json!("you have claimed your horses already"));
}

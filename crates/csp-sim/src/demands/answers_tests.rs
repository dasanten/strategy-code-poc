//! `demand-answers.test.ts`: how NPC cities and the Trade Organization answer demands. The views of
//! a realm's diplomacy (`diplomacyFor`) come with the server.

use super::*;
use crate::invariants::{check_invariants, world_invariants};
use crate::npc_plan::plan_due;
use crate::offers::{offers_sound, step_offers};
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::demand::{npc_orgs_known_to, yields_to_demand};
use crate::queries::goods::free_stock;
use crate::queries::persuasion::{city_soldiers, respect_seen_by};
use crate::queries::standing::standing_of;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::test_support::{add_city, building, plains};
use crate::tick::Scratch;
use crate::walking::Walking;
use crate::world::{create_world, step_world};
use csp_shared::balance::{
    DEMAND_DECLINED_STANDING_LOSS, DEMAND_TRADE_ORG_STANDING_LOSS, DEMAND_YIELD_RESPECT_MIN,
    DEMAND_YIELD_RESPECT_TIMES, DIRECT_OFFER_DAYS, NPC_PLAN_TICKS, SIGHT_RANGE,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{BuildingKind, JoinRequest, Realm, Standing, TradeOrgCity};
use serde_json::json;
use std::sync::Arc;

const SIZE: i32 = 128;

fn mara() -> OrderSender {
    OrderSender::player(7, "Mara")
}

fn resident(
    world: &mut WorldState,
    id: &str,
    owner: Option<&str>,
    x: f64,
    y: f64,
    city_id: Option<&str>,
) -> usize {
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner, city_id, x, y, tick: 0.0 };
    let mut r = new_resident(&mut || m.next(), &fields, None);
    r.born_at = -20.0 * 24.0 * 3600.0;
    r.lifespan = 60.0;
    world.residents.push(r);
    world.residents.len() - 1
}

fn arm(world: &mut WorldState, i: usize) {
    world.residents[i].carried = [(Good::Spear, 1.0)].into_iter().collect();
}

/// Places `n` armed residents of a realm in a line, starting at (x, y).
fn army(world: &mut WorldState, n: usize, x: f64, y: f64, owner: &str) {
    for i in 0..n {
        let r = resident(world, &format!("{owner}s{i}"), Some(owner), x, y + i as f64, None);
        world.residents[r].carried = [(Good::Sword, 1.0)].into_iter().collect();
    }
}

fn needed() -> usize {
    DEMAND_YIELD_RESPECT_MIN.max(DEMAND_YIELD_RESPECT_TIMES) as usize
}

fn enough() -> usize {
    DEMAND_YIELD_RESPECT_MIN as usize + 5
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    queue: OrderQueue,
}

/// Realm r1 (Player 7) with Leader a1 at home in c1, far away, and realm r2 (Player 8). The NPC
/// city n1, Oakford, at (40, 40), where n1a lives, armed, and n1b, unarmed: in r1's memory, with a
/// storage holding goods. `armed` of r1's residents stand just outside it, in its sight.
fn setup(armed: usize) -> Setup {
    let terrain = plains(SIZE);
    let mut world = create_world(&terrain, 1);
    for (id, user, leader, name) in [("r1", 7, "a1", "Mara"), ("r2", 8, "b1", "Tobin")] {
        let realm = json!({ "id": id, "userId": user, "leaderId": leader, "name": name });
        world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    }
    add_city(&mut world, "c1", Some("r1"), 5.0, 5.0);
    add_city(&mut world, "n1", None, 40.0, 40.0);
    world.cities[1].name = "Oakford".into();
    add_city(&mut world, "post", None, 90.0, 90.0);
    world.cities[2].name = "Saltmarsh".into();
    world.cities[2].trade_org = Some(TradeOrgCity::Post);
    world.cities[2].layout = None;
    resident(&mut world, "a1", Some("r1"), 5.0, 5.0, Some("c1"));
    resident(&mut world, "b1", Some("r2"), 100.0, 40.0, None);
    let n1a = resident(&mut world, "n1a", None, 40.0, 40.0, Some("n1"));
    arm(&mut world, n1a);
    resident(&mut world, "n1b", None, 41.0, 40.0, Some("n1"));
    army(&mut world, armed, 45.0, 40.0, "r1");
    let mut s = building("n1s", BuildingKind::Storage, Some("n1"), 48.0, 34.0);
    s.stock = Some([(Good::Food, 40.0), (Good::Iron, 3.0)].into_iter().collect());
    world.buildings.push(s);
    let n1 = serde_json::to_value(&world.cities[1]).unwrap();
    let mut n1_seen = n1.clone();
    n1_seen["is"] = json!("city");
    n1_seen["seenAt"] = json!(0);
    for k in ["gameName", "workplaceIds", "scouted", "formerPlayer", "outsiders", "layout"] {
        n1_seen.as_object_mut().unwrap().remove(k);
    }
    n1_seen["occupation"] = json!(null);
    n1_seen["hire"] = json!(null);
    let post_seen = json!({
        "is": "city", "id": "post", "name": "Saltmarsh", "realmId": null, "tradeOrg": "post",
        "townHallId": "post-hall", "occupation": null, "hire": null, "seenAt": 0,
    });
    world.last_seen.insert(
        7,
        vec![serde_json::from_value(n1_seen).unwrap(), serde_json::from_value(post_seen).unwrap()],
    );
    let terrain = Arc::new(terrain);
    Setup { world, queue: OrderQueue::new(order_kinds(), Some(terrain.clone())), terrain }
}

fn city_demand() -> Value {
    json!({
        "kind": "sendDemand", "realmId": "n1", "terms": { "kind": "city", "cityId": "n1" },
        "note": "Open your gates.", "days": 3,
    })
}

fn goods_demand() -> Value {
    with(city_demand(), "terms", json!({ "kind": "goods", "goods": { "food": 5, "stone": 2 } }))
}

fn with(mut order: Value, k: &str, v: Value) -> Value {
    order[k] = v;
    order
}

/// Whether `actual` holds everything in `expected` (vitest's `toMatchObject`).
fn matches(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Object(a), Value::Object(e)) => {
            e.iter().all(|(k, v)| a.get(k).is_some_and(|x| matches(x, v)))
        }
        (Value::Array(a), Value::Array(e)) => {
            a.len() == e.len() && a.iter().zip(e).all(|(x, y)| matches(x, y))
        }
        (Value::Number(a), Value::Number(e)) => a.as_f64() == e.as_f64(),
        _ => actual == expected,
    }
}

fn assert_matches<T: serde::Serialize>(actual: &T, expected: Value) {
    let actual = serde_json::to_value(actual).unwrap();
    assert!(matches(&actual, &expected), "{actual:#}\ndoes not match\n{expected:#}");
}

impl Setup {
    fn n1(&self) -> &City {
        self.world.cities.iter().find(|c| c.id == "n1").unwrap()
    }

    fn n1_realm(&self) -> Option<&str> {
        self.n1().realm_id.as_deref()
    }

    /// Sends an order from Mara and applies it; the reason it was refused, if it was.
    fn order(&mut self, o: Value) -> Option<String> {
        let answer = self.queue.receive(&self.world, &mara(), &json!("q"), &o);
        self.queue.apply_all(&mut self.world);
        match answer {
            OrderReply::Rejected { reason, .. } => Some(reason),
            _ => None,
        }
    }

    /// Steps demands until `who` answers, at its next planning pass.
    fn until_answered(&mut self, who: &str) {
        let done = |w: &WorldState| !w.demands.iter().any(|d| d.to_id == who);
        let mut i = 0.0;
        while i <= NPC_PLAN_TICKS && !done(&self.world) {
            answer_demands(&mut self.world, SIZE);
            assert_eq!(demands_sound(&self.world), vec![]);
            if !done(&self.world) {
                self.world.tick += 1;
            }
            i += 1.0;
        }
        assert!(done(&self.world));
    }

    fn log(&self) -> Vec<Value> {
        self.world
            .events
            .iter()
            .filter(|e| e.user_id == 7)
            .map(|e| serde_json::to_value(e).unwrap())
            .filter(|e| e["kind"] == "demand")
            .collect()
    }

    fn last_log(&self) -> Value {
        self.log().pop().unwrap()
    }

    /// Steps the whole world through a planning pass, the invariants holding each tick.
    fn run(&mut self) {
        let terrain = self.terrain.clone();
        let mut walking = Walking::new(terrain.clone());
        let mut scratch = Scratch::default();
        for _ in 0..=NPC_PLAN_TICKS as usize {
            step_world(&mut self.world, &terrain, &mut scratch, Some(&mut walking), None);
            assert_eq!(check_invariants(&self.world, &terrain, &world_invariants()), vec![]);
        }
        assert_eq!(self.world.demands, vec![]);
    }
}

mod how_much_respect_an_npc_city_yields_to {
    use super::*;

    #[test]
    fn takes_far_more_than_its_soldiers_more_than_persuading_a_city_does() {
        let mut s = setup(needed() - 1);
        assert_eq!(city_soldiers(&s.world, s.n1()), 1.0);
        assert!(!yields_to_demand(&s.world, s.n1(), "r1", SIZE));
        let r = resident(&mut s.world, "one-more", Some("r1"), 44.0, 40.0, None);
        arm(&mut s.world, r);
        assert!(yields_to_demand(&s.world, s.n1(), "r1", SIZE));
    }

    #[test]
    fn grows_with_its_soldiers() {
        let soldiers = DEMAND_YIELD_RESPECT_MIN as usize;
        let mut s = setup(soldiers);
        for i in 0..soldiers {
            let r = resident(&mut s.world, &format!("guard{i}"), None, 39.0, 40.0 + i as f64, Some("n1"));
            arm(&mut s.world, r);
        }
        assert_eq!(city_soldiers(&s.world, s.n1()), soldiers as f64 + 1.0);
        assert!(!yields_to_demand(&s.world, s.n1(), "r1", SIZE));
    }

    #[test]
    fn is_not_one_person_with_a_spear_even_where_it_has_no_soldiers() {
        let mut s = setup(1);
        let n1a = s.world.residents.iter().position(|r| r.id == "n1a").unwrap();
        s.world.residents[n1a].carried = Stock::default();
        assert_eq!(city_soldiers(&s.world, s.n1()), 0.0);
        assert!(!yields_to_demand(&s.world, s.n1(), "r1", SIZE));
    }

    #[test]
    fn counts_the_senders_walls_in_its_sight_too() {
        let mut s = setup(1);
        for i in 0..needed() - 1 {
            let wall = building(&format!("w{i}"), BuildingKind::Wall, Some("c1"), 36.0, 40.0 + i as f64);
            s.world.buildings.push(wall);
        }
        assert!(yields_to_demand(&s.world, s.n1(), "r1", SIZE));
    }
}

mod a_demand_for_an_npc_city {
    use super::*;

    #[test]
    fn waits_for_the_citys_planning_pass_then_an_army_in_sight_wins_it() {
        let mut s = setup(enough());
        assert_eq!(s.order(city_demand()), None);
        assert_matches(
            &s.world.demands,
            json!([{ "fromId": "r1", "toId": "n1",
                "terms": { "kind": "city", "cityId": "n1", "cityName": "Oakford" } }]),
        );
        // Not at once, unless it happens to plan this very tick.
        s.world.tick = 1;
        while plan_due(&s.world, "n1") {
            s.world.tick += 1;
        }
        s.world.demands[0].sent_at = s.world.tick as f64;
        answer_demands(&mut s.world, SIZE);
        assert_eq!(s.world.demands.len(), 1);
        assert_eq!(s.n1_realm(), None);

        s.until_answered("n1");
        assert!(plan_due(&s.world, "n1"));
        assert_eq!(s.n1_realm(), Some("r1"));
        let owners: Vec<_> = s
            .world
            .residents
            .iter()
            .filter(|r| r.city_id.as_deref() == Some("n1"))
            .map(|r| r.owner.as_deref())
            .collect();
        assert_eq!(owners, vec![Some("r1"), Some("r1")]);
        assert_matches(
            &s.last_log(),
            json!({ "what": "accepted", "mine": true, "other": "Oakford", "otherIs": "city",
                "terms": { "kind": "city", "cityName": "Oakford" } }),
        );
        assert_eq!(standing_of(&s.world, "n1", "r1"), 0.0);
    }

    #[test]
    fn forgets_any_ask_of_it_to_join_when_it_joins() {
        let mut s = setup(enough());
        s.world.join_requests.push(JoinRequest {
            city_id: "n1".into(),
            realm_id: "r1".into(),
            at: 0.0,
            declined: false,
        });
        s.order(city_demand());
        s.until_answered("n1");
        assert_eq!(s.n1_realm(), Some("r1"));
        assert_eq!(s.world.join_requests, vec![]);
    }

    #[test]
    fn is_declined_with_too_few_in_sight_and_its_standing_drops() {
        let mut s = setup(2);
        s.order(city_demand());
        s.until_answered("n1");
        assert_eq!(s.n1_realm(), None);
        assert_eq!(standing_of(&s.world, "n1", "r1"), -DEMAND_DECLINED_STANDING_LOSS);
        assert_matches(&s.last_log(), json!({ "what": "declined", "otherIs": "city" }));
    }

    #[test]
    fn doesnt_count_armed_residents_out_of_its_sight() {
        let mut s = setup(0);
        army(&mut s.world, enough(), 42.0 + SIGHT_RANGE, 40.0, "r1");
        assert_eq!(respect_seen_by(&s.world, s.n1(), "r1", SIZE), 0.0);
        s.order(city_demand());
        s.until_answered("n1");
        assert_eq!(s.n1_realm(), None);
        assert_eq!(standing_of(&s.world, "n1", "r1"), -DEMAND_DECLINED_STANDING_LOSS);
    }

    #[test]
    fn lapses_with_no_standing_lost_when_the_city_joins_a_realm_before_it_answers() {
        let mut s = setup(enough());
        s.order(city_demand());
        s.world.cities[1].realm_id = Some("r2".into());
        answer_demands(&mut s.world, SIZE);
        assert_eq!(s.world.demands, vec![]);
        assert_eq!(s.n1_realm(), Some("r2"));
        assert_matches(&s.last_log(), json!({ "what": "lapsed", "otherIs": "city" }));
        assert_eq!(standing_of(&s.world, "n1", "r1"), 0.0);
    }

    #[test]
    fn names_only_the_city_itself() {
        let mut s = setup(0);
        let o = with(city_demand(), "terms", json!({ "kind": "city", "cityId": "c1" }));
        assert_eq!(s.order(o).as_deref(), Some("an NPC city can only hand over itself"));
    }

    #[test]
    fn cant_be_answered_by_a_player() {
        let mut s = setup(2);
        s.order(city_demand());
        let id = s.world.demands[0].id.clone();
        assert_eq!(
            s.order(json!({ "kind": "declineDemand", "demandId": id })).as_deref(),
            Some("only the realm it was sent to can answer it"),
        );
    }
}

mod a_demand_for_goods_of_an_npc_city {
    use super::*;

    #[test]
    fn sets_them_aside_at_its_storage_for_the_sender_alone_as_far_as_it_holds_them() {
        let mut s = setup(enough());
        s.order(goods_demand());
        s.until_answered("n1");
        let lapses_at = s.world.tick as f64 + DIRECT_OFFER_DAYS * TICKS_PER_GAME_DAY;
        assert_matches(
            &s.world.offers,
            json!([{ "realmId": "n1", "storageId": "n1s", "gives": "food", "givesUnits": 1,
                "wantsUnits": 0, "times": 5, "direct": { "toId": "r1", "lapsesAt": lapses_at } }]),
        );
        assert_eq!(free_stock(&s.world, "n1s", s.world.buildings.iter().find(|b| b.id == "n1s").unwrap().stock.as_ref()).get(&Good::Food), Some(&35.0));
        assert_matches(
            &s.last_log(),
            json!({ "what": "accepted", "otherIs": "city",
                "handedOver": { "way": "setAside", "goods": { "food": 5 }, "x": 48, "y": 34 } }),
        );
        assert_eq!(offers_sound(&s.world), vec![]);
        // It stands through the world's step that looks after offers.
        step_offers(&mut s.world);
        assert_eq!(s.world.offers.len(), 1);
        assert_eq!(offers_sound(&s.world), vec![]);
        assert_eq!(demands_sound(&s.world), vec![]);
    }

    #[test]
    fn declines_with_none_of_them_there_and_its_standing_drops() {
        let mut s = setup(enough());
        let terms = json!({ "kind": "goods", "goods": { "stone": 2 } });
        s.order(with(goods_demand(), "terms", terms));
        s.until_answered("n1");
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(standing_of(&s.world, "n1", "r1"), -DEMAND_DECLINED_STANDING_LOSS);
        assert_matches(&s.last_log(), json!({ "what": "declined" }));
    }

    #[test]
    fn is_declined_with_too_few_in_sight_and_nothing_is_set_aside() {
        let mut s = setup(1);
        s.order(goods_demand());
        s.until_answered("n1");
        assert_eq!(s.world.offers, vec![]);
        assert_eq!(standing_of(&s.world, "n1", "r1"), -DEMAND_DECLINED_STANDING_LOSS);
    }

    #[test]
    fn ends_what_was_set_aside_when_the_city_joins_a_realm() {
        let mut s = setup(enough());
        s.order(goods_demand());
        s.until_answered("n1");
        s.world.cities[1].realm_id = Some("r2".into());
        step_offers(&mut s.world);
        assert_eq!(s.world.offers, vec![]);
        assert_matches(
            s.world.events.last().unwrap(),
            json!({ "kind": "directOffer", "what": "storageLost", "from": "Oakford",
                "fromCity": true }),
        );
    }
}

mod over_ticks_of_the_whole_world {
    use super::*;

    #[test]
    fn hands_over_a_city_and_holds_together() {
        let mut s = setup(enough());
        s.order(city_demand());
        s.run();
        assert_eq!(s.n1_realm(), Some("r1"));
    }

    #[test]
    fn sets_goods_aside_and_holds_together() {
        let mut s = setup(enough());
        s.order(goods_demand());
        s.run();
        assert_eq!(s.n1_realm(), None);
        assert_matches(&s.world.offers, json!([{ "realmId": "n1", "gives": "food", "times": 5 }]));
    }

    #[test]
    fn declines_and_holds_together() {
        let mut s = setup(1);
        s.order(with(goods_demand(), "realmId", json!(TRADE_ORG)));
        s.order(city_demand());
        s.run();
        assert_eq!(s.n1_realm(), None);
        assert!(standing_of(&s.world, "n1", "r1") < 0.0);
        assert!(standing_of(&s.world, TRADE_ORG, "r1") < 0.0);
    }
}

mod a_demand_to_the_trade_organization {
    use super::*;

    fn goods() -> Value {
        with(goods_demand(), "realmId", json!(TRADE_ORG))
    }

    #[test]
    fn is_always_declined_however_big_the_army_and_being_asked_costs_standing() {
        let mut s = setup(0);
        army(&mut s.world, 30, 92.0, 88.0, "r1");
        assert_eq!(s.order(goods()), None);
        assert_eq!(s.world.demands[0].to_id, TRADE_ORG);
        s.until_answered(TRADE_ORG);
        assert_eq!(standing_of(&s.world, TRADE_ORG, "r1"), -DEMAND_TRADE_ORG_STANDING_LOSS);
        assert_matches(
            &s.last_log(),
            json!({ "what": "declined", "other": "the Trade Organization", "otherIs": "tradeOrg" }),
        );
        assert_eq!(s.world.offers, vec![]);
    }

    #[test]
    fn takes_a_trading_posts_id_for_the_trade_organization_and_can_name_a_post() {
        let mut s = setup(0);
        let terms = json!({ "kind": "city", "cityId": "post" });
        assert_eq!(s.order(with(with(goods(), "realmId", json!("post")), "terms", terms)), None);
        assert_matches(
            &s.world.demands[0],
            json!({ "toId": TRADE_ORG, "terms": { "cityId": "post", "cityName": "Saltmarsh" } }),
        );
        s.until_answered(TRADE_ORG);
        assert_eq!(s.world.cities[2].trade_org, Some(TradeOrgCity::Post));
    }

    #[test]
    fn names_only_its_own_cities() {
        let mut s = setup(0);
        let terms = json!({ "kind": "city", "cityId": "n1" });
        assert_eq!(
            s.order(with(goods(), "terms", terms)).as_deref(),
            Some("as far as you know, that city isn’t theirs"),
        );
    }
}

mod whom_a_player_can_send_one_to {
    use super::*;

    #[test]
    fn knows_of_the_trade_organization_always_and_an_npc_city_as_of_a_realm() {
        let mut s = setup(0);
        assert_eq!(npc_orgs_known_to(&s.world, "r2", []), vec![TRADE_ORG]);
        // Seen now, last seen, or by a standing either way.
        let seen = ["n1", "r1", "c1", "post"];
        assert_eq!(npc_orgs_known_to(&s.world, "r2", seen), vec![TRADE_ORG, "n1"]);
        assert_eq!(npc_orgs_known_to(&s.world, "r1", []), vec![TRADE_ORG, "n1"]);
        s.world.standings.push(Standing { of: "n1".into(), toward: "r2".into(), value: -3.0 });
        assert_eq!(npc_orgs_known_to(&s.world, "r2", []), vec![TRADE_ORG, "n1"]);
    }

    #[test]
    fn refuses_an_npc_city_they_dont_know_of() {
        let mut s = setup(0);
        add_city(&mut s.world, "n2", None, 70.0, 70.0);
        let o = with(city_demand(), "realmId", json!("n2"));
        assert_eq!(s.order(o).as_deref(), Some("you don’t know of that realm"));
        assert_eq!(s.world.demands, vec![]);
    }

    #[test]
    fn counts_against_what_a_realm_can_send_as_any_demand_does() {
        let mut s = setup(0);
        let t = s.world.tick as f64;
        s.world.realms[0].demands_sent_at = Some(vec![t, t, t]);
        let reason = s.order(city_demand()).unwrap_or_default();
        assert!(reason.contains("at most"), "{reason}");
    }
}

mod its_invariant {
    use super::*;

    #[test]
    fn catches_a_demand_the_game_has_left_unanswered_too_long() {
        let mut s = setup(1);
        s.order(goods_demand());
        s.world.tick += NPC_PLAN_TICKS as u64 + 1;
        let found = demands_sound(&s.world);
        assert!(found[0].message.contains("waited longer than a planning pass"), "{found:?}");
    }

    #[test]
    fn still_catches_a_demand_to_a_realm_that_is_gone() {
        let mut s = setup(0);
        s.world.demands.push(Demand {
            id: "d1".into(),
            from_id: "r1".into(),
            to_id: "nobody".into(),
            terms: serde_json::from_value(json!({ "kind": "goods", "goods": { "food": 1 } }))
                .unwrap(),
            note: "Food".into(),
            sent_at: 0.0,
            deadline: 100.0,
        });
        let found = demands_sound(&s.world);
        assert!(found[0].message.contains("does not exist"), "{found:?}");
    }
}

//! `apps/server/src/post-debt.test.ts`: a trading post taken, and the debt the Trade Organization
//! makes of it (`CONTEXT.md`: Trade Organization debt).

mod ts_match;

use std::sync::Arc;

use csp_shared::balance::{
    AVERAGE_HORSE_STATS, TRADE_ORG_ARMY, TRADE_ORG_DEBT_DEMAND_DAYS, TRADE_ORG_LOSS,
};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, Carriage, City, Crime, CrimeKind, Demand, DemandTerms, Good,
    HorseStats, Stock, TradeOrgCity, WorldState,
};
use csp_sim::capture::capture_city;
use csp_sim::caravans::place_caravans;
use csp_sim::crimes::step_crimes;
use csp_sim::demands::step_demands;
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::queries::standing::TRADE_ORG;
use csp_sim::queries::warehouse_trade::{debt_of, trading_warehouse_at};
use csp_sim::random::Mulberry32;
use csp_sim::starting_city::found_starting_city;
use csp_sim::survival::end_realm;
use csp_sim::tick::Scratch;
use csp_sim::trade_org::found_trade_org_hq;
use csp_sim::trade_org_debt::{debt_demands_sound, owe_trade_org, step_debts, FirstOwed};
use csp_sim::trade_org_punishment::step_punishments;
use csp_sim::traders::place_traders;
use csp_sim::trading_posts::{found_trading_post, trading_posts};
use csp_sim::walking::Walking;
use csp_sim::world::{create_world, step_world};
use serde_json::{json, Value};
use ts_match::{assert_matches, json_of};

const SIZE: i32 = 512;
const WORTH: f64 = TRADE_ORG_LOSS.capture;

/// The Trade Org HQ, three trading posts with their caravans and traders, and a Player's realm.
struct Fixture {
    world: WorldState,
    terrain: TerrainMap,
    hq: String,
    posts: Vec<String>,
    traders: Vec<String>,
    realm: String,
    leader: String,
}

fn fixture() -> Fixture {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(5.0);
    let mut rand = || m.next();
    let hq = found_trade_org_hq(&mut world, &terrain, 128, 128, &mut rand);
    let posts = [(220, 128), (220, 220), (128, 220)]
        .into_iter()
        .map(|(x, y)| found_trading_post(&mut world, &terrain, x, y, None, &mut rand))
        .collect();
    place_caravans(&mut world);
    let traders = place_traders(&mut world, SIZE);
    for h in &mut world.horses {
        h.stats = HorseStats {
            speed: AVERAGE_HORSE_STATS.speed,
            strength: AVERAGE_HORSE_STATS.strength,
            endurance: AVERAGE_HORSE_STATS.endurance,
        };
    }
    let ri = found_starting_city(&mut world, &terrain, 7, None);
    let (realm, leader) = (world.realms[ri].id.clone(), world.realms[ri].leader_id.clone());
    Fixture { world, terrain, hq, posts, traders, realm, leader }
}

impl Fixture {
    fn post(&self) -> String {
        self.posts[0].clone()
    }
    fn city(&self, id: &str) -> &City {
        self.world.cities.iter().find(|c| c.id == id).expect("a city")
    }
    fn city_mut(&mut self, id: &str) -> &mut City {
        self.world.cities.iter_mut().find(|c| c.id == id).expect("a city")
    }
    fn hall(&self, city: &str) -> Building {
        let hall = self.city(city).town_hall_id.clone();
        self.world.buildings.iter().find(|b| b.id == hall).expect("a town hall").clone()
    }
    fn leader_mut(&mut self) -> &mut csp_shared::world::Resident {
        let id = self.leader.clone();
        self.world.residents.iter_mut().find(|r| r.id == id).expect("the Leader")
    }

    /// The leader, armed, stands on the post's town hall as it falls to their realm (`capture`).
    fn capture(&mut self, post: &str) {
        let hall = self.hall(post);
        let l = self.leader_mut();
        l.x = hall.x;
        l.y = hall.y;
        l.carried.insert(Good::Spear, 1.0);
        l.order = None;
        let owner = l.owner.clone().expect("of a realm");
        capture_city(&mut self.world, post, &owner, SIZE);
    }

    fn capture_of(&mut self, post: &str) -> &mut Crime {
        self.world
            .crimes
            .iter_mut()
            .find(|c| c.kind == CrimeKind::Capture && c.post.as_deref() == Some(post))
            .expect("the capture")
    }

    /// The news of the post's capture comes in: a trader's driver gets to the HQ with it
    /// (`newsComes`).
    fn news_comes(&mut self, post: &str) {
        let trader = self.traders[0].clone();
        let witness = self
            .world
            .traders
            .iter()
            .find(|t| t.id == trader)
            .and_then(|t| t.driver_id.clone())
            .expect("a driver");
        let hall = self.hall(&self.hq.clone());
        let w = self.world.residents.iter_mut().find(|r| r.id == witness).expect("the driver");
        w.x = hall.x;
        w.y = hall.y;
        self.capture_of(post).witnesses = vec![witness];
        step_crimes(&mut self.world, SIZE);
        let crime = self.capture_of(post).clone();
        assert!(crime.known_by.contains(&crime.victim_org));
        step_debts(&mut self.world);
    }

    fn post_demand(&self, post: &str) -> Option<&Demand> {
        self.world
            .demands
            .iter()
            .find(|d| matches!(&d.terms, DemandTerms::City { city_id, .. } if city_id == post))
    }

    fn coin_demand(&self) -> Option<&Demand> {
        self.world.demands.iter().find(|d| matches!(d.terms, DemandTerms::Goods { .. }))
    }

    /// The Player's answer to a demand, applied, and what it says (`answer`).
    fn answer_to(&mut self, kind: &str, demand_id: &str) -> String {
        let mut q = OrderQueue::new(order_kinds(), Some(Arc::new(self.terrain.clone())));
        let o = json!({ "kind": kind, "demandId": demand_id });
        let said = q.receive(&self.world, &OrderSender::player(7, "Mara"), &json!("a"), &o);
        q.apply_all(&mut self.world);
        match said {
            OrderReply::Ack { .. } => "ack".into(),
            OrderReply::Rejected { reason, .. } => reason,
        }
    }
    fn answer(&mut self, kind: &str) -> String {
        let id = self.post_demand(&self.post()).expect("a demand for the post").id.clone();
        self.answer_to(kind, &id)
    }

    fn events(&self) -> Vec<Value> {
        self.world.events.iter().filter(|e| e.user_id == 7).map(json_of).collect()
    }
    fn debt_events(&self, what: &str) -> Vec<Value> {
        self.events().into_iter().filter(|e| e["kind"] == "debt" && e["what"] == what).collect()
    }
    fn demand_events(&self, what: &str) -> usize {
        self.events().iter().filter(|e| e["kind"] == "demand" && e["what"] == what).count()
    }

    fn owe(&mut self, coins: f64) {
        let realm = self.realm.clone();
        owe_trade_org(&mut self.world, &realm, coins, None, FirstOwed::Owed);
    }

    fn storages(&self, post: &str) -> Vec<&Building> {
        self.world
            .buildings
            .iter()
            .filter(|b| b.city_id.as_deref() == Some(post) && b.kind == BuildingKind::Storage)
            .collect()
    }
    fn warehouse(&self, post: &str) -> Option<&Building> {
        self.world
            .buildings
            .iter()
            .find(|b| b.kind == BuildingKind::Warehouse && b.city_id.as_deref() == Some(post))
    }

    fn sound_debt_demands(&self) {
        let broken: Vec<String> =
            debt_demands_sound(&self.world).into_iter().map(|v| v.message).collect();
        assert_eq!(broken, Vec::<String>::new());
    }
}

/// A post taken and heard of: what the Trade Organization then wants of the realm (`heardOf`).
fn heard_of() -> Fixture {
    let mut s = fixture();
    let post = s.post();
    s.capture(&post);
    s.news_comes(&post);
    s
}

fn stock(pairs: &[(Good, f64)]) -> Stock {
    pairs.iter().copied().collect()
}

mod a_captured_post_the_trade_organization_has_not_heard_of {
    use super::*;

    #[test]
    fn owes_nothing_and_is_asked_for_nothing_however_long_it_stands() {
        let mut s = fixture();
        s.capture(&s.post());
        for _ in 0..10 {
            step_crimes(&mut s.world, SIZE);
            step_debts(&mut s.world);
            step_punishments(&mut s.world, SIZE);
            s.world.tick += TICKS_PER_GAME_DAY as u64;
        }
        assert!(s.world.debts.is_empty());
        assert!(s.world.demands.is_empty());
        assert!(s.world.punishments.is_empty());
    }
}

mod once_it_has_heard_who_took_a_post {
    use super::*;

    #[test]
    fn demands_the_city_back_with_a_debt_for_its_worth_and_sends_no_army() {
        let mut s = heard_of();
        let post = s.post();
        assert_eq!(
            json_of(&s.world.debts),
            json!([{ "org": s.realm, "coins": WORTH, "cityId": post }])
        );
        let name = s.city(&post).name.clone();
        let deadline = s.world.tick as f64 + TRADE_ORG_DEBT_DEMAND_DAYS * TICKS_PER_GAME_DAY;
        assert_matches(
            s.post_demand(&post).expect("a demand"),
            json!({
                "fromId": TRADE_ORG, "toId": s.realm,
                "terms": { "kind": "city", "cityId": post, "cityName": name },
                "deadline": deadline
            }),
        );
        assert!(s.coin_demand().is_none());
        assert_eq!(s.capture_of(&post).punished, Some(true));
        assert_eq!(s.debt_events("postOwed").len(), 1);
        assert_eq!(s.demand_events("received"), 1);
        // It knows, however low its standing went: the debt is what it does about it.
        let hq = s.hq.clone();
        for r in &mut s.world.residents {
            if r.city_id.as_deref() == Some(hq.as_str()) && r.owner.is_none() {
                r.carried.insert(Good::Spear, 1.0);
            }
        }
        step_punishments(&mut s.world, SIZE);
        assert!(s.world.punishments.is_empty());
        s.sound_debt_demands();
    }

    #[test]
    fn does_so_once_however_often_its_debts_come_round() {
        let mut s = heard_of();
        step_debts(&mut s.world);
        step_debts(&mut s.world);
        assert_eq!(s.world.demands.len(), 1);
        assert_eq!(s.world.debts[0].coins, WORTH);
    }

    #[test]
    fn with_a_city_they_no_longer_hold_it_is_a_debt_like_any_a_demand_for_the_coins() {
        let mut s = fixture();
        let post = s.post();
        s.capture(&post);
        let other = found_starting_city(&mut s.world, &s.terrain.clone(), 8, None);
        let other = s.world.realms[other].id.clone();
        s.city_mut(&post).realm_id = Some(other);
        s.news_comes(&post);
        assert!(s.post_demand(&post).is_none());
        assert_matches(
            s.coin_demand().expect("a demand for the Coins"),
            json!({ "toId": s.realm, "terms": { "goods": { "coins": WORTH } } }),
        );
    }

    #[test]
    fn asks_a_realm_that_owes_already_for_both_its_demand_for_the_coins_rising_by_the_worth() {
        let mut s = fixture();
        s.owe(300.0);
        step_debts(&mut s.world);
        let terms = |s: &Fixture| json_of(&s.coin_demand().expect("a demand").terms);
        assert_eq!(terms(&s), json!({ "kind": "goods", "goods": { "coins": 300.0 } }));
        let post = s.post();
        s.capture(&post);
        s.news_comes(&post);
        assert_eq!(debt_of(&s.world, &s.realm), 300.0 + WORTH);
        assert_eq!(terms(&s), json!({ "kind": "goods", "goods": { "coins": 300.0 + WORTH } }));
        assert!(s.post_demand(&post).is_some());
        assert_eq!(s.debt_events("rose").len(), 1);
        s.sound_debt_demands();
    }

    #[test]
    fn reacts_to_nothing_at_all_once_the_hq_has_fallen() {
        let mut s = fixture();
        let post = s.post();
        s.capture(&post);
        let c = s.capture_of(&post);
        c.known_by.push(c.victim_org.clone());
        let hq = s.hq.clone();
        s.city_mut(&hq).trade_org = None;
        step_debts(&mut s.world);
        assert!(s.world.debts.is_empty());
        assert!(s.world.demands.is_empty());
    }
}

mod giving_the_post_back {
    use super::*;

    #[test]
    fn settles_the_debt_and_makes_it_a_trading_post_again() {
        let mut s = heard_of();
        let post = s.post();
        let before: Vec<Building> = s.storages(&post).into_iter().cloned().collect();
        assert_eq!(before.len(), 2);
        let second = before[1].id.clone();
        s.world.buildings.iter_mut().find(|b| b.id == second).unwrap().stock =
            Some(stock(&[(Good::Coins, 777.0), (Good::Wood, 5.0)]));
        assert_eq!(s.answer("acceptDemand"), "ack");
        assert_matches(s.city(&post), json!({ "tradeOrg": "post", "realmId": null }));
        assert!(trading_posts(&s.world).iter().any(|c| c.id == post));
        assert_eq!(
            json_of(&s.warehouse(&post).expect("a warehouse").stock),
            json!({ "coins": 777.0, "wood": 5.0 })
        );
        let now: Vec<&Building> = s.storages(&post);
        assert_eq!(now.len(), 1);
        assert_eq!(json_of(now[0]), json_of(&before[0]));
        assert!(s.world.debts.is_empty());
        assert!(s.world.demands.is_empty());
        let returned = s.debt_events("postReturned");
        assert_eq!(returned.len(), 1);
        assert_matches(&returned[0], json!({ "coins": WORTH, "owed": 0 }));
        assert_eq!(s.demand_events("accepted"), 1);
    }

    #[test]
    fn gives_it_back_its_people_horses_and_carriages_and_a_leader_stays_in_the_realm() {
        let mut s = fixture();
        let post = s.post();
        let living: Vec<String> = s
            .world
            .residents
            .iter()
            .filter(|r| r.city_id.as_deref() == Some(post.as_str()))
            .map(|r| r.id.clone())
            .collect();
        // The Leader moved in while they held it.
        s.capture(&post);
        s.leader_mut().city_id = Some(post.clone());
        let hall = s.hall(&post);
        s.world.carriages.push(Carriage {
            id: "k-in-post".into(),
            realm_id: Some(s.realm.clone()),
            city_id: None,
            x: hall.x,
            y: hall.y,
            horse_id: None,
            load: Stock::new(),
        });
        s.news_comes(&post);
        s.answer("acceptDemand");
        for id in &living {
            let r = s.world.residents.iter().find(|r| &r.id == id).expect("still there");
            assert_matches(r, json!({ "owner": null, "cityId": post, "order": null }));
        }
        let leader = s.leader_mut().clone();
        assert_matches(&leader, json!({ "owner": s.realm, "cityId": null }));
        let k = s.world.carriages.iter().find(|k| k.id == "k-in-post").expect("the carriage");
        assert_matches(k, json!({ "realmId": null, "cityId": post }));
    }

    #[test]
    fn leaves_a_working_post_it_trades_has_its_caravan_and_traders_call_again() {
        let mut s = heard_of();
        let post = s.post();
        let mut walking = Walking::new(Arc::new(s.terrain.clone()));
        let caravans = |w: &WorldState| w.caravans.iter().filter(|c| c.post_id == post).count();
        assert_eq!(caravans(&s.world), 0);
        s.answer("acceptDemand");
        assert_eq!(caravans(&s.world), 1);
        let warehouse = s.warehouse(&post).expect("a warehouse").clone();
        // Another realm buys there, as anywhere the Trade Organization trades.
        let ri = found_starting_city(&mut s.world, &s.terrain.clone(), 8, None);
        let buyer_id = s.world.realms[ri].leader_id.clone();
        {
            let w = s.world.buildings.iter_mut().find(|b| b.id == warehouse.id).unwrap();
            w.stock.get_or_insert_with(Stock::new).insert(Good::Food, 50.0);
        }
        let buyer = s.world.residents.iter_mut().find(|r| r.id == buyer_id).unwrap();
        buyer.x = warehouse.x;
        buyer.y = warehouse.y;
        buyer.carried = stock(&[(Good::Coins, 1_000.0)]);
        buyer.order = Some(
            serde_json::from_value(json!({
                "kind": "trade", "side": "buy", "good": "food", "units": 3, "carriageId": null
            }))
            .expect("a trade order"),
        );
        assert_eq!(
            trading_warehouse_at(&s.world, warehouse.x, warehouse.y).map(|b| b.id.clone()),
            Some(warehouse.id.clone())
        );
        let mut scratch = Scratch::default();
        step_world(&mut s.world, &s.terrain, &mut scratch, None, None);
        let buyer = s.world.residents.iter().find(|r| r.id == buyer_id).unwrap();
        assert_eq!(buyer.carried.get(&Good::Food), Some(&3.0));
        assert!(buyer.carried.get(&Good::Coins).copied().unwrap_or(0.0) < 1_000.0);
        for i in 0..100 {
            step_world(&mut s.world, &s.terrain, &mut scratch, Some(&mut walking), None);
            if i % 10 == 0 {
                let broken: Vec<String> =
                    check_all(&s.world, &s.terrain).into_iter().map(|v| v.message).collect();
                assert_eq!(broken, Vec::<String>::new());
            }
        }
        for t in &s.world.traders {
            assert!(t.r#loop.contains(&post));
        }
        let left: Vec<_> = s
            .world
            .residents
            .iter()
            .filter(|r| r.city_id.as_deref() == Some(post.as_str()) && r.owner.is_none())
            .collect();
        assert!(!left.is_empty());
        assert_eq!(s.city(&post).trade_org, Some(TradeOrgCity::Post));
        // Its own people are at work again, the game running them.
        assert!(left.iter().any(|r| r.order.is_some()));
    }

    #[test]
    fn takes_off_only_the_posts_worth_anything_else_owed_stays_and_gets_its_own_demand() {
        let mut s = fixture();
        let post = s.post();
        s.capture(&post);
        s.news_comes(&post);
        s.owe(300.0);
        step_debts(&mut s.world);
        assert!(s.coin_demand().is_none());
        s.answer("acceptDemand");
        assert_eq!(s.world.debts.len(), 1);
        assert_matches(&s.world.debts[0], json!({ "org": s.realm, "coins": 300 }));
        step_debts(&mut s.world);
        assert_matches(
            s.coin_demand().expect("a demand"),
            json!({ "terms": { "goods": { "coins": 300 } } }),
        );
        s.sound_debt_demands();
    }

    #[test]
    fn leaves_what_a_demand_for_the_coins_asks_following_what_is_owed_now() {
        let mut s = fixture();
        s.owe(300.0);
        step_debts(&mut s.world);
        let post = s.post();
        s.capture(&post);
        s.news_comes(&post);
        s.answer("acceptDemand");
        step_debts(&mut s.world);
        assert_eq!(s.world.debts.len(), 1);
        assert_matches(&s.world.debts[0], json!({ "org": s.realm, "coins": 300 }));
        assert_eq!(
            json_of(&s.coin_demand().expect("a demand").terms),
            json!({ "kind": "goods", "goods": { "coins": 300.0 } })
        );
        s.sound_debt_demands();
    }

    #[test]
    fn is_refused_for_a_city_no_longer_theirs_and_stays_until_they_decline_or_it_lapses() {
        let mut s = heard_of();
        let post = s.post();
        let other = found_starting_city(&mut s.world, &s.terrain.clone(), 8, None);
        let other = s.world.realms[other].id.clone();
        s.city_mut(&post).realm_id = Some(other);
        let said = s.answer("acceptDemand");
        assert!(said.contains("no longer yours"), "{said}");
        assert!(s.post_demand(&post).is_some());
        assert_eq!(s.city(&post).trade_org, None);
    }

    #[test]
    fn makes_a_new_warehouse_only_when_nothing_is_left_to_turn_back() {
        let mut s = heard_of();
        let post = s.post();
        let hall = s.hall(&post);
        let side = f64::from(FOOTPRINT.get("storage").expect("a footprint"));
        let (x, y) = (hall.x + side + 2.0, hall.y - side - 1.0);
        let old = s
            .storages(&post)
            .into_iter()
            .find(|b| b.x == x && b.y == y)
            .expect("the old warehouse")
            .id
            .clone();
        // Torn down while they held it.
        s.world.buildings.retain(|b| b.id != old);
        assert_eq!(s.storages(&post).len(), 1);
        s.answer("acceptDemand");
        assert_eq!(s.storages(&post).len(), 1);
        assert_matches(
            s.warehouse(&post).expect("a warehouse"),
            json!({ "x": x, "y": y, "stock": {} }),
        );
    }

    #[test]
    fn turns_another_storage_into_its_warehouse_when_its_old_one_is_gone() {
        let mut s = heard_of();
        let post = s.post();
        let hall = s.hall(&post);
        let side = f64::from(FOOTPRINT.get("storage").expect("a footprint"));
        let old = s
            .storages(&post)
            .into_iter()
            .find(|b| b.x == hall.x + side + 2.0)
            .expect("the old warehouse")
            .id
            .clone();
        // It stands elsewhere now: a storage the realm built instead.
        s.world.buildings.iter_mut().find(|b| b.id == old).unwrap().x -= 8.0;
        s.answer("acceptDemand");
        assert_eq!(s.storages(&post).len(), 1);
        let kind = s.world.buildings.iter().find(|b| b.id == old).unwrap().kind;
        assert_eq!(kind, BuildingKind::Warehouse);
    }
}

mod anything_but_giving_it_back {
    use super::*;

    #[test]
    fn declined_goes_up_the_steps_like_any_debt() {
        let mut s = heard_of();
        let post = s.post();
        assert_eq!(s.answer("declineDemand"), "ack");
        assert_matches(
            &s.world.debts[0],
            json!({ "org": s.realm, "coins": WORTH, "step": "wrecks" }),
        );
        assert!(s.post_demand(&post).is_none());
        assert_eq!(s.debt_events("overdue").len(), 1);
        assert_eq!(s.city(&post).realm_id.as_deref(), Some(s.realm.as_str()));
        step_debts(&mut s.world);
        assert!(s.world.demands.is_empty());
        s.sound_debt_demands();
    }

    #[test]
    fn declined_sends_its_next_army_to_the_post_it_wants_back_wherever_else_they_hold() {
        let mut s = heard_of();
        let post = s.post();
        let home = s
            .world
            .cities
            .iter()
            .find(|c| c.realm_id.as_deref() == Some(s.realm.as_str()) && c.id != post)
            .expect("their home")
            .clone();
        // Their home stands nearer the HQ, where an army with no city to go to would go.
        let hq_hall = s.hall(&s.hq.clone());
        let hall = s.world.buildings.iter_mut().find(|b| b.id == home.town_hall_id).unwrap();
        hall.x = hq_hall.x + 10.0;
        hall.y = hq_hall.y;
        assert_eq!(s.answer("declineDemand"), "ack");
        assert_matches(&s.world.debts[0], json!({ "cityId": post }));
        let hq = s.hq.clone();
        let soldiers = (TRADE_ORG_ARMY.guard + 4.0) as usize;
        for r in s
            .world
            .residents
            .iter_mut()
            .filter(|r| r.owner.is_none() && r.city_id.as_deref() == Some(hq.as_str()))
            .take(soldiers)
        {
            r.carried.insert(Good::Spear, 1.0);
        }
        step_punishments(&mut s.world, SIZE);
        assert_eq!(s.world.punishments.len(), 1);
        assert_matches(&s.world.punishments[0], json!({ "culpritOrg": s.realm, "cityId": post }));
    }

    #[test]
    fn lapsed_goes_up_the_steps_like_any_debt() {
        let mut s = heard_of();
        let post = s.post();
        s.world.tick = s.post_demand(&post).expect("a demand").deadline as u64;
        step_demands(&mut s.world);
        assert_matches(&s.world.debts[0], json!({ "step": "wrecks" }));
        assert_eq!(s.debt_events("overdue").len(), 1);
        step_debts(&mut s.world);
        assert!(s.world.demands.is_empty());
    }

    #[test]
    fn with_a_demand_for_the_coins_still_open_leaves_it_to_that_one() {
        let mut s = fixture();
        s.owe(300.0);
        step_debts(&mut s.world);
        let post = s.post();
        s.capture(&post);
        s.news_comes(&post);
        s.answer("declineDemand");
        assert_matches(&s.world.debts[0], json!({ "step": "demanded" }));
        assert!(s.coin_demand().is_some());
        assert!(s.debt_events("overdue").is_empty());
        // Both out at once and lapsing together, it goes up the once.
        let second = s.posts[1].clone();
        s.capture(&second);
        s.news_comes(&second);
        let deadline = s.world.demands.iter().map(|d| d.deadline).fold(f64::MIN, f64::max);
        s.world.tick = deadline as u64;
        step_demands(&mut s.world);
        assert_matches(&s.world.debts[0], json!({ "step": "wrecks" }));
        assert_eq!(s.debt_events("overdue").len(), 1);
    }

    #[test]
    fn at_a_step_further_up_stays_there_and_the_city_can_still_go_back() {
        let mut s = fixture();
        let (post, second) = (s.post(), s.posts[1].clone());
        s.capture(&post);
        s.capture(&second);
        s.news_comes(&post);
        s.news_comes(&second);
        assert_eq!(s.world.debts[0].coins, 2.0 * WORTH);
        s.answer("declineDemand");
        assert_matches(&s.world.debts[0], json!({ "step": "wrecks" }));
        let id = s.post_demand(&second).expect("a demand").id.clone();
        s.answer_to("acceptDemand", &id);
        assert_eq!(s.city(&second).trade_org, Some(TradeOrgCity::Post));
        assert_matches(&s.world.debts[0], json!({ "step": "wrecks", "coins": WORTH }));
        assert_eq!(s.debt_events("overdue").len(), 1);
    }

    #[test]
    fn paid_in_full_at_a_warehouse_ends_the_demand_and_they_keep_the_city() {
        let mut s = heard_of();
        let post = s.post();
        let warehouse = s.warehouse(&s.posts[1].clone()).expect("a warehouse").clone();
        let l = s.leader_mut();
        l.x = warehouse.x;
        l.y = warehouse.y;
        l.carried.insert(Good::Coins, WORTH);
        l.order = Some(
            serde_json::from_value(
                json!({ "kind": "payDebt", "coins": WORTH, "carriageId": null }),
            )
            .expect("a payDebt order"),
        );
        step_world(&mut s.world, &s.terrain, &mut Scratch::default(), None, None);
        assert!(s.world.debts.is_empty());
        assert!(s.world.demands.is_empty());
        assert_eq!(s.city(&post).realm_id.as_deref(), Some(s.realm.as_str()));
    }

    #[test]
    fn with_the_leader_dead_goes_with_the_realm() {
        let mut s = heard_of();
        let realm = s.realm.clone();
        end_realm(&mut s.world, &realm, SIZE);
        step_debts(&mut s.world);
        assert!(s.world.demands.is_empty());
        assert!(s.world.debts.is_empty());
        s.sound_debt_demands();
    }
}

mod invariants_of_a_post_wanted_back {
    use super::*;

    fn messages(s: &Fixture) -> Vec<String> {
        debt_demands_sound(&s.world).into_iter().map(|v| v.message).collect()
    }

    #[test]
    fn catch_one_demanded_with_no_debt_or_twice_or_heard_of_and_on_no_debt() {
        let mut s = heard_of();
        let post = s.post();
        let twice = Demand { id: "demand-again".into(), ..s.post_demand(&post).unwrap().clone() };
        s.world.demands.push(twice);
        let m = messages(&s);
        assert!(m.len() == 1 && m[0].contains("demanded back twice"), "{m:?}");
        s.world.demands.retain(|d| d.id != "demand-again");
        s.world.debts.clear();
        let m = messages(&s);
        assert!(m.len() == 1 && m[0].contains("owes nothing for"), "{m:?}");
        s.world.demands.clear();
        s.capture_of(&post).punished = None;
        let m = messages(&s);
        assert!(m.len() == 1 && m[0].contains("on no debt"), "{m:?}");
    }
}

//! `apps/server/src/directives.test.ts`. The Trade Org HQ is hand-made (its town hall, its coin
//! warehouse and one goods warehouse) instead of `foundTradeOrgHq` (T86.9). Left out until their
//! tickets land: the Trade Organization's refusals and punishments under a directive
//! (`tradeOrgRefuses`, `stepPunishments`: T86.5, T86.9), the Players' view (`diplomacyFor`: T87.6),
//! and `checkInvariants` (T86.13). Deaths go through `count_soldiers_killed`, as `dieAll` (T86.3)
//! calls it for the killed.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    BuildingKind, Directive, DirectiveGoal, Good, ResidentOrder, TradeOrgCity, WorldState,
};
use serde_json::{json, Value};

use super::*;
use crate::queries::names::held;
use crate::queries::warehouse::HQ_COIN_WAREHOUSE;
use crate::realm_test_world::{add_city, building, plains, resident, send};
use crate::tick::Scratch;
use crate::world::{create_world, step_world};

const MID: f64 = 320.0;

fn terrain() -> TerrainMap {
    plains(640)
}

/// The Trade Org HQ at (MID, MID) with a coin and a goods warehouse; realm r1 (Leader a1, Aldo)
/// with city c1 near the HQ and c2 far from it, its storage s1 full of Coins; realm r2 (Leader b1,
/// Bea) in an alliance with r1 and its city c3; and an NPC city n1 apart.
fn setup() -> WorldState {
    let mut world = create_world(&terrain(), 1);
    world.nodes.clear();
    add_city(&mut world, "hq", None, MID, MID, "the HQ");
    let hq = world.cities.iter_mut().find(|c| c.id == "hq").expect("the HQ");
    hq.trade_org = Some(TradeOrgCity::Hq);
    hq.layout = None;
    let (cx, cy) = (MID + HQ_COIN_WAREHOUSE.0, MID + HQ_COIN_WAREHOUSE.1);
    let mut coins = building("hq-coins", BuildingKind::Warehouse, Some("hq"), cx, cy);
    coins.stock = Some([(Good::Coins, 500.0)].into_iter().collect());
    world.buildings.push(coins);
    let mut goods = building("hq-goods", BuildingKind::Warehouse, Some("hq"), MID - 8.0, MID);
    goods.stock = Some(Default::default());
    world.buildings.push(goods);
    for (id, user, leader) in [("r1", 7, "a1"), ("r2", 8, "b1")] {
        world.realms.push(
            serde_json::from_value(json!({"id": id, "userId": user, "leaderId": leader}))
                .expect("a realm"),
        );
    }
    add_city(&mut world, "c1", Some("r1"), MID, MID + 88.0, "Ashford");
    add_city(&mut world, "c2", Some("r1"), MID + 240.0, MID, "Farhold");
    add_city(&mut world, "c3", Some("r2"), MID - 120.0, MID - 120.0, "Bywater");
    add_city(&mut world, "n1", None, MID + 120.0, MID - 160.0, "Nook");
    person(&mut world, "a1", "r1", MID - 4.0, MID + 92.0, "c1", "Aldo");
    person(&mut world, "b1", "r2", MID - 124.0, MID - 116.0, "c3", "Bea");
    let north = json!({
        "id": "al1", "name": "North", "leaderId": "r1",
        "members": [{"realmId": "r1", "joinedAt": 0, "leaving": null}, {"realmId": "r2", "joinedAt": 0, "leaving": null}],
        "invites": [], "army": []
    });
    world.alliances.push(serde_json::from_value(north).expect("an alliance"));
    world
}

fn person(
    world: &mut WorldState,
    id: &str,
    owner: &str,
    x: f64,
    y: f64,
    city: &str,
    name: &str,
) -> usize {
    let mut r = resident(id, Some(owner), x, y);
    r.city_id = Some(city.into());
    r.name = name.into();
    world.residents.push(r);
    world.residents.len() - 1
}

/// Adds an armed resident of `owner` in `city`, far from the HQ.
fn soldier(world: &mut WorldState, id: &str, owner: &str, city: &str) -> usize {
    let i = person(world, id, owner, MID + 244.0, MID + 4.0, city, id);
    world.residents[i].carried.insert(Good::Spear, 1.0);
    i
}

fn give_with(world: &mut WorldState, target: &str, with_alliance: bool, goals: Value) -> Directive {
    let input = json!({"target": target, "withAlliance": with_alliance, "reason": "farms new Players", "goals": goals});
    give_directive(world, &input, "Daniel").expect("given")
}

/// Gives a directive that must be given.
fn give(world: &mut WorldState, target: &str) -> Directive {
    give_with(world, target, false, json!([{"kind": "soldiers", "count": 1000}]))
}

fn directive<'w>(world: &'w WorldState, id: &str) -> &'w Directive {
    world.directives.iter().find(|d| d.id == id).expect("in force")
}

fn met(world: &WorldState, id: &str) -> Vec<bool> {
    directive(world, id)
        .goals
        .iter()
        .map(|g| matches!(g, DirectiveGoal::City { met: true, .. }))
        .collect()
}

#[test]
fn names_a_realm_or_an_npc_city_with_a_reason_once_each() {
    let mut world = setup();
    let reason = "farms new Players";
    let try_give = |world: &mut WorldState, input: Value| give_directive(world, &input, "D").err();
    for target in ["nobody", "hq", "trade-org"] {
        assert_eq!(
            try_give(
                &mut world,
                json!({"target": target, "withAlliance": false, "reason": reason})
            )
            .as_deref(),
            Some("Name a realm or an NPC city.")
        );
    }
    assert_eq!(
        try_give(&mut world, json!({"target": "r1", "withAlliance": false, "reason": "  "}))
            .as_deref(),
        Some("Give a reason; every Player sees it.")
    );
    let long = "x".repeat(MAX_DIRECTIVE_REASON + 1);
    assert!(try_give(&mut world, json!({"target": "r1", "withAlliance": false, "reason": long}))
        .expect("refused")
        .contains("Keep the reason"));
    assert!(try_give(&mut world, json!({"target": "r1", "withAlliance": "yes", "reason": reason}))
        .expect("refused")
        .contains("alliance"));
    let d = give(&mut world, "r1");
    assert_eq!(
        (d.target.as_str(), d.with_alliance, d.reason.as_str(), d.given_by.as_str()),
        ("r1", false, reason, "Daniel")
    );
    assert_eq!(
        try_give(&mut world, json!({"target": "r1", "withAlliance": true, "reason": reason}))
            .as_deref(),
        Some("A directive already names Aldo.")
    );
    give(&mut world, "n1");
    assert_eq!(world.directives.len(), 2);
    assert!(lift_directive(&mut world, &d.id));
    assert!(!lift_directive(&mut world, &d.id));
    assert_eq!(world.directives.iter().map(|x| x.target.as_str()).collect::<Vec<_>>(), vec!["n1"]);
}

#[test]
fn offers_admins_every_realm_and_npc_city_to_name_never_the_trade_organization() {
    let world = setup();
    let targets = directive_target_choices(&world, &|id| (id == 7).then(|| "mara".to_string()));
    let named = |id: &str, name: &str| NamedCity { id: id.into(), name: name.into() };
    assert_eq!(
        targets,
        vec![
            DirectiveTarget {
                org: "r1".into(),
                name: "Aldo".into(),
                is: TargetIs::Realm,
                account: Some("mara".into()),
                cities: vec![named("c1", "Ashford"), named("c2", "Farhold")],
                allies: vec!["r2".into()],
            },
            DirectiveTarget {
                org: "r2".into(),
                name: "Bea".into(),
                is: TargetIs::Realm,
                account: None,
                cities: vec![named("c3", "Bywater")],
                allies: vec!["r1".into()],
            },
            DirectiveTarget {
                org: "n1".into(),
                name: "Nook".into(),
                is: TargetIs::City,
                account: None,
                cities: vec![named("n1", "Nook")],
                allies: Vec::new(),
            },
        ]
    );
}

#[test]
fn shows_admins_who_gave_it_and_how_far_its_goals_have_come() {
    let mut world = setup();
    give_with(&mut world, "n1", false, json!([{"kind": "city", "cityId": "n1"}]));
    let views = admin_directives(&world);
    assert_eq!(views.len(), 1);
    let v = &views[0];
    assert_eq!(
        (v.target.as_str(), v.target_name.as_str(), v.given_by.as_str(), v.soldiers_killed),
        ("n1", "Nook", "Daniel", 0.0)
    );
    assert_eq!(
        v.goals,
        vec![DirectiveGoal::City { city_id: "n1".into(), city: "Nook".into(), met: false }]
    );
}

#[test]
fn needs_at_least_one_goal_each_a_city_of_whom_it_names_or_soldiers_killed() {
    let mut world = setup();
    let mut try_goals = |goals: Value| {
        let input = json!({"target": "r1", "withAlliance": false, "reason": "farms new Players", "goals": goals});
        give_directive(&mut world, &input, "Daniel").err().unwrap_or_default()
    };
    assert_eq!(try_goals(Value::Null), "Set at least one goal.");
    assert_eq!(try_goals(json!([])), "Set at least one goal.");
    assert_eq!(
        try_goals(json!([{"kind": "gold"}])),
        "A goal is a city destroyed or soldiers killed."
    );
    assert_eq!(try_goals(json!([null])), "A goal is a city destroyed or soldiers killed.");
    let many: Vec<Value> =
        (0..=MAX_DIRECTIVE_GOALS).map(|_| json!({"kind": "soldiers", "count": 1})).collect();
    assert!(try_goals(json!(many)).contains("at most"));
    // Bywater is r2's: only a directive with r1's alliance can make it a goal.
    assert!(try_goals(json!([{"kind": "city", "cityId": "c3"}])).contains("city of the target"));
    assert!(try_goals(json!([{"kind": "city", "cityId": "n1"}])).contains("city of the target"));
    assert_eq!(
        try_goals(json!([{"kind": "city", "cityId": "c1"}, {"kind": "city", "cityId": "c1"}])),
        "Ashford is a goal twice."
    );
    for count in [json!(0), json!(1.5), json!(-2), json!(MAX_DIRECTIVE_SOLDIERS + 1.0), json!("3")]
    {
        assert!(
            try_goals(json!([{"kind": "soldiers", "count": count}])).contains("soldiers killed")
        );
    }
    for percent in [0.0, 101.0, 33.3] {
        assert!(
            try_goals(json!([{"kind": "soldierShare", "percent": percent}])).contains("percent")
        );
    }
    assert!(world.directives.is_empty());
    let goals = json!([{"kind": "city", "cityId": "c3"}, {"kind": "city", "cityId": "c2"}, {"kind": "soldiers", "count": 12}]);
    let d = give_with(&mut world, "r1", true, goals);
    assert_eq!(
        d.goals,
        vec![
            DirectiveGoal::City { city_id: "c3".into(), city: "Bywater".into(), met: false },
            DirectiveGoal::City { city_id: "c2".into(), city: "Farhold".into(), met: false },
            DirectiveGoal::Soldiers { count: 12.0, percent: None },
        ]
    );
    assert_eq!(d.soldiers_killed, 0.0);
}

#[test]
fn counts_a_share_of_soldiers_from_those_it_names_when_given_at_least_one() {
    let mut world = setup();
    for i in 0..5 {
        soldier(&mut world, &format!("s{i}"), "r1", "c2");
    }
    soldier(&mut world, "x1", "r2", "c3");
    person(&mut world, "u1", "r1", MID + 244.0, MID + 4.0, "c2", "u1"); // unarmed: no soldier
    let d = give_with(&mut world, "r1", false, json!([{"kind": "soldierShare", "percent": 50}]));
    // r1 has 5 soldiers (Aldo carries no weapon); half of them is 3, rounding up.
    assert_eq!(d.goals, vec![DirectiveGoal::Soldiers { count: 3.0, percent: Some(50.0) }]);
    lift_directive(&mut world, &d.id);
    // With its alliance, Bea's realm's soldier counts too.
    let all = give_with(&mut world, "r1", true, json!([{"kind": "soldierShare", "percent": 100}]));
    assert_eq!(all.goals, vec![DirectiveGoal::Soldiers { count: 6.0, percent: Some(100.0) }]);
    lift_directive(&mut world, &all.id);
    let none = give_with(&mut world, "n1", false, json!([{"kind": "soldierShare", "percent": 10}]));
    assert_eq!(none.goals, vec![DirectiveGoal::Soldiers { count: 1.0, percent: Some(10.0) }]);
}

#[test]
fn counts_soldiers_of_those_it_names_killed_not_the_unarmed() {
    let mut world = setup();
    let d = give_with(&mut world, "r1", true, json!([{"kind": "soldiers", "count": 1000}]));
    let other = give(&mut world, "n1");
    let s1 = soldier(&mut world, "s1", "r1", "c2");
    let ally = soldier(&mut world, "x1", "r2", "c3");
    let unarmed = person(&mut world, "u1", "r1", MID + 244.0, MID + 4.0, "c2", "u1");
    let killed: Vec<_> = [s1, unarmed, ally].iter().map(|&i| world.residents[i].clone()).collect();
    count_soldiers_killed(&mut world, &killed);
    assert_eq!(directive(&world, &d.id).soldiers_killed, 2.0);
    assert_eq!(directive(&world, &other.id).soldiers_killed, 0.0);
}

#[test]
fn meets_a_city_goal_once_the_city_is_captured_or_dissolved_and_keeps_it_met() {
    let mut world = setup();
    let goals = json!([
        {"kind": "city", "cityId": "c1"}, {"kind": "city", "cityId": "c2"},
        {"kind": "city", "cityId": "c3"}, {"kind": "soldiers", "count": 50}
    ]);
    let d = give_with(&mut world, "r1", true, goals);
    let c2 = |world: &mut WorldState| {
        world
            .cities
            .iter_mut()
            .find(|c| c.id == "c2")
            .expect("c2")
            .realm_id
            .clone_from(&Some("r2".into()))
    };
    // Handing a city to an ally the directive names doesn't destroy it.
    c2(&mut world);
    step_directives(&mut world);
    assert_eq!(met(&world, &d.id), vec![false; 4]);
    // Captured by someone it doesn't name.
    world.realms.push(
        serde_json::from_value(json!({"id": "r3", "userId": 9, "leaderId": "z1"}))
            .expect("a realm"),
    );
    world.cities.iter_mut().find(|c| c.id == "c2").expect("c2").realm_id = Some("r3".into());
    // Its town hall torn down: the city is gone.
    world.cities.retain(|c| c.id != "c3");
    step_directives(&mut world);
    assert_eq!(met(&world, &d.id), vec![false, true, true, false]);
    // Taken back, it stays met.
    world.cities.iter_mut().find(|c| c.id == "c2").expect("c2").realm_id = Some("r1".into());
    step_directives(&mut world);
    assert_eq!(met(&world, &d.id), vec![false, true, true, false]);
    assert_eq!(world.directives.len(), 1);
    assert!(directives_sound(&world).is_empty());
}

#[test]
fn meets_an_npc_city_targets_city_goal_once_it_joins_a_realm() {
    let mut world = setup();
    give_with(&mut world, "n1", false, json!([{"kind": "city", "cityId": "n1"}]));
    step_directives(&mut world);
    assert_eq!(world.directives.len(), 1);
    world.cities.iter_mut().find(|c| c.id == "n1").expect("n1").realm_id = Some("r2".into());
    step_directives(&mut world);
    assert!(world.directives.is_empty());
}

#[test]
fn ends_once_all_its_goals_are_met_telling_every_realm_it_named() {
    let mut world = setup();
    let d = give_with(
        &mut world,
        "r1",
        true,
        json!([{"kind": "city", "cityId": "c2"}, {"kind": "soldiers", "count": 2}]),
    );
    let c2 = world.cities.iter_mut().find(|c| c.id == "c2").expect("c2");
    c2.realm_id = None;
    let s1 = soldier(&mut world, "s1", "r1", "c2");
    let killed = vec![world.residents[s1].clone()];
    count_soldiers_killed(&mut world, &killed);
    step_directives(&mut world);
    // One soldier of two: it stands.
    assert_eq!(world.directives.len(), 1);
    let s2 = soldier(&mut world, "s2", "r2", "c3");
    let killed = vec![world.residents[s2].clone()];
    count_soldiers_killed(&mut world, &killed);
    step_directives(&mut world);
    assert!(world.directives.is_empty());
    for user in [7, 8] {
        let ended: Vec<_> = world
            .events
            .iter()
            .filter(|e| e.user_id == user && matches!(&e.what, RealmEventWhat::DirectiveEnded { reason } if *reason == d.reason))
            .collect();
        assert_eq!(ended.len(), 1);
    }
}

#[test]
fn ends_within_a_world_step_once_a_goal_city_is_lost() {
    let mut world = setup();
    give_with(&mut world, "r1", false, json!([{"kind": "city", "cityId": "c2"}]));
    let terrain = terrain();
    let mut scratch = Scratch::default();
    step_world(&mut world, &terrain, &mut scratch, None, None);
    assert_eq!(world.directives.len(), 1);
    world.cities.iter_mut().find(|c| c.id == "c2").expect("c2").realm_id = None;
    step_world(&mut world, &terrain, &mut scratch, None, None);
    assert!(world.directives.is_empty());
}

#[test]
fn never_ends_on_its_own_without_goals() {
    let mut world = setup();
    let d = give(&mut world, "r1");
    world.directives[0].goals.clear();
    step_directives(&mut world);
    assert_eq!(world.directives.len(), 1);
    assert_eq!(world.directives[0].id, d.id);
}

fn base(id: &str, target: &str, reason: &str, goals: Value, killed: f64) -> Directive {
    serde_json::from_value(json!({
        "id": id, "target": target, "withAlliance": false, "reason": reason, "givenBy": "Daniel", "givenAt": 0,
        "goals": goals, "soldiersKilled": killed, "price": null
    }))
    .expect("a directive")
}

#[test]
fn directives_sound_catches_the_trade_organization_a_target_named_twice_or_no_reason() {
    let mut world = setup();
    world.directives = vec![
        base("d1", "hq", "x", json!([]), 0.0),
        base("d2", "r1", "x", json!([]), 0.0),
        base("d3", "r1", " ", json!([]), 0.0),
    ];
    let found: Vec<String> = directives_sound(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(
        found,
        vec![
            "directive d1 names the Trade Organization",
            "r1 is named by two directives",
            "directive d3 has a reason of 1 characters"
        ]
    );
}

#[test]
fn directives_sound_catches_badly_formed_goals_a_partial_count_and_all_goals_met() {
    let mut world = setup();
    world.directives = vec![
        base(
            "d1",
            "r1",
            "x",
            json!([{"kind": "soldiers", "count": 0}, {"kind": "soldiers", "count": 3, "percent": 120}]),
            1.5,
        ),
        base(
            "d2",
            "r2",
            "x",
            json!([{"kind": "city", "cityId": "c3", "city": "Bywater", "met": true}, {"kind": "soldiers", "count": 2}]),
            2.0,
        ),
    ];
    let found: Vec<String> = directives_sound(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(
        found,
        vec![
            "directive d1 counts 1.5 soldiers killed",
            "directive d1 asks for 0 soldiers killed",
            "directive d1 asks for 120% of its soldiers killed",
            "directive d2 met all its goals but is still in force",
        ]
    );
}

/// The setup with a directive against r1 that costs `price` to buy off.
fn priced(price: Value, with_alliance: bool) -> (WorldState, String) {
    let mut world = setup();
    let input = json!({
        "target": "r1", "withAlliance": with_alliance, "reason": "farms new Players", "price": price,
        "goals": [{"kind": "soldiers", "count": 1000}]
    });
    let d = give_directive(&mut world, &input, "Daniel").expect("given");
    (world, d.id)
}

fn building_at(world: &WorldState, id: &str) -> (f64, f64) {
    let b = world.buildings.iter().find(|b| b.id == id).expect("a building");
    (b.x, b.y)
}

/// Puts a resident on a tile with some coins in their hands.
fn stand_on(world: &mut WorldState, id: &str, at: (f64, f64), coins: f64) {
    let r = world.residents.iter_mut().find(|x| x.id == id).expect("a resident");
    (r.x, r.y) = at;
    r.carried =
        if coins > 0.0 { [(Good::Coins, coins)].into_iter().collect() } else { Default::default() };
}

fn buy_off(
    world: &mut WorldState,
    from: u64,
    resident: &str,
    directive: &str,
    carriage: Option<&str>,
) -> Result<(), String> {
    let o = json!({"kind": "buyOff", "residentId": resident, "directiveId": directive, "carriageId": carriage});
    send(world, &terrain(), &BuyOff, from, o)
}

fn coins_in(world: &WorldState, id: &str) -> f64 {
    let b = world.buildings.iter().find(|b| b.id == id).expect("a building");
    b.stock.as_ref().map_or(0.0, |s| held(s, Good::Coins))
}

#[test]
fn ends_the_directive_once_the_target_pays_its_price_at_a_warehouse() {
    let (mut world, d) = priced(json!(300), false);
    let goods = building_at(&world, "hq-goods");
    stand_on(&mut world, "a1", goods, 350.0);
    let before = coins_in(&world, "hq-coins");
    assert_eq!(buy_off(&mut world, 7, "a1", &d, None), Ok(()));
    let (bought, records) = resolve_buy_offs(&mut world);
    assert_eq!(bought, 1);
    assert!(world.directives.is_empty());
    let a1 = world.residents.iter().find(|r| r.id == "a1").expect("a1");
    assert_eq!(held(&a1.carried, Good::Coins), 50.0);
    assert_eq!(a1.order, None);
    assert_eq!(coins_in(&world, "hq-coins"), before + 300.0);
    assert_eq!(coins_in(&world, "hq-goods"), 0.0);
    let bought_off: Vec<_> = world
        .events
        .iter()
        .filter(|e| matches!(e.what, RealmEventWhat::BoughtOff { .. }))
        .collect();
    assert_eq!(bought_off.len(), 1);
    let RealmEventWhat::BoughtOff { name, reason, coins, .. } = &bought_off[0].what else {
        unreachable!()
    };
    assert_eq!((name.as_str(), reason.as_str(), *coins), ("Aldo", "farms new Players", 300.0));
    assert_eq!(records.len(), 1);
    assert!(buy_offs_sound(&world, &records).is_empty());
}

#[test]
fn takes_the_price_from_a_carriage_and_at_the_coin_warehouse_itself() {
    let (mut world, d) = priced(json!(300), false);
    let coins = building_at(&world, "hq-coins");
    stand_on(&mut world, "a1", coins, 0.0);
    let carriage = json!({"id": "k1", "realmId": "r1", "cityId": null, "x": coins.0, "y": coins.1, "horseId": null, "load": {"coins": 300}});
    world.carriages.push(serde_json::from_value(carriage).expect("a carriage"));
    let before = coins_in(&world, "hq-coins");
    assert_eq!(buy_off(&mut world, 7, "a1", &d, Some("k1")), Ok(()));
    let mut scratch = Scratch::default();
    step_world(&mut world, &terrain(), &mut scratch, None, None);
    assert!(world.directives.is_empty());
    assert_eq!(world.carriages[0].load.get(&Good::Coins), None);
    assert_eq!(coins_in(&world, "hq-coins"), before + 300.0);
}

#[test]
fn is_refused_unless_the_admin_allows_it_to_the_target_with_the_whole_price_on_a_warehouse() {
    let (mut world, d) = priced(json!(300), true);
    let goods = building_at(&world, "hq-goods");
    stand_on(&mut world, "a1", goods, 299.0);
    stand_on(&mut world, "b1", goods, 1000.0);
    let ask = |world: &WorldState, from: u64, resident: &str, directive: &str| {
        let o: csp_shared::world::OrderRequest =
            serde_json::from_value(json!({"kind": "buyOff", "residentId": resident, "directiveId": directive, "carriageId": null}))
                .expect("an order");
        BuyOff.validate(world, &OrderSender { user_id: from, npc_city_id: None }, &o, None)
    };
    assert_eq!(ask(&world, 7, "a1", &d).as_deref(), Some("it costs 300 coins"));
    // Bea's realm is named only through its alliance: the target pays, not its allies.
    assert_eq!(
        ask(&world, 8, "b1", &d).as_deref(),
        Some("no directive names your realm by that id")
    );
    assert_eq!(
        ask(&world, 7, "a1", "nope").as_deref(),
        Some("no directive names your realm by that id")
    );
    stand_on(&mut world, "a1", (goods.0 + 30.0, goods.1 + 30.0), 300.0);
    assert_eq!(ask(&world, 7, "a1", &d).as_deref(), Some("not at a Trade Org warehouse"));
    stand_on(&mut world, "a1", goods, 300.0);
    assert_eq!(ask(&world, 7, "a1", &d), None);
    assert_eq!(set_directive_price(&mut world, &d, &Value::Null).map(|d| d.price), Ok(None));
    assert_eq!(ask(&world, 7, "a1", &d).as_deref(), Some("this directive can’t be bought off"));
}

#[test]
fn does_nothing_when_the_price_rose_since_the_order() {
    let (mut world, d) = priced(json!(300), false);
    let goods = building_at(&world, "hq-goods");
    stand_on(&mut world, "a1", goods, 300.0);
    buy_off(&mut world, 7, "a1", &d, None).expect("taken");
    set_directive_price(&mut world, &d, &json!(400)).expect("set");
    let mut scratch = Scratch::default();
    step_world(&mut world, &terrain(), &mut scratch, None, None);
    assert_eq!(world.directives.len(), 1);
    let a1 = world.residents.iter().find(|r| r.id == "a1").expect("a1");
    assert_eq!(held(&a1.carried, Good::Coins), 300.0);
    assert_eq!(a1.order, None);
}

#[test]
fn lets_admins_set_whole_coins_as_the_price_or_none() {
    let (mut world, d) = priced(Value::Null, false);
    assert_eq!(directive(&world, &d).price, None);
    let bad = "A price to buy it off is a whole number of Coins, at least one, or none.";
    for price in [json!(0), json!(-5), json!(2.5), json!("100")] {
        assert_eq!(set_directive_price(&mut world, &d, &price).err().as_deref(), Some(bad));
    }
    assert_eq!(
        set_directive_price(&mut world, "nope", &json!(100)).err().as_deref(),
        Some("No such directive.")
    );
    assert_eq!(set_directive_price(&mut world, &d, &json!(500)).map(|d| d.price), Ok(Some(500.0)));
    let input = json!({"target": "n1", "withAlliance": false, "reason": "x", "price": 0, "goals": [{"kind": "soldiers", "count": 1000}]});
    assert_eq!(give_directive(&mut world, &input, "Daniel").err().as_deref(), Some(bad));
}

#[test]
fn the_buy_off_invariants_catch_a_price_that_is_not_whole_coins() {
    let mut world = setup();
    let d = give(&mut world, "r1");
    world.directives[0].price = Some(2.5);
    let found: Vec<String> = directives_sound(&world).into_iter().map(|v| v.message).collect();
    assert_eq!(found, vec![format!("directive {} asks 2.5 coins to buy it off", d.id)]);
}

#[test]
fn the_buy_off_invariants_catch_a_buy_off_that_made_or_lost_coins_or_left_its_directive_in_force() {
    let (mut world, d) = priced(json!(100), false);
    let saved = directive(&world, &d).clone();
    let coins = building_at(&world, "hq-coins");
    stand_on(&mut world, "a1", coins, 100.0);
    let a1 = world.residents.iter_mut().find(|r| r.id == "a1").expect("a1");
    a1.order = Some(ResidentOrder::BuyOff(csp_shared::world::BuyOffOrder {
        directive_id: d.clone(),
        carriage_id: None,
    }));
    let mut scratch = Scratch::default();
    let result = step_world(&mut world, &terrain(), &mut scratch, None, None);
    assert!(world.directives.is_empty());
    assert!(buy_offs_sound(&world, &result.buy_offs).is_empty());
    let mut records = result.buy_offs;
    records[0].after += 1.0;
    world.directives.push(saved);
    let before = records[0].before;
    let found: Vec<String> =
        buy_offs_sound(&world, &records).into_iter().map(|v| v.message).collect();
    assert_eq!(
        found,
        vec![
            format!(
                "a buy-off by a1 turned {} coins into {}",
                js_number(before),
                js_number(before + 1.0)
            ),
            format!("directive {d} still holds after it was bought off"),
        ]
    );
}

#[test]
fn the_buy_off_invariants_catch_a_buy_off_order_that_outlasts_its_tick() {
    let mut world = setup();
    let a1 = world.residents.iter_mut().find(|r| r.id == "a1").expect("a1");
    a1.order = Some(ResidentOrder::BuyOff(csp_shared::world::BuyOffOrder {
        directive_id: "d".into(),
        carriage_id: None,
    }));
    assert_eq!(buy_off_orders_done(&world).len(), 1);
}

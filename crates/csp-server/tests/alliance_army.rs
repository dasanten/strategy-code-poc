//! `apps/server/src/alliance-army.test.ts`, ported (T86.17). Here and not in `csp-sim`, as the
//! alliance matters a member sees (`diplomacy_for`) are the server's.

use csp_server::diplomacy::diplomacy_for;
use csp_shared::balance::{ALLIANCE_LEAVE_DELAY, ALLIANCE_RECALL_DELAY};
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    AllianceArmyPart, AllianceArmyPartIs, DeathCause, Good, ResidentOrder, WorldState,
};
use csp_sim::alliances::step_alliances;
use csp_sim::armies::step_armies;
use csp_sim::invariants::{check_all, world_invariants};
use csp_sim::npc_behaviour::npc_home;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::queries::alliance::{alliance_of, commander_of};
use csp_sim::queries::city_area::in_city_area;
use csp_sim::starting_city::found_starting_city;
use csp_sim::survival::die_all;
use csp_sim::world::create_world;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Arc, OnceLock};

/// `cityTerrain()` of `test-terrain.ts`: the seed-1 map of 1536 tiles the TypeScript generated
/// (`csp-sim/fixtures/terrain/1-1536.bin`), not today's new land. Read once.
fn city_terrain() -> &'static TerrainMap {
    static TERRAIN: OnceLock<TerrainMap> = OnceLock::new();
    TERRAIN.get_or_init(|| {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../csp-sim/fixtures/terrain/1-1536.bin");
        TerrainMap { size: 1536, tiles: std::fs::read(path).expect("terrain fixture") }
    })
}

const MARA: u64 = 1;
const TOBIN: u64 = 2;
const ASH: u64 = 3;

fn player(user_id: u64) -> OrderSender {
    OrderSender::player(user_id, &format!("p{user_id}"))
}

struct Setup {
    world: WorldState,
    terrain: &'static TerrainMap,
    queue: OrderQueue,
    alliance_id: String,
    used: HashSet<String>,
}

/// Mara leads the alliance "North" with Tobin in it; Ash is in none. Each has a starting city;
/// `soldier(p)` arms a resident of the Player's realm, not their Leader.
fn setup() -> Setup {
    let terrain = city_terrain();
    let mut world = create_world(terrain, 1);
    for p in [MARA, TOBIN, ASH] {
        found_starting_city(&mut world, terrain, p, None);
    }
    let queue = OrderQueue::new(order_kinds(), Some(Arc::new(terrain.clone())));
    let mut s = Setup { world, terrain, queue, alliance_id: String::new(), used: HashSet::new() };
    s.order(MARA, json!({ "kind": "foundAlliance", "name": "North" }));
    let id = alliance_of(&s.world, &s.realm(MARA)).unwrap().id.clone();
    s.order(MARA, json!({ "kind": "inviteToAlliance", "realmId": s.realm(TOBIN) }));
    s.world.tick += 1;
    s.order(TOBIN, json!({ "kind": "acceptInvite", "allianceId": id }));
    s.alliance_id = id;
    s
}

impl Setup {
    fn realm(&self, user_id: u64) -> String {
        self.world.realms.iter().find(|r| r.user_id == user_id).unwrap().id.clone()
    }

    /// Sends an order and applies it as the next tick would; the reason it was refused, or "ok".
    fn order(&mut self, user_id: u64, o: Value) -> String {
        let answer = self.queue.receive(&self.world, &player(user_id), &json!("q"), &o);
        self.queue.apply_all(&mut self.world);
        match answer {
            OrderReply::Rejected { reason, .. } => reason,
            OrderReply::Ack { .. } => "ok".into(),
        }
    }

    /// The id of a grown resident of the Player's realm, not their Leader, not given out before,
    /// holding a sword.
    fn soldier(&mut self, user_id: u64) -> String {
        let realm_id = self.realm(user_id);
        let leader = self.world.realms.iter().find(|r| r.id == realm_id).unwrap().leader_id.clone();
        let used = &self.used;
        let r = self
            .world
            .residents
            .iter_mut()
            .find(|x| {
                x.owner.as_deref() == Some(realm_id.as_str())
                    && x.id != leader
                    && !used.contains(&x.id)
                    && x.born_at < -1e6
            })
            .expect("a soldier");
        r.carried.insert(Good::Sword, 1.0);
        let id = r.id.clone();
        self.used.insert(id.clone());
        id
    }

    fn carriage(&self, user_id: u64) -> String {
        let realm_id = self.realm(user_id);
        self.world
            .carriages
            .iter()
            .find(|k| k.realm_id.as_deref() == Some(realm_id.as_str()))
            .unwrap()
            .id
            .clone()
    }

    fn r(&mut self, id: &str) -> &mut csp_shared::world::Resident {
        self.world.residents.iter_mut().find(|r| r.id == id).unwrap()
    }

    fn walk(&self, id: &str) -> Value {
        let r = self.world.residents.iter().find(|r| r.id == id).unwrap();
        json!({ "kind": "walkTo", "residentId": id, "x": r.x + 1.0, "y": r.y })
    }

    fn commander(&self, id: &str) -> Option<String> {
        let r = self.world.residents.iter().find(|r| r.id == id).unwrap();
        commander_of(&self.world, id, r.owner.as_deref())
    }

    /// Moves time on by `ticks`, running alliances and armies each tick as the world does.
    fn pass(&mut self, ticks: f64) {
        for _ in 0..ticks as usize {
            self.world.tick += 1;
            step_alliances(&mut self.world);
            step_armies(&mut self.world, self.terrain.size);
        }
    }

    #[track_caller]
    fn assert_sound(&self) {
        let broken: Vec<String> = check_all(&self.world, self.terrain)
            .iter()
            .map(|v| format!("{}: {}", v.invariant, v.message))
            .collect();
        assert!(broken.is_empty(), "{broken:?}");
    }

    fn army_ids(&self) -> Vec<String> {
        self.world.alliances[0].army.iter().map(|p| p.id.clone()).collect()
    }

    fn die_leader_of_realm_1(&mut self) {
        let leader = self.world.realms[1].leader_id.clone();
        die_all(&mut self.world, &[leader], DeathCause::Killed, self.terrain.size, None);
    }
}

fn walk_order(x: f64, y: f64) -> ResidentOrder {
    serde_json::from_value(
        json!({ "kind": "walkTo", "target": { "x": x, "y": y }, "path": null, "progress": 0 }),
    )
    .unwrap()
}

#[test]
fn hands_over_soldiers_and_carriages_who_then_take_orders_only_from_the_alliance_leader() {
    let mut t = setup();
    let s = t.soldier(TOBIN);
    let k = t.carriage(TOBIN);
    let (sx, sy) = (t.r(&s).x, t.r(&s).y);
    t.r(&s).order = Some(walk_order(sx + 1.0, sy));
    assert_eq!(
        t.order(
            TOBIN,
            json!({ "kind": "handOverToAlliance", "residentIds": [s], "carriageIds": [k] })
        ),
        "ok"
    );
    // Handing over stops what they were doing; they stay in their own realm.
    assert!(t.r(&s).order.is_none());
    let tobin_realm = t.realm(TOBIN);
    assert_eq!(t.r(&s).owner, Some(tobin_realm));
    let carriage = t.world.carriages.iter().find(|c| c.id == k).unwrap().clone();
    assert_eq!(carriage.realm_id, Some(t.realm(TOBIN)));
    assert_eq!(t.commander(&s), Some(t.realm(MARA)));
    assert_eq!(
        t.world.alliances[0].army,
        vec![
            AllianceArmyPart { is: AllianceArmyPartIs::Resident, id: s.clone(), recall_at: None },
            AllianceArmyPart { is: AllianceArmyPartIs::Carriage, id: k.clone(), recall_at: None },
        ]
    );
    let walk = t.walk(&s);
    assert_eq!(t.order(TOBIN, walk.clone()), "not one of your residents");
    assert_eq!(t.order(MARA, walk), "ok");
    let driver = t
        .world
        .residents
        .iter()
        .find(|x| x.owner.as_deref() == Some(t.realm(TOBIN).as_str()) && x.id != s)
        .unwrap()
        .id
        .clone();
    let drive = json!({
        "kind": "drive", "residentId": driver, "carriageId": k,
        "x": carriage.x + 1.0, "y": carriage.y
    });
    assert_eq!(t.order(TOBIN, drive), "not one of your carriages");
    // The alliance leader can put soldiers handed over into an army of theirs.
    assert_eq!(
        t.order(MARA, json!({ "kind": "formArmy", "name": "Guard", "residentIds": [s] })),
        "ok"
    );
    assert!(t
        .order(TOBIN, json!({ "kind": "formArmy", "name": "Mine", "residentIds": [s] }))
        .contains("not all of them"));
    t.pass(1.0);
    let mara_realm = t.realm(MARA);
    let army = t.world.armies.iter().find(|a| a.realm_id == mara_realm).unwrap();
    assert_eq!(army.member_ids, vec![s.clone()]);
    t.assert_sound();
    // Members see the alliance army in their alliance matters.
    let seen = diplomacy_for(&t.world, &t.realm(TOBIN), [], vec![]).alliance.unwrap().army;
    let seen = serde_json::to_value(&seen).unwrap();
    let tobin = t.realm(TOBIN);
    let want =
        |is: &str, id: &str| json!({ "is": is, "id": id, "realmId": tobin, "recallAt": null });
    for (got, want) in
        seen.as_array().unwrap().iter().zip([want("resident", &s), want("carriage", &k)])
    {
        for (key, v) in want.as_object().unwrap() {
            assert_eq!(&got[key], v, "{key} of {got}");
        }
    }
    assert_eq!(seen.as_array().unwrap().len(), 2);
    assert_eq!(alliance_of(&t.world, &t.realm(MARA)).unwrap().id, t.alliance_id);
}

#[test]
fn takes_only_soldiers_and_carriages_of_a_member_each_once() {
    let mut t = setup();
    let s = t.soldier(TOBIN);
    let hand = |t: &mut Setup, p: u64, o: Value| {
        let mut order = json!({ "kind": "handOverToAlliance" });
        order.as_object_mut().unwrap().extend(o.as_object().unwrap().clone());
        t.order(p, order)
    };
    let ash_soldier = t.soldier(ASH);
    assert_eq!(
        hand(&mut t, ASH, json!({ "residentIds": [ash_soldier] })),
        "you are in no alliance"
    );
    t.r(&s).carried.shift_remove(&Good::Sword);
    assert!(hand(&mut t, TOBIN, json!({ "residentIds": [s] })).contains("is not a soldier"));
    t.r(&s).carried.insert(Good::Sword, 1.0);
    let mara_soldier = t.soldier(MARA);
    assert!(
        hand(&mut t, TOBIN, json!({ "residentIds": [mara_soldier] })).contains("not all of them")
    );
    let mara_carriage = t.carriage(MARA);
    assert!(
        hand(&mut t, TOBIN, json!({ "carriageIds": [mara_carriage] })).contains("not all of them")
    );
    assert!(hand(&mut t, TOBIN, json!({ "residentIds": [s, s] })).contains("once"));
    assert_eq!(hand(&mut t, TOBIN, json!({})), "hand over at least one");
    assert_eq!(hand(&mut t, TOBIN, json!({ "residentIds": [s] })), "ok");
    assert!(
        hand(&mut t, TOBIN, json!({ "residentIds": [s] })).contains("already in the alliance army")
    );
    t.order(TOBIN, json!({ "kind": "leaveAlliance" }));
    let tobin_carriage = t.carriage(TOBIN);
    assert_eq!(
        hand(&mut t, TOBIN, json!({ "carriageIds": [tobin_carriage] })),
        "you are leaving the alliance"
    );
    assert_eq!(t.world.alliances[0].army.len(), 1);
}

#[test]
fn gives_a_recalled_soldier_back_after_a_game_day_stopping_the_leaders_order() {
    let mut t = setup();
    let s = t.soldier(TOBIN);
    t.order(TOBIN, json!({ "kind": "handOverToAlliance", "residentIds": [s] }));
    let recall = json!({ "kind": "recallFromAlliance", "ids": [s] });
    assert_eq!(t.order(MARA, recall.clone()), "you did not hand that over");
    assert_eq!(t.order(TOBIN, recall.clone()), "ok");
    assert_eq!(t.order(TOBIN, recall), "already recalled");
    assert_eq!(
        t.world.alliances[0].army[0].recall_at,
        Some(t.world.tick as f64 + ALLIANCE_RECALL_DELAY)
    );
    // Until the recall takes effect, the soldier still takes the alliance leader's orders.
    t.pass(ALLIANCE_RECALL_DELAY - 1.0);
    let walk = t.walk(&s);
    assert_eq!(t.order(MARA, walk.clone()), "ok");
    assert_eq!(t.order(TOBIN, walk.clone()), "not one of your residents");
    assert!(t.r(&s).order.is_some());
    t.assert_sound();
    t.pass(1.0);
    assert!(t.world.alliances[0].army.is_empty());
    assert_eq!(t.commander(&s), Some(t.realm(TOBIN)));
    assert!(t.r(&s).order.is_none());
    assert_eq!(t.order(TOBIN, walk.clone()), "ok");
    assert_eq!(t.order(MARA, walk), "not one of your residents");
}

#[test]
fn recalls_everything_when_a_member_leaves_and_leaves_armies_it_made() {
    let mut t = setup();
    let s = t.soldier(TOBIN);
    let k = t.carriage(TOBIN);
    t.order(TOBIN, json!({ "kind": "handOverToAlliance", "residentIds": [s], "carriageIds": [k] }));
    t.order(MARA, json!({ "kind": "formArmy", "name": "Guard", "residentIds": [s] }));
    t.order(TOBIN, json!({ "kind": "leaveAlliance" }));
    t.pass(ALLIANCE_LEAVE_DELAY);
    assert!(alliance_of(&t.world, &t.realm(TOBIN)).is_none());
    assert!(t.world.alliances[0].army.is_empty());
    assert_eq!(t.commander(&s), Some(t.realm(TOBIN)));
    assert!(t.world.armies.is_empty());
    t.assert_sound();
}

#[test]
fn goes_to_the_next_alliance_leader_and_back_home_when_its_owners_leader_dies() {
    let mut t = setup();
    let s = t.soldier(TOBIN);
    let own = t.soldier(MARA);
    t.order(TOBIN, json!({ "kind": "handOverToAlliance", "residentIds": [s] }));
    t.order(MARA, json!({ "kind": "handOverToAlliance", "residentIds": [own] }));
    // Mara leaves: her soldier comes back to her, Tobin leads and commands his own again.
    t.order(MARA, json!({ "kind": "leaveAlliance" }));
    t.pass(ALLIANCE_LEAVE_DELAY);
    assert_eq!(t.world.alliances[0].leader_id, t.realm(TOBIN));
    assert_eq!(t.army_ids(), vec![s.clone()]);
    assert_eq!(t.commander(&own), Some(t.realm(MARA)));
    assert_eq!(t.commander(&s), Some(t.realm(TOBIN)));
    t.die_leader_of_realm_1();
    assert!(t.world.alliances.is_empty());
    assert_eq!(t.commander(&s), None);
    t.assert_sound();
}

#[test]
fn sends_a_dead_leaders_alliance_army_soldiers_home_out_of_the_alliance_leaders_army() {
    let mut t = setup();
    let s = t.soldier(TOBIN);
    let k = t.carriage(TOBIN);
    t.order(TOBIN, json!({ "kind": "handOverToAlliance", "residentIds": [s], "carriageIds": [k] }));
    assert_eq!(
        t.order(MARA, json!({ "kind": "formArmy", "name": "Guard", "residentIds": [s] })),
        "ok"
    );
    // Far out on the alliance leader's errand.
    let city_id = t.r(&s).city_id.clone().unwrap();
    let size = t.terrain.size;
    let x = (t.r(&s).x + 30.0) % f64::from(size);
    t.r(&s).x = x;
    let y = t.r(&s).y;
    assert!(!in_city_area(&t.world, &city_id, x, y, size));
    let walk = json!({ "kind": "walkTo", "residentId": s, "x": x + 1.0, "y": y });
    assert_eq!(t.order(MARA, walk), "ok");
    t.die_leader_of_realm_1();
    // The realm left at once; Mara's alliance carries on without Tobin's soldier and carriage.
    let members: Vec<String> =
        t.world.alliances[0].members.iter().map(|m| m.realm_id.clone()).collect();
    assert_eq!(members, vec![t.realm(MARA)]);
    assert!(t.world.alliances[0].army.is_empty());
    assert!(t.world.armies.is_empty());
    assert_eq!(t.commander(&s), None);
    assert_eq!(t.world.carriages.iter().find(|c| c.id == k).unwrap().realm_id, None);
    let home = npc_home(&t.world, &city_id).unwrap();
    let (hx, hy) = (home.x, home.y);
    match &t.r(&s).order {
        Some(ResidentOrder::WalkTo(w)) => assert_eq!((w.target.x, w.target.y), (hx, hy)),
        other => panic!("{other:?}"),
    }
    t.assert_sound();
}

#[test]
fn reports_alliance_armies_that_dont_hold_together() {
    let mut t = setup();
    let s = t.soldier(TOBIN);
    t.order(TOBIN, json!({ "kind": "handOverToAlliance", "residentIds": [s] }));
    let ash_soldier = t.soldier(ASH);
    let tick = t.world.tick as f64;
    let a = &mut t.world.alliances[0];
    a.army.push(AllianceArmyPart {
        is: AllianceArmyPartIs::Resident,
        id: s.clone(),
        recall_at: Some(tick),
    });
    a.army.push(AllianceArmyPart {
        is: AllianceArmyPartIs::Carriage,
        id: "carriage999".into(),
        recall_at: None,
    });
    a.army.push(AllianceArmyPart {
        is: AllianceArmyPartIs::Resident,
        id: ash_soldier.clone(),
        recall_at: None,
    });
    let id = a.id.clone();
    let invariant = world_invariants().into_iter().find(|i| i.name == "alliances-sound").unwrap();
    let messages: Vec<String> =
        invariant.check(&t.world, t.terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        vec![
            format!("alliance {id} shares resident {s} in its army"),
            format!("alliance {id} shares resident {s} in its army"),
            format!("alliance {id} has resident {s} in its army recalled at tick {}", t.world.tick),
            format!("alliance {id} has carriage carriage999 in its army, which is gone"),
            format!("alliance {id} has resident {ash_soldier} in its army, which is no member's"),
        ]
    );
}

//! `npc-alliances.test.ts`: NPC cities in alliances (`CONTEXT.md`: Alliance). Its case on the
//! `diplomacyFor` view and the shared walls is in `crates/csp-server/tests/npc_alliances.rs`,
//! where `diplomacy_for` is.

use std::sync::Arc;

use csp_shared::balance::{
    ALLIANCE_LEAVE_DELAY, CRIME_MEMORY_DAYS, NPC_ALLIANCE_JOIN_STANDING,
    NPC_ALLIANCE_LEAVE_STANDING,
};
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Crime, Leaving, Realm, TradeOrgCity, WorldState};
use serde_json::{json, Value};

use super::step_alliances;
use crate::invariants::check_all;
use crate::invariants::checks::alliances_sound;
use crate::order_sender::OrderSender;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queries::alliance::alliance_of;
use crate::random::Mulberry32;
use crate::residents::{new_resident, NewResident};
use crate::sight::entities_in_sight;
use crate::standing::change_standing;
use crate::test_support::add_city;
use crate::world::create_world;
use crate::world_index::WorldIndex;

const SIZE: i32 = 256;

fn terrain() -> TerrainMap {
    TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] }
}

fn mara() -> OrderSender {
    OrderSender::player(1, "p1")
}

fn tobin() -> OrderSender {
    OrderSender::player(2, "p2")
}

fn resident(world: &mut WorldState, id: &str, owner: Option<&str>, x: f64, y: f64) {
    let city_id = owner.is_none().then_some("npc");
    let mut m = Mulberry32::new(world.residents.len() as f64 + 1.0);
    let fields = NewResident { id, owner, city_id, x, y, tick: world.tick as f64 };
    let r = new_resident(&mut || m.next(), &fields, None);
    world.residents.push(r);
}

/// Realms r1 (Mara, leading the alliance "North") and r2 (Tobin, its other member), the NPC city
/// npc (Dunmere) with its resident n1, and the Trade Org post.
struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    alliance: String,
}

impl Setup {
    /// Sends an order and applies it as the next tick would: `ok`, or why it was turned down.
    fn order(&mut self, sender: &OrderSender, o: Value) -> String {
        let mut queue = OrderQueue::new(order_kinds(), Some(self.terrain.clone()));
        let answer = queue.receive(&self.world, sender, &json!("q"), &o);
        queue.apply_all(&mut self.world);
        match answer {
            OrderReply::Rejected { reason, .. } => reason,
            OrderReply::Ack { .. } => "ok".into(),
        }
    }

    fn invite_npc(&mut self) -> String {
        self.order(&mara(), json!({ "kind": "inviteToAlliance", "realmId": "npc" }))
    }

    /// Moves time on, running alliances each tick.
    fn pass(&mut self, ticks: f64) {
        for _ in 0..ticks as u64 {
            self.world.tick += 1;
            step_alliances(&mut self.world);
        }
    }

    fn members(&self) -> Vec<String> {
        let first = self.world.alliances.first();
        first.map(|a| a.members.iter().map(|m| m.realm_id.clone()).collect()).unwrap_or_default()
    }

    fn npc_leaving(&self) -> Option<Leaving> {
        let members = &self.world.alliances[0].members;
        members.iter().find(|m| m.realm_id == "npc").unwrap().leaving.clone()
    }

    /// The last event of Player `user_id`, as JSON.
    fn last_event(&self, user_id: u64) -> Value {
        let e = self.world.events.iter().rfind(|e| e.user_id == user_id);
        serde_json::to_value(e.expect("an event")).unwrap()
    }
}

fn setup() -> Setup {
    let terrain = terrain();
    let mut world = create_world(&terrain, 1);
    for (id, user, leader) in [("r1", 1, "a1"), ("r2", 2, "b1")] {
        let realm = json!({ "id": id, "userId": user, "leaderId": leader });
        world.realms.push(serde_json::from_value::<Realm>(realm).unwrap());
    }
    resident(&mut world, "a1", Some("r1"), 20.0, 20.0);
    resident(&mut world, "b1", Some("r2"), 160.0, 20.0);
    add_city(&mut world, "npc", None, 80.0, 80.0);
    world.cities.last_mut().unwrap().name = "Dunmere".into();
    resident(&mut world, "n1", None, 84.0, 80.0);
    add_city(&mut world, "post", None, 200.0, 200.0);
    let post = world.cities.last_mut().unwrap();
    post.name = "Post".into();
    post.trade_org = Some(TradeOrgCity::Post);
    post.layout = None;
    let mut s = Setup { world, terrain: Arc::new(terrain), alliance: String::new() };
    s.order(&mara(), json!({ "kind": "foundAlliance", "name": "North" }));
    s.alliance = alliance_of(&s.world, "r1").expect("North").id.clone();
    s.order(&mara(), json!({ "kind": "inviteToAlliance", "realmId": "r2" }));
    let id = s.alliance.clone();
    s.order(&tobin(), json!({ "kind": "acceptInvite", "allianceId": id }));
    s
}

/// Dunmere holds both realms in high standing.
fn well_regarded() -> Setup {
    let mut s = setup();
    for r in ["r1", "r2"] {
        change_standing(&mut s.world, "npc", r, NPC_ALLIANCE_JOIN_STANDING);
    }
    s
}

/// A crime by Tobin's Leader against Dunmere at `tick`, known to Dunmere when `known`.
fn crime_against_city(world: &mut WorldState, tick: f64, known: bool) -> usize {
    let crime: Crime = serde_json::from_value(json!({
        "id": "x1", "kind": "theft", "tick": tick, "x": 80, "y": 80,
        "culprit": { "residentId": "b1", "name": "Tobin", "org": "r2", "orgName": "the realm of Tobin" },
        "victimOrg": "npc", "goods": { "food": 1 }, "witnesses": [],
        "knownBy": if known { json!(["npc"]) } else { json!([]) },
    }))
    .unwrap();
    world.crimes.push(crime);
    world.crimes.len() - 1
}

#[test]
fn joins_at_once_when_it_holds_every_member_in_high_standing() {
    let mut s = well_regarded();
    assert_eq!(s.invite_npc(), "ok");
    assert_eq!(s.members(), ["r1", "r2", "npc"]);
    assert!(s.world.alliances[0].invites.is_empty());
    for p in [1, 2] {
        let e = s.last_event(p);
        assert_eq!(e["kind"], "allianceJoined");
        assert_eq!(e["realmId"], "npc");
        assert_eq!(e["realm"], "Dunmere");
        assert_eq!(e["city"], true);
    }
    assert_eq!(check_all(&s.world, &s.terrain), []);
}

#[test]
fn declines_when_it_holds_one_member_short_of_high_standing() {
    let mut s = setup();
    change_standing(&mut s.world, "npc", "r1", NPC_ALLIANCE_JOIN_STANDING);
    change_standing(&mut s.world, "npc", "r2", NPC_ALLIANCE_JOIN_STANDING - 1.0);
    assert_eq!(s.invite_npc(), "ok");
    assert_eq!(s.members(), ["r1", "r2"]);
    assert!(s.world.alliances[0].invites.is_empty());
    let e = s.last_event(1);
    assert_eq!(e["kind"], "allianceDeclined");
    assert_eq!(e["realmId"], "npc");
    assert_eq!(e["realm"], "Dunmere");
    assert_eq!(s.last_event(2)["kind"], "allianceJoined");
}

#[test]
fn declines_while_it_knows_of_a_recent_crime_by_a_member_but_not_one_it_never_learnt_of() {
    let mut s = well_regarded();
    s.world.tick = (10.0 * TICKS_PER_GAME_DAY) as u64;
    let tick = s.world.tick as f64 - 1.0;
    let crime = crime_against_city(&mut s.world, tick, false);
    s.invite_npc();
    assert!(s.members().contains(&"npc".to_string()));
    s.order(&mara(), json!({ "kind": "removeFromAlliance", "realmId": "npc" }));
    s.world.tick += ALLIANCE_LEAVE_DELAY as u64;
    step_alliances(&mut s.world);
    assert_eq!(s.members(), ["r1", "r2"]);
    s.world.crimes[crime].known_by.push("npc".into());
    s.invite_npc();
    assert_eq!(s.members(), ["r1", "r2"]);
    assert_eq!(s.last_event(1)["kind"], "allianceDeclined");
    // Once the crime is older than CRIME_MEMORY_DAYS it is no longer recent.
    s.world.tick = (s.world.crimes[crime].tick + CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY) as u64;
    s.invite_npc();
    assert!(s.members().contains(&"npc".to_string()));
}

#[test]
fn leaves_on_its_own_when_its_standing_toward_a_member_falls_too_low() {
    let mut s = well_regarded();
    s.invite_npc();
    // Standing fading toward neutral is no reason to go.
    change_standing(&mut s.world, "npc", "r2", -NPC_ALLIANCE_JOIN_STANDING);
    s.pass(1.0);
    assert_eq!(s.npc_leaving(), None);
    change_standing(&mut s.world, "npc", "r2", NPC_ALLIANCE_LEAVE_STANDING - 1.0);
    s.pass(1.0);
    let at = s.world.tick as f64 + ALLIANCE_LEAVE_DELAY;
    assert_eq!(s.npc_leaving(), Some(Leaving { at, removed: false }));
    assert_eq!(check_all(&s.world, &s.terrain), []);
    s.pass(ALLIANCE_LEAVE_DELAY);
    assert_eq!(s.members(), ["r1", "r2"]);
    let e = s.last_event(1);
    assert_eq!(e["kind"], "allianceLeft");
    assert_eq!(e["realmId"], "npc");
    assert_eq!(e["realm"], "Dunmere");
    assert_eq!(e["why"], "left");
    assert_eq!(e["city"], true);
}

#[test]
fn leaves_at_once_when_it_joins_a_realm() {
    let mut s = well_regarded();
    s.invite_npc();
    s.world.cities.iter_mut().find(|c| c.id == "npc").unwrap().realm_id = Some("r1".into());
    s.pass(1.0);
    assert_eq!(s.members(), ["r1", "r2"]);
}

#[test]
fn never_leads_the_role_passes_to_a_realm_and_an_alliance_with_no_realm_left_ends() {
    let mut s = well_regarded();
    s.invite_npc();
    // Dunmere joined after Tobin; make it the longest-standing member.
    let alliance = &mut s.world.alliances[0];
    alliance.members.sort_by_key(|m| m.realm_id != "npc");
    for m in &mut alliance.members {
        m.joined_at = 0.0;
    }
    s.order(&mara(), json!({ "kind": "leaveAlliance" }));
    s.pass(ALLIANCE_LEAVE_DELAY);
    assert_eq!(s.world.alliances[0].leader_id, "r2");
    s.order(&tobin(), json!({ "kind": "leaveAlliance" }));
    s.pass(ALLIANCE_LEAVE_DELAY);
    assert!(s.world.alliances.is_empty());
}

#[test]
fn cant_be_the_trade_organization_nor_a_city_already_in_an_alliance() {
    let mut s = well_regarded();
    let post = s.order(&mara(), json!({ "kind": "inviteToAlliance", "realmId": "post" }));
    assert_eq!(post, "no such realm or NPC city");
    s.invite_npc();
    assert_eq!(s.invite_npc(), "they are already in an alliance");
    assert_eq!(s.members(), ["r1", "r2", "npc"]);
}

#[test]
fn shares_sight_members_see_through_its_residents() {
    let mut s = well_regarded();
    resident(&mut s.world, "stranger", None, 96.0, 96.0);
    s.world.residents.iter_mut().find(|r| r.id == "stranger").unwrap().city_id = None;
    let seen = |world: &WorldState| {
        let index = WorldIndex::new(world, SIZE);
        entities_in_sight(world, &index, Some("r1"), None).iter().any(|e| e.id() == "stranger")
    };
    assert!(!seen(&s.world));
    s.invite_npc();
    assert!(seen(&s.world));
}

#[test]
fn reports_a_trade_org_city_member_and_an_npc_city_leader() {
    let mut s = well_regarded();
    let tick = s.world.tick as f64;
    let alliance = &mut s.world.alliances[0];
    for id in ["post", "npc"] {
        let m = json!({ "realmId": id, "joinedAt": tick, "leaving": null });
        alliance.members.push(serde_json::from_value(m).unwrap());
    }
    alliance.leader_id = "npc".into();
    let id = s.alliance.clone();
    let messages: Vec<String> =
        alliances_sound(&s.world, &s.terrain).into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        [
            format!("alliance {id} has leader npc, which is no realm"),
            format!("alliance {id} has member post, which is no realm or NPC city"),
        ]
    );
}

//! `apps/server/src/alliances.test.ts`, on hand-made realms instead of starting cities (T86.8).
//! Left out: `checkInvariants`/`alliancesSound` (T86.13) and the `diplomacyFor` view (T87.6, with
//! the sync); a Leader's death goes through `leave_on_leader_death` and ends the realm by hand, as
//! `dieAll` (T86.3) does.

use csp_shared::balance::ALLIANCE_LEAVE_DELAY;
use csp_shared::world::{AllianceLeftWhy, RealmEventWhat, WorldState};
use serde_json::{json, Value};

use super::*;
use crate::queries::alliance::alliance_of;
use crate::queries::alliance_rules::{realms_standing_together, ALLIANCE_NAME_MAX_LENGTH};
use crate::realm_test_world::{plains, realm_id, send, world_with_realms};
use crate::tick::Scratch;
use crate::world::step_world;

const MARA: u64 = 1;
const TOBIN: u64 = 2;
const WREN: u64 = 3;
const ASH: u64 = 4;

fn realm(p: u64) -> String {
    realm_id(p)
}

/// A world where four Players have their realms.
fn setup() -> WorldState {
    world_with_realms(&plains(64), &[MARA, TOBIN, WREN, ASH])
}

/// Sends an order and applies it as the next tick would; "ok" or the reason.
fn order(world: &mut WorldState, from: u64, o: Value) -> String {
    let kind = o["kind"].as_str().expect("a kind").to_string();
    let orders = alliance_orders();
    let (_, k) = orders.iter().find(|(n, _)| *n == kind).expect("an alliance order");
    match send(world, &plains(64), k, from, o) {
        Ok(()) => "ok".into(),
        Err(e) => e,
    }
}

/// Mara founds "North"; Tobin, then Wren, are invited and join.
fn allied_world() -> (WorldState, String) {
    let mut world = setup();
    order(&mut world, MARA, json!({"kind": "foundAlliance", "name": "North"}));
    let id = alliance_of(&world, &realm(MARA)).expect("North").id.clone();
    for p in [TOBIN, WREN] {
        order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(p)}));
        world.tick += 1;
        order(&mut world, p, json!({"kind": "acceptInvite", "allianceId": id}));
    }
    (world, id)
}

fn members(world: &WorldState, id: &str) -> Vec<String> {
    world
        .alliances
        .iter()
        .find(|a| a.id == id)
        .map(|a| a.members.iter().map(|m| m.realm_id.clone()).collect())
        .unwrap_or_default()
}

/// Moves time on by `ticks`, running alliances each tick as the world does.
fn pass(world: &mut WorldState, ticks: f64) {
    for _ in 0..ticks as u64 {
        world.tick += 1;
        step_alliances(world);
    }
}

/// The Leader of Player `p` dies: their realm leaves its alliance and ends (`dieAll`).
fn leader_dies(world: &mut WorldState, p: u64) {
    leave_on_leader_death(world, &realm(p));
    world.realms.retain(|r| r.id != realm(p));
    world.residents.retain(|r| r.id != format!("leader{p}"));
}

#[test]
fn founds_an_alliance_with_the_founder_as_its_only_member_and_its_leader() {
    let mut world = setup();
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "foundAlliance", "name": "  North  "})),
        "ok"
    );
    let a = alliance_of(&world, &realm(MARA)).expect("North").clone();
    assert_eq!(
        (a.name.as_str(), a.leader_id.as_str(), a.invites.len()),
        ("North", realm(MARA).as_str(), 0)
    );
    assert_eq!(
        a.members,
        vec![AllianceMember { realm_id: realm(MARA), joined_at: world.tick as f64, leaving: None }]
    );
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "foundAlliance", "name": "South"})),
        "you are already in an alliance"
    );
    assert_eq!(
        order(&mut world, TOBIN, json!({"kind": "foundAlliance", "name": " "})),
        "the alliance needs a name"
    );
    let long = "x".repeat(ALLIANCE_NAME_MAX_LENGTH + 1);
    assert!(order(&mut world, TOBIN, json!({"kind": "foundAlliance", "name": long}))
        .contains("at most"));
    assert_eq!(world.alliances.len(), 1);
}

#[test]
fn lets_only_the_alliance_leader_invite_and_the_invited_realm_join() {
    let mut world = setup();
    order(&mut world, MARA, json!({"kind": "foundAlliance", "name": "North"}));
    let id = alliance_of(&world, &realm(MARA)).expect("North").id.clone();
    assert_eq!(
        order(&mut world, TOBIN, json!({"kind": "inviteToAlliance", "realmId": realm(WREN)})),
        "you are in no alliance"
    );
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": "realm999"})),
        "no such realm or NPC city"
    );
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(TOBIN)})),
        "ok"
    );
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(TOBIN)})),
        "already invited"
    );
    let last = world.events.last().expect("an event");
    assert!(matches!(last.what, RealmEventWhat::AllianceInvited { .. }) && last.user_id == TOBIN);
    assert_eq!(
        order(&mut world, WREN, json!({"kind": "acceptInvite", "allianceId": id})),
        "you hold no such invitation"
    );
    assert_eq!(order(&mut world, TOBIN, json!({"kind": "acceptInvite", "allianceId": id})), "ok");
    assert_eq!(members(&world, &id), vec![realm(MARA), realm(TOBIN)]);
    assert!(world.alliances[0].invites.is_empty());
    assert_eq!(
        order(&mut world, TOBIN, json!({"kind": "inviteToAlliance", "realmId": realm(WREN)})),
        "only the alliance leader can do that"
    );
    let mut joined: Vec<u64> = world
        .events
        .iter()
        .filter(|e| matches!(e.what, RealmEventWhat::AllianceJoined { .. }))
        .map(|e| e.user_id)
        .collect();
    joined.sort_unstable();
    assert_eq!(joined, vec![MARA, TOBIN]);
}

#[test]
fn keeps_a_realm_in_at_most_one_alliance() {
    let mut world = setup();
    order(&mut world, MARA, json!({"kind": "foundAlliance", "name": "North"}));
    order(&mut world, TOBIN, json!({"kind": "foundAlliance", "name": "South"}));
    let (north, south) = (world.alliances[0].id.clone(), world.alliances[1].id.clone());
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(TOBIN)})),
        "they are already in an alliance"
    );
    order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(WREN)}));
    order(&mut world, TOBIN, json!({"kind": "inviteToAlliance", "realmId": realm(WREN)}));
    // Two invitations: accepting one lets the other lapse.
    assert_eq!(world.alliances.iter().filter(|a| a.invites.contains(&realm(WREN))).count(), 2);
    assert_eq!(order(&mut world, WREN, json!({"kind": "acceptInvite", "allianceId": south})), "ok");
    assert_eq!(
        order(&mut world, WREN, json!({"kind": "acceptInvite", "allianceId": north})),
        "you hold no such invitation"
    );
    assert_eq!(members(&world, &north), vec![realm(MARA)]);
    assert_eq!(members(&world, &south), vec![realm(TOBIN), realm(WREN)]);
    // Founding an alliance lets invitations lapse too.
    order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(ASH)}));
    order(&mut world, ASH, json!({"kind": "foundAlliance", "name": "East"}));
    assert!(world.alliances.iter().find(|a| a.id == north).expect("North").invites.is_empty());
}

#[test]
fn lets_the_invited_realm_decline_and_the_alliance_leader_withdraw_an_invitation() {
    let mut world = setup();
    order(&mut world, MARA, json!({"kind": "foundAlliance", "name": "North"}));
    let id = world.alliances[0].id.clone();
    order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(TOBIN)}));
    order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(WREN)}));
    assert_eq!(order(&mut world, TOBIN, json!({"kind": "declineInvite", "allianceId": id})), "ok");
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "withdrawInvite", "realmId": realm(WREN)})),
        "ok"
    );
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "withdrawInvite", "realmId": realm(WREN)})),
        "that realm is not invited"
    );
    assert!(world.alliances[0].invites.is_empty());
    assert_eq!(
        order(&mut world, WREN, json!({"kind": "acceptInvite", "allianceId": id})),
        "you hold no such invitation"
    );
    assert_eq!(world.alliances[0].members.len(), 1);
}

#[test]
fn lets_a_member_leave_after_the_leave_delay_a_member_like_any_other_until_then() {
    let (mut world, id) = allied_world();
    assert_eq!(order(&mut world, WREN, json!({"kind": "leaveAlliance"})), "ok");
    assert_eq!(
        order(&mut world, WREN, json!({"kind": "leaveAlliance"})),
        "you are already leaving"
    );
    assert_eq!(
        order(&mut world, WREN, json!({"kind": "foundAlliance", "name": "South"})),
        "you are already in an alliance"
    );
    pass(&mut world, ALLIANCE_LEAVE_DELAY - 1.0);
    assert!(members(&world, &id).contains(&realm(WREN)));
    pass(&mut world, 1.0);
    assert_eq!(members(&world, &id), vec![realm(MARA), realm(TOBIN)]);
    assert!(matches!(
        world.events.last().expect("an event").what,
        RealmEventWhat::AllianceLeft { why: AllianceLeftWhy::Left, .. }
    ));
    assert_eq!(order(&mut world, WREN, json!({"kind": "foundAlliance", "name": "South"})), "ok");
}

#[test]
fn lets_only_the_alliance_leader_remove_a_member_after_the_leave_delay() {
    let (mut world, id) = allied_world();
    assert_eq!(
        order(&mut world, TOBIN, json!({"kind": "removeFromAlliance", "realmId": realm(WREN)})),
        "only the alliance leader can do that"
    );
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "removeFromAlliance", "realmId": realm(MARA)})),
        "to go yourself, leave the alliance"
    );
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "removeFromAlliance", "realmId": realm(ASH)})),
        "that realm is not a member"
    );
    assert_eq!(
        order(&mut world, MARA, json!({"kind": "removeFromAlliance", "realmId": realm(WREN)})),
        "ok"
    );
    assert_eq!(
        order(&mut world, WREN, json!({"kind": "leaveAlliance"})),
        "you are already leaving"
    );
    pass(&mut world, ALLIANCE_LEAVE_DELAY - 1.0);
    assert!(members(&world, &id).contains(&realm(WREN)));
    pass(&mut world, 1.0);
    assert_eq!(members(&world, &id), vec![realm(MARA), realm(TOBIN)]);
    let left: Vec<_> = world
        .events
        .iter()
        .filter(|e| matches!(e.what, RealmEventWhat::AllianceLeft { .. }))
        .collect();
    let mut users: Vec<u64> = left.iter().map(|e| e.user_id).collect();
    users.sort_unstable();
    assert_eq!(users, vec![MARA, TOBIN, WREN]);
    for e in left {
        let RealmEventWhat::AllianceLeft { realm_id, why, .. } = &e.what else { unreachable!() };
        assert_eq!((realm_id.as_str(), *why), (realm(WREN).as_str(), AllianceLeftWhy::Removed));
    }
}

#[test]
fn passes_the_role_to_the_longest_standing_member_when_the_alliance_leader_leaves() {
    let (mut world, id) = allied_world();
    order(&mut world, MARA, json!({"kind": "leaveAlliance"}));
    pass(&mut world, ALLIANCE_LEAVE_DELAY - 1.0);
    assert_eq!(world.alliances[0].leader_id, realm(MARA));
    pass(&mut world, 1.0);
    assert_eq!(world.alliances[0].leader_id, realm(TOBIN));
    assert_eq!(members(&world, &id), vec![realm(TOBIN), realm(WREN)]);
    let last = &world.events.last().expect("an event").what;
    assert!(
        matches!(last, RealmEventWhat::AllianceLeader { realm_id, .. } if *realm_id == realm(TOBIN))
    );
    assert_eq!(
        order(&mut world, TOBIN, json!({"kind": "inviteToAlliance", "realmId": realm(ASH)})),
        "ok"
    );
}

#[test]
fn ends_an_alliance_when_its_last_member_has_left() {
    let mut world = setup();
    order(&mut world, MARA, json!({"kind": "foundAlliance", "name": "North"}));
    order(&mut world, MARA, json!({"kind": "leaveAlliance"}));
    pass(&mut world, ALLIANCE_LEAVE_DELAY);
    assert!(world.alliances.is_empty());
}

#[test]
fn takes_a_realm_whose_leader_dies_out_at_once_the_role_passing_on() {
    let (mut world, id) = allied_world();
    order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(ASH)}));
    // Tobin was leaving; dying ends that at once too.
    order(&mut world, TOBIN, json!({"kind": "leaveAlliance"}));
    leader_dies(&mut world, MARA);
    leader_dies(&mut world, TOBIN);
    assert_eq!(members(&world, &id), vec![realm(WREN)]);
    assert_eq!(world.alliances[0].leader_id, realm(WREN));
    assert_eq!(world.alliances[0].invites, vec![realm(ASH)]);
    let left: Vec<_> = world
        .events
        .iter()
        .filter(|e| e.user_id == WREN)
        .filter_map(|e| match &e.what {
            RealmEventWhat::AllianceLeft { realm_id, why, .. } => Some((realm_id.clone(), *why)),
            _ => None,
        })
        .collect();
    assert_eq!(
        left,
        vec![
            (realm(MARA), AllianceLeftWhy::LeaderDied),
            (realm(TOBIN), AllianceLeftWhy::LeaderDied)
        ]
    );
}

#[test]
fn lets_the_invitations_of_a_realm_whose_leader_dies_lapse() {
    let mut world = setup();
    order(&mut world, MARA, json!({"kind": "foundAlliance", "name": "North"}));
    order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(TOBIN)}));
    leader_dies(&mut world, TOBIN);
    assert!(world.alliances[0].invites.is_empty());
}

#[test]
fn lets_leaves_take_effect_as_the_world_steps() {
    let (mut world, id) = allied_world();
    order(&mut world, WREN, json!({"kind": "leaveAlliance"}));
    let terrain = plains(64);
    let mut scratch = Scratch::default();
    for _ in 0..ALLIANCE_LEAVE_DELAY as u32 {
        step_world(&mut world, &terrain, &mut scratch, None, None);
    }
    assert_eq!(members(&world, &id), vec![realm(MARA), realm(TOBIN)]);
}

#[test]
fn groups_realms_standing_together() {
    let (mut world, _id) = allied_world();
    order(&mut world, MARA, json!({"kind": "inviteToAlliance", "realmId": realm(ASH)}));
    order(&mut world, TOBIN, json!({"kind": "leaveAlliance"}));
    assert_eq!(
        realms_standing_together(&world),
        vec![vec![realm(MARA), realm(TOBIN), realm(WREN)], vec![realm(ASH)]]
    );
    assert_eq!(crate::queries::alliance::realm_name(&world, &realm(MARA)), "Name of leader1");
}

#[test]
fn hands_soldiers_over_to_the_alliance_army_and_takes_them_back_on_a_recall() {
    use csp_shared::balance::ALLIANCE_RECALL_DELAY;
    use csp_shared::world::Good;
    let (mut world, id) = allied_world();
    let mut soldier = crate::realm_test_world::resident("s1", Some(&realm(TOBIN)), 3.0, 3.0);
    soldier.carried.insert(Good::Sword, 1.0);
    world.residents.push(soldier);
    world.residents.push(crate::realm_test_world::resident("u1", Some(&realm(TOBIN)), 3.0, 3.0));
    let hand = |ids: Value| json!({"kind": "handOverToAlliance", "residentIds": ids});
    assert_eq!(
        order(&mut world, TOBIN, hand(json!(["u1"]))),
        "Name of u1 is not a soldier: they carry no weapon"
    );
    assert_eq!(
        order(&mut world, TOBIN, hand(json!(["leader2"]))),
        "Name of leader2 is your Leader"
    );
    assert_eq!(
        order(&mut world, TOBIN, hand(json!(["s1", "s1"]))),
        "name each soldier and carriage once"
    );
    assert_eq!(order(&mut world, TOBIN, hand(json!(["s1"]))), "ok");
    let soldier = world.residents.iter().find(|r| r.id == "s1").expect("s1");
    assert_eq!(
        crate::queries::alliance::commander_of(&world, "s1", soldier.owner.as_deref()),
        Some(realm(MARA))
    );
    assert_eq!(
        order(&mut world, TOBIN, json!({"kind": "recallFromAlliance", "ids": ["s1"]})),
        "ok"
    );
    assert_eq!(
        order(&mut world, TOBIN, json!({"kind": "recallFromAlliance", "ids": ["s1"]})),
        "already recalled"
    );
    pass(&mut world, ALLIANCE_RECALL_DELAY);
    assert!(world.alliances.iter().find(|a| a.id == id).expect("North").army.is_empty());
}

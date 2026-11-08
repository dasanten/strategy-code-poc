//! `waypoints.test.ts`. The TypeScript sets up `worldWithPost` (a generated world with Player
//! 1's starting city); these need only Player 1's realm and a map. Its Leader-death case needs
//! `dieAll` (T86.3) and `foundStartingCity` (T86.8): T86.14 runs it.

use super::*;
use crate::orders::{order_kinds, OrderQueue, OrderReply};
use crate::queues::tests::resident;
use crate::world::create_world;
use csp_shared::terrain::Terrain;
use csp_shared::world::{Realm, RunningScript};
use serde_json::json;
use std::sync::Arc;

const SIZE: i32 = 64;

fn player() -> OrderSender {
    OrderSender::player(1, "Mara")
}

fn other() -> OrderSender {
    OrderSender::player(2, "Edda")
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
    queue: OrderQueue,
}

fn setup() -> Setup {
    let terrain =
        TerrainMap { size: SIZE, tiles: vec![Terrain::Plains as u8; (SIZE * SIZE) as usize] };
    let mut world = create_world(&terrain, 1);
    let realm: Realm =
        serde_json::from_value(json!({ "id": "r1", "userId": 1, "leaderId": "w1" })).unwrap();
    world.realms.push(realm);
    world.residents.push(resident("w1", Some("r1"), 6.0, 6.0));
    let terrain = Arc::new(terrain);
    Setup { world, queue: OrderQueue::new(order_kinds(), Some(terrain.clone())), terrain }
}

impl Setup {
    /// Sends an order and applies it as the next tick would: `ok`, or why it was turned down.
    fn send(&mut self, order: Value, sender: &OrderSender) -> String {
        let answer = self.queue.receive(&self.world, sender, &json!("q"), &order);
        self.queue.apply_all(&mut self.world);
        match answer {
            OrderReply::Rejected { reason, .. } => reason,
            OrderReply::Ack { .. } => "ok".into(),
        }
    }

    fn add(&mut self, x: f64, y: f64, name: &str, sender: &OrderSender) -> String {
        self.send(json!({ "kind": "addWaypoint", "x": x, "y": y, "name": name }), sender)
    }

    fn sound(&self) -> Vec<InvariantViolation> {
        waypoints_sound(&self.world, &self.terrain)
    }
}

#[test]
fn are_added_on_a_tile_with_their_name_trimmed_oldest_first_for_their_player_only() {
    let mut s = setup();
    assert_eq!(s.add(3.0, 4.0, "  Pass ", &player()), "ok");
    assert_eq!(s.add(10.0, 2.0, "Gold ore node", &player()), "ok");
    let held = waypoints_of(&s.world, 1);
    let shown: Vec<_> = held.iter().map(|w| (w.name.as_str(), w.x, w.y)).collect();
    assert_eq!(shown, [("Pass", 3.0, 4.0), ("Gold ore node", 10.0, 2.0)]);
    assert_ne!(held[0].id, held[1].id);
    assert!(waypoints_of(&s.world, 2).is_empty());
    assert!(s.sound().is_empty());
}

#[test]
fn turn_down_a_tile_off_the_map_and_a_bad_name() {
    let mut s = setup();
    assert_eq!(s.add(-1.0, 4.0, "Pass", &player()), "not a tile on the map");
    assert_eq!(s.add(f64::from(SIZE), 4.0, "Pass", &player()), "not a tile on the map");
    assert_eq!(s.add(1.5, 4.0, "Pass", &player()), "not a tile on the map");
    assert_eq!(s.add(3.0, 4.0, "   ", &player()), "Name: needs a name");
    let long = "x".repeat(WAYPOINT_NAME_MAX_LENGTH as usize + 1);
    assert_eq!(
        s.add(3.0, 4.0, &long, &player()),
        format!("Name: at most {} characters", WAYPOINT_NAME_MAX_LENGTH)
    );
    assert!(s.world.waypoints.is_empty());
}

#[test]
fn are_turned_down_past_the_cap_per_player_also_when_sent_in_the_same_tick() {
    let mut s = setup();
    let max = WAYPOINTS_MAX as usize;
    for i in 0..max - 1 {
        assert_eq!(s.add((i as i32 % SIZE).into(), 1.0, &format!("W{i}"), &player()), "ok");
    }
    // Two at once: both pass the check on arrival, only the first fits when applied.
    let a = json!({ "kind": "addWaypoint", "x": 1, "y": 1, "name": "Last" });
    let b = json!({ "kind": "addWaypoint", "x": 2, "y": 1, "name": "Too many" });
    s.queue.receive(&s.world, &player(), &json!("a"), &a);
    s.queue.receive(&s.world, &player(), &json!("b"), &b);
    s.queue.apply_all(&mut s.world);
    assert_eq!(waypoints_of(&s.world, 1).len(), max);
    assert_eq!(waypoints_of(&s.world, 1).last().unwrap().name, "Last");
    assert_eq!(
        s.add(5.0, 5.0, "More", &player()),
        format!("you hold {max} waypoints already, the most")
    );
    // Another Player's cap is their own.
    assert_eq!(s.add(5.0, 5.0, "Mine", &other()), "ok");
    assert!(s.sound().is_empty());
}

#[test]
fn are_renamed_and_removed_only_by_their_own_player() {
    let mut s = setup();
    s.add(3.0, 4.0, "Pass", &player());
    s.add(6.0, 6.0, "Ford", &player());
    let (pass, ford) = (waypoints_of(&s.world, 1)[0].clone(), waypoints_of(&s.world, 1)[1].clone());
    let rename =
        |id: &str, name: &str| json!({ "kind": "renameWaypoint", "waypointId": id, "name": name });
    let remove = |id: &str| json!({ "kind": "removeWaypoint", "waypointId": id });
    assert_eq!(s.send(rename(&pass.id, " High pass "), &player()), "ok");
    assert_eq!(waypoints_of(&s.world, 1)[0], Waypoint { name: "High pass".into(), ..pass.clone() });
    assert_eq!(s.send(rename(&pass.id, ""), &player()), "Name: needs a name");
    assert_eq!(s.send(rename(&pass.id, "Mine"), &other()), "not one of your waypoints");
    assert_eq!(s.send(remove(&pass.id), &other()), "not one of your waypoints");

    assert_eq!(s.send(remove(&pass.id), &player()), "ok");
    assert_eq!(waypoints_of(&s.world, 1), std::slice::from_ref(&ford));
    assert_eq!(s.send(remove(&pass.id), &player()), "not one of your waypoints");
    assert_eq!(s.send(remove(&ford.id), &player()), "ok");
    // A Player left with none has no entry.
    assert!(s.world.waypoints.is_empty());
}

#[test]
fn leave_a_residents_script_running_when_a_script_of_theirs_puts_one_down() {
    let mut s = setup();
    let script: RunningScript =
        serde_json::from_value(json!({ "scriptId": 1, "memory": {} })).unwrap();
    s.world.residents[0].script = Some(script);
    let order =
        json!({ "kind": "addWaypoint", "residentId": "w1", "x": 3, "y": 4, "name": "Pass" });
    assert_eq!(s.send(order, &player()), "ok");
    assert!(s.world.residents[0].script.is_some());
}

#[test]
fn finds_waypoints_past_the_cap_off_the_map_badly_named_or_sharing_an_id_broken() {
    let mut s = setup();
    let wp =
        |id: &str, name: &str, x: f64| Waypoint { id: id.into(), name: name.into(), x, y: 0.0 };
    s.world.waypoints.insert(1, vec![wp("wp1", "Pass", f64::from(SIZE)), wp("wp1", " Ford", 0.0)]);
    let many =
        (0..WAYPOINTS_MAX as usize + 1).map(|i| wp(&format!("wp{}", 100 + i), "W", 0.0)).collect();
    s.world.waypoints.insert(2, many);
    let messages: Vec<String> = s.sound().into_iter().map(|v| v.message).collect();
    assert_eq!(
        messages,
        [
            "Player 1's waypoint wp1: is off the map".to_string(),
            "Player 1's waypoint wp1: shares its id with another waypoint".to_string(),
            format!(
                "Player 2 holds {} waypoints, more than {}",
                WAYPOINTS_MAX as usize + 1,
                WAYPOINTS_MAX
            ),
        ]
    );
}

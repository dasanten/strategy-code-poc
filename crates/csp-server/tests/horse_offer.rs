//! `horse-offer.test.ts`, offering horses again (`CONTEXT.md`: Horse offer;
//! `reopenHorseOffers`). The rest of that file is in `csp-sim/src/horse_grant/offer_tests.rs`.

use std::sync::{Arc, OnceLock};

use csp_server::app::reopen_horse_offers;
use csp_shared::balance::HORSE_GRANT_HORSES;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;
use csp_sim::invariants::check_all;
use csp_sim::order_sender::OrderSender;
use csp_sim::orders::{order_kinds, OrderQueue, OrderReply};
use csp_sim::starting_city::{found_starting_city, realm_of};
use serde_json::json;

fn player() -> OrderSender {
    OrderSender::player(1, "Mara")
}

/// `worldWithPost`: a generated world on `cityTerrain` where Player 1 has founded their starting
/// city. Generated once and cloned for each test.
fn world_with_post() -> (WorldState, Arc<TerrainMap>) {
    static WORLD: OnceLock<(WorldState, Arc<TerrainMap>)> = OnceLock::new();
    let (world, terrain) = WORLD.get_or_init(|| {
        let terrain = csp_sim::terrain_gen::generate_terrain(1, 1536);
        let mut world = csp_sim::world::generate_world(&terrain, 1);
        found_starting_city(&mut world, &terrain, 1, None);
        (world, Arc::new(terrain))
    });
    (world.clone(), terrain.clone())
}

struct Setup {
    world: WorldState,
    terrain: Arc<TerrainMap>,
}

fn setup() -> Setup {
    let (world, terrain) = world_with_post();
    Setup { world, terrain }
}

impl Setup {
    fn queue(&self) -> OrderQueue {
        OrderQueue::new(order_kinds(), Some(self.terrain.clone()))
    }

    /// Claims Player 1's horses as the next tick would: `ok`, or why it was turned down.
    fn claim(&mut self) -> String {
        let mut queue = self.queue();
        let order = json!({ "kind": "claimHorses" });
        let answer = queue.receive(&self.world, &player(), &json!("q"), &order);
        queue.apply_all(&mut self.world);
        match answer {
            OrderReply::Rejected { reason, .. } => reason,
            OrderReply::Ack { .. } => "ok".into(),
        }
    }

    fn realm_horses(&self) -> usize {
        let realm = &self.world.realms[realm_of(&self.world, 1).unwrap()].id;
        self.world.horses.iter().filter(|h| h.realm_id.as_ref() == Some(realm)).count()
    }

    fn no_violations(&self) {
        let broken = check_all(&self.world, &self.terrain);
        assert!(!broken.iter().any(|v| v.invariant == "horse-offers-once"), "{broken:?}");
    }
}

const GRANT: usize = HORSE_GRANT_HORSES as usize;

#[test]
fn lets_a_player_who_claimed_claim_once_more_and_just_once_each_time() {
    let mut s = setup();
    let start = s.realm_horses();
    assert_eq!(s.claim(), "ok");
    assert_ne!(s.claim(), "ok");

    for round in [1, 2] {
        assert_eq!(reopen_horse_offers(&mut s.world, None), 1);
        assert!(s.world.horse_offers_claimed.is_empty());
        s.no_violations();
        assert_eq!(s.claim(), "ok");
        assert_ne!(s.claim(), "ok");
        assert_eq!(s.realm_horses(), start + GRANT * (round + 1));
        assert_eq!(s.world.horse_offers_claimed, [1]);
        s.no_violations();
    }
}

#[test]
fn places_only_one_claims_horses_for_two_claims_in_one_tick() {
    let mut s = setup();
    let mut queue = s.queue();
    assert_eq!(s.claim(), "ok");
    reopen_horse_offers(&mut s.world, None);
    let before = s.realm_horses();
    let order = json!({ "kind": "claimHorses" });
    queue.receive(&s.world, &player(), &json!("a"), &order);
    queue.receive(&s.world, &player(), &json!("b"), &order);
    queue.apply_all(&mut s.world);
    assert_eq!(s.realm_horses(), before + GRANT);
    assert_eq!(s.world.horse_offers_claimed, [1]);
}

#[test]
fn re_opens_for_one_player_or_for_all_who_claimed_and_counts_them() {
    let mut s = setup();
    s.world.horse_offers_claimed = vec![1, 2, 3];
    assert_eq!(reopen_horse_offers(&mut s.world, Some(2)), 1);
    assert_eq!(s.world.horse_offers_claimed, [1, 3]);
    assert_eq!(reopen_horse_offers(&mut s.world, None), 2);
    assert!(s.world.horse_offers_claimed.is_empty());
    assert_eq!(reopen_horse_offers(&mut s.world, None), 0);
}

#[test]
fn still_gives_a_player_who_hadnt_claimed_just_the_one_claim() {
    let mut s = setup();
    assert_eq!(reopen_horse_offers(&mut s.world, Some(1)), 0);
    assert_eq!(reopen_horse_offers(&mut s.world, None), 0);
    let before = s.realm_horses();
    assert_eq!(s.claim(), "ok");
    assert_ne!(s.claim(), "ok");
    assert_eq!(s.realm_horses(), before + GRANT);
}

//! NPC cities acting first: allies and mercenaries (T98.5, `CONTEXT.md`: Acting first).

use csp_shared::balance::{
    NPC_ACTING_FIRST, NPC_ALLIANCE_JOIN_STANDING, NPC_VILLAGE, TRADE_ORG_ARMY,
};
use csp_shared::terrain::TerrainMap;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Good, RealmEventWhat, WorldState};
use serde_json::json;

use super::*;
use crate::invariants::check_all;
use crate::npc_cities::found_npc_city;
use crate::random::Mulberry32;
use crate::realm_test_world::plains;
use crate::residents::{new_resident, NewResident};
use crate::standing::change_standing;
use crate::trade_org::found_trade_org_hq;
use crate::world::create_world;

struct Place {
    world: WorldState,
    terrain: TerrainMap,
    n1: String,
    n2: String,
}

/// The Trade Org HQ at (320, 320) with 20 of its residents armed; villages n1 at (40, 40) and n2
/// at (120, 40), who hold each other in high standing; realms r1 (Leader a1) and r2 (Leader a2).
fn place() -> Place {
    let terrain = plains(640);
    let mut world = create_world(&terrain, 1);
    let mut m = Mulberry32::new(7.0);
    let hq = found_trade_org_hq(&mut world, &terrain, 320, 320, &mut || m.next());
    let people: Vec<usize> = (0..world.residents.len())
        .filter(|&i| world.residents[i].city_id.as_deref() == Some(hq.as_str()))
        .take(20)
        .collect();
    for i in people {
        world.residents[i].carried.insert(Good::Spear, 1.0);
    }
    crate::equipment::settle_all(&mut world);
    let n1 = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 40, 40, &mut || m.next(), None);
    let n2 = found_npc_city(&mut world, &terrain, &NPC_VILLAGE, 120, 40, &mut || m.next(), None);
    for (realm, leader, x, user) in [("r1", "a1", 200.0, 7), ("r2", "a2", 240.0, 8)] {
        world.realms.push(
            serde_json::from_value(json!({ "id": realm, "userId": user, "leaderId": leader }))
                .unwrap(),
        );
        let mut m = Mulberry32::new(x);
        let fields =
            NewResident { id: leader, owner: Some(realm), city_id: None, x, y: 200.0, tick: 0.0 };
        let mut r = new_resident(&mut || m.next(), &fields, None);
        r.born_at = -20.0 * 24.0 * 3600.0;
        r.lifespan = 60.0;
        world.residents.push(r);
    }
    change_standing(&mut world, &n1, &n2, NPC_ALLIANCE_JOIN_STANDING);
    change_standing(&mut world, &n2, &n1, NPC_ALLIANCE_JOIN_STANDING);
    Place { world, terrain, n1, n2 }
}

impl Place {
    fn city_mut(&mut self, id: &str) -> &mut City {
        self.world.cities.iter_mut().find(|c| c.id == id).expect("the city")
    }

    /// `id` feels `threat` from r1.
    fn threatened(&mut self, id: &str, threat: f64) {
        self.city_mut(id).threats = Some([("r1".to_string(), threat)].into_iter().collect());
    }

    fn coins(&mut self, id: &str, coins: f64) {
        let home = npc_home(&self.world, id).expect("a storage").id.clone();
        let b = self.world.buildings.iter_mut().find(|b| b.id == home).unwrap();
        b.stock.get_or_insert_with(Default::default).insert(Good::Coins, coins);
    }

    fn coins_of(&self, id: &str) -> f64 {
        let city = self.world.cities.iter().find(|c| c.id == id).unwrap();
        coins_of(&self.world, city)
    }

    /// Steps the clock to `id`'s first planning pass of the next game day and acts there.
    fn next_day(&mut self, id: &str) {
        let day = (self.world.tick as f64 / TICKS_PER_GAME_DAY).floor();
        loop {
            self.world.tick += 1;
            if (self.world.tick as f64 / TICKS_PER_GAME_DAY).floor() > day
                && crate::npc_stance::first_pass_of_day(&self.world, id)
            {
                break;
            }
        }
        step_npc_acting_first(&mut self.world, self.terrain.size);
    }

    /// Whether the Player `user` heard of an invitation.
    fn invited(&self, user: u64) -> bool {
        self.world
            .events
            .iter()
            .any(|e| e.user_id == user && matches!(e.what, RealmEventWhat::AllianceInvited { .. }))
    }

    fn checked(&self) -> Vec<crate::sight::InvariantViolation> {
        check_all(&self.world, &self.terrain)
    }
}

#[test]
fn two_npc_cities_threatened_by_the_same_organization_in_high_standing_end_up_allied() {
    let mut p = place();
    let (n1, n2) = (p.n1.clone(), p.n2.clone());
    p.threatened(&n1, NPC_ACTING_FIRST.ally_threat);
    p.threatened(&n2, 1.0);
    p.next_day(&n1);
    assert_eq!(p.world.alliances.len(), 1);
    let a = &p.world.alliances[0];
    assert_eq!(a.leader_id, n1);
    let members: Vec<&str> = a.members.iter().map(|m| m.realm_id.as_str()).collect();
    assert_eq!(members, [n1.as_str(), n2.as_str()]);
    assert_eq!(p.checked(), []);
}

#[test]
fn invites_a_realm_it_holds_in_high_standing_but_never_the_threat() {
    let mut p = place();
    let n1 = p.n1.clone();
    p.threatened(&n1, NPC_ACTING_FIRST.ally_threat);
    change_standing(&mut p.world, &n1, "r2", NPC_ALLIANCE_JOIN_STANDING);
    change_standing(&mut p.world, &n1, "r1", NPC_ALLIANCE_JOIN_STANDING);
    p.next_day(&n1);
    assert!(p.invited(8));
    assert!(!p.invited(7));
    assert_eq!(p.world.alliances[0].invites, ["r2"]);
    assert_eq!(p.world.alliances[0].leader_id, n1);
    assert_eq!(p.checked(), []);
}

#[test]
fn seeks_no_allies_while_not_threatened_enough() {
    let mut p = place();
    let (n1, n2) = (p.n1.clone(), p.n2.clone());
    p.threatened(&n1, NPC_ACTING_FIRST.ally_threat - 1.0);
    p.threatened(&n2, 1.0);
    p.next_day(&n1);
    assert!(p.world.alliances.is_empty());
    // Nor with one that doesn't feel the same threat.
    p.threatened(&n1, NPC_ACTING_FIRST.ally_threat);
    p.city_mut(&n2).threats = None;
    p.next_day(&n1);
    assert!(p.world.alliances.is_empty());
}

#[test]
fn a_threatened_city_with_coins_hires_soldiers_and_pays_them() {
    let mut p = place();
    let n1 = p.n1.clone();
    p.threatened(&n1, NPC_ACTING_FIRST.hire_threat);
    p.coins(&n1, 1000.0);
    p.next_day(&n1);
    let c = p.world.contracts.iter().find(|c| c.hirer_id == n1).expect("an offer").clone();
    assert_eq!(c.lender_id, TRADE_ORG);
    assert_eq!(c.resident_ids.len(), NPC_ACTING_FIRST.hire_soldiers as usize);
    let price = NPC_ACTING_FIRST.hire_soldiers * TRADE_ORG_ARMY.price_per_soldier_week;
    assert_eq!(c.price_per_week, price);
    // The Trade Organization accepts it as any other; the city pays the week in advance.
    crate::trade_org_army::step_trade_org_army(&mut p.world, p.terrain.size);
    assert!(p.world.contracts.iter().any(|x| x.id == c.id && x.started_at.is_some()));
    step_npc_acting_first(&mut p.world, p.terrain.size);
    let c = p.world.contracts.iter().find(|x| x.id == c.id).unwrap();
    assert_eq!(c.paid_weeks, 1.0);
    assert_eq!(p.coins_of(&n1), 1000.0 - price);
    let paid_in = p.world.buildings.iter().find(|b| b.id == c.storage_id).unwrap();
    assert!(held_in(paid_in.stock.as_ref(), Good::Coins) >= price);
    // Its mercenaries walk to its town hall.
    let merc = p.world.residents.iter().find(|r| r.id == c.resident_ids[0]).unwrap();
    assert!(merc.order.is_some());
    assert!(hired_by(&p.world, &merc.id, &n1));
    // It hires no more while it has them.
    let contracts = p.world.contracts.len();
    p.next_day(&n1);
    assert_eq!(p.world.contracts.len(), contracts);
    assert_eq!(p.checked(), []);
}

#[test]
fn a_threatened_city_without_the_coins_hires_nobody() {
    let mut p = place();
    let n1 = p.n1.clone();
    p.threatened(&n1, NPC_ACTING_FIRST.hire_threat);
    p.coins(&n1, 0.0);
    p.next_day(&n1);
    assert!(p.world.contracts.is_empty());
    // Nor one with coins that isn't threatened enough.
    p.threatened(&n1, NPC_ACTING_FIRST.hire_threat - 1.0);
    p.coins(&n1, 1000.0);
    p.next_day(&n1);
    assert!(p.world.contracts.is_empty());
}

#[test]
fn its_mercenaries_take_food_for_the_way_and_eat_from_its_storage_at_its_town_hall() {
    // #1414: the Trade Org soldiers an NPC city hired walked out with no Food, and nothing fed them
    // at its town hall: they starved.
    let mut p = place();
    let n1 = p.n1.clone();
    p.threatened(&n1, NPC_ACTING_FIRST.hire_threat);
    p.coins(&n1, 1000.0);
    p.next_day(&n1);
    crate::trade_org_army::step_trade_org_army(&mut p.world, p.terrain.size);
    let c = p.world.contracts.iter().find(|c| c.hirer_id == n1).expect("a contract").clone();
    let id = c.resident_ids[0].clone();
    let i = p.world.residents.iter().position(|r| r.id == id).unwrap();
    p.world.residents[i].carried.shift_remove(&Good::Food);
    p.world.residents[i].order = None;
    step_npc_acting_first(&mut p.world, p.terrain.size);
    // Setting out, they go for the Food at a storage of the HQ, not straight to its hall.
    let city = p.world.cities.iter().find(|c| c.id == n1).unwrap().clone();
    let hall = town_hall_of(&p.world, &city).map(|h| (h.x, h.y)).unwrap();
    let r = &p.world.residents[i];
    let to_hall =
        matches!(&r.order, Some(ResidentOrder::WalkTo(o)) if (o.target.x, o.target.y) == hall);
    assert!(r.order.is_some() && !to_hall, "{:?}", r.order);
    // At its town hall, its storage feeds them.
    let r = &mut p.world.residents[i];
    (r.x, r.y, r.order) = (hall.0, hall.1, None);
    let size = p.terrain.size;
    let source = crate::survival::refill_source(&p.world, &p.world.residents[i], size);
    let storage = source.map(|s| s.holder);
    let theirs =
        p.world.buildings.iter().position(|b| {
            b.city_id.as_deref() == Some(n1.as_str()) && b.kind == BuildingKind::Storage
        });
    assert_eq!(storage, theirs.map(crate::survival::Holder::Building));
}

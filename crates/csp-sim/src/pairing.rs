//! Pairing, carrying and children (`CONTEXT.md`: Pairing, Carrying, Child), ported from
//! `apps/server/src/pairing.ts`: a pair requests a carry once its wait is over and a birth once the
//! carrying is done (ADR 0002); the world resolves them at the end of the tick. The pair order is
//! a plain `validate`/`apply` pair for the order queue (T86.2) to wire.

use std::collections::HashMap;

use csp_shared::balance::{CARRYING_TICKS, PAIRING_WAIT_TICKS};
use csp_shared::world::{Carrying, Pair, RealmEventWhat, Resident, ResidentOrder, WorldState};

use crate::pending::people::{base_stats, new_child, Place};
use crate::pending::{record_event, resident_names_taken, Sender};
use crate::queries::alliance::commands;
use crate::queries::city_area::{free_housing, has_food_surplus};
use crate::queries::people::CARRYING_A_CHILD;
use crate::queries::residents::can_work;
use crate::random::{hash_str, Mulberry32};

/// An action a pair requests (`BirthAction`): one of them starts carrying, or a child is born.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BirthAction {
    Carry { parent_ids: [String; 2] },
    Birth { parent_id: String },
}

/// Orders a carrying resident can't hold (`CARRYING_BLOCKS`): working, building, tearing down,
/// breeding horses, hauling and relocating.
pub fn carrying_blocks(o: &ResidentOrder) -> bool {
    matches!(
        o,
        ResidentOrder::WorkAt(_)
            | ResidentOrder::Breed(_)
            | ResidentOrder::Build(_)
            | ResidentOrder::RoadLine(_)
            | ResidentOrder::WallLine(_)
            | ResidentOrder::TearDown(_)
            | ResidentOrder::Haul(_)
            | ResidentOrder::Relocate(_)
    )
}

/// The input of a pairing order (`PairRequest`).
#[derive(Debug, Clone, Copy, Default)]
pub struct PairRequest<'a> {
    pub resident_id: Option<&'a str>,
    pub partner_id: Option<&'a str>,
}

/// `pair.validate` (`CONTEXT.md`: Pairing): two adult residents of the same city, both the
/// Player's, neither carrying a child.
pub fn validate_pair(world: &WorldState, sender: &Sender, o: &PairRequest) -> Option<&'static str> {
    let realm = world.realms.iter().find(|r| r.user_id == sender.user_id);
    let mine = |id: Option<&str>| {
        let x = world.residents.iter().find(|y| Some(y.id.as_str()) == id);
        realm.filter(|realm| commands(world, &realm.id, x)).and(x)
    };
    let (Some(r), Some(partner)) = (mine(o.resident_id), mine(o.partner_id)) else {
        return Some("not one of your residents");
    };
    if r.id == partner.id {
        return Some("a resident can’t pair with themselves");
    }
    let tick = world.tick as f64;
    if !can_work(r.born_at, tick) || !can_work(partner.born_at, tick) {
        return Some("children can’t pair");
    }
    if r.city_id.is_none() || r.city_id != partner.city_id {
        return Some("they must live in the same city");
    }
    if r.carrying.is_some() || partner.carrying.is_some() {
        return Some(CARRYING_A_CHILD);
    }
    None
}

fn paired_with(r: &Resident, partner: &Resident) -> bool {
    r.pair.as_ref().is_some_and(|p| p.partner_id == partner.id)
}

/// `pair.apply`: both get a pair naming the other; a pair ordered again keeps its time.
pub fn apply_pair(world: &mut WorldState, o: &PairRequest) {
    let find = |id: Option<&str>| world.residents.iter().position(|x| Some(x.id.as_str()) == id);
    let (Some(a), Some(b)) = (find(o.resident_id), find(o.partner_id)) else { return };
    let (r, partner) = (&world.residents[a], &world.residents[b]);
    if r.carrying.is_some() || partner.carrying.is_some() {
        return;
    }
    let since = if paired_with(r, partner) && paired_with(partner, r) {
        r.pair.as_ref().map_or(0.0, |p| p.since)
    } else {
        world.tick as f64
    };
    let (rid, pid) = (r.id.clone(), partner.id.clone());
    world.residents[a].pair = Some(Pair { partner_id: pid, since });
    world.residents[b].pair = Some(Pair { partner_id: rid, since });
}

/// Ends pairs that no longer hold, stops what carrying residents can't do, then requests a carry
/// for every pair whose wait is over with no child on the way, and a birth for every resident who
/// has carried long enough (`requestBirths`).
pub fn request_births(world: &mut WorldState) -> Vec<BirthAction> {
    let by_id: HashMap<String, usize> =
        world.residents.iter().enumerate().map(|(i, r)| (r.id.clone(), i)).collect();
    let broken: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            let Some(p) = &r.pair else { return false };
            match by_id.get(&p.partner_id).map(|&j| &world.residents[j]) {
                None => true,
                Some(partner) => {
                    !paired_with(partner, r) || r.city_id.is_none() || partner.city_id != r.city_id
                }
            }
        })
        .collect();
    for i in broken {
        world.residents[i].pair = None;
    }
    for r in &mut world.residents {
        if r.carrying.is_some() && r.order.as_ref().is_some_and(carrying_blocks) {
            r.order = None;
        }
    }
    let tick = world.tick as f64;
    let mut actions = Vec::new();
    for r in &world.residents {
        if let Some(c) = &r.carrying {
            if tick - c.since >= CARRYING_TICKS {
                actions.push(BirthAction::Birth { parent_id: r.id.clone() });
            }
            continue;
        }
        let Some(p) = &r.pair else { continue };
        let partner_carries =
            by_id.get(&p.partner_id).is_some_and(|&j| world.residents[j].carrying.is_some());
        if r.id > p.partner_id || partner_carries {
            continue;
        }
        if tick - p.since >= PAIRING_WAIT_TICKS {
            actions.push(BirthAction::Carry { parent_ids: [r.id.clone(), p.partner_id.clone()] });
        }
    }
    actions
}

/// Resolves birth actions one after another (`resolveBirths`). Returns the ids of the children
/// born.
pub fn resolve_births(world: &mut WorldState, actions: &[BirthAction]) -> Vec<String> {
    let mut born = Vec::new();
    for action in actions {
        match action {
            BirthAction::Carry { parent_ids } => start_carrying(world, parent_ids),
            BirthAction::Birth { parent_id } => {
                if let Some(child) = give_birth(world, parent_id) {
                    born.push(child);
                }
            }
        }
    }
    born
}

/// A pair still paired starts carrying when their city has free housing (counting the children
/// on the way) and a food surplus (`startCarrying`): one partner, at random, carries.
fn start_carrying(world: &mut WorldState, parent_ids: &[String; 2]) {
    let find = |id: &str| world.residents.iter().position(|r| r.id == id);
    let (Some(a), Some(b)) = (find(&parent_ids[0]), find(&parent_ids[1])) else { return };
    let (ra, rb) = (&world.residents[a], &world.residents[b]);
    if !paired_with(ra, rb)
        || !paired_with(rb, ra)
        || ra.carrying.is_some()
        || rb.carrying.is_some()
    {
        return;
    }
    let Some(city) = world.cities.iter().find(|c| ra.city_id.as_ref() == Some(&c.id)) else {
        return;
    };
    if rb.city_id.as_ref() != Some(&city.id) {
        return;
    }
    let on_the_way = world
        .residents
        .iter()
        .filter(|r| r.carrying.is_some() && r.city_id.as_ref() == Some(&city.id))
        .count() as f64;
    if free_housing(world, &city.id) - on_the_way <= 0.0 || !has_food_surplus(world, city) {
        return;
    }
    let mut rand = Mulberry32::new(f64::from(hash_str(&format!(
        "{}:{}:{}:{}",
        world.seed, world.tick, ra.id, rb.id
    ))));
    let (carrier, other) = if rand.next() < 0.5 { (a, b) } else { (b, a) };
    let o = &world.residents[other];
    let carrying = Carrying {
        since: world.tick as f64,
        partner_id: o.id.clone(),
        partner_name: o.name.clone(),
        partner_base: base_stats(o),
    };
    let c = &mut world.residents[carrier];
    c.carrying = Some(carrying);
    c.order = None;
    c.script = None;
}

/// A child is born when its time has come (`giveBirth`): on the carrying parent's tile, into their
/// city and realm, inheriting both parents' base stats; the realm log says so, and the pair ends.
fn give_birth(world: &mut WorldState, parent_id: &str) -> Option<String> {
    let pi = world.residents.iter().position(|r| r.id == parent_id)?;
    let parent = &world.residents[pi];
    let carrying = parent.carrying.clone()?;
    if (world.tick as f64) - carrying.since < CARRYING_TICKS {
        return None;
    }
    let id = format!("r{}", world.next_id);
    world.next_id += 1;
    let parent = &world.residents[pi];
    let mut taken = resident_names_taken(world, parent.owner.as_deref(), parent.city_id.as_deref());
    let mut rand = Mulberry32::new(f64::from(hash_str(&format!("{}:{id}", world.seed))));
    let place = Place {
        id: id.clone(),
        owner: parent.owner.as_deref(),
        city_id: parent.city_id.as_deref(),
        x: parent.x,
        y: parent.y,
        tick: world.tick as f64,
    };
    let child = new_child(
        &mut rand,
        [&base_stats(parent), &carrying.partner_base],
        place,
        Some(&mut taken),
    );
    let parent_name = parent.name.clone();
    let partner_id = parent.pair.as_ref().map(|p| p.partner_id.clone());
    world.residents.push(child.clone());
    world.residents[pi].carrying = None;
    if let Some(partner_id) = partner_id {
        if let Some(partner) = world.residents.iter_mut().find(|r| r.id == partner_id) {
            if partner.pair.as_ref().is_some_and(|p| p.partner_id == parent_id) {
                partner.pair = None;
            }
        }
    }
    world.residents[pi].pair = None;
    let what = RealmEventWhat::Born {
        resident_id: child.id.clone(),
        name: child.name.clone(),
        parents: [parent_name, carrying.partner_name],
    };
    record_event(world, child.owner.as_deref(), what);
    Some(child.id)
}

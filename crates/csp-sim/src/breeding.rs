//! Breeding horses (`CONTEXT.md`: Breeding, Horse market), ported from
//! `apps/server/src/breeding.ts`: a resident at a stable tends two horses, a tick at a time, until
//! a foal is born. The breed order is a plain `validate`/`apply` pair for the order queue (T86.2).

use csp_shared::balance::{
    FOAL_STAT_SPREAD, MAP_SIZE, MAX_HEALTH, MAX_HUNGER, STABLE_BREED_DAYS, STABLE_CAPACITY,
};
use csp_shared::footprint::is_at;
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    BreedOrder, Building, Horse, HorseStats, KeptBreeding, RealmEventWhat, ResidentOrder, Tile,
    WorldState,
};

use crate::events::record_event;
use crate::horses::horse_name;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::queries::breeding::{breed_problem, kept_breeding};
use crate::queries::horses::{horses_in, HorseOwner};
use crate::queries::js_round;
use crate::queries::names::placed;
use crate::queries::people::CARRYING_A_CHILD;
use crate::queries::residents::can_work;
use crate::random::{hash_str, Mulberry32};

/// Ticks of tending a foal takes (`STABLE_BREED_TICKS` of shared `horses.ts`).
pub const STABLE_BREED_TICKS: f64 = STABLE_BREED_DAYS * TICKS_PER_GAME_DAY;

/// An action a resident with a breed order requests (`BreedAction`): tend the two horses a tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BreedAction {
    pub resident_id: String,
}

/// The input of a breed order (`BreedRequest`).
#[derive(Debug, Clone, Default)]
pub struct BreedRequest {
    pub resident_id: Option<String>,
    pub stable_id: Option<String>,
    /// `None` for no list; the problem check says what is wrong with one.
    pub horse_ids: Option<Vec<String>>,
}

/// Whose horses the sender's residents breed (`ownerOf`): the Player's realm's, or the NPC city's.
fn owner_of<'w>(world: &'w WorldState, sender: &'w OrderSender) -> Option<HorseOwner<'w>> {
    if let Some(city) = &sender.npc_city_id {
        return Some(HorseOwner::City(city));
    }
    world.realms.iter().find(|r| r.user_id == sender.user_id).map(|r| HorseOwner::Realm(&r.id))
}

fn at(p: (f64, f64), b: &Building, size: i32) -> bool {
    is_at((p.0 as i32, p.1 as i32), placed(b), size)
}

/// `breed.validate` (`CONTEXT.md`: Breeding): one of the Player's adult residents, at a finished
/// stable, tends two fed horses of the Player's realm in it (`breedProblem`).
pub fn validate_breed(
    world: &WorldState,
    sender: &OrderSender,
    o: &BreedRequest,
) -> Option<&'static str> {
    let r = ordered_resident(world, sender, o.resident_id.as_deref());
    let owner = owner_of(world, sender);
    let (Some(r), Some(owner)) = (r, owner) else { return Some("not one of your residents") };
    let r = &world.residents[r];
    if !can_work(r.born_at, world.tick as f64) {
        return Some("children can’t breed horses");
    }
    if r.carrying.is_some() {
        return Some(CARRYING_A_CHILD);
    }
    let Some(stable) = world.buildings.iter().find(|b| Some(&b.id) == o.stable_id.as_ref()) else {
        return Some("not standing at that stable");
    };
    if !at((r.x, r.y), stable, MAP_SIZE) {
        return Some("not standing at that stable");
    }
    breed_problem(world, stable, owner, Some(&r.id), o.horse_ids.as_deref())
}

/// `breed.apply`: a pair the stable kept breeding progress for carries on where it stopped.
pub fn apply_breed(world: &mut WorldState, o: &BreedRequest) {
    let Some(ri) = world.residents.iter().position(|x| Some(&x.id) == o.resident_id.as_ref())
    else {
        return;
    };
    let (Some(stable_id), Some(ids)) = (o.stable_id.clone(), o.horse_ids.as_ref()) else { return };
    let ids = [ids.first().cloned().unwrap_or_default(), ids.get(1).cloned().unwrap_or_default()];
    let progress = world
        .buildings
        .iter()
        .find(|b| b.id == stable_id)
        .and_then(|s| kept_breeding(s, &ids))
        .map_or(0.0, |k| k.progress);
    let r = &mut world.residents[ri];
    r.order = Some(ResidentOrder::Breed(BreedOrder {
        stable_id,
        horse_ids: ids,
        at: Tile { x: r.x, y: r.y },
        progress,
    }));
}

/// Requests this tick's tending from residents' breed orders (`requestBreeding`).
pub fn request_breeding(world: &WorldState) -> Vec<BreedAction> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::Breed(_))))
        .map(|r| BreedAction { resident_id: r.id.clone() })
        .collect()
}

/// Whether a resident's breeding goes on (`breedingGoesOn`): they still stand where they started,
/// at the finished stable, and both horses are alive and in it.
pub fn breeding_goes_on(world: &WorldState, ri: usize, size: i32) -> bool {
    let r = &world.residents[ri];
    let Some(ResidentOrder::Breed(o)) = &r.order else { return false };
    if r.x != o.at.x || r.y != o.at.y {
        return false;
    }
    let Some(stable) = world.buildings.iter().find(|b| b.id == o.stable_id) else { return false };
    if stable.site.is_some() || !at((r.x, r.y), stable, size) {
        return false;
    }
    o.horse_ids.iter().all(|id| {
        world.horses.iter().find(|h| h.id == *id).is_some_and(|h| at((h.x, h.y), stable, size))
    })
}

/// Drops the breeding progress stables keep for pairs that broke up (`dropLostBreedings`).
pub fn drop_lost_breedings(world: &mut WorldState, size: i32) {
    let horses = &world.horses;
    for stable in &mut world.buildings {
        let Some(breedings) = stable.breedings.take() else { continue };
        let kept: Vec<KeptBreeding> = breedings
            .into_iter()
            .filter(|k| {
                let find = |id: &String| horses.iter().find(|h| h.id == *id);
                let (Some(a), Some(b)) = (find(&k.horse_ids[0]), find(&k.horse_ids[1])) else {
                    return false;
                };
                if !at((a.x, a.y), stable, size) || !at((b.x, b.y), stable, size) {
                    return false;
                }
                a.realm_id == b.realm_id && a.city_id == b.city_id
            })
            .collect();
        if !kept.is_empty() {
            stable.breedings = Some(kept);
        }
    }
}

/// Ends the breeding a horse is part of as it changes hands (`endBreedingOf`).
pub fn end_breeding_of(world: &mut WorldState, horse_id: &str) {
    for r in &mut world.residents {
        if matches!(&r.order, Some(ResidentOrder::Breed(o)) if o.horse_ids.iter().any(|h| h == horse_id))
        {
            r.order = None;
        }
    }
    for stable in &mut world.buildings {
        let Some(breedings) = stable.breedings.take() else { continue };
        let kept: Vec<KeptBreeding> =
            breedings.into_iter().filter(|k| !k.horse_ids.iter().any(|h| h == horse_id)).collect();
        if !kept.is_empty() {
            stable.breedings = Some(kept);
        }
    }
}

/// A foal's stats (`foalStats`): its parents' average in each, plus or minus up to
/// `FOAL_STAT_SPREAD`, whole and at least 1.
pub fn foal_stats(rand: &mut Mulberry32, a: &HorseStats, b: &HorseStats) -> HorseStats {
    let mut stat = |x: f64, y: f64| {
        let noise = (rand.next() * (2.0 * FOAL_STAT_SPREAD + 1.0)).floor() - FOAL_STAT_SPREAD;
        1f64.max(js_round((x + y) / 2.0) + noise)
    };
    let speed = stat(a.speed, b.speed);
    let strength = stat(a.strength, b.strength);
    let endurance = stat(a.endurance, b.endurance);
    HorseStats { speed, strength, endurance }
}

/// Resolves breeding (`resolveBreeding`): stables drop what broke up, then breeding that no longer
/// goes on stops, a stable with no room pauses, and otherwise the resident tends the horses a tick;
/// after `STABLE_BREED_TICKS` a foal is born in the stable. Returns the foals' ids.
pub fn resolve_breeding(world: &mut WorldState, actions: &[BreedAction], size: i32) -> Vec<String> {
    drop_lost_breedings(world, size);
    let mut foals = Vec::new();
    for a in actions {
        let Some(ri) = world.residents.iter().position(|x| x.id == a.resident_id) else { continue };
        let Some(ResidentOrder::Breed(o)) = &world.residents[ri].order else { continue };
        let o = o.clone();
        if !breeding_goes_on(world, ri, size) {
            world.residents[ri].order = None;
            continue;
        }
        let si =
            world.buildings.iter().position(|b| b.id == o.stable_id).expect("breeding goes on");
        let kept = kept_breeding(&world.buildings[si], &o.horse_ids).map(|k| k.progress);
        set_progress(world, ri, kept.unwrap_or(0.0));
        if horses_in(&world.horses, &world.buildings[si]).len() as f64 >= STABLE_CAPACITY {
            continue;
        }
        let stable = &mut world.buildings[si];
        let breedings = stable.breedings.get_or_insert_with(Vec::new);
        let k = match breedings.iter().position(|k| {
            o.horse_ids.contains(&k.horse_ids[0]) && o.horse_ids.contains(&k.horse_ids[1])
        }) {
            Some(k) => k,
            None => {
                breedings.push(KeptBreeding { horse_ids: o.horse_ids.clone(), progress: 0.0 });
                breedings.len() - 1
            }
        };
        breedings[k].progress += 1.0;
        let progress = breedings[k].progress;
        set_progress(world, ri, progress);
        if progress < STABLE_BREED_TICKS {
            continue;
        }
        world.residents[ri].order = None;
        let stable = &mut world.buildings[si];
        if let Some(b) = &mut stable.breedings {
            b.remove(k);
            if b.is_empty() {
                stable.breedings = None;
            }
        }
        let find = |id: &String| {
            world.horses.iter().find(|h| h.id == *id).expect("breeding goes on").clone()
        };
        let (mother, father) = (find(&o.horse_ids[0]), find(&o.horse_ids[1]));
        let foal = new_foal(world, si, &mother, &father);
        let what = RealmEventWhat::Foaled {
            horse_id: foal.id.clone(),
            stable_id: o.stable_id.clone(),
            name: Some(foal.name.clone()),
        };
        let realm = foal.realm_id.clone();
        foals.push(foal.id.clone());
        world.horses.push(foal);
        record_event(world, realm.as_deref(), what);
    }
    foals
}

fn set_progress(world: &mut WorldState, ri: usize, progress: f64) {
    if let Some(ResidentOrder::Breed(o)) = &mut world.residents[ri].order {
        o.progress = progress;
    }
}

/// A foal of the two horses, born now in the stable, fed and healthy (`newFoal`).
fn new_foal(world: &mut WorldState, si: usize, a: &Horse, b: &Horse) -> Horse {
    let id = format!("horse{}", world.next_id);
    world.next_id += 1;
    let mut rand = Mulberry32::new(f64::from(hash_str(&format!("{}:foal:{id}", world.seed))));
    let stats = foal_stats(&mut rand, &a.stats, &b.stats);
    let stable = &world.buildings[si];
    Horse {
        name: horse_name(&mut || rand.next()),
        id,
        realm_id: a.realm_id.clone(),
        city_id: a.city_id.clone(),
        x: stable.x,
        y: stable.y,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats,
        born_at: world.tick as f64,
        down_until: None,
    }
}

#[cfg(test)]
mod tests;

//! Driving (`apps/server/src/driving.ts`, `CONTEXT.md`: Carriage, Hitched horse, Supply line,
//! Stealing a carriage or horse): the drive, unhitch and hitch orders.

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{Army, DriveOrder, OrderRequest, ResidentOrder, Tile, WorldState};

use crate::order_sender::{commands, ordered_resident, realm_of, OrderSender};
use crate::orders::{int_field, str_field, OrderKind};
use crate::queries::alliance::commander_of;
use crate::queries::carriages::driver_of;
use crate::queries::command::{commands_carriage, steals_carriage};
use crate::queries::driving::{
    carriage_can_go_to, drive_off_problem, drive_problem, hitch_off_problem, hitch_problem,
    horse_to_steal, unhitch_problem,
};
use crate::stealing::{take_over, Taken};

/// The realm's army a carriage goes after, or why it can't (`armyToSupply`).
pub fn army_to_supply<'w>(
    world: &'w WorldState,
    realm_id: &str,
    army_id: Option<&str>,
) -> Result<&'w Army, &'static str> {
    world
        .armies
        .iter()
        .find(|a| Some(a.id.as_str()) == army_id && a.realm_id == realm_id)
        .ok_or("not one of your armies")
}

/// Where an army stands to start with: its first member's tile (`armyStart`).
pub fn army_start(world: &WorldState, army: &Army) -> Tile {
    let first = army.member_ids.first().and_then(|id| world.residents.iter().find(|r| r.id == *id));
    Tile { x: first.map_or(0.0, |r| r.x), y: first.map_or(0.0, |r| r.y) }
}

/// The drive order (`drive`): one of the Player's adult residents drives one of the Player's
/// carriages to a tile, or after an army of theirs as its supply wagon. Naming another
/// organization's carriage steals it, with a free horse of another organization on the tile when
/// it has none; for the realm's own carriage, only a horse the order names (`horseId`).
pub struct Drive;

impl OrderKind for Drive {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let realm = realm_of(world, sender.user_id);
        let r =
            world.residents.iter().find(|x| Some(x.id.as_str()) == str_field(order, "residentId"));
        let (Some(realm), Some(r)) = (realm, r) else {
            return Some("not one of your residents".into());
        };
        if !commands(world, &realm.id, Some(r)) {
            return Some("not one of your residents".into());
        }
        let Some(carriage) =
            world.carriages.iter().find(|k| Some(k.id.as_str()) == str_field(order, "carriageId"))
        else {
            return Some("not one of your carriages".into());
        };
        let steals = steals_carriage(world, &realm.id, carriage);
        if !steals && !commands_carriage(world, &realm.id, Some(carriage)) {
            return Some("not one of your carriages".into());
        }
        if order.fields.contains_key("armyId") {
            if let Err(e) = army_to_supply(world, &realm.id, str_field(order, "armyId")) {
                return Some(e.into());
            }
        } else {
            let (Some(x), Some(y)) = (int_field(order, "x"), int_field(order, "y")) else {
                return Some("the target must be a tile".into());
            };
            if terrain.is_some_and(|t| !carriage_can_go_to(world, t, x as i32, y as i32)) {
                return Some("a carriage can’t go there".into());
            }
        }
        if steals {
            let size = terrain.map_or(MAP_SIZE, |t| t.size);
            return drive_off_problem(world, r, carriage, &realm.id, size);
        }
        if let Some(named) = str_field(order, "horseId") {
            if carriage.realm_id.as_deref() == Some(realm.id.as_str()) {
                return hitch_off_problem(world, r, carriage, &realm.id, Some(named));
            }
        }
        drive_problem(world, r, carriage)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Some(i) = world
            .residents
            .iter()
            .position(|x| Some(x.id.as_str()) == str_field(order, "residentId"))
        else {
            return;
        };
        let Some(k) = world
            .carriages
            .iter()
            .position(|x| Some(x.id.as_str()) == str_field(order, "carriageId"))
        else {
            return;
        };
        let army_given = order.fields.contains_key("armyId");
        let army = army_given
            .then(|| {
                world
                    .armies
                    .iter()
                    .find(|a| Some(a.id.as_str()) == str_field(order, "armyId"))
                    .cloned()
            })
            .flatten();
        if army_given && army.is_none() {
            return;
        }
        let size = terrain.map_or(MAP_SIZE, |t| t.size);
        let r = &world.residents[i];
        let realm_id = commander_of(world, &r.id, r.owner.as_deref());
        let carriage = &world.carriages[k];
        match realm_id.as_deref() {
            Some(realm) if steals_carriage(world, realm, carriage) => {
                // Taken or driven by someone else since the order came: it goes no further.
                if drive_off_problem(world, r, carriage, realm, size).is_some() {
                    return;
                }
                let hitched = carriage
                    .horse_id
                    .as_deref()
                    .and_then(|id| world.horses.iter().position(|h| h.id == id));
                let stolen = horse_to_steal(world, r, carriage, realm, None).map(|h| {
                    world.horses.iter().position(|x| x.id == h.id).expect("a horse of the world")
                });
                let horse = hitched.or(stolen);
                // A taking from each owner is one theft, so a stranger's horse is one of its own.
                let together = horse.is_some_and(|h| {
                    world.horses[h].realm_id == carriage.realm_id
                        && world.horses[h].city_id == carriage.city_id
                });
                let thief = r.id.clone();
                let realm = realm.to_string();
                let taken = Taken { carriage: Some(k), horse: if together { horse } else { None } };
                take_over(world, &thief, &realm, taken, size);
                if let Some(h) = stolen {
                    if !together {
                        take_over(
                            world,
                            &thief,
                            &realm,
                            Taken { carriage: None, horse: Some(h) },
                            size,
                        );
                    }
                    world.carriages[k].horse_id = Some(world.horses[h].id.clone());
                }
            }
            Some(realm)
                if str_field(order, "horseId").is_some()
                    && carriage.realm_id.as_deref() == Some(realm) =>
            {
                let named = str_field(order, "horseId");
                if hitch_off_problem(world, r, carriage, realm, named).is_some() {
                    return;
                }
                let stolen = horse_to_steal(world, r, carriage, realm, named).map(|h| {
                    world.horses.iter().position(|x| x.id == h.id).expect("a horse of the world")
                });
                if let Some(h) = stolen {
                    let (thief, realm) = (r.id.clone(), realm.to_string());
                    take_over(
                        world,
                        &thief,
                        &realm,
                        Taken { carriage: None, horse: Some(h) },
                        size,
                    );
                    world.carriages[k].horse_id = Some(world.horses[h].id.clone());
                }
            }
            // Two drivers ordered onto one carriage in the same tick: the first one drives it.
            _ => {
                if drive_problem(world, r, carriage).is_some() {
                    return;
                }
            }
        }
        let carriage_id = world.carriages[k].id.clone();
        let order = match army {
            None => DriveOrder {
                carriage_id,
                target: Tile {
                    x: int_field(order, "x").unwrap_or(0.0),
                    y: int_field(order, "y").unwrap_or(0.0),
                },
                path: None,
                progress: 0.0,
                army: None,
                near: None,
            },
            Some(army) => DriveOrder {
                carriage_id,
                target: army_start(world, &army),
                path: None,
                progress: 0.0,
                army: Some(army.id.clone()),
                near: None,
            },
        };
        world.residents[i].order = Some(ResidentOrder::Drive(order));
    }
}

/// The unhitch order (`unhitch`): a grown resident of the carriage's realm on its tile unhitches
/// its horse, which stands free on the tile. A carriage being driven stops first.
pub struct Unhitch;

impl OrderKind for Unhitch {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(r) = ordered_resident(world, sender, str_field(order, "residentId"))
            .map(|i| &world.residents[i])
        else {
            return Some("not one of your residents".into());
        };
        let carriage =
            world.carriages.iter().find(|k| Some(k.id.as_str()) == str_field(order, "carriageId"));
        unhitch_problem(r, carriage, world.tick as f64)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let r =
            world.residents.iter().find(|x| Some(x.id.as_str()) == str_field(order, "residentId"));
        let Some(k) = world
            .carriages
            .iter()
            .position(|x| Some(x.id.as_str()) == str_field(order, "carriageId"))
        else {
            return;
        };
        let Some(r) = r else { return };
        if unhitch_problem(r, Some(&world.carriages[k]), world.tick as f64).is_some() {
            return;
        }
        let driver = driver_of(world, &world.carriages[k].id).map(|d| d.id.clone());
        if let Some(d) = driver {
            if let Some(d) = world.residents.iter_mut().find(|x| x.id == d) {
                d.order = None;
            }
        }
        world.carriages[k].horse_id = None;
    }
}

/// The hitch order (`hitch`): a grown resident of the carriage's realm on its tile hitches the
/// horse they name, at once. Only the realm's own horses.
pub struct Hitch;

impl OrderKind for Hitch {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        let Some(r) = ordered_resident(world, sender, str_field(order, "residentId"))
            .map(|i| &world.residents[i])
        else {
            return Some("not one of your residents".into());
        };
        let carriage =
            world.carriages.iter().find(|k| Some(k.id.as_str()) == str_field(order, "carriageId"));
        hitch_problem(world, r, carriage, str_field(order, "horseId"))
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) {
        let r =
            world.residents.iter().find(|x| Some(x.id.as_str()) == str_field(order, "residentId"));
        let Some(k) = world
            .carriages
            .iter()
            .position(|x| Some(x.id.as_str()) == str_field(order, "carriageId"))
        else {
            return;
        };
        let horse_id = str_field(order, "horseId");
        // Two hitching one horse in the same tick: the first one gets it.
        let Some(r) = r else { return };
        if hitch_problem(world, r, Some(&world.carriages[k]), horse_id).is_some() {
            return;
        }
        world.carriages[k].horse_id = horse_id.map(str::to_string);
    }
}

#[cfg(test)]
mod mountain_tests;
#[cfg(test)]
mod tests;

//! NPC cities defending themselves (`CONTEXT.md`: NPC city, Combat, Trading post, Alarm): a
//! trading post and the HQ send their armed residents in their area after attackers there; any NPC
//! city keeps soldiers by its size and closes its gates while armed outsiders are near. Only
//! orders a Player could give (ADR 0002), or opening and closing its own gates as a realm does.

// Epic 127: this file still has `_ =>` arms over enums; its tickets name each variant or say
// why the wildcard is right, then remove this line.
#![allow(clippy::wildcard_enum_match_arm)]

use std::collections::HashSet;

use csp_shared::balance::{
    MAP_SIZE, NPC_ARCHER_ARROWS, NPC_GATE_WATCH_RANGE, NPC_SOLDIERS_ON_HALL, NPC_STEEL_KIT,
    PROTECTION_DEFENCE, TRADE_ORG_ARMY,
};
use csp_shared::footprint::is_at;
use csp_shared::goods::{PROTECTION_KINDS, WEAPONS};
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    Building, BuildingKind, City, DropOrder, Good, GoodsSpot, PickUpOrder, Resident, ResidentOrder,
    Stock, Task, TradeOrgCity, WorldState,
};

use crate::combat::attack_order;
use crate::crimes::{city_organization, known_thieves};
use crate::npc_behaviour::{stop_work, walk_to};
use crate::npc_founding::founding_party;
use crate::npc_growth::no_storage_yet;
use crate::npc_posts::free_soldiers;
use crate::queries::alliance::{allied, contract_of};
use crate::queries::building::{building_pile, recipe_for, recipe_input, work_problem};
use crate::queries::city::{for_sale, in_city_area, npc_city_refuses};
use crate::queries::city_area::{defends_city, occupiers_of};
use crate::queries::names::{good_name, good_of, held, held_in, placed};
use crate::queries::npc_trade::{
    is_npc_archer, npc_archer_target, npc_city_soldier_target, npc_makes_steel, npc_smithy,
    npc_soldier_kit, npc_soldier_target,
};
use crate::queries::residents::best_weapon;
use crate::queries::residents::{can_work, carry_capacity, is_armed, stock_weight};
use crate::queries::standing::TRADE_ORG;
use crate::queries::walls::wall_side;
use crate::queries::warehouse::{stock_floor, warehouse_keeps};
use crate::running::RunningOrder;
use crate::sight::InvariantViolation;
use crate::work::start_work;

/// A resident's tile.
fn tile(world: &WorldState, i: usize) -> (i32, i32) {
    (world.residents[i].x as i32, world.residents[i].y as i32)
}

/// Everyone the Trade Organization runs away from their city (`caravanCrew`, `punishers`).
fn away_on_trade_org_business(world: &WorldState) -> HashSet<String> {
    let mut away = crate::caravans::caravan_crew(world);
    away.extend(crate::queries::trade_org::punishers(world));
    away
}

/// Raises the alarm in a city whose town hall is occupied (`raiseOccupied` of `alarms.ts`).
fn raise_occupied(world: &mut WorldState, city: &City, occupier: &str, size: i32) {
    crate::alarms::raise_occupied(world, &city.id, occupier, size);
}

use crate::queries::trade_org::trade_org_army_wanted;

/// One tick of NPC cities defending themselves (`stepNpcDefence`). Run before `step_npc_cities`, so
/// the work it hands out passes its soldiers by. `size` is the map's.
pub fn step_npc_defence(world: &mut WorldState, size: i32) {
    let away = away_on_trade_org_business(world);
    let ids: Vec<String> =
        world.cities.iter().filter(|c| c.realm_id.is_none()).map(|c| c.id.clone()).collect();
    for id in ids {
        let Some(city) = world.cities.iter().find(|c| c.id == id).cloned() else { continue };
        let people: Vec<usize> = (0..world.residents.len())
            .filter(|&i| {
                let r = &world.residents[i];
                r.owner.is_none()
                    && r.city_id.as_deref() == Some(id.as_str())
                    && r.health > 0.0
                    && !away.contains(&r.id)
                    && contract_of(world, &r.id).is_none()
            })
            .collect();
        if city.trade_org.is_some() {
            fight_attackers(world, &city, &people, size);
        } else if let Some(occupation) = &city.occupation {
            raise_occupied(world, &city, &occupation.realm_id, size);
        }
        let tick = world.tick as f64;
        let adults =
            people.iter().filter(|&&i| can_work(world.residents[i].born_at, tick)).count() as f64;
        if city.trade_org == Some(TradeOrgCity::Hq) {
            // Its army's weapons come from its goods warehouse, which keeps them in stock.
            let goods = world.buildings.iter().position(|b| {
                b.city_id.as_deref() == Some(id.as_str())
                    && warehouse_keeps(world, b).iter().any(|g| WEAPONS.contains(&good_name(*g)))
            });
            let target = trade_org_army_target(adults, trade_org_army_wanted(world));
            keep_soldiers(world, &city, &people, target, goods);
            let tools = world.buildings.iter().position(|b| {
                b.city_id.as_deref() == Some(id.as_str())
                    && warehouse_keeps(world, b).contains(&Good::Tools)
            });
            keep_tools(world, &city, &people, tools);
        }
        if city.trade_org == Some(TradeOrgCity::Post) {
            // A trading post arms from its warehouse, as far as it holds weapons.
            let warehouse = world.buildings.iter().position(|b| {
                b.city_id.as_deref() == Some(id.as_str()) && b.kind == BuildingKind::Warehouse
            });
            keep_soldiers(world, &city, &people, npc_soldier_target(adults), warehouse);
            keep_tools(world, &city, &people, warehouse);
        }
        if city.trade_org.is_some() {
            continue;
        }
        let storage = world.buildings.iter().position(|b| {
            b.city_id.as_deref() == Some(id.as_str())
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        });
        keep_soldiers(world, &city, &people, npc_city_soldier_target(&city, adults), storage);
        keep_tools(world, &city, &people, storage);
        watch_gates(world, &city, size);
    }
}

/// An NPC city's workers and builders carry a set of Tools each (`CONTEXT.md`: Tools, NPC
/// reserve): while `store` holds a set, one grown, unarmed resident at a time who carries none,
/// idle or at work, fetches one from it, as soldiers fetch their weapons (`fetch`); a set that
/// breaks is replaced the same way. Not its traders nor a founding party's members, who are on
/// their way. Trading posts and the HQ fetch from their warehouse, only what it holds above its
/// floor (`stock_floor`), so their market of Tools stays (decided overnight, Daniel to confirm).
/// Only orders a Player could give (ADR 0002).
fn keep_tools(world: &mut WorldState, city: &City, people: &[usize], store: Option<usize>) {
    let Some(st) = store else { return };
    let b = &world.buildings[st];
    let floor =
        if city.trade_org.is_some() { held(&stock_floor(world, b), Good::Tools) } else { 0.0 };
    if b.site.is_some() || held_in(b.stock.as_ref(), Good::Tools) - floor < 1.0 {
        return;
    }
    let tick = world.tick as f64;
    let plan = world.city_plans.get(&city.id);
    let mut away: HashSet<String> = founding_party(plan).into_iter().collect();
    away.extend(
        plan.and_then(|p| p.traders.as_ref()).into_iter().flatten().map(|t| t.resident_id.clone()),
    );
    let lacking: Vec<usize> = people
        .iter()
        .copied()
        .filter(|&i| {
            let r = &world.residents[i];
            can_work(r.born_at, tick)
                && !is_armed(r)
                && held(&r.carried, Good::Tools) < 1.0
                && !away.contains(&r.id)
        })
        .collect();
    if !lacking.is_empty() {
        fetch(world, st, &lacking, &Stock::from([(Good::Tools, 1.0)]));
    }
}

/// How many soldiers the Trade Org HQ keeps (`tradeOrgArmyTarget`): as many as it `wants`, but
/// never so many that fewer than `TRADE_ORG_ARMY.workers` of its `adults` are left to work.
pub fn trade_org_army_target(adults: f64, wanted: f64) -> f64 {
    0f64.max(wanted.min(adults - TRADE_ORG_ARMY.workers))
}

/// Attackers in a city's area (`attackersOf`), by their place in `world.residents`.
pub fn attackers_of(world: &WorldState, city: &City, size: i32) -> Vec<usize> {
    let occupiers = occupiers_of(world, city, size);
    let own = |id: &str| {
        world
            .residents
            .iter()
            .find(|x| x.id == id)
            .is_some_and(|t| t.owner.is_none() && t.city_id.as_ref() == Some(&city.id))
    };
    let own_wall = |id: &str| {
        world.buildings.iter().any(|b| {
            b.id == id
                && b.city_id.as_ref() == Some(&city.id)
                && matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate | BuildingKind::Tower)
        })
    };
    (0..world.residents.len())
        .filter(|&i| {
            if occupiers.contains(&i) {
                return true;
            }
            let r = &world.residents[i];
            if r.health <= 0.0 || (r.owner.is_none() && r.city_id.as_ref() == Some(&city.id)) {
                return false;
            }
            let attacking = r
                .order
                .as_ref()
                .and_then(|o| o.ties().strikes)
                .is_some_and(|id| own(id) || own_wall(id));
            attacking && in_city_area(world, &city.id, r.x as i32, r.y as i32, size)
        })
        .collect()
}

/// The thieves a trading post goes after (`thievesOf`).
pub fn thieves_of(world: &WorldState, city: &City, size: i32) -> Vec<usize> {
    let thieves = known_thieves(world, city_organization(city));
    (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            thieves.contains(&r.id)
                && r.health > 0.0
                && in_city_area(world, &city.id, r.x as i32, r.y as i32, size)
        })
        .collect()
}

/// A trading post's or the HQ's soldiers fight attackers in its area on their own
/// (`fightAttackers`).
fn fight_attackers(world: &mut WorldState, city: &City, people: &[usize], size: i32) {
    let mut attackers = attackers_of(world, city, size);
    if city.trade_org == Some(TradeOrgCity::Post) {
        attackers.extend(thieves_of(world, city, size));
    }
    if attackers.is_empty() {
        return;
    }
    let occupiers = occupiers_of(world, city, size);
    for &i in people {
        if matches!(world.residents[i].order, Some(ResidentOrder::Attack(_)))
            || !defends_city(world, city, &world.residents[i], size)
        {
            continue;
        }
        go_after_nearest(world, i, &attackers, &occupiers, size);
    }
}

/// Sends a city's defender after the nearest of `attackers` (`goAfterNearest`). Going after one of
/// the `occupiers` of its town hall is defending it, no crime.
pub fn go_after_nearest(
    world: &mut WorldState,
    i: usize,
    attackers: &[usize],
    occupiers: &[usize],
    size: i32,
) {
    let at = tile(world, i);
    let nearest = attackers
        .iter()
        .copied()
        .reduce(|a, b| {
            if wrap_distance(size, at, tile(world, b)) < wrap_distance(size, at, tile(world, a)) {
                b
            } else {
                a
            }
        })
        .expect("an attacker");
    let target = world.residents[nearest].id.clone();
    world.residents[i].order =
        Some(ResidentOrder::Attack(attack_order(&target, false, occupiers.contains(&nearest))));
}

/// An NPC city keeps `target` soldiers (`keepSoldiers`): its armed adults are its soldiers and stop
/// working. While it has too few, it arms one more adult at a time: with a weapon from `storage`,
/// else with a spear from its smithy.
fn keep_soldiers(
    world: &mut WorldState,
    city: &City,
    people: &[usize],
    target: f64,
    storage: Option<usize>,
) {
    let tick = world.tick as f64;
    // The armed member of a founding party goes with it, not counted here.
    let party: HashSet<String> =
        founding_party(world.city_plans.get(&city.id)).into_iter().collect();
    let adults: Vec<usize> = people
        .iter()
        .copied()
        .filter(|&i| {
            can_work(world.residents[i].born_at, tick) && !party.contains(&world.residents[i].id)
        })
        .collect();
    let soldiers: Vec<usize> =
        adults.iter().copied().filter(|&i| is_armed(&world.residents[i])).collect();
    let no_storage = no_storage_yet(world, city);
    for &i in &soldiers {
        let r = &mut world.residents[i];
        let task = r.script.as_ref().and_then(|s| s.task);
        if task == Some(Task::Alarm)
            || task == Some(Task::Train)
            || (task == Some(Task::Build) && no_storage)
        {
            continue;
        }
        if matches!(r.order, Some(ResidentOrder::WorkAt(_)) | Some(ResidentOrder::Build(_))) {
            stop_work(r);
        } else {
            r.script = None;
        }
    }
    let standing_down = if city.trade_org.is_none() && !no_storage {
        stand_down(world, city, &adults, &soldiers, target, storage)
    } else {
        Vec::new()
    };
    let soldiers: Vec<usize> =
        soldiers.into_iter().filter(|i| !standing_down.contains(i)).collect();
    let archers = npc_archer_target(world, city, adults.len() as f64);
    upgrade_soldiers(world, city, &soldiers, storage, archers);
    if soldiers.len() as f64 >= target {
        return;
    }
    // Its traders are never made soldiers.
    let traders: HashSet<String> = world
        .city_plans
        .get(&city.id)
        .and_then(|p| p.traders.as_ref())
        .into_iter()
        .flatten()
        .map(|t| t.resident_id.clone())
        .collect();
    let unarmed: Vec<usize> = adults
        .iter()
        .copied()
        .filter(|&i| {
            let r = &world.residents[i];
            !is_armed(r)
                && !matches!(r.order, Some(ResidentOrder::Attack(_)))
                && !traders.contains(&r.id)
        })
        .collect();
    if unarmed.is_empty() {
        return;
    }
    let smithy = npc_smithy(world, city);
    if let Some(s) = smithy {
        if take_from_smithy(world, s, &unarmed) {
            return;
        }
    }
    if let Some(st) = storage {
        if let Some(weapon) = weapon_in(world.buildings[st].stock.as_ref()) {
            fetch(world, st, &unarmed, &Stock::from([(weapon, 1.0)]));
            return;
        }
    }
    let weapon = npc_soldier_kit(world, city)[0];
    let recipe = recipe_for(BuildingKind::Smithy, Some(good_name(weapon)));
    let (Some(s), Some(st), Some(recipe)) = (smithy, storage, recipe) else { return };
    let input: Stock = recipe_input(recipe).into_iter().collect();
    // One carrying a child can't work, so can't forge what they would fetch.
    let smiths: Vec<usize> =
        unarmed.iter().copied().filter(|&i| world.residents[i].carrying.is_none()).collect();
    if smithing(world, s, &smiths, &input, weapon) {
        return;
    }
    let enough = input.iter().all(|(g, n)| held_in(world.buildings[st].stock.as_ref(), *g) >= *n);
    if enough {
        fetch(world, st, &smiths, &input);
    }
}

/// With more armed `adults` than the `target` soldiers it keeps, an NPC city stands the extra down
/// (`CONTEXT.md`: Soldiers in peace): first those free and walking to `storage` already, such as a
/// smith carrying the smithy's weapons there, then those free on a post, archers last, by id from
/// the last, always leaving those who hold its town hall (`NPC_SOLDIERS_ON_HALL`, at most
/// `target`). One standing down walks to the storage and there puts their weapons, armour and
/// Arrows into it, and is a spare hand again at the city's next pass. Those on a round, escorting,
/// training, teaching, on alarm, fighting or about anything else stay soldiers for now. Only orders
/// a Player could give (ADR 0002). Returns those standing down.
fn stand_down(
    world: &mut WorldState,
    city: &City,
    adults: &[usize],
    soldiers: &[usize],
    target: f64,
    storage: Option<usize>,
) -> Vec<usize> {
    let Some(st) = storage else { return Vec::new() };
    let extra = soldiers.len() as f64 - target;
    if extra < 1.0 {
        return Vec::new();
    }
    let (sx, sy) = (world.buildings[st].x, world.buildings[st].y);
    let to_store = |r: &Resident| matches!(&r.order, Some(ResidentOrder::WalkTo(w)) if w.target.x == sx && w.target.y == sy);
    let mut free: Vec<usize> = free_soldiers(world, city, adults)
        .into_iter()
        .filter(|&i| {
            let r = &world.residents[i];
            r.order.is_none() || to_store(r)
        })
        .collect();
    free.sort_by(|&a, &b| {
        let (ra, rb) = (&world.residents[a], &world.residents[b]);
        (!to_store(ra), is_npc_archer(ra))
            .cmp(&(!to_store(rb), is_npc_archer(rb)))
            .then_with(|| rb.id.cmp(&ra.id))
    });
    let hold = (NPC_SOLDIERS_ON_HALL.min(target) as usize).min(free.len());
    let most = (extra as usize).min(free.len() - hold);
    let chosen: Vec<usize> = free.into_iter().take(most).collect();
    for &i in &chosen {
        let r = &world.residents[i];
        if r.order.is_some() {
            continue;
        }
        if !is_at(tile(world, i), placed(&world.buildings[st]), MAP_SIZE) {
            walk_to(&mut world.residents[i], (sx, sy));
            continue;
        }
        let gear = gear_of(&r.carried);
        if !gear.is_empty() {
            let to = GoodsSpot::Storage { storage_id: world.buildings[st].id.clone() };
            world.residents[i].order = Some(ResidentOrder::Drop(DropOrder { to, goods: gear }));
        }
    }
    chosen
}

/// What one standing down puts into the storage: all they carry but Food, Coins and Tools.
fn gear_of(carried: &Stock) -> Stock {
    carried
        .iter()
        .filter(|(g, n)| **n > 0.0 && !matches!(g, Good::Food | Good::Coins | Good::Tools))
        .map(|(g, n)| (*g, *n))
        .collect()
}

/// Invariant `npc-soldiers-stand-down` (`CONTEXT.md`: Soldiers in peace; ADR 0004): an NPC city
/// with a finished storage never has more of its soldiers free on a post with nothing to do (no
/// order, no script), away from its storage, than the soldiers it keeps by its size: the extra
/// stand down.
pub fn npc_soldiers_stand_down(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let tick = world.tick as f64;
    for city in world.cities.iter().filter(|c| c.realm_id.is_none() && c.trade_org.is_none()) {
        let Some(store) = world.buildings.iter().find(|b| {
            b.city_id.as_ref() == Some(&city.id)
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        }) else {
            continue;
        };
        let people: Vec<usize> = (0..world.residents.len())
            .filter(|&i| {
                let r = &world.residents[i];
                r.owner.is_none()
                    && r.city_id.as_ref() == Some(&city.id)
                    && r.health > 0.0
                    && contract_of(world, &r.id).is_none()
            })
            .collect();
        let grown: Vec<usize> = people
            .iter()
            .copied()
            .filter(|&i| can_work(world.residents[i].born_at, tick))
            .collect();
        let target = npc_city_soldier_target(city, grown.len() as f64);
        let party: HashSet<String> =
            founding_party(world.city_plans.get(&city.id)).into_iter().collect();
        let adults: Vec<usize> =
            grown.into_iter().filter(|&i| !party.contains(&world.residents[i].id)).collect();
        let standing: Vec<&str> = free_soldiers(world, city, &adults)
            .into_iter()
            .map(|i| &world.residents[i])
            .filter(|r| r.order.is_none() && !is_at((r.x as i32, r.y as i32), placed(store), size))
            .map(|r| r.id.as_str())
            .collect();
        if standing.len() as f64 > target {
            out.push(InvariantViolation {
                invariant: "npc-soldiers-stand-down".into(),
                message: format!(
                    "{} has {} soldiers standing with nothing to do, keeps {target}",
                    city.id,
                    standing.len()
                ),
                entity_ids: std::iter::once(city.id.clone())
                    .chain(standing.iter().map(|s| s.to_string()))
                    .collect(),
            });
        }
    }
    out
}

/// The best weapon a stock holds, if any (`weaponIn`): steel before iron.
fn weapon_in(stock: Option<&Stock>) -> Option<Good> {
    let held: Stock = WEAPONS
        .iter()
        .filter_map(|w| good_of(w))
        .map(|g| (g, held_in(stock, g)))
        .filter(|(_, n)| *n > 0.0)
        .collect();
    best_weapon(&held)
}

/// A weapon lies on the smithy's pile: an unarmed adult working there, or idle at it, picks it up
/// (`takeFromSmithy`). Whether one does.
fn take_from_smithy(world: &mut WorldState, smithy: usize, unarmed: &[usize]) -> bool {
    let sb = &world.buildings[smithy];
    let Some(weapon) = weapon_in(building_pile(world, sb).map(|p| &p.goods)) else { return false };
    let here = unarmed.iter().copied().find(|&i| {
        let r = &world.residents[i];
        is_at(tile(world, i), placed(sb), MAP_SIZE)
            && match &r.order {
                None => true,
                Some(ResidentOrder::WorkAt(o)) => o.building_id == sb.id,
                _ => false,
            }
    });
    let Some(i) = here else { return false };
    world.residents[i].order = Some(ResidentOrder::PickUp(PickUpOrder {
        from: GoodsSpot::Ground,
        goods: Stock::from([(weapon, 1.0)]),
    }));
    true
}

/// Sends one unarmed adult to the storage for `goods`, unless one is on the way already (`fetch`).
fn fetch(world: &mut WorldState, storage: usize, unarmed: &[usize], goods: &Stock) {
    let tick = world.tick as f64;
    let room = |i: usize| {
        stock_weight(&world.residents[i].carried) + stock_weight(goods)
            <= carry_capacity(&world.residents[i], tick)
    };
    let unarmed: Vec<usize> = unarmed.iter().copied().filter(|&i| room(i)).collect();
    let sb = &world.buildings[storage];
    let at = |i: usize| is_at(tile(world, i), placed(sb), MAP_SIZE);
    if let Some(&i) = unarmed.iter().find(|&&i| world.residents[i].order.is_none() && at(i)) {
        let from = GoodsSpot::Storage { storage_id: sb.id.clone() };
        world.residents[i].order =
            Some(ResidentOrder::PickUp(PickUpOrder { from, goods: goods.clone() }));
        return;
    }
    let coming = unarmed.iter().any(|&i| matches!(&world.residents[i].order, Some(ResidentOrder::WalkTo(o)) if o.target.x == sb.x && o.target.y == sb.y));
    if coming {
        return;
    }
    let sent =
        unarmed.iter().copied().find(|&i| world.residents[i].order.is_none()).or_else(|| {
            unarmed
                .iter()
                .copied()
                .find(|&i| matches!(world.residents[i].order, Some(ResidentOrder::WorkAt(_))))
        });
    if let Some(i) = sent {
        let to = (sb.x, sb.y);
        world.residents[i].script = None;
        walk_to(&mut world.residents[i], to);
    }
}

/// The smith's part (`smithing`): an unarmed adult already working the smithy keeps at it; one
/// carrying the spear's Iron and Wood with nothing to do goes there and makes a spear. Whether
/// someone is on it.
fn smithing(
    world: &mut WorldState,
    smithy: usize,
    unarmed: &[usize],
    input: &Stock,
    weapon: Good,
) -> bool {
    let sb = world.buildings[smithy].clone();
    if unarmed.iter().any(|&i| matches!(&world.residents[i].order, Some(ResidentOrder::WorkAt(o)) if o.building_id == sb.id)) {
        return true;
    }
    let carries = |i: usize| input.iter().all(|(g, n)| held(&world.residents[i].carried, *g) >= *n);
    let smith = unarmed.iter().copied().find(|&i| {
        carries(i)
            && match &world.residents[i].order {
                None => true,
                Some(ResidentOrder::WalkTo(o)) => o.target.x == sb.x && o.target.y == sb.y,
                _ => false,
            }
    });
    let Some(i) = smith else { return false };
    if world.residents[i].order.is_some() {
        return true;
    }
    if !is_at(tile(world, i), placed(&sb), MAP_SIZE) {
        walk_to(&mut world.residents[i], (sb.x, sb.y));
        return true;
    }
    if work_problem(world, &world.residents[i], Some(weapon)).is_some() {
        return false;
    }
    start_work(&mut world.residents[i], &sb, Some(weapon));
    true
}

/// The Trade Org army an NPC city keeps its gates open for, by id (`armyLetPast`).
fn army_let_past(world: &WorldState, city: &City) -> HashSet<String> {
    let mut ids = HashSet::new();
    if npc_city_refuses(world, city, TRADE_ORG) {
        return ids;
    }
    let org = city_organization(city);
    let aimed_here = |pid: Option<&String>| {
        pid.and_then(|id| world.punishments.iter().find(|p| &p.id == id))
            .is_some_and(|p| p.culprit_org == org)
    };
    for p in &world.punishments {
        if p.culprit_org != org {
            ids.extend(p.members.iter().map(|m| m.resident_id.clone()));
        }
    }
    for w in &world.supply_wagons {
        if let Some(d) = &w.driver_id {
            if !aimed_here(w.punishment_id.as_ref()) {
                ids.insert(d.clone());
            }
        }
    }
    ids
}

/// An NPC city closes its gates while an armed outsider stands within `NPC_GATE_WATCH_RANGE` of one
/// of them, and opens them again once none does (`watchGates`).
fn watch_gates(world: &mut WorldState, city: &City, size: i32) {
    let gates: Vec<usize> = (0..world.buildings.len())
        .filter(|&i| {
            let b = &world.buildings[i];
            // The kind first: cheaper than comparing the city's id.
            b.kind == BuildingKind::Gate && b.site.is_none() && b.city_id.as_ref() == Some(&city.id)
        })
        .collect();
    if gates.is_empty() {
        return;
    }
    let let_past = army_let_past(world, city);
    let near = world.residents.iter().any(|r| {
        r.health > 0.0
            && is_armed(r)
            && !let_past.contains(&r.id)
            && !allied(world, &city.id, wall_side(r).unwrap_or(""))
            && gates.iter().any(|&g| {
                let b = &world.buildings[g];
                wrap_distance(size, (r.x as i32, r.y as i32), (b.x as i32, b.y as i32))
                    <= NPC_GATE_WATCH_RANGE * crate::npc_stance::gate_watch_factor(city)
            })
    });
    for g in gates {
        world.buildings[g].closed = near.then_some(true);
    }
}

/// How far inside `NPC_GATE_WATCH_RANGE` the invariant looks (`GATE_WATCH_SLACK`).
const GATE_WATCH_SLACK: f64 = 8.0;

/// Invariant `npc-gate-shut-to-its-punishers` (`CONTEXT.md`: Trade Org army at an NPC gate).
pub fn npc_gate_shut_to_its_punishers(world: &WorldState, size: i32) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    let reach = NPC_GATE_WATCH_RANGE - GATE_WATCH_SLACK;
    for p in &world.punishments {
        let Some(city) =
            world.cities.iter().find(|c| for_sale(c) && city_organization(c) == p.culprit_org)
        else {
            continue;
        };
        let open: Vec<&Building> = world
            .buildings
            .iter()
            .filter(|b| {
                b.city_id.as_ref() == Some(&city.id)
                    && b.kind == BuildingKind::Gate
                    && b.site.is_none()
                    && b.closed != Some(true)
            })
            .collect();
        for m in &p.members {
            let Some(r) = world.residents.iter().find(|x| x.id == m.resident_id) else { continue };
            if r.health <= 0.0 || !is_armed(r) {
                continue;
            }
            let at = (r.x as i32, r.y as i32);
            if let Some(gate) =
                open.iter().find(|g| wrap_distance(size, at, (g.x as i32, g.y as i32)) <= reach)
            {
                out.push(InvariantViolation {
                    invariant: "npc-gate-shut-to-its-punishers".into(),
                    message: format!(
                        "gate {} of {} is open to {}, who has come to punish it",
                        gate.id, city.id, r.id
                    ),
                    entity_ids: vec![gate.id.clone(), r.id.clone(), p.id.clone()],
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod archer_tests;

/// The steel kit a city's soldiers fetch from its store (`upgradeKit`, `CONTEXT.md`: NPC reserve,
/// Trade Org army): `NPC_STEEL_KIT` for a Trade Org city and an NPC city that goes for Steel
/// (`npc_makes_steel`); none for any other, whose soldiers keep the spear they were armed with.
fn upgrade_kit(world: &WorldState, city: &City) -> Vec<Good> {
    if city.trade_org.is_some() || npc_makes_steel(world, city) {
        NPC_STEEL_KIT.iter().filter_map(|g| good_of(g)).collect()
    } else {
        Vec::new()
    }
}

/// What a soldier carries beyond their gear and the Food and Coins they keep (`spare`): every
/// weapon but one of their best (an archer's Bow: `is_npc_archer`), of each kind of protection
/// every piece but one of the best, and any other goods, such as the Steel a smith who took up arms
/// still carries; an archer keeps `NPC_ARCHER_ARROWS` Arrows.
fn spare(carried: &Stock) -> Stock {
    let archer = held(carried, Good::Bow) > 0.0;
    let weapon = if archer { Some(Good::Bow) } else { best_weapon(carried) };
    let mut keep: Vec<Good> = weapon.into_iter().collect();
    for kind in PROTECTION_KINDS {
        let best = kind
            .iter()
            .filter_map(|p| good_of(p).map(|g| (g, PROTECTION_DEFENCE.get(p).unwrap_or(0.0))))
            .filter(|(g, _)| held(carried, *g) > 0.0)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        keep.extend(best.map(|(g, _)| g));
    }
    carried
        .iter()
        .filter(|(g, n)| **n > 0.0 && **g != Good::Food && **g != Good::Coins)
        .map(|(g, n)| {
            let kept = match *g {
                Good::Arrows if archer => NPC_ARCHER_ARROWS,
                g if keep.contains(&g) => 1.0,
                _ => 0.0,
            };
            (*g, n - kept)
        })
        .filter(|(_, n)| *n > 0.0)
        .collect()
}

/// A city's soldiers arm themselves with steel as far as its store holds it (`upgradeSoldiers`,
/// `CONTEXT.md`: NPC reserve, Trade Org army): a soldier at the store with nothing to do puts back
/// what they carry spare (`spare`: what a better piece outdoes, more than one of a piece, other
/// goods); one with something spare elsewhere goes there to, one at a time; otherwise one soldier at
/// a time fetches the first piece of the city's steel kit (`upgrade_kit`) they lack that the store
/// holds. Before the steel kit, a city that wants `archers` (`npc_archer_target`) has an archer
/// low on Arrows fetch more, and while it has fewer archers one soldier at a time fetches a Bow and
/// Arrows (`CONTEXT.md`: Ranged combat); an archer fetches no weapon or shield of the kit. Only
/// orders a Player could give (ADR 0002).
fn upgrade_soldiers(
    world: &mut WorldState,
    city: &City,
    soldiers: &[usize],
    storage: Option<usize>,
    archers: f64,
) {
    let Some(st) = storage else { return };
    let kit = upgrade_kit(world, city);
    if kit.is_empty() && archers <= 0.0 {
        return;
    }
    let sb = &world.buildings[st];
    let (sx, sy) = (sb.x, sb.y);
    let to_store = |o: &Option<ResidentOrder>| matches!(o, Some(ResidentOrder::WalkTo(w)) if w.target.x == sx && w.target.y == sy);
    // A trader's escort keeps with them (`CONTEXT.md`: Escort): not sent home for gear (#1379:
    // Thornbury's escort, just at the warehouse 495 tiles out, walked home for a new shield, and
    // its trader stood waiting for it until they starved).
    let escorts = crate::npc_escort::escorts_out(world, &city.id);
    let free: Vec<usize> = soldiers
        .iter()
        .copied()
        .filter(|&i| {
            let r = &world.residents[i];
            r.script.is_none()
                && (r.order.is_none() || to_store(&r.order))
                && !escorts.contains(&r.id)
        })
        .collect();
    let at_store = |world: &WorldState, i: usize| {
        is_at(tile(world, i), placed(&world.buildings[st]), MAP_SIZE)
    };
    for &i in &free {
        if world.residents[i].order.is_some() || !at_store(world, i) {
            continue;
        }
        let put = spare(&world.residents[i].carried);
        if !put.is_empty() {
            let to = GoodsSpot::Storage { storage_id: world.buildings[st].id.clone() };
            world.residents[i].order = Some(ResidentOrder::Drop(DropOrder { to, goods: put }));
            return;
        }
    }
    if free.iter().any(|&i| to_store(&world.residents[i].order)) {
        return;
    }
    if let Some(&i) = free.iter().find(|&&i| !spare(&world.residents[i].carried).is_empty()) {
        walk_to(&mut world.residents[i], (sx, sy));
        return;
    }
    let stock = world.buildings[st].stock.clone();
    if archers > 0.0 && arm_archers(world, st, soldiers, &free, archers) {
        return;
    }
    for g in kit {
        if held_in(stock.as_ref(), g) < 1.0 {
            continue;
        }
        let bow_hands = g == Good::SteelShield || WEAPONS.contains(&good_name(g));
        let lacking: Vec<usize> = free
            .iter()
            .copied()
            .filter(|&i| {
                let r = &world.residents[i];
                held(&r.carried, g) <= 0.0 && !(bow_hands && is_npc_archer(r))
            })
            .collect();
        if !lacking.is_empty() {
            fetch(world, st, &lacking, &Stock::from([(g, 1.0)]));
            return;
        }
    }
}

/// The archers' part of `upgrade_soldiers` (`CONTEXT.md`: Ranged combat, NPC reserve): an archer
/// with fewer than half `NPC_ARCHER_ARROWS` fetches that half from the storage as far as it holds
/// them; else, with fewer archers among its `soldiers` than it wants, one of its `free` soldiers
/// who is none, by id, fetches a Bow and up to `NPC_ARCHER_ARROWS`, while the storage holds a Bow
/// and Arrows. Whether one is on it.
fn arm_archers(
    world: &mut WorldState,
    st: usize,
    soldiers: &[usize],
    free: &[usize],
    archers: f64,
) -> bool {
    let stock = world.buildings[st].stock.clone();
    let arrows = held_in(stock.as_ref(), Good::Arrows);
    if arrows < 1.0 {
        return false;
    }
    let half = (NPC_ARCHER_ARROWS / 2.0).ceil();
    let low: Vec<usize> = free
        .iter()
        .copied()
        .filter(|&i| {
            let r = &world.residents[i];
            is_npc_archer(r) && held(&r.carried, Good::Arrows) < half
        })
        .collect();
    if !low.is_empty() {
        fetch(world, st, &low, &Stock::from([(Good::Arrows, half.min(arrows))]));
        return true;
    }
    let now = soldiers.iter().filter(|&&i| is_npc_archer(&world.residents[i])).count() as f64;
    if now >= archers || held_in(stock.as_ref(), Good::Bow) < 1.0 {
        return false;
    }
    let mut others: Vec<usize> =
        free.iter().copied().filter(|&i| !is_npc_archer(&world.residents[i])).collect();
    others.sort_by(|&a, &b| world.residents[a].id.cmp(&world.residents[b].id));
    if others.is_empty() {
        return false;
    }
    let goods = Stock::from([(Good::Bow, 1.0), (Good::Arrows, NPC_ARCHER_ARROWS.min(arrows))]);
    fetch(world, st, &others, &goods);
    true
}

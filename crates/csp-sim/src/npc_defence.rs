//! NPC cities defending themselves (`apps/server/src/npc-defence.ts`, `CONTEXT.md`: NPC city,
//! Combat, Trading post, Alarm): a trading post and the HQ send their armed residents in their
//! area after attackers there; any NPC city keeps soldiers by its size and closes its gates while
//! armed outsiders are near. Only orders a Player could give (ADR 0002), or opening and closing its
//! own gates as a realm does.

use std::collections::HashSet;

use csp_shared::balance::{MAP_SIZE, NPC_GATE_WATCH_RANGE, TRADE_ORG_ARMY};
use csp_shared::footprint::is_at;
use csp_shared::goods::WEAPONS;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    Building, BuildingKind, City, Good, GoodsSpot, PickUpOrder, ResidentOrder, Stock, Task,
    TradeOrgCity, WorldState,
};

use crate::combat::attack_order;
use crate::crimes::{city_organization, known_thieves};
use crate::npc_behaviour::{stop_work, walk_to};
use crate::npc_founding::founding_party;
use crate::npc_growth::no_storage_yet;
use crate::queries::alliance::{allied, contract_of};
use crate::queries::building::{building_pile, recipe_for, recipe_input, work_problem};
use crate::queries::city::{for_sale, in_city_area, npc_city_refuses};
use crate::queries::city_area::{defends_city, occupiers_of};
use crate::queries::names::{good_name, good_of, held, held_in, placed};
use crate::queries::npc_trade::{npc_soldier_target, NPC_SMITHY_WEAPON};
use crate::queries::residents::{can_work, carry_capacity, is_armed, stock_weight};
use crate::queries::standing::TRADE_ORG;
use crate::queries::walls::wall_side;
use crate::queries::warehouse::warehouse_keeps;
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
/// TODO(T86.12): call the ported alarms; until then nobody is alarmed by an occupation.
fn raise_occupied(_world: &mut WorldState, _city: &City, _occupier: &str, _size: i32) {}

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
        }
        if city.trade_org == Some(TradeOrgCity::Post) {
            // A trading post arms from its warehouse, as far as it holds weapons.
            let warehouse = world.buildings.iter().position(|b| {
                b.city_id.as_deref() == Some(id.as_str()) && b.kind == BuildingKind::Warehouse
            });
            keep_soldiers(world, &city, &people, npc_soldier_target(adults), warehouse);
        }
        if city.trade_org.is_some() {
            continue;
        }
        let storage = world.buildings.iter().position(|b| {
            b.city_id.as_deref() == Some(id.as_str())
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
        });
        keep_soldiers(world, &city, &people, npc_soldier_target(adults), storage);
        watch_gates(world, &city, size);
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
                && (b.kind == BuildingKind::Wall || b.kind == BuildingKind::Gate)
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
            let attacking = match &r.order {
                Some(ResidentOrder::Attack(o)) => {
                    o.defending != Some(true) && (own(&o.target_id) || own_wall(&o.target_id))
                }
                Some(ResidentOrder::Climb(o)) => own_wall(&o.wall_id),
                _ => false,
            };
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
        adults.iter().copied().filter(|&i| is_armed(&world.residents[i].carried)).collect();
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
            !is_armed(&r.carried)
                && !matches!(r.order, Some(ResidentOrder::Attack(_)))
                && !traders.contains(&r.id)
        })
        .collect();
    if unarmed.is_empty() {
        return;
    }
    let smithy = world.buildings.iter().position(|b| {
        b.kind == BuildingKind::Smithy
            && b.site.is_none()
            && (b.city_id.as_ref() == Some(&city.id)
                || city.workplace_ids.iter().flatten().any(|id| *id == b.id))
    });
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
    let recipe = recipe_for(BuildingKind::Smithy, Some(good_name(NPC_SMITHY_WEAPON)));
    let (Some(s), Some(st), Some(recipe)) = (smithy, storage, recipe) else { return };
    let input: Stock = recipe_input(recipe).into_iter().collect();
    // One carrying a child can't work, so can't forge what they would fetch.
    let smiths: Vec<usize> =
        unarmed.iter().copied().filter(|&i| world.residents[i].carrying.is_none()).collect();
    if smithing(world, s, &smiths, &input) {
        return;
    }
    let enough = input.iter().all(|(g, n)| held_in(world.buildings[st].stock.as_ref(), *g) >= *n);
    if enough {
        fetch(world, st, &smiths, &input);
    }
}

/// The first weapon a stock holds, if any (`weaponIn`).
fn weapon_in(stock: Option<&Stock>) -> Option<Good> {
    WEAPONS.iter().filter_map(|w| good_of(w)).find(|g| held_in(stock, *g) > 0.0)
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
fn smithing(world: &mut WorldState, smithy: usize, unarmed: &[usize], input: &Stock) -> bool {
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
    if work_problem(world, &world.residents[i], Some(NPC_SMITHY_WEAPON)).is_some() {
        return false;
    }
    start_work(&mut world.residents[i], &sb, Some(NPC_SMITHY_WEAPON));
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
            b.city_id.as_ref() == Some(&city.id) && b.kind == BuildingKind::Gate && b.site.is_none()
        })
        .collect();
    if gates.is_empty() {
        return;
    }
    let let_past = army_let_past(world, city);
    let near = world.residents.iter().any(|r| {
        r.health > 0.0
            && is_armed(&r.carried)
            && !let_past.contains(&r.id)
            && !allied(world, &city.id, wall_side(r).unwrap_or(""))
            && gates.iter().any(|&g| {
                let b = &world.buildings[g];
                wrap_distance(size, (r.x as i32, r.y as i32), (b.x as i32, b.y as i32))
                    <= NPC_GATE_WATCH_RANGE
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
            if r.health <= 0.0 || !is_armed(&r.carried) {
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

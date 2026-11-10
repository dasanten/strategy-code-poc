//! Aging (`apps/server/src/aging.ts`, `CONTEXT.md`: Aging, Child): children grow up, residents
//! die of old age at their lifespan, and declining Strength puts down what it can no longer
//! carry.

use csp_shared::balance::{GOOD_WEIGHT, MAP_SIZE};
use csp_shared::world::{DeathCause, Good, Realm, RealmEventWhat, Resident, Stock, WorldState};

use crate::events::record_event;
use crate::queries::names::{good_of, held};
use crate::queries::residents::{
    age_in_years, can_work, carry_capacity, good_weight, stock_weight,
};
use crate::survival::{die_all, drop_goods};

/// What aging did this tick (`AgingResult`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AgingResult {
    /// Residents who died of old age this tick.
    pub died: Vec<Resident>,
    /// Realms that ended because their Leader died of old age.
    pub ended: Vec<Realm>,
    /// Children who grew up this tick, so they can work from now on.
    pub grown: Vec<Resident>,
}

/// One tick of aging (`stepAging`, `CONTEXT.md`: Aging, Child), run after the tick has advanced:
/// a child who reaches `ADULT_AGE` has grown up and goes in the Player's realm log; a resident who
/// has reached their lifespan dies of old age, dropping what they carried; a Leader's death ends
/// their realm. Stats decline late in life (`stat_value`), so a resident whose Strength no longer
/// carries their load puts down what is too much on their tile, Food last. `size` is the map's.
pub fn step_aging(world: &mut WorldState, size: i32) -> AgingResult {
    let tick = world.tick as f64;
    let grown: Vec<Resident> = world
        .residents
        .iter()
        .filter(|r| can_work(r.born_at, tick) && !can_work(r.born_at, tick - 1.0))
        .cloned()
        .collect();
    for r in &grown {
        let what = RealmEventWhat::GrownUp { resident_id: r.id.clone(), name: r.name.clone() };
        record_event(world, r.owner.as_deref(), what);
    }
    let died: Vec<String> = world
        .residents
        .iter()
        .filter(|r| age_in_years(r.born_at, tick) >= r.lifespan)
        .map(|r| r.id.clone())
        .collect();
    let (died, ended) = die_all(world, &died, DeathCause::OldAge, size, None);
    for i in 0..world.residents.len() {
        drop_excess(world, i);
    }
    AgingResult { died, ended, grown }
}

/// Goods put down first when a load is too heavy (`DROP_ORDER`): heaviest per unit first, Food
/// last; goods of one weight in `GOOD_WEIGHT`'s order.
fn drop_order() -> Vec<Good> {
    let mut order: Vec<Good> =
        GOOD_WEIGHT.0.iter().filter_map(|(g, _)| good_of(g)).filter(|g| *g != Good::Food).collect();
    order.sort_by(|a, b| good_weight(*b).total_cmp(&good_weight(*a)));
    order.push(Good::Food);
    order
}

/// Puts down whole units until what the resident at `i` carries is within their carry capacity
/// (`dropExcess`).
fn drop_excess(world: &mut WorldState, i: usize) {
    let tick = world.tick as f64;
    let r = &mut world.residents[i];
    let mut over = stock_weight(&r.carried) - carry_capacity(r, tick);
    if over <= 1e-9 {
        return;
    }
    let mut dropped = Stock::new();
    for good in drop_order() {
        let have = held(&r.carried, good);
        if have <= 0.0 {
            continue;
        }
        let w = good_weight(good);
        let units = have.min((over / w - 1e-9).ceil());
        dropped.insert(good, units);
        if units == have {
            r.carried.shift_remove(&good);
        } else {
            r.carried.insert(good, have - units);
        }
        over -= units * w;
        if over <= 1e-9 {
            break;
        }
    }
    let (x, y) = (r.x, r.y);
    // The TypeScript leaves out the map's size here, so it is `MAP_SIZE` (ported as it is).
    drop_goods(world, x, y, &dropped, MAP_SIZE);
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::balance::{
        ticks_for_age, ADULT_AGE, DECLINE_AGE, DECLINE_FLOOR, LIFESPAN_MAX, LIFESPAN_MIN,
    };
    use csp_shared::terrain::{Terrain, TerrainMap};
    use csp_shared::time::TICKS_PER_GAME_YEAR;
    use csp_shared::world::Pile;

    use crate::invariants::check_all;
    use crate::npc_test_world::Runner;
    use crate::queries::residents::{age_factor, hunger_factor, walk_speed};
    use crate::test_support::world_with_city;

    /// Makes a resident the given age in game years at `tick` (`aged`).
    fn aged(r: &mut Resident, years: f64, tick: f64) {
        r.born_at = tick - ticks_for_age(years).ceil();
    }

    // aging.test.ts: ages residents over simulated years until each dies of old age at their lifespan
    #[test]
    fn ages_residents_over_simulated_years_until_each_dies_at_their_lifespan() {
        let (mut world, terrain) = world_with_city();
        let realm = world.realms[0].id.clone();
        let lifespans: Vec<(String, f64)> =
            world.residents.iter().map(|r| (r.id.clone(), r.lifespan)).collect();
        let mut deaths = Vec::new();
        let mut realm_ended = None;
        let mut year = 1u64;
        while !world.residents.is_empty() {
            assert!((year as f64) < LIFESPAN_MAX);
            world.tick = year * TICKS_PER_GAME_YEAR as u64;
            let AgingResult { died, ended, .. } = step_aging(&mut world, terrain.size);
            let tick = world.tick as f64;
            deaths.extend(died.iter().map(|r| (r.id.clone(), age_in_years(r.born_at, tick))));
            if ended.iter().any(|x| x.id == realm) {
                realm_ended = Some(year);
            }
            assert_eq!(check_all(&world, &terrain), []);
            year += 1;
        }
        assert_eq!(deaths.len(), lifespans.len());
        for (id, age) in deaths {
            let lifespan = lifespans.iter().find(|(i, _)| *i == id).unwrap().1;
            // Stepped a year at a time, so each dies within a year after reaching their lifespan.
            assert!(age >= lifespan && age < lifespan + 1.0);
            assert!(age >= LIFESPAN_MIN);
        }
        // The Leader died of old age too, which ended the realm.
        assert!(realm_ended.is_some());
        assert!(world.realms.is_empty());
    }

    /// The rule alone: a death of old age drops what was carried.
    #[test]
    fn lets_a_resident_die_of_old_age_dropping_what_they_carried() {
        let (mut world, terrain) = world_with_city();
        let tick = world.tick as f64;
        let r = &mut world.residents[1];
        r.carried = Stock::from([(Good::Stone, 3.0)]);
        r.lifespan = age_in_years(r.born_at, tick) + 5.0 / TICKS_PER_GAME_YEAR;
        let (id, x, y) = (r.id.clone(), r.x, r.y);
        for _ in 0..10 {
            world.tick += 1;
            step_aging(&mut world, terrain.size);
        }
        assert!(world.residents.iter().all(|r| r.id != id));
        assert_eq!(world.residents.len(), 7);
        let piles: Vec<&Pile> = world.piles.iter().collect();
        assert_eq!(piles.len(), 1);
        assert_eq!((piles[0].x, piles[0].y), (x, y));
        assert_eq!(piles[0].goods, Stock::from([(Good::Stone, 3.0)]));
    }

    // aging.test.ts: lets a resident die of old age in the running world, dropping what they carried
    #[test]
    fn lets_a_resident_die_of_old_age_in_the_running_world_dropping_what_they_carried() {
        let (mut world, terrain) = world_with_city();
        let tick = world.tick as f64;
        let r = &mut world.residents[1];
        r.carried = Stock::from([(Good::Stone, 3.0)]);
        r.lifespan = age_in_years(r.born_at, tick) + 5.0 / TICKS_PER_GAME_YEAR;
        let (id, x, y) = (r.id.clone(), r.x, r.y);
        let mut runner = Runner::new(&terrain);
        for _ in 0..10 {
            runner.step(&mut world, &terrain);
        }
        assert!(world.residents.iter().all(|r| r.id != id));
        assert_eq!(world.residents.len(), 7);
        assert_eq!(world.piles.len(), 1);
        assert_eq!((world.piles[0].x, world.piles[0].y), (x, y));
        assert_eq!(world.piles[0].goods, Stock::from([(Good::Stone, 3.0)]));
        assert_eq!(check_all(&world, &terrain), []);
    }

    // aging.test.ts: does not let children work until they are grown
    #[test]
    fn does_not_let_children_work_until_they_are_grown() {
        let (mut world, _) = world_with_city();
        let tick = world.tick as f64;
        aged(&mut world.residents[1], 0.0, tick);
        let child = &world.residents[1];
        assert!(!can_work(child.born_at, tick));
        assert!(!can_work(child.born_at, tick + ticks_for_age(ADULT_AGE - 0.01)));
        assert!(can_work(child.born_at, tick + ticks_for_age(ADULT_AGE)));
        assert!(world.residents.iter().skip(2).all(|r| can_work(r.born_at, tick)));
        assert!(can_work(world.residents[0].born_at, tick));
    }

    #[test]
    fn records_children_who_grow_up() {
        let (mut world, terrain) = world_with_city();
        let tick = world.tick as f64 + 10.0;
        world.residents[1].born_at = tick - ticks_for_age(ADULT_AGE).ceil();
        world.tick += 10;
        let AgingResult { grown, .. } = step_aging(&mut world, terrain.size);
        assert_eq!(grown.len(), 1);
        assert_eq!(grown[0].id, world.residents[1].id);
        assert!(matches!(world.events.last().unwrap().what, RealmEventWhat::GrownUp { .. }));
    }

    // aging.test.ts: makes stats decline late in life, down to a floor
    #[test]
    fn makes_stats_decline_late_in_life_down_to_a_floor() {
        let (mut world, _) = world_with_city();
        let tick = world.tick as f64;
        let r = &mut world.residents[1];
        r.stats.strength.base = 10.0;
        r.stats.agility.base = 10.0;
        r.stats.endurance.base = 10.0;
        let mut at = |years: f64| {
            aged(r, years, tick);
            (
                age_factor(r, tick),
                carry_capacity(r, tick),
                walk_speed(r, Terrain::Plains as u8, tick),
                hunger_factor(r, tick),
            )
        };
        let young = at(20.0);
        assert_eq!(young.0, 1.0);
        assert_eq!(at(DECLINE_AGE + 0.9), young);
        let old = at(DECLINE_AGE + 10.0);
        assert!(old.0 < 1.0);
        assert!(old.1 < young.1);
        assert!(old.2 < young.2);
        // Less Endurance: the old need more food.
        assert!(old.3 > young.3);
        assert_eq!(at(200.0).0, DECLINE_FLOOR);
    }

    // aging.test.ts: puts down what declining Strength can no longer carry, Food last
    #[test]
    fn puts_down_what_declining_strength_can_no_longer_carry_food_last() {
        let (mut world, terrain) = world_with_city();
        let tick = world.tick as f64;
        let r = &mut world.residents[1];
        r.lifespan = LIFESPAN_MAX;
        aged(r, 30.0, tick);
        let stone = carry_capacity(r, tick).floor() - 5.0;
        r.carried = Stock::from([(Good::Food, 5.0), (Good::Stone, stone)]);
        assert!(stock_weight(&r.carried) <= carry_capacity(r, tick));
        assert_eq!(check_all(&world, &terrain), []);
        let r = &mut world.residents[1];
        aged(r, DECLINE_AGE + 10.0, tick);
        let (x, y) = (r.x, r.y);
        step_aging(&mut world, terrain.size);
        let r = &world.residents[1];
        let capacity = carry_capacity(r, tick);
        assert!(stock_weight(&r.carried) <= capacity);
        assert!(stock_weight(&r.carried) > capacity - 1.0);
        assert_eq!(held(&r.carried, Good::Food), 5.0);
        assert_eq!(world.piles.len(), 1);
        assert_eq!((world.piles[0].x, world.piles[0].y), (x, y));
        assert_eq!(world.piles[0].goods.keys().collect::<Vec<_>>(), [&Good::Stone]);
        assert_eq!(check_all(&world, &terrain), []);
    }

    /// The violations as (invariant, entity ids).
    fn violations(world: &WorldState, terrain: &TerrainMap) -> Vec<(String, Vec<String>)> {
        check_all(world, terrain).into_iter().map(|v| (v.invariant, v.entity_ids)).collect()
    }

    // aging.test.ts: is watched by an invariant: nobody outlives their lifespan
    #[test]
    fn is_watched_by_an_invariant_nobody_outlives_their_lifespan() {
        let (mut world, terrain) = world_with_city();
        let tick = world.tick as f64;
        let r = &mut world.residents[1];
        let lifespan = r.lifespan;
        aged(r, lifespan, tick);
        let id = r.id.clone();
        assert_eq!(violations(&world, &terrain), [("ages-in-range".into(), vec![id.clone()])]);
        let r = &mut world.residents[1];
        r.lifespan = LIFESPAN_MAX + 1.0;
        aged(r, 20.0, tick);
        assert_eq!(violations(&world, &terrain), [("ages-in-range".into(), vec![id])]);
    }
}

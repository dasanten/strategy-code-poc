//! The movement functions of `packages/shared/src/balance.ts`: how fast a resident walks, a
//! carriage goes and a rider rides, the horse stat factors behind them, and the Driving skill
//! learned on the way (`CONTEXT.md`: Terrain, Stats, Carriage, Horse stats, Riding).

use csp_shared::balance::{
    AGILITY_AVERAGE, AGILITY_LIMIT, AGILITY_SPEED_EFFECT, AGILITY_TERRAIN_EFFECT, CARRIAGE_SPEED,
    DRIVING_SKILL_EFFECT, DRIVING_SKILL_LIMIT, DRIVING_SKILL_PER_DAY, HORSE_ENDURANCE_EFFECT,
    HORSE_ENDURANCE_LIMIT, HORSE_HUNGRY_SHARE, HORSE_SPEED_EFFECT, HORSE_SPEED_LIMIT,
    HORSE_STAT_AVERAGE, HUNGRY_HORSE_PACE, INTELLECT_AVERAGE, MAX_HUNGER, TERRAIN_SPEED,
    WALK_TICKS_PER_TILE,
};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{Horse, HorseStats, Resident, SkillName, StatName};

use super::residents::stat_value;

/// `Math.max(-limit, Math.min(limit, v))`.
fn clamp(v: f64, limit: f64) -> f64 {
    (-limit).max(limit.min(v))
}

/// How far a horse stat is from average, as a share, at most `limit` either way.
fn horse_stat_share(stat: f64, effect: f64, limit: f64) -> f64 {
    clamp((stat - HORSE_STAT_AVERAGE) * effect, limit)
}

/// How much faster than an average horse a horse goes, from its Speed (`horseSpeedFactor`).
pub fn horse_speed_factor(stats: &HorseStats) -> f64 {
    1.0 + horse_stat_share(stats.speed, HORSE_SPEED_EFFECT, HORSE_SPEED_LIMIT)
}

/// How much of `HORSE_FOOD_PER_DAY` a horse needs, from its Endurance (`horseFoodFactor`).
pub fn horse_food_factor(stats: &HorseStats) -> f64 {
    1.0 - horse_stat_share(stats.endurance, HORSE_ENDURANCE_EFFECT, HORSE_ENDURANCE_LIMIT)
}

/// How many tiles per tick a resident walks onto a tile of the given terrain (`walkSpeed`):
/// plains speed from Agility, the terrain's slowdown softened by Agility, a road's speed-up on
/// top as it is. Zero for terrain nobody can enter.
pub fn walk_speed(r: &Resident, terrain: u8, tick: f64) -> f64 {
    let base = TERRAIN_SPEED.get(terrain).unwrap_or(0.0);
    if base == 0.0 || base.is_nan() {
        return 0.0;
    }
    let away = stat_value(r, StatName::Agility, tick) - AGILITY_AVERAGE;
    let pace = 1.0 + clamp(away * AGILITY_SPEED_EFFECT, AGILITY_LIMIT);
    let slowdown =
        0.0f64.max(1.0 - base) * (1.0 - clamp(away * AGILITY_TERRAIN_EFFECT, AGILITY_LIMIT));
    let speed_up = 0.0f64.max(base - 1.0);
    (pace * (1.0 - slowdown + speed_up)) / WALK_TICKS_PER_TILE
}

/// A resident's Driving skill (`skills.driving ?? 0`).
pub fn driving_skill(r: &Resident) -> f64 {
    r.skills.get(&SkillName::Driving).copied().unwrap_or(0.0)
}

/// How many tiles per tick a carriage driven by `driver` and pulled by a horse of `stats` goes
/// onto a tile of the given terrain (`driveSpeed`). Zero where a carriage cannot go.
pub fn drive_speed(driver: &Resident, stats: &HorseStats, terrain: u8) -> f64 {
    let base = CARRIAGE_SPEED.get(terrain).unwrap_or(0.0);
    let skilled = 1.0 + DRIVING_SKILL_LIMIT.min(driving_skill(driver) * DRIVING_SKILL_EFFECT);
    (base * horse_speed_factor(stats) * skilled) / WALK_TICKS_PER_TILE
}

/// How many tiles per tick a resident riding `horse` goes onto a tile of the given terrain
/// (`rideSpeed`): `drive_speed`, and only `HUNGRY_HORSE_PACE` of it while the horse is hungry.
pub fn ride_speed(rider: &Resident, horse: &Horse, terrain: u8) -> f64 {
    let hungry = horse.hunger < HORSE_HUNGRY_SHARE * MAX_HUNGER;
    drive_speed(rider, &horse.stats, terrain) * if hungry { HUNGRY_HORSE_PACE } else { 1.0 }
}

/// Driving skill a driver learns from one tick of driving (`drivingLearned`).
pub fn driving_learned(r: &Resident, tick: f64) -> f64 {
    let pace = stat_value(r, StatName::Intellect, tick) / INTELLECT_AVERAGE;
    (DRIVING_SKILL_PER_DAY / TICKS_PER_GAME_DAY) * pace
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_shared::terrain::Terrain;

    fn stats(speed: f64, endurance: f64) -> HorseStats {
        HorseStats { speed, strength: 10.0, endurance }
    }

    #[test]
    fn horse_factors_clamp_at_their_limits() {
        assert_eq!(horse_speed_factor(&stats(10.0, 10.0)), 1.0);
        assert_eq!(horse_speed_factor(&stats(100.0, 10.0)), 1.0 + HORSE_SPEED_LIMIT);
        assert_eq!(horse_food_factor(&stats(10.0, 100.0)), 1.0 - HORSE_ENDURANCE_LIMIT);
    }

    #[test]
    fn a_carriage_cannot_cross_bare_mountain() {
        let mut r: Resident = serde_json::from_value(serde_json::json!({
            "id": "r", "name": "R", "owner": null, "cityId": null, "x": 0, "y": 0,
            "stats": {"strength": {"base": 10, "trained": 0}, "endurance": {"base": 10, "trained": 0},
                      "agility": {"base": 10, "trained": 0}, "intellect": {"base": 10, "trained": 0}},
            "skills": {}, "health": 100, "hunger": 100, "bornAt": -1e9, "lifespan": 1e12,
            "carried": {}, "order": null
        }))
        .expect("a resident");
        // Just grown up, so old age takes nothing off the stats.
        r.born_at = -csp_shared::balance::ADULT_AGE
            * csp_shared::balance::CHILD_YEAR_DAYS
            * TICKS_PER_GAME_DAY;
        assert_eq!(drive_speed(&r, &stats(10.0, 10.0), Terrain::Mountain as u8), 0.0);
        assert_eq!(
            drive_speed(&r, &stats(10.0, 10.0), Terrain::Plains as u8),
            2.0 / WALK_TICKS_PER_TILE
        );
        assert_eq!(walk_speed(&r, Terrain::Plains as u8, 0.0), 1.0 / WALK_TICKS_PER_TILE);
    }
}

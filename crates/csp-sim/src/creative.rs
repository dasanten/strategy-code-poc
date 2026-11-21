//! Creative actions (`CONTEXT.md`: Creative mode, ADR 0043): what an admin on a server started
//! with `CREATIVE=1` does to the world by hand, between ticks. They are no order kind and no
//! script call (ADR 0002 stays whole for Players): the server's creative routes call them
//! directly. They reach every realm and unowned things alike.
//!
//! - **Goods:** give or take goods in a storage (or warehouse, stable or haven) or a carriage.
//! - **Finish now:** a construction site, the rest of the road or wall lines building on it, or
//!   the trainings at a training ground. Each ends as it would at normal speed: the site becomes
//!   its building through [`finish_site_by`], and the orders on it go on or end as after the last
//!   tick of work.
//! - **Residents and horses:** add a Resident (age, stats and skills picked) or a horse to a realm
//!   on a tile; heal a Resident, grow a child up, or kill one by a normal death.
//! - **Move:** a Resident or a group stands on a tile at once, their way and work dropped.

use csp_shared::balance::{
    ticks_for_age, ADULT_AGE, CREATIVE_HORSE_AGE_MAX, CREATIVE_STAT_MAX, LIFESPAN_MIN, MAP_SIZE,
    MAX_HEALTH, PASSENGER_WEIGHT, SKILL_MAX,
};
use csp_shared::footprint::is_at;
use csp_shared::terrain::{is_passable_terrain, is_water, terrain_at, tile_index, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_YEAR;
use csp_shared::world::{
    BuildingKind, DeathCause, Good, HorseStats, RealmEventWhat, ResidentOrder, SkillName, Stat,
    StatRecord, Stock, TrainingSubject, WallMaterial, WorldState,
};
use indexmap::IndexMap;

use crate::building::{building_part, finish_site_by, lay_out_site, orders_follow_sites};
use crate::cities::update_city_membership;
use crate::events::record_event;
use crate::horses::{new_horse, NewHorse};
use crate::names::resident_names_taken;
use crate::queries::balance::{skill_value, training_gain};
use crate::queries::building::{
    build_problem_for, carriage_can_go_to, construction_index_at, is_stone, line_building,
    line_kind_at, materials_of, teacher_at, work_of, TerrainLookup, KEEPS_GOODS,
};
use crate::queries::carriages::carriage_capacity;
use crate::queries::goods::take_out;
use crate::queries::js_round;
use crate::queries::names::placed;
use crate::queries::residents::can_work;
use crate::queries::residents::{good_weight, stock_weight};
use crate::queries::vessels::vessel_room;
use crate::random::{hash_str, new_id, Mulberry32};
use crate::residents::{new_resident, NewResident};
use crate::survival::die_all;
use crate::training::learn;
use crate::walls::{wall_map, WallKind};

/// The most ticks of training [`finish_now`] runs for one trainee: far more than any training
/// to its ceiling takes, so it only stops one that would never end.
const MOST_TRAINING_TICKS: u32 = 10_000_000;

/// Whole units of goods, more than none: what a creative goods action moves.
fn units(amount: f64) -> Result<f64, String> {
    if amount.is_finite() && amount >= 1.0 && amount.fract() == 0.0 {
        Ok(amount)
    } else {
        Err("Give a whole number of units, at least one.".into())
    }
}

/// Where goods are given or taken: a building that keeps goods, or a carriage.
enum Holder {
    Building(usize),
    Carriage(usize),
}

fn holder(world: &WorldState, id: &str) -> Result<Holder, String> {
    if let Some(i) = world.buildings.iter().position(|b| b.id == id) {
        let b = &world.buildings[i];
        if !KEEPS_GOODS.contains(&b.kind) || b.site.is_some() {
            return Err("Only a storage, warehouse, stable, haven or carriage holds goods.".into());
        }
        return Ok(Holder::Building(i));
    }
    world
        .carriages
        .iter()
        .position(|k| k.id == id)
        .map(Holder::Carriage)
        .ok_or_else(|| "No such building or carriage.".into())
}

/// Gives `amount` units of `good` to the storage or carriage `id`, from nothing. A carriage takes
/// no more than it holds. Answers the units given.
pub fn give_goods(
    world: &mut WorldState,
    id: &str,
    good: Good,
    amount: f64,
) -> Result<f64, String> {
    let units = units(amount)?;
    let stock: &mut Stock = match holder(world, id)? {
        Holder::Building(i) => world.buildings[i].stock.get_or_insert_with(Stock::new),
        Holder::Carriage(i) => {
            let capacity = carriage_capacity(world, &world.carriages[i]);
            let load = &world.carriages[i].load;
            if stock_weight(load) + units * good_weight(good) > capacity + 1e-9 {
                let free = (capacity - stock_weight(load)).max(0.0);
                return Err(format!(
                    "The carriage holds {capacity} kg; it has room for {} kg more.",
                    free.floor()
                ));
            }
            &mut world.carriages[i].load
        }
    };
    *stock.entry(good).or_insert(0.0) += units;
    Ok(units)
}

/// Takes up to `amount` units of `good` out of the storage or carriage `id`, never below none.
/// Answers the units taken.
pub fn take_goods(
    world: &mut WorldState,
    id: &str,
    good: Good,
    amount: f64,
) -> Result<f64, String> {
    let units = units(amount)?;
    let stock: &mut Stock = match holder(world, id)? {
        Holder::Building(i) => world.buildings[i].stock.get_or_insert_with(Stock::new),
        Holder::Carriage(i) => &mut world.carriages[i].load,
    };
    let taken = units.min(stock.get(&good).copied().unwrap_or(0.0));
    take_out(stock, good, taken);
    Ok(taken)
}

/// Finishes the construction site or the trainings at the building `id` now (`CONTEXT.md`:
/// Creative mode, finish now), as they would end at normal speed:
///
/// - **A site** gets all its materials and work and becomes its building (or boat, ship, carriage
///   or siege machine) for the realm of a resident building it, else the realm that laid it out;
///   the builders' orders end.
/// - **A road or wall line** building on that site builds every tile it has left the same way,
///   where a site may go, and its order ends.
/// - **A training ground:** every trainee there trains to where their teacher takes them (their
///   ceiling, or the teacher's level) and their order ends.
///
/// Answers what was done, for the admin.
pub fn finish_now(
    world: &mut WorldState,
    id: &str,
    terrain: Option<&TerrainMap>,
) -> Result<String, String> {
    let i = world.buildings.iter().position(|b| b.id == id).ok_or("No such building.")?;
    if world.buildings[i].site.is_some() {
        return finish_site_now(world, i, terrain);
    }
    if world.buildings[i].kind == BuildingKind::TrainingGround {
        let size = terrain.map_or(MAP_SIZE, |t| t.size);
        let trained = finish_training(world, i, size);
        if trained == 0 {
            return Err("Nobody trains here.".into());
        }
        let s = if trained == 1 { "" } else { "s" };
        return Ok(format!("{trained} trainee{s} finished training."));
    }
    Err("Nothing to finish here: it is no construction site or training ground.".into())
}

/// Gives a site everything it still needs: all its materials and all its work.
fn complete(world: &mut WorldState, i: usize) {
    let (materials, work) = (materials_of(&world.buildings[i]), work_of(&world.buildings[i]));
    if let Some(site) = world.buildings[i].site.as_mut() {
        site.delivered = materials;
        site.work = work;
    }
}

/// A line order building on a site: who builds it, of what, and the tiles left after this one.
struct Line {
    resident: usize,
    building: BuildingKind,
    material: Option<WallMaterial>,
    rest: Vec<(f64, f64)>,
}

fn finish_site_now(
    world: &mut WorldState,
    i: usize,
    terrain: Option<&TerrainMap>,
) -> Result<String, String> {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    let site_id = world.buildings[i].id.clone();
    // Who builds it: the first builder there gives the finished thing their realm, as the one who
    // puts the last in would; without one, the realm (or city) that laid it out.
    let builders: Vec<usize> = (0..world.residents.len())
        .filter(|&r| {
            building_part(world.residents[r].order.as_ref())
                .is_some_and(|p| p.site_id.as_deref() == Some(site_id.as_str()))
        })
        .collect();
    let (owner, city_id) = match builders.first() {
        Some(&r) => (world.residents[r].owner.clone(), world.residents[r].city_id.clone()),
        None => (world.buildings[i].realm_id.clone(), world.buildings[i].city_id.clone()),
    };
    let lines: Vec<Line> = builders
        .iter()
        .filter_map(|&r| match &world.residents[r].order {
            Some(o @ (ResidentOrder::RoadLine(l) | ResidentOrder::WallLine(l))) => Some(Line {
                resident: r,
                building: line_building(o)?,
                material: l.material,
                rest: l.tiles.iter().skip(1).copied().collect(),
            }),
            _ => None,
        })
        .collect();
    let kind = world.buildings[i].kind;
    complete(world, i);
    if !finish_site_by(world, i, owner.as_deref(), city_id.as_deref(), terrain) {
        return Err("It can't be finished: no free water next to it to float it on.".into());
    }
    let mut changed_cities = kind != BuildingKind::Road;
    let mut tiles = 0;
    for line in &lines {
        // The line is done: its builder no longer walks it.
        world.residents[line.resident].order = None;
        for &(x, y) in &line.rest {
            if let Some(built) = finish_line_tile(world, line, (x, y), terrain) {
                tiles += 1;
                changed_cities |= built != BuildingKind::Road;
            }
        }
    }
    if changed_cities {
        update_city_membership(world, size);
    }
    orders_follow_sites(world);
    Ok(if tiles == 0 {
        "Finished.".into()
    } else {
        let s = if tiles == 1 { "" } else { "s" };
        format!("Finished, and {tiles} more tile{s} of the line.")
    })
}

/// Builds one more tile of a line at once, as its builder would on reaching it: joins the
/// unfinished site of its kind there, or lays out a new one where it may go, and finishes it.
/// Answers what was built, or nothing where it can't go.
fn finish_line_tile(
    world: &mut WorldState,
    line: &Line,
    (x, y): (f64, f64),
    terrain: Option<&TerrainMap>,
) -> Option<BuildingKind> {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    let lookup = terrain.map(|t| t as &dyn TerrainLookup);
    let (tx, ty) = (x as i32, y as i32);
    let kind = line_kind_at(world, line.building, line.material, tx, ty);
    let joins = construction_index_at(world, tx, ty, kind).filter(|&i| {
        let h = &world.buildings[i];
        h.site.is_some()
            && h.kind == kind
            && is_stone(h.kind, h.material) == is_stone(kind, line.material)
    });
    let i = match joins {
        Some(i) => i,
        None => {
            if build_problem_for(world, tx, ty, kind, line.material, lookup).is_some() {
                return None;
            }
            let id = lay_out_site(world, line.resident, (x, y), kind, line.material, size);
            world.buildings.iter().position(|b| b.id == id)?
        }
    };
    complete(world, i);
    let r = &world.residents[line.resident];
    let (owner, city_id) = (r.owner.clone(), r.city_id.clone());
    finish_site_by(world, i, owner.as_deref(), city_id.as_deref(), terrain).then_some(kind)
}

/// Every trainee at the training ground `gi` trains on, tick by tick as at normal speed, until
/// they gain no more from its teacher, and stops. Answers how many trained.
fn finish_training(world: &mut WorldState, gi: usize, size: i32) -> usize {
    let ground = world.buildings[gi].clone();
    let trainees: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let r = &world.residents[i];
            matches!(&r.order, Some(ResidentOrder::Train(o)) if o.building_id == ground.id)
                && is_at((r.x as i32, r.y as i32), placed(&ground), size)
        })
        .collect();
    let lesson = teacher_at(&ground, &world.residents, size).and_then(|t| match &t.order {
        Some(ResidentOrder::Teach(o)) => Some((t.clone(), o.subject)),
        _ => None,
    });
    let tick = world.tick as f64;
    for &i in &trainees {
        if let Some((teacher, subject)) = &lesson {
            train_to_the_end(&mut world.residents[i], teacher, *subject, tick);
        }
        world.residents[i].order = None;
    }
    trainees.len()
}

fn train_to_the_end(
    r: &mut csp_shared::world::Resident,
    teacher: &csp_shared::world::Resident,
    subject: TrainingSubject,
    tick: f64,
) {
    for _ in 0..MOST_TRAINING_TICKS {
        let gain = training_gain(r, teacher, subject, tick);
        if gain <= 1e-12 {
            return;
        }
        learn(r, subject, gain);
    }
}

/// The creative actions as the server's creative route names them: none is an order kind or a
/// script call.
pub const CREATIVE_ACTIONS: [&str; 9] = [
    "giveGoods",
    "takeGoods",
    "finishNow",
    "addResident",
    "addHorse",
    "heal",
    "growUp",
    "kill",
    "moveResidents",
];

/// Who a creative Resident or horse joins: a city and its realm. A Player's city gives them to its
/// realm; an NPC city, trading post or the Trade Organization's HQ keeps them as its own (no
/// realm, that city), as its residents and horses are.
fn joining(world: &WorldState, city_id: &str) -> Result<(Option<String>, String), String> {
    let city = world.cities.iter().find(|c| c.id == city_id).ok_or("No such city.")?;
    Ok((city.realm_id.clone(), city.id.clone()))
}

/// The tile `(x, y)`, if it is on the map and passable.
fn standing_tile(terrain: &TerrainMap, x: f64, y: f64) -> Result<(f64, f64), String> {
    let (tx, ty) = (x.floor(), y.floor());
    let on_map = |v: f64| v.is_finite() && v >= 0.0 && v < f64::from(terrain.size);
    if !on_map(tx) || !on_map(ty) {
        return Err("That tile is off the map.".into());
    }
    if !is_passable_terrain(terrain_at(terrain, tx as i32, ty as i32)) {
        return Err("Nobody can stand on that tile.".into());
    }
    Ok((tx, ty))
}

/// What an admin picks for a new Resident: an age in game years, base stats and skills. What is
/// left out is drawn as for a starting city's resident (skills: none).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResidentPick {
    pub age: Option<f64>,
    pub stats: Option<StatRecord<f64>>,
    pub skills: IndexMap<SkillName, f64>,
}

/// Adds a Resident on the tile `(x, y)` to the city `city_id` and its realm (`CONTEXT.md`:
/// Creative mode): drawn as a starting city's resident is, then given what `pick` picks, with a
/// game-given name no living resident of that realm has. They join like a newcomer, standing idle
/// with nothing on them. Answers their id.
pub fn add_resident(
    world: &mut WorldState,
    terrain: &TerrainMap,
    city_id: &str,
    (x, y): (f64, f64),
    pick: &ResidentPick,
) -> Result<String, String> {
    let (owner, city_id) = joining(world, city_id)?;
    let (x, y) = standing_tile(terrain, x, y)?;
    if let Some(age) = pick.age {
        if !(age.is_finite() && (0.0..LIFESPAN_MIN).contains(&age)) {
            return Err(format!("Pick an age from 0 to under {LIFESPAN_MIN} game years."));
        }
    }
    if let Some(s) = &pick.stats {
        let all = [s.strength, s.endurance, s.agility, s.intellect];
        if !all.iter().all(|v| v.fract() == 0.0 && (1.0..=CREATIVE_STAT_MAX).contains(v)) {
            return Err(format!("Stats are whole numbers from 1 to {CREATIVE_STAT_MAX}."));
        }
    }
    for (&skill, &v) in &pick.skills {
        let most = skill_value(&SKILL_MAX, skill);
        if !(v.is_finite() && (0.0..=most).contains(&v)) {
            return Err(format!("{skill:?} goes from 0 to {most}."));
        }
    }
    let id = new_id("r", &mut world.next_id);
    let mut taken = resident_names_taken(world, owner.as_deref(), Some(&city_id));
    let mut rand = Mulberry32::new(f64::from(hash_str(&format!("{}:{id}", world.seed))));
    let tick = world.tick as f64;
    let place =
        NewResident { id: &id, owner: owner.as_deref(), city_id: Some(&city_id), x, y, tick };
    let mut r = new_resident(&mut || rand.next(), &place, Some(&mut taken));
    if let Some(age) = pick.age {
        r.born_at = tick - js_round(ticks_for_age(age));
    }
    if let Some(s) = &pick.stats {
        let stat = |base: f64| Stat { base, trained: 0.0 };
        r.stats = StatRecord {
            strength: stat(s.strength),
            endurance: stat(s.endurance),
            agility: stat(s.agility),
            intellect: stat(s.intellect),
        };
    }
    r.skills = pick.skills.iter().filter(|(_, v)| **v > 0.0).map(|(k, v)| (*k, *v)).collect();
    world.residents.push(r);
    Ok(id)
}

/// Adds a horse on the tile `(x, y)` to the city `city_id` and its realm (`CONTEXT.md`: Creative
/// mode): drawn as a new horse is, then given the `age` and `stats` picked; a name from the horse
/// pool, full hunger and health. A Player's horse belongs to its realm (no city), an NPC city's to
/// the city. Answers its id.
pub fn add_horse(
    world: &mut WorldState,
    terrain: &TerrainMap,
    city_id: &str,
    (x, y): (f64, f64),
    age: Option<f64>,
    stats: Option<HorseStats>,
) -> Result<String, String> {
    let (realm_id, city_id) = joining(world, city_id)?;
    let (x, y) = standing_tile(terrain, x, y)?;
    if let Some(age) = age {
        if !(age.is_finite() && (0.0..=CREATIVE_HORSE_AGE_MAX).contains(&age)) {
            return Err(format!(
                "Pick a horse's age from 0 to {CREATIVE_HORSE_AGE_MAX} game years."
            ));
        }
    }
    if let Some(s) = &stats {
        let all = [s.speed, s.strength, s.endurance];
        if !all.iter().all(|v| v.fract() == 0.0 && (1.0..=CREATIVE_STAT_MAX).contains(v)) {
            return Err(format!("Horse stats are whole numbers from 1 to {CREATIVE_STAT_MAX}."));
        }
    }
    let id = new_id("horse", &mut world.next_id);
    let mut rand = Mulberry32::new(f64::from(hash_str(&format!("{}:{id}", world.seed))));
    let tick = world.tick as f64;
    let city_id = if realm_id.is_some() { None } else { Some(city_id) };
    let fields = NewHorse { id: id.clone(), realm_id, city_id, x, y, tick };
    let mut h = new_horse(&mut || rand.next(), fields);
    if let Some(age) = age {
        h.born_at = tick - js_round(age * TICKS_PER_GAME_YEAR);
    }
    if let Some(s) = stats {
        h.stats = s;
    }
    world.horses.push(h);
    Ok(id)
}

fn resident_at(world: &WorldState, id: &str) -> Result<usize, String> {
    world.residents.iter().position(|r| r.id == id).ok_or_else(|| "No such resident.".into())
}

/// Heals the resident `id` (`CONTEXT.md`: Creative mode): their wounds close, and a Down resident
/// wakes and stands idle, at full health. Their hunger meter is left as it is: a starving one still
/// needs food.
pub fn heal(world: &mut WorldState, id: &str) -> Result<String, String> {
    let i = resident_at(world, id)?;
    let r = &mut world.residents[i];
    let down = r.down_until.is_some();
    if !down && r.health >= MAX_HEALTH {
        return Err(format!("{} is not hurt.", r.name));
    }
    r.health = MAX_HEALTH;
    r.down_until = None;
    let name = r.name.clone();
    if down {
        let what = RealmEventWhat::Woke {
            resident_id: r.id.clone(),
            name: name.clone(),
            by: "an admin".into(),
        };
        let owner = r.owner.clone();
        record_event(world, owner.as_deref(), what);
        return Ok(format!("{name} woke, healed."));
    }
    Ok(format!("{name} is healed."))
}

/// Grows the child `id` up now (`CONTEXT.md`: Creative mode), as if the years had passed: they are
/// `ADULT_AGE`, and their Player's realm log says they have grown up, as aging would.
pub fn grow_up(world: &mut WorldState, id: &str) -> Result<String, String> {
    let i = resident_at(world, id)?;
    let tick = world.tick as f64;
    let r = &mut world.residents[i];
    if can_work(r.born_at, tick) {
        return Err(format!("{} is grown already.", r.name));
    }
    r.born_at = tick - ticks_for_age(ADULT_AGE);
    let (owner, name) = (r.owner.clone(), r.name.clone());
    let what = RealmEventWhat::GrownUp { resident_id: r.id.clone(), name: name.clone() };
    record_event(world, owner.as_deref(), what);
    Ok(format!("{name} has grown up."))
}

/// Kills the resident `id` (`CONTEXT.md`: Creative mode) by a normal death, killed by nobody:
/// what they carry drops, their realm log says so, and a Leader's death follows the Leader death
/// rules (their heir takes over, or the realm ends).
pub fn kill(world: &mut WorldState, id: &str, size: i32) -> Result<String, String> {
    let i = resident_at(world, id)?;
    let name = world.residents[i].name.clone();
    let leader = world.realms.iter().any(|x| x.leader_id == id);
    let (_, ended) = die_all(world, &[id.to_string()], DeathCause::Killed, size, None);
    // A drifter on the way is gone with them, as the next tick would drop them.
    world.drifters.retain(|d| d.resident_id != id);
    Ok(match (leader, ended.is_empty()) {
        (false, _) => format!("{name} is dead."),
        (true, true) => format!("{name}, the Leader, is dead; the heir takes over."),
        (true, false) => format!("{name}, the Leader, is dead; the realm has ended."),
    })
}

/// Moves the residents `ids` (one, or a group) to the tile `(x, y)` at once (`CONTEXT.md`:
/// Creative mode, move): they stand there now, their order (the way they walked, the work they
/// did) dropped, what they carry kept. A rider's horse comes along where a horse may go; elsewhere
/// they get off and it stays. Whoever leaves a carriage, vessel or siege machine is off it and out
/// of its crew, and one up on a wall walk is on the ground.
///
/// The tile must be one a resident may stand on: land, or water only with a vessel there that
/// takes them all aboard (of their realm, with room); never a wall, which is reached only up on
/// its walk. All of them move, or none. Answers what was done, for the admin.
pub fn move_residents(
    world: &mut WorldState,
    terrain: &TerrainMap,
    ids: &[String],
    (x, y): (f64, f64),
) -> Result<String, String> {
    let mut moved: Vec<usize> = Vec::new();
    for id in ids {
        let i = resident_at(world, id)?;
        if !moved.contains(&i) {
            moved.push(i);
        }
    }
    if moved.is_empty() {
        return Err("Pick a resident to move.".into());
    }
    let (tx, ty) = (x.floor(), y.floor());
    let on_map = |v: f64| v.is_finite() && v >= 0.0 && v < f64::from(terrain.size);
    if !on_map(tx) || !on_map(ty) {
        return Err("That tile is off the map.".into());
    }
    let (ix, iy) = (tx as i32, ty as i32);
    let ground = terrain_at(terrain, ix, iy);
    // On water, the vessel there takes them aboard.
    let vessel = if is_water(ground) {
        let v = world
            .vessels
            .iter()
            .find(|v| (v.x as i32, v.y as i32) == (ix, iy))
            .ok_or("Nobody can stand on water without a vessel there.")?;
        let boarding: Vec<usize> = moved
            .iter()
            .copied()
            .filter(|&i| world.residents[i].aboard.as_deref() != Some(v.id.as_str()))
            .collect();
        let stranger = boarding.iter().find(|&&i| {
            let owner = world.residents[i].owner.as_deref();
            owner.is_none() || owner != v.realm_id.as_deref()
        });
        if let Some(&i) = stranger {
            return Err(format!("{} is not of the vessel's realm.", world.residents[i].name));
        }
        if vessel_room(world, v) + 1e-9 < boarding.len() as f64 * PASSENGER_WEIGHT {
            return Err("The vessel there has no room for them all.".into());
        }
        Some(v.id.clone())
    } else if !is_passable_terrain(ground) {
        return Err("Nobody can stand on that tile.".into());
    } else {
        let walls = wall_map(world, terrain);
        let wall = walls.tiles.get(&tile_index(terrain.size, ix, iy));
        if wall.is_some_and(|w| w.kind == WallKind::Wall) {
            return Err(
                "Nobody stands on a wall from the ground: it is reached up on its walk.".into()
            );
        }
        None
    };
    let horses_go = vessel.is_none() && carriage_can_go_to(world, terrain, ix, iy);
    for &i in &moved {
        let id = world.residents[i].id.clone();
        if world.residents[i].aboard != vessel {
            for v in &mut world.vessels {
                v.crew_ids.retain(|c| *c != id);
                if v.rower_id.as_deref() == Some(id.as_str()) {
                    v.rower_id = None;
                }
            }
        }
        for m in &mut world.siege_machines {
            m.crew_ids.retain(|c| *c != id);
        }
        let r = &mut world.residents[i];
        r.order = None;
        r.interrupted = None;
        r.up = None;
        r.aboard = vessel.clone();
        r.x = tx;
        r.y = ty;
        let ridden = if horses_go { r.riding.clone() } else { r.riding.take() };
        if let Some(h) = ridden.and_then(|h| world.horses.iter_mut().find(|x| x.id == h)) {
            h.x = tx;
            h.y = ty;
        }
    }
    let at = format!("({tx}, {ty})");
    Ok(match moved.as_slice() {
        [i] => format!("{} stands on {at}.", world.residents[*i].name),
        _ => format!("{} residents stand on {at}.", moved.len()),
    })
}

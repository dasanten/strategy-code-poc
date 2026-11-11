//! Survival (`apps/server/src/survival.ts`, `CONTEXT.md`: Hunger, Eating, Down, Reviving, Leader
//! death, Loot, Refilling): the hunger meter, eating what one carries, going Down and dying of
//! hunger, a Leader's death ending their realm, piles of what the dead carried, and refilling
//! from a storage, a workplace's pile or a carriage.
//!
//! Where the TypeScript keeps a resident object across a death, this keeps its id and finds it in
//! `world.residents` when it is needed; [`die`] removes it and hands back what was removed. What
//! the rules of other tickets do on a Leader's death is called through the hooks at the bottom of
//! the file, each marked with the ticket that ports it.

use std::collections::HashSet;

use csp_shared::balance::{
    DOWN_DAYS, FOOD_PER_DAY, HEAL_DAYS, HOME_FOOD_LOW, HUNGER_DAYS, MAP_SIZE, MAX_HEALTH,
    MAX_HUNGER, MEAL_UNITS, OUTPOST_REFILL_REACH, OWN_FOOD, STARVE_DAYS, WAKE_HEALTH,
};
use csp_shared::footprint::{covers, is_at, near_footprint};
use csp_shared::terrain::{ground_at, wrap_distance, TerrainMap};
use csp_shared::time::TICKS_PER_GAME_DAY;
use csp_shared::world::{
    Building, BuildingKind, DeathCause, Good, Realm, RealmEventWhat, Resident, ResidentOrder,
    SelfManagedCity, Stock, WorldState,
};

use crate::city_layout::pick_layout;
use crate::events::record_event;
use crate::queries::alliance::contract_of;
use crate::queries::army::{drivers_food, spare_food};
use crate::queries::building::building_pile_index;
use crate::queries::city::{building_realm, in_city_area, is_outpost_storage, town_hall_of};
use crate::queries::combat::in_contact;
use crate::queries::goods::{carried_food, units_that_fit};
use crate::queries::names::{held, held_in, placed};
use crate::queries::offers::free_stock;
use crate::queries::residents::{can_work, food_use};
use crate::queries::standing::TRADE_ORG;
use crate::queries::trade_org::trade_org_hq;
use crate::sight::InvariantViolation;
use crate::tick::Scratch;

/// How far one unit of food fills the hunger meter: a full meter holds `HUNGER_DAYS` of meals.
const FILL_PER_FOOD: f64 = MAX_HUNGER / (HUNGER_DAYS * FOOD_PER_DAY);

/// Ticks a resident lies Down before they die of hunger (`DOWN_TICKS`, `DOWN_DAYS`).
pub const DOWN_TICKS: f64 = DOWN_DAYS * TICKS_PER_GAME_DAY;

/// What survival did this tick (`SurvivalResult`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SurvivalResult {
    /// Residents who died this tick.
    pub died: Vec<Resident>,
    /// Realms that ended because their Leader died.
    pub ended: Vec<Realm>,
}

/// A resident's tile, as whole numbers.
fn tile_of(r: &Resident) -> (i32, i32) {
    (r.x as i32, r.y as i32)
}

/// One tick of survival (`stepSurvival`, `CONTEXT.md`: Hunger, Eating, Down, Leader death): the
/// hunger meter runs down (faster on hard terrain, slower with high Endurance; on a road as on
/// Plains); a resident eats a unit of food when there is room for it, only from what they carry,
/// also at home. An empty meter costs health; a meter with anything in it slowly gives health
/// back. A resident whose health hunger used up goes Down (`go_down`); Down, they don't eat and
/// lose no more health, and when their time is up they die of hunger and drop what they carried
/// in a pile. When a Leader dies, their realm ends; a Leader who is Down still leads. A meter
/// running empty, going Down and a death go in the Player's realm log.
pub fn step_survival(
    world: &mut WorldState,
    terrain: &TerrainMap,
    scratch: &mut Scratch,
) -> SurvivalResult {
    let drain = MAX_HUNGER / (HUNGER_DAYS * TICKS_PER_GAME_DAY);
    let starve = MAX_HEALTH / (STARVE_DAYS * TICKS_PER_GAME_DAY);
    let heal = MAX_HEALTH / (HEAL_DAYS * TICKS_PER_GAME_DAY);
    let tick = world.tick as f64;
    let roads = scratch.index(world, terrain.size).roads(world);
    let mut died = Vec::new();

    // `leaveArmies` (in `go_down`) only filters the armies, so positions in `residents` hold.
    for i in 0..world.residents.len() {
        let r = &mut world.residents[i];
        if let Some(until) = r.down_until {
            if tick >= until {
                died.push(r.id.clone());
            }
            continue;
        }
        let was_fed = r.hunger > 0.0;
        let (x, y) = tile_of(r);
        let ground = ground_at(terrain, &roads, x, y);
        r.hunger = (r.hunger - drain * food_use(r, ground, tick)).max(0.0);
        if r.hunger <= MAX_HUNGER - FILL_PER_FOOD && carried_food(r) >= 1.0 {
            take(&mut r.carried, Good::Food, 1.0);
            r.hunger = MAX_HUNGER.min(r.hunger + FILL_PER_FOOD);
        }
        let hungry = r.hunger <= 0.0 && was_fed;
        if r.hunger <= 0.0 {
            r.health = (r.health - starve).max(0.0);
        } else {
            r.health = MAX_HEALTH.min(r.health + heal);
        }
        let down = r.health <= 0.0;
        if hungry {
            let (owner, what) = (
                r.owner.clone(),
                RealmEventWhat::Hungry { resident_id: r.id.clone(), name: r.name.clone() },
            );
            record_event(world, owner.as_deref(), what);
        }
        if down {
            go_down(world, i);
        }
    }
    let (died, ended) = die_all(world, &died, DeathCause::Starved, terrain.size, None);
    SurvivalResult { died, ended }
}

/// Puts the resident at `i` whose health hunger used up Down (`goDown`, `CONTEXT.md`: Down) until
/// `DOWN_TICKS` from now: lying on their tile, so off any horse or carriage, their order, script
/// and queue end, a defence script and what it interrupted too, and they leave any army, taking
/// no orders. Their Player's realm log says so, with when they die.
pub fn go_down(world: &mut WorldState, i: usize) {
    let until = world.tick as f64 + DOWN_TICKS;
    let r = &mut world.residents[i];
    r.health = 0.0;
    r.down_until = Some(until);
    hold_still(r);
    r.riding = None;
    r.aboard = None;
    let (id, name, owner) = (r.id.clone(), r.name.clone(), r.owner.clone());
    leave_armies(world, &HashSet::from([id.clone()]));
    record_event(world, owner.as_deref(), RealmEventWhat::Down { resident_id: id, name, until });
}

/// Wakes the Down resident at `i` (`wake`, `CONTEXT.md`: Reviving) who has Food in their hands:
/// they eat a unit at once, so their hunger meter isn't empty, and stand idle at `WAKE_HEALTH`.
/// Their Player's realm log says so, with `by`, who fed them. Returns whether they woke.
pub fn wake(world: &mut WorldState, i: usize, by: &str) -> bool {
    let r = &mut world.residents[i];
    if r.down_until.is_none() || carried_food(r) < 1.0 {
        return false;
    }
    take(&mut r.carried, Good::Food, 1.0);
    r.hunger = MAX_HUNGER.min(r.hunger + FILL_PER_FOOD);
    r.health = WAKE_HEALTH;
    r.down_until = None;
    let what =
        RealmEventWhat::Woke { resident_id: r.id.clone(), name: r.name.clone(), by: by.into() };
    let owner = r.owner.clone();
    record_event(world, owner.as_deref(), what);
    true
}

/// Ends whatever a resident was doing: their order, script, queue and defence script
/// (`holdStill`).
fn hold_still(r: &mut Resident) {
    r.order = None;
    r.script = None;
    r.queue = None;
    r.interrupted = None;
    r.given_under_attack = None;
}

/// Down residents do nothing (`keepDownStill`, `CONTEXT.md`: Down): whatever the game's own
/// cities, armies or a fight gave them since they went Down ends before it turns into anything
/// they do.
pub fn keep_down_still(world: &mut WorldState) {
    for r in &mut world.residents {
        if r.down_until.is_some() {
            hold_still(r);
        }
    }
}

/// Invariant `down-do-nothing` (`CONTEXT.md`: Down): one who is Down has no order, script, queue
/// or defence script, rides no horse or carriage and is in no army; their health stays at 0; and
/// they die within `DOWN_TICKS` of going Down, not before the tick they are due.
pub fn down_do_nothing(world: &WorldState) -> Vec<InvariantViolation> {
    let in_army: HashSet<&str> =
        world.armies.iter().flat_map(|a| a.member_ids.iter().map(String::as_str)).collect();
    let tick = world.tick as f64;
    let mut out = Vec::new();
    for r in &world.residents {
        let Some(until) = r.down_until else { continue };
        let problems = [
            r.order.as_ref().map(|o| format!("has a {} order", order_kind(o))),
            r.script.is_some().then(|| "runs a script".to_string()),
            r.queue.is_some().then(|| "has a queue".to_string()),
            r.interrupted.is_some().then(|| "was interrupted by a defence script".to_string()),
            r.riding.is_some().then(|| "rides a horse".to_string()),
            r.aboard.is_some().then(|| "is aboard a carriage".to_string()),
            in_army.contains(r.id.as_str()).then(|| "is in an army".to_string()),
            (r.health != 0.0).then(|| format!("has health {}", js_number(r.health))),
            (!(until >= tick && until <= tick + DOWN_TICKS))
                .then(|| format!("is due to die at {}", js_number(until))),
        ];
        for p in problems.into_iter().flatten() {
            out.push(InvariantViolation {
                invariant: "down-do-nothing".into(),
                message: format!("resident {} is Down but {p}", r.id),
                entity_ids: vec![r.id.clone()],
            });
        }
    }
    out
}

/// Invariant `awake-alive` (`CONTEXT.md`: Reviving): a resident who woke in the tick just stepped
/// is no longer Down, has health above zero and a hunger meter that isn't empty.
pub fn awake_alive(world: &WorldState) -> Vec<InvariantViolation> {
    let woke: HashSet<&str> = world
        .events
        .iter()
        .filter_map(|e| match &e.what {
            RealmEventWhat::Woke { resident_id, .. } if e.tick + 1 >= world.tick => {
                Some(resident_id.as_str())
            }
            _ => None,
        })
        .collect();
    let mut out = Vec::new();
    for r in &world.residents {
        if !woke.contains(r.id.as_str()) {
            continue;
        }
        let problems = [
            r.down_until.is_some().then(|| "woke but is still Down".to_string()),
            (r.health <= 0.0).then(|| format!("woke with health {}", js_number(r.health))),
            (r.hunger <= 0.0).then(|| "woke with an empty hunger meter".to_string()),
        ];
        for p in problems.into_iter().flatten() {
            out.push(InvariantViolation {
                invariant: "awake-alive".into(),
                message: format!("resident {} {p}", r.id),
                entity_ids: vec![r.id.clone()],
            });
        }
    }
    out
}

/// A number as JavaScript writes it in a template string: whole numbers without a fraction.
fn js_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// An order's `kind`, as the TypeScript names it.
pub fn order_kind(o: &ResidentOrder) -> &'static str {
    match o {
        ResidentOrder::WalkTo(_) => "walkTo",
        ResidentOrder::Drive(_) => "drive",
        ResidentOrder::Haul(_) => "haul",
        ResidentOrder::PickUp(_) => "pickUp",
        ResidentOrder::Drop(_) => "drop",
        ResidentOrder::Store(_) => "store",
        ResidentOrder::Fetch(_) => "fetch",
        ResidentOrder::Build(_) => "build",
        ResidentOrder::TearDown(_) => "tearDown",
        ResidentOrder::WorkAt(_) => "workAt",
        ResidentOrder::Breed(_) => "breed",
        ResidentOrder::Attack(_) => "attack",
        ResidentOrder::Climb(_) => "climb",
        ResidentOrder::Teach(_) => "teach",
        ResidentOrder::Train(_) => "train",
        ResidentOrder::RoadLine(_) => "roadLine",
        ResidentOrder::WallLine(_) => "wallLine",
        ResidentOrder::Pay(_) => "pay",
        ResidentOrder::BuyCity(_) => "buyCity",
        ResidentOrder::Trade(_) => "trade",
        ResidentOrder::Swap(_) => "swap",
        ResidentOrder::BuyHorse(_) => "buyHorse",
        ResidentOrder::SellHorse(_) => "sellHorse",
        ResidentOrder::HandIn(_) => "handIn",
        ResidentOrder::BuyOff(_) => "buyOff",
        ResidentOrder::PayDebt(_) => "payDebt",
        ResidentOrder::AcceptOffer(_) => "acceptOffer",
        ResidentOrder::Relocate(_) => "relocate",
        ResidentOrder::Feed(_) => "feed",
    }
}

/// Who killed a resident, by their id (`killers`).
pub type Killers = dyn Fn(&str) -> Option<String>;

/// Residents die of `cause` (`dieAll`), each death going in their Player's realm log; a Leader's
/// death ends their realm. `killers` names who killed each of them, by resident id, when they were
/// killed. Returns the residents who died, as they were removed, and the realms that ended.
/// `size` is the map's.
pub fn die_all(
    world: &mut WorldState,
    died: &[String],
    cause: DeathCause,
    size: i32,
    killers: Option<&Killers>,
) -> (Vec<Resident>, Vec<Realm>) {
    if cause == DeathCause::Killed {
        let killed: Vec<Resident> =
            world.residents.iter().filter(|r| died.contains(&r.id)).cloned().collect();
        crate::directives::count_soldiers_killed(world, &killed);
    }
    // Every death is written down before any realm ends, so all of them reach the Player.
    for id in died {
        let Some(r) = world.residents.iter().find(|r| &r.id == id) else { continue };
        let leader = world.realms.iter().any(|x| &x.leader_id == id);
        let what = RealmEventWhat::Died {
            resident_id: id.clone(),
            name: r.name.clone(),
            cause,
            leader,
            by: killers.and_then(|k| k(id)),
        };
        let owner = r.owner.clone();
        record_event(world, owner.as_deref(), what);
    }
    let mut removed = Vec::new();
    let mut ended = Vec::new();
    for id in died {
        if let Some(r) = die(world, id) {
            removed.push(r);
        }
        if let Some(realm) = world.realms.iter().find(|x| &x.leader_id == id).cloned() {
            end_realm(world, &realm.id, size);
            ended.push(realm);
        }
    }
    (removed, ended)
}

/// Takes `units` of a good out of a stock, leaving no empty entry (`take`).
fn take(stock: &mut Stock, good: Good, units: f64) {
    let left = held(stock, good) - units;
    if left > 0.0 {
        stock.insert(good, left);
    } else {
        stock.shift_remove(&good);
    }
}

/// Removes a dead resident (`die`); what they carried drops in a pile on their tile
/// (`CONTEXT.md`: Loot). Their pair ends with them, and they leave any caravan (`CONTEXT.md`:
/// Caravan crew lost). Returns the resident removed, if they were there.
pub fn die(world: &mut WorldState, id: &str) -> Option<Resident> {
    let i = world.residents.iter().position(|x| x.id == id)?;
    let r = world.residents.remove(i);
    leave_caravans(world, &r.id);
    // The TypeScript leaves out the map's size here, so it is `MAP_SIZE` (ported as it is).
    drop_goods(world, r.x, r.y, &r.carried, MAP_SIZE);
    if let Some(pair) = &r.pair {
        if let Some(partner) = world.residents.iter_mut().find(|x| x.id == pair.partner_id) {
            if partner.pair.as_ref().is_some_and(|p| p.partner_id == r.id) {
                partner.pair = None;
            }
        }
    }
    Some(r)
}

/// Puts goods in the pile reached from a tile (`dropGoods`), starting one if there is none and
/// there is anything to drop: on a building's footprint its one pile (`CONTEXT.md`: A building's
/// pile), kept on its north-west tile (`pile_tile`). `size` is the map's; the TypeScript's default
/// is `MAP_SIZE`.
pub fn drop_goods(world: &mut WorldState, x: f64, y: f64, stock: &Stock, size: i32) {
    let goods: Vec<(Good, f64)> =
        stock.iter().filter(|(_, n)| **n > 0.0).map(|(g, n)| (*g, *n)).collect();
    if goods.is_empty() {
        return;
    }
    let (px, py) = crate::queries::building::pile_tile(world, x as i32, y as i32, size);
    let (px, py) = (f64::from(px), f64::from(py));
    let i = match world.piles.iter().position(|p| p.x == px && p.y == py) {
        Some(i) => i,
        None => {
            let id = format!("pile{}", world.next_id);
            world.next_id += 1;
            world.piles.push(csp_shared::world::Pile { id, x: px, y: py, goods: Stock::new() });
            world.piles.len() - 1
        }
    };
    let pile = &mut world.piles[i];
    for (good, n) in goods {
        *pile.goods.entry(good).or_insert(0.0) += n;
    }
}

/// Gathers the piles lying on a building's footprint into its one pile on its north-west tile
/// (`gatherPile`, `CONTEXT.md`: A building's pile), as when a site is laid out over goods on the
/// ground. `size` is the map's; the TypeScript's default is `MAP_SIZE`.
pub fn gather_pile(world: &mut WorldState, b: &Building, size: i32) {
    let lying = |p: &csp_shared::world::Pile| {
        covers(placed(b), p.x as i32, p.y as i32, size) && (p.x != b.x || p.y != b.y)
    };
    if !world.piles.iter().any(lying) {
        return;
    }
    let (gathered, kept): (Vec<_>, Vec<_>) = world.piles.drain(..).partition(|p| lying(p));
    world.piles = kept;
    for p in gathered {
        drop_goods(world, b.x, b.y, &p.goods, size);
    }
}

/// Leader death (`endRealm`, `CONTEXT.md`: Leader death, Self-managed city): the realm ends, its
/// mercenary contracts end, it leaves its alliance, and each of its cities becomes its own
/// self-managed city, an NPC city with the residents who live there. Homeless residents join the
/// nearest of those cities, and each horse and carriage goes to the one nearest it. With control
/// the Player's orders end: a resident away walks home (`walk_home_if_away`), and the others keep
/// only the orders an NPC city gives itself (`NPC_ORDER_KINDS`). With no city left to go to, the
/// realm's residents, horses and carriages belong to nobody. The Player's log says what became of
/// each city, and each city remembers them in good standing (`rememberFormerPlayer`). `size` is
/// the map's.
pub fn end_realm(world: &mut WorldState, realm_id: &str, size: i32) {
    end_contracts_on_leader_death(world, realm_id);
    lapse_demands_on_leader_death(world, realm_id);
    leave_on_leader_death(world, realm_id);
    let Some(user_id) = world.realms.iter().find(|r| r.id == realm_id).map(|r| r.user_id) else {
        return;
    };
    let cities: Vec<String> = world
        .cities
        .iter()
        .filter(|c| c.realm_id.as_deref() == Some(realm_id))
        .map(|c| c.id.clone())
        .collect();
    let seed = world.seed;
    for c in world.cities.iter_mut().filter(|c| cities.contains(&c.id)) {
        c.realm_id = None;
        c.layout = Some(pick_layout(seed, &c.id));
    }
    crate::standing::remember_former_player(world, &cities, user_id);
    for i in 0..world.residents.len() {
        if world.residents[i].owner.as_deref() != Some(realm_id) {
            continue;
        }
        world.residents[i].owner = None;
        if world.residents[i].city_id.is_none() {
            let at = tile_of(&world.residents[i]);
            world.residents[i].city_id = nearest_city(world, &cities, at, size);
        }
        let city = world.residents[i].city_id.clone().filter(|c| cities.contains(c));
        if let Some(city) = city {
            if walk_home_if_away(world, &city, i, size) {
                continue;
            }
        }
        let r = &mut world.residents[i];
        if r.order.as_ref().is_some_and(|o| !is_npc_order(o)) {
            r.order = None;
        }
    }
    for i in 0..world.horses.len() {
        if world.horses[i].realm_id.as_deref() != Some(realm_id) {
            continue;
        }
        let at = (world.horses[i].x as i32, world.horses[i].y as i32);
        world.horses[i].realm_id = None;
        world.horses[i].city_id = nearest_city(world, &cities, at, size);
    }
    for i in 0..world.carriages.len() {
        if world.carriages[i].realm_id.as_deref() != Some(realm_id) {
            continue;
        }
        let at = (world.carriages[i].x as i32, world.carriages[i].y as i32);
        world.carriages[i].realm_id = None;
        world.carriages[i].city_id = nearest_city(world, &cities, at, size);
    }
    // An outpost storage has no city to go with, so it belongs to nobody.
    for b in &mut world.buildings {
        if b.realm_id.as_deref() == Some(realm_id) {
            b.realm_id = None;
        }
    }
    // What became of each city goes in the Player's log while the realm is still there to name
    // them.
    let became: Vec<SelfManagedCity> = cities
        .iter()
        .filter_map(|id| {
            let c = world.cities.iter().find(|c| &c.id == id)?;
            let hall = town_hall_of(world, c)?;
            let residents =
                world.residents.iter().filter(|r| r.city_id.as_deref() == Some(id)).count();
            Some(SelfManagedCity {
                city_id: c.id.clone(),
                name: c.name.clone(),
                x: hall.x,
                y: hall.y,
                residents: residents as f64,
            })
        })
        .collect();
    record_event(world, Some(realm_id), RealmEventWhat::SelfManaged { cities: became });
    world.realms.retain(|x| x.id != realm_id);
}

/// Of `cities`, the id of the one whose town hall is nearest a spot (`nearestCity`); `None` when
/// there is none.
pub fn nearest_city(
    world: &WorldState,
    cities: &[String],
    at: (i32, i32),
    size: i32,
) -> Option<String> {
    let mut best: Option<(&str, f64)> = None;
    for id in cities {
        let Some(city) = world.cities.iter().find(|c| &c.id == id) else { continue };
        let Some(hall) = town_hall_of(world, city) else { continue };
        let d = wrap_distance(size, at, (hall.x as i32, hall.y as i32));
        if best.is_none_or(|(_, bd)| d < bd) {
            best = Some((&city.id, d));
        }
    }
    best.map(|(id, _)| id.to_string())
}

// The NPC behaviour module's; `npc_home` is still reached from here too.
use crate::npc_behaviour::walk_to;
pub use crate::npc_behaviour::{is_npc_order, npc_home};

/// Sends the resident at `i`, of an NPC city, who is away from it home (`walkHomeIfAway`,
/// `npcHome`): one outside its area (`CONTEXT.md`: City area) who is not working one of its
/// workplaces. Returns whether they were sent.
pub fn walk_home_if_away(world: &mut WorldState, city_id: &str, i: usize, size: i32) -> bool {
    let r = &world.residents[i];
    let workplaces =
        world.cities.iter().find(|c| c.id == city_id).and_then(|c| c.workplace_ids.as_ref());
    let at_work = match &r.order {
        Some(ResidentOrder::WorkAt(o)) => world.buildings.iter().any(|b| {
            b.id == o.building_id
                && (b.city_id.as_deref() == Some(city_id)
                    || workplaces.is_some_and(|w| w.contains(&b.id)))
        }),
        _ => false,
    };
    let Some(home) = npc_home(world, city_id) else { return false };
    let (x, y) = tile_of(r);
    if at_work || in_city_area(world, city_id, x, y, size) {
        return false;
    }
    let to = (home.x, home.y);
    walk_to(&mut world.residents[i], to);
    true
}

/// Whether a city is the resident's own home organization (`isHome`): a city of their realm, or
/// for a resident of an NPC city, who belongs to no realm, that city itself (`CONTEXT.md`:
/// Organization).
fn is_home(r: &Resident, city: &csp_shared::world::City) -> bool {
    match &r.owner {
        Some(owner) => city.realm_id.as_ref() == Some(owner),
        None => city.realm_id.is_none() && r.city_id.as_ref() == Some(&city.id),
    }
}

/// Food in a storage that isn't set aside for an offer (`freeStock(world, b).food ?? 0`).
fn free_food(world: &WorldState, b: &Building) -> f64 {
    held(&free_stock(world, &b.id, b.stock.as_ref()), Good::Food)
}

/// Where in `world.buildings` the finished storage that holds food of the city they stand in
/// stands, if the resident is at home (`homeStorage`, `CONTEXT.md`: At home): in the area of a
/// city of their own realm, or a resident of an NPC city in their city's area.
pub fn home_storage(world: &WorldState, r: &Resident, size: i32) -> Option<usize> {
    let (x, y) = tile_of(r);
    for home in &world.cities {
        if !is_home(r, home) || !in_city_area(world, &home.id, x, y, size) {
            continue;
        }
        let storage = world.buildings.iter().position(|b| {
            b.city_id.as_ref() == Some(&home.id)
                && b.kind == BuildingKind::Storage
                && b.site.is_none()
                && free_food(world, b) > 0.0
        });
        if storage.is_some() {
            return storage;
        }
    }
    None
}

/// For a mercenary the Trade Organization hired, standing in the Trade Org HQ's area, the HQ's
/// finished storage with Food (`hirersStorage`, `CONTEXT.md`: Trade Org army).
fn hirers_storage(world: &WorldState, r: &Resident, size: i32) -> Option<usize> {
    if contract_of(world, &r.id).is_none_or(|c| c.hirer_id != TRADE_ORG) {
        return None;
    }
    let hq = trade_org_hq(world)?;
    let (x, y) = tile_of(r);
    if !in_city_area(world, &hq.id, x, y, size) {
        return None;
    }
    world.buildings.iter().position(|b| {
        b.city_id.as_ref() == Some(&hq.id)
            && b.kind == BuildingKind::Storage
            && b.site.is_none()
            && held_in(b.stock.as_ref(), Good::Food) > 0.0
    })
}

/// For a resident of a realm, a finished outpost storage of their realm with Food within
/// `OUTPOST_REFILL_REACH` tiles (`outpostStorage`, `CONTEXT.md`: Refilling at an outpost storage).
fn outpost_storage(world: &WorldState, r: &Resident, size: i32) -> Option<usize> {
    let owner = r.owner.as_deref()?;
    world.buildings.iter().position(|b| {
        is_outpost_storage(b)
            && free_food(world, b) > 0.0
            && building_realm(world, b) == Some(owner)
            && near_footprint(placed(b), tile_of(r), OUTPOST_REFILL_REACH as i32, size)
    })
}

/// Whose goods a meal is taken from (the TypeScript's `stock` of a `RefillSource`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Holder {
    /// A building's stock, by its place in `world.buildings`.
    Building(usize),
    /// A pile's goods, by its place in `world.piles`.
    Pile(usize),
    /// A carriage's load, by its place in `world.carriages`.
    Carriage(usize),
}

/// Goods a resident may take a meal from, and how many units of Food of them they may take
/// (`RefillSource`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RefillSource {
    pub holder: Holder,
    pub food: f64,
}

/// The goods a holder holds.
fn goods_of(world: &mut WorldState, holder: Holder) -> &mut Stock {
    match holder {
        Holder::Building(i) => world.buildings[i].stock.get_or_insert_with(Stock::new),
        Holder::Pile(i) => &mut world.piles[i].goods,
        Holder::Carriage(i) => &mut world.carriages[i].load,
    }
}

/// A stock to refill from when it has Food: all of it may be taken (`whole`).
fn whole(holder: Holder, stock: &Stock) -> Option<RefillSource> {
    let food = held(stock, Good::Food);
    (food > 0.0).then_some(RefillSource { holder, food })
}

/// Where a resident running low on food takes a meal from, if anywhere (`refillSource`,
/// `CONTEXT.md`: Refilling): at home, their city's storage (a mercenary of the Trade Org's, the
/// HQ's); near an outpost storage of their realm, that storage; working at a workplace, or
/// teaching or training at a training ground, the Food in its pile, else on a carriage standing
/// at it; on a caravan's crew, its carriage close by (`caravan_food`); in a Trade Org punishment
/// or driving for it, its supply wagon close by (`wagon_food`); driving a carriage of their realm,
/// that carriage, but not the horse's share of what a haul route keeps on board (`drivers_food`);
/// anyone of a realm (in an army, a passenger, a driver whose drive is over, someone beside a
/// parked carriage), a carriage of their realm on or next to their tile, but not the Food a haul
/// route keeps on board (`spare_food`). Elsewhere nowhere, and
/// nowhere for a resident who is Down (`CONTEXT.md`: Down), who does nothing.
pub fn refill_source(world: &WorldState, r: &Resident, size: i32) -> Option<RefillSource> {
    if r.down_until.is_some() {
        return None;
    }
    let home = home_storage(world, r, size)
        .or_else(|| hirers_storage(world, r, size))
        .or_else(|| outpost_storage(world, r, size));
    // What is set aside for an offer stays there (`CONTEXT.md`: Offer).
    if let Some(i) = home {
        let food = free_food(world, &world.buildings[i]);
        return Some(RefillSource { holder: Holder::Building(i), food });
    }
    // Teaching and training refill at the training ground as at a workplace (`CONTEXT.md`:
    // Training).
    let place_id = match &r.order {
        Some(ResidentOrder::WorkAt(o)) if r.x == o.at.x && r.y == o.at.y => Some(&o.building_id),
        Some(ResidentOrder::Teach(o)) => Some(&o.building_id),
        Some(ResidentOrder::Train(o)) => Some(&o.building_id),
        _ => None,
    };
    let place = place_id.and_then(|id| world.buildings.iter().find(|b| &b.id == id));
    if let Some(place) = place {
        if place.site.is_none() && is_at(tile_of(r), placed(place), size) {
            if let Some(i) = building_pile_index(world, place) {
                if held(&world.piles[i].goods, Good::Food) > 0.0 {
                    return whole(Holder::Pile(i), &world.piles[i].goods);
                }
            }
            let here = world.carriages.iter().position(|k| {
                is_at((k.x as i32, k.y as i32), placed(place), size)
                    && held(&k.load, Good::Food) > 0.0
            });
            if let Some(i) = here {
                return whole(Holder::Carriage(i), &world.carriages[i].load);
            }
        }
    }
    if let Some(i) = caravan_food(world, r, size).or_else(|| wagon_food(world, r, size)) {
        return whole(Holder::Carriage(i), &world.carriages[i].load);
    }
    let owner = r.owner.as_deref()?;
    if let Some((i, food)) = drivers_food(world, r) {
        if world.carriages[i].realm_id.as_deref() == Some(owner) && food > 0.0 {
            return Some(RefillSource { holder: Holder::Carriage(i), food });
        }
    }
    for (i, k) in world.carriages.iter().enumerate() {
        if k.realm_id.as_deref() != Some(owner)
            || !in_contact(size, (k.x as i32, k.y as i32), tile_of(r))
        {
            continue;
        }
        let food = spare_food(world, k);
        if food > 0.0 {
            return Some(RefillSource { holder: Holder::Carriage(i), food });
        }
    }
    None
}

/// How much Food a resident refills up to where they stand (`refillTarget`, `CONTEXT.md`:
/// Refilling at home, Child): a child in their own city's area, with Food in its storage, to their
/// own food (`OWN_FOOD`), so they leave the city with food on them; everyone else, and a child
/// anywhere else, until they no longer run low (`HOME_FOOD_LOW`).
pub fn refill_target(world: &WorldState, r: &Resident, size: i32) -> f64 {
    if !can_work(r.born_at, world.tick as f64) && home_storage(world, r, size).is_some() {
        OWN_FOOD
    } else {
        HOME_FOOD_LOW
    }
}

/// Refilling (`stepRefill`, `CONTEXT.md`: Refilling at home, Refilling at an outpost storage,
/// Refilling at a workplace, Refilling from a carriage): a resident who carries less food than
/// their `refill_target` takes meals (`MEAL_UNITS` each) into their hands from their
/// `refill_source`, without an order, until they reach it, there is none left, or no more fits.
/// Residents anywhere else get nothing. They still eat only what they carry.
pub fn step_refill(world: &mut WorldState, size: i32) {
    let mut from_pile = false;
    let tick = world.tick as f64;
    for i in 0..world.residents.len() {
        let target = refill_target(world, &world.residents[i], size);
        while carried_food(&world.residents[i]) < target {
            let r = &world.residents[i];
            let source = refill_source(world, r, size);
            let fits = units_that_fit(r, Good::Food, tick);
            let units = MEAL_UNITS.min(source.map_or(0.0, |s| s.food)).min(fits);
            let Some(source) = source else { break };
            if units <= 0.0 {
                break;
            }
            take(goods_of(world, source.holder), Good::Food, units);
            *world.residents[i].carried.entry(Good::Food).or_insert(0.0) += units;
            from_pile |= matches!(source.holder, Holder::Pile(_));
        }
    }
    if from_pile {
        world.piles.retain(|p| p.goods.values().any(|n| *n > 0.0));
    }
}

// ------------------------------------------------------------------------------------------------
// What other tickets' rules do here, until they are ported.
// ------------------------------------------------------------------------------------------------

pub use crate::armies::leave_armies;

/// A dead resident leaves any caravan or wandering trader (`leaveCaravans`, in `caravans.rs`).
fn leave_caravans(world: &mut WorldState, resident_id: &str) {
    crate::caravans::leave_caravans(world, resident_id);
}

/// For a resident of no realm on a caravan's or trader's crew, its carriage close by with Food
/// (`caravanFood`, in `caravans.rs`).
fn caravan_food(world: &WorldState, r: &Resident, size: i32) -> Option<usize> {
    crate::caravans::caravan_food(world, r, size)
}

/// For a resident of no realm driving a supply wagon or in its punishment, the wagon close by
/// with Food (`wagonFood` of `supply-wagons.ts`).
fn wagon_food(world: &WorldState, r: &Resident, size: i32) -> Option<usize> {
    let ri = world.residents.iter().position(|x| x.id == r.id)?;
    crate::supply_wagons::wagon_food(world, ri, size)
}

use crate::alliances::leave_on_leader_death;
use crate::contracts::end_contracts_on_leader_death;
use crate::demands::lapse_demands_on_leader_death;

#[cfg(test)]
mod self_managed_tests;
#[cfg(test)]
mod tests;

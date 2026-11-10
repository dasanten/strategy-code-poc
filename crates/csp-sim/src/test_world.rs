//! What the conflict tests share, as the TypeScript tests' `setup` helpers and `test-terrain.ts`
//! give it: a plains world, residents with fixed stats, cities, and a step that runs the conflict
//! phases in `stepRest`'s order. Test-only.

use csp_shared::balance::{MAX_HEALTH, MAX_HUNGER};
use csp_shared::world::{
    Building, BuildingKind, City, CityLayout, Realm, Resident, Stat, StatRecord, TradeOrgCity,
    WorldState,
};

use crate::armies::step_armies;
use crate::capture::step_captures;
use crate::combat::{request_strikes, resolve_strikes, CombatResult};
use crate::crimes::step_crimes;
use crate::defence::NoAlarms;
use crate::persuasion::step_persuasion;
use crate::standing::step_standing;

/// An empty world as `createWorld` makes one, seed 1, without the resource nodes, which no
/// conflict rule looks at (`create_world` places them).
pub fn empty_world() -> WorldState {
    serde_json::from_value(serde_json::json!({
        "tick": 0, "seed": 1, "nextId": 1, "residents": [], "nodes": [], "realms": [], "cities": [],
        "buildings": [], "horses": [], "carriages": [], "piles": [], "events": [], "alliances": [],
        "armies": [], "crimes": [], "standings": [], "contracts": [], "demands": [],
        "joinRequests": [], "caravans": [], "traders": [], "deliveries": [], "transfers": [],
        "offers": [], "routeRobberies": {}, "punishments": [], "supplyWagons": [], "directives": [],
        "debts": [], "lastSeen": {}, "scriptViewChanges": 1, "horseOffersClaimed": [],
        "waypoints": {}, "cityPlans": {}, "workplaceSettings": {}
    }))
    .expect("an empty world")
}

/// A grown resident at (x, y) with every stat 10 and no Agility, so they never dodge; named by
/// their id.
pub fn resident(world: &mut WorldState, id: &str, owner: Option<&str>, x: f64, y: f64) -> usize {
    let stat = |base: f64| Stat { base, trained: 0.0 };
    world.residents.push(Resident {
        id: id.into(),
        name: id.into(),
        game_name: None,
        owner: owner.map(str::to_string),
        city_id: None,
        x,
        y,
        stats: StatRecord {
            strength: stat(10.0),
            endurance: stat(10.0),
            agility: stat(0.0),
            intellect: stat(10.0),
        },
        skills: Default::default(),
        health: MAX_HEALTH,
        hunger: MAX_HUNGER,
        born_at: -20.0 * 24.0 * 3600.0,
        lifespan: 60.0,
        carried: Default::default(),
        order: None,
        order_ended: None,
        struck: None,
        script: None,
        interrupted: None,
        given_under_attack: None,
        defence_script_id: None,
        alarm_script_id: None,
        script_params: None,
        script_log: None,
        queue: None,
        pair: None,
        carrying: None,
        riding: None,
        aboard: None,
        down_until: None,
    });
    world.residents.len() - 1
}

/// A realm of the Player `user_id`, led by `leader_id`.
pub fn realm(world: &mut WorldState, id: &str, user_id: u64, leader_id: &str) {
    world.realms.push(Realm {
        id: id.into(),
        user_id,
        leader_id: leader_id.into(),
        name: None,
        demands_sent_at: None,
    });
}

/// A building of `kind` at (x, y) of `city_id`.
pub fn building(
    world: &mut WorldState,
    id: &str,
    kind: BuildingKind,
    city_id: Option<&str>,
    x: f64,
    y: f64,
) -> usize {
    world.buildings.push(Building {
        id: id.into(),
        kind,
        city_id: city_id.map(str::to_string),
        realm_id: None,
        x,
        y,
        stock: None,
        site: None,
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
    });
    world.buildings.len() - 1
}

/// A city with only its town hall at (x, y) (`addCity` of `test-terrain.ts`): its area is the
/// tiles around the hall. The hall's id is `${id}-hall`.
pub fn add_city(
    world: &mut WorldState,
    id: &str,
    realm_id: Option<&str>,
    x: f64,
    y: f64,
    trade_org: Option<TradeOrgCity>,
) {
    let hall = format!("{id}-hall");
    building(world, &hall, BuildingKind::TownHall, Some(id), x, y);
    world.cities.push(City {
        id: id.into(),
        name: "Ashford".into(),
        game_name: None,
        realm_id: realm_id.map(str::to_string),
        town_hall_id: hall,
        trade_org,
        workplace_ids: None,
        scouted: None,
        former_player: None,
        occupation: None,
        outsiders: None,
        alarmed_attackers: None,
        layout: (realm_id.is_none() && trade_org.is_none()).then_some(CityLayout::Grid),
    });
}

/// The resident of an id.
pub fn live<'w>(world: &'w WorldState, id: &str) -> Option<&'w Resident> {
    world.residents.iter().find(|r| r.id == id)
}

/// The resident of an id, to change.
pub fn live_mut<'w>(world: &'w mut WorldState, id: &str) -> &'w mut Resident {
    world.residents.iter_mut().find(|r| r.id == id).expect("a resident of that id")
}

/// One tick of the conflict phases, in `stepRest`'s order, residents kept fed: strikes, the tick
/// turning, captures, crimes, standing, persuasion, armies. Nobody walks and no script runs.
pub fn step(world: &mut WorldState, size: i32) -> CombatResult {
    for r in &mut world.residents {
        r.hunger = 100.0;
    }
    let strikes = request_strikes(world, size);
    let result = resolve_strikes(world, &strikes, size, &mut NoAlarms, &mut Default::default());
    world.tick += 1;
    step_captures(world, size, None, &mut NoAlarms);
    step_crimes(world, size);
    step_standing(world);
    step_persuasion(world, size);
    step_armies(world, size);
    result
}

/// Steps `ticks` times.
pub fn run(world: &mut WorldState, size: i32, ticks: usize) {
    for _ in 0..ticks {
        step(world, size);
    }
}

/// Steps until resident `id`'s health falls, at most `limit` ticks (`untilHit`); the ticks taken.
pub fn until_hit(world: &mut WorldState, size: i32, id: &str, limit: usize) -> Option<usize> {
    let before = live(world, id).expect("a resident of that id").health;
    for t in 1..=limit {
        step(world, size);
        match live(world, id) {
            None => return Some(t),
            Some(r) if r.health < before - 0.5 => return Some(t),
            _ => {}
        }
    }
    None
}

/// `cityTerrain()` of `test-terrain.ts`: the seed-1 map of 1536 tiles, made once.
pub fn city_terrain() -> &'static csp_shared::terrain::TerrainMap {
    static TERRAIN: std::sync::OnceLock<csp_shared::terrain::TerrainMap> =
        std::sync::OnceLock::new();
    TERRAIN.get_or_init(|| crate::terrain_gen::generate_terrain(1, 1536))
}

/// `worldWithCity()`: a fresh world on `cityTerrain` where Player 1 has founded their city.
pub fn world_with_city() -> WorldState {
    let terrain = city_terrain();
    let mut world = crate::world::create_world(terrain, 1);
    crate::starting_city::found_starting_city(&mut world, terrain, 1, None);
    world
}

//! The tear-down order (`apps/server/src/teardown.ts`, `CONTEXT.md`: Tearing down): work at
//! taking down the building or construction site on the resident's tile, whoever's it is.

use csp_shared::balance::MAP_SIZE;
use csp_shared::footprint::is_at;
use csp_shared::terrain::{terrain_at, TerrainMap};
use csp_shared::world::{
    Building, OrderRequest, ResidentOrder, SkillName, TearDownOrder, Tile, WorldState,
};

use crate::order_sender::{commands, realm_of, OrderSender};
use crate::queries::balance::{build_work, construction_learned, skill_of};
use crate::queries::building::{
    site_work_of, strands_on_mountain, teardown_left, teardown_returns, teardown_work,
};
use crate::queries::building::{tear_down_problem, CARRYING_A_CHILD};
use crate::queries::names::placed;
use crate::queries::residents::can_work;
use crate::queue::field_str as str_field;
use crate::stand_ins::{commit_tear_down_crime, dissolve_city, update_city_membership};
use crate::survival::drop_goods;
use crate::tick::Scratch;

/// An action a resident with a tear-down order requests: a tick's work (`TearDownAction`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TearDownAction {
    pub resident_id: String,
}

/// A building or site that came down, and who put in the last work (`Felled`).
#[derive(Debug, Clone, PartialEq)]
pub struct Felled {
    pub resident_id: String,
    pub building: Building,
}

/// Requests this tick's tear-down work (`requestTearingDown`).
pub fn request_tearing_down(world: &WorldState) -> Vec<TearDownAction> {
    world
        .residents
        .iter()
        .filter(|r| matches!(r.order, Some(ResidentOrder::TearDown(_))))
        .map(|r| TearDownAction { resident_id: r.id.clone() })
        .collect()
}

/// Resolves tear-down work (ADR 0002), one action after another (`resolveTearingDown`). A
/// resident who has left the tile stops. Work goes into the building on the tile and teaches
/// Construction; once enough is in, the building or site is gone, its returned materials lie on
/// the tile, and everyone's build or tear-down order on it is done. Tearing down a town hall
/// dissolves its city. Taking down another Organization's building is a crime by whoever puts in
/// the last work. Returns what came down.
pub fn resolve_tearing_down(
    world: &mut WorldState,
    actions: &[TearDownAction],
    terrain: Option<&TerrainMap>,
    scratch: &mut Scratch,
) -> Vec<Felled> {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    let tick = world.tick as f64;
    let mut felled = Vec::new();
    for a in actions {
        let Some(ri) = world.residents.iter().position(|x| x.id == a.resident_id) else {
            continue;
        };
        let r = &world.residents[ri];
        let Some(ResidentOrder::TearDown(o)) = &r.order else { continue };
        let (rx, ry) = (r.x as i32, r.y as i32);
        let bi = world.buildings.iter().position(|x| x.id == o.building_id);
        let stays = (rx, ry) == (o.at.x as i32, o.at.y as i32);
        let Some(bi) = bi.filter(|&i| stays && is_at((rx, ry), placed(&world.buildings[i]), size))
        else {
            world.residents[ri].order = None;
            continue;
        };
        // A carriage or ridden horse on the mountain road: the work waits for them to leave.
        if terrain.is_some_and(|t| strands_on_mountain(world, &world.buildings[bi], t)) {
            continue;
        }
        if teardown_left(&world.buildings[bi]) > 0.0 {
            let b = &world.buildings[bi];
            let under = terrain.map(|t| terrain_at(t, b.x as i32, b.y as i32));
            let work = site_work_of(build_work(r, tick), b.kind, under);
            let total = teardown_work(b).min(b.teardown.unwrap_or(0.0) + work);
            let learned = construction_learned(r, tick);
            let had = skill_of(r, SkillName::Construction);
            world.buildings[bi].teardown = Some(total);
            world.residents[ri].skills.insert(SkillName::Construction, had + learned);
        }
        if teardown_left(&world.buildings[bi]) == 0.0 {
            let resident_id = world.residents[ri].id.clone();
            let b = world.buildings[bi].clone();
            commit_tear_down_crime(world, &resident_id, &b, size);
            world.buildings.retain(|x| x.id != b.id);
            let returned = teardown_returns(&b);
            drop_goods(world, b.x, b.y, &returned, size);
            scratch.made.note(&returned);
            // What a stable kept for its horses stays on the tile too.
            if let Some(stock) = &b.stock {
                drop_goods(world, b.x, b.y, stock, size);
            }
            if let Some(city) = world.cities.iter().find(|c| c.town_hall_id == b.id) {
                let city_id = city.id.clone();
                dissolve_city(world, &city_id);
            }
            felled.push(Felled { resident_id, building: b });
        }
    }
    if !felled.is_empty() {
        update_city_membership(world, size);
    }
    let standing: std::collections::HashSet<String> =
        world.buildings.iter().map(|b| b.id.clone()).collect();
    for r in &mut world.residents {
        let ends = match &r.order {
            Some(ResidentOrder::TearDown(o)) => !standing.contains(&o.building_id),
            Some(ResidentOrder::Build(o)) => {
                o.site_id.as_ref().is_some_and(|s| !standing.contains(s))
            }
            _ => false,
        };
        if ends {
            r.order = None;
        }
    }
    felled
}

/// Checks a tear-down order (`tearDown.validate`): one of the Player's adult residents works at
/// taking down the building or construction site on their tile, whoever's it is.
pub fn validate_tear_down(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    let id = str_field(order, "residentId");
    let r = world.residents.iter().find(|x| Some(x.id.as_str()) == id);
    let realm = realm_of(world, sender.user_id);
    let (Some(realm), Some(r)) = (realm, r) else {
        return Some("not one of your residents".into());
    };
    if !commands(world, &realm.id, Some(r)) {
        return Some("not one of your residents".into());
    }
    if !can_work(r.born_at, world.tick as f64) {
        return Some("children can’t tear down buildings".into());
    }
    if r.carrying.is_some() {
        return Some(CARRYING_A_CHILD.into());
    }
    let Some(building_id) = str_field(order, "buildingId") else {
        return Some("which building?".into());
    };
    tear_down_problem(world, r.x as i32, r.y as i32, building_id, terrain)
}

/// Gives the resident the tear-down order (`tearDown.apply`); the work happens in later ticks.
pub fn apply_tear_down(world: &mut WorldState, order: &OrderRequest) {
    let Some(building_id) = str_field(order, "buildingId") else { return };
    let id = str_field(order, "residentId");
    if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
        r.order = Some(ResidentOrder::TearDown(TearDownOrder {
            building_id: building_id.to_string(),
            at: Tile { x: r.x, y: r.y },
        }));
    }
}

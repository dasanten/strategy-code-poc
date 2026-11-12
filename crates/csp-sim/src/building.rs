//! The build order and its sites (`apps/server/src/building.ts`, `CONTEXT.md`: Building,
//! Construction site): laying out a construction site, putting work into it, and what a finished
//! one becomes. Road and wall lines build their tiles through here too (`road_line`).

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::{terrain_at, TerrainMap};
use csp_shared::world::{
    BuildOrder, Building, BuildingKind, Carriage, ConstructionSite, LinePhase, OrderRequest,
    Resident, ResidentOrder, SkillName, Stock, Tile, Vessel, VesselKind, WorldState,
};

use crate::cities::update_city_membership;
use crate::order_sender::{ordered_resident, OrderSender};
use crate::queries::balance::{build_work, construction_learned, skill_of};
use crate::queries::building::build_at_problem;
use crate::queries::building::{
    build_problem, build_work_of, construction_index_at, line_building, line_order_mut,
    materials_needed, max_workers, site_work_of, work_needed, TerrainLookup, ON_PLAINS,
};
use crate::queries::names::{kind_of, placed};
use crate::queries::vessels::launch_tile;
use crate::queue::field_str as str_field;
use crate::random::new_id;
use crate::survival::gather_pile;

/// Founds a city around the finished town hall `town_hall_id` (`foundCity` of `cities.ts`).
fn found_city(world: &mut WorldState, town_hall_id: &str, realm_id: Option<&str>) {
    if let Some(hall) = world.buildings.iter().position(|b| b.id == town_hall_id) {
        crate::cities::found_city(world, hall, realm_id);
    }
}

/// What an action asks of a construction site (`BuildAction.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildActionKind {
    /// Lay out the site from the resident's tile, or join the one there.
    LayOut,
    /// Put a tick's work into it.
    Work,
}

/// An action a resident with a build order requests (`BuildAction`); the world checks and
/// resolves it at the end of the tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildAction {
    pub kind: BuildActionKind,
    pub resident_id: String,
}

/// What a resident is building, and where (`buildingPart`): a build order, or a line order that
/// is building on its next tile.
#[derive(Debug, Clone, PartialEq)]
pub struct BuildingPart {
    pub building: BuildingKind,
    pub at: (i32, i32),
    pub site_id: Option<String>,
}

/// What a resident is building, and where (`buildingPart`). Nothing otherwise.
pub fn building_part(o: Option<&ResidentOrder>) -> Option<BuildingPart> {
    match o? {
        ResidentOrder::Build(b) => Some(BuildingPart {
            building: b.building,
            at: (b.at.x as i32, b.at.y as i32),
            site_id: b.site_id.clone(),
        }),
        line @ (ResidentOrder::RoadLine(l) | ResidentOrder::WallLine(l))
            if l.phase == LinePhase::Building =>
        {
            Some(BuildingPart {
                building: line_building(line)?,
                at: (l.tiles[0].0 as i32, l.tiles[0].1 as i32),
                site_id: l.site_id.clone(),
            })
        }
        _ => None,
    }
}

/// Sets the site a build or line order works on.
fn set_site_id(o: &mut Option<ResidentOrder>, id: String) {
    match o {
        Some(ResidentOrder::Build(b)) => b.site_id = Some(id),
        Some(ResidentOrder::RoadLine(l) | ResidentOrder::WallLine(l)) => l.site_id = Some(id),
        _ => {}
    }
}

/// A line order goes on to its next tile, walking there; after the last it is done. Any other
/// order is done (`nextTile`).
pub fn next_tile(r: &mut Resident) {
    match line_order_mut(r.order.as_mut()) {
        Some(o) if o.tiles.len() > 1 => {
            o.tiles.remove(0);
            o.phase = LinePhase::Walking;
            o.path = None;
            o.progress = 0.0;
            o.site_id = None;
        }
        _ => r.order = None,
    }
}

/// The city a site is laid out for (`laidOutFor`, `CONTEXT.md`: Farm, Haven): a farm, stable or
/// haven belongs to the city of the resident who lays it out, while that city exists, so taking
/// from a haven's storage is judged as at any storage.
fn laid_out_for(world: &WorldState, r: &Resident, kind: BuildingKind) -> Option<String> {
    if !ON_PLAINS.contains(&kind) && kind != BuildingKind::Haven {
        return None;
    }
    let city_id = r.city_id.as_ref()?;
    world.cities.iter().any(|c| &c.id == city_id).then(|| city_id.clone())
}

/// A workplace other than a farm that a resident of an NPC city lays out is one of that city's
/// workplaces (`ownWorkplace`, `City.workplaceIds`).
fn own_workplace(world: &mut WorldState, r: &Resident, kind: BuildingKind, id: &str) {
    if max_workers(kind).is_none() || ON_PLAINS.contains(&kind) {
        return;
    }
    let Some(city) = world.cities.iter_mut().find(|c| Some(&c.id) == r.city_id.as_ref()) else {
        return;
    };
    if city.realm_id.is_some() || r.owner.is_some() {
        return;
    }
    city.workplace_ids.get_or_insert_with(Vec::new).push(id.to_string());
}

/// Makes the construction site at `site` in `world.buildings` the building once it has all its
/// materials and work (`finishSite`); `r` is the resident who put the last of them in. Returns
/// whether it was finished; the caller brings city membership up to date. A boat site needs the
/// map to float its boat: without it, or with no free water near, it waits finished but unlaunched
/// until the next time someone works or delivers there with the map at hand.
pub fn finish_site(
    world: &mut WorldState,
    site: usize,
    r: &Resident,
    terrain: Option<&TerrainMap>,
) -> bool {
    let b = &world.buildings[site];
    if b.site.is_none() || work_needed(b) > 0.0 || !materials_needed(b).is_empty() {
        return false;
    }
    let vessel = match b.kind {
        BuildingKind::Boat => Some(VesselKind::Boat),
        BuildingKind::Ship => Some(VesselKind::Ship),
        _ => None,
    };
    if let Some(kind) = vessel {
        // `CONTEXT.md`: Building a boat, Building a ship: the site is gone, and an empty vessel of
        // the finisher's realm floats on the nearest free water tile next to it (Sea for a ship).
        let Some((x, y)) =
            terrain.and_then(|t| launch_tile(world, t, b.x as i32, b.y as i32, kind))
        else {
            return false;
        };
        world.buildings.remove(site);
        let prefix = if kind == VesselKind::Ship { "ship" } else { "boat" };
        let id = new_id(prefix, &mut world.next_id);
        world.vessels.push(Vessel {
            id,
            kind,
            realm_id: r.owner.clone(),
            x: f64::from(x),
            y: f64::from(y),
            load: Stock::new(),
            rower_id: None,
            crew_ids: Vec::new(),
        });
        return true;
    }
    if b.kind == BuildingKind::Carriage {
        let (x, y) = (b.x, b.y);
        world.buildings.remove(site);
        let id = new_id("carriage", &mut world.next_id);
        world.carriages.push(Carriage {
            id,
            realm_id: r.owner.clone(),
            city_id: if r.owner.is_none() { r.city_id.clone() } else { None },
            x,
            y,
            horse_id: None,
            load: Stock::new(),
        });
        return true;
    }
    let b = &mut world.buildings[site];
    b.site = None;
    // Finished, it belongs where its kind of building does, no longer to the realm that laid it out.
    b.realm_id = None;
    let (kind, id) = (b.kind, b.id.clone());
    if kind == BuildingKind::TownHall {
        found_city(world, &id, r.owner.as_deref());
    }
    // A storage no city takes in is the builder's realm's (`CONTEXT.md`: Outpost storage).
    if kind == BuildingKind::Storage && r.owner.is_some() {
        if let Some(b) = world.buildings.iter_mut().find(|b| b.id == id) {
            b.realm_id = r.owner.clone();
        }
    }
    true
}

/// Requests this tick's build actions: laying out the site first, then work (`requestBuilding`).
pub fn request_building(world: &WorldState) -> Vec<BuildAction> {
    world
        .residents
        .iter()
        .filter_map(|r| {
            let part = building_part(r.order.as_ref())?;
            let kind = if part.site_id.is_none() {
                BuildActionKind::LayOut
            } else {
                BuildActionKind::Work
            };
            Some(BuildAction { kind, resident_id: r.id.clone() })
        })
        .collect()
}

/// Resolves build actions (ADR 0002), one after another (`resolveBuilding`). A resident who has
/// left the tile stops. Laying out joins an unfinished site of the same kind they stand at, or
/// lays out a new one where the building may go, gathering the goods on its footprint into its
/// pile; otherwise the order ends (a line order goes on to its next tile). Work goes into the
/// site they stand at, up to what it needs, and teaches Construction. A site with all its
/// materials and work becomes the building, and everyone's order for it is done (a line order
/// goes on).
pub fn resolve_building(
    world: &mut WorldState,
    actions: &[BuildAction],
    terrain: Option<&TerrainMap>,
) {
    let size = terrain.map_or(MAP_SIZE, |t| t.size);
    let lookup = terrain.map(|t| t as &dyn TerrainLookup);
    let tick = world.tick as f64;
    let mut finished = false;
    for a in actions {
        let Some(ri) = world.residents.iter().position(|x| x.id == a.resident_id) else {
            continue;
        };
        let Some(part) = building_part(world.residents[ri].order.as_ref()) else { continue };
        let (rx, ry) = (world.residents[ri].x as i32, world.residents[ri].y as i32);
        if (rx, ry) != part.at {
            world.residents[ri].order = None;
            continue;
        }
        if a.kind == BuildActionKind::LayOut {
            let here = construction_index_at(world, rx, ry, part.building);
            let joins = here.filter(|&i| {
                let h = &world.buildings[i];
                h.site.is_some() && h.kind == part.building
            });
            if let Some(i) = joins {
                let id = world.buildings[i].id.clone();
                set_site_id(&mut world.residents[ri].order, id);
            } else if build_problem(world, rx, ry, part.building, lookup).is_some() {
                next_tile(&mut world.residents[ri]);
            } else {
                let id = new_id("b", &mut world.next_id);
                let r = &world.residents[ri];
                let site = Building {
                    id: id.clone(),
                    kind: part.building,
                    city_id: laid_out_for(world, r, part.building),
                    // The realm whose resident lays it out, until it is finished.
                    realm_id: r.owner.clone(),
                    x: r.x,
                    y: r.y,
                    stock: None,
                    site: Some(ConstructionSite { delivered: Stock::new(), work: 0.0 }),
                    teardown: None,
                    closed: None,
                    damage: None,
                    breedings: None,
                };
                world.buildings.push(site.clone());
                gather_pile(world, &site, size);
                set_site_id(&mut world.residents[ri].order, id.clone());
                let r = world.residents[ri].clone();
                own_workplace(world, &r, part.building, &id);
            }
            continue;
        }
        let si =
            part.site_id.as_ref().and_then(|id| world.buildings.iter().position(|b| &b.id == id));
        let at_site = si.filter(|&i| {
            let b = &world.buildings[i];
            b.site.is_some() && csp_shared::footprint::is_at((rx, ry), placed(b), size)
        });
        let Some(si) = at_site else {
            world.residents[ri].order = None;
            continue;
        };
        if work_needed(&world.buildings[si]) > 0.0 {
            let (kind, bx, by) =
                (world.buildings[si].kind, world.buildings[si].x, world.buildings[si].y);
            let under = terrain.map(|t| terrain_at(t, bx as i32, by as i32));
            let r = &world.residents[ri];
            let work = site_work_of(build_work(r, tick), kind, under);
            let learned = construction_learned(r, tick);
            let had = skill_of(r, SkillName::Construction);
            if let Some(s) = world.buildings[si].site.as_mut() {
                s.work = build_work_of(kind).min(s.work + work);
            }
            world.residents[ri].skills.insert(SkillName::Construction, had + learned);
        }
        let kind = world.buildings[si].kind;
        let r = world.residents[ri].clone();
        // A road is no city building, so a tile of it changes no city (`updateCityMembership`).
        finished = (finish_site(world, si, &r, terrain) && kind != BuildingKind::Road) || finished;
    }
    if finished {
        update_city_membership(world, size);
    }
    // Orders on a site that is finished go on (a line order to its next tile); on one that is
    // gone, they end. `new Map(...)`: the last building with an id wins.
    let built = |world: &WorldState, id: &str| {
        world.buildings.iter().rev().find(|b| b.id == id).map(|b| b.site.is_none())
    };
    for i in 0..world.residents.len() {
        let Some(site_id) =
            building_part(world.residents[i].order.as_ref()).and_then(|p| p.site_id)
        else {
            continue;
        };
        match built(world, &site_id) {
            Some(false) => {}
            Some(true) => next_tile(&mut world.residents[i]),
            None => world.residents[i].order = None,
        }
    }
}

/// Checks a build order (`build.validate`): one of the sender's adult residents builds `building`
/// with the north-west tile of its footprint on the tile they stand on, or joins the unfinished
/// one of that kind there.
pub fn validate_build(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    terrain: Option<&TerrainMap>,
) -> Option<String> {
    let Some(ri) = ordered_resident(world, sender, str_field(order, "residentId")) else {
        return Some("not one of your residents".into());
    };
    let r = &world.residents[ri];
    let building = str_field(order, "building").and_then(kind_of);
    build_at_problem(world, r, building, (r.x as i32, r.y as i32), terrain)
}

/// Gives the resident the build order (`build.apply`); laying out and working happen in later
/// ticks.
pub fn apply_build(world: &mut WorldState, order: &OrderRequest) {
    let Some(building) = str_field(order, "building").and_then(kind_of) else { return };
    let id = str_field(order, "residentId");
    if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
        r.order = Some(ResidentOrder::Build(BuildOrder {
            building,
            at: Tile { x: r.x, y: r.y },
            site_id: None,
        }));
    }
}

type Validate = fn(&WorldState, &OrderSender, &OrderRequest, Option<&TerrainMap>) -> Option<String>;
type Apply = fn(&mut WorldState, &OrderRequest, Option<&TerrainMap>);

/// One of T86.6's order kinds for the order registry (`OrderKind`): its checks and what it sets.
struct Kind {
    validate: Validate,
    apply: Apply,
}

impl crate::orders::OrderKind for Kind {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        (self.validate)(world, sender, order, terrain)
    }

    fn apply(
        &self,
        world: &mut WorldState,
        _sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        (self.apply)(world, order, terrain)
    }
}

/// Adds the order kinds of building, tearing down, lines, work, teaching and training to the
/// registry (`orderKinds`' `build`, `tearDown`, `roadLine`, `wallLine`, `workAt`, `teach`,
/// `train`).
pub fn add_building_orders(kinds: &mut crate::orders::OrderKinds) {
    use crate::road_line::{apply_line, validate_line, LineKind};
    use crate::teaching::{apply_teach, validate_teach};
    use crate::teardown::{apply_tear_down, validate_tear_down};
    use crate::training::{apply_train, validate_train};
    use crate::work::{apply_work_at, validate_work_at};
    let kinds_of: [(&str, Validate, Apply); 7] = [
        ("build", validate_build, |w, o, _| apply_build(w, o)),
        ("tearDown", validate_tear_down, |w, o, _| apply_tear_down(w, o)),
        (
            "roadLine",
            |w, s, o, t| validate_line(LineKind::RoadLine, w, s, o, t),
            |w, o, t| apply_line(LineKind::RoadLine, w, o, t),
        ),
        (
            "wallLine",
            |w, s, o, t| validate_line(LineKind::WallLine, w, s, o, t),
            |w, o, t| apply_line(LineKind::WallLine, w, o, t),
        ),
        ("workAt", |w, s, o, _| validate_work_at(w, s, o), |w, o, _| apply_work_at(w, o)),
        ("teach", |w, s, o, _| validate_teach(w, s, o), |w, o, _| apply_teach(w, o)),
        ("train", |w, s, o, _| validate_train(w, s, o), |w, o, _| apply_train(w, o)),
    ];
    for (name, validate, apply) in kinds_of {
        kinds.insert(name, Kind { validate, apply });
    }
}

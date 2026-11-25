//! The build order and its sites (`apps/server/src/building.ts`, `CONTEXT.md`: Building,
//! Construction site): laying out a construction site, putting work into it, and what a finished
//! one becomes. Road and wall lines build their tiles through here too (`road_line`).

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::{terrain_at, TerrainMap};
use csp_shared::world::{
    BuildOrder, Building, BuildingKind, Carriage, ConstructionSite, LinePhase, OrderRequest,
    Resident, ResidentOrder, SiegeMachine, SkillName, Stock, Tile, Vessel, VesselKind,
    WallMaterial, WorldState,
};

use crate::cities::update_city_membership;
use crate::order_meta::{OrderMeta, StepGroup};
use crate::order_sender::{ordered_resident, OrderSender};
use crate::queries::balance::{build_work, construction_learned, skill_of};
use crate::queries::building::build_at_problem_of;
use crate::queries::building::{
    build_problem_for, construction_index_at, is_stone, line_building, line_kind_at,
    line_order_mut, materials_needed, max_workers, site_work_of, wooden_wall_index_at, work_needed,
    work_of, TerrainLookup, ON_PLAINS,
};
use crate::queries::names::{kind_of, placed};
use crate::queries::vessels::launch_tile;
use crate::queue::field_str as str_field;
use crate::random::new_id;
use crate::running::{in_place, On, RunningOrder, Ties, TiesMut};
use crate::script_actions::{arg, arg_as, ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;
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
    /// What a wall or gate is built of; none is wood.
    pub material: Option<WallMaterial>,
}

/// What a resident is building, and where (`buildingPart`). Nothing otherwise.
pub fn building_part(o: Option<&ResidentOrder>) -> Option<BuildingPart> {
    match o? {
        ResidentOrder::Build(b) => Some(BuildingPart {
            building: b.building,
            at: (b.at.x as i32, b.at.y as i32),
            site_id: b.site_id.clone(),
            material: b.material,
        }),
        line @ (ResidentOrder::RoadLine(l) | ResidentOrder::WallLine(l))
            if l.phase == LinePhase::Building =>
        {
            Some(BuildingPart {
                building: line_building(line)?,
                at: (l.tiles[0].0 as i32, l.tiles[0].1 as i32),
                site_id: l.site_id.clone(),
                material: l.material,
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

/// The finished wooden wall or gate that the stone site at `site` in `world.buildings` upgrades
/// (`CONTEXT.md`: Wood or stone), if it stands over one of its kind.
fn upgraded_by(world: &WorldState, site: usize) -> Option<usize> {
    let s = &world.buildings[site];
    if !is_stone(s.kind, s.material) {
        return None;
    }
    wooden_wall_index_at(world, s.x as i32, s.y as i32, s.kind)
}

/// Orders on the site `from` that a finished upgrade folded into the wall `to` now name `to`, so
/// a line goes on to its next tile and a builder's order is done as on any finished site.
fn point_orders_at(world: &mut WorldState, from: &str, to: &str) {
    for r in &mut world.residents {
        if let Some(place) = r.order.as_mut().and_then(|o| o.ties_mut().place) {
            if *place == from {
                *place = to.to_string();
            }
        }
    }
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
    finish_site_by(world, site, r.owner.as_deref(), r.city_id.as_deref(), terrain)
}

/// [`finish_site`] for a finisher of realm `owner` (none for an NPC city's) who lives in
/// `city_id`: what the site becomes goes to them, as to the resident who put the last in.
pub fn finish_site_by(
    world: &mut WorldState,
    site: usize,
    owner: Option<&str>,
    city_id: Option<&str>,
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
            realm_id: owner.map(str::to_string),
            x: f64::from(x),
            y: f64::from(y),
            load: Stock::new(),
            rower_id: None,
            crew_ids: Vec::new(),
        });
        return true;
    }
    if let Some(kind) = crate::siege::machine_kind(b.kind) {
        // `CONTEXT.md`: Siege machine: the site is gone, and the machine of the finisher's realm
        // stands where it was, with no crew yet.
        let (x, y) = (b.x, b.y);
        world.buildings.remove(site);
        let id = new_id(crate::siege::machine_name(kind), &mut world.next_id);
        world.siege_machines.push(SiegeMachine {
            id,
            kind,
            realm_id: owner.map(str::to_string),
            x,
            y,
            damage: None,
            teardown: None,
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
            realm_id: owner.map(str::to_string),
            city_id: if owner.is_none() { city_id.map(str::to_string) } else { None },
            x,
            y,
            horse_id: None,
            load: Stock::new(),
        });
        return true;
    }
    if let Some(wooden) = upgraded_by(world, site) {
        // `CONTEXT.md`: Wood or stone: finished, the stone one replaces the wooden one where it
        // stands. The wooden one becomes it, keeping its id, its city, a gate's open or closed and
        // those up on it; its damage goes, and the site with it.
        let site_id = world.buildings[site].id.clone();
        let wooden_id = world.buildings[wooden].id.clone();
        let w = &mut world.buildings[wooden];
        w.material = Some(WallMaterial::Stone);
        w.damage = None;
        world.buildings.remove(site);
        point_orders_at(world, &site_id, &wooden_id);
        return true;
    }
    let b = &mut world.buildings[site];
    b.site = None;
    // Finished, it belongs where its kind of building does, no longer to the realm that laid it out.
    b.realm_id = None;
    let (kind, id) = (b.kind, b.id.clone());
    if kind == BuildingKind::TownHall {
        found_city(world, &id, owner);
    }
    // A storage no city takes in is the builder's realm's (`CONTEXT.md`: Outpost storage).
    if kind == BuildingKind::Storage && owner.is_some() {
        if let Some(b) = world.buildings.iter_mut().find(|b| b.id == id) {
            b.realm_id = owner.map(str::to_string);
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
        let Some(mut part) = building_part(world.residents[ri].order.as_ref()) else { continue };
        let (rx, ry) = (world.residents[ri].x as i32, world.residents[ri].y as i32);
        if matches!(world.residents[ri].order, Some(ResidentOrder::WallLine(_))) {
            // A stone line upgrades a wooden gate on its way to a stone gate.
            part.building = line_kind_at(world, part.building, part.material, rx, ry);
        }
        if (rx, ry) != part.at {
            world.residents[ri].order = None;
            continue;
        }
        if a.kind == BuildActionKind::LayOut {
            let here = construction_index_at(world, rx, ry, part.building);
            let joins = here.filter(|&i| {
                let h = &world.buildings[i];
                h.site.is_some()
                    && h.kind == part.building
                    && is_stone(h.kind, h.material) == is_stone(part.building, part.material)
            });
            if let Some(i) = joins {
                let id = world.buildings[i].id.clone();
                set_site_id(&mut world.residents[ri].order, id);
            } else if build_problem_for(world, rx, ry, part.building, part.material, lookup)
                .is_some()
            {
                next_tile(&mut world.residents[ri]);
            } else {
                let at = (world.residents[ri].x, world.residents[ri].y);
                let id = lay_out_site(world, ri, at, part.building, part.material, size);
                set_site_id(&mut world.residents[ri].order, id);
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
            let total = work_of(&world.buildings[si]);
            let r = &world.residents[ri];
            let work = site_work_of(build_work(r, tick), kind, under);
            let learned = construction_learned(r, tick);
            let had = skill_of(r, SkillName::Construction);
            let site_id = world.buildings[si].id.clone();
            let work = work * crate::rally::rallied_pace(world, ri, &site_id);
            if let Some(s) = world.buildings[si].site.as_mut() {
                s.work = total.min(s.work + work);
            }
            world.residents[ri].skills.insert(SkillName::Construction, had + learned);
            crate::wear::wear_tools(world, ri);
        }
        let kind = world.buildings[si].kind;
        let r = world.residents[ri].clone();
        // A road is no city building, so a tile of it changes no city (`updateCityMembership`).
        finished = (finish_site(world, si, &r, terrain) && kind != BuildingKind::Road) || finished;
    }
    if finished {
        update_city_membership(world, size);
    }
    orders_follow_sites(world);
}

/// The resident at `ri` lays out a new construction site of `kind` (of `material`) at `at`, the
/// tile they stand on in a tick, gathering the goods on its footprint into its pile; answers its id.
/// The caller has checked that it may go there.
pub fn lay_out_site(
    world: &mut WorldState,
    ri: usize,
    at: (f64, f64),
    kind: BuildingKind,
    material: Option<WallMaterial>,
    size: i32,
) -> String {
    let id = new_id("b", &mut world.next_id);
    let r = &world.residents[ri];
    let site = Building {
        id: id.clone(),
        kind,
        city_id: laid_out_for(world, r, kind),
        // The realm whose resident lays it out, until it is finished.
        realm_id: r.owner.clone(),
        x: at.0,
        y: at.1,
        stock: None,
        site: Some(ConstructionSite { delivered: Stock::new(), work: 0.0 }),
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
        decay: None,
        ruined_at: None,
        repair: None,
        // Only stone is written down: none is wood.
        material: is_stone(kind, material).then_some(WallMaterial::Stone),
    };
    world.buildings.push(site.clone());
    gather_pile(world, &site, size);
    let r = world.residents[ri].clone();
    own_workplace(world, &r, kind, &id);
    id
}

/// Orders on a site that is finished go on (a line order to its next tile); on one that is gone,
/// they end (the end of `resolveBuilding`).
pub fn orders_follow_sites(world: &mut WorldState) {
    // `new Map(...)`: the last building with an id wins.
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
    if let Some(problem) = material_problem(order, building) {
        return Some(problem);
    }
    let material = material_field(order);
    build_at_problem_of(world, r, building, material, (r.x as i32, r.y as i32), terrain)
}

/// What a build or wall line order asks its wall or gate to be built of (`material`: "wood" or
/// "stone", `CONTEXT.md`: Wall / Gate, Wood or stone); none is wood.
pub fn material_field(order: &OrderRequest) -> Option<WallMaterial> {
    match str_field(order, "material") {
        Some("stone") => Some(WallMaterial::Stone),
        Some("wood") => Some(WallMaterial::Wood),
        _ => None,
    }
}

/// Why an order's `material` won't do: one that is neither wood nor stone, or one for anything but
/// a wall, gate or tower.
pub fn material_problem(order: &OrderRequest, building: Option<BuildingKind>) -> Option<String> {
    let given = order.fields.get("material").filter(|v| !v.is_null())?;
    if material_field(order).is_none() {
        return Some(format!("a wall is of \"wood\" or \"stone\", not {given}"));
    }
    if !matches!(building, Some(BuildingKind::Wall | BuildingKind::Gate | BuildingKind::Tower)) {
        return Some("only a wall, gate or tower is of wood or stone".into());
    }
    None
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
            material: material_field(order).filter(|m| *m == WallMaterial::Stone),
        }));
    }
}

pub(crate) static BUILD_META: OrderMeta =
    OrderMeta::fns("build", validate_build, |w, _, o, _| apply_build(w, o))
        .queue_step(StepGroup::Work)
        .gets_off_first()
        .adults_only()
        .npc_city()
        .blocked_carrying_child()
        .script(&[BUILD_ACTION]);

const BUILD_ACTION: ScriptAction = ScriptAction {
    name: "build",
    group: ActionGroup::Work,
    request: Request::Fields(&[arg("building"), arg_as("material?", "material")]),
    cost: 10.0,
    description: "Lay out or join a construction site of that kind on my tile. A wall or gate is of \"wood\" (by default) or \"stone\"; a stone one may be laid out on a wooden one of its kind, which stands until the stone one is finished.",
    returns: ScriptType::String,
};

impl RunningOrder for BuildOrder {
    in_place!();
    fn ties(&self) -> Ties<'_> {
        let site = self.site_id.as_deref();
        Ties { on: site.map_or(On::Nothing, On::Site), crew_of: site, ..Ties::NONE }
    }
    fn ties_mut(&mut self) -> TiesMut<'_> {
        TiesMut { place: self.site_id.as_mut(), ..TiesMut::none() }
    }
}

//! The tear-down order (`CONTEXT.md`: Tearing down): work at taking down the building or
//! construction site on the resident's tile, whoever's it is.

use csp_shared::balance::MAP_SIZE;
use csp_shared::footprint::is_at;
use csp_shared::terrain::{terrain_at, TerrainMap};
use csp_shared::world::{
    Building, OrderRequest, ResidentOrder, SkillName, TearDownOrder, Tile, WorldState,
};

use crate::cities::{dissolve_city, update_city_membership};
use crate::crimes::{building_organization, commit_crime, CrimeAgainst};
use crate::order_meta::{OrderMeta, StepGroup};
use crate::order_sender::{commands, realm_of, OrderSender};
use crate::queries::balance::{build_work, construction_learned, skill_of};
use crate::queries::building::{
    site_work_of, strands_on_mountain, teardown_left, teardown_returns, teardown_work,
};
use crate::queries::building::{tear_down_problem, CARRYING_A_CHILD};
use crate::queries::names::placed;
use crate::queries::residents::can_work;
use crate::queue::field_str as str_field;
use crate::running::{in_place, no_ties_mut, On, RunningOrder, Ties};
use crate::script_actions::{arg, ActionGroup, Request, ScriptAction};
use crate::script_views::ScriptType;
use crate::survival::drop_goods;
use crate::tick::Scratch;
use crate::world_index::{building_index, resident_index};

/// Taking down another Organization's building is a crime (`buildingOrganization`, `commitCrime`
/// of `teardown.ts`), noted before the building goes.
fn commit_tear_down_crime(
    world: &mut WorldState,
    resident_id: &str,
    building: &Building,
    size: i32,
) {
    let victim_org = building_organization(world, building);
    let against =
        CrimeAgainst { victim_org, building: Some(building.kind), ..CrimeAgainst::default() };
    commit_crime(world, size, csp_shared::world::CrimeKind::TearDown, resident_id, against);
}

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
        let Some(ri) = resident_index(world, &a.resident_id) else {
            continue;
        };
        let r = &world.residents[ri];
        let Some(ResidentOrder::TearDown(o)) = &r.order else { continue };
        let (rx, ry) = (r.x as i32, r.y as i32);
        if let Some(mi) = crate::siege::machine_index(world, &o.building_id) {
            tear_down_machine(world, ri, mi, size, scratch);
            continue;
        }
        let bi = building_index(world, &o.building_id);
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
            let learned = construction_learned(r, tick);
            let had = skill_of(r, SkillName::Construction);
            let id = b.id.clone();
            let work = work * crate::rally::rallied_pace(world, ri, &id);
            let b = &world.buildings[bi];
            let total = teardown_work(b).min(b.teardown.unwrap_or(0.0) + work);
            world.buildings[bi].teardown = Some(total);
            world.residents[ri].skills.insert(SkillName::Construction, had + learned);
            crate::wear::wear_tools(world, ri);
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
    // Orders on what is gone end: each looked up by id, rather than every building's id copied
    // into a set each tick for the few on such an order (T89.6).
    let gone = |id: &str| building_index(world, id).is_none();
    let ends: Vec<usize> = (0..world.residents.len())
        .filter(|&i| {
            let on = world.residents[i].order.as_ref().map_or(On::Nothing, |o| o.ties().on);
            match on {
                On::TearsDown(id) => gone(id) && crate::siege::machine_index(world, id).is_none(),
                On::Site(id) => gone(id),
                On::Repairs(_) | On::Nothing => false,
            }
        })
        .collect();
    for i in ends {
        world.residents[i].order = None;
    }
    felled
}

/// A tick's work at tearing down the siege machine at `mi` by the resident at `ri`, who stays on
/// its tile while it stands there (`CONTEXT.md`: Siege machine, Tearing down). Once its work is in
/// it is gone and `TEARDOWN_MATERIALS_RETURNED` of its materials lie on its tile; the order is done.
fn tear_down_machine(
    world: &mut WorldState,
    ri: usize,
    mi: usize,
    size: i32,
    scratch: &mut Scratch,
) {
    let tick = world.tick as f64;
    let r = &world.residents[ri];
    let m = &world.siege_machines[mi];
    let stays = matches!(&r.order, Some(ResidentOrder::TearDown(o))
        if (o.at.x as i32, o.at.y as i32) == (r.x as i32, r.y as i32));
    let on_it = (r.x as i32, r.y as i32) == (m.x as i32, m.y as i32);
    if !stays || !on_it || r.owner.is_none() || r.owner != m.realm_id {
        world.residents[ri].order = None;
        return;
    }
    let needed = crate::siege::machine_teardown_work(m.kind);
    let total = needed.min(m.teardown.unwrap_or(0.0) + build_work(r, tick));
    let learned = construction_learned(r, tick);
    let had = skill_of(r, SkillName::Construction);
    world.residents[ri].skills.insert(SkillName::Construction, had + learned);
    world.siege_machines[mi].teardown = Some(total);
    if total < needed {
        return;
    }
    let m = world.siege_machines.remove(mi);
    let returned = crate::siege::torn_down_machine_returns(m.kind);
    drop_goods(world, m.x, m.y, &returned, size);
    scratch.made.note(&returned);
    for r in &mut world.residents {
        if matches!(&r.order, Some(ResidentOrder::TearDown(o)) if o.building_id == m.id) {
            r.order = None;
        }
    }
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
    if let Some(no) = crate::lent::refusal(world, r, building_id) {
        return Some(no.into());
    }
    // A siege machine is torn down by its own realm only, standing on its tile (`CONTEXT.md`:
    // Siege machine).
    if let Some(m) = crate::siege::machine_by_id(world, building_id) {
        let name = crate::siege::machine_name(m.kind);
        if m.realm_id.as_deref() != Some(realm.id.as_str()) {
            return Some(format!("only its own realm tears down a {name}"));
        }
        if (r.x as i32, r.y as i32) != (m.x as i32, m.y as i32) {
            return Some(format!("the resident is not at that {name}"));
        }
        return None;
    }
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

pub(crate) static TEAR_DOWN_META: OrderMeta =
    OrderMeta::fns("tearDown", validate_tear_down, |w, _, o, _| apply_tear_down(w, o))
        .queue_step(StepGroup::Work)
        .gets_off_first()
        .adults_only()
        .npc_city()
        .blocked_carrying_child()
        .script(&[TEAR_DOWN_ACTION]);

const TEAR_DOWN_ACTION: ScriptAction = ScriptAction {
    name: "tearDown",
    group: ActionGroup::Work,
    request: Request::Fields(&[arg("buildingId")]),
    cost: 10.0,
    description: "Tear down the building or site on my tile.",
    returns: ScriptType::String,
};

impl RunningOrder for TearDownOrder {
    in_place!();
    fn ties(&self) -> Ties<'_> {
        Ties { on: On::TearsDown(&self.building_id), ..Ties::NONE }
    }
    no_ties_mut!();
}

//! Picking up and putting down goods (`apps/server/src/carrying.ts`, `CONTEXT.md`: Core rule,
//! Crime, Down, Outpost storage): the pick-up and drop orders, and the take and put actions every
//! goods order requests, resolved one after another at the end of the tick (ADR 0002).

use std::collections::HashSet;

use csp_shared::balance::MAP_SIZE;
use csp_shared::terrain::TerrainMap;
use csp_shared::world::{
    DropOrder, GoodsSpot, OrderRequest, PickUpOrder, ResidentOrder, Stock, WorldState,
};
use serde_json::Value;

use crate::goods_deps::{
    building_organization, carriage_organization, collects_from, collects_transfer_from,
    commit_theft, drop_goods, finish_site, ordered_resident, organization_of, raise_theft,
    rob_caravan, rob_trader, update_city_membership, OrderSender,
};
use crate::holders::{move_between, stock_of, Holder};
use crate::queries::command::commander_of_resident;
use crate::queries::goods::{
    can_handle, down_index_on, free_stock, goods_at_spot, materials_needed, move_goods,
    pile_index_at, site_at, site_index_at, storage_at, storage_index_at, units_that_fit,
    units_that_fit_carriage,
};
use crate::queries::guard::outpost_storage_guarded;
use crate::queries::names::{good_of, held};
use crate::queries::vessels::{beside_vessel, units_that_fit_vessel};
use crate::storing::carried_for_order;

/// Whether an action takes goods from a spot or puts carried goods there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CarryKind {
    Take,
    Put,
}

/// An action a resident requests (`CarryAction`): take goods from a spot on their tile, or put
/// carried goods there. The world checks and resolves it at the end of the tick.
#[derive(Debug, Clone, PartialEq)]
pub struct CarryAction {
    pub kind: CarryKind,
    pub resident_id: String,
    pub spot: GoodsSpot,
    pub goods: Stock,
}

/// The order's goods as plain data (`readGoods`): known goods, whole positive units, at least one.
pub fn read_goods(goods: Option<&Value>) -> Option<Stock> {
    let obj = goods?.as_object()?;
    let mut out = Stock::new();
    for (name, units) in obj {
        let good = good_of(name)?;
        let n = units.as_f64()?;
        if !(n.is_finite() && n.fract() == 0.0) || n <= 0.0 {
            return None;
        }
        out.insert(good, n);
    }
    (!out.is_empty()).then_some(out)
}

/// The order's spot as plain data (`readSpot`).
pub fn read_spot(spot: Option<&Value>) -> Option<GoodsSpot> {
    let s = spot?.as_object()?;
    let id = |key: &str| s.get(key).and_then(Value::as_str).map(str::to_string);
    match s.get("kind").and_then(Value::as_str)? {
        "ground" => Some(GoodsSpot::Ground),
        "resident" => Some(GoodsSpot::Resident { resident_id: id("residentId")? }),
        "carriage" => Some(GoodsSpot::Carriage { carriage_id: id("carriageId")? }),
        "storage" => Some(GoodsSpot::Storage { storage_id: id("storageId")? }),
        "site" => Some(GoodsSpot::Site { site_id: id("siteId")? }),
        "vessel" => Some(GoodsSpot::Vessel { vessel_id: id("vesselId")? }),
        _ => None,
    }
}

/// What the pick-up and drop orders share once checked: the resident (an index), spot and goods.
struct Checked {
    r: usize,
    spot: GoodsSpot,
    goods: Stock,
}

/// Checks what pick-up and drop orders share (`check`).
fn check(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Result<Checked, String> {
    let o = &order.fields;
    let Some(ri) = ordered_resident(world, sender, o.get("residentId")) else {
        return Err("not one of your residents".into());
    };
    let r = &world.residents[ri];
    let Some(spot) = read_spot(o.get("spot")) else {
        return Err(
            "the spot must be the ground, a storage, a construction site, a carriage, a boat or a Down resident"
                .into(),
        );
    };
    let Some(goods) = read_goods(o.get("goods")) else {
        return Err("goods must be whole units of known goods".into());
    };
    if !can_handle(r.born_at, world.tick as f64, goods.keys()) {
        return Err("children can’t pick up or put down goods".into());
    }
    match &spot {
        GoodsSpot::Storage { storage_id }
            if storage_at(world, r.x as i32, r.y as i32, MAP_SIZE).map(|s| &s.id)
                != Some(storage_id) =>
        {
            return Err("the resident is not at that storage".into());
        }
        GoodsSpot::Site { site_id } if site_at(world, r.x, r.y, site_id).is_none() => {
            return Err("the resident is not at that construction site".into());
        }
        GoodsSpot::Carriage { .. } if goods_at_spot(world, r.x, r.y, &spot).is_none() => {
            return Err("that carriage is not on the resident’s tile".into());
        }
        GoodsSpot::Vessel { .. } if goods_at_spot(world, r.x, r.y, &spot).is_none() => {
            return Err("that boat is not beside the resident".into());
        }
        GoodsSpot::Resident { resident_id }
            if down_index_on(world, r.x, r.y, resident_id).is_none() =>
        {
            return Err("nobody of that id lies Down on the resident’s tile".into());
        }
        _ => {}
    }
    Ok(Checked { r: ri, spot, goods })
}

/// Whether a stock holds any of the goods (`has`).
fn has(stock: Option<&Stock>, goods: &Stock) -> bool {
    goods.keys().any(|g| stock.is_some_and(|s| held(s, *g) > 0.0))
}

/// Checks a pick-up order (`pickUp.validate`): one of the Player's residents takes goods from the
/// pile, a storage, a construction site or a carriage on their tile, or from a Down resident.
pub fn validate_pick_up(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let c = match check(world, sender, order) {
        Ok(c) => c,
        Err(e) => return Some(e),
    };
    let r = &world.residents[c.r];
    let here = goods_at_spot(world, r.x, r.y, &c.spot);
    if !has(here, &c.goods) {
        return Some("none of those goods here".into());
    }
    let free = takeable_from(world, c.r, &c.spot, here.expect("has goods"), false);
    if has(Some(&free), &c.goods) {
        None
    } else {
        Some("those goods are set aside for an offer".into())
    }
}

/// Gives a pick-up order (`pickUp.apply`).
pub fn apply_pick_up(world: &mut WorldState, _sender: &OrderSender, order: &OrderRequest) {
    let o = &order.fields;
    let id = o.get("residentId").and_then(Value::as_str);
    let (Some(from), Some(goods)) = (read_spot(o.get("spot")), read_goods(o.get("goods"))) else {
        return;
    };
    if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
        r.order = Some(ResidentOrder::PickUp(PickUpOrder { from, goods }));
    }
}

/// Checks a drop order (`drop.validate`): one of the Player's residents puts down carried goods
/// on their tile; at a construction site only what it still needs.
pub fn validate_drop(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Option<String> {
    let c = match check(world, sender, order) {
        Ok(c) => c,
        Err(e) => return Some(e),
    };
    let r = &world.residents[c.r];
    if !has(Some(&r.carried), &c.goods) {
        return Some("not carrying any of those goods".into());
    }
    // Food goes into a Down resident's hands by feeding them (`CONTEXT.md`: Reviving).
    if matches!(c.spot, GoodsSpot::Resident { .. }) {
        return Some("goods can’t be put down on a resident".into());
    }
    if let GoodsSpot::Site { site_id } = &c.spot {
        let site = site_at(world, r.x, r.y, site_id).expect("checked");
        if !has(Some(&materials_needed(site)), &c.goods) {
            return Some("the construction site needs none of those goods".into());
        }
    }
    None
}

/// Gives a drop order (`drop.apply`).
pub fn apply_drop(world: &mut WorldState, _sender: &OrderSender, order: &OrderRequest) {
    let o = &order.fields;
    let id = o.get("residentId").and_then(Value::as_str);
    let (Some(to), Some(goods)) = (read_spot(o.get("spot")), read_goods(o.get("goods"))) else {
        return;
    };
    if let Some(r) = world.residents.iter_mut().find(|x| Some(x.id.as_str()) == id) {
        r.order = Some(ResidentOrder::Drop(DropOrder { to, goods }));
    }
}

/// Requests this tick's take and put actions from pick-up and drop orders (`requestCarrying`).
pub fn request_carrying(world: &WorldState) -> Vec<CarryAction> {
    let mut actions = Vec::new();
    for r in &world.residents {
        match &r.order {
            Some(ResidentOrder::PickUp(o)) => actions.push(CarryAction {
                kind: CarryKind::Take,
                resident_id: r.id.clone(),
                spot: o.from.clone(),
                goods: o.goods.clone(),
            }),
            Some(ResidentOrder::Drop(o)) => actions.push(CarryAction {
                kind: CarryKind::Put,
                resident_id: r.id.clone(),
                spot: o.to.clone(),
                goods: o.goods.clone(),
            }),
            _ => {}
        }
    }
    actions
}

/// A theft of goods this tick whose alarm is still to be raised (`Theft`).
struct Theft {
    thief: usize,
    victim_org: String,
}

/// Resolves take and put actions one after another (`resolveCarrying`), so two residents never
/// take the same goods. A take or put of a pick-up or drop order ends it; a store or fetch order
/// goes on or ends (`carried_for_order`). Thefts raise their alarms once all have carried.
pub fn resolve_carrying(world: &mut WorldState, actions: &[CarryAction], size: i32) {
    resolve_carrying_on(world, actions, size, None);
}

/// `resolve_carrying` with the map at hand, which the last materials put into a boat site need to
/// float its boat (`finish_site`).
pub fn resolve_carrying_on(
    world: &mut WorldState,
    actions: &[CarryAction],
    size: i32,
    terrain: Option<&TerrainMap>,
) {
    let mut robbed = HashSet::new();
    let mut thefts = Vec::new();
    for a in actions {
        let Some(ri) = world.residents.iter().position(|x| x.id == a.resident_id) else {
            continue;
        };
        match a.kind {
            CarryKind::Take => take(world, ri, a, size, &mut robbed, &mut thefts),
            CarryKind::Put => put(world, ri, a, size, terrain),
        }
        let r = &mut world.residents[ri];
        if matches!(r.order, Some(ResidentOrder::PickUp(_) | ResidentOrder::Drop(_))) {
            r.order = None;
        } else {
            carried_for_order(world, ri);
        }
    }
    for Theft { thief, victim_org } in thefts {
        raise_theft(world, thief, &victim_org, size);
    }
}

/// `resolve_carrying` on a map of `MAP_SIZE` tiles.
pub fn resolve_carrying_default(world: &mut WorldState, actions: &[CarryAction]) {
    resolve_carrying(world, actions, MAP_SIZE);
}

/// Where the goods of a spot other than the ground are, if it is on the resident's tile
/// (`spotStock`). A storage without a stock gets an empty one, as `storage.stock ??= {}` does.
fn spot_holder(world: &mut WorldState, ri: usize, spot: &GoodsSpot) -> Option<Holder> {
    let (x, y) = (world.residents[ri].x, world.residents[ri].y);
    match spot {
        GoodsSpot::Carriage { carriage_id } => world
            .carriages
            .iter()
            .position(|k| &k.id == carriage_id && k.x == x && k.y == y)
            .map(Holder::Carriage),
        GoodsSpot::Vessel { vessel_id } => world
            .vessels
            .iter()
            .position(|v| &v.id == vessel_id && beside_vessel(world, v, x, y))
            .map(Holder::Vessel),
        GoodsSpot::Resident { resident_id } => {
            down_index_on(world, x, y, resident_id).map(Holder::Resident)
        }
        GoodsSpot::Site { site_id } => site_index_at(world, x, y, site_id).map(Holder::Site),
        GoodsSpot::Storage { storage_id } => {
            let i = storage_index_at(world, x, y)?;
            if &world.buildings[i].id != storage_id {
                return None;
            }
            world.buildings[i].stock.get_or_insert_with(Stock::new);
            Some(Holder::Storage(i))
        }
        GoodsSpot::Ground => None,
    }
}

fn take(
    world: &mut WorldState,
    ri: usize,
    a: &CarryAction,
    size: i32,
    robbed: &mut HashSet<String>,
    thefts: &mut Vec<Theft>,
) {
    let (x, y) = (world.residents[ri].x, world.residents[ri].y);
    let source = match a.spot {
        GoodsSpot::Ground => pile_index_at(world, x as i32, y as i32, MAP_SIZE).map(Holder::Pile),
        _ => spot_holder(world, ri, &a.spot),
    };
    let Some(source) = source else { return };
    if guarded_from(world, ri, &a.spot, size) {
        return;
    }
    // A caravan collecting a pick-up takes what was sold to it (`CONTEXT.md`: Delivery), one
    // collecting a transfer what it was given to carry (`CONTEXT.md`: Transfer).
    let sold = match &a.spot {
        GoodsSpot::Storage { storage_id } => {
            let r = &world.residents[ri];
            collects_from(world, r, storage_id) || collects_transfer_from(world, r, storage_id)
        }
        _ => false,
    };
    let free = takeable_from(world, ri, &a.spot, &stock_of(world, source), sold);
    let mut taken = Stock::new();
    let tick = world.tick as f64;
    for (&good, &wanted) in &a.goods {
        let fit = units_that_fit(&world.residents[ri], good, tick);
        let units = wanted.min(held(&free, good)).min(fit);
        move_between(world, source, Holder::Resident(ri), good, units);
        if units > 0.0 {
            taken.insert(good, units);
        }
    }
    world.piles.retain(|p| p.goods.values().any(|n| *n > 0.0));
    let victim_org = spot_organization(world, &a.spot);
    if let Some(victim_org) = victim_org.filter(|_| !sold && !taken.is_empty()) {
        let victim = match &a.spot {
            GoodsSpot::Resident { resident_id } => down_index_on(world, x, y, resident_id),
            _ => None,
        };
        commit_theft(world, size, ri, &victim_org, &taken, victim);
        thefts.push(Theft { thief: ri, victim_org });
    }
    if let GoodsSpot::Carriage { carriage_id } = &a.spot {
        if !taken.is_empty() {
            rob_caravan(world, ri, carriage_id, robbed);
            rob_trader(world, ri, carriage_id, robbed);
        }
    }
}

/// What the resident can take of the goods `source` at a spot (`takeableFrom`): the storage's own
/// side, and a caravan collecting there (`sold`), leave what is set aside for offers alone.
fn takeable_from(
    world: &WorldState,
    ri: usize,
    spot: &GoodsSpot,
    source: &Stock,
    sold: bool,
) -> Stock {
    let GoodsSpot::Storage { storage_id } = spot else {
        return source.clone();
    };
    let r = &world.residents[ri];
    let org = spot_organization(world, spot);
    let theirs = org.as_ref().is_some_and(|org| {
        organization_of(r).as_ref() == Some(org)
            || commander_of_resident(world, r).as_ref() == Some(org)
    });
    if theirs || sold {
        free_stock(world, storage_id, Some(source))
    } else {
        source.clone()
    }
}

/// Whether a spot is an outpost storage guarded against the resident (`guardedFrom`).
fn guarded_from(world: &WorldState, ri: usize, spot: &GoodsSpot, size: i32) -> bool {
    let GoodsSpot::Storage { storage_id } = spot else {
        return false;
    };
    let Some(b) = world.buildings.iter().find(|x| &x.id == storage_id) else {
        return false;
    };
    world.residents[ri].owner != b.realm_id && outpost_storage_guarded(world, b, size)
}

/// Whose goods a spot holds (`spotOrganization`): a storage's, a carriage's or a Down resident's
/// Organization. Piles and construction sites belong to nobody.
fn spot_organization(world: &WorldState, spot: &GoodsSpot) -> Option<String> {
    match spot {
        GoodsSpot::Resident { resident_id } => {
            world.residents.iter().find(|x| &x.id == resident_id).and_then(organization_of)
        }
        GoodsSpot::Storage { storage_id } => world
            .buildings
            .iter()
            .find(|x| &x.id == storage_id)
            .and_then(|b| building_organization(world, b)),
        GoodsSpot::Carriage { carriage_id } => {
            world.carriages.iter().find(|k| &k.id == carriage_id).and_then(carriage_organization)
        }
        GoodsSpot::Vessel { vessel_id } => {
            world.vessels.iter().find(|v| &v.id == vessel_id).and_then(|v| v.realm_id.clone())
        }
        _ => None,
    }
}

/// Puts down goods (`put`). The last materials delivered to a site that has all its work finish
/// it (`finish_site`).
fn put(
    world: &mut WorldState,
    ri: usize,
    a: &CarryAction,
    size: i32,
    terrain: Option<&TerrainMap>,
) {
    // On the ground the goods go in the tile's pile; a storage or site that is gone takes nothing,
    // nor does a Down resident: Food goes into their hands by feeding (`CONTEXT.md`: Reviving).
    if matches!(a.spot, GoodsSpot::Resident { .. }) {
        return;
    }
    let (x, y) = (world.residents[ri].x, world.residents[ri].y);
    let ground = matches!(a.spot, GoodsSpot::Ground);
    let target = if ground { None } else { spot_holder(world, ri, &a.spot) };
    if !ground && target.is_none() {
        return;
    }
    // A construction site takes only the materials it still needs, a carriage what fits on it.
    let room = match target {
        Some(Holder::Site(i)) => Some(materials_needed(&world.buildings[i])),
        _ => None,
    };
    let mut dropped = Stock::new();
    for (&good, &wanted) in &a.goods {
        let fits = match target {
            Some(Holder::Carriage(k)) => units_that_fit_carriage(world, &world.carriages[k], good),
            // Passengers count against what a vessel holds (`CONTEXT.md`: Beside a vessel).
            Some(Holder::Vessel(v)) => units_that_fit_vessel(world, &world.vessels[v], good),
            _ => f64::INFINITY,
        };
        let carried = held(&world.residents[ri].carried, good);
        let units = wanted.min(carried).min(room.as_ref().map_or(fits, |r| held(r, good)));
        match target {
            Some(t) => move_between(world, Holder::Resident(ri), t, good, units),
            None => move_goods(&mut world.residents[ri].carried, &mut dropped, good, units),
        }
    }
    if ground {
        drop_goods(world, x, y, &dropped, MAP_SIZE);
    }
    if let Some(Holder::Site(i)) = target {
        if finish_site(world, i, ri, terrain) {
            update_city_membership(world, size);
        }
    }
}

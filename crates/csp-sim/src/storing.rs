//! Storing and fetching (`apps/server/src/storing.ts`, `CONTEXT.md`: Store, Fetch, Getting food):
//! a resident walks to a storage, a stable or a carriage of their side and puts goods down or
//! takes them there, through the take and put actions of `carrying.rs`.

use csp_shared::balance::OWN_FOOD;
use csp_shared::footprint::covers;
use csp_shared::terrain::wrap_distance;
use csp_shared::world::{
    Building, BuildingKind, FetchOrder, FetchPhase, Good, GoodsPlace, GoodsSpot, GoodsWanted,
    OrderEnded, OrderEndedKind, OrderRequest, Resident, ResidentOrder, Stock, StoreOrder,
    StorePhase, WorldState,
};
use serde_json::Value;

use crate::carrying::{CarryAction, CarryKind};
use crate::goods_deps::{
    building_organization, carriage_organization, ordered_resident, realm_of, OrderSender,
};
use crate::queries::command::commander_of_resident;
use crate::queries::command::steals_carriage;
use crate::queries::goods::{can_handle, free_stock, put_away_units};
use crate::queries::names::{good_of, held, placed};
use crate::queries::vessels::{resident_beside_vessel, vessel_by_id};
use csp_shared::balance::MAP_SIZE;

/// `Number.MAX_SAFE_INTEGER`: a fetch of as many as there are.
const AS_MANY_AS_THERE_ARE: f64 = 9_007_199_254_740_991.0;

/// The buildings a store or fetch order goes to (`PLACE_KINDS`): a storage, or a stable's or a
/// haven's storage.
const PLACE_KINDS: [BuildingKind; 3] =
    [BuildingKind::Storage, BuildingKind::Stable, BuildingKind::Haven];

/// The order's goods as plain data (`readWanted`): a list of known goods (as many as there are of
/// each), or known goods with whole positive units or null. At least one.
pub fn read_wanted(goods: Option<&Value>) -> Option<GoodsWanted> {
    let mut out = GoodsWanted::new();
    match goods? {
        Value::Array(list) => {
            for g in list {
                out.insert(good_of(g.as_str()?)?, None);
            }
        }
        Value::Object(obj) => {
            for (name, units) in obj {
                let good = good_of(name)?;
                if units.is_null() {
                    out.insert(good, None);
                    continue;
                }
                let n = units.as_f64()?;
                if !(n.is_finite() && n.fract() == 0.0) || n <= 0.0 {
                    return None;
                }
                out.insert(good, Some(n));
            }
        }
        _ => return None,
    }
    (!out.is_empty()).then_some(out)
}

/// The Organization the sender orders for (`sideOf`): their realm, or the NPC city running
/// defaults.
fn side_of(world: &WorldState, sender: &OrderSender) -> Option<String> {
    sender.npc_city_id.clone().or_else(|| realm_of(world, sender.user_id).map(|r| r.id.clone()))
}

/// The place an id names (`namedPlace`): a finished storage or stable, anyone's, a Trade Org
/// city's own warehouse when that city sends it, or a carriage of the sender's own. An id may also
/// come as anything with an `id`.
fn named_place(world: &WorldState, side: Option<&str>, id: &Value) -> Option<GoodsPlace> {
    let key = match id {
        Value::Object(o) => o.get("id")?,
        v => v,
    };
    let key = key.as_str()?;
    if let Some(b) = world.buildings.iter().find(|x| x.id == key) {
        let own_warehouse =
            b.kind == BuildingKind::Warehouse && side.is_some() && b.city_id.as_deref() == side;
        return ((PLACE_KINDS.contains(&b.kind) || own_warehouse) && b.site.is_none())
            .then(|| GoodsPlace::Storage { storage_id: b.id.clone() });
    }
    if let Some(v) = vessel_by_id(world, key) {
        return (side.is_some() && v.realm_id.as_deref() == side)
            .then(|| GoodsPlace::Vessel { vessel_id: v.id.clone() });
    }
    let k = world.carriages.iter().find(|x| x.id == key)?;
    (side.is_some() && carriage_organization(k).as_deref() == side)
        .then(|| GoodsPlace::Carriage { carriage_id: k.id.clone() })
}

/// Where a place stands now (`placeTile`); `None` once it is gone.
pub fn place_tile(world: &WorldState, place: &GoodsPlace) -> Option<(f64, f64)> {
    match place {
        GoodsPlace::Carriage { carriage_id } => {
            world.carriages.iter().find(|k| &k.id == carriage_id).map(|k| (k.x, k.y))
        }
        GoodsPlace::Vessel { vessel_id } => vessel_by_id(world, vessel_id).map(|v| (v.x, v.y)),
        GoodsPlace::Storage { storage_id } => {
            finished_storage(world, storage_id).map(|b| (b.x, b.y))
        }
    }
}

/// The goods at a place, wherever it stands (`placeStock`).
fn place_stock<'w>(world: &'w WorldState, place: &GoodsPlace) -> Option<Option<&'w Stock>> {
    match place {
        GoodsPlace::Carriage { carriage_id } => {
            world.carriages.iter().find(|k| &k.id == carriage_id).map(|k| Some(&k.load))
        }
        GoodsPlace::Vessel { vessel_id } => vessel_by_id(world, vessel_id).map(|v| Some(&v.load)),
        GoodsPlace::Storage { storage_id } => {
            finished_storage(world, storage_id).map(|b| b.stock.as_ref())
        }
    }
}

/// Whether the resident stands at the place (`atPlace`).
fn at_place(world: &WorldState, r: &Resident, place: &GoodsPlace) -> bool {
    match place {
        GoodsPlace::Carriage { carriage_id } => world
            .carriages
            .iter()
            .find(|k| &k.id == carriage_id)
            .is_some_and(|k| k.x == r.x && k.y == r.y),
        // From beside it (`CONTEXT.md`: Beside a vessel).
        GoodsPlace::Vessel { vessel_id } => {
            vessel_by_id(world, vessel_id).is_some_and(|v| resident_beside_vessel(v, r))
        }
        GoodsPlace::Storage { storage_id } => finished_storage(world, storage_id)
            .is_some_and(|b| covers(placed(b), r.x as i32, r.y as i32, MAP_SIZE)),
    }
}

/// The units of each good a store order puts (`toStore`): those asked for, or all carried but
/// own food.
fn to_store(r: &Resident, goods: &GoodsWanted, own_food: Option<f64>) -> Stock {
    let mut out = Stock::new();
    for (&good, &units) in goods {
        let carried = held(&r.carried, good);
        let n = match units {
            None => put_away_units(good, carried, Some(own_food.unwrap_or(OWN_FOOD))),
            Some(u) => u.min(carried),
        };
        if n > 0.0 {
            out.insert(good, n);
        }
    }
    out
}

/// The nearest of `places` to the resident, the short way round the map (`nearest`).
fn nearest<T>(r: &Resident, places: Vec<(f64, f64, T)>, size: i32) -> Option<T> {
    let mut best = None;
    let mut best_distance = f64::INFINITY;
    for (x, y, p) in places {
        let d = wrap_distance(size, (r.x as i32, r.y as i32), (x as i32, y as i32));
        if d < best_distance {
            best = Some(p);
            best_distance = d;
        }
    }
    best
}

/// Where a store order goes (`storePlace`): `to`, or the nearest finished storage of the sender's
/// side. A reason when there is none.
fn store_place(
    world: &WorldState,
    sender: &OrderSender,
    r: &Resident,
    to: Option<&Value>,
    size: i32,
) -> Result<GoodsPlace, String> {
    let side = side_of(world, sender);
    if let Some(to) = to.filter(|v| !v.is_null()) {
        return named_place(world, side.as_deref(), to)
            .ok_or_else(|| "to must be a storage, a stable, a carriage or a boat of yours".into());
    }
    let storages = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Storage
                && b.site.is_none()
                && side.is_some()
                && building_organization(world, b) == side
        })
        .map(|b| (b.x, b.y, b.id.clone()))
        .collect();
    nearest(r, storages, size)
        .map(|storage_id| GoodsPlace::Storage { storage_id })
        .ok_or_else(|| "no storage".into())
}

/// Where a fetch order goes (`fetchPlace`): `from`, or the nearest finished storage or carriage of
/// the sender's holding any of the goods. A reason when there is none.
fn fetch_place(
    world: &WorldState,
    sender: &OrderSender,
    r: &Resident,
    from: Option<&Value>,
    goods: &GoodsWanted,
    size: i32,
) -> Result<GoodsPlace, String> {
    let side = side_of(world, sender);
    if let Some(from) = from.filter(|v| !v.is_null()) {
        return named_place(world, side.as_deref(), from).ok_or_else(|| {
            "from must be a storage, a stable, a carriage or a boat of yours".into()
        });
    }
    let holds = |stock: &Stock| goods.keys().any(|g| held(stock, *g) > 0.0);
    let mut places: Vec<(f64, f64, GoodsPlace)> = world
        .buildings
        .iter()
        .filter(|b| {
            b.kind == BuildingKind::Storage
                && b.site.is_none()
                && side.is_some()
                && building_organization(world, b) == side
                && holds(&free_stock(world, &b.id, b.stock.as_ref()))
        })
        .map(|b| (b.x, b.y, GoodsPlace::Storage { storage_id: b.id.clone() }))
        .collect();
    places.extend(
        world
            .carriages
            .iter()
            .filter(|k| side.is_some() && carriage_organization(k) == side && holds(&k.load))
            .map(|k| (k.x, k.y, GoodsPlace::Carriage { carriage_id: k.id.clone() })),
    );
    nearest(r, places, size).ok_or_else(|| "nothing of yours holds those goods".into())
}

/// Checks what store and fetch orders share (`check`): the resident (an index) and goods.
fn check(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
) -> Result<(usize, GoodsWanted), String> {
    let o = &order.fields;
    let Some(ri) = ordered_resident(world, sender, o.get("residentId")) else {
        return Err("not one of your residents".into());
    };
    let Some(goods) = read_wanted(o.get("goods")) else {
        return Err("goods must be a list of goods, or whole units of known goods".into());
    };
    if !can_handle(world.residents[ri].born_at, world.tick as f64, goods.keys()) {
        return Err("children can’t store or fetch goods".into());
    }
    Ok((ri, goods))
}

/// A store order's `ownFood` (`readOwnFood`): absent, or units of zero or more; `Err` when it is
/// neither.
fn read_own_food(own_food: Option<&Value>) -> Result<Option<f64>, ()> {
    match own_food {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64() {
            Some(n) if n.is_finite() && n >= 0.0 => Ok(Some(n)),
            _ => Err(()),
        },
    }
}

/// Checks a store order (`store.validate`): one of the Player's residents walks to `to` (by
/// default the nearest storage of their realm) and puts the goods down there.
pub fn validate_store(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    size: i32,
) -> Option<String> {
    let (ri, goods) = match check(world, sender, order) {
        Ok(c) => c,
        Err(e) => return Some(e),
    };
    let Ok(own_food) = read_own_food(order.fields.get("ownFood")) else {
        return Some("ownFood must be units of Food, zero or more".into());
    };
    let r = &world.residents[ri];
    if to_store(r, &goods, own_food).is_empty() {
        return Some("not carrying any of those goods".into());
    }
    store_place(world, sender, r, order.fields.get("to"), size).err()
}

/// Gives a store order (`store.apply`).
pub fn apply_store(world: &mut WorldState, sender: &OrderSender, order: &OrderRequest, size: i32) {
    let Ok((ri, goods)) = check(world, sender, order) else { return };
    let Ok(own_food) = read_own_food(order.fields.get("ownFood")) else { return };
    let Ok(to) = store_place(world, sender, &world.residents[ri], order.fields.get("to"), size)
    else {
        return;
    };
    let there = at_place(world, &world.residents[ri], &to);
    let r = &mut world.residents[ri];
    r.order_ended = None;
    r.order = Some(ResidentOrder::Store(StoreOrder {
        goods,
        to,
        phase: if there { StorePhase::Putting } else { StorePhase::Walking },
        own_food,
        path: None,
        progress: 0.0,
    }));
}

/// Checks a fetch order (`fetch.validate`): one of the Player's residents walks to `from` (by
/// default the nearest storage or carriage of their realm holding the goods) and takes them.
pub fn validate_fetch(
    world: &WorldState,
    sender: &OrderSender,
    order: &OrderRequest,
    size: i32,
) -> Option<String> {
    let (ri, goods) = match check(world, sender, order) {
        Ok(c) => c,
        Err(e) => return Some(e),
    };
    fetch_place(world, sender, &world.residents[ri], order.fields.get("from"), &goods, size).err()
}

/// Gives a fetch order (`fetch.apply`).
pub fn apply_fetch(world: &mut WorldState, sender: &OrderSender, order: &OrderRequest, size: i32) {
    let Ok((ri, goods)) = check(world, sender, order) else { return };
    let r = &world.residents[ri];
    let Ok(from) = fetch_place(world, sender, r, order.fields.get("from"), &goods, size) else {
        return;
    };
    let there = at_place(world, r, &from);
    let r = &mut world.residents[ri];
    r.order_ended = None;
    r.order = Some(ResidentOrder::Fetch(FetchOrder {
        goods,
        from,
        phase: if there { FetchPhase::Taking } else { FetchPhase::Walking },
        path: None,
        progress: 0.0,
    }));
}

/// A store or fetch order's place (`placeOf`).
pub fn place_of(o: &ResidentOrder) -> Option<&GoodsPlace> {
    match o {
        ResidentOrder::Store(s) => Some(&s.to),
        ResidentOrder::Fetch(f) => Some(&f.from),
        _ => None,
    }
}

/// Ends the resident's order (`endOrder`). A store or fetch order says how it ended: `reason`
/// `None` when it was done, else why not.
pub fn end_order(world: &mut WorldState, ri: usize, reason: Option<String>) {
    let tick = world.tick as f64;
    let r = &mut world.residents[ri];
    let kind = match r.order {
        Some(ResidentOrder::Store(_)) => Some(OrderEndedKind::Store),
        Some(ResidentOrder::Fetch(_)) => Some(OrderEndedKind::Fetch),
        _ => None,
    };
    if let Some(kind) = kind {
        r.order_ended = Some(OrderEnded { kind, tick, reason });
    }
    r.order = None;
}

/// Whether the carriage a Player's resident stores at or fetches from was stolen since the order
/// was given (`carriageLost`).
fn carriage_lost(world: &WorldState, r: &Resident, place: &GoodsPlace) -> bool {
    let GoodsPlace::Carriage { carriage_id } = place else {
        return false;
    };
    let Some(k) = world.carriages.iter().find(|k| &k.id == carriage_id) else {
        return false;
    };
    commander_of_resident(world, r).is_some_and(|by| steals_carriage(world, &by, k))
}

/// Requests this tick's take and put actions from store and fetch orders at their place
/// (`requestStoring`). An order whose place is gone ends; one whose resident isn't at its place
/// walks there again.
pub fn request_storing(world: &mut WorldState) -> Vec<CarryAction> {
    let mut actions = Vec::new();
    for ri in 0..world.residents.len() {
        let Some(order) = world.residents[ri].order.clone() else { continue };
        let order = &order;
        let Some(place) = place_of(order).cloned() else { continue };
        let r = &world.residents[ri];
        if place_tile(world, &place).is_none() || carriage_lost(world, r, &place) {
            let reason = match place {
                GoodsPlace::Carriage { .. } => "the carriage is gone",
                GoodsPlace::Vessel { .. } => "the boat is gone",
                GoodsPlace::Storage { .. } => "the storage is gone",
            };
            end_order(world, ri, Some(reason.into()));
            continue;
        }
        let walking = match order {
            ResidentOrder::Store(s) => s.phase == StorePhase::Walking,
            ResidentOrder::Fetch(f) => f.phase == FetchPhase::Walking,
            _ => unreachable!(),
        };
        if walking {
            continue;
        }
        if !at_place(world, r, &place) {
            match world.residents[ri].order.as_mut() {
                Some(ResidentOrder::Store(s)) => {
                    s.phase = StorePhase::Walking;
                    s.path = None;
                    s.progress = 0.0;
                }
                Some(ResidentOrder::Fetch(f)) => {
                    f.phase = FetchPhase::Walking;
                    f.path = None;
                    f.progress = 0.0;
                }
                _ => {}
            }
            continue;
        }
        let spot = match &place {
            GoodsPlace::Storage { storage_id } => {
                GoodsSpot::Storage { storage_id: storage_id.clone() }
            }
            GoodsPlace::Carriage { carriage_id } => {
                GoodsSpot::Carriage { carriage_id: carriage_id.clone() }
            }
            GoodsPlace::Vessel { vessel_id } => GoodsSpot::Vessel { vessel_id: vessel_id.clone() },
        };
        let (kind, goods) = match order {
            // As many as there are: take clips them to what is there and fits.
            ResidentOrder::Fetch(f) => (
                CarryKind::Take,
                f.goods.iter().map(|(g, u)| (*g, u.unwrap_or(AS_MANY_AS_THERE_ARE))).collect(),
            ),
            ResidentOrder::Store(s) if s.phase == StorePhase::Putting => {
                (CarryKind::Put, to_store(r, &s.goods, s.own_food))
            }
            ResidentOrder::Store(s) => {
                let want = 0f64.max(s.own_food.unwrap_or(OWN_FOOD) - held(&r.carried, Good::Food));
                (CarryKind::Take, Stock::from([(Good::Food, want)]))
            }
            _ => unreachable!(),
        };
        actions.push(CarryAction { kind, resident_id: r.id.clone(), spot, goods });
    }
    actions
}

/// After a store or fetch order's take or put (`carriedForOrder`): a store at a storage with Food
/// goes on to top up own food when it is short; otherwise the order is done.
pub fn carried_for_order(world: &mut WorldState, ri: usize) {
    let r = &world.residents[ri];
    if let Some(ResidentOrder::Store(o)) = &r.order {
        if o.phase == StorePhase::Putting {
            let food = match &o.to {
                GoodsPlace::Storage { .. } => {
                    place_stock(world, &o.to).flatten().map_or(0.0, |s| held(s, Good::Food))
                }
                GoodsPlace::Carriage { .. } | GoodsPlace::Vessel { .. } => 0.0,
            };
            let is_storage = match &o.to {
                GoodsPlace::Storage { storage_id } => world
                    .buildings
                    .iter()
                    .any(|b| &b.id == storage_id && b.kind == BuildingKind::Storage),
                GoodsPlace::Carriage { .. } | GoodsPlace::Vessel { .. } => false,
            };
            if is_storage
                && food > 0.0
                && held(&r.carried, Good::Food) < o.own_food.unwrap_or(OWN_FOOD)
            {
                if let Some(ResidentOrder::Store(o)) = world.residents[ri].order.as_mut() {
                    o.phase = StorePhase::Refilling;
                }
                return;
            }
        }
    }
    if matches!(world.residents[ri].order, Some(ResidentOrder::Store(_) | ResidentOrder::Fetch(_)))
    {
        end_order(world, ri, None);
    }
}

/// The building `id`, if it is finished: a storage a store or fetch order may use
/// (`finishedStorage`).
fn finished_storage<'w>(world: &'w WorldState, id: &str) -> Option<&'w Building> {
    crate::world_index::building_by_id(world, id).filter(|b| b.site.is_none())
}

//! Loading a ship at its haven (`CONTEXT.md`: Docked, Haven): those at the haven a ship is docked
//! at move goods straight between the haven's storage and the ship, the load order. They need not
//! carry them over: as much as the ship (or the haven) takes moves at once, by the take and put
//! actions of carrying (`carrying.rs`), so taking from another city's haven is judged as taking
//! from any storage.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::{GoodsSpot, OrderRequest, Stock, VesselKind, WorldState};

use crate::carrying::{read_goods, resolve_carrying_on, CarryAction, CarryKind};
use crate::order_sender::{ordered_resident, OrderSender};
use crate::orders::{bool_field, str_field, OrderKind};
use crate::queries::goods::{can_handle, free_stock};
use crate::queries::names::held;
use crate::queries::vessels::{
    docked_at, resident_beside_vessel, vessel_by_id, vessel_of_resident,
};

/// The most take-and-put rounds one load order makes: goods move a resident's hands' worth at a
/// time, and a full ship is many of them.
const MAX_ROUNDS: usize = 1000;

/// The load order (`load`): one of the Player's residents at the haven a ship of their realm is
/// docked at moves `goods` from the haven's storage onto the ship, or with `unload` off the ship
/// into the haven's storage, as many as there are and fit. What they were doing stops.
pub struct Load;

/// The resident (an index), the ship (an index), the haven's storage id and the goods.
type Checked = (usize, usize, String, Stock);

impl Load {
    fn check(
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
    ) -> Result<Checked, String> {
        let Some(ri) = ordered_resident(world, sender, str_field(order, "residentId")) else {
            return Err("not one of your residents".into());
        };
        let r = &world.residents[ri];
        let Some(v) = str_field(order, "vesselId").and_then(|id| vessel_by_id(world, id)) else {
            return Err("no such ship".into());
        };
        let Some(goods) = read_goods(order.fields.get("goods")) else {
            return Err("goods must be whole units of known goods".into());
        };
        if v.kind != VesselKind::Ship {
            return Err("only a ship loads at a haven: a boat is loaded by hand".into());
        }
        if !vessel_of_resident(v, r) {
            return Err("not a ship of your realm".into());
        }
        let Some(haven) = docked_at(world, v) else {
            return Err("the ship is not docked at a haven".into());
        };
        if !resident_beside_vessel(world, v, r) {
            return Err("not at the haven the ship is docked at".into());
        }
        if !can_handle(r.born_at, world.tick as f64, goods.keys()) {
            return Err("children can’t pick up or put down goods".into());
        }
        let unload = bool_field(order, "unload") == Some(true);
        let from = if unload {
            v.load.clone()
        } else {
            free_stock(world, &haven.id, haven.stock.as_ref())
        };
        if !goods.keys().any(|g| held(&from, *g) > 0.0) {
            return Err(if unload {
                "none of those goods aboard the ship".into()
            } else {
                "none of those goods in the haven".into()
            });
        }
        let vi = world.vessels.iter().position(|x| x.id == v.id).expect("a vessel");
        Ok((ri, vi, haven.id.clone(), goods))
    }
}

impl OrderKind for Load {
    fn validate(
        &self,
        world: &WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        _terrain: Option<&TerrainMap>,
    ) -> Option<String> {
        Load::check(world, sender, order).err()
    }

    fn apply(
        &self,
        world: &mut WorldState,
        sender: &OrderSender,
        order: &OrderRequest,
        terrain: Option<&TerrainMap>,
    ) {
        let Ok((ri, vi, haven, goods)) = Load::check(world, sender, order) else { return };
        world.residents[ri].order = None;
        let ship = GoodsSpot::Vessel { vessel_id: world.vessels[vi].id.clone() };
        let storage = GoodsSpot::Storage { storage_id: haven };
        let (from, to) = if bool_field(order, "unload") == Some(true) {
            (ship, storage)
        } else {
            (storage, ship)
        };
        let size = terrain.map_or(csp_shared::balance::MAP_SIZE, |t| t.size);
        move_straight(world, ri, &from, &to, goods, size, terrain);
    }
}

/// Moves up to `goods` from the spot `from` to the spot `to`, both at the resident's place, a
/// handful at a time through their hands; what `to` won't take goes back to `from`.
pub(crate) fn move_straight(
    world: &mut WorldState,
    ri: usize,
    from: &GoodsSpot,
    to: &GoodsSpot,
    mut goods: Stock,
    size: i32,
    terrain: Option<&TerrainMap>,
) {
    let rid = world.residents[ri].id.clone();
    let action = |kind, spot: &GoodsSpot, goods: Stock| CarryAction {
        kind,
        resident_id: rid.clone(),
        spot: spot.clone(),
        goods,
    };
    for _ in 0..MAX_ROUNDS {
        if goods.is_empty() {
            return;
        }
        let before = world.residents[ri].carried.clone();
        resolve_carrying_on(world, &[action(CarryKind::Take, from, goods.clone())], size, terrain);
        let taken = gained(&before, &world.residents[ri].carried);
        if taken.is_empty() {
            return;
        }
        let holding = world.residents[ri].carried.clone();
        resolve_carrying_on(world, &[action(CarryKind::Put, to, taken.clone())], size, terrain);
        let put = gained(&world.residents[ri].carried, &holding);
        let left = gained(&put, &taken);
        if !left.is_empty() {
            // What has no room there goes back where it came from, and the moving stops.
            resolve_carrying_on(world, &[action(CarryKind::Put, from, left)], size, terrain);
            return;
        }
        for (good, units) in &put {
            let rest = held(&goods, *good) - units;
            if rest > 0.0 {
                goods.insert(*good, rest);
            } else {
                goods.shift_remove(good);
            }
        }
    }
}

/// How much more of each good `after` holds than `before`.
fn gained(before: &Stock, after: &Stock) -> Stock {
    after
        .iter()
        .filter_map(|(g, n)| {
            let more = n - held(before, *g);
            (more > 0.0).then_some((*g, more))
        })
        .collect()
}

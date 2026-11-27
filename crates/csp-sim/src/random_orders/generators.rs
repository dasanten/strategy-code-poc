//! How the random-order run makes a request of each order kind (T125.2): one entry per kind in
//! [`GENERATORS`], which says who the request is for and what its fields name, drawn from the
//! world as it stands. A kind of the run's registry without an entry fails
//! `every_order_kind_has_a_generator_entry`; one whose requests are never accepted over the fixed
//! seeds fails `every_order_kind_is_accepted`.
//!
//! An entry aims at a request that can be accepted (a resident standing where the kind needs,
//! ids of the right things); the run then spoils some of them ([`super::spoil`]) so the refusals
//! are tried too.

use csp_shared::footprint::covers;
use csp_shared::terrain::{Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, ContractSide, Good, Resident, SiegeMachineKind, VesselKind,
    WorldState,
};
use serde_json::{json, Map, Value};

use super::world::PLACED;
use super::Draws;
use crate::queries::names::placed as footprint;
use crate::queries::residents::{can_work, is_down};

/// What an entry draws from: the run's draws, the world, and the resident drawn for the request,
/// of the realm whose Player sends it.
pub struct Gen<'a> {
    pub draws: std::cell::RefCell<&'a mut Draws>,
    pub world: &'a WorldState,
    pub terrain: &'a TerrainMap,
    pub me: &'a Resident,
    pub realm: &'a str,
    pub user: u64,
}

/// A request's fields but its kind; `residentId` is the drawn resident unless the entry says.
pub type Make = fn(&mut Gen) -> Map<String, Value>;

fn tile(x: f64, y: f64) -> (i32, i32) {
    (x.floor() as i32, y.floor() as i32)
}

fn r_tile(r: &Resident) -> (i32, i32) {
    tile(r.x, r.y)
}

fn b_tile(b: &Building) -> (i32, i32) {
    tile(b.x, b.y)
}

fn near8(a: (i32, i32), b: (i32, i32)) -> bool {
    a != b && (a.0 - b.0).abs() <= 1 && (a.1 - b.1).abs() <= 1
}

fn obj(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => Map::new(),
    }
}

fn name_of(g: Good) -> Value {
    serde_json::to_value(g).expect("a good")
}

/// A slot's goods, for equipping.
const GEAR: &[Good] = &[
    Good::Spear,
    Good::Sword,
    Good::SteelSword,
    Good::Bow,
    Good::Crossbow,
    Good::Shield,
    Good::SteelShield,
    Good::Armour,
    Good::SteelArmour,
];

const NAMES: &[&str] = &["Ash", "Brook", "Cole", "Dale", "Elm"];

impl<'a> Gen<'a> {
    fn chance(&self, p: f64) -> bool {
        self.draws.borrow_mut().chance(p)
    }

    fn between(&self, lo: i64, hi: i64) -> i64 {
        self.draws.borrow_mut().between(lo, hi)
    }

    fn pick<T: Clone>(&self, items: &[T]) -> Option<T> {
        self.draws.borrow_mut().pick(items).cloned()
    }

    fn name(&self) -> Value {
        json!(self.pick(NAMES).unwrap_or("Ash"))
    }

    fn size(&self) -> i32 {
        self.terrain.size
    }

    fn terrain_at(&self, (x, y): (i32, i32)) -> Option<u8> {
        let s = self.size();
        (0..s).contains(&x).then_some(())?;
        (0..s).contains(&y).then_some(())?;
        self.terrain.tiles.get((y * s + x) as usize).copied()
    }

    fn covers(&self, b: &Building, (x, y): (i32, i32)) -> bool {
        covers(footprint(b), x, y, self.size())
    }

    /// The realm's living residents that can act, the drawn one first.
    fn mine(&self) -> Vec<&'a Resident> {
        let mut v: Vec<&'a Resident> = self
            .world
            .residents
            .iter()
            .filter(|r| r.owner.as_deref() == Some(self.realm) && !is_down(r.down_until))
            .collect();
        v.sort_by_key(|r| r.id != self.me.id);
        v
    }

    fn grown(&self, r: &Resident) -> bool {
        can_work(r.born_at, self.world.tick as f64)
    }

    /// One of the realm's residents for which `fits` holds, the drawn one when it does.
    fn mine_where(&self, fits: impl Fn(&Gen, &Resident) -> bool) -> Option<&'a Resident> {
        let all = self.mine();
        let fitting: Vec<&'a Resident> = all.into_iter().filter(|r| fits(self, r)).collect();
        if fitting.first().is_some_and(|r| r.id == self.me.id) && self.chance(0.5) {
            return fitting.first().copied();
        }
        self.pick(&fitting)
    }

    /// The fields with `residentId` set to `r`'s (the drawn resident's when none fits).
    fn for_r(&self, r: Option<&Resident>, rest: Value) -> Map<String, Value> {
        let mut m = obj(rest);
        m.insert("residentId".into(), json!(r.map_or(&self.me.id, |r| &r.id)));
        m
    }

    fn me_tile(&self) -> (i32, i32) {
        r_tile(self.me)
    }

    /// A tile near `at`, by up to `reach` each way, on the map.
    fn near(&self, at: (i32, i32), reach: i64) -> (i32, i32) {
        let s = i64::from(self.size());
        let x = (i64::from(at.0) + self.between(-reach, reach)).clamp(0, s - 1);
        let y = (i64::from(at.1) + self.between(-reach, reach)).clamp(0, s - 1);
        (x as i32, y as i32)
    }

    /// Where something of the world is, near which a walk ends: anything with a place.
    fn somewhere(&self) -> (i32, i32) {
        let w = self.world;
        let lists: [Vec<(i32, i32)>; 6] = [
            w.buildings.iter().filter(|b| b.kind != BuildingKind::Wall).map(b_tile).collect(),
            w.residents.iter().map(r_tile).collect(),
            w.horses.iter().map(|h| tile(h.x, h.y)).collect(),
            w.carriages.iter().map(|c| tile(c.x, c.y)).collect(),
            w.siege_machines.iter().map(|m| tile(m.x, m.y)).collect(),
            w.vessels.iter().map(|v| tile(v.x, v.y)).collect(),
        ];
        let list = self.draws.borrow_mut().below(lists.len());
        let at = self.pick(&lists[list]).unwrap_or_else(|| self.me_tile());
        self.near(at, 2)
    }

    fn xy(&self, at: (i32, i32)) -> Value {
        json!({ "x": at.0, "y": at.1 })
    }

    fn realm_cities(&self, realm: &str) -> Vec<&'a str> {
        self.world
            .cities
            .iter()
            .filter(|c| c.realm_id.as_deref() == Some(realm))
            .map(|c| c.id.as_str())
            .collect()
    }

    fn my_city(&self) -> Value {
        let cities = self.realm_cities(self.realm);
        json!(self.pick(&cities).unwrap_or("nowhere"))
    }

    /// Another Player's realm.
    fn other_realm(&self) -> Option<&'a str> {
        let others: Vec<&'a str> = self
            .world
            .realms
            .iter()
            .map(|r| r.id.as_str())
            .filter(|r| *r != self.realm)
            .collect();
        self.pick(&others)
    }

    fn other_city(&self) -> Value {
        let other = self.other_realm().unwrap_or("nobody");
        let cities = self.realm_cities(other);
        json!(self.pick(&cities).unwrap_or("nowhere"))
    }

    /// The NPC cities (no realm, not the Trade Org's).
    fn npc_cities(&self) -> Vec<&'a str> {
        self.world
            .cities
            .iter()
            .filter(|c| c.realm_id.is_none() && c.trade_org.is_none())
            .map(|c| c.id.as_str())
            .collect()
    }

    /// Buildings of `kind` of the cities `cities`.
    fn buildings_of(&self, kind: BuildingKind, cities: &[&str]) -> Vec<&'a Building> {
        self.world
            .buildings
            .iter()
            .filter(|b| b.kind == kind && b.site.is_none())
            .filter(|b| b.city_id.as_deref().is_some_and(|c| cities.contains(&c)))
            .collect()
    }

    fn my_buildings(&self, kind: BuildingKind) -> Vec<&'a Building> {
        let cities = self.realm_cities(self.realm);
        self.buildings_of(kind, &cities)
    }

    fn my_storage(&self) -> Value {
        let s = self.my_buildings(BuildingKind::Storage);
        json!(self.pick(&s).map_or("nowhere", |b| b.id.as_str()))
    }

    /// A resident of the realm standing on one of `places`, and that place.
    fn on_one_of(&self, places: &[&'a Building]) -> (Option<&'a Resident>, Option<&'a Building>) {
        let places: Vec<&'a Building> = places.to_vec();
        let r = self.mine_where(|g, r| places.iter().any(|b| g.covers(b, r_tile(r))));
        let place = r.and_then(|r| places.iter().copied().find(|b| self.covers(b, r_tile(r))));
        (r, place.or_else(|| self.draws.borrow_mut().pick(&places).copied()))
    }

    /// The finished warehouses the Trade Org trades at.
    fn warehouses(&self) -> Vec<&'a Building> {
        self.world
            .buildings
            .iter()
            .filter(|b| b.kind == BuildingKind::Warehouse && b.site.is_none())
            .filter(|b| crate::queries::warehouse_trade::trading_warehouse_at(self.world, b.x, b.y).is_some())
            .collect()
    }

    /// A good `r` carries, but food when other goods are there.
    fn carried_good(&self, r: &Resident, but: &[Good]) -> Good {
        let goods: Vec<Good> =
            r.carried.iter().filter(|(g, n)| **n >= 1.0 && !but.contains(g)).map(|(g, _)| *g).collect();
        self.pick(&goods).unwrap_or(Good::Wood)
    }

    fn priced_good(&self) -> Good {
        self.pick(&csp_shared::goods::PRICED_GOODS).unwrap_or(Good::Wood)
    }

    fn other_good(&self, than: Good) -> Good {
        let goods: Vec<Good> = [Good::Coins, Good::Wood, Good::Food, Good::Stone, Good::Iron]
            .into_iter()
            .filter(|g| *g != than)
            .collect();
        self.pick(&goods).unwrap_or(Good::Coins)
    }

    /// A resident of another organisation in reach of the realm's.
    fn foreign_resident(&self) -> Option<&'a Resident> {
        let mine: Vec<(i32, i32)> = self.mine().iter().map(|r| r_tile(r)).collect();
        let realm = self.realm;
        let others: Vec<&'a Resident> = self
            .world
            .residents
            .iter()
            .filter(|r| r.owner.as_deref() != Some(realm))
            .filter(|r| {
                let at = r_tile(r);
                mine.iter().any(|m| (m.0 - at.0).abs().max((m.1 - at.1).abs()) <= 40)
            })
            .collect();
        self.pick(&others)
    }

    /// The walls, gates and towers of other cities than the realm's.
    fn foreign_walls(&self) -> Vec<&'a Building> {
        let mine = self.realm_cities(self.realm);
        self.world
            .buildings
            .iter()
            .filter(|b| {
                matches!(b.kind, BuildingKind::Wall | BuildingKind::Gate | BuildingKind::Tower)
                    && b.site.is_none()
                    && !b.city_id.as_deref().is_some_and(|c| mine.contains(&c))
            })
            .collect()
    }

    fn army(&self) -> Value {
        let realm = self.realm;
        let armies: Vec<&str> =
            self.world.armies.iter().filter(|a| a.realm_id == realm).map(|a| a.id.as_str()).collect();
        json!(self.pick(&armies).unwrap_or("no-army"))
    }

    fn alliance_of(&self, realm: &str) -> Option<&'a csp_shared::world::Alliance> {
        self.world.alliances.iter().find(|a| a.members.iter().any(|m| m.realm_id == realm))
    }

    /// Some of the realm's grown residents but its Leader, one to three, all of them armed.
    fn some_soldiers(&self) -> Vec<String> {
        let leader = self.leader().map(|r| r.id.clone());
        let fit: Vec<String> = self
            .mine()
            .into_iter()
            .filter(|r| self.grown(r) && Some(&r.id) != leader.as_ref())
            .map(|r| r.id.clone())
            .collect();
        let n = self.between(1, 3) as usize;
        let mut chosen = Vec::new();
        for _ in 0..n {
            if let Some(id) = self.pick(&fit) {
                if !chosen.contains(&id) {
                    chosen.push(id);
                }
            }
        }
        chosen
    }

    fn leader(&self) -> Option<&'a Resident> {
        let realm = self.world.realms.iter().find(|r| r.id == self.realm)?;
        self.world.residents.iter().find(|r| r.id == realm.leader_id)
    }

    /// Goods terms of an offer the realm can make from `storage`: what it holds, for coins or
    /// wood, which the residents placed at the other's storage carry.
    fn offer_terms(&self, storage: Option<&Building>) -> Map<String, Value> {
        let held: Vec<Good> = storage
            .and_then(|b| b.stock.as_ref())
            .map(|s| s.iter().filter(|(_, n)| **n >= 3.0).map(|(g, _)| *g).collect())
            .unwrap_or_default();
        let gives = self.pick(&held).unwrap_or(Good::Food);
        let wants = if gives == Good::Coins { Good::Wood } else { Good::Coins };
        obj(json!({
            "gives": name_of(gives), "givesUnits": self.between(1, 3),
            "wants": name_of(wants), "wantsUnits": self.between(1, 3), "times": self.between(1, 2),
        }))
    }

    /// The tile of a vessel or machine.
    fn sea_near(&self, at: (i32, i32)) -> (i32, i32) {
        for _ in 0..12 {
            let t = self.near(at, 4);
            if self.terrain_at(t) == Some(Terrain::Sea as u8) {
                return t;
            }
        }
        at
    }
}

/// A random step of a queue: an entry of a kind a queue may hold, without its resident, with a
/// duration so that no step waits for ever.
fn queue_steps(g: &mut Gen) -> Value {
    let kinds: Vec<&str> = crate::order_meta::ORDER_METAS
        .iter()
        .filter(|m| m.queue_step)
        .map(|m| m.kind)
        .filter(|k| GENERATORS.iter().any(|(n, _)| n == k) && !matches!(*k, "queue" | "editQueue"))
        .collect();
    let n = g.between(1, 3);
    let steps: Vec<Value> = (0..n)
        .map(|_| {
            let kind = g.pick(&kinds).unwrap_or("walkTo");
            let mut order = make(g, kind);
            order.remove("residentId");
            order.insert("kind".into(), json!(kind));
            let mut step = json!({ "order": order });
            if g.chance(0.8) {
                step["minutes"] = json!(g.between(1, 5));
            }
            step
        })
        .collect();
    json!(steps)
}

/// The fields of a request of `kind` (with `kind` left out), by its entry.
pub fn make(g: &mut Gen, kind: &str) -> Map<String, Value> {
    let make = GENERATORS.iter().find(|(k, _)| *k == kind).map(|(_, m)| *m);
    make.map_or_else(Map::new, |m| m(g))
}

/// Every kind the run gives, and how it makes a request of it. A new order kind needs an entry
/// here: who its request is for (a resident standing where the kind needs) and what its fields
/// name in the world (see the entries of kinds like it). If the world lacks what it needs, add it
/// to `random_orders/world.rs`.
pub static GENERATORS: &[(&str, Make)] = &[
    // Moving.
    ("walkTo", |g| {
        let at = if g.chance(0.7) { g.somewhere() } else { g.near(g.me_tile(), 6) };
        g.for_r(None, json!({ "x": at.0, "y": at.1 }))
    }),
    ("drive", |g| {
        let carts = &g.world.carriages;
        let realm = g.realm;
        let r = g.mine_where(|g, r| {
            g.grown(r)
                && carts.iter().any(|c| c.realm_id.as_deref() == Some(realm) && tile(c.x, c.y) == r_tile(r))
        });
        let cart = r.and_then(|r| carts.iter().find(|c| tile(c.x, c.y) == r_tile(r)));
        let to = g.near(r.map_or(g.me_tile(), r_tile), 5);
        g.for_r(r, json!({ "carriageId": cart.map(|c| c.id.as_str()), "x": to.0, "y": to.1 }))
    }),
    ("mount", |g| {
        let horses = &g.world.horses;
        let realm = g.realm;
        let free = |h: &&csp_shared::world::Horse| {
            h.realm_id.as_deref() == Some(realm)
                && !g.world.carriages.iter().any(|c| c.horse_id.as_deref() == Some(h.id.as_str()))
        };
        let pairs: Vec<(&Resident, &str)> = g
            .mine()
            .into_iter()
            .filter(|r| r.riding.is_none())
            .filter_map(|r| horses.iter().filter(free).find(|h| tile(h.x, h.y) == r_tile(r)).map(|h| (r, h.id.as_str())))
            .collect();
        let pair = g.pick(&pairs);
        g.for_r(pair.map(|p| p.0), json!({ "horseId": pair.map(|p| p.1) }))
    }),
    ("dismount", |g| {
        let r = g.mine_where(|_, r| r.riding.is_some());
        g.for_r(r, json!({}))
    }),
    ("unhitch", |g| {
        let carts = &g.world.carriages;
        let realm = g.realm;
        let on = |r: &Resident| {
            carts.iter().find(|c| {
                c.realm_id.as_deref() == Some(realm) && c.horse_id.is_some() && tile(c.x, c.y) == r_tile(r)
            })
        };
        let r = g.mine_where(|g, r| g.grown(r) && on(r).is_some());
        g.for_r(r, json!({ "carriageId": r.and_then(on).map(|c| c.id.as_str()) }))
    }),
    ("hitch", |g| {
        let w = g.world;
        let realm = g.realm;
        let pair = |r: &Resident| {
            let c = w.carriages.iter().find(|c| {
                c.realm_id.as_deref() == Some(realm) && c.horse_id.is_none() && tile(c.x, c.y) == r_tile(r)
            })?;
            let h = w.horses.iter().find(|h| {
                h.realm_id == c.realm_id
                    && h.city_id == c.city_id
                    && tile(h.x, h.y) == tile(c.x, c.y)
                    && !w.residents.iter().any(|r| r.riding.as_deref() == Some(h.id.as_str()))
            })?;
            Some((c.id.as_str(), h.id.as_str()))
        };
        let r = g.mine_where(|g, r| g.grown(r) && pair(r).is_some());
        let p = r.and_then(pair);
        g.for_r(r, json!({ "carriageId": p.map(|p| p.0), "horseId": p.map(|p| p.1) }))
    }),
    ("board", |g| {
        let w = g.world;
        let realm = g.realm;
        let what = |g: &Gen, r: &Resident| -> Option<Value> {
            if r.aboard.is_some() || r.riding.is_some() {
                return None;
            }
            if let Some(c) = w.carriages.iter().find(|c| c.realm_id.as_deref() == Some(realm) && tile(c.x, c.y) == r_tile(r)) {
                return Some(json!({ "carriageId": c.id }));
            }
            w.vessels.iter().filter(|v| v.realm_id.as_deref() == Some(realm)).find_map(|v| {
                let at = tile(v.x, v.y);
                match v.kind {
                    VesselKind::Boat if near8(at, r_tile(r)) => Some(json!({ "vesselId": v.id })),
                    VesselKind::Ship
                        if w.buildings.iter().any(|b| b.kind == BuildingKind::Haven && g.covers(b, r_tile(r))) =>
                    {
                        Some(json!({ "vesselId": v.id, "asCrew": true }))
                    }
                    _ => None,
                }
            })
        };
        let r = g.mine_where(|g, r| what(g, r).is_some());
        let fields = r.and_then(|r| what(g, r)).unwrap_or(json!({ "vesselId": "none" }));
        g.for_r(r, fields)
    }),
    ("getOff", |g| {
        let r = g.mine_where(|_, r| r.aboard.is_some());
        g.for_r(r, json!({}))
    }),
    ("load", |g| {
        let havens: Vec<&Building> = g.world.buildings.iter().filter(|b| b.kind == BuildingKind::Haven).collect();
        let (r, haven) = g.on_one_of(&havens);
        let ship = g.world.vessels.iter().find(|v| v.kind == VesselKind::Ship && v.realm_id.as_deref() == Some(g.realm));
        let unload = ship.is_some_and(|s| !s.load.is_empty()) && g.chance(0.4);
        let good = if unload {
            ship.and_then(|s| s.load.keys().next().copied()).unwrap_or(Good::Wood)
        } else {
            haven.and_then(|h| h.stock.as_ref()).and_then(|s| s.keys().next().copied()).unwrap_or(Good::Wood)
        };
        let goods = json!({ name_of(good).as_str().unwrap_or("wood"): g.between(1, 4) });
        g.for_r(r, json!({ "vesselId": ship.map(|s| s.id.as_str()), "goods": goods, "unload": unload }))
    }),
    ("row", |g| {
        let w = g.world;
        let realm = g.realm;
        let boat = |r: &Resident| {
            w.vessels.iter().find(|v| {
                v.kind == VesselKind::Boat
                    && v.realm_id.as_deref() == Some(realm)
                    && (r.aboard.as_deref() == Some(v.id.as_str()) || (r.aboard.is_none() && near8(tile(v.x, v.y), r_tile(r))))
            })
        };
        let r = g.mine_where(|g, r| g.grown(r) && boat(r).is_some());
        let b = r.and_then(boat);
        let to = g.sea_near(b.map_or(g.me_tile(), |b| tile(b.x, b.y)));
        g.for_r(r, json!({ "vesselId": b.map(|b| b.id.as_str()), "x": to.0, "y": to.1 }))
    }),
    ("sail", |g| {
        let w = g.world;
        let ship = |r: &Resident| {
            w.vessels.iter().find(|v| v.kind == VesselKind::Ship && r.aboard.as_deref() == Some(v.id.as_str()) && v.crew_ids.contains(&r.id))
        };
        let r = g.mine_where(|_, r| ship(r).is_some());
        let s = r.and_then(ship);
        let to = g.sea_near(s.map_or(g.me_tile(), |s| tile(s.x, s.y)));
        g.for_r(r, json!({ "vesselId": s.map(|s| s.id.as_str()), "x": to.0, "y": to.1 }))
    }),
    // Siege machines.
    ("crew", |g| {
        let realm = g.realm;
        let machines: Vec<&str> = g.world.siege_machines.iter().filter(|m| m.realm_id.as_deref() == Some(realm)).map(|m| m.id.as_str()).collect();
        let r = g.mine_where(|g, r| g.grown(r) && !r.id.starts_with(PLACED));
        let m = g.pick(&machines);
        g.for_r(r, json!({ "machineId": m }))
    }),
    ("push", |g| siege(g, None)),
    ("ram", |g| siege(g, Some(SiegeMachineKind::Ram))),
    ("throw", |g| siege(g, Some(SiegeMachineKind::Catapult))),
    // Goods.
    ("haul", |g| {
        let carts = &g.world.carriages;
        let realm = g.realm;
        let r = g.mine_where(|g, r| {
            g.grown(r) && r.carrying.is_none()
                && carts.iter().any(|c| c.realm_id.as_deref() == Some(realm) && tile(c.x, c.y) == r_tile(r))
        });
        let cart = r.and_then(|r| carts.iter().find(|c| tile(c.x, c.y) == r_tile(r)));
        let to = g.near(r.map_or(g.me_tile(), r_tile), 6);
        let good = g.pick(&[Good::Wood, Good::Food, Good::Stone]).unwrap_or(Good::Wood);
        g.for_r(r, json!({
            "carriageId": cart.map(|c| c.id.as_str()), "x": to.0, "y": to.1,
            "goods": [name_of(good)], "keepFood": g.between(0, 2),
        }))
    }),
    ("stop", |g| g.for_r(None, json!({}))),
    ("pickUp", |g| {
        let w = g.world;
        let keeps: Vec<&Building> = w
            .buildings
            .iter()
            .filter(|b| csp_shared::building_spec::KEEPS_GOODS.contains(&b.kind) && b.stock.as_ref().is_some_and(|s| !s.is_empty()))
            .collect();
        let on_pile = |r: &Resident| w.piles.iter().find(|p| tile(p.x, p.y) == r_tile(r) && !p.goods.is_empty());
        if g.chance(0.4) {
            if let Some(r) = g.mine_where(|_, r| on_pile(r).is_some()) {
                let good = on_pile(r).and_then(|p| p.goods.keys().next().copied()).unwrap_or(Good::Wood);
                let goods = json!({ name_of(good).as_str().unwrap_or("wood"): 1 });
                return g.for_r(Some(r), json!({ "spot": { "kind": "ground" }, "goods": goods }));
            }
        }
        let (r, b) = g.on_one_of(&keeps);
        let good = b.and_then(|b| b.stock.as_ref()).and_then(|s| s.keys().next().copied()).unwrap_or(Good::Wood);
        let goods = json!({ name_of(good).as_str().unwrap_or("wood"): g.between(1, 3) });
        g.for_r(r, json!({ "spot": { "kind": "storage", "storageId": b.map(|b| b.id.as_str()) }, "goods": goods }))
    }),
    ("drop", |g| {
        let r = g.mine_where(|_, r| r.carried.values().any(|n| *n >= 1.0));
        let good = g.carried_good(r.unwrap_or(g.me), &[]);
        let goods = json!({ name_of(good).as_str().unwrap_or("wood"): 1 });
        g.for_r(r, json!({ "spot": { "kind": "ground" }, "goods": goods }))
    }),
    ("store", |g| {
        let r = g.mine_where(|_, r| r.carried.iter().any(|(k, n)| *k != Good::Food && *n >= 1.0));
        let good = g.carried_good(r.unwrap_or(g.me), &[Good::Food]);
        let mut fields = json!({ "goods": [name_of(good)] });
        if g.chance(0.4) {
            fields["to"] = g.my_storage();
        }
        g.for_r(r, fields)
    }),
    ("fetch", |g| {
        let good = g.pick(&[Good::Wood, Good::Food, Good::Stone, Good::Coins]).unwrap_or(Good::Wood);
        let r = g.mine_where(|g, r| g.grown(r) && r.carrying.is_none());
        let mut fields = json!({ "goods": [name_of(good)] });
        if g.chance(0.4) {
            fields["from"] = g.my_storage();
        }
        g.for_r(r, fields)
    }),
    ("equip", |g| {
        let r = g.mine_where(|_, r| GEAR.iter().filter(|k| r.carried.get(*k).is_some_and(|n| *n >= 1.0)).count() >= 2);
        let carried: Vec<Good> = GEAR.iter().copied().filter(|k| r.unwrap_or(g.me).carried.contains_key(k)).collect();
        let good = g.pick(&carried).unwrap_or(Good::Spear);
        g.for_r(r, json!({ "good": name_of(good) }))
    }),
    ("takeOff", |g| {
        let slot = g.pick(&["weapon", "shield", "armour"]).unwrap_or("weapon");
        g.for_r(None, json!({ "slot": slot }))
    }),
    ("feed", |g| {
        let w = g.world;
        let hungry = |at: (i32, i32)| {
            w.horses
                .iter()
                .filter(|h| h.hunger < csp_shared::balance::MAX_HUNGER - 20.0)
                .map(|h| h.id.as_str())
                .chain(w.residents.iter().filter(|r| is_down(r.down_until)).map(|r| r.id.as_str()))
                .find(|id| {
                    let p = w.horses.iter().find(|h| h.id == *id).map(|h| tile(h.x, h.y))
                        .or_else(|| w.residents.iter().find(|r| r.id == *id).map(r_tile));
                    p.is_some_and(|p| p == at || near8(p, at))
                })
        };
        let r = g.mine_where(|g, r| g.grown(r) && r.carried.get(&Good::Food).is_some_and(|n| *n >= 1.0) && hungry(r_tile(r)).is_some());
        let target = r.and_then(|r| hungry(r_tile(r)));
        g.for_r(r, json!({ "targetId": target, "units": g.between(1, 2) }))
    }),
    // Building and work.
    ("build", |g| {
        let kind = g.pick(&["road", "road", "wall", "storage", "house"]).unwrap_or("road");
        let r = g.mine_where(|g, r| g.grown(r) && r.carrying.is_none() && !g.world.buildings.iter().any(|b| g.covers(b, r_tile(r))));
        let mut fields = json!({ "building": kind });
        if kind == "wall" {
            fields["material"] = json!(g.pick(&["wood", "stone"]));
        }
        g.for_r(r, fields)
    }),
    ("tearDown", |g| {
        let w = g.world;
        let on = |g: &Gen, r: &Resident| {
            w.buildings.iter().find(|b| {
                g.covers(b, r_tile(r))
                    && !matches!(b.kind, BuildingKind::TownHall | BuildingKind::Warehouse)
            })
        };
        let r = g.mine_where(|g, r| g.grown(r) && r.carrying.is_none() && on(g, r).is_some());
        let b = r.and_then(|r| on(g, r));
        g.for_r(r, json!({ "buildingId": b.map(|b| b.id.as_str()) }))
    }),
    ("repair", |g| {
        let w = g.world;
        let worn = |g: &Gen, r: &Resident| {
            w.buildings.iter().find(|b| b.decay.is_some_and(|d| d >= 0.25) && g.covers(b, r_tile(r)))
        };
        let r = g.mine_where(|g, r| g.grown(r) && worn(g, r).is_some());
        let b = r.and_then(|r| worn(g, r));
        g.for_r(r, json!({ "buildingId": b.map(|b| b.id.as_str()) }))
    }),
    ("workAt", |g| {
        let w = g.world;
        let at = |g: &Gen, r: &Resident| {
            w.buildings.iter().find(|b| {
                b.site.is_none()
                    && crate::queries::building::max_workers(b.kind).is_some()
                    && g.covers(b, r_tile(r))
            })
        };
        let r = g.mine_where(|g, r| g.grown(r) && r.carrying.is_none() && at(g, r).is_some());
        let b = r.and_then(|r| at(g, r));
        let mut fields = json!({});
        if b.is_some_and(|b| b.kind != BuildingKind::Farm) || g.chance(0.1) {
            fields["makes"] = name_of(g.priced_good());
        }
        g.for_r(r, fields)
    }),
    ("gather", |g| {
        let on = |g: &Gen, r: &Resident| {
            let t = g.terrain_at(r_tile(r));
            (t == Some(Terrain::Forest as u8) || t == Some(Terrain::Hills as u8))
                && !g.world.buildings.iter().any(|b| g.covers(b, r_tile(r)))
        };
        let r = g.mine_where(|g, r| g.grown(r) && r.carrying.is_none() && on(g, r));
        let hills = r.is_some_and(|r| g.terrain_at(r_tile(r)) == Some(Terrain::Hills as u8));
        let good = if hills { "stone" } else { g.pick(&["wood", "food"]).unwrap_or("wood") };
        g.for_r(r, json!({ "good": good }))
    }),
    ("teach", |g| training(g, true)),
    ("train", |g| training(g, false)),
    ("breed", |g| {
        let w = g.world;
        let realm = g.realm;
        let stables: Vec<&Building> = w.buildings.iter().filter(|b| b.kind == BuildingKind::Stable && b.site.is_none()).collect();
        let (r, stable) = g.on_one_of(&stables);
        let horses: Vec<&str> = w
            .horses
            .iter()
            .filter(|h| h.realm_id.as_deref() == Some(realm) && stable.is_some_and(|s| g.covers(s, tile(h.x, h.y))))
            .map(|h| h.id.as_str())
            .collect();
        g.for_r(r, json!({ "stableId": stable.map(|s| s.id.as_str()), "horseIds": horses.iter().take(2).collect::<Vec<_>>() }))
    }),
    ("pair", |g| {
        let mine = g.mine();
        let fit: Vec<&Resident> = mine.into_iter().filter(|r| g.grown(r) && r.city_id.is_some() && r.carrying.is_none()).collect();
        let a = g.pick(&fit);
        let partners: Vec<&Resident> = fit.iter().copied().filter(|p| a.is_some_and(|a| a.id != p.id && a.city_id == p.city_id)).collect();
        let b = g.pick(&partners);
        g.for_r(a, json!({ "partnerId": b.map(|b| b.id.as_str()) }))
    }),
    ("roadLine", |g| line(g, "road")),
    ("wallLine", |g| line(g, "wall")),
    ("setGate", |g| {
        let gates = g.my_buildings(BuildingKind::Gate);
        let gate = g.pick(&gates);
        obj(json!({ "gateId": gate.map(|b| b.id.as_str()), "open": g.chance(0.5) }))
    }),
    // Fighting.
    ("attack", |g| {
        let target = if g.chance(0.7) {
            g.foreign_resident().map(|r| r.id.clone())
        } else {
            let walls = g.foreign_walls();
            g.pick(&walls).map(|b| b.id.clone())
        };
        g.for_r(None, json!({ "targetId": target }))
    }),
    ("climb", |g| {
        let walls = g.foreign_walls();
        let by = |r: &Resident| {
            let at = r_tile(r);
            walls.iter().find(|b| {
                b.kind != BuildingKind::Tower && {
                    let t = b_tile(b);
                    (t.0 - at.0).abs() + (t.1 - at.1).abs() == 1
                }
            })
        };
        let r = g.mine_where(|_, r| by(r).is_some());
        let wall = r.and_then(by);
        g.for_r(r, json!({ "wallId": wall.map(|b| b.id.as_str()) }))
    }),
    // Queues.
    ("queue", |g| {
        let r = g.mine_where(|g, r| g.grown(r) && !r.id.starts_with(PLACED));
        let steps = queue_steps(g);
        g.for_r(r, json!({ "steps": steps, "loop": g.chance(0.5) }))
    }),
    ("editQueue", |g| {
        let r = g.mine_where(|_, r| r.queue.is_some());
        let steps = queue_steps(g);
        g.for_r(r, json!({ "steps": steps }))
    }),
    // Scripts, as the game's default scripts (`random_orders` runs them with `DefaultScripts`).
    ("runScript", |g| {
        let task = g.pick(&[csp_shared::world::Task::Explore, csp_shared::world::Task::Defend]).expect("a task");
        let id = crate::script_runner::default_host::default_script_id(g.user, task);
        let r = g.mine_where(|g, r| g.grown(r) && !r.id.starts_with(PLACED));
        g.for_r(r, json!({ "scriptId": id }))
    }),
    ("setDefenceScript", |g| {
        let id = crate::script_runner::default_host::default_script_id(g.user, csp_shared::world::Task::Defend);
        let script = if g.chance(0.2) { Value::Null } else { json!(id) };
        g.for_r(None, json!({ "scriptId": script }))
    }),
    ("setAlarmScript", |g| {
        let id = crate::script_runner::default_host::default_script_id(g.user, csp_shared::world::Task::Alarm);
        let script = if g.chance(0.2) { json!("none") } else { json!(id) };
        g.for_r(None, json!({ "scriptId": script }))
    }),
    ("task", |g| {
        let w = g.world;
        let farm = |g: &Gen, r: &Resident| {
            w.buildings.iter().find(|b| b.kind == BuildingKind::Farm && b.site.is_none() && g.covers(b, r_tile(r)))
        };
        if g.chance(0.6) {
            let r = g.mine_where(|g, r| g.grown(r) && r.carrying.is_none() && farm(g, r).is_some());
            let b = r.and_then(|r| farm(g, r));
            return g.for_r(r, json!({ "task": "work", "workplaceId": b.map(|b| b.id.as_str()) }));
        }
        let task = g.pick(&["explore", "defend"]).unwrap_or("explore");
        let r = g.mine_where(|g, r| g.grown(r) && !r.id.starts_with(PLACED));
        g.for_r(r, json!({ "task": task }))
    }),
    // Trade.
    ("buy", |g| trade(g, false)),
    ("sell", |g| trade(g, true)),
    ("swap", |g| {
        let warehouses = g.warehouses();
        let (r, _) = g.on_one_of(&warehouses);
        let give = g.carried_good(r.unwrap_or(g.me), &[Good::Coins, Good::Food]);
        let want = g.other_good(give);
        g.for_r(r, json!({ "give": name_of(give), "want": name_of(want), "units": 1 }))
    }),
    ("buyHorse", |g| {
        let w = g.world;
        let npc = g.npc_cities();
        let stables = g.buildings_of(BuildingKind::Stable, &npc);
        let (r, stable) = g.on_one_of(&stables);
        let horses: Vec<&str> = w
            .horses
            .iter()
            .filter(|h| h.realm_id.is_none() && stable.is_some_and(|s| g.covers(s, tile(h.x, h.y))))
            .map(|h| h.id.as_str())
            .collect();
        let h = g.pick(&horses);
        g.for_r(r, json!({ "horseId": h }))
    }),
    ("sellHorse", |g| {
        let w = g.world;
        let realm = g.realm;
        let npc = g.npc_cities();
        let stables = g.buildings_of(BuildingKind::Stable, &npc);
        let mine: Vec<&csp_shared::world::Horse> = w
            .horses
            .iter()
            .filter(|h| h.realm_id.as_deref() == Some(realm) && stables.iter().any(|s| g.covers(s, tile(h.x, h.y))))
            .collect();
        let h = g.pick(&mine);
        let r = g.mine_where(|_, r| h.is_some_and(|h| tile(h.x, h.y) == r_tile(r)));
        g.for_r(r, json!({ "horseId": h.map(|h| h.id.as_str()) }))
    }),
    ("buyCity", |g| {
        let npc = g.npc_cities();
        let halls: Vec<&Building> = g.world.buildings.iter().filter(|b| b.kind == BuildingKind::TownHall && b.city_id.as_deref().is_some_and(|c| npc.contains(&c))).collect();
        let (r, hall) = g.on_one_of(&halls);
        g.for_r(r, json!({ "cityId": hall.and_then(|h| h.city_id.as_deref()) }))
    }),
    ("handIn", |g| {
        let warehouses = g.warehouses();
        let (r, _) = g.on_one_of(&warehouses);
        let good = g.carried_good(r.unwrap_or(g.me), &[Good::Coins]);
        g.for_r(r, json!({ "good": name_of(good), "units": g.between(1, 2), "toCityId": g.other_city() }))
    }),
    ("transfer", |g| {
        let good = g.pick(&[Good::Wood, Good::Food, Good::Stone]).unwrap_or(Good::Wood);
        obj(json!({ "fromCityId": g.my_city(), "good": name_of(good), "units": g.between(1, 3), "toCityId": g.other_city() }))
    }),
    ("buyOff", |g| {
        let realm = g.realm;
        let d = g.world.directives.iter().find(|d| d.target == realm).map(|d| d.id.clone());
        let warehouses = g.warehouses();
        let (r, _) = g.on_one_of(&warehouses);
        g.for_r(r, json!({ "directiveId": d }))
    }),
    ("payDebt", |g| {
        let warehouses = g.warehouses();
        let (r, _) = g.on_one_of(&warehouses);
        g.for_r(r, json!({ "coins": g.between(1, 10) }))
    }),
    // Offers.
    ("postOffer", |g| {
        let storages = g.my_buildings(BuildingKind::Storage);
        let s = g.pick(&storages);
        let mut fields = g.offer_terms(s);
        fields.insert("storageId".into(), json!(s.map(|s| s.id.as_str())));
        fields
    }),
    ("takeDownOffer", |g| {
        let realm = g.realm;
        let offers: Vec<&str> = g.world.offers.iter().filter(|o| o.realm_id == realm).map(|o| o.id.as_str()).collect();
        obj(json!({ "offerId": g.pick(&offers) }))
    }),
    ("acceptOffer", |g| {
        let w = g.world;
        let realm = g.realm;
        let open: Vec<&csp_shared::world::Offer> = w.offers.iter().filter(|o| o.realm_id != realm && o.direct.as_ref().is_none_or(|d| d.to_id == realm && d.carried.is_none())).collect();
        let at = |g: &Gen, r: &Resident| {
            open.iter().copied().find(|o| {
                w.buildings.iter().any(|b| b.id == o.storage_id && g.covers(b, r_tile(r)))
                    && r.carried.get(&o.wants).is_some_and(|n| *n >= o.wants_units)
            })
        };
        let r = g.mine_where(|g, r| g.grown(r) && at(g, r).is_some());
        let o = r.and_then(|r| at(g, r)).or_else(|| open.first().copied());
        g.for_r(r, json!({ "offerId": o.map(|o| o.id.as_str()), "times": 1 }))
    }),
    ("sendDirectOffer", |g| {
        let storages = g.my_buildings(BuildingKind::Storage);
        let s = g.pick(&storages);
        let mut fields = g.offer_terms(s);
        fields.insert("storageId".into(), json!(s.map(|s| s.id.as_str())));
        fields.insert("toId".into(), json!(g.other_realm()));
        fields
    }),
    ("sendCarriedOffer", |g| {
        let storages = g.my_buildings(BuildingKind::Storage);
        let s = g.pick(&storages);
        let mut fields = g.offer_terms(s);
        let to = g.other_realm();
        let to_city = to.map(|t| g.realm_cities(t)).and_then(|c| c.first().copied());
        fields.insert("toId".into(), json!(to));
        fields.insert("fromCityId".into(), g.my_city());
        fields.insert("toCityId".into(), json!(to_city));
        fields.insert("feeBy".into(), json!(g.pick(&["sender", "split"])));
        fields.insert("times".into(), json!(1));
        fields
    }),
    ("acceptCarriedOffer", |g| directed(g, true)),
    ("declineOffer", |g| directed(g, false)),
    // The realm and its people.
    ("handOver", |g| {
        let leader = g.leader();
        let to = g.mine_where(|g, r| g.grown(r) && Some(r.id.as_str()) != leader.map(|l| l.id.as_str()) && r.city_id.is_some());
        g.for_r(leader, json!({ "newLeaderId": to.map(|r| r.id.as_str()) }))
    }),
    ("nameHeir", |g| {
        let leader = g.leader().map(|l| l.id.clone());
        let heir = g.mine_where(|g, r| g.grown(r) && Some(&r.id) != leader.as_ref() && r.city_id.is_some());
        g.for_r(None, json!({ "heirId": heir.map(|r| r.id.as_str()) }))
    }),
    ("clearHeir", |g| g.for_r(None, json!({}))),
    ("rename", |g| {
        let target = g.mine_where(|_, _| true);
        let mut fields = json!({ "targetId": target.map(|r| r.id.as_str()), "name": g.name() });
        let unnamed = g.world.realms.iter().any(|r| r.id == g.realm && r.name.is_none());
        if unnamed && target.is_some_and(|t| g.leader().is_some_and(|l| l.id == t.id)) {
            fields["realmName"] = g.name();
        }
        g.for_r(None, fields)
    }),
    ("renameCity", |g| g.for_r(None, json!({ "cityId": g.my_city(), "name": g.name() }))),
    ("renameHorse", |g| {
        let realm = g.realm;
        let horses: Vec<&str> = g.world.horses.iter().filter(|h| h.realm_id.as_deref() == Some(realm)).map(|h| h.id.as_str()).collect();
        g.for_r(None, json!({ "horseId": g.pick(&horses), "name": g.name() }))
    }),
    ("relocate", |g| {
        let city = g.my_city();
        let r = g.mine_where(|_, r| r.city_id.as_deref() != city.as_str() && r.carrying.is_none());
        g.for_r(r, json!({ "cityId": city }))
    }),
    ("claimHorses", |_| Map::new()),
    ("rally", |g| {
        let leader = g.leader();
        g.for_r(leader, json!({}))
    }),
    ("pay", |g| {
        let w = g.world;
        let realm = g.realm;
        let in_force: Vec<&csp_shared::world::MercenaryContract> = w.contracts.iter().filter(|c| c.hirer_id == realm && c.started_at.is_some()).collect();
        let at = |g: &Gen, r: &Resident| {
            in_force.iter().copied().find(|c| w.buildings.iter().any(|b| b.id == c.storage_id && g.covers(b, r_tile(r))))
        };
        let r = g.mine_where(|g, r| at(g, r).is_some());
        let c = r.and_then(|r| at(g, r)).or_else(|| in_force.first().copied());
        g.for_r(r, json!({ "contractId": c.map(|c| c.id.as_str()), "weeks": 1 }))
    }),
    // Demands.
    ("sendDemand", |g| {
        let to = g.other_realm();
        let goods = json!({ "coins": g.between(1, 5) });
        obj(json!({ "realmId": to, "terms": { "kind": "goods", "goods": goods }, "note": "pay up", "days": g.between(1, 10) }))
    }),
    ("acceptDemand", |g| {
        let realm = g.realm;
        let d = g.world.demands.iter().find(|d| d.to_id == realm).map(|d| d.id.clone());
        let storage = g.my_storage();
        obj(json!({ "demandId": d, "handOver": { "way": "setAside", "storageId": storage } }))
    }),
    ("declineDemand", |g| {
        let realm = g.realm;
        let d = g.world.demands.iter().find(|d| d.to_id == realm).map(|d| d.id.clone());
        obj(json!({ "demandId": d }))
    }),
    // Waypoints.
    ("addWaypoint", |g| {
        let at = g.somewhere();
        obj(json!({ "x": at.0, "y": at.1, "name": g.name() }))
    }),
    ("renameWaypoint", |g| obj(json!({ "waypointId": waypoint(g), "name": g.name() }))),
    ("removeWaypoint", |g| obj(json!({ "waypointId": waypoint(g) }))),
    // Alliances.
    ("foundAlliance", |g| obj(json!({ "name": g.name() }))),
    ("inviteToAlliance", |g| {
        let mut to: Vec<&str> = g.npc_cities();
        to.extend(g.other_realm());
        obj(json!({ "realmId": g.pick(&to) }))
    }),
    ("withdrawInvite", |g| {
        let invited = g.alliance_of(g.realm).map(|a| a.invites.clone()).unwrap_or_default();
        obj(json!({ "realmId": g.pick(&invited) }))
    }),
    ("acceptInvite", |g| invite(g)),
    ("declineInvite", |g| invite(g)),
    ("leaveAlliance", |_| Map::new()),
    ("removeFromAlliance", |g| {
        let realm = g.realm;
        let members: Vec<String> = g.alliance_of(realm).map(|a| a.members.iter().map(|m| m.realm_id.clone()).filter(|m| m != realm).collect()).unwrap_or_default();
        obj(json!({ "realmId": g.pick(&members) }))
    }),
    ("handOverToAlliance", |g| {
        let soldiers = g.some_soldiers();
        let realm = g.realm;
        let carts: Vec<&str> = g.world.carriages.iter().filter(|c| c.realm_id.as_deref() == Some(realm)).map(|c| c.id.as_str()).collect();
        let carts: Vec<&str> = if g.chance(0.3) { g.pick(&carts).into_iter().collect() } else { Vec::new() };
        obj(json!({ "residentIds": soldiers, "carriageIds": carts }))
    }),
    ("recallFromAlliance", |g| {
        let w = g.world;
        let realm = g.realm;
        let parts: Vec<String> = g
            .alliance_of(realm)
            .map(|a| {
                a.army
                    .iter()
                    .filter(|p| p.recall_at.is_none())
                    .filter(|p| {
                        w.residents.iter().any(|r| r.id == p.id && r.owner.as_deref() == Some(realm))
                            || w.carriages.iter().any(|c| c.id == p.id && c.realm_id.as_deref() == Some(realm))
                    })
                    .map(|p| p.id.clone())
                    .collect()
            })
            .unwrap_or_default();
        obj(json!({ "ids": parts.iter().take(2).collect::<Vec<_>>() }))
    }),
    // Contracts.
    ("offerContract", |g| {
        let soldiers = g.some_soldiers();
        let storage = g.my_storage();
        obj(json!({
            "residentIds": soldiers, "realmId": g.other_realm(), "days": g.between(7, 30),
            "pricePerWeek": g.between(1, 5), "storageId": storage,
        }))
    }),
    ("acceptContract", |g| contract(g, true)),
    ("cancelContract", |g| contract(g, false)),
    // Armies.
    ("formArmy", |g| {
        let soldiers = g.some_soldiers();
        obj(json!({ "name": g.name(), "residentIds": soldiers }))
    }),
    ("disbandArmy", |g| obj(json!({ "armyId": g.army() }))),
    ("armyStop", |g| obj(json!({ "armyId": g.army() }))),
    ("armyWalkTo", |g| {
        let at = g.somewhere();
        obj(json!({ "armyId": g.army(), "x": at.0, "y": at.1 }))
    }),
    ("armyGuard", |g| {
        let at = g.near(g.me_tile(), 5);
        obj(json!({ "armyId": g.army(), "x": at.0, "y": at.1 }))
    }),
    ("armyAttack", |g| {
        let target = g.foreign_resident().map(|r| r.id.clone());
        obj(json!({ "armyId": g.army(), "targetId": target }))
    }),
    ("armyFollow", |g| {
        let target = if g.chance(0.5) { g.foreign_resident().map(|r| r.id.clone()) } else { Some(g.me.id.clone()) };
        obj(json!({ "armyId": g.army(), "targetId": target }))
    }),
    // NPC cities asking to join.
    ("acceptJoin", |g| join(g)),
    ("declineJoin", |g| join(g)),
];

/// Push, Ram and Throw: by one of the crew on the machine's tile, at a foreign wall in reach.
fn siege(g: &mut Gen, kind: Option<SiegeMachineKind>) -> Map<String, Value> {
    let w = g.world;
    let realm = g.realm;
    let machine = |r: &Resident| {
        w.siege_machines.iter().find(|m| {
            m.realm_id.as_deref() == Some(realm)
                && kind.is_none_or(|k| m.kind == k)
                && m.crew_ids.contains(&r.id)
                && tile(m.x, m.y) == r_tile(r)
        })
    };
    let r = g.mine_where(|_, r| machine(r).is_some());
    let m = r.and_then(machine);
    let at = m.map_or(g.me_tile(), |m| tile(m.x, m.y));
    let mut fields = json!({ "machineId": m.map(|m| m.id.as_str()) });
    if kind.is_none() {
        let to = g.near(at, 2);
        fields["x"] = json!(to.0);
        fields["y"] = json!(to.1);
    } else {
        let reach = if kind == Some(SiegeMachineKind::Ram) { 2 } else { 20 };
        let walls: Vec<&Building> = g
            .foreign_walls()
            .into_iter()
            .filter(|b| {
                let t = b_tile(b);
                (t.0 - at.0).abs().max((t.1 - at.1).abs()) <= reach
            })
            .collect();
        fields["targetId"] = json!(g.pick(&walls).map(|b| b.id.as_str()));
    }
    g.for_r(r, fields)
}

/// Teach and Train: by someone standing on a training ground, naming it.
fn training(g: &mut Gen, teach: bool) -> Map<String, Value> {
    let grounds: Vec<&Building> = g
        .world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::TrainingGround && b.site.is_none())
        .collect();
    let (r, ground) = g.on_one_of(&grounds);
    let mut fields = json!({ "buildingId": ground.map(|b| b.id.as_str()) });
    if teach {
        fields["subject"] = json!(g.pick(super::SUBJECTS));
    }
    g.for_r(r, fields)
}

/// Road line and Wall line: a few tiles from where the resident stands.
fn line(g: &mut Gen, kind: &str) -> Map<String, Value> {
    let r = g.mine_where(|g, r| g.grown(r) && r.carrying.is_none());
    let from = r.map_or(g.me_tile(), r_tile);
    let to = if g.chance(0.5) {
        (from.0 + g.between(-5, 5) as i32, from.1)
    } else {
        (from.0, from.1 + g.between(-5, 5) as i32)
    };
    let mut fields = json!({ "from": g.xy(from), "to": g.xy(to) });
    if kind == "wall" {
        fields["material"] = json!(g.pick(&["wood", "stone"]));
    }
    g.for_r(r, fields)
}

/// Buy and Sell: by someone standing on a trading warehouse or an NPC city's storage.
fn trade(g: &mut Gen, sell: bool) -> Map<String, Value> {
    let mut places = g.warehouses();
    let npc = g.npc_cities();
    places.extend(g.buildings_of(BuildingKind::Storage, &npc));
    let (r, _) = g.on_one_of(&places);
    let good = if sell {
        g.carried_good(r.unwrap_or(g.me), &[Good::Coins])
    } else {
        g.pick(&[Good::Food, Good::Wood, Good::Stone, Good::Iron]).unwrap_or(Good::Food)
    };
    let units = g.between(1, 3);
    g.for_r(r, json!({ "good": name_of(good), "units": units }))
}

/// Accept carried offer and Decline offer: an offer directed at the realm.
fn directed(g: &mut Gen, carried: bool) -> Map<String, Value> {
    let realm = g.realm;
    let offers: Vec<&str> = g
        .world
        .offers
        .iter()
        .filter(|o| o.direct.as_ref().is_some_and(|d| d.to_id == realm && (!carried || d.carried.is_some())))
        .map(|o| o.id.as_str())
        .collect();
    obj(json!({ "offerId": g.pick(&offers) }))
}

fn waypoint(g: &mut Gen) -> Value {
    let ids: Vec<String> =
        g.world.waypoints.get(&g.user).map(|w| w.iter().map(|w| w.id.clone()).collect()).unwrap_or_default();
    json!(g.pick(&ids))
}

fn invite(g: &mut Gen) -> Map<String, Value> {
    let realm = g.realm;
    let a: Vec<&str> =
        g.world.alliances.iter().filter(|a| a.invites.iter().any(|i| i == realm)).map(|a| a.id.as_str()).collect();
    obj(json!({ "allianceId": g.pick(&a) }))
}

/// Accept contract and Cancel contract: an offered contract the realm is a side of; one it can
/// accept for Accept.
fn contract(g: &mut Gen, accept: bool) -> Map<String, Value> {
    let realm = g.realm;
    let open: Vec<&str> = g
        .world
        .contracts
        .iter()
        .filter(|c| c.started_at.is_none())
        .filter(|c| {
            let (offerer, other) = match c.offered_by {
                ContractSide::Lender => (&c.lender_id, &c.hirer_id),
                ContractSide::Hirer => (&c.hirer_id, &c.lender_id),
            };
            if accept {
                other == realm
            } else {
                offerer == realm || other == realm
            }
        })
        .map(|c| c.id.as_str())
        .collect();
    obj(json!({ "contractId": g.pick(&open) }))
}

fn join(g: &mut Gen) -> Map<String, Value> {
    let realm = g.realm;
    let cities: Vec<&str> =
        g.world.join_requests.iter().filter(|j| j.realm_id == realm).map(|j| j.city_id.as_str()).collect();
    obj(json!({ "cityId": g.pick(&cities) }))
}

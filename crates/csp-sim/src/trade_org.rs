//! The Trade Org HQ (`apps/server/src/trade-org.ts`, `CONTEXT.md`: Trade Org HQ): its round
//! layout, where it may stand, and laying it out.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;

use csp_shared::balance::{CITY_AREA_MARGIN, SIGHT_RANGE, START_CARRIED_FOOD, TRADE_ORG_HQ};
use csp_shared::footprint::{footprint_tiles, Placed, FOOTPRINT};
use csp_shared::terrain::{terrain_at, wrap_distance, Terrain, TerrainMap};
use csp_shared::world::{
    Building, BuildingKind, City, Good, ResidentOrder, ResourceKind, ResourceNode, Stock,
    Tile as TileXy, WorkOrder, WorldState,
};

use crate::goods_deps::{new_id, update_city_membership};
use crate::names::unique_name;
use crate::placing::{node_workplace, Ground};
use crate::queries::building::node_corner;
use crate::queries::city::town_hall_of;
use crate::queries::names::good_of;
use crate::queries::trade_org::trade_org_hq;
use crate::queries::warehouse::HQ_COIN_WAREHOUSE as HQ_COINS;
use crate::random::{hash_str, Mulberry32};
use crate::residents::{new_resident, NewResident, Rand};

/// A tile as `(x, y)`.
pub type Tile = (i32, i32);

/// Whether an offset from the middle lies within `radius`, as a round shape on the grid
/// (`within`).
pub fn within(dx: i32, dy: i32, radius: f64) -> bool {
    f64::from(dx).hypot(f64::from(dy)) <= radius + 0.5
}

/// A round ring of tiles `radius` out from (cx, cy) (`roundRing`): the tiles within it that
/// touch a tile outside it, along a side or a corner, row by row.
pub fn round_ring(cx: i32, cy: i32, radius: f64) -> Vec<Tile> {
    let mut out = Vec::new();
    let r = radius.ceil() as i32 + 1;
    for dy in -r..=r {
        for dx in -r..=r {
            if !within(dx, dy, radius) {
                continue;
            }
            let edge = (-1..=1).any(|ny| (-1..=1).any(|nx| !within(dx + nx, dy + ny, radius)));
            if edge {
                out.push((cx + dx, cy + dy));
            }
        }
    }
    out
}

/// The angle of a tile seen from (cx, cy), clockwise from due north, in [0, 2π) (`angleOf`).
pub fn angle_of(cx: i32, cy: i32, (x, y): Tile) -> f64 {
    (f64::from(x - cx).atan2(f64::from(cy - y)) + 2.0 * PI) % (2.0 * PI)
}

/// The `n` gate angles of a ring, evenly round it, the first due north (`gateAngles`).
pub fn gate_angles(n: usize) -> Vec<f64> {
    (0..n).map(|i| (i as f64 * 2.0 * PI) / n as f64).collect()
}

/// How far apart two angles are, the short way round (`angleApart`).
pub fn angle_apart(a: f64, b: f64) -> f64 {
    let d = (a - b).abs() % (2.0 * PI);
    d.min(2.0 * PI - d)
}

/// The tile of `ring` nearest each gate angle (`gatesOf`): the first of the nearest.
pub fn gates_of(cx: i32, cy: i32, ring: &[Tile]) -> Vec<Tile> {
    gate_angles(TRADE_ORG_HQ.gates as usize)
        .into_iter()
        .map(|a| {
            *ring
                .iter()
                .min_by(|p, q| {
                    let dp = angle_apart(angle_of(cx, cy, **p), a);
                    let dq = angle_apart(angle_of(cx, cy, **q), a);
                    dp.partial_cmp(&dq).expect("angles are numbers")
                })
                .expect("a ring has tiles")
        })
        .collect()
}

/// Where the HQ's buildings stand around the middle tile of its town hall (`HqLayout`), each by
/// the north-west tile of its footprint.
#[derive(Debug, Clone, PartialEq)]
pub struct HqLayout {
    pub hall: Tile,
    pub storage: Tile,
    pub coin_warehouse: Tile,
    pub goods_warehouse: Tile,
    pub inner_ring: Vec<Tile>,
    pub inner_gates: Vec<Tile>,
    pub outer_ring: Vec<Tile>,
    pub outer_gates: Vec<Tile>,
    pub houses: Vec<Tile>,
    pub smelter: Tile,
    pub mint: Tile,
}

thread_local! {
    /// Layouts worked out so far (`layouts`), by their middle tile.
    static LAYOUTS: RefCell<HashMap<Tile, HqLayout>> = RefCell::new(HashMap::new());
}

/// The HQ's shape around the middle tile (cx, cy) of its town hall (`hqLayout`), worked out once
/// for each tile.
pub fn hq_layout(cx: i32, cy: i32) -> HqLayout {
    LAYOUTS
        .with(|l| l.borrow_mut().entry((cx, cy)).or_insert_with(|| work_out_layout(cx, cy)).clone())
}

fn side(kind: &str) -> i32 {
    FOOTPRINT.get(kind).expect("a footprint")
}

fn work_out_layout(cx: i32, cy: i32) -> HqLayout {
    let (inner, outer) = (TRADE_ORG_HQ.inner_radius, TRADE_ORG_HQ.outer_radius);
    let inner_ring = round_ring(cx, cy, inner);
    let outer_ring = round_ring(cx, cy, outer);
    let between = crate::queries::js_round((inner + outer) / 2.0);
    // Keep a tile and a half clear on either side of each way in, beside the houses' footprints.
    let clear = ((1.5 + f64::from(side("house"))) / between).asin();
    let gates = gate_angles(TRADE_ORG_HQ.gates as usize);
    let mut slots: Vec<Tile> = round_ring(cx, cy, between)
        .into_iter()
        .filter(|t| gates.iter().all(|a| angle_apart(angle_of(cx, cy, *t), *a) > clear))
        .collect();
    slots.sort_by(|p, q| angle_of(cx, cy, *p).partial_cmp(&angle_of(cx, cy, *q)).expect("angles"));
    let houses = TRADE_ORG_HQ.houses as usize;
    let wanted = houses + 2;
    assert!(
        slots.len() >= wanted * (side("house") as usize + 1),
        "the Trade Org HQ has no room for its houses"
    );
    let spread: Vec<Tile> = (0..wanted).map(|i| slots[(i * slots.len()) / wanted]).collect();
    let hall = (cx - 1, cy - 1);
    let storage = side("storage");
    let (dx, dy) = (HQ_COINS.0 as i32, HQ_COINS.1 as i32);
    HqLayout {
        hall,
        storage: (hall.0 - storage - 1, hall.1 - storage - 1),
        coin_warehouse: (hall.0 + dx, hall.1 + dy),
        goods_warehouse: (hall.0 + dx, hall.1 - dy),
        inner_gates: gates_of(cx, cy, &inner_ring),
        inner_ring,
        outer_gates: gates_of(cx, cy, &outer_ring),
        outer_ring,
        houses: spread[..houses].to_vec(),
        smelter: spread[houses],
        mint: spread[houses + 1],
    }
}

/// How far the HQ's ground reaches from its town hall: its outer ring and the farms beyond it
/// (`HQ_FOOTPRINT`).
pub fn hq_footprint() -> f64 {
    TRADE_ORG_HQ.outer_radius + farm_ring()
}

/// The ring of farms round a city (`FARM_RING` of `starting-city.ts`). TODO(T86.8): import it.
fn farm_ring() -> f64 {
    1.0 + CITY_AREA_MARGIN
}

/// Where residents, horses, carriages and piles stand (`residentTiles` of `starting-city.ts`).
/// TODO(T86.8): import it.
fn resident_tiles(world: &WorldState) -> Vec<Tile> {
    let r = world.residents.iter().map(|e| (e.x, e.y));
    let h = world.horses.iter().map(|e| (e.x, e.y));
    let k = world.carriages.iter().map(|e| (e.x, e.y));
    let p = world.piles.iter().map(|e| (e.x, e.y));
    r.chain(h).chain(k).chain(p).map(|(x, y)| (x as i32, y as i32)).collect()
}

/// The ground with what stands on it (`takenGround`).
fn taken_ground<'t>(world: &WorldState, terrain: &'t TerrainMap) -> Ground<'t> {
    let nodes = world.nodes.iter().map(|n| (n.x as i32, n.y as i32));
    Ground::new(world, terrain, nodes.chain(resident_tiles(world)))
}

/// Where the HQ's farms go (`farmTiles`): wholly just past its area on Plains, apart from each
/// other, nearest an outer gate first.
fn farm_tiles(ground: &Ground, cx: i32, cy: i32) -> Vec<Tile> {
    let l = hq_layout(cx, cy);
    let margin = CITY_AREA_MARGIN as i32;
    let mut near = HashSet::new();
    for &(x, y) in &l.outer_ring {
        for dy in -margin..=margin {
            for dx in -margin..=margin {
                near.insert((x + dx, y + dy));
            }
        }
    }
    let side = side("farm");
    let half = f64::from(side - 1) / 2.0;
    let to_gate = |t: Tile| {
        l.outer_gates
            .iter()
            .map(|g| {
                (f64::from(t.0) + half - f64::from(g.0))
                    .hypot(f64::from(t.1) + half - f64::from(g.1))
            })
            .fold(f64::INFINITY, f64::min)
    };
    // North-west tiles of footprints that reach no further in than the ring just past the area,
    // in the order they were first found (a JavaScript `Map`'s).
    let mut candidates: Vec<Tile> = Vec::new();
    let mut seen = HashSet::new();
    for k in 0..side {
        for t in round_ring(cx, cy, hq_footprint() + f64::from(k)) {
            if seen.insert(t) {
                candidates.push(t);
            }
        }
    }
    candidates.sort_by(|p, q| to_gate(*p).partial_cmp(&to_gate(*q)).expect("distances"));
    let mut mine: HashSet<Tile> = HashSet::new();
    let mut out = Vec::new();
    let reach = hq_footprint() + f64::from(side);
    for t in candidates {
        if out.len() >= TRADE_ORG_HQ.farms as usize {
            break;
        }
        let also = |x: i32, y: i32| {
            !near.contains(&(x, y)) && !mine.contains(&(x, y)) && within(x - cx, y - cy, reach)
        };
        if !ground.fits(BuildingKind::Farm, t.0, t.1, Some(&also)) {
            continue;
        }
        out.push(t);
        let size = ground.terrain.size;
        mine.extend(footprint_tiles(Placed { kind: "farm", x: t.0, y: t.1 }, size));
    }
    out
}

/// Whether the HQ fits with the middle of its town hall at (cx, cy) (`hqSiteFits`).
pub fn hq_site_fits(
    world: &WorldState,
    terrain: &TerrainMap,
    cx: i32,
    cy: i32,
    ground: &Ground,
) -> bool {
    let unseen = SIGHT_RANGE + hq_footprint() + f64::from(side("farm"));
    for r in &world.residents {
        if r.owner.is_some()
            && wrap_distance(terrain.size, (r.x as i32, r.y as i32), (cx, cy)) <= unseen
        {
            return false;
        }
    }
    let reach = hq_footprint() as i32;
    for dy in -reach..=reach {
        for dx in -reach..=reach {
            if !within(dx, dy, hq_footprint()) {
                continue;
            }
            let t = terrain_at(terrain, cx + dx, cy + dy);
            let open = t == Terrain::Plains as u8
                || t == Terrain::Forest as u8
                || t == Terrain::Hills as u8;
            if !open || !ground.free(cx + dx, cy + dy) {
                return false;
            }
        }
    }
    farm_tiles(ground, cx, cy).len() >= TRADE_ORG_HQ.farms as usize
}

/// How far apart candidate sites for the HQ lie (`SITE_STEP`).
const SITE_STEP: usize = 24;

/// Picks the site for the HQ's town hall (`findHqSite`): as far from the nearest city as the map
/// allows, by a random pick among the equally far.
pub fn find_hq_site(world: &WorldState, terrain: &TerrainMap, rand: &mut Rand) -> Option<Tile> {
    let edge = hq_footprint() as i32 + side("farm");
    let halls: Vec<(i32, i32)> = world
        .cities
        .iter()
        .filter_map(|c| town_hall_of(world, c))
        .map(|h| (h.x as i32, h.y as i32))
        .collect();
    let mut candidates: Vec<(Tile, f64, f64)> = Vec::new();
    for y in (edge..terrain.size - edge).step_by(SITE_STEP) {
        for x in (edge..terrain.size - edge).step_by(SITE_STEP) {
            let far = halls
                .iter()
                .map(|h| wrap_distance(terrain.size, *h, (x, y)))
                .fold(f64::INFINITY, f64::min);
            candidates.push(((x, y), far, rand()));
        }
    }
    // `b.far - a.far || a.order - b.order`: Infinity - Infinity is NaN, which counts as equal.
    candidates.sort_by(|a, b| {
        let far = b.1 - a.1;
        let by_far = if far > 0.0 {
            std::cmp::Ordering::Greater
        } else if far < 0.0 {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Equal
        };
        by_far.then(a.2.partial_cmp(&b.2).expect("numbers"))
    });
    let ground = taken_ground(world, terrain);
    candidates
        .into_iter()
        .find(|c| hq_site_fits(world, terrain, c.0 .0, c.0 .1, &ground))
        .map(|c| c.0)
}

/// The nearest node of `kind` from (cx, cy) whose workplace can still be laid out on it
/// (`nearestFreeNode`): where that workplace goes.
pub fn nearest_free_node(
    world: &WorldState,
    terrain: &TerrainMap,
    kind: ResourceKind,
    cx: i32,
    cy: i32,
) -> Option<Tile> {
    let mut nodes: Vec<(&ResourceNode, f64)> = world
        .nodes
        .iter()
        .filter(|n| n.kind == kind)
        .map(|n| (n, wrap_distance(terrain.size, (n.x as i32, n.y as i32), (cx, cy))))
        .collect();
    nodes.sort_by(|a, b| a.1.partial_cmp(&b.1).expect("distances"));
    nodes.into_iter().find_map(|(n, _)| node_corner(world, terrain, n))
}

/// The resource kinds the HQ runs a workplace on (`HQ_NODES`).
const HQ_NODES: [ResourceKind; 4] =
    [ResourceKind::Forest, ResourceKind::Stone, ResourceKind::IronOre, ResourceKind::GoldOre];

/// City names the game gives (`CITY_NAMES` of `cities.ts`). TODO(T86.8): import them.
const CITY_NAMES: [&str; 20] = [
    "Ashford",
    "Brackenholt",
    "Coldwater",
    "Dunmere",
    "Eastwick",
    "Fallowby",
    "Greyhaven",
    "Hartwell",
    "Ironside",
    "Juniper",
    "Kettleby",
    "Larkspur",
    "Millbrook",
    "Northam",
    "Oakhurst",
    "Pinecrest",
    "Quarrytown",
    "Redbank",
    "Stonebridge",
    "Thornbury",
];

/// The name the game gives a new city (`givenCityName` of `cities.ts`). TODO(T86.8): import it.
fn given_city_name(world: &WorldState, drawn: &str) -> String {
    let taken: HashSet<String> = world.cities.iter().map(|c| c.name.clone()).collect();
    unique_name(drawn, &taken, &CITY_NAMES)
}

fn new_building(
    world: &mut WorldState,
    kind: BuildingKind,
    city_id: Option<&str>,
    (x, y): Tile,
) -> Building {
    Building {
        id: new_id(world, "b"),
        kind,
        city_id: city_id.map(str::to_string),
        realm_id: None,
        x: f64::from(x),
        y: f64::from(y),
        stock: None,
        site: None,
        teardown: None,
        closed: None,
        damage: None,
        breedings: None,
    }
}

/// A ring of wall with gates on `gates`, closed when `closed` (`ring` of `foundTradeOrgHq`).
fn ring(
    world: &mut WorldState,
    city: &str,
    tiles: &[Tile],
    gates: &[Tile],
    closed: bool,
) -> Vec<Building> {
    tiles
        .iter()
        .map(|t| {
            if !gates.contains(t) {
                return new_building(world, BuildingKind::Wall, Some(city), *t);
            }
            let mut g = new_building(world, BuildingKind::Gate, Some(city), *t);
            if closed {
                g.closed = Some(true);
            }
            g
        })
        .collect()
}

/// Lays out the Trade Org HQ with the middle of its town hall at (cx, cy) (`foundTradeOrgHq`).
/// Returns the city's id.
pub fn found_trade_org_hq(
    world: &mut WorldState,
    terrain: &TerrainMap,
    cx: i32,
    cy: i32,
    rand: &mut Rand,
) -> String {
    let layout = hq_layout(cx, cy);
    let id = new_id(world, "city");
    let drawn = CITY_NAMES[hash_str(&format!("{}:{id}", world.seed)) as usize % CITY_NAMES.len()];
    let name = given_city_name(world, drawn);
    let c = Some(id.as_str());
    let hall = new_building(world, BuildingKind::TownHall, c, layout.hall);
    let hall_id = hall.id.clone();
    // The farms are made right after the town hall, as in the TypeScript, so their ids come next;
    // they stand after the houses in the list.
    let farm_at = farm_tiles(&taken_ground(world, terrain), cx, cy);
    let farms: Vec<Building> = farm_at
        .iter()
        .map(|t| new_building(world, BuildingKind::Farm, Some(id.as_str()), *t))
        .collect();
    let mut storage = new_building(world, BuildingKind::Storage, c, layout.storage);
    storage.stock = Some(Stock::from([(Good::Food, TRADE_ORG_HQ.food)]));
    let mut coins = new_building(world, BuildingKind::Warehouse, c, layout.coin_warehouse);
    coins.stock = Some(Stock::from([(Good::Coins, TRADE_ORG_HQ.coins)]));
    let mut goods = new_building(world, BuildingKind::Warehouse, c, layout.goods_warehouse);
    goods.stock = Some(
        TRADE_ORG_HQ.goods.0.iter().filter_map(|(g, n)| good_of(g).map(|g| (g, *n))).collect(),
    );
    let mut buildings = vec![hall, storage, coins, goods];
    // The inner gates stay closed (`CONTEXT.md`: Trade Org army); its own residents pass them.
    buildings.extend(ring(world, &id, &layout.inner_ring, &layout.inner_gates, true));
    buildings.extend(ring(world, &id, &layout.outer_ring, &layout.outer_gates, false));
    for t in &layout.houses {
        buildings.push(new_building(world, BuildingKind::House, c, *t));
    }
    let farm_spots: Vec<(String, f64, f64)> =
        farms.iter().map(|f| (f.id.clone(), f.x, f.y)).collect();
    buildings.extend(farms);
    let workplaces = vec![
        new_building(world, BuildingKind::Smelter, None, layout.smelter),
        new_building(world, BuildingKind::Mint, None, layout.mint),
    ];
    let mut workplace_ids: Vec<String> = workplaces.iter().map(|w| w.id.clone()).collect();
    let city: City = serde_json::from_value(serde_json::json!({
        "id": id, "name": name, "gameName": true, "realmId": null, "townHallId": hall_id,
        "occupation": null, "tradeOrg": "hq",
    }))
    .expect("a city");
    world.cities.push(city);
    world.buildings.extend(buildings);
    world.buildings.extend(workplaces);
    // One on each kind of node, each laid out once the others stand, so none overlaps another.
    for kind in HQ_NODES {
        let Some(spot) = nearest_free_node(world, terrain, kind, cx, cy) else { continue };
        let w = new_building(world, node_workplace(kind), None, spot);
        workplace_ids.push(w.id.clone());
        world.buildings.push(w);
    }
    let ci = world.cities.len() - 1;
    world.cities[ci].workplace_ids = Some(workplace_ids);
    let mut names = HashSet::new();
    for i in 0..TRADE_ORG_HQ.residents as usize {
        let (farm_id, fx, fy) = farm_spots[i % farm_spots.len()].clone();
        let rid = new_id(world, "r");
        let tick = world.tick as f64;
        let fields = NewResident { id: &rid, owner: None, city_id: Some(&id), x: fx, y: fy, tick };
        let mut r = new_resident(rand, &fields, Some(&mut names));
        r.carried = Stock::from([(Good::Food, START_CARRIED_FOOD)]);
        r.order = Some(ResidentOrder::WorkAt(WorkOrder {
            building_id: farm_id.clone(),
            at: TileXy { x: fx, y: fy },
            progress: 0.0,
            makes: None,
        }));
        r.script = Some(
            serde_json::from_value(serde_json::json!({
                "scriptId": 0, "task": "work", "memory": { "workplaceId": farm_id },
            }))
            .expect("a running script"),
        );
        world.residents.push(r);
    }
    update_city_membership(world, terrain.size);
    id
}

/// Places the Trade Org HQ unless the world has one already (`placeTradeOrgHq`), or none when
/// the map has no room for it. Returns its city's id.
pub fn place_trade_org_hq(world: &mut WorldState, terrain: &TerrainMap) -> Option<String> {
    if let Some(hq) = trade_org_hq(world) {
        return Some(hq.id.clone());
    }
    let mut rand = Mulberry32::new(world.seed as f64 * 7919.0 + 17.0);
    let mut next = || rand.next();
    let site = find_hq_site(world, terrain, &mut next)?;
    Some(found_trade_org_hq(world, terrain, site.0, site.1, &mut next))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ring_holds_together_and_the_gates_lie_on_it() {
        let ring = round_ring(0, 0, 16.0);
        assert!(ring.contains(&(0, -16)));
        let l = hq_layout(320, 320);
        for g in &l.outer_gates {
            assert!(l.outer_ring.contains(g));
        }
        assert_eq!(l.outer_gates[0].0, 320, "the first gate due north");
        assert_eq!(l.houses.len(), TRADE_ORG_HQ.houses as usize);
    }
}

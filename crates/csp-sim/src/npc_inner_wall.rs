//! A big NPC city's inner ring of wall (`apps/server/src/npc-inner-wall.ts`, `CONTEXT.md`: Bigger
//! projects; ADR 0029): round its town hall and storage, with a gate its own pass through, from
//! materials above its reserve. Its outer wall goes on growing as before: `wall_rings` only ever
//! reads the outer one (`outer_walls`).

use std::collections::{HashMap, HashSet};
use std::f64::consts::{FRAC_1_SQRT_2, PI};

use csp_shared::balance::{NPC_INNER_WALL_REACH, NPC_VILLAGE, NPC_WALL_TILES_PER_TRIP};
use csp_shared::footprint::{footprint_tiles, middle_of};
use csp_shared::terrain::{
    is_passable_terrain, terrain_at, tile_index, wrap, wrap_delta, TerrainMap,
};
use csp_shared::world::{Building, BuildingKind, City, CityProject, Stock, WorldState};

use crate::city_layout::{layout_plan, GateAt, LayoutPlan};
use crate::npc_chain::short_goods;
use crate::placing::Ground;
use crate::queries::building::build_materials;
use crate::queries::city::town_hall_of;
use crate::queries::names::{held, placed};
use crate::queries::npc_trade::{is_big_npc_city, npc_city_stock, npc_reserve};
use crate::sight::InvariantViolation;
use crate::terrain_gen::js_hypot;

/// Where an NPC city's outer wall stands at its nearest, tiles from its home along the farther
/// direction: a village's (`OUTER_WALL_NEAREST`).
pub const OUTER_WALL_NEAREST: i32 = (NPC_VILLAGE.size / 2.0) as i32;

/// A tile relative to some middle: how far along the farther direction (`ringOf`).
fn ring_of(dx: i32, dy: i32) -> i32 {
    dx.abs().max(dy.abs())
}

/// How far a tile is from a city's home along the farther direction (`fromHome`).
pub fn from_home(home: (i32, i32), x: i32, y: i32, size: i32) -> i32 {
    ring_of(wrap_delta(home.0, x, size), wrap_delta(home.1, y, size))
}

/// The walls of a city's outer wall among `walls` (`outerWalls`): those at the distance an outer
/// wall stands, the inner ring left out. A city with none there has only what it has.
pub fn outer_walls<T: Clone>(
    walls: &[T],
    at: impl Fn(&T) -> (i32, i32),
    home: (i32, i32),
    size: i32,
) -> Vec<T> {
    let outer: Vec<T> = walls
        .iter()
        .filter(|b| {
            let (x, y) = at(b);
            from_home(home, x, y, size) >= OUTER_WALL_NEAREST
        })
        .cloned()
        .collect();
    if outer.is_empty() {
        walls.to_vec()
    } else {
        outer
    }
}

/// A tile of the inner ring (`InnerWallTile`): what goes there, and whether it is finished or
/// begun (`site`: where the begun one stands in `world.buildings`).
#[derive(Debug, Clone, PartialEq)]
pub struct InnerWallTile {
    pub kind: BuildingKind,
    pub x: i32,
    pub y: i32,
    pub done: bool,
    pub site: Option<String>,
}

/// A shape the ring can take, relative to the middle of the town hall (`Shape`).
struct Shape {
    square: bool,
    d: i32,
    tiles: Vec<(i32, i32)>,
}

impl Shape {
    fn inside(&self, dx: i32, dy: i32) -> bool {
        if self.square {
            ring_of(dx, dy) < self.d
        } else {
            js_hypot(f64::from(dx), f64::from(dy)) < f64::from(self.d) - FRAC_1_SQRT_2
        }
    }
}

/// A square with `d` tiles from its middle to each side, the wall on the outermost tiles.
fn square(d: i32) -> Shape {
    let mut tiles = Vec::new();
    for dy in -d..=d {
        for dx in -d..=d {
            if ring_of(dx, dy) == d {
                tiles.push((dx, dy));
            }
        }
    }
    Shape { square: true, d, tiles }
}

/// A circle of radius `r`, its tiles joining side to side as a circular lane's do.
fn circle(r: i32) -> Shape {
    let mut tiles = Vec::new();
    for dy in -r - 1..=r + 1 {
        for dx in -r - 1..=r + 1 {
            if (js_hypot(f64::from(dx), f64::from(dy)) - f64::from(r)).abs() <= FRAC_1_SQRT_2 {
                tiles.push((dx, dy));
            }
        }
    }
    Shape { square: false, d: r, tiles }
}

/// The shapes the ring can take, the smallest first.
fn shapes() -> Vec<Shape> {
    (2..=NPC_INNER_WALL_REACH as i32).flat_map(|d| [square(d), circle(d)]).collect()
}

/// What a shape would cost a city (`Fit`).
struct Fit<'s> {
    shape: &'s Shape,
    begun: usize,
    gaps: usize,
    off_street: usize,
}

/// How a shape fits a city with the middle of its town hall at `anchor` (`fit`): it has to hold
/// the town hall and the storage (`home`) and stay nearer the home than its outer wall.
fn fit<'s>(
    shape: &'s Shape,
    anchor: (i32, i32),
    held_tiles: &[(i32, i32)],
    home: (i32, i32),
    walls: &HashMap<usize, &Building>,
    ground: &Ground,
    plan: Option<&LayoutPlan>,
) -> Option<Fit<'s>> {
    let size = ground.terrain.size;
    let holds_all = held_tiles
        .iter()
        .all(|&(x, y)| shape.inside(wrap_delta(anchor.0, x, size), wrap_delta(anchor.1, y, size)));
    if !holds_all {
        return None;
    }
    let (mut begun, mut gaps, mut off_street) = (0, 0, 0);
    for &(dx, dy) in &shape.tiles {
        let x = wrap(anchor.0 + dx, size);
        let y = wrap(anchor.1 + dy, size);
        if from_home(home, x, y, size) >= OUTER_WALL_NEAREST {
            return None;
        }
        if walls.contains_key(&tile_index(size, x, y)) {
            begun += 1;
        } else if !ground.fits(BuildingKind::Wall, x, y, None) {
            gaps += 1;
        } else if plan.is_some_and(|p| !p.street(x, y)) {
            off_street += 1;
        }
    }
    Some(Fit { shape, begun, gaps, off_street })
}

/// The tiles of the city's inner ring (`innerWall`), the walls on round from its gate and the gate
/// last, so the way in stays open while it goes up. It takes the shape round the town hall that
/// leaves fewest gaps, on the tiles its layout keeps for streets where it can. Its gate stands as
/// near the outer gate as it can. None for a city with no town hall, or where no shape fits.
pub fn inner_wall(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    outer_gate: (i32, i32),
    new_gate: GateAt,
) -> Vec<InnerWallTile> {
    let size = terrain.size;
    let Some(hall) = town_hall_of(world, city) else { return Vec::new() };
    let anchor = middle_of(placed(hall), size);
    let home_at = (home.x as i32, home.y as i32);
    let mut walls: HashMap<usize, &Building> = HashMap::new();
    for b in &world.buildings {
        if b.kind != BuildingKind::Wall && b.kind != BuildingKind::Gate {
            continue;
        }
        if from_home(home_at, b.x as i32, b.y as i32, size) < OUTER_WALL_NEAREST {
            walls.insert(tile_index(size, b.x as i32, b.y as i32), b);
        }
    }
    let ground = Ground::new(world, terrain, []);
    let plan = layout_plan(world, city, home, Some(new_gate), size);
    let mut held_tiles = footprint_tiles(placed(hall), size);
    held_tiles.extend(footprint_tiles(placed(home), size));
    let all = shapes();
    let mut best: Option<Fit> = None;
    for shape in &all {
        let Some(f) = fit(shape, anchor, &held_tiles, home_at, &walls, &ground, plan.as_ref())
        else {
            continue;
        };
        let better = match &best {
            None => true,
            Some(b) => {
                f.begun > b.begun
                    || (f.begun == b.begun
                        && (f.gaps < b.gaps
                            || (f.gaps == b.gaps
                                && (f.off_street < b.off_street
                                    || (f.off_street == b.off_street
                                        && f.shape.tiles.len() < b.shape.tiles.len())))))
            }
        };
        if better {
            best = Some(f);
        }
    }
    let Some(best) = best else { return Vec::new() };
    struct T<'w> {
        x: i32,
        y: i32,
        dx: i32,
        dy: i32,
        here: Option<&'w Building>,
    }
    let tiles: Vec<T> = best
        .shape
        .tiles
        .iter()
        .filter_map(|&(dx, dy)| {
            let x = wrap(anchor.0 + dx, size);
            let y = wrap(anchor.1 + dy, size);
            let here = walls.get(&tile_index(size, x, y)).copied();
            if here.is_none() && !ground.fits(BuildingKind::Wall, x, y, None) {
                return None;
            }
            Some(T { x, y, dx, dy, here })
        })
        .collect();
    let to_gate = |t: &T| {
        js_hypot(
            f64::from(wrap_delta(outer_gate.0, t.x, size)),
            f64::from(wrap_delta(outer_gate.1, t.y, size)),
        )
    };
    let gate: Option<usize> = tiles
        .iter()
        .position(|t| t.here.is_some_and(|h| h.kind == BuildingKind::Gate))
        .or_else(|| {
            let mut free: Vec<usize> =
                (0..tiles.len()).filter(|&i| tiles[i].here.is_none()).collect();
            free.sort_by(|&a, &b| to_gate(&tiles[a]).total_cmp(&to_gate(&tiles[b])));
            free.first().copied()
        });
    let mut out: Vec<(f64, InnerWallTile)> = tiles
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let angle = |dx: i32, dy: i32| f64::from(dy).atan2(f64::from(dx));
            let turn = match gate {
                Some(g) => angle(t.dx, t.dy) - angle(tiles[g].dx, tiles[g].dy),
                None => angle(t.dx, t.dy),
            };
            let is_gate = Some(i) == gate;
            let order = if is_gate { f64::INFINITY } else { (turn + 4.0 * PI) % (2.0 * PI) };
            let tile = InnerWallTile {
                kind: if is_gate { BuildingKind::Gate } else { BuildingKind::Wall },
                x: t.x,
                y: t.y,
                done: t.here.is_some_and(|h| h.site.is_none()),
                site: t.here.filter(|h| h.site.is_some()).map(|h| h.id.clone()),
            };
            (order, tile)
        })
        .collect();
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out.into_iter().map(|(_, t)| t).collect()
}

/// Whether a city's stock holds all of `goods` above its reserve (`holdsAboveReserve`).
pub fn holds_above_reserve(world: &WorldState, city: &City, goods: &Stock) -> bool {
    let stock = npc_city_stock(world, city);
    let reserve = npc_reserve(world, city);
    goods.iter().all(|(good, n)| held(&stock, *good) - held(&reserve, *good) >= *n)
}

/// What `inner_wall_project` needs to know of a city's outer wall (`rings`).
pub struct Rings {
    pub expanding: bool,
    /// Where the outer wall's gate stands, if it has one.
    pub gate: Option<(i32, i32)>,
    pub new_gate: GateAt,
}

/// The next tile of a big NPC city's inner ring to build (`innerWallProject`, `CONTEXT.md`: Bigger
/// projects), if it is time for one: its outer wall has its gate and isn't moving out, nothing is
/// short of its reserve, and it holds above that reserve what `builders` take on a trip for walls.
pub fn inner_wall_project(
    world: &WorldState,
    city: &City,
    home: &Building,
    terrain: &TerrainMap,
    rings: &Rings,
    builders: f64,
) -> Option<CityProject> {
    if city.trade_org.is_some() || rings.expanding {
        return None;
    }
    let gate = rings.gate?;
    if !is_big_npc_city(world, city) || !short_goods(world, city, terrain.size, None).is_empty() {
        return None;
    }
    let tiles = inner_wall(world, city, home, terrain, gate, rings.new_gate);
    let next =
        tiles.iter().find(|t| t.site.is_some()).or_else(|| tiles.iter().find(|t| !t.done))?;
    let trips = NPC_WALL_TILES_PER_TRIP * builders;
    let goods: Stock =
        build_materials(next.kind).into_iter().map(|(g, n)| (g, n * trips)).collect();
    if !holds_above_reserve(world, city, &goods) {
        return None;
    }
    Some(CityProject::Build { building: next.kind, x: f64::from(next.x), y: f64::from(next.y) })
}

/// How far from its home someone stands who has come out past the farthest an inner ring can
/// stand (`PAST_THE_RING`).
const PAST_THE_RING: i32 = OUTER_WALL_NEAREST - 1;

/// Invariant `inner-wall-leaves-a-way` (`CONTEXT.md`: Bigger projects; ADR 0004): from an NPC
/// city's storage there is a way past its inner ring on foot, through its gate or a gap.
pub fn inner_wall_leaves_a_way(
    world: &WorldState,
    terrain: &TerrainMap,
) -> Vec<InvariantViolation> {
    let size = terrain.size;
    let mut homes: HashMap<&String, &Building> = HashMap::new();
    let mut walls_of: HashMap<&String, Vec<&Building>> = HashMap::new();
    for b in &world.buildings {
        let Some(city) = &b.city_id else { continue };
        if b.site.is_some() {
            continue;
        }
        if b.kind == BuildingKind::Storage && !homes.contains_key(city) {
            homes.insert(city, b);
        } else if b.kind == BuildingKind::Wall {
            walls_of.entry(city).or_default().push(b);
        }
    }
    let mut out = Vec::new();
    for city in &world.cities {
        if city.realm_id.is_some() || city.trade_org.is_some() {
            continue;
        }
        let Some(home) = homes.get(&city.id) else { continue };
        let home_at = (home.x as i32, home.y as i32);
        let walls: Vec<&&Building> = walls_of
            .get(&city.id)
            .into_iter()
            .flatten()
            .filter(|b| from_home(home_at, b.x as i32, b.y as i32, size) < OUTER_WALL_NEAREST)
            .collect();
        if walls.is_empty() {
            continue;
        }
        let blocked: HashSet<usize> =
            walls.iter().map(|b| tile_index(size, b.x as i32, b.y as i32)).collect();
        if !way_past(home_at, &blocked, terrain) {
            out.push(InvariantViolation {
                invariant: "inner-wall-leaves-a-way".into(),
                message: format!("{}'s inner ring has no way through it to its storage", city.id),
                entity_ids: vec![city.id.clone(), home.id.clone()],
            });
        }
    }
    out
}

/// Whether someone at `home` can walk past the walls in `blocked`, out to `PAST_THE_RING`
/// (`wayPast`).
fn way_past(home: (i32, i32), blocked: &HashSet<usize>, terrain: &TerrainMap) -> bool {
    let size = terrain.size;
    let mut seen = HashSet::from([tile_index(size, home.0, home.1)]);
    let mut todo = vec![home];
    while let Some((x, y)) = todo.pop() {
        if from_home(home, x, y, size) >= PAST_THE_RING {
            return true;
        }
        for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] {
            let (tx, ty) = (wrap(nx, size), wrap(ny, size));
            let t = tile_index(size, tx, ty);
            if seen.contains(&t)
                || blocked.contains(&t)
                || !is_passable_terrain(terrain_at(terrain, tx, ty))
            {
                continue;
            }
            seen.insert(t);
            todo.push((tx, ty));
        }
    }
    false
}

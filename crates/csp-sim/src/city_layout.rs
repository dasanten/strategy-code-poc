//! How an NPC city sets out its town (`apps/server/src/city-layout.ts`, `CONTEXT.md`: City
//! layout): the layout it gets when it comes to be, and what that says about a tile. Where the
//! next building goes among those is `house_tile`'s (`npc-growth.ts`).

use std::collections::{HashMap, HashSet};
use std::f64::consts::FRAC_1_SQRT_2;

use csp_shared::balance::{CITY_GRID_BLOCK, CITY_QUARTER_ROWS, CITY_RING_STEP, CITY_SIDE_LANE_GAP};
use csp_shared::footprint::{footprint_tiles, middle_of, FOOTPRINT};
use csp_shared::terrain::{
    is_passable_terrain, terrain_at, tile_index, wrap, wrap_delta, wrap_distance, TerrainMap,
};
use csp_shared::world::{Building, BuildingKind, City, CityLayout, WorldState};

use crate::queries::building::building_at;
use crate::queries::city::town_hall_of;
use crate::queries::names::{kind_name, placed};
use crate::random::hash_str;
use crate::sight::InvariantViolation;
use crate::terrain_gen::js_hypot;

/// The layouts an NPC city can get, in the TypeScript's order (`CITY_LAYOUTS`).
pub const CITY_LAYOUTS: [CityLayout; 4] =
    [CityLayout::Grid, CityLayout::Rings, CityLayout::MainStreet, CityLayout::Quarters];

/// The layout a city gets (`pickLayout`), drawn from the world's seed and its id, so a world
/// always picks the same one for it.
pub fn pick_layout(seed: i64, city_id: &str) -> CityLayout {
    CITY_LAYOUTS[(hash_str(&format!("{seed}:layout:{city_id}")) % 4) as usize]
}

/// Where a city's next gate goes, relative to its home (`{ dx, dy }`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GateAt {
    pub dx: i32,
    pub dy: i32,
}

/// A footprint's side for a kind (`FOOTPRINT[kind]`).
fn side(kind: BuildingKind) -> i32 {
    FOOTPRINT.get(kind_name(kind)).expect("every kind has a footprint")
}

/// `n` counted up from 0 again every `by`, for negative numbers too (`mod`).
fn modulo(n: i32, by: i32) -> i32 {
    n.rem_euclid(by)
}

/// `Math.round`, on a number that is not a half below zero (as the circles' lanes are).
fn js_round(v: f64) -> f64 {
    crate::queries::js_round(v)
}

/// The tiles straight through a city's gates (`gateLanes`): columns and rows.
#[derive(Debug, Clone, Default)]
struct Lanes {
    columns: HashSet<i32>,
    rows: HashSet<i32>,
}

impl Lanes {
    fn has(&self, x: i32, y: i32) -> bool {
        self.columns.contains(&x) || self.rows.contains(&y)
    }
}

/// One way from a gate to the middle (`gateWays`): across and along the gate's line, and which way
/// along it is out of town; `swap` for a gate east or west of the home, whose line runs along x.
#[derive(Debug, Clone, Copy)]
struct Way {
    gate_across: i32,
    gate_along: i32,
    out: i32,
    swap: bool,
}

impl Way {
    /// Whether the tile (relative to the middle) is on the way.
    fn on(&self, dx: i32, dy: i32) -> bool {
        let (across, along) = if self.swap { (dy, dx) } else { (dx, dy) };
        (across == self.gate_across && along * self.out >= 0.min(self.gate_along * self.out))
            || (along == 0
                && across >= 0.min(self.gate_across)
                && across <= 0.max(self.gate_across))
    }
}

/// What a city's layout says about the ground (`LayoutPlan`).
#[derive(Debug, Clone)]
pub struct LayoutPlan {
    size: i32,
    anchor: (i32, i32),
    lanes: Lanes,
    kind: PlanKind,
}

#[derive(Debug, Clone)]
enum PlanKind {
    Grid,
    Quarters,
    Rings { ways: Vec<Way> },
    MainStreet { north_south: bool, line: i32 },
}

impl LayoutPlan {
    /// Whether the tile is kept free for a street (`street`).
    pub fn street(&self, x: i32, y: i32) -> bool {
        let size = self.size;
        let (ax, ay) = self.anchor;
        match &self.kind {
            PlanKind::Grid => {
                let pitch = CITY_GRID_BLOCK as i32 + 1;
                modulo(wrap_delta(ax, x, size), pitch) == 0
                    || modulo(wrap_delta(ay, y, size), pitch) == 0
                    || self.lanes.has(x, y)
            }
            PlanKind::Quarters => {
                let pitch = CITY_QUARTER_ROWS as i32 + 1;
                x == ax || modulo(wrap_delta(ay, y, size), pitch) == 0 || self.lanes.has(x, y)
            }
            PlanKind::Rings { ways } => {
                let dx = wrap_delta(ax, x, size);
                let dy = wrap_delta(ay, y, size);
                let far = js_hypot(f64::from(dx), f64::from(dy));
                let lane = js_round(far / CITY_RING_STEP);
                if lane > 0.0 && (far - lane * CITY_RING_STEP).abs() <= FRAC_1_SQRT_2 {
                    return true;
                }
                ways.iter().any(|w| w.on(dx, dy))
            }
            PlanKind::MainStreet { .. } => {
                let pitch = CITY_SIDE_LANE_GAP as i32 + 1;
                self.across(x, y) == 0
                    || modulo(self.along(x, y), pitch) == 0
                    || self.lanes.has(x, y)
            }
        }
    }

    /// Whether a building of `kind` may have the north-west tile of its footprint here (`spot`).
    pub fn spot(&self, kind: BuildingKind, x: i32, y: i32) -> bool {
        let size = self.size;
        let (ax, ay) = self.anchor;
        match &self.kind {
            PlanKind::Grid => {
                let pitch = CITY_GRID_BLOCK as i32 + 1;
                let in_block = |from: i32, to: i32, side: i32| {
                    let at = modulo(wrap_delta(from, to, size), pitch);
                    at > 0 && (at - 1) % side == 0 && at - 1 + side <= CITY_GRID_BLOCK as i32
                };
                in_block(ax, x, side(kind)) && in_block(ay, y, side(kind))
            }
            PlanKind::Quarters => self.in_row(kind, x, y) && self.part_at(x, y) == quarter_of(kind),
            PlanKind::Rings { .. } => {
                let middle = f64::from(side(kind) - 1) / 2.0;
                let far = js_hypot(
                    f64::from(wrap_delta(ax, x, size)) + middle,
                    f64::from(wrap_delta(ay, y, size)) + middle,
                );
                let lane = (far / CITY_RING_STEP).floor();
                if lane == 0.0 {
                    return kind == BuildingKind::Storage;
                }
                (far - (lane + 0.5) * CITY_RING_STEP).abs() <= FRAC_1_SQRT_2
            }
            PlanKind::MainStreet { .. } => {
                let side = side(kind);
                let behind = self.back(kind, x, y);
                let pitch = CITY_SIDE_LANE_GAP as i32 + 1;
                let gap = CITY_SIDE_LANE_GAP as i32;
                let from = modulo(self.along(x, y), pitch) - 1;
                if behind < 0 || behind % side != 0 || from < 0 {
                    return false;
                }
                if from + side > gap {
                    return false;
                }
                if behind == 0 {
                    from % side == 0
                } else {
                    from == 0 || from + side == gap
                }
            }
        }
    }

    /// Which spots it fills first, lowest first (`rank`); `None` for a layout where all are alike.
    pub fn rank(&self, kind: BuildingKind, x: i32, y: i32) -> Option<i32> {
        match self.kind {
            PlanKind::MainStreet { .. } => Some(self.back(kind, x, y)),
            _ => None,
        }
    }

    /// Whether the layout ranks its spots (`plan.rank !== undefined`).
    pub fn has_rank(&self) -> bool {
        matches!(self.kind, PlanKind::MainStreet { .. })
    }

    /// Whether a building of `kind` may have that tile once no `spot` is left for it (`spill`);
    /// `None` for a layout that never spills.
    pub fn spill(&self, kind: BuildingKind, x: i32, y: i32) -> Option<bool> {
        match self.kind {
            PlanKind::Quarters => Some(self.in_row(kind, x, y)),
            _ => None,
        }
    }

    /// Whether the layout lets a building spill (`plan.spill !== undefined`).
    pub fn has_spill(&self) -> bool {
        matches!(self.kind, PlanKind::Quarters)
    }

    /// Quarters: whether a footprint stands in a row (`inRow`).
    fn in_row(&self, kind: BuildingKind, x: i32, y: i32) -> bool {
        let (size, (ax, ay)) = (self.size, self.anchor);
        let side = side(kind);
        let pitch = CITY_QUARTER_ROWS as i32 + 1;
        let dx = wrap_delta(ax, x, size);
        let at = modulo(wrap_delta(ay, y, size), pitch);
        dx != 0
            && modulo(if dx > 0 { dx - 1 } else { dx }, side) == 0
            && at > 0
            && (at - 1) % side == 0
            && at - 1 + side <= CITY_QUARTER_ROWS as i32
    }

    /// Quarters: the part a tile is in (`partAt`).
    fn part_at(&self, x: i32, y: i32) -> Quarter {
        let (size, (ax, ay)) = (self.size, self.anchor);
        if wrap_delta(ay, y, size) < 0 {
            return Quarter::Houses;
        }
        if wrap_delta(ax, x, size) < 0 {
            Quarter::Workshops
        } else {
            Quarter::Storages
        }
    }

    /// Main street: how far a tile lies to the side of the street (`across`).
    fn across(&self, x: i32, y: i32) -> i32 {
        let PlanKind::MainStreet { north_south, line } = self.kind else { unreachable!() };
        wrap_delta(line, if north_south { x } else { y }, self.size)
    }

    /// Main street: how far along it from the town hall a tile lies (`along`).
    fn along(&self, x: i32, y: i32) -> i32 {
        let PlanKind::MainStreet { north_south, .. } = self.kind else { unreachable!() };
        let (ax, ay) = self.anchor;
        if north_south {
            wrap_delta(ay, y, self.size)
        } else {
            wrap_delta(ax, x, self.size)
        }
    }

    /// Main street: tiles between the street and a footprint; negative for one on the street
    /// (`back`).
    fn back(&self, kind: BuildingKind, x: i32, y: i32) -> i32 {
        let at = self.across(x, y);
        if at > 0 {
            at - 1
        } else {
            -(at + side(kind))
        }
    }
}

/// The part of a Quarters city a kind of building belongs in (`quarterOf`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Quarter {
    Houses,
    Storages,
    Workshops,
}

fn quarter_of(kind: BuildingKind) -> Quarter {
    match kind {
        BuildingKind::House => Quarter::Houses,
        BuildingKind::Storage => Quarter::Storages,
        _ => Quarter::Workshops,
    }
}

/// What the city's layout says about the ground, or `None` for a city without one (`layoutPlan`).
/// `gate` is where its next gate goes, relative to its home, if it has a plan for one.
pub fn layout_plan(
    world: &WorldState,
    city: &City,
    home: &Building,
    gate: Option<GateAt>,
    size: i32,
) -> Option<LayoutPlan> {
    let layout = city.layout?;
    let anchor = middle_of(placed(town_hall_of(world, city).unwrap_or(home)), size);
    let offsets = gate_offsets(world, city, home, gate, size);
    let lanes = gate_lanes(home, &offsets, size);
    let kind = match layout {
        CityLayout::Grid => PlanKind::Grid,
        CityLayout::Quarters => PlanKind::Quarters,
        CityLayout::Rings => PlanKind::Rings { ways: gate_ways(home, anchor, &offsets, size) },
        CityLayout::MainStreet => {
            let way = match gate {
                Some(g) => g,
                None => offsets[0],
            };
            let north_south = way.dy.abs() >= way.dx.abs();
            let line = if north_south {
                wrap(home.x as i32 + way.dx, size)
            } else {
                wrap(home.y as i32 + way.dy, size)
            };
            PlanKind::MainStreet { north_south, line }
        }
    };
    Some(LayoutPlan { size, anchor, lanes, kind })
}

/// The ways from the city's gates, and from where its next gate goes, to the middle (`gateWays`):
/// straight in along the gate's line until level with the middle, then along to it.
fn gate_ways(home: &Building, anchor: (i32, i32), offsets: &[GateAt], size: i32) -> Vec<Way> {
    let home_dx = wrap_delta(anchor.0, home.x as i32, size);
    let home_dy = wrap_delta(anchor.1, home.y as i32, size);
    offsets
        .iter()
        .map(|&GateAt { dx, dy }| {
            if dy.abs() >= dx.abs() {
                Way {
                    gate_across: home_dx + dx,
                    gate_along: home_dy + dy,
                    out: dy.signum(),
                    swap: false,
                }
            } else {
                Way {
                    gate_across: home_dy + dy,
                    gate_along: home_dx + dx,
                    out: dx.signum(),
                    swap: true,
                }
            }
        })
        .collect()
}

/// The lines of tiles straight through the city's gates, and through where its next gate goes
/// (`gateLanes`): a column for a gate north or south of the home, else a row.
fn gate_lanes(home: &Building, offsets: &[GateAt], size: i32) -> Lanes {
    let mut lanes = Lanes::default();
    for &GateAt { dx, dy } in offsets {
        if dy.abs() >= dx.abs() {
            lanes.columns.insert(wrap(home.x as i32 + dx, size));
        } else {
            lanes.rows.insert(wrap(home.y as i32 + dy, size));
        }
    }
    lanes
}

/// Where the city's gates stand relative to its home, and where its next one goes (south of the
/// home when it has no plan for one yet) (`gateOffsets`).
fn gate_offsets(
    world: &WorldState,
    city: &City,
    home: &Building,
    gate: Option<GateAt>,
    size: i32,
) -> Vec<GateAt> {
    let mut out: Vec<GateAt> = world
        .buildings
        .iter()
        .filter(|b| b.kind == BuildingKind::Gate && b.city_id.as_ref() == Some(&city.id))
        .map(|b| GateAt {
            dx: wrap_delta(home.x as i32, b.x as i32, size),
            dy: wrap_delta(home.y as i32, b.y as i32, size),
        })
        .collect();
    out.push(gate.unwrap_or(GateAt { dx: 0, dy: 1 }));
    out
}

/// What a street goes up beside (`STREET_SIDE`): the town hall, and what a layout sets out.
pub const STREET_SIDE: [BuildingKind; 8] = [
    BuildingKind::TownHall,
    BuildingKind::House,
    BuildingKind::Storage,
    BuildingKind::Smelter,
    BuildingKind::Smithy,
    BuildingKind::Mint,
    BuildingKind::Stable,
    BuildingKind::TrainingGround,
];

/// The tiles of the city's streets it wants as road now (`streetsOwed`, `CONTEXT.md`: City
/// layout), nearest its home first: those touching a finished building of `STREET_SIDE`, corners
/// too, on passable land, with no finished road yet. Nothing is torn down for a street. None for a
/// city without a layout. `roads` is the finished roads (`worldIndex(world).roads(size)`).
pub fn streets_owed(
    world: &WorldState,
    city: &City,
    home: &Building,
    gate: Option<GateAt>,
    terrain: &TerrainMap,
    roads: &HashSet<usize>,
) -> Vec<(i32, i32)> {
    let size = terrain.size;
    let Some(plan) = layout_plan(world, city, home, gate, size) else { return Vec::new() };
    let own: HashSet<&String> = city.workplace_ids.iter().flatten().collect();
    // Insertion order, as a `Map` keeps it; the sort below is stable.
    let mut owed: Vec<(i32, i32)> = Vec::new();
    let mut seen: HashMap<usize, ()> = HashMap::new();
    for b in &world.buildings {
        if b.site.is_some() || !STREET_SIDE.contains(&b.kind) {
            continue;
        }
        if b.city_id.as_ref() != Some(&city.id) && !own.contains(&b.id) {
            continue;
        }
        for (fx, fy) in footprint_tiles(placed(b), size) {
            for dy in -1..=1 {
                for dx in -1..=1 {
                    let x = wrap(fx + dx, size);
                    let y = wrap(fy + dy, size);
                    let tile = tile_index(size, x, y);
                    if seen.contains_key(&tile) || roads.contains(&tile) || !plan.street(x, y) {
                        continue;
                    }
                    if building_at(world, x, y, size).is_some() {
                        continue;
                    }
                    if is_passable_terrain(terrain_at(terrain, x, y)) {
                        seen.insert(tile, ());
                        owed.push((x, y));
                    }
                }
            }
        }
    }
    let home_at = (home.x as i32, home.y as i32);
    let far = |&(x, y): &(i32, i32)| wrap_distance(size, home_at, (x, y));
    owed.sort_by(|a, b| far(a).total_cmp(&far(b)).then(a.1.cmp(&b.1)).then(a.0.cmp(&b.0)));
    owed
}

/// Invariant `city-streets-sound` (`CONTEXT.md`: City layout; ADR 0004): no city without a layout
/// plans streets, and no tile of them stands twice.
pub fn city_streets_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for city in &world.cities {
        let Some(streets) = world.city_plans.get(&city.id).and_then(|p| p.streets.as_ref()) else {
            continue;
        };
        let mut report = |what: &str| {
            out.push(InvariantViolation {
                invariant: "city-streets-sound".into(),
                message: format!("{} {what}", city.id),
                entity_ids: vec![city.id.clone()],
            })
        };
        if city.layout.is_none() {
            report("has no layout but plans streets");
        }
        let tiles: HashSet<String> = streets.iter().map(|t| format!("{},{}", t.0, t.1)).collect();
        if tiles.len() != streets.len() {
            report("plans a tile of street twice");
        }
    }
    out
}

/// Invariant `city-layouts-sound` (`CONTEXT.md`: City layout; ADR 0004): every NPC city has a
/// known layout, and a trading post, the HQ or a Player's city has none.
pub fn city_layouts_sound(world: &WorldState) -> Vec<InvariantViolation> {
    let mut out = Vec::new();
    for city in &world.cities {
        let mut report = |what: String| {
            out.push(InvariantViolation {
                invariant: "city-layouts-sound".into(),
                message: format!("{} {what}", city.id),
                entity_ids: vec![city.id.clone()],
            })
        };
        let npc = city.realm_id.is_none() && city.trade_org.is_none();
        if npc && city.layout.is_none() {
            report("is an NPC city with no layout".into());
        }
        if let (false, Some(layout)) = (npc, city.layout) {
            let name = serde_json::to_value(layout).expect("a layout");
            report(format!("is no NPC city but has the layout {}", name.as_str().unwrap_or("")));
        }
        // An unknown layout cannot be read into `CityLayout`; the save loader refuses it.
    }
    out
}

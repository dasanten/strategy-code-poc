//! The benchmarks (ADR 0030): `bench-world` (world generation by stage) and `bench-sim` (ms per
//! tick per phase). The twin of `scripts/bench-ts.mts` (T84.7): the same tables line for line, so
//! the Rust and the TypeScript numbers compare directly. Results go under `## Measurements` in
//! `docs/proposals/rust-rewrite.md`.
//!
//! `bench-ts.mts suite` (the TypeScript test suite's wall time) has no twin: `cargo nextest run`
//! prints its own.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use csp_shared::balance::{MAP_SIZE, NPC_VILLAGE};
use csp_shared::terrain::{tile_index, Terrain, TerrainMap};
use csp_shared::world::{ResourceKind, ResourceNode, WorldState};
use csp_sim::sight::InvariantViolation;
use csp_sim::terrain_gen::{generate_terrain, generate_terrain_timed};
use csp_sim::tick::{
    run_tick, Scratch, ScriptErrorWhere, TickHealth, TickOptions, TickPhase, TickReporter,
    TICK_PHASES,
};
use csp_sim::world::{create_world, generate_world, generate_world_timed};

use crate::db::open_db;
use crate::saves::load_or_create_world;

/// Where a benchmark's lines go: stdout in the binaries, a `Vec` in the tests.
pub type Out<'a> = dyn FnMut(&str) + 'a;

/// The machine and the day, for the line above every table (`machineLine`).
pub fn machine_line() -> String {
    let mut sys = sysinfo::System::new();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
    sys.refresh_memory();
    let cpu = sys.cpus().first().map(|c| c.brand().trim().to_string()).filter(|b| !b.is_empty());
    let threads = std::thread::available_parallelism().map_or(0, |n| n.get());
    let gib = (sys.total_memory() as f64 / 2f64.powi(30)).round();
    let build = if cfg!(debug_assertions) { "debug" } else { "release" };
    format!(
        "{}, {}, {threads} threads, {gib} GiB, rust {build}",
        today(),
        cpu.as_deref().unwrap_or("unknown CPU"),
    )
}

/// Today as `YYYY-MM-DD` (UTC, as `toISOString`).
fn today() -> String {
    let days = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() / 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The calendar date of a day number since 1970-01-01 (Howard Hinnant's `civil_from_days`).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// A Markdown table, the first column left-aligned and the rest right-aligned (`table`).
pub fn table(header: &[&str], rows: &[Vec<String>], out: &mut Out<'_>) {
    let widths: Vec<usize> = header
        .iter()
        .enumerate()
        .map(|(i, h)| rows.iter().map(|r| r[i].chars().count()).fold(h.chars().count(), usize::max))
        .collect();
    let line = |cells: &[&str]| {
        let padded: Vec<String> = cells
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let pad = " ".repeat(widths[i].saturating_sub(c.chars().count()));
                if i == 0 {
                    format!("{c}{pad}")
                } else {
                    format!("{pad}{c}")
                }
            })
            .collect();
        format!("| {} |", padded.join(" | "))
    };
    out(&line(header));
    let rule: Vec<String> = widths
        .iter()
        .enumerate()
        .map(|(i, w)| {
            if i == 0 {
                format!(":{}", "-".repeat(w + 1))
            } else {
                format!("{}:", "-".repeat(w + 1))
            }
        })
        .collect();
    out(&format!("|{}|", rule.join("|")));
    for r in rows {
        let cells: Vec<&str> = r.iter().map(String::as_str).collect();
        out(&line(&cells));
    }
}

/// A time in ms as the tables print it (`fmt`): whole from 100, two places from 1, else three.
pub fn fmt(ms: f64) -> String {
    if ms >= 100.0 {
        format!("{ms:.0}")
    } else if ms >= 1.0 {
        format!("{ms:.2}")
    } else {
        format!("{ms:.3}")
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

// ---------------------------------------------------------------------------------------- world

/// What `bench_world` made, for its tests.
pub struct WorldBench {
    pub terrain_stages: Vec<(&'static str, f64)>,
    pub world_stages: Vec<(&'static str, f64)>,
    pub world: WorldState,
}

/// Times `generate_terrain` and `generate_world` by stage and prints both tables (`benchWorld`).
pub fn bench_world(size: i32, seed: i64, out: &mut Out<'_>) -> WorldBench {
    let mut terrain_stages = Vec::new();
    let mut world_stages = Vec::new();
    out(&format!("world {size}x{size}, seed {seed}: {}", machine_line()));
    let t0 = Instant::now();
    let terrain = generate_terrain_timed(seed, size, &mut |stage, took| {
        terrain_stages.push((stage, ms(took)))
    });
    let terrain_ms = ms(t0.elapsed());
    let t1 = Instant::now();
    let world = generate_world_timed(&terrain, seed, &mut |stage, took| {
        world_stages.push((stage, ms(took)))
    });
    let world_ms = ms(t1.elapsed());
    let rows = |stages: &[(&str, f64)], total: f64| -> Vec<Vec<String>> {
        let mut rows: Vec<Vec<String>> = stages
            .iter()
            .map(|(s, ms)| vec![s.to_string(), fmt(*ms), format!("{:.1}%", ms / total * 100.0)])
            .collect();
        rows.push(vec!["total".into(), fmt(total), "100.0%".into()]);
        rows
    };
    out("");
    table(&["generateTerrain stage", "ms", "share"], &rows(&terrain_stages, terrain_ms), out);
    out("");
    table(&["generateWorld stage", "ms", "share"], &rows(&world_stages, world_ms), out);
    out("");
    out(&format!(
        "made: {} nodes, {} cities, {} residents, {} caravans, {} traders",
        world.nodes.len(),
        world.cities.len(),
        world.residents.len(),
        world.caravans.len(),
        world.traders.len()
    ));
    WorldBench { terrain_stages, world_stages, world }
}

// ----------------------------------------------------------------------------------------- sim

/// A world to step and its terrain.
pub struct Scene {
    pub world: WorldState,
    pub terrain: TerrainMap,
}

/// The scenes `bench-sim` steps (`SCENES`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SceneName {
    Village,
    Villages,
    Hq,
    Save,
}

impl SceneName {
    pub const ALL: [SceneName; 4] =
        [SceneName::Village, SceneName::Villages, SceneName::Hq, SceneName::Save];

    pub fn name(self) -> &'static str {
        match self {
            SceneName::Village => "village",
            SceneName::Villages => "villages",
            SceneName::Hq => "hq",
            SceneName::Save => "save",
        }
    }

    pub fn parse(name: &str) -> Option<SceneName> {
        SceneName::ALL.into_iter().find(|s| s.name() == name)
    }
}

/// Ticks `bench-sim` steps unless told otherwise (`DEFAULT_TICKS`).
pub const DEFAULT_TICKS: usize = 600;

fn plains(size: i32) -> TerrainMap {
    TerrainMap { size, tiles: vec![Terrain::Plains as u8; (size * size) as usize] }
}

/// Founds an NPC city of `kind` with its top-left corner at (x, y) (`foundNpcCity`).
// TODO(T86.10): `csp_sim::npc_cities::found_npc_city` once the NPC cities are ported; until then
// the scenes have no cities and `bench-sim` times an empty world.
fn found_npc_city(
    _world: &mut WorldState,
    _terrain: &TerrainMap,
    _kind: csp_shared::balance::NpcCitySize,
    _x: i32,
    _y: i32,
    _rand: &mut dyn FnMut() -> f64,
) {
}

/// Founds the Trade Org HQ at (x, y) (`foundTradeOrgHq`).
// TODO(T86.9): `csp_sim::trade_org::found_trade_org_hq` once the Trade Organization is ported.
fn found_trade_org_hq(
    _world: &mut WorldState,
    _terrain: &TerrainMap,
    _x: i32,
    _y: i32,
    _rand: &mut dyn FnMut() -> f64,
) {
}

fn mulberry(seed: u32) -> impl FnMut() -> f64 {
    let mut rng = csp_sim::random::Mulberry32::new(f64::from(seed));
    move || rng.next()
}

fn node(id: &str, kind: ResourceKind, x: i32, y: i32) -> ResourceNode {
    ResourceNode { id: id.into(), kind, x: f64::from(x), y: f64::from(y) }
}

/// `village()` of `npc-growth.fixture.ts`: one village on a Plains map with a forest east of it.
pub fn village() -> Scene {
    let mut terrain = plains(200);
    let mut world = create_world(&terrain, 1);
    found_npc_city(&mut world, &terrain, NPC_VILLAGE, 20, 20, &mut mulberry(7));
    world.nodes.push(node("forest", ResourceKind::Forest, 34 + 40, 34));
    terrain.tiles[tile_index(terrain.size, 34 + 40, 34)] = Terrain::Forest as u8;
    Scene { world, terrain }
}

/// `villages(n)` of `npc-plan.test.ts`: `n` villages in a grid on a Plains map.
pub fn villages(n: usize) -> Scene {
    let side = (n as f64).sqrt().ceil() as i32;
    let step = NPC_VILLAGE.size as i32 + 20;
    let terrain = plains(side * step + 40);
    let mut world = create_world(&terrain, 1);
    let mut rand = mulberry(11);
    for i in 0..n as i32 {
        let (x, y) = (20 + (i % side) * step, 20 + (i / side) * step);
        found_npc_city(&mut world, &terrain, NPC_VILLAGE, x, y, &mut rand);
    }
    Scene { world, terrain }
}

/// `hq()` of `trade-org.test.ts`: the Trade Org HQ alone on a Plains map 640 across, four nodes.
pub fn hq() -> Scene {
    let mid = 320;
    let mut terrain = plains(640);
    let nodes = [
        (ResourceKind::Forest, mid + 80, mid),
        (ResourceKind::Stone, mid + 80, mid + 12),
        (ResourceKind::IronOre, mid + 88, mid - 12),
        (ResourceKind::GoldOre, mid + 96, mid),
    ];
    for (kind, x, y) in nodes {
        let t = if kind == ResourceKind::Forest { Terrain::Forest } else { Terrain::Hills };
        terrain.tiles[tile_index(terrain.size, x, y)] = t as u8;
    }
    let mut world = create_world(&terrain, 1);
    world.nodes =
        nodes.iter().enumerate().map(|(i, &(k, x, y))| node(&format!("n{i}"), k, x, y)).collect();
    found_trade_org_hq(&mut world, &terrain, mid, mid, &mut mulberry(7));
    Scene { world, terrain }
}

/// The newest save of the database at `source`, read from a copy so the original is left alone.
pub fn save_from(source: &Path) -> Result<Scene, String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let copy = dir.path().join("world.db");
    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", source.display()));
        if from.exists() {
            let to = PathBuf::from(format!("{}{suffix}", copy.display()));
            std::fs::copy(&from, &to).map_err(|e| format!("{}: {e}", from.display()))?;
        }
    }
    let conn = open_db(&copy, None).map_err(|e| e.to_string())?;
    let (world, terrain) =
        load_or_create_world(&conn, |seed| generate_terrain(seed, MAP_SIZE), generate_world, 1)
            .map_err(|e| e.to_string())?;
    Ok(Scene { world, terrain })
}

/// The newest save of the database at `DB_PATH` (`save`).
fn save() -> Result<Scene, String> {
    let source = std::env::var_os("DB_PATH")
        .ok_or("sim save needs DB_PATH, the database to read the newest save from")?;
    save_from(Path::new(&source))
}

/// The scene by name.
pub fn scene(name: SceneName) -> Result<Scene, String> {
    Ok(match name {
        SceneName::Village => village(),
        SceneName::Villages => villages(60),
        SceneName::Hq => hq(),
        SceneName::Save => save()?,
    })
}

/// A reporter that ignores what it is told and stops at errors (`quiet`).
struct Quiet;

impl TickReporter for Quiet {
    fn invariant_violations(&mut self, _world: &WorldState, _violations: &[InvariantViolation]) {}
    fn tick_health(&mut self, _world: &WorldState, _health: &TickHealth) {}
    fn tick_error(&mut self, _world: &WorldState, error: &str) {
        panic!("{error}")
    }
    fn script_error(&mut self, _world: &WorldState, error: &str, _at: &ScriptErrorWhere) {
        panic!("{error}")
    }
}

/// The `p` percentile of sorted values (`percentile`).
pub fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let i = ((p * sorted.len() as f64).ceil() as usize).saturating_sub(1);
    sorted[i.min(sorted.len() - 1)]
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().sum::<f64>() / (xs.len().max(1) as f64)
}

fn p95(xs: &[f64]) -> f64 {
    let mut sorted = xs.to_vec();
    sorted.sort_by(f64::total_cmp);
    percentile(&sorted, 0.95)
}

/// What `bench_sim` measured: each phase's ms, the tick's ms and the residents, tick by tick.
pub struct SimBench {
    pub phases: Vec<(TickPhase, Vec<f64>)>,
    pub totals: Vec<f64>,
    pub residents: Vec<f64>,
}

/// Steps the scene through `run_tick` with the invariants off and prints the mean and p95 of every
/// phase, the residents, and ms per tick per resident (`benchSim`). Players' queues, orders and
/// scripts are not wired, so the NPC cities' residents' scripts are what runs; the phases that
/// belong to the server loop (`finish`) are not run and print 0.
pub fn bench_sim(name: SceneName, scene: Scene, ticks: usize, out: &mut Out<'_>) -> SimBench {
    let Scene { mut world, terrain } = scene;
    let mut scratch = Scratch::default();
    let mut reporter = Quiet;
    let mut phases: Vec<(TickPhase, Vec<f64>)> =
        TICK_PHASES.iter().map(|&p| (p, Vec::with_capacity(ticks))).collect();
    let mut totals = Vec::with_capacity(ticks);
    let mut residents = Vec::with_capacity(ticks);
    let start_residents = world.residents.len();
    for i in 0..ticks {
        // TODO(T86.4): `walking: Some(&mut Walking::new(&terrain))`, as the TypeScript bench does.
        let opts = TickOptions::new(&mut reporter, 0.0, f64::INFINITY);
        let Some(health) = run_tick(&mut world, &terrain, &mut scratch, opts) else {
            panic!("tick {i} failed");
        };
        for (p, xs) in &mut phases {
            xs.push(health.phases.get(*p));
        }
        totals.push(health.duration_ms);
        residents.push(health.residents as f64);
    }
    out(&format!(
        "sim {}, {ticks} ticks, invariants off, {}x{} map, {start_residents} residents at the start: {}",
        name.name(),
        terrain.size,
        terrain.size,
        machine_line()
    ));
    out("");
    let mut rows: Vec<Vec<String>> = phases
        .iter()
        .map(|(p, xs)| vec![p.name().to_string(), fmt(mean(xs)), fmt(p95(xs))])
        .collect();
    rows.push(vec!["tick (total)".into(), fmt(mean(&totals)), fmt(p95(&totals))]);
    table(&["phase", "mean ms", "p95 ms"], &rows, out);
    let mean_residents = mean(&residents);
    let per = if mean_residents == 0.0 { 1.0 } else { mean_residents };
    out("");
    out(&format!(
        "residents: {mean_residents:.0} on average ({start_residents} to {}); ms per tick per resident: {} mean, {} p95",
        world.residents.len(),
        fmt(mean(&totals) / per),
        fmt(p95(&totals) / per),
    ));
    out("(npc, walking, rest and lastSeen are parts of world; phases the server loop owns print 0.)");
    SimBench { phases, totals, residents }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(run: impl FnOnce(&mut Out<'_>)) -> Vec<String> {
        let mut lines = Vec::new();
        run(&mut |l: &str| lines.push(l.to_string()));
        lines
    }

    #[test]
    fn prints_a_markdown_table_with_aligned_columns() {
        let rows = vec![vec!["seas".into(), "12.50".into()], vec!["total".into(), "100".into()]];
        let out = lines(|out| table(&["stage", "ms"], &rows, out));
        assert_eq!(
            out,
            ["| stage |    ms |", "|:------|------:|", "| seas  | 12.50 |", "| total |   100 |"]
        );
    }

    #[test]
    fn formats_times_as_the_typescript_bench() {
        assert_eq!(fmt(1234.4), "1234");
        assert_eq!(fmt(100.0), "100");
        assert_eq!(fmt(12.345), "12.35");
        assert_eq!(fmt(0.01234), "0.012");
    }

    #[test]
    fn takes_the_percentile_as_the_typescript_bench() {
        let sorted: Vec<f64> = (1..=20).map(f64::from).collect();
        assert_eq!(percentile(&sorted, 0.95), 19.0);
        assert_eq!(percentile(&[3.0], 0.95), 3.0);
        assert_eq!(percentile(&[], 0.95), 0.0);
    }

    #[test]
    fn knows_the_day_of_a_day_number() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_765), (2026, 11, 8));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }
}

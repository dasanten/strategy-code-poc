//! A small test world (`CONTEXT.md`: Creative mode, Test worlds; Epic 117, `csp-admin new-world`):
//! a new world at a size and seed the admin picks, made by the generator the live game uses
//! (terrain, regions, starting sites, the Trade Organization and its posts, NPC cities), into a
//! database of its own. The server opens it as any other (`DB_PATH`): its terrain is stored, so the
//! size comes from the world, and so is its first save, so the server starts on it as generated.

use std::{
    path::{Path, PathBuf},
    time::Instant,
};

use csp_shared::{balance::{MAP_SIZE, SMALL_WORLD_MIN_SIZE}, chunks::CHUNK_SIZE, terrain::TerrainMap, world::WorldState};
use csp_sim::{
    queries::trade_org::trade_org_hq, terrain_gen::generate_terrain, trading_posts::trading_posts,
    world::generate_world,
};

use crate::{
    db::open_db,
    saves::{save_terrain, save_world},
};

/// The size `new-world` makes without `--size`: a small world (`is_small_world`) where the
/// generator places the Trade Organization and a few NPC cities whatever the seed.
pub const DEFAULT_SIZE: i32 = 768;

/// The smallest world `new-world` makes (`SMALL_WORLD_MIN_SIZE`).
pub const MIN_SIZE: i32 = SMALL_WORLD_MIN_SIZE;

/// A map's side is a whole number of these, so its chunks and overview squares come out whole.
pub const SIZE_STEP: i32 = 2 * CHUNK_SIZE;

pub const USAGE: &str = "usage: admin new-world --db <path> [--size <tiles>] [--seed <n>]";

/// What `new-world` was asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewWorld {
    pub db: PathBuf,
    pub size: i32,
    pub seed: i64,
}

/// `new-world`'s arguments (after the command): `--db` is needed; `--size` is `DEFAULT_SIZE`
/// without it and `--seed` random.
pub fn parse(args: &[String]) -> Result<NewWorld, String> {
    let value = |flag: &str| -> Result<Option<&String>, String> {
        match args.iter().position(|a| a == flag) {
            Some(i) => args.get(i + 1).map(Some).ok_or_else(|| USAGE.to_owned()),
            None => Ok(None),
        }
    };
    let known = ["--db", "--size", "--seed"];
    let mut rest = args.iter();
    while let Some(a) = rest.next() {
        if !known.contains(&a.as_str()) {
            return Err(USAGE.to_owned());
        }
        rest.next();
    }
    let db = value("--db")?.map(PathBuf::from).ok_or_else(|| USAGE.to_owned())?;
    let size = match value("--size")? {
        Some(s) => s.parse::<i32>().map_err(|_| USAGE.to_owned())?,
        None => DEFAULT_SIZE,
    };
    if !(MIN_SIZE..=MAP_SIZE).contains(&size) || size % SIZE_STEP != 0 {
        return Err(format!(
            "--size is a multiple of {SIZE_STEP} from {MIN_SIZE} to {MAP_SIZE} tiles, not {size}"
        ));
    }
    let seed = match value("--seed")? {
        Some(s) => s.parse::<i64>().ok().filter(|s| *s > 0).ok_or_else(|| USAGE.to_owned())?,
        None => crate::reset::new_seed(None),
    };
    Ok(NewWorld { db, size, seed })
}

/// What a new world holds, for `new-world` to print and refuse on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Made {
    pub hq: bool,
    pub posts: usize,
    pub npc_cities: usize,
    pub starting_sites: usize,
    pub caravans: usize,
    pub traders: usize,
}

impl Made {
    pub fn of(world: &WorldState) -> Made {
        let npc_cities =
            world.cities.iter().filter(|c| c.trade_org.is_none() && c.realm_id.is_none()).count();
        Made {
            hq: trade_org_hq(world).is_some(),
            posts: trading_posts(world).len(),
            npc_cities,
            starting_sites: world.starting_sites.len(),
            caravans: world.caravans.len(),
            traders: world.traders.len(),
        }
    }

    /// Whether it holds what a test world is for: the HQ, a trading post with its caravan and an
    /// NPC city.
    pub fn whole(&self) -> bool {
        self.hq && self.posts > 0 && self.caravans > 0 && self.npc_cities > 0
    }
}

/// The world and terrain of `size` and `seed`, as the generator makes them.
pub fn generate(size: i32, seed: i64) -> (TerrainMap, WorldState) {
    let terrain = generate_terrain(seed, size);
    let world = generate_world(&terrain, seed);
    (terrain, world)
}

/// `csp-admin new-world`: refuses a database that exists; generates the world; refuses one without
/// the HQ, a trading post or an NPC city (another seed or size may have room), writing nothing;
/// otherwise stores its terrain and first save in a new database at `db`.
pub fn new_world(order: &NewWorld) -> Result<String, String> {
    let NewWorld { db, size, seed } = order;
    if db.exists() {
        return Err(format!("{} exists: new-world makes a new database only", db.display()));
    }
    let started = Instant::now();
    let (terrain, world) = generate(*size, *seed);
    let made = Made::of(&world);
    if !made.whole() {
        return Err(format!(
            "seed {seed} at {size} tiles has no room for {}: try another seed or size. \
             Nothing written.",
            missing(&made)
        ));
    }
    write(db, *seed, &terrain, &world)?;
    let secs = started.elapsed().as_secs_f64();
    Ok(format!(
        "Made a {size}×{size} world, seed {seed}, in {secs:.1} s: the Trade Org HQ, {} trading \
         posts, {} NPC cities, {} starting sites, {} caravans, {} wandering traders.\n\
         Written to {}. Start a creative server on it with DB_PATH={} CREATIVE=1.",
        made.posts,
        made.npc_cities,
        made.starting_sites,
        made.caravans,
        made.traders,
        db.display(),
        db.display(),
    ))
}

fn missing(made: &Made) -> String {
    let mut out = Vec::new();
    if !made.hq {
        out.push("the Trade Org HQ");
    }
    if made.posts == 0 || made.caravans == 0 {
        out.push("a trading post with a caravan");
    }
    if made.npc_cities == 0 {
        out.push("an NPC city");
    }
    out.join(" or ")
}

/// Stores the terrain and the world's first save in a new database at `db`.
fn write(db: &Path, seed: i64, terrain: &TerrainMap, world: &WorldState) -> Result<(), String> {
    if let Some(dir) = db.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let conn = open_db(db, None).map_err(|e| e.to_string())?;
    save_terrain(&conn, seed, terrain).map_err(|e| e.to_string())?;
    save_world(&conn, world).map_err(|e| e.to_string())?;
    Ok(())
}

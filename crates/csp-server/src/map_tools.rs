//! Dev tools on the command line for measuring the map (Epic 99, ADR 0034), run by `csp-admin`:
//! `explore` stages a far-explored Player in a copy of a world, and `map-stats` prints what each
//! Player's map costs as it is sent today. Never routes.

use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;
use csp_sim::explored::ExploredTerrain;
use csp_sim::queries::city::town_hall_of;
use csp_sim::queries::territory::compute_territory;
use csp_sim::sight::SightTracker;
use csp_sim::world_index::world_index;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::auth::now_ms;
use crate::explored::{load_explored, save_explored};
use crate::first_day::read_first_day;
use crate::realtime::{welcome_message, TickView};
use crate::saves::{gzip, latest_save, load_terrain};
use crate::world_format::{migrate_world, MigrationContext, RESET_BEFORE};

/// What `explore` marks as explored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    /// A disc of this radius in tiles around the town hall of the Player's first city.
    Radius(i32),
    /// The whole map.
    All,
}

/// What `explore` says, and all it does, without `--yes`.
pub const EXPLORE_WARNING: &str = "explore writes a Player's explored terrain into the database. \
Run it on a copy of a world (DB_PATH) or with the server stopped: a running server writes its \
own bitmap back at its next save. Add --yes to write.";

/// The newest save and the terrain, as the server would start with them, read without writing:
/// no world is made, no terrain generated and no old world reset.
pub fn load_world(conn: &Connection) -> Result<(WorldState, TerrainMap), String> {
    let (state, version) = latest_save(conn).map_err(|e| e.to_string())?.ok_or("no saved world")?;
    if version < RESET_BEFORE {
        return Err(format!("the saved world's format {version} is from before the last reset"));
    }
    let (_, terrain) = load_terrain(conn).map_err(|e| e.to_string())?.ok_or("no terrain stored")?;
    let migrated = migrate_world(state, version, &MigrationContext { terrain: &terrain })
        .map_err(|e| e.to_string())?;
    let world = serde_json::from_value(migrated).map_err(|e| e.to_string())?;
    Ok((world, terrain))
}

/// The account of that name, or of that id: its id.
fn user_id_of(conn: &Connection, player: &str) -> Result<i64, String> {
    let by_name = conn
        .query_row("SELECT id FROM users WHERE name = ?1", [player], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = by_name {
        return Ok(id);
    }
    let by_id = match player.parse::<i64>() {
        Ok(id) => conn
            .query_row("SELECT id FROM users WHERE id = ?1", [id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?,
        Err(_) => None,
    };
    by_id.ok_or_else(|| format!("no account {player}"))
}

/// Marks tiles as explored for a Player in the database (`csp-admin explore`): a disc around their
/// first city's town hall, across the map's joins, or the whole map. Writes their `explored` row
/// as the server saves it, and nothing else. Without `yes` it only says what it would do.
pub fn explore(conn: &Connection, player: &str, reach: Reach, yes: bool) -> Result<String, String> {
    if !yes {
        return Err(EXPLORE_WARNING.to_owned());
    }
    let user_id = user_id_of(conn, player)?;
    let row: Option<Vec<u8>> = conn
        .query_row("SELECT data FROM explored WHERE user_id = ?1", [user_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let rows = row.map(|bits| (user_id as u64, bits));
    let (world, terrain) = match reach {
        Reach::All => {
            (None, load_terrain(conn).map_err(|e| e.to_string())?.ok_or("no terrain stored")?.1)
        }
        Reach::Radius(_) => {
            let (world, terrain) = load_world(conn)?;
            (Some(world), terrain)
        }
    };
    let mut explored = ExploredTerrain::from_bitmaps(terrain, &[], rows);
    let before = explored.explored_tiles(user_id as u64);
    match (reach, world) {
        (Reach::Radius(radius), Some(world)) => {
            let realm = world
                .realms
                .iter()
                .find(|r| r.user_id == user_id as u64)
                .ok_or_else(|| format!("{player} has no realm"))?;
            let hall = world
                .cities
                .iter()
                .find(|c| c.realm_id.as_deref() == Some(realm.id.as_str()))
                .and_then(|c| town_hall_of(&world, c))
                .ok_or_else(|| format!("{player}'s realm has no city with a town hall"))?;
            let (x, y) = (hall.x.floor() as i32, hall.y.floor() as i32);
            explored.explore(user_id as u64, x, y, radius);
        }
        _ => explored.explore_all(user_id as u64),
    }
    save_explored(conn, &mut explored, now_ms()).map_err(|e| e.to_string())?;
    let after = explored.explored_tiles(user_id as u64);
    let chunks = explored.explored_chunks(user_id as u64).len();
    Ok(format!("{player} has explored {after} tiles in {chunks} chunks (was {before} tiles)."))
}

/// The bytes of a welcome by part, as JSON on the socket.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WelcomeBytes {
    pub explored_chunks: usize,
    pub entities: usize,
    pub last_seen: usize,
    pub region: usize,
    /// Everything else: the keys, the account, the events, diplomacy and the rest.
    pub rest: usize,
    pub total: usize,
    /// The whole welcome gzipped, as a compressed message would be.
    pub gzipped: usize,
}

impl WelcomeBytes {
    /// A welcome measured by part.
    pub fn of(welcome: &Value) -> Self {
        let text = welcome.to_string();
        let part = |key: &str| welcome.get(key).map_or(0, |v| v.to_string().len());
        // Explored terrain as the welcome lists it: with counts (ADR 0034), or plainly before.
        let explored_chunks = part("exploredCounts") + part("exploredChunks");
        let (entities, last_seen, region) = (part("entities"), part("lastSeen"), part("region"));
        WelcomeBytes {
            explored_chunks,
            entities,
            last_seen,
            region,
            rest: text.len() - explored_chunks - entities - last_seen - region,
            total: text.len(),
            gzipped: gzip(text.as_bytes()).map_or(0, |g| g.len()),
        }
    }
}

/// What one Player's map costs as it is sent today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerMap {
    pub user_id: i64,
    pub name: String,
    pub explored_tiles: usize,
    pub explored_chunks: usize,
    /// What they remember out of sight: entries.
    pub last_seen: usize,
    /// Organizations on their Region map, and the tiles they hold on it.
    pub region_holders: usize,
    pub region_tiles: usize,
    pub welcome: WelcomeBytes,
}

/// What every Player's map costs as sent today (`csp-admin map-stats`), for the latest save: their
/// welcome built by the code that builds it for the socket, after their residents looked around,
/// with territory worked out once. Reads the database and changes nothing.
pub fn map_stats(conn: &Connection) -> Result<Vec<PlayerMap>, String> {
    let (world, terrain) = load_world(conn)?;
    let size = terrain.size;
    let mut explored = load_explored(conn, terrain, &world.nodes).map_err(|e| e.to_string())?;
    let mut slot = None;
    SightTracker::new().update(&world, world_index(&mut slot, &world, size), &mut explored);
    let territory = compute_territory(&world, size);
    let index = world_index(&mut slot, &world, size);
    let view = TickView { territory: Some(&territory), explored: &explored };
    let mut realms: Vec<_> = world.realms.iter().collect();
    realms.sort_by_key(|r| r.user_id);
    let mut out = Vec::new();
    for realm in realms {
        let user_id = realm.user_id as i64;
        let account: Option<(String, bool)> = conn
            .query_row("SELECT name, is_admin FROM users WHERE id = ?1", [user_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()
            .map_err(|e| e.to_string())?;
        let (name, is_admin) = account.unwrap_or_else(|| (format!("#{user_id}"), false));
        let account = json!({ "name": name, "isAdmin": is_admin });
        let first_day = read_first_day(conn, user_id).ok();
        let from = (&world, size, index, view);
        let Some(welcome) = welcome_message(from, &realm.id, user_id, &account, first_day) else {
            continue;
        };
        let holders = welcome["region"]["holders"].as_array().cloned().unwrap_or_default();
        out.push(PlayerMap {
            user_id,
            name,
            explored_tiles: explored.explored_tiles(realm.user_id),
            explored_chunks: explored.explored_chunks(realm.user_id).len(),
            last_seen: welcome["lastSeen"].as_array().map_or(0, Vec::len),
            region_holders: holders.len(),
            region_tiles: holders.iter().map(|h| h["tiles"].as_array().map_or(0, Vec::len)).sum(),
            welcome: WelcomeBytes::of(&welcome),
        });
    }
    Ok(out)
}

/// `map-stats` as printed: one block per Player.
pub fn describe_map_stats(players: &[PlayerMap]) -> String {
    if players.is_empty() {
        return "No Player has a realm.".to_owned();
    }
    let mut out = Vec::new();
    for p in players {
        let w = &p.welcome;
        out.push(format!(
            "{} (#{})\n  explored: {} tiles in {} chunks\n  Last seen out of sight: {} entries, \
             {} of JSON\n  Region map: {} holders, {} tiles, {} of JSON\n  welcome: {} ({} \
             gzipped): explored terrain {}, entities {}, lastSeen {}, region {}, the rest {}",
            p.name,
            p.user_id,
            p.explored_tiles,
            p.explored_chunks,
            p.last_seen,
            bytes(w.last_seen),
            p.region_holders,
            p.region_tiles,
            bytes(w.region),
            bytes(w.total),
            bytes(w.gzipped),
            bytes(w.explored_chunks),
            bytes(w.entities),
            bytes(w.last_seen),
            bytes(w.region),
            bytes(w.rest),
        ));
    }
    out.join("\n")
}

/// Bytes, in B, KB or MB (of 1,000).
fn bytes(n: usize) -> String {
    match n {
        n if n < 1_000 => format!("{n} B"),
        n if n < 1_000_000 => format!("{:.1} KB", n as f64 / 1e3),
        n => format!("{:.2} MB", n as f64 / 1e6),
    }
}

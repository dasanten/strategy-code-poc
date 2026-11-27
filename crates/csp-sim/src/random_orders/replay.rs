//! A replay file: a failure of the random run as plain data (its world, its orders with their
//! tick, what broke), read back and played again. A file in `replays/` is a regression test: it
//! must keep the invariants (`every_replay_keeps_the_invariants`). `docs/recipes.md` ("A failure of
//! the random-order run") says how a failure becomes one.

use std::path::PathBuf;

use csp_shared::terrain::TerrainMap;
use csp_shared::world::WorldState;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{play, Broke, Failure, Given};
use crate::test_world::two_realms_world;

/// A run to play again.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Replay {
    /// What it is, for a reader: the bug it is the regression test of.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// The world it starts from, by its maker's name: `twoRealms` ([`two_realms_world`]).
    pub world: String,
    /// The map's side, in tiles.
    pub size: i32,
    /// The seed of the random run it came from (the orders are in the file, so it only tells).
    pub seed: u64,
    /// How many ticks it runs.
    pub ticks: u64,
    /// What broke when it was written.
    pub broke: Broken,
    /// The orders, each given before its tick of the run.
    pub orders: Vec<Step>,
}

/// An order of a replay.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    /// The tick of the run (from 0) it is given before.
    pub tick: u64,
    pub user_id: u64,
    pub order: Value,
}

/// What broke a run, as a replay file keeps it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Broken {
    /// The first invariant broken, and its message.
    Invariant {
        name: String,
        message: String,
    },
    Panic {
        message: String,
    },
}

impl Broken {
    /// What broke `failure`: its first invariant, or its panic.
    pub fn of(failure: &Failure) -> Broken {
        match &failure.broke {
            Broke::Invariants(vs) => {
                let v = vs.first().expect("a broken run breaks an invariant");
                Broken::Invariant { name: v.invariant.clone(), message: v.message.clone() }
            }
            Broke::Panic(m) => Broken::Panic { message: m.clone() },
        }
    }

    /// Whether `failure` broke the same way: the same invariant among those it broke, or a panic
    /// with the same text but for its numbers (ids and amounts move when orders are dropped).
    pub fn is_broken_by(&self, failure: &Failure) -> bool {
        let digitless = |s: &str| s.chars().filter(|c| !c.is_ascii_digit()).collect::<String>();
        match (self, &failure.broke) {
            (Broken::Invariant { name, .. }, Broke::Invariants(vs)) => {
                vs.iter().any(|v| &v.invariant == name)
            }
            (Broken::Panic { message }, Broke::Panic(m)) => digitless(message) == digitless(m),
            _ => false,
        }
    }
}

impl Replay {
    /// The world and map the replay starts from.
    pub fn start(&self) -> (WorldState, TerrainMap) {
        match self.world.as_str() {
            "twoRealms" => two_realms_world(self.size),
            other => panic!("a replay of the world {other:?}, which no maker makes"),
        }
    }

    /// Reads a replay file.
    pub fn read(path: &std::path::Path) -> Replay {
        let text = std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("reading the replay {}: {e}", path.display()));
        serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("the replay {} is not one: {e}", path.display()))
    }

    /// Writes the replay to `random-orders/seed-<seed>.json` in the build's target directory,
    /// returning where.
    pub fn write(&self) -> PathBuf {
        let target = std::env::var_os("CARGO_TARGET_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target")));
        let dir = target.join("random-orders");
        std::fs::create_dir_all(&dir).expect("the target directory is writable");
        let path = dir.join(format!("seed-{}.json", self.seed));
        let text = serde_json::to_string_pretty(self).expect("a replay is data");
        std::fs::write(&path, text + "\n").expect("the replay is written");
        path
    }
}

/// Plays `replay` again from its world, with `rule` run before every tick (a rule broken on
/// purpose, in tests; `&mut |_| {}` otherwise).
pub fn replay(
    replay: &Replay,
    rule: &mut dyn FnMut(&mut WorldState),
) -> Result<Vec<Given>, Box<Failure>> {
    let (mut world, terrain) = replay.start();
    let mut requests = |_: &WorldState, at: u64| {
        replay
            .orders
            .iter()
            .filter(|s| s.tick == at)
            .map(|s| (s.user_id, s.order.clone()))
            .collect()
    };
    play(&mut world, terrain, replay.seed, replay.ticks, &mut requests, rule)
}

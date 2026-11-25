//! Balance numbers: how much, how fast, how often. The rules (what happens) are in `CONTEXT.md`;
//! these are the values Daniel tunes. One commented constant each, in the file of its domain.
//!
//! A new number is one declaration inside its domain file's `balance!` block: that defines the
//! constant and puts it in the export (`balance_json`), under its own name and in the order of the
//! declarations. Then run `pnpm balance:rust`. The numbers of a building kind are in its spec
//! (`building_specs.rs`), which the tables keyed by a kind are made from, and those of a kind of
//! vessel or siege machine in its own (`craft_specs.rs`). A number the client has no use for stands outside the block and says `Not exported` in its comment. All are read as
//! `balance::NAME`, whichever file they are in. A few numbers sit in the file before or after their
//! domain's (T120.3): there they keep their place in the export.
//!
//! Work (eating, production, building, skill, spoilage, breeding) is counted in game days; social
//! and political timers (memory, standing, persuasion, contracts, punishment, alliance delays) keep
//! their real-time length (`CONTEXT.md`: Game time).
//!
//! Numbers are `f64` as in the client's TypeScript; the exceptions are the tile counts that are
//! grid sizes (`MAP_SIZE`), which are `i32`. Structured constants are structs (serialised in camel
//! case) or `Table`s keyed by a string. Helpers that take a world type (`Resident`, `Horse`,
//! `Stock`) are in `csp-sim`. The client reads the numbers from `packages/balance`, which
//! `pnpm balance:rust` writes from here.

use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;
use serde_json::{Map, Value};

/// Declares the numbers of one domain and its `export`, which puts each of them into the export.
/// Every item is either a constant, declared as usual, or `export NAME = value;`: a value worked out
/// for the client alone, with no constant of that name. The declarations are not indented, so a
/// number's lines look the same inside the block and outside it.
macro_rules! balance {
    ($($(#[$attr:meta])* $vis:vis $kind:ident $name:ident $(: $ty:ty)? = $value:expr;)*) => {
        $(balance!(@declare [$(#[$attr])*] [$vis] $kind $name [$($ty)?] $value);)*

        /// Puts the numbers of this domain into the export, in the order they are declared.
        pub(super) fn export(out: &mut serde_json::Map<String, serde_json::Value>) {
            $(super::put(out, stringify!($name), balance!(@value $kind $name $value));)*
        }
    };
    (@declare [$(#[$attr:meta])*] [$vis:vis] const $name:ident [$ty:ty] $value:expr) => {
        $(#[$attr])*
        $vis const $name: $ty = $value;
    };
    (@declare [$(#[$attr:meta])*] [$vis:vis] export $name:ident [] $value:expr) => {};
    (@value const $name:ident $value:expr) => { &$name };
    (@value export $name:ident $value:expr) => { &$value };
}

mod armies;
mod building_specs;
mod buildings;
mod cities;
mod craft_specs;
mod decay;
mod demands;
mod exploring;
mod fighting;
mod goods;
mod horses;
mod land;
mod names;
mod npc_cities;
mod npc_planning;
mod realms;
mod residents;
mod scripts;
mod skills;
mod standing;
mod starting_city;
mod survival;
mod trade_org;
mod travel;
mod vessels;
mod work;
mod zeal;

/// The domain files, in the order the export lists their numbers (a new one also needs its `mod`).
macro_rules! domains {
    ($($name:ident)*) => {
        $(pub use $name::*;)*

        /// Every exported number as JSON, keyed by its name: what `pnpm balance:rust` writes to
        /// `packages/balance/balance.json` for the client.
        pub fn balance_json() -> Value {
            let mut out = Map::new();
            $($name::export(&mut out);)*
            Value::Object(out)
        }
    };
}

domains! {
    land
    residents
    starting_city
    horses
    cities
    npc_cities
    npc_planning
    trade_org
    goods
    survival
    travel
    vessels
    standing
    buildings
    work
    decay
    realms
    fighting
    skills
    armies
    scripts
    names
    exploring
    demands
    zeal
}

/// Adds a number to the export.
fn put(out: &mut Map<String, Value>, name: &str, value: &impl Serialize) {
    let value = serde_json::to_value(value).expect("serialisable");
    assert!(out.insert(name.to_string(), value).is_none(), "{name} is declared twice");
}

/// A static table from a string key (a good, a building kind, a skill) to a value, in the order
/// the TypeScript object lists them; serialised as a JSON object.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Table<V: 'static>(pub &'static [(&'static str, V)]);

impl<V: Copy> Table<V> {
    /// The value under `key`, if the table has one.
    pub fn get(&self, key: &str) -> Option<V> {
        self.0.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
    }
}

impl<V: Serialize> Serialize for Table<V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in self.0 {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

/// A static table from a terrain byte (`Terrain as u8`) to a number, as the TypeScript objects
/// keyed by `[Terrain.X]`; serialised as a JSON object with the byte as the key.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TerrainTable(pub &'static [(u8, f64)]);

impl TerrainTable {
    /// The number for a terrain byte, if the table lists it.
    pub fn get(&self, terrain: u8) -> Option<f64> {
        self.0.iter().find(|(t, _)| *t == terrain).map(|(_, v)| *v)
    }
}

impl Serialize for TerrainTable {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (terrain, value) in self.0 {
            map.serialize_entry(&terrain.to_string(), value)?;
        }
        map.end()
    }
}

/// `Math.ceil` for constants: `f64::ceil` is not `const` yet.
const fn ceil(x: f64) -> f64 {
    let t = x as i64 as f64;
    if t < x {
        t + 1.0
    } else {
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::{TICKS_PER_GAME_DAY, TICKS_PER_GAME_YEAR};

    #[test]
    fn weighs_goods_by_their_unit_weights() {
        // Coins weigh too: a fortune is heavy.
        assert!(GOOD_WEIGHT.get("coins").unwrap() > 0.0);
        assert_eq!(GOOD_WEIGHT.get("armour"), Some(8.0));
    }

    #[test]
    fn turns_an_age_back_into_ticks_on_both_sides_of_the_boundary() {
        assert_eq!(ticks_for_age(ADULT_AGE), 56.0 * TICKS_PER_GAME_DAY);
        assert_eq!(ticks_for_age(0.0), 0.0);
        assert_eq!(ticks_for_age(3.5), 14.0 * TICKS_PER_GAME_DAY);
        assert_eq!(ticks_for_age(ADULT_AGE + 1.0), 56.0 * TICKS_PER_GAME_DAY + TICKS_PER_GAME_YEAR);
    }

    #[test]
    fn caps_a_skill_at_where_its_bonus_reaches_the_limit() {
        assert_eq!(WORK_SKILL_MAX, 100.0);
        assert_eq!(CONSTRUCTION_SKILL_MAX, 100.0);
        assert_eq!(SKILL_MAX.combat, COMBAT_SKILL_LIMIT / COMBAT_SKILL_EFFECT);
    }

    #[test]
    fn caps_training_a_stat_at_half_its_base() {
        assert_eq!(trained_cap(10.0), 5.0);
        assert_eq!(trained_cap(8.0), 4.0);
        assert_eq!(trained_cap(7.0), 3.0);
    }

    #[test]
    fn rounds_food_for_a_trip_up_to_whole_units() {
        // 100 tiles: 100 * 7.5 * 1.4 ticks = 1050, 0.73 game days, 0.36 units of Food.
        assert_eq!(trip_food(100.0), 1.0);
        assert_eq!(set_out_food(0.0), 2.0 * 0.0 + (SET_OUT_WORK_DAYS * FOOD_PER_DAY).ceil());
        assert_eq!(road_crew_food(TICKS_PER_GAME_DAY * 4.0), 2.0 + GET_FOOD_AT);
        assert!(wagon_food_for(1000.0, 8.0) > wagon_food_for(1000.0, 1.0));
    }

    #[test]
    fn lets_a_carriage_into_everything_but_bare_mountain() {
        use crate::terrain::Terrain;
        for t in [Terrain::Plains, Terrain::Forest, Terrain::Hills, Terrain::Road] {
            assert!(carriage_can_enter(t as u8));
        }
        for t in [Terrain::Mountain, Terrain::Lake, Terrain::Sea] {
            assert!(!carriage_can_enter(t as u8));
        }
    }

    #[test]
    fn computes_the_derived_constants_as_typescript_does() {
        assert_eq!(HORSE_GRANT_FOOD, 4.0);
        assert_eq!(OWN_FOOD, 2.0);
        assert_eq!(DELIVERY_LOAD, 400.0 - 72.0);
        assert_eq!(DIRECTIVE_PUNISH_WORTH, 2.0 * 400.0);
        assert_eq!(TRADE_ORG_LOSS.capture, 400.0 * 6.0);
    }

    /// A number outside `balance!` does not reach the client: that has to be on purpose.
    #[test]
    fn a_number_that_is_not_exported_says_so() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/balance");
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            // A spec's numbers reach the export through the tables and constants made from the specs.
            if path.ends_with("building_specs.rs") || path.ends_with("craft_specs.rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            let mut inside = false;
            let mut said = false;
            for line in text.lines() {
                match line {
                    "balance! {" => inside = true,
                    "}" => inside = false,
                    _ => {}
                }
                let number = (line.starts_with("const ")
                    || line.starts_with("pub const ")
                    || line.starts_with("pub(super) const "))
                    && !line.contains("const fn");
                assert!(
                    !number || inside || said,
                    "{}: `{line}` is neither in `balance!` nor says `Not exported`",
                    path.display()
                );
                said = line.starts_with("///") && (said || line.contains("Not exported"));
            }
        }
    }
}

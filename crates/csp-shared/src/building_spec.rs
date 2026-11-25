//! What a building kind's spec holds, and everything made from the specs: the lists of kinds and,
//! with `spec_table!`, the tables keyed by a kind's name. The specs themselves, one block per kind,
//! are in `balance/building_specs.rs`.

use crate::balance::{Recipe, Table};
use crate::world::{BuildingKind, SkillName};

/// Everything fixed about a kind of building. A fact that does not apply to a kind is `None`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BuildingSpec {
    /// What the kind is for, in words: the Build menu and the ⓘ on a building's card show it.
    /// `{housing}` stands for `housing_room`; no number is typed into it.
    pub purpose: &'static str,
    /// Tiles along each side (`CONTEXT.md`: Footprint).
    pub footprint: i32,
    pub stands: Stands,
    /// Whether it may share a tile with a building: roads and the sites of what moves off.
    pub shares_a_tile: bool,
    /// Whether it keeps goods, as a storage does.
    pub keeps_goods: bool,
    /// How it is built; `None` for a kind nobody builds.
    pub build: Option<BuildSpec>,
    /// What working there takes and gives; `None` for a kind that is no workplace.
    pub workplace: Option<Workplace>,
    /// Residents it houses (`HOUSING_ROOM`).
    pub housing_room: Option<f64>,
    /// Game days it takes to lose all its condition (`DECAY_DAYS`); `None` never decays.
    pub decay_days: Option<f64>,
}

/// Where a kind may stand (`CONTEXT.md`: Where buildings go).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stands {
    /// With one tile on a resource node of its kind.
    OnNode,
    /// Wholly on Plains, off any resource node.
    OnPlains,
    /// On passable land but Mountain, off any resource node; only in a city's area, or only on the
    /// shore (touching Lake or Sea), besides.
    OffNodes { city_area: bool, shore: bool },
    /// By a rule of its own (`build_problem`): roads, and the sites of what moves off. A warehouse,
    /// which nobody builds, has none.
    OwnRule,
}

/// How a kind is built.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BuildSpec {
    /// Its group of the Build menu, and its place among the group's kinds, the first 1.
    pub menu: BuildMenu,
    pub menu_place: u8,
    /// Materials its site needs (`BUILD_MATERIALS`).
    pub materials: Table<f64>,
    /// Work its site needs, in ticks of one unskilled resident (`BUILD_WORK`).
    pub work: f64,
    /// What it takes instead when it is built of stone; `None` for a kind that can't be.
    pub stone: Option<StoneBuild>,
}

/// What a stone wall, gate or tower takes (`STONE_BUILD_MATERIALS`, `STONE_BUILD_WORK`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StoneBuild {
    pub materials: Table<f64>,
    pub work: f64,
}

/// The groups of the Build menu, in the order it shows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildMenu {
    Resources,
    FoodAndAnimals,
    Industry,
    City,
    Defence,
    Transport,
    Siege,
}

impl BuildMenu {
    pub const ALL: [BuildMenu; 7] = [
        BuildMenu::Resources,
        BuildMenu::FoodAndAnimals,
        BuildMenu::Industry,
        BuildMenu::City,
        BuildMenu::Defence,
        BuildMenu::Transport,
        BuildMenu::Siege,
    ];

    /// The group's name, as the menu shows it.
    pub const fn name(self) -> &'static str {
        match self {
            BuildMenu::Resources => "Resources",
            BuildMenu::FoodAndAnimals => "Food and animals",
            BuildMenu::Industry => "Industry",
            BuildMenu::City => "City",
            BuildMenu::Defence => "Defence",
            BuildMenu::Transport => "Transport",
            BuildMenu::Siege => "Siege",
        }
    }

    /// The kinds in the group, in its order.
    pub fn kinds(self) -> Vec<BuildingKind> {
        let mut kinds: Vec<(u8, BuildingKind)> = BuildingKind::ALL
            .iter()
            .filter_map(|k| k.spec().build.map(|b| (b, *k)))
            .filter(|(b, _)| b.menu == self)
            .map(|(b, k)| (b.menu_place, k))
            .collect();
        kinds.sort_by_key(|(place, _)| *place);
        kinds.into_iter().map(|(_, k)| k).collect()
    }
}

/// What working at a kind takes and gives (`CONTEXT.md`: Workplace).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Workplace {
    /// Most residents working there at a time (`WORKPLACE_MAX_WORKERS`).
    pub max_workers: f64,
    /// The skill it uses and teaches (`WORKPLACE_SKILL`).
    pub skill: SkillName,
    /// What it counts for against a Trade Org debt, in Coins (`WORKPLACE_WRECK_WORTH`).
    pub wreck_worth: f64,
    /// What it turns goods into; `None` for a workplace that makes its good from nothing.
    pub processing: Option<Processing>,
}

/// How a workplace turns goods into others.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Processing {
    /// Its recipes (`RECIPES`); the first is its default, but for a smithy, which has none.
    pub recipes: &'static [Recipe],
    /// Batches a worker gets through per game day (`BATCHES_PER_DAY`).
    pub batches_per_day: f64,
}

/// `Option::and_then` in a `const`: what `$then` says of the value in `$option`, if it has one.
macro_rules! opt {
    ($option:expr, $value:ident => $then:expr) => {
        match &$option {
            Some($value) => $then,
            None => None,
        }
    };
}
pub(crate) use opt;

/// A `Table` keyed by name, with a row for each kind whose spec gives a value, in the order of the
/// enum's `ALL`: of `BuildingKind`, or of the enum named.
macro_rules! spec_table {
    ($value:ty, |$spec:ident| $of:expr) => {
        crate::building_spec::spec_table!(BuildingKind: $value, |$spec| $of)
    };
    ($enum:ident: $value:ty, |$spec:ident| $of:expr) => {{
        use crate::world::$enum;
        const fn value_of(kind: $enum) -> Option<$value> {
            let $spec = kind.spec();
            $of
        }
        const KINDS: &[$enum] =
            $crate::building_spec::kinds_where!($enum, |k| value_of(k).is_some());
        const ROWS: [(&str, $value); KINDS.len()] = {
            let Some(first) = value_of(KINDS[0]) else { unreachable!() };
            let mut rows = [(KINDS[0].name(), first); KINDS.len()];
            let mut i = 1;
            while i < KINDS.len() {
                if let Some(value) = value_of(KINDS[i]) {
                    rows[i] = (KINDS[i].name(), value);
                }
                i += 1;
            }
            rows
        };
        crate::balance::Table(&ROWS)
    }};
}
pub(crate) use spec_table;

/// The kinds that pass, in the order of the enum's `ALL`, as a `&'static` slice: of `BuildingKind`,
/// or of the enum named.
macro_rules! kinds_where {
    (|$kind:ident| $passes:expr) => {
        crate::building_spec::kinds_where!(BuildingKind, |$kind| $passes)
    };
    ($enum:ident, |$kind:ident| $passes:expr) => {{
        const fn passes($kind: crate::world::$enum) -> bool {
            $passes
        }
        const ALL: &[crate::world::$enum] = crate::world::$enum::ALL;
        const COUNT: usize = {
            let (mut i, mut n) = (0, 0);
            while i < ALL.len() {
                if passes(ALL[i]) {
                    n += 1;
                }
                i += 1;
            }
            n
        };
        const FOUND: [crate::world::$enum; COUNT] = {
            let mut found = [ALL[0]; COUNT];
            let (mut i, mut n) = (0, 0);
            while i < ALL.len() {
                if passes(ALL[i]) {
                    found[n] = ALL[i];
                    n += 1;
                }
                i += 1;
            }
            found
        };
        &FOUND
    }};
}
pub(crate) use kinds_where;

/// Kinds that may share a tile with a building (`SHARES_A_TILE`): roads, and carriage, boat, ship,
/// ram and catapult sites.
pub const SHARES_A_TILE: &[BuildingKind] = kinds_where!(|k| k.spec().shares_a_tile);

/// Kinds that keep goods (`KEEPS_GOODS`): storages, warehouses, stables and havens.
pub const KEEPS_GOODS: &[BuildingKind] = kinds_where!(|k| k.spec().keeps_goods);

/// Kinds of building that can be built (`BUILDABLE`).
pub const BUILDABLE: &[BuildingKind] = kinds_where!(|k| k.spec().build.is_some());

/// Workplaces that turn goods into other goods (`PROCESSING`, the keys of `RECIPES`).
pub const PROCESSING: &[BuildingKind] =
    kinds_where!(|k| matches!(k.spec().workplace, Some(Workplace { processing: Some(_), .. })));

/// Kinds that go on a resource node: mines, quarries and lumber camps.
pub const ON_NODE: &[BuildingKind] = kinds_where!(|k| matches!(k.spec().stands, Stands::OnNode));

/// Kinds that go on passable land but Mountain, off any resource node (`OFF_NODES`).
pub const OFF_NODES: &[BuildingKind] =
    kinds_where!(|k| matches!(k.spec().stands, Stands::OffNodes { .. }));

/// Kinds that go on the shore, with a tile of their footprint touching Lake or Sea straight or
/// diagonally (`ON_SHORE`, `CONTEXT.md`: Haven): havens.
pub const ON_SHORE: &[BuildingKind] =
    kinds_where!(|k| matches!(k.spec().stands, Stands::OffNodes { shore: true, .. }));

/// Kinds that go wholly on Plains, off any resource node (`ON_PLAINS`): stables and farms.
pub const ON_PLAINS: &[BuildingKind] =
    kinds_where!(|k| matches!(k.spec().stands, Stands::OnPlains));

/// Kinds that go only in a city's area, every tile of their footprint (`IN_CITY_AREA`).
pub const IN_CITY_AREA: &[BuildingKind] =
    kinds_where!(|k| matches!(k.spec().stands, Stands::OffNodes { city_area: true, .. }));

/// What a build menu offers off any resource node (`OFF_NODE_BUILDS`).
pub const OFF_NODE_BUILDS: &[BuildingKind] =
    kinds_where!(|k| matches!(k.spec().stands, Stands::OffNodes { .. } | Stands::OnPlains));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_kinds_name_is_the_one_serde_writes() {
        for k in BuildingKind::ALL {
            assert_eq!(serde_json::to_value(k).unwrap(), k.name());
            assert_eq!(serde_json::from_value::<BuildingKind>(k.name().into()).unwrap(), *k);
        }
    }

    #[test]
    fn a_skills_name_is_the_one_serde_writes() {
        for skill in BuildingKind::ALL.iter().filter_map(|k| k.spec().workplace).map(|w| w.skill) {
            assert_eq!(serde_json::to_value(skill).unwrap(), skill.name());
        }
    }

    #[test]
    fn a_build_menu_groups_kinds_take_the_places_from_one_on() {
        for menu in BuildMenu::ALL {
            let places: Vec<u8> =
                menu.kinds().iter().map(|k| k.spec().build.unwrap().menu_place).collect();
            assert_eq!(places, (1..=places.len() as u8).collect::<Vec<_>>(), "{menu:?}");
        }
    }

    #[test]
    fn only_a_kind_with_a_rule_of_its_own_is_never_built() {
        for k in BuildingKind::ALL.iter().filter(|k| k.spec().build.is_none()) {
            assert_eq!(k.spec().stands, Stands::OwnRule, "{k:?}");
        }
    }
}

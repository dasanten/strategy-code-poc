//! What each kind of building is for, in words, and everything the ⓘ on a building's card says
//! about its kind (`packages/shared/src/building-info.ts`). No numbers typed into the text: they
//! come from the balance.

use csp_shared::balance::{Recipe, BUILD_WORK, HOUSING_ROOM, RECIPES, WORKPLACE_MAX_WORKERS};
use csp_shared::footprint::FOOTPRINT;
use csp_shared::world::{BuildingKind, Good, ResourceKind, SkillName, Stock};

use super::balance::workplace_skill;
use super::building::{build_materials, node_good, node_workplace};
use super::names::kind_name;

/// What each kind of building is for (`BUILDING_PURPOSE`): the one description the Build menu and
/// the building card's ⓘ share.
pub fn building_purpose(kind: BuildingKind) -> String {
    match kind {
        BuildingKind::TownHall => {
            "A town hall founds a new city of your realm; tearing it down dissolves the city.".into()
        }
        BuildingKind::House => format!(
            "A house is room for {} residents; only in a city’s area, and it grows the city.",
            HOUSING_ROOM.get("house").unwrap_or(0.0)
        ),
        BuildingKind::Storage => "A storage keeps a city’s goods: workers carry their output here, and builders fetch materials from it.".into(),
        BuildingKind::Warehouse => "A warehouse keeps the Trade Organization’s goods; a resident or carriage on it can sell goods for its coins or buy with them.".into(),
        BuildingKind::Wall => "A stretch of wall; walls grow the city they stand by, like houses.".into(),
        BuildingKind::Gate => "A gate in a wall, which its city’s realm opens and closes; it grows the city like a wall does.".into(),
        BuildingKind::Farm => "A farm is fields that make Food; on Plains only.".into(),
        BuildingKind::Stable => "A stable keeps horses and their Food, and breeds them; on Plains only.".into(),
        BuildingKind::Mine => "A mine digs the ore of the iron ore or gold ore node it stands on.".into(),
        BuildingKind::Quarry => "A quarry cuts stone from the stone node it stands on.".into(),
        BuildingKind::LumberCamp => "A lumber camp fells wood in the forest node it stands on.".into(),
        BuildingKind::Smelter => "A smelter turns iron ore into iron; not on Mountain.".into(),
        BuildingKind::Mint => "A mint turns gold ore into coins; not on Mountain.".into(),
        BuildingKind::Smithy => "A smithy turns iron and wood into spears, swords, shields and armour; not on Mountain.".into(),
        BuildingKind::TrainingGround => "A training ground is where residents train a stat or a skill under a teacher; not on Mountain. Like a workplace, nobody owns it.".into(),
        BuildingKind::Road => "A road: residents walk and carriages drive faster on it, on any land (slower to build on Mountain), and it can run through a gate. Nobody owns it.".into(),
        BuildingKind::Carriage => "A carriage carries far more than any resident, pulled by a horse; built at a finished stable, on its tiles or right by them, and it belongs to the realm of whoever finishes it.".into(),
        BuildingKind::Haven => "A haven is where boats and ships are built, with a storage anyone at it loads and unloads; on the shore, touching Lake or Sea, and not on Mountain. Like a stable, nobody owns it.".into(),
        BuildingKind::Boat => "A boat is rowed over Lake and Sea with a few residents and a little cargo aboard; built on a tile of a finished haven that touches the water, it floats on the nearest free water tile next to it and belongs to the realm of whoever finishes it.".into(),
        BuildingKind::Ship => "A ship is sailed over the Sea by a crew, carrying far more than a carriage; built on a tile of a finished haven that touches the Sea, it floats on the nearest free Sea tile next to it and belongs to the realm of whoever finishes it.".into(),
    }
}

/// A group of the Build menu and the kinds in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuildGroup {
    pub name: &'static str,
    pub kinds: &'static [BuildingKind],
}

/// The groups of the Build menu and the kinds in each, in the order it shows them
/// (`BUILD_GROUPS`).
pub const BUILD_GROUPS: [BuildGroup; 6] = [
    BuildGroup {
        name: "Resources",
        kinds: &[BuildingKind::LumberCamp, BuildingKind::Quarry, BuildingKind::Mine],
    },
    BuildGroup { name: "Food and animals", kinds: &[BuildingKind::Farm, BuildingKind::Stable] },
    BuildGroup {
        name: "Industry",
        kinds: &[BuildingKind::Smelter, BuildingKind::Mint, BuildingKind::Smithy],
    },
    BuildGroup {
        name: "City",
        kinds: &[
            BuildingKind::TownHall,
            BuildingKind::House,
            BuildingKind::Storage,
            BuildingKind::TrainingGround,
        ],
    },
    BuildGroup { name: "Defence", kinds: &[BuildingKind::Wall, BuildingKind::Gate] },
    BuildGroup {
        name: "Transport",
        kinds: &[
            BuildingKind::Road,
            BuildingKind::Carriage,
            BuildingKind::Haven,
            BuildingKind::Boat,
            BuildingKind::Ship,
        ],
    },
];

/// Everything the ⓘ on a building's card says about its kind (`BuildingInfo`).
#[derive(Debug, Clone, PartialEq)]
pub struct BuildingInfo {
    pub kind: BuildingKind,
    pub purpose: String,
    /// What a workplace that processes goods turns into what (`RECIPES`); empty elsewhere.
    pub recipes: &'static [Recipe],
    /// What a workplace makes from nothing; empty elsewhere.
    pub yields: Vec<Good>,
    /// The skill working here teaches (`WORKPLACE_SKILL`).
    pub skill: Option<SkillName>,
    /// Up to how many residents can work here (`WORKPLACE_MAX_WORKERS`).
    pub max_workers: Option<f64>,
    /// Its footprint's side, in tiles (`FOOTPRINT`).
    pub footprint: i32,
    /// Materials it takes to build (`BUILD_MATERIALS`).
    pub materials: Stock,
    /// Work it takes to build (`BUILD_WORK`).
    pub work: f64,
}

/// The resource kinds in `NODE_WORKPLACE`'s order.
const RESOURCE_KINDS: [ResourceKind; 4] =
    [ResourceKind::Forest, ResourceKind::Stone, ResourceKind::IronOre, ResourceKind::GoldOre];

/// What a kind of building is and does (`buildingInfo`); `node` picks what a mine yields.
pub fn building_info(kind: BuildingKind, node: Option<ResourceKind>) -> BuildingInfo {
    let nodes: Vec<ResourceKind> = match node {
        Some(n) => vec![n],
        None => RESOURCE_KINDS.to_vec(),
    };
    let mut yields: Vec<Good> = Vec::new();
    if kind == BuildingKind::Farm {
        yields.push(Good::Food);
    } else {
        for n in nodes.into_iter().filter(|n| node_workplace(*n) == kind) {
            if !yields.contains(&node_good(n)) {
                yields.push(node_good(n));
            }
        }
    }
    let name = kind_name(kind);
    BuildingInfo {
        kind,
        purpose: building_purpose(kind),
        recipes: RECIPES.get(name).unwrap_or(&[]),
        yields,
        skill: workplace_skill(kind),
        max_workers: WORKPLACE_MAX_WORKERS.get(name),
        footprint: FOOTPRINT.get(name).unwrap_or(0),
        materials: build_materials(kind),
        work: BUILD_WORK.get(name).unwrap_or(0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queries::building::BUILDABLE;
    use crate::queries::names::{good_name, ALL_KINDS};

    #[test]
    fn gives_every_kind_of_building_a_description() {
        for kind in ALL_KINDS {
            assert!(!building_purpose(kind).trim().is_empty(), "{kind:?}");
        }
    }

    #[test]
    fn writes_no_numbers_into_the_text_which_come_from_the_balance() {
        let room = format!("room for {} residents", HOUSING_ROOM.get("house").unwrap());
        for kind in ALL_KINDS {
            let text = building_purpose(kind).replace(&room, "");
            assert!(!text.chars().any(|c| c.is_ascii_digit()), "{kind:?}");
        }
    }

    #[test]
    fn says_how_many_residents_a_house_is_room_for() {
        let room = format!("room for {} residents", HOUSING_ROOM.get("house").unwrap());
        assert!(building_purpose(BuildingKind::House).contains(&room));
    }

    #[test]
    fn puts_every_buildable_kind_in_exactly_one_group_and_nothing_else() {
        let mut grouped: Vec<&str> =
            BUILD_GROUPS.iter().flat_map(|g| g.kinds).map(|k| kind_name(*k)).collect();
        let mut buildable: Vec<&str> = BUILDABLE.iter().map(|k| kind_name(*k)).collect();
        grouped.sort();
        buildable.sort();
        assert_eq!(grouped, buildable);
    }

    #[test]
    fn takes_a_processing_workplaces_recipes_skill_workers_footprint_and_cost_from_the_balance() {
        let info = building_info(BuildingKind::Smelter, None);
        // `toBe` in the TypeScript: the same recipes; a Rust const has no identity to compare.
        assert_eq!(info.recipes, RECIPES.get("smelter").unwrap());
        assert!(info.yields.is_empty());
        assert_eq!(info.skill, Some(SkillName::Smelting));
        assert_eq!(info.max_workers, WORKPLACE_MAX_WORKERS.get("smelter"));
        assert_eq!(Some(info.footprint), FOOTPRINT.get("smelter"));
        assert_eq!(info.materials, build_materials(BuildingKind::Smelter));
        assert!(info.work > 0.0);
    }

    #[test]
    fn says_a_nodes_workplace_yields_what_its_node_does() {
        let names =
            |k, n| -> Vec<&str> { building_info(k, n).yields.into_iter().map(good_name).collect() };
        assert_eq!(names(BuildingKind::Mine, None), ["ironOre", "goldOre"]);
        assert_eq!(names(BuildingKind::Mine, Some(ResourceKind::GoldOre)), ["goldOre"]);
        assert_eq!(names(BuildingKind::LumberCamp, None), ["wood"]);
        assert_eq!(building_info(BuildingKind::Mine, None).skill, Some(SkillName::Mining));
    }

    #[test]
    fn says_a_farm_makes_food_and_a_city_building_nothing() {
        assert_eq!(building_info(BuildingKind::Farm, None).yields, [Good::Food]);
        let house = building_info(BuildingKind::House, None);
        assert!(house.yields.is_empty());
        assert!(house.recipes.is_empty());
        assert_eq!(house.skill, None);
        assert_eq!(house.max_workers, None);
    }

    #[test]
    fn gives_a_kind_with_no_materials_an_empty_cost() {
        assert!(building_info(BuildingKind::Warehouse, None).materials.is_empty());
    }
}

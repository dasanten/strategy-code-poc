//! What each kind of building is for, in words, and everything the ⓘ on a building's card says
//! about its kind. No numbers typed into the text: they come from the balance.

use csp_shared::balance::Recipe;
use csp_shared::building_spec::BuildMenu;
use csp_shared::world::{BuildingKind, Good, ResourceKind, SkillName, Stock};

use super::balance::workplace_skill;
use super::building::{
    build_materials, build_work_of, max_workers, node_good, node_workplace, recipes_of,
};

/// What each kind of building is for (`BUILDING_PURPOSE`): the one description the Build menu and
/// the building card's ⓘ share.
pub fn building_purpose(kind: BuildingKind) -> String {
    let spec = kind.spec();
    spec.purpose.replace("{housing}", &spec.housing_room.unwrap_or(0.0).to_string())
}

/// A group of the Build menu and the kinds in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildGroup {
    pub name: &'static str,
    pub kinds: Vec<BuildingKind>,
}

/// The groups of the Build menu and the kinds in each, in the order it shows them
/// (`BUILD_GROUPS`).
pub fn build_groups() -> Vec<BuildGroup> {
    BuildMenu::ALL.iter().map(|m| BuildGroup { name: m.name(), kinds: m.kinds() }).collect()
}

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
const RESOURCE_KINDS: [ResourceKind; 5] = [
    ResourceKind::Forest,
    ResourceKind::Stone,
    ResourceKind::IronOre,
    ResourceKind::GoldOre,
    ResourceKind::Coal,
];

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
    BuildingInfo {
        kind,
        purpose: building_purpose(kind),
        recipes: recipes_of(kind),
        yields,
        skill: workplace_skill(kind),
        max_workers: max_workers(kind),
        footprint: kind.spec().footprint,
        materials: build_materials(kind),
        work: build_work_of(kind),
    }
}

#[cfg(test)]
mod tests {
    use csp_shared::balance::{HOUSING_ROOM, RECIPES, WORKPLACE_MAX_WORKERS};
    use csp_shared::footprint::FOOTPRINT;

    use super::*;
    use crate::queries::building::BUILDABLE;
    use crate::queries::names::{good_name, kind_name, ALL_KINDS};

    #[test]
    fn gives_every_kind_of_building_a_description() {
        for &kind in ALL_KINDS {
            assert!(!building_purpose(kind).trim().is_empty(), "{kind:?}");
        }
    }

    #[test]
    fn writes_no_numbers_into_the_text_which_come_from_the_balance() {
        let room = format!("room for {} residents", HOUSING_ROOM.get("house").unwrap());
        for &kind in ALL_KINDS {
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
            build_groups().iter().flat_map(|g| &g.kinds).map(|k| kind_name(*k)).collect();
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
        assert_eq!(names(BuildingKind::Mine, None), ["ironOre", "goldOre", "coal"]);
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

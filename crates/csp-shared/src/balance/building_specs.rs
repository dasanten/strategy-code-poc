//! Building kinds: every fact and number of each kind, one block per kind (`BuildingSpec`). The
//! balance tables (`BUILD_MATERIALS`, `DECAY_DAYS`, ...), the Build menu and every list of kinds are
//! made from these blocks (`building_spec.rs`), so a new kind is its name in `BuildingKind` and its
//! block here. What each number means is said at its table and at `BuildingSpec`.

use super::*;
use crate::building_spec::{
    BuildMenu, BuildSpec, BuildingSpec, Processing, Stands, StoneBuild, Workplace,
};
use crate::time::TICKS_PER_GAME_DAY;
use crate::world::{BuildingKind, SkillName};

impl BuildingKind {
    /// The kind's facts and numbers. Exhaustive: a kind without a block does not compile.
    pub const fn spec(self) -> &'static BuildingSpec {
        match self {
            BuildingKind::TownHall => &TOWN_HALL,
            BuildingKind::House => &HOUSE,
            BuildingKind::Storage => &STORAGE,
            BuildingKind::Warehouse => &WAREHOUSE,
            BuildingKind::Wall => &WALL,
            BuildingKind::Gate => &GATE,
            BuildingKind::Tower => &TOWER,
            BuildingKind::Farm => &FARM,
            BuildingKind::Stable => &STABLE,
            BuildingKind::Mine => &MINE,
            BuildingKind::Quarry => &QUARRY,
            BuildingKind::LumberCamp => &LUMBER_CAMP,
            BuildingKind::Smelter => &SMELTER,
            BuildingKind::Mint => &MINT,
            BuildingKind::Smithy => &SMITHY,
            BuildingKind::Kiln => &KILN,
            BuildingKind::TrainingGround => &TRAINING_GROUND,
            BuildingKind::Road => &ROAD,
            BuildingKind::Carriage => &CARRIAGE,
            BuildingKind::Haven => &HAVEN,
            BuildingKind::Boat => &BOAT,
            BuildingKind::Ship => &SHIP,
            BuildingKind::Ram => &RAM,
            BuildingKind::Catapult => &CATAPULT,
            BuildingKind::Ballista => &BALLISTA,
        }
    }
}

const TOWN_HALL: BuildingSpec = BuildingSpec {
    label: "Town hall",
    purpose: "A town hall founds a new city of your realm; tearing it down dissolves the city.",
    footprint: 3,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::City,
        menu_place: 1,
        materials: Table(&[("wood", 60.0), ("stone", 40.0)]),
        work: 6.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: Some(7200.0),
};

const HOUSE: BuildingSpec = BuildingSpec {
    label: "House",
    purpose: "A house is room for {housing} residents; only in a city’s area, and it grows the \
              city.",
    footprint: 2,
    stands: Stands::OffNodes { city_area: true, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::City,
        menu_place: 2,
        // A house (`CONTEXT.md`: House): timber for four residents' room.
        materials: Table(&[("wood", 20.0)]),
        work: TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: Some(4.0),
    decay_days: Some(4500.0),
};

const STORAGE: BuildingSpec = BuildingSpec {
    label: "Storage",
    purpose: "A storage keeps a city’s goods: workers carry their output here, and builders fetch \
              materials from it.",
    footprint: 2,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: true,
    build: Some(BuildSpec {
        menu: BuildMenu::City,
        menu_place: 3,
        // A storage (`CONTEXT.md`: Storage): a timber store on a stone floor, a little more than a
        // house.
        materials: Table(&[("wood", 30.0), ("stone", 10.0)]),
        work: 2.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: Some(5400.0),
};

const WAREHOUSE: BuildingSpec = BuildingSpec {
    label: "Warehouse",
    purpose: "A warehouse keeps the Trade Organization’s goods; a resident or carriage on it can \
              sell goods for its coins or buy with them.",
    footprint: 3,
    stands: Stands::OwnRule,
    shares_a_tile: false,
    keeps_goods: true,
    build: None,
    workplace: None,
    housing_room: None,
    decay_days: Some(10800.0),
};

const WALL: BuildingSpec = BuildingSpec {
    label: "Wall",
    purpose: "A stretch of wall; walls grow the city they stand by, like houses.",
    footprint: 1,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Defence,
        menu_place: 1,
        // A tile of wall: about a quarter of what a 40 m stretch took.
        materials: Table(&[("wood", 3.0)]),
        work: TICKS_PER_GAME_DAY / 16.0,
        stone: Some(StoneBuild {
            materials: Table(&[("stone", 4.0)]),
            work: 3.0 * TICKS_PER_GAME_DAY / 16.0,
        }),
    }),
    workplace: None,
    housing_room: None,
    decay_days: Some(2700.0),
};

const GATE: BuildingSpec = BuildingSpec {
    label: "Gate",
    purpose: "A gate in a wall, which its city’s realm opens and closes; it grows the city like a \
              wall does.",
    footprint: 1,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Defence,
        menu_place: 2,
        // A gate, of a wall's tile.
        materials: Table(&[("wood", 4.0)]),
        work: TICKS_PER_GAME_DAY / 8.0,
        stone: Some(StoneBuild {
            materials: Table(&[("stone", 6.0)]),
            work: 3.0 * TICKS_PER_GAME_DAY / 8.0,
        }),
    }),
    workplace: None,
    housing_room: None,
    decay_days: Some(2700.0),
};

const TOWER: BuildingSpec = BuildingSpec {
    label: "Tower",
    purpose:
        "A tower is a square building of wood or stone, two tiles a side, in a wall’s line or \
              alone; it closes the way like a wall, its top is part of the wall walk where a wall \
              touches it, and it holds a few residents up at once. It is broken like a wall but \
              holds out longer.",
    footprint: 2,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Defence,
        menu_place: 3,
        // A tower (`CONTEXT.md`: Tower): a 2×2 timber keep with room on top, about seven tiles of
        // wall.
        materials: Table(&[("wood", 20.0)]),
        work: TICKS_PER_GAME_DAY / 2.0,
        stone: Some(StoneBuild {
            materials: Table(&[("stone", 28.0)]),
            work: 3.0 * TICKS_PER_GAME_DAY / 2.0,
        }),
    }),
    workplace: None,
    housing_room: None,
    // Never decays, though the rules say every finished building does (#1615).
    decay_days: None,
};

const FARM: BuildingSpec = BuildingSpec {
    label: "Farm",
    purpose: "A farm is fields that make Food; on Plains only.",
    footprint: 4,
    stands: Stands::OnPlains,
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::FoodAndAnimals,
        menu_place: 1,
        // A farm is fields on Plains: work, but no materials, so a city can always feed itself.
        materials: Table(&[]),
        work: TICKS_PER_GAME_DAY / 2.0,
        stone: None,
    }),
    workplace: Some(Workplace {
        max_workers: 10.0,
        skill: SkillName::Farming,
        wreck_worth: 200.0,
        processing: None,
    }),
    housing_room: None,
    decay_days: Some(3600.0),
};

const STABLE: BuildingSpec = BuildingSpec {
    label: "Stable",
    purpose: "A stable keeps horses and their Food, and breeds them; on Plains only.",
    footprint: 3,
    stands: Stands::OnPlains,
    shares_a_tile: false,
    keeps_goods: true,
    build: Some(BuildSpec {
        menu: BuildMenu::FoodAndAnimals,
        menu_place: 2,
        materials: Table(&[("wood", 40.0)]),
        work: 3.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: Some(4500.0),
};

const MINE: BuildingSpec = BuildingSpec {
    label: "Mine",
    purpose: "A mine digs what the iron ore, gold ore or coal node it stands on yields.",
    footprint: 2,
    stands: Stands::OnNode,
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Resources,
        menu_place: 3,
        materials: Table(&[("wood", 40.0), ("stone", 20.0)]),
        work: 4.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: Some(Workplace {
        max_workers: 8.0,
        skill: SkillName::Mining,
        wreck_worth: 400.0,
        processing: None,
    }),
    housing_room: None,
    decay_days: Some(5400.0),
};

const QUARRY: BuildingSpec = BuildingSpec {
    label: "Quarry",
    purpose: "A quarry cuts stone from the stone node it stands on.",
    footprint: 2,
    stands: Stands::OnNode,
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Resources,
        menu_place: 2,
        materials: Table(&[("wood", 30.0)]),
        work: 3.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: Some(Workplace {
        max_workers: 6.0,
        skill: SkillName::Mining,
        wreck_worth: 240.0,
        processing: None,
    }),
    housing_room: None,
    decay_days: Some(5400.0),
};

const LUMBER_CAMP: BuildingSpec = BuildingSpec {
    label: "Lumber camp",
    purpose: "A lumber camp fells wood in the forest node it stands on.",
    footprint: 2,
    stands: Stands::OnNode,
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Resources,
        menu_place: 1,
        materials: Table(&[]),
        work: 2.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: Some(Workplace {
        max_workers: 6.0,
        skill: SkillName::Woodcutting,
        wreck_worth: 200.0,
        processing: None,
    }),
    housing_room: None,
    decay_days: Some(4500.0),
};

const SMELTER: BuildingSpec = BuildingSpec {
    label: "Smelter",
    purpose: "A smelter turns iron ore into iron, or iron and coal into steel; not on Mountain.",
    footprint: 2,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Industry,
        menu_place: 1,
        materials: Table(&[("stone", 40.0), ("wood", 20.0)]),
        work: 4.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: Some(Workplace {
        max_workers: 4.0,
        skill: SkillName::Smelting,
        wreck_worth: 400.0,
        processing: Some(Processing {
            recipes: &[
                Recipe { input: Table(&[("ironOre", 2.0)]), output: Table(&[("iron", 1.0)]) },
                Recipe {
                    input: Table(&[("iron", 1.0), ("coal", 1.0)]),
                    output: Table(&[("steel", 1.0)]),
                },
            ],
            batches_per_day: 2.0,
        }),
    }),
    housing_room: None,
    decay_days: Some(10800.0),
};

const MINT: BuildingSpec = BuildingSpec {
    label: "Mint",
    purpose: "A mint turns gold ore into coins; not on Mountain.",
    footprint: 2,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Industry,
        menu_place: 2,
        materials: Table(&[("stone", 40.0), ("iron", 10.0)]),
        work: 5.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: Some(Workplace {
        max_workers: 4.0,
        skill: SkillName::Smelting,
        wreck_worth: 560.0,
        processing: Some(Processing {
            recipes: &[Recipe {
                input: Table(&[("goldOre", 1.0)]),
                output: Table(&[("coins", 10.0)]),
            }],
            batches_per_day: 2.0,
        }),
    }),
    housing_room: None,
    decay_days: Some(10800.0),
};

const SMITHY: BuildingSpec = BuildingSpec {
    label: "Smithy",
    purpose: "A smithy turns iron and wood into spears, swords, shields and armour, and steel and \
              wood into steel swords, shields and armour; not on Mountain.",
    footprint: 2,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Industry,
        menu_place: 3,
        materials: Table(&[("stone", 30.0), ("wood", 20.0), ("iron", 10.0)]),
        work: 5.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: Some(Workplace {
        max_workers: 4.0,
        skill: SkillName::Smithing,
        wreck_worth: 600.0,
        processing: Some(Processing {
            recipes: &[
                Recipe {
                    input: Table(&[("iron", 1.0), ("wood", 2.0)]),
                    output: Table(&[("spear", 1.0)]),
                },
                Recipe {
                    input: Table(&[("iron", 2.0), ("wood", 1.0)]),
                    output: Table(&[("sword", 1.0)]),
                },
                Recipe {
                    input: Table(&[("iron", 1.0), ("wood", 3.0)]),
                    output: Table(&[("shield", 1.0)]),
                },
                Recipe {
                    input: Table(&[("iron", 7.0), ("wood", 1.0)]),
                    output: Table(&[("armour", 1.0)]),
                },
                Recipe {
                    input: Table(&[("steel", 2.0), ("wood", 1.0)]),
                    output: Table(&[("steelSword", 1.0)]),
                },
                Recipe {
                    input: Table(&[("steel", 1.0), ("wood", 3.0)]),
                    output: Table(&[("steelShield", 1.0)]),
                },
                Recipe {
                    input: Table(&[("steel", 7.0), ("wood", 1.0)]),
                    output: Table(&[("steelArmour", 1.0)]),
                },
                Recipe {
                    input: Table(&[("iron", 1.0), ("wood", 1.0)]),
                    output: Table(&[("tools", 1.0)]),
                },
                Recipe { input: Table(&[("wood", 2.0)]), output: Table(&[("bow", 1.0)]) },
                Recipe {
                    input: Table(&[("iron", 1.0), ("wood", 3.0)]),
                    output: Table(&[("crossbow", 1.0)]),
                },
                Recipe {
                    input: Table(&[("iron", 1.0), ("wood", 3.0)]),
                    output: Table(&[("arrows", 40.0)]),
                },
            ],
            batches_per_day: 2.0,
        }),
    }),
    housing_room: None,
    decay_days: Some(10800.0),
};

const TRAINING_GROUND: BuildingSpec = BuildingSpec {
    label: "Training ground",
    purpose:
        "A training ground is where residents train a stat or a skill under a teacher; not on \
              Mountain. Like a workplace, nobody owns it.",
    footprint: 3,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::City,
        menu_place: 4,
        // A training ground (`CONTEXT.md`: Training ground): a fenced yard with posts and racks on
        // a few paving stones, so mostly Wood and a little Stone, no iron; a bit more timber than
        // a stable, and buildable before any smelter.
        materials: Table(&[("wood", 50.0), ("stone", 10.0)]),
        work: 3.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: Some(5400.0),
};

const ROAD: BuildingSpec = BuildingSpec {
    label: "Road",
    purpose: "A road: residents walk and carriages drive faster on it, on any land (slower to \
              build on Mountain), and it can run through a gate. Nobody owns it.",
    footprint: 1,
    stands: Stands::OwnRule,
    shares_a_tile: true,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Transport,
        menu_place: 1,
        // A tile of road (`CONTEXT.md`: Road): a little Stone, so a quarry pays for a long road;
        // about a quarter of what a 40 m tile took.
        materials: Table(&[("stone", 1.0)]),
        work: TICKS_PER_GAME_DAY / 16.0,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: Some(2700.0),
};

const CARRIAGE: BuildingSpec = BuildingSpec {
    label: "Carriage",
    purpose: "A carriage carries far more than any resident, pulled by a horse; built at a \
              finished stable, on its tiles or right by them, and it belongs to the realm of \
              whoever finishes it.",
    footprint: 1,
    stands: Stands::OwnRule,
    shares_a_tile: true,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Transport,
        menu_place: 2,
        // A carriage, built at a stable (`CONTEXT.md`: Carriage): a wooden cart with iron
        // fittings, so a realm needs a smelter's iron for its second carriage.
        materials: Table(&[("wood", 30.0), ("iron", 5.0)]),
        work: 2.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: None,
};

const HAVEN: BuildingSpec = BuildingSpec {
    label: "Haven",
    purpose: "A haven is where boats and ships are built, with a storage anyone at it loads and \
              unloads; on the shore, touching Lake or Sea, and not on Mountain. Like a stable, \
              nobody owns it.",
    footprint: 3,
    stands: Stands::OffNodes { city_area: false, shore: true },
    shares_a_tile: false,
    keeps_goods: true,
    build: Some(BuildSpec {
        menu: BuildMenu::Transport,
        menu_place: 3,
        // A haven (`CONTEXT.md`: Haven): timber jetties and slipways on stone footings at the
        // shore, so mostly Wood and some Stone; a little more timber than a town hall, which
        // covers as much.
        materials: Table(&[("wood", 70.0), ("stone", 20.0)]),
        work: 4.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: Some(5400.0),
};

const BOAT: BuildingSpec = BuildingSpec {
    label: "Boat",
    purpose: "A boat is rowed over Lake and Sea with a few residents and a little cargo aboard; \
              built on a tile of a finished haven that touches the water, it floats on the nearest \
              free water tile next to it and belongs to the realm of whoever finishes it.",
    footprint: 1,
    stands: Stands::OwnRule,
    shares_a_tile: true,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Transport,
        menu_place: 4,
        // A boat, built at a haven (`CONTEXT.md`: Building a boat): planks, a thwart and oars,
        // pegged rather than nailed, so all Wood and buildable before any smelter; two thirds of a
        // carriage's timber.
        materials: Table(&[("wood", 20.0)]),
        work: TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: None,
};

const SHIP: BuildingSpec = BuildingSpec {
    label: "Ship",
    purpose:
        "A ship is sailed over the Sea by a crew, carrying far more than a carriage; built on \
              a tile of a finished haven that touches the Sea, it floats on the nearest free Sea \
              tile next to it and belongs to the realm of whoever finishes it.",
    footprint: 1,
    stands: Stands::OwnRule,
    shares_a_tile: true,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Transport,
        menu_place: 5,
        // A ship, built at a haven on the Sea (`CONTEXT.md`: Building a ship): a hull, a mast and
        // rigging, iron-fastened, so Wood and some Iron; six boats' timber.
        materials: Table(&[("wood", 120.0), ("iron", 15.0)]),
        work: 10.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: None,
};

const RAM: BuildingSpec = BuildingSpec {
    label: "Ram",
    purpose: "A ram is a siege machine built in the field, anywhere a carriage could stand; \
              finished, it belongs to the realm of whoever finishes it, and a crew of its \
              residents pushes it slowly where a carriage could go. Blows break it, and its realm \
              can tear it down.",
    footprint: 1,
    stands: Stands::OwnRule,
    shares_a_tile: true,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Siege,
        menu_place: 1,
        // A ram (`CONTEXT.md`: Siege machine, Ram): a roofed frame on wheels round a heavy beam
        // with an iron head, so a little more timber than a carriage and as much Iron; built in
        // the field.
        materials: Table(&[("wood", 40.0), ("iron", 5.0)]),
        work: 2.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: None,
};

const CATAPULT: BuildingSpec = BuildingSpec {
    label: "Catapult",
    purpose: "A catapult is a siege machine built in the field like a ram; its crew throws Stone \
              they or its tile hold at a wall, gate or tower far out of any archer's reach. It \
              hits buildings only, and its crew stands in the open.",
    footprint: 1,
    stands: Stands::OwnRule,
    shares_a_tile: true,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Siege,
        menu_place: 2,
        // A catapult (`CONTEXT.md`: Siege machine, Catapult): a timber frame and throwing arm on
        // wheels, iron-bound, weighted with Stone for its counterweight; a little less timber than
        // a ram.
        materials: Table(&[("wood", 30.0), ("iron", 5.0), ("stone", 10.0)]),
        work: 2.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: None,
};

const KILN: BuildingSpec = BuildingSpec {
    label: "Kiln",
    purpose: "A kiln burns wood into coal; not on Mountain.",
    footprint: 2,
    stands: Stands::OffNodes { city_area: false, shore: false },
    shares_a_tile: false,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Industry,
        menu_place: 4,
        materials: Table(&[("stone", 30.0), ("wood", 10.0)]),
        work: 3.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: Some(Workplace {
        max_workers: 3.0,
        skill: SkillName::Smelting,
        wreck_worth: 250.0,
        processing: Some(Processing {
            recipes: &[Recipe { input: Table(&[("wood", 3.0)]), output: Table(&[("coal", 1.0)]) }],
            batches_per_day: 2.0,
        }),
    }),
    housing_room: None,
    decay_days: Some(10800.0),
};

const BALLISTA: BuildingSpec = BuildingSpec {
    label: "Ballista",
    purpose: "A ballista is a siege machine built in the field like a ram.",
    footprint: 1,
    stands: Stands::OwnRule,
    shares_a_tile: true,
    keeps_goods: false,
    build: Some(BuildSpec {
        menu: BuildMenu::Siege,
        menu_place: 3,
        materials: Table(&[("wood", 30.0), ("iron", 3.0)]),
        work: 2.0 * TICKS_PER_GAME_DAY,
        stone: None,
    }),
    workplace: None,
    housing_room: None,
    decay_days: None,
};
